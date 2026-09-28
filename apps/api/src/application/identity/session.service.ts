import type { Pool } from "pg";
import type { ActorContext } from "../../domain/shared-kernel/audit-context.js";
import { ForbiddenError } from "../../domain/shared-kernel/errors.js";
import {
  inGovernedTransaction,
  recordGovernedAudit,
} from "../../infrastructure/persistence/repositories/governed-transaction.js";

/**
 * Epic 1 (§4.1 B) — the server-side security context. The `sessions` row is
 * the single source of truth for the active Role; the JWT only carries
 * `sessionId`, and the auth plugin resolves the context here on every request.
 *
 * Free functions taking a `Pool`, not a service class, for the same reason
 * `refresh-token.ts` is: the auth plugin resolves the actor from a module-level
 * pool before any container exists, and the HTTP layer must not construct a
 * second access path to the same table.
 *
 * There is deliberately no "ensure a session exists" fallback: a token whose
 * session row is gone is a 401 at the auth plugin, never a freshly created
 * session.
 */

const ASSIGNMENT_COLUMNS = `
  aura.id AS assignment_id,
  aura.role_id,
  r.code AS role_code,
  aura.scope_type,
  aura.scope_organization_unit_id,
  aura.scope_customer_id
`;

/** Every read of an assignment resolves the active Role's code with it, so
 * authorization never has to re-query what authentication already knew. */
const ASSIGNMENT_JOIN = `
  LEFT JOIN authorization_effective_user_role_assignments aura
    ON aura.id = s.active_assignment_id
  LEFT JOIN roles r ON r.id = aura.role_id
`;

/**
 * Creates the session row for one password-verified login and pins its
 * default active assignment.
 *
 * The default pick follows the same order the post-login picker uses
 * (`ORDER BY r.name, aura.id`), so repeated logins land in the same context
 * instead of drifting between assignments.
 *
 * `active_assignment_id` may legitimately end up NULL — a user holding no
 * effective assignment can still log in and reach `/me`, which is where they
 * learn why nothing is available. They stay authenticated but every
 * permissioned route fails closed with 403.
 */
export async function createSession(
  pool: Pool,
  input: {
    userId: string;
    tenantId: string;
    remoteAddr?: string;
    webSession?: string;
  },
): Promise<string> {
  const result = await pool.query<{ id: string }>(
    `WITH default_assignment AS (
       SELECT aura.id, aura.role_id, aura.scope_organization_unit_id
         FROM authorization_effective_user_role_assignments aura
         JOIN roles r ON r.id = aura.role_id
        WHERE aura.user_id = $1
          AND aura.tenant_id = $2
        ORDER BY r.name, aura.id
        LIMIT 1
     )
     INSERT INTO sessions (user_id, tenant_id, remote_addr, web_session,
                           active_assignment_id, active_role_id, organization_unit_id)
     SELECT $1, $2, $3, $4, d.id, d.role_id, d.scope_organization_unit_id
       FROM (SELECT 1) AS one
       LEFT JOIN default_assignment d ON true
     RETURNING id`,
    [input.userId, input.tenantId, input.remoteAddr ?? null, input.webSession ?? null],
  );
  return result.rows[0].id;
}

/**
 * Resolves the actor context for one request. Returns null whenever the
 * caller must be rejected with 401 — unknown session, revoked session, or a
 * session/user/tenant mismatch.
 *
 * An assignment that is no longer effective (revoked by Epic 4, Role
 * deactivated) resolves to `assignmentId: null` instead. That is a 403 at
 * permissioned routes, not a 401 that would hide the cause behind an
 * "invalid token" the user cannot act on.
 */
export async function resolveActor(
  pool: Pool,
  input: { sessionId: string; userId: string; tenantId: string },
): Promise<ActorContext | null> {
  const result = await pool.query<{
    user_id: string;
    tenant_id: string;
    user_tenant_id: string;
    status: string;
    revoked_at: Date | null;
    assignment_id: string | null;
    role_id: string | null;
    role_code: string | null;
    scope_type: "tenant" | "organization_unit" | "customer" | null;
    scope_organization_unit_id: string | null;
    scope_customer_id: string | null;
  }>(
    `SELECT s.user_id, s.tenant_id, u.tenant_id AS user_tenant_id, u.status, s.revoked_at, ${ASSIGNMENT_COLUMNS}
       FROM sessions s
       JOIN users u ON u.id = s.user_id AND u.deleted_at IS NULL
       ${ASSIGNMENT_JOIN}
      WHERE s.id = $1`,
    [input.sessionId],
  );
  const row = result.rows[0];
  if (
    !row ||
    row.revoked_at !== null ||
    row.user_id !== input.userId ||
    // The session's own tenant is the address the token was minted for; the
    // USER's tenant is the one every downstream check reads (RBAC, data
    // scope, audit). A user moved to another tenant (Phase 11F) must lose
    // the old token even though the session row still names the old tenant,
    // so both are compared against the token claim.
    row.tenant_id !== input.tenantId ||
    row.user_tenant_id !== input.tenantId ||
    row.status !== "active"
  ) {
    return null;
  }
  return {
    userId: row.user_id,
    tenantId: row.tenant_id,
    sessionId: input.sessionId,
    assignmentId: row.assignment_id,
    roleId: row.role_id,
    roleCode: row.role_code,
    scopeType: row.scope_type,
    scopeOrganizationUnitId: row.scope_organization_unit_id,
    scopeCustomerId: row.scope_customer_id,
  };
}

/**
 * Refresh-time liveness check. Unlike `resolveActor` this does not join the
 * effective view: an assignment that became ineffective must not kill the
 * refresh — the next permissioned request fails closed instead, and the user
 * can still switch to an assignment they do hold. Only a revoked session or
 * an unavailable user denies refresh.
 */
export async function sessionForRefresh(
  pool: Pool,
  input: { sessionId: string; userId: string },
): Promise<string | null> {
  const result = await pool.query<{
    id: string;
    user_id: string;
    revoked_at: Date | null;
  }>(
    `SELECT s.id, s.user_id, s.revoked_at
       FROM sessions s
       JOIN users u ON u.id = s.user_id AND u.deleted_at IS NULL
      WHERE s.id = $1 AND u.status = 'active'`,
    [input.sessionId],
  );
  const row = result.rows[0];
  if (!row || row.revoked_at !== null || row.user_id !== input.userId) return null;
  return row.id;
}

/** Refreshes `last_seen_at` for a request that already resolved its session.
 * Fire-and-forget on the caller's side: a lost timestamp update is not worth
 * failing a request over. */
export async function touchSession(pool: Pool, sessionId: string): Promise<void> {
  await pool.query(`UPDATE sessions SET last_seen_at = now() WHERE id = $1`, [sessionId]);
}

/**
 * Epic 1 (§4.1 E) — switch the active Role without re-login.
 *
 * One statement answers "is this assignment mine and currently effective" and
 * performs the write, so a concurrent revocation cannot slip between the check
 * and the update. A foreign, revoked or inactive-Scope assignment matches no
 * row and raises the same `ForbiddenError`, so the caller cannot probe for
 * assignments they do not hold.
 *
 * The switch and its audit row share one governed transaction: an audit entry
 * that survived a rolled-back switch, or a switch with no audit entry, would
 * both corrupt the separation-of-duties record.
 */
export async function switchSessionRole(
  pool: Pool,
  input: {
    sessionId: string;
    userId: string;
    tenantId: string;
    assignmentId: string;
  },
): Promise<ActorContext> {
  return inGovernedTransaction(pool, input.tenantId, async (client) => {
    const target = await client.query<{
      assignment_id: string;
      role_id: string;
      role_code: string;
      scope_type: "tenant" | "organization_unit" | "customer";
      scope_organization_unit_id: string | null;
      scope_customer_id: string | null;
    }>(
      `SELECT ${ASSIGNMENT_COLUMNS}
         FROM authorization_effective_user_role_assignments aura
         JOIN roles r ON r.id = aura.role_id
        WHERE aura.id = $1
          AND aura.user_id = $2
          AND aura.tenant_id = $3`,
      [input.assignmentId, input.userId, input.tenantId],
    );
    const assignment = target.rows[0];
    if (!assignment) {
      throw new ForbiddenError("Assignment is not available in this session");
    }

    const previous = await client.query<{
      active_assignment_id: string | null;
      active_role_id: string | null;
    }>(
      `SELECT active_assignment_id, active_role_id
         FROM sessions
        WHERE id = $1
          AND user_id = $2
          AND tenant_id = $3
          AND revoked_at IS NULL
        FOR UPDATE`,
      [input.sessionId, input.userId, input.tenantId],
    );
    const before = previous.rows[0];
    if (!before) {
      throw new ForbiddenError("Assignment is not available in this session");
    }

    await client.query(
      `UPDATE sessions
          SET active_assignment_id = $2,
              active_role_id = $3,
              organization_unit_id = $4,
              last_seen_at = now()
        WHERE id = $1`,
      [
        input.sessionId,
        assignment.assignment_id,
        assignment.role_id,
        assignment.scope_organization_unit_id,
      ],
    );

    await recordGovernedAudit(client, {
      tenantId: input.tenantId,
      actorUserId: input.userId,
      action: "session.role.switched",
      entityType: "session",
      entityId: input.sessionId,
      metadata: {
        previousRoleId: before.active_role_id,
        roleId: assignment.role_id,
        previousAssignmentId: before.active_assignment_id,
        assignmentId: assignment.assignment_id,
      },
    });

    return {
      userId: input.userId,
      tenantId: input.tenantId,
      sessionId: input.sessionId,
      assignmentId: assignment.assignment_id,
      roleId: assignment.role_id,
      roleCode: assignment.role_code,
      scopeType: assignment.scope_type,
      scopeOrganizationUnitId: assignment.scope_organization_unit_id,
      scopeCustomerId: assignment.scope_customer_id,
    };
  });
}

/** Logout revokes the session alongside the refresh token, so a session that
 * outlived its token cannot be revived by a leftover token pair. Idempotent:
 * revoking an already-revoked session is not an error. */
export async function revokeSession(pool: Pool, sessionId: string): Promise<void> {
  await pool.query(
    `UPDATE sessions SET revoked_at = now(), processed = true
      WHERE id = $1 AND revoked_at IS NULL`,
    [sessionId],
  );
}
