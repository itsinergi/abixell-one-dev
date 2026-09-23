import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../../src/app.js";
import { pool } from "../../src/infrastructure/persistence/db.js";
import { hashPassword } from "../../src/infrastructure/security/password.js";
import { authHeader, bootstrapTenant, login, provisionFirstAdmin } from "./helpers.js";

/**
 * Email-only login + post-login role/site selection.
 *
 * Covers the three behaviours the login redesign turns on:
 *  - tenant-agnostic login resolves the tenant from the email when it is
 *    unambiguous, and returns the tenant name for the client to display;
 *  - when the SAME email exists in several tenants, no token is issued and
 *    the verified tenant list comes back instead — and only after the
 *    password verifies, so it never becomes an enumeration oracle;
 *  - `/me` exposes the caller's own assignments (with scope names) and can
 *    narrow the reported capability set to one chosen context.
 *
 * `tenantCode` stays required exactly as before for every pre-existing
 * caller, so the backward-compatibility test comes first.
 */

const STAMP = Date.now();
const TENANT_A = `test-lws-a-${STAMP}`;
const TENANT_B = `test-lws-b-${STAMP}`;
const SHARED_EMAIL = `shared@lws-${STAMP}.local`;
const SOLE_EMAIL = `sole@lws-${STAMP}.local`;
const PASSWORD = "SharedPass123!";

describe("Login workspace selection", () => {
  const app = buildApp();
  let tenantAId: string;
  let tenantBId: string;

  async function addUser(tenantId: string, email: string, password: string): Promise<string> {
    const hash = await hashPassword(password);
    const result = await pool.query(
      `INSERT INTO users (tenant_id, email, password_hash, full_name)
       VALUES ($1, $2, $3, 'LWS User') RETURNING id`,
      [tenantId, email, hash],
    );
    return result.rows[0].id as string;
  }

  beforeAll(async () => {
    const a = await bootstrapTenant(app, TENANT_A, "LWS Tenant A");
    const b = await bootstrapTenant(app, TENANT_B, "LWS Tenant B");
    tenantAId = a.id;
    tenantBId = b.id;

    // Same address in both tenants — this is the legitimate multi-tenant case.
    const userA = await addUser(tenantAId, SHARED_EMAIL, PASSWORD);
    const userB = await addUser(tenantBId, SHARED_EMAIL, PASSWORD);
    await addUser(tenantAId, SOLE_EMAIL, PASSWORD);

    // Give the tenant-A user a second assignment (an OU-scoped role) so the
    // selection screen has two role+scope pairs to distinguish.
    const leResult = await pool.query(
      `INSERT INTO legal_entities (tenant_id, name) VALUES ($1, 'LWS Legal Entity') RETURNING id`,
      [tenantAId],
    );
    const ouResult = await pool.query(
      `INSERT INTO organization_units (tenant_id, legal_entity_id, name, unit_type)
       VALUES ($1, $2, 'Site LWS', 'Site') RETURNING id`,
      [tenantAId, leResult.rows[0].id],
    );
    const orgUnitId = ouResult.rows[0].id as string;
    const roleResult = await pool.query(
      `INSERT INTO roles (tenant_id, code, name) VALUES ($1, 'SITE_ROLE', 'Site Role') RETURNING id`,
      [tenantAId],
    );
    const roleId = roleResult.rows[0].id as string;
    await pool.query(
      `INSERT INTO role_permissions (role_id, permission_id)
       SELECT $1, id FROM permissions WHERE code = ANY($2)`,
      [roleId, ["organization_unit.read"]],
    );
    await pool.query(
      `INSERT INTO user_role_assignments (user_id, role_id, scope_type, scope_organization_unit_id)
       VALUES ($1, $2, 'organization_unit', $3)`,
      [userA, roleId, orgUnitId],
    );
    // A plain tenant-wide baseline role so the user is never assignment-less.
    const baseRole = await pool.query(
      `INSERT INTO roles (tenant_id, code, name) VALUES ($1, 'BASE_ROLE', 'Base Role') RETURNING id`,
      [tenantAId],
    );
    await pool.query(
      `INSERT INTO role_permissions (role_id, permission_id)
       SELECT $1, id FROM permissions WHERE code = ANY($2)`,
      [baseRole.rows[0].id, ["tenant.read"]],
    );
    await pool.query(
      `INSERT INTO user_role_assignments (user_id, role_id, scope_type)
       VALUES ($1, $2, 'tenant')`,
      [userA, baseRole.rows[0].id],
    );
  });

  afterAll(async () => {
    // Cascade removes users, roles, assignments, and audit rows.
    await pool.query(`DELETE FROM tenants WHERE id = ANY($1)`, [[tenantAId, tenantBId]]);
    await app.close();
  });

  it("still authenticates the legacy tenantCode + email + password shape", async () => {
    const result = await login(app, TENANT_A, SOLE_EMAIL, PASSWORD);
    expect(result.statusCode).toBe(200);
    expect(result.body.status).toBe("authenticated");
    expect(result.body.accessToken).toBeTruthy();
    expect(result.body.tenantCode).toBe(TENANT_A);
  });

  it("resolves the tenant from the email alone when it is unambiguous", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/auth/login",
      payload: { email: SOLE_EMAIL, password: PASSWORD },
    });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.status).toBe("authenticated");
    expect(body.tenantCode).toBe(TENANT_A);
    expect(body.tenantName).toBe("LWS Tenant A");
  });

  it("returns the verified tenant list (no token) when the email spans tenants", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/auth/login",
      payload: { email: SHARED_EMAIL, password: PASSWORD },
    });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.status).toBe("tenant_selection_required");
    expect(body.accessToken).toBeUndefined();
    expect(body.tenants).toHaveLength(2);
    expect(body.tenants.map((t: { tenantCode: string }) => t.tenantCode).sort()).toEqual(
      [TENANT_A, TENANT_B].sort(),
    );
  });

  it("never reveals the tenant list to a wrong password", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/auth/login",
      payload: { email: SHARED_EMAIL, password: "not-the-password" },
    });
    expect(response.statusCode).toBe(401);
    expect(response.json().error).toBe("Invalid tenant, email, or password");
  });

  it("authenticates once the chosen tenantId is supplied", async () => {
    const first = await app.inject({
      method: "POST",
      url: "/auth/login",
      payload: { email: SHARED_EMAIL, password: PASSWORD },
    });
    const chosen = first.json().tenants.find(
      (t: { tenantCode: string }) => t.tenantCode === TENANT_B,
    );
    const second = await app.inject({
      method: "POST",
      url: "/auth/login",
      payload: { email: SHARED_EMAIL, password: PASSWORD, tenantId: chosen.tenantId },
    });
    expect(second.statusCode).toBe(200);
    expect(second.json().status).toBe("authenticated");
    expect(second.json().tenantId).toBe(tenantBId);
  });

  it("denies a tenantId the caller does not belong to", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/auth/login",
      payload: { email: SOLE_EMAIL, password: PASSWORD, tenantId: tenantBId },
    });
    expect(response.statusCode).toBe(401);
    expect(response.json().error).toBe("Invalid tenant, email, or password");
  });

  it("exposes the caller's own assignments with scope names on /me", async () => {
    const result = await login(app, TENANT_A, SHARED_EMAIL, PASSWORD);
    const me = await app.inject({
      method: "GET",
      url: "/me",
      headers: authHeader(result.body.accessToken),
    });
    expect(me.statusCode).toBe(200);
    const body = me.json();
    expect(body.assignments).toHaveLength(2);
    const site = body.assignments.find(
      (a: { scopeType: string }) => a.scopeType === "organization_unit",
    );
    expect(site.scopeOrganizationUnitName).toBe("Site LWS");
    expect(site.roleCode).toBe("SITE_ROLE");
  });

  it("narrows /me permissions to the chosen assignment", async () => {
    const result = await login(app, TENANT_A, SHARED_EMAIL, PASSWORD);
    const token = result.body.accessToken;
    const all = (
      await app.inject({ method: "GET", url: "/me", headers: authHeader(token) })
    ).json();
    const site = all.assignments.find(
      (a: { scopeType: string }) => a.scopeType === "organization_unit",
    );

    const narrowed = (
      await app.inject({
        method: "GET",
        url: `/me?assignmentId=${site.id}`,
        headers: authHeader(token),
      })
    ).json();

    expect(narrowed.activeAssignmentId).toBe(site.id);
    expect(narrowed.permissions).toEqual(["organization_unit.read"]);
    expect(narrowed.scopeTypes).toEqual(["organization_unit"]);
    // The full set is unchanged — narrowing is per-request, not a revocation.
    expect(all.permissions.length).toBeGreaterThan(narrowed.permissions.length);
  });

  it("ignores an assignmentId that belongs to someone else", async () => {
    const result = await login(app, TENANT_A, SHARED_EMAIL, PASSWORD);
    const token = result.body.accessToken;
    const foreign = "00000000-0000-0000-0000-000000000000";
    const body = (
      await app.inject({
        method: "GET",
        url: `/me?assignmentId=${foreign}`,
        headers: authHeader(token),
      })
    ).json();
    expect(body.activeAssignmentId).toBeNull();
    expect(body.permissions.length).toBeGreaterThan(0);
  });
});
