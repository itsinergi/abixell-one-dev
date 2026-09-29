import type {
  CreateDepartmentInput,
  DepartmentRepository,
  UpdateDepartmentInput,
} from "../../domain/department/department.entity.js";
import { NotFoundError } from "../../domain/shared-kernel/errors.js";
import type { RbacService } from "../rbac/rbac.service.js";
import type { ActorContext } from "../../domain/shared-kernel/audit-context.js";

/**
 * Department application service — a tenant-owned master.
 *
 * ══════════════════════════════════════════════════════════════════════════
 *  A DEPARTMENT IS NEVER AN AUTHORIZATION SCOPE.
 * ══════════════════════════════════════════════════════════════════════════
 *
 * §4.5 principle 4, and the roadmap risk row "Department dipakai sebagai
 * security scope". Read the three facts this service guarantees:
 *
 *   1. `RbacService` is consulted for CAPABILITIES only — `department.read`,
 *      `department.create`, `department.update`. No `DataScope` method is
 *      called with a Department id (`hasTenantScope` is the only scope-shaped
 *      call, and it asks about the ACTOR, never about a Department).
 *   2. No Department id is ever passed to `authorize`, `requireScope*`, a
 *      `scope_type` column, or `data scope` resolution. There is no
 *      `scopeDepartmentId` in this module, and adding one is the change this
 *      comment exists to make visible in review.
 *   3. When a Department is used to organise people, the ACCESS decision still
 *      comes from the user's Role assignment and its Organization Unit /
 *      Customer scope. A Department confers nothing.
 *
 * Writes are governed: `PgDepartmentRepository` runs each one inside
 * `inGovernedTransaction` with `requireTransactionActorPermission` and
 * `recordGovernedAudit`, so the audit row commits with the change.
 */
export class DepartmentService {
  constructor(
    private readonly repo: DepartmentRepository,
    private readonly rbac: RbacService,
  ) {}

  async create(actor: ActorContext, input: Omit<CreateDepartmentInput, "tenantId">) {
    await this.rbac.requirePermission(actor, "department.create");
    return this.repo.create({ ...input, tenantId: actor.tenantId }, actor);
  }

  async listForTenant(actor: ActorContext) {
    await this.rbac.requirePermission(actor, "department.read");
    // Tenant-scoped by construction: the query filters on `tenant_id` and on
    // nothing else. A Department hierarchy is a directory, not a filter.
    return this.repo.listByTenant(actor.tenantId);
  }

  async update(actor: ActorContext, id: string, input: UpdateDepartmentInput) {
    await this.rbac.requirePermission(actor, "department.update");
    const department = await this.repo.findById(id);
    if (!department || department.tenantId !== actor.tenantId) {
      throw new NotFoundError("Department", id);
    }
    return this.repo.update(id, input, actor);
  }

  /**
   * Department lifecycle: active / inactive only (G0 §5 — "no tombstone, not a
   * Data Scope"). Deactivating a Department changes nothing about who can read
   * or write anything, so unlike an Organization Unit there is no child or
   * scope consequence to guard.
   */
  async setActive(actor: ActorContext, id: string, isActive: boolean) {
    await this.rbac.requirePermission(actor, "department.update");
    const department = await this.repo.findById(id);
    if (!department || department.tenantId !== actor.tenantId) {
      throw new NotFoundError("Department", id);
    }
    return this.repo.setActive(id, isActive, actor);
  }
}
