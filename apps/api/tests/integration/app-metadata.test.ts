import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { buildApp } from "../../src/app.js";
import { pool } from "../../src/infrastructure/persistence/db.js";
import { activateAllModules, authHeader, bootstrapTenant, login, provisionFirstAdmin } from "./helpers.js";
import { ROUTE_REGISTRY } from "../../src/domain/configuration/route-registry.js";

const TENANT_CODE = `test-app-metadata-${Date.now()}`;

describe("Epic 2 Wave 1 — Application Dictionary & Metadata Engine", () => {
  const app = buildApp();
  let tenantId: string;
  let adminToken: string;

  beforeAll(async () => {
    const tenant = await bootstrapTenant(app, TENANT_CODE, "Test Tenant App Metadata");
    await activateAllModules(tenant.id);
    tenantId = tenant.id;
    await provisionFirstAdmin({
      tenantId,
      email: "admin@test-app-metadata.local",
      password: "AdminPass123!",
    });
    const loginResult = await login(
      app,
      TENANT_CODE,
      "admin@test-app-metadata.local",
      "AdminPass123!",
    );
    adminToken = loginResult.body.accessToken;
  });

  afterAll(async () => {
    await pool.query(`DELETE FROM tenants WHERE id = $1`, [tenantId]);
    await app.close();
  });

  describe("Windows (Pages/Routes)", () => {
    it("should create a window", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/app-metadata/windows",
        headers: { authorization: `Bearer ${adminToken}` },
        payload: {
          code: "profile_page",
          name: "User Profile",
          description: "Display and edit user profile",
          moduleCode: "core_user",
          isActive: true,
        },
      });

      expect(response.statusCode).toBe(201);
      const body = JSON.parse(response.body);
      expect(body).toMatchObject({
        code: "profile_page",
        name: "User Profile",
        moduleCode: "core_user",
        isActive: true,
      });
      expect(body.id).toBeDefined();
      expect(body.tenantId).toBe(tenantId);
    });

    it("should list windows", async () => {
      await app.inject({
        method: "POST",
        url: "/app-metadata/windows",
        headers: { authorization: `Bearer ${adminToken}` },
        payload: {
          code: "dashboard_page",
          name: "Dashboard",
          moduleCode: "core_dashboard",
          isActive: true,
        },
      });

      const response = await app.inject({
        method: "GET",
        url: "/app-metadata/windows",
        headers: { authorization: `Bearer ${adminToken}` },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(Array.isArray(body)).toBe(true);
      expect(body.length).toBeGreaterThanOrEqual(2);
    });

    it("should get a specific window", async () => {
      const createResponse = await app.inject({
        method: "POST",
        url: "/app-metadata/windows",
        headers: { authorization: `Bearer ${adminToken}` },
        payload: {
          code: "settings_page",
          name: "Settings",
          moduleCode: "core_settings",
          isActive: true,
        },
      });

      const created = JSON.parse(createResponse.body);

      const getResponse = await app.inject({
        method: "GET",
        url: `/app-metadata/windows/${created.id}`,
        headers: { authorization: `Bearer ${adminToken}` },
      });

      expect(getResponse.statusCode).toBe(200);
      const body = JSON.parse(getResponse.body);
      expect(body.id).toBe(created.id);
      expect(body.code).toBe("settings_page");
    });

    it("should update a window", async () => {
      const createResponse = await app.inject({
        method: "POST",
        url: "/app-metadata/windows",
        headers: { authorization: `Bearer ${adminToken}` },
        payload: {
          code: "test_update_window",
          name: "Original Name",
          moduleCode: "core_test",
          isActive: true,
        },
      });

      const created = JSON.parse(createResponse.body);

      const updateResponse = await app.inject({
        method: "PATCH",
        url: `/app-metadata/windows/${created.id}`,
        headers: { authorization: `Bearer ${adminToken}` },
        payload: {
          name: "Updated Name",
          description: "Updated description",
        },
      });

      expect(updateResponse.statusCode).toBe(200);
      const updated = JSON.parse(updateResponse.body);
      expect(updated.name).toBe("Updated Name");
      expect(updated.description).toBe("Updated description");
    });

    it("should reject isExternalAllowed edit from wire (locked decision)", async () => {
      const createResponse = await app.inject({
        method: "POST",
        url: "/app-metadata/windows",
        headers: { authorization: `Bearer ${adminToken}` },
        payload: {
          code: "locked_test_window",
          name: "Locked Test",
          moduleCode: "core_locked",
          isActive: true,
        },
      });

      const created = JSON.parse(createResponse.body);

      const updateResponse = await app.inject({
        method: "PATCH",
        url: `/app-metadata/windows/${created.id}`,
        headers: { authorization: `Bearer ${adminToken}` },
        payload: {
          name: "Same Name",
          isExternalAllowed: true,
        },
      });

      expect(updateResponse.statusCode).toBe(400);
      const error = JSON.parse(updateResponse.body);
      expect(error.error).toContain("isExternalAllowed is set in code only");
    });

    it("should reject code-owned route metadata from the wire (locked decision)", async () => {
      const createResponse = await app.inject({
        method: "POST",
        url: "/app-metadata/windows",
        headers: { authorization: `Bearer ${adminToken}` },
        payload: {
          code: "route_metadata_locked",
          name: "Route Metadata Locked",
          moduleCode: "core_locked",
          isActive: true,
        },
      });
      const created = JSON.parse(createResponse.body);

      // Zod strips unknown keys, so without the explicit pre-parse check these
      // would vanish silently. They decide whether a page renders and who may
      // reach it (§4.2 "inti di kode"), so they must fail loudly instead.
      for (const [field, value] of [
        ["registrationStatus", "di_menu"],
        ["requiredPermissions", ["config.manage"]],
        ["parentPath", "/administration"],
      ] as const) {
        const response = await app.inject({
          method: "PATCH",
          url: `/app-metadata/windows/${created.id}`,
          headers: { authorization: `Bearer ${adminToken}` },
          payload: { name: "Still Original", [field]: value },
        });

        expect(response.statusCode, `${field} must be rejected`).toBe(400);
        expect(JSON.parse(response.body).error).toContain(`${field} is set in code only`);
      }

      // Nothing leaked through: the window is unchanged and still unregistered.
      const after = await app.inject({
        method: "GET",
        url: `/app-metadata/windows/${created.id}`,
        headers: { authorization: `Bearer ${adminToken}` },
      });
      const body = JSON.parse(after.body);
      expect(body.name).toBe("Route Metadata Locked");
      expect(body.registrationStatus).toBe("belum_terdaftar");
      expect(body.requiredPermissions).toEqual([]);
    });

    it("should answer 400, not 500, for a non-object PATCH body", async () => {
      // `field in body` throws a TypeError on null/string/number, which the
      // error mapper turns into a 500 before authorization even runs.
      for (const payload of [null, "just a string", 42, [1, 2, 3]]) {
        const response = await app.inject({
          method: "PATCH",
          url: "/app-metadata/windows/00000000-0000-0000-0000-000000000000",
          headers: { authorization: `Bearer ${adminToken}`, "content-type": "application/json" },
          payload: JSON.stringify(payload),
        });
        expect(response.statusCode, `body ${JSON.stringify(payload)}`).toBe(400);
      }
    });

    it("should ignore code-owned route metadata supplied at create time", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/app-metadata/windows",
        headers: { authorization: `Bearer ${adminToken}` },
        payload: {
          code: "route_metadata_on_create",
          name: "Route Metadata On Create",
          moduleCode: "core_locked",
          isActive: true,
          registrationStatus: "di_menu",
          requiredPermissions: ["config.read"],
          parentPath: "/",
        },
      });

      expect(response.statusCode).toBe(201);
      const body = JSON.parse(response.body);
      // A window created through the API has no route behind it, so it can
      // never be role-locked — the seed migration is what registers routes.
      expect(body.registrationStatus).toBe("belum_terdaftar");
      expect(body.requiredPermissions).toEqual([]);
      expect(body.parentPath).toBeUndefined();
    });
  });

  describe("Route auto-registration seed (Epic 2 Wave 1, §4.3)", () => {
    it("seeds one app_window per registered route for a new tenant", async () => {
      const rows = await pool.query<{
        code: string;
        registration_status: string;
        required_permissions: string[];
      }>(
        `SELECT code, registration_status, required_permissions
           FROM app_windows
          WHERE tenant_id = $1 AND code LIKE 'route:%'`,
        [tenantId],
      );

      // Comparing against the registry rather than a pinned count means a route
      // added in code without a matching seed fails here, which is the drift
      // this migration exists to prevent.
      const seededPaths = rows.rows.map((r) => r.code.replace(/^route:/, "")).sort();
      expect(seededPaths).toEqual(ROUTE_REGISTRY.map((r) => r.path).sort());

      const byCode = new Map(rows.rows.map((r) => [r.code, r]));

      // The HSE report form is gated server-side on `hse.report`
      // (hse.service.ts:110), not `hse.manage`; the registry carries both so an
      // assignee can also open it to correct a record.
      const hseReport = byCode.get("route:/hse/report");
      expect(hseReport?.registration_status).toBe("tersembunyi");
      expect(hseReport?.required_permissions).toEqual(["hse.report", "hse.manage"]);

      const adminComplaints = byCode.get("route:/administration/complaints");
      expect(adminComplaints?.required_permissions).toEqual(["complaint.configure"]);

      // Entry-flow routes render outside the shell and need no permission.
      expect(byCode.get("route:/login")?.required_permissions).toEqual([]);

      // Nothing is seeded as unregistered: that status exists for rows created
      // through the API, and it is what guard report mode surfaces.
      expect(rows.rows.every((r) => r.registration_status !== "belum_terdaftar")).toBe(true);
    });

    it("seeds the corrected finance detail description, not the stale exception note", async () => {
      // 1787200000000 seeded this row's description from a note that read
      // "Read-only exception (§4.3) ...". That framing was wrong: the page
      // writes through `finance.manage` and `finance.approve`, and read-only
      // mode is lapis 3 (`role_window_access`), never carried by the route.
      // 1787900000000 repairs the trigger for tenants created after it, so a
      // fresh tenant must get the corrected wording. The description travels
      // through `GET /app-metadata/windows`, which is why this is asserted
      // through the API rather than only against the table.
      const row = await pool.query<{ description: string | null }>(
        `SELECT description FROM app_windows
          WHERE tenant_id = $1 AND code = 'route:/finance/transactions/:transactionId'`,
        [tenantId],
      );
      expect(row.rows[0]?.description).toBe(
        "Detail with its own window identity (§4.3); role read-only mode is lapis 3, not carried here.",
      );
      expect(row.rows[0]?.description ?? "").not.toMatch(/Read-only exception/);
    });

    it("leaves no tenant carrying the stale finance detail description", async () => {
      // The other half of 1787900000000: an UPDATE repairs tenants seeded
      // before the migration, the trigger repair covers tenants seeded after
      // it. A row that bypassed both would still expose the wrong framing
      // through the Application Dictionary, so this asserts across every
      // tenant rather than the one this suite happens to use.
      const stale = await pool.query<{ tenant_id: string }>(
        `SELECT tenant_id FROM app_windows
          WHERE code = 'route:/finance/transactions/:transactionId'
            AND description LIKE 'Read-only exception%'`,
      );
      expect(stale.rows).toEqual([]);
    });

    it("provides the module every registry moduleCode references", async () => {
      const missing = await pool.query<{ code: string }>(
        `SELECT DISTINCT w.module_code AS code
           FROM app_windows w
           LEFT JOIN modules m ON m.code = w.module_code
          WHERE w.tenant_id = $1 AND w.code LIKE 'route:%' AND m.code IS NULL`,
        [tenantId],
      );
      expect(missing.rows.map((r) => r.code)).toEqual([]);
    });
  });

  describe("Tabs (Sections within a Window)", () => {
    let windowId: string;

    beforeAll(async () => {
      const response = await app.inject({
        method: "POST",
        url: "/app-metadata/windows",
        headers: { authorization: `Bearer ${adminToken}` },
        payload: {
          code: "window_for_tabs",
          name: "Window for Tabs Test",
          moduleCode: "core_tabs_test",
          isActive: true,
        },
      });
      windowId = JSON.parse(response.body).id;
    });

    it("should create a tab", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/app-metadata/tabs",
        headers: { authorization: `Bearer ${adminToken}` },
        payload: {
          windowId,
          code: "details_tab",
          name: "Details",
          tabType: "fields",
          sequenceNo: 10,
          isActive: true,
        },
      });

      expect(response.statusCode).toBe(201);
      const body = JSON.parse(response.body);
      expect(body).toMatchObject({
        code: "details_tab",
        name: "Details",
        tabType: "fields",
        windowId,
      });
    });

    it("should list tabs by window", async () => {
      const response = await app.inject({
        method: "GET",
        url: `/app-metadata/windows/${windowId}/tabs`,
        headers: { authorization: `Bearer ${adminToken}` },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(Array.isArray(body)).toBe(true);
    });
  });

  describe("Tables & Fields", () => {
    // The migration only creates the app_tables/app_fields SCHEMA; it does
    // not seed any rows (that is tenant/module data, not schema). Insert a
    // minimal fixture row directly so listTables/listFieldsByTable have
    // something real to return instead of an empty array.
    let fixtureTableId: string;

    beforeAll(async () => {
      const tableRow = await pool.query(
        `INSERT INTO app_tables (tenant_id, code, name, module_code, is_active)
         VALUES ($1, 'test_fixture_table', 'Test Fixture Table', 'core_test', true)
         RETURNING id`,
        [tenantId],
      );
      fixtureTableId = tableRow.rows[0].id;

      await pool.query(
        `INSERT INTO app_fields (tenant_id, table_id, code, name, field_type, is_active)
         VALUES ($1, $2, 'test_field', 'Test Field', 'text', true)`,
        [tenantId, fixtureTableId],
      );
    });

    it("should list tables", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/app-metadata/tables",
        headers: authHeader(adminToken),
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(Array.isArray(body)).toBe(true);
      expect(body.some((t: { id: string }) => t.id === fixtureTableId)).toBe(true);
    });

    it("should get a specific table", async () => {
      const response = await app.inject({
        method: "GET",
        url: `/app-metadata/tables/${fixtureTableId}`,
        headers: authHeader(adminToken),
      });

      expect(response.statusCode).toBe(200);
      expect(JSON.parse(response.body).code).toBe("test_fixture_table");
    });

    it("should list fields by table", async () => {
      const response = await app.inject({
        method: "GET",
        url: `/app-metadata/tables/${fixtureTableId}/fields`,
        headers: authHeader(adminToken),
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(Array.isArray(body)).toBe(true);
      expect(body.some((f: { code: string }) => f.code === "test_field")).toBe(true);
    });
  });

  describe("API Resources", () => {
    it("should list API resources", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/app-metadata/api-resources",
        headers: { authorization: `Bearer ${adminToken}` },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(Array.isArray(body)).toBe(true);
    });
  });

  describe("Field Rules (Versioned Structured Rules)", () => {
    let tableId: string;

    beforeAll(async () => {
      const tablesResponse = await app.inject({
        method: "GET",
        url: "/app-metadata/tables",
        headers: authHeader(adminToken),
      });
      const tables = JSON.parse(tablesResponse.body);
      tableId = tables.find((t: { code: string }) => t.code === "test_fixture_table").id;
    });

    it("should create a rule version (draft)", async () => {
      const response = await app.inject({
        method: "POST",
        url: `/app-metadata/tables/${tableId}/rule-versions`,
        headers: authHeader(adminToken),
        payload: {
          rules: [
            {
              field: "status",
              ruleType: "mandatory",
              conditions: {
                rules: [
                  {
                    field: "workflowState",
                    operator: "eq",
                    value: "active",
                  },
                ],
                combinator: "AND",
              },
            },
          ],
        },
      });

      expect(response.statusCode).toBe(201);
      const body = JSON.parse(response.body);
      expect(body.status).toBe("draft");
      expect(body.versionNumber).toBe(1);
      expect(body.isCurrent).toBe(false);
    });

    it("should accept all nine locked operators with valid value shapes", async () => {
      const response = await app.inject({
        method: "POST",
        url: `/app-metadata/tables/${tableId}/rule-versions`,
        headers: authHeader(adminToken),
        payload: {
          rules: [
            {
              field: "reviewState",
              ruleType: "readonly",
              conditions: {
                rules: [
                  { field: "text", operator: "eq", value: "x" },
                  { field: "text", operator: "neq", value: "y" },
                  { field: "number", operator: "gt", value: 1 },
                  { field: "number", operator: "gte", value: 1 },
                  { field: "number", operator: "lt", value: 9 },
                  { field: "number", operator: "lte", value: 9 },
                  { field: "state", operator: "in", value: ["draft", "review"] },
                  { field: "state", operator: "notIn", value: ["final"] },
                  { field: "approver", operator: "isNull", value: true },
                ],
                combinator: "AND",
              },
            },
          ],
        },
      });

      expect(response.statusCode).toBe(201);
    });

    it("should reject invalid shapes for notIn and isNull", async () => {
      const invalidNotIn = await app.inject({
        method: "POST",
        url: `/app-metadata/tables/${tableId}/rule-versions`,
        headers: authHeader(adminToken),
        payload: {
          rules: [
            {
              field: "reviewState",
              ruleType: "readonly",
              conditions: { rules: [{ field: "state", operator: "notIn", value: "final" }], combinator: "AND" },
            },
          ],
        },
      });
      expect(invalidNotIn.statusCode).toBe(400);

      const invalidIsNull = await app.inject({
        method: "POST",
        url: `/app-metadata/tables/${tableId}/rule-versions`,
        headers: authHeader(adminToken),
        payload: {
          rules: [
            {
              field: "reviewState",
              ruleType: "readonly",
              conditions: { rules: [{ field: "approver", operator: "isNull", value: "true" }], combinator: "AND" },
            },
          ],
        },
      });
      expect(invalidIsNull.statusCode).toBe(400);
    });

    it("should publish a rule version and retire previous current", async () => {
      // Create first version
      const createResponse1 = await app.inject({
        method: "POST",
        url: `/app-metadata/tables/${tableId}/rule-versions`,
        headers: authHeader(adminToken),
        payload: {
          rules: [
            {
              field: "name",
              ruleType: "mandatory",
              conditions: {
                rules: [{ field: "type", operator: "neq", value: "temporary" }],
                combinator: "AND",
              },
            },
          ],
        },
      });

      const version1 = JSON.parse(createResponse1.body);

      // Publish first version
      const publishResponse1 = await app.inject({
        method: "POST",
        url: `/app-metadata/rule-versions/${version1.id}/publish`,
        headers: authHeader(adminToken),
      });

      expect(publishResponse1.statusCode).toBe(200);
      const published1 = JSON.parse(publishResponse1.body);
      expect(published1.status).toBe("published");
      expect(published1.isCurrent).toBe(true);

      // Create second version
      const createResponse2 = await app.inject({
        method: "POST",
        url: `/app-metadata/tables/${tableId}/rule-versions`,
        headers: authHeader(adminToken),
        payload: {
          rules: [
            {
              field: "name",
              ruleType: "readonly",
              conditions: {
                rules: [{ field: "locked", operator: "eq", value: true }],
                combinator: "AND",
              },
            },
          ],
        },
      });

      const version2 = JSON.parse(createResponse2.body);

      // Publish second version
      const publishResponse2 = await app.inject({
        method: "POST",
        url: `/app-metadata/rule-versions/${version2.id}/publish`,
        headers: authHeader(adminToken),
      });

      expect(publishResponse2.statusCode).toBe(200);
      const published2 = JSON.parse(publishResponse2.body);
      expect(published2.status).toBe("published");
      expect(published2.isCurrent).toBe(true);

      // List: exactly one current, and it is version2; version1 retired
      const listResponse = await app.inject({
        method: "GET",
        url: `/app-metadata/tables/${tableId}/rule-versions`,
        headers: authHeader(adminToken),
      });

      const versions = JSON.parse(listResponse.body);
      const current = versions.filter((v: { isCurrent: boolean }) => v.isCurrent);
      expect(current).toHaveLength(1);
      expect(current[0].id).toBe(version2.id);
      expect(versions.find((v: { id: string }) => v.id === version1.id).status).toBe("retired");
    });

    it("should refuse to publish the same version twice", async () => {
      const createResponse = await app.inject({
        method: "POST",
        url: `/app-metadata/tables/${tableId}/rule-versions`,
        headers: authHeader(adminToken),
        payload: {
          rules: [
            {
              field: "code",
              ruleType: "visible",
              conditions: { rules: [{ field: "isActive", operator: "eq", value: true }], combinator: "AND" },
            },
          ],
        },
      });

      const version = JSON.parse(createResponse.body);

      // First publish succeeds
      const firstPublish = await app.inject({
        method: "POST",
        url: `/app-metadata/rule-versions/${version.id}/publish`,
        headers: authHeader(adminToken),
      });
      expect(firstPublish.statusCode).toBe(200);

      // Second publish on the same version must fail (not a draft anymore)
      const secondPublish = await app.inject({
        method: "POST",
        url: `/app-metadata/rule-versions/${version.id}/publish`,
        headers: authHeader(adminToken),
      });
      expect(secondPublish.statusCode).toBe(400);
      expect(JSON.parse(secondPublish.body).error).toContain("Cannot publish");
    });

    it("should get current rule version", async () => {
      const response = await app.inject({
        method: "GET",
        url: `/app-metadata/tables/${tableId}/rule-versions/current`,
        headers: authHeader(adminToken),
      });

      expect(response.statusCode).toBe(200);
      expect(JSON.parse(response.body).isCurrent).toBe(true);
    });
  });

  describe("Authentication & Authorization", () => {
    it("should reject unauthenticated requests", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/app-metadata/windows",
      });

      expect(response.statusCode).toBe(401);
    });
  });
});
