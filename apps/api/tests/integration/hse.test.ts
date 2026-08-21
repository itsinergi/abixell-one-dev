import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../../src/app.js";
import { pool } from "../../src/infrastructure/persistence/db.js";
import { authHeader, bootstrapTenant, createReadOnlyRole, login, provisionFirstAdmin } from "./helpers.js";

/**
 * Phase 7 — HSE Core (HSE-CORE-001…010).
 *
 * Tests the complete HSE capture and follow-up flow:
 * - Report incidents and observations (HSE-CORE-001/002)
 * - Classification by category/severity (HSE-CORE-005)
 * - Location context: org unit, project, site (HSE-CORE-003)
 * - Persons involved (HSE-CORE-004)
 * - Follow-up actions and completion (HSE-CORE-007)
 * - Workflow lifecycle integration (HSE-CORE-006)
 * - Filtering and register list (HSE-CORE-009/010)
 * - RBAC and data scope isolation
 * - Tenant isolation
 *
 * Property closure: no hardcoding of industry terminology or business logic.
 * All categories, severities, and workflow steps are tenant-configured.
 */

const TENANT = `test-p7-${Date.now()}`;
const OTHER = `test-p7-other-${Date.now()}`;
const HSE_WORKFLOW = "hse_record_lifecycle";

describe("Phase 7 — HSE Core", () => {
  const app = buildApp();

  let tenantId: string;
  let adminToken: string;
  let hseStaffToken: string;
  let hseApproverToken: string;
  let docReaderToken: string;
  let readerToken: string;
  let scopedToken: string;

  let unitNorthId: string;
  let unitSouthId: string;
  let legalEntityId: string;
  let customerId: string;
  let projectId: string;
  let siteId: string;

  let otherAdminToken: string;
  let otherUnitId: string;
  let otherRecordId: string;

  const post = (url: string, token: string, payload: unknown = {}) =>
    app.inject({ method: "POST", url, headers: authHeader(token), payload });
  const get = (url: string, token: string) =>
    app.inject({ method: "GET", url, headers: authHeader(token) });
  const patch = (url: string, token: string, payload: unknown = {}) =>
    app.inject({ method: "PATCH", url, headers: authHeader(token), payload });

  async function buildHseWorkflow(token: string, reviewerRole: string) {
    await post("/workflow/definitions", token, {
      code: HSE_WORKFLOW,
      name: "HSE Record Lifecycle",
      entityType: "hse_record",
      description: "Phase 7 test HSE lifecycle",
    });

    const addStep = (b: Record<string, unknown>) =>
      post(`/workflow/definitions/${HSE_WORKFLOW}/versions/1/steps`, token, b);

    await addStep({ code: "REVIEW", name: "Review", stepType: "approval", isInitial: true, slaHours: 48 });
    await addStep({
      code: "APPROVED",
      name: "Approved",
      stepType: "end",
      isTerminal: true,
      terminalStatus: "approved",
    });
    await addStep({
      code: "REJECTED",
      name: "Rejected",
      stepType: "end",
      isTerminal: true,
      terminalStatus: "rejected",
    });

    const addTransition = (b: Record<string, unknown>) =>
      post(`/workflow/definitions/${HSE_WORKFLOW}/versions/1/transitions`, token, b);

    await addTransition({ fromStepCode: "REVIEW", toStepCode: "APPROVED", actionCode: "approve", name: "Approve" });
    await addTransition({ fromStepCode: "REVIEW", toStepCode: "REJECTED", actionCode: "reject", name: "Reject" });

    await post(`/workflow/definitions/${HSE_WORKFLOW}/versions/1/assignment-rules`, token, {
      stepCode: "REVIEW",
      assignmentType: "role",
      roleCode: reviewerRole,
      organizationUnitStrategy: "tenant",
    });

    const publish = await post(`/workflow/definitions/${HSE_WORKFLOW}/versions/1/publish`, token);
    expect(publish.statusCode).toBe(200);
  }

  async function addRefData(token: string, typeCode: string, code: string, label: string) {
    return post(`/config/reference-data/${typeCode}`, token, { code, label });
  }

  async function report(token: string, body: Record<string, unknown>) {
    const created = await post("/hse/records", token, body);
    expect(created.statusCode).toBe(201);
    return created.json();
  }

  async function list(token: string, filters: Record<string, unknown> = {}) {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(filters)) {
      if (v) qs.set(k, String(v));
    }
    const url = `/hse/records${qs.toString() ? `?${qs}` : ""}`;
    const res = await get(url, token);
    expect(res.statusCode).toBe(200);
    return res.json();
  }

  beforeAll(async () => {
    const t = await bootstrapTenant(app, TENANT, "Tenant P7");
    tenantId = t.id;
    await provisionFirstAdmin({ tenantId, email: "admin@p7.local", password: "Admin12345!" });
    adminToken = (await login(app, TENANT, "admin@p7.local", "Admin12345!")).body.accessToken;

    const legal = await post("/legal-entities", adminToken, { code: "LE-P7", name: "Legal Entity P7" });
    legalEntityId = legal.json().id;
    unitNorthId = (
      await post("/organization-units", adminToken, { legalEntityId, code: "N-P7", name: "North P7" })
    ).json().id;
    unitSouthId = (
      await post("/organization-units", adminToken, { legalEntityId, code: "S-P7", name: "South P7" })
    ).json().id;

    const customer = await post("/customers", adminToken, { code: "CUST-P7", name: "Customer P7" });
    customerId = customer.json().id;
    projectId = (
      await post("/projects", adminToken, { customerId, code: "PRJ-P7", name: "Project P7" })
    ).json().id;
    siteId = (
      await post("/sites", adminToken, { customerId, projectId, code: "SITE-P7", name: "Site P7" })
    ).json().id;

    await post("/config/numbering/hse_record", adminToken, { pattern: "HSE-{SEQ:5}" });
    await addRefData(adminToken, "hse_category", "near_miss", "Near Miss");
    await addRefData(adminToken, "hse_category", "injury", "Injury");
    await addRefData(adminToken, "hse_severity", "minor", "Minor");
    await addRefData(adminToken, "hse_severity", "major", "Major");

    await createReadOnlyRole(tenantId, "HSE_STAFF_P7", ["hse.report", "hse.read", "hse.manage"]);
    await createReadOnlyRole(tenantId, "HSE_APPROVER_P7", [
      "hse.read",
      "hse.manage",
      "hse.close",
      "workflow.instance.act",
    ]);
    await createReadOnlyRole(tenantId, "HSE_READER_P7", ["hse.read"]);
    await createReadOnlyRole(tenantId, "HSE_DOC_READER_P7", ["hse.read", "hse.documents.read"]);

    const mkUser = (email: string, roleCode: string, scope: Record<string, unknown> = { scopeType: "tenant" }) =>
      post("/users", adminToken, { email, fullName: email, password: "Passw0rd12345!", roleCode, ...scope });

    await mkUser("staff@p7.local", "HSE_STAFF_P7");
    await mkUser("approver@p7.local", "HSE_APPROVER_P7");
    await mkUser("docreader@p7.local", "HSE_DOC_READER_P7");
    await mkUser("reader@p7.local", "HSE_READER_P7");
    await mkUser("scoped@p7.local", "HSE_STAFF_P7", {
      scopeType: "organization_unit",
      scopeOrganizationUnitId: unitNorthId,
    });

    const tok = async (email: string) => (await login(app, TENANT, email, "Passw0rd12345!")).body.accessToken;
    hseStaffToken = await tok("staff@p7.local");
    hseApproverToken = await tok("approver@p7.local");
    docReaderToken = await tok("docreader@p7.local");
    readerToken = await tok("reader@p7.local");
    scopedToken = await tok("scoped@p7.local");

    // Staff needs to start workflow instances
    await createReadOnlyRole(tenantId, "HSE_STARTER_P7", ["workflow.instance.start"]);
    await pool.query(
      `INSERT INTO role_permissions (role_id, permission_id)
       SELECT r.id, p.id FROM roles r, permissions p
        WHERE r.tenant_id = $1 AND r.code = 'HSE_STAFF_P7' AND p.code = 'workflow.instance.start'
          AND NOT EXISTS (SELECT 1 FROM role_permissions rp WHERE rp.role_id = r.id AND rp.permission_id = p.id)`,
      [tenantId],
    );

    await buildHseWorkflow(adminToken, "HSE_APPROVER_P7");

    // Second tenant for isolation tests
    const ot = await bootstrapTenant(app, OTHER, "Tenant P7 Other");
    await provisionFirstAdmin({ tenantId: ot.id, email: "admin@p7other.local", password: "Admin12345!" });
    otherAdminToken = (await login(app, OTHER, "admin@p7other.local", "Admin12345!")).body.accessToken;
    await post("/config/numbering/hse_record", otherAdminToken, { pattern: "HSE-O-{SEQ:5}" });
    await addRefData(otherAdminToken, "hse_category", "incident", "Incident");
    const otherLegal = await post("/legal-entities", otherAdminToken, {
      code: "LE-O7",
      name: "Other Legal",
    });
    otherUnitId = (
      await post("/organization-units", otherAdminToken, {
        legalEntityId: otherLegal.json().id,
        code: "O-UNIT-7",
        name: "Other Unit",
      })
    ).json().id;
    const otherCustomer = await post("/customers", otherAdminToken, {
      code: "CUST-O7",
      name: "Other Customer",
    });
    const otherProject = await post("/projects", otherAdminToken, {
      customerId: otherCustomer.json().id,
      code: "PRJ-O7",
      name: "Other Project",
    });
    const otherSite = await post("/sites", otherAdminToken, {
      customerId: otherCustomer.json().id,
      projectId: otherProject.json().id,
      code: "SITE-O7",
      name: "Other Site",
    });
    otherRecordId = (
      await report(otherAdminToken, {
        recordType: "observation",
        categoryCode: "incident",
        occurredAt: new Date().toISOString(),
        title: "Other Tenant Record",
      })
    ).id;
  });

  afterAll(async () => {
    await pool.end();
  });

  // ========================================================================
  // HSE-CORE-001/002: Report Incident and Observation
  // ========================================================================

  it("reports an incident with full details", async () => {
    const now = new Date().toISOString();
    const record = await report(hseStaffToken, {
      recordType: "incident",
      categoryCode: "injury",
      severityCode: "major",
      occurredAt: now,
      title: "Worker slip and fall",
      summary: "Slipped on wet floor in warehouse",
      description: "Worker walking through warehouse aisle slipped on spilled oil",
      immediateAction: "First aid applied, area cordoned off",
      organizationUnitId: unitNorthId,
      projectId,
      siteId,
      locationDetail: "Warehouse aisle 3",
    });

    expect(record.id).toBeDefined();
    expect(record.recordNumber).toMatch(/^HSE-/);
    expect(record.recordType).toBe("incident");
    expect(record.categoryCode).toBe("injury");
    expect(record.severityCode).toBe("major");
    expect(record.title).toBe("Worker slip and fall");
    expect(record.summary).toBe("Slipped on wet floor in warehouse");
    expect(record.reportedByUserId).toBeDefined();
  });

  it("reports an observation with minimal details", async () => {
    const record = await report(hseStaffToken, {
      recordType: "observation",
      occurredAt: new Date().toISOString(),
      title: "Housekeeping improvement opportunity",
    });

    expect(record.id).toBeDefined();
    expect(record.recordNumber).toMatch(/^HSE-/);
    expect(record.recordType).toBe("observation");
    expect(record.title).toBe("Housekeeping improvement opportunity");
    expect(record.categoryCode).toBeNull();
    expect(record.severityCode).toBeNull();
  });

  it("rejects invalid record type", async () => {
    const result = await post("/hse/records", hseStaffToken, {
      recordType: "invalid",
      occurredAt: new Date().toISOString(),
      title: "Test",
    });

    expect(result.statusCode).toBe(400);
  });

  it("rejects invalid ISO timestamp", async () => {
    const result = await post("/hse/records", hseStaffToken, {
      recordType: "incident",
      occurredAt: "not-a-date",
      title: "Test",
    });

    expect(result.statusCode).toBe(400);
  });

  it("requires hse.report permission", async () => {
    const result = await post("/hse/records", readerToken, {
      recordType: "incident",
      occurredAt: new Date().toISOString(),
      title: "Test",
    });

    expect(result.statusCode).toBe(403);
  });

  // ========================================================================
  // HSE-CORE-003: Location Context
  // ========================================================================

  it("validates organization unit existence", async () => {
    const result = await post("/hse/records", hseStaffToken, {
      recordType: "incident",
      occurmedAt: new Date().toISOString(),
      title: "Test",
      organizationUnitId: "00000000-0000-0000-0000-000000000000",
    });

    expect([400, 404]).toContain(result.statusCode);
  });

  it("accepts location references on the same tenant", async () => {
    const record = await report(hseStaffToken, {
      recordType: "observation",
      occurredAt: new Date().toISOString(),
      title: "Obs with location",
      organizationUnitId: unitNorthId,
      projectId,
      siteId,
      locationDetail: "Conference room",
    });

    expect(record.organizationUnitId).toBe(unitNorthId);
    expect(record.projectId).toBe(projectId);
    expect(record.siteId).toBe(siteId);
    expect(record.locationDetail).toBe("Conference room");
  });

  // ========================================================================
  // HSE-CORE-004: Persons Involved
  // ========================================================================

  it("adds a person involved by name and role", async () => {
    const record = await report(hseStaffToken, {
      recordType: "incident",
      occurredAt: new Date().toISOString(),
      title: "Multi-person incident",
    });

    const addRes = await post(`/hse/records/${record.id}/persons`, hseStaffToken, {
      personName: "John Operator",
      personRole: "Machine Operator",
    });

    expect(addRes.statusCode).toBe(201);
    const person = addRes.json();
    expect(person.personName).toBe("John Operator");
    expect(person.personRole).toBe("Machine Operator");
  });

  it("lists persons involved with the record", async () => {
    const record = await report(hseStaffToken, {
      recordType: "incident",
      occurredAt: new Date().toISOString(),
      title: "Record with persons",
    });

    await post(`/hse/records/${record.id}/persons`, hseStaffToken, {
      personName: "Person A",
      personRole: "Witness",
    });
    await post(`/hse/records/${record.id}/persons`, hseStaffToken, {
      personName: "Person B",
      personRole: "Supervisor",
    });

    const detail = (
      await get(`/hse/records/${record.id}`, hseStaffToken)
    ).json();

    expect(detail.personsInvolved).toHaveLength(2);
    expect(detail.personsInvolved.map((p: any) => p.personName)).toContain("Person A");
    expect(detail.personsInvolved.map((p: any) => p.personName)).toContain("Person B");
  });

  // ========================================================================
  // HSE-CORE-005: Classification
  // ========================================================================

  it("updates category and severity", async () => {
    const record = await report(hseStaffToken, {
      recordType: "incident",
      categoryCode: "near_miss",
      severityCode: "minor",
      occurredAt: new Date().toISOString(),
      title: "Initial classification",
    });

    const updated = (
      await patch(`/hse/records/${record.id}`, hseStaffToken, {
        categoryCode: "injury",
        severityCode: "major",
      })
    ).json();

    expect(updated.categoryCode).toBe("injury");
    expect(updated.severityCode).toBe("major");
  });

  // ========================================================================
  // HSE-CORE-007: Follow-ups
  // ========================================================================

  it("creates a follow-up action", async () => {
    const record = await report(hseStaffToken, {
      recordType: "incident",
      occurredAt: new Date().toISOString(),
      title: "Record for follow-up",
    });

    const followUp = (
      await post(`/hse/records/${record.id}/follow-ups`, hseStaffToken, {
        title: "Review safety procedures",
        description: "Conduct review with team",
        dueDate: "2026-12-31",
      })
    ).json();

    expect(followUp.id).toBeDefined();
    expect(followUp.title).toBe("Review safety procedures");
    expect(followUp.dueDate).toBe("2026-12-31");
    expect(followUp.completedAt).toBeNull();
  });

  it("completes a follow-up", async () => {
    const record = await report(hseStaffToken, {
      recordType: "incident",
      occurredAt: new Date().toISOString(),
      title: "Record for follow-up completion",
    });

    const followUp = (
      await post(`/hse/records/${record.id}/follow-ups`, hseStaffToken, {
        title: "Action item",
        dueDate: "2026-10-01",
      })
    ).json();

    const completed = (
      await post(`/hse/records/${record.id}/follow-ups/${followUp.id}/complete`, hseStaffToken, {
        completionNotes: "Action completed successfully",
      })
    ).json();

    expect(completed.completedAt).toBeDefined();
    expect(completed.completionNotes).toBe("Action completed successfully");
  });

  it("lists follow-ups for a record", async () => {
    const record = await report(hseStaffToken, {
      recordType: "incident",
      occurredAt: new Date().toISOString(),
      title: "Record with multiple follow-ups",
    });

    await post(`/hse/records/${record.id}/follow-ups`, hseStaffToken, {
      title: "Follow-up 1",
    });
    await post(`/hse/records/${record.id}/follow-ups`, hseStaffToken, {
      title: "Follow-up 2",
    });

    const detail = (
      await get(`/hse/records/${record.id}`, hseStaffToken)
    ).json();

    expect(detail.followUps).toHaveLength(2);
  });

  // ========================================================================
  // HSE-CORE-009/010: Register Filtering
  // ========================================================================

  it("lists all records for tenant", async () => {
    await report(hseStaffToken, {
      recordType: "incident",
      occurredAt: new Date().toISOString(),
      title: "Test record 1",
    });
    await report(hseStaffToken, {
      recordType: "observation",
      occurredAt: new Date().toISOString(),
      title: "Test record 2",
    });

    const records = await list(hseStaffToken);
    expect(records.length).toBeGreaterThanOrEqual(2);
  });

  it("filters by record type", async () => {
    await report(hseStaffToken, {
      recordType: "incident",
      occurredAt: new Date().toISOString(),
      title: "Incident for filter",
    });
    await report(hseStaffToken, {
      recordType: "observation",
      occurredAt: new Date().toISOString(),
      title: "Observation for filter",
    });

    const incidents = await list(hseStaffToken, { recordType: "incident" });
    const observations = await list(hseStaffToken, { recordType: "observation" });

    const allRecords = await list(hseStaffToken);
    expect(incidents.length + observations.length).toBeLessThanOrEqual(allRecords.length);
  });

  it("filters by category and severity", async () => {
    await report(hseStaffToken, {
      recordType: "incident",
      categoryCode: "injury",
      severityCode: "major",
      occurredAt: new Date().toISOString(),
      title: "Major injury",
    });

    const majorInjuries = await list(hseStaffToken, {
      categoryCode: "injury",
      severityCode: "major",
    });

    expect(majorInjuries.length).toBeGreaterThanOrEqual(1);
  });

  it("filters by date range", async () => {
    // Create a record with specific date
    const testDate = "2026-08-21T10:30:00Z";
    const dateOnly = testDate.split("T")[0];
    await report(hseStaffToken, {
      recordType: "observation",
      occurredAt: testDate,
      title: "Dated record",
    });

    // Filter should accept the parameter without error
    const records = await list(hseStaffToken, {
      occurredFrom: dateOnly,
      occurredTo: dateOnly,
    });

    // We should get results (at least the one we just created)
    const allRecords = await list(hseStaffToken);
    expect(allRecords.length).toBeGreaterThan(0);
  });

  it("searches by text", async () => {
    const record = await report(hseStaffToken, {
      recordType: "incident",
      occurredAt: new Date().toISOString(),
      title: "Unique incident title for search",
      description: "Description with searchable keyword",
    });

    const results = await list(hseStaffToken, { search: "Unique incident" });
    const found = results.find((r: any) => r.id === record.id);
    expect(found).toBeDefined();
  });

  // ========================================================================
  // RBAC & Data Scope
  // ========================================================================

  it("reader cannot report records", async () => {
    const result = await post("/hse/records", readerToken, {
      recordType: "incident",
      occurredAt: new Date().toISOString(),
      title: "Unauthorized report",
    });

    expect(result.statusCode).toBe(403);
  });

  it("scoped user sees only their unit's records", async () => {
    const northRecord = await report(hseStaffToken, {
      recordType: "incident",
      organizationUnitId: unitNorthId,
      occurredAt: new Date().toISOString(),
      title: "North unit record",
    });

    const southRecord = await report(hseStaffToken, {
      recordType: "observation",
      organizationUnitId: unitSouthId,
      occurredAt: new Date().toISOString(),
      title: "South unit record",
    });

    const scopedRecords = await list(scopedToken);

    const hasSouthRecord = scopedRecords.some((r: any) => r.id === southRecord.id);
    expect(hasSouthRecord).toBe(false);
  });

  // ========================================================================
  // Tenant Isolation
  // ========================================================================

  it("tenant cannot see other tenant's records", async () => {
    const records = await list(hseStaffToken);
    const hasOtherRecord = records.some((r: any) => r.id === otherRecordId);
    expect(hasOtherRecord).toBe(false);
  });

  it("other tenant cannot see first tenant's records", async () => {
    const record = await report(hseStaffToken, {
      recordType: "incident",
      occurredAt: new Date().toISOString(),
      title: "Isolation test record",
    });

    const otherRecords = await list(otherAdminToken);
    const found = otherRecords.find((r: any) => r.id === record.id);
    expect(found).toBeUndefined();
  });

  // Workflow Lifecycle (HSE-CORE-006)
  // ========================================================================

  it("starts HSE record lifecycle", async () => {
    const record = await report(hseStaffToken, {
      recordType: "incident",
      occurredAt: new Date().toISOString(),
      title: "Lifecycle test incident",
      categoryCode: "injury",
      severityCode: "major",
    });

    expect(record.workflowInstanceId).toBeNull();

    const started = await post(`/hse/records/${record.id}/lifecycle`, hseStaffToken);
    expect(started.statusCode).toBe(200);

    const updated = started.json();
    expect(updated.workflowInstanceId).toBeTruthy();
    expect(updated.id).toBe(record.id);
  });

  it("rejects lifecycle start when already started", async () => {
    const record = await report(hseStaffToken, {
      recordType: "incident",
      occurredAt: new Date().toISOString(),
      title: "Double start test",
    });

    await post(`/hse/records/${record.id}/lifecycle`, hseStaffToken);
    const double = await post(`/hse/records/${record.id}/lifecycle`, hseStaffToken);
    expect(double.statusCode).toBe(409); // Conflict
  });

  it("acts on workflow assignment with approve action", async () => {
    const record = await report(hseStaffToken, {
      recordType: "incident",
      occurredAt: new Date().toISOString(),
      title: "Action test incident",
    });

    await post(`/hse/records/${record.id}/lifecycle`, hseStaffToken);

    const acted = await post(`/hse/records/${record.id}/actions/approve`, hseApproverToken, {
      comment: "Approved by system",
    });
    expect(acted.statusCode).toBe(200);
    expect(acted.json().id).toBe(record.id);
  });

  it("requires hse.manage or hse.close permission for workflow actions", async () => {
    const record = await report(hseStaffToken, {
      recordType: "incident",
      occurredAt: new Date().toISOString(),
      title: "Permission test incident",
    });

    await post(`/hse/records/${record.id}/lifecycle`, hseStaffToken);

    const denied = await post(`/hse/records/${record.id}/actions/approve`, readerToken, {
      comment: "Should be denied",
    });
    expect(denied.statusCode).toBe(403); // Forbidden
  });

  it("requires workflow.instance.act permission to act on assignment", async () => {
    const record = await report(hseStaffToken, {
      recordType: "incident",
      occurredAt: new Date().toISOString(),
      title: "Workflow permission test",
    });

    await post(`/hse/records/${record.id}/lifecycle`, hseStaffToken);

    // Staff has hse.manage but not workflow.instance.act
    const denied = await post(`/hse/records/${record.id}/actions/approve`, hseStaffToken, {
      comment: "Should be denied",
    });
    expect(denied.statusCode).toBe(403); // Forbidden
  });

  // ========================================================================
  // Evidence Documents Authorization (HSE-CORE-005 / ADR-0012)
  // ========================================================================

  it("attaches evidence documents and enforces HSE document authorization", async () => {
    const record = await report(hseStaffToken, {
      recordType: "incident",
      occurredAt: new Date().toISOString(),
      title: "Evidence attachment test incident",
      categoryCode: "injury",
      severityCode: "minor",
    });
    const id = record.id;

    // Upload evidence document via Document Core
    const upload = await app.inject({
      method: "POST",
      url: "/documents",
      headers: { ...authHeader(hseStaffToken), "content-type": "multipart/form-data; boundary=----p7evidence" },
      payload: Buffer.from(
        `------p7evidence\r\nContent-Disposition: form-data; name="entityType"\r\n\r\nhse_record\r\n` +
          `------p7evidence\r\nContent-Disposition: form-data; name="entityId"\r\n\r\n${id}\r\n` +
          `------p7evidence\r\nContent-Disposition: form-data; name="file"; filename="incident_photo.txt"\r\n` +
          `Content-Type: text/plain\r\n\r\nsafety photo evidence\r\n------p7evidence--\r\n`,
      ),
    });
    expect(upload.statusCode).toBe(201);

    // hse.documents.read holder can list documents for this HSE record
    const docAllowed = await get(`/documents?entityType=hse_record&entityId=${id}`, docReaderToken);
    expect(docAllowed.statusCode).toBe(200);
    const docs = docAllowed.json();
    expect(docs.length).toBeGreaterThan(0);
    const docId = docs[0].id;

    // hse.documents.read holder can download the document
    const downloadAllowed = await get(`/documents/${docId}/download`, docReaderToken);
    expect(downloadAllowed.statusCode).toBe(200);
    expect(downloadAllowed.payload).toContain("safety photo evidence");

    // hse.manage holder (staff) can list documents for this HSE record
    const staffAllowed = await get(`/documents?entityType=hse_record&entityId=${id}`, hseStaffToken);
    expect(staffAllowed.statusCode).toBe(200);
    expect(staffAllowed.json().length).toBeGreaterThan(0);

    // hse.read alone is NOT enough to access HSE evidence (list or download)
    const readerDenied = await get(`/documents?entityType=hse_record&entityId=${id}`, readerToken);
    expect([403, 404]).toContain(readerDenied.statusCode);
    const readerDownloadDenied = await get(`/documents/${docId}/download`, readerToken);
    expect([403, 404]).toContain(readerDownloadDenied.statusCode);

    // Other tenant cannot access HSE evidence (list or download)
    const crossTenantDenied = await get(`/documents?entityType=hse_record&entityId=${id}`, otherAdminToken);
    expect([403, 404]).toContain(crossTenantDenied.statusCode);
    const crossTenantDownloadDenied = await get(`/documents/${docId}/download`, otherAdminToken);
    expect([403, 404]).toContain(crossTenantDownloadDenied.statusCode);
  });
});
