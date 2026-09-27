import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../../src/app.js";
import { pool } from "../../src/infrastructure/persistence/db.js";
import { activateAllModules, authHeader, bootstrapTenant, createReadOnlyRole, login, provisionFirstAdmin } from "./helpers.js";

/**
 * Checkpoint 1C.4 — QA / Verification Experience. The verifier experience is
 * built entirely on the existing operational read-model (queue filtered by
 * stepCode=VERIFICATION, operational detail) + the existing /verification
 * endpoint + workflow `verify` transition — no new backend endpoint or
 * schema. This suite proves the QA-relevant behaviour and the security
 * boundaries: only the eligible verifier gets the verify action, a
 * non-verifier handler is denied it, a customer is denied the operational
 * detail, and cross-tenant is denied.
 */

const TENANT_CODE = `test-1c4-${Date.now()}`;
const OTHER_TENANT_CODE = `test-1c4-other-${Date.now()}`;
const WORKFLOW_CODE = "complaint_lifecycle";

describe("Checkpoint 1C.4 — QA / Verification Experience", () => {
  const app = buildApp();
  let tenantId: string;
  let otherTenantId: string;
  let adminToken: string;
  let otherAdminToken: string;
  let siteId: string;
  let customerAId: string;
  let customerUserAToken: string;
  let handlerToken: string;
  let managerToken: string;

  async function addWorkflow() {
    await app.inject({
      method: "POST",
      url: "/workflow/definitions",
      headers: authHeader(adminToken),
      payload: { code: WORKFLOW_CODE, name: "Lifecycle 1C4", entityType: "complaint", description: "1C4" },
    });
    const step = (body: Record<string, unknown>) =>
      app.inject({ method: "POST", url: `/workflow/definitions/${WORKFLOW_CODE}/versions/1/steps`, headers: authHeader(adminToken), payload: body });
    await step({ code: "DRAFT", name: "Draft", stepType: "task", isInitial: true });
    await step({ code: "SUBMITTED", name: "Submitted", stepType: "task", slaHours: 4 });
    await step({ code: "ACKNOWLEDGED", name: "Acknowledged", stepType: "task" });
    await step({ code: "ASSIGNED", name: "Assigned", stepType: "task" });
    await step({ code: "IN_INVESTIGATION", name: "In Investigation", stepType: "task", slaHours: 48 });
    await step({ code: "CORRECTIVE_ACTION", name: "Corrective Action", stepType: "task" });
    await step({ code: "VERIFICATION", name: "Verification", stepType: "approval" });
    await step({ code: "CUSTOMER_CONFIRMATION", name: "Customer Confirmation", stepType: "approval" });
    await step({ code: "CLOSED", name: "Closed", stepType: "end", isTerminal: true, terminalStatus: "approved" });
    const tr = (body: Record<string, unknown>) =>
      app.inject({ method: "POST", url: `/workflow/definitions/${WORKFLOW_CODE}/versions/1/transitions`, headers: authHeader(adminToken), payload: body });
    await tr({ fromStepCode: "DRAFT", toStepCode: "SUBMITTED", actionCode: "submit", name: "Submit" });
    await tr({ fromStepCode: "SUBMITTED", toStepCode: "ACKNOWLEDGED", actionCode: "acknowledge", name: "Acknowledge" });
    await tr({ fromStepCode: "ACKNOWLEDGED", toStepCode: "ASSIGNED", actionCode: "assign", name: "Assign" });
    await tr({ fromStepCode: "ASSIGNED", toStepCode: "IN_INVESTIGATION", actionCode: "start_investigation", name: "Start Investigation" });
    await tr({ fromStepCode: "IN_INVESTIGATION", toStepCode: "CORRECTIVE_ACTION", actionCode: "submit_corrective_action", name: "Submit Corrective Action" });
    await tr({ fromStepCode: "CORRECTIVE_ACTION", toStepCode: "VERIFICATION", actionCode: "submit_for_verification", name: "Submit for Verification" });
    await tr({ fromStepCode: "VERIFICATION", toStepCode: "CUSTOMER_CONFIRMATION", actionCode: "verify", name: "Verify" });
    await tr({ fromStepCode: "CUSTOMER_CONFIRMATION", toStepCode: "CLOSED", actionCode: "confirm", name: "Confirm" });
    const rule = (body: Record<string, unknown>) =>
      app.inject({ method: "POST", url: `/workflow/definitions/${WORKFLOW_CODE}/versions/1/assignment-rules`, headers: authHeader(adminToken), payload: body });
    await rule({ stepCode: "DRAFT", assignmentType: "specific_user", specificUserSource: "submitter" });
    await rule({ stepCode: "SUBMITTED", assignmentType: "role", roleCode: "HANDLER_1C4", organizationUnitStrategy: "submitter_unit" });
    await rule({ stepCode: "ACKNOWLEDGED", assignmentType: "role", roleCode: "HANDLER_1C4", organizationUnitStrategy: "submitter_unit" });
    await rule({ stepCode: "ASSIGNED", assignmentType: "role", roleCode: "HANDLER_1C4", organizationUnitStrategy: "submitter_unit" });
    await rule({ stepCode: "IN_INVESTIGATION", assignmentType: "role", roleCode: "HANDLER_1C4", organizationUnitStrategy: "submitter_unit" });
    await rule({ stepCode: "CORRECTIVE_ACTION", assignmentType: "role", roleCode: "HANDLER_1C4", organizationUnitStrategy: "submitter_unit" });
    // Verification is independent QA — the tenant-wide MANAGER, never the Handler.
    await rule({ stepCode: "VERIFICATION", assignmentType: "role", roleCode: "MANAGER_1C4", organizationUnitStrategy: "tenant" });
    await rule({ stepCode: "CUSTOMER_CONFIRMATION", assignmentType: "specific_user", specificUserSource: "submitter" });
    await app.inject({ method: "POST", url: `/workflow/definitions/${WORKFLOW_CODE}/versions/1/publish`, headers: authHeader(adminToken) });
  }

  beforeAll(async () => {
    const tenant = await bootstrapTenant(app, TENANT_CODE, "Tenant 1C4");
    tenantId = tenant.id;
    await activateAllModules(tenantId);
    await provisionFirstAdmin({ tenantId, email: "admin@test1c4.local", password: "Admin12345!" });
    adminToken = (await login(app, TENANT_CODE, "admin@test1c4.local", "Admin12345!")).body.accessToken;

    const legalEntityId = (
      await app.inject({ method: "POST", url: "/legal-entities", headers: authHeader(adminToken), payload: { name: "LE 1C4" } })
    ).json().id;
    siteId = (
      await app.inject({ method: "POST", url: "/organization-units", headers: authHeader(adminToken), payload: { legalEntityId, name: "Site A 1C4", unitType: "Site", parentId: null } })
    ).json().id;
    customerAId = (
      await app.inject({ method: "POST", url: "/customers", headers: authHeader(adminToken), payload: { code: "CUST-1C4-A", name: "Customer 1C4 A", ownerOrganizationUnitId: siteId } })
    ).json().id;

    await createReadOnlyRole(tenantId, "HANDLER_1C4", ["complaint.read", "complaint.manage", "workflow.instance.act", "customer.read"]);
    await createReadOnlyRole(tenantId, "MANAGER_1C4", ["complaint.read", "complaint.manage", "workflow.instance.act", "customer.read"]);
    await createReadOnlyRole(tenantId, "CUSTOMER_A_1C4", ["customer.read", "complaint.read", "complaint.manage", "workflow.instance.start", "workflow.instance.act"]);

    const createUser = (payload: Record<string, unknown>) =>
      app.inject({ method: "POST", url: "/users", headers: authHeader(adminToken), payload });
    await createUser({ email: "handler@test1c4.local", fullName: "Handler", password: "Handler12345!", roleCode: "HANDLER_1C4", scopeType: "organization_unit", scopeOrganizationUnitId: siteId });
    await createUser({ email: "manager@test1c4.local", fullName: "Manager", password: "Manager12345!", roleCode: "MANAGER_1C4", scopeType: "tenant" });
    await createUser({ email: "user-a@test1c4.local", fullName: "Customer A User", password: "CustomerUser12345!", roleCode: "CUSTOMER_A_1C4", scopeType: "customer", scopeCustomerId: customerAId });

    handlerToken = (await login(app, TENANT_CODE, "handler@test1c4.local", "Handler12345!")).body.accessToken;
    managerToken = (await login(app, TENANT_CODE, "manager@test1c4.local", "Manager12345!")).body.accessToken;
    customerUserAToken = (await login(app, TENANT_CODE, "user-a@test1c4.local", "CustomerUser12345!")).body.accessToken;

    await app.inject({ method: "POST", url: "/config/numbering/complaint_number", headers: authHeader(adminToken), payload: { pattern: "CMP-1C4-{SEQ:5}" } });
    await addWorkflow();

    const otherTenant = await bootstrapTenant(app, OTHER_TENANT_CODE, "Other 1C4");

    await activateAllModules(otherTenant.id);
    otherTenantId = otherTenant.id;
    await provisionFirstAdmin({ tenantId: otherTenantId, email: "admin@other1c4.local", password: "Admin12345!" });
    otherAdminToken = (await login(app, OTHER_TENANT_CODE, "admin@other1c4.local", "Admin12345!")).body.accessToken;
  });

  afterAll(async () => {
    await pool.query(`DELETE FROM tenants WHERE id = ANY($1)`, [[tenantId, otherTenantId]]);
    await app.close();
  });

  let complaintId: string;

  async function driveToVerification() {
    const id = (
      await app.inject({
        method: "POST",
        url: "/complaints",
        headers: authHeader(customerUserAToken),
        payload: { customerId: customerAId, category: "service_quality", description: "QA test", priority: "high", severity: "major" },
      })
    ).json().id as string;
    await app.inject({ method: "POST", url: `/complaints/${id}/submit`, headers: authHeader(customerUserAToken), payload: {} });
    for (const action of ["acknowledge", "assign", "start_investigation"]) {
      await app.inject({ method: "POST", url: `/complaints/${id}/actions/${action}`, headers: authHeader(handlerToken), payload: {} });
    }
    await app.inject({
      method: "POST",
      url: `/complaints/${id}/investigation`,
      headers: authHeader(handlerToken),
      payload: { rootCause: "Root", correctiveAction: "Fix", preventiveAction: "Prevent" },
    });
    await app.inject({ method: "POST", url: `/complaints/${id}/actions/submit_corrective_action`, headers: authHeader(handlerToken), payload: {} });
    await app.inject({ method: "POST", url: `/complaints/${id}/actions/submit_for_verification`, headers: authHeader(handlerToken), payload: {} });
    return id;
  }

  it("Verification queue: the eligible verifier sees the complaint via stepCode=VERIFICATION", async () => {
    complaintId = await driveToVerification();
    const res = await app.inject({
      method: "GET",
      url: "/complaints/queue?stepCode=VERIFICATION&assignedToMe=true",
      headers: authHeader(managerToken),
    });
    expect(res.statusCode).toBe(200);
    const row = res.json().items.find((i: { complaint: { id: string } }) => i.complaint.id === complaintId);
    expect(row).toBeTruthy();
    expect(row.status.stepCode).toBe("VERIFICATION");
    expect(row.assignment.isMine).toBe(true);
  });

  it("Verification detail: verifier gets the `verify` action and can see the investigation result", async () => {
    const res = await app.inject({ method: "GET", url: `/complaints/${complaintId}/operational-detail`, headers: authHeader(managerToken) });
    expect(res.statusCode).toBe(200);
    const d = res.json();
    expect(d.availableActions.map((a: { actionCode: string }) => a.actionCode)).toContain("verify");
    expect(d.complaint.rootCause).toBe("Root");
    expect(d.complaint.correctiveAction).toBe("Fix");
  });

  it("Non-verifier handler is NOT offered the verify action and cannot execute it", async () => {
    const detail = await app.inject({ method: "GET", url: `/complaints/${complaintId}/operational-detail`, headers: authHeader(handlerToken) });
    expect(detail.statusCode).toBe(200);
    expect(detail.json().availableActions.map((a: { actionCode: string }) => a.actionCode)).not.toContain("verify");

    const denied = await app.inject({ method: "POST", url: `/complaints/${complaintId}/actions/verify`, headers: authHeader(handlerToken), payload: {} });
    expect(denied.statusCode).toBe(403);
  });

  it("Customer is denied the operational/verification detail (no internal QA leak)", async () => {
    const res = await app.inject({ method: "GET", url: `/complaints/${complaintId}/operational-detail`, headers: authHeader(customerUserAToken) });
    expect(res.statusCode).toBe(403);
  });

  it("Cross-tenant: another tenant's admin cannot read the verification detail", async () => {
    const res = await app.inject({ method: "GET", url: `/complaints/${complaintId}/operational-detail`, headers: authHeader(otherAdminToken) });
    expect(res.statusCode).toBe(404);
  });

  it("Independent verification: verifier records the note and approves; workflow advances", async () => {
    const note = await app.inject({
      method: "POST",
      url: `/complaints/${complaintId}/verification`,
      headers: authHeader(managerToken),
      payload: { note: "Verified independently — corrective action effective" },
    });
    expect(note.statusCode).toBe(200);
    expect(note.json().verificationNote).toBe("Verified independently — corrective action effective");

    const verify = await app.inject({ method: "POST", url: `/complaints/${complaintId}/actions/verify`, headers: authHeader(managerToken), payload: {} });
    expect(verify.statusCode).toBe(200);

    const after = await app.inject({ method: "GET", url: `/complaints/${complaintId}/operational-detail`, headers: authHeader(managerToken) });
    expect(after.json().status.stepCode).toBe("CUSTOMER_CONFIRMATION");
  });

  it("Customer regression: the customer-safe detail still hides internal actor/comment on their own complaint", async () => {
    const res = await app.inject({ method: "GET", url: `/complaints/${complaintId}/detail`, headers: authHeader(customerUserAToken) });
    expect(res.statusCode).toBe(200);
    for (const entry of res.json().timeline) {
      expect(entry).not.toHaveProperty("actorUserId");
      expect(entry).not.toHaveProperty("comment");
    }
  });
});
