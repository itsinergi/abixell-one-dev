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
} from "./helpers.js";

/**
 * WP-OPS-03 Phase 6 — Billing / AR (FR-FIN-008, E2E-010).
 *
 * Customer invoice from a cost-finalized Work Order: value =
 * costs_total × (1 + markup), markup default from the tenant parameter
 * `service_operations.invoice.default_markup`, optional PPN leg posting as
 * its own outbox event `work_order.invoice_tax` (a posting rule can carry
 * only one AMOUNT token). AR = base (RULE_WO_INVOICED: 1210/4100) + tax
 * (RULE_WO_INVOICE_TAX: 1210/2410).
 */

const TENANT = `test-ops-03-${Date.now()}`;
const OTHER = `test-ops-03-other-${Date.now()}`;
const WORKFLOW_CODE = "service_operations_work_order";
const SERVICE_CODE = "billing_ar_service";
const MARKUP_PARAM = "service_operations.invoice.default_markup";

describe("WP-OPS-03 Phase 6 — Billing / AR", () => {
  const app = buildApp();

  let tenantId: string;
  let adminToken: string;
  let coordinatorToken: string;
  let executorToken: string;
  let executorUserId: string;
  let verifierToken: string;
  let billingToken: string;
  let customerAId: string;

  let otherTenantId: string;
  let otherTenantAdminToken: string;
  let otherWorkOrderId: string;

  let legalEntityId: string;
  let periodId: string;
  let emptyLeId: string;

  const post = (url: string, token: string, payload: unknown = {}) =>
    app.inject({ method: "POST", url, headers: authHeader(token), payload });
  const get = (url: string, token: string) =>
    app.inject({ method: "GET", url, headers: authHeader(token) });

  async function buildWorkflow(token: string) {
    await post("/workflow/definitions", token, {
      code: WORKFLOW_CODE,
      name: "Work Order Lifecycle",
      entityType: "work_order",
      description: "Phase 6 billing test lifecycle",
    });
    const addStep = (body: Record<string, unknown>) =>
      post(`/workflow/definitions/${WORKFLOW_CODE}/versions/1/steps`, token, body);
    await addStep({ code: "PLANNED", name: "Planned", stepType: "task", isInitial: true });
    await addStep({ code: "IN_PROGRESS", name: "In Progress", stepType: "task" });
    await addStep({ code: "DONE", name: "Done", stepType: "approval" });
    await addStep({ code: "CLOSED", name: "Closed", stepType: "end", isTerminal: true, terminalStatus: "approved" });

    const addTransition = (body: Record<string, unknown>) =>
      post(`/workflow/definitions/${WORKFLOW_CODE}/versions/1/transitions`, token, body);
    await addTransition({ fromStepCode: "PLANNED", toStepCode: "IN_PROGRESS", actionCode: "start", name: "Start" });
    await addTransition({ fromStepCode: "IN_PROGRESS", toStepCode: "DONE", actionCode: "complete", name: "Complete" });
    await addTransition({ fromStepCode: "DONE", toStepCode: "CLOSED", actionCode: "verify", name: "Verify" });

    const addRule = (body: Record<string, unknown>) =>
      post(`/workflow/definitions/${WORKFLOW_CODE}/versions/1/assignment-rules`, token, body);
    for (const stepCode of ["PLANNED", "IN_PROGRESS", "DONE"]) {
      await addRule({ stepCode, assignmentType: "role", roleCode: "COORD_OPS", organizationUnitStrategy: "tenant" });
    }
    const publish = await post(`/workflow/definitions/${WORKFLOW_CODE}/versions/1/publish`, token);
    expect(publish.statusCode).toBe(200);
  }

  /** WO to customer-accepted state. */
  async function acceptedWorkOrder(title: string): Promise<string> {
    const wo = await post("/work-orders", coordinatorToken, {
      customerId: customerAId,
      serviceDefinitionCode: SERVICE_CODE,
      title,
    });
    const woId = wo.json().id;
    await post(`/work-orders/${woId}/assign`, coordinatorToken, { assigneeUserId: executorUserId });
    await post(`/work-orders/${woId}/actions/start`, coordinatorToken, {});
    await post(`/work-orders/${woId}/start`, executorToken, {});
    await post(`/work-orders/${woId}/complete`, executorToken, {});
    await post(`/work-orders/${woId}/actions/complete`, coordinatorToken, {});
    await post(`/work-orders/${woId}/verify`, verifierToken, {});
    const accepted = await post(`/work-orders/${woId}/customer-accept`, verifierToken, {});
    expect(accepted.statusCode).toBe(200);
    return woId;
  }

  const addCost = (woId: string, body: Record<string, unknown>) =>
    post(`/work-orders/${woId}/cost-items`, coordinatorToken, body);

  /** Accept → add costs → finalize. Returns the WO id; cost basis defaults
   * to 100000 unless overridden. */
  async function finalizedWorkOrder(title: string, costTotal = "100000"): Promise<string> {
    const woId = await acceptedWorkOrder(title);
    await addCost(woId, { costType: "material", quantity: "10", unitCost: String(Number(costTotal) / 10) });
    const fin = await post(`/work-orders/${woId}/finalize-costs`, verifierToken, { legalEntityId });
    expect(fin.statusCode).toBe(200);
    return woId;
  }

  beforeAll(async () => {
    const t = await bootstrapTenant(app, TENANT, "Tenant Billing AR");
    await activateAllModules(t.id);
    tenantId = t.id;
    await provisionFirstAdmin({ tenantId, email: "admin@ops3.local", password: "Admin12345!" });
    adminToken = (await login(app, TENANT, "admin@ops3.local", "Admin12345!")).body.accessToken;

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

    const customerA = await post("/customers", adminToken, { code: "CUST-OPS3-A", name: "Customer A" });
    customerAId = customerA.json().id;
    await post("/sites", adminToken, { customerId: customerAId, code: "SITE-OPS3-A", name: "Site A" });

    const mkInternalUser = (email: string, roleCode: string) =>
      post("/admin/users", adminToken, {
        email,
        fullName: email,
        password: "Passw0rd12345!",
        pairs: [{ roleCode, scopeType: "tenant" }],
      });

    await mkInternalUser("coord@ops3.local", "COORD_OPS");
    executorUserId = (await mkInternalUser("exec@ops3.local", "EXEC_OPS")).json().user.id;
    await mkInternalUser("verify@ops3.local", "VERIFY_OPS");
    await mkInternalUser("bill@ops3.local", "BILL_OPS");

    const tok = async (email: string) => (await login(app, TENANT, email, "Passw0rd12345!")).body.accessToken;
    coordinatorToken = await tok("coord@ops3.local");
    executorToken = await tok("exec@ops3.local");
    verifierToken = await tok("verify@ops3.local");
    billingToken = await tok("bill@ops3.local");

    await post("/config/numbering/work_order", adminToken, { pattern: "WO-{SEQ:5}" });
    await buildWorkflow(adminToken);
    await post("/service-definitions", coordinatorToken, {
      code: SERVICE_CODE,
      name: "Billing AR Service",
    });

    // Invoice numbering + tenant default markup (level S for this tenant).
    await post("/config/numbering/customer_invoice", adminToken, { pattern: "INV-{SEQ:5}" });
    const param = await pool.query(`SELECT id FROM app_parameters WHERE code = $1`, [MARKUP_PARAM]);
    await pool.query(
      `INSERT INTO app_parameter_values (tenant_id, parameter_id, level, client_scope_id, value, updated_by)
       VALUES ($1, $2, 'S', NULL, '0.15'::jsonb, NULL)`,
      [tenantId, param.rows[0].id],
    );

    const le = await pool.query(
      `INSERT INTO legal_entities (tenant_id, name) VALUES ($1, 'LE Ops3') RETURNING id`,
      [tenantId],
    );
    legalEntityId = le.rows[0].id;
    const emptyLe = await pool.query(
      `INSERT INTO legal_entities (tenant_id, name) VALUES ($1, 'LE Ops3 No Period') RETURNING id`,
      [tenantId],
    );
    emptyLeId = emptyLe.rows[0].id;
    const period = await pool.query(
      `INSERT INTO accounting_periods (tenant_id, legal_entity_id, fiscal_year_code, period_code, period_name, period_type, date_from, date_to, status)
       VALUES ($1, $2, 'FY2026', 'P-OPS3', 'Ops3 Period', 'monthly', '2026-01-01', '2026-12-31', 'open') RETURNING id`,
      [tenantId, legalEntityId],
    );
    periodId = period.rows[0].id;

    const ot = await bootstrapTenant(app, OTHER, "Tenant Ops3 Other");
    await activateAllModules(ot.id);
    otherTenantId = ot.id;
    await provisionFirstAdmin({ tenantId: ot.id, email: "admin@ops3other.local", password: "Admin12345!" });
    otherTenantAdminToken = (await login(app, OTHER, "admin@ops3other.local", "Admin12345!")).body.accessToken;
    await post("/config/numbering/work_order", otherTenantAdminToken, { pattern: "WO-O-{SEQ:5}" });
    await buildWorkflow(otherTenantAdminToken);
    await post("/service-definitions", otherTenantAdminToken, { code: SERVICE_CODE, name: "Other Service" });
    const otherCust = await post("/customers", otherTenantAdminToken, { code: "CUST-O3", name: "Other Cust" });
    const otherWo = await post("/work-orders", otherTenantAdminToken, {
      customerId: otherCust.json().id,
      serviceDefinitionCode: SERVICE_CODE,
      title: "Other tenant WO",
    });
    otherWorkOrderId = otherWo.json().id;
  });

  afterAll(async () => {
    await pool.query(`ALTER TABLE scm_accounting_ready_events DISABLE TRIGGER trg_scm_accounting_ready_events_immutable_facts`);
    try {
      for (const tid of [tenantId, otherTenantId]) {
        await pool.query(`DELETE FROM customer_invoices WHERE tenant_id = $1`, [tid]);
        await pool.query(`DELETE FROM scm_accounting_ready_events WHERE tenant_id = $1 AND event_type IN ('work_order.invoiced','work_order.invoice_tax')`, [tid]);
        await pool.query(`DELETE FROM work_order_cost_items WHERE tenant_id = $1`, [tid]);
        await pool.query(`DELETE FROM work_order_acceptance_tokens WHERE tenant_id = $1`, [tid]);
        await pool.query(`DELETE FROM survey_integration_executions WHERE tenant_id = $1`, [tid]);
        await pool.query(`DELETE FROM work_orders WHERE tenant_id = $1`, [tid]);
        await pool.query(`DELETE FROM customers WHERE tenant_id = $1`, [tid]);
        await pool.query(
          `DELETE FROM app_parameter_values WHERE tenant_id = $1 AND parameter_id = (SELECT id FROM app_parameters WHERE code = $2)`,
          [tid, MARKUP_PARAM],
        );
      }
    } finally {
      await pool.query(`ALTER TABLE scm_accounting_ready_events ENABLE TRIGGER trg_scm_accounting_ready_events_immutable_facts`);
    }
    await pool.query(`DELETE FROM accounting_periods WHERE id = $1`, [periodId]);
    await pool.query(`DELETE FROM legal_entities WHERE id IN ($1, $2)`, [legalEntityId, emptyLeId]);

    await app.close();
    await pool.end();
  });

  const invoiceEvents = (woId: string) =>
    pool.query(
      `SELECT e.event_type, e.amount, e.idempotency_key, e.payload
       FROM scm_accounting_ready_events e
       JOIN customer_invoices ci ON ci.id = e.source_document_id
       WHERE ci.work_order_id = $1
         AND e.event_type IN ('work_order.invoiced','work_order.invoice_tax')
       ORDER BY e.event_type`,
      [woId],
    );

  // --- createInvoice -------------------------------------------------------

  it("OPS-03-001: non-taxable invoice uses tenant default markup; one event", async () => {
    const woId = await finalizedWorkOrder("Invoice default markup");
    const res = await post(`/work-orders/${woId}/create-invoice`, billingToken, {
      legalEntityId,
      isTaxable: false,
    });
    expect(res.statusCode).toBe(201);
    const inv = res.json().invoice;
    expect(Number(inv.costBasis)).toBe(100000);
    expect(Number(inv.markupRate)).toBe(0.15);
    expect(Number(inv.baseAmount)).toBe(115000);
    expect(inv.isTaxable).toBe(false);
    expect(inv.taxRate).toBeNull();
    expect(Number(inv.taxAmount)).toBe(0);
    expect(Number(inv.totalAmount)).toBe(115000);
    expect(inv.invoiceNumber).toMatch(/^INV-\d{5}$/);
    expect(inv.arStatus).toBe("open");

    const ev = await invoiceEvents(woId);
    expect(ev.rows.length).toBe(1);
    expect(ev.rows[0].event_type).toBe("work_order.invoiced");
    expect(Number(ev.rows[0].amount)).toBe(115000);
    expect(ev.rows[0].payload.legalEntityId).toBe(legalEntityId);
    expect(ev.rows[0].payload.periodId).toBe(periodId);
    expect(typeof ev.rows[0].payload.legalEntityId).toBe("string");
    expect(typeof ev.rows[0].payload.periodId).toBe("string");
    expect(ev.rows[0].payload.sourceDocumentType).toBe("customer_invoice");
    expect(typeof ev.rows[0].payload.sourceDocumentId).toBe("string");
  });

  it("OPS-03-002: markup override wins over tenant default", async () => {
    const woId = await finalizedWorkOrder("Invoice markup override");
    const res = await post(`/work-orders/${woId}/create-invoice`, billingToken, {
      legalEntityId,
      markupRate: "0.25",
      isTaxable: false,
    });
    expect(res.statusCode).toBe(201);
    expect(Number(res.json().invoice.markupRate)).toBe(0.25);
    expect(Number(res.json().invoice.baseAmount)).toBe(125000);
  });

  it("OPS-03-003: taxable invoice defaults to 11% PPN; two events", async () => {
    const woId = await finalizedWorkOrder("Invoice taxable default");
    const res = await post(`/work-orders/${woId}/create-invoice`, billingToken, {
      legalEntityId,
      isTaxable: true,
    });
    expect(res.statusCode).toBe(201);
    const inv = res.json().invoice;
    expect(Number(inv.taxRate)).toBe(0.11);
    expect(Number(inv.baseAmount)).toBe(115000);
    // 115000 * 0.11 = 12650
    expect(Number(inv.taxAmount)).toBe(12650);
    expect(Number(inv.totalAmount)).toBe(127650);

    const ev = await invoiceEvents(woId);
    expect(ev.rows.length).toBe(2);
    const byType = Object.fromEntries(ev.rows.map((r) => [r.event_type, r]));
    expect(Number(byType["work_order.invoiced"].amount)).toBe(115000);
    expect(Number(byType["work_order.invoice_tax"].amount)).toBe(12650);
    expect(byType["work_order.invoiced"].idempotency_key).toBe(`wo-inv:${woId}`);
    expect(byType["work_order.invoice_tax"].idempotency_key).toBe(`wo-inv-tax:${woId}`);
  });

  it("OPS-03-004: tax rate override persists and calculates", async () => {
    const woId = await finalizedWorkOrder("Invoice tax override");
    const res = await post(`/work-orders/${woId}/create-invoice`, billingToken, {
      legalEntityId,
      isTaxable: true,
      taxRate: "0.05",
    });
    expect(res.statusCode).toBe(201);
    expect(Number(res.json().invoice.taxRate)).toBe(0.05);
    expect(Number(res.json().invoice.taxAmount)).toBe(5750);
    expect(Number(res.json().invoice.totalAmount)).toBe(120750);
  });

  it("OPS-03-005: taxable with taxRate 0 → tax_amount 0, exactly one event", async () => {
    const woId = await finalizedWorkOrder("Invoice zero tax");
    const res = await post(`/work-orders/${woId}/create-invoice`, billingToken, {
      legalEntityId,
      isTaxable: true,
      taxRate: "0",
    });
    expect(res.statusCode).toBe(201);
    expect(Number(res.json().invoice.taxAmount)).toBe(0);
    const ev = await invoiceEvents(woId);
    expect(ev.rows.length).toBe(1);
    expect(ev.rows[0].event_type).toBe("work_order.invoiced");
  });

  it("OPS-03-006: invoice before costs finalized → 409", async () => {
    const woId = await acceptedWorkOrder("Invoice not finalized");
    const res = await post(`/work-orders/${woId}/create-invoice`, billingToken, {
      legalEntityId,
      isTaxable: false,
    });
    expect(res.statusCode).toBe(409);
  });

  it("OPS-03-007: duplicate invoice → 409; outbox rows unchanged", async () => {
    const woId = await finalizedWorkOrder("Invoice duplicate");
    const first = await post(`/work-orders/${woId}/create-invoice`, billingToken, {
      legalEntityId,
      isTaxable: false,
    });
    expect(first.statusCode).toBe(201);
    const again = await post(`/work-orders/${woId}/create-invoice`, billingToken, {
      legalEntityId,
      isTaxable: false,
    });
    expect(again.statusCode).toBe(409);
    const ev = await invoiceEvents(woId);
    expect(ev.rows.length).toBe(1);
  });

  it("OPS-03-008: concurrent create — one 201, one 409, exact outbox rows", async () => {
    const woId = await finalizedWorkOrder("Invoice concurrent");
    const [a, b] = await Promise.all([
      post(`/work-orders/${woId}/create-invoice`, billingToken, { legalEntityId, isTaxable: true }),
      post(`/work-orders/${woId}/create-invoice`, billingToken, { legalEntityId, isTaxable: true }),
    ]);
    const statuses = [a.statusCode, b.statusCode].sort();
    expect(statuses).toEqual([201, 409]);
    const ev = await invoiceEvents(woId);
    expect(ev.rows.length).toBe(2);
    const types = ev.rows.map((r) => r.event_type).sort();
    expect(types).toEqual(["work_order.invoice_tax", "work_order.invoiced"]);
  });

  it("OPS-03-009: foreign legal entity → 404 before lifecycle leak", async () => {
    const woId = await acceptedWorkOrder("Invoice foreign LE");
    const res = await post(`/work-orders/${woId}/create-invoice`, billingToken, {
      legalEntityId: "00000000-0000-4000-8000-000000000003",
      isTaxable: false,
    });
    expect(res.statusCode).toBe(404);
  });

  it("OPS-03-010: legal entity with no open period → 409", async () => {
    const woId = await finalizedWorkOrder("Invoice no period", "50000");
    const res = await post(`/work-orders/${woId}/create-invoice`, billingToken, {
      legalEntityId: emptyLeId,
      isTaxable: false,
    });
    expect(res.statusCode).toBe(409);
  });

  it("OPS-03-011: user without billing.manage cannot create invoice (403)", async () => {
    const woId = await finalizedWorkOrder("Invoice perm");
    const res = await post(`/work-orders/${woId}/create-invoice`, coordinatorToken, {
      legalEntityId,
      isTaxable: false,
    });
    expect(res.statusCode).toBe(403);
  });

  it("OPS-03-012: billing.manage holder CAN create invoice; verify-only cannot", async () => {
    const woId = await finalizedWorkOrder("Invoice billing holder");
    const denied = await post(`/work-orders/${woId}/create-invoice`, executorToken, {
      legalEntityId,
      isTaxable: false,
    });
    expect(denied.statusCode).toBe(403);
    const ok = await post(`/work-orders/${woId}/create-invoice`, billingToken, {
      legalEntityId,
      isTaxable: false,
    });
    expect(ok.statusCode).toBe(201);
  });

  it("OPS-03-013: cross-tenant create → 404", async () => {
    const res = await post(`/work-orders/${otherWorkOrderId}/create-invoice`, billingToken, {
      legalEntityId,
      isTaxable: false,
    });
    expect(res.statusCode).toBe(404);
  });

  it("OPS-03-014: invalid markup/tax rates → 400", async () => {
    const woId = await finalizedWorkOrder("Invoice bad rates");
    for (const body of [
      { legalEntityId, isTaxable: false, markupRate: "-0.1" },
      { legalEntityId, isTaxable: false, markupRate: "1.5" },
      { legalEntityId, isTaxable: false, markupRate: "abc" },
      { legalEntityId, isTaxable: false, markupRate: "0.1234567" },
      { legalEntityId, isTaxable: true, taxRate: "1.0000001" },
      { legalEntityId, isTaxable: true, taxRate: "-0.05" },
    ]) {
      const res = await post(`/work-orders/${woId}/create-invoice`, billingToken, body);
      expect(res.statusCode).toBe(400);
    }
  });

  it("OPS-03-015: outbox event types satisfy the widened CHECK (17 types)", async () => {
    const ev = await pool.query(
      `SELECT DISTINCT event_type FROM scm_accounting_ready_events WHERE event_type IN ('work_order.invoiced','work_order.invoice_tax')`,
    );
    expect(ev.rows.length).toBe(2);
  });

  // --- getInvoice ----------------------------------------------------------

  it("OPS-03-016: GET invoice 200 after create", async () => {
    const woId = await finalizedWorkOrder("Get invoice ok");
    await post(`/work-orders/${woId}/create-invoice`, billingToken, { legalEntityId, isTaxable: false });
    const res = await get(`/work-orders/${woId}/invoice`, coordinatorToken);
    expect(res.statusCode).toBe(200);
    expect(res.json().workOrderId).toBe(woId);
    expect(res.json().invoiceNumber).toMatch(/^INV-\d{5}$/);
  });

  it("OPS-03-017: GET invoice before invoicing → 404", async () => {
    const woId = await finalizedWorkOrder("Get invoice missing");
    const res = await get(`/work-orders/${woId}/invoice`, coordinatorToken);
    expect(res.statusCode).toBe(404);
  });

  it("OPS-03-018: GET invoice cross-tenant → 403/404", async () => {
    const res = await get(`/work-orders/${otherWorkOrderId}/invoice`, coordinatorToken);
    expect([403, 404]).toContain(res.statusCode);
  });

  it("OPS-03-019: full smoke — accept → costs → finalize → taxable invoice → open + two outbox rows", async () => {
    const woId = await finalizedWorkOrder("Full smoke invoice", "250000");
    const res = await post(`/work-orders/${woId}/create-invoice`, billingToken, {
      legalEntityId,
      isTaxable: true,
    });
    expect(res.statusCode).toBe(201);
    const inv = res.json().invoice;
    expect(Number(inv.costBasis)).toBe(250000);
    expect(Number(inv.baseAmount)).toBe(287500);
    expect(Number(inv.taxAmount)).toBe(31625);
    expect(Number(inv.totalAmount)).toBe(319125);

    const stored = await get(`/work-orders/${woId}/invoice`, coordinatorToken);
    expect(stored.json().arStatus).toBe("open");
    const ev = await invoiceEvents(woId);
    expect(ev.rows.length).toBe(2);
  });
});
