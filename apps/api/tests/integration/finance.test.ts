import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../../src/app.js";
import { pool } from "../../src/infrastructure/persistence/db.js";
import { activateAllModules, authHeader, bootstrapTenant, createReadOnlyRole, login, provisionFirstAdmin } from "./helpers.js";

/**
 * Phase 6 — Finance Core (FIN-CORE-001…011).
 *
 * Drives the real HTTP API: cash/bank account master → category catalog →
 * income and expense through the configured approval lifecycle → balance
 * effects → correction by compensating entry → operational cashflow.
 *
 * Two properties are closure-critical here and are tested hardest:
 * **exact decimal money** (nothing is ever added up in JavaScript) and
 * **transactional balance integrity** under concurrency.
 */

const TENANT = `test-p6-${Date.now()}`;
const OTHER = `test-p6-other-${Date.now()}`;
const FIN_WORKFLOW = "finance_transaction_approval";

describe("Phase 6 — Finance Core", () => {
  const app = buildApp();

  let tenantId: string;
  let adminToken: string;
  let financeToken: string;
  let approverToken: string;
  let readerToken: string;
  let docReaderToken: string;
  let scopedToken: string;

  let unitNorthId: string;
  let unitSouthId: string;
  let legalEntityId: string;
  let customerId: string;
  let projectId: string;

  let otherAdminToken: string;
  let otherTransactionId: string;
  let otherCustomerId: string;
  let otherUnitId: string;

  const post = (url: string, token: string, payload: unknown = {}) =>
    app.inject({ method: "POST", url, headers: authHeader(token), payload });
  const get = (url: string, token: string) => app.inject({ method: "GET", url, headers: authHeader(token) });
  const patch = (url: string, token: string, payload: unknown = {}) =>
    app.inject({ method: "PATCH", url, headers: authHeader(token), payload });

  /** The approval lifecycle every Finance transaction follows (FIN-CORE-006). */
  async function buildFinanceWorkflow(token: string, approverRole: string) {
    await post("/workflow/definitions", token, {
      code: FIN_WORKFLOW,
      name: "Finance Transaction Approval",
      entityType: "finance_transaction",
      description: "Phase 6 test approval lifecycle",
    });
    const addStep = (b: Record<string, unknown>) =>
      post(`/workflow/definitions/${FIN_WORKFLOW}/versions/1/steps`, token, b);
    await addStep({ code: "REVIEW", name: "Review", stepType: "approval", isInitial: true, slaHours: 24 });
    await addStep({
      code: "APPROVED",
      name: "Approved",
      stepType: "end",
      isTerminal: true,
      terminalStatus: "approved",
    });
    await addStep({
      code: "REJECTED",
      name: "Rejected",
      stepType: "end",
      isTerminal: true,
      terminalStatus: "rejected",
    });

    const addTransition = (b: Record<string, unknown>) =>
      post(`/workflow/definitions/${FIN_WORKFLOW}/versions/1/transitions`, token, b);
    await addTransition({ fromStepCode: "REVIEW", toStepCode: "APPROVED", actionCode: "approve", name: "Approve" });
    await addTransition({ fromStepCode: "REVIEW", toStepCode: "REJECTED", actionCode: "reject", name: "Reject" });

    await post(`/workflow/definitions/${FIN_WORKFLOW}/versions/1/assignment-rules`, token, {
      stepCode: "REVIEW",
      assignmentType: "role",
      roleCode: approverRole,
      organizationUnitStrategy: "tenant",
    });
    const publish = await post(`/workflow/definitions/${FIN_WORKFLOW}/versions/1/publish`, token);
    expect(publish.statusCode).toBe(200);
  }

  async function addCategory(token: string, code: string, label: string) {
    return post(`/config/reference-data/finance_transaction_category`, token, { code, label });
  }

  async function record(token: string, body: Record<string, unknown>) {
    const created = await post("/finance/transactions", token, body);
    expect(created.statusCode).toBe(201);
    return created.json();
  }

  /** Record and approve in one step — the common "money actually moved" path. */
  async function recordAndApprove(body: Record<string, unknown>) {
    const view = await record(financeToken, body);
    const approved = await post(
      `/finance/transactions/${view.transaction.id}/actions/approve`,
      approverToken,
      {},
    );
    expect(approved.statusCode).toBe(200);
    return approved.json();
  }

  const balanceOf = async (token: string, code: string) => (await get(`/finance/accounts/${code}`, token)).json().balance;

  beforeAll(async () => {
    const t = await bootstrapTenant(app, TENANT, "Tenant P6");
    await activateAllModules(t.id);
    tenantId = t.id;
    await provisionFirstAdmin({ tenantId, email: "admin@p6.local", password: "Admin12345!" });
    adminToken = (await login(app, TENANT, "admin@p6.local", "Admin12345!")).body.accessToken;

    const legal = await post("/legal-entities", adminToken, { code: "LE-P6", name: "Legal Entity P6" });
    legalEntityId = legal.json().id;
    unitNorthId = (
      await post("/organization-units", adminToken, { legalEntityId, code: "N-P6", name: "North P6" })
    ).json().id;
    unitSouthId = (
      await post("/organization-units", adminToken, { legalEntityId, code: "S-P6", name: "South P6" })
    ).json().id;

    const customer = await post("/customers", adminToken, { code: "CUST-P6", name: "Customer P6" });
    customerId = customer.json().id;
    projectId = (
      await post("/projects", adminToken, { customerId, code: "PRJ-P6", name: "Project P6" })
    ).json().id;

    await post("/config/numbering/finance_transaction", adminToken, { pattern: "FIN-{SEQ:5}" });
    await addCategory(adminToken, "sales", "Sales Receipt");
    await addCategory(adminToken, "operational", "Operational Expense");
    await addCategory(adminToken, "travel", "Travel");

    await createReadOnlyRole(tenantId, "FIN_STAFF_P6", ["finance.read", "finance.manage", "finance.configure"]);
    await createReadOnlyRole(tenantId, "FIN_APPROVER_P6", [
      "finance.read",
      "finance.approve",
      "workflow.instance.act",
    ]);
    await createReadOnlyRole(tenantId, "FIN_READER_P6", ["finance.read"]);
    await createReadOnlyRole(tenantId, "FIN_DOCS_P6", [
      "finance.read",
      "finance.documents.read",
      "document.read",
      "document.manage",
    ]);

    const mkUser = (email: string, roleCode: string, scope: Record<string, unknown> = { scopeType: "tenant" }) =>
      post("/admin/users", adminToken, { email, fullName: email, password: "Passw0rd12345!", pairs: [{ roleCode, ...scope }] });
    await mkUser("staff@p6.local", "FIN_STAFF_P6");
    await mkUser("approver@p6.local", "FIN_APPROVER_P6");
    await mkUser("reader@p6.local", "FIN_READER_P6");
    await mkUser("docs@p6.local", "FIN_DOCS_P6");
    await mkUser("scoped@p6.local", "FIN_STAFF_P6", {
      scopeType: "organization_unit",
      scopeOrganizationUnitId: unitNorthId,
    });

    const tok = async (email: string) => (await login(app, TENANT, email, "Passw0rd12345!")).body.accessToken;
    financeToken = await tok("staff@p6.local");
    approverToken = await tok("approver@p6.local");
    readerToken = await tok("reader@p6.local");
    docReaderToken = await tok("docs@p6.local");
    scopedToken = await tok("scoped@p6.local");

    // Staff also needs to start instances; grant via the same role.
    await createReadOnlyRole(tenantId, "FIN_STARTER_P6", ["workflow.instance.start"]);
    await pool.query(
      `INSERT INTO role_permissions (role_id, permission_id)
       SELECT r.id, p.id FROM roles r, permissions p
        WHERE r.tenant_id = $1 AND r.code = 'FIN_STAFF_P6' AND p.code = 'workflow.instance.start'
          AND NOT EXISTS (SELECT 1 FROM role_permissions rp WHERE rp.role_id = r.id AND rp.permission_id = p.id)`,
      [tenantId],
    );

    await buildFinanceWorkflow(adminToken, "FIN_APPROVER_P6");

    // Second tenant for cross-tenant isolation.
    const ot = await bootstrapTenant(app, OTHER, "Tenant P6 Other");
    await activateAllModules(ot.id);
    await provisionFirstAdmin({ tenantId: ot.id, email: "admin@p6other.local", password: "Admin12345!" });
    otherAdminToken = (await login(app, OTHER, "admin@p6other.local", "Admin12345!")).body.accessToken;
    await post("/config/numbering/finance_transaction", otherAdminToken, { pattern: "FIN-O-{SEQ:5}" });
    await addCategory(otherAdminToken, "sales", "Sales Receipt");
    const otherLegal = await post("/legal-entities", otherAdminToken, { code: "LE-O6", name: "Other LE" });
    otherUnitId = (
      await post("/organization-units", otherAdminToken, {
        legalEntityId: otherLegal.json().id,
        code: "O-UNIT-6",
        name: "Other Unit",
      })
    ).json().id;
    otherCustomerId = (
      await post("/customers", otherAdminToken, { code: "CUST-O6", name: "Other Customer" })
    ).json().id;
    await buildFinanceWorkflow(otherAdminToken, "ADMIN");
    await post("/finance/accounts", otherAdminToken, {
      code: "OTHER-CASH",
      name: "Other Cash",
      accountType: "cash",
      currency: "USD",
    });
    otherTransactionId = (
      await post("/finance/transactions", otherAdminToken, {
        direction: "income",
        amount: "10.00",
        transactionDate: "2026-03-01",
        accountCode: "OTHER-CASH",
        categoryCode: "sales",
      })
    ).json().transaction.id;
  });

  afterAll(async () => {
    await app.close();
    await pool.end();
  });

  // --- FIN-CORE-004: cash / bank account master --------------------------

  it("FIN-CORE-004: maintains cash and bank accounts, each with its own currency", async () => {
    const cash = await post("/finance/accounts", financeToken, {
      code: "CASH-MAIN",
      name: "Main Cash",
      accountType: "cash",
      currency: "idr",
      organizationUnitId: unitNorthId,
      legalEntityId,
    });
    expect(cash.statusCode).toBe(201);
    expect(cash.json()).toMatchObject({ code: "CASH-MAIN", accountType: "cash", currency: "IDR", isActive: true });
    // A brand-new account starts at exactly zero — there is no writable
    // opening balance.
    expect(cash.json().balance).toBe("0.00");

    const bank = await post("/finance/accounts", financeToken, {
      code: "BANK-OPS",
      name: "Operations Bank",
      accountType: "bank",
      currency: "IDR",
    });
    expect(bank.statusCode).toBe(201);

    const duplicate = await post("/finance/accounts", financeToken, {
      code: "CASH-MAIN",
      name: "Clash",
      accountType: "cash",
      currency: "IDR",
    });
    expect(duplicate.statusCode).toBe(409);

    const badType = await post("/finance/accounts", financeToken, {
      code: "X",
      name: "X",
      accountType: "gl_account",
      currency: "IDR",
    });
    expect(badType.statusCode).toBe(400);

    const badCurrency = await post("/finance/accounts", financeToken, {
      code: "Y",
      name: "Y",
      accountType: "cash",
      currency: "RUPIAH",
    });
    expect(badCurrency.statusCode).toBe(400);
  });

  it("FIN-CORE-004: an account balance is never directly writable", async () => {
    await post("/finance/accounts", financeToken, {
      code: "CASH-RO",
      name: "Read-only balance",
      accountType: "cash",
      currency: "IDR",
    });
    // The update surface accepts descriptive fields only; a balance sent
    // alongside them is simply not a field that exists.
    const updated = await patch("/finance/accounts/CASH-RO", financeToken, {
      name: "Renamed",
      balance: "999999.00",
    });
    expect(updated.statusCode).toBe(200);
    expect(updated.json().name).toBe("Renamed");
    expect(updated.json().balance).toBe("0.00");
  });

  // --- FIN-CORE-003: category catalog ------------------------------------

  it("FIN-CORE-003: categories come from the tenant's configurable catalog", async () => {
    const categories = await get("/finance/categories", financeToken);
    expect(categories.statusCode).toBe(200);
    expect(categories.json().map((c: { code: string }) => c.code)).toEqual(
      expect.arrayContaining(["sales", "operational", "travel"]),
    );

    await post("/finance/accounts", financeToken, {
      code: "CASH-CAT",
      name: "Category test",
      accountType: "cash",
      currency: "IDR",
    });
    const unknown = await post("/finance/transactions", financeToken, {
      direction: "income",
      amount: "10.00",
      transactionDate: "2026-03-01",
      accountCode: "CASH-CAT",
      categoryCode: "not-configured",
    });
    expect(unknown.statusCode).toBe(404);
  });

  // --- FIN-CORE-001/002/006: income, expense, lifecycle ------------------

  it("FIN-CORE-001/006: income only moves the balance once the lifecycle approves it", async () => {
    await post("/finance/accounts", financeToken, {
      code: "CASH-INC",
      name: "Income account",
      accountType: "cash",
      currency: "IDR",
    });

    const view = await record(financeToken, {
      direction: "income",
      amount: "1500.50",
      transactionDate: "2026-03-05",
      accountCode: "CASH-INC",
      categoryCode: "sales",
      description: "March retainer",
      customerId,
      projectId,
    });
    expect(view.transaction.transactionNumber).toMatch(/^FIN-\d{5}$/);
    expect(view.transaction.amount).toBe("1500.50");
    expect(view.transaction.currency).toBe("IDR");
    expect(view.transaction.transactionDate).toBe("2026-03-05");
    expect(view.isApplied).toBe(false);
    expect(view.status.instanceStatus).toBe("in_progress");
    // Nothing has moved yet.
    expect(await balanceOf(financeToken, "CASH-INC")).toBe("0.00");

    const approved = await post(
      `/finance/transactions/${view.transaction.id}/actions/approve`,
      approverToken,
      {},
    );
    expect(approved.statusCode).toBe(200);
    expect(approved.json().isApplied).toBe(true);
    expect(approved.json().transaction.appliedAt).not.toBeNull();
    expect(await balanceOf(financeToken, "CASH-INC")).toBe("1500.50");

    // Approving twice cannot move the money twice.
    const again = await post(`/finance/transactions/${view.transaction.id}/actions/approve`, approverToken, {});
    expect(again.statusCode).toBe(409);
    expect(await balanceOf(financeToken, "CASH-INC")).toBe("1500.50");
  });

  it("FIN-CORE-002: an expense reduces the balance, and a rejected one changes nothing", async () => {
    await post("/finance/accounts", financeToken, {
      code: "CASH-EXP",
      name: "Expense account",
      accountType: "cash",
      currency: "IDR",
    });
    await recordAndApprove({
      direction: "income",
      amount: "1000.00",
      transactionDate: "2026-03-01",
      accountCode: "CASH-EXP",
      categoryCode: "sales",
    });

    await recordAndApprove({
      direction: "expense",
      amount: "250.75",
      transactionDate: "2026-03-02",
      accountCode: "CASH-EXP",
      categoryCode: "operational",
    });
    expect(await balanceOf(financeToken, "CASH-EXP")).toBe("749.25");

    // A rejected expense never touches the balance.
    const rejected = await record(financeToken, {
      direction: "expense",
      amount: "100.00",
      transactionDate: "2026-03-03",
      accountCode: "CASH-EXP",
      categoryCode: "travel",
    });
    const decision = await post(
      `/finance/transactions/${rejected.transaction.id}/actions/reject`,
      approverToken,
      { comment: "Not approved" },
    );
    expect(decision.statusCode).toBe(200);
    expect(decision.json().isApplied).toBe(false);
    expect(decision.json().transaction.appliedAt).toBeNull();
    expect(await balanceOf(financeToken, "CASH-EXP")).toBe("749.25");
  });

  // --- Money precision (closure-critical) --------------------------------

  it("Precision: exact decimal arithmetic — 100.10 + 200.20 - 50.05 = 250.25", async () => {
    await post("/finance/accounts", financeToken, {
      code: "CASH-PREC",
      name: "Precision account",
      accountType: "cash",
      currency: "IDR",
    });

    await recordAndApprove({
      direction: "income",
      amount: "100.10",
      transactionDate: "2026-04-01",
      accountCode: "CASH-PREC",
      categoryCode: "sales",
    });
    await recordAndApprove({
      direction: "income",
      amount: "200.20",
      transactionDate: "2026-04-02",
      accountCode: "CASH-PREC",
      categoryCode: "sales",
    });
    await recordAndApprove({
      direction: "expense",
      amount: "50.05",
      transactionDate: "2026-04-03",
      accountCode: "CASH-PREC",
      categoryCode: "operational",
    });

    // Exact, as a string — never 250.24999999999997.
    expect(await balanceOf(financeToken, "CASH-PREC")).toBe("250.25");

    const flow = await get(
      "/finance/cashflow?from=2026-04-01&to=2026-04-30&accountCode=CASH-PREC",
      financeToken,
    );
    expect(flow.json().totals).toEqual({ income: "300.30", expense: "50.05", net: "250.25" });
    expect(flow.json().closing).toBe("250.25");
  });

  it("Precision: the classic 0.1 + 0.2 case stores and reports exactly 0.30", async () => {
    await post("/finance/accounts", financeToken, {
      code: "CASH-TENTH",
      name: "Tenths",
      accountType: "cash",
      currency: "IDR",
    });
    await recordAndApprove({
      direction: "income",
      amount: "0.10",
      transactionDate: "2026-04-01",
      accountCode: "CASH-TENTH",
      categoryCode: "sales",
    });
    await recordAndApprove({
      direction: "income",
      amount: "0.20",
      transactionDate: "2026-04-01",
      accountCode: "CASH-TENTH",
      categoryCode: "sales",
    });
    expect(await balanceOf(financeToken, "CASH-TENTH")).toBe("0.30");
    expect(0.1 + 0.2).not.toBe(0.3); // …which is exactly why none of this is done in JS.
  });

  it("Precision: very large amounts survive intact, and unrepresentable amounts are refused", async () => {
    await post("/finance/accounts", financeToken, {
      code: "BANK-BIG",
      name: "Large amounts",
      accountType: "bank",
      currency: "IDR",
    });
    await recordAndApprove({
      direction: "income",
      amount: "9999999999999.99",
      transactionDate: "2026-05-01",
      accountCode: "BANK-BIG",
      categoryCode: "sales",
    });
    await recordAndApprove({
      direction: "income",
      amount: "0.01",
      transactionDate: "2026-05-01",
      accountCode: "BANK-BIG",
      categoryCode: "sales",
    });
    // A float would have lost the cent long before here.
    expect(await balanceOf(financeToken, "BANK-BIG")).toBe("10000000000000.00");

    const tooPrecise = await post("/finance/transactions", financeToken, {
      direction: "income",
      amount: "10.005",
      transactionDate: "2026-05-01",
      accountCode: "BANK-BIG",
      categoryCode: "sales",
    });
    expect(tooPrecise.statusCode).toBe(400);

    for (const bad of ["0", "-5.00", "abc", ""]) {
      const response = await post("/finance/transactions", financeToken, {
        direction: "income",
        amount: bad,
        transactionDate: "2026-05-01",
        accountCode: "BANK-BIG",
        categoryCode: "sales",
      });
      expect(response.statusCode).toBe(400);
    }
  });

  // --- Transactional integrity + concurrency (closure-critical) ----------

  it("Integrity: ten concurrent approvals move the balance exactly ten times", async () => {
    await post("/finance/accounts", financeToken, {
      code: "CASH-RACE",
      name: "Race account",
      accountType: "cash",
      currency: "IDR",
    });

    const ids: string[] = [];
    for (let i = 0; i < 10; i++) {
      const view = await record(financeToken, {
        direction: "income",
        amount: "100.00",
        transactionDate: "2026-06-01",
        accountCode: "CASH-RACE",
        categoryCode: "sales",
        reference: `race-${i}`,
      });
      ids.push(view.transaction.id);
    }

    const results = await Promise.all(
      ids.map((id) => post(`/finance/transactions/${id}/actions/approve`, approverToken, {})),
    );
    expect(results.filter((r) => r.statusCode === 200)).toHaveLength(10);

    // Exactly +1000.00 — no lost update, no double application.
    expect(await balanceOf(financeToken, "CASH-RACE")).toBe("1000.00");

    const account = (await get("/finance/accounts/CASH-RACE", financeToken)).json();
    const ledger = await pool.query(
      `SELECT COALESCE(SUM(CASE WHEN direction = 'income' THEN amount ELSE -amount END), 0)::text AS total,
              COUNT(*) FILTER (WHERE applied_at IS NOT NULL)::int AS applied
         FROM finance_transactions WHERE account_id = $1 AND applied_at IS NOT NULL`,
      [account.id],
    );
    expect(ledger.rows[0].total).toBe("1000.00");
    expect(ledger.rows[0].applied).toBe(10);
  });

  it("Integrity: an expense beyond the balance is refused, and writes nothing", async () => {
    await post("/finance/accounts", financeToken, {
      code: "CASH-LIMIT",
      name: "Limited cash",
      accountType: "cash",
      currency: "IDR",
    });
    await recordAndApprove({
      direction: "income",
      amount: "100.00",
      transactionDate: "2026-06-01",
      accountCode: "CASH-LIMIT",
      categoryCode: "sales",
    });

    const overspend = await record(financeToken, {
      direction: "expense",
      amount: "150.00",
      transactionDate: "2026-06-02",
      accountCode: "CASH-LIMIT",
      categoryCode: "operational",
    });
    const refused = await post(
      `/finance/transactions/${overspend.transaction.id}/actions/approve`,
      approverToken,
      {},
    );
    expect(refused.statusCode).toBe(409);
    expect(refused.json().error).toMatch(/Insufficient balance/i);

    // Balance untouched, and the transaction is still unapplied.
    expect(await balanceOf(financeToken, "CASH-LIMIT")).toBe("100.00");
    const detail = await get(`/finance/transactions/${overspend.transaction.id}`, financeToken);
    expect(detail.json().transaction.appliedAt).toBeNull();

    // Concurrent overspend: three expenses of 60 against 100 — at most one
    // can succeed, and the balance can never go below zero.
    const ids: string[] = [];
    for (let i = 0; i < 3; i++) {
      const view = await record(financeToken, {
        direction: "expense",
        amount: "60.00",
        transactionDate: "2026-06-03",
        accountCode: "CASH-LIMIT",
        categoryCode: "operational",
      });
      ids.push(view.transaction.id);
    }
    const results = await Promise.all(
      ids.map((id) => post(`/finance/transactions/${id}/actions/approve`, approverToken, {})),
    );
    expect(results.filter((r) => r.statusCode === 200)).toHaveLength(1);
    expect(results.filter((r) => r.statusCode === 409)).toHaveLength(2);
    expect(await balanceOf(financeToken, "CASH-LIMIT")).toBe("40.00");
  });

  // --- FIN-CORE-008: immutability and compensating entries ---------------

  it("FIN-CORE-008: an applied transaction cannot be edited — there is no edit surface at all", async () => {
    await post("/finance/accounts", financeToken, {
      code: "CASH-IMM",
      name: "Immutable",
      accountType: "cash",
      currency: "IDR",
    });
    const applied = await recordAndApprove({
      direction: "income",
      amount: "500.00",
      transactionDate: "2026-07-01",
      accountCode: "CASH-IMM",
      categoryCode: "sales",
    });
    const id = applied.transaction.id;

    // No PATCH, no PUT, no DELETE exists for a transaction.
    for (const method of ["PATCH", "PUT", "DELETE"] as const) {
      const response = await app.inject({
        method,
        url: `/finance/transactions/${id}`,
        headers: authHeader(financeToken),
        payload: { amount: "1.00" },
      });
      expect(response.statusCode).toBe(404);
    }

    const after = await get(`/finance/transactions/${id}`, financeToken);
    expect(after.json().transaction.amount).toBe("500.00");
    expect(await balanceOf(financeToken, "CASH-IMM")).toBe("500.00");
  });

  it("FIN-CORE-008: a correction is a compensating transaction, linked both ways, approved on its own", async () => {
    await post("/finance/accounts", financeToken, {
      code: "CASH-REV",
      name: "Reversal account",
      accountType: "cash",
      currency: "IDR",
    });
    const original = await recordAndApprove({
      direction: "income",
      amount: "300.00",
      transactionDate: "2026-07-01",
      accountCode: "CASH-REV",
      categoryCode: "sales",
      description: "Recorded twice by mistake",
    });
    const originalId = original.transaction.id;
    expect(await balanceOf(financeToken, "CASH-REV")).toBe("300.00");

    const reversal = await post(`/finance/transactions/${originalId}/reversal`, financeToken, {
      reason: "Duplicate entry",
    });
    expect(reversal.statusCode).toBe(201);
    const reversalId = reversal.json().transaction.id;
    expect(reversal.json().transaction.direction).toBe("expense");
    expect(reversal.json().transaction.amount).toBe("300.00");
    expect(reversal.json().transaction.reversesTransactionId).toBe(originalId);
    // The compensating entry goes through the same approval lifecycle, so
    // the money has NOT moved back yet.
    expect(reversal.json().isApplied).toBe(false);
    expect(await balanceOf(financeToken, "CASH-REV")).toBe("300.00");

    const approved = await post(`/finance/transactions/${reversalId}/actions/approve`, approverToken, {});
    expect(approved.statusCode).toBe(200);
    expect(await balanceOf(financeToken, "CASH-REV")).toBe("0.00");

    // The original is untouched and now points at its correction.
    const originalAfter = await get(`/finance/transactions/${originalId}`, financeToken);
    expect(originalAfter.json().transaction.amount).toBe("300.00");
    expect(originalAfter.json().transaction.appliedAt).not.toBeNull();
    expect(originalAfter.json().transaction.reversedByTransactionId).toBe(reversalId);

    // …and it can only be reversed once.
    const twice = await post(`/finance/transactions/${originalId}/reversal`, financeToken, {});
    expect(twice.statusCode).toBe(409);

    // An unapplied transaction has nothing to compensate.
    const pending = await record(financeToken, {
      direction: "income",
      amount: "10.00",
      transactionDate: "2026-07-02",
      accountCode: "CASH-REV",
      categoryCode: "sales",
    });
    expect(
      (await post(`/finance/transactions/${pending.transaction.id}/reversal`, financeToken, {})).statusCode,
    ).toBe(409);
  });

  // --- FIN-CORE-007: operational cashflow --------------------------------

  it("FIN-CORE-007: cashflow reports in, out, net, opening and closing over a period", async () => {
    await post("/finance/accounts", financeToken, {
      code: "BANK-FLOW",
      name: "Cashflow account",
      accountType: "bank",
      currency: "IDR",
    });
    await recordAndApprove({
      direction: "income",
      amount: "400.00",
      transactionDate: "2026-08-15",
      accountCode: "BANK-FLOW",
      categoryCode: "sales",
    });
    await recordAndApprove({
      direction: "income",
      amount: "600.25",
      transactionDate: "2026-09-10",
      accountCode: "BANK-FLOW",
      categoryCode: "sales",
    });
    await recordAndApprove({
      direction: "expense",
      amount: "150.25",
      transactionDate: "2026-09-20",
      accountCode: "BANK-FLOW",
      categoryCode: "travel",
    });
    // Unapproved money is not cash — it must not appear anywhere.
    await record(financeToken, {
      direction: "income",
      amount: "9999.00",
      transactionDate: "2026-09-25",
      accountCode: "BANK-FLOW",
      categoryCode: "sales",
    });

    const september = await get(
      "/finance/cashflow?from=2026-09-01&to=2026-09-30&accountCode=BANK-FLOW",
      financeToken,
    );
    expect(september.statusCode).toBe(200);
    const body = september.json();
    expect(body.opening).toBe("400.00");
    expect(body.totals).toEqual({ income: "600.25", expense: "150.25", net: "450.00" });
    expect(body.closing).toBe("850.00");
    expect(body.byCategory).toEqual(
      expect.arrayContaining([
        { categoryCode: "sales", direction: "income", amount: "600.25" },
        { categoryCode: "travel", direction: "expense", amount: "150.25" },
      ]),
    );
    // The reported closing position equals the account's own balance.
    expect(await balanceOf(financeToken, "BANK-FLOW")).toBe("850.00");

    const backwards = await get("/finance/cashflow?from=2026-09-30&to=2026-09-01", financeToken);
    expect(backwards.statusCode).toBe(400);
  });

  // --- FIN-CORE-010: authorization, scope, isolation ---------------------

  it("FIN-CORE-010: each capability gates its own action", async () => {
    await post("/finance/accounts", financeToken, {
      code: "CASH-PERM",
      name: "Permission test",
      accountType: "cash",
      currency: "IDR",
    });
    const view = await record(financeToken, {
      direction: "income",
      amount: "50.00",
      transactionDate: "2026-03-01",
      accountCode: "CASH-PERM",
      categoryCode: "sales",
    });

    // A reader can read but not record, approve, configure, or correct.
    expect((await get("/finance/transactions", readerToken)).statusCode).toBe(200);
    expect(
      (await post("/finance/transactions", readerToken, {
        direction: "income",
        amount: "1.00",
        transactionDate: "2026-03-01",
        accountCode: "CASH-PERM",
        categoryCode: "sales",
      })).statusCode,
    ).toBe(403);
    expect(
      (await post("/finance/accounts", readerToken, {
        code: "NOPE",
        name: "Nope",
        accountType: "cash",
        currency: "IDR",
      })).statusCode,
    ).toBe(403);
    expect(
      (await post(`/finance/transactions/${view.transaction.id}/actions/approve`, readerToken, {})).statusCode,
    ).toBe(403);

    // Recording staff cannot approve their own transaction.
    expect(
      (await post(`/finance/transactions/${view.transaction.id}/actions/approve`, financeToken, {})).statusCode,
    ).toBe(403);
  });

  it("FIN-CORE-010: Data Scope limits which accounts, transactions, and totals a user sees", async () => {
    const northAccount = await post("/finance/accounts", financeToken, {
      code: "CASH-NORTH",
      name: "North cash",
      accountType: "cash",
      currency: "IDR",
      organizationUnitId: unitNorthId,
    });
    const southAccount = await post("/finance/accounts", financeToken, {
      code: "CASH-SOUTH",
      name: "South cash",
      accountType: "cash",
      currency: "IDR",
      organizationUnitId: unitSouthId,
    });
    expect(northAccount.statusCode).toBe(201);
    expect(southAccount.statusCode).toBe(201);

    const north = await recordAndApprove({
      direction: "income",
      amount: "111.00",
      transactionDate: "2026-10-01",
      accountCode: "CASH-NORTH",
      categoryCode: "sales",
    });
    const south = await recordAndApprove({
      direction: "income",
      amount: "222.00",
      transactionDate: "2026-10-01",
      accountCode: "CASH-SOUTH",
      categoryCode: "sales",
    });

    const accounts = await get("/finance/accounts", scopedToken);
    const accountCodes = accounts.json().map((a: { code: string }) => a.code);
    expect(accountCodes).toContain("CASH-NORTH");
    expect(accountCodes).not.toContain("CASH-SOUTH");
    expect((await get("/finance/accounts/CASH-SOUTH", scopedToken)).statusCode).toBe(403);

    const listed = await get("/finance/transactions", scopedToken);
    const ids = listed.json().map((t: { id: string }) => t.id);
    expect(ids).toContain(north.transaction.id);
    expect(ids).not.toContain(south.transaction.id);
    expect((await get(`/finance/transactions/${south.transaction.id}`, scopedToken)).statusCode).toBe(403);

    // The aggregate obeys the same rule — a scoped user never sees
    // tenant-wide totals.
    const flow = await get("/finance/cashflow?from=2026-10-01&to=2026-10-31", scopedToken);
    expect(flow.json().totals.income).toBe("111.00");
    const adminFlow = await get("/finance/cashflow?from=2026-10-01&to=2026-10-31", financeToken);
    expect(adminFlow.json().totals.income).toBe("333.00");

    // Booking into a unit outside the actor's scope is refused.
    expect(
      (await post("/finance/transactions", scopedToken, {
        direction: "income",
        amount: "1.00",
        transactionDate: "2026-10-02",
        accountCode: "CASH-NORTH",
        categoryCode: "sales",
        organizationUnitId: unitSouthId,
      })).statusCode,
    ).toBe(403);
  });

  it("Cross-tenant: another tenant's finance data is invisible and unusable", async () => {
    expect((await get(`/finance/transactions/${otherTransactionId}`, financeToken)).statusCode).toBe(404);
    expect(
      (await post(`/finance/transactions/${otherTransactionId}/actions/approve`, approverToken, {})).statusCode,
    ).toBe(404);
    expect(
      (await post(`/finance/transactions/${otherTransactionId}/reversal`, financeToken, {})).statusCode,
    ).toBe(404);
    expect((await get("/finance/accounts/OTHER-CASH", financeToken)).statusCode).toBe(404);

    const listed = await get("/finance/transactions", financeToken);
    expect(listed.json().map((t: { id: string }) => t.id)).not.toContain(otherTransactionId);
    const accounts = await get("/finance/accounts", financeToken);
    expect(accounts.json().map((a: { code: string }) => a.code)).not.toContain("OTHER-CASH");

    // Cross-tenant context references are refused at recording time.
    await post("/finance/accounts", financeToken, {
      code: "CASH-XT",
      name: "Cross-tenant test",
      accountType: "cash",
      currency: "IDR",
    });
    const base = {
      direction: "income" as const,
      amount: "10.00",
      transactionDate: "2026-03-01",
      accountCode: "CASH-XT",
      categoryCode: "sales",
    };
    expect((await post("/finance/transactions", financeToken, { ...base, customerId: otherCustomerId })).statusCode).toBe(404);
    expect(
      (await post("/finance/transactions", financeToken, { ...base, organizationUnitId: otherUnitId })).statusCode,
    ).toBe(404);
  });

  // --- FIN-CORE-005: evidence --------------------------------------------

  it("FIN-CORE-005: evidence needs the dedicated capability and inherits the transaction's authorisation", async () => {
    await post("/finance/accounts", financeToken, {
      code: "CASH-DOC",
      name: "Evidence account",
      accountType: "cash",
      currency: "IDR",
    });
    const view = await record(financeToken, {
      direction: "expense",
      amount: "75.00",
      transactionDate: "2026-03-01",
      accountCode: "CASH-DOC",
      categoryCode: "travel",
    });
    const id = view.transaction.id;

    const upload = await app.inject({
      method: "POST",
      url: "/documents",
      headers: { ...authHeader(docReaderToken), "content-type": "multipart/form-data; boundary=----p6b" },
      payload: Buffer.from(
        `------p6b\r\nContent-Disposition: form-data; name="entityType"\r\n\r\nfinance_transaction\r\n` +
          `------p6b\r\nContent-Disposition: form-data; name="entityId"\r\n\r\n${id}\r\n` +
          `------p6b\r\nContent-Disposition: form-data; name="file"; filename="receipt.txt"\r\n` +
          `Content-Type: text/plain\r\n\r\ntaxi receipt\r\n------p6b--\r\n`,
      ),
    });
    expect(upload.statusCode).toBe(201);

    const allowed = await get(`/documents?entityType=finance_transaction&entityId=${id}`, docReaderToken);
    expect(allowed.statusCode).toBe(200);
    expect(allowed.json().length).toBeGreaterThan(0);

    // finance.read alone is NOT enough to see financial evidence.
    const denied = await get(`/documents?entityType=finance_transaction&entityId=${id}`, readerToken);
    expect([403, 404]).toContain(denied.statusCode);

    // …and no other tenant can reach it.
    const crossTenant = await get(`/documents?entityType=finance_transaction&entityId=${id}`, otherAdminToken);
    expect([403, 404]).toContain(crossTenant.statusCode);
  });

  // --- FIN-CORE-011: usable surface --------------------------------------

  it("FIN-CORE-011: transactions are filterable by direction, account, category, date, and state", async () => {
    await post("/finance/accounts", financeToken, {
      code: "CASH-FILTER",
      name: "Filter account",
      accountType: "cash",
      currency: "IDR",
    });
    await recordAndApprove({
      direction: "income",
      amount: "10.00",
      transactionDate: "2026-11-05",
      accountCode: "CASH-FILTER",
      categoryCode: "sales",
      reference: "FILTER-REF-1",
    });
    const pending = await record(financeToken, {
      direction: "expense",
      amount: "5.00",
      transactionDate: "2026-11-06",
      accountCode: "CASH-FILTER",
      categoryCode: "travel",
    });

    const byAccount = await get("/finance/transactions?accountCode=CASH-FILTER", financeToken);
    expect(byAccount.json()).toHaveLength(2);

    const income = await get("/finance/transactions?accountCode=CASH-FILTER&direction=income", financeToken);
    expect(income.json()).toHaveLength(1);

    const byCategory = await get(
      "/finance/transactions?accountCode=CASH-FILTER&categoryCode=travel",
      financeToken,
    );
    expect(byCategory.json()).toHaveLength(1);

    const byDate = await get(
      "/finance/transactions?accountCode=CASH-FILTER&dateFrom=2026-11-06&dateTo=2026-11-06",
      financeToken,
    );
    expect(byDate.json()).toHaveLength(1);

    const pendingOnly = await get("/finance/transactions?accountCode=CASH-FILTER&state=pending", financeToken);
    expect(pendingOnly.json().map((t: { id: string }) => t.id)).toEqual([pending.transaction.id]);

    const appliedOnly = await get("/finance/transactions?accountCode=CASH-FILTER&state=applied", financeToken);
    expect(appliedOnly.json()).toHaveLength(1);

    const bySearch = await get("/finance/transactions?search=FILTER-REF-1", financeToken);
    expect(bySearch.json()).toHaveLength(1);
  });

  it("Validation: unknown references and malformed dates are refused before anything is written", async () => {
    await post("/finance/accounts", financeToken, {
      code: "CASH-VAL",
      name: "Validation",
      accountType: "cash",
      currency: "IDR",
    });
    const base = {
      direction: "income" as const,
      amount: "10.00",
      transactionDate: "2026-03-01",
      accountCode: "CASH-VAL",
      categoryCode: "sales",
    };

    expect((await post("/finance/transactions", financeToken, { ...base, accountCode: "nope" })).statusCode).toBe(404);
    expect((await post("/finance/transactions", financeToken, { ...base, transactionDate: "01/03/2026" })).statusCode).toBe(400);
    expect((await post("/finance/transactions", financeToken, { ...base, direction: "transfer" })).statusCode).toBe(400);
    expect(
      (await post("/finance/transactions", financeToken, {
        ...base,
        projectId: "00000000-0000-0000-0000-000000000000",
      })).statusCode,
    ).toBe(404);
    expect((await get("/finance/transactions/00000000-0000-0000-0000-000000000000", financeToken)).statusCode).toBe(404);

    // An inactive account cannot take new money.
    await patch("/finance/accounts/CASH-VAL", financeToken, { isActive: false });
    expect((await post("/finance/transactions", financeToken, base)).statusCode).toBe(409);
  });

  // --- Audit --------------------------------------------------------------

  it("Audit: account, creation, decision, application, and reversal are all recorded", async () => {
    await post("/finance/accounts", financeToken, {
      code: "CASH-AUDIT",
      name: "Audited",
      accountType: "cash",
      currency: "IDR",
    });
    const applied = await recordAndApprove({
      direction: "income",
      amount: "20.00",
      transactionDate: "2026-03-01",
      accountCode: "CASH-AUDIT",
      categoryCode: "sales",
    });
    await post(`/finance/transactions/${applied.transaction.id}/reversal`, financeToken, { reason: "Audit test" });

    const actions = (
      await pool.query(
        `SELECT action FROM audit_log
          WHERE entity_id = $1 OR entity_id = (SELECT id FROM finance_accounts WHERE tenant_id = $2 AND code = 'CASH-AUDIT')`,
        [applied.transaction.id, tenantId],
      )
    ).rows.map((r: { action: string }) => r.action);

    expect(actions).toContain("finance.account.created");
    expect(actions).toContain("finance.transaction.created");
    expect(actions).toContain("finance.transaction.approved");
    expect(actions).toContain("finance.transaction.applied");
    expect(actions).toContain("finance.transaction.reversed");
  });

  // --- Closure invariant ---------------------------------------------------

  it("Invariant: every account balance equals the sum of its applied ledger, and nothing is negative", async () => {
    const violations = await pool.query(
      `SELECT a.code, a.balance::text AS cached, COALESCE(l.total, 0)::text AS ledger
         FROM finance_accounts a
         LEFT JOIN (
           SELECT account_id,
                  SUM(CASE WHEN direction = 'income' THEN amount ELSE -amount END) AS total
             FROM finance_transactions
            WHERE applied_at IS NOT NULL
            GROUP BY account_id
         ) l ON l.account_id = a.id
        WHERE a.tenant_id = $1
          AND (a.balance <> COALESCE(l.total, 0) OR a.balance < 0)`,
      [tenantId],
    );
    expect(violations.rows).toEqual([]);

    // An unapplied transaction never has an applied stamp, and vice versa.
    const halfApplied = await pool.query(
      `SELECT id FROM finance_transactions
        WHERE tenant_id = $1 AND ((applied_at IS NULL) <> (applied_by_user_id IS NULL))`,
      [tenantId],
    );
    expect(halfApplied.rows).toEqual([]);

    // Every amount is stored with exactly two decimal places and is positive.
    const badAmounts = await pool.query(
      `SELECT id FROM finance_transactions
        WHERE tenant_id = $1 AND (amount <= 0 OR scale(amount) > 2)`,
      [tenantId],
    );
    expect(badAmounts.rows).toEqual([]);

    // A reversal always mirrors its original exactly.
    const badReversals = await pool.query(
      `SELECT r.id
         FROM finance_transactions r
         JOIN finance_transactions o ON o.id = r.reverses_transaction_id
        WHERE r.tenant_id = $1
          AND (r.amount <> o.amount OR r.account_id <> o.account_id
               OR r.currency <> o.currency OR r.direction = o.direction)`,
      [tenantId],
    );
    expect(badReversals.rows).toEqual([]);
  });
});
