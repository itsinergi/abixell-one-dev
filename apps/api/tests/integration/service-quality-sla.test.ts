import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { buildApp } from "../../src/app.js";
import { buildContainer } from "../../src/composition-root.js";
import { pool } from "../../src/infrastructure/persistence/db.js";
import { activateAllModules, authHeader, bootstrapTenant, createReadOnlyRole, login, provisionFirstAdmin } from "./helpers.js";

const TENANT_CODE = `sq-a-${Date.now()}`;
const OTHER_TENANT_CODE = `sq-b-${Date.now()}`;
const WORKFLOW_CODE = "complaint_lifecycle";
const ADMIN_EMAIL = "admin@sq-adv-001.local";
const ADMIN_PASSWORD = "Admin12345!";
const CUSTOMER_PASSWORD = "Customer12345!";

/**
 * Wave A1 / SQ-ADV-001 migration-backed integration coverage. The suite uses
 * real HTTP authorization and Workflow transitions for business behavior, and
 * direct SQL only to freeze time or recreate a process-crash reconciliation
 * gap that cannot be reached through a production route.
 */
describe("Wave A1 — multidimensional Service Quality SLA", () => {
  const app = buildApp();
  const reconciliationContainer = buildContainer();

  let tenantId: string;
  let otherTenantId: string;
  let adminUserId: string;
  let otherAdminUserId: string;
  let adminToken: string;
  let otherAdminToken: string;
  let customerUserId: string;
  let customerToken: string;
  let emptyScopeToken: string;
  let customerAId: string;
  let customerBId: string;
  let customerCId: string;
  let contractAId: string;
  let calendarId: string;
  let policyId: string;
  let winningRuleId: string;
  let fallbackRuleId: string;
  let mainComplaintId: string;
  let mainTargetId: string;
  let initialFirstResponseAt: Date;

  const post = (
    url: string,
    token: string,
    payload?: Record<string, unknown>,
  ) =>
    app.inject({
      method: "POST",
      url,
      headers: authHeader(token),
      ...(payload === undefined ? {} : { payload }),
    });

  async function createComplaint(params: {
    token: string;
    customerId: string;
    contractId?: string;
    description: string;
    category?: string;
    severity?: string;
  }) {
    const response = await post("/complaints", params.token, {
      customerId: params.customerId,
      contractId: params.contractId,
      category: params.category ?? "quality",
      description: params.description,
      priority: "high",
      severity: params.severity ?? "major",
      source: "integration_test",
      channel: "api",
    });
    expect(response.statusCode).toBe(201);
    return response.json() as { id: string; workflowInstanceId: string };
  }

  async function submitComplaint(id: string, token: string) {
    const response = await post(`/complaints/${id}/submit`, token, {});
    expect(response.statusCode).toBe(200);
    return response;
  }

  async function createDirectSubmittedComplaint(params: {
    tenantId: string;
    customerId: string;
    submittedBy: string;
    complaintNumber: string;
    category?: string;
    severity?: string;
  }): Promise<string> {
    return (
      await pool.query(
        `INSERT INTO complaints
           (tenant_id, complaint_number, customer_id, category, description,
            priority, severity, submitted_by_user_id, submitted_at)
         VALUES ($1, $2, $3, $4, 'Reconciliation fixture', 'high', $5, $6, now())
         RETURNING id`,
        [
          params.tenantId,
          params.complaintNumber,
          params.customerId,
          params.category ?? "quality",
          params.severity ?? "major",
          params.submittedBy,
        ],
      )
    ).rows[0].id as string;
  }

  async function recordLifecycleEvent(params: {
    tenantId: string;
    complaintId: string;
    eventType:
      | "complaint.submitted"
      | "complaint.acknowledged"
      | "complaint.customer_confirmed";
    createdBy: string;
    occurredAt?: Date;
  }): Promise<string> {
    return (
      await pool.query(
        `INSERT INTO domain_events
           (tenant_id, event_type, entity_type, entity_id, payload, occurred_at, created_by)
         VALUES ($1, $2, 'complaint', $3, '{}'::jsonb, COALESCE($4, now()), $5)
         RETURNING id`,
        [
          params.tenantId,
          params.eventType,
          params.complaintId,
          params.occurredAt ?? null,
          params.createdBy,
        ],
      )
    ).rows[0].id as string;
  }

  async function receiptCount(eventId: string): Promise<number> {
    return (
      await pool.query(
        `SELECT count(*)::int AS count
           FROM service_quality_event_receipts
          WHERE domain_event_id = $1`,
        [eventId],
      )
    ).rows[0].count as number;
  }

  beforeAll(async () => {
    const tenant = await bootstrapTenant(
      app,
      TENANT_CODE,
      "SQ-ADV-001 Tenant",
    );
    await activateAllModules(tenant.id);
    tenantId = tenant.id;
    const admin = await provisionFirstAdmin({
      tenantId,
      email: ADMIN_EMAIL,
      password: ADMIN_PASSWORD,
    });
    adminUserId = admin.userId;
    adminToken = (
      await login(app, TENANT_CODE, ADMIN_EMAIL, ADMIN_PASSWORD)
    ).body.accessToken;

    const legalEntity = await post("/legal-entities", adminToken, {
      name: "SQ-ADV-001 Legal Entity",
    });
    expect(legalEntity.statusCode).toBe(201);
    const organizationUnit = await post("/organization-units", adminToken, {
      legalEntityId: legalEntity.json().id,
      name: "SQ-ADV-001 Operations",
      unitType: "Site",
      parentId: null,
    });
    expect(organizationUnit.statusCode).toBe(201);

    const createCustomer = async (code: string, name: string) => {
      const response = await post("/customers", adminToken, {
        code,
        name,
        ownerOrganizationUnitId: organizationUnit.json().id,
      });
      expect(response.statusCode).toBe(201);
      return response.json().id as string;
    };
    customerAId = await createCustomer("SQ-A", "SLA Customer A");
    customerBId = await createCustomer("SQ-B", "SLA Customer B");
    customerCId = await createCustomer("SQ-C", "Empty Scope Customer");

    const contract = await post("/contracts", adminToken, {
      customerId: customerAId,
      code: "SQ-CONTRACT-A",
      name: "SLA Contract A",
    });
    expect(contract.statusCode).toBe(201);
    contractAId = contract.json().id;

    for (const [typeCode, code, label] of [
      ["complaint_category", "quality", "Quality"],
      ["complaint_severity", "major", "Major"],
    ]) {
      const response = await post(
        `/config/reference-data/${typeCode}`,
        adminToken,
        { code, label },
      );
      expect(response.statusCode).toBe(201);
    }

    const numbering = await post(
      "/config/numbering/complaint_number",
      adminToken,
      { pattern: "SQ-CMP-{SEQ:5}" },
    );
    expect(numbering.statusCode).toBe(201);

    const customerRoleId = await createReadOnlyRole(
      tenantId,
      "SQ_CUSTOMER_A",
      [
        "customer.read",
        "complaint.read",
        "complaint.manage",
        "workflow.instance.start",
        "workflow.instance.act",
        "service_quality.read",
      ],
    );
    void customerRoleId;
    const customerUser = await post("/users", adminToken, {
      email: "customer-a@sq-adv-001.local",
      fullName: "SLA Customer A User",
      password: CUSTOMER_PASSWORD,
      roleCode: "SQ_CUSTOMER_A",
      scopeType: "customer",
      scopeCustomerId: customerAId,
    });
    expect(customerUser.statusCode).toBe(201);
    customerUserId = (
      await pool.query(
        `SELECT id FROM users WHERE tenant_id = $1 AND email = $2`,
        [tenantId, "customer-a@sq-adv-001.local"],
      )
    ).rows[0].id;

    customerToken = (
      await login(
        app,
        TENANT_CODE,
        "customer-a@sq-adv-001.local",
        CUSTOMER_PASSWORD,
      )
    ).body.accessToken;

    await createReadOnlyRole(tenantId, "SQ_EMPTY_SCOPE", [
      "service_quality.read",
    ]);
    const emptyScopeUser = await post("/users", adminToken, {
      email: "empty-scope@sq-adv-001.local",
      fullName: "Empty Scope Reader",
      password: CUSTOMER_PASSWORD,
      roleCode: "SQ_EMPTY_SCOPE",
      scopeType: "customer",
      scopeCustomerId: customerCId,
    });
    expect(emptyScopeUser.statusCode).toBe(201);
    emptyScopeToken = (
      await login(
        app,
        TENANT_CODE,
        "empty-scope@sq-adv-001.local",
        CUSTOMER_PASSWORD,
      )
    ).body.accessToken;

    const definition = await post("/workflow/definitions", adminToken, {
      code: WORKFLOW_CODE,
      name: "SQ-ADV-001 Complaint Lifecycle",
      entityType: "complaint",
      description: "Minimal real lifecycle for commercial SLA integration tests",
    });
    expect(definition.statusCode).toBe(201);

    for (const step of [
      {
        code: "DRAFT",
        name: "Draft",
        stepType: "task",
        isInitial: true,
      },
      { code: "SUBMITTED", name: "Submitted", stepType: "task" },
      {
        code: "ACKNOWLEDGED",
        name: "Acknowledged",
        stepType: "task",
      },
      {
        code: "CLOSED",
        name: "Closed",
        stepType: "end",
        isTerminal: true,
        terminalStatus: "approved",
      },
      {
        code: "REJECTED",
        name: "Rejected",
        stepType: "end",
        isTerminal: true,
        terminalStatus: "rejected",
      },
      {
        code: "CANCELLED",
        name: "Cancelled",
        stepType: "end",
        isTerminal: true,
        terminalStatus: "cancelled",
      },
    ]) {
      const response = await post(
        `/workflow/definitions/${WORKFLOW_CODE}/versions/1/steps`,
        adminToken,
        step,
      );
      expect(response.statusCode).toBe(201);
    }

    for (const transition of [
      {
        fromStepCode: "DRAFT",
        toStepCode: "SUBMITTED",
        actionCode: "submit",
        name: "Submit",
      },
      {
        fromStepCode: "SUBMITTED",
        toStepCode: "ACKNOWLEDGED",
        actionCode: "acknowledge",
        name: "Acknowledge",
      },
      {
        fromStepCode: "ACKNOWLEDGED",
        toStepCode: "CLOSED",
        actionCode: "confirm",
        name: "Customer Confirm",
      },
      {
        fromStepCode: "SUBMITTED",
        toStepCode: "REJECTED",
        actionCode: "reject",
        name: "Reject",
      },
      {
        fromStepCode: "SUBMITTED",
        toStepCode: "CANCELLED",
        actionCode: "cancel",
        name: "Cancel",
      },
    ]) {
      const response = await post(
        `/workflow/definitions/${WORKFLOW_CODE}/versions/1/transitions`,
        adminToken,
        transition,
      );
      expect(response.statusCode).toBe(201);
    }

    for (const stepCode of ["DRAFT", "SUBMITTED", "ACKNOWLEDGED"]) {
      const response = await post(
        `/workflow/definitions/${WORKFLOW_CODE}/versions/1/assignment-rules`,
        adminToken,
        {
          stepCode,
          assignmentType: "specific_user",
          specificUserSource: "submitter",
        },
      );
      expect(response.statusCode).toBe(201);
    }

    const publish = await post(
      `/workflow/definitions/${WORKFLOW_CODE}/versions/1/publish`,
      adminToken,
    );
    expect(publish.statusCode).toBe(200);

    const otherTenant = await bootstrapTenant(
      app,
      OTHER_TENANT_CODE,
      "SQ-ADV-001 Other Tenant",
    );

    await activateAllModules(otherTenant.id);
    otherTenantId = otherTenant.id;
    const otherAdmin = await provisionFirstAdmin({
      tenantId: otherTenantId,
      email: "admin@other-sq-adv-001.local",
      password: ADMIN_PASSWORD,
    });
    otherAdminUserId = otherAdmin.userId;
    otherAdminToken = (
      await login(
        app,
        OTHER_TENANT_CODE,
        "admin@other-sq-adv-001.local",
        ADMIN_PASSWORD,
      )
    ).body.accessToken;
  });

  afterAll(async () => {
    await pool.query(`DELETE FROM tenants WHERE id = ANY($1::uuid[])`, [
      [tenantId, otherTenantId],
    ]);
    await app.close();
    await pool.end();
  });

  it("creates Tenant-authored calendars, policies, and deterministic matrix rules", async () => {
    const calendar = await post("/service-quality/calendars", adminToken, {
      code: "UTC_24X7",
      name: "UTC continuous",
      timeZone: "UTC",
      isContinuous: true,
      isDefault: true,
      windows: [],
    });
    expect(calendar.statusCode).toBe(201);
    calendarId = calendar.json().calendar.id;

    const policy = await post("/service-quality/sla-policies", adminToken, {
      code: "COMMERCIAL",
      name: "Commercial complaint commitments",
      calendarId,
    });
    expect(policy.statusCode).toBe(201);
    policyId = policy.json().id;

    const fallback = await post("/service-quality/sla-rules", adminToken, {
      policyId,
      code: "FALLBACK",
      responseMinutes: 240,
      resolutionMinutes: 480,
      priority: 999,
    });
    expect(fallback.statusCode).toBe(201);
    fallbackRuleId = fallback.json().id;

    const winning = await post("/service-quality/sla-rules", adminToken, {
      policyId,
      code: "A_EXACT",
      customerId: customerAId,
      contractId: contractAId,
      severityCode: "major",
      categoryCode: "quality",
      responseMinutes: 60,
      resolutionMinutes: 120,
      priority: 50,
    });
    expect(winning.statusCode).toBe(201);
    winningRuleId = winning.json().id;

    const lexicographicLoser = await post(
      "/service-quality/sla-rules",
      adminToken,
      {
        policyId,
        code: "Z_EXACT",
        customerId: customerAId,
        contractId: contractAId,
        severityCode: "major",
        categoryCode: "quality",
        responseMinutes: 5,
        resolutionMinutes: 10,
        priority: 50,
      },
    );
    expect(lexicographicLoser.statusCode).toBe(201);

    const listed = await app.inject({
      method: "GET",
      url: "/service-quality/sla-policies",
      headers: authHeader(adminToken),
    });
    expect(listed.statusCode).toBe(200);
    expect(listed.json()[0].rules).toHaveLength(3);
  });

  it("starts no commercial SLA while a Complaint remains in Draft", async () => {
    const complaint = await createComplaint({
      token: customerToken,
      customerId: customerAId,
      contractId: contractAId,
      description: "Draft has no commercial clock",
    });
    mainComplaintId = complaint.id;

    const targets = await pool.query(
      `SELECT id FROM complaint_sla_targets WHERE complaint_id = $1`,
      [mainComplaintId],
    );
    expect(targets.rows).toHaveLength(0);
  });

  it("starts on submission, resolves specificity before priority, and applies the code tiebreak", async () => {
    await submitComplaint(mainComplaintId, customerToken);

    const target = await pool.query(
      `SELECT * FROM complaint_sla_targets WHERE complaint_id = $1`,
      [mainComplaintId],
    );
    expect(target.rows).toHaveLength(1);
    mainTargetId = target.rows[0].id;
    expect(target.rows[0]).toMatchObject({
      policy_id: policyId,
      rule_id: winningRuleId,
      policy_code_snapshot: "COMMERCIAL",
      rule_code_snapshot: "A_EXACT",
      calendar_code_snapshot: "UTC_24X7",
      time_zone_snapshot: "UTC",
      response_minutes: 60,
      resolution_minutes: 120,
      matched_dimensions: {
        customerId: customerAId,
        contractId: contractAId,
        severityCode: "major",
        categoryCode: "quality",
      },
    });

    const complaint = await pool.query(
      `SELECT submitted_at FROM complaints WHERE id = $1`,
      [mainComplaintId],
    );
    const startedAt = target.rows[0].started_at as Date;
    expect(startedAt.getTime()).toBe(
      (complaint.rows[0].submitted_at as Date).getTime(),
    );
    expect((target.rows[0].response_due_at as Date).getTime()).toBe(
      startedAt.getTime() + 60 * 60_000,
    );
  });

  it("freezes target history when policy data changes and submission is replayed", async () => {
    await pool.query(
      `UPDATE service_sla_rules
          SET response_minutes = 999, resolution_minutes = 999, updated_at = now()
        WHERE id = $1`,
      [winningRuleId],
    );

    const replayed = await reconciliationContainer.serviceQuality.assignTargetForComplaint(
      tenantId,
      mainComplaintId,
      adminUserId,
    );
    expect(replayed).toMatchObject({
      id: mainTargetId,
      responseMinutes: 60,
      resolutionMinutes: 120,
      ruleCodeSnapshot: "A_EXACT",
    });
    expect(
      (
        await pool.query(
          `SELECT count(*)::int AS count
             FROM complaint_sla_targets
            WHERE complaint_id = $1`,
          [mainComplaintId],
        )
      ).rows[0].count,
    ).toBe(1);
  });

  it("couples service_quality.read and Customer Data Scope to one assignment", async () => {
    const own = await app.inject({
      method: "GET",
      url: `/service-quality/complaints/${mainComplaintId}/sla`,
      headers: authHeader(customerToken),
    });
    expect(own.statusCode).toBe(200);
    expect(own.json().target.id).toBe(mainTargetId);

    const customerBComplaint = await createComplaint({
      token: adminToken,
      customerId: customerBId,
      description: "Scope isolation probe",
    });
    await submitComplaint(customerBComplaint.id, adminToken);

    const denied = await app.inject({
      method: "GET",
      url: `/service-quality/complaints/${customerBComplaint.id}/sla`,
      headers: authHeader(customerToken),
    });
    expect(denied.statusCode).toBe(403);
  });

  it("records first response only on acknowledgment and keeps the first instant on replay", async () => {
    const before = await pool.query(
      `SELECT first_response_at FROM complaint_sla_targets WHERE id = $1`,
      [mainTargetId],
    );
    expect(before.rows[0].first_response_at).toBeNull();

    const acknowledge = await post(
      `/complaints/${mainComplaintId}/actions/acknowledge`,
      customerToken,
      {},
    );
    expect(acknowledge.statusCode).toBe(200);

    const first = await pool.query(
      `SELECT first_response_at FROM complaint_sla_targets WHERE id = $1`,
      [mainTargetId],
    );
    initialFirstResponseAt = first.rows[0].first_response_at as Date;
    expect(initialFirstResponseAt).toBeInstanceOf(Date);

    const replayEventId = await recordLifecycleEvent({
      tenantId,
      complaintId: mainComplaintId,
      eventType: "complaint.acknowledged",
      createdBy: customerUserId,
      occurredAt: new Date(initialFirstResponseAt.getTime() + 2 * 60 * 60_000),
    });
    const replay =
      await reconciliationContainer.serviceQuality.reconcileComplaintLifecycleEvents(
        tenantId,
      );
    expect(replay).toMatchObject({ failed: 0 });
    expect(await receiptCount(replayEventId)).toBe(1);

    const after = await pool.query(
      `SELECT first_response_at FROM complaint_sla_targets WHERE id = $1`,
      [mainTargetId],
    );
    expect((after.rows[0].first_response_at as Date).getTime()).toBe(
      initialFirstResponseAt.getTime(),
    );
  });

  it("resolves only on the customer-confirmed Workflow transition", async () => {
    const before = await pool.query(
      `SELECT resolved_at FROM complaint_sla_targets WHERE id = $1`,
      [mainTargetId],
    );
    expect(before.rows[0].resolved_at).toBeNull();

    const confirm = await post(
      `/complaints/${mainComplaintId}/actions/confirm`,
      customerToken,
      {},
    );
    expect(confirm.statusCode).toBe(200);
    expect(confirm.json().workflowResult.instance.status).toBe("approved");

    const target = await pool.query(
      `SELECT resolved_at FROM complaint_sla_targets WHERE id = $1`,
      [mainTargetId],
    );
    expect(target.rows[0].resolved_at).toBeInstanceOf(Date);
  });

  it("ignores a more-specific rule whose business calendar is inactive", async () => {
    const inactiveCalendar = await post(
      "/service-quality/calendars",
      adminToken,
      {
        code: "INACTIVE_24X7",
        name: "Inactive calendar",
        timeZone: "UTC",
        isContinuous: true,
        windows: [],
      },
    );
    expect(inactiveCalendar.statusCode).toBe(201);
    const inactiveCalendarId = inactiveCalendar.json().calendar.id as string;

    const inactivePolicy = await post(
      "/service-quality/sla-policies",
      adminToken,
      {
        code: "INACTIVE_POLICY",
        name: "Policy on inactive calendar",
        calendarId: inactiveCalendarId,
      },
    );
    expect(inactivePolicy.statusCode).toBe(201);
    const inactiveRule = await post(
      "/service-quality/sla-rules",
      adminToken,
      {
        policyId: inactivePolicy.json().id,
        code: "B_EXACT_INACTIVE",
        customerId: customerBId,
        severityCode: "major",
        categoryCode: "quality",
        responseMinutes: 1,
        resolutionMinutes: 1,
        priority: 1_000_000,
      },
    );
    expect(inactiveRule.statusCode).toBe(201);
    await pool.query(
      `UPDATE service_business_calendars SET is_active = false WHERE id = $1`,
      [inactiveCalendarId],
    );

    const complaint = await createComplaint({
      token: adminToken,
      customerId: customerBId,
      description: "Inactive calendar must not match",
    });
    await submitComplaint(complaint.id, adminToken);
    const target = await pool.query(
      `SELECT rule_id, rule_code_snapshot
         FROM complaint_sla_targets
        WHERE complaint_id = $1`,
      [complaint.id],
    );
    expect(target.rows[0]).toMatchObject({
      rule_id: fallbackRuleId,
      rule_code_snapshot: "FALLBACK",
    });
  });

  it("does not treat rejected or cancelled terminal Complaints as resolved", async () => {
    for (const actionCode of ["reject", "cancel"] as const) {
      const complaint = await createComplaint({
        token: adminToken,
        customerId: customerBId,
        description: `${actionCode} is not successful resolution`,
      });
      await submitComplaint(complaint.id, adminToken);
      const terminal = await post(
        `/complaints/${complaint.id}/actions/${actionCode}`,
        adminToken,
        {},
      );
      expect(terminal.statusCode).toBe(200);

      const target = await pool.query(
        `SELECT resolved_at FROM complaint_sla_targets WHERE complaint_id = $1`,
        [complaint.id],
      );
      expect(target.rows[0].resolved_at).toBeNull();
    }
  });

  it("counts unanswered overdue responses in scope-safe analytics", async () => {
    const complaint = await createComplaint({
      token: customerToken,
      customerId: customerAId,
      description: "Unanswered overdue response",
    });
    await submitComplaint(complaint.id, customerToken);
    await pool.query(
      `UPDATE complaint_sla_targets
          SET response_due_at = now() - interval '1 hour',
              resolution_due_at = now() + interval '1 day'
        WHERE complaint_id = $1`,
      [complaint.id],
    );

    const response = await app.inject({
      method: "GET",
      url: "/service-quality/sla-performance",
      headers: authHeader(customerToken),
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual([
      {
        severityCode: "major",
        totalWithTarget: 2,
        responseBreached: 1,
        resolutionBreached: 0,
        openPastDue: 0,
      },
    ]);
  });

  it("returns an empty analytics result for an authorized scope with no targets", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/service-quality/sla-performance",
      headers: authHeader(emptyScopeToken),
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual([]);
  });

  it("isolates SLA detail and analytics across Tenants", async () => {
    const detail = await app.inject({
      method: "GET",
      url: `/service-quality/complaints/${mainComplaintId}/sla`,
      headers: authHeader(otherAdminToken),
    });
    expect(detail.statusCode).toBe(404);

    const analytics = await app.inject({
      method: "GET",
      url: "/service-quality/sla-performance",
      headers: authHeader(otherAdminToken),
    });
    expect(analytics.statusCode).toBe(200);
    expect(analytics.json()).toEqual([]);
  });

  it("persists receipts for successful immediate lifecycle projections", async () => {
    const rows = await pool.query(
      `SELECT de.event_type, count(receipt.domain_event_id)::int AS receipt_count
         FROM domain_events de
         LEFT JOIN service_quality_event_receipts receipt
           ON receipt.tenant_id = de.tenant_id
          AND receipt.domain_event_id = de.id
        WHERE de.tenant_id = $1
          AND de.entity_id = $2
          AND de.event_type IN (
            'complaint.submitted',
            'complaint.acknowledged',
            'complaint.customer_confirmed'
          )
        GROUP BY de.event_type
        ORDER BY de.event_type`,
      [tenantId, mainComplaintId],
    );
    expect(rows.rows).toEqual([
      { event_type: "complaint.acknowledged", receipt_count: 2 },
      { event_type: "complaint.customer_confirmed", receipt_count: 1 },
      { event_type: "complaint.submitted", receipt_count: 1 },
    ]);
  });

  it("reconciles a missing subscriber receipt and is idempotent on rerun", async () => {
    const complaintId = await createDirectSubmittedComplaint({
      tenantId,
      customerId: customerAId,
      submittedBy: adminUserId,
      complaintNumber: "SQ-RECONCILE-1",
    });
    const eventId = await recordLifecycleEvent({
      tenantId,
      complaintId,
      eventType: "complaint.submitted",
      createdBy: adminUserId,
    });
    expect(await receiptCount(eventId)).toBe(0);

    const first =
      await reconciliationContainer.serviceQuality.reconcileComplaintLifecycleEvents(
        tenantId,
      );
    expect(first).toMatchObject({ failed: 0 });
    expect(first.processed).toBeGreaterThanOrEqual(1);
    expect(await receiptCount(eventId)).toBe(1);
    expect(
      (
        await pool.query(
          `SELECT count(*)::int AS count
             FROM complaint_sla_targets
            WHERE complaint_id = $1`,
          [complaintId],
        )
      ).rows[0].count,
    ).toBe(1);

    const second =
      await reconciliationContainer.serviceQuality.reconcileComplaintLifecycleEvents(
        tenantId,
      );
    expect(second).toEqual({ scanned: 0, processed: 0, failed: 0 });
  });

  it("leaves a failed projection unreceipted until its configuration is safe", async () => {
    const unreachableCalendarId = (
      await pool.query(
        `INSERT INTO service_business_calendars
           (tenant_id, code, name, time_zone, is_continuous, created_by, updated_by)
         VALUES ($1, 'UNREACHABLE', 'Unreachable calendar', 'UTC', false, $2, $2)
         RETURNING id`,
        [tenantId, adminUserId],
      )
    ).rows[0].id as string;
    const unreachablePolicyId = (
      await pool.query(
        `INSERT INTO service_sla_policies
           (tenant_id, code, name, calendar_id, created_by, updated_by)
         VALUES ($1, 'UNREACHABLE', 'Unreachable policy', $2, $3, $3)
         RETURNING id`,
        [tenantId, unreachableCalendarId, adminUserId],
      )
    ).rows[0].id as string;
    await pool.query(
      `INSERT INTO service_sla_rules
         (tenant_id, policy_id, code, customer_id, severity_code, category_code,
          response_minutes, resolution_minutes, priority, created_by, updated_by)
       VALUES ($1, $2, 'UNREACHABLE_EXACT', $3, 'unreachable', 'unreachable',
               60, 60, 100, $4, $4)`,
      [tenantId, unreachablePolicyId, customerCId, adminUserId],
    );

    const complaintId = await createDirectSubmittedComplaint({
      tenantId,
      customerId: customerCId,
      submittedBy: adminUserId,
      complaintNumber: "SQ-RECONCILE-FAIL",
      category: "unreachable",
      severity: "unreachable",
    });
    const eventId = await recordLifecycleEvent({
      tenantId,
      complaintId,
      eventType: "complaint.submitted",
      createdBy: adminUserId,
    });

    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const failed =
      await reconciliationContainer.serviceQuality.reconcileComplaintLifecycleEvents(
        tenantId,
      );
    consoleError.mockRestore();
    expect(failed.failed).toBe(1);
    expect(await receiptCount(eventId)).toBe(0);
    expect(
      (
        await pool.query(
          `SELECT count(*)::int AS count
             FROM complaint_sla_targets
            WHERE complaint_id = $1`,
          [complaintId],
        )
      ).rows[0].count,
    ).toBe(0);

    await pool.query(
      `UPDATE service_business_calendars SET is_active = false WHERE id = $1`,
      [unreachableCalendarId],
    );
    const recovered =
      await reconciliationContainer.serviceQuality.reconcileComplaintLifecycleEvents(
        tenantId,
      );
    expect(recovered).toMatchObject({ failed: 0, processed: 1 });
    expect(await receiptCount(eventId)).toBe(1);
  });

  it("scopes manual Scheduler reconciliation to the caller Tenant", async () => {
    const customerAEvent = await recordLifecycleEvent({
      tenantId,
      complaintId: await createDirectSubmittedComplaint({
        tenantId,
        customerId: customerAId,
        submittedBy: adminUserId,
        complaintNumber: "SQ-SCHEDULER-A",
      }),
      eventType: "complaint.submitted",
      createdBy: adminUserId,
    });

    const otherCustomerId = (
      await pool.query(
        `INSERT INTO customers (tenant_id, code, name, created_by, updated_by)
         VALUES ($1, 'SQ-OTHER', 'Other Tenant Customer', $2, $2)
         RETURNING id`,
        [otherTenantId, otherAdminUserId],
      )
    ).rows[0].id as string;
    const customerBEvent = await recordLifecycleEvent({
      tenantId: otherTenantId,
      complaintId: await createDirectSubmittedComplaint({
        tenantId: otherTenantId,
        customerId: otherCustomerId,
        submittedBy: otherAdminUserId,
        complaintNumber: "SQ-SCHEDULER-B",
      }),
      eventType: "complaint.submitted",
      createdBy: otherAdminUserId,
    });

    const trigger = await post(
      "/scheduler/jobs/service-quality-sla-reconciliation/trigger",
      adminToken,
    );
    expect(trigger.statusCode).toBe(200);
    expect(trigger.json()).toMatchObject({
      trigger: "manual",
      status: "success",
      resultSummary: { tenantsSwept: 1, failed: 0 },
    });
    expect(trigger.json().resultSummary.perTenant).toBeUndefined();
    expect(await receiptCount(customerAEvent)).toBe(1);
    expect(await receiptCount(customerBEvent)).toBe(0);

    const other =
      await reconciliationContainer.serviceQuality.reconcileComplaintLifecycleEvents(
        otherTenantId,
      );
    expect(other).toMatchObject({ failed: 0, processed: 1 });
    expect(await receiptCount(customerBEvent)).toBe(1);
  });
});
