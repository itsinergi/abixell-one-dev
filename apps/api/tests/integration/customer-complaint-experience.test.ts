import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../../src/app.js";
import { pool } from "../../src/infrastructure/persistence/db.js";
import { activateAllModules, authHeader, bootstrapTenant, createReadOnlyRole, login, provisionFirstAdmin } from "./helpers.js";

/**
 * Checkpoint 1C.2 — Customer Complaint Experience (backend read/authorization
 * surface). Proves the additive, generic read capability added for the
 * customer experience:
 *  - `GET /complaints?view=summary` (list with live status + SLA)
 *  - `GET /complaints/:id/detail` (customer-safe composite: status, SLA,
 *     safe timeline, available actions, reopen eligibility)
 *  - `GET /complaints/reference-data` (Tenant-configured create options,
 *     reachable by a Customer User without `config.read`)
 * against the REAL database + workflow engine, plus the security-critical
 * negative paths (cross-customer, cross-tenant, evidence scope).
 *
 * The customer-safe timeline MUST NOT leak internal actor identities or
 * internal workflow comments (guard 9) — asserted explicitly below.
 */

const TENANT_CODE = `test-1c2-${Date.now()}`;
const OTHER_TENANT_CODE = `test-1c2-other-${Date.now()}`;
const WORKFLOW_CODE = "complaint_lifecycle";

describe("Checkpoint 1C.2 — Customer Complaint Experience", () => {
  const app = buildApp();
  let tenantId: string;
  let otherTenantId: string;
  let adminToken: string;
  let otherAdminToken: string;
  let siteId: string;
  let customerAId: string;
  let customerBId: string;
  let customerUserAToken: string;
  let customerUserBToken: string;
  let handlerToken: string;
  let managerToken: string;

  beforeAll(async () => {
    const tenant = await bootstrapTenant(app, TENANT_CODE, "Test Tenant 1C2");
    tenantId = tenant.id;
    await activateAllModules(tenantId);
    await provisionFirstAdmin({ tenantId, email: "admin@test1c2.local", password: "Admin12345!" });
    adminToken = (await login(app, TENANT_CODE, "admin@test1c2.local", "Admin12345!")).body.accessToken;

    const legalEntity = await app.inject({
      method: "POST",
      url: "/legal-entities",
      headers: authHeader(adminToken),
      payload: { name: "LE 1C2" },
    });
    const legalEntityId = legalEntity.json().id;
    const site = await app.inject({
      method: "POST",
      url: "/organization-units",
      headers: authHeader(adminToken),
      payload: { legalEntityId, name: "Site A 1C2", unitType: "Site", parentId: null },
    });
    siteId = site.json().id;

    const customerA = await app.inject({
      method: "POST",
      url: "/customers",
      headers: authHeader(adminToken),
      payload: { code: "CUST-1C2-A", name: "Customer 1C2 A", ownerOrganizationUnitId: siteId },
    });
    customerAId = customerA.json().id;
    const customerB = await app.inject({
      method: "POST",
      url: "/customers",
      headers: authHeader(adminToken),
      payload: { code: "CUST-1C2-B", name: "Customer 1C2 B", ownerOrganizationUnitId: siteId },
    });
    customerBId = customerB.json().id;

    await createReadOnlyRole(tenantId, "HANDLER_1C2", [
      "complaint.read",
      "complaint.manage",
      "workflow.instance.act",
      "customer.read",
    ]);
    await createReadOnlyRole(tenantId, "MANAGER_1C2", [
      "complaint.read",
      "complaint.manage",
      "workflow.instance.act",
      "customer.read",
    ]);
    await createReadOnlyRole(tenantId, "CUSTOMER_A_1C2", [
      "customer.read",
      "complaint.read",
      "complaint.manage",
      "workflow.instance.start",
      "workflow.instance.act",
    ]);
    await createReadOnlyRole(tenantId, "CUSTOMER_B_1C2", [
      "customer.read",
      "complaint.read",
      "complaint.manage",
      "workflow.instance.start",
      "workflow.instance.act",
    ]);

    // B1b (§4.4 D): customer-scope payloads stay on the ADR-0011 door; every
    // other scope is rewritten into a governed one-pair batch.
    const createUser = (payload: Record<string, unknown>) => {
      if (payload.scopeType === "customer") {
        return app.inject({ method: "POST", url: "/users", headers: authHeader(adminToken), payload });
      }
      const { email, fullName, password, roleCode, scopeType, scopeOrganizationUnitId, ...rest } = payload as Record<string, string>;
      const pair =
        scopeType === "organization_unit"
          ? { roleCode, scopeType: "organization_unit" as const, scopeOrganizationUnitId }
          : { roleCode, scopeType: "tenant" as const };
      return app.inject({
        method: "POST",
        url: "/admin/users",
        headers: authHeader(adminToken),
        payload: { email, fullName, password, pairs: [pair], ...rest },
      });
    };

    await createUser({
      email: "handler@test1c2.local",
      fullName: "Handler",
      password: "Handler12345!",
      roleCode: "HANDLER_1C2",
      scopeType: "organization_unit",
      scopeOrganizationUnitId: siteId,
    });
    await createUser({
      email: "manager@test1c2.local",
      fullName: "Manager",
      password: "Manager12345!",
      roleCode: "MANAGER_1C2",
      scopeType: "tenant",
    });
    await createUser({
      email: "user@customer-a.local",
      fullName: "Customer A User",
      password: "CustomerUser12345!",
      roleCode: "CUSTOMER_A_1C2",
      scopeType: "customer",
      scopeCustomerId: customerAId,
    });
    await createUser({
      email: "user@customer-b.local",
      fullName: "Customer B User",
      password: "CustomerUser12345!",
      roleCode: "CUSTOMER_B_1C2",
      scopeType: "customer",
      scopeCustomerId: customerBId,
    });

    handlerToken = (await login(app, TENANT_CODE, "handler@test1c2.local", "Handler12345!")).body.accessToken;
    managerToken = (await login(app, TENANT_CODE, "manager@test1c2.local", "Manager12345!")).body.accessToken;
    customerUserAToken = (await login(app, TENANT_CODE, "user@customer-a.local", "CustomerUser12345!")).body.accessToken;
    customerUserBToken = (await login(app, TENANT_CODE, "user@customer-b.local", "CustomerUser12345!")).body.accessToken;

    await app.inject({
      method: "POST",
      url: "/config/numbering/complaint_number",
      headers: authHeader(adminToken),
      payload: { pattern: "CMP-1C2-{SEQ:5}" },
    });

    // Tenant-configured create-form catalogs (proves the option source is
    // Configuration, not hardcoded).
    const addRef = (typeCode: string, code: string, label: string) =>
      app.inject({
        method: "POST",
        url: `/config/reference-data/${typeCode}`,
        headers: authHeader(adminToken),
        payload: { code, label },
      });
    await addRef("complaint_category", "service_quality", "Service Quality");
    await addRef("complaint_category", "safety", "Safety");
    await addRef("complaint_severity", "major", "Major");
    await addRef("complaint_severity", "critical", "Critical");
    await addRef("priority_level", "high", "High");
    await addRef("priority_level", "low", "Low");

    // Build the complaint_lifecycle workflow via the real admin API.
    await app.inject({
      method: "POST",
      url: "/workflow/definitions",
      headers: authHeader(adminToken),
      payload: {
        code: WORKFLOW_CODE,
        name: "Complaint Lifecycle 1C2",
        entityType: "complaint",
        description: "1C2 test workflow",
      },
    });
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
    await addStep({ code: "CANCELLED", name: "Cancelled", stepType: "end", isTerminal: true, terminalStatus: "cancelled" });

    const addTransition = (body: Record<string, unknown>) =>
      app.inject({
        method: "POST",
        url: `/workflow/definitions/${WORKFLOW_CODE}/versions/1/transitions`,
        headers: authHeader(adminToken),
        payload: body,
      });
    await addTransition({ fromStepCode: "DRAFT", toStepCode: "SUBMITTED", actionCode: "submit", name: "Submit" });
    await addTransition({ fromStepCode: "DRAFT", toStepCode: "CANCELLED", actionCode: "cancel", name: "Cancel" });
    await addTransition({ fromStepCode: "SUBMITTED", toStepCode: "ACKNOWLEDGED", actionCode: "acknowledge", name: "Acknowledge" });
    await addTransition({ fromStepCode: "ACKNOWLEDGED", toStepCode: "ASSIGNED", actionCode: "assign", name: "Assign" });
    await addTransition({ fromStepCode: "ASSIGNED", toStepCode: "IN_INVESTIGATION", actionCode: "start_investigation", name: "Start Investigation" });
    await addTransition({ fromStepCode: "IN_INVESTIGATION", toStepCode: "CORRECTIVE_ACTION", actionCode: "submit_corrective_action", name: "Submit Corrective Action" });
    await addTransition({ fromStepCode: "CORRECTIVE_ACTION", toStepCode: "VERIFICATION", actionCode: "submit_for_verification", name: "Submit for Verification" });
    await addTransition({ fromStepCode: "VERIFICATION", toStepCode: "CUSTOMER_CONFIRMATION", actionCode: "verify", name: "Verify" });
    await addTransition({ fromStepCode: "CUSTOMER_CONFIRMATION", toStepCode: "CLOSED", actionCode: "confirm", name: "Customer Confirm & Close" });

    const addRule = (body: Record<string, unknown>) =>
      app.inject({
        method: "POST",
        url: `/workflow/definitions/${WORKFLOW_CODE}/versions/1/assignment-rules`,
        headers: authHeader(adminToken),
        payload: body,
      });
    await addRule({ stepCode: "DRAFT", assignmentType: "specific_user", specificUserSource: "submitter" });
    await addRule({ stepCode: "SUBMITTED", assignmentType: "role", roleCode: "HANDLER_1C2", organizationUnitStrategy: "submitter_unit" });
    await addRule({ stepCode: "ACKNOWLEDGED", assignmentType: "role", roleCode: "HANDLER_1C2", organizationUnitStrategy: "submitter_unit" });
    await addRule({ stepCode: "ASSIGNED", assignmentType: "role", roleCode: "HANDLER_1C2", organizationUnitStrategy: "submitter_unit" });
    await addRule({ stepCode: "IN_INVESTIGATION", assignmentType: "role", roleCode: "HANDLER_1C2", organizationUnitStrategy: "submitter_unit" });
    await addRule({ stepCode: "CORRECTIVE_ACTION", assignmentType: "role", roleCode: "HANDLER_1C2", organizationUnitStrategy: "submitter_unit" });
    await addRule({ stepCode: "VERIFICATION", assignmentType: "role", roleCode: "MANAGER_1C2", organizationUnitStrategy: "tenant" });
    await addRule({ stepCode: "CUSTOMER_CONFIRMATION", assignmentType: "specific_user", specificUserSource: "submitter" });

    await app.inject({
      method: "POST",
      url: `/workflow/definitions/${WORKFLOW_CODE}/versions/1/publish`,
      headers: authHeader(adminToken),
    });

    const otherTenant = await bootstrapTenant(app, OTHER_TENANT_CODE, "Other Tenant 1C2");

    await activateAllModules(otherTenant.id);
    otherTenantId = otherTenant.id;
    await provisionFirstAdmin({ tenantId: otherTenantId, email: "admin@other1c2.local", password: "Admin12345!" });
    otherAdminToken = (await login(app, OTHER_TENANT_CODE, "admin@other1c2.local", "Admin12345!")).body.accessToken;
  });

  afterAll(async () => {
    await pool.query(`DELETE FROM tenants WHERE id = ANY($1)`, [[tenantId, otherTenantId]]);
    await app.close();
  });

  let complaintId: string;

  async function createComplaintA(overrides: Record<string, unknown> = {}) {
    const create = await app.inject({
      method: "POST",
      url: "/complaints",
      headers: authHeader(customerUserAToken),
      payload: {
        customerId: customerAId,
        category: "service_quality",
        description: "Kebersihan tidak sesuai kontrak",
        priority: "high",
        severity: "major",
        ...overrides,
      },
    });
    expect(create.statusCode).toBe(201);
    return create.json().id as string;
  }

  it("Create options: a Customer User (without config.read) gets the Tenant-configured catalogs", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/complaints/reference-data",
      headers: authHeader(customerUserAToken),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.categories.map((c: { code: string }) => c.code)).toEqual(
      expect.arrayContaining(["service_quality", "safety"]),
    );
    expect(body.severities.length).toBeGreaterThanOrEqual(1);
    expect(body.priorities.map((p: { code: string }) => p.code)).toEqual(
      expect.arrayContaining(["high", "low"]),
    );
  });

  it("List summary: a customer sees only their own complaints, enriched with live status + SLA", async () => {
    complaintId = await createComplaintA();
    const res = await app.inject({
      method: "GET",
      url: `/complaints?customerId=${customerAId}&view=summary`,
      headers: authHeader(customerUserAToken),
    });
    expect(res.statusCode).toBe(200);
    const list = res.json();
    expect(Array.isArray(list)).toBe(true);
    const row = list.find((r: { complaint: { id: string } }) => r.complaint.id === complaintId);
    expect(row).toBeTruthy();
    expect(row.status).toMatchObject({ stepCode: "DRAFT", instanceStatus: "in_progress" });
  });

  it("Composite detail: customer-safe view exposes available actions and a leak-free timeline", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/complaints/${complaintId}/detail`,
      headers: authHeader(customerUserAToken),
    });
    expect(res.statusCode).toBe(200);
    const detail = res.json();
    expect(detail.status).toMatchObject({ stepCode: "DRAFT", instanceStatus: "in_progress" });
    // At DRAFT the submitter (this customer) may submit or cancel.
    const actions = detail.availableActions.map((a: { actionCode: string }) => a.actionCode);
    expect(actions).toEqual(expect.arrayContaining(["submit", "cancel"]));
    // A closed action is NOT offered mid-lifecycle.
    expect(actions).not.toContain("confirm");
    expect(detail.reopen.canReopen).toBe(false);
    // Timeline must not leak internal actor identity or internal comments.
    expect(detail.timeline.length).toBeGreaterThanOrEqual(1);
    for (const entry of detail.timeline) {
      expect(entry).not.toHaveProperty("actorUserId");
      expect(entry).not.toHaveProperty("comment");
    }
  });

  it("Available actions reflect eligibility: after submit, the customer has no pending action", async () => {
    const submit = await app.inject({
      method: "POST",
      url: `/complaints/${complaintId}/submit`,
      headers: authHeader(customerUserAToken),
      payload: {},
    });
    expect(submit.statusCode).toBe(200);
    const res = await app.inject({
      method: "GET",
      url: `/complaints/${complaintId}/detail`,
      headers: authHeader(customerUserAToken),
    });
    const detail = res.json();
    expect(detail.status.stepCode).toBe("SUBMITTED");
    // The pending task now belongs to the Handler role — not the customer.
    expect(detail.availableActions).toHaveLength(0);
  });

  it("Cross-customer denial: Customer B cannot read Customer A's complaint detail", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/complaints/${complaintId}/detail`,
      headers: authHeader(customerUserBToken),
    });
    expect(res.statusCode).toBe(403);
  });

  it("Cross-tenant denial: an admin from another tenant cannot read the complaint detail", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/complaints/${complaintId}/detail`,
      headers: authHeader(otherAdminToken),
    });
    expect(res.statusCode).toBe(404);
  });

  it("Evidence: the customer can attach and list evidence on their own complaint; Customer B is denied", async () => {
    const boundary = "----vitest1c2boundary";
    const parts = [
      `--${boundary}\r\nContent-Disposition: form-data; name="entityType"\r\n\r\ncomplaint\r\n`,
      `--${boundary}\r\nContent-Disposition: form-data; name="entityId"\r\n\r\n${complaintId}\r\n`,
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="evidence.txt"\r\nContent-Type: text/plain\r\n\r\nBukti lapangan\r\n`,
      `--${boundary}--\r\n`,
    ];
    const upload = await app.inject({
      method: "POST",
      url: "/documents",
      headers: { ...authHeader(customerUserAToken), "content-type": `multipart/form-data; boundary=${boundary}` },
      payload: Buffer.from(parts.join("")),
    });
    expect(upload.statusCode).toBe(201);

    const list = await app.inject({
      method: "GET",
      url: `/documents?entityType=complaint&entityId=${complaintId}`,
      headers: authHeader(customerUserAToken),
    });
    expect(list.statusCode).toBe(200);
    expect(list.json().length).toBeGreaterThanOrEqual(1);

    const denied = await app.inject({
      method: "GET",
      url: `/documents?entityType=complaint&entityId=${complaintId}`,
      headers: authHeader(customerUserBToken),
    });
    expect(denied.statusCode).toBe(403);
  });

  it("Reopen eligibility: after the complaint is Closed, detail reports the customer may reopen with valid target steps", async () => {
    // Drive the full lifecycle to Closed.
    await app.inject({ method: "POST", url: `/complaints/${complaintId}/actions/acknowledge`, headers: authHeader(handlerToken), payload: {} });
    await app.inject({ method: "POST", url: `/complaints/${complaintId}/actions/assign`, headers: authHeader(handlerToken), payload: {} });
    await app.inject({ method: "POST", url: `/complaints/${complaintId}/actions/start_investigation`, headers: authHeader(handlerToken), payload: {} });
    await app.inject({ method: "POST", url: `/complaints/${complaintId}/actions/submit_corrective_action`, headers: authHeader(handlerToken), payload: {} });
    await app.inject({ method: "POST", url: `/complaints/${complaintId}/actions/submit_for_verification`, headers: authHeader(handlerToken), payload: {} });
    await app.inject({ method: "POST", url: `/complaints/${complaintId}/actions/verify`, headers: authHeader(managerToken), payload: {} });

    // Customer confirmation is now the pending action for the submitter.
    const beforeConfirm = await app.inject({
      method: "GET",
      url: `/complaints/${complaintId}/detail`,
      headers: authHeader(customerUserAToken),
    });
    expect(beforeConfirm.json().availableActions.map((a: { actionCode: string }) => a.actionCode)).toContain("confirm");

    await app.inject({ method: "POST", url: `/complaints/${complaintId}/actions/confirm`, headers: authHeader(customerUserAToken), payload: {} });

    const afterClose = await app.inject({
      method: "GET",
      url: `/complaints/${complaintId}/detail`,
      headers: authHeader(customerUserAToken),
    });
    const detail = afterClose.json();
    expect(detail.status.instanceStatus).toBe("approved");
    expect(detail.reopen.canReopen).toBe(true);
    expect(detail.reopen.targetSteps.length).toBeGreaterThanOrEqual(1);
    // No forward actions once closed.
    expect(detail.availableActions).toHaveLength(0);
  });
});
