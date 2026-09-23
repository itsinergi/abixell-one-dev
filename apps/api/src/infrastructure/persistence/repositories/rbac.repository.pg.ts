import type { Pool, PoolClient } from "pg";
import type {
  AdminRoleAssignmentSummary,
  AdminUserAccessSummary,
  AssignRoleInput,
  GovernedRoleAssignmentInput,
  MyRoleAssignment,
  Permission,
  RbacRepository,
  Role,
  RolePermissionDetail,
  RoleSummary,
  UserRoleAssignment,
} from "../../../domain/rbac/rbac.entity.js";
import { ConflictError, ForbiddenError, NotFoundError } from "../../../domain/shared-kernel/errors.js";

const USER_ROLE_MANAGE = "user.role.manage";
const UNIQUE_VIOLATION = "23505";

function mapAdminAssignment(row: Record<string, unknown>): AdminRoleAssignmentSummary {
  return {
    id: row.id as string,
    roleState: row.role_state as AdminRoleAssignmentSummary["roleState"],
    roleCode: (row.role_code as string | null) ?? null,
    roleName: (row.role_name as string | null) ?? null,
    scopeType: row.scope_type as AdminRoleAssignmentSummary["scopeType"],
    scopeState: row.scope_state as AdminRoleAssignmentSummary["scopeState"],
    scopeOrganizationUnitId: (row.scope_organization_unit_id as string | null) ?? null,
    scopeOrganizationUnitName: (row.scope_organization_unit_name as string | null) ?? null,
    scopeCustomerId: (row.scope_customer_id as string | null) ?? null,
    scopeCustomerName: (row.scope_customer_name as string | null) ?? null,
  };
}

export class PgRbacRepository implements RbacRepository {
  constructor(private readonly pool: Pool) {}

  async listRoleSummaries(tenantId: string): Promise<RoleSummary[]> {
    // Phase 11C — Business Admin Console. Counted with correlated subqueries
    // rather than JOIN + GROUP BY so the two counts stay independent: a JOIN
    // across both role_permissions and user_role_assignments would multiply
    // the rows and inflate each count by the other's cardinality. The assigned
    // user count is retained administrative inventory, not effective access;
    // authorization decisions use the effective-assignment view instead.
    const result = await this.pool.query(
      `SELECT r.id,
              r.code,
              r.name,
              COALESCE(r.is_full_access, false) AS is_full_access,
              (SELECT COUNT(*) FROM role_permissions rp WHERE rp.role_id = r.id)::int
                AS permission_count,
              (SELECT COUNT(DISTINCT ura.user_id)
                 FROM user_role_assignments ura
                 JOIN users u ON u.id = ura.user_id
                WHERE ura.role_id = r.id
                  AND u.tenant_id = r.tenant_id
                  AND u.deleted_at IS NULL)::int
                AS assigned_user_count
         FROM roles r
        WHERE r.tenant_id = $1
        ORDER BY r.code`,
      [tenantId],
    );
    return result.rows.map((row) => ({
      id: row.id,
      code: row.code,
      name: row.name,
      isFullAccess: row.is_full_access,
      permissionCount: row.permission_count,
      assignedUserCount: row.assigned_user_count,
    }));
  }

  async listPermissionCatalog(): Promise<Permission[]> {
    const result = await this.pool.query(
      `SELECT code, description FROM permissions ORDER BY code`,
    );
    return result.rows.map((row) => ({ code: row.code, description: row.description }));
  }

  async hasPermissionSetOnSameAssignment(
    userId: string,
    permissionCodes: readonly string[],
  ): Promise<boolean> {
    const requiredCodes = [...new Set(permissionCodes)];
    if (requiredCodes.length === 0) return true;

    const result = await this.pool.query(
      `SELECT EXISTS (
         SELECT 1
           FROM authorization_effective_user_role_assignments aura
           JOIN role_permissions rp ON rp.role_id = aura.role_id
           JOIN permissions p ON p.id = rp.permission_id
          WHERE aura.user_id = $1
            AND p.code = ANY($2::text[])
          GROUP BY aura.id
         HAVING COUNT(DISTINCT p.code) = $3
       ) AS allowed`,
      [userId, requiredCodes, requiredCodes.length],
    );
    return result.rows[0]?.allowed === true;
  }

  async hasTenantScopedPermission(
    tenantId: string,
    userId: string,
    permissionCode: string,
  ): Promise<boolean> {
    const result = await this.pool.query(
      `SELECT EXISTS (
         SELECT 1
           FROM authorization_effective_user_role_assignments aura
           JOIN role_permissions rp ON rp.role_id = aura.role_id
           JOIN permissions p ON p.id = rp.permission_id
          WHERE aura.user_id = $2
            AND aura.tenant_id = $1
            AND aura.scope_type = 'tenant'
            AND aura.scope_organization_unit_id IS NULL
            AND aura.scope_customer_id IS NULL
            AND p.code = $3
       ) AS allowed`,
      [tenantId, userId, permissionCode],
    );
    return result.rows[0]?.allowed === true;
  }

  async getAssignmentsWithPermission(
    userId: string,
    permissionCode: string,
  ): Promise<UserRoleAssignment[]> {
    const result = await this.pool.query(
      `SELECT DISTINCT aura.id, aura.user_id, aura.role_id, r.code AS role_code,
              aura.scope_type, aura.scope_organization_unit_id, aura.scope_customer_id
         FROM authorization_effective_user_role_assignments aura
         JOIN roles r ON r.id = aura.role_id
         JOIN role_permissions rp ON rp.role_id = aura.role_id
         JOIN permissions p ON p.id = rp.permission_id
        WHERE aura.user_id = $1 AND p.code = $2`,
      [userId, permissionCode],
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

  async listAdminUserAccess(tenantId: string): Promise<AdminUserAccessSummary[]> {
    const result = await this.pool.query(
      `SELECT u.id AS user_id,
              u.full_name,
              u.email,
              u.status,
              access.id AS assignment_id,
              access.role_state,
              access.role_code,
              access.role_name,
              access.scope_type,
              access.scope_state,
              access.scope_organization_unit_id,
              access.scope_organization_unit_name,
              access.scope_customer_id,
              access.scope_customer_name
         FROM users u
         LEFT JOIN LATERAL (
           SELECT ura.id,
                  ura.created_at,
                  CASE WHEN r.id IS NOT NULL THEN 'available' ELSE 'unavailable' END
                    AS role_state,
                  r.code AS role_code,
                  r.name AS role_name,
                  ura.scope_type,
                  CASE
                    WHEN ura.scope_invalidated_at IS NULL
                     AND r.id IS NOT NULL
                     AND (
                       (
                         ura.scope_type = 'tenant'
                         AND ura.scope_organization_unit_id IS NULL
                         AND ura.scope_customer_id IS NULL
                       )
                       OR (ura.scope_type = 'organization_unit' AND ou.id IS NOT NULL)
                       OR (ura.scope_type = 'customer' AND c.id IS NOT NULL)
                     )
                    THEN 'available'
                    ELSE 'unavailable'
                  END AS scope_state,
                  ura.scope_organization_unit_id,
                  CASE
                    WHEN ura.scope_invalidated_at IS NULL AND r.id IS NOT NULL
                      THEN ou.name
                    ELSE NULL
                  END AS scope_organization_unit_name,
                  ura.scope_customer_id,
                  CASE
                    WHEN ura.scope_invalidated_at IS NULL AND r.id IS NOT NULL
                      THEN c.name
                    ELSE NULL
                  END AS scope_customer_name
             FROM user_role_assignments ura
             LEFT JOIN roles r
               ON r.id = ura.role_id
              AND r.tenant_id = u.tenant_id
             LEFT JOIN organization_units ou
               ON ou.id = ura.scope_organization_unit_id
              AND ou.tenant_id = u.tenant_id
              AND ou.deleted_at IS NULL
             LEFT JOIN customers c
               ON c.id = ura.scope_customer_id
              AND c.tenant_id = u.tenant_id
              AND c.deleted_at IS NULL
            WHERE ura.user_id = u.id
         ) access ON true
        WHERE u.tenant_id = $1
          AND u.deleted_at IS NULL
          AND u.status = 'active'
        ORDER BY u.full_name,
                 u.id,
                 access.role_code,
                 access.created_at,
                 access.id`,
      [tenantId],
    );

    const users = new Map<string, AdminUserAccessSummary>();
    for (const row of result.rows) {
      let user = users.get(row.user_id);
      if (!user) {
        user = {
          id: row.user_id,
          fullName: row.full_name,
          email: row.email,
          status: row.status,
          roleAssignments: [],
        };
        users.set(row.user_id, user);
      }
      if (row.assignment_id) {
        user.roleAssignments.push(
          mapAdminAssignment({
            id: row.assignment_id,
            role_state: row.role_state,
            role_code: row.role_code,
            role_name: row.role_name,
            scope_type: row.scope_type,
            scope_state: row.scope_state,
            scope_organization_unit_id: row.scope_organization_unit_id,
            scope_organization_unit_name: row.scope_organization_unit_name,
            scope_customer_id: row.scope_customer_id,
            scope_customer_name: row.scope_customer_name,
          }),
        );
      }
    }
    return [...users.values()];
  }

  async getRolePermissionDetail(
    tenantId: string,
    roleCode: string,
  ): Promise<RolePermissionDetail | null> {
    const result = await this.pool.query(
      `SELECT r.code AS role_code,
              r.name AS role_name,
              COALESCE(r.is_full_access, false) AS is_full_access,
              p.code AS permission_code,
              p.description AS permission_description
         FROM roles r
         LEFT JOIN role_permissions rp ON rp.role_id = r.id
         LEFT JOIN permissions p ON p.id = rp.permission_id
        WHERE r.tenant_id = $1
          AND r.code = $2
        ORDER BY p.code`,
      [tenantId, roleCode],
    );
    if (!result.rows[0]) return null;
    return {
      roleCode: result.rows[0].role_code,
      roleName: result.rows[0].role_name,
      isFullAccess: result.rows[0].is_full_access,
      permissions: result.rows
        .filter((row) => row.permission_code !== null)
        .map((row) => ({ code: row.permission_code, description: row.permission_description })),
    };
  }

  async createGovernedRoleAssignment(
    actor: { tenantId: string; userId: string },
    targetUserId: string,
    input: GovernedRoleAssignmentInput,
  ): Promise<AdminRoleAssignmentSummary> {
    return this.inGovernedTransaction(actor.tenantId, async (client) => {
      await this.requireTransactionActorAuthority(client, actor);

      const target = await client.query(
        `SELECT id
           FROM users
          WHERE id = $1
            AND tenant_id = $2
            AND deleted_at IS NULL
            AND status = 'active'`,
        [targetUserId, actor.tenantId],
      );
      if (!target.rows[0]) throw new NotFoundError("User", targetUserId);

      const roleResult = await client.query(
        `SELECT id, code, name
           FROM roles
          WHERE tenant_id = $1
            AND code = $2`,
        [actor.tenantId, input.roleCode],
      );
      const role = roleResult.rows[0];
      if (!role) throw new NotFoundError("Role", input.roleCode);

      let organizationUnitName: string | null = null;
      let customerName: string | null = null;
      const organizationUnitId =
        input.scopeType === "organization_unit" ? input.scopeOrganizationUnitId : null;
      const customerId = input.scopeType === "customer" ? input.scopeCustomerId : null;

      if (organizationUnitId) {
        const organizationUnit = await client.query(
          `SELECT name
             FROM organization_units
            WHERE id = $1
              AND tenant_id = $2
              AND deleted_at IS NULL`,
          [organizationUnitId, actor.tenantId],
        );
        if (!organizationUnit.rows[0]) {
          throw new NotFoundError("Organization Unit", organizationUnitId);
        }
        organizationUnitName = organizationUnit.rows[0].name;
      }

      if (customerId) {
        const customer = await client.query(
          `SELECT name
             FROM customers
            WHERE id = $1
              AND tenant_id = $2
              AND deleted_at IS NULL`,
          [customerId, actor.tenantId],
        );
        if (!customer.rows[0]) throw new NotFoundError("Customer", customerId);
        customerName = customer.rows[0].name;
      }

      let inserted;
      try {
        inserted = await client.query(
          `INSERT INTO user_role_assignments
             (user_id, role_id, scope_type, scope_organization_unit_id,
              scope_customer_id, created_by)
           VALUES ($1, $2, $3, $4, $5, $6)
           RETURNING id, scope_type, scope_organization_unit_id, scope_customer_id`,
          [
            targetUserId,
            role.id,
            input.scopeType,
            organizationUnitId,
            customerId,
            actor.userId,
          ],
        );
      } catch (error) {
        const databaseError = error as { code?: string; constraint?: string };
        if (
          databaseError.code === UNIQUE_VIOLATION &&
          databaseError.constraint === "user_role_assignments_exact_assignment_unique"
        ) {
          throw new ConflictError("This exact Role assignment already exists");
        }
        throw error;
      }

      const row = inserted.rows[0];
      const assignment = mapAdminAssignment({
        id: row.id,
        role_state: "available",
        role_code: role.code,
        role_name: role.name,
        scope_type: row.scope_type,
        scope_state: "available",
        scope_organization_unit_id: row.scope_organization_unit_id,
        scope_organization_unit_name: organizationUnitName,
        scope_customer_id: row.scope_customer_id,
        scope_customer_name: customerName,
      });

      await this.recordGovernedAudit(client, {
        tenantId: actor.tenantId,
        actorUserId: actor.userId,
        targetUserId,
        assignment,
        action: "user.role_assigned",
      });
      return assignment;
    });
  }

  async removeGovernedRoleAssignment(
    actor: { tenantId: string; userId: string },
    targetUserId: string,
    assignmentId: string,
  ): Promise<void> {
    await this.inGovernedTransaction(actor.tenantId, async (client) => {
      await this.requireTransactionActorAuthority(client, actor);

      const target = await client.query(
        `SELECT id
           FROM users
          WHERE id = $1
            AND tenant_id = $2
            AND deleted_at IS NULL
            AND status = 'active'`,
        [targetUserId, actor.tenantId],
      );
      if (!target.rows[0]) throw new NotFoundError("User", targetUserId);

      const assignmentResult = await client.query(
        `SELECT ura.id,
                CASE WHEN r.id IS NOT NULL THEN 'available' ELSE 'unavailable' END
                  AS role_state,
                ura.scope_type,
                CASE
                  WHEN ura.scope_invalidated_at IS NULL
                   AND r.id IS NOT NULL
                   AND (
                     (
                       ura.scope_type = 'tenant'
                       AND ura.scope_organization_unit_id IS NULL
                       AND ura.scope_customer_id IS NULL
                     )
                     OR (ura.scope_type = 'organization_unit' AND ou.id IS NOT NULL)
                     OR (ura.scope_type = 'customer' AND c.id IS NOT NULL)
                   )
                  THEN 'available'
                  ELSE 'unavailable'
                END AS scope_state,
                ura.scope_organization_unit_id,
                CASE
                  WHEN ura.scope_invalidated_at IS NULL AND r.id IS NOT NULL
                    THEN ou.name
                  ELSE NULL
                END AS scope_organization_unit_name,
                ura.scope_customer_id,
                CASE
                  WHEN ura.scope_invalidated_at IS NULL AND r.id IS NOT NULL
                    THEN c.name
                  ELSE NULL
                END AS scope_customer_name,
                r.code AS role_code,
                r.name AS role_name,
                EXISTS (
                  SELECT 1
                    FROM role_permissions manager_rp
                    JOIN permissions manager_p ON manager_p.id = manager_rp.permission_id
                   WHERE manager_rp.role_id = r.id
                     AND manager_p.code = $4
                ) AS grants_user_role_manage
           FROM user_role_assignments ura
           JOIN users u
             ON u.id = ura.user_id
            AND u.tenant_id = $2
            AND u.deleted_at IS NULL
            AND u.status = 'active'
           LEFT JOIN roles r
             ON r.id = ura.role_id
            AND r.tenant_id = u.tenant_id
           LEFT JOIN organization_units ou
             ON ou.id = ura.scope_organization_unit_id
            AND ou.tenant_id = u.tenant_id
            AND ou.deleted_at IS NULL
           LEFT JOIN customers c
             ON c.id = ura.scope_customer_id
            AND c.tenant_id = u.tenant_id
            AND c.deleted_at IS NULL
          WHERE ura.id = $1
            AND ura.user_id = $3`,
        [assignmentId, actor.tenantId, targetUserId, USER_ROLE_MANAGE],
      );
      const row = assignmentResult.rows[0];
      if (!row) throw new NotFoundError("Role assignment", assignmentId);

      const removesTenantManager =
        row.scope_state === "available" &&
        row.grants_user_role_manage === true &&
        row.scope_type === "tenant" &&
        row.scope_organization_unit_id === null &&
        row.scope_customer_id === null;
      if (removesTenantManager && targetUserId === actor.userId) {
        throw new ConflictError("You cannot remove your own tenant manager assignment");
      }

      if (removesTenantManager) {
        const remainingManagers = await client.query(
          `SELECT COUNT(DISTINCT manager_aura.user_id)::int AS count
             FROM authorization_effective_user_role_assignments manager_aura
             JOIN role_permissions manager_rp ON manager_rp.role_id = manager_aura.role_id
             JOIN permissions manager_p ON manager_p.id = manager_rp.permission_id
            WHERE manager_aura.tenant_id = $1
              AND manager_aura.scope_type = 'tenant'
              AND manager_aura.scope_organization_unit_id IS NULL
              AND manager_aura.scope_customer_id IS NULL
              AND manager_p.code = $2
              AND manager_aura.user_id <> $3`,
          [actor.tenantId, USER_ROLE_MANAGE, targetUserId],
        );
        if (remainingManagers.rows[0].count === 0) {
          throw new ConflictError("Cannot remove the final active tenant manager assignment");
        }
      }

      const assignment = mapAdminAssignment(row);
      await client.query(
        `DELETE FROM user_role_assignments
          WHERE id = $1
            AND user_id = $2`,
        [assignmentId, targetUserId],
      );
      await this.recordGovernedAudit(client, {
        tenantId: actor.tenantId,
        actorUserId: actor.userId,
        targetUserId,
        assignment,
        action: "user.role_removed",
      });
    });
  }

  private async inGovernedTransaction<T>(
    tenantId: string,
    operation: (client: PoolClient) => Promise<T>,
  ): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const lockedTenant = await client.query(
        `SELECT id
           FROM tenants
          WHERE id = $1
            AND deleted_at IS NULL
          FOR UPDATE`,
        [tenantId],
      );
      if (!lockedTenant.rows[0]) throw new NotFoundError("Tenant", tenantId);
      const result = await operation(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  private async requireTransactionActorAuthority(
    client: PoolClient,
    actor: { tenantId: string; userId: string },
  ): Promise<void> {
    const result = await client.query(
      `SELECT EXISTS (
         SELECT 1
           FROM users u
          WHERE u.id = $2
            AND u.tenant_id = $1
            AND u.deleted_at IS NULL
            AND u.status = 'active'
            AND EXISTS (
              SELECT 1
                FROM authorization_effective_user_role_assignments entry_aura
                JOIN role_permissions entry_rp ON entry_rp.role_id = entry_aura.role_id
                JOIN permissions entry_p ON entry_p.id = entry_rp.permission_id
               WHERE entry_aura.user_id = u.id
                 AND entry_aura.tenant_id = u.tenant_id
                 AND entry_p.code = $3
            )
            AND EXISTS (
              SELECT 1
                FROM authorization_effective_user_role_assignments manager_aura
                JOIN role_permissions manager_rp ON manager_rp.role_id = manager_aura.role_id
                JOIN permissions manager_p ON manager_p.id = manager_rp.permission_id
               WHERE manager_aura.user_id = u.id
                 AND manager_aura.tenant_id = u.tenant_id
                 AND manager_aura.scope_type = 'tenant'
                 AND manager_aura.scope_organization_unit_id IS NULL
                 AND manager_aura.scope_customer_id IS NULL
                 AND manager_p.code = $4
            )
       ) AS allowed`,
      [actor.tenantId, actor.userId, "admin.console.read", USER_ROLE_MANAGE],
    );
    if (result.rows[0]?.allowed !== true) {
      throw new ForbiddenError("Admin Console access or tenant-scoped User access management authority is missing");
    }
  }

  private async recordGovernedAudit(
    client: PoolClient,
    input: {
      tenantId: string;
      actorUserId: string;
      targetUserId: string;
      assignment: AdminRoleAssignmentSummary;
      action: "user.role_assigned" | "user.role_removed";
    },
  ): Promise<void> {
    const metadata = {
      targetUserId: input.targetUserId,
      roleCode: input.assignment.roleCode,
      scopeType: input.assignment.scopeType,
      scopeOrganizationUnitId: input.assignment.scopeOrganizationUnitId,
      scopeCustomerId: input.assignment.scopeCustomerId,
    };
    await client.query(
      `INSERT INTO audit_log
         (tenant_id, actor_user_id, action, entity_type, entity_id, metadata)
       VALUES ($1, $2, $3, 'user', $4, $5::jsonb)`,
      [
        input.tenantId,
        input.actorUserId,
        input.action,
        input.targetUserId,
        JSON.stringify(metadata),
      ],
    );
  }

  async listUserIdsWithPermissionInTenant(tenantId: string, permissionCode: string): Promise<string[]> {
    // Capability-based recipient resolution (Checkpoint 1E.2). Internal
    // scopes only — `customer`-scoped assignments are deliberately excluded
    // so a Customer User can never be an internal management recipient.
    const result = await this.pool.query(
      `SELECT DISTINCT aura.user_id
         FROM authorization_effective_user_role_assignments aura
         JOIN role_permissions rp ON rp.role_id = aura.role_id
         JOIN permissions p ON p.id = rp.permission_id
        WHERE aura.tenant_id = $1
          AND p.code = $2
          AND aura.scope_type IN ('tenant', 'organization_unit')`,
      [tenantId, permissionCode],
    );
    return result.rows.map((r) => r.user_id);
  }

  async getEffectivePermissionCodes(userId: string): Promise<Set<string>> {
    const result = await this.pool.query(
      `SELECT DISTINCT p.code
         FROM authorization_effective_user_role_assignments aura
         JOIN role_permissions rp ON rp.role_id = aura.role_id
         JOIN permissions p ON p.id = rp.permission_id
        WHERE aura.user_id = $1`,
      [userId],
    );
    return new Set(result.rows.map((r) => r.code));
  }

  async getAssignments(userId: string): Promise<UserRoleAssignment[]> {
    const result = await this.pool.query(
      `SELECT aura.id, aura.user_id, aura.role_id, r.code AS role_code,
              aura.scope_type, aura.scope_organization_unit_id, aura.scope_customer_id
         FROM authorization_effective_user_role_assignments aura
         JOIN roles r ON r.id = aura.role_id
        WHERE aura.user_id = $1`,
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

  /** Phase 11F (self-service): the caller's OWN authorization-effective
   * assignments with role and scope display names resolved, so a post-login
   * "select role & site" screen can present them without holding any admin
   * permission. Unlike `listAdminUserAccess` this uses the effective view,
   * so invalidated/unavailable rows are already excluded — a user is never
   * offered a context they cannot actually act in. */
  async getMyAssignmentsWithScopeNames(
    userId: string,
  ): Promise<MyRoleAssignment[]> {
    const result = await this.pool.query(
      `SELECT aura.id,
              aura.role_id,
              r.code AS role_code,
              r.name AS role_name,
              aura.scope_type,
              aura.scope_organization_unit_id,
              ou.name AS scope_organization_unit_name,
              aura.scope_customer_id,
              c.name AS scope_customer_name
         FROM authorization_effective_user_role_assignments aura
         JOIN roles r ON r.id = aura.role_id
         LEFT JOIN organization_units ou
           ON ou.id = aura.scope_organization_unit_id
          AND ou.deleted_at IS NULL
         LEFT JOIN customers c
           ON c.id = aura.scope_customer_id
          AND c.deleted_at IS NULL
        WHERE aura.user_id = $1
        ORDER BY r.name, aura.id`,
      [userId],
    );
    return result.rows.map((row) => ({
      id: row.id,
      roleId: row.role_id,
      roleCode: row.role_code,
      roleName: row.role_name,
      scopeType: row.scope_type,
      scopeOrganizationUnitId: row.scope_organization_unit_id,
      scopeOrganizationUnitName: row.scope_organization_unit_name,
      scopeCustomerId: row.scope_customer_id,
      scopeCustomerName: row.scope_customer_name,
    }));
  }

  async findRoleByCode(tenantId: string, code: string): Promise<Role | null> {    const result = await this.pool.query(
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
         SELECT id, parent_id
           FROM organization_units
          WHERE id = $3
            AND tenant_id = $1
            AND deleted_at IS NULL
         UNION ALL
         SELECT ou.id, ou.parent_id
           FROM organization_units ou
           JOIN ancestors a ON ou.id = a.parent_id
          WHERE ou.tenant_id = $1
            AND ou.deleted_at IS NULL
       )
       SELECT DISTINCT aura.user_id
         FROM authorization_effective_user_role_assignments aura
         JOIN roles r ON r.id = aura.role_id
        WHERE aura.tenant_id = $1
          AND r.code = $2
          AND (
            aura.scope_type = 'tenant'
            OR (
              $3::uuid IS NOT NULL
              AND aura.scope_type = 'organization_unit'
              AND aura.scope_organization_unit_id IN (SELECT id FROM ancestors)
            )
          )`,
      [tenantId, roleCode, organizationUnitId],
    );
    return result.rows.map((r) => r.user_id);
  }
}
