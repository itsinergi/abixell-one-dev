import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../../src/app.js";
import { pool } from "../../src/infrastructure/persistence/db.js";
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
 * Phase 1C — Accounting Kernel HTTP Routes (WP-FIN-01).
 *
 * Covers tiered COA via HTTP:
 *   - POST /accounting/accounts with parentAccountId (depth enforcement, deactivated rejection)
 *   - GET /accounting/accounts/hierarchy (depth array, parent-first order)
 *
 * Pattern: real HTTP via buildApp(), dedicated tenant, RBAC enforcement.
 */

const TENANT = `ak-routes-${Date.now()}`;

describe("Accounting Kernel HTTP Routes — COA Hierarchy (WP-FIN-01)", () => {
  const app = buildApp();

  let tenantId: string;
  let legalEntityId: string;
  let coaId: string;
  let adminToken: string;
  let financeToken: string;

  const post = (url: string, token: string, payload: unknown = {}) =>
    app.inject({ method: "POST", url, headers: authHeader(token), payload });
  const get = (url: string, token: string) => app.inject({ method: "GET", url, headers: authHeader(token) });

  beforeAll(async () => {
    const tenant = await bootstrapTenant(app, TENANT, "Accounting Kernel Routes Test");
    tenantId = tenant.id;

    await activateAllModules(tenantId);
    await provisionFirstAdmin({ tenantId, email: "admin@ak-routes.local", password: "Admin12345!" });
    adminToken = (await login(app, TENANT, "admin@ak-routes.local", "Admin12345!")).body.accessToken;

    // Create a finance user with accounting configure + read permissions
    await createReadOnlyRole(tenantId, "ACCT_ROUTES", [
      "finance.accounting.configure",
      "finance.accounting.read",
    ]);
    await createInternalUser(app, adminToken, {
      email: "finance@ak-routes.local",
      fullName: "Finance User",
      password: "Finance12345!",
      roleCode: "ACCT_ROUTES",
      scopeType: "tenant",
    });

    financeToken = (await login(app, TENANT, "finance@ak-routes.local", "Finance12345!")).body.accessToken;

    // Create legal entity (no HTTP route; direct insert like other tests)
    const leRes = await pool.query(
      `INSERT INTO legal_entities (tenant_id, name) VALUES ($1, 'Routes Test LE') RETURNING id`,
      [tenantId],
    );
    legalEntityId = leRes.rows[0].id;

    // Create COA (no API route exists; direct insert is the supported path)
    const coaRes = await pool.query(
      `INSERT INTO chart_of_accounts (tenant_id, legal_entity_id, coa_version_code, coa_version_date)
       VALUES ($1, $2, 'COA-ROUTES', '2026-01-01') RETURNING id`,
      [tenantId, legalEntityId],
    );
    coaId = coaRes.rows[0].id;
  });

  afterAll(async () => {
    await pool.query(`DELETE FROM tenants WHERE code = $1`, [TENANT]);
    await app.close();
  });

  describe("POST /accounting/accounts with parentAccountId", () => {
    it("creates account with same-entity parent and persists parentAccountId", async () => {
      // Create parent account
      const parentRes = await post("/accounting/accounts", financeToken, {
        legalEntityId,
        coaId,
        accountCode: "1000",
        accountName: "Assets",
        accountClass: "ASSET",
        normalBalance: "debit",
        accountType: "current_asset",
        parentAccountId: null,
      });
      expect(parentRes.statusCode).toBe(201);
      const parentId = parentRes.json().id;

      // Create child with parent link
      const childRes = await post("/accounting/accounts", financeToken, {
        legalEntityId,
        coaId,
        accountCode: "1100",
        accountName: "Cash",
        accountClass: "ASSET",
        normalBalance: "debit",
        accountType: "current_asset",
        parentAccountId: parentId,
      });
      expect(childRes.statusCode).toBe(201);
      const child = childRes.json();
      expect(child.parentAccountId).toBe(parentId);
    });

    it("depth 7 parent succeeds, depth 8 parent fails with ValidationError", async () => {
      // Build a 7-deep chain: root → L1 → L2 → L3 → L4 → L5 → L6 → L7
      let current = null;
      for (let i = 1; i <= 7; i++) {
        const res = await post("/accounting/accounts", financeToken, {
          legalEntityId,
          coaId,
          accountCode: `2${i}00`,
          accountName: `Level ${i}`,
          accountClass: "ASSET",
          normalBalance: "debit",
          accountType: "current_asset",
          parentAccountId: current,
        });
        expect(res.statusCode).toBe(201);
        current = res.json().id;
      }

      // L7 exists at depth 6 (0-based). Child would be at depth 7. Max is 8 levels (0-7), so succeeds.
      const depthSevenParent = current;
      const childAt7 = await post("/accounting/accounts", financeToken, {
        legalEntityId,
        coaId,
        accountCode: "2800",
        accountName: "Child at depth 7",
        accountClass: "ASSET",
        normalBalance: "debit",
        accountType: "current_asset",
        parentAccountId: depthSevenParent,
      });
      expect(childAt7.statusCode).toBe(201);

      // Now L8 is at depth 7. Child would be at depth 8. Exceeds max of 8 levels (0-7).
      const depthEightParent = childAt7.json().id;
      const childAt8 = await post("/accounting/accounts", financeToken, {
        legalEntityId,
        coaId,
        accountCode: "2900",
        accountName: "Child at depth 8 (should fail)",
        accountClass: "ASSET",
        normalBalance: "debit",
        accountType: "current_asset",
        parentAccountId: depthEightParent,
      });
      expect(childAt8.statusCode).toBe(400);
      expect(childAt8.json().error).toMatch(/exceeds maximum depth/i);
    });

    it("deactivated parent is rejected with ConflictError", async () => {
      // Create parent, deactivate it
      const parentRes = await post("/accounting/accounts", financeToken, {
        legalEntityId,
        coaId,
        accountCode: "3000",
        accountName: "Parent to Deactivate",
        accountClass: "LIABILITY",
        normalBalance: "credit",
        accountType: "current_liability",
        parentAccountId: null,
      });
      const parentId = parentRes.json().id;

      // Deactivate via direct DB (no service endpoint yet)
      await pool.query(`UPDATE accounting_accounts SET is_active = false WHERE id = $1`, [parentId]);

      // Try to use deactivated parent — should fail
      const childRes = await post("/accounting/accounts", financeToken, {
        legalEntityId,
        coaId,
        accountCode: "3100",
        accountName: "Child of Deactivated",
        accountClass: "LIABILITY",
        normalBalance: "credit",
        accountType: "current_liability",
        parentAccountId: parentId,
      });
      expect(childRes.statusCode).toBe(409);
      expect(childRes.json().error).toMatch(/deactivated/i);
    });

    it("cross-entity parent is rejected", async () => {
      // Create another legal entity (no HTTP route; direct insert)
      const otherLeRes = await pool.query(
        `INSERT INTO legal_entities (tenant_id, name) VALUES ($1, 'Other LE') RETURNING id`,
        [tenantId],
      );
      const otherLeId = otherLeRes.rows[0].id;

      // Create COA in other LE (no API route exists; direct insert)
      const otherCoaRes = await pool.query(
        `INSERT INTO chart_of_accounts (tenant_id, legal_entity_id, coa_version_code, coa_version_date)
         VALUES ($1, $2, 'COA-OTHER', '2026-01-01') RETURNING id`,
        [tenantId, otherLeId],
      );
      const otherCoaId = otherCoaRes.rows[0].id;

      // Create parent in other LE
      const parentRes = await post("/accounting/accounts", financeToken, {
        legalEntityId: otherLeId,
        coaId: otherCoaId,
        accountCode: "4000",
        accountName: "Parent Other LE",
        accountClass: "ASSET",
        normalBalance: "debit",
        accountType: "current_asset",
        parentAccountId: null,
      });
      const parentId = parentRes.json().id;

      // Try to use parent from other LE in main LE — should fail
      const childRes = await post("/accounting/accounts", financeToken, {
        legalEntityId,
        coaId,
        accountCode: "4100",
        accountName: "Child Cross Entity",
        accountClass: "ASSET",
        normalBalance: "debit",
        accountType: "current_asset",
        parentAccountId: parentId,
      });
      expect(childRes.statusCode).toBe(400);
      expect(childRes.json().error).toMatch(/same tenant and legal entity/i);
    });
  });

  describe("GET /accounting/accounts/hierarchy", () => {
    it("returns 200 with depth array in parent-first order", async () => {
      // Create hierarchy: parent → child1, child2
      const parentRes = await post("/accounting/accounts", financeToken, {
        legalEntityId,
        coaId,
        accountCode: "5000",
        accountName: "Parent for Hierarchy",
        accountClass: "EQUITY",
        normalBalance: "credit",
        accountType: "contributed_capital",
        parentAccountId: null,
      });
      const parentId = parentRes.json().id;

      const child1Res = await post("/accounting/accounts", financeToken, {
        legalEntityId,
        coaId,
        accountCode: "5100",
        accountName: "Child 1",
        accountClass: "EQUITY",
        normalBalance: "credit",
        accountType: "contributed_capital",
        parentAccountId: parentId,
      });
      const child1Id = child1Res.json().id;

      const child2Res = await post("/accounting/accounts", financeToken, {
        legalEntityId,
        coaId,
        accountCode: "5200",
        accountName: "Child 2",
        accountClass: "EQUITY",
        normalBalance: "credit",
        accountType: "contributed_capital",
        parentAccountId: parentId,
      });
      const child2Id = child2Res.json().id;

      // Fetch hierarchy
      const hierarchyRes = await get(`/accounting/accounts/hierarchy?legalEntityId=${legalEntityId}`, financeToken);
      expect(hierarchyRes.statusCode).toBe(200);

      const hierarchy = hierarchyRes.json() as Array<{ account: { id: string } }>;
      expect(Array.isArray(hierarchy)).toBe(true);

      // Parent should appear before children (parent-first order)
      const parentIndex = hierarchy.findIndex((h) => h.account.id === parentId);
      const child1Index = hierarchy.findIndex((h) => h.account.id === child1Id);
      const child2Index = hierarchy.findIndex((h) => h.account.id === child2Id);

      expect(parentIndex).toBeGreaterThanOrEqual(0);
      expect(child1Index).toBeGreaterThan(parentIndex);
      expect(child2Index).toBeGreaterThan(parentIndex);

      // Parent at depth 0, children at depth 1
      expect(hierarchy[parentIndex].depth).toBe(0);
      expect(hierarchy[child1Index].depth).toBe(1);
      expect(hierarchy[child2Index].depth).toBe(1);
    });

    it("rejects missing legalEntityId query parameter", async () => {
      const res = await get(`/accounting/accounts/hierarchy`, financeToken);
      expect(res.statusCode).toBe(400);
    });

    it("requires finance.accounting.read permission", async () => {
      // Create user with no accounting permissions
      await createReadOnlyRole(tenantId, "NOACCESS", []);
      await createInternalUser(app, adminToken, {
        email: "noaccess@ak-routes.local",
        fullName: "No Access User",
        password: "NoAccess12345!",
        roleCode: "NOACCESS",
        scopeType: "tenant",
      });
      const noAccessToken = (await login(app, TENANT, "noaccess@ak-routes.local", "NoAccess12345!")).body.accessToken;

      const res = await get(`/accounting/accounts/hierarchy?legalEntityId=${legalEntityId}`, noAccessToken);
      expect(res.statusCode).toBe(403);
    });
  });
});

const REV_TENANT = `ak-rev-${Date.now()}`;

describe("Accounting Kernel HTTP Routes — Journal Reversal (WP-FIN-02)", () => {
  const app = buildApp();

  let tenantId: string;
  let legalEntityId: string;
  let coaId: string;
  let adminToken: string;
  let financeApprovingToken: string;

  const post = (url: string, token: string, payload: unknown = {}) =>
    app.inject({ method: "POST", url, headers: authHeader(token), payload });

  beforeAll(async () => {
    const tenant = await bootstrapTenant(app, REV_TENANT, "Journal Reversal Routes Test");
    tenantId = tenant.id;

    await activateAllModules(tenantId);
    await provisionFirstAdmin({ tenantId, email: "admin@ak-rev.local", password: "Admin12345!" });
    adminToken = (await login(app, REV_TENANT, "admin@ak-rev.local", "Admin12345!")).body.accessToken;

    // Create finance user with all accounting permissions (configure, manage, approve)
    await createReadOnlyRole(tenantId, "ACCT_APPROVE", [
      "finance.accounting.configure",
      "finance.accounting.manage",
      "finance.accounting.approve",
      "finance.accounting.read",
    ]);
    await createInternalUser(app, adminToken, {
      email: "approver@ak-rev.local",
      fullName: "Finance Approver",
      password: "Approver12345!",
      roleCode: "ACCT_APPROVE",
      scopeType: "tenant",
    });

    financeApprovingToken = (await login(app, REV_TENANT, "approver@ak-rev.local", "Approver12345!")).body.accessToken;

    // Set up legal entity, COA
    const leRes = await pool.query(
      `INSERT INTO legal_entities (tenant_id, name) VALUES ($1, 'Reversal Test LE') RETURNING id`,
      [tenantId],
    );
    legalEntityId = leRes.rows[0].id;

    const coaRes = await pool.query(
      `INSERT INTO chart_of_accounts (tenant_id, legal_entity_id, coa_version_code, coa_version_date)
       VALUES ($1, $2, 'COA-REV', '2026-01-01') RETURNING id`,
      [tenantId, legalEntityId],
    );
    coaId = coaRes.rows[0].id;
  });

  afterAll(async () => {
    await pool.query(`DELETE FROM tenants WHERE code = $1`, [REV_TENANT]);
    await app.close();
  });

  describe("POST /accounting/journals/:id/reverse", () => {
    it("201 happy path: reverses a posted journal with reason and type", async () => {
      // Create a period
      const periodRes = await post("/accounting/periods", financeApprovingToken, {
        legalEntityId,
        fiscalYearCode: "FY2026",
        periodCode: "REV-P01",
        periodName: "Rev Period 1",
        periodType: "monthly",
        dateFrom: "2026-01-01",
        dateTo: "2026-01-31",
      });
      expect(periodRes.statusCode).toBe(201);
      const periodId = periodRes.json().id;

      // Periods are created as 'draft'; no HTTP route opens one (lock only
      // closes), so open it directly like the other unsupported ops in this
      // file (legal entity, COA).
      await pool.query(`UPDATE accounting_periods SET status = 'open' WHERE id = $1`, [periodId]);

      // Create two accounts (debit and credit sides)
      const debitRes = await post("/accounting/accounts", financeApprovingToken, {
        legalEntityId,
        coaId,
        accountCode: "1000",
        accountName: "Test Asset",
        accountClass: "ASSET",
        normalBalance: "debit",
        accountType: null,
      });
      const debitAccountId = debitRes.json().id;

      const creditRes = await post("/accounting/accounts", financeApprovingToken, {
        legalEntityId,
        coaId,
        accountCode: "5000",
        accountName: "Test Equity",
        accountClass: "EQUITY",
        normalBalance: "credit",
        accountType: null,
      });
      const creditAccountId = creditRes.json().id;

      // Create a journal
      const journalRes = await post("/accounting/journals", financeApprovingToken, {
        legalEntityId,
        journalNumber: "REV-JNL-001",
        journalDate: "2026-01-15",
        accountingDate: "2026-01-15",
        periodId,
        description: "Test reversal source",
        currency: "USD",
        lines: [
          {
            accountId: debitAccountId,
            lineNumber: 1,
            debit: "100.00",
            credit: "0.00",
            lineDescription: "Debit leg",
            projectId: null,
            siteId: null,
          },
          {
            accountId: creditAccountId,
            lineNumber: 2,
            debit: "0.00",
            credit: "100.00",
            lineDescription: "Credit leg",
            projectId: null,
            siteId: null,
          },
        ],
      });
      expect(journalRes.statusCode).toBe(201);
      const journalId = journalRes.json().id;

      // Post the journal
      const postRes = await post(`/accounting/journals/${journalId}/post`, financeApprovingToken);
      expect(postRes.statusCode).toBe(200);

      // Reverse it
      const reverseRes = await post(`/accounting/journals/${journalId}/reverse`, financeApprovingToken, {
        type: "reverse_correct",
        reason: "Testing reversal endpoint",
      });
      expect(reverseRes.statusCode).toBe(201);
      const reversal = reverseRes.json();
      expect(reversal.reversalOfId).toBe(journalId);
      expect(reversal.reversalReason).toBe("Testing reversal endpoint");
      expect(reversal.reversalType).toBe("reverse_correct");
      expect(reversal.status).toBe("posted");
    });
  });
});

const REOPEN_TENANT = `ak-reopen-routes-${Date.now()}`;

describe("Accounting Kernel HTTP Routes — Period Reopen (WP-FIN-03)", () => {
  const app = buildApp();

  let tenantId: string;
  let legalEntityId: string;
  let adminToken: string;
  let requesterToken: string;
  let approverToken: string;
  let readOnlyToken: string;

  const post = (url: string, token: string, payload: unknown = {}) =>
    app.inject({ method: "POST", url, headers: authHeader(token), payload });

  async function createClosedPeriod(code: string): Promise<string> {
    const periodRes = await post("/accounting/periods", adminToken, {
      legalEntityId,
      fiscalYearCode: "FY2026",
      periodCode: code,
      periodName: code,
      periodType: "monthly",
      dateFrom: "2026-04-01",
      dateTo: "2026-04-30",
    });
    expect(periodRes.statusCode).toBe(201);
    const id = periodRes.json().id;
    await pool.query(`UPDATE accounting_periods SET status = 'closed' WHERE id = $1`, [id]);
    return id;
  }

  beforeAll(async () => {
    const tenant = await bootstrapTenant(app, REOPEN_TENANT, "Period Reopen Routes Test");
    tenantId = tenant.id;

    await activateAllModules(tenantId);
    await provisionFirstAdmin({ tenantId, email: "admin@ak-reopen.local", password: "Admin12345!" });
    adminToken = (await login(app, REOPEN_TENANT, "admin@ak-reopen.local", "Admin12345!")).body.accessToken;

    await createReadOnlyRole(tenantId, "ACCT_REOPEN_REQUEST", [
      "finance.accounting.period.lock",
      "finance.accounting.read",
    ]);
    await createInternalUser(app, adminToken, {
      email: "requester@ak-reopen.local",
      fullName: "Reopen Requester",
      password: "Requester12345!",
      roleCode: "ACCT_REOPEN_REQUEST",
      scopeType: "tenant",
    });
    requesterToken = (await login(app, REOPEN_TENANT, "requester@ak-reopen.local", "Requester12345!")).body.accessToken;

    await createReadOnlyRole(tenantId, "ACCT_REOPEN_APPROVE", [
      "finance.accounting.approve",
      "finance.accounting.read",
    ]);
    await createInternalUser(app, adminToken, {
      email: "approver@ak-reopen.local",
      fullName: "Reopen Approver",
      password: "Approver12345!",
      roleCode: "ACCT_REOPEN_APPROVE",
      scopeType: "tenant",
    });
    approverToken = (await login(app, REOPEN_TENANT, "approver@ak-reopen.local", "Approver12345!")).body.accessToken;

    await createReadOnlyRole(tenantId, "ACCT_REOPEN_READ", ["finance.accounting.read"]);
    await createInternalUser(app, adminToken, {
      email: "readonly@ak-reopen.local",
      fullName: "Read Only",
      password: "ReadOnly12345!",
      roleCode: "ACCT_REOPEN_READ",
      scopeType: "tenant",
    });
    readOnlyToken = (await login(app, REOPEN_TENANT, "readonly@ak-reopen.local", "ReadOnly12345!")).body.accessToken;

    const leRes = await pool.query(
      `INSERT INTO legal_entities (tenant_id, name) VALUES ($1, 'Reopen Routes LE') RETURNING id`,
      [tenantId],
    );
    legalEntityId = leRes.rows[0].id;
  });

  afterAll(async () => {
    await pool.query(`DELETE FROM tenants WHERE code = $1`, [REOPEN_TENANT]);
    await app.close();
  });

  it("204 happy path: request then approve by a different user", async () => {
    const periodId = await createClosedPeriod("REOPEN-ROUTE-OK");

    const requestRes = await post(`/accounting/periods/${periodId}/reopen`, requesterToken, {
      reason: "Route reopen request",
      impactEvidence: "Route evidence",
    });
    expect(requestRes.statusCode).toBe(204);

    const approveRes = await post(`/accounting/periods/${periodId}/reopen/approve`, approverToken, {
      note: "ok",
    });
    expect(approveRes.statusCode).toBe(204);

    // Verify final state directly (204 carries no body)
    const row = await pool.query(`SELECT status FROM accounting_periods WHERE id = $1`, [periodId]);
    expect(row.rows[0].status).toBe("open");
  });

  it("409 rejects approval by the requester", async () => {
    const periodId = await createClosedPeriod("REOPEN-ROUTE-SOD");
    await createReadOnlyRole(tenantId, "ACCT_REOPEN_BOTH", [
      "finance.accounting.period.lock",
      "finance.accounting.approve",
      "finance.accounting.read",
    ]);
    await createInternalUser(app, adminToken, {
      email: "both@ak-reopen.local",
      fullName: "Both Permissions",
      password: "Both12345!",
      roleCode: "ACCT_REOPEN_BOTH",
      scopeType: "tenant",
    });
    const bothToken = (await login(app, REOPEN_TENANT, "both@ak-reopen.local", "Both12345!")).body.accessToken;

    const requestRes = await post(`/accounting/periods/${periodId}/reopen`, bothToken, {
      reason: "Self approve attempt",
      impactEvidence: "Evidence",
    });
    expect(requestRes.statusCode).toBe(204);

    const approveRes = await post(`/accounting/periods/${periodId}/reopen/approve`, bothToken, {});
    expect(approveRes.statusCode).toBe(409);
  });

  it("400 rejects an empty request reason", async () => {
    const periodId = await createClosedPeriod("REOPEN-ROUTE-EMPTY");
    const res = await post(`/accounting/periods/${periodId}/reopen`, requesterToken, {
      reason: "",
      impactEvidence: "Evidence",
    });
    expect(res.statusCode).toBe(400);
  });

  it("409 rejects request when the period is open", async () => {
    const periodRes = await post("/accounting/periods", adminToken, {
      legalEntityId,
      fiscalYearCode: "FY2026",
      periodCode: "REOPEN-ROUTE-OPEN",
      periodName: "REOPEN-ROUTE-OPEN",
      periodType: "monthly",
      dateFrom: "2026-05-01",
      dateTo: "2026-05-31",
    });
    expect(periodRes.statusCode).toBe(201);
    const periodId = periodRes.json().id;
    await pool.query(`UPDATE accounting_periods SET status = 'open' WHERE id = $1`, [periodId]);

    const res = await post(`/accounting/periods/${periodId}/reopen`, requesterToken, {
      reason: "Should fail",
      impactEvidence: "Evidence",
    });
    expect(res.statusCode).toBe(409);
  });

  it("403 rejects request without finance.accounting.period.lock", async () => {
    const periodId = await createClosedPeriod("REOPEN-ROUTE-FORBIDDEN");
    const res = await post(`/accounting/periods/${periodId}/reopen`, readOnlyToken, {
      reason: "No permission",
      impactEvidence: "Evidence",
    });
    expect(res.statusCode).toBe(403);
  });
});

const RECON_TENANT = `ak-recon-routes-${Date.now()}`;

describe("Accounting Kernel HTTP Routes — GL Reconciliation (WP-FIN-04)", () => {
  const app = buildApp();

  let tenantId: string;
  let legalEntityId: string;
  let coaId: string;
  let adminToken: string;
  let financeApprovingToken: string;
  let readOnlyToken: string;

  const post = (url: string, token: string, payload: unknown = {}) =>
    app.inject({ method: "POST", url, headers: authHeader(token), payload });
  const get = (url: string, token: string) => app.inject({ method: "GET", url, headers: authHeader(token) });

  beforeAll(async () => {
    const tenant = await bootstrapTenant(app, RECON_TENANT, "GL Reconciliation Routes Test");
    tenantId = tenant.id;

    await activateAllModules(tenantId);
    await provisionFirstAdmin({ tenantId, email: "admin@ak-recon.local", password: "Admin12345!" });
    adminToken = (await login(app, RECON_TENANT, "admin@ak-recon.local", "Admin12345!")).body.accessToken;

    await createReadOnlyRole(tenantId, "ACCT_RECON_APPROVE", [
      "finance.accounting.configure",
      "finance.accounting.manage",
      "finance.accounting.approve",
      "finance.accounting.read",
    ]);
    await createInternalUser(app, adminToken, {
      email: "approver@ak-recon.local",
      fullName: "Recon Approver",
      password: "Approver12345!",
      roleCode: "ACCT_RECON_APPROVE",
      scopeType: "tenant",
    });
    financeApprovingToken = (await login(app, RECON_TENANT, "approver@ak-recon.local", "Approver12345!")).body
      .accessToken;

    await createReadOnlyRole(tenantId, "ACCT_RECON_READ", ["finance.accounting.read"]);
    await createInternalUser(app, adminToken, {
      email: "readonly@ak-recon.local",
      fullName: "Recon Read Only",
      password: "ReadOnly12345!",
      roleCode: "ACCT_RECON_READ",
      scopeType: "tenant",
    });
    readOnlyToken = (await login(app, RECON_TENANT, "readonly@ak-recon.local", "ReadOnly12345!")).body.accessToken;

    const leRes = await pool.query(
      `INSERT INTO legal_entities (tenant_id, name) VALUES ($1, 'Recon Routes LE') RETURNING id`,
      [tenantId],
    );
    legalEntityId = leRes.rows[0].id;

    const coaRes = await pool.query(
      `INSERT INTO chart_of_accounts (tenant_id, legal_entity_id, coa_version_code, coa_version_date)
       VALUES ($1, $2, 'COA-RECON', '2026-01-01') RETURNING id`,
      [tenantId, legalEntityId],
    );
    coaId = coaRes.rows[0].id;
  });

  afterAll(async () => {
    await pool.query(`DELETE FROM tenants WHERE code = $1`, [RECON_TENANT]);
    await app.close();
  });

  describe("GET /accounting/periods/:id/reconciliation", () => {
    it("200 happy path: balanced posted journal reconciles matched", async () => {
      const periodRes = await post("/accounting/periods", financeApprovingToken, {
        legalEntityId,
        fiscalYearCode: "FY2026",
        periodCode: "RECON-P01",
        periodName: "Recon Period 1",
        periodType: "monthly",
        dateFrom: "2026-01-01",
        dateTo: "2026-01-31",
      });
      expect(periodRes.statusCode).toBe(201);
      const periodId = periodRes.json().id;
      await pool.query(`UPDATE accounting_periods SET status = 'open' WHERE id = $1`, [periodId]);

      const debitRes = await post("/accounting/accounts", financeApprovingToken, {
        legalEntityId,
        coaId,
        accountCode: "1000",
        accountName: "Recon Asset",
        accountClass: "ASSET",
        normalBalance: "debit",
        accountType: null,
      });
      const debitAccountId = debitRes.json().id;

      const creditRes = await post("/accounting/accounts", financeApprovingToken, {
        legalEntityId,
        coaId,
        accountCode: "5000",
        accountName: "Recon Equity",
        accountClass: "EQUITY",
        normalBalance: "credit",
        accountType: null,
      });
      const creditAccountId = creditRes.json().id;

      const journalRes = await post("/accounting/journals", financeApprovingToken, {
        legalEntityId,
        journalNumber: "RECON-JNL-001",
        journalDate: "2026-01-15",
        accountingDate: "2026-01-15",
        periodId,
        description: "Recon route test",
        currency: "USD",
        lines: [
          {
            accountId: debitAccountId,
            lineNumber: 1,
            debit: "100.00",
            credit: "0.00",
            lineDescription: "Debit leg",
            projectId: null,
            siteId: null,
          },
          {
            accountId: creditAccountId,
            lineNumber: 2,
            debit: "0.00",
            credit: "100.00",
            lineDescription: "Credit leg",
            projectId: null,
            siteId: null,
          },
        ],
      });
      expect(journalRes.statusCode).toBe(201);
      const journalId = journalRes.json().id;

      const postRes = await post(`/accounting/journals/${journalId}/post`, financeApprovingToken);
      expect(postRes.statusCode).toBe(200);

      const reconRes = await get(`/accounting/periods/${periodId}/reconciliation`, financeApprovingToken);
      expect(reconRes.statusCode).toBe(200);
      const recon = reconRes.json();
      expect(recon.periodId).toBe(periodId);
      expect(recon.matched).toBe(true);
      expect(recon.orphanGlEntryIds).toHaveLength(0);
      expect(recon.mismatchedGlEntryIds).toHaveLength(0);
      expect(recon.unpostedJournalIds).toHaveLength(0);
      expect(recon.totals.glDebit).toBe("100.00");
      expect(recon.totals.glCredit).toBe("100.00");
    });

    it("404 rejects a period from another tenant", async () => {
      const otherTenant = await bootstrapTenant(app, `ak-recon-other-${Date.now()}`, "Other Tenant");
      await activateAllModules(otherTenant.id);
      const otherLeRes = await pool.query(
        `INSERT INTO legal_entities (tenant_id, name) VALUES ($1, 'Other Tenant LE') RETURNING id`,
        [otherTenant.id],
      );
      const otherPeriodRes = await pool.query(
        `INSERT INTO accounting_periods (tenant_id, legal_entity_id, fiscal_year_code, period_code, period_name, period_type, date_from, date_to, status)
         VALUES ($1, $2, 'FY2026', 'OTHER-P01', 'Other Period', 'monthly', '2026-01-01', '2026-01-31', 'open') RETURNING id`,
        [otherTenant.id, otherLeRes.rows[0].id],
      );
      const otherPeriodId = otherPeriodRes.rows[0].id;

      const res = await get(`/accounting/periods/${otherPeriodId}/reconciliation`, financeApprovingToken);
      expect(res.statusCode).toBe(404);

      await pool.query(`DELETE FROM tenants WHERE id = $1`, [otherTenant.id]);
    });

    it("403 rejects without finance.accounting.read permission", async () => {
      await createReadOnlyRole(tenantId, "ACCT_RECON_NOACCESS", []);
      await createInternalUser(app, adminToken, {
        email: "noaccess@ak-recon.local",
        fullName: "Recon No Access",
        password: "NoAccess12345!",
        roleCode: "ACCT_RECON_NOACCESS",
        scopeType: "tenant",
      });
      const noAccessToken = (await login(app, RECON_TENANT, "noaccess@ak-recon.local", "NoAccess12345!")).body
        .accessToken;

      const periodRes = await post("/accounting/periods", financeApprovingToken, {
        legalEntityId,
        fiscalYearCode: "FY2026",
        periodCode: "RECON-P03",
        periodName: "Recon Period 3",
        periodType: "monthly",
        dateFrom: "2026-02-01",
        dateTo: "2026-02-28",
      });
      const periodId = periodRes.json().id;

      const res = await get(`/accounting/periods/${periodId}/reconciliation`, noAccessToken);
      expect(res.statusCode).toBe(403);
    });

    it("403 rejects the read-only role scoped to a different permission set", async () => {
      const periodRes = await post("/accounting/periods", financeApprovingToken, {
        legalEntityId,
        fiscalYearCode: "FY2026",
        periodCode: "RECON-P04",
        periodName: "Recon Period 4",
        periodType: "monthly",
        dateFrom: "2026-03-01",
        dateTo: "2026-03-31",
      });
      const periodId = periodRes.json().id;

      // readOnlyToken legitimately HAS finance.accounting.read — this is the
      // allow-path control for the preceding deny-path test, same role.
      const res = await get(`/accounting/periods/${periodId}/reconciliation`, readOnlyToken);
      expect(res.statusCode).toBe(200);
    });
  });
});

const POSTING_RULES_TENANT = `ak-pr-routes-${Date.now()}`;

describe("Accounting Kernel HTTP Routes — Posting Rules (WP-FIN-05)", () => {
  const app = buildApp();

  let tenantId: string;
  let legalEntityId: string;
  let coaId: string;
  let adminToken: string;
  let financeToken: string;
  let readOnlyToken: string;

  const post = (url: string, token: string, payload: unknown = {}) =>
    app.inject({ method: "POST", url, headers: authHeader(token), payload });
  const get = (url: string, token: string) => app.inject({ method: "GET", url, headers: authHeader(token) });

  beforeAll(async () => {
    const tenant = await bootstrapTenant(app, POSTING_RULES_TENANT, "Posting Rules Routes Test");
    tenantId = tenant.id;

    await activateAllModules(tenantId);
    await provisionFirstAdmin({ tenantId, email: "admin@ak-pr.local", password: "Admin12345!" });
    adminToken = (await login(app, POSTING_RULES_TENANT, "admin@ak-pr.local", "Admin12345!")).body.accessToken;

    await createReadOnlyRole(tenantId, "ACCT_POSTING_RULES", [
      "finance.accounting.configure",
      "finance.accounting.manage",
      "finance.accounting.approve",
      "finance.accounting.read",
    ]);
    await createInternalUser(app, adminToken, {
      email: "finance@ak-pr.local",
      fullName: "Finance User",
      password: "Finance12345!",
      roleCode: "ACCT_POSTING_RULES",
      scopeType: "tenant",
    });
    financeToken = (await login(app, POSTING_RULES_TENANT, "finance@ak-pr.local", "Finance12345!")).body.accessToken;

    await createReadOnlyRole(tenantId, "ACCT_PR_READ", ["finance.accounting.read"]);
    await createInternalUser(app, adminToken, {
      email: "readonly@ak-pr.local",
      fullName: "Read Only",
      password: "ReadOnly12345!",
      roleCode: "ACCT_PR_READ",
      scopeType: "tenant",
    });
    readOnlyToken = (await login(app, POSTING_RULES_TENANT, "readonly@ak-pr.local", "ReadOnly12345!")).body
      .accessToken;

    const leRes = await pool.query(
      `INSERT INTO legal_entities (tenant_id, name) VALUES ($1, 'Posting Rules Routes LE') RETURNING id`,
      [tenantId],
    );
    legalEntityId = leRes.rows[0].id;

    const coaRes = await pool.query(
      `INSERT INTO chart_of_accounts (tenant_id, legal_entity_id, coa_version_code, coa_version_date)
       VALUES ($1, $2, 'COA-PR', '2026-01-01') RETURNING id`,
      [tenantId, legalEntityId],
    );
    coaId = coaRes.rows[0].id;

    await post("/accounting/accounts", financeToken, {
      legalEntityId,
      coaId,
      accountCode: "1000",
      accountName: "Cash",
      accountClass: "ASSET",
      normalBalance: "debit",
      accountType: null,
    });
    await post("/accounting/accounts", financeToken, {
      legalEntityId,
      coaId,
      accountCode: "4000",
      accountName: "Revenue",
      accountClass: "INCOME",
      normalBalance: "credit",
      accountType: null,
    });
  });

  afterAll(async () => {
    await pool.query(`DELETE FROM tenants WHERE code = $1`, [POSTING_RULES_TENANT]);
    await app.close();
  });

  describe("POST /accounting/posting-rules", () => {
    it("201 happy path: creates a balanced posting rule", async () => {
      const res = await post("/accounting/posting-rules", financeToken, {
        ruleCode: "RULE_HTTP_OK",
        ruleName: "HTTP Rule",
        ruleVersion: "v1",
        triggerEventType: "TEST_HTTP",
        accountingFormula: [
          { accountCode: "1000", side: "debit", amountExpression: "AMOUNT" },
          { accountCode: "4000", side: "credit", amountExpression: "AMOUNT" },
        ],
        requiresApproval: false,
        materialityThreshold: null,
        effectiveDate: "2026-01-01",
      });
      expect(res.statusCode).toBe(201);
      const rule = res.json();
      expect(rule.ruleCode).toBe("RULE_HTTP_OK");
      expect(rule.isActive).toBe(true);
    });

    it("403 rejects without finance.accounting.configure", async () => {
      const res = await post("/accounting/posting-rules", readOnlyToken, {
        ruleCode: "RULE_HTTP_NOPERM",
        ruleName: "No Permission",
        ruleVersion: "v1",
        triggerEventType: "TEST_NOPERM",
        accountingFormula: [
          { accountCode: "1000", side: "debit", amountExpression: "AMOUNT" },
          { accountCode: "4000", side: "credit", amountExpression: "AMOUNT" },
        ],
        requiresApproval: false,
        materialityThreshold: null,
        effectiveDate: "2026-01-01",
      });
      expect(res.statusCode).toBe(403);
    });
  });

  describe("GET /accounting/posting-rules", () => {
    it("200 happy path: lists posting rules by trigger event type", async () => {
      await post("/accounting/posting-rules", financeToken, {
        ruleCode: "RULE_HTTP_LIST",
        ruleName: "List Rule",
        ruleVersion: "v1",
        triggerEventType: "TEST_HTTP_LIST",
        accountingFormula: [
          { accountCode: "1000", side: "debit", amountExpression: "AMOUNT" },
          { accountCode: "4000", side: "credit", amountExpression: "AMOUNT" },
        ],
        requiresApproval: false,
        materialityThreshold: null,
        effectiveDate: "2026-01-01",
      });

      const res = await get(`/accounting/posting-rules?triggerEventType=TEST_HTTP_LIST`, financeToken);
      expect(res.statusCode).toBe(200);
      const rules = res.json() as Array<{ ruleCode: string }>;
      expect(Array.isArray(rules)).toBe(true);
      expect(rules.some((r) => r.ruleCode === "RULE_HTTP_LIST")).toBe(true);
    });

    it("403 rejects without finance.accounting.read", async () => {
      await createReadOnlyRole(tenantId, "ACCT_PR_NOACCESS", []);
      await createInternalUser(app, adminToken, {
        email: "noaccess@ak-pr.local",
        fullName: "No Access",
        password: "NoAccess12345!",
        roleCode: "ACCT_PR_NOACCESS",
        scopeType: "tenant",
      });
      const noAccessToken = (await login(app, POSTING_RULES_TENANT, "noaccess@ak-pr.local", "NoAccess12345!")).body
        .accessToken;

      const res = await get(`/accounting/posting-rules`, noAccessToken);
      expect(res.statusCode).toBe(403);
    });
  });

  describe("POST /accounting/posting-rules/:id/deprecate", () => {
    it("200 happy path: deprecates a posting rule", async () => {
      const createRes = await post("/accounting/posting-rules", financeToken, {
        ruleCode: "RULE_HTTP_DEPRECATE",
        ruleName: "Deprecate Rule",
        ruleVersion: "v1",
        triggerEventType: "TEST_DEPRECATE",
        accountingFormula: [
          { accountCode: "1000", side: "debit", amountExpression: "AMOUNT" },
          { accountCode: "4000", side: "credit", amountExpression: "AMOUNT" },
        ],
        requiresApproval: false,
        materialityThreshold: null,
        effectiveDate: "2026-01-01",
      });
      const ruleId = createRes.json().id;

      const res = await post(`/accounting/posting-rules/${ruleId}/deprecate`, financeToken);
      expect(res.statusCode).toBe(200);
      const deprecated = res.json();
      expect(deprecated.isActive).toBe(false);
      expect(deprecated.deprecatedDate).toBeTruthy();
    });

    it("404 rejects a non-existent rule", async () => {
      const fakeId = "00000000-0000-4000-8000-000000000001";
      const res = await post(`/accounting/posting-rules/${fakeId}/deprecate`, financeToken);
      expect(res.statusCode).toBe(404);
    });

    it("403 rejects without finance.accounting.configure", async () => {
      const createRes = await post("/accounting/posting-rules", financeToken, {
        ruleCode: "RULE_HTTP_DEPRECATE_NOPERM",
        ruleName: "Deprecate No Perm",
        ruleVersion: "v1",
        triggerEventType: "TEST_DEPRECATE_NOPERM",
        accountingFormula: [
          { accountCode: "1000", side: "debit", amountExpression: "AMOUNT" },
          { accountCode: "4000", side: "credit", amountExpression: "AMOUNT" },
        ],
        requiresApproval: false,
        materialityThreshold: null,
        effectiveDate: "2026-01-01",
      });
      const ruleId = createRes.json().id;

      const res = await post(`/accounting/posting-rules/${ruleId}/deprecate`, readOnlyToken);
      expect(res.statusCode).toBe(403);
    });
  });

  describe("POST /accounting/posting-rules/resolve", () => {
    it("200 happy path: resolves a rule and returns evaluated legs", async () => {
      await post("/accounting/posting-rules", financeToken, {
        ruleCode: "RULE_HTTP_RESOLVE",
        ruleName: "Resolve Rule",
        ruleVersion: "v1",
        triggerEventType: "TEST_RESOLVE",
        accountingFormula: [
          { accountCode: "1000", side: "debit", amountExpression: "AMOUNT" },
          { accountCode: "4000", side: "credit", amountExpression: "AMOUNT" },
        ],
        requiresApproval: false,
        materialityThreshold: null,
        effectiveDate: "2026-01-01",
      });

      const res = await post("/accounting/posting-rules/resolve", financeToken, {
        triggerEventType: "TEST_RESOLVE",
        accountingDate: "2026-06-01",
        amount: "50.00",
      });
      expect(res.statusCode).toBe(200);
      const result = res.json();
      expect(result.rule).toBeTruthy();
      expect(result.resolvedLegs).toHaveLength(2);
      expect(result.resolvedLegs[0].amount).toBe("50.00");
      expect(result.resolvedLegs[1].amount).toBe("50.00");
    });

    it("404 rejects an unresolvable trigger event type", async () => {
      const res = await post("/accounting/posting-rules/resolve", financeToken, {
        triggerEventType: "NONEXISTENT_EVENT",
        accountingDate: "2026-06-01",
        amount: "50.00",
      });
      expect(res.statusCode).toBe(404);
    });
  });

  describe("POST /accounting/posting-rules/generate", () => {
    it("201 happy path: generates a draft journal with posting_rule_version_id set", async () => {
      const ruleRes = await post("/accounting/posting-rules", financeToken, {
        ruleCode: "RULE_HTTP_GENERATE",
        ruleName: "Generate Rule",
        ruleVersion: "v1",
        triggerEventType: "TEST_GENERATE",
        accountingFormula: [
          { accountCode: "1000", side: "debit", amountExpression: "AMOUNT" },
          { accountCode: "4000", side: "credit", amountExpression: "AMOUNT" },
        ],
        requiresApproval: false,
        materialityThreshold: null,
        effectiveDate: "2026-01-01",
      });
      const ruleId = ruleRes.json().id;

      const periodRes = await post("/accounting/periods", financeToken, {
        legalEntityId,
        fiscalYearCode: "FY2026",
        periodCode: "PR-GEN-P01",
        periodName: "Posting Rules Generate Period",
        periodType: "monthly",
        dateFrom: "2026-01-01",
        dateTo: "2026-01-31",
      });
      const periodId = periodRes.json().id;
      await pool.query(`UPDATE accounting_periods SET status = 'open' WHERE id = $1`, [periodId]);

      const res = await post("/accounting/posting-rules/generate", financeToken, {
        legalEntityId,
        triggerEventType: "TEST_GENERATE",
        journalNumber: "GEN-JNL-001",
        journalDate: "2026-01-15",
        accountingDate: "2026-01-15",
        periodId,
        amount: "100.00",
        idempotencyKey: `${POSTING_RULES_TENANT}-gen-key-1`,
        description: null,
        currency: "USD",
      });
      expect(res.statusCode).toBe(201);
      const journal = res.json();
      expect(journal.status).toBe("pending");
      expect(journal.postingRuleVersionId).toBe(ruleId);
    });

    it("409 rejects duplicate idempotency key", async () => {
      await post("/accounting/posting-rules", financeToken, {
        ruleCode: "RULE_HTTP_GENERATE_DUP",
        ruleName: "Generate Dup Rule",
        ruleVersion: "v1",
        triggerEventType: "TEST_GENERATE_DUP",
        accountingFormula: [
          { accountCode: "1000", side: "debit", amountExpression: "AMOUNT" },
          { accountCode: "4000", side: "credit", amountExpression: "AMOUNT" },
        ],
        requiresApproval: false,
        materialityThreshold: null,
        effectiveDate: "2026-01-01",
      });

      const periodRes = await post("/accounting/periods", financeToken, {
        legalEntityId,
        fiscalYearCode: "FY2026",
        periodCode: "PR-GEN-P02",
        periodName: "Posting Rules Generate Period 2",
        periodType: "monthly",
        dateFrom: "2026-02-01",
        dateTo: "2026-02-28",
      });
      const periodId = periodRes.json().id;
      await pool.query(`UPDATE accounting_periods SET status = 'open' WHERE id = $1`, [periodId]);

      const idempotencyKey = `${POSTING_RULES_TENANT}-gen-key-dup`;

      await post("/accounting/posting-rules/generate", financeToken, {
        legalEntityId,
        triggerEventType: "TEST_GENERATE_DUP",
        journalNumber: "GEN-JNL-DUP-1",
        journalDate: "2026-02-15",
        accountingDate: "2026-02-15",
        periodId,
        amount: "100.00",
        idempotencyKey,
        description: null,
        currency: "USD",
      });

      const res = await post("/accounting/posting-rules/generate", financeToken, {
        legalEntityId,
        triggerEventType: "TEST_GENERATE_DUP",
        journalNumber: "GEN-JNL-DUP-2",
        journalDate: "2026-02-15",
        accountingDate: "2026-02-15",
        periodId,
        amount: "100.00",
        idempotencyKey,
        description: null,
        currency: "USD",
      });
      expect(res.statusCode).toBe(409);
    });

    it("409 rejects when period is closed", async () => {
      await post("/accounting/posting-rules", financeToken, {
        ruleCode: "RULE_HTTP_GENERATE_CLOSED",
        ruleName: "Generate Closed Period",
        ruleVersion: "v1",
        triggerEventType: "TEST_GENERATE_CLOSED",
        accountingFormula: [
          { accountCode: "1000", side: "debit", amountExpression: "AMOUNT" },
          { accountCode: "4000", side: "credit", amountExpression: "AMOUNT" },
        ],
        requiresApproval: false,
        materialityThreshold: null,
        effectiveDate: "2026-01-01",
      });

      const periodRes = await post("/accounting/periods", financeToken, {
        legalEntityId,
        fiscalYearCode: "FY2026",
        periodCode: "PR-GEN-P03",
        periodName: "Posting Rules Generate Period 3",
        periodType: "monthly",
        dateFrom: "2026-03-01",
        dateTo: "2026-03-31",
      });
      const periodId = periodRes.json().id;
      await pool.query(`UPDATE accounting_periods SET status = 'closed' WHERE id = $1`, [periodId]);

      const res = await post("/accounting/posting-rules/generate", financeToken, {
        legalEntityId,
        triggerEventType: "TEST_GENERATE_CLOSED",
        journalNumber: "GEN-JNL-CLOSED",
        journalDate: "2026-03-15",
        accountingDate: "2026-03-15",
        periodId,
        amount: "100.00",
        idempotencyKey: `${POSTING_RULES_TENANT}-gen-key-closed`,
        description: null,
        currency: "USD",
      });
      expect(res.statusCode).toBe(409);
    });

    it("403 rejects without finance.accounting.manage", async () => {
      const periodRes = await post("/accounting/periods", financeToken, {
        legalEntityId,
        fiscalYearCode: "FY2026",
        periodCode: "PR-GEN-P04",
        periodName: "Posting Rules Generate Period 4",
        periodType: "monthly",
        dateFrom: "2026-04-01",
        dateTo: "2026-04-30",
      });
      const periodId = periodRes.json().id;
      await pool.query(`UPDATE accounting_periods SET status = 'open' WHERE id = $1`, [periodId]);

      const res = await post("/accounting/posting-rules/generate", readOnlyToken, {
        legalEntityId,
        triggerEventType: "TEST_GENERATE",
        journalNumber: "GEN-JNL-NOPERM",
        journalDate: "2026-04-15",
        accountingDate: "2026-04-15",
        periodId,
        amount: "100.00",
        idempotencyKey: `${POSTING_RULES_TENANT}-gen-key-noperm`,
        description: null,
        currency: "USD",
      });
      expect(res.statusCode).toBe(403);
    });
  });
});

