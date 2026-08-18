import type { Pool } from "pg";
import type {
  AssignRoleInput,
  RbacRepository,
  Role,
  UserRoleAssignment,
} from "../../../domain/rbac/rbac.entity.js";

export class PgRbacRepository implements RbacRepository {
  constructor(private readonly pool: Pool) {}

  async getEffectivePermissionCodes(userId: string): Promise<Set<string>> {
    const result = await this.pool.query(
      `SELECT DISTINCT p.code
         FROM user_role_assignments ura
         JOIN role_permissions rp ON rp.role_id = ura.role_id
         JOIN permissions p ON p.id = rp.permission_id
        WHERE ura.user_id = $1`,
      [userId],
    );
    return new Set(result.rows.map((r) => r.code));
  }

  async getAssignments(userId: string): Promise<UserRoleAssignment[]> {
    const result = await this.pool.query(
      `SELECT ura.id, ura.user_id, ura.role_id, r.code AS role_code,
              ura.scope_type, ura.scope_organization_unit_id, ura.scope_customer_id
         FROM user_role_assignments ura
         JOIN roles r ON r.id = ura.role_id
        WHERE ura.user_id = $1`,
      [userId],
    );
    return result.rows.map((row) => ({
      id: row.id,
      userId: row.user_id,
      roleId: row.role_id,
      roleCode: row.role_code,
      scopeType: row.scope_type,
      scopeOrganizationUnitId: row.scope_organization_unit_id,
      scopeCustomerId: row.scope_customer_id,
    }));
  }

  async findRoleByCode(tenantId: string, code: string): Promise<Role | null> {
    const result = await this.pool.query(
      `SELECT * FROM roles WHERE tenant_id = $1 AND code = $2`,
      [tenantId, code],
    );
    if (!result.rows[0]) return null;
    return {
      id: result.rows[0].id,
      tenantId: result.rows[0].tenant_id,
      code: result.rows[0].code,
      name: result.rows[0].name,
    };
  }

  async assignRole(
    input: AssignRoleInput,
    createdBy: string | null,
  ): Promise<UserRoleAssignment> {
    const result = await this.pool.query(
      `INSERT INTO user_role_assignments
         (user_id, role_id, scope_type, scope_organization_unit_id, scope_customer_id, created_by)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [
        input.userId,
        input.roleId,
        input.scopeType,
        input.scopeOrganizationUnitId ?? null,
        input.scopeCustomerId ?? null,
        createdBy,
      ],
    );
    const roleResult = await this.pool.query(`SELECT code FROM roles WHERE id = $1`, [
      input.roleId,
    ]);
    const row = result.rows[0];
    return {
      id: row.id,
      userId: row.user_id,
      roleId: row.role_id,
      roleCode: roleResult.rows[0]?.code ?? "",
      scopeType: row.scope_type,
      scopeOrganizationUnitId: row.scope_organization_unit_id,
      scopeCustomerId: row.scope_customer_id,
    };
  }

  async listUserIdsWithRoleInScope(
    tenantId: string,
    roleCode: string,
    organizationUnitId: string | null,
  ): Promise<string[]> {
    // Checkpoint 0F / ADR-0009 (Hierarchical Data Scope): a role+scope
    // holder assigned to any ANCESTOR of `organizationUnitId` is also
    // eligible, not just an exact match — computed here with the same
    // upward `parent_id` walk `OrganizationUnitRepository.listAncestorIds`
    // uses, kept self-contained in this query (a single JOIN) rather than
    // a second round-trip, since this method is already tenant/role
    // scoped SQL.
    const result = await this.pool.query(
      `WITH RECURSIVE ancestors AS (
         SELECT id, parent_id FROM organization_units WHERE id = $3
         UNION ALL
         SELECT ou.id, ou.parent_id
           FROM organization_units ou
           JOIN ancestors a ON ou.id = a.parent_id
       )
       SELECT DISTINCT ura.user_id
         FROM user_role_assignments ura
         JOIN roles r ON r.id = ura.role_id
         JOIN users u ON u.id = ura.user_id
        WHERE r.tenant_id = $1
          AND r.code = $2
          AND u.tenant_id = $1
          AND (
            ura.scope_type = 'tenant'
            OR (
              $3::uuid IS NOT NULL
              AND ura.scope_type = 'organization_unit'
              AND ura.scope_organization_unit_id IN (SELECT id FROM ancestors)
            )
          )`,
      [tenantId, roleCode, organizationUnitId],
    );
    return result.rows.map((r) => r.user_id);
  }
}
