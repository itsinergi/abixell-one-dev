/**
 * Epic 5 G3, enforcement batch (t_e1a1984c) — the authorization guards that
 * make the wave fail CLOSED on an inactive or deleted hierarchy entity.
 *
 * The sibling core suite (`epic-5-g3-legal-entity-scope.test.ts`) proves the
 * Legal Entity scope EXISTS and is enforced on reads of the projection. This
 * file proves the other half — what happens when an entity that confers or
 * receives authority stops being usable:
 *
 *   1. M13 (1789430000000): an assignment whose SCOPE Organization Unit is not
 *      `status = 'active'` leaves `authorization_effective_user_role_assignments`
 *      entirely — the same fail-closed rule M12 already applied to a Legal
 *      Entity scope;
 *   2. a live session loses its active assignment the moment its scope unit or
 *      scope Legal Entity is deactivated, and gets it back when the entity is
 *      reactivated (`resolveActor` re-resolves per request, so nothing is
 *      cached past the next call);
 *   3. a RETIRED (soft-deleted) Organization Unit is never a usable target;
 *   4. an inactive Legal Entity is refused as a TARGET for new work
 *      (`isActiveLegalEntityScopeCovered`) while its own aggregate stays
 *      manageable (`isLegalEntityScopeCovered`), so the lifecycle transitions
 *      that end the inactive state stay reachable;
 *   5. the list-narrowing helpers answer from the ACTIVE assignment only, cover
 *      the Legal Entity family, and exclude units that authorize nothing;
 *   6. the wiring on a real resource: Finance refuses an account booked into a
 *      sibling or inactive Legal Entity.
 *
 * Every group asserts `SELECT current_database()` first and refuses to run
 * against a production database by name.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { pool } from "../../src/infrastructure/persistence/db.js";
import { buildApp } from "../../src/app.js";
import {
  createSession,
  resolveActor,
} from "../../src/application/identity/session.service.js";
import { RbacService } from "../../src/application/rbac/rbac.service.js";
import { PgRbacRepository } from "../../src/infrastructure/persistence/repositories/rbac.repository.pg.js";
import { PgOrganizationUnitRepository } from "../../src/infrastructure/persistence/repositories/organization-unit.repository.pg.js";
import { PgLegalEntityRepository } from "../../src/infrastructure/persistence/repositories/legal-entity.repository.pg.js";
import type { ActorContext } from "../../src/domain/shared-kernel/audit-context.js";
import {
  activateAllModules,
  authHeader,
  bootstrapTenant,
  login,
  provisionFirstAdmin,
  sessionTokenFor,
} from "./helpers.js";

const STAMP = Date.now();
const TENANT = `g3enf-${STAMP}`;
const PASSWORD = "EpicFiveG3Enforce1!";

async function assertNonProductionDatabase(): Promise<string> {
  const { rows } = await pool.query<{ current_database: string }>(
    "SELECT current_database()",
  );
  const name = rows[0].current_database;
  console.log(`[G3 enforcement guard] current_database() = ${name}`);
  if (/prod|prd|production/i.test(name)) {
    throw new Error(`Refusing to run G3 enforcement verification against '${name}'`);
  }
  return name;
}

describe("Epic 5 G3 enforcement — fail closed on inactive or deleted hierarchy entities", () => {
  const app = buildApp();
  const rbac = new RbacService(
    new PgRbacRepository(pool),
    new PgOrganizationUnitRepository(pool),
    new PgLegalEntityRepository(pool),
  );

  let tenantId: string;
  let leAId: string;
  let leBId: string;
  let centralAId: string;
  let regionAId: string;
  let siteAId: string;
  let doomedUnitId: string;
  let centralBId: string;

  let financeRoleId: string;
  let scopedUserId: string;
  let scopedAssignmentId: string;
  let regionUserId: string;
  let regionAssignmentId: string;
  let adminUserId: string;

  async function insertLegalEntity(name: string): Promise<string> {
    const r = await pool.query(
      `INSERT INTO legal_entities (tenant_id, name) VALUES ($1, $2) RETURNING id`,
      [tenantId, name],
    );
    return r.rows[0].id as string;
  }

  async function insertUnit(
    legalEntityId: string,
    name: string,
    parentId: string | null,
  ): Promise<string> {
    const r = await pool.query(
      `INSERT INTO organization_units (tenant_id, legal_entity_id, parent_id, name, unit_type)
       VALUES ($1, $2, $3, $4, 'Site') RETURNING id`,
      [tenantId, legalEntityId, parentId, name],
    );
    return r.rows[0].id as string;
  }

  async function insertRole(code: string, permissionCodes: string[]): Promise<string> {
    const role = await pool.query(
      `INSERT INTO roles (tenant_id, code, name) VALUES ($1, $2, $2) RETURNING id`,
      [tenantId, code],
    );
    const roleId = role.rows[0].id as string;
    await pool.query(
      `INSERT INTO role_permissions (role_id, permission_id)
       SELECT $1, id FROM permissions WHERE code = ANY($2)`,
      [roleId, permissionCodes],
    );
    return roleId;
  }

  async function insertUser(email: string): Promise<string> {
    const r = await pool.query(
      `INSERT INTO users (tenant_id, email, password_hash, full_name)
       VALUES ($1, $2, 'not-a-real-hash', 'G3 Enforcement Fixture') RETURNING id`,
      [tenantId, email],
    );
    return r.rows[0].id as string;
  }

  async function insertAssignment(input: {
    userId: string;
    roleId: string;
    scopeType: "tenant" | "legal_entity" | "organization_unit";
    legalEntityId?: string | null;
    organizationUnitId?: string | null;
  }): Promise<string> {
    const r = await pool.query(
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
    return r.rows[0].id as string;
  }

  async function setUnitActive(unitId: string, isActive: boolean): Promise<void> {
    await pool.query(`UPDATE organization_units SET is_active = $2 WHERE id = $1`, [
      unitId,
      isActive,
    ]);
  }

  async function setLegalEntityActive(leId: string, isActive: boolean): Promise<void> {
    await pool.query(`UPDATE legal_entities SET is_active = $2 WHERE id = $1`, [
      leId,
      isActive,
    ]);
  }

  async function unitStatus(unitId: string): Promise<string> {
    const r = await pool.query<{ status: string }>(
      `SELECT status FROM organization_units WHERE id = $1`,
      [unitId],
    );
    return r.rows[0].status;
  }

  async function assignmentIsEffective(assignmentId: string): Promise<boolean> {
    const r = await pool.query(
      `SELECT 1 FROM authorization_effective_user_role_assignments WHERE id = $1`,
      [assignmentId],
    );
    return r.rows.length === 1;
  }

  async function actorFor(userId: string, assignmentId: string): Promise<ActorContext> {
    const sessionId = await createSession(pool, { userId, tenantId });
    await pool.query(`UPDATE sessions SET active_assignment_id = $2 WHERE id = $1`, [
      sessionId,
      assignmentId,
    ]);
    const actor = await resolveActor(pool, { sessionId, userId, tenantId });
    if (!actor) throw new Error("fixture actor did not resolve");
    return actor;
  }

  beforeAll(async () => {
    await assertNonProductionDatabase();

    const tenant = await bootstrapTenant(app, TENANT, "G3 Enforcement Tenant");
    tenantId = tenant.id;
    await activateAllModules(tenantId);
    const admin = await provisionFirstAdmin({
      tenantId,
      email: `admin-${STAMP}@g3enf.test`,
      password: PASSWORD,
    });
    adminUserId = admin.userId;

    leAId = await insertLegalEntity("Enforcement Legal Entity A");
    leBId = await insertLegalEntity("Enforcement Legal Entity B");
    centralAId = await insertUnit(leAId, "Central A", null);
    regionAId = await insertUnit(leAId, "Region A", centralAId);
    siteAId = await insertUnit(leAId, "Site A", regionAId);
    doomedUnitId = await insertUnit(leAId, "Doomed Unit", centralAId);
    centralBId = await insertUnit(leBId, "Central B", null);

    financeRoleId = await insertRole("G3_ENF_FINANCE", [
      "finance.configure",
      "finance.read",
    ]);

    scopedUserId = await insertUser(`enf-le-${STAMP}@g3enf.test`);
    scopedAssignmentId = await insertAssignment({
      userId: scopedUserId,
      roleId: financeRoleId,
      scopeType: "legal_entity",
      legalEntityId: leAId,
    });

    regionUserId = await insertUser(`enf-region-${STAMP}@g3enf.test`);
    regionAssignmentId = await insertAssignment({
      userId: regionUserId,
      roleId: financeRoleId,
      scopeType: "organization_unit",
      organizationUnitId: regionAId,
    });
  }, 120_000);

  afterAll(async () => {
    await pool.query(`DELETE FROM tenants WHERE id = $1`, [tenantId]);
    await app.close();
  });

  describe("M13 — the authorization projection refuses a non-active Organization Unit scope", () => {
    beforeAll(async () => {
      await assertNonProductionDatabase();
    });

    it("drops and restores an Organization Unit-scoped assignment with the unit's lifecycle", async () => {
      await expect(assignmentIsEffective(regionAssignmentId)).resolves.toBe(true);

      await setUnitActive(regionAId, false);
      expect(await unitStatus(regionAId)).toBe("inactive");
      await expect(assignmentIsEffective(regionAssignmentId)).resolves.toBe(false);

      await setUnitActive(regionAId, true);
      expect(await unitStatus(regionAId)).toBe("active");
      await expect(assignmentIsEffective(regionAssignmentId)).resolves.toBe(true);
    });

    it("keeps the pre-M13 predicate change visible in the installed view definition", async () => {
      const r = await pool.query<{ def: string }>(
        `SELECT pg_get_viewdef('authorization_effective_user_role_assignments'::regclass) AS def`,
      );
      expect(r.rows[0].def).toContain("ou.status = 'active'");
      expect(r.rows[0].def).toContain("ou.deleted_at IS NULL");
      expect(r.rows[0].def).toContain("le.is_active");
    });
  });

  describe("a live session loses and regains its authority with the scope entity", () => {
    beforeAll(async () => {
      await assertNonProductionDatabase();
    });

    it("refuses the permissioned route while the scope unit is inactive and serves it again after reactivation", async () => {
      const token = await sessionTokenFor({
        userId: regionUserId,
        tenantId,
        activeAssignmentId: regionAssignmentId,
      });

      const before = await app.inject({
        method: "GET",
        url: "/finance/accounts",
        headers: authHeader(token),
      });
      expect(before.statusCode).toBe(200);

      await setUnitActive(regionAId, false);
      const during = await app.inject({
        method: "GET",
        url: "/finance/accounts",
        headers: authHeader(token),
      });
      expect(during.statusCode).toBe(403);

      await setUnitActive(regionAId, true);
      const after = await app.inject({
        method: "GET",
        url: "/finance/accounts",
        headers: authHeader(token),
      });
      expect(after.statusCode).toBe(200);
    });

    it("loses the active assignment in the resolved context, not just at the route", async () => {
      await setUnitActive(regionAId, false);
      const sessionId = await createSession(pool, { userId: regionUserId, tenantId });
      await pool.query(`UPDATE sessions SET active_assignment_id = $2 WHERE id = $1`, [
        sessionId,
        regionAssignmentId,
      ]);
      const actor = await resolveActor(pool, {
        sessionId,
        userId: regionUserId,
        tenantId,
      });
      expect(actor).not.toBeNull();
      expect(actor!.assignmentId).toBeNull();
      expect(actor!.scopeType).toBeNull();
      await setUnitActive(regionAId, true);
    });
  });

  describe("coverage checks fail closed on inactive, deleted and cross-tenant entities", () => {
    beforeAll(async () => {
      await assertNonProductionDatabase();
    });

    it("refuses a RETIRED Organization Unit as a target for every scope family", async () => {
      const regionActor = await actorFor(regionUserId, regionAssignmentId);
      await expect(rbac.isActiveOrganizationUnitScopeCovered(regionActor, siteAId)).resolves.toBe(
        true,
      );

      await pool.query(`UPDATE organization_units SET deleted_at = now() WHERE id = $1`, [
        siteAId,
      ]);
      await expect(rbac.isActiveOrganizationUnitScopeCovered(regionActor, siteAId)).resolves.toBe(
        false,
      );

      await pool.query(`UPDATE organization_units SET deleted_at = NULL WHERE id = $1`, [siteAId]);
      await expect(rbac.isActiveOrganizationUnitScopeCovered(regionActor, siteAId)).resolves.toBe(
        true,
      );
    });

    it("voids an authority whose SCOPE unit is inactive, even from a stale ActorContext", async () => {
      const staleActor: ActorContext = {
        userId: regionUserId,
        tenantId,
        sessionId: "00000000-0000-0000-0000-000000000000",
        assignmentId: regionAssignmentId,
        roleId: financeRoleId,
        roleCode: "G3_ENF_FINANCE",
        scopeType: "organization_unit",
        scopeLegalEntityId: null,
        scopeOrganizationUnitId: regionAId,
        scopeCustomerId: null,
      };

      await expect(
        rbac.isActiveOrganizationUnitScopeCovered(staleActor, siteAId),
      ).resolves.toBe(true);

      await setUnitActive(regionAId, false);
      await expect(
        rbac.isActiveOrganizationUnitScopeCovered(staleActor, siteAId),
      ).resolves.toBe(false);
      await setUnitActive(regionAId, true);
    });

    it("refuses an inactive Legal Entity as a target while its own aggregate stays manageable", async () => {
      const adminToken = await sessionTokenFor({ userId: adminUserId, tenantId });
      const adminSessionId = await createSession(pool, { userId: adminUserId, tenantId });
      const adminActor = await resolveActor(pool, {
        sessionId: adminSessionId,
        userId: adminUserId,
        tenantId,
      });
      expect(adminActor!.scopeType).toBe("tenant");
      expect(adminToken.length).toBeGreaterThan(0);

      await setLegalEntityActive(leBId, false);
      // Target for NEW work: refused, even for a tenant-wide Role.
      await expect(
        rbac.isActiveLegalEntityScopeCovered(adminActor!, leBId),
      ).resolves.toBe(false);
      // The Legal Entity's own aggregate: still coverable, so its lifecycle can
      // be moved back out of the inactive state (no unsatisfiable guard).
      await expect(rbac.isLegalEntityScopeCovered(adminActor!, leBId)).resolves.toBe(true);
      await expect(
        rbac.requireLegalEntityScopeForActor(adminActor!, leBId),
      ).resolves.toBeUndefined();
      await expect(
        rbac.requireActiveLegalEntityScopeForActor(adminActor!, leBId),
      ).rejects.toThrow(/not active/);

      await setLegalEntityActive(leBId, true);
      await expect(
        rbac.isActiveLegalEntityScopeCovered(adminActor!, leBId),
      ).resolves.toBe(true);
    });
  });

  describe("list narrowing answers from the ACTIVE assignment", () => {
    beforeAll(async () => {
      await assertNonProductionDatabase();
    });

    it("narrows Organization Units by scope family and excludes unusable units", async () => {
      const adminSessionId = await createSession(pool, { userId: adminUserId, tenantId });
      const adminActor = await resolveActor(pool, {
        sessionId: adminSessionId,
        userId: adminUserId,
        tenantId,
      });
      await expect(rbac.listScopedOrganizationUnitIds(adminActor!)).resolves.toBeNull();

      const leActor = await actorFor(scopedUserId, scopedAssignmentId);
      const leScoped = await rbac.listScopedOrganizationUnitIds(leActor);
      expect(leScoped).toEqual(
        expect.arrayContaining([centralAId, regionAId, siteAId, doomedUnitId]),
      );
      expect(leScoped).not.toContain(centralBId);

      const regionActor = await actorFor(regionUserId, regionAssignmentId);
      const regionScoped = await rbac.listScopedOrganizationUnitIds(regionActor);
      // The scope unit and its descendants only: a sibling branch of the same
      // Legal Entity (Doomed Unit under Central A) is NOT covered, which is the
      // hierarchical rule ADR-0009 states.
      expect(regionScoped).toEqual(expect.arrayContaining([regionAId, siteAId]));
      expect(regionScoped).not.toContain(centralAId);
      expect(regionScoped).not.toContain(doomedUnitId);
      expect(regionScoped).not.toContain(centralBId);

      await setUnitActive(siteAId, false);
      const afterDeactivation = await rbac.listScopedOrganizationUnitIds(regionActor);
      expect(afterDeactivation).not.toContain(siteAId);
      await setUnitActive(siteAId, true);
    });

    it("fails closed to an empty list for an assignment-less or customer-scoped actor", async () => {
      const orphanUser = await insertUser(`enf-orphan-${STAMP}@g3enf.test`);
      const orphanSessionId = await createSession(pool, { userId: orphanUser, tenantId });
      const orphanActor = await resolveActor(pool, {
        sessionId: orphanSessionId,
        userId: orphanUser,
        tenantId,
      });
      expect(orphanActor!.assignmentId).toBeNull();
      await expect(rbac.listScopedOrganizationUnitIds(orphanActor!)).resolves.toEqual([]);
      await expect(rbac.listScopedLegalEntityIds(orphanActor!)).resolves.toEqual([]);

      const customerActor: ActorContext = {
        ...orphanActor!,
        assignmentId: regionAssignmentId,
        scopeType: "customer",
        scopeCustomerId: "00000000-0000-0000-0000-000000000001",
        scopeOrganizationUnitId: null,
      };
      await expect(rbac.listScopedOrganizationUnitIds(customerActor)).resolves.toEqual([]);
      await expect(rbac.listScopedLegalEntityIds(customerActor)).resolves.toEqual([]);
    });

    it("narrows Legal Entity reads: the whole Tenant, the scope Legal Entity, or the parent of a covered unit", async () => {
      const adminSessionId = await createSession(pool, { userId: adminUserId, tenantId });
      const adminActor = await resolveActor(pool, {
        sessionId: adminSessionId,
        userId: adminUserId,
        tenantId,
      });
      await expect(rbac.listScopedLegalEntityIds(adminActor!)).resolves.toBeNull();

      const leActor = await actorFor(scopedUserId, scopedAssignmentId);
      await expect(rbac.listScopedLegalEntityIds(leActor)).resolves.toEqual([leAId]);

      const regionActor = await actorFor(regionUserId, regionAssignmentId);
      await expect(rbac.listScopedLegalEntityIds(regionActor)).resolves.toEqual([leAId]);

      await setLegalEntityActive(leAId, false);
      // A Legal-Entity-scoped Role whose own scope Legal Entity is inactive
      // authorizes nothing, so it is shown nothing — not even the entity itself.
      await expect(rbac.listScopedLegalEntityIds(leActor)).resolves.toEqual([]);
      await setLegalEntityActive(leAId, true);
      await expect(rbac.listScopedLegalEntityIds(leActor)).resolves.toEqual([leAId]);
    });
  });

  describe("resource wiring — Finance refuses a Legal Entity outside the scope or closed", () => {
    beforeAll(async () => {
      await assertNonProductionDatabase();
    });

    it("accepts an account inside the scope Legal Entity", async () => {
      const token = await sessionTokenFor({
        userId: scopedUserId,
        tenantId,
        activeAssignmentId: scopedAssignmentId,
      });
      const response = await app.inject({
        method: "POST",
        url: "/finance/accounts",
        headers: authHeader(token),
        payload: {
          code: `ENF-A-${STAMP}`,
          name: "Enforcement Account A",
          accountType: "cash",
          currency: "IDR",
          legalEntityId: leAId,
        },
      });
      expect(response.statusCode).toBe(201);
    });

    it("refuses an account booked into a sibling Legal Entity of the same Tenant", async () => {
      const token = await sessionTokenFor({
        userId: scopedUserId,
        tenantId,
        activeAssignmentId: scopedAssignmentId,
      });
      const response = await app.inject({
        method: "POST",
        url: "/finance/accounts",
        headers: authHeader(token),
        payload: {
          code: `ENF-B-${STAMP}`,
          name: "Enforcement Account B",
          accountType: "cash",
          currency: "IDR",
          legalEntityId: leBId,
        },
      });
      expect(response.statusCode).toBe(403);
    });

    it("refuses an account booked into an INACTIVE Legal Entity even for a tenant-wide Role", async () => {
      const adminLogin = await login(app, TENANT, `admin-${STAMP}@g3enf.test`, PASSWORD);
      expect(adminLogin.statusCode).toBe(200);
      const adminToken = adminLogin.body.accessToken as string;

      await setLegalEntityActive(leBId, false);
      const refused = await app.inject({
        method: "POST",
        url: "/finance/accounts",
        headers: authHeader(adminToken),
        payload: {
          code: `ENF-C-${STAMP}`,
          name: "Enforcement Account C",
          accountType: "cash",
          currency: "IDR",
          legalEntityId: leBId,
        },
      });
      expect(refused.statusCode).toBe(403);

      const allowed = await app.inject({
        method: "POST",
        url: "/finance/accounts",
        headers: authHeader(adminToken),
        payload: {
          code: `ENF-D-${STAMP}`,
          name: "Enforcement Account D",
          accountType: "cash",
          currency: "IDR",
          legalEntityId: leAId,
        },
      });
      expect(allowed.statusCode).toBe(201);
      await setLegalEntityActive(leBId, true);
    });
  });
});
