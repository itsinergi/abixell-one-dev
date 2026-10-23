import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../../src/app.js";
import { pool } from "../../src/infrastructure/persistence/db.js";
import {
  SAK_EMKM_TEMPLATE,
  SAK_UMUM_TEMPLATE,
} from "../../src/modules/accounting/kernel/domain/coa-templates.js";
import type { ChartOfAccounts } from "../../src/modules/accounting/kernel/domain/accounting-kernel.entity.js";
import {
  activateAllModules,
  authHeader,
  bootstrapTenant,
  createReadOnlyRole,
  login,
  provisionFirstAdmin,
  createInternalUser,
} from "./helpers.js";

/**
 * Wave A6 — Chart of Accounts Builder HTTP Routes (Phase 2).
 *
 * Covers draft COA lifecycle via HTTP:
 *   - POST /accounting/charts (draft shell)
 *   - POST /accounting/charts/instantiate (SAK_UMUM / SAK_EMKM template + accounts)
 *   - GET /accounting/charts (list)
 *   - POST /accounting/charts/:id/approve (draft → approved, maker-checker)
 */

const TENANT = `coa-builder-${Date.now()}`;

describe("Accounting Kernel HTTP Routes — COA Builder (Wave A6)", () => {
  const app = buildApp();

  let tenantId: string;
  let legalEntityId: string;
  let financeToken: string;
  let adminToken: string;

  const post = (url: string, token: string, payload: unknown = {}) =>
    app.inject({ method: "POST", url, headers: authHeader(token), payload });
  const get = (url: string, token: string) =>
    app.inject({ method: "GET", url, headers: authHeader(token) });

  beforeAll(async () => {
    const tenant = await bootstrapTenant(app, TENANT, "COA Builder Test");
    tenantId = tenant.id;

    await activateAllModules(tenantId);
    await provisionFirstAdmin({ tenantId, email: "admin@coa-builder.local", password: "Admin12345!" });
    adminToken = (await login(app, TENANT, "admin@coa-builder.local", "Admin12345!")).body.accessToken;

    await createReadOnlyRole(tenantId, "COA_BUILDER", [
      "finance.accounting.configure",
      "finance.accounting.read",
      "finance.accounting.approve",
    ]);
    await createInternalUser(app, adminToken, {
      email: "finance@coa-builder.local",
      fullName: "Finance User",
      password: "Finance12345!",
      roleCode: "COA_BUILDER",
      scopeType: "tenant",
    });

    financeToken = (await login(app, TENANT, "finance@coa-builder.local", "Finance12345!")).body.accessToken;

    const leRes = await pool.query(
      `INSERT INTO legal_entities (tenant_id, name) VALUES ($1, 'COA Builder LE') RETURNING id`,
      [tenantId],
    );
    legalEntityId = leRes.rows[0].id;
  });

  afterAll(async () => {
    await pool.query(`DELETE FROM tenants WHERE code = $1`, [TENANT]);
    await app.close();
  });

  describe("POST /accounting/charts (draft shell)", () => {
    it("creates a draft COA without accounts", async () => {
      const res = await post("/accounting/charts", financeToken, {
        legalEntityId,
        coaVersionCode: "COA-SHELL-1",
        coaVersionDate: "2026-01-01",
        templateType: null,
      });
      expect(res.statusCode).toBe(201);
      const chart = res.json();
      expect(chart.coaStatus).toBe("draft");
      expect(chart.templateType).toBeNull();
    });

    it("rejects invalid templateType", async () => {
      const res = await post("/accounting/charts", financeToken, {
        legalEntityId,
        coaVersionCode: "COA-BAD",
        coaVersionDate: "2026-01-01",
        templateType: "INVALID",
      });
      expect(res.statusCode).toBe(400);
    });
  });

  describe("POST /accounting/charts/instantiate (SAK_EMKM)", () => {
    it("creates draft COA with full account tree from template", async () => {
      const res = await post("/accounting/charts/instantiate", financeToken, {
        legalEntityId,
        coaVersionCode: "COA-EMKM-1",
        coaVersionDate: "2026-01-01",
        templateType: "SAK_EMKM",
      });
      expect(res.statusCode).toBe(201);
      const { chart, accounts } = res.json();
      expect(chart.coaStatus).toBe("draft");
      expect(chart.templateType).toBe("SAK_EMKM");
      expect(accounts).toHaveLength(SAK_EMKM_TEMPLATE.length);
    });

    it("creates draft COA with full account tree from SAK_UMUM template", async () => {
      const res = await post("/accounting/charts/instantiate", financeToken, {
        legalEntityId,
        coaVersionCode: "COA-UMUM-1",
        coaVersionDate: "2026-01-01",
        templateType: "SAK_UMUM",
      });
      expect(res.statusCode).toBe(201);
      const { chart, accounts } = res.json();
      expect(chart.templateType).toBe("SAK_UMUM");
      expect(accounts).toHaveLength(SAK_UMUM_TEMPLATE.length);
    });
  });

  describe("GET /accounting/charts", () => {
    it("lists all COAs for the tenant", async () => {
      const res = await get("/accounting/charts", financeToken);
      expect(res.statusCode).toBe(200);
      const charts = res.json() as ChartOfAccounts[];
      expect(charts.length).toBeGreaterThanOrEqual(2);
      expect(charts.every((c) => c.coaStatus === "draft")).toBe(true);
    });

    it("filters by legalEntityId", async () => {
      const res = await get(`/accounting/charts?legalEntityId=${legalEntityId}`, financeToken);
      expect(res.statusCode).toBe(200);
      expect(res.json().length).toBeGreaterThanOrEqual(2);
    });
  });

  describe("POST /accounting/charts/:id/approve (draft → approved)", () => {
    it("rejects self-approval (maker-checker)", async () => {
      const listRes = await get("/accounting/charts", financeToken);
      const draftChart = (listRes.json() as ChartOfAccounts[]).find((c) => c.coaStatus === "draft");
      expect(draftChart).toBeDefined();

      // financeToken created the charts; same user must not approve.
      const res = await post(`/accounting/charts/${draftChart.id}/approve`, financeToken);
      expect(res.statusCode).toBe(409);
    });

    it("approves a draft COA via a different user", async () => {
      const listRes = await get("/accounting/charts", financeToken);
      const draftChart = (listRes.json() as ChartOfAccounts[]).find((c) => c.coaStatus === "draft");
      expect(draftChart).toBeDefined();

      const res = await post(`/accounting/charts/${draftChart.id}/approve`, adminToken);
      expect(res.statusCode).toBe(200);
      expect(res.json().coaStatus).toBe("approved");
      expect(res.json().approvedBy).toBeTruthy();
    });

    it("rejects approving an already-approved COA", async () => {
      const listRes = await get("/accounting/charts", financeToken);
      const approvedChart = (listRes.json() as ChartOfAccounts[]).find((c) => c.coaStatus === "approved");
      expect(approvedChart).toBeDefined();

      const res = await post(`/accounting/charts/${approvedChart.id}/approve`, adminToken);
      expect(res.statusCode).toBe(409);
    });
  });
});
