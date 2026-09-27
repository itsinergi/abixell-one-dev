import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../../src/app.js";
import { pool } from "../../src/infrastructure/persistence/db.js";
import { activateAllModules, authHeader, bootstrapTenant, createReadOnlyRole, login, provisionFirstAdmin } from "./helpers.js";

/**
 * Checkpoint 0D integration test — proves the Workflow & Approval Engine
 * end-to-end, against the generic `demo_transactions` object ONLY (no
 * Complaint/Survey/Procurement business logic, per explicit Founder
 * instruction):
 *
 *   Workflow Definition -> Version -> Step -> Transition -> Condition ->
 *   Assignment (role+scope AND specific_user) -> Approval -> Reject ->
 *   Return/Resubmit -> Escalation -> History -> RBAC -> Audit Trail ->
 *   PostgreSQL
 *
 * Same pattern as 0B/0C: runs against the real database, no mocking,
 * direct `pool` assertions confirm data actually persisted.
 */

const TENANT_CODE = `test-0d-${Date.now()}`;

describe("Checkpoint 0D — Workflow & Approval Engine Foundation", () => {
  const app = buildApp();
  let tenantId: string;
  let adminToken: string;
  let siteId: string;
  let reviewerToken: string;
  let managerToken: string;

  beforeAll(async () => {
    const tenant = await bootstrapTenant(app, TENANT_CODE, "Test Tenant 0D");
    await activateAllModules(tenant.id);
    tenantId = tenant.id;
    await provisionFirstAdmin({
      tenantId,
      email: "admin@test-0d.local",
      password: "AdminPass123!",
    });

    const adminLogin = await login(app, TENANT_CODE, "admin@test-0d.local", "AdminPass123!");
    adminToken = adminLogin.body.accessToken;

    const legalEntityResponse = await app.inject({
      method: "POST",
      url: "/legal-entities",
      headers: authHeader(adminToken),
      payload: { name: "Test Legal Entity 0D" },
    });
    const legalEntityId = legalEntityResponse.json().id;
    const siteResponse = await app.inject({
      method: "POST",
      url: "/organization-units",
      headers: authHeader(adminToken),
      payload: { legalEntityId, name: "Site A" },
    });
    siteId = siteResponse.json().id;

    // WORKFLOW_REVIEWER scoped to Site A, WORKFLOW_MANAGER tenant-wide —
    // same shape as the seed script's demo roles, proving Assignment
    // routes to a role+scope "queue", not one pre-picked user.
    await createReadOnlyRole(tenantId, "WORKFLOW_REVIEWER", [
      "workflow.instance.read",
      "workflow.instance.act",
    ]);
    await createReadOnlyRole(tenantId, "WORKFLOW_MANAGER", [
      "workflow.instance.read",
      "workflow.instance.act",
    ]);

    const reviewerCreate = await app.inject({
      method: "POST",
      url: "/users",
      headers: authHeader(adminToken),
      payload: {
        email: "reviewer@test-0d.local",
        fullName: "Test Reviewer",
        password: "ReviewerPass123!",
        roleCode: "WORKFLOW_REVIEWER",
        scopeType: "organization_unit",
        scopeOrganizationUnitId: siteId,
      },
    });
    expect(reviewerCreate.statusCode).toBe(201);

    const managerCreate = await app.inject({
      method: "POST",
      url: "/users",
      headers: authHeader(adminToken),
      payload: {
        email: "manager@test-0d.local",
        fullName: "Test Manager",
        password: "ManagerPass123!",
        roleCode: "WORKFLOW_MANAGER",
        scopeType: "tenant",
      },
    });
    expect(managerCreate.statusCode).toBe(201);

    reviewerToken = (await login(app, TENANT_CODE, "reviewer@test-0d.local", "ReviewerPass123!")).body
      .accessToken;
    managerToken = (await login(app, TENANT_CODE, "manager@test-0d.local", "ManagerPass123!")).body
      .accessToken;

    // --- Build the demo Workflow Definition via the real HTTP API -------
    const definitionResponse = await app.inject({
      method: "POST",
      url: "/workflow/definitions",
      headers: authHeader(adminToken),
      payload: {
        code: "test_approval_workflow",
        name: "Test Approval Workflow",
        entityType: "demo_transaction",
        description: "Checkpoint 0D integration test workflow",
      },
    });
    expect(definitionResponse.statusCode).toBe(201);

    const addStep = (body: Record<string, unknown>) =>
      app.inject({
        method: "POST",
        url: "/workflow/definitions/test_approval_workflow/versions/1/steps",
        headers: authHeader(adminToken),
        payload: body,
      });
    await addStep({ code: "REVIEW", name: "Review", stepType: "approval", isInitial: true, slaHours: 4 });
    await addStep({ code: "REVISE", name: "Revise", stepType: "task" });
    await addStep({
      code: "COMPLETE",
      name: "Complete",
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

    const addTransition = (body: Record<string, unknown>) =>
      app.inject({
        method: "POST",
        url: "/workflow/definitions/test_approval_workflow/versions/1/transitions",
        headers: authHeader(adminToken),
        payload: body,
      });
    await addTransition({ fromStepCode: "REVIEW", toStepCode: "COMPLETE", actionCode: "approve", name: "Approve" });
    await addTransition({ fromStepCode: "REVIEW", toStepCode: "REJECTED", actionCode: "reject", name: "Reject" });
    await addTransition({ fromStepCode: "REVIEW", toStepCode: "REVISE", actionCode: "return", name: "Return" });
    await addTransition({ fromStepCode: "REVISE", toStepCode: "REVIEW", actionCode: "resubmit", name: "Resubmit" });

    const addAssignmentRule = (body: Record<string, unknown>) =>
      app.inject({
        method: "POST",
        url: "/workflow/definitions/test_approval_workflow/versions/1/assignment-rules",
        headers: authHeader(adminToken),
        payload: body,
      });
    await addAssignmentRule({
      stepCode: "REVIEW",
      sortOrder: 1,
      conditionExpression: { field: "category", operator: "eq", value: "high_risk" },
      assignmentType: "role",
      roleCode: "WORKFLOW_MANAGER",
      organizationUnitStrategy: "tenant",
    });
    await addAssignmentRule({
      stepCode: "REVIEW",
      sortOrder: 2,
      assignmentType: "role",
      roleCode: "WORKFLOW_REVIEWER",
      organizationUnitStrategy: "submitter_unit",
    });
    await addAssignmentRule({
      stepCode: "REVISE",
      assignmentType: "specific_user",
      specificUserSource: "submitter",
    });

    const escalationResponse = await app.inject({
      method: "POST",
      url: "/workflow/definitions/test_approval_workflow/versions/1/escalation-rules",
      headers: authHeader(adminToken),
      payload: {
        stepCode: "REVIEW",
        escalateAfterHours: 4,
        escalateToRoleCode: "WORKFLOW_MANAGER",
        escalateToOrganizationUnitStrategy: "tenant",
      },
    });
    expect(escalationResponse.statusCode).toBe(201);

    const publishResponse = await app.inject({
      method: "POST",
      url: "/workflow/definitions/test_approval_workflow/versions/1/publish",
      headers: authHeader(adminToken),
    });
    expect(publishResponse.statusCode).toBe(200);
    expect(publishResponse.json().isCurrent).toBe(true);
  });

  afterAll(async () => {
    await pool.query(`DELETE FROM tenants WHERE id = $1`, [tenantId]);
    await app.close();
  });

  async function startInstance(category: string) {
    const tx = await app.inject({
      method: "POST",
      url: "/workflow/demo-transactions",
      headers: authHeader(adminToken),
      payload: { title: `Test transaction (${category})` },
    });
    const start = await app.inject({
      method: "POST",
      url: "/workflow/instances",
      headers: authHeader(adminToken),
      payload: {
        definitionCode: "test_approval_workflow",
        entityId: tx.json().id,
        contextData: { organizationUnitId: siteId, category },
      },
    });
    expect(start.statusCode).toBe(201);
    return start.json() as { instance: { id: string }; assignment: { id: string } };
  }

  it("routes a default-category instance to the Site-scoped WORKFLOW_REVIEWER (fallback Assignment Rule)", async () => {
    const { assignment } = await startInstance("normal");
    expect(assignment).toMatchObject({ assignmentType: "role", assignedRoleCode: "WORKFLOW_REVIEWER" });
  });

  it("Condition-based dynamic routing: a high_risk instance is routed to WORKFLOW_MANAGER instead", async () => {
    const { assignment } = await startInstance("high_risk");
    expect(assignment).toMatchObject({
      assignmentType: "role",
      assignedRoleCode: "WORKFLOW_MANAGER",
      assignedOrganizationUnitId: null, // tenant-wide
    });
  });

  it("REJECTS an actor who does not hold the assigned Role in scope (403, backend-enforced)", async () => {
    const { assignment } = await startInstance("normal"); // -> WORKFLOW_REVIEWER only
    const response = await app.inject({
      method: "POST",
      url: `/workflow/assignments/${assignment.id}/act`,
      headers: authHeader(managerToken), // Manager does not hold WORKFLOW_REVIEWER
      payload: { actionCode: "approve" },
    });
    expect(response.statusCode).toBe(403);
  });

  it("Approval happy path: Reviewer approves -> Instance reaches COMPLETE with status 'approved'", async () => {
    const { instance, assignment } = await startInstance("normal");
    const response = await app.inject({
      method: "POST",
      url: `/workflow/assignments/${assignment.id}/act`,
      headers: authHeader(reviewerToken),
      payload: { actionCode: "approve", comment: "Looks good" },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().instance.status).toBe("approved");
    expect(response.json().newAssignment).toBeNull();

    const row = await pool.query(`SELECT status, completed_at FROM workflow_instances WHERE id = $1`, [
      instance.id,
    ]);
    expect(row.rows[0].status).toBe("approved");
    expect(row.rows[0].completed_at).not.toBeNull();
  });

  it("Reject path: Reviewer rejects -> Instance reaches REJECTED with status 'rejected'", async () => {
    const { assignment } = await startInstance("normal");
    const response = await app.inject({
      method: "POST",
      url: `/workflow/assignments/${assignment.id}/act`,
      headers: authHeader(reviewerToken),
      payload: { actionCode: "reject", comment: "Not compliant" },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().instance.status).toBe("rejected");
  });

  it("Return/Resubmit rework loop: Reviewer returns -> assigned to the submitter (specific_user) -> submitter resubmits -> back to REVIEW", async () => {
    const { instance, assignment } = await startInstance("normal");

    const returnResponse = await app.inject({
      method: "POST",
      url: `/workflow/assignments/${assignment.id}/act`,
      headers: authHeader(reviewerToken),
      payload: { actionCode: "return", comment: "Please clarify" },
    });
    expect(returnResponse.statusCode).toBe(200);
    expect(returnResponse.json().instance.status).toBe("in_progress");
    const reviseAssignment = returnResponse.json().newAssignment;
    expect(reviseAssignment).toMatchObject({ assignmentType: "specific_user" });

    // The Reviewer should NOT be able to act on the REVISE assignment —
    // it's routed to the submitter (admin), a different actor.
    const wrongActor = await app.inject({
      method: "POST",
      url: `/workflow/assignments/${reviseAssignment.id}/act`,
      headers: authHeader(reviewerToken),
      payload: { actionCode: "resubmit" },
    });
    expect(wrongActor.statusCode).toBe(403);

    const resubmitResponse = await app.inject({
      method: "POST",
      url: `/workflow/assignments/${reviseAssignment.id}/act`,
      headers: authHeader(adminToken), // admin = the submitter
      payload: { actionCode: "resubmit" },
    });
    expect(resubmitResponse.statusCode).toBe(200);
    expect(resubmitResponse.json().instance.status).toBe("in_progress");
    expect(resubmitResponse.json().newAssignment).toMatchObject({ assignedRoleCode: "WORKFLOW_REVIEWER" });

    const history = await app.inject({
      method: "GET",
      url: `/workflow/instances/${instance.id}/history`,
      headers: authHeader(adminToken),
    });
    const actions = history.json().map((h: { actionCode: string }) => h.actionCode);
    expect(actions).toEqual(expect.arrayContaining(["started", "return", "resubmit"]));
  });

  it("Escalation sweep: an overdue Assignment is reassigned per its Step's Escalation Rule", async () => {
    const { instance, assignment } = await startInstance("normal");

    // Simulate SLA breach — directly backdate due_at (there is no
    // automatic scheduler in Phase 0, see docs/decision-log.md; the
    // sweep itself is what's under test here, not a timer).
    await pool.query(
      `UPDATE workflow_instance_assignments SET due_at = now() - interval '1 hour' WHERE id = $1`,
      [assignment.id],
    );

    const sweep = await app.inject({
      method: "POST",
      url: "/workflow/escalation-sweep",
      headers: authHeader(adminToken),
    });
    expect(sweep.statusCode).toBe(200);
    expect(sweep.json().escalatedCount).toBeGreaterThanOrEqual(1);

    const escalatedRow = await pool.query(
      `SELECT status FROM workflow_instance_assignments WHERE id = $1`,
      [assignment.id],
    );
    expect(escalatedRow.rows[0].status).toBe("escalated");

    const newAssignmentRow = await pool.query(
      `SELECT assigned_role_code, status FROM workflow_instance_assignments
        WHERE workflow_instance_id = $1 AND status = 'pending' ORDER BY assigned_at DESC LIMIT 1`,
      [instance.id],
    );
    expect(newAssignmentRow.rows[0]).toMatchObject({
      assigned_role_code: "WORKFLOW_MANAGER",
      status: "pending",
    });

    const historyActions = (
      await pool.query(
        `SELECT action_code FROM workflow_history WHERE workflow_instance_id = $1 ORDER BY occurred_at`,
        [instance.id],
      )
    ).rows.map((r) => r.action_code);
    expect(historyActions).toContain("escalated");

    const notificationHooks = (
      await pool.query(
        `SELECT event_type FROM workflow_notification_hooks WHERE workflow_instance_id = $1`,
        [instance.id],
      )
    ).rows.map((r) => r.event_type);
    expect(notificationHooks).toContain("escalated");
  });

  it("Versioning: publishing a new Version does not disturb an already-running Instance's Version", async () => {
    const { instance: runningInstance } = await startInstance("normal");
    const runningInstanceBefore = await pool.query(
      `SELECT workflow_version_id FROM workflow_instances WHERE id = $1`,
      [runningInstance.id],
    );
    const v1Id = runningInstanceBefore.rows[0].workflow_version_id;

    const createV2 = await app.inject({
      method: "POST",
      url: "/workflow/definitions/test_approval_workflow/versions",
      headers: authHeader(adminToken),
      payload: {},
    });
    expect(createV2.statusCode).toBe(201);
    expect(createV2.json().versionNumber).toBe(2);

    // Publishing v2 without any Steps must fail validation, not silently
    // succeed with a broken Version.
    const publishEmptyV2 = await app.inject({
      method: "POST",
      url: "/workflow/definitions/test_approval_workflow/versions/2/publish",
      headers: authHeader(adminToken),
    });
    expect(publishEmptyV2.statusCode).toBe(400);
    expect(publishEmptyV2.json().details.length).toBeGreaterThan(0);

    // The already-running Instance from before still points at v1 —
    // confirmed directly against PostgreSQL, not just trusted.
    const runningInstanceAfter = await pool.query(
      `SELECT workflow_version_id FROM workflow_instances WHERE id = $1`,
      [runningInstance.id],
    );
    expect(runningInstanceAfter.rows[0].workflow_version_id).toBe(v1Id);

    const v1Row = await pool.query(`SELECT is_current FROM workflow_versions WHERE id = $1`, [v1Id]);
    expect(v1Row.rows[0].is_current).toBe(true);
  });

  it("REJECTS an assignment action without workflow.instance.act permission (403)", async () => {
    await createReadOnlyRole(tenantId, "WORKFLOW_OBSERVER", ["workflow.instance.read"]);
    const observerCreate = await app.inject({
      method: "POST",
      url: "/users",
      headers: authHeader(adminToken),
      payload: {
        email: "observer@test-0d.local",
        fullName: "Test Observer",
        password: "ObserverPass123!",
        roleCode: "WORKFLOW_OBSERVER",
        scopeType: "tenant",
      },
    });
    expect(observerCreate.statusCode).toBe(201);
    const observerToken = (await login(app, TENANT_CODE, "observer@test-0d.local", "ObserverPass123!")).body
      .accessToken;

    const { assignment } = await startInstance("normal");
    const response = await app.inject({
      method: "POST",
      url: `/workflow/assignments/${assignment.id}/act`,
      headers: authHeader(observerToken),
      payload: { actionCode: "approve" },
    });
    expect(response.statusCode).toBe(403);
    expect(response.json().error).toContain("workflow.instance.act");
  });

  it("records Audit Trail entries for Definition authoring, Instance lifecycle, and Escalation", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/audit-log/recent",
      headers: authHeader(adminToken),
    });
    const actions = response.json().map((e: { action: string }) => e.action);

    expect(actions).toContain("workflow.definition.created");
    expect(actions).toContain("workflow.version.published");
    expect(actions).toContain("workflow.instance.started");
    expect(actions).toContain("workflow.instance.acted");
    expect(actions).toContain("workflow.instance.escalated");
  });
});
