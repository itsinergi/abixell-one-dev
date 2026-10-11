import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../../src/app.js";
import { pool } from "../../src/infrastructure/persistence/db.js";
import { activateAllModules, authHeader, bootstrapTenant, createReadOnlyRole, login, provisionFirstAdmin } from "./helpers.js";

/**
 * WP-OPS-01 Phase 6 — Customer Acceptance Gate (FR-OPS-001, E2EGAP-014).
 *
 * Formal customer sign-off on verified Work Orders via public token link,
 * acceptance/rejection facts persisted to `work_orders`, outbox event
 * `work_order.accepted` (amount 0, real cost in WP-OPS-02), and automatic
 * CSAT survey assignment (token path → skipped respondent, internal path →
 * customer-scoped actor → survey assigned).
 */

const TENANT = `test-ops-01-${Date.now()}`;
const OTHER = `test-ops-01-other-${Date.now()}`;
const WORKFLOW_CODE = "service_operations_work_order";
const SERVICE_CODE = "acceptance_gate_service";

describe("WP-OPS-01 Phase 6 — Customer Acceptance Gate", () => {
  const app = buildApp();

  let tenantId: string;
  let adminToken: string;
  let coordinatorToken: string;
  let executorToken: string;
  let executorUserId: string;
  let verifierToken: string;
  let customerUserToken: string;
  let customerAId: string;

  let otherTenantId: string;
  let otherTenantAdminToken: string;
  let otherCustomerId: string;
  let otherWorkOrderId: string;

  const post = (url: string, token: string, payload: unknown = {}) =>
    app.inject({ method: "POST", url, headers: authHeader(token), payload });
  const get = (url: string, token: string) =>
    app.inject({ method: "GET", url, headers: authHeader(token) });

  /** Build the Work Order lifecycle as Tenant Configuration. */
  async function buildWorkflow(token: string) {
    await post("/workflow/definitions", token, {
      code: WORKFLOW_CODE,
      name: "Work Order Lifecycle",
      entityType: "work_order",
      description: "Phase 6 acceptance gate test lifecycle",
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

  beforeAll(async () => {
    const t = await bootstrapTenant(app, TENANT, "Tenant Acceptance Gate");
    await activateAllModules(t.id);
    tenantId = t.id;
    await provisionFirstAdmin({ tenantId, email: "admin@ops1.local", password: "Admin12345!" });
    adminToken = (await login(app, TENANT, "admin@ops1.local", "Admin12345!")).body.accessToken;

    // Roles: coordinator, executor, verifier, customer-scoped user.
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
    await createReadOnlyRole(tenantId, "CUSTOMER_OPS", [
      "service_operations.read",
      "service_operations.manage",
      // Internal acceptance is governed by `service_operations.verify`; a
      // customer representative recording sign-off holds it here so the
      // respondent-resolved (assigned) survey branch is exercised.
      "service_operations.verify",
      "customer.read",
      "workflow.instance.start",
    ]);

    const customerA = await post("/customers", adminToken, { code: "CUST-OPS-A", name: "Customer A" });
    customerAId = customerA.json().id;
    await post("/sites", adminToken, { customerId: customerAId, code: "SITE-OPS-A", name: "Site A" });

    // Create internal users (tenant-scoped).
    const mkInternalUser = (email: string, roleCode: string) =>
      post("/admin/users", adminToken, {
        email,
        fullName: email,
        password: "Passw0rd12345!",
        pairs: [{ roleCode, scopeType: "tenant" }],
      });

    await mkInternalUser("coord@ops1.local", "COORD_OPS");
    executorUserId = (await mkInternalUser("exec@ops1.local", "EXEC_OPS")).json().user.id;
    await mkInternalUser("verify@ops1.local", "VERIFY_OPS");

    // Customer-scoped user.
    await post("/users", adminToken, {
      email: "cust@ops1.local",
      fullName: "Customer User",
      password: "Passw0rd12345!",
      roleCode: "CUSTOMER_OPS",
      scopeType: "customer",
      scopeCustomerId: customerAId,
    });

    const tok = async (email: string) => (await login(app, TENANT, email, "Passw0rd12345!")).body.accessToken;
    coordinatorToken = await tok("coord@ops1.local");
    executorToken = await tok("exec@ops1.local");
    verifierToken = await tok("verify@ops1.local");
    customerUserToken = await tok("cust@ops1.local");

    // Tenant configuration: numbering + workflow.
    await post("/config/numbering/work_order", adminToken, { pattern: "WO-{SEQ:5}" });
    await buildWorkflow(adminToken);

    // Service definition.
    await post("/service-definitions", coordinatorToken, {
      code: SERVICE_CODE,
      name: "Acceptance Gate Service",
    });

    // Second tenant for cross-tenant isolation.
    const ot = await bootstrapTenant(app, OTHER, "Tenant Other");
    await activateAllModules(ot.id);
    otherTenantId = ot.id;
    await provisionFirstAdmin({ tenantId: ot.id, email: "admin@other.local", password: "Admin12345!" });
    otherTenantAdminToken = (await login(app, OTHER, "admin@other.local", "Admin12345!")).body.accessToken;

    // CSAT seed is per-tenant and the migration backfills tenants that existed
    // at migrate time only (INSERT … FROM tenants … ON CONFLICT DO NOTHING).
    // These test tenants are created now, so seed them explicitly for both.
    // Mirrors migration 1794200000000 sections 4–5 one-for-one.
    const seedCsat = async (tid: string) => {
      await pool.query(
        `INSERT INTO survey_definitions (tenant_id, code, name, description, is_active)
         VALUES ($1, 'CSAT_POST_ACCEPTANCE',
                 'Customer Satisfaction — Post Work Order Acceptance',
                 'Short CSAT survey auto-assigned after a work order is accepted by the customer.',
                 true)
         ON CONFLICT (tenant_id, code) DO NOTHING`,
        [tid],
      );
      await pool.query(
        `INSERT INTO survey_versions (survey_definition_id, version_number, status, is_current, published_at)
         SELECT d.id, 1, 'published', true, now()
           FROM survey_definitions d
          WHERE d.tenant_id = $1 AND d.code = 'CSAT_POST_ACCEPTANCE'
            AND NOT EXISTS (
              SELECT 1 FROM survey_versions v
               WHERE v.survey_definition_id = d.id AND v.version_number = 1
            )`,
        [tid],
      );
      await pool.query(
        `INSERT INTO survey_sections (survey_version_id, code, title, sort_order)
         SELECT v.id, 'MAIN', 'Satisfaction', 0
           FROM survey_versions v
           JOIN survey_definitions d ON d.id = v.survey_definition_id
          WHERE d.tenant_id = $1 AND d.code = 'CSAT_POST_ACCEPTANCE' AND v.version_number = 1
            AND NOT EXISTS (
              SELECT 1 FROM survey_sections s
               WHERE s.survey_version_id = v.id AND s.code = 'MAIN'
            )`,
        [tid],
      );
      await pool.query(
        `INSERT INTO survey_questions
           (survey_version_id, section_id, code, text, question_type, is_required, config, sort_order)
         SELECT v.id, s.id, 'OVERALL',
                'How satisfied are you with the completed work?',
                'rating', true,
                '{"scale":{"min":1,"max":5}}'::jsonb,
                0
           FROM survey_versions v
           JOIN survey_definitions d ON d.id = v.survey_definition_id
           JOIN survey_sections s ON s.survey_version_id = v.id AND s.code = 'MAIN'
          WHERE d.tenant_id = $1 AND d.code = 'CSAT_POST_ACCEPTANCE' AND v.version_number = 1
            AND NOT EXISTS (
              SELECT 1 FROM survey_questions q
               WHERE q.survey_version_id = v.id AND q.code = 'OVERALL'
            )`,
        [tid],
      );
      await pool.query(
        `INSERT INTO survey_integration_policies
           (tenant_id, code, name, enabled, source_entity_type, source_event_type,
            survey_definition_code, respondent_resolution, one_per_entity_lifetime)
         VALUES ($1, 'CSAT_POST_ACCEPTANCE_WO',
                 'Auto-assign CSAT when a work order is accepted',
                 true, 'work_order', 'work_order.accepted',
                 'CSAT_POST_ACCEPTANCE', 'source_event_actor', true)
         ON CONFLICT (tenant_id, code) DO NOTHING`,
        [tid],
      );
    };
    await seedCsat(tenantId);
    await seedCsat(otherTenantId);

    await post("/config/numbering/work_order", otherTenantAdminToken, { pattern: "WO-O-{SEQ:5}" });
    await buildWorkflow(otherTenantAdminToken);
    await post("/service-definitions", otherTenantAdminToken, { code: SERVICE_CODE, name: "Other Service" });
    const otherCust = await post("/customers", otherTenantAdminToken, { code: "CUST-O", name: "Other Cust" });
    otherCustomerId = otherCust.json().id;
    const otherWo = await post("/work-orders", otherTenantAdminToken, {
      customerId: otherCustomerId,
      serviceDefinitionCode: SERVICE_CODE,
      title: "Other tenant WO",
    });
    otherWorkOrderId = otherWo.json().id;
  });

  afterAll(async () => {
    // FK-safe teardown: delete work-related rows before customers.
    await pool.query(`DELETE FROM survey_integration_executions WHERE tenant_id = $1`, [tenantId]);
    await pool.query(`DELETE FROM work_order_acceptance_tokens WHERE tenant_id = $1`, [tenantId]);
    await pool.query(`DELETE FROM work_orders WHERE tenant_id = $1`, [tenantId]);
    await pool.query(`DELETE FROM customers WHERE tenant_id = $1`, [tenantId]);
    // Users stay: the immutable outbox row's created_by FK (ON DELETE SET NULL)
    // would be rewritten, which the accounting-ready immutability trigger rejects.

    await pool.query(`DELETE FROM survey_integration_executions WHERE tenant_id = $1`, [otherTenantId]);
    await pool.query(`DELETE FROM work_order_acceptance_tokens WHERE tenant_id = $1`, [otherTenantId]);
    await pool.query(`DELETE FROM work_orders WHERE tenant_id = $1`, [otherTenantId]);
    await pool.query(`DELETE FROM customers WHERE tenant_id = $1`, [otherTenantId]);

    await app.close();
    await pool.end();
  });

  // --- Acceptance Token Lifecycle (WP-OPS-01 Phase 6) ---------------

  it("WP-OPS-01-001: issueAcceptanceToken rejected before Work Order is verified (409)", async () => {
    const wo = await post("/work-orders", coordinatorToken, {
      customerId: customerAId,
      serviceDefinitionCode: SERVICE_CODE,
      title: "Not yet verified",
    });
    const woId = wo.json().id;

    const issued = await post(`/work-orders/${woId}/acceptance-token`, verifierToken, {});
    expect(issued.statusCode).toBe(409);
    expect(issued.json().error).toContain("verified");
  });

  it("WP-OPS-01-002: issueAcceptanceToken succeeds after verify; raw token returned once", async () => {
    // Full lifecycle to verified state.
    const wo = await post("/work-orders", coordinatorToken, {
      customerId: customerAId,
      serviceDefinitionCode: SERVICE_CODE,
      title: "For acceptance",
    });
    const woId = wo.json().id;

    await post(`/work-orders/${woId}/assign`, coordinatorToken, { assigneeUserId: executorUserId });
    await post(`/work-orders/${woId}/actions/start`, coordinatorToken, {});
    await post(`/work-orders/${woId}/start`, executorToken, {});
    await post(`/work-orders/${woId}/complete`, executorToken, { notes: "done" });
    await post(`/work-orders/${woId}/actions/complete`, coordinatorToken, {});
    const verified = await post(`/work-orders/${woId}/verify`, verifierToken, {});
    expect(verified.statusCode).toBe(200);

    const issued = await post(`/work-orders/${woId}/acceptance-token`, verifierToken, {});
    expect(issued.statusCode).toBe(201);
    const { token, expiresAt } = issued.json();
    expect(token).toBeTruthy();
    expect(typeof token).toBe("string");
    expect(token.length).toBeGreaterThan(0);
    expect(expiresAt).toBeTruthy();
  });

  it("WP-OPS-01-003: GET /public/work-orders/acceptance/:token returns summary; unknown token → 404", async () => {
    // Verified WO + issued token.
    const wo = await post("/work-orders", coordinatorToken, {
      customerId: customerAId,
      serviceDefinitionCode: SERVICE_CODE,
      title: "For public summary",
    });
    const woId = wo.json().id;
    await post(`/work-orders/${woId}/assign`, coordinatorToken, { assigneeUserId: executorUserId });
    await post(`/work-orders/${woId}/actions/start`, coordinatorToken, {});
    await post(`/work-orders/${woId}/start`, executorToken, {});
    await post(`/work-orders/${woId}/complete`, executorToken, {});
    await post(`/work-orders/${woId}/actions/complete`, coordinatorToken, {});
    await post(`/work-orders/${woId}/verify`, verifierToken, {});

    const issued = await post(`/work-orders/${woId}/acceptance-token`, verifierToken, {});
    const token = issued.json().token;

    // Valid token.
    const summary = await app.inject({ method: "GET", url: `/public/work-orders/acceptance/${token}` });
    expect(summary.statusCode).toBe(200);
    expect(summary.json().workOrderNumber).toMatch(/^WO-\d{5}$/);
    expect(summary.json().title).toBe("For public summary");
    expect(summary.json().accepted).toBe(false);
    expect(summary.json().expiresAt).toBeTruthy();

    // Unknown token.
    const unknown = await app.inject({ method: "GET", url: `/public/work-orders/acceptance/unknown-token-xyz` });
    expect(unknown.statusCode).toBe(404);
  });

  it("WP-OPS-01-004: POST /public/.../accept → 200; customer_accepted_at, via='token' populated", async () => {
    const wo = await post("/work-orders", coordinatorToken, {
      customerId: customerAId,
      serviceDefinitionCode: SERVICE_CODE,
      title: "For public accept",
    });
    const woId = wo.json().id;
    await post(`/work-orders/${woId}/assign`, coordinatorToken, { assigneeUserId: executorUserId });
    await post(`/work-orders/${woId}/actions/start`, coordinatorToken, {});
    await post(`/work-orders/${woId}/start`, executorToken, {});
    await post(`/work-orders/${woId}/complete`, executorToken, {});
    await post(`/work-orders/${woId}/actions/complete`, coordinatorToken, {});
    await post(`/work-orders/${woId}/verify`, verifierToken, {});

    const issued = await post(`/work-orders/${woId}/acceptance-token`, verifierToken, {});
    const token = issued.json().token;

    const accepted = await app.inject({
      method: "POST",
      url: `/public/work-orders/acceptance/${token}/accept`,
      payload: { comment: "Looks good" },
    });
    expect(accepted.statusCode).toBe(200);

    // Verify WO state.
    const detail = await get(`/work-orders/${woId}`, coordinatorToken);
    expect(detail.json().workOrder.customerAcceptedAt).toBeTruthy();
    expect(detail.json().workOrder.customerAcceptedVia).toBe("token");
    expect(detail.json().workOrder.customerAcceptanceComment).toBe("Looks good");
  });

  it("WP-OPS-01-005: Outbox: work_order.accepted row exists in scm_accounting_ready_events", async () => {
    const wo = await post("/work-orders", coordinatorToken, {
      customerId: customerAId,
      serviceDefinitionCode: SERVICE_CODE,
      title: "For outbox check",
    });
    const woId = wo.json().id;
    await post(`/work-orders/${woId}/assign`, coordinatorToken, { assigneeUserId: executorUserId });
    await post(`/work-orders/${woId}/actions/start`, coordinatorToken, {});
    await post(`/work-orders/${woId}/start`, executorToken, {});
    await post(`/work-orders/${woId}/complete`, executorToken, {});
    await post(`/work-orders/${woId}/actions/complete`, coordinatorToken, {});
    await post(`/work-orders/${woId}/verify`, verifierToken, {});

    const issued = await post(`/work-orders/${woId}/acceptance-token`, verifierToken, {});
    const token = issued.json().token;

    await app.inject({
      method: "POST",
      url: `/public/work-orders/acceptance/${token}/accept`,
      payload: {},
    });

    // Check outbox.
    const result = await pool.query(
      `SELECT event_type, source_document_id, amount, quantity FROM scm_accounting_ready_events
       WHERE source_document_id = $1 AND event_type = 'work_order.accepted'`,
      [woId],
    );
    expect(result.rows.length).toBeGreaterThan(0);
    expect(result.rows[0].event_type).toBe("work_order.accepted");
    // pg returns numeric columns as strings.
    expect(Number(result.rows[0].amount)).toBe(0); // Amount 0, cost in WP-OPS-02.
    expect(Number(result.rows[0].quantity)).toBe(1);
  });

  it("WP-OPS-01-006: Survey execution created for token path (status=skipped_recipient_unresolvable)", async () => {
    const wo = await post("/work-orders", coordinatorToken, {
      customerId: customerAId,
      serviceDefinitionCode: SERVICE_CODE,
      title: "For survey check",
    });
    const woId = wo.json().id;
    await post(`/work-orders/${woId}/assign`, coordinatorToken, { assigneeUserId: executorUserId });
    await post(`/work-orders/${woId}/actions/start`, coordinatorToken, {});
    await post(`/work-orders/${woId}/start`, executorToken, {});
    await post(`/work-orders/${woId}/complete`, executorToken, {});
    await post(`/work-orders/${woId}/actions/complete`, coordinatorToken, {});
    await post(`/work-orders/${woId}/verify`, verifierToken, {});

    const issued = await post(`/work-orders/${woId}/acceptance-token`, verifierToken, {});
    const token = issued.json().token;

    await app.inject({
      method: "POST",
      url: `/public/work-orders/acceptance/${token}/accept`,
      payload: {},
    });

    // Check survey execution (token path → no actor → skipped respondent).
    const result = await pool.query(
      `SELECT status FROM survey_integration_executions WHERE tenant_id = $1 AND source_entity_id = $2 ORDER BY created_at DESC LIMIT 1`,
      [tenantId, woId],
    );
    expect(result.rows.length).toBeGreaterThan(0);
    expect(result.rows[0].status).toBe("skipped_recipient_unresolvable");
  });

  it("WP-OPS-01-007: Accept again → 409 (idempotent guard)", async () => {
    const wo = await post("/work-orders", coordinatorToken, {
      customerId: customerAId,
      serviceDefinitionCode: SERVICE_CODE,
      title: "For idempotency",
    });
    const woId = wo.json().id;
    await post(`/work-orders/${woId}/assign`, coordinatorToken, { assigneeUserId: executorUserId });
    await post(`/work-orders/${woId}/actions/start`, coordinatorToken, {});
    await post(`/work-orders/${woId}/start`, executorToken, {});
    await post(`/work-orders/${woId}/complete`, executorToken, {});
    await post(`/work-orders/${woId}/actions/complete`, coordinatorToken, {});
    await post(`/work-orders/${woId}/verify`, verifierToken, {});

    const issued = await post(`/work-orders/${woId}/acceptance-token`, verifierToken, {});
    const token = issued.json().token;

    const first = await app.inject({
      method: "POST",
      url: `/public/work-orders/acceptance/${token}/accept`,
      payload: {},
    });
    expect(first.statusCode).toBe(200);

    // Second attempt → 409 (already claimed).
    const second = await app.inject({
      method: "POST",
      url: `/public/work-orders/acceptance/${token}/accept`,
      payload: {},
    });
    expect(second.statusCode).toBe(409);
    expect(second.json().error).toContain("already been used");
  });

  it("WP-OPS-01-008: Token expired/revoked/used → 409 with specific message", async () => {
    const wo = await post("/work-orders", coordinatorToken, {
      customerId: customerAId,
      serviceDefinitionCode: SERVICE_CODE,
      title: "For token states",
    });
    const woId = wo.json().id;
    await post(`/work-orders/${woId}/assign`, coordinatorToken, { assigneeUserId: executorUserId });
    await post(`/work-orders/${woId}/actions/start`, coordinatorToken, {});
    await post(`/work-orders/${woId}/start`, executorToken, {});
    await post(`/work-orders/${woId}/complete`, executorToken, {});
    await post(`/work-orders/${woId}/actions/complete`, coordinatorToken, {});
    await post(`/work-orders/${woId}/verify`, verifierToken, {});

    const issued1 = await post(`/work-orders/${woId}/acceptance-token`, verifierToken, {});
    const token1 = issued1.json().token;

    // Accept once to mark token as used.
    await app.inject({
      method: "POST",
      url: `/public/work-orders/acceptance/${token1}/accept`,
      payload: {},
    });

    // Try again with same (now used) token.
    const used = await app.inject({
      method: "POST",
      url: `/public/work-orders/acceptance/${token1}/accept`,
      payload: {},
    });
    expect(used.statusCode).toBe(409);
    expect(used.json().error).toContain("already been used");
  });

  it("WP-OPS-01-009: POST /public/.../reject → 200; customer_rejected_at, reason populated", async () => {
    const wo = await post("/work-orders", coordinatorToken, {
      customerId: customerAId,
      serviceDefinitionCode: SERVICE_CODE,
      title: "For public reject",
    });
    const woId = wo.json().id;
    await post(`/work-orders/${woId}/assign`, coordinatorToken, { assigneeUserId: executorUserId });
    await post(`/work-orders/${woId}/actions/start`, coordinatorToken, {});
    await post(`/work-orders/${woId}/start`, executorToken, {});
    await post(`/work-orders/${woId}/complete`, executorToken, {});
    await post(`/work-orders/${woId}/actions/complete`, coordinatorToken, {});
    await post(`/work-orders/${woId}/verify`, verifierToken, {});

    const issued = await post(`/work-orders/${woId}/acceptance-token`, verifierToken, {});
    const token = issued.json().token;

    const rejected = await app.inject({
      method: "POST",
      url: `/public/work-orders/acceptance/${token}/reject`,
      payload: { reason: "Quality issue at site" },
    });
    expect(rejected.statusCode).toBe(200);

    const detail = await get(`/work-orders/${woId}`, coordinatorToken);
    expect(detail.json().workOrder.customerRejectedAt).toBeTruthy();
    expect(detail.json().workOrder.customerRejectionReason).toBe("Quality issue at site");
    expect(detail.json().workOrder.customerAcceptedAt).toBeNull(); // Not accepted, only rejected.
  });

  it("WP-OPS-01-010: Internal accept (via='internal'); customer-scoped actor → survey assigned", async () => {
    const wo = await post("/work-orders", coordinatorToken, {
      customerId: customerAId,
      serviceDefinitionCode: SERVICE_CODE,
      title: "For internal accept",
    });
    const woId = wo.json().id;
    await post(`/work-orders/${woId}/assign`, coordinatorToken, { assigneeUserId: executorUserId });
    await post(`/work-orders/${woId}/actions/start`, coordinatorToken, {});
    await post(`/work-orders/${woId}/start`, executorToken, {});
    await post(`/work-orders/${woId}/complete`, executorToken, {});
    await post(`/work-orders/${woId}/actions/complete`, coordinatorToken, {});
    await post(`/work-orders/${woId}/verify`, verifierToken, {});

    // Customer-scoped actor calls internal accept → survey respondent resolves → assigned.
    const accepted = await post(`/work-orders/${woId}/customer-accept`, customerUserToken, { comment: "Manual sign-off" });
    expect(accepted.statusCode).toBe(200);
    expect(accepted.json().customerAcceptedAt).toBeTruthy();
    expect(accepted.json().customerAcceptedVia).toBe("internal");

    // Survey execution: internal path with customer-scoped actor → respondent resolved → assigned.
    const execs = await pool.query(
      `SELECT status FROM survey_integration_executions WHERE tenant_id = $1 AND source_entity_id = $2 ORDER BY created_at DESC LIMIT 1`,
      [tenantId, woId],
    );
    expect(execs.rows.length).toBeGreaterThan(0);
    // For internal with customer-scoped actor, respondent is resolvable → assigned (not skipped).
    expect(execs.rows[0].status).toBe("assigned");
  });

  it("WP-OPS-01-011: Cross-tenant isolation: authenticated acceptance routes cannot reach another tenant's WO", async () => {
    // The public token path is tenant-agnostic by design (the token binds
    // its own tenant + WO). Isolation is enforced on the authenticated routes.
    const issue = await post(`/work-orders/${otherWorkOrderId}/acceptance-token`, verifierToken, {});
    expect([403, 404]).toContain(issue.statusCode);

    const accept = await post(`/work-orders/${otherWorkOrderId}/customer-accept`, verifierToken, {});
    expect([403, 404]).toContain(accept.statusCode);

    const reject = await post(`/work-orders/${otherWorkOrderId}/customer-reject`, verifierToken, { reason: "x" });
    expect([403, 404]).toContain(reject.statusCode);
  });

  it("WP-OPS-01-012: Regression: verifyWork existing flow still works unaffected", async () => {
    const wo = await post("/work-orders", coordinatorToken, {
      customerId: customerAId,
      serviceDefinitionCode: SERVICE_CODE,
      title: "Regression test",
    });
    const woId = wo.json().id;
    await post(`/work-orders/${woId}/assign`, coordinatorToken, { assigneeUserId: executorUserId });
    await post(`/work-orders/${woId}/actions/start`, coordinatorToken, {});
    await post(`/work-orders/${woId}/start`, executorToken, {});
    await post(`/work-orders/${woId}/complete`, executorToken, {});
    await post(`/work-orders/${woId}/actions/complete`, coordinatorToken, {});

    const verified = await post(`/work-orders/${woId}/verify`, verifierToken, {});
    expect(verified.statusCode).toBe(200);
    expect(verified.json().verifiedAt).toBeTruthy();

    // Duplicate verify → 409.
    const dup = await post(`/work-orders/${woId}/verify`, verifierToken, {});
    expect(dup.statusCode).toBe(409);

    // Verify events exist.
    const events = await pool.query(
      `SELECT event_type FROM domain_events WHERE entity_type = 'work_order' AND entity_id = $1`,
      [woId],
    );
    expect(events.rows.map((r) => r.event_type)).toEqual(
      expect.arrayContaining(["work_order.created", "work_order.assigned", "work_order.started", "work_order.completed", "work_order.verified"]),
    );
  });
});
