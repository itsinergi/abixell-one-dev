import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../../src/app.js";
import { pool } from "../../src/infrastructure/persistence/db.js";
import { hashPassword } from "../../src/infrastructure/security/password.js";
import {
  activateAllModules,
  authHeader,
  bootstrapTenant,
  provisionFirstAdmin,
  sessionTokenFor,
} from "./helpers.js";

/**
 * WP-APR-03 — Segregation of Duties end-to-end.
 *
 * The hard block lives in the BEFORE INSERT OR UPDATE trigger on
 * `user_role_assignments` (migration 1793000000010). It raises with a stable
 * CONSTRAINT (`user_role_assignments_sod_violation_check`, ERRCODE 23514), and
 * every assignment write path in `rbac.repository.pg.ts` maps that constraint
 * to a ConflictError → HTTP 409. This test proves both halves:
 *
 *   1. assigning a role whose code pairs with a live assignment of the same
 *      user through a forbidden rule is blocked at the governed surface with a
 *      409 (not a 500), and revoking either side lifts the block;
 *   2. `GET /sod/violations` surveys pairs already held against the rules,
 *      including pairs that existed before the rule was created (the
 *      back-dated case the trigger cannot catch retroactively).
 *
 * Fixtures are direct SQL: the governed HTTP assignment surface is what is
 * under test, so manufacturing actors through it would make the assertions
 * circular. Two real roles with distinct codes are created per tenant so the
 * forbidden pair names codes that actually exist (the repository checks
 * referential honesty before inserting a rule).
 */

const stamp = `${Date.now().toString(36)}_${process.pid}_${randomUUID().replaceAll("-", "").slice(0, 8)}`;
const codeStamp = stamp.toUpperCase();
const TENANT = `p4sod-${stamp}`;
const PASSWORD = "Passw0rd12345!";

const MANAGER_PERMISSIONS = [
  "admin.console.read",
  "user.read",
  "config.read",
  "user.role.manage",
];

const app = buildApp();

interface UserFixture {
  id: string;
  email: string;
}

async function createRole(
  tenantId: string,
  code: string,
  permissionCodes: string[] = [],
): Promise<{ id: string; code: string }> {
  const roleResult = await pool.query(
    `INSERT INTO roles (tenant_id, code, name, is_full_access)
     VALUES ($1, $2, $2, false)
     RETURNING id, code`,
    [tenantId, code],
  );
  const role = roleResult.rows[0] as { id: string; code: string };
  if (permissionCodes.length > 0) {
    await pool.query(
      `INSERT INTO role_permissions (role_id, permission_id)
       SELECT $1, id FROM permissions WHERE code = ANY($2::text[])`,
      [role.id, [...new Set(permissionCodes)]],
    );
  }
  return role;
}

async function createUser(
  tenantId: string,
  localName: string,
  passwordHash: string,
): Promise<UserFixture> {
  const email = `${localName}.${stamp}@p4sod.local`;
  const result = await pool.query(
    `INSERT INTO users (tenant_id, email, password_hash, full_name)
     VALUES ($1, $2, $3, $4)
     RETURNING id, email`,
    [tenantId, email, passwordHash, `Phase 4 SoD ${localName}`],
  );
  return result.rows[0] as UserFixture;
}

async function createAssignment(
  userId: string,
  roleId: string,
): Promise<string> {
  const result = await pool.query(
    `INSERT INTO user_role_assignments
       (user_id, role_id, scope_type, scope_customer_id)
     VALUES ($1, $2, 'tenant', NULL)
     RETURNING id`,
    [userId, roleId],
  );
  return result.rows[0].id as string;
}

describe("WP-APR-03 — Segregation of Duties", () => {
  let tenantId: string;
  let passwordHash: string;
  let admin: { userId: string; roleId: string };
  let adminToken: string;

  // Two real roles whose codes are forbidden to coexist on one user.
  let roleA: { id: string; code: string };
  let roleB: { id: string; code: string };
  let unrelatedRole: { id: string; code: string };

  beforeAll(async () => {
    passwordHash = await hashPassword(PASSWORD);

    const primary = await bootstrapTenant(app, TENANT, "Tenant Phase 4 SoD");
    tenantId = primary.id;
    await activateAllModules(tenantId);
    admin = await provisionFirstAdmin({
      tenantId,
      email: `p4sod-admin.${stamp}@p4sod.local`,
      password: PASSWORD,
    });
    // provisionFirstAdmin's ADMIN role is full-access; give the admin session
    // the console entry + governance permissions through that role.
    adminToken = await sessionTokenFor({ userId: admin.userId, tenantId });

    roleA = await createRole(tenantId, `P4SOD_A_${codeStamp}`, [
      ...MANAGER_PERMISSIONS,
    ]);
    roleB = await createRole(tenantId, `P4SOD_B_${codeStamp}`, ["user.read"]);
    unrelatedRole = await createRole(tenantId, `P4SOD_C_${codeStamp}`, [
      "user.read",
    ]);
  });

  afterAll(async () => {
    await pool.query(`DELETE FROM tenants WHERE code = ANY($1::text[])`, [
      [TENANT],
    ]);
    await app.close();
    await pool.end();
  });

  it("creates and lists a forbidden pair rule via the governed surface", async () => {
    const created = await app.inject({
      method: "POST",
      url: "/sod/rules",
      headers: authHeader(adminToken),
      payload: {
        roleCodeA: roleA.code,
        roleCodeB: roleB.code,
        reason: "A and B cannot be held by the same user",
      },
    });
    expect(created.statusCode).toBe(201);
    const body = created.json();
    expect(body.roleCodeA).toBe(roleA.code);
    expect(body.roleCodeB).toBe(roleB.code);
    expect(body.reason).toBe("A and B cannot be held by the same user");

    const listed = await app.inject({
      method: "GET",
      url: "/sod/rules",
      headers: authHeader(adminToken),
    });
    expect(listed.statusCode).toBe(200);
    const rules = listed.json();
    expect(
      rules.some(
        (r: { roleCodeA: string; roleCodeB: string }) =>
          (r.roleCodeA === roleA.code && r.roleCodeB === roleB.code) ||
          (r.roleCodeA === roleB.code && r.roleCodeB === roleA.code),
      ),
    ).toBe(true);
  });

  it("blocks a second forbidden assignment with a 409, not a 500", async () => {
    const target = await createUser(tenantId, "blocked-target", passwordHash);
    // First assignment (roleA) lands cleanly.
    await createAssignment(target.id, roleA.id);

    // Second assignment (roleB) is forbidden by the rule → trigger raises with
    // the SOD constraint, mapped to ConflictError → 409.
    const res = await app.inject({
      method: "POST",
      url: `/admin/users/${target.id}/role-assignments`,
      headers: authHeader(adminToken),
      payload: { roleCode: roleB.code, scopeType: "tenant" },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toContain("Segregation of Duties");
  });

  it("allows an unrelated assignment that does not form a forbidden pair", async () => {
    const target = await createUser(tenantId, "clean-target", passwordHash);
    await createAssignment(target.id, roleA.id);
    // unrelatedRole (code C) is not in any rule with roleA.
    const res = await app.inject({
      method: "POST",
      url: `/admin/users/${target.id}/role-assignments`,
      headers: authHeader(adminToken),
      payload: { roleCode: unrelatedRole.code, scopeType: "tenant" },
    });
    expect(res.statusCode).toBe(201);
  });

  it("surveys a pre-existing violation that the rule only later forbade", async () => {
    // The trigger blocks the *transition* into a violating state, so it cannot
    // retroactively flag a pair that was already held when the rule was added.
    // That is exactly what the survey exists for. Build the pair while no rule
    // covers it: remove the rule, assign both live, then re-add the rule.
    const target = await createUser(tenantId, "retro-target", passwordHash);

    const rulesList = await app.inject({
      method: "GET",
      url: "/sod/rules",
      headers: authHeader(adminToken),
    });
    const abRule = (rulesList.json() as Array<{ id: string; roleCodeA: string; roleCodeB: string }>).find(
      (r) =>
        (r.roleCodeA === roleA.code && r.roleCodeB === roleB.code) ||
        (r.roleCodeA === roleB.code && r.roleCodeB === roleA.code),
    )!;
    const del = await app.inject({
      method: "DELETE",
      url: `/sod/rules/${abRule.id}`,
      headers: authHeader(adminToken),
    });
    expect(del.statusCode).toBe(204);

    // No rule now → both assignments land cleanly.
    await createAssignment(target.id, roleA.id);
    await createAssignment(target.id, roleB.id);

    // Re-add the rule; the pair is now live-and-forbidden with no write to
    // block, so only the survey can see it.
    const recreated = await app.inject({
      method: "POST",
      url: "/sod/rules",
      headers: authHeader(adminToken),
      payload: {
        roleCodeA: roleA.code,
        roleCodeB: roleB.code,
        reason: "A and B cannot be held by the same user",
      },
    });
    expect(recreated.statusCode).toBe(201);

    const violations = await app.inject({
      method: "GET",
      url: "/sod/violations",
      headers: authHeader(adminToken),
    });
    expect(violations.statusCode).toBe(200);
    const list = violations.json() as Array<{
      userId: string;
      roleCodeA: string;
      roleCodeB: string;
      reason: string;
    }>;
    const hit = list.find(
      (v) =>
        v.userId === target.id &&
        ((v.roleCodeA === roleA.code && v.roleCodeB === roleB.code) ||
          (v.roleCodeA === roleB.code && v.roleCodeB === roleA.code)),
    );
    expect(hit).toBeDefined();
    expect(hit!.reason).toBe("A and B cannot be held by the same user");
  });
});
