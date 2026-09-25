import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../../src/app.js";
import { ForbiddenError } from "../../src/domain/shared-kernel/errors.js";
import { pool } from "../../src/infrastructure/persistence/db.js";
import { PgTenantRepository } from "../../src/infrastructure/persistence/repositories/tenant.repository.pg.js";
import { signAccessToken } from "../../src/infrastructure/security/jwt.js";
import { hashPassword } from "../../src/infrastructure/security/password.js";
import {
  authHeader,
  bootstrapTenant,
  createReadOnlyRole,
  provisionFirstAdmin,
} from "./helpers.js";

/**
 * Tenant name update — `PATCH /tenants/me`.
 *
 * Covers the governed path: the caller can only rename the Tenant its token
 * belongs to, the permission must sit on the same assignment that carries
 * tenant scope, the name and its audit event commit together, and no other
 * Tenant field is reachable through the body.
 */

// Tenant codes are capped at 32 characters, so the stamp stays short.
const stamp = `${Date.now().toString(36)}${randomUUID().replaceAll("-", "").slice(0, 6)}`;
const TENANT = `tu-${stamp}`;
const OTHER_TENANT = `tu-other-${stamp}`;
const PASSWORD = "Passw0rd12345!";

const app = buildApp();

let tenantId: string;
let otherTenantId: string;
let adminId: string;
let adminToken: string;
let otherTenantName: string;

async function createLegalEntity(): Promise<string> {
  const result = await pool.query(
    `INSERT INTO legal_entities (tenant_id, name) VALUES ($1, $2) RETURNING id`,
    [tenantId, `LE ${stamp}`],
  );
  return result.rows[0].id as string;
}

async function createOrganizationUnit(legalEntityId: string): Promise<string> {
  const result = await pool.query(
    `INSERT INTO organization_units (tenant_id, legal_entity_id, name) VALUES ($1, $2, $3) RETURNING id`,
    [tenantId, legalEntityId, `OU ${stamp}`],
  );
  return result.rows[0].id as string;
}

async function createUserWithRole(
  roleId: string,
  scope: { type: "tenant" | "organization_unit"; organizationUnitId?: string },
): Promise<{ userId: string; token: string }> {
  const passwordHash = await hashPassword(PASSWORD);
  const userResult = await pool.query(
    `INSERT INTO users (tenant_id, email, password_hash, full_name)
     VALUES ($1, $2, $3, $4) RETURNING id`,
    [tenantId, `u-${randomUUID().slice(0, 8)}@${stamp}.test`, passwordHash, `User ${stamp}`],
  );
  const userId = userResult.rows[0].id as string;
  await pool.query(
    `INSERT INTO user_role_assignments (user_id, role_id, scope_type, scope_organization_unit_id)
     VALUES ($1, $2, $3, $4)`,
    [userId, roleId, scope.type, scope.organizationUnitId ?? null],
  );
  return { userId, token: signAccessToken({ sub: userId, tenantId }) };
}

async function patch(
  payload: unknown,
  options: { token?: string | null } = {},
): Promise<{ statusCode: number; body: unknown }> {
  const token = options.token === undefined ? adminToken : options.token;
  const response = await app.inject({
    method: "PATCH",
    url: "/tenants/me",
    headers: token ? authHeader(token) : {},
    payload,
  });
  return { statusCode: response.statusCode, body: response.json() };
}

async function readName(id: string): Promise<string> {
  const result = await pool.query(`SELECT name FROM tenants WHERE id = $1`, [id]);
  return result.rows[0].name as string;
}

async function updateAuditRows(id: string) {
  const result = await pool.query(
    `SELECT actor_user_id, entity_type, entity_id, tenant_id, metadata
       FROM audit_log
      WHERE action = 'tenant.updated' AND entity_id = $1
      ORDER BY created_at ASC`,
    [id],
  );
  return result.rows;
}

beforeAll(async () => {
  const tenant = await bootstrapTenant(app, TENANT, "Tenant Update Test");
  tenantId = tenant.id;
  const other = await bootstrapTenant(app, OTHER_TENANT, "Untouched Tenant");
  otherTenantId = other.id;
  otherTenantName = await readName(otherTenantId);

  const admin = await provisionFirstAdmin({
    tenantId,
    email: `admin@${stamp}.test`,
    password: PASSWORD,
  });
  adminId = admin.userId;
  adminToken = signAccessToken({ sub: adminId, tenantId });
});

afterAll(async () => {
  await pool.query(`DELETE FROM tenants WHERE id = ANY($1::uuid[])`, [
    [tenantId, otherTenantId],
  ]);
  await pool.end();
});

describe("PATCH /tenants/me", () => {
  it("renames the caller's tenant, trims the name, and returns only the name", async () => {
    const { statusCode, body } = await patch({ name: "  Renamed Workspace  " });

    expect(statusCode).toBe(200);
    expect(body).toEqual({ name: "Renamed Workspace" });
    expect(await readName(tenantId)).toBe("Renamed Workspace");

    const stored = await pool.query(
      `SELECT updated_by, updated_at, created_at FROM tenants WHERE id = $1`,
      [tenantId],
    );
    expect(stored.rows[0].updated_by).toBe(adminId);
    expect(stored.rows[0].updated_at.getTime()).toBeGreaterThanOrEqual(
      stored.rows[0].created_at.getTime(),
    );

    const read = await app.inject({
      method: "GET",
      url: "/tenants/me",
      headers: authHeader(adminToken),
    });
    expect(read.statusCode).toBe(200);
    expect(read.json().name).toBe("Renamed Workspace");
  });

  it("leaves code, status, identity, and other tenants untouched", async () => {
    const before = await pool.query(
      `SELECT code, status, created_at, updated_at FROM tenants WHERE id = $1`,
      [tenantId],
    );

    const { statusCode } = await patch({ name: "Second Rename" });
    expect(statusCode).toBe(200);

    const after = await pool.query(
      `SELECT id, code, status, created_at, updated_at FROM tenants WHERE id = $1`,
      [tenantId],
    );
    expect(after.rows[0].id).toBe(tenantId);
    expect(after.rows[0].code).toBe(before.rows[0].code);
    expect(after.rows[0].status).toBe(before.rows[0].status);
    expect(after.rows[0].created_at).toEqual(before.rows[0].created_at);

    expect(await readName(otherTenantId)).toBe(otherTenantName);
  });

  it("records exactly one audit event carrying the before and after names", async () => {
    const previousName = await readName(tenantId);
    const { statusCode } = await patch({ name: "Audited Rename" });
    expect(statusCode).toBe(200);

    const rows = await updateAuditRows(tenantId);
    const matching = rows.filter(
      (row) => row.metadata.previousName === previousName,
    );
    expect(matching).toHaveLength(1);
    expect(matching[0]).toMatchObject({
      actor_user_id: adminId,
      entity_type: "tenant",
      entity_id: tenantId,
      tenant_id: tenantId,
    });
    expect(matching[0].metadata).toEqual({
      previousName,
      name: "Audited Rename",
    });
    expect(Object.keys(matching[0].metadata).sort()).toEqual([
      "name",
      "previousName",
    ]);
  });

  it("rejects an unauthenticated request without mutating the tenant", async () => {
    const before = await readName(tenantId);
    const { statusCode } = await patch({ name: "Anonymous Rename" }, { token: null });

    expect(statusCode).toBe(401);
    expect(await readName(tenantId)).toBe(before);
  });

  it("rejects an actor whose assignment lacks the permission", async () => {
    const before = await readName(tenantId);
    // Earlier cases in this file legitimately wrote audit events for this
    // tenant, so the assertion is "no NEW event", not "no event at all".
    const auditBefore = (await updateAuditRows(tenantId)).length;
    const readOnlyRole = await createReadOnlyRole(tenantId, `RO_${stamp}`, ["tenant.read"]);
    const reader = await createUserWithRole(readOnlyRole, { type: "tenant" });

    const { statusCode } = await patch({ name: "Unprivileged Rename" }, { token: reader.token });

    expect(statusCode).toBe(403);
    expect(await readName(tenantId)).toBe(before);
    expect((await updateAuditRows(tenantId)).length).toBe(auditBefore);
  });

  it("rejects organization-unit-scoped permission for a tenant-wide resource", async () => {
    const before = await readName(tenantId);
    const legalEntityId = await createLegalEntity();
    const organizationUnitId = await createOrganizationUnit(legalEntityId);
    const scopedRole = await createReadOnlyRole(tenantId, `OU_${stamp}`, ["tenant.update"]);
    const scopedUser = await createUserWithRole(scopedRole, {
      type: "organization_unit",
      organizationUnitId,
    });

    const { statusCode } = await patch(
      { name: "Scoped Rename" },
      { token: scopedUser.token },
    );

    expect(statusCode).toBe(403);
    expect(await readName(tenantId)).toBe(before);
  });

  it("rejects permission and tenant scope held on separate assignments", async () => {
    const before = await readName(tenantId);
    const legalEntityId = await createLegalEntity();
    const organizationUnitId = await createOrganizationUnit(legalEntityId);
    const permissionRole = await createReadOnlyRole(tenantId, `SPLIT_${stamp}`, [
      "tenant.update",
    ]);
    const scopeRole = await createReadOnlyRole(tenantId, `SCOPE_${stamp}`, ["tenant.read"]);

    const passwordHash = await hashPassword(PASSWORD);
    const userResult = await pool.query(
      `INSERT INTO users (tenant_id, email, password_hash, full_name)
       VALUES ($1, $2, $3, $4) RETURNING id`,
      [tenantId, `split-${stamp}@${stamp}.test`, passwordHash, "Split Scope"],
    );
    const userId = userResult.rows[0].id as string;
    await pool.query(
      `INSERT INTO user_role_assignments (user_id, role_id, scope_type, scope_organization_unit_id)
       VALUES ($1, $2, 'organization_unit', $3), ($1, $4, 'tenant', NULL)`,
      [userId, permissionRole, organizationUnitId, scopeRole],
    );
    const token = signAccessToken({ sub: userId, tenantId });

    const { statusCode } = await patch({ name: "Split Rename" }, { token });

    expect(statusCode).toBe(403);
    expect(await readName(tenantId)).toBe(before);
  });

  it("repeats the authorization check inside the transaction", async () => {
    const before = await readName(tenantId);
    const legalEntityId = await createLegalEntity();
    const organizationUnitId = await createOrganizationUnit(legalEntityId);
    const scopedRole = await createReadOnlyRole(tenantId, `TX_${stamp}`, ["tenant.update"]);
    const scopedUser = await createUserWithRole(scopedRole, {
      type: "organization_unit",
      organizationUnitId,
    });

    // Bypasses the service-level precheck on purpose: the repository must still
    // refuse an assignment whose scope does not cover the tenant.
    const repository = new PgTenantRepository(pool);
    await expect(
      repository.updateName(
        { name: "Repository Bypass" },
        { userId: scopedUser.userId, tenantId },
      ),
    ).rejects.toBeInstanceOf(ForbiddenError);

    expect(await readName(tenantId)).toBe(before);
  });

  it("rejects invalid bodies without mutating the tenant", async () => {
    const before = await readName(tenantId);
    const longName = "x".repeat(121);
    const cases: unknown[] = [
      {},
      { name: "" },
      { name: "   " },
      { name: "a" },
      { name: longName },
      { name: 123 },
      { name: null },
      { name: "Valid Name", code: "HIJACK" },
      { name: "Valid Name", status: "suspended" },
      { name: "Valid Name", tenantId: otherTenantId },
    ];

    for (const payload of cases) {
      const { statusCode } = await patch(payload);
      expect(statusCode, JSON.stringify(payload)).toBe(400);
    }

    expect(await readName(tenantId)).toBe(before);
    expect(await readName(otherTenantId)).toBe(otherTenantName);
  });

  it("rolls back the rename when the audit insert is forced to fail", async () => {
    const before = await readName(tenantId);
    const auditBefore = (await updateAuditRows(tenantId)).length;
    const identifier = `tu_${randomUUID().replaceAll("-", "").slice(0, 20)}`;
    const functionName = `${identifier}_fn`;
    const triggerName = `${identifier}_trg`;

    await pool.query(`
      CREATE FUNCTION ${functionName}() RETURNS trigger
      LANGUAGE plpgsql
      AS $$
      BEGIN
        IF NEW.tenant_id = '${tenantId}'::uuid
           AND NEW.action = 'tenant.updated'
           AND NEW.metadata->>'name' = 'Forced Failure' THEN
          RAISE EXCEPTION 'Tenant update forced audit failure';
        END IF;
        RETURN NEW;
      END;
      $$;
      CREATE TRIGGER ${triggerName}
      BEFORE INSERT ON audit_log
      FOR EACH ROW EXECUTE FUNCTION ${functionName}();
    `);

    let statusCode: number | undefined;
    try {
      ({ statusCode } = await patch({ name: "Forced Failure" }));
    } finally {
      await pool.query(`DROP TRIGGER IF EXISTS ${triggerName} ON audit_log`);
      await pool.query(`DROP FUNCTION IF EXISTS ${functionName}()`);
    }

    expect(statusCode).toBe(500);
    expect(await readName(tenantId)).toBe(before);
    expect((await updateAuditRows(tenantId)).length).toBe(auditBefore);
  });
});
