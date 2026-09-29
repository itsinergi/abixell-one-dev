import { randomUUID } from "node:crypto";
import type {
  InjectPayload,
  Response as LightMyRequestResponse,
} from "light-my-request";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../../src/app.js";
import { pool } from "../../src/infrastructure/persistence/db.js";
import { PgRbacRepository } from "../../src/infrastructure/persistence/repositories/rbac.repository.pg.js";
import { hashPassword } from "../../src/infrastructure/security/password.js";
import {
  activateAllModules,
  authHeader,
  bootstrapTenant,
  provisionFirstAdmin,
  sessionTokenFor,
} from "./helpers.js";

/**
 * Epic 4 Wave 3 — CORE-ROADMAP.md §4.4 steps 17–21.
 *
 * Revocation is a governed state transition, not a delete. The row is kept as
 * history with who/why/when on it, the grant goes inert on the next
 * authorization check, and the exact-assignment key only covers live rows so a
 * later re-grant is a new row rather than a revival.
 *
 * Fixture setup uses direct SQL for actors and roles: the governed HTTP surface
 * is what is under test here, and manufacturing actors through it would make
 * the visibility assertions circular.
 */

const stamp = `${Date.now().toString(36)}_${process.pid}_${randomUUID().replaceAll("-", "").slice(0, 8)}`;
const codeStamp = stamp.toUpperCase();
const TENANT = `e4w3-${stamp}`;
const OTHER_TENANT = `e4w3o-${stamp}`;
const GUARD_TENANT = `e4w3g-${stamp}`;
const PASSWORD = "Passw0rd12345!";

const MANAGER_PERMISSIONS = [
  "admin.console.read",
  "user.read",
  "config.read",
  "user.role.manage",
];

const app = buildApp();
const rbacRepository = new PgRbacRepository(pool);

interface UserFixture {
  id: string;
  email: string;
}

async function createRole(
  tenantId: string,
  code: string,
  name: string,
  permissionCodes: string[] = [],
): Promise<{ id: string; code: string; name: string }> {
  const roleResult = await pool.query(
    `INSERT INTO roles (tenant_id, code, name, is_full_access)
     VALUES ($1, $2, $3, false)
     RETURNING id, code, name`,
    [tenantId, code, name],
  );
  const role = roleResult.rows[0] as { id: string; code: string; name: string };
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
): Promise<UserFixture> {
  const email = `${localName}.${stamp}@e4w3.local`;
  const result = await pool.query(
    `INSERT INTO users (tenant_id, email, password_hash, full_name)
     VALUES ($1, $2, $3, $4)
     RETURNING id, email`,
    [tenantId, email, passwordHash, `Epic 4 Wave 3 ${localName}`],
  );
  return result.rows[0] as UserFixture;
}

async function createOrganizationUnit(
  tenantId: string,
  suffix: string,
): Promise<string> {
  const legalEntity = await pool.query(
    `INSERT INTO legal_entities (tenant_id, name)
     VALUES ($1, $2)
     RETURNING id`,
    [tenantId, `E4W3 Legal Entity ${suffix}`],
  );
  const organizationUnit = await pool.query(
    `INSERT INTO organization_units (tenant_id, legal_entity_id, name, unit_type)
     VALUES ($1, $2, $3, 'Internal Site')
     RETURNING id`,
    [tenantId, legalEntity.rows[0].id, `E4W3 Organization Unit ${suffix}`],
  );
  return organizationUnit.rows[0].id as string;
}

async function createAssignment(
  userId: string,
  roleId: string,
  scope: { scopeType: "tenant" } | { scopeType: "organization_unit"; scopeOrganizationUnitId: string },
  createdBy: string | null = null,
): Promise<string> {
  const result = await pool.query(
    `INSERT INTO user_role_assignments
       (user_id, role_id, scope_type, scope_organization_unit_id,
        scope_customer_id, created_by)
     VALUES ($1, $2, $3, $4, NULL, $5)
     RETURNING id`,
    [
      userId,
      roleId,
      scope.scopeType,
      scope.scopeType === "organization_unit"
        ? scope.scopeOrganizationUnitId
        : null,
      createdBy,
    ],
  );
  return result.rows[0].id as string;
}

function tokenFor(tenantId: string, user: UserFixture): Promise<string> {
  // Epic 1 (�4.1 F): a bearer token must name a session, so fixtures create
  // one the way the login endpoint does instead of signing a bare payload.
  return sessionTokenFor({ userId: user.id, tenantId });
}

async function get(url: string, token: string): Promise<LightMyRequestResponse> {
  return app.inject({ method: "GET", url, headers: authHeader(token) });
}

async function post(
  url: string,
  token: string,
  payload: InjectPayload,
): Promise<LightMyRequestResponse> {
  return app.inject({
    method: "POST",
    url,
    headers: authHeader(token),
    payload,
  });
}

async function revoke(
  userId: string,
  assignmentId: string,
  token: string,
  reason = "Epic 4 Wave 3 integration revoke",
): Promise<LightMyRequestResponse> {
  return post(
    `/admin/users/${userId}/role-assignments/${assignmentId}/revoke`,
    token,
    { reason },
  );
}

describe("Epic 4 Wave 3 — governed assignment revocation", () => {
  let tenantId: string;
  let otherTenantId: string;

  let managerRole: { id: string; code: string; name: string };
  let grantableRole: { id: string; code: string; name: string };
  let manager: UserFixture;
  let managerToken: string;
  let target: UserFixture;
  let otherManager: UserFixture;
  let otherManagerToken: string;
  let otherTarget: UserFixture;

  beforeAll(async () => {
    const passwordHash = await hashPassword(PASSWORD);

    const primary = await bootstrapTenant(app, TENANT, "Tenant Epic 4 Wave 3");
    tenantId = primary.id;
    await activateAllModules(tenantId);
    await provisionFirstAdmin({
      tenantId,
      email: `e4w3-admin.${stamp}@e4w3.local`,
      password: PASSWORD,
    });

    managerRole = await createRole(
      tenantId,
      `E4W3_MANAGER_${codeStamp}`,
      "Epic 4 Wave 3 manager",
      MANAGER_PERMISSIONS,
    );
    grantableRole = await createRole(
      tenantId,
      `E4W3_GRANTABLE_${codeStamp}`,
      "Epic 4 Wave 3 grantable",
      ["user.read"],
    );

    manager = await createUser(tenantId, "manager", passwordHash);
    target = await createUser(tenantId, "target", passwordHash);
    await createAssignment(manager.id, managerRole.id, { scopeType: "tenant" });
    managerToken = await tokenFor(tenantId, manager);

    const other = await bootstrapTenant(
      app,
      OTHER_TENANT,
      "Tenant Epic 4 Wave 3 Other",
    );
    otherTenantId = other.id;
    await activateAllModules(otherTenantId);
    await provisionFirstAdmin({
      tenantId: otherTenantId,
      email: `e4w3-other-admin.${stamp}@e4w3.local`,
      password: PASSWORD,
    });
    const otherRole = await createRole(
      otherTenantId,
      `E4W3_OTHER_MANAGER_${codeStamp}`,
      "Epic 4 Wave 3 other manager",
      MANAGER_PERMISSIONS,
    );
    otherManager = await createUser(otherTenantId, "other-manager", passwordHash);
    otherTarget = await createUser(otherTenantId, "other-target", passwordHash);
    await createAssignment(otherManager.id, otherRole.id, {
      scopeType: "tenant",
    });
    otherManagerToken = await tokenFor(otherTenantId, otherManager);
  });

  afterAll(async () => {
    await pool.query(`DELETE FROM tenants WHERE code = ANY($1::text[])`, [
      [TENANT, OTHER_TENANT, GUARD_TENANT],
    ]);
    await app.close();
    await pool.end();
  });

  it("retains the row with who, why, and when, and stops the grant on the next check", async () => {
    const localTarget = await createUser(tenantId, "retain", await hashPassword(PASSWORD));
    const assignmentId = await createAssignment(
      localTarget.id,
      grantableRole.id,
      { scopeType: "tenant" },
      manager.id,
    );
    expect(
      (await rbacRepository.getEffectivePermissionCodes(localTarget.id)).has(
        "user.read",
      ),
    ).toBe(true);

    const reason = "Operator revoked this grant after a review";
    const response = await revoke(localTarget.id, assignmentId, managerToken, reason);
    expect(response.statusCode).toBe(204);
    expect(response.body).toBe("");

    // The row is history now, complete and unedited except for the lifecycle.
    const retained = await pool.query(
      `SELECT user_id, role_id, scope_type, created_by,
              revoked_at, revoked_by, revoke_reason
         FROM user_role_assignments
        WHERE id = $1`,
      [assignmentId],
    );
    expect(retained.rows).toHaveLength(1);
    expect(retained.rows[0]).toMatchObject({
      user_id: localTarget.id,
      role_id: grantableRole.id,
      scope_type: "tenant",
      created_by: manager.id,
      revoked_by: manager.id,
      revoke_reason: reason,
    });
    expect(retained.rows[0].revoked_at).toBeInstanceOf(Date);

    // Permission loss takes effect on the next authorization read, with no
    // logout and no session invalidation step.
    expect(
      (await rbacRepository.getEffectivePermissionCodes(localTarget.id)).has(
        "user.read",
      ),
    ).toBe(false);
    expect(await rbacRepository.getAssignments(localTarget.id)).toEqual([]);
    expect(
      await rbacRepository.listUserIdsWithPermissionInTenant(tenantId, "user.read"),
    ).not.toContain(localTarget.id);
  });

  it("projects the revoked assignment with its lifecycle state, reason, and actor", async () => {
    const localTarget = await createUser(tenantId, "projection", await hashPassword(PASSWORD));
    const assignmentId = await createAssignment(
      localTarget.id,
      grantableRole.id,
      { scopeType: "tenant" },
      manager.id,
    );
    const reason = "Projection check reason";
    expect((await revoke(localTarget.id, assignmentId, managerToken, reason)).statusCode).toBe(204);

    const detail = await get(`/admin/users/${localTarget.id}/access`, managerToken);
    expect(detail.statusCode).toBe(200);
    const detailAssignment = (detail.json().roleAssignments as Array<Record<string, unknown>>).find(
      (candidate) => candidate.id === assignmentId,
    );
    expect(detailAssignment).toMatchObject({
      id: assignmentId,
      assignmentState: "revoked",
      revokedBy: manager.id,
      revokeReason: reason,
      assignedBy: manager.id,
    });
    expect(detailAssignment!.revokedAt).toEqual(expect.any(String));
    expect(detailAssignment!.assignedAt).toEqual(expect.any(String));
    // roleState keeps describing the Role row itself; only the lifecycle state
    // (assignmentState) and the scope availability fold in the revocation.
    expect(detailAssignment!.roleState).toBe("available");
    expect(detailAssignment!.scopeState).toBe("unavailable");

    // The same lifecycle state appears on the assignment-centric surface, so
    // the two surfaces cannot disagree about one row.
    const inventory = await get("/admin/assignments", managerToken);
    expect(inventory.statusCode).toBe(200);
    const row = (inventory.json() as Array<Record<string, unknown>>).find(
      (candidate) => candidate.id === assignmentId,
    );
    expect(row).toMatchObject({
      id: assignmentId,
      userId: localTarget.id,
      assignmentState: "revoked",
      revokedBy: manager.id,
      revokeReason: reason,
    });

    // And on the list projection the user still appears, because the retained
    // record is inventory — not access.
    const list = await get("/admin/users", managerToken);
    const listed = (list.json() as Array<Record<string, unknown>>).find(
      (candidate) => candidate.id === localTarget.id,
    );
    expect(listed).toBeDefined();
    const listedAssignment = (listed!.roleAssignments as Array<Record<string, unknown>>).find(
      (candidate) => candidate.id === assignmentId,
    );
    expect(listedAssignment).toMatchObject({
      assignmentState: "revoked",
      revokeReason: reason,
    });
  });

  it("writes one before/after revoke audit event and no additional assign event", async () => {
    const localTarget = await createUser(tenantId, "audit", await hashPassword(PASSWORD));
    const assignmentId = await createAssignment(
      localTarget.id,
      grantableRole.id,
      { scopeType: "tenant" },
      manager.id,
    );
    const reason = "Audit trail reason";
    expect((await revoke(localTarget.id, assignmentId, managerToken, reason)).statusCode).toBe(204);

    const events = await pool.query(
      `SELECT action, actor_user_id, entity_type, entity_id, metadata
         FROM audit_log
        WHERE tenant_id = $1 AND entity_id = $2
        ORDER BY created_at`,
      [tenantId, localTarget.id],
    );
    expect(events.rows.map((row) => row.action)).toEqual(["user.role_revoked"]);
    const event = events.rows[0];
    expect(event).toMatchObject({
      actor_user_id: manager.id,
      entity_type: "user",
      entity_id: localTarget.id,
    });
    expect(event.metadata).toMatchObject({
      targetUserId: localTarget.id,
      scopeType: "tenant",
      assignmentId,
      reason,
      before: {
        status: "active",
        revokedAt: null,
        revokedBy: null,
        revokeReason: null,
      },
      after: {
        status: "revoked",
        revokedBy: manager.id,
        revokeReason: reason,
      },
    });
    expect(event.metadata.after.revokedAt).toEqual(expect.any(String));
  });

  it("refuses a second revoke of the same row with 409 and keeps the first provenance", async () => {
    const localTarget = await createUser(tenantId, "double", await hashPassword(PASSWORD));
    const assignmentId = await createAssignment(
      localTarget.id,
      grantableRole.id,
      { scopeType: "tenant" },
      manager.id,
    );
    expect(
      (await revoke(localTarget.id, assignmentId, managerToken, "First revoke")).statusCode,
    ).toBe(204);

    const second = await revoke(
      localTarget.id,
      assignmentId,
      managerToken,
      "Second revoke attempt",
    );
    expect(second.statusCode).toBe(409);
    expect(second.json().error).toMatch(/already revoked/i);

    const row = await pool.query(
      `SELECT revoke_reason FROM user_role_assignments WHERE id = $1`,
      [assignmentId],
    );
    expect(row.rows[0].revoke_reason).toBe("First revoke");
    const revokeEvents = await pool.query(
      `SELECT 1 FROM audit_log
        WHERE tenant_id = $1 AND action = 'user.role_revoked' AND entity_id = $2`,
      [tenantId, localTarget.id],
    );
    expect(revokeEvents.rows).toHaveLength(1);
  });

  it("lets the same Role and scope be granted again as a fresh row after a revoke", async () => {
    const localTarget = await createUser(tenantId, "regrant", await hashPassword(PASSWORD));
    const first = await createAssignment(
      localTarget.id,
      grantableRole.id,
      { scopeType: "tenant" },
      manager.id,
    );
    expect((await revoke(localTarget.id, first, managerToken)).statusCode).toBe(204);

    const regrant = await post(
      `/admin/users/${localTarget.id}/role-assignments`,
      managerToken,
      { roleCode: grantableRole.code, scopeType: "tenant" },
    );
    expect(regrant.statusCode).toBe(201);
    expect(regrant.json().id).not.toBe(first);
    expect(regrant.json()).toMatchObject({
      assignmentState: "active",
      revokedAt: null,
      revokedBy: null,
      revokeReason: null,
      assignedBy: manager.id,
    });

    // Two rows now exist for the same key: one revoked history, one live.
    const rows = await pool.query(
      `SELECT id, revoked_at FROM user_role_assignments
        WHERE user_id = $1 AND role_id = $2 AND scope_type = 'tenant'
        ORDER BY created_at`,
      [localTarget.id, grantableRole.id],
    );
    expect(rows.rows).toHaveLength(2);
    expect(rows.rows.filter((row) => row.revoked_at === null)).toHaveLength(1);
    expect(
      (await rbacRepository.getEffectivePermissionCodes(localTarget.id)).has(
        "user.read",
      ),
    ).toBe(true);
  });

  it("requires a non-empty, bounded revoke reason", async () => {
    const localTarget = await createUser(tenantId, "reason", await hashPassword(PASSWORD));
    const assignmentId = await createAssignment(
      localTarget.id,
      grantableRole.id,
      { scopeType: "tenant" },
      manager.id,
    );
    const url = `/admin/users/${localTarget.id}/role-assignments/${assignmentId}/revoke`;

    expect((await post(url, managerToken, {})).statusCode).toBe(400);
    expect((await post(url, managerToken, { reason: "" })).statusCode).toBe(400);
    expect((await post(url, managerToken, { reason: "   " })).statusCode).toBe(400);
    expect(
      (await post(url, managerToken, { reason: "x".repeat(501) })).statusCode,
    ).toBe(400);
    // Unknown keys are refused rather than silently ignored.
    expect(
      (await post(url, managerToken, { reason: "ok", extra: 1 })).statusCode,
    ).toBe(400);

    // Nothing was revoked by any rejected attempt.
    const row = await pool.query(
      `SELECT revoked_at FROM user_role_assignments WHERE id = $1`,
      [assignmentId],
    );
    expect(row.rows[0].revoked_at).toBeNull();
    expect(
      (await revoke(localTarget.id, assignmentId, managerToken, "valid")).statusCode,
    ).toBe(204);
  });

  it("keeps out-of-scope and foreign revocations indistinguishable from a missing row", async () => {
    const foreignAssignmentId = await createAssignment(
      otherTarget.id,
      (
        await pool.query(`SELECT id FROM roles WHERE tenant_id = $1`, [otherTenantId])
      ).rows[0].id as string,
      { scopeType: "tenant" },
    );

    // Another tenant's user+assignment, addressed from this tenant.
    expect(
      (await revoke(otherTarget.id, foreignAssignmentId, managerToken)).statusCode,
    ).toBe(404);
    // This tenant's user, another tenant's assignment id.
    const localTarget = await createUser(tenantId, "scope", await hashPassword(PASSWORD));
    expect(
      (await revoke(localTarget.id, foreignAssignmentId, managerToken)).statusCode,
    ).toBe(404);
    // Nonexistent assignment for a real user.
    expect(
      (await revoke(localTarget.id, randomUUID(), managerToken)).statusCode,
    ).toBe(404);
    // A caller from the other tenant cannot reach this tenant's rows either.
    const localAssignmentId = await createAssignment(
      localTarget.id,
      grantableRole.id,
      { scopeType: "tenant" },
      manager.id,
    );
    expect(
      (await revoke(localTarget.id, localAssignmentId, otherManagerToken)).statusCode,
    ).toBe(404);

    // The foreign row is untouched by any of those attempts.
    const foreignRow = await pool.query(
      `SELECT revoked_at FROM user_role_assignments WHERE id = $1`,
      [foreignAssignmentId],
    );
    expect(foreignRow.rows[0].revoked_at).toBeNull();
  });

  it("refuses revocation without admin.console.read or without user.role.manage", async () => {
    const localTarget = await createUser(tenantId, "gate", await hashPassword(PASSWORD));
    const assignmentId = await createAssignment(
      localTarget.id,
      grantableRole.id,
      { scopeType: "tenant" },
      manager.id,
    );

    const readerRole = await createRole(
      tenantId,
      `E4W3_READER_${codeStamp}`,
      "Epic 4 Wave 3 reader",
      ["admin.console.read", "user.read"],
    );
    const reader = await createUser(tenantId, "reader", await hashPassword(PASSWORD));
    await createAssignment(reader.id, readerRole.id, { scopeType: "tenant" });
    expect(
      (await revoke(localTarget.id, assignmentId, await tokenFor(tenantId, reader))).statusCode,
    ).toBe(403);

    const areaOnlyRole = await createRole(
      tenantId,
      `E4W3_AREA_ONLY_${codeStamp}`,
      "Epic 4 Wave 3 area only",
      ["user.role.manage", "user.read"],
    );
    const areaOnly = await createUser(tenantId, "area-only", await hashPassword(PASSWORD));
    await createAssignment(areaOnly.id, areaOnlyRole.id, { scopeType: "tenant" });
    expect(
      (await revoke(localTarget.id, assignmentId, await tokenFor(tenantId, areaOnly))).statusCode,
    ).toBe(403);

    expect((await revoke(localTarget.id, assignmentId, managerToken)).statusCode).toBe(204);
  });

  it("keeps revocation monotonic: an UPDATE cannot clear or rewrite its provenance", async () => {
    const localTarget = await createUser(tenantId, "monotonic", await hashPassword(PASSWORD));
    const assignmentId = await createAssignment(
      localTarget.id,
      grantableRole.id,
      { scopeType: "tenant" },
      manager.id,
    );
    const reason = "Original reason";
    expect((await revoke(localTarget.id, assignmentId, managerToken, reason)).statusCode).toBe(204);
    const revokedAt = (
      await pool.query(`SELECT revoked_at FROM user_role_assignments WHERE id = $1`, [
        assignmentId,
      ])
    ).rows[0].revoked_at as Date;

    // A later governed or maintenance UPDATE must not resurrect the grant nor
    // launder who revoked it.
    await pool.query(
      `UPDATE user_role_assignments
          SET revoked_at = NULL,
              revoked_by = NULL,
              revoke_reason = 'rewritten'
        WHERE id = $1`,
      [assignmentId],
    );

    const after = await pool.query(
      `SELECT revoked_at, revoked_by, revoke_reason
         FROM user_role_assignments WHERE id = $1`,
      [assignmentId],
    );
    expect(after.rows[0].revoked_by).toBe(manager.id);
    expect(after.rows[0].revoke_reason).toBe(reason);
    expect((after.rows[0].revoked_at as Date).getTime()).toBe(revokedAt.getTime());
    expect(
      (await rbacRepository.getEffectivePermissionCodes(localTarget.id)).has(
        "user.read",
      ),
    ).toBe(false);
  });

  it("still denies self-revocation and the final active tenant manager", async () => {
    // A holder cannot revoke their own tenant-manager grant, even while another
    // active holder exists.
    const backupRole = await createRole(
      tenantId,
      `E4W3_BACKUP_MANAGER_${codeStamp}`,
      "Epic 4 Wave 3 backup manager",
      MANAGER_PERMISSIONS,
    );
    const backup = await createUser(tenantId, "backup-manager", await hashPassword(PASSWORD));
    await createAssignment(backup.id, backupRole.id, { scopeType: "tenant" });

    const ownAssignment = (
      await pool.query(
        `SELECT id FROM user_role_assignments
          WHERE user_id = $1 AND role_id = $2 AND scope_type = 'tenant'
            AND revoked_at IS NULL`,
        [backup.id, backupRole.id],
      )
    ).rows[0].id as string;
    const selfRevoke = await revoke(
      backup.id,
      ownAssignment,
      await tokenFor(tenantId, backup),
      "self attempt",
    );
    expect(selfRevoke.statusCode).toBe(409);
    expect(selfRevoke.json().error).toMatch(/own tenant manager assignment/i);

    // The last-manager rule counts only TENANT-scope managers. An actor whose
    // user.role.manage grant is Organization-Unit-scoped can therefore reach a
    // tenant manager who is the last of their kind, and must be refused.
    const guard = await bootstrapTenant(
      app,
      GUARD_TENANT,
      "Tenant Epic 4 Wave 3 Guard",
    );
    const guardTenantId = guard.id;
    await activateAllModules(guardTenantId);

    const guardRole = await createRole(
      guardTenantId,
      `E4W3_OU_MANAGER_${codeStamp}`,
      "Epic 4 Wave 3 unit manager",
      MANAGER_PERMISSIONS,
    );
    const lastManagerRole = await createRole(
      guardTenantId,
      `E4W3_LAST_MANAGER_${codeStamp}`,
      "Epic 4 Wave 3 last manager",
      MANAGER_PERMISSIONS,
    );
    const organizationUnitId = await createOrganizationUnit(guardTenantId, "guard");

    const unitActor = await createUser(guardTenantId, "unit-actor", await hashPassword(PASSWORD));
    await createAssignment(unitActor.id, guardRole.id, {
      scopeType: "organization_unit",
      scopeOrganizationUnitId: organizationUnitId,
    });

    // The tenant's only tenant-scope manager, kept inside the actor's Data
    // Scope by a live Organization Unit assignment of their own.
    const lastManager = await createUser(guardTenantId, "last-manager", await hashPassword(PASSWORD));
    const lastManagerAssignmentId = await createAssignment(
      lastManager.id,
      lastManagerRole.id,
      { scopeType: "tenant" },
    );
    await createAssignment(lastManager.id, guardRole.id, {
      scopeType: "organization_unit",
      scopeOrganizationUnitId: organizationUnitId,
    });

    const finalManager = await revoke(
      lastManager.id,
      lastManagerAssignmentId,
      await tokenFor(guardTenantId, unitActor),
      "last manager attempt",
    );
    expect(finalManager.statusCode).toBe(409);
    expect(finalManager.json().error).toMatch(/final active tenant manager/i);

    const untouched = await pool.query(
      `SELECT revoked_at FROM user_role_assignments WHERE id = $1`,
      [lastManagerAssignmentId],
    );
    expect(untouched.rows[0].revoked_at).toBeNull();

    // The same actor CAN revoke the target's Organization Unit grant: the
    // guard protects the tenant manager role, not every grant the holder has.
    const unitAssignmentId = (
      await pool.query(
        `SELECT id FROM user_role_assignments
          WHERE user_id = $1 AND role_id = $2 AND scope_type = 'organization_unit'
            AND revoked_at IS NULL`,
        [lastManager.id, guardRole.id],
      )
    ).rows[0].id as string;
    expect(
      (
        await revoke(
          lastManager.id,
          unitAssignmentId,
          await tokenFor(guardTenantId, unitActor),
          "unit grant revoke",
        )
      ).statusCode,
    ).toBe(204);
  });
});
