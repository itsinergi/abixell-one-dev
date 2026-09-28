import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../../src/app.js";
import { pool } from "../../src/infrastructure/persistence/db.js";
import { signAccessToken } from "../../src/infrastructure/security/jwt.js";
import { authHeader, bootstrapTenant, login } from "./helpers.js";

/**
 * Epic 1 (§4.1 B/C/F) — the session/RBAC half of the Security Context.
 *
 * The ACTIVE Role is server-side session state, resolved on every request
 * from the session row — never from the token and never from a query
 * parameter. These cases pin the cutover behaviour end to end:
 *
 *  1. a single-Role user is unchanged: login already writes the assignment,
 *     `/me` reports it, and permissioned routes answer as before;
 *  2. the permission set is THE ACTIVE ROLE'S ONLY — while role A is
 *     active, role B's permissions answer 403 even though the user holds
 *     both assignments;
 *  3. switching is a session write that keeps the SAME token (no re-login)
 *     and records a `session.role.switched` audit row;
 *  4. a token minted before sessions existed (no `sessionId` claim) is
 *     refused — hard cutover, no transition window (§4.1 F).
 *
 * The approval-authority half (cases 5–11) lives in
 * approval-authority-unit.test.ts plus the accumulation SQL exercised by
 * the full regression suite.
 */

const STAMP = Date.now();
const TENANT = `test-epic1-${STAMP}`;
const PASSWORD = "EpicOnePass123!";

describe("Epic 1 security context (§4.1)", () => {
  const app = buildApp();
  let tenantId: string;
  let userId: string;
  let roleAId: string;
  let roleBId: string;
  let assignmentAId: string;
  let assignmentBId: string;

  async function addRole(code: string, permissionCodes: string[]): Promise<string> {
    const role = await pool.query(
      `INSERT INTO roles (tenant_id, code, name) VALUES ($1, $2, $2) RETURNING id`,
      [tenantId, code],
    );
    const roleId = role.rows[0].id as string;
    await pool.query(
      `INSERT INTO role_permissions (role_id, permission_id)
       SELECT $1, id FROM permissions WHERE code = ANY($2)`,
      [roleId, permissionCodes],
    );
    return roleId;
  }

  async function addAssignment(roleId: string): Promise<string> {
    const result = await pool.query(
      `INSERT INTO user_role_assignments (user_id, role_id, scope_type)
       VALUES ($1, $2, 'tenant') RETURNING id`,
      [userId, roleId],
    );
    return result.rows[0].id as string;
  }

  beforeAll(async () => {
    const tenant = await bootstrapTenant(app, TENANT, "Epic 1 Tenant");
    tenantId = tenant.id;

    // Role A can read tenants; role B can read the audit log. Disjoint
    // permission sets, both tenant-wide, so the only variable in every
    // case below is WHICH role the session holds active.
    roleAId = await addRole("EPIC1_ROLE_A", ["tenant.read"]);
    roleBId = await addRole("EPIC1_ROLE_B", ["audit_log.read"]);

    const bcrypt = await import("bcryptjs");
    const hash = await bcrypt.hash(PASSWORD, 10);
    const user = await pool.query(
      `INSERT INTO users (tenant_id, email, password_hash, full_name)
       VALUES ($1, $2, $3, 'Epic 1 User') RETURNING id`,
      [tenantId, `epic1@${STAMP}.local`, hash],
    );
    userId = user.rows[0].id as string;

    assignmentAId = await addAssignment(roleAId);
    assignmentBId = await addAssignment(roleBId);
  });

  afterAll(async () => {
    // Cascade removes users, roles, assignments, sessions, and audit rows.
    await pool.query(`DELETE FROM tenants WHERE id = $1`, [tenantId]);
    await app.close();
  });

  /** Login, then read the ACTIVE assignment back from `/me` — the login
   * response issues the session; only `/me` names which assignment it
   * activated. The `me` body is returned for the caller's assertions. */
  async function loginAndReadMe() {
    const result = await login(app, TENANT, `epic1@${STAMP}.local`, PASSWORD);
    expect(result.statusCode).toBe(200);
    const me = await app.inject({
      method: "GET",
      url: "/me",
      headers: authHeader(result.body.accessToken),
    });
    expect(me.statusCode).toBe(200);
    return { token: result.body.accessToken as string, sessionId: result.body.sessionId as string, me: me.json() };
  }

  it("case 1: single-Role user is unchanged — login already wrote the assignment", async () => {
    const { token, sessionId, me } = await loginAndReadMe();
    expect(me.sessionId).toBe(sessionId);
    expect(me.assignments).toHaveLength(2);
    // The active assignment is one of the two, decided server-side.
    expect([assignmentAId, assignmentBId]).toContain(me.activeAssignmentId);
    expect(token).toBeTruthy();
  });

  it("case 2: while role A is active, role B's permissions answer 403", async () => {
    const { token, me } = await loginAndReadMe();

    // Land deterministically on role A before asserting anything.
    if (me.activeAssignmentId !== assignmentAId) {
      await app.inject({
        method: "POST",
        url: "/auth/switch-role",
        headers: authHeader(token),
        payload: { assignmentId: assignmentAId },
      });
    }

    // Role A's own permission still answers 200.
    const own = await app.inject({
      method: "GET",
      url: "/tenants/me",
      headers: authHeader(token),
    });
    expect(own.statusCode).toBe(200);

    // Role B's permission is refused even though the user holds it too.
    const foreign = await app.inject({
      method: "GET",
      url: "/audit-log/recent",
      headers: authHeader(token),
    });
    expect(foreign.statusCode).toBe(403);
  });

  it("case 3: switch keeps the same token and writes an audit row", async () => {
    const { token, sessionId, me } = await loginAndReadMe();
    const before = me.activeAssignmentId as string;
    const target = before === assignmentAId ? assignmentBId : assignmentAId;

    const switched = await app.inject({
      method: "POST",
      url: "/auth/switch-role",
      headers: authHeader(token),
      payload: { assignmentId: target },
    });
    expect(switched.statusCode).toBe(200);
    expect(switched.json().activeAssignmentId).toBe(target);

    // The SAME token now carries role B's permission — no re-login, and
    // the previously-403 route answers 200.
    const nowAllowed = await app.inject({
      method: "GET",
      url: "/audit-log/recent",
      headers: authHeader(token),
    });
    expect(nowAllowed.statusCode).toBe(200);

    // The session row itself moved — that is the whole point of Epic 1.
    const sessionRow = await pool.query(
      `SELECT active_assignment_id FROM sessions WHERE id = $1`,
      [sessionId],
    );
    expect(sessionRow.rows[0].active_assignment_id).toBe(target);

    // One governed audit row records the switch with both ends.
    const audit = await pool.query(
      `SELECT metadata FROM audit_log
        WHERE tenant_id = $1 AND entity_type = 'session' AND entity_id = $2
          AND action = 'session.role.switched'`,
      [tenantId, sessionId],
    );
    expect(audit.rows).toHaveLength(1);
    expect(audit.rows[0].metadata).toMatchObject({
      previousAssignmentId: before,
      assignmentId: target,
    });
  });

  it("case 4: a token without a sessionId claim is refused (hard cutover, §4.1 F)", async () => {
    // Minted the pre-Epic-1 way: sub + tenantId only. A valid signature
    // is not enough anymore — the session must exist and be resolvable.
    const legacyToken = signAccessToken({
      sub: userId,
      tenantId,
    } as unknown as Parameters<typeof signAccessToken>[0]);

    const me = await app.inject({
      method: "GET",
      url: "/me",
      headers: authHeader(legacyToken),
    });
    expect(me.statusCode).toBe(401);
    expect(me.json().error).toBe("Invalid or expired access token");
  });
});
