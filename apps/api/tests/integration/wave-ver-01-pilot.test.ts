import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../../src/app.js";
import { pool } from "../../src/infrastructure/persistence/db.js";
import { PgAccountingKernelRepository } from "../../src/modules/accounting/kernel/infrastructure/accounting-kernel.repository.pg.js";
import { AccountingKernelService } from "../../src/modules/accounting/kernel/application/accounting-kernel.service.js";
import { AccountingEventConsumerService } from "../../src/modules/accounting/consumer/accounting-event-consumer.service.js";
import { PgAccountingEventWritePort } from "../../src/modules/supply-chain/ports/accounting-event.port.pg.js";
import { PgRbacRepository } from "../../src/infrastructure/persistence/repositories/rbac.repository.pg.js";
import { PgAuditLogRepository } from "../../src/infrastructure/persistence/repositories/audit-log.repository.pg.js";
import { PgOrganizationUnitRepository } from "../../src/infrastructure/persistence/repositories/organization-unit.repository.pg.js";
import { PgLegalEntityRepository } from "../../src/infrastructure/persistence/repositories/legal-entity.repository.pg.js";
import { PgDomainEventRepository } from "../../src/infrastructure/persistence/repositories/domain-event.repository.pg.js";
import { RbacService } from "../../src/application/rbac/rbac.service.js";
import { AuditService } from "../../src/application/audit/audit.service.js";
import { EventBus } from "../../src/application/event/event-bus.js";
import {
  activateAllModules,
  authHeader,
  bootstrapTenant,
  createReadOnlyRole,
  login,
  provisionFirstAdmin,
} from "./helpers.js";

/**
 * WP-VER-01 Phase 7 — E2E-014 catering pilot (engineering half).
 *
 * One integration test proving the whole DEC-009 chain on a single Work
 * Order: catering pack → menu → recipe (+ingredients) → recipe cost
 * (nonzero) → meal plan → batch confirmed → WO lifecycle → customer-accept
 * → cost items → finalize-costs → GL cost journal (6200/2500) via
 * consumer.processTenant → create-invoice (PPN 11%) → AR journals
 * (1210/4100 base, 1210/2410 tax) via consumer again.
 *
 * Batch ↔ WO link is narrative only — catering_meal_batches carries no
 * work_order_id FK, so the WO title references the batch number instead.
 *
 * Posting rules are per-tenant rows; the seeding migrations only touch
 * pre-existing tenants, so this test seeds its own rules + accounts.
 */
const TENANT = `test-ver-01-${Date.now()}`;
const WORKFLOW_CODE = "service_operations_work_order";
const SERVICE_CODE = "catering_pilot_service";
const MARKUP_PARAM = "service_operations.invoice.default_markup";
const TODAY = new Date().toISOString().slice(0, 10);

describe("WP-VER-01 — E2E-014 catering pilot (engineering half)", () => {
  const app = buildApp();

  let tenantId: string;
  let adminToken: string;
  let coordinatorToken: string;
  let executorToken: string;
  let executorUserId: string;
  let verifierToken: string;
  let billingToken: string;
  let customerId: string;
  let siteId: string;
  let riceItemId: string;
  let outputItemId: string;
  let userId: string;
  let legalEntityId: string;
  let periodId: string;

  let service: AccountingEventConsumerService;
  let repo: PgAccountingKernelRepository;

  const post = (url: string, token: string, payload: unknown = {}) =>
    app.inject({ method: "POST", url, headers: authHeader(token), payload });

  const putIngredients = (ingredients: Record<string, unknown>[]) =>
    app.inject({
      method: "PUT",
      url: "/catering/recipes/RC-VER01/ingredients",
      headers: authHeader(adminToken),
      payload: { ingredients },
    });

  beforeAll(async () => {
    const t = await bootstrapTenant(app, TENANT, "Tenant VER-01 Pilot");
    await activateAllModules(t.id);
    tenantId = t.id;
    await provisionFirstAdmin({ tenantId, email: "admin@ver01.local", password: "Admin12345!" });
    adminToken = (await login(app, TENANT, "admin@ver01.local", "Admin12345!")).body.accessToken;

    await createReadOnlyRole(tenantId, "COORD_OPS", [
      "service_operations.read",
      "service_operations.manage",
      "service_operations.configure",
      "customer.read",
      "workflow.instance.start",
      "workflow.instance.act",
    ]);
    await createReadOnlyRole(tenantId, "EXEC_OPS", [
      "service_operations.read",
      "service_operations.execute",
      "workflow.instance.act",
    ]);
    await createReadOnlyRole(tenantId, "VERIFY_OPS", [
      "service_operations.read",
      "service_operations.verify",
      "workflow.instance.act",
    ]);
    await createReadOnlyRole(tenantId, "BILL_OPS", [
      "service_operations.read",
      "service_operations.billing.manage",
      "customer.read",
    ]);

    const customer = await post("/customers", adminToken, { code: "CUST-VER01", name: "Catering Client" });
    customerId = customer.json().id;
    const site = await post("/sites", adminToken, { customerId, code: "SITE-VER01", name: "Client Site" });
    siteId = site.json().id;

    const mkInternalUser = (email: string, roleCode: string) =>
      post("/admin/users", adminToken, {
        email,
        fullName: email,
        password: "Passw0rd12345!",
        pairs: [{ roleCode, scopeType: "tenant" }],
      });

    await mkInternalUser("coord@ver01.local", "COORD_OPS");
    executorUserId = (await mkInternalUser("exec@ver01.local", "EXEC_OPS")).json().user.id;
    await mkInternalUser("verify@ver01.local", "VERIFY_OPS");
    await mkInternalUser("bill@ver01.local", "BILL_OPS");

    const tok = async (email: string) => (await login(app, TENANT, email, "Passw0rd12345!")).body.accessToken;
    coordinatorToken = await tok("coord@ver01.local");
    executorToken = await tok("exec@ver01.local");
    verifierToken = await tok("verify@ver01.local");
    billingToken = await tok("bill@ver01.local");

    await post("/config/numbering/work_order", adminToken, { pattern: "WO-{SEQ:5}" });
    await post("/config/numbering/customer_invoice", adminToken, { pattern: "INV-{SEQ:5}" });

    // Workflow: same shape as wave-ops-02/03.
    await post("/workflow/definitions", adminToken, {
      code: WORKFLOW_CODE,
      name: "Work Order Lifecycle",
      entityType: "work_order",
      description: "VER-01 pilot lifecycle",
    });
    const addStep = (body: Record<string, unknown>) =>
      post(`/workflow/definitions/${WORKFLOW_CODE}/versions/1/steps`, adminToken, body);
    await addStep({ code: "PLANNED", name: "Planned", stepType: "task", isInitial: true });
    await addStep({ code: "IN_PROGRESS", name: "In Progress", stepType: "task" });
    await addStep({ code: "DONE", name: "Done", stepType: "approval" });
    await addStep({ code: "CLOSED", name: "Closed", stepType: "end", isTerminal: true, terminalStatus: "approved" });
    const addTransition = (body: Record<string, unknown>) =>
      post(`/workflow/definitions/${WORKFLOW_CODE}/versions/1/transitions`, adminToken, body);
    await addTransition({ fromStepCode: "PLANNED", toStepCode: "IN_PROGRESS", actionCode: "start", name: "Start" });
    await addTransition({ fromStepCode: "IN_PROGRESS", toStepCode: "DONE", actionCode: "complete", name: "Complete" });
    await addTransition({ fromStepCode: "DONE", toStepCode: "CLOSED", actionCode: "verify", name: "Verify" });
    const addRule = (body: Record<string, unknown>) =>
      post(`/workflow/definitions/${WORKFLOW_CODE}/versions/1/assignment-rules`, adminToken, body);
    for (const stepCode of ["PLANNED", "IN_PROGRESS", "DONE"]) {
      await addRule({ stepCode, assignmentType: "role", roleCode: "COORD_OPS", organizationUnitStrategy: "tenant" });
    }
    expect((await post(`/workflow/definitions/${WORKFLOW_CODE}/versions/1/publish`, adminToken)).statusCode).toBe(200);

    await post("/service-definitions", coordinatorToken, {
      code: SERVICE_CODE,
      name: "Catering Pilot Service",
    });

    // --- Catering vertical (wave-md-03 pattern) ----------------------------
    await pool.query(
      `INSERT INTO service_pack_activations (tenant_id, pack_code, is_active)
       VALUES ($1, 'catering', true)
       ON CONFLICT (tenant_id, pack_code) DO UPDATE SET is_active = true`,
      [tenantId],
    );

    const kg = await pool.query(
      `INSERT INTO units_of_measure (tenant_id, code, name, base_unit_code, category)
       VALUES ($1, 'KG', 'Kilogram', 'KG', 'mass') RETURNING id`,
      [tenantId],
    );
    const kgUnitId = kg.rows[0].id;
    const g = await pool.query(
      `INSERT INTO units_of_measure (tenant_id, code, name, base_unit_code, category)
       VALUES ($1, 'G', 'Gram', 'G', 'mass') RETURNING id`,
      [tenantId],
    );
    const gUnitId = g.rows[0].id;
    await pool.query(
      `INSERT INTO unit_conversions (tenant_id, from_unit_id, to_unit_id, factor, effective_from)
       VALUES ($1, $2, $3, '1000', '2020-01-01')`,
      [tenantId, kgUnitId, gUnitId],
    );

    const rice = await pool.query(
      `INSERT INTO items (tenant_id, code, name, unit_of_measure, unit_of_measure_id)
       VALUES ($1, 'RICE-VER01', 'Rice', 'KG', $2) RETURNING id`,
      [tenantId, kgUnitId],
    );
    riceItemId = rice.rows[0].id;
    const output = await pool.query(
      `INSERT INTO items (tenant_id, code, name, unit_of_measure, unit_of_measure_id)
       VALUES ($1, 'COOKED-RICE-VER01', 'Cooked Rice', 'KG', $2) RETURNING id`,
      [tenantId, kgUnitId],
    );
    outputItemId = output.rows[0].id;

    // Valuation layer: 100 KG @ 12000/KG.
    await pool.query(
      `INSERT INTO scm_valuation_layers
         (tenant_id, item_id, received_date, original_quantity, remaining_quantity,
          unit_cost, effective_unit_cost, total_value)
       VALUES ($1, $2, $3::date, 100, 100, 12000, 12000, 1200000)`,
      [tenantId, riceItemId, TODAY],
    );

    // Menu → recipe → ingredients → costing → meal plan → batch.
    const menu = await post("/catering/menus", adminToken, {
      code: "MENU-VER01",
      name: "Pilot Lunch Menu",
      effectiveFrom: TODAY,
    });
    expect(menu.statusCode).toBe(201);
    const recipe = await post("/catering/recipes", adminToken, {
      code: "RC-VER01",
      name: "Cooked Rice Recipe",
      outputItemId,
      outputQuantity: "2",
      outputUnitCode: "KG",
      effectiveFrom: TODAY,
    });
    expect(recipe.statusCode).toBe(201);
    const ing = await putIngredients([{ itemId: riceItemId, quantity: "500", unitCode: "G" }]);
    expect(ing.statusCode).toBe(200);

    const cost = await post("/catering/recipes/RC-VER01/cost", adminToken, { onDate: TODAY });
    expect(cost.statusCode).toBe(200);
    expect(cost.json().totalCost).toBe("6000.000000"); // 500 G = 0.5 KG @ 12000

    const mealPlan = await post("/catering/meal-plans", adminToken, {
      menuCode: "MENU-VER01",
      siteId,
      mealDate: TODAY,
      mealType: "lunch",
      plannedPortions: 20,
    });
    expect(mealPlan.statusCode).toBe(201);
    const batch = await post("/catering/meal-batches", adminToken, {
      batchNumber: "BATCH-VER01-001",
      recipeCode: "RC-VER01",
    });
    expect(batch.statusCode).toBe(201);
    const confirmed = await post("/catering/meal-batches/BATCH-VER01-001/status", adminToken, {
      status: "confirmed",
    });
    expect(confirmed.statusCode).toBe(200);

    // --- Accounting foundation (per-tenant; migrations don't cover new tenants)
    const userRes = await pool.query(
      `INSERT INTO users (tenant_id, email, password_hash, full_name)
       VALUES ($1, $2, 'x', $2) RETURNING id`,
      [tenantId, `kernel-actor-${Date.now()}@ver01.local`],
    );
    userId = userRes.rows[0].id;

    const le = await pool.query(
      `INSERT INTO legal_entities (tenant_id, name) VALUES ($1, 'LE Ver01') RETURNING id`,
      [tenantId],
    );
    legalEntityId = le.rows[0].id;
    const period = await pool.query(
      `INSERT INTO accounting_periods (tenant_id, legal_entity_id, fiscal_year_code, period_code, period_name, period_type, date_from, date_to, status, created_by)
       VALUES ($1, $2, 'FY2026', 'P-VER01', 'Ver01 Period', 'monthly', '2026-01-01', '2026-12-31', 'open', $3) RETURNING id`,
      [tenantId, legalEntityId, userId],
    );
    periodId = period.rows[0].id;

    const coa = await pool.query(
      `INSERT INTO chart_of_accounts (tenant_id, legal_entity_id, coa_version_code, coa_version_date, is_active, created_by)
       VALUES ($1, $2, 'FY2026', '2026-01-01', true, $3) RETURNING id`,
      [tenantId, legalEntityId, userId],
    );
    const coaId = coa.rows[0].id;

    const mkAccount = (code: string, name: string, accountClass: string, normalBalance: string) =>
      pool.query(
        `INSERT INTO accounting_accounts (tenant_id, legal_entity_id, coa_id, account_code, account_name, account_class, normal_balance, is_active, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, true, $8)`,
        [tenantId, legalEntityId, coaId, code, name, accountClass, normalBalance, userId],
      );
    await mkAccount("1210", "Accounts Receivable", "ASSET", "debit");
    await mkAccount("2410", "Tax Payable", "LIABILITY", "credit");
    await mkAccount("2500", "Accrued WO Cost", "LIABILITY", "credit");
    await mkAccount("4100", "Service Revenue", "INCOME", "credit");
    await mkAccount("6200", "WO Cost", "EXPENSE", "debit");

    // Posting rules (v1 legs, same as seeding migrations 1794300000010 /
    // 1794400000010) — created_by left NULL so the kernel treats them as
    // tenant configuration.
    const mkRule = (code: string, name: string, trigger: string, legs: string) =>
      pool.query(
        `INSERT INTO posting_rules (tenant_id, rule_code, rule_name, rule_version, trigger_event_type, accounting_formula, requires_approval, effective_date, is_active)
         VALUES ($1, $2, $3, 'v1', $4, $5::jsonb, false, '2026-01-01', true)`,
        [tenantId, code, name, trigger, legs],
      );
    await mkRule("RULE_WO_COST_ACCUMULATED", "WO Cost Accumulated", "work_order.cost_accumulated", JSON.stringify([
      { accountCode: "6200", side: "debit", amountExpression: "AMOUNT" },
      { accountCode: "2500", side: "credit", amountExpression: "AMOUNT" },
    ]));
    await mkRule("RULE_WO_INVOICED", "WO Invoiced", "work_order.invoiced", JSON.stringify([
      { accountCode: "1210", side: "debit", amountExpression: "AMOUNT" },
      { accountCode: "4100", side: "credit", amountExpression: "AMOUNT" },
    ]));
    await mkRule("RULE_WO_INVOICE_TAX", "WO Invoice Tax", "work_order.invoice_tax", JSON.stringify([
      { accountCode: "1210", side: "debit", amountExpression: "AMOUNT" },
      { accountCode: "2410", side: "credit", amountExpression: "AMOUNT" },
    ]));

    // --- Consumer wiring (accounting-event-consumer.test.ts pattern) --------
    repo = new PgAccountingKernelRepository(pool);
    const eventPort = new PgAccountingEventWritePort(pool);
    const kernel = new AccountingKernelService(
      repo,
      {} as never,
      new AuditService(new PgAuditLogRepository(pool)),
      new RbacService(
        new PgRbacRepository(pool),
        new PgOrganizationUnitRepository(pool),
        new PgLegalEntityRepository(pool),
      ),
      new EventBus(new PgDomainEventRepository(pool), () => {}),
    );
    service = new AccountingEventConsumerService(kernel, eventPort, repo);

    // Tenant default markup for invoicing (level S).
    const param = await pool.query(`SELECT id FROM app_parameters WHERE code = $1`, [MARKUP_PARAM]);
    await pool.query(
      `INSERT INTO app_parameter_values (tenant_id, parameter_id, level, client_scope_id, value, updated_by)
       VALUES ($1, $2, 'S', NULL, '0.15'::jsonb, NULL)`,
      [tenantId, param.rows[0].id],
    );
  });

  afterAll(async () => {
    // Events are immutable; bypass the trigger via session_replication_role
    // scoped to one transaction (no table lock, safe alongside parallel
    // suites on the shared dev DB). Tenant cascade handles the rest.
    // Pool is a shared singleton managed by app lifecycle; never close it from tests.
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(`SET LOCAL session_replication_role = replica`);
      await client.query(`DELETE FROM tenants WHERE id = $1`, [tenantId]);
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
    await app.close();
  });

  /** WO through the full lifecycle to customer-accepted. Each transition is
   * asserted so an early failure (e.g. permission mismatch) points at the real
   * step rather than surfacing as a confusing downstream error. */
  async function acceptedWorkOrder(title: string): Promise<string> {
    const wo = await post("/work-orders", coordinatorToken, {
      customerId,
      serviceDefinitionCode: SERVICE_CODE,
      title,
    });
    expect(wo.statusCode).toBe(201);
    const woId = wo.json().id;
    const steps: Array<{ url: string; token: string; expected: number }> = [
      { url: `/work-orders/${woId}/assign`, token: coordinatorToken, expected: 200 },
      { url: `/work-orders/${woId}/actions/start`, token: coordinatorToken, expected: 200 },
      { url: `/work-orders/${woId}/start`, token: executorToken, expected: 200 },
      { url: `/work-orders/${woId}/complete`, token: executorToken, expected: 200 },
      { url: `/work-orders/${woId}/actions/complete`, token: coordinatorToken, expected: 200 },
      { url: `/work-orders/${woId}/verify`, token: verifierToken, expected: 200 },
      { url: `/work-orders/${woId}/customer-accept`, token: verifierToken, expected: 200 },
    ];
    const assignPayload = { assigneeUserId: executorUserId };
    for (const [i, s] of steps.entries()) {
      const res = await post(s.url, s.token, i === 0 ? assignPayload : {});
      expect(res.statusCode, `${s.url} failed with ${res.statusCode}: ${res.payload}`).toBe(s.expected);
    }
    return woId;
  }

  it("E2E-014: catering → WO → accept → cost → GL → invoice → AR, one chain", async () => {
    // 1. Catering batch confirmed (narrative link to the WO — no FK).
    const batchRow = await pool.query(
      `SELECT status, produced_at FROM catering_meal_batches
       WHERE tenant_id = $1 AND batch_number = 'BATCH-VER01-001'`,
      [tenantId],
    );
    expect(batchRow.rows[0].status).toBe("confirmed");
    expect(batchRow.rows[0].produced_at).not.toBeNull();

    // 2. WO lifecycle → accept.
    const woId = await acceptedWorkOrder("Catering pilot batch BATCH-VER01-001");

    // 3. Cost items + finalize.
    const mat = await post(`/work-orders/${woId}/cost-items`, coordinatorToken, { costType: "material", quantity: "2", unitCost: "10000" });
    expect(mat.statusCode).toBe(201);
    const lab = await post(`/work-orders/${woId}/cost-items`, coordinatorToken, { costType: "labor", quantity: "1", unitCost: "50000" });
    expect(lab.statusCode).toBe(201);
    const ovh = await post(`/work-orders/${woId}/cost-items`, coordinatorToken, { costType: "overhead", quantity: "1", unitCost: "5000" });
    expect(ovh.statusCode).toBe(201);
    const fin = await post(`/work-orders/${woId}/finalize-costs`, verifierToken, { legalEntityId });
    expect(fin.statusCode).toBe(200);
    expect(Number(fin.json().costsTotal)).toBe(75000);
    expect(fin.json().periodId).toBe(periodId);
    expect(fin.json().outboxEventEmitted).toBe(true);

    // 4. GL: drain outbox → cost journal posted (6200/2500).
    const afterCost = await service.processTenant(tenantId);
    expect(afterCost.posted).toBeGreaterThanOrEqual(1);

    // 5. Invoice (PPN 11%, markup default 0.15).
    const inv = await post(`/work-orders/${woId}/create-invoice`, billingToken, {
      legalEntityId,
      isTaxable: true,
    });
    expect(inv.statusCode).toBe(201);
    const invoice = inv.json().invoice;
    expect(Number(invoice.costBasis)).toBe(75000);
    expect(Number(invoice.baseAmount)).toBe(86250); // 75000 × 1.15
    expect(Number(invoice.taxAmount)).toBe(9487.5); // 86250 × 0.11
    expect(Number(invoice.totalAmount)).toBe(95737.5);
    expect(invoice.invoiceNumber).toMatch(/^INV-\d{5}$/);

    // 6. GL: drain outbox again → AR base + tax journals posted.
    const afterInvoice = await service.processTenant(tenantId);
    expect(afterInvoice.posted).toBeGreaterThanOrEqual(2);

    // 7. Journals: three posted journals with the right legs and amounts.
    const journals = await repo.listJournals(tenantId, { periodId, status: "posted" });
    expect(journals.length).toBe(3); // cost + AR base + AR tax

    const legs = await pool.query(
      `SELECT jh.id AS journal_header_id, aa.account_code,
              CASE WHEN jl.debit > 0 THEN 'debit' ELSE 'credit' END AS side,
              GREATEST(jl.debit, jl.credit) AS amount
       FROM journal_headers jh
       JOIN journal_lines jl ON jl.journal_header_id = jh.id
       JOIN accounting_accounts aa ON aa.id = jl.account_id
       WHERE jh.tenant_id = $1 AND jh.status = 'posted'`,
      [tenantId],
    );
    // Cost journal: 6200 debit / 2500 credit @ 75000 (one journal).
    const costHeaderIds = new Set(
      legs.rows.filter((r) => r.account_code === "6200").map((r) => r.journal_header_id),
    );
    expect(costHeaderIds.size).toBe(1);
    const costLegs = legs.rows.filter((r) => costHeaderIds.has(r.journal_header_id));
    expect(costLegs.map((r) => `${r.account_code}:${r.side}`).sort()).toEqual(["2500:credit", "6200:debit"]);
    for (const leg of costLegs) expect(Number(leg.amount)).toBe(75000);

    // AR base: 1210 debit / 4100 credit @ 86250.
    const baseHeaderIds = new Set(
      legs.rows.filter((r) => r.account_code === "4100").map((r) => r.journal_header_id),
    );
    expect(baseHeaderIds.size).toBe(1);
    const baseLegs = legs.rows.filter((r) => baseHeaderIds.has(r.journal_header_id));
    expect(baseLegs.map((r) => `${r.account_code}:${r.side}`).sort()).toEqual(["1210:debit", "4100:credit"]);
    for (const leg of baseLegs) expect(Number(leg.amount)).toBe(86250);

    // AR tax: 1210 debit / 2410 credit @ 9487.5 (numeric(18,4) → 9487.5000).
    const taxHeaderIds = new Set(
      legs.rows.filter((r) => r.account_code === "2410").map((r) => r.journal_header_id),
    );
    expect(taxHeaderIds.size).toBe(1);
    const taxLegs = legs.rows.filter((r) => taxHeaderIds.has(r.journal_header_id));
    expect(taxLegs.map((r) => `${r.account_code}:${r.side}`).sort()).toEqual(["1210:debit", "2410:credit"]);
    for (const leg of taxLegs) expect(Number(leg.amount)).toBe(9487.5);

    // 8. Event states: the three GL-posting chain events published + matched.
    // `work_order.accepted` is an acceptance marker from WP-OPS-01; it has no
    // GL metadata and is ignored by the accounting consumer.
    const states = await pool.query(
      `SELECT event_type, outbox_state, reconciliation_state
       FROM scm_accounting_ready_events
       WHERE tenant_id = $1
         AND event_type IN ('work_order.cost_accumulated', 'work_order.invoiced', 'work_order.invoice_tax')
         AND (source_document_id = $2
              OR source_document_id = (SELECT id FROM customer_invoices WHERE tenant_id = $1 AND work_order_id = $2))
       ORDER BY event_type`,
      [tenantId, woId],
    );
    expect(states.rows.map((r) => r.event_type).sort()).toEqual([
      "work_order.cost_accumulated",
      "work_order.invoice_tax",
      "work_order.invoiced",
    ]);
    for (const row of states.rows) {
      expect(row.outbox_state).toBe("published");
      expect(row.reconciliation_state).toBe("matched");
    }
  });
});
