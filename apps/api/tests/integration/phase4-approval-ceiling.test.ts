import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../../src/app.js";
import { pool } from "../../src/infrastructure/persistence/db.js";
import { hashPassword } from "../../src/infrastructure/security/password.js";
import {
  activateAllModules,
  authHeader,
  bootstrapTenant,
  provisionFirstAdmin,
  sessionTokenFor,
} from "./helpers.js";

/**
 * WP-APR-01 — Approval ceiling wiring (DEC-002/005).
 *
 * `approval-authority-unit.test.ts` pins the resolver's pure decision core
 * (self-approval, NULL-limit skip, currency conversion, accumulation,
 * supervisor escalation, cycle guard) against a scripted repository. This
 * file pins the WIRING: that `WorkflowService.createAssignmentForStep`
 * actually consults `ApprovalAuthorityService.resolveApprover` when an
 * approval-typed step carries a document amount, and routes the resulting
 * assignment to the decision's user — or fails clean with a 409 when the
 * ceiling is exhausted.
 *
 * Cases (amount read from `contextData` via `documentAmountOf`):
 *   1. NULL amount  → self-approved path → legacy role assignment untouched;
 *   2. amount ≤ role limit + IsCanApproveOwnDoc → self-assigned to the starter;
 *   3. amount > role limit → escalated to the starter's supervisor (who is
 *      within their own limit) → assigned to that supervisor;
 *   4. amount > role limit and no supervisor in the chain → no-approver → 409.
 *
 * Fixtures are direct SQL (the governed assignment surface is not what is
 * under test here), exactly like the SoD and rule-registry suites.
 */

const stamp = `${Date.now().toString(36)}_${process.pid}_${randomUUID().replaceAll("-", "").slice(0, 8)}`;
const codeStamp = stamp.toUpperCase();
const TENANT = `p4ceil-${stamp}`;
const PASSWORD = "Passw0rd12345!";

const START_PERMISSIONS = [
  "workflow.instance.start",
  "workflow.instance.read",
  "workflow.instance.act",
];

const app = buildApp();

interface UserFixture {
  id: string;
  email: string;
}

async function createApprovalRole(
  tenantId: string,
  code: string,
  permissionCodes: string[],
  approval: {
    amtApproval: string;
    isCanApproveOwnDoc: boolean;
    currencyCode?: string | null;
  },
): Promise<{ id: string; code: string }> {
  const roleResult = await pool.query(
    `INSERT INTO roles (tenant_id, code, name, is_full_access, is_active,
                        amt_approval, is_can_approve_own_doc, currency_code)
     VALUES ($1, $2, $2, false, true, $3, $4, $5)
     RETURNING id, code`,
    [
      tenantId,
      code,
      approval.amtApproval,
      approval.isCanApproveOwnDoc,
      approval.currencyCode ?? null,
    ],
  );
  const role = roleResult.rows[0] as { id: string; code: string };
  if (permissionCodes.length > 0) {
    await pool.query(
      `INSERT INTO role_permissions (role_id, permission_id)
       SELECT $1, id FROM permissions WHERE code = ANY($2::text[])`,
      [role.id, [...new Set(permissionCodes)]],
    );
  }
  return role;
}

async function createUser(
  tenantId: string,
  localName: string,
  passwordHash: string,
  supervisorUserId: string | null,
): Promise<UserFixture> {
  const email = `${localName}.${stamp}@p4ceil.local`;
  const result = await pool.query(
    `INSERT INTO users (tenant_id, email, password_hash, full_name, status, supervisor_user_id)
     VALUES ($1, $2, $3, $4, 'active', $5)
     RETURNING id, email`,
    [tenantId, email, passwordHash, `Phase 4 Ceiling ${localName}`, supervisorUserId],
  );
  return result.rows[0] as UserFixture;
}

async function assignRole(userId: string, roleId: string): Promise<string> {
  const result = await pool.query(
    `INSERT INTO user_role_assignments (user_id, role_id, scope_type)
     VALUES ($1, $2, 'tenant')
     RETURNING id`,
    [userId, roleId],
  );
  return result.rows[0].id as string;
}

describe("WP-APR-01 — Approval ceiling wiring", () => {
  let tenantId: string;
  let passwordHash: string;
  let admin: { userId: string; roleId: string };
  let adminToken: string;
  let siteId: string;

  // The capped role the assignment rule routes to: limit 100, own-doc
  // allowed, so an amount ≤ 100 self-approves and > 100 escalates.
  let cappedRole: { id: string; code: string };
  // The supervisor's role: limit high enough to clear every over-limit
  // amount in this suite.
  let highRole: { id: string; code: string };

  // Submitter A — capped role, supervisor chain resolves to supervisorA.
  let submitterA: UserFixture;
  let submitterAAssignmentId: string;
  let submitterAToken: string;
  let supervisorA: UserFixture;
  let supervisorAToken: string;

  // Submitter B — capped role, NO supervisor and NO org-unit supervisor →
  // the ceiling is exhausted, the start must fail clean with a 409.
  let submitterB: UserFixture;
  let submitterBAssignmentId: string;
  let submitterBToken: string;

  // One published definition whose single approval step routes through the
  // capped role; the ceiling resolver overrides the role assignment when an
  // amount is present.
  const definitionCode = `p4ceil_wf_${codeStamp}`;

  async function addStep(body: Record<string, unknown>) {
    const res = await app.inject({
      method: "POST",
      url: `/workflow/definitions/${definitionCode}/versions/1/steps`,
      headers: authHeader(adminToken),
      payload: body,
    });
    expect(res.statusCode).toBe(201);
  }

  async function startInstance(
    token: string,
    contextData: Record<string, unknown>,
  ): Promise<{ statusCode: number; body: Record<string, unknown> }> {
    // A throwaway entity row — `workflow_instances.entity_id` is a loose
    // UUID (no FK to demo_transactions), but using the real
    // createDemoTransaction path keeps the start identical to production.
    const tx = await app.inject({
      method: "POST",
      url: "/workflow/demo-transactions",
      headers: authHeader(token),
      payload: { title: `Ceiling tx ${stamp}` },
    });
    expect(tx.statusCode).toBe(201);
    const start = await app.inject({
      method: "POST",
      url: "/workflow/instances",
      headers: authHeader(token),
      payload: {
        definitionCode,
        entityId: tx.json().id,
        contextData,
      },
    });
    return { statusCode: start.statusCode, body: start.json() as Record<string, unknown> };
  }

  beforeAll(async () => {
    passwordHash = await hashPassword(PASSWORD);

    const primary = await bootstrapTenant(app, TENANT, "Tenant Phase 4 Ceiling");
    tenantId = primary.id;
    await activateAllModules(tenantId);
    admin = await provisionFirstAdmin({
      tenantId,
      email: `p4ceil-admin.${stamp}@p4ceil.local`,
      password: PASSWORD,
    });
    adminToken = await sessionTokenFor({ userId: admin.userId, tenantId });

    // Legal entity + organization unit (no supervisor set on the unit, so
    // the org-unit fallback returns null — the no-approver case depends on
    // it).
    const legalEntity = await app.inject({
      method: "POST",
      url: "/legal-entities",
      headers: authHeader(adminToken),
      payload: { name: "Ceiling Legal Entity" },
    });
    const site = await app.inject({
      method: "POST",
      url: "/organization-units",
      headers: authHeader(adminToken),
      payload: { legalEntityId: legalEntity.json().id, name: "Ceiling Site" },
    });
    siteId = site.json().id;

    cappedRole = await createApprovalRole(
      tenantId,
      `P4CEIL_CAPPED_${codeStamp}`,
      START_PERMISSIONS,
      { amtApproval: "100.00", isCanApproveOwnDoc: true },
    );
    highRole = await createApprovalRole(
      tenantId,
      `P4CEIL_HIGH_${codeStamp}`,
      START_PERMISSIONS,
      { amtApproval: "10000.00", isCanApproveOwnDoc: true },
    );

    // Supervisor A first (so submitter A can reference them).
    supervisorA = await createUser(tenantId, "supervisor-a", passwordHash, null);
    const supervisorAAssignmentId = await assignRole(supervisorA.id, highRole.id);
    supervisorAToken = await sessionTokenFor({
      userId: supervisorA.id,
      tenantId,
      activeAssignmentId: supervisorAAssignmentId,
    });

    submitterA = await createUser(tenantId, "submitter-a", passwordHash, supervisorA.id);
    submitterAAssignmentId = await assignRole(submitterA.id, cappedRole.id);
    submitterAToken = await sessionTokenFor({
      userId: submitterA.id,
      tenantId,
      activeAssignmentId: submitterAAssignmentId,
    });

    submitterB = await createUser(tenantId, "submitter-b", passwordHash, null);
    submitterBAssignmentId = await assignRole(submitterB.id, cappedRole.id);
    submitterBToken = await sessionTokenFor({
      userId: submitterB.id,
      tenantId,
      activeAssignmentId: submitterBAssignmentId,
    });

    // --- Workflow definition: one approval step routed to the capped role -
    const definition = await app.inject({
      method: "POST",
      url: "/workflow/definitions",
      headers: authHeader(adminToken),
      payload: {
        code: definitionCode,
        name: "Ceiling Workflow",
        entityType: "demo_transaction",
        description: "WP-APR-01 ceiling wiring test",
      },
    });
    expect(definition.statusCode).toBe(201);

    await addStep({ code: "REVIEW", name: "Review", stepType: "approval", isInitial: true });
    await addStep({
      code: "COMPLETE",
      name: "Complete",
      stepType: "end",
      isTerminal: true,
      terminalStatus: "approved",
    });

    const transition = await app.inject({
      method: "POST",
      url: `/workflow/definitions/${definitionCode}/versions/1/transitions`,
      headers: authHeader(adminToken),
      payload: { fromStepCode: "REVIEW", toStepCode: "COMPLETE", actionCode: "approve", name: "Approve" },
    });
    expect(transition.statusCode).toBe(201);

    const rule = await app.inject({
      method: "POST",
      url: `/workflow/definitions/${definitionCode}/versions/1/assignment-rules`,
      headers: authHeader(adminToken),
      payload: {
        stepCode: "REVIEW",
        sortOrder: 1,
        assignmentType: "role",
        roleCode: cappedRole.code,
        organizationUnitStrategy: "tenant",
      },
    });
    expect(rule.statusCode).toBe(201);

    const publish = await app.inject({
      method: "POST",
      url: `/workflow/definitions/${definitionCode}/versions/1/publish`,
      headers: authHeader(adminToken),
    });
    expect(publish.statusCode).toBe(200);
  });

  afterAll(async () => {
    await pool.query(`DELETE FROM tenants WHERE code = ANY($1::text[])`, [[TENANT]]);
    await app.close();
    await pool.end();
  });

  it("a document with no amount keeps the legacy role assignment (self-approved path)", async () => {
    const { statusCode, body } = await startInstance(submitterAToken, {
      organizationUnitId: siteId,
    });
    expect(statusCode).toBe(201);
    const assignment = body.assignment as Record<string, unknown>;
    expect(assignment.assignmentType).toBe("role");
    expect(assignment.assignedRoleCode).toBe(cappedRole.code);
    expect(assignment.assignedUserId).toBeNull();
  });

  it("an amount within the role limit self-routes to the starter and the starter can act", async () => {
    const { statusCode, body } = await startInstance(submitterAToken, {
      organizationUnitId: siteId,
      amount: "50.00",
    });
    expect(statusCode).toBe(201);
    const assignment = body.assignment as Record<string, unknown>;
    // The resolver returned "approve" with the starter as the approver, so
    // the step is assigned to them directly — the role code is cleared and
    // the assignment is re-typed to specific_user so `assertEligible` routes
    // on the user, not on a NULL role code.
    expect(assignment.assignmentType).toBe("specific_user");
    expect(assignment.assignedUserId).toBe(submitterA.id);
    expect(assignment.assignedRoleCode).toBeNull();

    // The whole point of the re-typing: the named user can actually clear the
    // task. A `role`-typed row with a NULL role code would 403 here.
    const act = await app.inject({
      method: "POST",
      url: `/workflow/assignments/${assignment.id as string}/act`,
      headers: authHeader(submitterAToken),
      payload: { actionCode: "approve" },
    });
    expect(act.statusCode).toBe(200);
    expect((act.json().instance as { status: string }).status).toBe("approved");
  });

  it("an amount over the role limit escalates to the supervisor, who can act", async () => {
    const { statusCode, body } = await startInstance(submitterAToken, {
      organizationUnitId: siteId,
      amount: "500.00",
    });
    expect(statusCode).toBe(201);
    const assignment = body.assignment as Record<string, unknown>;
    expect(assignment.assignmentType).toBe("specific_user");
    expect(assignment.assignedUserId).toBe(supervisorA.id);
    expect(assignment.assignedRoleCode).toBeNull();

    // A different actor (the starter) must not be able to act on the
    // supervisor's task…
    const wrongActor = await app.inject({
      method: "POST",
      url: `/workflow/assignments/${assignment.id as string}/act`,
      headers: authHeader(submitterAToken),
      payload: { actionCode: "approve" },
    });
    expect(wrongActor.statusCode).toBe(403);

    // …and the escalated supervisor must.
    const act = await app.inject({
      method: "POST",
      url: `/workflow/assignments/${assignment.id as string}/act`,
      headers: authHeader(supervisorAToken),
      payload: { actionCode: "approve" },
    });
    expect(act.statusCode).toBe(200);
    expect((act.json().instance as { status: string }).status).toBe("approved");
  });

  it("an exhausted ceiling (no supervisor, no org-unit supervisor) fails clean with 409", async () => {
    // Submitter B has no supervisor and the org unit has none set, so the
    // resolver walks to no-approver → ConflictError → 409, not a 500.
    const { statusCode, body } = await startInstance(submitterBToken, {
      organizationUnitId: siteId,
      amount: "500.00",
    });
    expect(statusCode).toBe(409);
    expect((body.error as string) ?? "").toMatch(/approver/i);
  });
});
