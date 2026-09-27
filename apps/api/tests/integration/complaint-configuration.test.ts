import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../../src/app.js";
import { pool } from "../../src/infrastructure/persistence/db.js";
import { activateAllModules, authHeader, bootstrapTenant, createReadOnlyRole, login, provisionFirstAdmin } from "./helpers.js";

/**
 * Checkpoint 1C.6 — Complaint Administration & Configuration. Verifies the
 * complaint.configure permission gate, reference-data management (create +
 * activate/deactivate) reusing Configuration Core via audited trusted-caller
 * writes, the read-only composite (numbering/notification/workflow), tenant
 * isolation, and the downstream effect on the customer create-options.
 */

const TENANT_CODE = `test-1c6-${Date.now()}`;
const OTHER_TENANT_CODE = `test-1c6-other-${Date.now()}`;
const WF = "complaint_lifecycle";

describe("Checkpoint 1C.6 — Complaint Administration & Configuration", () => {
  const app = buildApp();
  let tenantId: string;
  let otherTenantId: string;
  let adminToken: string;
  let otherAdminToken: string;
  let handlerToken: string;
  let customerUserToken: string;

  beforeAll(async () => {
    const tenant = await bootstrapTenant(app, TENANT_CODE, "Tenant 1C6");
    tenantId = tenant.id;
    await activateAllModules(tenantId);
    await provisionFirstAdmin({ tenantId, email: "admin@test1c6.local", password: "Admin12345!" });
    adminToken = (await login(app, TENANT_CODE, "admin@test1c6.local", "Admin12345!")).body.accessToken;

    const legalEntityId = (await app.inject({ method: "POST", url: "/legal-entities", headers: authHeader(adminToken), payload: { name: "LE" } })).json().id;
    const siteId = (await app.inject({ method: "POST", url: "/organization-units", headers: authHeader(adminToken), payload: { legalEntityId, name: "Site A", unitType: "Site", parentId: null } })).json().id;
    const customerId = (await app.inject({ method: "POST", url: "/customers", headers: authHeader(adminToken), payload: { code: "CUST-A", name: "Customer A", ownerOrganizationUnitId: siteId } })).json().id;

    await createReadOnlyRole(tenantId, "HANDLER_1C6", ["complaint.read", "complaint.manage", "workflow.instance.act", "customer.read"]);
    await createReadOnlyRole(tenantId, "CUSTOMER_1C6", ["customer.read", "complaint.read", "complaint.manage", "workflow.instance.start", "workflow.instance.act"]);
    await app.inject({ method: "POST", url: "/users", headers: authHeader(adminToken), payload: { email: "handler@test1c6.local", fullName: "H", password: "Handler12345!", roleCode: "HANDLER_1C6", scopeType: "organization_unit", scopeOrganizationUnitId: siteId } });
    await app.inject({ method: "POST", url: "/users", headers: authHeader(adminToken), payload: { email: "user@test1c6.local", fullName: "U", password: "CustomerUser12345!", roleCode: "CUSTOMER_1C6", scopeType: "customer", scopeCustomerId: customerId } });
    handlerToken = (await login(app, TENANT_CODE, "handler@test1c6.local", "Handler12345!")).body.accessToken;
    customerUserToken = (await login(app, TENANT_CODE, "user@test1c6.local", "CustomerUser12345!")).body.accessToken;

    await app.inject({ method: "POST", url: "/config/numbering/complaint_number", headers: authHeader(adminToken), payload: { pattern: "CMP-1C6-{SEQ:5}" } });

    // Minimal published complaint_lifecycle so the config workflow view has steps.
    await app.inject({ method: "POST", url: "/workflow/definitions", headers: authHeader(adminToken), payload: { code: WF, name: "WF", entityType: "complaint", description: "d" } });
    const step = (b: Record<string, unknown>) => app.inject({ method: "POST", url: `/workflow/definitions/${WF}/versions/1/steps`, headers: authHeader(adminToken), payload: b });
    await step({ code: "DRAFT", name: "Draft", stepType: "task", isInitial: true });
    await step({ code: "SUBMITTED", name: "Submitted", stepType: "task", slaHours: 4 });
    await step({ code: "CLOSED", name: "Closed", stepType: "end", isTerminal: true, terminalStatus: "approved" });
    await app.inject({ method: "POST", url: `/workflow/definitions/${WF}/versions/1/transitions`, headers: authHeader(adminToken), payload: { fromStepCode: "DRAFT", toStepCode: "SUBMITTED", actionCode: "submit", name: "Submit" } });
    await app.inject({ method: "POST", url: `/workflow/definitions/${WF}/versions/1/transitions`, headers: authHeader(adminToken), payload: { fromStepCode: "SUBMITTED", toStepCode: "CLOSED", actionCode: "close", name: "Close" } });
    await app.inject({ method: "POST", url: `/workflow/definitions/${WF}/versions/1/assignment-rules`, headers: authHeader(adminToken), payload: { stepCode: "DRAFT", assignmentType: "specific_user", specificUserSource: "submitter" } });
    await app.inject({ method: "POST", url: `/workflow/definitions/${WF}/versions/1/assignment-rules`, headers: authHeader(adminToken), payload: { stepCode: "SUBMITTED", assignmentType: "role", roleCode: "HANDLER_1C6", organizationUnitStrategy: "submitter_unit" } });
    await app.inject({ method: "POST", url: `/workflow/definitions/${WF}/versions/1/publish`, headers: authHeader(adminToken) });

    const otherTenant = await bootstrapTenant(app, OTHER_TENANT_CODE, "Other 1C6");

    await activateAllModules(otherTenant.id);
    otherTenantId = otherTenant.id;
    await provisionFirstAdmin({ tenantId: otherTenantId, email: "admin@other1c6.local", password: "Admin12345!" });
    otherAdminToken = (await login(app, OTHER_TENANT_CODE, "admin@other1c6.local", "Admin12345!")).body.accessToken;
  });

  afterAll(async () => {
    await pool.query(`DELETE FROM tenants WHERE id = ANY($1)`, [[tenantId, otherTenantId]]);
    await app.close();
  });

  it("Permission: config surface requires complaint.configure", async () => {
    expect((await app.inject({ method: "GET", url: "/complaints/config", headers: authHeader(adminToken) })).statusCode).toBe(200);
    expect((await app.inject({ method: "GET", url: "/complaints/config", headers: authHeader(handlerToken) })).statusCode).toBe(403);
    expect((await app.inject({ method: "GET", url: "/complaints/config", headers: authHeader(customerUserToken) })).statusCode).toBe(403);
  });

  it("Composite: exposes reference data, numbering, and the read-only workflow view", async () => {
    const cfg = (await app.inject({ method: "GET", url: "/complaints/config", headers: authHeader(adminToken) })).json();
    expect(cfg.referenceData).toHaveProperty("categories");
    expect(cfg.referenceData).toHaveProperty("severities");
    expect(cfg.referenceData).toHaveProperty("priorities");
    expect(cfg.numbering.pattern).toBe("CMP-1C6-{SEQ:5}");
    expect(cfg.workflow.steps.length).toBe(3);
    expect(cfg.capabilities.referenceDataCreate).toBe(true);
    expect(cfg.capabilities.workflowEditable).toBe(false);
  });

  it("Reference data: create a category (audited) and it appears in config", async () => {
    const create = await app.inject({
      method: "POST",
      url: "/complaints/config/reference-data/complaint_category",
      headers: authHeader(adminToken),
      payload: { code: "billing", label: "Billing" },
    });
    expect(create.statusCode).toBe(201);
    const cfg = (await app.inject({ method: "GET", url: "/complaints/config", headers: authHeader(adminToken) })).json();
    expect(cfg.referenceData.categories.map((c: { code: string }) => c.code)).toContain("billing");

    const audit = await pool.query(
      `SELECT 1 FROM audit_log WHERE tenant_id = $1 AND action = 'config.reference_data_item.created' AND metadata->>'code' = 'billing'`,
      [tenantId],
    );
    expect(audit.rows.length).toBeGreaterThanOrEqual(1);
  });

  it("Reference data: a non-complaint catalog is rejected", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/complaints/config/reference-data/some_other_type",
      headers: authHeader(adminToken),
      payload: { code: "x", label: "X" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("Reference data: deactivate hides the item from the customer create options; reactivate restores it", async () => {
    await app.inject({ method: "POST", url: "/complaints/config/reference-data/complaint_severity", headers: authHeader(adminToken), payload: { code: "cosmetic", label: "Cosmetic" } });
    const cfg = (await app.inject({ method: "GET", url: "/complaints/config", headers: authHeader(adminToken) })).json();
    const item = cfg.referenceData.severities.find((s: { code: string }) => s.code === "cosmetic");
    expect(item.isActive).toBe(true);

    // Customer sees it while active.
    let opts = (await app.inject({ method: "GET", url: "/complaints/reference-data", headers: authHeader(customerUserToken) })).json();
    expect(opts.severities.map((s: { code: string }) => s.code)).toContain("cosmetic");

    // Deactivate (audited).
    const patch = await app.inject({
      method: "PATCH",
      url: `/complaints/config/reference-data/complaint_severity/${item.id}`,
      headers: authHeader(adminToken),
      payload: { isActive: false },
    });
    expect(patch.statusCode).toBe(200);
    expect(patch.json().isActive).toBe(false);

    opts = (await app.inject({ method: "GET", url: "/complaints/reference-data", headers: authHeader(customerUserToken) })).json();
    expect(opts.severities.map((s: { code: string }) => s.code)).not.toContain("cosmetic");

    const audit = await pool.query(
      `SELECT 1 FROM audit_log WHERE tenant_id = $1 AND action = 'config.reference_data_item.deactivated' AND metadata->>'code' = 'cosmetic'`,
      [tenantId],
    );
    expect(audit.rows.length).toBeGreaterThanOrEqual(1);

    // Reactivate restores it.
    await app.inject({ method: "PATCH", url: `/complaints/config/reference-data/complaint_severity/${item.id}`, headers: authHeader(adminToken), payload: { isActive: true } });
    opts = (await app.inject({ method: "GET", url: "/complaints/reference-data", headers: authHeader(customerUserToken) })).json();
    expect(opts.severities.map((s: { code: string }) => s.code)).toContain("cosmetic");
  });

  it("Mutation is denied without complaint.configure", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/complaints/config/reference-data/complaint_category",
      headers: authHeader(handlerToken),
      payload: { code: "nope", label: "Nope" },
    });
    expect(res.statusCode).toBe(403);
  });

  it("Tenant isolation: another tenant's config does not see this tenant's items", async () => {
    const cfg = (await app.inject({ method: "GET", url: "/complaints/config", headers: authHeader(otherAdminToken) })).json();
    expect(cfg.referenceData.categories.map((c: { code: string }) => c.code)).not.toContain("billing");
  });
});
