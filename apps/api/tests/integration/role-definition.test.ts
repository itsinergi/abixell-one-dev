import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../../src/app.js";
import { pool } from "../../src/infrastructure/persistence/db.js";
import { signAccessToken } from "../../src/infrastructure/security/jwt.js";
import { authHeader, bootstrapTenant, sessionTokenFor } from "./helpers.js";

const REQUIRED_DATABASE = "abixell_one_epic3_wave4";
// The tenant bootstrap endpoint caps `code` at 32 characters and role codes at
// 100, so the stamp stays short: 7 base-36 digits plus 6 hex characters.
const stamp = `${Date.now().toString(36)}${randomUUID().replaceAll("-", "").slice(0, 6)}`;
const codeStamp = stamp.toUpperCase();
const TENANT = `rd-${stamp}`;
const OTHER_TENANT = `rdo-${stamp}`;
const MANAGER_PERMISSIONS = [
  "admin.console.read",
  "config.read",
  "role.manage",
  "hse.read",
];

const app = buildApp();

interface RoleFixture {
  id: string;
  code: string;
}

interface UserFixture {
  id: string;
}

function roleCode(name: string) {
  return `RD_${name}_${codeStamp}`;
}

function tokenFor(tenantId: string, user: UserFixture): Promise<string> {
  // Epic 1 (§4.1 F): a bearer token must name a session, so fixtures create
  // one the way the login endpoint does instead of signing a bare payload.
  return sessionTokenFor({ userId: user.id, tenantId });
}

function assertIsolatedDatabase() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error(`DATABASE_URL must target ${REQUIRED_DATABASE}`);
  }
  const databaseName = new URL(databaseUrl).pathname.replace(/^\//, "");
  if (databaseName !== REQUIRED_DATABASE) {
    throw new Error(
      `Role-definition integration tests require ${REQUIRED_DATABASE}, got ${databaseName}`,
    );
  }
}

async function createRole(
  tenantId: string,
  code: string,
  permissionCodes: string[] = [],
  isFullAccess = false,
): Promise<RoleFixture> {
  const role = await pool.query(
    `INSERT INTO roles (tenant_id, code, name, is_full_access)
     VALUES ($1, $2, $3, $4)
     RETURNING id, code`,
    [tenantId, code, `Fixture ${code}`, isFullAccess],
  );
  const missing = await pool.query(
    `SELECT code FROM unnest($1::text[]) AS requested(code)
     WHERE NOT EXISTS (SELECT 1 FROM permissions p WHERE p.code = requested.code)`,
    [permissionCodes],
  );
  if (missing.rows.length > 0) {
    throw new Error(`Missing fixture permissions: ${missing.rows.map((row) => row.code).join(", ")}`);
  }
  if (permissionCodes.length > 0) {
    await pool.query(
      `INSERT INTO role_permissions (role_id, permission_id)
       SELECT $1, id FROM permissions WHERE code = ANY($2::text[])`,
      [role.rows[0].id, permissionCodes],
    );
  }
  return role.rows[0] as RoleFixture;
}

async function createUser(tenantId: string, name: string): Promise<UserFixture> {
  const user = await pool.query(
    `INSERT INTO users (tenant_id, email, password_hash, full_name)
     VALUES ($1, $2, 'fixture-password-hash', $3)
     RETURNING id`,
    [tenantId, `${name}.${stamp}@role-definition.test`, `Role Definition ${name}`],
  );
  return user.rows[0] as UserFixture;
}

async function assignTenantRole(userId: string, roleId: string) {
  const assignment = await pool.query(
    `INSERT INTO user_role_assignments (user_id, role_id, scope_type)
     VALUES ($1, $2, 'tenant')
     RETURNING id`,
    [userId, roleId],
  );
  return assignment.rows[0].id as string;
}

async function get(url: string, token: string) {
  return app.inject({ method: "GET", url, headers: authHeader(token) });
}

async function post(url: string, token: string, payload: unknown) {
  return app.inject({ method: "POST", url, headers: authHeader(token), payload });
}

async function put(url: string, token: string, payload: unknown) {
  return app.inject({ method: "PUT", url, headers: authHeader(token), payload });
}

async function remove(url: string, token: string) {
  return app.inject({ method: "DELETE", url, headers: authHeader(token) });
}

describe("Epic 4 Wave 1 — Role definitions", () => {
  let tenantId: string;
  let otherTenantId: string;
  let managerToken: string;
  let otherManagerToken: string;
  let splitAuthorityToken: string;

  beforeAll(async () => {
    assertIsolatedDatabase();

    const tenant = await bootstrapTenant(app, TENANT, "Role definition test tenant");
    tenantId = tenant.id;
    const managerRole = await createRole(
      tenantId,
      roleCode("MANAGER"),
      MANAGER_PERMISSIONS,
    );
    const manager = await createUser(tenantId, "manager");
    await assignTenantRole(manager.id, managerRole.id);
    managerToken = await tokenFor(tenantId, manager);

    const entryRole = await createRole(tenantId, roleCode("SPLIT_ENTRY"), [
      "admin.console.read",
    ]);
    const manageRole = await createRole(tenantId, roleCode("SPLIT_MANAGE"), [
      "role.manage",
    ]);
    const configRole = await createRole(tenantId, roleCode("SPLIT_CONFIG"), [
      "config.read",
    ]);
    const splitAuthority = await createUser(tenantId, "split-authority");
    const entryAssignmentId = await assignTenantRole(splitAuthority.id, entryRole.id);
    await assignTenantRole(splitAuthority.id, manageRole.id);
    await assignTenantRole(splitAuthority.id, configRole.id);
    // Epic 1 (§4.1 B): the default active Role is the first by name, which
    // here is the config-only Role and would refuse console entry before the
    // assertions below could probe anything. The session is pinned to the
    // entry Role instead — the only one of the three holding
    // admin.console.read — the way a user would pick it in the role picker.
    splitAuthorityToken = await sessionTokenFor({
      userId: splitAuthority.id,
      tenantId,
      activeAssignmentId: entryAssignmentId,
    });

    const otherTenant = await bootstrapTenant(
      app,
      OTHER_TENANT,
      "Other role definition test tenant",
    );
    otherTenantId = otherTenant.id;
    const otherManagerRole = await createRole(
      otherTenantId,
      roleCode("OTHER_MANAGER"),
      MANAGER_PERMISSIONS,
    );
    const otherManager = await createUser(otherTenantId, "other-manager");
    await assignTenantRole(otherManager.id, otherManagerRole.id);
    otherManagerToken = await tokenFor(otherTenantId, otherManager);

    await pool.query(
      `UPDATE tenant_module_activations tma
          SET is_active = false
         FROM modules m
        WHERE tma.tenant_id = $1
          AND tma.module_id = m.id
          AND m.code = 'hse'`,
      [tenantId],
    );
  });

  afterAll(async () => {
    if (tenantId || otherTenantId) {
      await pool.query(`DELETE FROM tenants WHERE id = ANY($1::uuid[])`, [
        [tenantId, otherTenantId].filter(Boolean),
      ]);
    }
    await app.close();
    await pool.end();
  });

  it("reports roleManage only for a tenant-scoped delegated manager", async () => {
    const managerOverview = await get("/admin/overview", managerToken);
    expect(managerOverview.statusCode).toBe(200);
    expect(managerOverview.json().capabilities.roleManage).toBe(true);

    const splitOverview = await get("/admin/overview", splitAuthorityToken);
    expect(splitOverview.statusCode).toBe(200);
    // Epic 1 (§4.1 C): the ACTIVE Role is what authorizes. The split user's
    // active assignment carries only console entry, so roleManage is reported
    // false even though the user also holds a (switched-away) role.manage.
    expect(splitOverview.json().capabilities.roleManage).toBe(false);
  });

  it("creates, copies, previews, updates, and deletes detached role definitions", async () => {
    const sourceCode = roleCode("LIFECYCLE_SOURCE");
    const copyCode = roleCode("LIFECYCLE_COPY");
    const created = await post("/admin/roles", managerToken, {
      code: sourceCode,
      name: "Lifecycle source",
      permissionCodes: ["config.read"],
      windows: [],
    });
    expect(created.statusCode).toBe(201);
    expect(created.json()).toMatchObject({
      code: sourceCode,
      name: "Lifecycle source",
      isFullAccess: false,
      version: 1,
      permissionCodes: ["config.read"],
      windows: [],
      // Derived from the server's served-route census (step 11b): enforced
      // while no mutating route is unaccounted for — mapped or exempted.
      enforcementStatus: "enforced",
    });

    const copied = await post(`/admin/roles/${sourceCode}/copy`, managerToken, {
      code: copyCode,
      name: "Lifecycle copy",
    });
    expect(copied.statusCode).toBe(201);
    expect(copied.json()).toMatchObject({
      code: copyCode,
      name: "Lifecycle copy",
      isFullAccess: false,
      version: 1,
      permissionCodes: ["config.read"],
      windows: [],
    });
    const copiedAssignments = await pool.query(
      `SELECT COUNT(*)::int AS count
         FROM user_role_assignments ura
         JOIN roles r ON r.id = ura.role_id
        WHERE r.tenant_id = $1 AND r.code = $2`,
      [tenantId, copyCode],
    );
    expect(copiedAssignments.rows[0].count).toBe(0);

    const preview = await post(`/admin/roles/${copyCode}/preview`, managerToken, {
      version: 1,
      name: "Lifecycle copy updated",
      description: null,
      permissionCodes: ["config.read", "role.manage"],
      windows: [],
    });
    expect(preview.statusCode).toBe(200);
    const previewBody = preview.json();
    expect(previewBody).toMatchObject({
      affectedUserCount: 0,
      role: {
        code: copyCode,
        name: "Lifecycle copy updated",
        version: 1,
        permissionCodes: ["config.read", "role.manage"],
      },
    });

    const updated = await put(`/admin/roles/${copyCode}/definition`, managerToken, {
      version: 1,
      name: "Lifecycle copy updated",
      description: null,
      permissionCodes: ["config.read", "role.manage"],
      windows: [],
      previewHash: previewBody.previewHash,
      confirm: true,
    });
    expect(updated.statusCode).toBe(200);
    expect(updated.json()).toMatchObject({
      code: copyCode,
      version: 2,
      permissionCodes: ["config.read", "role.manage"],
    });

    const deleted = await remove(`/admin/roles/${copyCode}/definition`, managerToken);
    expect(deleted.statusCode).toBe(204);
    expect((await get(`/admin/roles/${copyCode}/definition`, managerToken)).statusCode).toBe(404);
  });

  it("rejects stale versions and mismatched preview hashes", async () => {
    const code = roleCode("CONCURRENCY");
    const created = await post("/admin/roles", managerToken, {
      code,
      name: "Concurrency role",
      permissionCodes: ["config.read"],
      windows: [],
    });
    expect(created.statusCode).toBe(201);

    const stalePreview = await post(`/admin/roles/${code}/preview`, managerToken, {
      version: 2,
      name: "Concurrency role changed",
      description: null,
      permissionCodes: ["config.read"],
      windows: [],
    });
    expect(stalePreview.statusCode).toBe(409);

    const badHash = await put(`/admin/roles/${code}/definition`, managerToken, {
      version: 1,
      name: "Concurrency role changed",
      description: null,
      permissionCodes: ["config.read"],
      windows: [],
      previewHash: "not-the-server-preview-hash",
      confirm: true,
    });
    expect(badHash.statusCode).toBe(409);

    const staleUpdate = await put(`/admin/roles/${code}/definition`, managerToken, {
      version: 2,
      name: "Concurrency role changed",
      description: null,
      permissionCodes: ["config.read"],
      windows: [],
      previewHash: "not-the-server-preview-hash",
      confirm: true,
    });
    expect(staleUpdate.statusCode).toBe(409);
  });

  it("keeps version and audit count stable for a no-op commit", async () => {
    const code = roleCode("NOOP");
    const created = await post("/admin/roles", managerToken, {
      code,
      name: "No-op role",
      permissionCodes: ["config.read"],
      windows: [],
    });
    expect(created.statusCode).toBe(201);

    const preview = await post(`/admin/roles/${code}/preview`, managerToken, {
      version: 1,
      name: "No-op role",
      description: null,
      permissionCodes: ["config.read"],
      windows: [],
    });
    expect(preview.statusCode).toBe(200);
    const auditBefore = await pool.query(
      `SELECT COUNT(*)::int AS count
         FROM audit_log
        WHERE tenant_id = $1
          AND action = 'role.definition_updated'
          AND metadata->>'roleCode' = $2`,
      [tenantId, code],
    );

    const updated = await put(`/admin/roles/${code}/definition`, managerToken, {
      version: 1,
      name: "No-op role",
      description: null,
      permissionCodes: ["config.read"],
      windows: [],
      previewHash: preview.json().previewHash,
      confirm: true,
    });
    expect(updated.statusCode).toBe(200);
    expect(updated.json().version).toBe(1);

    const stored = await pool.query(
      `SELECT version FROM roles WHERE tenant_id = $1 AND code = $2`,
      [tenantId, code],
    );
    expect(stored.rows[0].version).toBe(1);
    const auditAfter = await pool.query(
      `SELECT COUNT(*)::int AS count
         FROM audit_log
        WHERE tenant_id = $1
          AND action = 'role.definition_updated'
          AND metadata->>'roleCode' = $2`,
      [tenantId, code],
    );
    expect(auditAfter.rows[0].count).toBe(auditBefore.rows[0].count);
  });

  it("commits assignment drift and audits count at commit time", async () => {
    const code = roleCode("ASSIGNMENT_DRIFT");
    const created = await post("/admin/roles", managerToken, {
      code,
      name: "Assignment drift role",
      permissionCodes: ["config.read"],
      windows: [],
    });
    expect(created.statusCode).toBe(201);
    const role = await pool.query(
      `SELECT id FROM roles WHERE tenant_id = $1 AND code = $2`,
      [tenantId, code],
    );
    const firstUser = await createUser(tenantId, "drift-one");
    await assignTenantRole(firstUser.id, role.rows[0].id);

    const preview = await post(`/admin/roles/${code}/preview`, managerToken, {
      version: 1,
      name: "Assignment drift role changed",
      description: null,
      permissionCodes: ["config.read", "role.manage"],
      windows: [],
    });
    expect(preview.statusCode).toBe(200);
    expect(preview.json().affectedUserCount).toBe(1);

    const secondUser = await createUser(tenantId, "drift-two");
    await assignTenantRole(secondUser.id, role.rows[0].id);

    const updated = await put(`/admin/roles/${code}/definition`, managerToken, {
      version: 1,
      name: "Assignment drift role changed",
      description: null,
      permissionCodes: ["config.read", "role.manage"],
      windows: [],
      previewHash: preview.json().previewHash,
      confirm: true,
    });
    expect(updated.statusCode).toBe(200);
    expect(updated.json().version).toBe(2);

    const audit = await pool.query(
      `SELECT metadata
         FROM audit_log
        WHERE tenant_id = $1
          AND action = 'role.definition_updated'
          AND metadata->>'roleCode' = $2
        ORDER BY created_at DESC
        LIMIT 1`,
      [tenantId, code],
    );
    expect(audit.rows[0].metadata.affectedUserCount).toBe(2);
  });

  it("blocks deletion for soft-deleted and invalidated retained assignments with exact count", async () => {
    const code = roleCode("RETAINED");
    const created = await post("/admin/roles", managerToken, {
      code,
      name: "Retained assignment role",
      permissionCodes: ["config.read"],
      windows: [],
    });
    expect(created.statusCode).toBe(201);
    const role = await pool.query(
      `SELECT id FROM roles WHERE tenant_id = $1 AND code = $2`,
      [tenantId, code],
    );

    const deletedUser = await createUser(tenantId, "retained-deleted");
    await assignTenantRole(deletedUser.id, role.rows[0].id);
    await pool.query(`UPDATE users SET deleted_at = now() WHERE id = $1`, [deletedUser.id]);

    const invalidatedUser = await createUser(tenantId, "retained-invalidated");
    const invalidatedAssignment = await assignTenantRole(invalidatedUser.id, role.rows[0].id);
    await pool.query(
      `UPDATE user_role_assignments SET scope_invalidated_at = now() WHERE id = $1`,
      [invalidatedAssignment],
    );

    const retained = await pool.query(
      `SELECT COUNT(*)::int AS count
         FROM user_role_assignments ura
         JOIN roles r ON r.id = ura.role_id
        WHERE r.tenant_id = $1 AND r.code = $2`,
      [tenantId, code],
    );
    expect(retained.rows[0].count).toBe(2);

    const deleted = await remove(`/admin/roles/${code}/definition`, managerToken);
    expect(deleted.statusCode).toBe(409);
    expect(deleted.json().error).toContain("2 User assignment(s) still reference it");
  });

  it.each(["config.read", "admin.console.read"])(
    "blocks removing %s from the actor's own Role definition authority",
    async (removedPermission) => {
      const role = await pool.query(
        `SELECT id, version, name
           FROM roles
          WHERE tenant_id = $1 AND code = $2`,
        [tenantId, roleCode("MANAGER")],
      );
      const current = await get(
        `/admin/roles/${roleCode("MANAGER")}/definition`,
        managerToken,
      );
      expect(current.statusCode).toBe(200);
      const currentBody = current.json();
      const permissionCodes = currentBody.permissionCodes.filter(
        (code: string) => code !== removedPermission,
      );

      const preview = await post(
        `/admin/roles/${roleCode("MANAGER")}/preview`,
        managerToken,
        {
          version: role.rows[0].version,
          name: role.rows[0].name,
          description: null,
          permissionCodes,
          windows: currentBody.windows,
        },
      );
      expect(preview.statusCode).toBe(200);

      const updated = await put(
        `/admin/roles/${roleCode("MANAGER")}/definition`,
        managerToken,
        {
          version: role.rows[0].version,
          name: role.rows[0].name,
          description: null,
          permissionCodes,
          windows: currentBody.windows,
          previewHash: preview.json().previewHash,
          confirm: true,
        },
      );
      expect(updated.statusCode).toBe(409);
      expect(updated.json().error).toContain(`'${removedPermission}'`);

      const stored = await pool.query(
        `SELECT p.code
           FROM role_permissions rp
           JOIN permissions p ON p.id = rp.permission_id
          WHERE rp.role_id = $1`,
        [role.rows[0].id],
      );
      expect(stored.rows.map((row) => row.code)).toContain(removedPermission);
    },
  );

  it("rejects strict extra inputs, duplicate grants, and full-access requests", async () => {
    const fullAccess = await post("/admin/roles", managerToken, {
      code: roleCode("FULL_ACCESS_REQUEST"),
      name: "Rejected full access request",
      permissionCodes: ["config.read"],
      windows: [],
      isFullAccess: true,
    });
    expect(fullAccess.statusCode).toBe(400);

    const duplicate = await post("/admin/roles", managerToken, {
      code: roleCode("DUPLICATE"),
      name: "Duplicate grants",
      permissionCodes: ["config.read", "config.read"],
      windows: [],
    });
    expect(duplicate.statusCode).toBe(400);

    const malformedWindow = await post("/admin/roles", managerToken, {
      code: roleCode("WINDOW_EXTRA"),
      name: "Window extra property",
      permissionCodes: ["config.read"],
      windows: [
        {
          windowCode: "route:/admin",
          isReadWrite: false,
          isActive: true,
          ignored: true,
        },
      ],
    });
    expect(malformedWindow.statusCode).toBe(400);
  });

  it("enforces tenant isolation across role-definition routes", async () => {
    const code = roleCode("TENANT_LOCAL");
    const created = await post("/admin/roles", managerToken, {
      code,
      name: "Tenant local role",
      permissionCodes: ["config.read"],
      windows: [],
    });
    expect(created.statusCode).toBe(201);

    expect((await get(`/admin/roles/${code}/definition`, otherManagerToken)).statusCode).toBe(404);
    expect((await post(`/admin/roles/${code}/copy`, otherManagerToken, {
      code: roleCode("FOREIGN_COPY"),
      name: "Foreign copy",
    })).statusCode).toBe(404);
    const foreignRows = await pool.query(
      `SELECT COUNT(*)::int AS count FROM roles WHERE tenant_id = $1 AND code = $2`,
      [otherTenantId, roleCode("FOREIGN_COPY")],
    );
    expect(foreignRows.rows[0].count).toBe(0);
  });

  it("enforces delegation and active-module ceilings", async () => {
    const outsideAuthority = await post("/admin/roles", managerToken, {
      code: roleCode("OUTSIDE_AUTHORITY"),
      name: "Outside authority",
      permissionCodes: ["user.read"],
      windows: [],
    });
    expect(outsideAuthority.statusCode).toBe(400);
    expect(outsideAuthority.json().error).toContain("outside your delegation authority");

    const inactiveModule = await post("/admin/roles", managerToken, {
      code: roleCode("INACTIVE_MODULE"),
      name: "Inactive module",
      permissionCodes: ["hse.read"],
      windows: [],
    });
    expect(inactiveModule.statusCode).toBe(400);
    expect(inactiveModule.json().error).toContain("Module 'hse' is not active");

    const options = await get("/admin/role-definition-options", managerToken);
    expect(options.statusCode).toBe(200);
    const hsePermission = options.json().permissions.find((permission: { code: string }) => permission.code === "hse.read");
    expect(hsePermission).toMatchObject({ isActive: true, selectable: false });
  });

  it("excludes wildcard route:* from options and rejects it as a Role window", async () => {
    const options = await get("/admin/role-definition-options", managerToken);
    expect(options.statusCode).toBe(200);
    expect(options.json().windows.some((window: { code: string }) => window.code === "route:*")).toBe(false);

    const wildcard = await post("/admin/roles", managerToken, {
      code: roleCode("WILDCARD"),
      name: "Wildcard window",
      permissionCodes: ["config.read"],
      windows: [
        {
          windowCode: "route:*",
          isReadWrite: false,
          isActive: true,
        },
      ],
    });
    expect(wildcard.statusCode).toBe(400);
    expect(wildcard.json().error).toContain("wildcard route");
  });

  it("rejects delegation assembled from separate assignments", async () => {
    const response = await post("/admin/roles", splitAuthorityToken, {
      code: roleCode("SPLIT_DELEGATION"),
      name: "Split delegation must fail",
      permissionCodes: [],
      windows: [],
    });
    expect(response.statusCode).toBe(403);
    // Epic 1 (§4.1 C): the refusal now fires at the active-Role precheck —
    // the session's active assignment (console entry only) cannot carry the
    // tenant-scoped role.manage the write requires, and a Role the user holds
    // but has not switched into grants nothing. The deeper transactional
    // authority check (same-assignment role.manage + config.read) still
    // exists behind this gate for the case the precheck passes but the two
    // permissions sit on different assignments.
    expect(response.json().error).toContain(
      "Missing tenant-scoped permission 'role.manage' in the active Role",
    );
  });

  it("round-trips description through create, copy, preview, and update", async () => {
    const sourceCode = roleCode("DESCRIPTION_SOURCE");
    const copyCode = roleCode("DESCRIPTION_COPY");
    const created = await post("/admin/roles", managerToken, {
      code: sourceCode,
      name: "Description source",
      description: "Owns the first-level approval for purchase requests.",
      permissionCodes: ["config.read"],
      windows: [],
    });
    expect(created.statusCode).toBe(201);
    expect(created.json().description).toBe(
      "Owns the first-level approval for purchase requests.",
    );

    // Omitted on copy means "carry the source's description".
    const copied = await post(`/admin/roles/${sourceCode}/copy`, managerToken, {
      code: copyCode,
      name: "Description copy",
    });
    expect(copied.statusCode).toBe(201);
    expect(copied.json().description).toBe(
      "Owns the first-level approval for purchase requests.",
    );

    // A supplied description overrides the carried one.
    const copyCodeTwo = roleCode("DESCRIPTION_COPY_TWO");
    const copiedTwo = await post(`/admin/roles/${sourceCode}/copy`, managerToken, {
      code: copyCodeTwo,
      name: "Description copy two",
      description: "Overridden on copy.",
    });
    expect(copiedTwo.statusCode).toBe(201);
    expect(copiedTwo.json().description).toBe("Overridden on copy.");

    // An empty string is operator-authored text, preserved as-is; it is NOT
    // flattened to null. Null is the only "never had one" value.
    const previewEmpty = await post(
      `/admin/roles/${copyCode}/preview`,
      managerToken,
      {
        version: 1,
        name: "Description copy",
        description: "",
        permissionCodes: ["config.read"],
        windows: [],
      },
    );
    expect(previewEmpty.statusCode).toBe(200);
    expect(previewEmpty.json().role.description).toBe("");

    const updatedEmpty = await put(
      `/admin/roles/${copyCode}/definition`,
      managerToken,
      {
        version: 1,
        name: "Description copy",
        description: "",
        permissionCodes: ["config.read"],
        windows: [],
        previewHash: previewEmpty.json().previewHash,
        confirm: true,
      },
    );
    expect(updatedEmpty.statusCode).toBe(200);
    // Version bumps on a description-only change...
    expect(updatedEmpty.json().version).toBe(2);
    expect(updatedEmpty.json().description).toBe("");

    const readBack = await get(`/admin/roles/${copyCode}/definition`, managerToken);
    expect(readBack.statusCode).toBe(200);
    expect(readBack.json().description).toBe("");

    // ...and null is preserved as null on the way back too.
    const previewNull = await post(
      `/admin/roles/${copyCode}/preview`,
      managerToken,
      {
        version: 2,
        name: "Description copy",
        description: null,
        permissionCodes: ["config.read"],
        windows: [],
      },
    );
    expect(previewNull.statusCode).toBe(200);
    const updatedNull = await put(
      `/admin/roles/${copyCode}/definition`,
      managerToken,
      {
        version: 2,
        name: "Description copy",
        description: null,
        permissionCodes: ["config.read"],
        windows: [],
        previewHash: previewNull.json().previewHash,
        confirm: true,
      },
    );
    expect(updatedNull.statusCode).toBe(200);
    expect(updatedNull.json().version).toBe(3);
    expect(updatedNull.json().description).toBeNull();
  });

  it("rejects an over-long description and omits nothing on the whole-definition routes", async () => {
    const overlong = await post("/admin/roles", managerToken, {
      code: roleCode("DESCRIPTION_OVERLONG"),
      name: "Over-long description",
      description: "x".repeat(501),
      permissionCodes: ["config.read"],
      windows: [],
    });
    expect(overlong.statusCode).toBe(400);
    expect(
      (
        await pool.query(
          `SELECT COUNT(*)::int AS count FROM roles
            WHERE tenant_id = $1 AND code = $2`,
          [tenantId, roleCode("DESCRIPTION_OVERLONG")],
        )
      ).rows[0].count,
    ).toBe(0);

    // A 500-character description is exactly at the cap and accepted.
    const atCap = await post("/admin/roles", managerToken, {
      code: roleCode("DESCRIPTION_AT_CAP"),
      name: "At-cap description",
      description: "y".repeat(500),
      permissionCodes: ["config.read"],
      windows: [],
    });
    expect(atCap.statusCode).toBe(201);
    expect((atCap.json().description as string).length).toBe(500);

    // The preview states the whole definition, so an omitted description is a
    // 400 — an accidental blank must not slip through the hash, which covers
    // only the authorization fields.
    const omitted = await post(
      `/admin/roles/${roleCode("DESCRIPTION_AT_CAP")}/preview`,
      managerToken,
      {
        version: 1,
        name: "At-cap description",
        permissionCodes: ["config.read"],
        windows: [],
      },
    );
    expect(omitted.statusCode).toBe(400);
  });

  it("refuses to deactivate a Role while a live assignment references it", async () => {
    const code = roleCode("DEACTIVATION");
    const created = await post("/admin/roles", managerToken, {
      code,
      name: "Deactivation role",
      permissionCodes: ["config.read"],
      windows: [],
    });
    expect(created.statusCode).toBe(201);
    expect(created.json().isActive).toBe(true);

    const role = await pool.query(
      `SELECT id FROM roles WHERE tenant_id = $1 AND code = $2`,
      [tenantId, code],
    );
    const holder = await createUser(tenantId, "deactivation-holder");
    const assignmentId = await assignTenantRole(holder.id, role.rows[0].id);

    const refused = await post(`/admin/roles/${code}/active-state`, managerToken, {
      isActive: false,
    });
    expect(refused.statusCode).toBe(409);
    expect(refused.json().error).toContain("1 live User assignment(s)");
    expect(
      (
        await pool.query(`SELECT is_active FROM roles WHERE id = $1`, [
          role.rows[0].id,
        ])
      ).rows[0].is_active,
    ).toBe(true);

    // The guard counts LIVE rows only. A revoked grant keeps its row (Wave 3
    // revocation is soft) and must not block deactivation.
    await pool.query(
      `UPDATE user_role_assignments
          SET revoked_at = now(), revoked_by = $2, revoke_reason = 'test'
        WHERE id = $1`,
      [assignmentId, holder.id],
    );

    const deactivated = await post(`/admin/roles/${code}/active-state`, managerToken, {
      isActive: false,
    });
    expect(deactivated.statusCode).toBe(200);
    expect(deactivated.json().isActive).toBe(false);

    // Idempotent: the same request returns the stored definition, no error.
    const again = await post(`/admin/roles/${code}/active-state`, managerToken, {
      isActive: false,
    });
    expect(again.statusCode).toBe(200);
    expect(again.json().isActive).toBe(false);

    // A deactivated Role cannot be granted through the governed surface. The
    // grant path needs user.role.manage, which the role-definition manager
    // above deliberately does not hold — so a dedicated assigner acts here.
    const probeCode = roleCode("DEACTIVATION_PROBE");
    const probeCreated = await post("/admin/roles", managerToken, {
      code: probeCode,
      name: "Deactivation probe role",
      permissionCodes: ["config.read"],
      windows: [],
    });
    expect(probeCreated.statusCode).toBe(201);
    // Nothing references it, so it deactivates immediately.
    const probeDeactivated = await post(
      `/admin/roles/${probeCode}/active-state`,
      managerToken,
      { isActive: false },
    );
    expect(probeDeactivated.statusCode).toBe(200);

    const assignerRole = await createRole(tenantId, roleCode("DEACTIVATION_ASSIGNER"), [
      "admin.console.read",
      "user.role.manage",
    ]);
    const assigner = await createUser(tenantId, "deactivation-assigner");
    await assignTenantRole(assigner.id, assignerRole.id);
    const assignerToken = await tokenFor(tenantId, assigner);

    const probeUser = await createUser(tenantId, "deactivation-probe");
    const probeGrant = await post(
      `/admin/users/${probeUser.id}/role-assignments`,
      assignerToken,
      { roleCode: probeCode, scopeType: "tenant" },
    );
    expect(probeGrant.statusCode).toBe(400);
    expect(probeGrant.json().error).toContain("is deactivated and cannot be assigned");

    const reactivated = await post(`/admin/roles/${code}/active-state`, managerToken, {
      isActive: true,
    });
    expect(reactivated.statusCode).toBe(200);
    expect(reactivated.json().isActive).toBe(true);
  });

  it("keeps a live grant inert when its Role is deactivated, through the projection join", async () => {
    const code = roleCode("DEACTIVATION_EFFECT");
    const created = await post("/admin/roles", managerToken, {
      code,
      name: "Deactivation effect role",
      permissionCodes: ["config.read"],
      windows: [],
    });
    expect(created.statusCode).toBe(201);
    const role = await pool.query(
      `SELECT id FROM roles WHERE tenant_id = $1 AND code = $2`,
      [tenantId, code],
    );

    // The deactivate guard refuses while a live assignment exists, so the row
    // this test needs is written directly — the same fixture convention as
    // the rest of this suite. The view's is_active join predicate is what
    // keeps such a row (drift, restore, a write that bypassed the governed
    // surface) from granting anything.
    const holder = await createUser(tenantId, "deactivation-effect-holder");
    const assignmentId = await assignTenantRole(holder.id, role.rows[0].id);

    const effectiveBefore = await pool.query(
      `SELECT COUNT(*)::int AS count
         FROM authorization_effective_user_role_assignments
        WHERE user_id = $1 AND role_id = $2`,
      [holder.id, role.rows[0].id],
    );
    expect(effectiveBefore.rows[0].count).toBe(1);

    await pool.query(`UPDATE roles SET is_active = false WHERE id = $1`, [
      role.rows[0].id,
    ]);

    // The user row stays administratively visible — the row does not vanish,
    // the grant stops authorizing. That is the JOIN-vs-WHERE distinction.
    const effectiveAfter = await pool.query(
      `SELECT COUNT(*)::int AS count
         FROM authorization_effective_user_role_assignments
        WHERE user_id = $1 AND role_id = $2`,
      [holder.id, role.rows[0].id],
    );
    expect(effectiveAfter.rows[0].count).toBe(0);

    // And back: reactivation re-projects the same untouched row.
    await pool.query(`UPDATE roles SET is_active = true WHERE id = $1`, [
      role.rows[0].id,
    ]);
    const effectiveRestored = await pool.query(
      `SELECT COUNT(*)::int AS count
         FROM authorization_effective_user_role_assignments
        WHERE user_id = $1 AND role_id = $2`,
      [holder.id, role.rows[0].id],
    );
    expect(effectiveRestored.rows[0].count).toBe(1);
  });

  // Runs last on purpose: it deliberately strips the shared `managerToken`
  // actor's own authority, so every earlier test that depends on that token
  // has already run.
  it("allows removing an authority permission when another manager retains the shape", async () => {
    const secondaryRole = await createRole(
      tenantId,
      roleCode("SECONDARY_MANAGER"),
      MANAGER_PERMISSIONS,
    );
    const secondary = await createUser(tenantId, "secondary-manager");
    await assignTenantRole(secondary.id, secondaryRole.id);

    const role = await pool.query(
      `SELECT id, version, name FROM roles WHERE tenant_id = $1 AND code = $2`,
      [tenantId, roleCode("MANAGER")],
    );
    const current = (
      await get(`/admin/roles/${roleCode("MANAGER")}/definition`, managerToken)
    ).json();
    const permissionCodes = current.permissionCodes.filter(
      (code: string) => code !== "config.read",
    );

    const preview = await post(
      `/admin/roles/${roleCode("MANAGER")}/preview`,
      managerToken,
      {
        version: role.rows[0].version,
        name: role.rows[0].name,
        description: null,
        permissionCodes,
        windows: current.windows,
      },
    );
    expect(preview.statusCode).toBe(200);

    const updated = await put(
      `/admin/roles/${roleCode("MANAGER")}/definition`,
      managerToken,
      {
        version: role.rows[0].version,
        name: role.rows[0].name,
        description: null,
        permissionCodes,
        windows: current.windows,
        previewHash: preview.json().previewHash,
        confirm: true,
      },
    );
    expect(updated.statusCode).toBe(200);
    expect(updated.json().permissionCodes).not.toContain("config.read");
  });
});
