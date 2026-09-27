import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../../src/app.js";
import { pool } from "../../src/infrastructure/persistence/db.js";
import { activateAllModules, authHeader, bootstrapTenant, createReadOnlyRole, login, provisionFirstAdmin } from "./helpers.js";

/**
 * Phase 11C — Business Admin Console read-side regression coverage.
 *
 * Phase 11F adds a separately governed role-assignment write slice. These
 * tests keep proving the original read contract: the entry permission is
 * explicit and required, holding it alone reveals nothing, one tenant can
 * never observe another, and no sensitive payload is projected.
 */

const stamp = Date.now();
const TENANT = `test-p11c-${stamp}`;
const OTHER = `test-p11co-${stamp}`;
const PASSWORD = "Passw0rd12345!";

const app = buildApp();

async function get(url: string, token: string) {
  return app.inject({ method: "GET", url, headers: authHeader(token) });
}

async function post(url: string, token: string, payload: unknown) {
  return app.inject({ method: "POST", url, headers: authHeader(token), payload });
}

describe("Phase 11C — Business Admin Console", () => {
  let tenantId: string;
  let otherTenantId: string;
  let adminToken: string;
  /** Holds admin.console.read AND the per-area read permissions. */
  let consoleToken: string;
  /** Holds ONLY admin.console.read — the escalation-probe actor. */
  let bareConsoleToken: string;
  /** Holds every per-area read permission but NOT admin.console.read. */
  let noConsoleToken: string;
  let otherConsoleToken: string;

  const AREA_PERMISSIONS = ["user.read", "config.read", "workflow.definition.read", "audit_log.read"];

  beforeAll(async () => {
    const t = await bootstrapTenant(app, TENANT, "Tenant P11C");
    await activateAllModules(t.id);
    tenantId = t.id;
    await provisionFirstAdmin({ tenantId, email: "admin@p11c.local", password: "Admin12345!" });
    adminToken = (await login(app, TENANT, "admin@p11c.local", "Admin12345!")).body.accessToken;

    await createReadOnlyRole(tenantId, "CONSOLE_P11C", ["admin.console.read", ...AREA_PERMISSIONS]);
    await createReadOnlyRole(tenantId, "CONSOLE_BARE_P11C", ["admin.console.read"]);
    await createReadOnlyRole(tenantId, "NO_CONSOLE_P11C", AREA_PERMISSIONS);

    for (const [email, roleCode] of [
      ["console@p11c.local", "CONSOLE_P11C"],
      ["bare@p11c.local", "CONSOLE_BARE_P11C"],
      ["noconsole@p11c.local", "NO_CONSOLE_P11C"],
    ]) {
      const created = await post("/admin/users", adminToken, { email, fullName: email, password: PASSWORD, pairs: [{ roleCode, scopeType: "tenant" as const }] });
      expect(created.statusCode).toBe(201);
    }

    const tok = async (email: string) => (await login(app, TENANT, email, PASSWORD)).body.accessToken;
    consoleToken = await tok("console@p11c.local");
    bareConsoleToken = await tok("bare@p11c.local");
    noConsoleToken = await tok("noconsole@p11c.local");

    // A second, fully independent tenant — the cross-tenant control.
    const ot = await bootstrapTenant(app, OTHER, "Tenant P11C Other");
    await activateAllModules(ot.id);
    otherTenantId = ot.id;
    await provisionFirstAdmin({ tenantId: otherTenantId, email: "admin@p11co.local", password: "Admin12345!" });
    const otherAdminToken = (await login(app, OTHER, "admin@p11co.local", "Admin12345!")).body.accessToken;
    await createReadOnlyRole(otherTenantId, "CONSOLE_P11CO", ["admin.console.read", ...AREA_PERMISSIONS]);
    const otherCreated = await post("/admin/users", otherAdminToken, { email: "console@p11co.local", fullName: "Other Console", password: PASSWORD, pairs: [{ roleCode: "CONSOLE_P11CO", scopeType: "tenant" as const }] });
    expect(otherCreated.statusCode).toBe(201);
    otherConsoleToken = (await login(app, OTHER, "console@p11co.local", PASSWORD)).body.accessToken;
  });

  afterAll(async () => {
    await app.close();
    await pool.end();
  });

  const ENDPOINTS = [
    "/admin/overview",
    "/admin/roles",
    "/admin/permissions",
    "/admin/modules",
    "/admin/workflows",
    "/admin/audit/recent",
  ];

  describe("authorization", () => {
    it("allows an actor holding admin.console.read plus the area permissions", async () => {
      for (const url of ENDPOINTS) {
        const response = await get(url, consoleToken);
        expect(response.statusCode, url).toBe(200);
      }
    });

    it("denies every endpoint to an actor without admin.console.read, even with all area permissions", async () => {
      // This is the load-bearing assertion for "explicit permission gate":
      // this actor can read users, config, workflows, and audit through the
      // existing endpoints, yet the console itself stays closed.
      for (const url of ENDPOINTS) {
        const response = await get(url, noConsoleToken);
        expect(response.statusCode, url).toBe(403);
      }
    });

    it("rejects unauthenticated requests", async () => {
      for (const url of ENDPOINTS) {
        const response = await app.inject({ method: "GET", url });
        expect(response.statusCode, url).toBe(401);
      }
    });

    it("grants no data to an actor holding admin.console.read alone", async () => {
      // admin.console.read is an entry ticket, never an override — so it can
      // never become a privilege-escalation shortcut or a de-facto superuser.
      const overview = await get("/admin/overview", bareConsoleToken);
      expect(overview.statusCode).toBe(200);
      const body = overview.json();
      for (const section of Object.values(body.sections) as { visible: boolean; count: number | null }[]) {
        expect(section.visible).toBe(false);
        // Null, never a misleading zero.
        expect(section.count).toBeNull();
      }

      for (const url of ENDPOINTS.filter((u) => u !== "/admin/overview")) {
        const response = await get(url, bareConsoleToken);
        expect(response.statusCode, url).toBe(403);
      }
    });

    it("names the permission each hidden section requires", async () => {
      const body = (await get("/admin/overview", bareConsoleToken)).json();
      expect(body.sections.users.requiredPermission).toBe("user.read");
      expect(body.sections.roles.requiredPermission).toBe("config.read");
      expect(body.sections.workflows.requiredPermission).toBe("workflow.definition.read");
      expect(body.sections.audit.requiredPermission).toBe("audit_log.read");
    });

    it("authorizes on permission, never on role name", async () => {
      // CONSOLE_P11C is not ADMIN and is not full-access, yet it works —
      // and NO_CONSOLE_P11C fails — purely because of granted permissions.
      const role = await pool.query(
        `SELECT is_full_access FROM roles WHERE tenant_id = $1 AND code = 'CONSOLE_P11C'`,
        [tenantId],
      );
      expect(role.rows[0].is_full_access).toBe(false);
      expect((await get("/admin/overview", consoleToken)).statusCode).toBe(200);
    });
  });

  describe("tenant isolation", () => {
    it("returns only the caller's own tenant in the overview", async () => {
      expect((await get("/admin/overview", consoleToken)).json().tenantId).toBe(tenantId);
      expect((await get("/admin/overview", otherConsoleToken)).json().tenantId).toBe(otherTenantId);
    });

    it("never exposes another tenant's roles", async () => {
      const mine = (await get("/admin/roles", consoleToken)).json() as { code: string }[];
      const theirs = (await get("/admin/roles", otherConsoleToken)).json() as { code: string }[];

      const myCodes = mine.map((r) => r.code);
      const theirCodes = theirs.map((r) => r.code);
      expect(myCodes).toContain("CONSOLE_P11C");
      expect(myCodes).not.toContain("CONSOLE_P11CO");
      expect(theirCodes).toContain("CONSOLE_P11CO");
      expect(theirCodes).not.toContain("CONSOLE_P11C");
    });

    it("counts only the caller's own tenant's users", async () => {
      const mine = (await get("/admin/overview", consoleToken)).json();
      const own = await pool.query(`SELECT COUNT(*)::int AS n FROM users WHERE tenant_id = $1 AND deleted_at IS NULL`, [
        tenantId,
      ]);
      expect(mine.sections.users.count).toBe(own.rows[0].n);

      // A global count would be strictly larger, since the other tenant has users.
      const global = await pool.query(`SELECT COUNT(*)::int AS n FROM users WHERE deleted_at IS NULL`);
      expect(global.rows[0].n).toBeGreaterThan(mine.sections.users.count);
    });

    it("never exposes another tenant's audit activity", async () => {
      const entries = (await get("/admin/audit/recent", consoleToken)).json() as { id: string }[];
      if (entries.length > 0) {
        const ids = entries.map((e) => e.id);
        const foreign = await pool.query(
          `SELECT COUNT(*)::int AS n FROM audit_log WHERE id = ANY($1::uuid[]) AND (tenant_id IS DISTINCT FROM $2)`,
          [ids, tenantId],
        );
        expect(foreign.rows[0].n).toBe(0);
      }
    });

    it("exposes the permission catalogue identically, because it is global platform metadata", async () => {
      // `permissions` has no tenant_id: it is migration-owned, byte-identical
      // in every deployment, and names no tenant, user, or record — so this
      // is safe catalogue metadata, not a cross-tenant leak.
      const mine = (await get("/admin/permissions", consoleToken)).json() as { code: string }[];
      const theirs = (await get("/admin/permissions", otherConsoleToken)).json() as { code: string }[];
      expect(mine.map((p) => p.code).sort()).toEqual(theirs.map((p) => p.code).sort());
      expect(mine.some((p) => p.code === "admin.console.read")).toBe(true);
    });
  });

  describe("privacy of projected data", () => {
    it("never projects a password hash or other user secret", async () => {
      // The overview reports counts only; assert the serialized payload
      // carries no credential material at all.
      const raw = (await get("/admin/overview", consoleToken)).body;
      expect(raw).not.toMatch(/password/i);
      expect(raw).not.toMatch(/passwordHash|password_hash/);
    });

    it("omits audit metadata and entityId from recent activity", async () => {
      const entries = (await get("/admin/audit/recent", consoleToken)).json() as Record<string, unknown>[];
      expect(entries.length).toBeGreaterThan(0);
      for (const entry of entries) {
        // `metadata` is free-form and may carry business narrative or reason
        // text; `entityId` identifies the specific record touched. Neither
        // belongs in a consolidated overview.
        expect(entry).not.toHaveProperty("metadata");
        expect(entry).not.toHaveProperty("entityId");
        expect(Object.keys(entry).sort()).toEqual(
          ["action", "actorUserId", "createdAt", "entityType", "id"].sort(),
        );
      }
    });

    it("bounds recent activity so it cannot become a bulk export", async () => {
      const entries = (await get("/admin/audit/recent", consoleToken)).json() as unknown[];
      expect(entries.length).toBeLessThanOrEqual(25);
    });

    it("summarises roles without exposing an id or a permission matrix", async () => {
      const roles = (await get("/admin/roles", consoleToken)).json() as Record<string, unknown>[];
      expect(roles.length).toBeGreaterThan(0);
      for (const role of roles) {
        // No `id`: the console never hands out a mutation handle. No
        // `permissions` array: it summarises access, it does not export it.
        expect(role).not.toHaveProperty("id");
        expect(role).not.toHaveProperty("permissions");
        expect(Object.keys(role).sort()).toEqual(
          ["assignedUserCount", "code", "isFullAccess", "name", "permissionCount"].sort(),
        );
      }
    });
  });

  describe("bounded management surface", () => {
    it("keeps every Phase 11C area read-only while declaring only the narrow Phase 11F capability", async () => {
      const capabilities = (await get("/admin/overview", consoleToken)).json().capabilities;
      expect(capabilities.readOnly).toBe(true);
      expect(capabilities.userRoleManage).toBe(false);
      expect(capabilities.userAccessRead).toBe(true);
      expect(capabilities.rolePermissionRead).toBe(true);
      expect(capabilities.userManage).toBe(false);
      expect(capabilities.roleManage).toBe(false);
      expect(capabilities.permissionManage).toBe(false);
      expect(capabilities.moduleActivationManage).toBe(false);
      expect(capabilities.workflowManage).toBe(false);
    });

    it("keeps the original Phase 11C routes free of mutation verbs", async () => {
      // Phase 11F adds writes only below the dedicated per-user assignment
      // resource. None of the original summary/catalog routes becomes mutable.
      // `POST /admin/roles` is Epic 4 Wave 1's governed definition-create
      // endpoint. All original Phase 11C summary/catalog routes below remain
      // read-only; routing its new resource through this old regression would
      // falsely call the intended addition a mutation leak.
      for (const url of ENDPOINTS.filter((url) => url !== "/admin/roles")) {
        for (const method of ["POST", "PATCH", "PUT", "DELETE"] as const) {
          const response = await app.inject({ method, url, headers: authHeader(adminToken), payload: {} });
          expect([404, 405], `${method} ${url}`).toContain(response.statusCode);
        }
      }
    });
  });

  describe("consolidated content", () => {
    it("reports role and module summaries the administrator can act on elsewhere", async () => {
      const roles = (await get("/admin/roles", consoleToken)).json() as {
        code: string;
        assignedUserCount: number;
        permissionCount: number;
      }[];
      const consoleRole = roles.find((r) => r.code === "CONSOLE_P11C");
      expect(consoleRole).toBeDefined();
      expect(consoleRole!.assignedUserCount).toBe(1);
      expect(consoleRole!.permissionCount).toBe(1 + AREA_PERMISSIONS.length);

      const modules = (await get("/admin/modules", consoleToken)).json() as {
        moduleCode: string;
        isActive: boolean;
      }[];
      expect(Array.isArray(modules)).toBe(true);
      for (const module of modules) {
        expect(typeof module.moduleCode).toBe("string");
        expect(typeof module.isActive).toBe("boolean");
      }
    });

    it("agrees between the overview counts and the detail endpoints", async () => {
      const overview = (await get("/admin/overview", consoleToken)).json();
      const roles = (await get("/admin/roles", consoleToken)).json() as unknown[];
      const permissions = (await get("/admin/permissions", consoleToken)).json() as unknown[];
      const modules = (await get("/admin/modules", consoleToken)).json() as { isActive: boolean }[];
      const workflows = (await get("/admin/workflows", consoleToken)).json() as unknown[];

      expect(overview.sections.roles.count).toBe(roles.length);
      expect(overview.sections.permissions.count).toBe(permissions.length);
      expect(overview.sections.modules.count).toBe(modules.length);
      expect(overview.sections.modules.activeCount).toBe(modules.filter((m) => m.isActive).length);
      expect(overview.sections.workflows.count).toBe(workflows.length);
    });
  });
});
