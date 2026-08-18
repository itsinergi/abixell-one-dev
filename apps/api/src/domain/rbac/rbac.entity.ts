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
  scopeType: "tenant" | "organization_unit";
  scopeOrganizationUnitId: string | null;
}

export interface AssignRoleInput {
  userId: string;
  roleId: string;
  scopeType: "tenant" | "organization_unit";
  scopeOrganizationUnitId?: string | null;
}

export interface RbacRepository {
  /** All permission codes granted to a user across every role assignment. */
  getEffectivePermissionCodes(userId: string): Promise<Set<string>>;
  getAssignments(userId: string): Promise<UserRoleAssignment[]>;
  findRoleByCode(tenantId: string, code: string): Promise<Role | null>;
  assignRole(input: AssignRoleInput, createdBy: string | null): Promise<UserRoleAssignment>;
}
