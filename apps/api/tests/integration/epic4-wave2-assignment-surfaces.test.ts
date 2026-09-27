import { randomUUID } from "node:crypto";
import type {
  InjectPayload,
  Response as LightMyRequestResponse,
} from "light-my-request";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../../src/app.js";
import { pool } from "../../src/infrastructure/persistence/db.js";
import { signAccessToken } from "../../src/infrastructure/security/jwt.js";
import { hashPassword } from "../../src/infrastructure/security/password.js";
import { activateAllModules, authHeader, bootstrapTenant } from "./helpers.js";

/**
 * Epic 4 Wave 2 §4.4 — the User-centric and assignment-centric surfaces.
 *
 * Fixtures are direct SQL for the same reason Phase 11F's are: the governed
 * HTTP surface is what these tests exercise, so manufacturing actors, Roles and
 * assignments through it would make the authorization assertions circular.
 *
 * The binding claims under test, each with the road-map line it answers to:
 *
 *   §4.4 step 16   a User outside the actor's visibility never enters the
 *                  payload, and an out-of-visibility target is a 404 rather
 *                  than a differently-shaped refusal (risk row 1);
 *   §4.4 E         an Organization Unit authority reaches every descendant, and
 *                  a unit above the actor is context with `selectable: false`;
 *   §4.4 H step 4  a Role outside the actor's delegation ceiling is refused by
 *                  the SAME reason on BOTH assignment surfaces (§4.4 D), and
 *                  the Region administrator's ceiling is their own permission
 *                  set — not an empty set, which is what the Role-definition
 *                  anchor (`role.manage` + `config.read` on one tenant-scoped
 *                  assignment) used to produce for them;
 *   §4.4 C         one batch is one transaction and one confirmation; the
 *                  preview hash binds actor + target + pairs;
 *   §4.4 step 11   a User with no assignment is valid and gets no default;
 *   §4.4 step 23   an inactive module is refused with its own reason.
 */

const stamp = `${Date.now().toString(36)}_${process.pid}_${randomUUID().replaceAll("-", "").slice(0, 8)}`;
const codeStamp = stamp.toUpperCase();
const TENANT = `e4w2-${stamp}`;
const PASSWORD = "Passw0rd12345!";

const MANAGER_PERMISSIONS = [
  "admin.console.read",
  "user.read",
  "config.read",
  "user.role.manage",
];

/** The Admin Console entry ticket plus the read permission, and NOTHING that
 * authorizes a grant — the shape that must be able to look without being able
 * to assign (§4.4 step 13's reason clause). */
const READER_PERMISSIONS = ["admin.console.read", "user.read"];

const app = buildApp();

interface UserFixture {
  id: string;
  email: string;
}

interface RoleFixture {
  id: string;
  code: string;
  name: string;
}

type Pair =
  | { roleCode: string; scopeType: "tenant" }
  | {
      roleCode: string;
      scopeType: "organization_unit";
      scopeOrganizationUnitId: string;
    }
  | { roleCode: string; scopeType: "customer"; scopeCustomerId: string };

async function createRole(
  tenantId: string,
  code: string,
  permissionCodes: string[],
): Promise<RoleFixture> {
  const result = await pool.query(
    `INSERT INTO roles (tenant_id, code, name) VALUES ($1, $2, $2)
     RETURNING id, code, name`,
    [tenantId, code],
  );
  if (permissionCodes.length > 0) {
    const uniqueCodes = [...new Set(permissionCodes)];
    const permissions = await pool.query(
      `SELECT id, code FROM permissions WHERE code = ANY($1::text[])`,
      [uniqueCodes],
    );
    const found = new Set(permissions.rows.map((row) => row.code as string));
    const missing = uniqueCodes.filter((code) => !found.has(code));
    if (missing.length > 0) {
      throw new Error(`Missing fixture permissions: ${missing.join(", ")}`);
    }
    await pool.query(
      `INSERT INTO role_permissions (role_id, permission_id)
       SELECT $1, id FROM permissions WHERE code = ANY($2::text[])`,
      [result.rows[0].id, uniqueCodes],
    );
  }
  return result.rows[0] as RoleFixture;
}

async function createUser(
  tenantId: string,
  localName: string,
  passwordHash: string,
): Promise<UserFixture> {
  const email = `${localName}.${stamp}@e4w2.local`;
  const result = await pool.query(
    `INSERT INTO users (tenant_id, email, password_hash, full_name)
     VALUES ($1, $2, $3, $4)
     RETURNING id, email`,
    [tenantId, email, passwordHash, `Wave 2 ${localName}`],
  );
  return result.rows[0] as UserFixture;
}

async function createAssignment(
  userId: string,
  roleId: string,
  scope: { scopeType: "tenant" } | { scopeType: "organization_unit"; organizationUnitId: string },
): Promise<string> {
  const organizationUnitId =
    scope.scopeType === "organization_unit" ? scope.organizationUnitId : null;
  const result = await pool.query(
    `INSERT INTO user_role_assignments
       (user_id, role_id, scope_type, scope_organization_unit_id, scope_customer_id)
     VALUES ($1, $2, $3, $4, NULL)
     RETURNING id`,
    [userId, roleId, scope.scopeType, organizationUnitId],
  );
  return result.rows[0].id as string;
}

/** Organization Units come as a tree: the §4.4 E descendant rule needs a real
 * `parent_id` chain, so the flat Phase 11F helper is not enough here. */
async function createOrganizationUnit(
  tenantId: string,
  name: string,
  parentId: string | null,
): Promise<string> {
  const legalEntity = await pool.query(
    `INSERT INTO legal_entities (tenant_id, name) VALUES ($1, $2) RETURNING id`,
    [tenantId, `${name} Legal Entity`],
  );
  const unit = await pool.query(
    `INSERT INTO organization_units
       (tenant_id, legal_entity_id, parent_id, name, unit_type)
     VALUES ($1, $2, $3, $4, 'Branch')
     RETURNING id`,
    [tenantId, legalEntity.rows[0].id, parentId, name],
  );
  return unit.rows[0].id as string;
}

async function createCustomer(tenantId: string, name: string): Promise<string> {
  const result = await pool.query(
    `INSERT INTO customers (tenant_id, code, name) VALUES ($1, $2, $3) RETURNING id`,
    [tenantId, `CUST-${name}-${codeStamp}`, name],
  );
  return result.rows[0].id as string;
}

function tokenFor(tenantId: string, user: UserFixture): string {
  return signAccessToken({ sub: user.id, tenantId });
}

function get(url: string, token: string): Promise<LightMyRequestResponse> {
  return app.inject({ method: "GET", url, headers: authHeader(token) });
}

function post(
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

describe("Epic 4 Wave 2 — User and assignment surfaces", () => {
  let tenantId: string;
  let passwordHash: string;

  let tenantAdmin: UserFixture;
  let tenantAdminToken: string;
  let regionAdmin: UserFixture;
  let regionAdminToken: string;
  let moduleAdmin: UserFixture;
  let moduleAdminToken: string;
  let consoleReader: UserFixture;
  let consoleReaderToken: string;
  let bareUser: UserFixture;
  let bareUserToken: string;

  let regionAId: string;
  let siteAId: string;
  let teamXId: string;
  let regionBId: string;

  let targetInTeamX: UserFixture;
  let targetInRegionA: UserFixture;
  let targetInRegionB: UserFixture;
  let tenantWideTarget: UserFixture;
  let unassignedTarget: UserFixture;

  let assignableRole: RoleFixture;
  let outsideCeilingRole: RoleFixture;
  let financeRole: RoleFixture;

  beforeAll(async () => {
    passwordHash = await hashPassword(PASSWORD);
    const primary = await bootstrapTenant(app, TENANT, "Tenant Epic 4 Wave 2");
    await activateAllModules(primary.id);
    tenantId = primary.id;

    // Tree: regionA ─ siteA ─ teamX, plus a sibling root regionB.
    regionAId = await createOrganizationUnit(tenantId, `Region A ${codeStamp}`, null);
    siteAId = await createOrganizationUnit(tenantId, `Site A ${codeStamp}`, regionAId);
    teamXId = await createOrganizationUnit(tenantId, `Team X ${codeStamp}`, siteAId);
    regionBId = await createOrganizationUnit(tenantId, `Region B ${codeStamp}`, null);

    const managerRole = await createRole(tenantId, `MANAGER_${codeStamp}`, MANAGER_PERMISSIONS);
    const readerRole = await createRole(
      tenantId,
      `READER_${codeStamp}`,
      READER_PERMISSIONS,
    );
    // Carries finance.read so the MODULE ceiling, not the delegation ceiling, is
    // the rule that refuses a finance Role below.
    const moduleRole = await createRole(tenantId, `MODULE_ADMIN_${codeStamp}`, [
      ...MANAGER_PERMISSIONS,
      "finance.read",
    ]);
    // The delegation ceiling is the intersection of the actor's permission sets
    // across their anchor assignments, so `user.read` is inside EVERY fixture
    // actor's ceiling and is what the Role below can be granted with.
    assignableRole = await createRole(tenantId, `ASSIGNABLE_${codeStamp}`, ["user.read"]);
    outsideCeilingRole = await createRole(tenantId, `OUTSIDE_${codeStamp}`, ["finance.manage"]);
    financeRole = await createRole(tenantId, `FINANCE_${codeStamp}`, ["finance.read"]);

    tenantAdmin = await createUser(tenantId, "tenant-admin", passwordHash);
    await createAssignment(tenantAdmin.id, managerRole.id, { scopeType: "tenant" });
    tenantAdminToken = tokenFor(tenantId, tenantAdmin);

    regionAdmin = await createUser(tenantId, "region-admin", passwordHash);
    await createAssignment(regionAdmin.id, managerRole.id, {
      scopeType: "organization_unit",
      organizationUnitId: siteAId,
    });
    regionAdminToken = tokenFor(tenantId, regionAdmin);

    moduleAdmin = await createUser(tenantId, "module-admin", passwordHash);
    await createAssignment(moduleAdmin.id, moduleRole.id, { scopeType: "tenant" });
    moduleAdminToken = tokenFor(tenantId, moduleAdmin);

    consoleReader = await createUser(tenantId, "console-reader", passwordHash);
    await createAssignment(consoleReader.id, readerRole.id, { scopeType: "tenant" });
    consoleReaderToken = tokenFor(tenantId, consoleReader);

    // Admin Console entry, but no administration authority of any kind.
    bareUser = await createUser(tenantId, "bare-user", passwordHash);
    bareUserToken = tokenFor(tenantId, bareUser);

    targetInTeamX = await createUser(tenantId, "target-teamx", passwordHash);
    await createAssignment(targetInTeamX.id, assignableRole.id, {
      scopeType: "organization_unit",
      organizationUnitId: teamXId,
    });

    targetInRegionA = await createUser(tenantId, "target-regiona", passwordHash);
    await createAssignment(targetInRegionA.id, assignableRole.id, {
      scopeType: "organization_unit",
      organizationUnitId: regionAId,
    });

    targetInRegionB = await createUser(tenantId, "target-regionb", passwordHash);
    await createAssignment(targetInRegionB.id, assignableRole.id, {
      scopeType: "organization_unit",
      organizationUnitId: regionBId,
    });

    tenantWideTarget = await createUser(tenantId, "target-tenantwide", passwordHash);
    await createAssignment(tenantWideTarget.id, assignableRole.id, { scopeType: "tenant" });

    unassignedTarget = await createUser(tenantId, "target-unassigned", passwordHash);

    // The finance module is switched off AFTER every actor exists, so the
    // ceiling checks that read the actor's own assignments are unaffected.
    await pool.query(
      `UPDATE tenant_module_activations SET is_active = false
        WHERE tenant_id = $1
          AND module_id = (SELECT id FROM modules WHERE code = 'finance')`,
      [tenantId],
    );
  });

  afterAll(async () => {
    if (tenantId) {
      await pool.query(`DELETE FROM tenants WHERE id = $1`, [tenantId]);
    }
    await app.close();
    await pool.end();
  });

  // ------------------------------------------------------------------
  // Authentication: every new route is behind the console entry ticket.
  // ------------------------------------------------------------------
  describe("surface authentication", () => {
    it("rejects unauthenticated requests to all six Wave 2 routes", async () => {
      const probes = [
        app.inject({ method: "GET", url: "/admin/users" }),
        app.inject({ method: "GET", url: `/admin/users/${unassignedTarget.id}/access` }),
        app.inject({ method: "GET", url: "/admin/assignments" }),
        app.inject({ method: "GET", url: "/admin/assignment-options" }),
        app.inject({
          method: "POST",
          url: `/admin/users/${unassignedTarget.id}/assignment-previews`,
          payload: { pairs: [] },
        }),
        app.inject({
          method: "POST",
          url: `/admin/users/${unassignedTarget.id}/assignment-batches`,
          payload: { pairs: [], previewHash: "x", confirm: true },
        }),
        app.inject({ method: "POST", url: "/admin/users", payload: {} }),
      ];
      for (const probe of probes) {
        expect((await probe).statusCode).toBe(401);
      }
    });

    it("refuses an actor with no Admin Console entry", async () => {
      expect((await get("/admin/users", bareUserToken)).statusCode).toBe(403);
      expect((await get("/admin/assignments", bareUserToken)).statusCode).toBe(403);
      expect(
        (await get("/admin/assignment-options", bareUserToken)).statusCode,
      ).toBe(403);
    });
  });

  // ------------------------------------------------------------------
  // §4.4 step 16 — visibility narrows the payload in SQL.
  // ------------------------------------------------------------------
  describe("server-side visibility (§4.4 step 16)", () => {
    it("sends a tenant-wide actor every active User", async () => {
      const response = await get("/admin/users", tenantAdminToken);
      expect(response.statusCode).toBe(200);
      const ids = (response.json() as Array<{ id: string }>).map((user) => user.id);
      for (const target of [
        targetInTeamX,
        targetInRegionB,
        tenantWideTarget,
        unassignedTarget,
      ]) {
        expect(ids, target.email).toContain(target.id);
      }
    });

    it("never sends an out-of-scope User to a Region administrator", async () => {
      const response = await get("/admin/users", regionAdminToken);
      expect(response.statusCode).toBe(200);
      const ids = (response.json() as Array<{ id: string }>).map((user) => user.id);
      // Inside the subtree (§4.4 E: siteA's authority reaches teamX).
      expect(ids).toContain(targetInTeamX.id);
      // Outside it — absent from the PAYLOAD, not filtered by the browser.
      expect(ids).not.toContain(targetInRegionB.id);
      expect(ids).not.toContain(tenantWideTarget.id);
      expect(ids).not.toContain(unassignedTarget.id);
    });

    it("answers an out-of-visibility target as missing, not as a different refusal", async () => {
      const outOfScope = await get(
        `/admin/users/${targetInRegionB.id}/access`,
        regionAdminToken,
      );
      const missing = await get(
        `/admin/users/${randomUUID()}/access`,
        regionAdminToken,
      );
      expect(outOfScope.statusCode).toBe(404);
      // §4.4 risk row 1 — a foreign target and a nonexistent one are
      // indistinguishable, so the surface is not an existence oracle. The
      // message necessarily echoes the id that was asked for; what must match
      // is its shape, which is the same "User <id> not found" either way.
      expect(missing.statusCode).toBe(404);
      expect(outOfScope.json().error).toBe(`User ${targetInRegionB.id} not found`);
      expect(missing.json().error).toMatch(/^User [0-9a-f-]{36} not found$/);
    });

    it("narrows the assignment-centric list by the same predicate", async () => {
      const response = await get("/admin/assignments", regionAdminToken);
      expect(response.statusCode).toBe(200);
      const rows = response.json() as Array<{ userId: string }>;
      expect(rows.some((row) => row.userId === targetInTeamX.id)).toBe(true);
      expect(rows.some((row) => row.userId === targetInRegionB.id)).toBe(false);
      expect(rows.some((row) => row.userId === tenantWideTarget.id)).toBe(false);
    });

    it("refuses an actor holding no administration authority at all", async () => {
      // bareUser has NO assignment, so the console entry is already missing.
      const response = await get("/admin/assignments", bareUserToken);
      expect(response.statusCode).toBe(403);
    });
  });

  // ------------------------------------------------------------------
  // §4.4 step 15 — the scope picker is server-owned.
  // ------------------------------------------------------------------
  describe("scope picker (§4.4 step 15)", () => {
    it("offers tenant scope and every unit to a tenant-wide actor", async () => {
      const response = await get("/admin/assignment-options", tenantAdminToken);
      expect(response.statusCode).toBe(200);
      const options = response.json() as {
        canAssignTenantScope: boolean;
        organizationUnits: Array<{ id: string; selectable: boolean; depth: number }>;
        roles: Array<{ code: string; selectable: boolean }>;
      };
      expect(options.canAssignTenantScope).toBe(true);
      expect(options.organizationUnits.every((unit) => unit.selectable)).toBe(true);
      expect(
        options.organizationUnits.find((unit) => unit.id === regionAId)?.depth,
      ).toBe(0);
      expect(
        options.organizationUnits.find((unit) => unit.id === teamXId)?.depth,
      ).toBe(2);
    });

    it("shows a Region administrator its own subtree and nothing above it", async () => {
      const response = await get("/admin/assignment-options", regionAdminToken);
      expect(response.statusCode).toBe(200);
      const options = response.json() as {
        canAssignTenantScope: boolean;
        organizationUnits: Array<{ id: string; selectable: boolean }>;
      };
      const selectableOf = (id: string) =>
        options.organizationUnits.find((unit) => unit.id === id)?.selectable;

      expect(options.canAssignTenantScope).toBe(false);
      // Its own anchor and the descendant beneath it.
      expect(selectableOf(siteAId)).toBe(true);
      expect(selectableOf(teamXId)).toBe(true);
      // An ancestor is CONTEXT, not a choice (§4.4 E).
      expect(selectableOf(regionAId)).toBe(false);
      // A sibling region is not in the actor's authority at all.
      expect(selectableOf(regionBId)).toBe(false);
    });

    it("marks a Role outside the delegation ceiling as unselectable", async () => {
      const response = await get("/admin/assignment-options", regionAdminToken);
      const options = response.json() as {
        roles: Array<{ code: string; selectable: boolean }>;
      };
      expect(
        options.roles.find((role) => role.code === assignableRole.code)?.selectable,
      ).toBe(true);
      expect(
        options.roles.find((role) => role.code === outsideCeilingRole.code)?.selectable,
      ).toBe(false);
    });

    it("offers nothing selectable to a console reader without assignment authority", async () => {
      // `consoleReader` holds the entry ticket and `user.read` but not
      // `user.role.manage`, so it may look at the console and still has no
      // assignment authority. The picker must answer 200 with NOTHING
      // selectable rather than an empty-looking toolbar, while the grant
      // inventory refuses outright: a viewer who cannot assign must not read
      // the grants either.
      const inventory = await get("/admin/assignments", consoleReaderToken);
      expect(inventory.statusCode).toBe(403);
      expect(inventory.json().error).toMatch(/user\.role\.manage/);

      const response = await get("/admin/assignment-options", consoleReaderToken);
      expect(response.statusCode).toBe(200);
      const options = response.json() as {
        canAssignTenantScope: boolean;
        organizationUnits: Array<{ selectable: boolean }>;
        roles: Array<{ selectable: boolean }>;
      };
      expect(options.canAssignTenantScope).toBe(false);
      expect(options.organizationUnits.every((unit) => !unit.selectable)).toBe(true);
      expect(options.roles.every((role) => !role.selectable)).toBe(true);
    });
  });

  // ------------------------------------------------------------------
  // §4.4 step 11 — Create User, with an optional initial assignment.
  // ------------------------------------------------------------------
  describe("Create User (§4.4 step 11)", () => {
    it("creates a User with no assignment and grants no default access", async () => {
      const response = await post("/admin/users", tenantAdminToken, {
        email: `no-assignment.${stamp}@e4w2.local`,
        fullName: "No Assignment",
        password: PASSWORD,
        pairs: [],
      });
      expect(response.statusCode).toBe(201);
      const body = response.json() as {
        user: { id: string };
        assignments: unknown[];
      };
      expect(body.assignments).toEqual([]);

      const access = await get(
        `/admin/users/${body.user.id}/access`,
        tenantAdminToken,
      );
      expect(access.statusCode).toBe(200);
      expect(access.json().roleAssignments).toEqual([]);
    });

    it("creates a User together with its initial assignments in one confirmation", async () => {
      const response = await post("/admin/users", tenantAdminToken, {
        email: `with-pairs.${stamp}@e4w2.local`,
        fullName: "With Pairs",
        password: PASSWORD,
        pairs: [
          { roleCode: assignableRole.code, scopeType: "tenant" },
          {
            roleCode: assignableRole.code,
            scopeType: "organization_unit",
            scopeOrganizationUnitId: teamXId,
          },
        ],
      });
      expect(response.statusCode).toBe(201);
      const body = response.json() as { assignments: Array<{ scopeType: string }> };
      expect(body.assignments).toHaveLength(2);
      expect(body.assignments.map((a) => a.scopeType).sort()).toEqual([
        "organization_unit",
        "tenant",
      ]);
    });

    it("refuses a duplicate email with a conflict", async () => {
      const email = `duplicate.${stamp}@e4w2.local`;
      const first = await post("/admin/users", tenantAdminToken, {
        email,
        fullName: "First",
        password: PASSWORD,
        pairs: [],
      });
      expect(first.statusCode).toBe(201);
      const second = await post("/admin/users", tenantAdminToken, {
        email,
        fullName: "Second",
        password: PASSWORD,
        pairs: [],
      });
      expect(second.statusCode).toBe(409);
    });

    it("refuses a mismatched confirmation and a malformed pair set", async () => {
      const missingConfirm = await post("/admin/users", tenantAdminToken, {
        email: `bad-body.${stamp}@e4w2.local`,
        fullName: "Bad Body",
        password: PASSWORD,
      });
      // `pairs` defaults to [] — a User without one is valid (§4.4 step 11).
      expect(missingConfirm.statusCode).toBe(201);

      const duplicatePairs = await post("/admin/users", tenantAdminToken, {
        email: `dupe-pairs.${stamp}@e4w2.local`,
        fullName: "Dupe Pairs",
        password: PASSWORD,
        pairs: [
          { roleCode: assignableRole.code, scopeType: "tenant" },
          { roleCode: assignableRole.code, scopeType: "tenant" },
        ],
      });
      expect(duplicatePairs.statusCode).toBe(400);
    });
  });

  // ------------------------------------------------------------------
  // §4.4 step 14 — one preview, one confirmation.
  // ------------------------------------------------------------------
  describe("preview and single confirmation (§4.4 step 14)", () => {
    it("previews without writing, then commits exactly the previewed set", async () => {
      const pairs: Pair[] = [
        { roleCode: assignableRole.code, scopeType: "tenant" },
        {
          roleCode: assignableRole.code,
          scopeType: "organization_unit",
          scopeOrganizationUnitId: regionAId,
        },
      ];
      const preview = await post(
        `/admin/users/${unassignedTarget.id}/assignment-previews`,
        tenantAdminToken,
        { pairs },
      );
      expect(preview.statusCode).toBe(200);
      const previewBody = preview.json() as {
        previewHash: string;
        targetUserId: string;
        pairs: Array<{ roleCode: string; scopeOrganizationUnitName: string | null }>;
      };
      expect(previewBody.targetUserId).toBe(unassignedTarget.id);
      expect(previewBody.pairs).toHaveLength(2);
      // The preview names the scope, so an operator confirms what they read.
      expect(
        previewBody.pairs.find((pair) => pair.scopeOrganizationUnitName)!
          .scopeOrganizationUnitName,
      ).toBe(`Region A ${codeStamp}`);

      const before = await pool.query(
        `SELECT count(*)::int AS count FROM user_role_assignments WHERE user_id = $1`,
        [unassignedTarget.id],
      );
      expect(before.rows[0].count).toBe(0);

      const commit = await post(
        `/admin/users/${unassignedTarget.id}/assignment-batches`,
        tenantAdminToken,
        { pairs, previewHash: previewBody.previewHash, confirm: true },
      );
      expect(commit.statusCode).toBe(201);
      expect((commit.json() as { created: unknown[] }).created).toHaveLength(2);

      const after = await pool.query(
        `SELECT count(*)::int AS count FROM user_role_assignments WHERE user_id = $1`,
        [unassignedTarget.id],
      );
      expect(after.rows[0].count).toBe(2);

      // The batch writes ONE audit event carrying every pair (§4.4 D).
      const audit = await pool.query(
        `SELECT metadata FROM audit_log
          WHERE tenant_id = $1 AND action = 'user.role_assigned' AND entity_id = $2`,
        [tenantId, unassignedTarget.id],
      );
      expect(audit.rows).toHaveLength(1);
      expect(audit.rows[0].metadata.batchSize).toBe(2);
    });

    it("refuses a hash that does not match the submitted pairs", async () => {
      const previewed: Pair[] = [
        { roleCode: assignableRole.code, scopeType: "tenant" },
      ];
      const preview = await post(
        `/admin/users/${targetInRegionB.id}/assignment-previews`,
        tenantAdminToken,
        { pairs: previewed },
      );
      expect(preview.statusCode).toBe(200);

      const substituted: Pair[] = [
        { roleCode: assignableRole.code, scopeType: "tenant" },
        {
          roleCode: assignableRole.code,
          scopeType: "organization_unit",
          scopeOrganizationUnitId: regionBId,
        },
      ];
      const replay = await post(
        `/admin/users/${targetInRegionB.id}/assignment-batches`,
        tenantAdminToken,
        {
          pairs: substituted,
          previewHash: (preview.json() as { previewHash: string }).previewHash,
          confirm: true,
        },
      );
      expect(replay.statusCode).toBe(409);
    });

    it("refuses a batch whose pair already exists, without partial writes", async () => {
      const target = await post("/admin/users", tenantAdminToken, {
        email: `partial.${stamp}@e4w2.local`,
        fullName: "Partial",
        password: PASSWORD,
        pairs: [{ roleCode: assignableRole.code, scopeType: "tenant" }],
      });
      expect(target.statusCode).toBe(201);
      const targetUserId = (target.json() as { user: { id: string } }).user.id;

      const pairs: Pair[] = [
        { roleCode: assignableRole.code, scopeType: "tenant" },
        {
          roleCode: assignableRole.code,
          scopeType: "organization_unit",
          scopeOrganizationUnitId: regionAId,
        },
      ];
      const preview = await post(
        `/admin/users/${targetUserId}/assignment-previews`,
        tenantAdminToken,
        { pairs },
      );
      const commit = await post(
        `/admin/users/${targetUserId}/assignment-batches`,
        tenantAdminToken,
        {
          pairs,
          previewHash: (preview.json() as { previewHash: string }).previewHash,
          confirm: true,
        },
      );
      // All-or-nothing (§4.4 C): the second pair never lands.
      expect(commit.statusCode).toBe(409);
      const count = await pool.query(
        `SELECT count(*)::int AS count FROM user_role_assignments WHERE user_id = $1`,
        [targetUserId],
      );
      expect(count.rows[0].count).toBe(1);
    });

    it("refuses an empty pair set and a missing confirmation flag", async () => {
      const empty = await post(
        `/admin/users/${unassignedTarget.id}/assignment-previews`,
        tenantAdminToken,
        { pairs: [] },
      );
      expect(empty.statusCode).toBe(400);

      const noConfirm = await post(
        `/admin/users/${unassignedTarget.id}/assignment-batches`,
        tenantAdminToken,
        { pairs: [{ roleCode: assignableRole.code, scopeType: "tenant" }], previewHash: "x" },
      );
      expect(noConfirm.statusCode).toBe(400);
    });

    it("refuses Customer scope by name through the batch surface", async () => {
      const customerId = await createCustomer(tenantId, `Wave2 Customer ${codeStamp}`);
      const response = await post(
        `/admin/users/${unassignedTarget.id}/assignment-previews`,
        tenantAdminToken,
        {
          pairs: [
            { roleCode: assignableRole.code, scopeType: "customer", scopeCustomerId: customerId },
          ],
        },
      );
      expect(response.statusCode).toBe(400);
      expect(response.json().error).toMatch(/customer-scope/i);
    });
  });

  // ------------------------------------------------------------------
  // §4.4 D/E/H — authority on the write path.
  // ------------------------------------------------------------------
  describe("authority on the assignment surfaces", () => {
    it("lets a Region administrator assign inside its own subtree", async () => {
      // `siteA` rather than `teamX`: the fixture already grants this Role at
      // `teamX`, and the unique index makes a repeat a conflict, not a grant.
      // The pair still sits inside the Region administrator's subtree.
      const pairs: Pair[] = [
        {
          roleCode: assignableRole.code,
          scopeType: "organization_unit",
          scopeOrganizationUnitId: siteAId,
        },
      ];
      const preview = await post(
        `/admin/users/${targetInTeamX.id}/assignment-previews`,
        regionAdminToken,
        { pairs },
      );
      expect(preview.statusCode).toBe(200);
      const commit = await post(
        `/admin/users/${targetInTeamX.id}/assignment-batches`,
        regionAdminToken,
        {
          pairs,
          previewHash: (preview.json() as { previewHash: string }).previewHash,
          confirm: true,
        },
      );
      expect(commit.statusCode).toBe(201);
      expect((commit.json() as { created: unknown[] }).created).toHaveLength(1);
    });

    it("refuses a tenant-wide pair to a Region administrator", async () => {
      const response = await post(
        `/admin/users/${targetInTeamX.id}/assignment-previews`,
        regionAdminToken,
        { pairs: [{ roleCode: assignableRole.code, scopeType: "tenant" }] },
      );
      expect(response.statusCode).toBe(403);
      expect(response.json().error).toMatch(/tenant-wide/i);
    });

    it("refuses a target outside the actor's Data Scope with a 404", async () => {
      // Both refusals of an out-of-visibility target are 404s: the target User
      // is foreign, and so would be the scope unit if the target were visible.
      // One indistinguishable answer keeps the surface an existence oracle for
      // neither (§4.4 risk row 1).
      const target = await post(
        `/admin/users/${targetInRegionB.id}/assignment-previews`,
        regionAdminToken,
        {
          pairs: [
            {
              roleCode: assignableRole.code,
              scopeType: "organization_unit",
              scopeOrganizationUnitId: regionBId,
            },
          ],
        },
      );
      expect(target.statusCode).toBe(404);
      expect(target.json().error).toMatch(/^User [0-9a-f-]{36} not found$/);
    });

    it("refuses a scope unit above the actor's authority", async () => {
      // `targetInTeamX` sits inside the Region administrator's visibility, so
      // §4.4 step 3's target check passes and the refusal comes from the PAIR:
      // `regionA` is the actor's PARENT — its authority reaches down, never up
      // (§4.4 E), so the target subtree check refuses.
      const response = await post(
        `/admin/users/${targetInTeamX.id}/assignment-previews`,
        regionAdminToken,
        {
          pairs: [
            {
              roleCode: assignableRole.code,
              scopeType: "organization_unit",
              scopeOrganizationUnitId: regionAId,
            },
          ],
        },
      );
      expect(response.statusCode).toBe(403);
      expect(response.json().error).toBe(
        "Assignment target is outside your Data Scope",
      );
    });
  });

  // ------------------------------------------------------------------
  // §4.4 D — the two surfaces answer the same question the same way. This
  // is the regression that keeps the delegation ceiling anchored on the
  // permission the act actually needs.
  // ------------------------------------------------------------------
  describe("two-surface policy identity (§4.4 D)", () => {
    it("refuses a Role outside the ceiling identically on both surfaces", async () => {
      const single = await post(
        `/admin/users/${unassignedTarget.id}/role-assignments`,
        tenantAdminToken,
        { roleCode: outsideCeilingRole.code, scopeType: "tenant" },
      );
      expect(single.statusCode).toBe(400);

      const batch = await post(
        `/admin/users/${unassignedTarget.id}/assignment-previews`,
        tenantAdminToken,
        { pairs: [{ roleCode: outsideCeilingRole.code, scopeType: "tenant" }] },
      );
      expect(batch.statusCode).toBe(400);
      // Not merely the same status — the same reason, which is what §4.4 D
      // requires when one action is reachable from two routes.
      expect(batch.json().error).toBe(single.json().error);
      expect(batch.json().error).toMatch(/outside your delegation authority/i);
    });

    it("refuses a Role whose module is inactive with its own reason (§4.4 step 23)", async () => {
      const single = await post(
        `/admin/users/${unassignedTarget.id}/role-assignments`,
        moduleAdminToken,
        { roleCode: financeRole.code, scopeType: "tenant" },
      );
      expect(single.statusCode).toBe(400);
      expect(single.json().error).toMatch(/module 'finance' which is not active/i);

      const batch = await post(
        `/admin/users/${unassignedTarget.id}/assignment-previews`,
        moduleAdminToken,
        { pairs: [{ roleCode: financeRole.code, scopeType: "tenant" }] },
      );
      expect(batch.statusCode).toBe(400);
      expect(batch.json().error).toBe(single.json().error);
    });

    it("lets both surfaces grant the same Role inside the ceiling", async () => {
      const singleTarget = await post("/admin/users", tenantAdminToken, {
        email: `identity-single.${stamp}@e4w2.local`,
        fullName: "Identity Single",
        password: PASSWORD,
        pairs: [],
      });
      const singleTargetId = (singleTarget.json() as { user: { id: string } }).user.id;
      const single = await post(
        `/admin/users/${singleTargetId}/role-assignments`,
        tenantAdminToken,
        { roleCode: assignableRole.code, scopeType: "tenant" },
      );
      expect(single.statusCode).toBe(201);

      const batchTarget = await post("/admin/users", tenantAdminToken, {
        email: `identity-batch.${stamp}@e4w2.local`,
        fullName: "Identity Batch",
        password: PASSWORD,
        pairs: [],
      });
      const batchTargetId = (batchTarget.json() as { user: { id: string } }).user.id;
      const pairs: Pair[] = [{ roleCode: assignableRole.code, scopeType: "tenant" }];
      const preview = await post(
        `/admin/users/${batchTargetId}/assignment-previews`,
        tenantAdminToken,
        { pairs },
      );
      const batch = await post(
        `/admin/users/${batchTargetId}/assignment-batches`,
        tenantAdminToken,
        {
          pairs,
          previewHash: (preview.json() as { previewHash: string }).previewHash,
          confirm: true,
        },
      );
      expect(batch.statusCode).toBe(201);

      // Both surfaces produce the same shape of grant.
      const left = await get(`/admin/users/${singleTargetId}/access`, tenantAdminToken);
      const right = await get(`/admin/users/${batchTargetId}/access`, tenantAdminToken);
      const project = (response: LightMyRequestResponse) =>
        (response.json() as { roleAssignments: Array<Record<string, unknown>> })
          .roleAssignments.map((assignment) => ({
            roleCode: assignment.roleCode,
            scopeType: assignment.scopeType,
            scopeState: assignment.scopeState,
          }));
      expect(project(left)).toEqual(project(right));
    });
  });
});
