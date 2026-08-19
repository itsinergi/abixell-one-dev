export interface Role {
  id: string;
  tenantId: string;
  code: string;
  name: string;
}

export interface Permission {
  code: string;
  description: string;
}

/** One row of a user's effective assignment: a Role plus the Data Scope it grants. */
export interface UserRoleAssignment {
  id: string;
  userId: string;
  roleId: string;
  roleCode: string;
  scopeType: "tenant" | "organization_unit" | "customer";
  scopeOrganizationUnitId: string | null;
  /** Checkpoint 1A / ADR-0011 — set when scopeType === "customer". */
  scopeCustomerId: string | null;
}

export interface AssignRoleInput {
  userId: string;
  roleId: string;
  scopeType: "tenant" | "organization_unit" | "customer";
  scopeOrganizationUnitId?: string | null;
  scopeCustomerId?: string | null;
}

export interface RbacRepository {
  /** All permission codes granted to a user across every role assignment. */
  getEffectivePermissionCodes(userId: string): Promise<Set<string>>;
  getAssignments(userId: string): Promise<UserRoleAssignment[]>;
  findRoleByCode(tenantId: string, code: string): Promise<Role | null>;
  assignRole(input: AssignRoleInput, createdBy: string | null): Promise<UserRoleAssignment>;

  /**
   * Every user who currently holds `roleCode` with a Data Scope covering
   * `organizationUnitId` (same exact-match + tenant-wide-covers-narrower
   * semantics as `RbacService.hasRoleCoveringScope`). `organizationUnitId
   * = null` means the target is tenant-wide, so only tenant-wide holders
   * of the role match. Added in Checkpoint 0E so the Notification Engine
   * can resolve "who is in this role+scope queue" without duplicating
   * ADR-0007's scope logic — used to fan out a Workflow role-Assignment
   * notification to every eligible reviewer, not just whoever acts first.
   */
  listUserIdsWithRoleInScope(
    tenantId: string,
    roleCode: string,
    organizationUnitId: string | null,
  ): Promise<string[]>;

  /**
   * Every INTERNAL user in the Tenant whose roles grant `permissionCode`.
   * Added in Checkpoint 1E.2 so management attention can be addressed by
   * CAPABILITY rather than by coupling to a role NAME (FD-1E §20).
   * Customer-scoped assignments are excluded: a Customer User must never
   * receive an internal management signal, even if their role happened to
   * carry the permission (FD-1E §42).
   */
  listUserIdsWithPermissionInTenant(tenantId: string, permissionCode: string): Promise<string[]>;
}
