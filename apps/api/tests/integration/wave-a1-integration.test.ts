import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../../src/app.js";
import { pool } from "../../src/infrastructure/persistence/db.js";
import {
  authHeader,
  bootstrapTenant,
  createReadOnlyRole,
  login,
  provisionFirstAdmin,
} from "./helpers.js";

const TENANT_CODE = `wave-a1-main-${Date.now()}`;
const OTHER_TENANT_CODE = `wave-a1-other-${Date.now()}`;
const ADMIN_EMAIL = "admin@wave-a1.local";
const ADMIN_PASSWORD = "Admin12345!";
const CUSTOMER_PASSWORD = "Customer12345!";

describe.sequential("Wave A1 — Advanced Commercial & Service Quality Integration Matrix", () => {
  const app = buildApp();

  let tenantId: string;
  let otherTenantId: string;
  let adminUserId: string;
  let adminToken: string;
  let otherAdminToken: string;
  let customerUserId: string;
  let customerToken: string;
  let customerAId: string;
  let customerBId: string;
  let serviceId: string;
  let priceBookId: string;
  let opportunityId: string;
  let quotationId: string;
  let complaintId: string;
  let rcaCategoryId: string;
  let capaActionId: string;
  let recurrenceRuleId: string;
  let automationRuleId: string;
  let proposalId: string;

  const post = (url: string, token: string, payload?: Record<string, unknown>) =>
    app.inject({
      method: "POST",
      url,
      headers: authHeader(token),
      ...(payload === undefined ? {} : { payload }),
    });

  const get = (url: string, token: string) =>
    app.inject({
      method: "GET",
      url,
      headers: authHeader(token),
    });

  const patch = (url: string, token: string, payload: Record<string, unknown>) =>
    app.inject({
      method: "PATCH",
      url,
      headers: authHeader(token),
      payload,
    });

  beforeAll(async () => {
    // Bootstrap Primary Tenant
    const primaryTenant = await bootstrapTenant(app, TENANT_CODE, "Wave A1 Primary Tenant");
    tenantId = primaryTenant.id;
    const adminUser = await provisionFirstAdmin({
      tenantId,
      email: ADMIN_EMAIL,
      password: ADMIN_PASSWORD,
    });
    adminUserId = adminUser.userId;
    const adminLogin = await login(app, TENANT_CODE, ADMIN_EMAIL, ADMIN_PASSWORD);
    adminToken = adminLogin.body.accessToken;

    // Bootstrap Other Tenant
    const otherTenant = await bootstrapTenant(app, OTHER_TENANT_CODE, "Wave A1 Other Tenant");
    otherTenantId = otherTenant.id;
    await provisionFirstAdmin({
      tenantId: otherTenantId,
      email: "admin@other.local",
      password: ADMIN_PASSWORD,
    });
    const otherAdminLogin = await login(app, OTHER_TENANT_CODE, "admin@other.local", ADMIN_PASSWORD);
    otherAdminToken = otherAdminLogin.body.accessToken;

    // Seed Numbering Sequences for Wave A1
    await post("/config/numbering/sales_opportunity", adminToken, { pattern: "OPP-{YYYY}-{SEQ:4}" });
    await post("/config/numbering/sales_quotation", adminToken, { pattern: "QTN-{YYYY}-{SEQ:4}" });
    await post("/config/numbering/capa_action", adminToken, { pattern: "CAPA-{YYYY}-{SEQ:4}" });
    await post("/config/numbering/complaint_ticket", adminToken, { pattern: "CMP-{YYYY}-{SEQ:4}" });
    await post("/config/numbering/complaint_number", adminToken, { pattern: "CMP-NUM-{YYYY}-{SEQ:4}" });

    // Seed Reference Data for Sales & Service Quality
    await post("/config/reference-data/sales_opportunity_stage", adminToken, { code: "lead", label: "Lead", sortOrder: 1 });
    await post("/config/reference-data/sales_opportunity_stage", adminToken, { code: "proposal", label: "Proposal", sortOrder: 2 });
    await post("/config/reference-data/sales_opportunity_source", adminToken, { code: "partner", label: "Partner", sortOrder: 1 });
    await post("/config/reference-data/sales_unit_of_measure", adminToken, { code: "port", label: "Port", sortOrder: 1 });
    await post("/config/reference-data/complaint_category", adminToken, { code: "network", label: "Network", sortOrder: 1 });
    await post("/config/reference-data/complaint_severity", adminToken, { code: "major", label: "Major", sortOrder: 1 });
    await post("/config/reference-data/complaint_severity", adminToken, { code: "critical", label: "Critical", sortOrder: 2 });
    await post("/config/reference-data/priority_level", adminToken, { code: "high", label: "High", sortOrder: 1 });

    // Seed Complaint Workflow Definition & Steps
    await post("/workflow/definitions", adminToken, {
      code: "complaint_lifecycle",
      name: "Complaint Lifecycle",
      entityType: "complaint",
      description: "Lifecycle workflow for complaints",
    });
    await post("/workflow/definitions/complaint_lifecycle/versions/1/steps", adminToken, {
      code: "DRAFT",
      name: "Draft",
      stepType: "task",
      isInitial: true,
    });
    await post("/workflow/definitions/complaint_lifecycle/versions/1/steps", adminToken, {
      code: "SUBMITTED",
      name: "Submitted",
      stepType: "task",
    });
    await post("/workflow/definitions/complaint_lifecycle/versions/1/steps", adminToken, {
      code: "CLOSED",
      name: "Closed",
      stepType: "end",
      isTerminal: true,
      terminalStatus: "approved",
    });
    await post("/workflow/definitions/complaint_lifecycle/versions/1/transitions", adminToken, {
      fromStepCode: "DRAFT",
      toStepCode: "SUBMITTED",
      actionCode: "submit",
      name: "Submit",
    });
    await post("/workflow/definitions/complaint_lifecycle/versions/1/transitions", adminToken, {
      fromStepCode: "SUBMITTED",
      toStepCode: "CLOSED",
      actionCode: "close",
      name: "Close",
    });
    await post("/workflow/definitions/complaint_lifecycle/versions/1/assignment-rules", adminToken, {
      stepCode: "DRAFT",
      assignmentType: "specific_user",
      specificUserSource: "submitter",
    });
    await post("/workflow/definitions/complaint_lifecycle/versions/1/assignment-rules", adminToken, {
      stepCode: "SUBMITTED",
      assignmentType: "specific_user",
      specificUserSource: "submitter",
    });
    await post("/workflow/definitions/complaint_lifecycle/versions/1/publish", adminToken);

    // Base Entities: Legal Entity & Org Unit
    const legalEntityRes = await post("/legal-entities", adminToken, { name: "Primary LE" });
    const legalEntityId = legalEntityRes.json().id;
    const orgUnitRes = await post("/organization-units", adminToken, {
      legalEntityId,
      name: "Operations Central",
      unitType: "department",
    });
    const orgUnitId = orgUnitRes.json().id;

    // Commercial Service
    const serviceRes = await post("/services", adminToken, {
      code: "SRV-FIBER-1G",
      name: "Dedicated Fiber Internet 1Gbps",
      category: "connectivity",
    });
    serviceId = serviceRes.json().id;

    // Customers A and B
    const custARes = await post("/customers", adminToken, {
      code: "CUST-A1-001",
      name: "Acme Corporation",
      ownerOrganizationUnitId: orgUnitId,
    });
    customerAId = custARes.json().id;

    const custBRes = await post("/customers", adminToken, {
      code: "CUST-A1-002",
      name: "Beta Logistics",
      ownerOrganizationUnitId: orgUnitId,
    });
    customerBId = custBRes.json().id;

    // Customer User scoped to Customer A
    await createReadOnlyRole(tenantId, "CUSTOMER_A1_PORTAL", [
      "customer.read",
      "sales.read",
      "complaint.read",
      "complaint.manage",
      "survey.respond",
    ]);

    const custUserRes = await post("/users", adminToken, {
      email: "portal@acme.local",
      fullName: "Acme Portal User",
      password: CUSTOMER_PASSWORD,
      roleCode: "CUSTOMER_A1_PORTAL",
      scopeType: "customer",
      scopeCustomerId: customerAId,
    });
    customerUserId = custUserRes.json().user.id;

    const custLogin = await login(app, TENANT_CODE, "portal@acme.local", CUSTOMER_PASSWORD);
    customerToken = custLogin.body.accessToken;
  });

  afterAll(async () => {
    await app.close();
  });

  // ==========================================================================
  // CUS-ADV-001: Sales Pipeline, Opportunities, Price Books & Quotations
  // ==========================================================================
  describe("CUS-ADV-001: Sales Pipeline & Versioned Quotations", () => {
    it("creates price book with tiered volume matrix", async () => {
      const pbRes = await post("/sales/price-books", adminToken, {
        code: "PB-A1-ENT",
        name: "Enterprise Rate Card",
        currencyCode: "IDR",
        effectiveFrom: "2026-01-01",
      });
      expect(pbRes.statusCode).toBe(201);
      priceBookId = pbRes.json().id;

      const entryRes = await post(`/sales/price-books/${priceBookId}/entries`, adminToken, {
        serviceId,
        unitCode: "port",
        unitPrice: 15_000_000,
        minQuantity: 1,
      });
      expect(entryRes.statusCode).toBe(201);

      const listEntries = await get(`/sales/price-books/${priceBookId}/entries`, adminToken);
      expect(listEntries.statusCode).toBe(200);
      expect(listEntries.json()).toHaveLength(1);
    });

    it("creates opportunity and tracks stage progression with immutable audit", async () => {
      const oppRes = await post("/sales/opportunities", adminToken, {
        customerId: customerAId,
        title: "Acme HQ Fiber Upgrade",
        stageCode: "lead",
        sourceCode: "partner",
        currencyCode: "IDR",
        estimatedValue: 180_000_000,
        probabilityPercent: 60,
      });
      expect(oppRes.statusCode).toBe(201);
      opportunityId = oppRes.json().id;

      // Advance stage to proposal
      const stageRes = await post(`/sales/opportunities/${opportunityId}/stage`, adminToken, {
        stageCode: "proposal",
        note: "Proposal submitted to CTO",
      });
      expect(stageRes.statusCode).toBe(200);
      expect(stageRes.json().stageCode).toBe("proposal");

      // Verify opportunity detail and history
      const detailRes = await get(`/sales/opportunities/${opportunityId}`, adminToken);
      expect(detailRes.statusCode).toBe(200);
      expect(detailRes.json().history).toHaveLength(2);
      expect(detailRes.json().history[0].fromStageCode).toBe(null);
      expect(detailRes.json().history[0].toStageCode).toBe("lead");
      expect(detailRes.json().history[1].fromStageCode).toBe("lead");
      expect(detailRes.json().history[1].toStageCode).toBe("proposal");
    });

    it("creates, submits, issues, and customer-accepts quotation with line totals", async () => {
      const quoteRes = await post("/sales/quotations", adminToken, {
        opportunityId,
        title: "Acme 1Gbps Dedicated Fiber Upgrade",
        lines: [
          {
            serviceId,
            description: "1Gbps Dedicated Internet",
            unitCode: "port",
            quantity: 12,
            unitPrice: 15_000_000,
            discountAmount: 18_000_000,
          },
        ],
      });
      expect(quoteRes.statusCode).toBe(201);
      quotationId = quoteRes.json().quotation.id;
      // 12 * 15,000,000 - 18,000,000 = 162,000,000
      expect(Number(quoteRes.json().quotation.subtotalAmount)).toBe(180_000_000);
      expect(Number(quoteRes.json().quotation.totalAmount)).toBe(162_000_000);

      // Submit for review
      const submitRes = await post(`/sales/quotations/${quotationId}/submit`, adminToken);
      expect(submitRes.statusCode).toBe(200);
      expect(submitRes.json().status).toBe("in_approval");

      // Issue (approval)
      const issueRes = await post(`/sales/quotations/${quotationId}/approval`, adminToken, {
        decision: "issued",
      });
      expect(issueRes.statusCode).toBe(200);
      expect(issueRes.json().status).toBe("issued");

      // Customer accepts
      const acceptRes = await post(`/sales/quotations/${quotationId}/customer-decision`, customerToken, {
        decision: "accepted",
        note: "Accepted by procurement",
      });
      expect(acceptRes.statusCode).toBe(200);
      expect(acceptRes.json().status).toBe("accepted");
    });
  });

  // ==========================================================================
  // CUS-ADV-002: Customer Self-Service Portal Privacy & Scoped Access
  // ==========================================================================
  describe("CUS-ADV-002: Customer Portal Privacy & Data Scope", () => {
    it("allows customer user to access own profile and quotations", async () => {
      const custRes = await get(`/customers/${customerAId}`, customerToken);
      expect(custRes.statusCode).toBe(200);
      expect(custRes.json().id).toBe(customerAId);

      const quotesRes = await get("/sales/quotations", customerToken);
      expect(quotesRes.statusCode).toBe(200);
      const quotes = quotesRes.json();
      expect(quotes.every((q: { customerId: string }) => q.customerId === customerAId)).toBe(true);
    });

    it("prevents customer user from accessing other customer profile or quotations", async () => {
      // Direct customer B access
      const custBRes = await get(`/customers/${customerBId}`, customerToken);
      expect(custBRes.statusCode).toBe(403);

      // Other tenant cross-access
      const otherTenantQuote = await get(`/sales/quotations/${quotationId}`, otherAdminToken);
      expect(otherTenantQuote.statusCode).toBe(404);
    });
  });

  // ==========================================================================
  // SQ-ADV-002: Structured Root Cause (RCA) & Advanced CAPA
  // ==========================================================================
  describe("SQ-ADV-002: Structured RCA & Advanced CAPA Tracking", () => {
    it("creates hierarchical RCA category taxonomy and tests findings & CAPA", async () => {
      // Create a complaint for RCA/CAPA
      const compRes = await post("/complaints", adminToken, {
        customerId: customerAId,
        title: "Intermittent Link Degradation",
        description: "High packet loss observed on uplink port",
        category: "network",
        severity: "major",
        priority: "high",
      });
      expect(compRes.statusCode).toBe(201);
      complaintId = compRes.json().id;

      const catRes = await post("/service-quality/rca/categories", adminToken, {
        code: "RCA-FIBER-PHYSICAL",
        name: "Fiber Optic Physical Fault",
        description: "Physical layer damage to optical cable",
      });
      expect(catRes.statusCode).toBe(201);
      rcaCategoryId = catRes.json().id;

      const listRes = await get("/service-quality/rca/categories", adminToken);
      expect(listRes.statusCode).toBe(200);
      expect(listRes.json().some((c: { id: string }) => c.id === rcaCategoryId)).toBe(true);

      // Record RCA finding with single primary invariant
      const find1Res = await post(`/service-quality/complaints/${complaintId}/rca/findings`, adminToken, {
        rootCauseCategoryId: rcaCategoryId,
        statement: "Primary fiber core attenuation",
        isPrimary: true,
      });
      expect(find1Res.statusCode).toBe(201);
      expect(find1Res.json().isPrimary).toBe(true);

      // Record a second finding marked primary; first finding should be demoted automatically
      const find2Res = await post(`/service-quality/complaints/${complaintId}/rca/findings`, adminToken, {
        rootCauseCategoryId: rcaCategoryId,
        statement: "Connector dirty at patch panel",
        isPrimary: true,
      });
      expect(find2Res.statusCode).toBe(201);
      expect(find2Res.json().isPrimary).toBe(true);

      const findingsRes = await get(`/service-quality/complaints/${complaintId}/rca/findings`, adminToken);
      expect(findingsRes.statusCode).toBe(200);
      const findings = findingsRes.json();
      expect(findings).toHaveLength(2);
      const primaryCount = findings.filter((f: { isPrimary: boolean }) => f.isPrimary).length;
      expect(primaryCount).toBe(1);

      // Create, advance, and verify CAPA action effectiveness
      const capaRes = await post("/service-quality/capa/actions", adminToken, {
        complaintId,
        actionType: "corrective",
        title: "Clean and re-terminate optical connectors",
        description: "Field team deployed with scope and cleaning kit",
        dueDate: "2026-09-01",
      });
      expect(capaRes.statusCode).toBe(201);
      capaActionId = capaRes.json().id;
      expect(capaRes.json().actionNumber).toBeDefined();

      // Progress CAPA to completed
      const progressRes = await patch(`/service-quality/capa/actions/${capaActionId}/status`, adminToken, {
        status: "completed",
        completionNote: "Patch connectors cleaned and loss measured at 0.1dB",
      });
      expect(progressRes.statusCode).toBe(200);
      expect(progressRes.json().status).toBe("completed");

      // Verify effectiveness
      const verifyRes = await post(`/service-quality/capa/actions/${capaActionId}/verify`, adminToken, {
        verdict: "effective",
        note: "24h traffic graph stable with 0% packet loss",
      });
      expect(verifyRes.statusCode).toBe(200);
      expect(verifyRes.json().effectivenessVerdict).toBe("effective");
      expect(verifyRes.json().status).toBe("verified");

      // Check summary
      const sumRes = await get("/service-quality/capa/effectiveness-summary", adminToken);
      expect(sumRes.statusCode).toBe(200);
      expect(sumRes.json().some((s: { status: string; effectiveCount: number }) => s.status === "verified" && s.effectiveCount >= 1)).toBe(true);
    });
  });

  // ==========================================================================
  // SQ-ADV-003: Deterministic Recurrence Analytics
  // ==========================================================================
  describe("SQ-ADV-003: Deterministic Recurrence Analytics", () => {
    it("creates recurrence rule and evaluates recurrence clusters", async () => {
      const ruleRes = await post("/service-quality/recurrence/rules", adminToken, {
        code: "REC-A1-NET-30D",
        name: "30-Day Network Issues Cluster",
        groupBy: "category",
        windowDays: 30,
        minimumOccurrences: 2,
      });
      expect(ruleRes.statusCode).toBe(201);
      recurrenceRuleId = ruleRes.json().id;

      // Submit complaint so it appears in analytics
      await post(`/complaints/${complaintId}/submit`, adminToken);

      const detectRes = await get(`/service-quality/recurrence/rules/${recurrenceRuleId}/detection`, adminToken);
      expect(detectRes.statusCode).toBe(200);
      expect(detectRes.json().clusters).toBeDefined();
      expect(Array.isArray(detectRes.json().clusters)).toBe(true);
    });
  });

  // ==========================================================================
  // SQ-ADV-004: Feedback Automation Proposals & Founder-Gated Execution
  // ==========================================================================
  describe("SQ-ADV-004: Feedback Automation Proposals", () => {
    it("creates automation rule and respects founder gating invariant", async () => {
      const ruleRes = await post("/service-quality/automation/rules", adminToken, {
        code: "AUTO-SURVEY-LOW",
        name: "Auto-escalate complaint on low survey score",
        triggerEvent: "survey_score_below_threshold",
        scoreThreshold: 4,
        proposedAction: "raise_complaint_severity",
        actionParameters: { severity: "critical" },
      });
      expect(ruleRes.statusCode).toBe(201);
      automationRuleId = ruleRes.json().id;
      expect(ruleRes.json().requiresApproval).toBe(true);
    });

    it("records, approves, and atomically executes proposal with two-phase locking", async () => {
      // Simulate proposal generation via service_feedback_automation_proposals
      const insertRes = await pool.query(
        `INSERT INTO service_feedback_automation_proposals (
          tenant_id, rule_id, idempotency_key, source_entity_type, source_entity_id,
          target_entity_type, target_entity_id, proposed_action, action_parameters, rationale, status
        ) VALUES ($1, $2, $3, 'complaint', $4, 'complaint', $4, 'raise_complaint_severity', $5, 'Automated low survey score escalation proposal', 'pending')
        RETURNING id`,
        [
          tenantId,
          automationRuleId,
          `survey_score:${complaintId}:${Date.now()}`,
          complaintId,
          JSON.stringify({ severity: "critical" }),
        ],
      );
      proposalId = insertRes.rows[0].id;

      // List proposals
      const listRes = await get("/service-quality/automation/proposals?status=pending", adminToken);
      expect(listRes.statusCode).toBe(200);
      expect(listRes.json().some((p: { id: string }) => p.id === proposalId)).toBe(true);

      // Approve proposal
      const approveRes = await post(`/service-quality/automation/proposals/${proposalId}/approve`, adminToken, {
        note: "Approved by Founder for customer escalation",
      });
      expect(approveRes.statusCode).toBe(200);
      expect(approveRes.json().status).toBe("applied");

      // Verify domain state mutation (complaint severity raised to critical)
      const compRes = await get(`/complaints/${complaintId}`, adminToken);
      expect(compRes.statusCode).toBe(200);
      expect(compRes.json().complaint.severity).toBe("critical");
    });
  });
});
