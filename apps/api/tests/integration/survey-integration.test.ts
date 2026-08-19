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

describe("Checkpoint 1E.1 — Survey Integration (Complaint → Assignment)", () => {
  const container = buildContainer();

  let tenantAId: string;
  let tenantBId: string;
  let adminAActor: ActorContext;
  let customerId: string;
  let customer2Id: string;
  let customerUserId: string; // customer-scoped over customerId (valid respondent)
  let customerUser2Id: string; // customer-scoped over customer2Id (wrong customer)
  let internalUserId: string; // tenant-scoped (internal actor, invalid respondent)
  let tenantBUserId: string; // belongs to tenant B (cross-tenant actor)
  let publishedVersionId: string;
  let policyId: string;

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
    adminAActor = { userId: admin.userId, tenantId: tenantAId };
    await provisionFirstAdmin({ tenantId: tenantBId, email: "admin@t1e1b.local", password: "Admin12345!" });

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

    // Published survey definition (Product Core, via the real service).
    const { version } = await container.survey.createDefinition(adminAActor, { code: SURVEY_CODE, name: "Customer Satisfaction" });
    await container.survey.addQuestion(adminAActor, version.id, {
      code: "overall",
      text: "Overall rating",
      questionType: "rating",
      isRequired: true,
      config: { min: 1, max: 5 },
    });
    await container.survey.publishVersion(adminAActor, SURVEY_CODE, 1);
    publishedVersionId = version.id;

    // The enabled integration policy under test (finite, structured).
    const policy = await container.surveyIntegration.createPolicy({
      tenantId: tenantAId,
      code: "csat-on-confirm",
      name: "CSAT on customer confirmation",
      sourceEntityType: "complaint",
      sourceEventType: "complaint.customer_confirmed",
      surveyDefinitionCode: SURVEY_CODE,
      respondentResolution: "source_event_actor",
      onePerEntityLifetime: true,
      createdBy: adminAActor.userId,
    });
    policyId = policy.id;
  });

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
    const adminB: ActorContext = {
      userId: (await pool.query(`SELECT id FROM users WHERE email = 'admin@t1e1b.local'`)).rows[0].id,
      tenantId: tenantBId,
    };
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
});
