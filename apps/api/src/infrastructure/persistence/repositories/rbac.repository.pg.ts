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
              ura.scope_type, ura.scope_organization_unit_id
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
         (user_id, role_id, scope_type, scope_organization_unit_id, created_by)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [
        input.userId,
        input.roleId,
        input.scopeType,
        input.scopeOrganizationUnitId ?? null,
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
    };
  }
}
