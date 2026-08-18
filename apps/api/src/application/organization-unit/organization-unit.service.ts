import type {
  CreateOrganizationUnitInput,
  OrganizationUnitRepository,
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

  async listForTenant(actor: ActorContext) {
    await this.rbac.requirePermission(actor.userId, "organization_unit.read");

    const all = await this.repo.listByTenant(actor.tenantId);
    const hasTenantScope = await this.rbac.hasTenantScope(actor.userId);
    if (hasTenantScope) return all;

    // Exact-match scope filter for non-tenant-wide assignments (0B scope
    // model — see docs/decision-log.md).
    const assignments = await this.rbacRepo.getAssignments(actor.userId);
    const allowedIds = new Set(
      assignments
        .filter((a) => a.scopeType === "organization_unit")
        .map((a) => a.scopeOrganizationUnitId),
    );
    return all.filter((u) => allowedIds.has(u.id));
  }
}
