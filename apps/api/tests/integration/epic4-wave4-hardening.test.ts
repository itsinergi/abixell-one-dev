import { randomUUID } from "node:crypto";
import type { InjectPayload } from "light-my-request";
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
 * Epic 4 Wave 4 — CORE-ROADMAP.md §4.4 steps 22–25.
 *
 * 22: a permission whose module is inactive produces the SAME refusal on the
 *     single-assignment route and the batch route, worded as a module problem,
 *     not folded into a delegation refusal.
 * 23: the four write refusals stay distinguishable: missing permission (403),
 *     inactive module (400), target outside Data Scope (404, indistinguishable
 *     from missing), and an invalid Role/scope target (404 by name).
 * 24: the regression matrix — tenant-wide manager, Organization-Unit-scoped
 *     (region) manager, and a User with no assignment at all.
 * 25: the user-centric and assignment-centric surfaces answer with one
 *     policy: the same rows, the same lifecycle state, and — the case this
 *     wave had to fix — the same visibility, so a revoked Organization Unit
 *     grant stops conferring write reach exactly where it stops conferring
 *     read reach.
 *
 * Fixture setup is direct SQL: the governed HTTP surface is what is under
 * test, and manufacturing actors through it would make the assertions
 * circular.
 */

const stamp = `${Date.now().toString(36)}_${process.pid}_${randomUUID().replaceAll("-", "").slice(0, 8)}`;
const codeStamp = stamp.toUpperCase();
const TENANT = `e4w4-${stamp}`;
const PASSWORD = "Passw0rd12345!";

/** Permissions whose combined presence defines the assignment-delegation
 * ceiling for these fixtures. A role carrying `user.role.manage` contributes
 * ALL of its permissions to what its holder may grant. */
const MANAGER_PERMISSIONS = [
  "admin.console.read",
  "user.read",
  "config.read",
  "user.role.manage",
];

const app = buildApp();

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
  const email = `${localName}.${stamp}@e4w4.local`;
  const result = await pool.query(
    `INSERT INTO users (tenant_id, email, password_hash, full_name)
     VALUES ($1, $2, $3, $4)
     RETURNING id, email`,
    [tenantId, email, passwordHash, `Epic 4 Wave 4 ${localName}`],
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
    [tenantId, `E4W4 Legal Entity ${suffix}`],
  );
  const organizationUnit = await pool.query(
    `INSERT INTO organization_units (tenant_id, legal_entity_id, name, unit_type)
     VALUES ($1, $2, $3, 'Branch')
     RETURNING id`,
    [tenantId, legalEntity.rows[0].id, `E4W4 Organization Unit ${suffix}`],
  );
  return organizationUnit.rows[0].id as string;
}

async function createAssignment(
  userId: string,
  roleId: string,
  scope:
    | { scopeType: "tenant" }
    | { scopeType: "organization_unit"; scopeOrganizationUnitId: string },
  createdBy: string | null = null,
): Promise<string> {
  const result = await pool.query(
    `INSERT INTO user_role_assignments
       (user_id, role_id, scope_type, scope_organization_unit_id, created_by)
     VALUES ($1, $2, $3, $4, $5)
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

async function inject(
  method: "GET" | "POST",
  url: string,
  token: string | null,
  payload?: InjectPayload,
) {
  return app.inject({
    method,
    url,
    headers: token ? authHeader(token) : undefined,
    payload,
  });
}

async function setModuleActive(
  tenantId: string,
  moduleCode: string,
  isActive: boolean,
) {
  await pool.query(
    `INSERT INTO tenant_module_activations (tenant_id, module_id, is_active)
     SELECT $1, m.id, $3 FROM modules m WHERE m.code = $2
     ON CONFLICT (tenant_id, module_id) DO UPDATE SET is_active = $3`,
    [tenantId, moduleCode, isActive],
  );
}

describe("Epic 4 Wave 4 — module feedback and hardening", () => {
  let tenantId: string;
  let passwordHash: string;

  let tenantManager: UserFixture;
  let tenantManagerToken: string;
  let regionManager: UserFixture;
  let regionManagerToken: string;
  let bareUser: UserFixture;
  let bareUserToken: string;

  let nearUnit: string;
  let otherNearUnit: string;
  let farUnit: string;

  let plainRole: { id: string; code: string; name: string };
  let hseRole: { id: string; code: string; name: string };
  let outOfCeilingRole: { id: string; code: string; name: string };

  let grantor: UserFixture;
  let grantorToken: string;
  /** Anchored in `nearUnit` — visible to both the tenant manager and the
   * region manager. */
  let nearTarget: UserFixture;
  /** Anchored only in `farUnit` — visible to the tenant manager, not the
   * region manager. */
  let farTarget: UserFixture;

  beforeAll(async () => {
    passwordHash = await hashPassword(PASSWORD);

    const primary = await bootstrapTenant(app, TENANT, "Tenant Epic 4 Wave 4");
    tenantId = primary.id;
    await activateAllModules(tenantId);
    await provisionFirstAdmin({
      tenantId,
      email: `e4w4-admin.${stamp}@e4w4.local`,
      password: PASSWORD,
    });

    nearUnit = await createOrganizationUnit(tenantId, "near");
    otherNearUnit = await createOrganizationUnit(tenantId, "other-near");
    farUnit = await createOrganizationUnit(tenantId, "far");

    // Step 24 matrix -------------------------------------------------------
    const tenantManagerRole = await createRole(
      tenantId,
      `E4W4_TENANT_MANAGER_${codeStamp}`,
      "Epic 4 Wave 4 tenant manager",
      MANAGER_PERMISSIONS,
    );
    tenantManager = await createUser(tenantId, "tenant-manager", passwordHash);
    await createAssignment(tenantManager.id, tenantManagerRole.id, {
      scopeType: "tenant",
    });
    tenantManagerToken = await tokenFor(tenantId, tenantManager);

    const regionManagerRole = await createRole(
      tenantId,
      `E4W4_REGION_MANAGER_${codeStamp}`,
      "Epic 4 Wave 4 region manager",
      MANAGER_PERMISSIONS,
    );
    regionManager = await createUser(tenantId, "region-manager", passwordHash);
    await createAssignment(regionManager.id, regionManagerRole.id, {
      scopeType: "organization_unit",
      scopeOrganizationUnitId: nearUnit,
    });
    regionManagerToken = await tokenFor(tenantId, regionManager);

    bareUser = await createUser(tenantId, "bare", passwordHash);
    bareUserToken = await tokenFor(tenantId, bareUser);

    // Roles ----------------------------------------------------------------
    plainRole = await createRole(
      tenantId,
      `E4W4_PLAIN_${codeStamp}`,
      "Epic 4 Wave 4 plain",
      ["user.read"],
    );
    hseRole = await createRole(
      tenantId,
      `E4W4_HSE_${codeStamp}`,
      "Epic 4 Wave 4 hse",
      ["hse.read"],
    );
    // `finance.read` lives in an active module but sits outside the delegation
    // ceiling below, so it isolates the delegation refusal from the module one.
    outOfCeilingRole = await createRole(
      tenantId,
      `E4W4_FINANCE_${codeStamp}`,
      "Epic 4 Wave 4 finance",
      ["finance.read"],
    );

    // Grantor: a manager whose ceiling covers hse.read but not finance.read.
    // The role that carries `user.role.manage` decides the ceiling, so hse.read
    // has to sit on THAT role.
    const grantorRole = await createRole(
      tenantId,
      `E4W4_GRANTOR_${codeStamp}`,
      "Epic 4 Wave 4 grantor",
      [...MANAGER_PERMISSIONS, "hse.read"],
    );
    grantor = await createUser(tenantId, "grantor", passwordHash);
    await createAssignment(grantor.id, grantorRole.id, { scopeType: "tenant" });
    grantorToken = await tokenFor(tenantId, grantor);

    // Targets --------------------------------------------------------------
    nearTarget = await createUser(tenantId, "near-target", passwordHash);
    await createAssignment(nearTarget.id, plainRole.id, {
      scopeType: "organization_unit",
      scopeOrganizationUnitId: nearUnit,
    });
    farTarget = await createUser(tenantId, "far-target", passwordHash);
    await createAssignment(farTarget.id, plainRole.id, {
      scopeType: "organization_unit",
      scopeOrganizationUnitId: farUnit,
    });
  });

  afterAll(async () => {
    await pool.query(`DELETE FROM tenants WHERE code = ANY($1::text[])`, [
      [TENANT],
    ]);
    await app.close();
    await pool.end();
  });

  describe("step 22 — one inactive-module refusal, both surfaces", () => {
    it("names the inactive module on both the single-grant and batch routes, in the same words", async () => {
      await setModuleActive(tenantId, "hse", false);
      let single: Awaited<ReturnType<typeof inject>>;
      try {
        single = await inject(
          "POST",
          `/admin/users/${nearTarget.id}/role-assignments`,
          grantorToken,
          {
            roleCode: hseRole.code,
            scopeType: "organization_unit",
            scopeOrganizationUnitId: nearUnit,
          },
        );
      } finally {
        await setModuleActive(tenantId, "hse", true);
      }

      expect(single.statusCode).toBe(400);
      expect(single.json().error).toBe(
        `Role '${hseRole.code}' needs module 'hse' which is not active for this tenant`,
      );

      // The batch path asks the same questions in the same order, so it must
      // answer with the same sentence rather than its own wording.
      await setModuleActive(tenantId, "hse", false);
      let preview: Awaited<ReturnType<typeof inject>>;
      try {
        preview = await inject(
          "POST",
          `/admin/users/${nearTarget.id}/assignment-previews`,
          grantorToken,
          {
            pairs: [
              {
                roleCode: hseRole.code,
                scopeType: "organization_unit",
                scopeOrganizationUnitId: nearUnit,
              },
            ],
          },
        );
      } finally {
        await setModuleActive(tenantId, "hse", true);
      }

      expect(preview.statusCode).toBe(400);
      expect(preview.json().error).toBe(single.json().error);
    });

    it("keeps each refusal its own reason: delegation, then permission", async () => {
      // Outside the ceiling — a delegation problem, not a module problem.
      const beyondCeiling = await inject(
        "POST",
        `/admin/users/${nearTarget.id}/role-assignments`,
        grantorToken,
        {
          roleCode: outOfCeilingRole.code,
          scopeType: "organization_unit",
          scopeOrganizationUnitId: nearUnit,
        },
      );
      expect(beyondCeiling.statusCode).toBe(400);
      expect(beyondCeiling.json().error).toBe(
        `Role '${outOfCeilingRole.code}' carries permission 'finance.read' outside your delegation authority`,
      );

      // Console entry missing — 403, and no target or module question is
      // answered first.
      const noManage = await inject(
        "POST",
        `/admin/users/${nearTarget.id}/role-assignments`,
        bareUserToken,
        { roleCode: plainRole.code, scopeType: "tenant" },
      );
      expect(noManage.statusCode).toBe(403);
      expect(noManage.json().error).toMatch(/permission|authorized/i);
    });
  });

  describe("step 23 — the four refusals stay distinguishable", () => {
    it("a target outside the actor's Data Scope is 404 on read and on write", async () => {
      const read = await inject(
        "GET",
        `/admin/users/${farTarget.id}/access`,
        regionManagerToken,
      );
      expect(read.statusCode).toBe(404);

      const grant = await inject(
        "POST",
        `/admin/users/${farTarget.id}/role-assignments`,
        regionManagerToken,
        {
          roleCode: plainRole.code,
          scopeType: "organization_unit",
          scopeOrganizationUnitId: nearUnit,
        },
      );
      // Indistinguishable from a User that does not exist: the response names
      // no scope and reveals no reach.
      expect(grant.statusCode).toBe(404);
      expect(grant.json().error).toMatch(/User .* not found/i);
    });

    it("an invalid Role or scope target is 404 by name", async () => {
      const missingRole = await inject(
        "POST",
        `/admin/users/${nearTarget.id}/role-assignments`,
        regionManagerToken,
        {
          roleCode: `E4W4_NO_SUCH_ROLE_${codeStamp}`,
          scopeType: "organization_unit",
          scopeOrganizationUnitId: nearUnit,
        },
      );
      expect(missingRole.statusCode).toBe(404);
      expect(missingRole.json().error).toMatch(/Role .* not found/i);

      const missingUnit = await inject(
        "POST",
        `/admin/users/${nearTarget.id}/role-assignments`,
        regionManagerToken,
        {
          roleCode: plainRole.code,
          scopeType: "organization_unit",
          scopeOrganizationUnitId: randomUUID(),
        },
      );
      expect(missingUnit.statusCode).toBe(404);
      expect(missingUnit.json().error).toMatch(/Organization Unit .* not found/i);
    });
  });

  describe("step 24 — regression matrix", () => {
    it("a tenant-wide manager sees every active user and the assignment inventory", async () => {
      const list = await inject("GET", "/admin/users", tenantManagerToken);
      expect(list.statusCode).toBe(200);
      const ids = (list.json() as Array<Record<string, unknown>>).map(
        (user) => user.id,
      );
      expect(ids).toContain(tenantManager.id);
      expect(ids).toContain(regionManager.id);
      expect(ids).toContain(nearTarget.id);
      expect(ids).toContain(farTarget.id);
      expect(ids).toContain(bareUser.id);

      const inventory = await inject(
        "GET",
        "/admin/assignments",
        tenantManagerToken,
      );
      expect(inventory.statusCode).toBe(200);
      expect((inventory.json() as unknown[]).length).toBeGreaterThan(0);
    });

    it("a region manager sees only targets anchored inside their own unit", async () => {
      const list = await inject("GET", "/admin/users", regionManagerToken);
      expect(list.statusCode).toBe(200);
      const ids = (list.json() as Array<Record<string, unknown>>).map(
        (user) => user.id,
      );
      expect(ids).toContain(nearTarget.id);
      // Anchored elsewhere, tenant-wide, or unassigned: none of them appear.
      expect(ids).not.toContain(farTarget.id);
      expect(ids).not.toContain(tenantManager.id);
      expect(ids).not.toContain(bareUser.id);
    });

    it("a user with no assignment is refused, not handed an empty page", async () => {
      const response = await inject("GET", "/admin/users", bareUserToken);
      expect(response.statusCode).toBe(403);
      expect(response.json().error).toMatch(/permission|authorized/i);
    });
  });

  describe("step 25 — both surfaces answer with one policy", () => {
    it("reports the same rows, lifecycle state, and provenance on both surfaces", async () => {
      const surfaceTarget = await createUser(tenantId, "surface-target", passwordHash);
      const keepAssignmentId = await createAssignment(
        surfaceTarget.id,
        plainRole.id,
        { scopeType: "organization_unit", scopeOrganizationUnitId: nearUnit },
        regionManager.id,
      );
      const revokeAssignmentId = await createAssignment(
        surfaceTarget.id,
        plainRole.id,
        { scopeType: "organization_unit", scopeOrganizationUnitId: otherNearUnit },
        regionManager.id,
      );
      // `otherNearUnit` is outside the region manager's reach, so make the
      // target visible through `nearUnit` first — done above — and revoke the
      // grant that is OUTSIDE their reach. The target stays visible.
      const revoke = await inject(
        "POST",
        `/admin/users/${surfaceTarget.id}/role-assignments/${revokeAssignmentId}/revoke`,
        regionManagerToken,
        { reason: "Wave 4 two-surface identity" },
      );
      expect(revoke.statusCode).toBe(204);

      const detail = await inject(
        "GET",
        `/admin/users/${surfaceTarget.id}/access`,
        regionManagerToken,
      );
      expect(detail.statusCode).toBe(200);
      const byId = new Map(
        (detail.json().roleAssignments as Array<Record<string, unknown>>).map(
          (row) => [row.id as string, row],
        ),
      );
      expect(byId.get(revokeAssignmentId)).toMatchObject({
        assignmentState: "revoked",
        revokeReason: "Wave 4 two-surface identity",
        revokedBy: regionManager.id,
      });
      expect(byId.get(keepAssignmentId)).toMatchObject({
        assignmentState: "active",
      });

      // Assignment-centric: the same rows with the same states and provenance.
      const inventory = await inject("GET", "/admin/assignments", regionManagerToken);
      expect(inventory.statusCode).toBe(200);
      const inventoryById = new Map(
        (inventory.json() as Array<Record<string, unknown>>).map((row) => [
          row.id as string,
          row,
        ]),
      );
      expect(inventoryById.get(revokeAssignmentId)).toMatchObject({
        userId: surfaceTarget.id,
        assignmentState: "revoked",
        revokeReason: "Wave 4 two-surface identity",
        revokedBy: regionManager.id,
      });
      expect(inventoryById.get(keepAssignmentId)).toMatchObject({
        userId: surfaceTarget.id,
        assignmentState: "active",
      });

      // Neither surface shows a row of this target that the other hides.
      const detailIds = new Set(byId.keys());
      const inventoryIdsForTarget = new Set(
        [...inventoryById.entries()]
          .filter(([, row]) => row.userId === surfaceTarget.id)
          .map(([id]) => id),
      );
      expect(detailIds).toEqual(inventoryIdsForTarget);
    });

    it("a revoked Organization Unit grant stops conferring write visibility, not only read visibility", async () => {
      // The target's ONLY live Organization Unit anchor is the region
      // manager's own unit. Revoking it must close the write paths exactly
      // where it closes the read path — the defect this wave fixes.
      const soleAnchorTarget = await createUser(tenantId, "sole-anchor", passwordHash);
      const soleAssignmentId = await createAssignment(
        soleAnchorTarget.id,
        plainRole.id,
        { scopeType: "organization_unit", scopeOrganizationUnitId: nearUnit },
        regionManager.id,
      );

      // Visible while the anchor is live.
      expect(
        (
          await inject(
            "GET",
            `/admin/users/${soleAnchorTarget.id}/access`,
            regionManagerToken,
          )
        ).statusCode,
      ).toBe(200);

      const revoke = await inject(
        "POST",
        `/admin/users/${soleAnchorTarget.id}/role-assignments/${soleAssignmentId}/revoke`,
        regionManagerToken,
        { reason: "Sole anchor revoked; write reach must follow" },
      );
      expect(revoke.statusCode).toBe(204);

      // Read, single grant, and batch preview must all answer 404 now: the
      // revoked grant no longer anchors this target inside any visibility.
      const read = await inject(
        "GET",
        `/admin/users/${soleAnchorTarget.id}/access`,
        regionManagerToken,
      );
      expect(read.statusCode).toBe(404);

      const grant = await inject(
        "POST",
        `/admin/users/${soleAnchorTarget.id}/role-assignments`,
        regionManagerToken,
        {
          roleCode: plainRole.code,
          scopeType: "organization_unit",
          scopeOrganizationUnitId: nearUnit,
        },
      );
      expect(grant.statusCode).toBe(404);
      expect(grant.json().error).toMatch(/User .* not found/i);

      const preview = await inject(
        "POST",
        `/admin/users/${soleAnchorTarget.id}/assignment-previews`,
        regionManagerToken,
        {
          pairs: [
            {
              roleCode: plainRole.code,
              scopeType: "organization_unit",
              scopeOrganizationUnitId: nearUnit,
            },
          ],
        },
      );
      expect(preview.statusCode).toBe(404);

      // The tenant-wide manager still sees the retained history row — the
      // revocation removed reach, not the record.
      const managerDetail = await inject(
        "GET",
        `/admin/users/${soleAnchorTarget.id}/access`,
        tenantManagerToken,
      );
      expect(managerDetail.statusCode).toBe(200);
      const revokedRow = (
        managerDetail.json().roleAssignments as Array<Record<string, unknown>>
      ).find((row) => row.id === soleAssignmentId);
      expect(revokedRow).toMatchObject({
        assignmentState: "revoked",
        revokeReason: "Sole anchor revoked; write reach must follow",
      });
    });
  });
});
