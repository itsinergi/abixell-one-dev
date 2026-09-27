import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../../src/app.js";
import { pool } from "../../src/infrastructure/persistence/db.js";
import { activateAllModules, authHeader, bootstrapTenant, createReadOnlyRole, login, provisionFirstAdmin } from "./helpers.js";

/**
 * Checkpoint 1C.5 — Management Dashboard & Action Center. Verifies the
 * permission gate (complaint.dashboard.read), Data-Scope-aware aggregation
 * (tenant + customer scope), KPI/breakdown correctness on a deterministic
 * dataset, and the Action Center attention rules — all via the real DB.
 */

const TENANT_CODE = `test-1c5-${Date.now()}`;
const OTHER_TENANT_CODE = `test-1c5-other-${Date.now()}`;
const WF = "complaint_lifecycle";

describe("Checkpoint 1C.5 — Management Dashboard", () => {
  const app = buildApp();
  let tenantId: string;
  let otherTenantId: string;
  let adminToken: string;
  let otherAdminToken: string;
  let siteAId: string;
  let siteBId: string;
  let customerAId: string;
  let customerBId: string;
  let customerUserAToken: string;
  let handlerToken: string;
  let managerTenantToken: string;
  let managerSiteAToken: string;

  async function buildWorkflow() {
    await app.inject({ method: "POST", url: "/workflow/definitions", headers: authHeader(adminToken), payload: { code: WF, name: "WF 1C5", entityType: "complaint", description: "1C5" } });
    const step = (b: Record<string, unknown>) => app.inject({ method: "POST", url: `/workflow/definitions/${WF}/versions/1/steps`, headers: authHeader(adminToken), payload: b });
    await step({ code: "DRAFT", name: "Draft", stepType: "task", isInitial: true });
    await step({ code: "SUBMITTED", name: "Submitted", stepType: "task", slaHours: 4 });
    await step({ code: "ACKNOWLEDGED", name: "Acknowledged", stepType: "task" });
    await step({ code: "ASSIGNED", name: "Assigned", stepType: "task" });
    await step({ code: "IN_INVESTIGATION", name: "In Investigation", stepType: "task", slaHours: 48 });
    await step({ code: "CORRECTIVE_ACTION", name: "Corrective Action", stepType: "task" });
    await step({ code: "VERIFICATION", name: "Verification", stepType: "approval" });
    await step({ code: "CUSTOMER_CONFIRMATION", name: "Customer Confirmation", stepType: "approval" });
    await step({ code: "CLOSED", name: "Closed", stepType: "end", isTerminal: true, terminalStatus: "approved" });
    const tr = (b: Record<string, unknown>) => app.inject({ method: "POST", url: `/workflow/definitions/${WF}/versions/1/transitions`, headers: authHeader(adminToken), payload: b });
    await tr({ fromStepCode: "DRAFT", toStepCode: "SUBMITTED", actionCode: "submit", name: "Submit" });
    await tr({ fromStepCode: "SUBMITTED", toStepCode: "ACKNOWLEDGED", actionCode: "acknowledge", name: "Acknowledge" });
    await tr({ fromStepCode: "ACKNOWLEDGED", toStepCode: "ASSIGNED", actionCode: "assign", name: "Assign" });
    await tr({ fromStepCode: "ASSIGNED", toStepCode: "IN_INVESTIGATION", actionCode: "start_investigation", name: "Start" });
    await tr({ fromStepCode: "IN_INVESTIGATION", toStepCode: "CORRECTIVE_ACTION", actionCode: "submit_corrective_action", name: "SCA" });
    await tr({ fromStepCode: "CORRECTIVE_ACTION", toStepCode: "VERIFICATION", actionCode: "submit_for_verification", name: "SFV" });
    await tr({ fromStepCode: "VERIFICATION", toStepCode: "CUSTOMER_CONFIRMATION", actionCode: "verify", name: "Verify" });
    await tr({ fromStepCode: "CUSTOMER_CONFIRMATION", toStepCode: "CLOSED", actionCode: "confirm", name: "Confirm" });
    const rule = (b: Record<string, unknown>) => app.inject({ method: "POST", url: `/workflow/definitions/${WF}/versions/1/assignment-rules`, headers: authHeader(adminToken), payload: b });
    await rule({ stepCode: "DRAFT", assignmentType: "specific_user", specificUserSource: "submitter" });
    await rule({ stepCode: "SUBMITTED", assignmentType: "role", roleCode: "HANDLER_1C5", organizationUnitStrategy: "submitter_unit" });
    await rule({ stepCode: "ACKNOWLEDGED", assignmentType: "role", roleCode: "HANDLER_1C5", organizationUnitStrategy: "submitter_unit" });
    await rule({ stepCode: "ASSIGNED", assignmentType: "role", roleCode: "HANDLER_1C5", organizationUnitStrategy: "submitter_unit" });
    await rule({ stepCode: "IN_INVESTIGATION", assignmentType: "role", roleCode: "HANDLER_1C5", organizationUnitStrategy: "submitter_unit" });
    await rule({ stepCode: "CORRECTIVE_ACTION", assignmentType: "role", roleCode: "HANDLER_1C5", organizationUnitStrategy: "submitter_unit" });
    await rule({ stepCode: "VERIFICATION", assignmentType: "role", roleCode: "MANAGER_T_1C5", organizationUnitStrategy: "tenant" });
    await rule({ stepCode: "CUSTOMER_CONFIRMATION", assignmentType: "specific_user", specificUserSource: "submitter" });
    await app.inject({ method: "POST", url: `/workflow/definitions/${WF}/versions/1/publish`, headers: authHeader(adminToken) });
  }

  async function createComplaint(tok: string, customerId: string, severity: string) {
    const r = await app.inject({ method: "POST", url: "/complaints", headers: authHeader(tok), payload: { customerId, category: "service_quality", description: "d", priority: "high", severity } });
    return r.json().id as string;
  }
  const actC = (tok: string, id: string, a: string) => app.inject({ method: "POST", url: `/complaints/${id}/actions/${a}`, headers: authHeader(tok), payload: {} });

  beforeAll(async () => {
    const tenant = await bootstrapTenant(app, TENANT_CODE, "Tenant 1C5");
    tenantId = tenant.id;
    await activateAllModules(tenantId);
    await provisionFirstAdmin({ tenantId, email: "admin@test1c5.local", password: "Admin12345!" });
    adminToken = (await login(app, TENANT_CODE, "admin@test1c5.local", "Admin12345!")).body.accessToken;

    const legalEntityId = (await app.inject({ method: "POST", url: "/legal-entities", headers: authHeader(adminToken), payload: { name: "LE" } })).json().id;
    siteAId = (await app.inject({ method: "POST", url: "/organization-units", headers: authHeader(adminToken), payload: { legalEntityId, name: "Site A", unitType: "Site", parentId: null } })).json().id;
    siteBId = (await app.inject({ method: "POST", url: "/organization-units", headers: authHeader(adminToken), payload: { legalEntityId, name: "Site B", unitType: "Site", parentId: null } })).json().id;
    customerAId = (await app.inject({ method: "POST", url: "/customers", headers: authHeader(adminToken), payload: { code: "CUST-A", name: "Customer A", ownerOrganizationUnitId: siteAId } })).json().id;
    customerBId = (await app.inject({ method: "POST", url: "/customers", headers: authHeader(adminToken), payload: { code: "CUST-B", name: "Customer B", ownerOrganizationUnitId: siteBId } })).json().id;

    await createReadOnlyRole(tenantId, "HANDLER_1C5", ["complaint.read", "complaint.manage", "workflow.instance.act", "customer.read"]);
    await createReadOnlyRole(tenantId, "MANAGER_T_1C5", ["complaint.read", "complaint.manage", "workflow.instance.act", "customer.read", "complaint.dashboard.read"]);
    await createReadOnlyRole(tenantId, "MANAGER_SITEA_1C5", ["complaint.read", "complaint.manage", "workflow.instance.act", "customer.read", "complaint.dashboard.read"]);
    await createReadOnlyRole(tenantId, "CUSTOMER_A_1C5", ["customer.read", "complaint.read", "complaint.manage", "workflow.instance.start", "workflow.instance.act"]);

    const mk = (p: Record<string, unknown>) => app.inject({ method: "POST", url: "/users", headers: authHeader(adminToken), payload: p });
    await mk({ email: "handler@test1c5.local", fullName: "H", password: "Handler12345!", roleCode: "HANDLER_1C5", scopeType: "organization_unit", scopeOrganizationUnitId: siteAId });
    await mk({ email: "mgrt@test1c5.local", fullName: "MT", password: "Manager12345!", roleCode: "MANAGER_T_1C5", scopeType: "tenant" });
    await mk({ email: "mgra@test1c5.local", fullName: "MA", password: "Manager12345!", roleCode: "MANAGER_SITEA_1C5", scopeType: "organization_unit", scopeOrganizationUnitId: siteAId });
    await mk({ email: "usera@test1c5.local", fullName: "UA", password: "CustomerUser12345!", roleCode: "CUSTOMER_A_1C5", scopeType: "customer", scopeCustomerId: customerAId });

    handlerToken = (await login(app, TENANT_CODE, "handler@test1c5.local", "Handler12345!")).body.accessToken;
    managerTenantToken = (await login(app, TENANT_CODE, "mgrt@test1c5.local", "Manager12345!")).body.accessToken;
    managerSiteAToken = (await login(app, TENANT_CODE, "mgra@test1c5.local", "Manager12345!")).body.accessToken;
    customerUserAToken = (await login(app, TENANT_CODE, "usera@test1c5.local", "CustomerUser12345!")).body.accessToken;

    await app.inject({ method: "POST", url: "/config/numbering/complaint_number", headers: authHeader(adminToken), payload: { pattern: "CMP-1C5-{SEQ:5}" } });
    await buildWorkflow();

    // Deterministic dataset (all created "now", within the default 30-day period).
    // c1: open + critical (customer A). c2: open + overdue (customer A).
    // c3: closed (customer A). c4: open (customer B).
    const c1 = await createComplaint(customerUserAToken, customerAId, "critical");
    await actC(customerUserAToken, c1, "submit");

    const c2 = await createComplaint(customerUserAToken, customerAId, "major");
    const c2wf = (await app.inject({ method: "GET", url: `/complaints/${c2}`, headers: authHeader(customerUserAToken) })).json().complaint.workflowInstanceId;
    await actC(customerUserAToken, c2, "submit");
    await actC(handlerToken, c2, "acknowledge");
    await actC(handlerToken, c2, "assign");
    await actC(handlerToken, c2, "start_investigation");
    await pool.query(`UPDATE workflow_instance_assignments SET due_at = now() - interval '1 hour' WHERE workflow_instance_id = $1 AND status = 'pending'`, [c2wf]);

    const c3 = await createComplaint(customerUserAToken, customerAId, "minor");
    await actC(customerUserAToken, c3, "submit");
    await actC(handlerToken, c3, "acknowledge");
    await actC(handlerToken, c3, "assign");
    await actC(handlerToken, c3, "start_investigation");
    await actC(handlerToken, c3, "submit_corrective_action");
    await actC(handlerToken, c3, "submit_for_verification");
    await actC(managerTenantToken, c3, "verify");
    await actC(customerUserAToken, c3, "confirm");

    const c4 = await createComplaint(adminToken, customerBId, "major");
    await actC(adminToken, c4, "submit");

    const otherTenant = await bootstrapTenant(app, OTHER_TENANT_CODE, "Other 1C5");

    await activateAllModules(otherTenant.id);
    otherTenantId = otherTenant.id;
    await provisionFirstAdmin({ tenantId: otherTenantId, email: "admin@other1c5.local", password: "Admin12345!" });
    otherAdminToken = (await login(app, OTHER_TENANT_CODE, "admin@other1c5.local", "Admin12345!")).body.accessToken;
  });

  afterAll(async () => {
    await pool.query(`DELETE FROM tenants WHERE id = ANY($1)`, [[tenantId, otherTenantId]]);
    await app.close();
  });

  it("Permission: dashboard requires complaint.dashboard.read", async () => {
    expect((await app.inject({ method: "GET", url: "/complaints/dashboard", headers: authHeader(handlerToken) })).statusCode).toBe(403);
    expect((await app.inject({ method: "GET", url: "/complaints/dashboard", headers: authHeader(customerUserAToken) })).statusCode).toBe(403);
    expect((await app.inject({ method: "GET", url: "/complaints/dashboard", headers: authHeader(managerTenantToken) })).statusCode).toBe(200);
  });

  it("KPI: tenant-scoped manager sees correct aggregate counts", async () => {
    const d = (await app.inject({ method: "GET", url: "/complaints/dashboard", headers: authHeader(managerTenantToken) })).json();
    expect(d.summary.total).toBe(4);
    expect(d.summary.open).toBe(3);
    expect(d.summary.closed).toBe(1);
    expect(d.summary.critical).toBe(1);
    expect(d.summary.slaOverdue).toBe(1);
    expect(d.summary.resolutionRatePercent).toBe(25);
    expect(d.summary.avgResolutionHours).not.toBeNull();
  });

  it("Breakdowns: by customer and severity aggregate correctly", async () => {
    const d = (await app.inject({ method: "GET", url: "/complaints/dashboard", headers: authHeader(managerTenantToken) })).json();
    const byCust = Object.fromEntries(d.breakdowns.byCustomer.map((r: { label: string; count: number }) => [r.label, r.count]));
    expect(byCust["Customer A"]).toBe(3);
    expect(byCust["Customer B"]).toBe(1);
    const bySev = Object.fromEntries(d.breakdowns.bySeverity.map((r: { label: string; count: number }) => [r.label, r.count]));
    expect(bySev["critical"]).toBe(1);
    expect(bySev["major"]).toBe(2);
    expect(bySev["minor"]).toBe(1);
    expect(d.breakdowns.byStatus.length).toBeGreaterThanOrEqual(1);
  });

  it("Action Center: overdue + critical open complaints surface", async () => {
    const d = (await app.inject({ method: "GET", url: "/complaints/dashboard", headers: authHeader(managerTenantToken) })).json();
    const overdue = d.actionCenter.some((i: { overdue: boolean }) => i.overdue);
    const critical = d.actionCenter.some((i: { critical: boolean }) => i.critical);
    expect(overdue).toBe(true);
    expect(critical).toBe(true);
    // Every action-center item carries a valid complaint id for drill-down.
    expect(d.actionCenter.every((i: { complaintId: string }) => typeof i.complaintId === "string")).toBe(true);
  });

  it("Data Scope: a Site-A-scoped manager only aggregates Customer A", async () => {
    const d = (await app.inject({ method: "GET", url: "/complaints/dashboard", headers: authHeader(managerSiteAToken) })).json();
    expect(d.summary.total).toBe(3); // c1,c2,c3 (Customer A); NOT c4 (Customer B)
    const labels = d.breakdowns.byCustomer.map((r: { label: string }) => r.label);
    expect(labels).toContain("Customer A");
    expect(labels).not.toContain("Customer B");
  });

  it("Cross-tenant: another tenant's dashboard does not count this tenant's complaints", async () => {
    const d = (await app.inject({ method: "GET", url: "/complaints/dashboard", headers: authHeader(otherAdminToken) })).json();
    expect(d.summary.total).toBe(0);
    expect(d.actionCenter).toHaveLength(0);
  });

  it("Filter: severity=critical narrows the aggregate", async () => {
    const d = (await app.inject({ method: "GET", url: "/complaints/dashboard?severity=critical", headers: authHeader(managerTenantToken) })).json();
    expect(d.summary.total).toBe(1);
    expect(d.summary.critical).toBe(1);
  });
});
