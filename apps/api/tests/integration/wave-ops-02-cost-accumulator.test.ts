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
 * WP-OPS-02 Phase 6 — Work Order Cost Accumulator (FR-OPS-002, E2E-010).
 *
 * Manual cost items (material / labor / overhead) on customer-accepted Work
 * Orders, guarded finalize, and outbox event `work_order.cost_accumulated`
 * carrying real amount + legalEntityId + periodId so the accounting-event
 * consumer can post to GL via seeded rule RULE_WO_COST_ACCUMULATED.
 */

const TENANT = `test-ops-02-${Date.now()}`;
const OTHER = `test-ops-02-other-${Date.now()}`;
const WORKFLOW_CODE = "service_operations_work_order";
const SERVICE_CODE = "cost_accumulator_service";

describe("WP-OPS-02 Phase 6 — Work Order Cost Accumulator", () => {
  const app = buildApp();

  let tenantId: string;
  let adminToken: string;
  let coordinatorToken: string;
  let executorToken: string;
  let executorUserId: string;
  let verifierToken: string;
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

  /** Build the Work Order lifecycle as Tenant Configuration (same shape as
   * wave-ops-01-acceptance). */
  async function buildWorkflow(token: string) {
    await post("/workflow/definitions", token, {
      code: WORKFLOW_CODE,
      name: "Work Order Lifecycle",
      entityType: "work_order",
      description: "Phase 6 cost accumulator test lifecycle",
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

  /** WO through internal acceptance — cost recording precondition. */
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

  beforeAll(async () => {
    const t = await bootstrapTenant(app, TENANT, "Tenant Cost Accumulator");
    await activateAllModules(t.id);
    tenantId = t.id;
    await provisionFirstAdmin({ tenantId, email: "admin@ops2.local", password: "Admin12345!" });
    adminToken = (await login(app, TENANT, "admin@ops2.local", "Admin12345!")).body.accessToken;

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

    const customerA = await post("/customers", adminToken, { code: "CUST-OPS2-A", name: "Customer A" });
    customerAId = customerA.json().id;
    await post("/sites", adminToken, { customerId: customerAId, code: "SITE-OPS2-A", name: "Site A" });

    const mkInternalUser = (email: string, roleCode: string) =>
      post("/admin/users", adminToken, {
        email,
        fullName: email,
        password: "Passw0rd12345!",
        pairs: [{ roleCode, scopeType: "tenant" }],
      });

    await mkInternalUser("coord@ops2.local", "COORD_OPS");
    executorUserId = (await mkInternalUser("exec@ops2.local", "EXEC_OPS")).json().user.id;
    await mkInternalUser("verify@ops2.local", "VERIFY_OPS");

    const tok = async (email: string) => (await login(app, TENANT, email, "Passw0rd12345!")).body.accessToken;
    coordinatorToken = await tok("coord@ops2.local");
    executorToken = await tok("exec@ops2.local");
    verifierToken = await tok("verify@ops2.local");

    await post("/config/numbering/work_order", adminToken, { pattern: "WO-{SEQ:5}" });
    await buildWorkflow(adminToken);
    await post("/service-definitions", coordinatorToken, {
      code: SERVICE_CODE,
      name: "Cost Accumulator Service",
    });

    // Legal entity + open accounting period covering 2026 (finalizeCosts
    // resolves periodId from these rows), plus a second entity with NO open
    // period for the negative case.
    const le = await pool.query(
      `INSERT INTO legal_entities (tenant_id, name) VALUES ($1, 'LE Ops2') RETURNING id`,
      [tenantId],
    );
    legalEntityId = le.rows[0].id;
    const emptyLe = await pool.query(
      `INSERT INTO legal_entities (tenant_id, name) VALUES ($1, 'LE Ops2 No Period') RETURNING id`,
      [tenantId],
    );
    emptyLeId = emptyLe.rows[0].id;
    const period = await pool.query(
      `INSERT INTO accounting_periods (tenant_id, legal_entity_id, fiscal_year_code, period_code, period_name, period_type, date_from, date_to, status)
       VALUES ($1, $2, 'FY2026', 'P-OPS2', 'Ops2 Period', 'monthly', '2026-01-01', '2026-12-31', 'open') RETURNING id`,
      [tenantId, legalEntityId],
    );
    periodId = period.rows[0].id;

    // Second tenant for cross-tenant isolation.
    const ot = await bootstrapTenant(app, OTHER, "Tenant Ops2 Other");
    await activateAllModules(ot.id);
    otherTenantId = ot.id;
    await provisionFirstAdmin({ tenantId: ot.id, email: "admin@ops2other.local", password: "Admin12345!" });
    otherTenantAdminToken = (await login(app, OTHER, "admin@ops2other.local", "Admin12345!")).body.accessToken;
    await post("/config/numbering/work_order", otherTenantAdminToken, { pattern: "WO-O-{SEQ:5}" });
    await buildWorkflow(otherTenantAdminToken);
    await post("/service-definitions", otherTenantAdminToken, { code: SERVICE_CODE, name: "Other Service" });
    const otherCust = await post("/customers", otherTenantAdminToken, { code: "CUST-O2", name: "Other Cust" });
    const otherWo = await post("/work-orders", otherTenantAdminToken, {
      customerId: otherCust.json().id,
      serviceDefinitionCode: SERVICE_CODE,
      title: "Other tenant WO",
    });
    otherWorkOrderId = otherWo.json().id;
  });

  afterAll(async () => {
    // FK-safe teardown, cost items first.
    for (const tid of [tenantId, otherTenantId]) {
      await pool.query(`DELETE FROM work_order_cost_items WHERE tenant_id = $1`, [tid]);
      await pool.query(`DELETE FROM work_order_acceptance_tokens WHERE tenant_id = $1`, [tid]);
      await pool.query(`DELETE FROM survey_integration_executions WHERE tenant_id = $1`, [tid]);
      await pool.query(`DELETE FROM work_orders WHERE tenant_id = $1`, [tid]);
      await pool.query(`DELETE FROM customers WHERE tenant_id = $1`, [tid]);
    }
    await pool.query(`DELETE FROM accounting_periods WHERE id = $1`, [periodId]);
    await pool.query(`DELETE FROM legal_entities WHERE id IN ($1, $2)`, [legalEntityId, emptyLeId]);

    await app.close();
    await pool.end();
  });

  // --- addCostItem -------------------------------------------------------

  it("OPS-02-001: addCostItem succeeds on accepted WO (labor)", async () => {
    const woId = await acceptedWorkOrder("Cost labor");
    const added = await addCost(woId, { costType: "labor", quantity: "4", unitCost: "150000" });
    expect(added.statusCode).toBe(201);
    expect(added.json().costType).toBe("labor");
    expect(Number(added.json().totalCost)).toBe(600000);
  });

  it("OPS-02-002: addCostItem succeeds for material and overhead", async () => {
    const woId = await acceptedWorkOrder("Cost material overhead");
    for (const costType of ["material", "overhead"]) {
      const added = await addCost(woId, { costType, quantity: "2", unitCost: "50000" });
      expect(added.statusCode).toBe(201);
      expect(Number(added.json().totalCost)).toBe(100000);
    }
  });

  it("OPS-02-003: addCostItem rejected before WO is customer-accepted (409)", async () => {
    const wo = await post("/work-orders", coordinatorToken, {
      customerId: customerAId,
      serviceDefinitionCode: SERVICE_CODE,
      title: "Not accepted yet",
    });
    const added = await addCost(wo.json().id, { costType: "material", quantity: "1", unitCost: "1000" });
    expect(added.statusCode).toBe(409);
  });

  it("OPS-02-004: addCostItem rejected after finalize (409)", async () => {
    const woId = await acceptedWorkOrder("Cost after finalize");
    await addCost(woId, { costType: "material", quantity: "1", unitCost: "1000" });
    const fin = await post(`/work-orders/${woId}/finalize-costs`, verifierToken, { legalEntityId });
    expect(fin.statusCode).toBe(200);
    const again = await addCost(woId, { costType: "material", quantity: "1", unitCost: "1000" });
    expect(again.statusCode).toBe(409);
  });

  it("OPS-02-005: addCostItem on another tenant's WO → 403/404", async () => {
    const added = await addCost(otherWorkOrderId, { costType: "material", quantity: "1", unitCost: "1000" });
    expect([403, 404]).toContain(added.statusCode);
  });

  it("OPS-02-006: listCostItems returns items, tenant-scoped", async () => {
    const woId = await acceptedWorkOrder("Cost list");
    await addCost(woId, { costType: "labor", quantity: "1", unitCost: "100" });
    await addCost(woId, { costType: "material", quantity: "2", unitCost: "200" });
    const listed = await get(`/work-orders/${woId}/cost-items`, coordinatorToken);
    expect(listed.statusCode).toBe(200);
    expect(listed.json().length).toBe(2);
  });

  // --- finalizeCosts -------------------------------------------------------

  it("OPS-02-007: finalizeCosts rejected if no cost items (422)", async () => {
    const woId = await acceptedWorkOrder("Finalize empty");
    const fin = await post(`/work-orders/${woId}/finalize-costs`, verifierToken, { legalEntityId });
    expect([422, 400]).toContain(fin.statusCode);
  });

  it("OPS-02-008: finalizeCosts rejected if WO not accepted (409)", async () => {
    const wo = await post("/work-orders", coordinatorToken, {
      customerId: customerAId,
      serviceDefinitionCode: SERVICE_CODE,
      title: "Not accepted finalize",
    });
    const fin = await post(`/work-orders/${wo.json().id}/finalize-costs`, verifierToken, { legalEntityId });
    expect(fin.statusCode).toBe(409);
  });

  it("OPS-02-009: finalizeCosts succeeds → costs set, outbox amount + payload correct", async () => {
    const woId = await acceptedWorkOrder("Finalize ok");
    await addCost(woId, { costType: "material", quantity: "3", unitCost: "10000" });
    await addCost(woId, { costType: "labor", quantity: "2", unitCost: "25000" });
    const fin = await post(`/work-orders/${woId}/finalize-costs`, verifierToken, { legalEntityId });
    expect(fin.statusCode).toBe(200);
    // numeric(18,4) serialises with scale; compare numerically.
    expect(Number(fin.json().costsTotal)).toBe(80000);
    expect(fin.json().periodId).toBe(periodId);
    expect(fin.json().outboxEventEmitted).toBe(true);

    const ev = await pool.query(
      `SELECT amount, quantity, payload FROM scm_accounting_ready_events
       WHERE source_document_id = $1 AND event_type = 'work_order.cost_accumulated'`,
      [woId],
    );
    expect(ev.rows.length).toBe(1);
    expect(Number(ev.rows[0].amount)).toBe(80000);
    expect(Number(ev.rows[0].quantity)).toBe(1);
    expect(ev.rows[0].payload.legalEntityId).toBe(legalEntityId);
    expect(ev.rows[0].payload.periodId).toBe(periodId);
  });

  it("OPS-02-010: finalizeCosts second call → 409 (already finalized)", async () => {
    const woId = await acceptedWorkOrder("Finalize twice");
    await addCost(woId, { costType: "material", quantity: "1", unitCost: "5000" });
    await post(`/work-orders/${woId}/finalize-costs`, verifierToken, { legalEntityId });
    const again = await post(`/work-orders/${woId}/finalize-costs`, verifierToken, { legalEntityId });
    expect(again.statusCode).toBe(409);
  });

  it("OPS-02-011: finalizeCosts with legal entity lacking open period → 409", async () => {
    const woId = await acceptedWorkOrder("Finalize no period");
    await addCost(woId, { costType: "material", quantity: "1", unitCost: "1000" });
    const fin = await post(`/work-orders/${woId}/finalize-costs`, verifierToken, { legalEntityId: emptyLeId });
    expect(fin.statusCode).toBe(409);
  });

  it("OPS-02-012: outbox payload carries legalEntityId + periodId (consumer postable)", async () => {
    const woId = await acceptedWorkOrder("Payload fields");
    await addCost(woId, { costType: "overhead", quantity: "1", unitCost: "12345" });
    await post(`/work-orders/${woId}/finalize-costs`, verifierToken, { legalEntityId });
    const ev = await pool.query(
      `SELECT payload FROM scm_accounting_ready_events
       WHERE source_document_id = $1 AND event_type = 'work_order.cost_accumulated'`,
      [woId],
    );
    expect(ev.rows[0].payload.legalEntityId).toBe(legalEntityId);
    expect(ev.rows[0].payload.periodId).toBe(periodId);
    expect(ev.rows[0].payload.workOrderNumber).toMatch(/^WO-\d{5}$/);
  });

  it("OPS-02-013: outbox event type satisfies the widened CHECK (15 types)", async () => {
    // OPS-02-009/012 already insert rows of the new type; this asserts the
    // consumer-visible discriminator directly.
    const ev = await pool.query(
      `SELECT DISTINCT event_type FROM scm_accounting_ready_events WHERE event_type = 'work_order.cost_accumulated'`,
    );
    expect(ev.rows.length).toBeGreaterThan(0);
  });

  it("OPS-02-014: non-manage user cannot addCostItem (403)", async () => {
    const woId = await acceptedWorkOrder("Perm manage");
    const denied = await post(`/work-orders/${woId}/cost-items`, verifierToken, {
      costType: "material",
      quantity: "1",
      unitCost: "1000",
    });
    expect(denied.statusCode).toBe(403);
  });

  it("OPS-02-015: non-verify user cannot finalizeCosts (403)", async () => {
    const woId = await acceptedWorkOrder("Finalize perm");
    await addCost(woId, { costType: "material", quantity: "1", unitCost: "1000" });
    const denied = await post(`/work-orders/${woId}/finalize-costs`, coordinatorToken, { legalEntityId });
    expect(denied.statusCode).toBe(403);
  });

  it("OPS-02-016: cross-tenant GET cost items → 403/404", async () => {
    const listed = await get(`/work-orders/${otherWorkOrderId}/cost-items`, coordinatorToken);
    expect([403, 404]).toContain(listed.statusCode);
  });

  it("OPS-02-017: outbox idempotency key is wo-cost:{woId}", async () => {
    const woId = await acceptedWorkOrder("Idem key");
    await addCost(woId, { costType: "material", quantity: "1", unitCost: "7000" });
    await post(`/work-orders/${woId}/finalize-costs`, verifierToken, { legalEntityId });
    const ev = await pool.query(
      `SELECT idempotency_key FROM scm_accounting_ready_events
       WHERE source_document_id = $1 AND event_type = 'work_order.cost_accumulated'`,
      [woId],
    );
    expect(ev.rows.length).toBe(1);
    expect(ev.rows[0].idempotency_key).toBe(`wo-cost:${woId}`);
  });

  it("OPS-02-018: full smoke — lifecycle → accept → 3 items → finalize → event amount", async () => {
    const woId = await acceptedWorkOrder("Full smoke");
    await addCost(woId, { costType: "material", quantity: "2", unitCost: "10000" });
    await addCost(woId, { costType: "labor", quantity: "1", unitCost: "50000" });
    await addCost(woId, { costType: "overhead", quantity: "1", unitCost: "5000" });
    const fin = await post(`/work-orders/${woId}/finalize-costs`, verifierToken, { legalEntityId });
    expect(fin.statusCode).toBe(200);
    expect(Number(fin.json().costsTotal)).toBe(75000);
    const ev = await pool.query(
      `SELECT amount FROM scm_accounting_ready_events
       WHERE source_document_id = $1 AND event_type = 'work_order.cost_accumulated'`,
      [woId],
    );
    expect(Number(ev.rows[0].amount)).toBe(75000);
  });

  // --- review follow-up coverage -----------------------------------------

  it("OPS-02-019: reject negative and sub-scale quantity/unitCost (400)", async () => {
    const woId = await acceptedWorkOrder("Negative guard");
    for (const body of [
      { costType: "material", quantity: "-1", unitCost: "1000" },
      { costType: "material", quantity: "1", unitCost: "-1000" },
      // 5 decimal places exceeds numeric(18,4) scale.
      { costType: "material", quantity: "0.00001", unitCost: "1000" },
      // 15 integer digits exceeds numeric(18,4) precision.
      { costType: "material", quantity: "100000000000000", unitCost: "1" },
    ]) {
      const added = await addCost(woId, body);
      expect(added.statusCode).toBe(400);
    }
  });

  it("OPS-02-020: unknown cost center → 404; foreign legal entity on tenant-2 WO → 404", async () => {
    const woId = await acceptedWorkOrder("Cross-tenant refs");
    const badCc = await addCost(woId, {
      costType: "material",
      quantity: "1",
      unitCost: "1000",
      costCenterId: "00000000-0000-4000-8000-000000000001",
    });
    expect(badCc.statusCode).toBe(404);

    // Tenant-1's legalEntityId handed to a tenant-2 WO — finalize must not
    // attach a foreign entity. (WO not accepted: the entity check must fire
    // before the acceptance guard, which is the 409/404 discriminator.)
    const cust = await post("/customers", otherTenantAdminToken, { code: "CUST-O2-B", name: "Other Cust B" });
    const otherWo = await post("/work-orders", otherTenantAdminToken, {
      customerId: cust.json().id,
      serviceDefinitionCode: SERVICE_CODE,
      title: "Other LE check",
    });
    const foreign = await post(`/work-orders/${otherWo.json().id}/finalize-costs`, otherTenantAdminToken, {
      legalEntityId,
    });
    expect(foreign.statusCode).toBe(404);
  });

  it("OPS-02-021: concurrent finalize — exactly one winner, one outbox row", async () => {
    const woId = await acceptedWorkOrder("Concurrent finalize");
    await addCost(woId, { costType: "material", quantity: "5", unitCost: "2000" });
    const [a, b] = await Promise.all([
      post(`/work-orders/${woId}/finalize-costs`, verifierToken, { legalEntityId }),
      post(`/work-orders/${woId}/finalize-costs`, verifierToken, { legalEntityId }),
    ]);
    const statuses = [a.statusCode, b.statusCode].sort();
    expect(statuses).toEqual([200, 409]);
    const ev = await pool.query(
      `SELECT amount FROM scm_accounting_ready_events
       WHERE source_document_id = $1 AND event_type = 'work_order.cost_accumulated'`,
      [woId],
    );
    expect(ev.rows.length).toBe(1);
    expect(Number(ev.rows[0].amount)).toBe(10000);
  });
});
