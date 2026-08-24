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
import {
  authHeader,
  bootstrapTenant,
  provisionFirstAdmin,
} from "./helpers.js";

/**
 * Phase 11F — Governed Business Admin access management.
 *
 * Fixture setup is deliberately direct SQL. The governed HTTP surface is what
 * these tests exercise; using that same surface to manufacture actors, roles,
 * and assignments would make authorization and manager-survival tests circular.
 */

const stamp = `${Date.now().toString(36)}_${process.pid}_${randomUUID().replaceAll("-", "").slice(0, 8)}`;
const codeStamp = stamp.toUpperCase();
const TENANT = `p11f-${stamp}`;
const OTHER_TENANT = `p11fo-${stamp}`;
const NAMES_TENANT = `p11fn-${stamp}`;
const GUARD_TENANT = `p11fg-${stamp}`;
const PASSWORD = "Passw0rd12345!";

const MANAGER_PERMISSIONS = [
  "admin.console.read",
  "user.read",
  "config.read",
  "user.role.manage",
];
const READ_PERMISSIONS = ["admin.console.read", "user.read", "config.read"];
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

type ScopeFixture =
  | { scopeType: "tenant" }
  | { scopeType: "organization_unit"; scopeOrganizationUnitId: string }
  | { scopeType: "customer"; scopeCustomerId: string };

async function createTenant(code: string, name: string): Promise<string> {
  const result = await pool.query(
    `INSERT INTO tenants (code, name) VALUES ($1, $2) RETURNING id`,
    [code, name],
  );
  return result.rows[0].id as string;
}

async function createRole(
  tenantId: string,
  code: string,
  name: string,
  permissionCodes: string[] = [],
  isFullAccess = false,
): Promise<RoleFixture> {
  const roleResult = await pool.query(
    `INSERT INTO roles (tenant_id, code, name, is_full_access)
     VALUES ($1, $2, $3, $4)
     RETURNING id, code, name`,
    [tenantId, code, name, isFullAccess],
  );
  const role = roleResult.rows[0] as RoleFixture;

  if (permissionCodes.length > 0) {
    const uniqueCodes = [...new Set(permissionCodes)];
    const permissions = await pool.query(
      `SELECT id, code FROM permissions WHERE code = ANY($1::text[])`,
      [uniqueCodes],
    );
    const foundCodes = new Set(
      permissions.rows.map((row) => row.code as string),
    );
    const missing = uniqueCodes.filter((code) => !foundCodes.has(code));
    if (missing.length > 0) {
      throw new Error(
        `Missing Phase 11F fixture permissions: ${missing.join(", ")}`,
      );
    }
    await pool.query(
      `INSERT INTO role_permissions (role_id, permission_id)
       SELECT $1, id FROM permissions WHERE code = ANY($2::text[])`,
      [role.id, uniqueCodes],
    );
  }
  return role;
}

async function createUser(
  tenantId: string,
  localName: string,
  passwordHash: string,
  options: { status?: string; deleted?: boolean } = {},
): Promise<UserFixture> {
  const email = `${localName}.${stamp}@p11f.local`;
  const result = await pool.query(
    `INSERT INTO users
       (tenant_id, email, password_hash, full_name, status, deleted_at)
     VALUES ($1, $2, $3, $4, $5, CASE WHEN $6::boolean THEN now() ELSE NULL END)
     RETURNING id, email`,
    [
      tenantId,
      email,
      passwordHash,
      `Phase 11F ${localName}`,
      options.status ?? "active",
      options.deleted ?? false,
    ],
  );
  return result.rows[0] as UserFixture;
}

async function createAssignment(
  userId: string,
  roleId: string,
  scope: ScopeFixture,
  createdBy: string | null = null,
): Promise<string> {
  const organizationUnitId =
    scope.scopeType === "organization_unit"
      ? scope.scopeOrganizationUnitId
      : null;
  const customerId =
    scope.scopeType === "customer" ? scope.scopeCustomerId : null;
  const result = await pool.query(
    `INSERT INTO user_role_assignments
       (user_id, role_id, scope_type, scope_organization_unit_id,
        scope_customer_id, created_by)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id`,
    [
      userId,
      roleId,
      scope.scopeType,
      organizationUnitId,
      customerId,
      createdBy,
    ],
  );
  return result.rows[0].id as string;
}

async function createOrganizationUnit(
  tenantId: string,
  suffix: string,
): Promise<string> {
  const legalEntity = await pool.query(
    `INSERT INTO legal_entities (tenant_id, name)
     VALUES ($1, $2)
     RETURNING id`,
    [tenantId, `P11F Legal Entity ${suffix}`],
  );
  const organizationUnit = await pool.query(
    `INSERT INTO organization_units (tenant_id, legal_entity_id, name, unit_type)
     VALUES ($1, $2, $3, 'Branch')
     RETURNING id`,
    [tenantId, legalEntity.rows[0].id, `P11F Organization Unit ${suffix}`],
  );
  return organizationUnit.rows[0].id as string;
}

async function createCustomer(
  tenantId: string,
  suffix: string,
): Promise<string> {
  const result = await pool.query(
    `INSERT INTO customers (tenant_id, code, name)
     VALUES ($1, $2, $3)
     RETURNING id`,
    [tenantId, `P11F-${suffix}-${codeStamp}`, `P11F Customer ${suffix}`],
  );
  return result.rows[0].id as string;
}

function tokenFor(tenantId: string, user: UserFixture): string {
  return signAccessToken({ sub: user.id, tenantId });
}

async function get(
  url: string,
  token: string,
): Promise<LightMyRequestResponse> {
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

async function remove(
  url: string,
  token: string,
): Promise<LightMyRequestResponse> {
  return app.inject({ method: "DELETE", url, headers: authHeader(token) });
}

function assignmentUrl(userId: string) {
  return `/admin/users/${userId}/role-assignments`;
}

function removalUrl(userId: string, assignmentId: string) {
  return `${assignmentUrl(userId)}/${assignmentId}`;
}

function tenantPayload(roleCode: string) {
  return { roleCode, scopeType: "tenant" as const };
}

describe("Phase 11F — governed Admin access management", () => {
  let tenantId: string;
  let otherTenantId: string;
  let namesTenantId: string;
  let guardTenantId: string;
  let passwordHash: string;

  let managerRole: RoleFixture;
  let assignableRole: RoleFixture;
  let manager: UserFixture;
  let managerToken: string;
  let readOnly: UserFixture;
  let readOnlyToken: string;
  let bareConsole: UserFixture;
  let bareConsoleToken: string;
  let noConsole: UserFixture;
  let noConsoleToken: string;
  let aggregateActor: UserFixture;
  let aggregateToken: string;
  let target: UserFixture;
  let targetBaseAssignmentId: string;
  let organizationUnitId: string;
  let customerId: string;

  let otherManager: UserFixture;
  let otherManagerToken: string;
  let otherRole: RoleFixture;
  let otherTarget: UserFixture;
  let otherAssignmentId: string;
  let otherOrganizationUnitId: string;
  let otherCustomerId: string;

  const nameOnlyActors: Array<{
    roleCode: string;
    user: UserFixture;
    token: string;
  }> = [];

  let guardA: UserFixture;
  let guardB: UserFixture;
  let guardInactive: UserFixture;
  let guardDeleted: UserFixture;
  let guardAToken: string;
  let guardBToken: string;
  let guardAAssignmentId: string;
  let guardBAssignmentId: string;
  let guardInactiveAssignmentId: string;
  let guardDeletedAssignmentId: string;

  beforeAll(async () => {
    passwordHash = await hashPassword(PASSWORD);

    const primary = await bootstrapTenant(app, TENANT, "Tenant Phase 11F");
    tenantId = primary.id;
    // provisionFirstAdmin receives every migrated permission, including
    // user.role.manage. Keep it tenant-scoped as a real bootstrap survivor,
    // but never use its token: all governed assertions use purpose-built roles.
    await provisionFirstAdmin({
      tenantId,
      email: `bootstrap.${stamp}@p11f.local`,
      password: PASSWORD,
    });

    organizationUnitId = await createOrganizationUnit(tenantId, "Primary");
    customerId = await createCustomer(tenantId, "PRIMARY");
    managerRole = await createRole(
      tenantId,
      `ORDINARY_MANAGER_${codeStamp}`,
      "Ordinary actual-grant manager",
      MANAGER_PERMISSIONS,
    );
    assignableRole = await createRole(
      tenantId,
      `ASSIGNABLE_${codeStamp}`,
      "Ordinary assignable role",
      ["user.read"],
    );
    const readOnlyRole = await createRole(
      tenantId,
      `READ_ONLY_${codeStamp}`,
      "Read-only console actor",
      READ_PERMISSIONS,
    );
    const bareConsoleRole = await createRole(
      tenantId,
      `BARE_CONSOLE_${codeStamp}`,
      "Console entry only",
      ["admin.console.read"],
    );
    const noConsoleRole = await createRole(
      tenantId,
      `NO_CONSOLE_${codeStamp}`,
      "Capabilities without console entry",
      ["user.read", "config.read", "user.role.manage"],
    );
    const narrowRole = await createRole(
      tenantId,
      `NARROW_MANAGER_${codeStamp}`,
      "Narrow manager",
      MANAGER_PERMISSIONS,
    );
    const unrelatedTenantRole = await createRole(
      tenantId,
      `UNRELATED_TENANT_${codeStamp}`,
      "Unrelated tenant scope",
    );

    manager = await createUser(tenantId, "manager", passwordHash);
    readOnly = await createUser(tenantId, "readonly", passwordHash);
    bareConsole = await createUser(tenantId, "bare-console", passwordHash);
    noConsole = await createUser(tenantId, "no-console", passwordHash);
    aggregateActor = await createUser(tenantId, "aggregate", passwordHash);
    target = await createUser(tenantId, "target", passwordHash);

    await createAssignment(manager.id, managerRole.id, { scopeType: "tenant" });
    await createAssignment(readOnly.id, readOnlyRole.id, {
      scopeType: "tenant",
    });
    await createAssignment(bareConsole.id, bareConsoleRole.id, {
      scopeType: "tenant",
    });
    await createAssignment(noConsole.id, noConsoleRole.id, {
      scopeType: "tenant",
    });
    await createAssignment(aggregateActor.id, narrowRole.id, {
      scopeType: "organization_unit",
      scopeOrganizationUnitId: organizationUnitId,
    });
    await createAssignment(aggregateActor.id, unrelatedTenantRole.id, {
      scopeType: "tenant",
    });
    targetBaseAssignmentId = await createAssignment(
      target.id,
      assignableRole.id,
      {
        scopeType: "customer",
        scopeCustomerId: customerId,
      },
    );

    managerToken = tokenFor(tenantId, manager);
    readOnlyToken = tokenFor(tenantId, readOnly);
    bareConsoleToken = tokenFor(tenantId, bareConsole);
    noConsoleToken = tokenFor(tenantId, noConsole);
    aggregateToken = tokenFor(tenantId, aggregateActor);

    // Independent tenant used for ownership/404 and projection-isolation probes.
    otherTenantId = await createTenant(OTHER_TENANT, "Tenant Phase 11F Other");
    otherOrganizationUnitId = await createOrganizationUnit(
      otherTenantId,
      "Other",
    );
    otherCustomerId = await createCustomer(otherTenantId, "OTHER");
    const otherManagerRole = await createRole(
      otherTenantId,
      `OTHER_MANAGER_${codeStamp}`,
      "Other ordinary manager",
      MANAGER_PERMISSIONS,
    );
    otherRole = await createRole(
      otherTenantId,
      `FOREIGN_ROLE_${codeStamp}`,
      "Foreign role",
      ["user.read"],
    );
    otherManager = await createUser(
      otherTenantId,
      "other-manager",
      passwordHash,
    );
    otherTarget = await createUser(otherTenantId, "other-target", passwordHash);
    await createAssignment(otherManager.id, otherManagerRole.id, {
      scopeType: "tenant",
    });
    otherAssignmentId = await createAssignment(otherTarget.id, otherRole.id, {
      scopeType: "organization_unit",
      scopeOrganizationUnitId: otherOrganizationUnitId,
    });
    otherManagerToken = tokenFor(otherTenantId, otherManager);

    // No bootstrap administrator exists in this tenant: the names and the
    // is_full_access marker are intentionally present without actual grants.
    namesTenantId = await createTenant(NAMES_TENANT, "Tenant Phase 11F Names");
    for (const [roleCode, isFullAccess] of [
      ["ADMIN", false],
      ["SUPERUSER", false],
      [`FULL_ACCESS_EMPTY_${codeStamp}`, true],
    ] as const) {
      const role = await createRole(
        namesTenantId,
        roleCode,
        `Authority probe ${roleCode}`,
        [],
        isFullAccess,
      );
      const user = await createUser(
        namesTenantId,
        `name-${roleCode.toLowerCase()}`,
        passwordHash,
      );
      const assignmentId = await createAssignment(user.id, role.id, {
        scopeType: "tenant",
      });
      nameOnlyActors.push({
        roleCode,
        user,
        token: tokenFor(namesTenantId, user),
      });
      expect(assignmentId).toMatch(/^[0-9a-f-]{36}$/);
    }

    // Dedicated guardrail tenant has exactly two active managers plus one
    // inactive and one deleted holder; no bootstrap/full-access survivor.
    guardTenantId = await createTenant(
      GUARD_TENANT,
      "Tenant Phase 11F Guardrails",
    );
    const guardRole = await createRole(
      guardTenantId,
      `GUARD_MANAGER_${codeStamp}`,
      "Guardrail manager",
      ["admin.console.read", "user.role.manage"],
    );
    guardA = await createUser(guardTenantId, "guard-a", passwordHash);
    guardB = await createUser(guardTenantId, "guard-b", passwordHash);
    guardInactive = await createUser(
      guardTenantId,
      "guard-inactive",
      passwordHash,
      {
        status: "inactive",
      },
    );
    guardDeleted = await createUser(
      guardTenantId,
      "guard-deleted",
      passwordHash,
      {
        deleted: true,
      },
    );
    guardAAssignmentId = await createAssignment(guardA.id, guardRole.id, {
      scopeType: "tenant",
    });
    guardBAssignmentId = await createAssignment(guardB.id, guardRole.id, {
      scopeType: "tenant",
    });
    guardInactiveAssignmentId = await createAssignment(
      guardInactive.id,
      guardRole.id,
      {
        scopeType: "tenant",
      },
    );
    guardDeletedAssignmentId = await createAssignment(
      guardDeleted.id,
      guardRole.id,
      {
        scopeType: "tenant",
      },
    );
    guardAToken = tokenFor(guardTenantId, guardA);
    guardBToken = tokenFor(guardTenantId, guardB);
  });

  afterAll(async () => {
    if (tenantId || otherTenantId || namesTenantId || guardTenantId) {
      await pool.query(`DELETE FROM tenants WHERE id = ANY($1::uuid[])`, [
        [tenantId, otherTenantId, namesTenantId, guardTenantId].filter(Boolean),
      ]);
    }
    await app.close();
    await pool.end();
  });

  describe("surface authentication and permission gates", () => {
    it("rejects unauthenticated requests to all four governed routes", async () => {
      const probes = [
        app.inject({ method: "GET", url: "/admin/users" }),
        app.inject({
          method: "GET",
          url: `/admin/roles/${assignableRole.code}/permissions`,
        }),
        app.inject({
          method: "POST",
          url: assignmentUrl(target.id),
          payload: tenantPayload(assignableRole.code),
        }),
        app.inject({
          method: "DELETE",
          url: removalUrl(target.id, targetBaseAssignmentId),
        }),
      ];
      const responses = await Promise.all(probes);
      expect(responses.map((response) => response.statusCode)).toEqual([
        401, 401, 401, 401,
      ]);
    });

    it("lets a read-only console actor read both details but never mutate", async () => {
      expect((await get("/admin/users", readOnlyToken)).statusCode).toBe(200);
      expect(
        (
          await get(
            `/admin/roles/${assignableRole.code}/permissions`,
            readOnlyToken,
          )
        ).statusCode,
      ).toBe(200);
      expect(
        (
          await post(
            assignmentUrl(target.id),
            readOnlyToken,
            tenantPayload(managerRole.code),
          )
        ).statusCode,
      ).toBe(403);
      expect(
        (
          await remove(
            removalUrl(target.id, targetBaseAssignmentId),
            readOnlyToken,
          )
        ).statusCode,
      ).toBe(403);
    });

    it("does not let admin.console.read alone reveal detailed data or mutate it", async () => {
      expect((await get("/admin/users", bareConsoleToken)).statusCode).toBe(
        403,
      );
      expect(
        (
          await get(
            `/admin/roles/${assignableRole.code}/permissions`,
            bareConsoleToken,
          )
        ).statusCode,
      ).toBe(403);
      expect(
        (
          await post(
            assignmentUrl(target.id),
            bareConsoleToken,
            tenantPayload(managerRole.code),
          )
        ).statusCode,
      ).toBe(403);
      expect(
        (
          await remove(
            removalUrl(target.id, targetBaseAssignmentId),
            bareConsoleToken,
          )
        ).statusCode,
      ).toBe(403);
    });

    it("denies every route without admin.console.read despite all area and mutation permissions", async () => {
      const responses = await Promise.all([
        get("/admin/users", noConsoleToken),
        get(`/admin/roles/${assignableRole.code}/permissions`, noConsoleToken),
        post(
          assignmentUrl(target.id),
          noConsoleToken,
          tenantPayload(managerRole.code),
        ),
        remove(removalUrl(target.id, targetBaseAssignmentId), noConsoleToken),
      ]);
      expect(responses.map((response) => response.statusCode)).toEqual([
        403, 403, 403, 403,
      ]);
    });

    it("never authorizes ADMIN, SUPERUSER, or is_full_access without actual grants", async () => {
      expect(nameOnlyActors.map((actor) => actor.roleCode)).toEqual([
        "ADMIN",
        "SUPERUSER",
        `FULL_ACCESS_EMPTY_${codeStamp}`,
      ]);
      for (const actor of nameOnlyActors) {
        const role = await pool.query(
          `SELECT is_full_access,
                  (SELECT COUNT(*)::int FROM role_permissions WHERE role_id = roles.id) AS grants
             FROM roles
            WHERE tenant_id = $1 AND code = $2`,
          [namesTenantId, actor.roleCode],
        );
        expect(role.rows[0].grants).toBe(0);
        if (actor.roleCode.startsWith("FULL_ACCESS_EMPTY_")) {
          expect(role.rows[0].is_full_access).toBe(true);
        }

        const responses = await Promise.all([
          get("/admin/users", actor.token),
          get(`/admin/roles/${actor.roleCode}/permissions`, actor.token),
          post(
            assignmentUrl(actor.user.id),
            actor.token,
            tenantPayload(actor.roleCode),
          ),
          remove(removalUrl(actor.user.id, randomUUID()), actor.token),
        ]);
        expect(
          responses.map((response) => response.statusCode),
          actor.roleCode,
        ).toEqual([403, 403, 403, 403]);
      }
    });

    it("reports mutation authority and its read prerequisites separately", async () => {
      const managerCapabilities = (await get("/admin/overview", managerToken)).json()
        .capabilities;
      expect(managerCapabilities).toMatchObject({
        readOnly: false,
        userRoleManage: true,
        userAccessRead: true,
        rolePermissionRead: true,
      });

      const noConsoleCapabilities = await get("/admin/overview", noConsoleToken);
      expect(noConsoleCapabilities.statusCode).toBe(403);
    });

    it("authorizes an arbitrarily named, non-full-access role by its exact grants", async () => {
      const role = await pool.query(
        `SELECT is_full_access,
                ARRAY(
                  SELECT p.code
                    FROM role_permissions rp
                    JOIN permissions p ON p.id = rp.permission_id
                   WHERE rp.role_id = roles.id
                   ORDER BY p.code
                ) AS permissions
           FROM roles
          WHERE id = $1`,
        [managerRole.id],
      );
      expect(role.rows[0].is_full_access).toBe(false);
      expect(role.rows[0].permissions).toEqual([...MANAGER_PERMISSIONS].sort());
      expect((await get("/admin/users", managerToken)).statusCode).toBe(200);
      expect(
        (
          await get(
            `/admin/roles/${assignableRole.code}/permissions`,
            managerToken,
          )
        ).statusCode,
      ).toBe(200);
    });

    it("rejects permission/scope aggregation across a narrow grant and unrelated tenant scope", async () => {
      const responses = await Promise.all([
        get("/admin/users", aggregateToken),
        get(`/admin/roles/${assignableRole.code}/permissions`, aggregateToken),
        post(
          assignmentUrl(target.id),
          aggregateToken,
          tenantPayload(managerRole.code),
        ),
        remove(removalUrl(target.id, targetBaseAssignmentId), aggregateToken),
      ]);
      expect(responses.map((response) => response.statusCode)).toEqual([
        403, 403, 403, 403,
      ]);
    });
  });

  describe("authorized projections and governed scope mutations", () => {
    it("projects only the tenant's safe user and role-permission detail shapes", async () => {
      const usersResponse = await get("/admin/users", managerToken);
      expect(usersResponse.statusCode).toBe(200);
      const users = usersResponse.json() as Array<Record<string, unknown>>;
      const projectedTarget = users.find((user) => user.id === target.id);
      expect(projectedTarget).toBeDefined();
      expect(Object.keys(projectedTarget!).sort()).toEqual(
        ["id", "fullName", "email", "status", "roleAssignments"].sort(),
      );
      expect(usersResponse.body).not.toMatch(
        /password|password_hash|passwordHash/i,
      );

      const assignments = projectedTarget!.roleAssignments as Array<
        Record<string, unknown>
      >;
      const base = assignments.find(
        (assignment) => assignment.id === targetBaseAssignmentId,
      );
      expect(base).toEqual({
        id: targetBaseAssignmentId,
        roleCode: assignableRole.code,
        roleName: assignableRole.name,
        scopeType: "customer",
        scopeOrganizationUnitId: null,
        scopeOrganizationUnitName: null,
        scopeCustomerId: customerId,
        scopeCustomerName: "P11F Customer PRIMARY",
      });

      const roleResponse = await get(
        `/admin/roles/${assignableRole.code}/permissions`,
        managerToken,
      );
      expect(roleResponse.statusCode).toBe(200);
      expect(roleResponse.json()).toEqual({
        roleCode: assignableRole.code,
        roleName: assignableRole.name,
        isFullAccess: false,
        permissions: [{ code: "user.read", description: expect.any(String) }],
      });
    });

    it("creates, lists, and deletes tenant, organization-unit, and customer scopes", async () => {
      const scopedTarget = await createUser(
        tenantId,
        "all-scopes",
        passwordHash,
      );
      const payloads = [
        tenantPayload(assignableRole.code),
        {
          roleCode: assignableRole.code,
          scopeType: "organization_unit" as const,
          scopeOrganizationUnitId: organizationUnitId,
        },
        {
          roleCode: assignableRole.code,
          scopeType: "customer" as const,
          scopeCustomerId: customerId,
        },
      ];

      const created: Array<Record<string, unknown>> = [];
      for (const payload of payloads) {
        const response = await post(
          assignmentUrl(scopedTarget.id),
          managerToken,
          payload,
        );
        expect(response.statusCode, JSON.stringify(payload)).toBe(201);
        created.push(response.json() as Record<string, unknown>);
      }

      expect(created).toEqual([
        {
          id: expect.any(String),
          roleCode: assignableRole.code,
          roleName: assignableRole.name,
          scopeType: "tenant",
          scopeOrganizationUnitId: null,
          scopeOrganizationUnitName: null,
          scopeCustomerId: null,
          scopeCustomerName: null,
        },
        {
          id: expect.any(String),
          roleCode: assignableRole.code,
          roleName: assignableRole.name,
          scopeType: "organization_unit",
          scopeOrganizationUnitId: organizationUnitId,
          scopeOrganizationUnitName: "P11F Organization Unit Primary",
          scopeCustomerId: null,
          scopeCustomerName: null,
        },
        {
          id: expect.any(String),
          roleCode: assignableRole.code,
          roleName: assignableRole.name,
          scopeType: "customer",
          scopeOrganizationUnitId: null,
          scopeOrganizationUnitName: null,
          scopeCustomerId: customerId,
          scopeCustomerName: "P11F Customer PRIMARY",
        },
      ]);

      const listed = (await get("/admin/users", managerToken)).json() as Array<{
        id: string;
        roleAssignments: Array<Record<string, unknown>>;
      }>;
      const projected = listed.find((user) => user.id === scopedTarget.id);
      expect(projected?.roleAssignments).toEqual(
        expect.arrayContaining(created),
      );

      for (const assignment of created) {
        const response = await remove(
          removalUrl(scopedTarget.id, assignment.id as string),
          managerToken,
        );
        expect(response.statusCode).toBe(204);
        expect(response.body).toBe("");
      }
      const remaining = await pool.query(
        `SELECT COUNT(*)::int AS count FROM user_role_assignments WHERE user_id = $1`,
        [scopedTarget.id],
      );
      expect(remaining.rows[0].count).toBe(0);
    });

    it("keeps two-tenant user and role projections isolated", async () => {
      const mine = (await get("/admin/users", managerToken)).json() as Array<{
        id: string;
      }>;
      const theirs = (
        await get("/admin/users", otherManagerToken)
      ).json() as Array<{ id: string }>;
      expect(mine.map((user) => user.id)).toContain(target.id);
      expect(mine.map((user) => user.id)).not.toContain(otherTarget.id);
      expect(theirs.map((user) => user.id)).toContain(otherTarget.id);
      expect(theirs.map((user) => user.id)).not.toContain(target.id);

      expect(
        (await get(`/admin/roles/${otherRole.code}/permissions`, managerToken))
          .statusCode,
      ).toBe(404);
      expect(
        (
          await get(
            `/admin/roles/${otherRole.code}/permissions`,
            otherManagerToken,
          )
        ).statusCode,
      ).toBe(200);
    });
  });

  describe("validation, ownership, binding, and duplicate safety", () => {
    it("rejects every non-canonical scope shape with 400", async () => {
      const invalidPayloads: InjectPayload[] = [
        {
          roleCode: assignableRole.code,
          scopeType: "tenant",
          scopeOrganizationUnitId: organizationUnitId,
        },
        { roleCode: assignableRole.code, scopeType: "organization_unit" },
        {
          roleCode: assignableRole.code,
          scopeType: "organization_unit",
          scopeOrganizationUnitId: organizationUnitId,
          scopeCustomerId: customerId,
        },
        { roleCode: assignableRole.code, scopeType: "customer" },
        {
          roleCode: assignableRole.code,
          scopeType: "customer",
          scopeCustomerId: customerId,
          scopeOrganizationUnitId: organizationUnitId,
        },
        { roleCode: assignableRole.code, scopeType: "project" },
        {
          roleCode: assignableRole.code,
          scopeType: "tenant",
          unexpected: true,
        },
        {
          roleCode: assignableRole.code,
          scopeType: "organization_unit",
          scopeOrganizationUnitId: "not-a-uuid",
        },
        {},
      ];

      for (const payload of invalidPayloads) {
        const response = await post(
          assignmentUrl(target.id),
          managerToken,
          payload,
        );
        expect(response.statusCode, JSON.stringify(payload)).toBe(400);
      }
    });

    it("returns 404 for foreign users, roles, organization units, customers, and assignments", async () => {
      expect(
        (
          await post(
            assignmentUrl(otherTarget.id),
            managerToken,
            tenantPayload(assignableRole.code),
          )
        ).statusCode,
      ).toBe(404);
      expect(
        (
          await post(
            assignmentUrl(target.id),
            managerToken,
            tenantPayload(otherRole.code),
          )
        ).statusCode,
      ).toBe(404);
      expect(
        (
          await post(assignmentUrl(target.id), managerToken, {
            roleCode: assignableRole.code,
            scopeType: "organization_unit",
            scopeOrganizationUnitId: otherOrganizationUnitId,
          })
        ).statusCode,
      ).toBe(404);
      expect(
        (
          await post(assignmentUrl(target.id), managerToken, {
            roleCode: assignableRole.code,
            scopeType: "customer",
            scopeCustomerId: otherCustomerId,
          })
        ).statusCode,
      ).toBe(404);
      expect(
        (await remove(removalUrl(target.id, otherAssignmentId), managerToken))
          .statusCode,
      ).toBe(404);
      expect(
        (
          await remove(
            removalUrl(otherTarget.id, targetBaseAssignmentId),
            managerToken,
          )
        ).statusCode,
      ).toBe(404);
    });

    it("binds deletion to the exact userId and assignmentId pair", async () => {
      const firstUser = await createUser(
        tenantId,
        "binding-first",
        passwordHash,
      );
      const secondUser = await createUser(
        tenantId,
        "binding-second",
        passwordHash,
      );
      const firstAssignment = await createAssignment(
        firstUser.id,
        assignableRole.id,
        {
          scopeType: "tenant",
        },
      );
      const secondAssignment = await createAssignment(
        secondUser.id,
        assignableRole.id,
        {
          scopeType: "tenant",
        },
      );

      const mismatched = await remove(
        removalUrl(secondUser.id, firstAssignment),
        managerToken,
      );
      expect(mismatched.statusCode).toBe(404);
      const stillPresent = await pool.query(
        `SELECT id, user_id FROM user_role_assignments WHERE id = ANY($1::uuid[]) ORDER BY id`,
        [[firstAssignment, secondAssignment]],
      );
      expect(stillPresent.rows).toHaveLength(2);

      expect(
        (await remove(removalUrl(firstUser.id, firstAssignment), managerToken))
          .statusCode,
      ).toBe(204);
      expect(
        (
          await remove(
            removalUrl(secondUser.id, secondAssignment),
            managerToken,
          )
        ).statusCode,
      ).toBe(204);
    });

    it("returns 409 for a sequential exact duplicate", async () => {
      const duplicateTarget = await createUser(
        tenantId,
        "duplicate-sequential",
        passwordHash,
      );
      const payload = tenantPayload(assignableRole.code);
      const first = await post(
        assignmentUrl(duplicateTarget.id),
        managerToken,
        payload,
      );
      const second = await post(
        assignmentUrl(duplicateTarget.id),
        managerToken,
        payload,
      );
      expect(first.statusCode).toBe(201);
      expect(second.statusCode).toBe(409);

      const rows = await pool.query(
        `SELECT id FROM user_role_assignments
          WHERE user_id = $1 AND role_id = $2 AND scope_type = 'tenant'`,
        [duplicateTarget.id, assignableRole.id],
      );
      expect(rows.rows).toHaveLength(1);
      expect(
        (
          await remove(
            removalUrl(duplicateTarget.id, rows.rows[0].id),
            managerToken,
          )
        ).statusCode,
      ).toBe(204);
    });

    it("serializes a concurrent exact duplicate to exactly one 201 and one 409", async () => {
      const duplicateTarget = await createUser(
        tenantId,
        "duplicate-concurrent",
        passwordHash,
      );
      const payload = {
        roleCode: assignableRole.code,
        scopeType: "customer" as const,
        scopeCustomerId: customerId,
      };
      const responses = await Promise.all([
        post(assignmentUrl(duplicateTarget.id), managerToken, payload),
        post(assignmentUrl(duplicateTarget.id), managerToken, payload),
      ]);
      expect(responses.map((response) => response.statusCode).sort()).toEqual([
        201, 409,
      ]);

      const rows = await pool.query(
        `SELECT id FROM user_role_assignments
          WHERE user_id = $1
            AND role_id = $2
            AND scope_type = 'customer'
            AND scope_customer_id = $3`,
        [duplicateTarget.id, assignableRole.id, customerId],
      );
      expect(rows.rows).toHaveLength(1);
      expect(
        (
          await remove(
            removalUrl(duplicateTarget.id, rows.rows[0].id),
            managerToken,
          )
        ).statusCode,
      ).toBe(204);
    });
  });

  describe("manager survival safeguards", () => {
    it("denies self-removal even with a backup, excludes inactive/deleted holders, and cannot concurrently remove both active managers", async () => {
      // Self-protection is independent of the last-manager rule: A cannot
      // remove A even while B is a valid active survivor.
      const selfRemoval = await remove(
        removalUrl(guardA.id, guardAAssignmentId),
        guardAToken,
      );
      expect(selfRemoval.statusCode).toBe(409);
      expect(selfRemoval.json().error).toMatch(
        /own tenant manager assignment/i,
      );

      // Both actors authenticate while both grants exist. The tenant lock and
      // in-transaction authority recheck permit one removal only; the loser no
      // longer has authority. A final active manager can therefore never be
      // removed by this race.
      const concurrent = await Promise.all([
        remove(removalUrl(guardB.id, guardBAssignmentId), guardAToken),
        remove(removalUrl(guardA.id, guardAAssignmentId), guardBToken),
      ]);
      expect(concurrent.map((response) => response.statusCode).sort()).toEqual([
        204, 403,
      ]);

      const assignments = await pool.query(
        `SELECT ura.id, u.id AS user_id, u.status, u.deleted_at
           FROM user_role_assignments ura
           JOIN users u ON u.id = ura.user_id
          WHERE ura.id = ANY($1::uuid[])
          ORDER BY ura.id`,
        [
          [
            guardAAssignmentId,
            guardBAssignmentId,
            guardInactiveAssignmentId,
            guardDeletedAssignmentId,
          ],
        ],
      );
      const activeSurvivors = assignments.rows.filter(
        (row) => row.status === "active" && row.deleted_at === null,
      );
      expect(activeSurvivors).toHaveLength(1);
      expect(assignments.rows.map((row) => row.id)).toEqual(
        expect.arrayContaining([
          guardInactiveAssignmentId,
          guardDeletedAssignmentId,
        ]),
      );

      const survivor = activeSurvivors[0];
      const survivorToken =
        survivor.user_id === guardA.id ? guardAToken : guardBToken;
      const finalRemoval = await remove(
        removalUrl(survivor.user_id, survivor.id),
        survivorToken,
      );
      expect(finalRemoval.statusCode).toBe(409);
      const finalStillPresent = await pool.query(
        `SELECT 1 FROM user_role_assignments WHERE id = $1`,
        [survivor.id],
      );
      expect(finalStillPresent.rows).toHaveLength(1);
    });
  });

  describe("audit atomicity and bounded surface invariants", () => {
    it("writes exactly one allowlisted success audit event for create and delete", async () => {
      const auditedTarget = await createUser(
        tenantId,
        "audited-success",
        passwordHash,
      );
      const createResponse = await post(
        assignmentUrl(auditedTarget.id),
        managerToken,
        tenantPayload(assignableRole.code),
      );
      expect(createResponse.statusCode).toBe(201);
      const assignmentId = createResponse.json().id as string;

      const assignedAudit = await pool.query(
        `SELECT actor_user_id, entity_type, entity_id, metadata
           FROM audit_log
          WHERE tenant_id = $1
            AND action = 'user.role_assigned'
            AND entity_id = $2`,
        [tenantId, auditedTarget.id],
      );
      expect(assignedAudit.rows).toHaveLength(1);
      expect(assignedAudit.rows[0]).toMatchObject({
        actor_user_id: manager.id,
        entity_type: "user",
        entity_id: auditedTarget.id,
      });
      expect(assignedAudit.rows[0].metadata).toEqual({
        targetUserId: auditedTarget.id,
        roleCode: assignableRole.code,
        scopeType: "tenant",
        scopeOrganizationUnitId: null,
        scopeCustomerId: null,
      });
      expect(Object.keys(assignedAudit.rows[0].metadata).sort()).toEqual(
        [
          "targetUserId",
          "roleCode",
          "scopeType",
          "scopeOrganizationUnitId",
          "scopeCustomerId",
        ].sort(),
      );

      const deleteResponse = await remove(
        removalUrl(auditedTarget.id, assignmentId),
        managerToken,
      );
      expect(deleteResponse.statusCode).toBe(204);
      const removedAudit = await pool.query(
        `SELECT actor_user_id, entity_type, entity_id, metadata
           FROM audit_log
          WHERE tenant_id = $1
            AND action = 'user.role_removed'
            AND entity_id = $2`,
        [tenantId, auditedTarget.id],
      );
      expect(removedAudit.rows).toHaveLength(1);
      expect(removedAudit.rows[0]).toEqual({
        actor_user_id: manager.id,
        entity_type: "user",
        entity_id: auditedTarget.id,
        metadata: assignedAudit.rows[0].metadata,
      });
    });

    it("does not record an additional success event for a failed mutation", async () => {
      const failedTarget = await createUser(
        tenantId,
        "audited-failure",
        passwordHash,
      );
      const payload = tenantPayload(assignableRole.code);
      const first = await post(
        assignmentUrl(failedTarget.id),
        managerToken,
        payload,
      );
      expect(first.statusCode).toBe(201);
      const duplicate = await post(
        assignmentUrl(failedTarget.id),
        managerToken,
        payload,
      );
      expect(duplicate.statusCode).toBe(409);

      const audit = await pool.query(
        `SELECT id FROM audit_log
          WHERE tenant_id = $1
            AND action = 'user.role_assigned'
            AND entity_id = $2`,
        [tenantId, failedTarget.id],
      );
      expect(audit.rows).toHaveLength(1);
      expect(
        (
          await remove(
            removalUrl(failedTarget.id, first.json().id),
            managerToken,
          )
        ).statusCode,
      ).toBe(204);
    });

    it("rolls back the assignment when its namespaced audit insert is forced to fail", async () => {
      const rollbackTarget = await createUser(
        tenantId,
        "audit-rollback",
        passwordHash,
      );
      const sentinelRole = await createRole(
        tenantId,
        `AUDIT_FAIL_SENTINEL_${codeStamp}`,
        "Audit failure sentinel",
      );
      const identifier = `p11f_${randomUUID().replaceAll("-", "").slice(0, 20)}`;
      const functionName = `${identifier}_fn`;
      const triggerName = `${identifier}_trg`;

      await pool.query(`
        CREATE FUNCTION ${functionName}() RETURNS trigger
        LANGUAGE plpgsql
        AS $$
        BEGIN
          IF NEW.tenant_id = '${tenantId}'::uuid
             AND NEW.action = 'user.role_assigned'
             AND NEW.metadata->>'roleCode' = '${sentinelRole.code}' THEN
            RAISE EXCEPTION 'Phase 11F namespaced forced audit failure';
          END IF;
          RETURN NEW;
        END;
        $$;
        CREATE TRIGGER ${triggerName}
        BEFORE INSERT ON audit_log
        FOR EACH ROW EXECUTE FUNCTION ${functionName}();
      `);

      let response: LightMyRequestResponse | undefined;
      try {
        response = await post(
          assignmentUrl(rollbackTarget.id),
          managerToken,
          tenantPayload(sentinelRole.code),
        );
      } finally {
        await pool.query(`DROP TRIGGER IF EXISTS ${triggerName} ON audit_log`);
        await pool.query(`DROP FUNCTION IF EXISTS ${functionName}()`);
      }

      expect(response!.statusCode).toBe(500);
      const assignment = await pool.query(
        `SELECT 1
           FROM user_role_assignments
          WHERE user_id = $1 AND role_id = $2`,
        [rollbackTarget.id, sentinelRole.id],
      );
      expect(assignment.rows).toHaveLength(0);
      const audit = await pool.query(
        `SELECT 1
           FROM audit_log
          WHERE tenant_id = $1
            AND action = 'user.role_assigned'
            AND entity_id = $2
            AND metadata->>'roleCode' = $3`,
        [tenantId, rollbackTarget.id, sentinelRole.code],
      );
      expect(audit.rows).toHaveLength(0);
    });

    it("keeps the assignment when its namespaced removal audit insert is forced to fail", async () => {
      const rollbackTarget = await createUser(
        tenantId,
        "removal-audit-rollback",
        passwordHash,
      );
      const sentinelRole = await createRole(
        tenantId,
        `REMOVE_AUDIT_FAIL_SENTINEL_${codeStamp}`,
        "Removal audit failure sentinel",
      );
      const assignmentId = await createAssignment(
        rollbackTarget.id,
        sentinelRole.id,
        { scopeType: "tenant" },
      );
      const identifier = `p11f_${randomUUID().replaceAll("-", "").slice(0, 20)}`;
      const functionName = `${identifier}_fn`;
      const triggerName = `${identifier}_trg`;

      await pool.query(`
        CREATE FUNCTION ${functionName}() RETURNS trigger
        LANGUAGE plpgsql
        AS $$
        BEGIN
          IF NEW.tenant_id = '${tenantId}'::uuid
             AND NEW.action = 'user.role_removed'
             AND NEW.metadata->>'roleCode' = '${sentinelRole.code}' THEN
            RAISE EXCEPTION 'Phase 11F namespaced forced removal audit failure';
          END IF;
          RETURN NEW;
        END;
        $$;
        CREATE TRIGGER ${triggerName}
        BEFORE INSERT ON audit_log
        FOR EACH ROW EXECUTE FUNCTION ${functionName}();
      `);

      let response: LightMyRequestResponse | undefined;
      try {
        response = await remove(
          removalUrl(rollbackTarget.id, assignmentId),
          managerToken,
        );
      } finally {
        await pool.query(`DROP TRIGGER IF EXISTS ${triggerName} ON audit_log`);
        await pool.query(`DROP FUNCTION IF EXISTS ${functionName}()`);
      }

      expect(response!.statusCode).toBe(500);
      const assignment = await pool.query(
        `SELECT id, user_id, role_id
           FROM user_role_assignments
          WHERE id = $1
            AND user_id = $2
            AND role_id = $3`,
        [assignmentId, rollbackTarget.id, sentinelRole.id],
      );
      expect(assignment.rows).toHaveLength(1);
      const audit = await pool.query(
        `SELECT 1
           FROM audit_log
          WHERE tenant_id = $1
            AND action = 'user.role_removed'
            AND entity_id = $2
            AND metadata->>'roleCode' = $3`,
        [tenantId, rollbackTarget.id, sentinelRole.code],
      );
      expect(audit.rows).toHaveLength(0);
    });

    it("never changes role definitions or role_permissions while governing assignments", async () => {
      const invariantTarget = await createUser(
        tenantId,
        "role-invariants",
        passwordHash,
      );
      const snapshot = async () => {
        const roles = await pool.query(
          `SELECT id, code, name, is_full_access, created_at, updated_at
             FROM roles
            WHERE tenant_id = $1
            ORDER BY id`,
          [tenantId],
        );
        const rolePermissions = await pool.query(
          `SELECT rp.role_id, rp.permission_id
             FROM role_permissions rp
             JOIN roles r ON r.id = rp.role_id
            WHERE r.tenant_id = $1
            ORDER BY rp.role_id, rp.permission_id`,
          [tenantId],
        );
        return { roles: roles.rows, rolePermissions: rolePermissions.rows };
      };

      const before = await snapshot();
      const created = await post(
        assignmentUrl(invariantTarget.id),
        managerToken,
        tenantPayload(assignableRole.code),
      );
      expect(created.statusCode).toBe(201);
      expect(
        (
          await remove(
            removalUrl(invariantTarget.id, created.json().id),
            managerToken,
          )
        ).statusCode,
      ).toBe(204);
      expect(await snapshot()).toEqual(before);
    });

    it("exposes no bulk role-permission matrix route", async () => {
      for (const url of [
        "/admin/role-permissions",
        "/admin/roles/permissions",
        "/admin/permission-matrix",
      ]) {
        const response = await get(url, managerToken);
        expect(response.statusCode, url).toBe(404);
      }
    });
  });
});
