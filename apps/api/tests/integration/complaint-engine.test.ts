import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../../src/app.js";
import { pool } from "../../src/infrastructure/persistence/db.js";
import { authHeader, bootstrapTenant, createReadOnlyRole, login, provisionFirstAdmin } from "./helpers.js";

/**
 * Checkpoint 1B — Generic Customer Complaint Engine.
 *
 * Proves the 1B E2E target end to end, against the REAL database (no
 * mocking): Customer User Submit Complaint -> Customer/Data Scope
 * Validation -> SLA Started -> Workflow Instance -> Assignment -> Internal
 * User Investigation -> Corrective Action -> Evidence -> Verification ->
 * Customer Confirmation -> Closed -> Audit/History -> PostgreSQL.
 *
 * Also proves the binding constraints from the Checkpoint 1B instruction:
 * - Workflow is NOT hardcoded in ComplaintService — the entire Step graph
 *   below is built through the generic Workflow Engine admin API
 *   (`/workflow/definitions/...`), exactly like the 0D test's demo
 *   workflow, just with `entityType: "complaint"`.
 * - Category/Priority/Severity/SLA/Assignment Rule/Numbering/Notification
 *   Template are all Tenant Configuration, zero new subsystem code.
 * - Evidence/attachment goes through Document Service + the `complaint`
 *   Entity Authorization Resolver (ADR-0012 pattern), not a separate
 *   permission.
 * - Priority and Severity are distinct fields/catalogs.
 * - Condition-based dynamic routing (severity=critical) and SLA Escalation
 *   both work without any Complaint-specific Scheduler code.
 *
 * Negative paths covered: wrong tenant, unauthorized customer, invalid
 * workflow transition, duplicate submission/idempotency, invalid
 * attachment, RBAC denial, SLA escalation, reopen authorization.
 */

const TENANT_CODE = `test-1b-${Date.now()}`;
const OTHER_TENANT_CODE = `test-1b-other-${Date.now()}`;
const WORKFLOW_CODE = "complaint_lifecycle";

describe("Checkpoint 1B — Generic Customer Complaint Engine", () => {
  const app = buildApp();
  let tenantId: string;
  let adminToken: string;
  let siteId: string;
  let customerAId: string;
  let customerBId: string;
  let customerUserAToken: string;
  let handlerToken: string;
  let managerToken: string;

  let otherTenantId: string;
  let otherAdminToken: string;

  beforeAll(async () => {
    const tenant = await bootstrapTenant(app, TENANT_CODE, "Test Tenant 1B");
    tenantId = tenant.id;
    await provisionFirstAdmin({ tenantId, email: "admin@test1b.local", password: "Admin12345!" });
    adminToken = (await login(app, TENANT_CODE, "admin@test1b.local", "Admin12345!")).body.accessToken;

    const legalEntity = await app.inject({
      method: "POST",
      url: "/legal-entities",
      headers: authHeader(adminToken),
      payload: { name: "Test Legal Entity 1B" },
    });
    const legalEntityId = legalEntity.json().id;
    const site = await app.inject({
      method: "POST",
      url: "/organization-units",
      headers: authHeader(adminToken),
      payload: { legalEntityId, name: "Site A 1B", unitType: "Site", parentId: null },
    });
    siteId = site.json().id;

    // Customer Foundation (1A, reused) — two Customers, A is the business
    // context for this checkpoint's E2E slice, B proves scope isolation.
    const customerA = await app.inject({
      method: "POST",
      url: "/customers",
      headers: authHeader(adminToken),
      payload: { code: "CUST-1B-A", name: "Customer 1B A", ownerOrganizationUnitId: siteId },
    });
    customerAId = customerA.json().id;
    const customerB = await app.inject({
      method: "POST",
      url: "/customers",
      headers: authHeader(adminToken),
      payload: { code: "CUST-1B-B", name: "Customer 1B B", ownerOrganizationUnitId: siteId },
    });
    customerBId = customerB.json().id;

    // Internal roles: COMPLAINT_HANDLER (Site-scoped investigator),
    // COMPLAINT_MANAGER (tenant-wide, independent verifier + escalation
    // target) — deliberately WITHOUT workflow.instance.read (see
    // decision-log.md: ComplaintService uses the trusted-caller
    // `getInstanceForEntityOwner`, so this broad permission is never
    // required just to work a Complaint).
    await createReadOnlyRole(tenantId, "COMPLAINT_HANDLER_1B", [
      "complaint.read",
      "complaint.manage",
      "workflow.instance.act",
      "customer.read",
    ]);
    await createReadOnlyRole(tenantId, "COMPLAINT_MANAGER_1B", [
      "complaint.read",
      "complaint.manage",
      "workflow.instance.act",
      "customer.read",
    ]);
    await createReadOnlyRole(tenantId, "CUSTOMER_USER_1B", [
      "customer.read",
      "complaint.read",
      "complaint.manage",
      "workflow.instance.start",
      "workflow.instance.act",
    ]);

    const handlerCreate = await app.inject({
      method: "POST",
      url: "/users",
      headers: authHeader(adminToken),
      payload: {
        email: "handler@test1b.local",
        fullName: "Test Complaint Handler",
        password: "Handler12345!",
        roleCode: "COMPLAINT_HANDLER_1B",
        scopeType: "organization_unit",
        scopeOrganizationUnitId: siteId,
      },
    });
    expect(handlerCreate.statusCode).toBe(201);
    const managerCreate = await app.inject({
      method: "POST",
      url: "/users",
      headers: authHeader(adminToken),
      payload: {
        email: "manager@test1b.local",
        fullName: "Test Complaint Manager",
        password: "Manager12345!",
        roleCode: "COMPLAINT_MANAGER_1B",
        scopeType: "tenant",
      },
    });
    expect(managerCreate.statusCode).toBe(201);
    const customerUserCreate = await app.inject({
      method: "POST",
      url: "/users",
      headers: authHeader(adminToken),
      payload: {
        email: "user@customer-1b-a.local",
        fullName: "Customer 1B A User",
        password: "CustomerUser12345!",
        roleCode: "CUSTOMER_USER_1B",
        scopeType: "customer",
        scopeCustomerId: customerAId,
      },
    });
    expect(customerUserCreate.statusCode).toBe(201);

    handlerToken = (await login(app, TENANT_CODE, "handler@test1b.local", "Handler12345!")).body.accessToken;
    managerToken = (await login(app, TENANT_CODE, "manager@test1b.local", "Manager12345!")).body.accessToken;
    customerUserAToken = (
      await login(app, TENANT_CODE, "user@customer-1b-a.local", "CustomerUser12345!")
    ).body.accessToken;

    // Numbering Sequence (Checkpoint 0C mechanism, Tenant Configuration).
    const numbering = await app.inject({
      method: "POST",
      url: "/config/numbering/complaint_number",
      headers: authHeader(adminToken),
      payload: { pattern: "CMP-1B-{SEQ:5}" },
    });
    expect(numbering.statusCode).toBe(201);

    // --- Build the `complaint_lifecycle` Workflow Definition via the real
    // HTTP API — proves "Workflow tidak boleh hardcoded di Complaint
    // Service" the same way 0D's test workflow does, just for
    // entityType='complaint'.
    const definition = await app.inject({
      method: "POST",
      url: "/workflow/definitions",
      headers: authHeader(adminToken),
      payload: {
        code: WORKFLOW_CODE,
        name: "Test Complaint Lifecycle",
        entityType: "complaint",
        description: "Checkpoint 1B integration test workflow",
      },
    });
    expect(definition.statusCode).toBe(201);

    const addStep = (body: Record<string, unknown>) =>
      app.inject({
        method: "POST",
        url: `/workflow/definitions/${WORKFLOW_CODE}/versions/1/steps`,
        headers: authHeader(adminToken),
        payload: body,
      });
    await addStep({ code: "DRAFT", name: "Draft", stepType: "task", isInitial: true });
    await addStep({ code: "SUBMITTED", name: "Submitted", stepType: "task", slaHours: 4 });
    await addStep({ code: "ACKNOWLEDGED", name: "Acknowledged", stepType: "task" });
    await addStep({ code: "ASSIGNED", name: "Assigned", stepType: "task", slaHours: 8 });
    await addStep({ code: "IN_INVESTIGATION", name: "In Investigation", stepType: "task", slaHours: 48 });
    await addStep({ code: "CORRECTIVE_ACTION", name: "Corrective Action", stepType: "task" });
    await addStep({ code: "VERIFICATION", name: "Verification", stepType: "approval" });
    await addStep({ code: "CUSTOMER_CONFIRMATION", name: "Customer Confirmation", stepType: "approval" });
    await addStep({ code: "CLOSED", name: "Closed", stepType: "end", isTerminal: true, terminalStatus: "approved" });
    await addStep({
      code: "REJECTED",
      name: "Rejected",
      stepType: "end",
      isTerminal: true,
      terminalStatus: "rejected",
    });
    await addStep({
      code: "CANCELLED",
      name: "Cancelled",
      stepType: "end",
      isTerminal: true,
      terminalStatus: "cancelled",
    });

    const addTransition = (body: Record<string, unknown>) =>
      app.inject({
        method: "POST",
        url: `/workflow/definitions/${WORKFLOW_CODE}/versions/1/transitions`,
        headers: authHeader(adminToken),
        payload: body,
      });
    await addTransition({ fromStepCode: "DRAFT", toStepCode: "SUBMITTED", actionCode: "submit", name: "Submit" });
    await addTransition({ fromStepCode: "DRAFT", toStepCode: "CANCELLED", actionCode: "cancel", name: "Cancel" });
    await addTransition({
      fromStepCode: "SUBMITTED",
      toStepCode: "ACKNOWLEDGED",
      actionCode: "acknowledge",
      name: "Acknowledge",
    });
    await addTransition({ fromStepCode: "SUBMITTED", toStepCode: "REJECTED", actionCode: "reject", name: "Reject" });
    await addTransition({ fromStepCode: "ACKNOWLEDGED", toStepCode: "ASSIGNED", actionCode: "assign", name: "Assign" });
    await addTransition({
      fromStepCode: "ASSIGNED",
      toStepCode: "IN_INVESTIGATION",
      actionCode: "start_investigation",
      name: "Start Investigation",
    });
    await addTransition({
      fromStepCode: "IN_INVESTIGATION",
      toStepCode: "CORRECTIVE_ACTION",
      actionCode: "submit_corrective_action",
      name: "Submit Corrective Action",
    });
    await addTransition({
      fromStepCode: "CORRECTIVE_ACTION",
      toStepCode: "VERIFICATION",
      actionCode: "submit_for_verification",
      name: "Submit for Verification",
    });
    await addTransition({ fromStepCode: "VERIFICATION", toStepCode: "CUSTOMER_CONFIRMATION", actionCode: "verify", name: "Verify" });
    await addTransition({
      fromStepCode: "CUSTOMER_CONFIRMATION",
      toStepCode: "CLOSED",
      actionCode: "confirm",
      name: "Customer Confirm & Close",
    });

    const addAssignmentRule = (body: Record<string, unknown>) =>
      app.inject({
        method: "POST",
        url: `/workflow/definitions/${WORKFLOW_CODE}/versions/1/assignment-rules`,
        headers: authHeader(adminToken),
        payload: body,
      });
    await addAssignmentRule({ stepCode: "DRAFT", assignmentType: "specific_user", specificUserSource: "submitter" });
    await addAssignmentRule({
      stepCode: "SUBMITTED",
      assignmentType: "role",
      roleCode: "COMPLAINT_HANDLER_1B",
      organizationUnitStrategy: "submitter_unit",
    });
    await addAssignmentRule({
      stepCode: "ACKNOWLEDGED",
      assignmentType: "role",
      roleCode: "COMPLAINT_HANDLER_1B",
      organizationUnitStrategy: "submitter_unit",
    });
    // Condition-based dynamic routing: severity=critical skips the local
    // Handler and goes straight to the tenant-wide Manager.
    await addAssignmentRule({
      stepCode: "ASSIGNED",
      sortOrder: 1,
      conditionExpression: { field: "severity", operator: "eq", value: "critical" },
      assignmentType: "role",
      roleCode: "COMPLAINT_MANAGER_1B",
      organizationUnitStrategy: "tenant",
    });
    await addAssignmentRule({
      stepCode: "ASSIGNED",
      sortOrder: 2,
      assignmentType: "role",
      roleCode: "COMPLAINT_HANDLER_1B",
      organizationUnitStrategy: "submitter_unit",
    });
    await addAssignmentRule({
      stepCode: "IN_INVESTIGATION",
      assignmentType: "role",
      roleCode: "COMPLAINT_HANDLER_1B",
      organizationUnitStrategy: "submitter_unit",
    });
    await addAssignmentRule({
      stepCode: "CORRECTIVE_ACTION",
      assignmentType: "role",
      roleCode: "COMPLAINT_HANDLER_1B",
      organizationUnitStrategy: "submitter_unit",
    });
    // Verification is independent QA — always the tenant-wide Manager,
    // never the Handler who ran the investigation.
    await addAssignmentRule({
      stepCode: "VERIFICATION",
      assignmentType: "role",
      roleCode: "COMPLAINT_MANAGER_1B",
      organizationUnitStrategy: "tenant",
    });
    await addAssignmentRule({
      stepCode: "CUSTOMER_CONFIRMATION",
      assignmentType: "specific_user",
      specificUserSource: "submitter",
    });

    const escalation = await app.inject({
      method: "POST",
      url: `/workflow/definitions/${WORKFLOW_CODE}/versions/1/escalation-rules`,
      headers: authHeader(adminToken),
      payload: {
        stepCode: "IN_INVESTIGATION",
        escalateAfterHours: 48,
        escalateToRoleCode: "COMPLAINT_MANAGER_1B",
        escalateToOrganizationUnitStrategy: "tenant",
      },
    });
    expect(escalation.statusCode).toBe(201);

    const publish = await app.inject({
      method: "POST",
      url: `/workflow/definitions/${WORKFLOW_CODE}/versions/1/publish`,
      headers: authHeader(adminToken),
    });
    expect(publish.statusCode).toBe(200);

    // A second, entirely separate Tenant — for the "wrong tenant" negative
    // path (its token must never reach Tenant 1B's data, even by guessing
    // a valid Complaint id).
    const otherTenant = await bootstrapTenant(app, OTHER_TENANT_CODE, "Other Tenant 1B");
    otherTenantId = otherTenant.id;
    await provisionFirstAdmin({
      tenantId: otherTenantId,
      email: "admin@other1b.local",
      password: "Admin12345!",
    });
    otherAdminToken = (await login(app, OTHER_TENANT_CODE, "admin@other1b.local", "Admin12345!")).body
      .accessToken;
  });

  afterAll(async () => {
    await pool.query(`DELETE FROM tenants WHERE id = ANY($1)`, [[tenantId, otherTenantId]]);
    await app.close();
  });

  let complaintId: string;
  let workflowInstanceId: string;

  it("RBAC denial: an actor without complaint.manage cannot create a Complaint", async () => {
    const noPermRoleId = await createReadOnlyRole(tenantId, "NO_COMPLAINT_PERM_1B", ["customer.read"]);
    void noPermRoleId;
    const create = await app.inject({
      method: "POST",
      url: "/users",
      headers: authHeader(adminToken),
      payload: {
        email: "noperm@test1b.local",
        fullName: "No Permission User",
        password: "NoPerm12345!",
        roleCode: "NO_COMPLAINT_PERM_1B",
        scopeType: "tenant",
      },
    });
    expect(create.statusCode).toBe(201);
    const noPermToken = (await login(app, TENANT_CODE, "noperm@test1b.local", "NoPerm12345!")).body
      .accessToken;

    const response = await app.inject({
      method: "POST",
      url: "/complaints",
      headers: authHeader(noPermToken),
      payload: {
        customerId: customerAId,
        category: "service_quality",
        description: "Should be denied",
        priority: "high",
        severity: "major",
      },
    });
    expect(response.statusCode).toBe(403);
  });

  it("Unauthorized customer: Customer A User cannot file a Complaint against Customer B", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/complaints",
      headers: authHeader(customerUserAToken),
      payload: {
        customerId: customerBId,
        category: "service_quality",
        description: "Should be denied — wrong Customer scope",
        priority: "high",
        severity: "major",
      },
    });
    expect(response.statusCode).toBe(403);
  });

  it("Customer User Submit Complaint: Draft created, Customer/Data Scope validated, Numbering applied, Workflow Instance started (SLA started)", async () => {
    const create = await app.inject({
      method: "POST",
      url: "/complaints",
      headers: authHeader(customerUserAToken),
      payload: {
        customerId: customerAId,
        category: "service_quality",
        subcategory: "cleaning",
        description: "Jadwal kebersihan tidak sesuai kontrak",
        priority: "high",
        severity: "major",
        source: "portal",
        channel: "web",
      },
    });
    expect(create.statusCode).toBe(201);
    const body = create.json();
    complaintId = body.id;
    workflowInstanceId = body.workflowInstanceId;
    expect(body.complaintNumber).toMatch(/^CMP-1B-\d{5}$/);
    expect(workflowInstanceId).toBeTruthy();
    expect(body.priority).toBe("high");
    expect(body.severity).toBe("major"); // distinct from priority

    const auditRow = await pool.query(
      `SELECT * FROM audit_log WHERE entity_type = 'complaint' AND entity_id = $1 AND action = 'complaint.created'`,
      [complaintId],
    );
    expect(auditRow.rows).toHaveLength(1);

    const stepRow = await pool.query(
      `SELECT ws.code, ws.sla_hours FROM workflow_instances wi
         JOIN workflow_steps ws ON ws.id = wi.current_step_id
       WHERE wi.id = $1`,
      [workflowInstanceId],
    );
    expect(stepRow.rows[0].code).toBe("DRAFT");
  });

  it("Invalid workflow transition: an actionCode not valid for the current Step is rejected by the Workflow Engine itself", async () => {
    const response = await app.inject({
      method: "POST",
      url: `/complaints/${complaintId}/actions/confirm`, // DRAFT has no 'confirm' transition
      headers: authHeader(customerUserAToken),
      payload: {},
    });
    expect(response.statusCode).toBe(400);
  });

  it("Invalid attachment: uploading with no file part is rejected", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/documents",
      headers: { ...authHeader(customerUserAToken), "content-type": "multipart/form-data; boundary=x" },
      payload: Buffer.from("--x--\r\n"),
    });
    expect(response.statusCode).toBe(400);
  });

  it("Submit (Draft -> Submitted): assigned to the Site-scoped COMPLAINT_HANDLER via submitter_unit routing", async () => {
    const response = await app.inject({
      method: "POST",
      url: `/complaints/${complaintId}/submit`,
      headers: authHeader(customerUserAToken),
      payload: { comment: "Mengajukan komplain" },
    });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.complaint.submittedAt).toBeTruthy();
    expect(body.workflowResult.newAssignment).toMatchObject({
      assignmentType: "role",
      assignedRoleCode: "COMPLAINT_HANDLER_1B",
      assignedOrganizationUnitId: siteId,
    });
  });

  it("Duplicate submission / idempotency: submitting again is rejected because Submit is no longer the pending action", async () => {
    const response = await app.inject({
      method: "POST",
      url: `/complaints/${complaintId}/submit`,
      headers: authHeader(customerUserAToken),
      payload: {},
    });
    // Customer User is not eligible for the pending Assignment anymore (it
    // now belongs to COMPLAINT_HANDLER_1B) — the Workflow Engine itself
    // rejects the duplicate action, proving there is no double-processing.
    expect(response.statusCode).toBe(403);
  });

  it("Internal User Investigation: Handler acknowledges, assigns, starts investigation, records Root Cause/Corrective Action, submits for verification", async () => {
    const acknowledge = await app.inject({
      method: "POST",
      url: `/complaints/${complaintId}/actions/acknowledge`,
      headers: authHeader(handlerToken),
      payload: {},
    });
    expect(acknowledge.statusCode).toBe(200);

    const assign = await app.inject({
      method: "POST",
      url: `/complaints/${complaintId}/actions/assign`,
      headers: authHeader(handlerToken),
      payload: {},
    });
    expect(assign.statusCode).toBe(200);
    expect(assign.json().workflowResult.newAssignment).toMatchObject({
      assignedRoleCode: "COMPLAINT_HANDLER_1B",
    });

    const startInvestigation = await app.inject({
      method: "POST",
      url: `/complaints/${complaintId}/actions/start_investigation`,
      headers: authHeader(handlerToken),
      payload: {},
    });
    expect(startInvestigation.statusCode).toBe(200);

    const investigation = await app.inject({
      method: "POST",
      url: `/complaints/${complaintId}/investigation`,
      headers: authHeader(handlerToken),
      payload: {
        rootCause: "Jadwal shift tidak sinkron",
        correctiveAction: "Perbaikan penjadwalan mingguan",
        preventiveAction: "Audit jadwal rutin",
      },
    });
    expect(investigation.statusCode).toBe(200);
    expect(investigation.json().rootCause).toBe("Jadwal shift tidak sinkron");

    const submitCorrectiveAction = await app.inject({
      method: "POST",
      url: `/complaints/${complaintId}/actions/submit_corrective_action`,
      headers: authHeader(handlerToken),
      payload: {},
    });
    expect(submitCorrectiveAction.statusCode).toBe(200);

    const submitForVerification = await app.inject({
      method: "POST",
      url: `/complaints/${complaintId}/actions/submit_for_verification`,
      headers: authHeader(handlerToken),
      payload: {},
    });
    expect(submitForVerification.statusCode).toBe(200);
    // Verification routes to the independent tenant-wide Manager, not the
    // Handler who ran the investigation.
    expect(submitForVerification.json().workflowResult.newAssignment).toMatchObject({
      assignedRoleCode: "COMPLAINT_MANAGER_1B",
      assignedOrganizationUnitId: null,
    });
  });

  it("Evidence: Handler uploads an attachment to the Complaint via Document Service + the `complaint` Entity Authorization Resolver (no document.* permission)", async () => {
    const boundary = "----vitestboundary1b";
    const parts = [
      `--${boundary}\r\nContent-Disposition: form-data; name="entityType"\r\n\r\ncomplaint\r\n`,
      `--${boundary}\r\nContent-Disposition: form-data; name="entityId"\r\n\r\n${complaintId}\r\n`,
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="evidence.txt"\r\nContent-Type: text/plain\r\n\r\nFoto kondisi lapangan\r\n`,
      `--${boundary}--\r\n`,
    ];
    const upload = await app.inject({
      method: "POST",
      url: "/documents",
      headers: { ...authHeader(handlerToken), "content-type": `multipart/form-data; boundary=${boundary}` },
      payload: Buffer.from(parts.join("")),
    });
    expect(upload.statusCode).toBe(201);

    const list = await app.inject({
      method: "GET",
      url: `/documents?entityType=complaint&entityId=${complaintId}`,
      headers: authHeader(customerUserAToken),
    });
    expect(list.statusCode).toBe(200);
    expect(list.json()).toHaveLength(1);
  });

  it("Wrong tenant: an Administrator from a completely different Tenant cannot reach this Complaint even with a valid id", async () => {
    const response = await app.inject({
      method: "GET",
      url: `/complaints/${complaintId}`,
      headers: authHeader(otherAdminToken),
    });
    expect(response.statusCode).toBe(404);
  });

  it("Reopen authorization: reopening a still-in-progress Complaint is rejected (must be Closed/Rejected/Cancelled first)", async () => {
    const response = await app.inject({
      method: "POST",
      url: `/complaints/${complaintId}/reopen`,
      headers: authHeader(managerToken),
      payload: { toStepCode: "ASSIGNED" },
    });
    expect(response.statusCode).toBe(409);
  });

  it("Verification + Customer Confirmation: Manager verifies, Customer confirms -> Closed, closureDate set, Audit/History recorded", async () => {
    const verification = await app.inject({
      method: "POST",
      url: `/complaints/${complaintId}/verification`,
      headers: authHeader(managerToken),
      payload: { note: "Verifikasi selesai, sesuai standar" },
    });
    expect(verification.statusCode).toBe(200);

    const verify = await app.inject({
      method: "POST",
      url: `/complaints/${complaintId}/actions/verify`,
      headers: authHeader(managerToken),
      payload: {},
    });
    expect(verify.statusCode).toBe(200);
    // Customer Confirmation routes back to the original submitter.
    expect(verify.json().workflowResult.newAssignment).toMatchObject({ assignmentType: "specific_user" });

    const confirmation = await app.inject({
      method: "POST",
      url: `/complaints/${complaintId}/customer-confirmation`,
      headers: authHeader(customerUserAToken),
      payload: { note: "Sudah sesuai, terima kasih" },
    });
    expect(confirmation.statusCode).toBe(200);

    const confirm = await app.inject({
      method: "POST",
      url: `/complaints/${complaintId}/actions/confirm`,
      headers: authHeader(customerUserAToken),
      payload: {},
    });
    expect(confirm.statusCode).toBe(200);
    expect(confirm.json().complaint.closureDate).toBeTruthy();
    expect(confirm.json().workflowResult.instance.status).toBe("approved");

    const get = await app.inject({
      method: "GET",
      url: `/complaints/${complaintId}`,
      headers: authHeader(customerUserAToken),
    });
    expect(get.json().status).toMatchObject({ stepCode: "CLOSED", instanceStatus: "approved" });

    const historyRows = await pool.query(
      `SELECT action_code FROM workflow_history WHERE workflow_instance_id = $1 ORDER BY occurred_at`,
      [workflowInstanceId],
    );
    const actionCodes = historyRows.rows.map((r) => r.action_code);
    expect(actionCodes).toEqual(
      expect.arrayContaining([
        "submit",
        "acknowledge",
        "assign",
        "start_investigation",
        "submit_corrective_action",
        "submit_for_verification",
        "verify",
        "confirm",
      ]),
    );

    const auditActions = (
      await pool.query(
        `SELECT action FROM audit_log WHERE entity_type = 'complaint' AND entity_id = $1 ORDER BY id`,
        [complaintId],
      )
    ).rows.map((r) => r.action);
    expect(auditActions).toEqual(
      expect.arrayContaining([
        "complaint.created",
        "complaint.submitted",
        "complaint.acknowledged",
        "complaint.assigned",
        "complaint.investigation_started",
        "complaint.investigation_updated",
        "complaint.corrective_action_submitted",
        "complaint.verification_requested",
        "complaint.verified",
        "complaint.customer_confirmation_recorded",
        "complaint.customer_confirmed",
      ]),
    );
  });

  it("Reopen authorization: after Closed, only an actor with complaint.manage can reopen; an unauthorized actor is rejected", async () => {
    const noPermToken = (await login(app, TENANT_CODE, "noperm@test1b.local", "NoPerm12345!")).body
      .accessToken;
    const denied = await app.inject({
      method: "POST",
      url: `/complaints/${complaintId}/reopen`,
      headers: authHeader(noPermToken),
      payload: { toStepCode: "ASSIGNED" },
    });
    expect(denied.statusCode).toBe(403);

    const reopen = await app.inject({
      method: "POST",
      url: `/complaints/${complaintId}/reopen`,
      headers: authHeader(managerToken),
      payload: { toStepCode: "ASSIGNED", comment: "Perlu klarifikasi lanjutan" },
    });
    expect(reopen.statusCode).toBe(200);
    expect(reopen.json().workflowResult.instance.status).toBe("in_progress");

    const get = await app.inject({
      method: "GET",
      url: `/complaints/${complaintId}`,
      headers: authHeader(customerUserAToken),
    });
    expect(get.json().status.stepCode).toBe("ASSIGNED");

    const auditRow = await pool.query(
      `SELECT * FROM audit_log WHERE entity_type = 'complaint' AND entity_id = $1 AND action = 'complaint.reopened'`,
      [complaintId],
    );
    expect(auditRow.rows).toHaveLength(1);
  });

  it("Condition-based dynamic routing: a severity=critical Complaint at ASSIGNED routes directly to the tenant-wide COMPLAINT_MANAGER", async () => {
    const create = await app.inject({
      method: "POST",
      url: "/complaints",
      headers: authHeader(customerUserAToken),
      payload: {
        customerId: customerAId,
        category: "safety",
        description: "Insiden keselamatan kritikal",
        priority: "high",
        severity: "critical",
      },
    });
    const criticalId = create.json().id;

    await app.inject({
      method: "POST",
      url: `/complaints/${criticalId}/submit`,
      headers: authHeader(customerUserAToken),
      payload: {},
    });
    await app.inject({
      method: "POST",
      url: `/complaints/${criticalId}/actions/acknowledge`,
      headers: authHeader(handlerToken),
      payload: {},
    });
    const assign = await app.inject({
      method: "POST",
      url: `/complaints/${criticalId}/actions/assign`,
      headers: authHeader(handlerToken),
      payload: {},
    });
    expect(assign.statusCode).toBe(200);
    expect(assign.json().workflowResult.newAssignment).toMatchObject({
      assignedRoleCode: "COMPLAINT_MANAGER_1B",
      assignedOrganizationUnitId: null,
    });
  });

  it("SLA Escalation: an overdue In Investigation Assignment escalates to the tenant-wide COMPLAINT_MANAGER via the Scheduler sweep, and republishes as complaint.escalated", async () => {
    const create = await app.inject({
      method: "POST",
      url: "/complaints",
      headers: authHeader(customerUserAToken),
      payload: {
        customerId: customerAId,
        category: "safety",
        description: "SLA escalation test",
        priority: "low",
        severity: "minor",
      },
    });
    const slaComplaintId = create.json().id;
    const slaWorkflowInstanceId = create.json().workflowInstanceId;

    await app.inject({
      method: "POST",
      url: `/complaints/${slaComplaintId}/submit`,
      headers: authHeader(customerUserAToken),
      payload: {},
    });
    await app.inject({
      method: "POST",
      url: `/complaints/${slaComplaintId}/actions/acknowledge`,
      headers: authHeader(handlerToken),
      payload: {},
    });
    await app.inject({
      method: "POST",
      url: `/complaints/${slaComplaintId}/actions/assign`,
      headers: authHeader(handlerToken),
      payload: {},
    });
    await app.inject({
      method: "POST",
      url: `/complaints/${slaComplaintId}/actions/start_investigation`,
      headers: authHeader(handlerToken),
      payload: {},
    });

    // Simulate SLA breach — directly backdate due_at (there is no
    // production path to fast-forward time; same technique 0D's test
    // uses).
    await pool.query(
      `UPDATE workflow_instance_assignments SET due_at = now() - interval '1 hour'
       WHERE workflow_instance_id = $1 AND status = 'pending'`,
      [slaWorkflowInstanceId],
    );

    const sweep = await app.inject({
      method: "POST",
      url: "/workflow/escalation-sweep",
      headers: authHeader(adminToken),
    });
    expect(sweep.statusCode).toBe(200);
    expect(sweep.json().escalatedCount).toBeGreaterThanOrEqual(1);

    const escalatedAssignment = await pool.query(
      `SELECT assigned_role_code, status FROM workflow_instance_assignments
       WHERE workflow_instance_id = $1 AND status = 'pending'`,
      [slaWorkflowInstanceId],
    );
    expect(escalatedAssignment.rows[0].assigned_role_code).toBe("COMPLAINT_MANAGER_1B");

    const events = await pool.query(
      `SELECT event_type FROM domain_events WHERE entity_type = 'complaint' AND entity_id = $1
       AND event_type IN ('workflow.escalated', 'complaint.escalated')`,
      [slaComplaintId],
    );
    const eventTypes = events.rows.map((r) => r.event_type);
    expect(eventTypes).toEqual(expect.arrayContaining(["workflow.escalated", "complaint.escalated"]));
  });

  it("Phase 0/1A regression guard: Customer Data Scope (ADR-0011) still blocks Customer B User from Customer A's Complaints", async () => {
    await createReadOnlyRole(tenantId, "CUSTOMER_USER_1B_B", [
      "customer.read",
      "complaint.read",
      "complaint.manage",
      "workflow.instance.start",
      "workflow.instance.act",
    ]);
    await app.inject({
      method: "POST",
      url: "/users",
      headers: authHeader(adminToken),
      payload: {
        email: "user@customer-1b-b.local",
        fullName: "Customer 1B B User",
        password: "CustomerUser12345!",
        roleCode: "CUSTOMER_USER_1B_B",
        scopeType: "customer",
        scopeCustomerId: customerBId,
      },
    });
    const customerUserBToken = (
      await login(app, TENANT_CODE, "user@customer-1b-b.local", "CustomerUser12345!")
    ).body.accessToken;

    const response = await app.inject({
      method: "GET",
      url: `/complaints/${complaintId}`,
      headers: authHeader(customerUserBToken),
    });
    expect(response.statusCode).toBe(403);
  });
});
