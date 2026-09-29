import type { ActorContext } from "../shared-kernel/audit-context.js";

/**
 * Department — a tenant-owned master (G0 contract `epic-5-g0-contract.md` M8).
 *
 * ══════════════════════════════════════════════════════════════════════════
 *  A DEPARTMENT IS NEVER AN AUTHORIZATION SCOPE.
 * ══════════════════════════════════════════════════════════════════════════
 *
 * §4.5 principle 4 and the roadmap risk row "Department dipakai sebagai
 * security scope" say the same thing from two directions: a Department
 * describes how the *organisation* arranges its people, and nothing about what
 * a caller may read or write. Every place that could be tempted to make it
 * one is called out below, and the guard is mechanical — there is no
 * `scope_department_id`, no `department` value in the `DataScope` union, no
 * `scope_type = 'department'` branch, and this module never calls
 * `RbacService` for anything except the plain permission check
 * (`department.read` / `.create` / `.update`), which is a CAPABILITY, not a
 * SCOPE.
 *
 * Concretely, the properties that keep it true:
 *
 *   - `department.repository.pg.ts` only ever consults the actor's Tenant. It
 *     never resolves an ancestor chain, never takes an organization-unit or
 *     customer scope into account, and never writes to a scope column.
 *   - `UserRoleAssignment.scope_type` CHECK is unchanged by Epic 5 G1, so a
 *     Department id cannot be stored there even by direct SQL.
 *   - The lifecycle is `is_active` only. There is no tombstone, because a
 *     tombstone exists to preserve a *scope* reference for history; a
 *     Department has none to preserve.
 *
 * @see apps/api/src/domain/rbac/rbac.entity.ts — DataScope keeps three variants
 */
export interface Department {
  id: string;
  tenantId: string;
  parentDepartmentId: string | null;
  name: string;
  /** The business identifier, unique per Tenant. NULL means "not assigned yet". */
  code: string | null;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateDepartmentInput {
  tenantId: string;
  parentDepartmentId?: string | null;
  name: string;
  code?: string | null;
}

export interface UpdateDepartmentInput {
  name?: string;
  code?: string | null;
  /** Re-parenting within the same Tenant. A cycle (or the node itself) is
   * refused by the repository; re-parenting is never a scope change. */
  parentDepartmentId?: string | null;
}

export interface DepartmentRepository {
  create(input: CreateDepartmentInput, actor: ActorContext): Promise<Department>;
  findById(id: string): Promise<Department | null>;
  listByTenant(tenantId: string): Promise<Department[]>;
  update(id: string, input: UpdateDepartmentInput, actor: ActorContext): Promise<Department>;
  setActive(id: string, isActive: boolean, actor: ActorContext): Promise<Department>;
}
