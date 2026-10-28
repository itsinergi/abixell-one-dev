import type { ActorContext } from "../../domain/shared-kernel/audit-context.js";
import type {
  ChangeRequestStatus,
  CreateChangeRequestInput,
  OrganizationUnitHierarchyRepository,
  TombstoneInput,
} from "../../domain/organization-unit/organization-unit-hierarchy.entity.js";
import { ORGANIZATION_UNIT_BACKDATE_LIMIT_DAYS } from "../../domain/organization-unit/organization-unit-hierarchy.entity.js";
import type { OrganizationUnitRepository } from "../../domain/organization-unit/organization-unit.entity.js";
import { ConflictError, NotFoundError } from "../../domain/shared-kernel/errors.js";
import type { RbacService } from "../rbac/rbac.service.js";
import type { ParameterReader } from "../../domain/configuration/parameter-reader.js";

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Epic 5 Gelombang 2 (§4.5 steps 10–13) — the Organization Unit structure
 * surface: effective-dated history, Admin Tenant proposals, Super Admin
 * review/publish/reject, and the tombstone/replacement flow.
 *
 * The service is a gatekeeper, not an owner of the rules: every rule it states
 * is re-evaluated inside the repository's transaction against locked rows. Its
 * job is to make the refusal arrive early, named, and with the actor's
 * permission and Data Scope already established — the same split
 * `OrganizationUnitService` uses for lifecycle (see its header).
 *
 * "Super Admin" is a permission here, not a flag: the codebase has one
 * authority model (permission + Data Scope from the SAME assignment, Epic 1 §4.1
 * C / ADR-0009), so review authority is `organization_unit.change_request.review`
 * and nothing in this file assumes the actor is privileged otherwise.
 */
export class OrganizationUnitHierarchyService {
  constructor(
    private readonly repo: OrganizationUnitHierarchyRepository,
    private readonly units: OrganizationUnitRepository,
    private readonly rbac: RbacService,
    private readonly parameters?: ParameterReader,
  ) {}

  /** §4.5 Putaran 5 — "Draft change request berisi before/after, effective date,
   * reason, dan proposer." Anyone who may edit the unit may propose; publishing
   * is the separate permission checked at publish time, never here. */
  async createChangeRequest(actor: ActorContext, input: CreateChangeRequestInput) {
    await this.rbac.requirePermission(actor, "organization_unit.change_request.create");

    const unit = await this.units.findById(input.organizationUnitId);
    if (!unit || unit.tenantId !== actor.tenantId) {
      throw new NotFoundError("OrganizationUnit", input.organizationUnitId);
    }
    await this.rbac.requireOrganizationUnitScopeForActor(actor, unit.id);

    if (!(input.requestedEffectiveFrom instanceof Date) || Number.isNaN(input.requestedEffectiveFrom.getTime())) {
      throw new ConflictError("A change request needs a valid effective date");
    }
    if (!input.reason || input.reason.trim().length === 0) {
      throw new ConflictError("A change request needs a reason");
    }
    await this.assertWithinBackdateLimit(actor.tenantId, input.requestedEffectiveFrom, new Date());

    return this.repo.createChangeRequest(input, actor);
  }

  /** Read surface: the reviewer queue and the per-unit proposal history. */
  async listChangeRequests(
    actor: ActorContext,
    filter: { organizationUnitId?: string; status?: ChangeRequestStatus } = {},
  ) {
    await this.rbac.requirePermission(actor, "organization_unit.read");
    if (filter.organizationUnitId) {
      const unit = await this.units.findById(filter.organizationUnitId);
      if (!unit || unit.tenantId !== actor.tenantId) {
        throw new NotFoundError("OrganizationUnit", filter.organizationUnitId);
      }
      await this.rbac.requireOrganizationUnitScopeForActor(actor, unit.id);
    }
    return this.repo.listChangeRequests(actor.tenantId, filter);
  }

  /** §4.5 principle 12 — only the Super Admin publishes. The Data Scope is
   * checked against the unit the request targets, so a reviewer can only publish
   * structure they can see. */
  async publishChangeRequest(actor: ActorContext, id: string) {
    await this.rbac.requirePermission(actor, "organization_unit.change_request.review");
    const request = await this.repo.findChangeRequest(id);
    if (!request || request.tenantId !== actor.tenantId) {
      throw new NotFoundError("OrganizationUnitChangeRequest", id);
    }
    await this.rbac.requireOrganizationUnitScopeForActor(actor, request.organizationUnitId);
    await this.assertWithinBackdateLimit(actor.tenantId, request.requestedEffectiveFrom, new Date());
    return this.repo.publishChangeRequest(id, actor);
  }

  async rejectChangeRequest(actor: ActorContext, id: string, reviewReason: string) {
    await this.rbac.requirePermission(actor, "organization_unit.change_request.review");
    const request = await this.repo.findChangeRequest(id);
    if (!request || request.tenantId !== actor.tenantId) {
      throw new NotFoundError("OrganizationUnitChangeRequest", id);
    }
    await this.rbac.requireOrganizationUnitScopeForActor(actor, request.organizationUnitId);
    return this.repo.rejectChangeRequest(id, reviewReason, actor);
  }

  async cancelChangeRequest(actor: ActorContext, id: string) {
    await this.rbac.requirePermission(actor, "organization_unit.change_request.create");
    const request = await this.repo.findChangeRequest(id);
    if (!request || request.tenantId !== actor.tenantId) {
      throw new NotFoundError("OrganizationUnitChangeRequest", id);
    }
    return this.repo.cancelChangeRequest(id, actor);
  }

  /**
   * §4.5 principle 7 read — the parent-child history of a unit, optionally the
   * single version in force at a business date. The unit is resolved through the
   * Organization Unit repository so the Tenant check and the Data Scope walk are
   * the same ones every other Organization Unit read uses.
   */
  async history(actor: ActorContext, organizationUnitId: string, at?: Date) {
    await this.rbac.requirePermission(actor, "organization_unit.read");
    const unit = await this.units.findById(organizationUnitId);
    if (!unit || unit.tenantId !== actor.tenantId) {
      throw new NotFoundError("OrganizationUnit", organizationUnitId);
    }
    await this.rbac.requireOrganizationUnitScopeForActor(actor, unit.id);
    if (at && Number.isNaN(at.getTime())) {
      throw new ConflictError("The 'at' query parameter must be an ISO-8601 timestamp");
    }
    return at ? this.repo.listHistory(organizationUnitId, at) : this.repo.listHistory(organizationUnitId);
  }

  /** §4.5 step 13 — the delete an Organization Unit actually gets. A unit with
   * references is tombstoned; the reference census is reported so the caller and
   * the audit trail can see whether a physical delete would even have been
   * eligible (§4.5 principle 6). */
  async tombstone(actor: ActorContext, organizationUnitId: string, input: TombstoneInput) {
    await this.rbac.requirePermission(actor, "organization_unit.tombstone");
    const unit = await this.units.findById(organizationUnitId);
    if (!unit || unit.tenantId !== actor.tenantId) {
      throw new NotFoundError("OrganizationUnit", organizationUnitId);
    }
    await this.rbac.requireOrganizationUnitScopeForActor(actor, unit.id);
    if (input.effectiveFrom) await this.assertWithinBackdateLimit(actor.tenantId, input.effectiveFrom, new Date());
    return this.repo.tombstoneUnit(organizationUnitId, input, actor);
  }

  /**
   * §4.5 G — "Boleh terbatas oleh Super Admin; reason dan audit khusus wajib."
   * The bound is a policy slot (§4.5 open item #1, owned by Epic 8); until that
   * parameter exists the platform default applies, and it applies to a proposal
   * and to its publish alike, so a request cannot become unpublishable between
   * the two.
   */
  private async assertWithinBackdateLimit(
    tenantId: string,
    effectiveFrom: Date,
    publishedAt: Date,
  ): Promise<void> {
    if (effectiveFrom.getTime() >= publishedAt.getTime()) return;
    const limitDays = this.parameters
      ? await this.parameters.getInteger(
          tenantId,
          "platform.organization_unit.backdate_limit_days",
          ORGANIZATION_UNIT_BACKDATE_LIMIT_DAYS,
        )
      : ORGANIZATION_UNIT_BACKDATE_LIMIT_DAYS;
    const ageDays = (publishedAt.getTime() - effectiveFrom.getTime()) / DAY_MS;
    if (ageDays > limitDays) {
      throw new ConflictError(
        `Backdated hierarchy changes are limited to ${limitDays} days; ` +
          `${effectiveFrom.toISOString()} is ${Math.floor(ageDays)} days before the publish date`,
      );
    }
  }
}
