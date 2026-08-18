import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../../src/app.js";
import { pool } from "../../src/infrastructure/persistence/db.js";
import {
  authHeader,
  bootstrapTenant,
  createReadOnlyRole,
  login,
  provisionFirstAdmin,
} from "./helpers.js";

/**
 * Checkpoint 0B integration test — proves the full chain end-to-end:
 *
 *   Tenant -> Legal Entity -> Organization Unit -> User -> Authentication
 *   -> RBAC -> Audit Trail -> PostgreSQL
 *
 * Runs against the real PostgreSQL database (no mocking of the DB layer)
 * so the assertions at the end that query `pool` directly are a genuine
 * check that data is actually persisted, not just that the API responded.
 */

const TENANT_CODE = `test-0b-${Date.now()}`;

describe("Checkpoint 0B — Identity & Organization vertical slice", () => {
  const app = buildApp();
  let tenantId: string;
  let adminToken: string;
  let legalEntityId: string;
  let headOfficeId: string;
  let siteId: string;
  let supervisorUserId: string;

  beforeAll(async () => {
    const tenant = await bootstrapTenant(app, TENANT_CODE, "Test Tenant 0B");
    tenantId = tenant.id;
    await provisionFirstAdmin({
      tenantId,
      email: "admin@test-0b.local",
      password: "AdminPass123!",
    });
  });

  afterAll(async () => {
    // Test hygiene: this suite provisions a real Tenant against the shared
    // dev database on every run — clean it up so repeated runs don't
    // accumulate test-only rows. ON DELETE CASCADE takes care of every
    // child table (legal_entities, organization_units, users, roles,
    // audit_log, ...).
    await pool.query(`DELETE FROM tenants WHERE id = $1`, [tenantId]);
    await app.close();
  });

  it("logs the Administrator in and issues a working access token", async () => {
    const result = await login(app, TENANT_CODE, "admin@test-0b.local", "AdminPass123!");
    expect(result.statusCode).toBe(200);
    expect(result.body.accessToken).toBeTruthy();
    adminToken = result.body.accessToken;
  });

  it("rejects login with a wrong password and records the failure in the audit trail", async () => {
    const result = await login(app, TENANT_CODE, "admin@test-0b.local", "wrong-password");
    expect(result.statusCode).toBe(401);

    const audit = await pool.query(
      `SELECT * FROM audit_log WHERE tenant_id = $1 AND action = 'auth.login.failed'`,
      [tenantId],
    );
    expect(audit.rows.length).toBeGreaterThan(0);
  });

  it("creates a Legal Entity under the Tenant", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/legal-entities",
      headers: authHeader(adminToken),
      payload: { name: "Test Legal Entity" },
    });
    expect(response.statusCode).toBe(201);
    legalEntityId = response.json().id;
    expect(response.json().tenantId).toBe(tenantId);
  });

  it("creates a root Organization Unit and a child Organization Unit (hierarchy)", async () => {
    const rootResponse = await app.inject({
      method: "POST",
      url: "/organization-units",
      headers: authHeader(adminToken),
      payload: { legalEntityId, name: "Head Office" },
    });
    expect(rootResponse.statusCode).toBe(201);
    headOfficeId = rootResponse.json().id;

    const childResponse = await app.inject({
      method: "POST",
      url: "/organization-units",
      headers: authHeader(adminToken),
      payload: { legalEntityId, parentId: headOfficeId, name: "Site A", unitType: "Site" },
    });
    expect(childResponse.statusCode).toBe(201);
    siteId = childResponse.json().id;
    expect(childResponse.json().parentId).toBe(headOfficeId);
  });

  it("creates a scoped Supervisor User with a real Role + Data Scope assignment", async () => {
    await createReadOnlyRole(tenantId, "SUPERVISOR", [
      "organization_unit.read",
      "user.read",
      "tenant.read",
    ]);

    const response = await app.inject({
      method: "POST",
      url: "/users",
      headers: authHeader(adminToken),
      payload: {
        email: "supervisor@test-0b.local",
        fullName: "Test Supervisor",
        password: "SupervisorPass123!",
        roleCode: "SUPERVISOR",
        scopeType: "organization_unit",
        scopeOrganizationUnitId: siteId,
      },
    });
    expect(response.statusCode).toBe(201);
    supervisorUserId = response.json().user.id;
    expect(response.json().assignment.scopeOrganizationUnitId).toBe(siteId);
  });

  it("authenticates the Supervisor and confirms their effective permissions via /me", async () => {
    const result = await login(app, TENANT_CODE, "supervisor@test-0b.local", "SupervisorPass123!");
    expect(result.statusCode).toBe(200);

    const meResponse = await app.inject({
      method: "GET",
      url: "/me",
      headers: authHeader(result.body.accessToken),
    });
    const permissions: string[] = meResponse.json().permissions;
    expect(permissions).toContain("organization_unit.read");
    expect(permissions).not.toContain("organization_unit.create");
  });

  it("scopes the Supervisor's Organization Unit list to exactly their assigned unit", async () => {
    const supervisorLogin = await login(
      app,
      TENANT_CODE,
      "supervisor@test-0b.local",
      "SupervisorPass123!",
    );

    const response = await app.inject({
      method: "GET",
      url: "/organization-units",
      headers: authHeader(supervisorLogin.body.accessToken),
    });
    const units = response.json();
    expect(units).toHaveLength(1);
    expect(units[0].id).toBe(siteId);
  });

  it("REJECTS the Supervisor's attempt to create an Organization Unit (403, backend-enforced)", async () => {
    const supervisorLogin = await login(
      app,
      TENANT_CODE,
      "supervisor@test-0b.local",
      "SupervisorPass123!",
    );

    const response = await app.inject({
      method: "POST",
      url: "/organization-units",
      headers: authHeader(supervisorLogin.body.accessToken),
      payload: { legalEntityId, parentId: siteId, name: "Should Not Be Created" },
    });
    expect(response.statusCode).toBe(403);

    // Confirm nothing was actually written — this is authorization, not
    // just an HTTP status code.
    const rows = await pool.query(
      `SELECT * FROM organization_units WHERE name = 'Should Not Be Created'`,
    );
    expect(rows.rows).toHaveLength(0);
  });

  it("REJECTS the Supervisor's attempt to create a User (403, backend-enforced)", async () => {
    const supervisorLogin = await login(
      app,
      TENANT_CODE,
      "supervisor@test-0b.local",
      "SupervisorPass123!",
    );

    const response = await app.inject({
      method: "POST",
      url: "/users",
      headers: authHeader(supervisorLogin.body.accessToken),
      payload: {
        email: "sneaky@test-0b.local",
        fullName: "Sneaky",
        password: "Whatever123!",
        roleCode: "ADMIN",
        scopeType: "tenant",
      },
    });
    expect(response.statusCode).toBe(403);
  });

  it("REJECTS any request without a bearer token (401)", async () => {
    const response = await app.inject({ method: "GET", url: "/organization-units" });
    expect(response.statusCode).toBe(401);
  });

  it("REJECTS Tenant bootstrap without the platform bootstrap key (401)", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/tenants",
      payload: { code: "should-not-be-created", name: "Should Not Be Created" },
    });
    expect(response.statusCode).toBe(401);
  });

  it("records an audit trail entry for every mutating action performed above", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/audit-log/recent",
      headers: authHeader(adminToken),
    });
    expect(response.statusCode).toBe(200);
    const actions = response.json().map((e: { action: string }) => e.action);

    expect(actions).toContain("legal_entity.created");
    expect(actions).toContain("organization_unit.created");
    expect(actions).toContain("user.created");
    expect(actions).toContain("user.role_assigned");
    expect(actions).toContain("auth.login.success");
    expect(actions).toContain("auth.login.failed");
  });

  it("persists every entity in PostgreSQL and is independently verifiable there", async () => {
    const tenantRow = await pool.query(`SELECT * FROM tenants WHERE id = $1`, [tenantId]);
    expect(tenantRow.rows).toHaveLength(1);

    const legalEntityRow = await pool.query(
      `SELECT * FROM legal_entities WHERE id = $1 AND tenant_id = $2`,
      [legalEntityId, tenantId],
    );
    expect(legalEntityRow.rows).toHaveLength(1);

    const orgUnitRows = await pool.query(
      `SELECT * FROM organization_units WHERE tenant_id = $1 ORDER BY created_at`,
      [tenantId],
    );
    expect(orgUnitRows.rows.length).toBeGreaterThanOrEqual(2);
    expect(orgUnitRows.rows.find((r) => r.id === siteId)?.parent_id).toBe(headOfficeId);

    const userRow = await pool.query(`SELECT * FROM users WHERE id = $1`, [supervisorUserId]);
    expect(userRow.rows).toHaveLength(1);
    expect(userRow.rows[0].password_hash).not.toBe("SupervisorPass123!"); // never plaintext

    const assignmentRow = await pool.query(
      `SELECT * FROM user_role_assignments WHERE user_id = $1`,
      [supervisorUserId],
    );
    expect(assignmentRow.rows).toHaveLength(1);
    expect(assignmentRow.rows[0].scope_organization_unit_id).toBe(siteId);

    const auditCount = await pool.query(
      `SELECT COUNT(*)::int AS count FROM audit_log WHERE tenant_id = $1`,
      [tenantId],
    );
    expect(auditCount.rows[0].count).toBeGreaterThan(0);
  });
});
