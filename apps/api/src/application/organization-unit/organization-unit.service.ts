import type {
  CreateOrganizationUnitInput,
  OrganizationUnitRepository,
  UpdateOrganizationUnitInput,
} from "../../domain/organization-unit/organization-unit.entity.js";
import type { RbacService } from "../rbac/rbac.service.js";
import type { RbacRepository } from "../../domain/rbac/rbac.entity.js";
import type { LifecycleStatus } from "../../domain/legal-entity/legal-entity.entity.js";
import type { ActorContext } from "../../domain/shared-kernel/audit-context.js";
import { ConflictError, ForbiddenError, NotFoundError } from "../../domain/shared-kernel/errors.js";

/**
 * Organization Unit application service.
 *
 * No `AuditService` dependency: every write is governed and the transaction in
 * `PgOrganizationUnitRepository` records its own audit row, so the trail can
 * never outlive a rolled-back change.
 *
 * The service layer additionally protects the root Central (§4.5 Putaran 4)
 * *before* the repository is reached, so the caller gets a named refusal rather
 * than a constraint error.
 */
export class OrganizationUnitService {
  constructor(
    private readonly repo: OrganizationUnitRepository,
    private readonly rbac: RbacService,
    private readonly rbacRepo: RbacRepository,
  ) {}

  async create(actor: ActorContext, input: Omit<CreateOrganizationUnitInput, "tenantId">) {
    await this.rbac.requirePermission(actor, "organization_unit.create");

    // Data Scope check: creating a root unit (no parent) requires
    // tenant-wide scope; creating a child requires scope covering the
    // parent unit (exact-match in 0B — see docs/decision-log.md gap).
    if (input.parentId) {
      const parent = await this.repo.findById(input.parentId);
      if (!parent) throw new NotFoundError("OrganizationUnit", input.parentId);
      if (parent.tenantId !== actor.tenantId) {
        throw new ForbiddenError("Parent Organization Unit belongs to a different Tenant");
      }
      await this.rbac.requireOrganizationUnitScopeForActor(actor, input.parentId);
    } else {
      const hasTenantScope = await this.rbac.hasTenantScope(actor);
      if (!hasTenantScope) {
        throw new ForbiddenError(
          "Creating a root Organization Unit requires tenant-wide Data Scope",
        );
      }
    }

    return this.repo.create({ ...input, tenantId: actor.tenantId }, actor);
  }

  async update(
    actor: ActorContext,
    id: string,
    input: UpdateOrganizationUnitInput,
  ) {
    await this.rbac.requirePermission(actor, "organization_unit.update");
    const unit = await this.repo.findById(id);
    if (!unit || unit.tenantId !== actor.tenantId) throw new NotFoundError("OrganizationUnit", id);
    await this.rbac.requireOrganizationUnitScopeForActor(actor, id);
    return this.repo.update(id, input, actor);
  }

  async setActive(actor: ActorContext, id: string, isActive: boolean) {
    await this.rbac.requirePermission(
      actor,
      isActive ? "organization_unit.activate" : "organization_unit.deactivate",
    );
    const unit = await this.repo.findById(id);
    if (!unit || unit.tenantId !== actor.tenantId) throw new NotFoundError("OrganizationUnit", id);
    this.assertRootCentralSurvives(unit.unitType, unit.parentId, isActive);
    await this.rbac.requireOrganizationUnitScopeForActor(actor, id);
    return this.repo.setActive(id, isActive, actor);
  }

  /**
   * Explicit lifecycle transition (`POST /organization-units/:id/status`).
   * G0 §5 keeps the same policy as the Legal Entity: `draft → active`,
   * `active → inactive`, `inactive → active`, `inactive → tombstone`.
   */
  async updateStatus(actor: ActorContext, id: string, status: LifecycleStatus) {
    await this.rbac.requirePermission(
      actor,
      status === "active" ? "organization_unit.activate" : "organization_unit.deactivate",
    );
    const unit = await this.repo.findById(id);
    if (!unit || unit.tenantId !== actor.tenantId) throw new NotFoundError("OrganizationUnit", id);
    this.assertRootCentralSurvives(unit.unitType, unit.parentId, status === "active");
    await this.rbac.requireOrganizationUnitScopeForActor(actor, id);
    return this.repo.updateStatus(id, status, actor);
  }

  /**
   * §4.5 Putaran 4: "Setiap Legal Entity wajib memiliki tepat satu root
   * Organization Unit bernama Central. Dibuat otomatis saat Legal Entity dibuat
   * dan tidak boleh dihapus." The database trigger refuses the write; this
   * states the rule where the caller can read it, and audits nothing because
   * nothing is written.
   */
  private assertRootCentralSurvives(
    unitType: string,
    parentId: string | null,
    isActive: boolean,
  ): void {
    if (unitType === "Central" && parentId === null && !isActive) {
      throw new ConflictError("Root Central Organization Unit cannot be deactivated");
    }
  }

  async listForTenant(actor: ActorContext) {
    await this.rbac.requirePermission(actor, "organization_unit.read");

    const all = await this.repo.listByTenant(actor.tenantId);
    const hasTenantScope = await this.rbac.hasTenantScope(actor);
    if (hasTenantScope) return all;

    // Hierarchical scope filter (Checkpoint 0F / ADR-0009, supersedes the
    // 0B exact-match-only rule): a unit is visible if the actor's Data
    // Scope covers the unit itself OR any of its ANCESTORS — e.g. an
    // assignment on "Region" now also surfaces every "Site" under it.
    // Walked in-memory against the tenant's full unit list (already
    // fetched above) rather than one SQL round-trip per unit.
    const assignments = await this.rbacRepo.getAssignments(actor.userId);
    const scopeIds = new Set(
      assignments
        .filter((a) => a.scopeType === "organization_unit" && a.scopeOrganizationUnitId)
        .map((a) => a.scopeOrganizationUnitId as string),
    );
    const byId = new Map(all.map((u) => [u.id, u]));
    const isCovered = (unitId: string): boolean => {
      let current = byId.get(unitId);
      while (current) {
        if (scopeIds.has(current.id)) return true;
        current = current.parentId ? byId.get(current.parentId) : undefined;
      }
      return false;
    };
    return all.filter((u) => isCovered(u.id));
  }
}
