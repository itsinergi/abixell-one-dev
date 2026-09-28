import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildContainer } from "../../src/composition-root.js";
import { pool } from "../../src/infrastructure/persistence/db.js";
import { provisionFirstAdmin, createReadOnlyRole } from "./helpers.js";
import type { ActorContext } from "../../src/domain/shared-kernel/audit-context.js";
import type { DomainEvent } from "../../src/domain/event/event.entity.js";

/**
 * Checkpoint 1E.1 — Complaint-to-Survey Assignment Integration.
 *
 * Exercises the REAL EventBus + the REAL registered subscriber wired in the
 * composition root (`buildContainer()`), not a manual subscriber call: a
 * `complaint.customer_confirmed` domain event is published and flows to
 * `SurveyIntegrationService.handleTriggerEvent`. The workflow transition
 * that ORIGINATES this event is already covered by complaint-engine tests;
 * here the concern is the integration orchestrator (policy/respondent/
 * version resolution, idempotency, one-per-lifetime, execution recording,
 * tenant isolation). Complaint rows are seeded directly to avoid re-building
 * the entire complaint lifecycle (numbering/reference-data/workflow) that is
 * irrelevant to the integration boundary under test.
 */

const A = `test-1e1-a-${Date.now()}`;
const B = `test-1e1-b-${Date.now()}`;
const SURVEY_CODE = "csat_1e1";
/** Capability used to address management attention — policy DATA, not a
 * role name and not hardcoded in the engine (FD-1E §20). */
const ATTENTION_PERMISSION = "complaint.dashboard.read";

describe("Checkpoint 1E.1 — Survey Integration (Complaint → Assignment)", () => {
  const container = buildContainer();

  let tenantAId: string;
  let tenantBId: string;
  let adminAActor: ActorContext;
  let adminBId: string;
  let customerId: string;
  let customer2Id: string;
  let customerUserId: string; // customer-scoped over customerId (valid respondent)
  let customerUser2Id: string; // customer-scoped over customer2Id (wrong customer)
  let internalUserId: string; // tenant-scoped (internal actor, invalid respondent)
  let tenantBUserId: string; // belongs to tenant B (cross-tenant actor)
  let publishedVersionId: string;
  let policyId: string;
  let managementUserId: string;
  let ratingQuestionId: string;
  let choiceQuestionId: string;
  let longTextQuestionId: string;

  const actorCache = new Map<string, ActorContext>();

  /**
   * Build an ActorContext the way the auth plugin resolves one — from the
   * user's effective assignment (Epic 1 §4.1 B). These tests drive the
   * application services directly rather than over HTTP, so they never hold
   * a token; before Epic 1 they could name just `userId` + `tenantId` and
   * RBAC read permissions by user. Now the active Role is the assignment, so
   * the fixture resolves it the same way a session would.
   */
  const actorOf = async (
    userId: string,
    tenantId: string,
    scope?: "tenant" | "customer",
  ): Promise<ActorContext> => {
    const key = `${userId}:${scope ?? ""}`;
    const cached = actorCache.get(key);
    if (cached) return cached;
    const row = (
      await pool.query(
        `SELECT aura.id, aura.role_id, r.code AS role_code, aura.scope_type,
                aura.scope_organization_unit_id, aura.scope_customer_id
           FROM authorization_effective_user_role_assignments aura
           JOIN roles r ON r.id = aura.role_id
          WHERE aura.user_id = $1
            AND aura.tenant_id = $2
            AND ($3::text IS NULL OR aura.scope_type = $3)
          ORDER BY aura.id
          LIMIT 1`,
        [userId, tenantId, scope ?? null],
      )
    ).rows[0];
    const actor: ActorContext = {
      userId,
      tenantId,
      sessionId: `test-session-${userId}`,
      assignmentId: (row?.id as string) ?? null,
      roleId: (row?.role_id as string) ?? null,
      roleCode: (row?.role_code as string) ?? null,
      scopeType: (row?.scope_type as ActorContext["scopeType"]) ?? null,
      scopeOrganizationUnitId: (row?.scope_organization_unit_id as string) ?? null,
      scopeCustomerId: (row?.scope_customer_id as string) ?? null,
    };
    actorCache.set(key, actor);
    return actor;
  };

  const insertTenant = async (code: string, name: string) =>
    (await pool.query(`INSERT INTO tenants (code, name) VALUES ($1, $2) RETURNING id`, [code, name])).rows[0].id as string;

  const insertCustomer = async (tenantId: string, code: string) =>
    (
      await pool.query(`INSERT INTO customers (tenant_id, code, name) VALUES ($1, $2, $2) RETURNING id`, [tenantId, code])
    ).rows[0].id as string;

  const insertUser = async (tenantId: string, email: string) =>
    (
      await pool.query(
        `INSERT INTO users (tenant_id, email, password_hash, full_name) VALUES ($1, $2, 'x', $2) RETURNING id`,
        [tenantId, email],
      )
    ).rows[0].id as string;

  const assignCustomerScope = async (userId: string, roleId: string, customerScopeId: string) =>
    pool.query(
      `INSERT INTO user_role_assignments (user_id, role_id, scope_type, scope_customer_id) VALUES ($1, $2, 'customer', $3)`,
      [userId, roleId, customerScopeId],
    );

  const assignTenantScope = async (userId: string, roleId: string) =>
    pool.query(`INSERT INTO user_role_assignments (user_id, role_id, scope_type) VALUES ($1, $2, 'tenant')`, [userId, roleId]);

  const insertComplaint = async (tenantId: string, custId: string, submittedBy: string, num: string) =>
    (
      await pool.query(
        `INSERT INTO complaints (tenant_id, complaint_number, customer_id, category, description, priority, severity, submitted_by_user_id)
         VALUES ($1, $2, $3, 'general', 'test', 'medium', 'medium', $4) RETURNING id`,
        [tenantId, num, custId, submittedBy],
      )
    ).rows[0].id as string;

  const confirm = (complaintId: string, createdBy: string | null, tenantId: string): Promise<DomainEvent> =>
    container.eventBus.publish({
      tenantId,
      eventType: "complaint.customer_confirmed",
      entityType: "complaint",
      entityId: complaintId,
      payload: { complaintNumber: "n/a" },
      createdBy,
    });

  const assignmentsForComplaint = async (complaintId: string) =>
    (
      await pool.query(
        `SELECT * FROM survey_assignments WHERE context_entity_type = 'complaint' AND context_entity_id = $1`,
        [complaintId],
      )
    ).rows;

  const executions = async (policy: string, complaintId: string) =>
    (
      await pool.query(
        `SELECT * FROM survey_integration_executions WHERE policy_id = $1 AND source_entity_id = $2 ORDER BY created_at`,
        [policy, complaintId],
      )
    ).rows;

  beforeAll(async () => {
    tenantAId = await insertTenant(A, "Tenant 1E1 A");
    tenantBId = await insertTenant(B, "Tenant 1E1 B");

    const admin = await provisionFirstAdmin({ tenantId: tenantAId, email: "admin@t1e1a.local", password: "Admin12345!" });
    adminAActor = await actorOf(admin.userId, tenantAId);
    const adminB = await provisionFirstAdmin({ tenantId: tenantBId, email: "admin@t1e1b.local", password: "Admin12345!" });
    adminBId = adminB.userId;

    customerId = await insertCustomer(tenantAId, "CUST-1E1-1");
    customer2Id = await insertCustomer(tenantAId, "CUST-1E1-2");

    // A role for customer-side actors — its permissions are irrelevant to
    // the customer-actor discriminator (a `customer`-scoped assignment);
    // what matters is the scope carried by the assignment.
    const custRoleId = await createReadOnlyRole(tenantAId, "CUSTOMER_1E1", ["survey.respond"]);
    const internalRoleId = await createReadOnlyRole(tenantAId, "INTERNAL_1E1", ["complaint.manage"]);

    customerUserId = await insertUser(tenantAId, "cust1@t1e1a.local");
    await assignCustomerScope(customerUserId, custRoleId, customerId);

    customerUser2Id = await insertUser(tenantAId, "cust2@t1e1a.local");
    await assignCustomerScope(customerUser2Id, custRoleId, customer2Id);

    internalUserId = await insertUser(tenantAId, "internal@t1e1a.local");
    await assignTenantScope(internalUserId, internalRoleId);

    tenantBUserId = await insertUser(tenantBId, "cust@t1e1b.local");

    // A management user identified by CAPABILITY (not role name) — the
    // attention recipient. A customer-scoped user must never receive it.
    const mgmtRoleId = await createReadOnlyRole(tenantAId, "MGMT_1E1", [ATTENTION_PERMISSION]);
    managementUserId = await insertUser(tenantAId, "mgmt@t1e1a.local");
    await assignTenantScope(managementUserId, mgmtRoleId);

    // Published survey definition (Product Core, via the real service).
    const { version } = await container.survey.createDefinition(adminAActor, { code: SURVEY_CODE, name: "Customer Satisfaction" });
    const mk = (input: Parameters<typeof container.survey.addQuestion>[2]) =>
      container.survey.addQuestion(adminAActor, version.id, input);
    ratingQuestionId = (
      await mk({ code: "overall", text: "Overall rating", questionType: "rating", isRequired: true, config: { min: 1, max: 5 }, sortOrder: 1 })
    ).id;
    choiceQuestionId = (
      await mk({ code: "recommend", text: "Would you recommend us?", questionType: "single_choice", sortOrder: 2 })
    ).id;
    await container.survey.addOption(adminAActor, choiceQuestionId, { code: "no", label: "No", score: 1 });
    await container.survey.addOption(adminAActor, choiceQuestionId, { code: "yes", label: "Yes", score: 5 });
    await container.survey.addOption(adminAActor, choiceQuestionId, { code: "unsure", label: "Unsure", score: null });
    longTextQuestionId = (
      await mk({ code: "comments", text: "Comments", questionType: "long_text", sortOrder: 3 })
    ).id;
    await container.survey.publishVersion(adminAActor, SURVEY_CODE, 1);
    publishedVersionId = version.id;

    // The enabled integration policy under test (finite, structured).
    // NOTE: "overall" / 2 / management_attention are POLICY DATA — the
    // engine never hardcodes a question code, threshold, or survey code.
    const policy = await container.surveyIntegration.createPolicy({
      tenantId: tenantAId,
      code: "csat-on-confirm",
      name: "CSAT on customer confirmation",
      sourceEntityType: "complaint",
      sourceEventType: "complaint.customer_confirmed",
      surveyDefinitionCode: SURVEY_CODE,
      respondentResolution: "source_event_actor",
      onePerEntityLifetime: true,
      outcomeQuestionCode: "overall",
      outcomeOperator: "lte",
      outcomeNumericValue: 2,
      targetAction: "management_attention",
      attentionPermissionCode: ATTENTION_PERMISSION,
      createdBy: adminAActor.userId,
    });
    policyId = policy.id;

    // in_app template so attention delivery produces real Notification rows.
    await container.notification.createTemplate(adminAActor, {
      eventType: "survey.integration.attention_required",
      channel: "in_app",
      subjectTemplate: "Survey requires management attention",
      bodyTemplate: "Survey {{surveyAssignmentId}} scored {{value}} on {{questionCode}}.",
    });
  });

  /** Drive a full assign → answer → submit cycle for one complaint. */
  const assignAnswerSubmit = async (
    complaintNumber: string,
    answers: { questionId: string; valueNumeric?: number; valueText?: string; optionIds?: string[] }[],
  ) => {
    const complaintId = await insertComplaint(tenantAId, customerId, customerUserId, complaintNumber);
    await confirm(complaintId, customerUserId, tenantAId);
    const assignmentId = (await assignmentsForComplaint(complaintId))[0].id as string;
    const respondent = await actorOf(customerUserId, tenantAId);
    await container.surveyResponse.saveAnswers(respondent, assignmentId, answers);
    await container.surveyResponse.submit(respondent, assignmentId);
    return { complaintId, assignmentId };
  };

  const execFor = async (complaintId: string) => (await executions(policyId, complaintId))[0];

  const attentionNotifications = async (assignmentId: string) =>
    (
      await pool.query(
        `SELECT n.* FROM notifications n
          WHERE n.event_type = 'survey.integration.attention_required'
            AND n.body LIKE $1`,
        [`%${assignmentId}%`],
      )
    ).rows;

  afterAll(async () => {
    await pool.end();
  });

  it("Valid confirm by a customer actor → creates exactly one Survey Assignment (automation-attributed)", async () => {
    const complaintId = await insertComplaint(tenantAId, customerId, customerUserId, "C-1E1-1");
    const event = await confirm(complaintId, customerUserId, tenantAId);

    const rows = await assignmentsForComplaint(complaintId);
    expect(rows).toHaveLength(1);
    expect(rows[0].respondent_user_id).toBe(customerUserId);
    expect(rows[0].respondent_type).toBe("user");
    expect(rows[0].survey_version_id).toBe(publishedVersionId);
    // FD-1E-03: automation, not manually created by the customer.
    expect(rows[0].assigned_by).toBeNull();

    const exec = await executions(policyId, complaintId);
    expect(exec).toHaveLength(1);
    expect(exec[0].status).toBe("assigned");
    expect(exec[0].respondent_user_id).toBe(customerUserId);
    expect(exec[0].survey_assignment_id).toBe(rows[0].id);
    expect(exec[0].trigger_domain_event_id).toBe(event.id);

    // Reused survey.assigned event (no duplicate integration-mirror event).
    const assigned = await pool.query(
      `SELECT * FROM domain_events WHERE event_type = 'survey.assigned' AND entity_id = $1`,
      [rows[0].id],
    );
    expect(assigned.rows).toHaveLength(1);
    expect(assigned.rows[0].created_by).toBeNull();
  });

  it("Idempotency — reprocessing the SAME trigger event does not create a second assignment", async () => {
    const complaintId = await insertComplaint(tenantAId, customerId, customerUserId, "C-1E1-2");
    const event = await confirm(complaintId, customerUserId, tenantAId);
    // Replay the exact same domain event (same id) through the handler.
    await container.surveyIntegration.handleTriggerEvent(event);

    expect(await assignmentsForComplaint(complaintId)).toHaveLength(1);
    // Exactly one execution row for (policy, event) — the ON CONFLICT guard.
    const exec = await executions(policyId, complaintId);
    expect(exec).toHaveLength(1);
    expect(exec[0].status).toBe("assigned");
  });

  it("One-per-lifetime — a second confirmation (new event) of the same complaint does not create a second survey", async () => {
    const complaintId = await insertComplaint(tenantAId, customerId, customerUserId, "C-1E1-3");
    await confirm(complaintId, customerUserId, tenantAId); // assigned
    await confirm(complaintId, customerUserId, tenantAId); // new event id → skipped

    expect(await assignmentsForComplaint(complaintId)).toHaveLength(1);
    const exec = await executions(policyId, complaintId);
    expect(exec).toHaveLength(2);
    expect(exec.map((e) => e.status).sort()).toEqual(["assigned", "skipped_already_assigned"]);
  });

  it("Recipient — an internal (tenant-scoped) actor is not a customer respondent → skipped, no assignment", async () => {
    const complaintId = await insertComplaint(tenantAId, customerId, internalUserId, "C-1E1-4");
    await confirm(complaintId, internalUserId, tenantAId);

    expect(await assignmentsForComplaint(complaintId)).toHaveLength(0);
    const exec = await executions(policyId, complaintId);
    expect(exec).toHaveLength(1);
    expect(exec[0].status).toBe("skipped_recipient_unresolvable");
  });

  it("Recipient — a customer actor for a DIFFERENT customer → skipped, no assignment", async () => {
    const complaintId = await insertComplaint(tenantAId, customerId, customerUser2Id, "C-1E1-5");
    await confirm(complaintId, customerUser2Id, tenantAId);

    expect(await assignmentsForComplaint(complaintId)).toHaveLength(0);
    expect((await executions(policyId, complaintId))[0].status).toBe("skipped_recipient_unresolvable");
  });

  it("Recipient — a cross-tenant actor → skipped, no assignment", async () => {
    const complaintId = await insertComplaint(tenantAId, customerId, customerUserId, "C-1E1-6");
    // event actor belongs to tenant B, event is tenant A.
    await confirm(complaintId, tenantBUserId, tenantAId);

    expect(await assignmentsForComplaint(complaintId)).toHaveLength(0);
    expect((await executions(policyId, complaintId))[0].status).toBe("skipped_recipient_unresolvable");
  });

  it("No published version — the policy's definition has no current published version → skipped, confirmation unaffected", async () => {
    // A draft-only definition + a dedicated enabled policy pointing at it.
    await container.survey.createDefinition(adminAActor, { code: "draftonly_1e1", name: "Draft Only" });
    const noPub = await container.surveyIntegration.createPolicy({
      tenantId: tenantAId,
      code: "nopub-on-confirm",
      name: "No published version",
      sourceEntityType: "complaint",
      sourceEventType: "complaint.customer_confirmed",
      surveyDefinitionCode: "draftonly_1e1",
      respondentResolution: "source_event_actor",
      onePerEntityLifetime: true,
      createdBy: adminAActor.userId,
    });

    const complaintId = await insertComplaint(tenantAId, customerId, customerUserId, "C-1E1-7");
    await confirm(complaintId, customerUserId, tenantAId);

    // The no-published-version policy skipped…
    const noPubExec = await executions(noPub.id, complaintId);
    expect(noPubExec).toHaveLength(1);
    expect(noPubExec[0].status).toBe("skipped_no_published_version");
    // …while the main (published) policy still assigned — confirmation flow
    // is never blocked by a mis-configured second policy.
    expect((await executions(policyId, complaintId))[0].status).toBe("assigned");
  });

  it("Tenant isolation — a confirmation in tenant B with only a DISABLED policy creates nothing (tenant-scoped policy lookup)", async () => {
    const adminB = await actorOf(adminBId, tenantBId);
    await container.survey.createDefinition(adminB, { code: SURVEY_CODE, name: "CSAT B" });
    const vB = (await pool.query(`SELECT sv.id FROM survey_versions sv JOIN survey_definitions sd ON sd.id = sv.survey_definition_id WHERE sd.tenant_id = $1`, [tenantBId])).rows[0].id;
    await container.survey.addQuestion(adminB, vB, { code: "overall", text: "Overall", questionType: "rating", isRequired: true, config: { min: 1, max: 5 } });
    await container.survey.publishVersion(adminB, SURVEY_CODE, 1);
    await container.surveyIntegration.createPolicy({
      tenantId: tenantBId,
      code: "disabled-on-confirm",
      name: "Disabled",
      enabled: false,
      sourceEntityType: "complaint",
      sourceEventType: "complaint.customer_confirmed",
      surveyDefinitionCode: SURVEY_CODE,
      respondentResolution: "source_event_actor",
      onePerEntityLifetime: true,
      createdBy: adminB.userId,
    });

    const custB = await insertCustomer(tenantBId, "CUST-1E1-B1");
    const custRoleB = await createReadOnlyRole(tenantBId, "CUSTOMER_1E1_B", ["survey.respond"]);
    const custUserB = await insertUser(tenantBId, "custb1@t1e1b.local");
    await assignCustomerScope(custUserB, custRoleB, custB);
    const complaintId = await insertComplaint(tenantBId, custB, custUserB, "C-1E1-B1");

    await confirm(complaintId, custUserB, tenantBId);

    // Disabled policy in B does not run; tenant A's enabled policy is
    // tenant-scoped and never sees a tenant B event.
    expect(await assignmentsForComplaint(complaintId)).toHaveLength(0);
    const anyExec = await pool.query(
      `SELECT * FROM survey_integration_executions WHERE source_entity_id = $1`,
      [complaintId],
    );
    expect(anyExec.rows).toHaveLength(0);
  });

  // ===================================================================
  // Checkpoint 1E.2 — outcome evaluation → management attention
  // ===================================================================

  it("1E.2 Outcome MATCH (rating 2 <= 2) → exactly one management attention, notified by capability", async () => {
    const { complaintId, assignmentId } = await assignAnswerSubmit("C-1E2-1", [
      { questionId: ratingQuestionId, valueNumeric: 2 },
    ]);

    const exec = await execFor(complaintId);
    expect(exec.outcome).toBe("matched");
    expect(Number(exec.outcome_value)).toBe(2);
    expect(exec.attention_status).toBe("created");
    // Capability holders = the dedicated management user AND the tenant
    // admin (full-access role also grants the permission) — resolved by
    // capability, not by role name.
    expect(exec.attention_recipient_count).toBe(2);
    expect(exec.attention_event_id).toBeTruthy();
    expect(exec.submitted_domain_event_id).toBeTruthy();
    // Snapshot of the policy config is on the execution (FD-1E §29).
    expect(exec.outcome_question_code).toBe("overall");
    expect(exec.outcome_operator).toBe("lte");
    expect(exec.target_action).toBe("management_attention");

    // Delivered to capability holders only — never to a Customer User.
    const notes = await attentionNotifications(assignmentId);
    const recipients = notes.map((n) => n.recipient_user_id);
    expect(recipients).toContain(managementUserId);
    expect(recipients).not.toContain(customerUserId);
    expect(recipients).not.toContain(customerUser2Id);
    expect(notes.every((n) => n.status === "sent")).toBe(true);

    // Audit covers evaluation + action.
    const actions = (
      await pool.query(
        `SELECT action FROM audit_log WHERE entity_id = $1 AND action LIKE 'survey.integration%' ORDER BY action`,
        [exec.id],
      )
    ).rows.map((r) => r.action);
    expect(actions).toContain("survey.integration.outcome.evaluated");
    expect(actions).toContain("survey.integration.attention.created");
  });

  it("1E.2 Outcome NON-MATCH (rating 4) → evaluation recorded, no management attention", async () => {
    const { complaintId, assignmentId } = await assignAnswerSubmit("C-1E2-2", [
      { questionId: ratingQuestionId, valueNumeric: 4 },
    ]);

    const exec = await execFor(complaintId);
    expect(exec.outcome).toBe("not_matched");
    expect(Number(exec.outcome_value)).toBe(4);
    expect(exec.attention_status).toBeNull();
    expect(await attentionNotifications(assignmentId)).toHaveLength(0);
  });

  it("1E.2 Event replay — reprocessing the same survey.submitted yields one attention only", async () => {
    const { complaintId, assignmentId } = await assignAnswerSubmit("C-1E2-3", [
      { questionId: ratingQuestionId, valueNumeric: 1 },
    ]);
    const submitted = (
      await pool.query(
        `SELECT * FROM domain_events WHERE event_type = 'survey.submitted' AND entity_id = $1`,
        [assignmentId],
      )
    ).rows[0];

    // Replay the exact same domain event through the real handler.
    await container.surveyIntegration.handleSurveySubmitted({
      id: submitted.id,
      tenantId: submitted.tenant_id,
      eventType: submitted.event_type,
      entityType: submitted.entity_type,
      entityId: submitted.entity_id,
      payload: submitted.payload,
      occurredAt: submitted.occurred_at,
      createdBy: submitted.created_by,
    });

    const exec = await execFor(complaintId);
    expect(exec.outcome).toBe("matched");
    // Still ONE attention: the replay lost the compare-and-set, so the
    // notification set was not duplicated (2 recipients, not 4 rows).
    expect(exec.attention_recipient_count).toBe(2);
    expect(await attentionNotifications(assignmentId)).toHaveLength(2);
  });

  it("1E.2 Single choice uses the configured option SCORE (not option order)", async () => {
    const scorePolicy = await container.surveyIntegration.createPolicy({
      tenantId: tenantAId,
      code: "choice-score",
      name: "Choice score policy",
      sourceEntityType: "complaint",
      sourceEventType: "complaint.customer_confirmed",
      surveyDefinitionCode: SURVEY_CODE,
      respondentResolution: "source_event_actor",
      onePerEntityLifetime: true,
      outcomeQuestionCode: "recommend",
      outcomeOperator: "lte",
      outcomeNumericValue: 1,
      targetAction: "management_attention",
      attentionPermissionCode: ATTENTION_PERMISSION,
      createdBy: adminAActor.userId,
    });

    const complaintId = await insertComplaint(tenantAId, customerId, customerUserId, "C-1E2-4");
    await confirm(complaintId, customerUserId, tenantAId);
    // Two policies both assigned (independent lineage, FD-1E §27).
    const scoreExecBefore = (await executions(scorePolicy.id, complaintId))[0];
    const assignmentId = scoreExecBefore.survey_assignment_id as string;
    const respondent = await actorOf(customerUserId, tenantAId);
    // "no" carries score 1 but is the FIRST option — order must not be used.
    const optionNoId = (
      await pool.query(`SELECT id FROM survey_question_options WHERE survey_question_id = $1 AND code = 'no'`, [choiceQuestionId])
    ).rows[0].id;
    await container.surveyResponse.saveAnswers(respondent, assignmentId, [
      { questionId: ratingQuestionId, valueNumeric: 5 },
      { questionId: choiceQuestionId, optionIds: [optionNoId] },
    ]);
    await container.surveyResponse.submit(respondent, assignmentId);

    const scoreExec = (await executions(scorePolicy.id, complaintId))[0];
    expect(scoreExec.outcome).toBe("matched");
    expect(Number(scoreExec.outcome_value)).toBe(1);
    expect(scoreExec.attention_status).toBe("created");
  });

  it("1E.2 Long text question → unresolvable, no attention, no invented number", async () => {
    const textPolicy = await container.surveyIntegration.createPolicy({
      tenantId: tenantAId,
      code: "text-policy",
      name: "Long text policy",
      sourceEntityType: "complaint",
      sourceEventType: "complaint.customer_confirmed",
      surveyDefinitionCode: SURVEY_CODE,
      respondentResolution: "source_event_actor",
      onePerEntityLifetime: true,
      outcomeQuestionCode: "comments",
      outcomeOperator: "lte",
      outcomeNumericValue: 2,
      targetAction: "management_attention",
      attentionPermissionCode: ATTENTION_PERMISSION,
      createdBy: adminAActor.userId,
    });

    const complaintId = await insertComplaint(tenantAId, customerId, customerUserId, "C-1E2-5");
    await confirm(complaintId, customerUserId, tenantAId);
    const assignmentId = (await executions(textPolicy.id, complaintId))[0].survey_assignment_id as string;
    const respondent = await actorOf(customerUserId, tenantAId);
    await container.surveyResponse.saveAnswers(respondent, assignmentId, [
      { questionId: ratingQuestionId, valueNumeric: 1 },
      { questionId: longTextQuestionId, valueText: "terrible" },
    ]);
    await container.surveyResponse.submit(respondent, assignmentId);

    const exec = (await executions(textPolicy.id, complaintId))[0];
    expect(exec.outcome).toBe("unresolvable");
    expect(exec.outcome_error_code).toBe("non_numeric_question");
    expect(exec.outcome_value).toBeNull();
    expect(exec.attention_status).toBeNull();
  });

  it("1E.2 Configured question code missing from the assigned version → unresolvable, no crash", async () => {
    const missingPolicy = await container.surveyIntegration.createPolicy({
      tenantId: tenantAId,
      code: "missing-question",
      name: "Missing question policy",
      sourceEntityType: "complaint",
      sourceEventType: "complaint.customer_confirmed",
      surveyDefinitionCode: SURVEY_CODE,
      respondentResolution: "source_event_actor",
      onePerEntityLifetime: true,
      outcomeQuestionCode: "nps_not_in_this_version",
      outcomeOperator: "lte",
      outcomeNumericValue: 2,
      targetAction: "management_attention",
      attentionPermissionCode: ATTENTION_PERMISSION,
      createdBy: adminAActor.userId,
    });

    const complaintId = await insertComplaint(tenantAId, customerId, customerUserId, "C-1E2-6");
    await confirm(complaintId, customerUserId, tenantAId);
    const assignmentId = (await executions(missingPolicy.id, complaintId))[0].survey_assignment_id as string;
    const respondent = await actorOf(customerUserId, tenantAId);
    await container.surveyResponse.saveAnswers(respondent, assignmentId, [
      { questionId: ratingQuestionId, valueNumeric: 1 },
    ]);
    await container.surveyResponse.submit(respondent, assignmentId);

    const exec = (await executions(missingPolicy.id, complaintId))[0];
    expect(exec.outcome).toBe("unresolvable");
    expect(exec.outcome_error_code).toBe("question_not_found");
    expect(exec.attention_status).toBeNull();
  });

  it("1E.2 Policy edited AFTER assignment does not change the already-assigned survey's judgement (snapshot)", async () => {
    const driftPolicy = await container.surveyIntegration.createPolicy({
      tenantId: tenantAId,
      code: "drift-policy",
      name: "Drift policy",
      sourceEntityType: "complaint",
      sourceEventType: "complaint.customer_confirmed",
      surveyDefinitionCode: SURVEY_CODE,
      respondentResolution: "source_event_actor",
      onePerEntityLifetime: true,
      outcomeQuestionCode: "overall",
      outcomeOperator: "lte",
      outcomeNumericValue: 2,
      targetAction: "management_attention",
      attentionPermissionCode: ATTENTION_PERMISSION,
      createdBy: adminAActor.userId,
    });

    const complaintId = await insertComplaint(tenantAId, customerId, customerUserId, "C-1E2-7");
    await confirm(complaintId, customerUserId, tenantAId);
    const assignmentId = (await executions(driftPolicy.id, complaintId))[0].survey_assignment_id as string;

    // Admin widens the threshold to 4 while the respondent is still answering.
    await pool.query(`UPDATE survey_integration_policies SET outcome_numeric_value = 4 WHERE id = $1`, [driftPolicy.id]);

    const respondent = await actorOf(customerUserId, tenantAId);
    await container.surveyResponse.saveAnswers(respondent, assignmentId, [
      { questionId: ratingQuestionId, valueNumeric: 3 },
    ]);
    await container.surveyResponse.submit(respondent, assignmentId);

    // 3 <= 4 under the NEW policy, but the assignment was made under <= 2.
    const exec = (await executions(driftPolicy.id, complaintId))[0];
    expect(Number(exec.outcome_numeric_value)).toBe(2);
    expect(exec.outcome).toBe("not_matched");
    expect(exec.attention_status).toBeNull();
  });

  it("1E.2 Policy disabled after assignment → outcome evaluated, action skipped", async () => {
    const offPolicy = await container.surveyIntegration.createPolicy({
      tenantId: tenantAId,
      code: "disable-after",
      name: "Disabled after assignment",
      sourceEntityType: "complaint",
      sourceEventType: "complaint.customer_confirmed",
      surveyDefinitionCode: SURVEY_CODE,
      respondentResolution: "source_event_actor",
      onePerEntityLifetime: true,
      outcomeQuestionCode: "overall",
      outcomeOperator: "lte",
      outcomeNumericValue: 2,
      targetAction: "management_attention",
      attentionPermissionCode: ATTENTION_PERMISSION,
      createdBy: adminAActor.userId,
    });

    const complaintId = await insertComplaint(tenantAId, customerId, customerUserId, "C-1E2-8");
    await confirm(complaintId, customerUserId, tenantAId);
    const assignmentId = (await executions(offPolicy.id, complaintId))[0].survey_assignment_id as string;
    await pool.query(`UPDATE survey_integration_policies SET enabled = false WHERE id = $1`, [offPolicy.id]);

    const respondent = await actorOf(customerUserId, tenantAId);
    await container.surveyResponse.saveAnswers(respondent, assignmentId, [
      { questionId: ratingQuestionId, valueNumeric: 1 },
    ]);
    await container.surveyResponse.submit(respondent, assignmentId);

    const exec = (await executions(offPolicy.id, complaintId))[0];
    expect(exec.outcome).toBe("matched");
    expect(exec.attention_status).toBe("skipped_policy_disabled");
    expect(await attentionNotifications(assignmentId)).toHaveLength(0);
  });

  it("1E.2 A manually created Survey Assignment (no integration lineage) is a safe no-op on submit", async () => {
    const assignment = await container.survey.createAssignment(adminAActor, {
      surveyDefinitionCode: SURVEY_CODE,
      respondentUserId: customerUserId,
    });
    const respondent = await actorOf(customerUserId, tenantAId);
    await container.surveyResponse.saveAnswers(respondent, assignment.id, [
      { questionId: ratingQuestionId, valueNumeric: 1 },
    ]);
    await container.surveyResponse.submit(respondent, assignment.id);

    const anyExec = await pool.query(
      `SELECT * FROM survey_integration_executions WHERE survey_assignment_id = $1`,
      [assignment.id],
    );
    expect(anyExec.rows).toHaveLength(0);
    expect(await attentionNotifications(assignment.id)).toHaveLength(0);
  });

  it("1E.2 Survey submission is never rolled back by an integration failure", async () => {
    // Force an attention failure: a policy whose capability nobody holds.
    const orphanPolicy = await container.surveyIntegration.createPolicy({
      tenantId: tenantAId,
      code: "no-recipient",
      name: "No recipient policy",
      sourceEntityType: "complaint",
      sourceEventType: "complaint.customer_confirmed",
      surveyDefinitionCode: SURVEY_CODE,
      respondentResolution: "source_event_actor",
      onePerEntityLifetime: true,
      outcomeQuestionCode: "overall",
      outcomeOperator: "lte",
      outcomeNumericValue: 2,
      targetAction: "management_attention",
      attentionPermissionCode: "survey.integration.nonexistent_capability",
      createdBy: adminAActor.userId,
    });

    const complaintId = await insertComplaint(tenantAId, customerId, customerUserId, "C-1E2-9");
    await confirm(complaintId, customerUserId, tenantAId);
    const assignmentId = (await executions(orphanPolicy.id, complaintId))[0].survey_assignment_id as string;
    const respondent = await actorOf(customerUserId, tenantAId);
    await container.surveyResponse.saveAnswers(respondent, assignmentId, [
      { questionId: ratingQuestionId, valueNumeric: 1 },
    ]);
    const submitted = await container.surveyResponse.submit(respondent, assignmentId);

    // Submission stands…
    expect(submitted.status).toBe("submitted");
    expect(submitted.totalScore).not.toBeNull();
    // …and the failure is durable + observable, not swallowed.
    const exec = (await executions(orphanPolicy.id, complaintId))[0];
    expect(exec.outcome).toBe("matched");
    expect(exec.attention_status).toBe("failed");
    expect(exec.error_code).toBe("no_management_recipient");
  });
});
