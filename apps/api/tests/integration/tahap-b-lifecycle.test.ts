import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../../src/app.js";
import { pool } from "../../src/infrastructure/persistence/db.js";
import { PgWorkflowRepository } from "../../src/infrastructure/persistence/repositories/workflow.repository.pg.js";
import { signAccessToken } from "../../src/infrastructure/security/jwt.js";
import { hashPassword } from "../../src/infrastructure/security/password.js";
import { authHeader, bootstrapTenant, provisionFirstAdmin } from "./helpers.js";

/**
 * Tahap B — Lifecycle soft-delete and activation/deactivation guards.
 *
 * Tests the governed transaction invariants:
 * - OU activation blocked when parent or LE inactive
 * - OU/LE deactivation blocked when children active
 * - Workflow specific_user assignment validation against user state
 * - Audit atomicity (mutation + record committed together)
 */

const stamp = `${Date.now().toString(36)}_${process.pid}_${randomUUID().replaceAll("-", "").slice(0, 8)}`;
const TENANT = `tahap-b-${stamp}`;
const PASSWORD = "Passw0rd12345!";

const app = buildApp();

let tenantId: string;
let adminId: string;
let adminToken: string;

async function createLegalEntity(name: string, isActive = true): Promise<string> {
  const result = await pool.query(
    `INSERT INTO legal_entities (tenant_id, name, is_active)
     VALUES ($1, $2, $3) RETURNING id`,
    [tenantId, name, isActive],
  );
  return result.rows[0].id;
}

async function createOrganizationUnit(
  legalEntityId: string,
  name: string,
  parentId?: string | null,
  isActive = true,
): Promise<string> {
  const result = await pool.query(
    `INSERT INTO organization_units (tenant_id, legal_entity_id, name, parent_id, is_active)
     VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [tenantId, legalEntityId, name, parentId ?? null, isActive],
  );
  return result.rows[0].id;
}

async function createUser(email: string, status = "active", deletedAt: Date | null = null): Promise<string> {
  const passwordHash = await hashPassword(PASSWORD);
  const result = await pool.query(
    `INSERT INTO users (tenant_id, email, password_hash, full_name, status, deleted_at)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
    [tenantId, email, passwordHash, email, status, deletedAt],
  );
  return result.rows[0].id;
}

async function createWorkflowDefinition(code: string): Promise<string> {
  const result = await pool.query(
    `INSERT INTO workflow_definitions (tenant_id, code, name, description, entity_type, created_by)
     VALUES ($1, $2, $3, $3, 'entity', $4) RETURNING id`,
    [tenantId, code, code, adminId],
  );
  return result.rows[0].id;
}

async function publishWorkflowVersion(defId: string): Promise<string> {
  const verResult = await pool.query(
    `INSERT INTO workflow_versions (workflow_definition_id, version_number, created_by)
     VALUES ($1, 1, $2) RETURNING id`,
    [defId, adminId],
  );
  const versionId = verResult.rows[0].id;
  await pool.query(`UPDATE workflow_versions SET is_current = true, status = 'published', published_at = now() WHERE id = $1`, [
    versionId,
  ]);

  const stepResult = await pool.query(
    `INSERT INTO workflow_steps (workflow_version_id, code, name, step_type)
     VALUES ($1, 'step1', 'Step 1', 'approval') RETURNING id`,
    [versionId],
  );
  return stepResult.rows[0].id;
}

async function createWorkflowInstance(defId: string): Promise<string> {
  const result = await pool.query(
    `INSERT INTO workflow_instances
       (tenant_id, workflow_definition_id, workflow_version_id, entity_type, entity_id, status, started_by)
     VALUES ($1, $2,
       (SELECT id FROM workflow_versions WHERE workflow_definition_id = $2 AND is_current = true),
       'entity', $3, 'in_progress', $3) RETURNING id`,
    [tenantId, defId, adminId],
  );
  return result.rows[0].id;
}

async function post(url: string, payload: unknown): Promise<{ status: number; body: unknown }> {
  const res = await app.inject({
    method: "POST",
    url,
    headers: authHeader(adminToken),
    payload,
  });
  return { status: res.statusCode, body: res.json() };
}

beforeAll(async () => {
  const tenant = await bootstrapTenant(app, TENANT, "Tahap B Test");
  tenantId = tenant.id;

  const admin = await provisionFirstAdmin({
    tenantId,
    email: `admin@${stamp}.test`,
    password: PASSWORD,
  });
  adminId = admin.userId;
  adminToken = signAccessToken({ sub: adminId, tenantId });
});

afterAll(async () => {
  await pool.end();
});

describe("Tahap B — Lifecycle guards", () => {
  describe("Organization Unit activation", () => {
    it("blocks activation when parent is inactive", async () => {
      const le = await createLegalEntity("LE Parent Test");
      const parent = await createOrganizationUnit(le, "Parent", undefined, false);
      const child = await createOrganizationUnit(le, "Child", parent);

      const res = await post(`/organization-units/${child}/activate`, {});

      expect(res.status).toBe(409);
      expect((res.body as Record<string, unknown>).error).toContain("Parent");
    });

    it("blocks activation when legal entity is inactive", async () => {
      const le = await createLegalEntity("LE Inactive Test", false);
      const ou = await createOrganizationUnit(le, "OU in Inactive LE", undefined);

      const res = await post(`/organization-units/${ou}/activate`, {});

      expect(res.status).toBe(409);
      expect((res.body as Record<string, unknown>).error).toContain("Legal Entity");
    });

    it("allows activation when parent and LE both active", async () => {
      const le = await createLegalEntity("LE Active Test");
      const parent = await createOrganizationUnit(le, "Parent Active", undefined, true);
      const child = await createOrganizationUnit(le, "Child Inactive", parent, false);

      const res = await post(`/organization-units/${child}/activate`, {});

      expect(res.status).toBe(200);
      const body = res.body as Record<string, unknown>;
      expect(body.isActive).toBe(true);
    });

    it("allows activation of root OU when LE active", async () => {
      const le = await createLegalEntity("LE Root Test");
      const root = await createOrganizationUnit(le, "Root No Parent", undefined, false);

      const res = await post(`/organization-units/${root}/activate`, {});

      expect(res.status).toBe(200);
      const body = res.body as Record<string, unknown>;
      expect(body.isActive).toBe(true);
    });
  });

  describe("Organization Unit deactivation", () => {
    it("blocks deactivation when active children exist", async () => {
      const le = await createLegalEntity("LE Deactivate Test");
      const parent = await createOrganizationUnit(le, "Parent");
      const _child = await createOrganizationUnit(le, "Child Active", parent);

      const res = await post(`/organization-units/${parent}/deactivate`, {});

      expect(res.status).toBe(409);
      expect((res.body as Record<string, unknown>).error).toContain("child");
    });

    it("allows deactivation when no active children", async () => {
      const le = await createLegalEntity("LE Deactivate Clean");
      const parent = await createOrganizationUnit(le, "Parent Clean");
      const _child = await createOrganizationUnit(le, "Child Inactive", parent, false);

      const res = await post(`/organization-units/${parent}/deactivate`, {});

      expect(res.status).toBe(200);
      const body = res.body as Record<string, unknown>;
      expect(body.isActive).toBe(false);
    });
  });

  describe("Legal Entity deactivation", () => {
    it("blocks deactivation when active OUs exist", async () => {
      const le = await createLegalEntity("LE with Active OUs");
      const _ou = await createOrganizationUnit(le, "Active OU");

      const res = await post(`/legal-entities/${le}/deactivate`, {});

      expect(res.status).toBe(409);
      expect((res.body as Record<string, unknown>).error).toContain("Organization Unit");
    });

    it("allows deactivation when all OUs inactive", async () => {
      const le = await createLegalEntity("LE with Inactive OUs");
      const _ou = await createOrganizationUnit(le, "Inactive OU", undefined, false);

      const res = await post(`/legal-entities/${le}/deactivate`, {});

      expect(res.status).toBe(200);
      const body = res.body as Record<string, unknown>;
      expect(body.isActive).toBe(false);
    });
  });

  // createAssignment has no HTTP surface — the engine calls it internally —
  // so the user-row locking guard is exercised against the repository itself.
  describe("Workflow specific_user assignment validation", () => {
    const workflowRepo = new PgWorkflowRepository(pool);

    async function assign(assignedUserId: string | null, code: string) {
      const defId = await createWorkflowDefinition(code);
      const stepId = await publishWorkflowVersion(defId);
      const instanceId = await createWorkflowInstance(defId);
      return workflowRepo.createAssignment({
        workflowInstanceId: instanceId,
        stepId,
        assignmentType: assignedUserId ? "specific_user" : "role",
        assignedRoleCode: assignedUserId ? null : "some_role",
        assignedOrganizationUnitId: null,
        assignedUserId,
        dueAt: null,
      });
    }

    it("rejects assignment to an inactive user", async () => {
      const user = await createUser(`inactive-${stamp}@test`, "inactive");
      await expect(assign(user, "wf-inactive")).rejects.toThrow(/User/);
    });

    it("rejects assignment to a soft-deleted user", async () => {
      const user = await createUser(`deleted-${stamp}@test`, "active", new Date());
      await expect(assign(user, "wf-deleted")).rejects.toThrow(/User/);
    });

    it("accepts assignment to an active user", async () => {
      const user = await createUser(`active-${stamp}@test`);
      const assignment = await assign(user, "wf-active");
      expect(assignment.assignedUserId).toBe(user);
    });

    it("skips user validation for role-based assignment", async () => {
      const assignment = await assign(null, "wf-role");
      expect(assignment.assignmentType).toBe("role");
    });
  });

  describe("Audit trail atomicity", () => {
    it("records activation audit entry on success", async () => {
      const le = await createLegalEntity("LE Audit Test");
      const ou = await createOrganizationUnit(le, "OU Audit", undefined, false);

      await post(`/organization-units/${ou}/activate`, {});

      const audit = await pool.query(
        `SELECT action, entity_type, entity_id FROM audit_log
         WHERE tenant_id = $1 AND entity_id = $2 AND action LIKE 'organization_unit%'
         ORDER BY created_at DESC LIMIT 1`,
        [tenantId, ou],
      );

      expect(audit.rows[0]).toBeDefined();
      expect(audit.rows[0].action).toBe("organization_unit.activated");
      expect(audit.rows[0].entity_type).toBe("organization_unit");
    });

    it("does not record audit on activation rejection", async () => {
      const le = await createLegalEntity("LE Audit Reject", false);
      const ou = await createOrganizationUnit(le, "OU Audit Reject");
      const auditBefore = await pool.query(
        `SELECT COUNT(*)::int AS count FROM audit_log
         WHERE tenant_id = $1 AND entity_id = $2`,
        [tenantId, ou],
      );

      await post(`/organization-units/${ou}/activate`, {});

      const auditAfter = await pool.query(
        `SELECT COUNT(*)::int AS count FROM audit_log
         WHERE tenant_id = $1 AND entity_id = $2`,
        [tenantId, ou],
      );

      expect(auditAfter.rows[0].count).toBe(auditBefore.rows[0].count);
    });
  });
});
