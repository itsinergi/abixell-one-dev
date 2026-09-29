/**
 * Epic 5 Gelombang 3 (§4.5 steps 14–15) — the `legal_entity` Data Scope core.
 *
 * G0 contract `docs/plans/epic-5-g0-contract.md` migrations M10 (1789400000000),
 * M11 (1789410000000) and M12 (1789420000000). This suite is the CORE half of
 * Wave 3: schema, session context, the authorization-effective projection, the
 * tenant → Legal Entity → Organization Unit coverage chain and the
 * same-assignment rule. Resource-by-resource enforcement is the sibling card's
 * scope; this file only proves the core it consumes is correct and closed.
 *
 * The acceptance probes are the contract's own (A5–A8):
 *
 *   A5  Legal Entity scope covers every Organization Unit inside it;
 *   A6  … and none of a SIBLING Legal Entity's;
 *   A7  permission from one assignment + scope from another is refused
 *       (same-assignment rule) even though the union holds the permission;
 *   A8  the projection is the enforcement source, not the request body.
 *
 * Every group asserts `SELECT current_database()` first and refuses to run
 * against a production database by name. All fixtures hang off Tenants this
 * file creates; the teardown deletes them, which is also the referential-chain
 * probe for the new `scope_legal_entity_id` FK.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { pool } from "../../src/infrastructure/persistence/db.js";
import { buildApp } from "../../src/app.js";
import { createSession, resolveActor, switchSessionRole } from "../../src/application/identity/session.service.js";
import { RbacService } from "../../src/application/rbac/rbac.service.js";
import { PgRbacRepository } from "../../src/infrastructure/persistence/repositories/rbac.repository.pg.js";
import { PgOrganizationUnitRepository } from "../../src/infrastructure/persistence/repositories/organization-unit.repository.pg.js";
import { PgLegalEntityRepository } from "../../src/infrastructure/persistence/repositories/legal-entity.repository.pg.js";
import { requireTransactionActorPermission } from "../../src/infrastructure/persistence/repositories/governed-transaction.js";
import {
  activateAllModules,
  authHeader,
  bootstrapTenant,
  login,
  provisionFirstAdmin,
  sessionTokenFor,
} from "./helpers.js";

const STAMP = Date.now();
/** Tenant `code` is capped at 32 characters, so the readable stem is short. */
const TENANT = `g3core-${STAMP}`;
const OTHER_TENANT = `g3other-${STAMP}`;
const PASSWORD = "EpicFiveG3Pass123!";

/** Card-mandated guard: name the database, refuse production, and leave the
 * name in the captured output as evidence. */
async function assertNonProductionDatabase(): Promise<string> {
  const { rows } = await pool.query<{ current_database: string }>(
    "SELECT current_database()",
  );
  const name = rows[0].current_database;
  console.log(`[G3 guard] current_database() = ${name}`);
  if (/prod|prd|production/i.test(name)) {
    throw new Error(`Refusing to run Epic 5 G3 verification against '${name}'`);
  }
  return name;
}

describe("Epic 5 G3 — legal_entity scope core (§4.5 steps 14–15)", () => {
  const app = buildApp();
  const rbacRepo = new PgRbacRepository(pool);
  const rbac = new RbacService(rbacRepo, new PgOrganizationUnitRepository(pool), new PgLegalEntityRepository(pool));

  let tenantId: string;
  let otherTenantId: string;
  let adminUserId: string;
  let leAId: string;
  let leBId: string;
  let centralAId: string;
  let regionAId: string;
  let centralBId: string;
  let otherTenantLeId: string;
  let leUserId: string;
  let leAssignmentId: string;
  let permUserId: string;
  let permTenantAssignmentId: string;
  let permLeAssignmentId: string;
  let targetUserId: string;
  let targetInLeAUserId: string;
  let adminToken: string;

  async function insertLegalEntity(tenant: string, name: string): Promise<string> {
    const result = await pool.query(
      `INSERT INTO legal_entities (tenant_id, name) VALUES ($1, $2) RETURNING id`,
      [tenant, name],
    );
    return result.rows[0].id as string;
  }

  async function insertUnit(
    tenant: string,
    legalEntityId: string,
    name: string,
    parentId: string | null,
  ): Promise<string> {
    const result = await pool.query(
      `INSERT INTO organization_units (tenant_id, legal_entity_id, parent_id, name, unit_type)
       VALUES ($1, $2, $3, $4, 'Site') RETURNING id`,
      [tenant, legalEntityId, parentId, name],
    );
    return result.rows[0].id as string;
  }

  async function insertRole(
    tenant: string,
    code: string,
    permissionCodes: string[],
  ): Promise<string> {
    const role = await pool.query(
      `INSERT INTO roles (tenant_id, code, name) VALUES ($1, $2, $2) RETURNING id`,
      [tenant, code],
    );
    const roleId = role.rows[0].id as string;
    if (permissionCodes.length > 0) {
      await pool.query(
        `INSERT INTO role_permissions (role_id, permission_id)
         SELECT $1, id FROM permissions WHERE code = ANY($2)`,
        [roleId, permissionCodes],
      );
    }
    return roleId;
  }

  async function insertUser(tenant: string, email: string): Promise<string> {
    const result = await pool.query(
      `INSERT INTO users (tenant_id, email, password_hash, full_name)
       VALUES ($1, $2, 'not-a-real-hash', 'G3 Fixture') RETURNING id`,
      [tenant, email],
    );
    return result.rows[0].id as string;
  }

  async function insertAssignment(input: {
    userId: string;
    roleId: string;
    scopeType: "tenant" | "legal_entity" | "organization_unit";
    legalEntityId?: string | null;
    organizationUnitId?: string | null;
  }): Promise<string> {
    const result = await pool.query(
      `INSERT INTO user_role_assignments
         (user_id, role_id, scope_type, scope_legal_entity_id, scope_organization_unit_id)
       VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [
        input.userId,
        input.roleId,
        input.scopeType,
        input.legalEntityId ?? null,
        input.organizationUnitId ?? null,
      ],
    );
    return result.rows[0].id as string;
  }

  beforeAll(async () => {
    await assertNonProductionDatabase();

    const tenant = await bootstrapTenant(app, TENANT, "G3 Scope Tenant");
    tenantId = tenant.id;
    await activateAllModules(tenantId);
    const admin = await provisionFirstAdmin({
      tenantId,
      email: `admin-${STAMP}@g3.test`,
      password: PASSWORD,
    });
    adminUserId = admin.userId;

    const other = await bootstrapTenant(app, OTHER_TENANT, "G3 Other Tenant");
    otherTenantId = other.id;

    leAId = await insertLegalEntity(tenantId, "G3 Legal Entity A");
    leBId = await insertLegalEntity(tenantId, "G3 Legal Entity B");
    otherTenantLeId = await insertLegalEntity(otherTenantId, "G3 Foreign Legal Entity");

    centralAId = await insertUnit(tenantId, leAId, "Central A", null);
    regionAId = await insertUnit(tenantId, leAId, "Region A", centralAId);
    centralBId = await insertUnit(tenantId, leBId, "Central B", null);

    const leManagerRoleId = await insertRole(tenantId, "G3_LE_MANAGER", [
      "organization_unit.update",
      "user.read",
      "admin.console.read",
      "user.role.manage",
    ]);
    const tenantWriterRoleId = await insertRole(tenantId, "G3_TENANT_WRITER", [
      "organization_unit.update",
    ]);
    const viewerRoleId = await insertRole(tenantId, "G3_VIEWER", []);

    leUserId = await insertUser(tenantId, `le-${STAMP}@g3.test`);
    leAssignmentId = await insertAssignment({
      userId: leUserId,
      roleId: leManagerRoleId,
      scopeType: "legal_entity",
      legalEntityId: leAId,
    });

    // The same-assignment probe's user: the permission lives on a tenant-scoped
    // assignment, the ACTIVE one is a Legal Entity-scoped assignment that does
    // not carry it.
    permUserId = await insertUser(tenantId, `perm-${STAMP}@g3.test`);
    permTenantAssignmentId = await insertAssignment({
      userId: permUserId,
      roleId: tenantWriterRoleId,
      scopeType: "tenant",
    });
    permLeAssignmentId = await insertAssignment({
      userId: permUserId,
      roleId: viewerRoleId,
      scopeType: "legal_entity",
      legalEntityId: leAId,
    });

    targetUserId = await insertUser(tenantId, `target-${STAMP}@g3.test`);

    // A second target whose only live assignment sits INSIDE Legal Entity A,
    // so a Legal Entity A-scoped administrator can see them — the shape the
    // delegation refusals are about. `targetUserId` above belongs to Legal
    // Entity B, which makes them the out-of-visibility probe.
    targetInLeAUserId = await insertUser(tenantId, `target-a-${STAMP}@g3.test`);
    await insertAssignment({
      userId: targetInLeAUserId,
      roleId: viewerRoleId,
      scopeType: "legal_entity",
      legalEntityId: leAId,
    });

    const adminLogin = await login(app, TENANT, `admin-${STAMP}@g3.test`, PASSWORD);
    expect(adminLogin.statusCode).toBe(200);
    adminToken = adminLogin.body.accessToken as string;
  }, 120_000);

  afterAll(async () => {
    await pool.query(`DELETE FROM tenants WHERE id = ANY($1::uuid[])`, [
      [tenantId, otherTenantId],
    ]);
    await app.close();
  });

  describe("M10/M11/M12 — schema, session column and projection", () => {
    beforeAll(async () => {
      await assertNonProductionDatabase();
    });

    it("installs the scope column, one consistency CHECK and the legal_entity branch of the guard", async () => {
      const column = await pool.query(
        `SELECT is_nullable FROM information_schema.columns
          WHERE table_name = 'user_role_assignments'
            AND column_name = 'scope_legal_entity_id'`,
      );
      expect(column.rows).toHaveLength(1);
      expect(column.rows[0].is_nullable).toBe("YES");

      const constraints = await pool.query<{ conname: string }>(
        `SELECT conname FROM pg_constraint
          WHERE conrelid = 'user_role_assignments'::regclass
            AND conname IN (
              'user_role_assignments_scope_consistency_check',
              'user_role_assignments_scope_type_check',
              'user_role_assignments_scope_org_unit_required_check',
              'user_role_assignments_scope_legal_entity_id_fkey'
            )
          ORDER BY conname`,
      );
      expect(constraints.rows.map((r) => r.conname)).toEqual([
        "user_role_assignments_scope_consistency_check",
        "user_role_assignments_scope_legal_entity_id_fkey",
      ]);

      const sessionColumn = await pool.query(
        `SELECT 1 FROM information_schema.columns
          WHERE table_name = 'sessions' AND column_name = 'scope_legal_entity_id'`,
      );
      expect(sessionColumn.rows).toHaveLength(1);

      const viewColumn = await pool.query(
        `SELECT 1 FROM information_schema.columns
          WHERE table_name = 'authorization_effective_user_role_assignments'
            AND column_name = 'scope_legal_entity_id'`,
      );
      expect(viewColumn.rows).toHaveLength(1);

      const stamps = await pool.query<{ name: string }>(
        `SELECT name FROM pgmigrations WHERE name LIKE '%epic-5-g3%' ORDER BY name`,
      );
      expect(stamps.rows.map((r) => r.name)).toEqual([
        "1789400000000_epic-5-g3-legal-entity-scope",
        "1789410000000_epic-5-g3-session-legal-entity-scope",
        "1789420000000_epic-5-g3-authorization-effective-view",
        // Enforcement batch (t_e1a1984c): the Organization Unit branch of the
        // projection now requires an ACTIVE scope unit, closing the asymmetry
        // M12 deliberately left open for the Legal Entity family.
        "1789430000000_epic-5-g3-organization-unit-scope-active",
      ]);
    });

    it("refuses a scope/target combination the consistency CHECK does not allow", async () => {
      const roleId = await insertRole(tenantId, "G3_CHECK_PROBE", []);
      await expect(
        pool.query(
          `INSERT INTO user_role_assignments
             (user_id, role_id, scope_type, scope_legal_entity_id, scope_organization_unit_id)
           VALUES ($1, $2, 'legal_entity', $3, $4)`,
          [targetUserId, roleId, leAId, centralAId],
        ),
      ).rejects.toThrow(/user_role_assignments_scope_consistency_check/);
    });
  });

  describe("A8 — the authorization-effective projection is the enforcement source", () => {
    beforeAll(async () => {
      await assertNonProductionDatabase();
    });

    it("returns the Legal Entity-scoped row, and drops it while the Legal Entity is not active", async () => {
      const granted = await pool.query<{ scope_legal_entity_id: string | null }>(
        `SELECT scope_legal_entity_id
           FROM authorization_effective_user_role_assignments
          WHERE id = $1`,
        [leAssignmentId],
      );
      expect(granted.rows).toHaveLength(1);
      expect(granted.rows[0].scope_legal_entity_id).toBe(leAId);

      await pool.query(`UPDATE legal_entities SET is_active = false WHERE id = $1`, [leAId]);
      const deactivated = await pool.query(
        `SELECT 1 FROM authorization_effective_user_role_assignments WHERE id = $1`,
        [leAssignmentId],
      );
      expect(deactivated.rows).toHaveLength(0);

      await pool.query(`UPDATE legal_entities SET is_active = true WHERE id = $1`, [leAId]);
      const reactivated = await pool.query(
        `SELECT 1 FROM authorization_effective_user_role_assignments WHERE id = $1`,
        [leAssignmentId],
      );
      expect(reactivated.rows).toHaveLength(1);
    });

    it("invalidates a cross-Tenant Legal Entity reference at write time and grants nothing", async () => {
      const roleId = await insertRole(tenantId, "G3_FOREIGN_PROBE", []);
      const assignmentId = await insertAssignment({
        userId: targetUserId,
        roleId,
        scopeType: "legal_entity",
        legalEntityId: otherTenantLeId,
      });

      const stored = await pool.query<{ scope_invalidated_at: Date | null }>(
        `SELECT scope_invalidated_at FROM user_role_assignments WHERE id = $1`,
        [assignmentId],
      );
      // The 1775000000000 guard, extended by M10: a target outside the
      // assignment User's Tenant makes the row authorization-inert instead of
      // raising, exactly as it already did for organization_unit and customer.
      expect(stored.rows[0].scope_invalidated_at).not.toBeNull();

      const effective = await pool.query(
        `SELECT 1 FROM authorization_effective_user_role_assignments WHERE id = $1`,
        [assignmentId],
      );
      expect(effective.rows).toHaveLength(0);
    });
  });

  describe("M11 — active session context carries the scope", () => {
    beforeAll(async () => {
      await assertNonProductionDatabase();
    });

    it("resolves the Legal Entity scope from the session's active assignment", async () => {
      const sessionId = await createSession(pool, { userId: leUserId, tenantId });
      const actor = await resolveActor(pool, { sessionId, userId: leUserId, tenantId });

      expect(actor).not.toBeNull();
      expect(actor!.scopeType).toBe("legal_entity");
      expect(actor!.scopeLegalEntityId).toBe(leAId);
      expect(actor!.scopeOrganizationUnitId).toBeNull();

      const sessionRow = await pool.query<{ scope_legal_entity_id: string | null }>(
        `SELECT scope_legal_entity_id FROM sessions WHERE id = $1`,
        [sessionId],
      );
      expect(sessionRow.rows[0].scope_legal_entity_id).toBe(leAId);
    });

    it("moves the mirrored scope column on switch-role", async () => {
      const sessionId = await createSession(pool, {
        userId: permUserId,
        tenantId,
      });
      await switchSessionRole(pool, {
        sessionId,
        userId: permUserId,
        tenantId,
        assignmentId: permLeAssignmentId,
      });

      const sessionRow = await pool.query<{
        scope_legal_entity_id: string | null;
        organization_unit_id: string | null;
      }>(
        `SELECT scope_legal_entity_id, organization_unit_id FROM sessions WHERE id = $1`,
        [sessionId],
      );
      expect(sessionRow.rows[0].scope_legal_entity_id).toBe(leAId);
      expect(sessionRow.rows[0].organization_unit_id).toBeNull();

      const backToTenant = await switchSessionRole(pool, {
        sessionId,
        userId: permUserId,
        tenantId,
        assignmentId: permTenantAssignmentId,
      });
      expect(backToTenant.scopeType).toBe("tenant");
      expect(backToTenant.scopeLegalEntityId).toBeNull();
    });
  });

  describe("A5/A6 — the coverage chain tenant → Legal Entity → Organization Unit", () => {
    beforeAll(async () => {
      await assertNonProductionDatabase();
    });

    it("covers every unit inside the Legal Entity and no unit of a sibling", async () => {
      const sessionId = await createSession(pool, { userId: leUserId, tenantId });
      const actor = await resolveActor(pool, { sessionId, userId: leUserId, tenantId });

      // A5 — inside the same Legal Entity, including a descendant.
      await expect(
        rbac.isActiveOrganizationUnitScopeCovered(actor!, regionAId),
      ).resolves.toBe(true);
      await expect(
        rbac.isActiveOrganizationUnitScopeCovered(actor!, centralAId),
      ).resolves.toBe(true);

      // A6 — the sibling Legal Entity of the SAME Tenant is never covered.
      await expect(
        rbac.isActiveOrganizationUnitScopeCovered(actor!, centralBId),
      ).resolves.toBe(false);

      await expect(rbac.isActiveLegalEntityScopeCovered(actor!, leAId)).resolves.toBe(true);
      await expect(rbac.isActiveLegalEntityScopeCovered(actor!, leBId)).resolves.toBe(false);

      // The enforced form: permission AND scope from the same active assignment.
      await expect(
        rbac.requireOrganizationUnitScopedPermissionForActor(
          actor!,
          "organization_unit.update",
          regionAId,
        ),
      ).resolves.toBeUndefined();
      await expect(
        rbac.requireOrganizationUnitScopedPermissionForActor(
          actor!,
          "organization_unit.update",
          centralBId,
        ),
      ).rejects.toThrow(/Data Scope/);
    });

    it("A7 — permission from one assignment never combines with the scope of another", async () => {
      // The union of the user's permissions DOES hold the code …
      const union = await rbac.getEffectivePermissions(permUserId);
      expect(union.has("organization_unit.update")).toBe(true);

      // … but the session's ACTIVE assignment must be the Legal Entity-scoped
      // one that does not carry it. The default pick is by Role NAME, so the
      // test states which context it means instead of assuming it.
      const sessionId = await createSession(pool, { userId: permUserId, tenantId });
      await switchSessionRole(pool, {
        sessionId,
        userId: permUserId,
        tenantId,
        assignmentId: permLeAssignmentId,
      });
      const actor = await resolveActor(pool, { sessionId, userId: permUserId, tenantId });
      expect(actor!.scopeType).toBe("legal_entity");

      await expect(
        rbac.requireOrganizationUnitScopedPermissionForActor(
          actor!,
          "organization_unit.update",
          regionAId,
        ),
      ).rejects.toThrow(/permission/);
    });
  });

  describe("R10 — the governed write gate covers an Organization Unit and a Legal Entity target", () => {
    beforeAll(async () => {
      await assertNonProductionDatabase();
    });

    it("allows the Legal Entity-scoped actor inside its own Legal Entity and refuses the sibling", async () => {
      const sessionId = await createSession(pool, { userId: leUserId, tenantId });
      const actor = await resolveActor(pool, { sessionId, userId: leUserId, tenantId });
      const governedActor = {
        tenantId: actor!.tenantId,
        userId: actor!.userId,
        assignmentId: actor!.assignmentId,
      };

      const client = await pool.connect();
      try {
        await client.query("BEGIN");

        // An Organization Unit target inside the Legal Entity resolves to that
        // Legal Entity and is covered.
        await expect(
          requireTransactionActorPermission(
            client,
            governedActor,
            "organization_unit.update",
            regionAId,
          ),
        ).resolves.toBeUndefined();

        // The explicit Legal Entity target form.
        await expect(
          requireTransactionActorPermission(
            client,
            governedActor,
            "organization_unit.update",
            undefined,
            leAId,
          ),
        ).resolves.toBeUndefined();

        // A unit of the sibling Legal Entity is outside the scope, even though
        // the same permission is held.
        await expect(
          requireTransactionActorPermission(
            client,
            governedActor,
            "organization_unit.update",
            centralBId,
          ),
        ).rejects.toThrow(/Data Scope/);

        // A tenant-wide target is still tenant-only authority.
        await expect(
          requireTransactionActorPermission(
            client,
            governedActor,
            "organization_unit.update",
          ),
        ).rejects.toThrow(/Data Scope/);
      } finally {
        await client.query("ROLLBACK");
        client.release();
      }
    });
  });

  describe("HTTP — the governed surface writes and refuses the same scopes", () => {
    beforeAll(async () => {
      await assertNonProductionDatabase();
    });

    it("grants a Legal Entity scope through POST /admin/users/:id/role-assignments", async () => {
      const roleId = await insertRole(tenantId, "G3_GRANTABLE", ["organization_unit.update"]);

      const response = await app.inject({
        method: "POST",
        url: `/admin/users/${targetUserId}/role-assignments`,
        headers: authHeader(adminToken),
        payload: {
          roleCode: "G3_GRANTABLE",
          scopeType: "legal_entity",
          scopeLegalEntityId: leBId,
        },
      });
      expect(response.statusCode).toBe(201);
      const body = response.json();
      expect(body.scopeType).toBe("legal_entity");
      expect(body.scopeLegalEntityId).toBe(leBId);
      expect(body.scopeLegalEntityName).toBe("G3 Legal Entity B");
      expect(body.scopeState).toBe("available");

      const stored = await pool.query<{ scope_legal_entity_id: string | null }>(
        `SELECT scope_legal_entity_id FROM user_role_assignments WHERE id = $1`,
        [body.id],
      );
      expect(stored.rows[0].scope_legal_entity_id).toBe(leBId);

      // The role above still exists and is the only thing the assertion needed.
      expect(roleId).toBeTruthy();
    });

    it("refuses a tenant-wide grant from a Legal Entity-scoped actor", async () => {
      const leToken = await sessionTokenFor({ userId: leUserId, tenantId });

      const me = await app.inject({
        method: "GET",
        url: "/me",
        headers: authHeader(leToken),
      });
      expect(me.statusCode).toBe(200);
      // A Legal Entity scope is INTERNAL: the caller must not be classified as
      // an external Customer User by the §4.3 filter.
      expect(me.json().scopeTypes).toEqual(["legal_entity"]);
      expect(me.json().activeScopeName).toBe("G3 Legal Entity A");

      const refused = await app.inject({
        method: "POST",
        url: `/admin/users/${targetInLeAUserId}/role-assignments`,
        headers: authHeader(leToken),
        payload: { roleCode: "G3_GRANTABLE", scopeType: "tenant" },
      });
      // Visible target, undersized authority: 403, and for the tenant-wide
      // reason rather than a missing permission.
      expect(refused.statusCode).toBe(403);

      // The out-of-scope target stays indistinguishable from a missing one
      // (§4.4 risk row 1): a User whose assignments all sit in the sibling
      // Legal Entity is 404, not 403.
      const invisible = await app.inject({
        method: "POST",
        url: `/admin/users/${targetUserId}/role-assignments`,
        headers: authHeader(leToken),
        payload: { roleCode: "G3_GRANTABLE", scopeType: "legal_entity", scopeLegalEntityId: leAId },
      });
      expect(invisible.statusCode).toBe(404);
    });

    it("lists the in-scope target and hides the out-of-scope one (§4.4 step 16 narrowing)", async () => {
      const leToken = await sessionTokenFor({ userId: leUserId, tenantId });
      const list = await app.inject({
        method: "GET",
        url: "/admin/users",
        headers: authHeader(leToken),
      });
      expect(list.statusCode).toBe(200);
      const ids = (list.json() as Array<{ id: string }>).map((row) => row.id);
      // The read path and the write path must agree about which Users exist:
      // a target whose only assignment is inside the actor's Legal Entity is
      // listed, and one whose assignments all sit in the sibling is not.
      expect(ids).toContain(targetInLeAUserId);
      expect(ids).not.toContain(targetUserId);
    });
  });

  describe("A8 — assignment options expose only the Legal Entities the actor may scope to", () => {
    beforeAll(async () => {
      await assertNonProductionDatabase();
    });

    it("offers every active Legal Entity to a tenant-wide actor", async () => {
      const sessionId = await createSession(pool, { userId: adminUserId, tenantId });
      const actor = await resolveActor(pool, { sessionId, userId: adminUserId, tenantId });
      const options = await rbacRepo.listAssignmentOptions({
        tenantId: actor!.tenantId,
        userId: actor!.userId,
        assignmentId: actor!.assignmentId,
      });

      const byId = new Map(options.legalEntities.map((entry) => [entry.id, entry]));
      expect(byId.get(leAId)?.selectable).toBe(true);
      expect(byId.get(leBId)?.selectable).toBe(true);
      expect(byId.get(leAId)?.name).toBe("G3 Legal Entity A");
      // A foreign Legal Entity is not listed at all.
      expect(byId.has(otherTenantLeId)).toBe(false);
    });
  });
});
