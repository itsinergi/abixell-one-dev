import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../../src/app.js";
import { pool } from "../../src/infrastructure/persistence/db.js";
import { activateAllModules, authHeader, bootstrapTenant, createReadOnlyRole, login, provisionFirstAdmin } from "./helpers.js";

/**
 * Checkpoint 1C.3 — Operational / Supervisor Experience (backend read/
 * authorization surface). Proves the additive, generic operational
 * capabilities:
 *  - GET /complaints/queue (internal-only, scope-filtered, enriched)
 *  - GET /complaints/:id/operational-detail (internal-only, role-appropriate
 *     timeline that DOES retain actor + comments)
 * plus the security guarantees: a Customer User cannot reach either
 * operational endpoint (no internal-data leak), and cross-tenant access is
 * denied. Investigation/actions reuse the existing 1B endpoints.
 */

const TENANT_CODE = `test-1c3-${Date.now()}`;
const OTHER_TENANT_CODE = `test-1c3-other-${Date.now()}`;
const WORKFLOW_CODE = "complaint_lifecycle";

describe("Checkpoint 1C.3 — Operational / Supervisor Experience", () => {
  const app = buildApp();
  let tenantId: string;
  let otherTenantId: string;
  let adminToken: string;
  let otherAdminToken: string;
  let siteId: string;
  let customerAId: string;
  let customerBId: string;
  let customerUserAToken: string;
  let handlerToken: string;
  let managerToken: string;
  let noPermInternalToken: string;

  async function addWorkflow() {
    await app.inject({
      method: "POST",
      url: "/workflow/definitions",
      headers: authHeader(adminToken),
      payload: { code: WORKFLOW_CODE, name: "Lifecycle 1C3", entityType: "complaint", description: "1C3" },
    });
    const addStep = (body: Record<string, unknown>) =>
      app.inject({ method: "POST", url: `/workflow/definitions/${WORKFLOW_CODE}/versions/1/steps`, headers: authHeader(adminToken), payload: body });
    await addStep({ code: "DRAFT", name: "Draft", stepType: "task", isInitial: true });
    await addStep({ code: "SUBMITTED", name: "Submitted", stepType: "task", slaHours: 4 });
    await addStep({ code: "ACKNOWLEDGED", name: "Acknowledged", stepType: "task" });
    await addStep({ code: "IN_INVESTIGATION", name: "In Investigation", stepType: "task", slaHours: 48 });
    await addStep({ code: "CLOSED", name: "Closed", stepType: "end", isTerminal: true, terminalStatus: "approved" });
    const addTransition = (body: Record<string, unknown>) =>
      app.inject({ method: "POST", url: `/workflow/definitions/${WORKFLOW_CODE}/versions/1/transitions`, headers: authHeader(adminToken), payload: body });
    await addTransition({ fromStepCode: "DRAFT", toStepCode: "SUBMITTED", actionCode: "submit", name: "Submit" });
    await addTransition({ fromStepCode: "SUBMITTED", toStepCode: "ACKNOWLEDGED", actionCode: "acknowledge", name: "Acknowledge" });
    await addTransition({ fromStepCode: "ACKNOWLEDGED", toStepCode: "IN_INVESTIGATION", actionCode: "start_investigation", name: "Start Investigation" });
    await addTransition({ fromStepCode: "IN_INVESTIGATION", toStepCode: "CLOSED", actionCode: "close", name: "Close" });
    const addRule = (body: Record<string, unknown>) =>
      app.inject({ method: "POST", url: `/workflow/definitions/${WORKFLOW_CODE}/versions/1/assignment-rules`, headers: authHeader(adminToken), payload: body });
    await addRule({ stepCode: "DRAFT", assignmentType: "specific_user", specificUserSource: "submitter" });
    await addRule({ stepCode: "SUBMITTED", assignmentType: "role", roleCode: "HANDLER_1C3", organizationUnitStrategy: "submitter_unit" });
    await addRule({ stepCode: "ACKNOWLEDGED", assignmentType: "role", roleCode: "HANDLER_1C3", organizationUnitStrategy: "submitter_unit" });
    await addRule({ stepCode: "IN_INVESTIGATION", assignmentType: "role", roleCode: "HANDLER_1C3", organizationUnitStrategy: "submitter_unit" });
    await app.inject({ method: "POST", url: `/workflow/definitions/${WORKFLOW_CODE}/versions/1/publish`, headers: authHeader(adminToken) });
  }

  beforeAll(async () => {
    const tenant = await bootstrapTenant(app, TENANT_CODE, "Tenant 1C3");
    tenantId = tenant.id;
    await activateAllModules(tenantId);
    await provisionFirstAdmin({ tenantId, email: "admin@test1c3.local", password: "Admin12345!" });
    adminToken = (await login(app, TENANT_CODE, "admin@test1c3.local", "Admin12345!")).body.accessToken;

    const legalEntityId = (
      await app.inject({ method: "POST", url: "/legal-entities", headers: authHeader(adminToken), payload: { name: "LE 1C3" } })
    ).json().id;
    siteId = (
      await app.inject({ method: "POST", url: "/organization-units", headers: authHeader(adminToken), payload: { legalEntityId, name: "Site A 1C3", unitType: "Site", parentId: null } })
    ).json().id;
    customerAId = (
      await app.inject({ method: "POST", url: "/customers", headers: authHeader(adminToken), payload: { code: "CUST-1C3-A", name: "Customer 1C3 A", ownerOrganizationUnitId: siteId } })
    ).json().id;
    customerBId = (
      await app.inject({ method: "POST", url: "/customers", headers: authHeader(adminToken), payload: { code: "CUST-1C3-B", name: "Customer 1C3 B", ownerOrganizationUnitId: siteId } })
    ).json().id;

    await createReadOnlyRole(tenantId, "HANDLER_1C3", ["complaint.read", "complaint.manage", "workflow.instance.act", "customer.read"]);
    await createReadOnlyRole(tenantId, "MANAGER_1C3", ["complaint.read", "complaint.manage", "workflow.instance.act", "customer.read"]);
    await createReadOnlyRole(tenantId, "CUSTOMER_A_1C3", ["customer.read", "complaint.read", "complaint.manage", "workflow.instance.start", "workflow.instance.act"]);
    await createReadOnlyRole(tenantId, "NOPERM_INTERNAL_1C3", ["customer.read"]);

    const createUser = (payload: Record<string, unknown>) =>
      app.inject({ method: "POST", url: "/users", headers: authHeader(adminToken), payload });
    await createUser({ email: "handler@test1c3.local", fullName: "Handler", password: "Handler12345!", roleCode: "HANDLER_1C3", scopeType: "organization_unit", scopeOrganizationUnitId: siteId });
    await createUser({ email: "manager@test1c3.local", fullName: "Manager", password: "Manager12345!", roleCode: "MANAGER_1C3", scopeType: "tenant" });
    await createUser({ email: "user-a@test1c3.local", fullName: "Customer A User", password: "CustomerUser12345!", roleCode: "CUSTOMER_A_1C3", scopeType: "customer", scopeCustomerId: customerAId });
    await createUser({ email: "noperm@test1c3.local", fullName: "No Perm Internal", password: "NoPerm12345!", roleCode: "NOPERM_INTERNAL_1C3", scopeType: "organization_unit", scopeOrganizationUnitId: siteId });

    handlerToken = (await login(app, TENANT_CODE, "handler@test1c3.local", "Handler12345!")).body.accessToken;
    managerToken = (await login(app, TENANT_CODE, "manager@test1c3.local", "Manager12345!")).body.accessToken;
    customerUserAToken = (await login(app, TENANT_CODE, "user-a@test1c3.local", "CustomerUser12345!")).body.accessToken;
    noPermInternalToken = (await login(app, TENANT_CODE, "noperm@test1c3.local", "NoPerm12345!")).body.accessToken;

    await app.inject({ method: "POST", url: "/config/numbering/complaint_number", headers: authHeader(adminToken), payload: { pattern: "CMP-1C3-{SEQ:5}" } });
    await addWorkflow();

    const otherTenant = await bootstrapTenant(app, OTHER_TENANT_CODE, "Other 1C3");

    await activateAllModules(otherTenant.id);
    otherTenantId = otherTenant.id;
    await provisionFirstAdmin({ tenantId: otherTenantId, email: "admin@other1c3.local", password: "Admin12345!" });
    otherAdminToken = (await login(app, OTHER_TENANT_CODE, "admin@other1c3.local", "Admin12345!")).body.accessToken;
  });

  afterAll(async () => {
    await pool.query(`DELETE FROM tenants WHERE id = ANY($1)`, [[tenantId, otherTenantId]]);
    await app.close();
  });

  let complaintId: string;

  async function createAndSubmit(customerId = customerAId) {
    const create = await app.inject({
      method: "POST",
      url: "/complaints",
      headers: authHeader(adminToken),
      payload: { customerId, category: "service_quality", description: "Op test", priority: "high", severity: "major" },
    });
    const id = create.json().id as string;
    await app.inject({ method: "POST", url: `/complaints/${id}/submit`, headers: authHeader(adminToken), payload: {} });
    return id;
  }

  it("Queue: an internal handler sees in-scope complaints enriched with status/SLA/assignment", async () => {
    complaintId = await createAndSubmit();
    const res = await app.inject({ method: "GET", url: "/complaints/queue", headers: authHeader(handlerToken) });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(Array.isArray(body.items)).toBe(true);
    const row = body.items.find((i: { complaint: { id: string } }) => i.complaint.id === complaintId);
    expect(row).toBeTruthy();
    expect(row.status.stepCode).toBe("SUBMITTED");
    expect(row.customerName).toBe("Customer 1C3 A");
    // The pending SUBMITTED task is the handler's role+scope → isMine.
    expect(row.assignment.isMine).toBe(true);
  });

  it("Queue: assignedToMe filter returns the handler's actionable complaints", async () => {
    const res = await app.inject({ method: "GET", url: "/complaints/queue?assignedToMe=true", headers: authHeader(handlerToken) });
    expect(res.statusCode).toBe(200);
    expect(res.json().items.some((i: { complaint: { id: string } }) => i.complaint.id === complaintId)).toBe(true);
  });

  it("Queue: filters by customer after batched scoped loading", async () => {
    const otherComplaintId = await createAndSubmit(customerBId);
    const res = await app.inject({
      method: "GET",
      url: `/complaints/queue?customerId=${customerBId}`,
      headers: authHeader(handlerToken),
    });
    expect(res.statusCode).toBe(200);
    const ids = res.json().items.map((i: { complaint: { id: string } }) => i.complaint.id);
    expect(ids).toContain(otherComplaintId);
    expect(ids).not.toContain(complaintId);
  });

  it("Queue: a Customer User is denied (operational area is internal-only)", async () => {
    const res = await app.inject({ method: "GET", url: "/complaints/queue", headers: authHeader(customerUserAToken) });
    expect(res.statusCode).toBe(403);
  });

  it("Operational detail: internal handler gets a role-appropriate timeline (actor + comment retained) and eligible actions", async () => {
    const res = await app.inject({ method: "GET", url: `/complaints/${complaintId}/operational-detail`, headers: authHeader(handlerToken) });
    expect(res.statusCode).toBe(200);
    const d = res.json();
    expect(d.status.stepCode).toBe("SUBMITTED");
    expect(d.availableActions.map((a: { actionCode: string }) => a.actionCode)).toContain("acknowledge");
    expect(d.timeline.length).toBeGreaterThanOrEqual(1);
    // Operational timeline intentionally exposes actor/comment fields.
    expect(d.timeline[0]).toHaveProperty("actorUserId");
    expect(d.timeline[0]).toHaveProperty("comment");
  });

  it("Operational detail: a Customer User is denied even for their own complaint (no internal-data leak)", async () => {
    const res = await app.inject({ method: "GET", url: `/complaints/${complaintId}/operational-detail`, headers: authHeader(customerUserAToken) });
    expect(res.statusCode).toBe(403);
  });

  it("Operational detail: cross-tenant access is denied", async () => {
    const res = await app.inject({ method: "GET", url: `/complaints/${complaintId}/operational-detail`, headers: authHeader(otherAdminToken) });
    expect(res.statusCode).toBe(404);
  });

  it("Workflow action: eligible handler acknowledges; an ineligible internal user is denied", async () => {
    const ack = await app.inject({ method: "POST", url: `/complaints/${complaintId}/actions/acknowledge`, headers: authHeader(handlerToken), payload: {} });
    expect(ack.statusCode).toBe(200);
    // A different internal user without complaint.manage cannot act.
    const denied = await app.inject({ method: "POST", url: `/complaints/${complaintId}/actions/assign`, headers: authHeader(noPermInternalToken), payload: {} });
    expect(denied.statusCode).toBe(403);
  });

  it("Investigation: authorized handler records it; an unauthorized internal user is denied", async () => {
    const ok = await app.inject({
      method: "POST",
      url: `/complaints/${complaintId}/investigation`,
      headers: authHeader(handlerToken),
      payload: { rootCause: "Root", correctiveAction: "Fix", preventiveAction: "Prevent" },
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().rootCause).toBe("Root");

    const denied = await app.inject({
      method: "POST",
      url: `/complaints/${complaintId}/investigation`,
      headers: authHeader(noPermInternalToken),
      payload: { rootCause: "x" },
    });
    expect(denied.statusCode).toBe(403);
  });

  it("Evidence: internal handler can attach/list evidence on an in-scope complaint", async () => {
    const boundary = "----vitest1c3";
    const parts = [
      `--${boundary}\r\nContent-Disposition: form-data; name="entityType"\r\n\r\ncomplaint\r\n`,
      `--${boundary}\r\nContent-Disposition: form-data; name="entityId"\r\n\r\n${complaintId}\r\n`,
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="op.txt"\r\nContent-Type: text/plain\r\n\r\nInternal note\r\n`,
      `--${boundary}--\r\n`,
    ];
    const upload = await app.inject({
      method: "POST",
      url: "/documents",
      headers: { ...authHeader(handlerToken), "content-type": `multipart/form-data; boundary=${boundary}` },
      payload: Buffer.from(parts.join("")),
    });
    expect(upload.statusCode).toBe(201);
    const list = await app.inject({ method: "GET", url: `/documents?entityType=complaint&entityId=${complaintId}`, headers: authHeader(handlerToken) });
    expect(list.statusCode).toBe(200);
    expect(list.json().length).toBeGreaterThanOrEqual(1);
  });

  it("Customer regression: /me reports scope types, and a Customer User is scoped to 'customer' only", async () => {
    const me = await app.inject({ method: "GET", url: "/me", headers: authHeader(customerUserAToken) });
    expect(me.statusCode).toBe(200);
    expect(me.json().scopeTypes).toEqual(["customer"]);
  });
});
