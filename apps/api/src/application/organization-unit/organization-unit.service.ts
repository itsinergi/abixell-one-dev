import type {
  CreateOrganizationUnitInput,
  OrganizationUnitRepository,
  UpdateOrganizationUnitInput,
} from "../../domain/organization-unit/organization-unit.entity.js";
import type { AuditService } from "../audit/audit.service.js";
import type { RbacService } from "../rbac/rbac.service.js";
import type { RbacRepository } from "../../domain/rbac/rbac.entity.js";
import type { ActorContext } from "../../domain/shared-kernel/audit-context.js";
import { ForbiddenError, NotFoundError } from "../../domain/shared-kernel/errors.js";

export class OrganizationUnitService {
  constructor(
    private readonly repo: OrganizationUnitRepository,
    private readonly audit: AuditService,
    private readonly rbac: RbacService,
    private readonly rbacRepo: RbacRepository,
  ) {}

  async create(actor: ActorContext, input: Omit<CreateOrganizationUnitInput, "tenantId">) {
    await this.rbac.requirePermission(actor.userId, "organization_unit.create");

    // Data Scope check: creating a root unit (no parent) requires
    // tenant-wide scope; creating a child requires scope covering the
    // parent unit (exact-match in 0B — see docs/decision-log.md gap).
    if (input.parentId) {
      const parent = await this.repo.findById(input.parentId);
      if (!parent) throw new NotFoundError("OrganizationUnit", input.parentId);
      if (parent.tenantId !== actor.tenantId) {
        throw new ForbiddenError("Parent Organization Unit belongs to a different Tenant");
      }
      await this.rbac.requireOrganizationUnitScope(actor.userId, input.parentId);
    } else {
      const hasTenantScope = await this.rbac.hasTenantScope(actor.userId);
      if (!hasTenantScope) {
        throw new ForbiddenError(
          "Creating a root Organization Unit requires tenant-wide Data Scope",
        );
      }
    }

    const unit = await this.repo.create({ ...input, tenantId: actor.tenantId }, actor.userId);

    await this.audit.record({
      tenantId: actor.tenantId,
      actorUserId: actor.userId,
      action: "organization_unit.created",
      entityType: "organization_unit",
      entityId: unit.id,
      metadata: { name: unit.name, parentId: unit.parentId },
    });

    return unit;
  }

  async update(
    actor: ActorContext,
    id: string,
    input: UpdateOrganizationUnitInput,
  ) {
    await this.rbac.requirePermission(actor.userId, "organization_unit.update");
    const unit = await this.repo.findById(id);
    if (!unit || unit.tenantId !== actor.tenantId) throw new NotFoundError("OrganizationUnit", id);
    await this.rbac.requireOrganizationUnitScope(actor.userId, id);
    return this.repo.update(id, input, actor);
  }

  async setActive(actor: ActorContext, id: string, isActive: boolean) {
    await this.rbac.requirePermission(
      actor.userId,
      isActive ? "organization_unit.activate" : "organization_unit.deactivate",
    );
    const unit = await this.repo.findById(id);
    if (!unit || unit.tenantId !== actor.tenantId) throw new NotFoundError("OrganizationUnit", id);
    await this.rbac.requireOrganizationUnitScope(actor.userId, id);
    return this.repo.setActive(id, isActive, actor);
  }

  async listForTenant(actor: ActorContext) {
    await this.rbac.requirePermission(actor.userId, "organization_unit.read");

    const all = await this.repo.listByTenant(actor.tenantId);
    const hasTenantScope = await this.rbac.hasTenantScope(actor.userId);
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
