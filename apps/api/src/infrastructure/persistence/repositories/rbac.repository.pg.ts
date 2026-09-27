import { createHash } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import type {
  AdminRoleAssignmentSummary,
  AdminUserAccessSummary,
  AdminAssignmentRow,
  AssignmentOptions,
  AssignmentRoleOption,
  AssignmentScopeUnitOption,
  AssignmentBatchResult,
  CreateGovernedUserInput,
  GovernedUserSummary,
  AssignRoleInput,
  CopyRoleDefinitionInput,
  CreateRoleDefinitionInput,
  GovernedRoleAssignmentInput,
  MyRoleAssignment,
  Permission,
  PermissionOption,
  PreviewRoleAssignmentsInput,
  RbacRepository,
  Role,
  RoleDefinition,
  RoleDefinitionOptions,
  RoleDefinitionPreview,
  RoleDefinitionPreviewInput,
  RolePermissionDetail,
  RoleSummary,
  UpdateRoleAssignmentsInput,
  UpdateRoleDefinitionInput,
  UserRoleAssignment,
  WindowAccessInput,
  WindowOption,
} from "../../../domain/rbac/rbac.entity.js";
import type {
  AdministrativeVisibility,
  AssignmentBatchPreview,
  AssignmentPairSummary,
} from "../../../domain/rbac/visibility-scope.js";
import { computeAssignmentBatchHash } from "../../../domain/rbac/visibility-scope.js";
import { attributePermission } from "../../../domain/configuration/module-attribution.js";
import { hashPassword } from "../../security/password.js";
import { resolveRouteEntry } from "../../../domain/configuration/route-registry.js";
import { windowEnforcementStatus } from "../../../domain/configuration/window-enforcement.js";
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from "../../../domain/shared-kernel/errors.js";

const USER_ROLE_MANAGE = "user.role.manage";
const ROLE_MANAGE = "role.manage";
const CONFIG_READ = "config.read";
const ADMIN_CONSOLE_READ = "admin.console.read";
const UNIQUE_VIOLATION = "23505";

/** Permissions whose combined presence defines Role Definition authority.
 * Removing any of them from a Role is the class of edit that can strand a
 * tenant or strip the actor's own management power, so §4.4 F protects the
 * post-change authority shape here. */
const ROLE_DEFINITION_AUTHORITY_PERMISSIONS = [
  ADMIN_CONSOLE_READ,
  CONFIG_READ,
  ROLE_MANAGE,
] as const;

/** Registration statuses under which a window is a real, addressable surface.
 * `belum_terdaftar` is reported by the guard but is not lockable (§4.2/§4.3). */
const REGISTERED_WINDOW_STATUSES = ["di_menu", "tersembunyi"] as const;

/** The wildcard registry entry is stored as a route window row but is a
 * deliberate non-match at runtime and must never become a grantable window. */
const WILDCARD_WINDOW_CODE = "route:*";

const WINDOW_CODE_PREFIX = "route:";

/** Deterministic content address for a proposed Role definition. The commit
 * path recomputes it from the definition the server is about to write, so a
 * preview approved against one set of grants can never be applied to another.
 *
 * Deliberately covers the DEFINITION only. Assignments may legitimately move
 * between preview and commit (§4.4 B); the commit revalidates authority and
 * protection rules anyway and records the ACTUAL affected-user count to the
 * audit trail, so assignment drift is reported there, never turned into a
 * 409. */
function computeDefinitionHash(
  name: string,
  permissionCodes: string[],
  windows: WindowAccessInput[],
): string {
  const canonical = {
    name,
    permissionCodes: [...new Set(permissionCodes)].sort(),
    windows: [...windows]
      .map((w) => ({
        windowCode: w.windowCode,
        isReadWrite: w.isReadWrite,
        isActive: w.isActive,
      }))
      .sort((a, b) =>
        a.windowCode < b.windowCode ? -1 : a.windowCode > b.windowCode ? 1 : 0,
      ),
  };
  return createHash("sha256").update(JSON.stringify(canonical)).digest("hex");
}

/** Sorted-array equality. Both sides are produced sorted (validateProposed*
 * sorts its output; loadRoleDefinition orders its SQL), so elementwise
 * comparison is enough for the no-op detection in updateRoleDefinition. */
function sameStringArrays(
  a: readonly string[],
  b: readonly string[],
): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

/** Same rule for window rows; both sides are sorted by windowCode. */
function sameWindows(
  a: readonly WindowAccessInput[],
  b: readonly WindowAccessInput[],
): boolean {
  return (
    a.length === b.length &&
    a.every(
      (w, index) =>
        w.windowCode === b[index].windowCode &&
        w.isReadWrite === b[index].isReadWrite &&
        w.isActive === b[index].isActive,
    )
  );
}

/** Derive whether a window is a detail/tool page from the canonical route
 * registry's `parentPath`, never from its status and never from a `.manage`
 * string in the permission list. */
function isDetailWindow(windowCode: string): boolean {
  if (!windowCode.startsWith(WINDOW_CODE_PREFIX)) return false;
  const entry = resolveRouteEntry(windowCode.slice(WINDOW_CODE_PREFIX.length));
  return entry?.parentPath !== undefined;
}

function mapAdminAssignment(
  row: Record<string, unknown>,
): AdminRoleAssignmentSummary {
  return {
    id: row.id as string,
    roleState: row.role_state as AdminRoleAssignmentSummary["roleState"],
    roleCode: (row.role_code as string | null) ?? null,
    roleName: (row.role_name as string | null) ?? null,
    scopeType: row.scope_type as AdminRoleAssignmentSummary["scopeType"],
    scopeState: row.scope_state as AdminRoleAssignmentSummary["scopeState"],
    scopeOrganizationUnitId:
      (row.scope_organization_unit_id as string | null) ?? null,
    scopeOrganizationUnitName:
      (row.scope_organization_unit_name as string | null) ?? null,
    scopeCustomerId: (row.scope_customer_id as string | null) ?? null,
    scopeCustomerName: (row.scope_customer_name as string | null) ?? null,
  };
}

/** The actor's own Organization Unit anchors for one permission, unexpanded.
 * Module-level so both the transaction-scoped and pool-scoped callers ask the
 * same question (§4.4 E: the hierarchy rule exists in exactly one place). */
async function listActorOrganizationUnitAnchorsIn(
  client: Pool | PoolClient,
  userId: string,
  permissionCode: string,
): Promise<string[]> {
  const result = await client.query<{ id: string }>(
    `SELECT DISTINCT aura.scope_organization_unit_id AS id
       FROM authorization_effective_user_role_assignments aura
       JOIN role_permissions rp ON rp.role_id = aura.role_id
       JOIN permissions p ON p.id = rp.permission_id
      WHERE aura.user_id = $1
        AND aura.scope_type = 'organization_unit'
        AND aura.scope_organization_unit_id IS NOT NULL
        AND p.code = $2
      ORDER BY aura.scope_organization_unit_id`,
    [userId, permissionCode],
  );
  return result.rows.map((row) => row.id);
}

/** Downward `parent_id` walk (ADR-0009 hierarchical Data Scope): an authority
 * on a unit covers every unit beneath it. `UNION` rather than `UNION ALL` so a
 * cycle cannot turn into an infinite scan. */
async function listOrganizationUnitSubtreeIdsIn(
  client: Pool | PoolClient,
  tenantId: string,
  rootOrganizationUnitIds: readonly string[],
): Promise<string[]> {
  const roots = [...new Set(rootOrganizationUnitIds)];
  if (roots.length === 0) return [];
  const result = await client.query<{ id: string }>(
    `WITH RECURSIVE subtree AS (
       SELECT id
         FROM organization_units
        WHERE tenant_id = $1
          AND id = ANY($2::uuid[])
          AND deleted_at IS NULL
       UNION
       SELECT child.id
         FROM organization_units child
         JOIN subtree parent ON child.parent_id = parent.id
        WHERE child.tenant_id = $1
          AND child.deleted_at IS NULL
     )
     SELECT id FROM subtree ORDER BY id`,
    [tenantId, roots],
  );
  return result.rows.map((row) => row.id);
}

/** Same-assignment visibility (§4.4 risk row 3): only an assignment that
 * ALREADY CARRIES `permissionCode` may contribute scope. A tenant-wide grant
 * therefore has to carry the permission itself — the aggregate-token
 * regression pins exactly that. */
async function resolveAdministrativeVisibilityIn(
  client: Pool | PoolClient,
  tenantId: string,
  userId: string,
  permissionCode: string,
): Promise<AdministrativeVisibility> {
  const tenantScope = await client.query<{ allowed: boolean }>(
    `SELECT EXISTS (
       SELECT 1
         FROM authorization_effective_user_role_assignments aura
         JOIN role_permissions rp ON rp.role_id = aura.role_id
         JOIN permissions p ON p.id = rp.permission_id
        WHERE aura.tenant_id = $1
          AND aura.user_id = $2
          AND aura.scope_type = 'tenant'
          AND aura.scope_organization_unit_id IS NULL
          AND aura.scope_customer_id IS NULL
          AND p.code = $3
     ) AS allowed`,
    [tenantId, userId, permissionCode],
  );
  if (tenantScope.rows[0]?.allowed === true) return { kind: "tenant" };

  const anchors = await listActorOrganizationUnitAnchorsIn(
    client,
    userId,
    permissionCode,
  );
  return {
    kind: "units",
    organizationUnitIds: await listOrganizationUnitSubtreeIdsIn(
      client,
      tenantId,
      anchors,
    ),
  };
}

/** Visibility, or a refusal. An empty `units` list is NO authority, not a
 * narrow one, and the two must not look alike: returning an empty page would
 * tell an actor "there are no Users here" when the truth is "you may not ask".
 * §4.4 H step 3 puts this before any target resolution. */
async function requireAdministrativeVisibilityIn(
  client: Pool | PoolClient,
  tenantId: string,
  userId: string,
  permissionCode: string,
): Promise<AdministrativeVisibility> {
  const visibility = await resolveAdministrativeVisibilityIn(
    client,
    tenantId,
    userId,
    permissionCode,
  );
  if (visibility.kind === "units" && visibility.organizationUnitIds.length === 0) {
    throw new ForbiddenError(
      `Missing permission or Data Scope for '${permissionCode}'`,
    );
  }
  return visibility;
}

/** Is `user` inside `visibility`? The same predicate the list read applies in
 * SQL (§4.4 step 16), asked here about one target so a write cannot reach a
 * User the read could not show. Only live Organization Unit assignments
 * count; a `customer` assignment confers no internal-User visibility. */
function isUserWithinVisibility(
  visibility: AdministrativeVisibility,
  organizationUnitIds: readonly (string | null)[],
): boolean {
  if (visibility.kind === "tenant") return true;
  const visible = new Set(visibility.organizationUnitIds);
  return organizationUnitIds.some((id) => id !== null && visible.has(id));
}

/** A pair's identity, matching the `NULLS NOT DISTINCT` comparison the unique
 * index uses. Used both to reject a repeated pair inside one request and to
 * match an `INSERT ... RETURNING` row back to the pair that produced it. */
function assignmentKey(
  roleId: string,
  scopeType: string,
  scopeId: string | null,
): string {
  return `${roleId}|${scopeType}|${scopeId ?? ""}`;
}

/**
 * §4.4 C: one batch is one transaction and one confirmation, so a pair repeated
 * inside the request is a malformed request — not a pair to be silently
 * deduplicated. Deduplication would also change the set the preview addressed,
 * which is exactly what `previewHash` exists to prevent.
 */
function normalizeAssignmentPairs(
  pairs: readonly GovernedRoleAssignmentInput[],
): GovernedRoleAssignmentInput[] {
  const seen = new Set<string>();
  for (const pair of pairs) {
    const key =
      pair.scopeType === "tenant"
        ? `${pair.roleCode}|tenant|`
        : pair.scopeType === "organization_unit"
          ? `${pair.roleCode}|organization_unit|${pair.scopeOrganizationUnitId}`
          : `${pair.roleCode}|customer|${pair.scopeCustomerId}`;
    if (seen.has(key)) {
      throw new ValidationError(
        `Duplicate assignment pair for Role '${pair.roleCode}' and the same scope`,
      );
    }
    seen.add(key);
  }
  return [...pairs];
}

/** One joined access-projection row → the public assignment shape. Extracted
 * so the User-centric read, the assignment-centric read, and the batch writer
 * cannot drift apart in what they project. */
function projectAdminAssignment(
  row: Record<string, unknown>,
): AdminRoleAssignmentSummary {
  return mapAdminAssignment({
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
  });
}

/** §4.4 D "satu audit batch": the whole confirmed batch is one audit event
 * carrying every pair, so an operator reads one line per confirmation rather
 * than reconstructing the batch from timestamps. */
async function recordAssignmentBatchAudit(
  client: PoolClient,
  input: {
    tenantId: string;
    actorUserId: string;
    targetUserId: string;
    pairs: readonly AssignmentPairSummary[];
  },
): Promise<void> {
  await client.query(
    `INSERT INTO audit_log
       (tenant_id, actor_user_id, action, entity_type, entity_id, metadata)
     VALUES ($1, $2, 'user.role_assigned', 'user', $3, $4::jsonb)`,
    [
      input.tenantId,
      input.actorUserId,
      input.targetUserId,
      JSON.stringify({
        targetUserId: input.targetUserId,
        batchSize: input.pairs.length,
        pairs: input.pairs.map((pair) => ({
          roleCode: pair.roleCode,
          scopeType: pair.scopeType,
          scopeOrganizationUnitId: pair.scopeOrganizationUnitId,
          scopeCustomerId: pair.scopeCustomerId,
        })),
      }),
    ],
  );
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
    return result.rows.map((row) => ({
      code: row.code,
      description: row.description,
    }));
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

  /**
   * Epic 4 step 11b — the Window lock read, for one actor and one Window.
   *
   * Anchored on `authorization_effective_user_role_assignments` for the same
   * reason every other predicate here is: an assignment whose scope was
   * invalidated, whose Role was revoked, or whose User is inactive or deleted
   * must not confer a write. Reading `user_role_assignments` directly would
   * let a revoked Role keep writing until the next login.
   *
   * One query, two answers, so the caller cannot observe a state the database
   * never had. `configured` and `writable` are aggregated over the same row
   * set: a Window with no configured Role stays outside the lock entirely
   * (absence is not read-only), and a single writable, active assignment is
   * enough however many read-only ones the user also holds (union allow).
   *
   * `scope_type` is deliberately not filtered here, unlike the tenant-scope
   * permission predicates above. The Window lock is a per-Window mode, not a
   * data-scope grant; the scope layer is a separate question answered
   * elsewhere, and intersecting them here would silently narrow the lock.
   */
  async getWindowAccessState(
    tenantId: string,
    userId: string,
    windowCode: string,
  ): Promise<{ configured: boolean; writable: boolean }> {
    const result = await this.pool.query(
      `SELECT COUNT(*) > 0 AS configured,
              COALESCE(BOOL_OR(rwa.is_read_write AND rwa.is_active), false) AS writable
         FROM authorization_effective_user_role_assignments aura
         JOIN role_window_access rwa
           ON rwa.tenant_id = aura.tenant_id
          AND rwa.role_id = aura.role_id
        WHERE aura.user_id = $2
          AND aura.tenant_id = $1
          AND rwa.window_code = $3`,
      [tenantId, userId, windowCode],
    );
    return {
      configured: result.rows[0]?.configured === true,
      writable: result.rows[0]?.writable === true,
    };
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

  async listAdminUserAccess(
    tenantId: string,
    visibility: AdministrativeVisibility,
  ): Promise<AdminUserAccessSummary[]> {
    const rows = await this.listAdminUserAccessRows(tenantId, visibility);
    return this.mapAdminUserAccessRows(rows);
  }

  async getAdminUserAccess(
    tenantId: string,
    userId: string,
    visibility: AdministrativeVisibility,
  ): Promise<AdminUserAccessSummary | null> {
    const rows = await this.listAdminUserAccessRows(tenantId, visibility, userId);
    return this.mapAdminUserAccessRows(rows)[0] ?? null;
  }

  async listOrganizationUnitSubtreeIds(
    tenantId: string,
    rootOrganizationUnitIds: readonly string[],
  ): Promise<string[]> {
    return listOrganizationUnitSubtreeIdsIn(this.pool, tenantId, rootOrganizationUnitIds);
  }

  async listActorOrganizationUnitAnchors(
    userId: string,
    permissionCode: string,
  ): Promise<string[]> {
    return listActorOrganizationUnitAnchorsIn(this.pool, userId, permissionCode);
  }

  async resolveAdministrativeVisibility(
    tenantId: string,
    userId: string,
    permissionCode: string,
  ): Promise<AdministrativeVisibility> {
    return resolveAdministrativeVisibilityIn(
      this.pool,
      tenantId,
      userId,
      permissionCode,
    );
  }

  async listAdminAssignments(
    tenantId: string,
    visibility: AdministrativeVisibility,
  ): Promise<AdminAssignmentRow[]> {
    const rows = await this.listAdminUserAccessRows(tenantId, visibility);
    return rows
      .filter((row) => row.assignment_id)
      .map((row) => ({
        userId: row.user_id as string,
        userName: row.full_name as string,
        userEmail: row.email as string,
        userStatus: row.status as string,
        ...projectAdminAssignment(row),
      }));
  }

  private async listAdminUserAccessRows(
    tenantId: string,
    visibility: AdministrativeVisibility,
    userId?: string,
    visibleRoleIds: readonly string[] = [],
  ): Promise<Record<string, unknown>[]> {
    const visibleUnitIds =
      visibility.kind === "units" ? visibility.organizationUnitIds : [];
    if (visibility.kind === "units" && visibleUnitIds.length === 0) return [];

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
                  ura.role_id,
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
          AND ($2::uuid IS NULL OR u.id = $2::uuid)
          AND (cardinality($5::uuid[]) = 0 OR access.role_id = ANY($5::uuid[]))
          AND (
            $3::boolean
            OR EXISTS (
              SELECT 1
                FROM user_role_assignments target_assignment
               WHERE target_assignment.user_id = u.id
                 AND target_assignment.scope_type = 'organization_unit'
                 AND target_assignment.scope_invalidated_at IS NULL
                 AND target_assignment.scope_organization_unit_id = ANY($4::uuid[])
            )
          )
        ORDER BY u.full_name,
                 u.id,
                 access.role_code,
                 access.created_at,
                 access.id`,
      [
        tenantId,
        userId ?? null,
        visibility.kind === "tenant",
        visibleUnitIds,
        visibleRoleIds,
      ],
    );
    return result.rows as Record<string, unknown>[];
  }

  private mapAdminUserAccessRows(
    rows: readonly Record<string, unknown>[],
  ): AdminUserAccessSummary[] {
    const users = new Map<string, AdminUserAccessSummary>();
    for (const row of rows) {
      const userId = row.user_id as string;
      let user = users.get(userId);
      if (!user) {
        user = {
          id: userId,
          fullName: row.full_name as string,
          email: row.email as string,
          status: row.status as string,
          roleAssignments: [],
        };
        users.set(userId, user);
      }
      if (row.assignment_id) {
        user.roleAssignments.push(projectAdminAssignment(row));
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
        .map((row) => ({
          code: row.permission_code,
          description: row.permission_description,
        })),
    };
  }

  async createGovernedRoleAssignment(
    actor: { tenantId: string; userId: string },
    targetUserId: string,
    input: GovernedRoleAssignmentInput,
  ): Promise<AdminRoleAssignmentSummary> {
    return this.inGovernedTransaction(actor.tenantId, async (client) => {
      // §4.4 D rewire — the same visibility policy as the Wave 2 surface: the
      // entry ticket at any scope, then the actor's own permission-bearing
      // visibility decides which targets exist for them.
      await this.requireTransactionConsoleEntry(client, actor);
      const visibility = await requireAdministrativeVisibilityIn(
        client,
        actor.tenantId,
        actor.userId,
        USER_ROLE_MANAGE,
      );

      const target = await client.query<{ organization_unit_ids: string[] }>(
        `SELECT ARRAY(
                    SELECT ura.scope_organization_unit_id
                      FROM user_role_assignments ura
                     WHERE ura.user_id = users.id
                       AND ura.scope_type = 'organization_unit'
                       AND ura.scope_invalidated_at IS NULL
                  ) AS organization_unit_ids
             FROM users
            WHERE id = $1
              AND tenant_id = $2
              AND deleted_at IS NULL
              AND status = 'active'`,
        [targetUserId, actor.tenantId],
      );
      if (
        !target.rows[0] ||
        !isUserWithinVisibility(visibility, target.rows[0].organization_unit_ids)
      ) {
        throw new NotFoundError("User", targetUserId);
      }
      if (input.scopeType === "tenant" && visibility.kind !== "tenant") {
        throw new ForbiddenError(
          "Tenant-wide assignment requires tenant-wide authority",
        );
      }

      const roleResult = await client.query(
        `SELECT id, code, name
           FROM roles
          WHERE tenant_id = $1
            AND code = $2`,
        [actor.tenantId, input.roleCode],
      );
      const role = roleResult.rows[0];
      if (!role) throw new NotFoundError("Role", input.roleCode);

      if (input.scopeType === "organization_unit" && visibility.kind === "units") {
        // ADR-0009: authority on a unit reaches everything beneath it, so the
        // whole subtree must sit inside the actor's own subtree set.
        const subtree = await listOrganizationUnitSubtreeIdsIn(
          client,
          actor.tenantId,
          [input.scopeOrganizationUnitId],
        );
        if (!subtree.every((id) => visibility.organizationUnitIds.includes(id))) {
          throw new ForbiddenError(
            "Assignment target is outside your Data Scope",
          );
        }
      }

      // §4.4 D — the single-assignment write answers the same delegation and
      // module questions the batch path asks, so neither route is stronger
      // merely because its route differs. One pair, one loop, ceilings once.
      const delegable = await this.assignmentDelegablePermissionCodes(client, actor);
      const activeModules = await this.activeModuleCodes(client, actor.tenantId);
      const granted = await client.query<{ code: string }>(
        `SELECT p.code
           FROM role_permissions rp
           JOIN permissions p ON p.id = rp.permission_id
          WHERE rp.role_id = $1`,
        [role.id],
      );
      for (const { code } of granted.rows) {
        if (!delegable.has(code)) {
          throw new ValidationError(
            `Role '${role.code}' carries permission '${code}' outside your delegation authority`,
          );
        }
        const moduleCode = attributePermission(code);
        if (moduleCode === undefined) {
          throw new ValidationError(`Permission '${code}' has no owning module`);
        }
        if (moduleCode !== "platform" && !activeModules.has(moduleCode)) {
          throw new ValidationError(
            `Role '${role.code}' needs module '${moduleCode}' which is not active for this tenant`,
          );
        }
      }

      let organizationUnitName: string | null = null;
      let customerName: string | null = null;
      const organizationUnitId =
        input.scopeType === "organization_unit"
          ? input.scopeOrganizationUnitId
          : null;
      const customerId =
        input.scopeType === "customer" ? input.scopeCustomerId : null;

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
          databaseError.constraint ===
            "user_role_assignments_exact_assignment_unique"
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
      // §4.4 D rewire — see createGovernedRoleAssignment.
      await this.requireTransactionConsoleEntry(client, actor);
      const visibility = await requireAdministrativeVisibilityIn(
        client,
        actor.tenantId,
        actor.userId,
        USER_ROLE_MANAGE,
      );

      const target = await client.query<{ organization_unit_ids: string[] }>(
        `SELECT ARRAY(
                    SELECT ura.scope_organization_unit_id
                      FROM user_role_assignments ura
                     WHERE ura.user_id = users.id
                       AND ura.scope_type = 'organization_unit'
                       AND ura.scope_invalidated_at IS NULL
                  ) AS organization_unit_ids
             FROM users
            WHERE id = $1
              AND tenant_id = $2
              AND deleted_at IS NULL
              AND status = 'active'`,
        [targetUserId, actor.tenantId],
      );
      if (
        !target.rows[0] ||
        !isUserWithinVisibility(visibility, target.rows[0].organization_unit_ids)
      ) {
        throw new NotFoundError("User", targetUserId);
      }

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
        throw new ConflictError(
          "You cannot remove your own tenant manager assignment",
        );
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
          throw new ConflictError(
            "Cannot remove the final active tenant manager assignment",
          );
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

  // ==========================================================================
  // Epic 4 Wave 2 — User and internal assignment management (CORE-ROADMAP.md
  // §4.4, Gelombang 2 steps 11–16). Both surfaces — the User-centric one and
  // the assignment-centric one — call these methods with the same policy: the
  // actor's visibility is resolved from their OWN permission-bearing
  // assignments (same-assignment rule, §4.4 risk row 3), an empty visibility is
  // a refusal rather than an empty page, targets are narrowed in SQL, and every
  // write owns one transaction with one batch audit row (§4.4 D/E).
  // ==========================================================================

  async listAssignmentOptions(
    actor: { tenantId: string; userId: string },
  ): Promise<AssignmentOptions> {
    const client = await this.pool.connect();
    try {
      // §4.4 D — the picker answers to the same policy as the write it feeds:
      // the console entry ticket at any Data Scope, then the actor's own
      // permission-bearing visibility. `canAssignTenantScope` and every
      // `selectable` below are derived from that visibility, so a region
      // administrator gets the subtree they may really assign to.
      await this.requireTransactionConsoleEntry(client, actor);
      const visibility = await resolveAdministrativeVisibilityIn(
        client,
        actor.tenantId,
        actor.userId,
        USER_ROLE_MANAGE,
      );
      const canAssignTenantScope = visibility.kind === "tenant";

      // One read for every Role and its permission codes, so the ceiling is
      // decided in one place and the picker cannot offer a Role the write path
      // would then refuse (§4.4 step 15).
      const rolePermissions = await client.query<{
        role_id: string;
        code: string;
        role_code: string;
        role_name: string;
        permission_code: string;
      }>(
        `SELECT r.id AS role_id,
                r.code,
                r.name AS role_name,
                r.code AS role_code,
                p.code AS permission_code
           FROM roles r
           JOIN role_permissions rp ON rp.role_id = r.id
           JOIN permissions p ON p.id = rp.permission_id
          WHERE r.tenant_id = $1
          ORDER BY r.code, p.code`,
        [actor.tenantId],
      );
      const emptyRoles = await client.query<{ role_id: string; role_code: string; role_name: string }>(
        `SELECT r.id AS role_id, r.code AS role_code, r.name AS role_name
           FROM roles r
          WHERE r.tenant_id = $1
            AND NOT EXISTS (SELECT 1 FROM role_permissions rp WHERE rp.role_id = r.id)
          ORDER BY r.code`,
        [actor.tenantId],
      );

      const delegable = await this.assignmentDelegablePermissionCodes(client, actor);
      const codesByRole = new Map<string, string[]>();
      const labelByRole = new Map<string, { code: string; name: string }>();
      for (const row of rolePermissions.rows) {
        const codes = codesByRole.get(row.role_id) ?? [];
        codes.push(row.permission_code);
        codesByRole.set(row.role_id, codes);
        labelByRole.set(row.role_id, { code: row.code, name: row.role_name });
      }
      for (const row of emptyRoles.rows) {
        codesByRole.set(row.role_id, []);
        labelByRole.set(row.role_id, { code: row.role_code, name: row.role_name });
      }

      const roles: AssignmentRoleOption[] = [...codesByRole.entries()]
        .map(([roleId, codes]) => ({
          code: labelByRole.get(roleId)!.code,
          name: labelByRole.get(roleId)!.name,
          permissionCount: codes.length,
          selectable: codes.every((code) => delegable.has(code)),
        }))
        .sort((a, b) => (a.code < b.code ? -1 : a.code > b.code ? 1 : 0));

      // The tree is tenant-wide because the browser renders the hierarchy; what
      // the actor may CHOOSE is narrower (§4.4 E). An ancestor above the
      // actor's authority is context with `selectable: false`.
      const units = await client.query<{
        id: string;
        name: string;
        parent_id: string | null;
        depth: number;
      }>(
        `WITH RECURSIVE tree AS (
           SELECT id, name, parent_id, 0 AS depth
             FROM organization_units
            WHERE tenant_id = $1 AND parent_id IS NULL AND deleted_at IS NULL
           UNION ALL
           SELECT child.id, child.name, child.parent_id, tree.depth + 1
             FROM organization_units child
             JOIN tree ON child.parent_id = tree.id
            WHERE child.tenant_id = $1 AND child.deleted_at IS NULL
         )
         SELECT id, name, parent_id, depth FROM tree ORDER BY depth, name`,
        [actor.tenantId],
      );
      const assignableUnits =
        visibility.kind === "units"
          ? new Set(visibility.organizationUnitIds)
          : null;

      const organizationUnits: AssignmentScopeUnitOption[] = units.rows.map(
        (row) => ({
          id: row.id,
          name: row.name,
          parentId: row.parent_id,
          depth: row.depth,
          selectable:
            canAssignTenantScope || (assignableUnits?.has(row.id) ?? false),
        }),
      );

      return { canAssignTenantScope, organizationUnits, roles };
    } finally {
      client.release();
    }
  }

  /**
   * Resolve, validate, and name every pair of a proposed batch, in §4.4 H
   * order: authority, target visibility, per-pair scope, then the Role's
   * delegation and module ceilings. The preview and the confirmation call this,
   * so both answer the same questions and the confirmed set is the previewed
   * set. Returns the display summaries in request order plus the validated rows
   * to insert.
   *
   * `targetUserId` is the User the batch is FOR, and is `null` only on the
   * create path, where the User is created by the caller inside this same
   * transaction and therefore cannot be looked up, cannot already hold an
   * Organization Unit assignment, and cannot be someone else's to govern.
   * §4.4 step 3's target check is skipped there; every pair's scope is not.
   */
  private async resolveAssignmentBatch(
    client: PoolClient,
    actor: { tenantId: string; userId: string },
    targetUserId: string | null,
    pairs: readonly GovernedRoleAssignmentInput[],
    resolvedVisibility?: AdministrativeVisibility,
  ): Promise<{
    summaries: AssignmentPairSummary[];
    writePairs: {
      roleId: string;
      scopeType: "tenant" | "organization_unit";
      scopeOrganizationUnitId: string | null;
    }[];
  }> {
    if (pairs.length === 0) {
      throw new ValidationError("At least one assignment pair is required");
    }
    const visibility =
      resolvedVisibility ??
      (await requireAdministrativeVisibilityIn(
        client,
        actor.tenantId,
        actor.userId,
        USER_ROLE_MANAGE,
      ));

    if (targetUserId !== null) {
      const target = await client.query<{ organization_unit_ids: string[] }>(
        `SELECT ARRAY(
                  SELECT ura.scope_organization_unit_id
                    FROM user_role_assignments ura
                   WHERE ura.user_id = users.id
                     AND ura.scope_type = 'organization_unit'
                     AND ura.scope_invalidated_at IS NULL
                ) AS organization_unit_ids
           FROM users
          WHERE id = $1
            AND tenant_id = $2
            AND deleted_at IS NULL
            AND status = 'active'`,
        [targetUserId, actor.tenantId],
      );
      if (
        !target.rows[0] ||
        !isUserWithinVisibility(visibility, target.rows[0].organization_unit_ids)
      ) {
        // Out of visibility is indistinguishable from missing (§4.4 risk row 1).
        throw new NotFoundError("User", targetUserId);
      }
    }

    const roleRows = await client.query<{ id: string; code: string; name: string }>(
      `SELECT id, code, name
         FROM roles
        WHERE tenant_id = $1 AND code = ANY($2::text[])`,
      [actor.tenantId, [...new Set(pairs.map((p) => p.roleCode))]],
    );
    const roleByCode = new Map(roleRows.rows.map((r) => [r.code, r]));
    const codeByRoleId = new Map(roleRows.rows.map((r) => [r.id, r.code]));

    const unitIds = [
      ...new Set(
        pairs.flatMap((p) =>
          p.scopeType === "organization_unit" ? [p.scopeOrganizationUnitId] : [],
        ),
      ),
    ];
    const unitNames = new Map<string, string>();
    if (unitIds.length > 0) {
      const unitRows = await client.query<{ id: string; name: string }>(
        `SELECT id, name
           FROM organization_units
          WHERE tenant_id = $1 AND id = ANY($2::uuid[]) AND deleted_at IS NULL`,
        [actor.tenantId, unitIds],
      );
      for (const row of unitRows.rows) unitNames.set(row.id, row.name);
    }

    const visibleUnits =
      visibility.kind === "units"
        ? new Set(visibility.organizationUnitIds)
        : new Set<string>();
    const summaries: AssignmentPairSummary[] = [];
    const writePairs: {
      roleId: string;
      scopeType: "tenant" | "organization_unit";
      scopeOrganizationUnitId: string | null;
    }[] = [];

    for (const pair of pairs) {
      const role = roleByCode.get(pair.roleCode);
      if (!role) throw new NotFoundError("Role", pair.roleCode);

      if (pair.scopeType === "tenant") {
        if (visibility.kind !== "tenant") {
          throw new ForbiddenError(
            "Tenant-wide assignment requires tenant-wide authority",
          );
        }
        summaries.push({
          roleCode: role.code,
          roleName: role.name,
          scopeType: "tenant",
          scopeOrganizationUnitId: null,
          scopeOrganizationUnitName: null,
          scopeCustomerId: null,
          scopeCustomerName: null,
        });
        writePairs.push({ roleId: role.id, scopeType: "tenant", scopeOrganizationUnitId: null });
        continue;
      }

      if (pair.scopeType === "organization_unit") {
        const name = unitNames.get(pair.scopeOrganizationUnitId);
        if (!name) {
          throw new NotFoundError("Organization Unit", pair.scopeOrganizationUnitId);
        }
        if (
          visibility.kind === "units" &&
          !visibleUnits.has(pair.scopeOrganizationUnitId)
        ) {
          // ADR-0009: authority on a unit reaches everything beneath it. The
          // actor's own set is already closed downward, so membership of the
          // TARGET unit is equivalent to "the whole target subtree is inside
          // the actor's authority" — and it costs no extra query.
          throw new ForbiddenError(
            "Assignment target is outside your Data Scope",
          );
        }
        summaries.push({
          roleCode: role.code,
          roleName: role.name,
          scopeType: "organization_unit",
          scopeOrganizationUnitId: pair.scopeOrganizationUnitId,
          scopeOrganizationUnitName: name,
          scopeCustomerId: null,
          scopeCustomerName: null,
        });
        writePairs.push({
          roleId: role.id,
          scopeType: "organization_unit",
          scopeOrganizationUnitId: pair.scopeOrganizationUnitId,
        });
        continue;
      }

      // §4.4 E keeps Customer scope out of the Epic 4 UI until the Service
      // Operation session closes, so no actor may reach it through this
      // governed surface in Wave 2. Refused by name, not silently dropped.
      throw new ValidationError(
        "Customer-scope assignment is not available through this surface",
      );
    }

    // Ceilings, once per distinct Role rather than once per pair.
    const distinctRoleIds = [...new Set(writePairs.map((p) => p.roleId))];
    const grantedRows = await client.query<{ role_id: string; permission_code: string }>(
      `SELECT rp.role_id, p.code AS permission_code
         FROM role_permissions rp
         JOIN permissions p ON p.id = rp.permission_id
        WHERE rp.role_id = ANY($1::uuid[])`,
      [distinctRoleIds],
    );
    const codesByRole = new Map<string, string[]>();
    for (const row of grantedRows.rows) {
      const codes = codesByRole.get(row.role_id) ?? [];
      codes.push(row.permission_code);
      codesByRole.set(row.role_id, codes);
    }
    const delegable = await this.assignmentDelegablePermissionCodes(client, actor);
    const activeModules = await this.activeModuleCodes(client, actor.tenantId);
    for (const roleId of distinctRoleIds) {
      const roleCode = codeByRoleId.get(roleId)!;
      for (const code of codesByRole.get(roleId) ?? []) {
        if (!delegable.has(code)) {
          throw new ValidationError(
            `Role '${roleCode}' carries permission '${code}' outside your delegation authority`,
          );
        }
        // The owning module is a code-owned fact (`module-attribution.ts`),
        // never a database column, so it is resolved in TypeScript.
        const moduleCode = attributePermission(code);
        if (moduleCode === undefined) {
          throw new ValidationError(`Permission '${code}' has no owning module`);
        }
        // §4.4 step 23: an inactive module is refused with its own reason, not
        // folded into the delegation refusal.
        if (moduleCode !== "platform" && !activeModules.has(moduleCode)) {
          throw new ValidationError(
            `Role '${roleCode}' needs module '${moduleCode}' which is not active for this tenant`,
          );
        }
      }
    }

    return { summaries, writePairs };
  }

  async previewRoleAssignments(
    actor: { tenantId: string; userId: string },
    targetUserId: string,
    input: PreviewRoleAssignmentsInput,
  ): Promise<AssignmentBatchPreview> {
    normalizeAssignmentPairs(input.pairs);
    return this.inGovernedTransaction(actor.tenantId, async (client) => {
      // §4.4 D — the entry ticket only; `resolveAssignmentBatch` resolves the
      // actor's visibility and refuses a target outside it, so the preview
      // answers exactly the questions the confirmation will answer.
      await this.requireTransactionConsoleEntry(client, actor);
      const { summaries } = await this.resolveAssignmentBatch(
        client,
        actor,
        targetUserId,
        input.pairs,
      );
      return {
        previewHash: computeAssignmentBatchHash(
          actor.userId,
          targetUserId,
          input.pairs,
        ),
        targetUserId,
        pairs: summaries,
      };
    });
  }

  async updateRoleAssignments(
    actor: { tenantId: string; userId: string },
    targetUserId: string,
    input: UpdateRoleAssignmentsInput,
  ): Promise<AssignmentBatchResult> {
    if (input.confirm !== true) {
      throw new ValidationError("Confirmation flag is required");
    }
    normalizeAssignmentPairs(input.pairs);
    // The content address binds actor, target, and pairs. Recomputed here from
    // what is about to be written, so a review approved against one batch can
    // never be replayed onto another.
    if (
      computeAssignmentBatchHash(actor.userId, targetUserId, input.pairs) !==
      input.previewHash
    ) {
      throw new ConflictError(
        "The previewed assignment batch no longer matches this request",
      );
    }

    return this.inGovernedTransaction(actor.tenantId, async (client) => {
      // §4.4 D — same policy as the preview above; the hash comparison already
      // happened outside the transaction, the visibility check happens inside
      // it, right here, against live data.
      await this.requireTransactionConsoleEntry(client, actor);
      const { summaries, writePairs } = await this.resolveAssignmentBatch(
        client,
        actor,
        targetUserId,
        input.pairs,
      );

      // One multi-row INSERT. Deliberately NOT `ON CONFLICT DO NOTHING`: §4.4 C
      // requires all-or-nothing, so an existing pair must abort the batch with
      // a conflict, and the 23505 catch below is the race backstop rather than
      // the primary check.
      let inserted;
      try {
        inserted = await client.query<{
          id: string;
          role_id: string;
          scope_type: "tenant" | "organization_unit";
          scope_organization_unit_id: string | null;
        }>(
          `INSERT INTO user_role_assignments
             (user_id, role_id, scope_type, scope_organization_unit_id,
              scope_customer_id, created_by)
           SELECT $1, r.id, p.scope_type, p.scope_organization_unit_id, NULL, $2
             FROM unnest($3::uuid[], $4::text[], $5::uuid[])
               AS p(role_id, scope_type, scope_organization_unit_id)
             JOIN roles r ON r.id = p.role_id
           RETURNING id, role_id, scope_type, scope_organization_unit_id`,
          [
            targetUserId,
            actor.userId,
            writePairs.map((p) => p.roleId),
            writePairs.map((p) => p.scopeType),
            writePairs.map((p) => p.scopeOrganizationUnitId),
          ],
        );
      } catch (error) {
        const databaseError = error as { code?: string; constraint?: string };
        if (
          databaseError.code === UNIQUE_VIOLATION &&
          databaseError.constraint ===
            "user_role_assignments_exact_assignment_unique"
        ) {
          throw new ConflictError(
            "One or more of these Role assignments already exist for this User",
          );
        }
        throw error;
      }

      await recordAssignmentBatchAudit(client, {
        tenantId: actor.tenantId,
        actorUserId: actor.userId,
        targetUserId,
        pairs: summaries,
      });

      const indexByKey = new Map(
        writePairs.map((pair, index) => [
          assignmentKey(pair.roleId, pair.scopeType, pair.scopeOrganizationUnitId),
          index,
        ]),
      );
      const created = inserted.rows.map((row) => {
        const summary =
          summaries[
            indexByKey.get(
              assignmentKey(row.role_id, row.scope_type, row.scope_organization_unit_id),
            )!
          ];
        return mapAdminAssignment({
          id: row.id,
          role_state: "available",
          role_code: summary.roleCode,
          role_name: summary.roleName,
          scope_type: row.scope_type,
          scope_state: "available",
          scope_organization_unit_id: row.scope_organization_unit_id,
          scope_organization_unit_name: summary.scopeOrganizationUnitName,
          scope_customer_id: null,
          scope_customer_name: null,
        });
      });

      return { targetUserId, created };
    });
  }

  async createGovernedUserWithAssignments(
    actor: { tenantId: string; userId: string },
    input: CreateGovernedUserInput,
  ): Promise<{
    user: GovernedUserSummary;
    assignments: AdminRoleAssignmentSummary[];
  }> {
    if (input.pairs.length > 0) normalizeAssignmentPairs(input.pairs);

    // Hashed BEFORE the tenant lock. Hashing is CPU work measured in tens of
    // milliseconds; holding the serialization lock through it would stall every
    // other governed write in the tenant for no correctness gain.
    const passwordHash = await hashPassword(input.password);
    const email = input.email.toLowerCase();

    return this.inGovernedTransaction(actor.tenantId, async (client) => {
      // §4.4 D — the entry ticket, then the actor's own permission-bearing
      // visibility. Resolved HERE, not by `resolveAssignmentBatch`, because
      // §4.4 step 3's target check cannot apply to a User this transaction is
      // about to create: they hold no Organization Unit assignment yet, so a
      // units actor would be refused their own new User. The pair ceilings
      // below still run against live data via the `null` target.
      await this.requireTransactionConsoleEntry(client, actor);
      const visibility = await resolveAdministrativeVisibilityIn(
        client,
        actor.tenantId,
        actor.userId,
        USER_ROLE_MANAGE,
      );
      if (
        visibility.kind === "units" &&
        visibility.organizationUnitIds.length === 0
      ) {
        throw new ForbiddenError(
          "Missing permission or Data Scope for 'user.role.manage'",
        );
      }

      const emailConflict = await client.query(
        `SELECT 1
           FROM users
          WHERE tenant_id = $1 AND email = $2 AND deleted_at IS NULL`,
        [actor.tenantId, email],
      );
      if (emailConflict.rows[0]) {
        throw new ConflictError(
          `Email '${input.email}' already exists in this Tenant`,
        );
      }

      let created: { id: string; status: string };
      try {
        const inserted = await client.query<{ id: string; status: string }>(
          `INSERT INTO users
             (tenant_id, email, password_hash, full_name, created_by, updated_by)
           VALUES ($1, $2, $3, $4, $5, $5)
           RETURNING id, status`,
          [actor.tenantId, email, passwordHash, input.fullName, actor.userId],
        );
        created = inserted.rows[0];
      } catch (error) {
        // The pre-check lost a race. `users_tenant_email_unique` does not
        // exclude soft-deleted rows, so a raw 23505 here would otherwise
        // surface as a 500.
        if ((error as { code?: string }).code === UNIQUE_VIOLATION) {
          throw new ConflictError(
            `Email '${input.email}' already exists in this Tenant`,
          );
        }
        throw error;
      }

      await client.query(
        `INSERT INTO audit_log
           (tenant_id, actor_user_id, action, entity_type, entity_id, metadata)
         VALUES ($1, $2, 'user.created', 'user', $3, $4::jsonb)`,
        [
          actor.tenantId,
          actor.userId,
          created.id,
          JSON.stringify({ email, fullName: input.fullName }),
        ],
      );

      let assignments: AdminRoleAssignmentSummary[] = [];
      if (input.pairs.length > 0) {
        const { summaries, writePairs } = await this.resolveAssignmentBatch(
          client,
          actor,
          null,
          input.pairs,
          visibility,
        );
        const inserted = await client.query<{
          id: string;
          role_id: string;
          scope_type: "tenant" | "organization_unit";
          scope_organization_unit_id: string | null;
        }>(
          `INSERT INTO user_role_assignments
             (user_id, role_id, scope_type, scope_organization_unit_id,
              scope_customer_id, created_by)
           SELECT $1, r.id, p.scope_type, p.scope_organization_unit_id, NULL, $2
             FROM unnest($3::uuid[], $4::text[], $5::uuid[])
               AS p(role_id, scope_type, scope_organization_unit_id)
             JOIN roles r ON r.id = p.role_id
           RETURNING id, role_id, scope_type, scope_organization_unit_id`,
          [
            created.id,
            actor.userId,
            writePairs.map((p) => p.roleId),
            writePairs.map((p) => p.scopeType),
            writePairs.map((p) => p.scopeOrganizationUnitId),
          ],
        );

        await recordAssignmentBatchAudit(client, {
          tenantId: actor.tenantId,
          actorUserId: actor.userId,
          targetUserId: created.id,
          pairs: summaries,
        });

        const indexByKey = new Map(
          writePairs.map((pair, index) => [
            assignmentKey(pair.roleId, pair.scopeType, pair.scopeOrganizationUnitId),
            index,
          ]),
        );
        assignments = inserted.rows.map((row) => {
          const summary =
            summaries[
              indexByKey.get(
                assignmentKey(row.role_id, row.scope_type, row.scope_organization_unit_id),
              )!
            ];
          return mapAdminAssignment({
            id: row.id,
            role_state: "available",
            role_code: summary.roleCode,
            role_name: summary.roleName,
            scope_type: row.scope_type,
            scope_state: "available",
            scope_organization_unit_id: row.scope_organization_unit_id,
            scope_organization_unit_name: summary.scopeOrganizationUnitName,
            scope_customer_id: null,
            scope_customer_name: null,
          });
        });
      }

      return {
        user: {
          id: created.id,
          fullName: input.fullName,
          email,
          status: created.status,
        },
        assignments,
      };
    });
  }

  // Epic 4 Wave 1 — Role definition (CORE-ROADMAP.md §4.4, Gelombang 1 steps
  // 5–9). Every mutating method owns its complete transaction: tenant lock,
  // authority revalidation, ceiling validation, mutation, and an append-only
  // audit row carrying the before/after definition.
  //
  // Windows are CONFIGURED here; enforcement is step 11b, wired in
  // `window-access-plugin.ts`. `enforcementStatus` is read from that plugin's
  // census of the routes Fastify declared (`windowEnforcementStatus()`) so this
  // read cannot claim a state the server does not enforce. Both call sites
  // below run after boot, which is when the census has been filled.
  // ==========================================================================

  async getRoleDefinition(
    tenantId: string,
    roleCode: string,
  ): Promise<RoleDefinition | null> {
    const role = await this.pool.query(
      `SELECT id, tenant_id, code, name, COALESCE(is_full_access, false) AS is_full_access, version
         FROM roles
        WHERE tenant_id = $1 AND code = $2`,
      [tenantId, roleCode],
    );
    if (!role.rows[0]) return null;
    return this.loadRoleDefinition(this.pool, role.rows[0]);
  }

  async listRoleDefinitionOptions(actor: {
    tenantId: string;
    userId: string;
  }): Promise<RoleDefinitionOptions> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await this.lockTenant(client, actor.tenantId);
      await this.requireTransactionRoleDefinitionAuthority(client, actor);

      const delegable = await this.roleDefinitionDelegablePermissionCodes(client, actor);
      const activeModules = await this.activeModuleCodes(
        client,
        actor.tenantId,
      );
      const registered = await this.registeredProcessCodes(
        client,
        actor.tenantId,
      );

      const catalog = await client.query(
        `SELECT code, description FROM permissions ORDER BY code`,
      );
      const permissions: PermissionOption[] = catalog.rows.map(
        (row: { code: string; description: string }) => {
          const moduleCode = attributePermission(row.code) ?? null;
          return {
            code: row.code,
            description: row.description,
            moduleCode,
            isActive: moduleCode !== null && registered.has(row.code),
            selectable:
              moduleCode !== null &&
              registered.has(row.code) &&
              (moduleCode === "platform" || activeModules.has(moduleCode)) &&
              delegable.has(row.code),
          };
        },
      );

      const windows = await this.loadWindowOptions(
        client,
        actor.tenantId,
        activeModules,
        delegable,
      );
      await client.query("COMMIT");
      return { permissions, windows };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async createRoleDefinition(
    actor: { tenantId: string; userId: string },
    input: CreateRoleDefinitionInput,
  ): Promise<RoleDefinition> {
    return this.inGovernedTransaction(actor.tenantId, async (client) => {
      await this.requireTransactionRoleDefinitionAuthority(client, actor);

      const existing = await client.query(
        `SELECT 1 FROM roles WHERE tenant_id = $1 AND code = $2`,
        [actor.tenantId, input.code],
      );
      if (existing.rows[0]) {
        throw new ConflictError(
          `A Role with code '${input.code}' already exists`,
        );
      }

      const permissionCodes = await this.validateProposedGrants(
        client,
        actor,
        input.permissionCodes,
        new Set(),
      );
      const windows = await this.validateProposedWindows(
        client,
        actor,
        input.windows,
        new Set(),
      );

      const inserted = await client.query(
        `INSERT INTO roles (tenant_id, code, name)
         VALUES ($1, $2, $3)
         RETURNING id`,
        [actor.tenantId, input.code, input.name],
      );
      const roleId = inserted.rows[0].id as string;
      await this.writeRoleGrants(
        client,
        actor.tenantId,
        roleId,
        permissionCodes,
        windows,
      );

      const definition = await this.loadRoleDefinition(client, {
        id: roleId,
        tenant_id: actor.tenantId,
        code: input.code,
        name: input.name,
        is_full_access: false,
        version: 1,
      });
      await this.recordRoleDefinitionAudit(client, {
        tenantId: actor.tenantId,
        actorUserId: actor.userId,
        roleCode: input.code,
        roleId,
        action: "role.definition_created",
        before: null,
        after: definition,
      });
      return definition;
    });
  }

  async copyRoleDefinition(
    actor: { tenantId: string; userId: string },
    sourceCode: string,
    input: CopyRoleDefinitionInput,
  ): Promise<RoleDefinition> {
    return this.inGovernedTransaction(actor.tenantId, async (client) => {
      await this.requireTransactionRoleDefinitionAuthority(client, actor);

      const source = await client.query(
        `SELECT id, COALESCE(is_full_access, false) AS is_full_access
           FROM roles WHERE tenant_id = $1 AND code = $2`,
        [actor.tenantId, sourceCode],
      );
      if (!source.rows[0]) throw new NotFoundError("Role", sourceCode);
      const sourceId = source.rows[0].id as string;

      const taken = await client.query(
        `SELECT 1 FROM roles WHERE tenant_id = $1 AND code = $2`,
        [actor.tenantId, input.code],
      );
      if (taken.rows[0])
        throw new ConflictError(
          `A Role with code '${input.code}' already exists`,
        );

      // Detached copy: the source's EXPLICIT rows are carried over as the new
      // Role's own rows. A full-access source is deliberately NOT copied as
      // full-access — the auto-grant flag is never inherited, so the copy holds
      // exactly the grants the source held explicitly at copy time (§4.4 C).
      const sourcePermissions = await client.query(
        `SELECT p.code
           FROM role_permissions rp
           JOIN permissions p ON p.id = rp.permission_id
          WHERE rp.role_id = $1`,
        [sourceId],
      );
      const sourceWindows = await client.query(
        `SELECT window_code, is_read_write, is_active
           FROM role_window_access WHERE tenant_id = $1 AND role_id = $2`,
        [actor.tenantId, sourceId],
      );

      const forNew = new Set<string>();
      const permissionCodes = await this.validateProposedGrants(
        client,
        actor,
        sourcePermissions.rows.map((r: { code: string }) => r.code),
        forNew,
      );
      const windows = await this.validateProposedWindows(
        client,
        actor,
        sourceWindows.rows.map(
          (r: {
            window_code: string;
            is_read_write: boolean;
            is_active: boolean;
          }) => ({
            windowCode: r.window_code,
            isReadWrite: r.is_read_write,
            isActive: r.is_active,
          }),
        ),
        forNew,
      );

      const inserted = await client.query(
        `INSERT INTO roles (tenant_id, code, name)
         VALUES ($1, $2, $3)
         RETURNING id`,
        [actor.tenantId, input.code, input.name],
      );
      const roleId = inserted.rows[0].id as string;
      await this.writeRoleGrants(
        client,
        actor.tenantId,
        roleId,
        permissionCodes,
        windows,
      );

      const definition = await this.loadRoleDefinition(client, {
        id: roleId,
        tenant_id: actor.tenantId,
        code: input.code,
        name: input.name,
        is_full_access: false,
        version: 1,
      });
      await this.recordRoleDefinitionAudit(client, {
        tenantId: actor.tenantId,
        actorUserId: actor.userId,
        roleCode: input.code,
        roleId,
        action: "role.definition_copied",
        before: null,
        after: definition,
      });
      return definition;
    });
  }

  async previewRoleDefinition(
    actor: { tenantId: string; userId: string },
    roleCode: string,
    input: RoleDefinitionPreviewInput,
  ): Promise<RoleDefinitionPreview> {
    return this.inGovernedTransaction(actor.tenantId, async (client) => {
      await this.requireTransactionRoleDefinitionAuthority(client, actor);

      const role = await this.loadRoleRow(client, actor.tenantId, roleCode);
      const current = await this.loadRoleDefinition(client, role);
      if (input.version !== current.version) {
        throw new ConflictError(
          `Role '${roleCode}' changed since it was loaded (expected version ${input.version}, current ${current.version})`,
        );
      }

      const existingCodes = new Set(current.permissionCodes);
      const existingWindows = new Set(current.windows.map((w) => w.windowCode));
      const permissionCodes = await this.validateProposedGrants(
        client,
        actor,
        input.permissionCodes,
        existingCodes,
      );
      const windows = await this.validateProposedWindows(
        client,
        actor,
        input.windows,
        existingWindows,
      );
      const affectedUserCount = await this.countRoleAssignments(
        client,
        actor.tenantId,
        role.id,
      );

      const preview: RoleDefinition = {
        id: role.id,
        tenantId: actor.tenantId,
        code: roleCode,
        name: input.name,
        isFullAccess: current.isFullAccess,
        version: input.version,
        permissionCodes,
        windows,
        enforcementStatus: windowEnforcementStatus(),
      };
      return {
        role: preview,
        previewHash: computeDefinitionHash(input.name, permissionCodes, windows),
        affectedUserCount,
      };
    });
  }

  async updateRoleDefinition(
    actor: { tenantId: string; userId: string },
    roleCode: string,
    input: UpdateRoleDefinitionInput,
  ): Promise<RoleDefinition> {
    return this.inGovernedTransaction(actor.tenantId, async (client) => {
      await this.requireTransactionRoleDefinitionAuthority(client, actor);

      const role = await this.loadRoleRow(client, actor.tenantId, roleCode);
      const current = await this.loadRoleDefinition(client, role);
      if (input.version !== current.version) {
        throw new ConflictError(
          `Role '${roleCode}' changed since it was previewed (expected version ${input.version}, current ${current.version})`,
        );
      }
      const expectedHash = computeDefinitionHash(
        input.name,
        input.permissionCodes,
        input.windows,
      );
      if (expectedHash !== input.previewHash) {
        throw new ConflictError(
          "The previewed Role definition no longer matches this request",
        );
      }

      const existingCodes = new Set(current.permissionCodes);
      const existingWindows = new Set(current.windows.map((w) => w.windowCode));
      const permissionCodes = await this.validateProposedGrants(
        client,
        actor,
        input.permissionCodes,
        existingCodes,
      );
      const windows = await this.validateProposedWindows(
        client,
        actor,
        input.windows,
        existingWindows,
      );

      // §4.4 B: `version` is a concurrency token for DEFINITION changes. When
      // the accepted request re-states the definition the Role already holds,
      // nothing changed, so the token must not advance — moving it would
      // invalidate every other administrator's in-flight preview for no
      // reason. Return the stored definition untouched (no rewrite, no audit).
      if (
        input.name === current.name &&
        sameStringArrays(permissionCodes, current.permissionCodes) &&
        sameWindows(windows, current.windows)
      ) {
        return current;
      }

      await this.protectTenantManagers(client, actor, role.id, permissionCodes);

      const affectedUserCountBefore = await this.countRoleAssignments(
        client,
        actor.tenantId,
        role.id,
      );

      await client.query(
        `UPDATE roles SET name = $1, version = version + 1 WHERE id = $2`,
        [input.name, role.id],
      );
      await client.query(`DELETE FROM role_permissions WHERE role_id = $1`, [
        role.id,
      ]);
      await client.query(
        `DELETE FROM role_window_access WHERE tenant_id = $1 AND role_id = $2`,
        [actor.tenantId, role.id],
      );
      await this.writeRoleGrants(
        client,
        actor.tenantId,
        role.id,
        permissionCodes,
        windows,
      );

      const after = await this.loadRoleDefinition(client, {
        id: role.id,
        tenant_id: actor.tenantId,
        code: roleCode,
        name: input.name,
        is_full_access: current.isFullAccess,
        version: current.version + 1,
      });
      await this.recordRoleDefinitionAudit(client, {
        tenantId: actor.tenantId,
        actorUserId: actor.userId,
        roleCode,
        roleId: role.id,
        action: "role.definition_updated",
        before: current,
        after,
        affectedUserCount: affectedUserCountBefore,
      });
      return after;
    });
  }

  async deleteRoleDefinition(
    actor: { tenantId: string; userId: string },
    roleCode: string,
  ): Promise<void> {
    await this.inGovernedTransaction(actor.tenantId, async (client) => {
      await this.requireTransactionRoleDefinitionAuthority(client, actor);

      const role = await this.loadRoleRow(client, actor.tenantId, roleCode);
      const current = await this.loadRoleDefinition(client, role);

      // §4.4 G: a Role is deleted only when it is not in use. ANY retained
      // assignment ROW refuses the delete — invalidated ones and ones whose
      // user was soft-deleted included — because `user_role_assignments.
      // role_id` is ON DELETE CASCADE, so proceeding would erase access
      // history with no trace. Counting DISTINCT active users here would let
      // exactly those rows through.
      const retained = await this.countRetainedAssignments(
        client,
        actor.tenantId,
        role.id,
      );
      if (retained > 0) {
        throw new ConflictError(
          `Cannot delete Role '${roleCode}': ${retained} User assignment(s) still reference it`,
        );
      }

      await client.query(`DELETE FROM role_permissions WHERE role_id = $1`, [
        role.id,
      ]);
      await client.query(
        `DELETE FROM role_window_access WHERE tenant_id = $1 AND role_id = $2`,
        [actor.tenantId, role.id],
      );
      await client.query(`DELETE FROM roles WHERE id = $1 AND tenant_id = $2`, [
        role.id,
        actor.tenantId,
      ]);
      await this.recordRoleDefinitionAudit(client, {
        tenantId: actor.tenantId,
        actorUserId: actor.userId,
        roleCode,
        roleId: role.id,
        action: "role.definition_deleted",
        before: current,
        after: null,
      });
    });
  }

  private async loadRoleRow(
    client: PoolClient | Pool,
    tenantId: string,
    roleCode: string,
  ): Promise<{
    id: string;
    tenant_id: string;
    code: string;
    name: string;
    is_full_access: boolean;
    version: number;
  }> {
    const result = await client.query(
      `SELECT id, tenant_id, code, name, COALESCE(is_full_access, false) AS is_full_access, version
         FROM roles
        WHERE tenant_id = $1 AND code = $2`,
      [tenantId, roleCode],
    );
    if (!result.rows[0]) throw new NotFoundError("Role", roleCode);
    return result.rows[0];
  }

  private async lockTenant(
    client: PoolClient,
    tenantId: string,
  ): Promise<void> {
    const lockedTenant = await client.query(
      `SELECT id FROM tenants WHERE id = $1 AND deleted_at IS NULL FOR UPDATE`,
      [tenantId],
    );
    if (!lockedTenant.rows[0]) throw new NotFoundError("Tenant", tenantId);
  }

  private async loadRoleDefinition(
    client: PoolClient | Pool,
    role: {
      id: string;
      tenant_id: string;
      code: string;
      name: string;
      is_full_access: boolean;
      version: number;
    },
  ): Promise<RoleDefinition> {
    const permissions = await client.query(
      `SELECT p.code
         FROM role_permissions rp
         JOIN permissions p ON p.id = rp.permission_id
        WHERE rp.role_id = $1
        ORDER BY p.code`,
      [role.id],
    );
    const windows = await client.query(
      `SELECT window_code, is_read_write, is_active
         FROM role_window_access
        WHERE tenant_id = $1 AND role_id = $2
        ORDER BY window_code`,
      [role.tenant_id, role.id],
    );
    return {
      id: role.id,
      tenantId: role.tenant_id,
      code: role.code,
      name: role.name,
      isFullAccess: role.is_full_access,
      version: role.version,
      permissionCodes: permissions.rows.map((r: { code: string }) => r.code),
      windows: windows.rows.map(
        (r: {
          window_code: string;
          is_read_write: boolean;
          is_active: boolean;
        }) => ({
          windowCode: r.window_code,
          isReadWrite: r.is_read_write,
          isActive: r.is_active,
        }),
      ),
      enforcementStatus: windowEnforcementStatus(),
    };
  }

  /**
   * Authority revalidation INSIDE the tenant lock, in the same shape as
   * `requireTransactionActorAuthority`: actor active in tenant, holding
   * `admin.console.read` from an effective assignment, AND holding BOTH
   * `role.manage` and `config.read` from ONE tenant-scoped assignment. The
   * single-assignment rule is what keeps delegation authority from being
   * manufactured out of unrelated Roles.
   */
  private async requireTransactionRoleDefinitionAuthority(
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
               GROUP BY manager_aura.id
              HAVING COUNT(DISTINCT CASE WHEN manager_p.code IN ($4, $5) THEN manager_p.code END) = 2
            )
       ) AS allowed`,
      [
        actor.tenantId,
        actor.userId,
        ADMIN_CONSOLE_READ,
        ROLE_MANAGE,
        CONFIG_READ,
      ],
    );
    if (result.rows[0]?.allowed !== true) {
      throw new ForbiddenError(
        "Admin Console access or Role definition management authority is missing",
      );
    }
  }

  /**
   * The ROLE-DEFINITION delegation ceiling (§4.4 A, Wave 1): the permission
   * set of the ONE tenant-scoped assignment that carries both `role.manage`
   * and `config.read`. Authority from other assignments is never unioned in.
   *
   * `role.manage` is the right anchor here because rewriting a Role definition
   * IS the act being authorized, and `config.read` is the Wave 1 gate's own
   * second token. The assignment surfaces use
   * `assignmentDelegablePermissionCodes` instead — the two ceilings answer
   * different questions and must not be swapped.
   */
  private async roleDefinitionDelegablePermissionCodes(
    client: PoolClient,
    actor: { tenantId: string; userId: string },
  ): Promise<Set<string>> {
    const result = await client.query(
      `SELECT DISTINCT p.code
         FROM authorization_effective_user_role_assignments aura
         JOIN role_permissions rp ON rp.role_id = aura.role_id
         JOIN permissions p ON p.id = rp.permission_id
        WHERE aura.user_id = $2
          AND aura.tenant_id = $1
          AND aura.scope_type = 'tenant'
          AND aura.scope_organization_unit_id IS NULL
          AND aura.scope_customer_id IS NULL
          AND aura.role_id IN (
            SELECT m.role_id
              FROM authorization_effective_user_role_assignments m
              JOIN role_permissions mrp ON mrp.role_id = m.role_id
              JOIN permissions mp ON mp.id = mrp.permission_id
             WHERE m.user_id = $2
               AND m.tenant_id = $1
               AND m.scope_type = 'tenant'
               AND m.scope_organization_unit_id IS NULL
               AND m.scope_customer_id IS NULL
             GROUP BY m.role_id
            HAVING COUNT(DISTINCT CASE WHEN mp.code IN ($3, $4) THEN mp.code END) = 2
          )`,
      [actor.tenantId, actor.userId, ROLE_MANAGE, CONFIG_READ],
    );
    return new Set(result.rows.map((r: { code: string }) => r.code));
  }

  /**
   * The delegation ceiling for the ASSIGNMENT surfaces (§4.4 H step 4): the
   * permission set of the actor's own effective, non-Customer assignments that
   * carry `user.role.manage`.
   *
   * The anchor permission is the one that authorizes the act being attempted.
   * A Role-definition ceiling anchored on `role.manage` answers a different
   * question — "may the actor rewrite a Role?" — and is a different helper
   * below. Reusing that one here made the assignment surfaces simultaneously
   * stricter than the Role surfaces and inconsistent with the single-assignment
   * route, which had no ceiling at all (§4.4 D forbids that).
   *
   * The anchor is deliberately NOT restricted to tenant scope. §4.4 E enables
   * an Admin Tenant whose `user.role.manage` sits on an Organization Unit; a
   * tenant-only anchor leaves that actor with an empty ceiling and a picker
   * where no Role is selectable, while `resolveAdministrativeVisibilityIn`
   * still hands them a subtree to administer. What they grant is already
   * bounded by that visibility, so the ceiling only has to answer "may the
   * actor hand this permission out at all" — and the honest answer is the
   * actor's own permission set, never the global catalog (§4.4 A).
   *
   * Customer-scoped assignments contribute nothing: they confer no internal
   * authority anywhere else in this repository, and letting one act as an
   * anchor would let a Customer-facing grant enlarge an internal one.
   */
  private async assignmentDelegablePermissionCodes(
    client: PoolClient,
    actor: { tenantId: string; userId: string },
  ): Promise<Set<string>> {
    const result = await client.query(
      `SELECT DISTINCT p.code
         FROM authorization_effective_user_role_assignments aura
         JOIN role_permissions rp ON rp.role_id = aura.role_id
         JOIN permissions p ON p.id = rp.permission_id
        WHERE aura.user_id = $2
          AND aura.tenant_id = $1
          AND aura.scope_customer_id IS NULL
          AND aura.role_id IN (
            SELECT anchor_rp.role_id
              FROM role_permissions anchor_rp
              JOIN permissions anchor_p ON anchor_p.id = anchor_rp.permission_id
             WHERE anchor_p.code = $3
          )`,
      [actor.tenantId, actor.userId, USER_ROLE_MANAGE],
    );
    return new Set(result.rows.map((r: { code: string }) => r.code));
  }

  private async activeModuleCodes(
    client: PoolClient,
    tenantId: string,
  ): Promise<Set<string>> {
    const result = await client.query(
      `SELECT m.code
         FROM modules m
         JOIN tenant_module_activations tma ON tma.module_id = m.id AND tma.tenant_id = $1
        WHERE tma.is_active = true`,
      [tenantId],
    );
    return new Set(result.rows.map((r: { code: string }) => r.code));
  }

  private async registeredProcessCodes(
    client: PoolClient,
    tenantId: string,
  ): Promise<Set<string>> {
    const result = await client.query(
      `SELECT code FROM app_processes WHERE tenant_id = $1 AND is_active = true`,
      [tenantId],
    );
    return new Set(result.rows.map((r: { code: string }) => r.code));
  }

  /**
   * Validate a proposed permission set. A code that is ALREADY on the Role may
   * be preserved even if its module was since deactivated; a NEW grant must be
   * attributable, registered as an active Process, fall inside an active module
   * (platform exempt), and sit within the delegation ceiling.
   */
  private async validateProposedGrants(
    client: PoolClient,
    actor: { tenantId: string; userId: string },
    proposed: readonly string[],
    existing: Set<string>,
  ): Promise<string[]> {
    const codes = [...new Set(proposed)];
    if (codes.length !== proposed.length) {
      throw new ValidationError("Duplicate permission codes are not allowed");
    }
    const delegable = await this.roleDefinitionDelegablePermissionCodes(client, actor);
    const activeModules = await this.activeModuleCodes(client, actor.tenantId);
    const registered = await this.registeredProcessCodes(
      client,
      actor.tenantId,
    );

    const catalog = await client.query(
      `SELECT code FROM permissions WHERE code = ANY($1::text[])`,
      [codes],
    );
    const known = new Set(catalog.rows.map((r: { code: string }) => r.code));

    for (const code of codes) {
      if (!known.has(code))
        throw new ValidationError(`Unknown permission code '${code}'`);
      if (!delegable.has(code)) {
        throw new ValidationError(
          `Permission '${code}' is outside your delegation authority`,
        );
      }
      if (existing.has(code)) continue;
      const moduleCode = attributePermission(code);
      if (moduleCode === undefined) {
        throw new ValidationError(`Permission '${code}' has no owning module`);
      }
      if (!registered.has(code)) {
        throw new ValidationError(
          `Permission '${code}' is not a registered active process`,
        );
      }
      if (moduleCode !== "platform" && !activeModules.has(moduleCode)) {
        throw new ValidationError(
          `Module '${moduleCode}' is not active for this tenant`,
        );
      }
    }
    return codes.sort();
  }

  /** Same preservation rule as permissions, applied to window access rows. */
  private async validateProposedWindows(
    client: PoolClient,
    actor: { tenantId: string; userId: string },
    proposed: readonly WindowAccessInput[],
    existing: Set<string>,
  ): Promise<WindowAccessInput[]> {
    const codes = proposed.map((w) => w.windowCode);
    if (new Set(codes).size !== codes.length) {
      throw new ValidationError("Duplicate window codes are not allowed");
    }
    const delegable = await this.roleDefinitionDelegablePermissionCodes(client, actor);
    const activeModules = await this.activeModuleCodes(client, actor.tenantId);

    const rows = await client.query(
      `SELECT code, module_code, registration_status, required_permissions
         FROM app_windows
        WHERE tenant_id = $1 AND code = ANY($2::text[]) AND is_active = true`,
      [actor.tenantId, [...new Set([...codes, ...existing])]],
    );
    const byCode = new Map<
      string,
      {
        module_code: string;
        registration_status: string;
        required_permissions: string[];
      }
    >();
    for (const row of rows.rows) {
      byCode.set(row.code, {
        module_code: row.module_code,
        registration_status: row.registration_status,
        required_permissions: row.required_permissions ?? [],
      });
    }

    for (const window of proposed) {
      if (window.windowCode === WILDCARD_WINDOW_CODE) {
        throw new ValidationError(
          "The wildcard route is not a grantable window",
        );
      }
      if (existing.has(window.windowCode)) continue;
      const row = byCode.get(window.windowCode);
      if (!row)
        throw new ValidationError(
          `Unknown or inactive window '${window.windowCode}'`,
        );
      if (
        !REGISTERED_WINDOW_STATUSES.includes(
          row.registration_status as "di_menu" | "tersembunyi",
        )
      ) {
        throw new ValidationError(
          `Window '${window.windowCode}' is not registered`,
        );
      }
      if (
        row.module_code !== "platform" &&
        !activeModules.has(row.module_code)
      ) {
        throw new ValidationError(
          `Module '${row.module_code}' is not active for this tenant`,
        );
      }
      for (const required of row.required_permissions) {
        if (!delegable.has(required)) {
          throw new ValidationError(
            `Window '${window.windowCode}' needs permission '${required}' outside your delegation authority`,
          );
        }
      }
    }
    return [...proposed].sort((a, b) =>
      a.windowCode < b.windowCode ? -1 : a.windowCode > b.windowCode ? 1 : 0,
    );
  }

  private async writeRoleGrants(
    client: PoolClient,
    tenantId: string,
    roleId: string,
    permissionCodes: readonly string[],
    windows: readonly WindowAccessInput[],
  ): Promise<void> {
    if (permissionCodes.length > 0) {
      await client.query(
        `INSERT INTO role_permissions (role_id, permission_id)
         SELECT $1, p.id FROM permissions p WHERE p.code = ANY($2::text[])`,
        [roleId, [...permissionCodes]],
      );
    }
    for (const window of windows) {
      await client.query(
        `INSERT INTO role_window_access (tenant_id, role_id, window_code, is_read_write, is_active)
         VALUES ($1, $2, $3, $4, $5)`,
        [
          tenantId,
          roleId,
          window.windowCode,
          window.isReadWrite,
          window.isActive,
        ],
      );
    }
  }

  /** Every retained assignment ROW for a Role, invalidated and soft-deleted
   * user included. This is the delete guard's whole population: the FK from
   * `user_role_assignments` to `roles` is ON DELETE CASCADE, so any row left
   * out of the count is a row that would vanish silently with the Role. */
  private async countRetainedAssignments(
    client: PoolClient,
    tenantId: string,
    roleId: string,
  ): Promise<number> {
    const result = await client.query(
      `SELECT COUNT(*)::int AS count
         FROM user_role_assignments ura
         JOIN users u ON u.id = ura.user_id AND u.tenant_id = $1
        WHERE ura.role_id = $2`,
      [tenantId, roleId],
    );
    return result.rows[0].count as number;
  }

  private async countRoleAssignments(
    client: PoolClient,
    tenantId: string,
    roleId: string,
  ): Promise<number> {
    const result = await client.query(
      `SELECT COUNT(DISTINCT ura.user_id)::int AS count
         FROM user_role_assignments ura
         JOIN users u ON u.id = ura.user_id AND u.tenant_id = $1 AND u.deleted_at IS NULL
        WHERE ura.role_id = $2`,
      [tenantId, roleId],
    );
    return result.rows[0].count as number;
  }

  /**
   * How many active Users still hold Role definition authority once the Role
   * under edit ($2) carries the proposed permission set ($3).
   *
   * Authority is a SHAPE, not a label, and it is reproduced here exactly as
   * `requireTransactionRoleDefinitionAuthority` checks it: an effective
   * `admin.console.read` ticket ($4) plus ONE tenant-scoped assignment
   * carrying both `role.manage` and `config.read` ($5, $6). The Role being
   * edited is scored with the proposed grants, every other Role with its
   * stored rows, so the result is the post-commit reality rather than a
   * per-permission headcount — a Role left holding only half the tuple counts
   * as holding none of the authority. `$7` restricts the scan to one User.
   */
  private roleDefinitionAuthorityCountSql = `
    WITH role_grants(role_id, permission_id) AS (
      SELECT $2::uuid, p.id FROM permissions p WHERE p.code = ANY($3::text[])
      UNION ALL
      SELECT rp.role_id, rp.permission_id
        FROM role_permissions rp
       WHERE rp.role_id <> $2::uuid
    )
    SELECT COUNT(*)::int AS count
      FROM users u
     WHERE u.tenant_id = $1
       AND u.deleted_at IS NULL
       AND u.status = 'active'
       AND ($7::uuid IS NULL OR u.id = $7)
       AND EXISTS (
         SELECT 1
           FROM authorization_effective_user_role_assignments entry_aura
           JOIN role_grants entry_grants ON entry_grants.role_id = entry_aura.role_id
           JOIN permissions entry_p ON entry_p.id = entry_grants.permission_id
          WHERE entry_aura.user_id = u.id
            AND entry_aura.tenant_id = u.tenant_id
            AND entry_p.code = $4
       )
       AND EXISTS (
         SELECT 1
           FROM authorization_effective_user_role_assignments manager_aura
           JOIN role_grants manager_grants ON manager_grants.role_id = manager_aura.role_id
           JOIN permissions manager_p ON manager_p.id = manager_grants.permission_id
          WHERE manager_aura.user_id = u.id
            AND manager_aura.tenant_id = u.tenant_id
            AND manager_aura.scope_type = 'tenant'
            AND manager_aura.scope_organization_unit_id IS NULL
            AND manager_aura.scope_customer_id IS NULL
          GROUP BY manager_aura.id
         HAVING COUNT(DISTINCT CASE WHEN manager_p.code IN ($5, $6) THEN manager_p.code END) = 2
       )`;

  /**
   * §4.4 F — self-management and final-manager protection.
   *
   * The previous guard watched only the two manager labels, so it let the
   * actor remove `config.read` (or `admin.console.read`) from the very Role
   * they manage Roles with: every per-permission count still found a holder,
   * and the next request 403'd. The check below asks the only question that
   * matters — how many Users satisfy the whole shape after the commit.
   *
   * That single number carries both duties. This guard runs inside the same
   * transaction as `requireTransactionRoleDefinitionAuthority`, so the caller
   * provably satisfies the shape at entry. A post-change count of zero
   * therefore means the actor has just stripped their own authority AND that
   * the tenant is left with no Role definition manager; one or more means the
   * actor provably kept it. There is no third case, so there is no second
   * query. Adding a call site that skips the entry check would break that
   * reasoning, so it must come with the actor-scoped count instead.
   */
  private async protectTenantManagers(
    client: PoolClient,
    actor: { tenantId: string; userId: string },
    roleId: string,
    proposed: readonly string[],
  ): Promise<void> {
    const removed = await this.findRemovedAuthorityPermissions(
      client,
      roleId,
      proposed,
    );
    if (removed.length === 0) return;

    const remaining = await client.query(this.roleDefinitionAuthorityCountSql, [
      actor.tenantId,
      roleId,
      [...proposed],
      ADMIN_CONSOLE_READ,
      ROLE_MANAGE,
      CONFIG_READ,
      null,
    ]);
    if ((remaining.rows[0].count as number) > 0) return;

    throw new ConflictError(
      `Cannot remove ${removed.map((code) => `'${code}'`).join(", ")}: ` +
        "no active User would retain Role definition authority, which would " +
        "strip your own access to this screen as well",
    );
  }

  /** Which authority permissions the commit would remove from the Role. When
   * this is empty the post-change shape cannot differ from the stored one,
   * because nothing in the shape was touched. */
  private async findRemovedAuthorityPermissions(
    client: PoolClient,
    roleId: string,
    proposed: readonly string[],
  ): Promise<string[]> {
    const existing = await client.query(
      `SELECT p.code
         FROM role_permissions rp
         JOIN permissions p ON p.id = rp.permission_id
        WHERE rp.role_id = $1 AND p.code = ANY($2::text[])`,
      [roleId, [...ROLE_DEFINITION_AUTHORITY_PERMISSIONS]],
    );
    const proposedSet = new Set(proposed);
    return existing.rows
      .map((r: { code: string }) => r.code)
      .filter((code: string) => !proposedSet.has(code));
  }

  private async loadWindowOptions(
    client: PoolClient,
    tenantId: string,
    activeModules: Set<string>,
    delegable: Set<string>,
  ): Promise<WindowOption[]> {
    const result = await client.query(
      `SELECT code, name, module_code, registration_status, required_permissions, parent_path
         FROM app_windows
        WHERE tenant_id = $1 AND is_active = true
          AND code <> $2
        ORDER BY code`,
      [tenantId, WILDCARD_WINDOW_CODE],
    );
    const options: WindowOption[] = [];
    for (const row of result.rows) {
      if (
        !REGISTERED_WINDOW_STATUSES.includes(
          row.registration_status as "di_menu" | "tersembunyi",
        )
      ) {
        continue;
      }
      const required: string[] = row.required_permissions ?? [];
      const selectable =
        (row.module_code === "platform" ||
          activeModules.has(row.module_code)) &&
        required.every((code) => delegable.has(code));
      options.push({
        code: row.code,
        name: row.name,
        moduleCode: row.module_code,
        registrationStatus: row.registration_status,
        requiredPermissions: required,
        parentPath: row.parent_path ?? null,
        isDetail: isDetailWindow(row.code),
        selectable,
      });
    }
    return options;
  }

  private async recordRoleDefinitionAudit(
    client: PoolClient,
    input: {
      tenantId: string;
      actorUserId: string;
      roleCode: string;
      roleId: string;
      action:
        | "role.definition_created"
        | "role.definition_copied"
        | "role.definition_updated"
        | "role.definition_deleted";
      before: RoleDefinition | null;
      after: RoleDefinition | null;
      affectedUserCount?: number;
    },
  ): Promise<void> {
    const metadata = {
      roleCode: input.roleCode,
      before: input.before
        ? {
            name: input.before.name,
            permissionCodes: input.before.permissionCodes,
            windows: input.before.windows,
            version: input.before.version,
          }
        : null,
      after: input.after
        ? {
            name: input.after.name,
            permissionCodes: input.after.permissionCodes,
            windows: input.after.windows,
            version: input.after.version,
          }
        : null,
      ...(input.affectedUserCount === undefined
        ? {}
        : { affectedUserCount: input.affectedUserCount }),
    };
    await client.query(
      `INSERT INTO audit_log
         (tenant_id, actor_user_id, action, entity_type, entity_id, metadata)
       VALUES ($1, $2, $3, 'role', $4, $5::jsonb)`,
      [
        input.tenantId,
        input.actorUserId,
        input.action,
        input.roleId,
        JSON.stringify(metadata),
      ],
    );
  }

  private async inGovernedTransaction<T>(
    tenantId: string,
    operation: (client: PoolClient) => Promise<T>,
  ): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await this.lockTenant(client, tenantId);
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
      throw new ForbiddenError(
        "Admin Console access or tenant-scoped User access management authority is missing",
      );
    }
  }

  /**
   * Epic 4 Wave 2 rewire of the Phase 11F write gates (§4.4 D): the console
   * entry ticket alone, at ANY Data Scope. The tenant-scoped
   * `user.role.manage` requirement it used to bundle moved to
   * `requireAdministrativeVisibilityIn`, which accepts the narrower
   * Organization Unit authority and returns the visibility that governs which
   * targets the actor may reach — so a narrow actor is refused by target (404),
   * not by gate (403).
   */
  private async requireTransactionConsoleEntry(
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
       ) AS allowed`,
      [actor.tenantId, actor.userId, ADMIN_CONSOLE_READ],
    );
    if (result.rows[0]?.allowed !== true) {
      throw new ForbiddenError("Admin Console access is missing");
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

  async listUserIdsWithPermissionInTenant(
    tenantId: string,
    permissionCode: string,
  ): Promise<string[]> {
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

  /**
   * The one assignment writer outside the Admin Console (User creation with
   * an initial assignment, §4.4 C). It runs inside the SAME tenant lock the
   * governed paths take, because `user_role_assignments.role_id` is
   * ON DELETE CASCADE: without the lock, a Role delete can count zero
   * assignments, commit, and take a concurrently inserted assignment with it
   * — silently, with no audit.
   *
   * The role is re-resolved INSIDE the lock rather than trusted from the
   * caller's earlier lookup, so a Role deleted since that lookup is a clean
   * 404 here instead of a foreign-key error.
   */
  async assignRole(
    tenantId: string,
    input: AssignRoleInput,
    createdBy: string | null,
  ): Promise<UserRoleAssignment> {
    return this.inGovernedTransaction(tenantId, async (client) => {
      const roleResult = await client.query(
        `SELECT code FROM roles WHERE id = $1 AND tenant_id = $2`,
        [input.roleId, tenantId],
      );
      if (!roleResult.rows[0]) throw new NotFoundError("Role", input.roleId);

      const result = await client.query(
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
      const row = result.rows[0];
      return {
        id: row.id,
        userId: row.user_id,
        roleId: row.role_id,
        roleCode: roleResult.rows[0].code as string,
        scopeType: row.scope_type,
        scopeOrganizationUnitId: row.scope_organization_unit_id,
        scopeCustomerId: row.scope_customer_id,
      };
    });
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
