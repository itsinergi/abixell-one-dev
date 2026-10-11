import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../../src/app.js";
import { pool } from "../../src/infrastructure/persistence/db.js";
import { activateAllModules, authHeader, bootstrapTenant, login, provisionFirstAdmin } from "./helpers.js";

/**
 * Wave MD-01 — Finance Master Data integration suite (WP-MD-01).
 *
 * Covers: cost center CRUD + 1-level hierarchy (K1) + effective window,
 * payment term CRUD + validation, tenant isolation, RBAC (finance.configure
 * vs finance.read), and the journal_lines FK to finance_cost_centers.
 */

const TENANT_CODE = `wave-md1-main-${Date.now()}`;
const OTHER_TENANT_CODE = `wave-md1-other-${Date.now()}`;
const ADMIN_EMAIL = "admin@wave-md1.local";
const ADMIN_PASSWORD = "Admin12345!";

const TODAY = new Date().toISOString().slice(0, 10);

describe.sequential("Wave MD-01 — Finance Master Data (WP-MD-01)", () => {
  const app = buildApp();

  let token: string;
  let otherToken: string;

  beforeAll(async () => {
    const primary = await bootstrapTenant(app, TENANT_CODE, "Wave MD1 Primary");
    await activateAllModules(primary.id);
    await provisionFirstAdmin({ tenantId: primary.id, email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
    const adminLogin = await login(app, TENANT_CODE, ADMIN_EMAIL, ADMIN_PASSWORD);
    token = adminLogin.body.accessToken;

    const other = await bootstrapTenant(app, OTHER_TENANT_CODE, "Wave MD1 Other");
    await activateAllModules(other.id);
    const otherEmail = "other@wave-md1.local";
    await provisionFirstAdmin({ tenantId: other.id, email: otherEmail, password: ADMIN_PASSWORD });
    const otherLogin = await login(app, OTHER_TENANT_CODE, otherEmail, ADMIN_PASSWORD);
    otherToken = otherLogin.body.accessToken;
  });

  afterAll(async () => {
    // Test-tenant cleanup (dev DB is shared — see memory vitest-shares-dev-db).
    for (const code of [TENANT_CODE, OTHER_TENANT_CODE]) {
      await pool.query(`DELETE FROM tenants WHERE code = $1`, [code]);
    }
    await app.close();
  });

  const post = (url: string, payload?: Record<string, unknown>, tok: string = token) =>
    app.inject({ method: "POST", url, headers: authHeader(tok), ...(payload === undefined ? {} : { payload }) });
  const get = (url: string, tok: string = token) => app.inject({ method: "GET", url, headers: authHeader(tok) });
  const patch = (url: string, payload: Record<string, unknown>, tok: string = token) =>
    app.inject({ method: "PATCH", url, headers: authHeader(tok), payload });

  // =========================================================================
  // Cost centers
  // =========================================================================

  it("creates a cost center", async () => {
    const res = await post("/finance/cost-centers", {
      code: "CC-OPS",
      name: "Operations",
      type: "cost",
      effectiveFrom: TODAY,
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().code).toBe("CC-OPS");
    expect(res.json().status).toBe("active");
  });

  it("rejects duplicate cost center code with 409", async () => {
    const res = await post("/finance/cost-centers", {
      code: "CC-OPS",
      name: "Duplicate",
      type: "cost",
      effectiveFrom: TODAY,
    });
    expect(res.statusCode).toBe(409);
  });

  it("rejects invalid effective window (to < from)", async () => {
    const res = await post("/finance/cost-centers", {
      code: "CC-BADWINDOW",
      name: "Bad Window",
      type: "cost",
      effectiveFrom: TODAY,
      effectiveTo: "2020-01-01",
    });
    expect(res.statusCode).toBe(400);
  });

  it("rejects a 2-level parent chain (K1)", async () => {
    const parent = await post("/finance/cost-centers", {
      code: "CC-ROOT",
      name: "Root",
      type: "cost",
      effectiveFrom: TODAY,
    });
    expect(parent.statusCode).toBe(201);
    const rootId = parent.json().id;

    const mid = await post("/finance/cost-centers", {
      code: "CC-MID",
      name: "Mid",
      type: "cost",
      parentId: rootId,
      effectiveFrom: TODAY,
    });
    expect(mid.statusCode).toBe(201);
    const midId = mid.json().id;

    const leaf = await post("/finance/cost-centers", {
      code: "CC-LEAF",
      name: "Leaf",
      type: "cost",
      parentId: midId,
      effectiveFrom: TODAY,
    });
    expect(leaf.statusCode).toBe(400);
  });

  it("rejects an unknown parent id", async () => {
    const res = await post("/finance/cost-centers", {
      code: "CC-ORPHAN",
      name: "Orphan",
      type: "cost",
      parentId: "00000000-0000-0000-0000-000000000001",
      effectiveFrom: TODAY,
    });
    expect(res.statusCode).toBe(400);
  });

  it("lists cost centers with a status filter", async () => {
    const res = await get("/finance/cost-centers?status=active");
    expect(res.statusCode).toBe(200);
    const codes = res.json().map((c: { code: string }) => c.code);
    expect(codes).toContain("CC-OPS");
  });

  it("patches a cost center (rename + deactivate)", async () => {
    const created = await post("/finance/cost-centers", {
      code: "CC-PATCH",
      name: "Before",
      type: "profit",
      effectiveFrom: TODAY,
    });
    const code = created.json().code;
    const renamed = await patch(`/finance/cost-centers/${code}`, { name: "After" });
    expect(renamed.statusCode).toBe(200);
    expect(renamed.json().name).toBe("After");
    const deactivated = await patch(`/finance/cost-centers/${code}`, { status: "inactive" });
    expect(deactivated.json().status).toBe("inactive");
  });

  it("rejects bad date format with 400", async () => {
    const res = await post("/finance/cost-centers", {
      code: "CC-BADDATE",
      name: "Bad Date",
      type: "cost",
      effectiveFrom: "11-10-2026",
    });
    expect(res.statusCode).toBe(400);
  });

  // =========================================================================
  // Payment terms
  // =========================================================================

  it("creates a payment term with discount", async () => {
    const res = await post("/finance/payment-terms", {
      code: "NET30-2/10",
      name: "Net 30, 2% 10 days",
      netDays: 30,
      discountDays: 10,
      discountPercent: "2.00",
      effectiveFrom: TODAY,
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().netDays).toBe(30);
    expect(res.json().discountPercent).toBe("2.00");
  });

  it("rejects discountPercent > 100", async () => {
    const res = await post("/finance/payment-terms", {
      code: "NET-BADPCT",
      name: "Bad percent",
      netDays: 30,
      discountPercent: "150.00",
      effectiveFrom: TODAY,
    });
    expect(res.statusCode).toBe(400);
  });

  it("rejects duplicate payment term code with 409", async () => {
    const res = await post("/finance/payment-terms", {
      code: "NET30-2/10",
      name: "Duplicate",
      netDays: 14,
      effectiveFrom: TODAY,
    });
    expect(res.statusCode).toBe(409);
  });

  it("gets and lists payment terms", async () => {
    const one = await get("/finance/payment-terms/NET30-2%2F10");
    expect(one.statusCode).toBe(200);
    const all = await get("/finance/payment-terms");
    expect(all.statusCode).toBe(200);
    expect(all.json().length).toBeGreaterThan(0);
  });

  it("404s on unknown payment term", async () => {
    const res = await get("/finance/payment-terms/DOES-NOT-EXIST");
    expect(res.statusCode).toBe(404);
  });

  // =========================================================================
  // Isolation & RBAC
  // =========================================================================

  it("isolates cost centers across tenants", async () => {
    const res = await get("/finance/cost-centers/CC-OPS", otherToken);
    expect(res.statusCode).toBe(404);
  });

  it("requires finance.configure for writes (read-only user 403)", async () => {
    const { provisionInternalUser } = await import("./helpers.js");
    const other = (await pool.query(`SELECT id FROM tenants WHERE code = $1`, [OTHER_TENANT_CODE])).rows[0];
    const email = "reader@wave-md1.local";
    await provisionInternalUser({
      tenantId: other.id,
      email,
      password: "Reader12345!",
      roleCode: "FIN-READER",
      permissionCodes: ["finance.read"],
    });
    const readerLogin = await login(app, OTHER_TENANT_CODE, email, "Reader12345!");
    expect(readerLogin.statusCode).toBe(200);
    const readerToken = readerLogin.body.accessToken;
    const denied = await post("/finance/cost-centers", { code: "X", name: "X", type: "cost", effectiveFrom: TODAY }, readerToken);
    expect(denied.statusCode).toBe(403);
    const allowedRead = await get("/finance/cost-centers", readerToken);
    expect(allowedRead.statusCode).toBe(200);
  });

  it("journal_lines accepts the cost_center FK (FK constraint exists)", async () => {
    const cc = await get("/finance/cost-centers/CC-OPS");
    const ccId = cc.json().id;
    const fk = (
      await pool.query(
        `SELECT conname FROM pg_constraint WHERE conrelid = 'journal_lines'::regclass AND conname = 'fk_journal_lines_cost_center'`,
      )
    ).rows;
    expect(fk.length).toBe(1);
    // The FK resolves to the created cost center.
    const valid = await pool.query(`SELECT id FROM finance_cost_centers WHERE id = $1`, [ccId]);
    expect(valid.rows.length).toBe(1);
  });
});
