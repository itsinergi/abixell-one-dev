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
const rbacRepository = new PgRbacRepository(pool);

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
     VALUES ($1, $2, $3, 'Internal Site')
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

function tokenFor(tenantId: string, user: UserFixture): Promise<string> {
  // Epic 1 (§4.1 F): a bearer token must name a session, so fixtures create
  // one the way the login endpoint does instead of signing a bare payload.
  return sessionTokenFor({ userId: user.id, tenantId });
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

// Epic 4 Wave 3 — removal became revocation: POST with a mandatory reason,
// row retained for history. The helper name keeps the old verb so the guard
// semantics of each call site stay obvious.
async function remove(
  url: string,
  token: string,
): Promise<LightMyRequestResponse> {
  return app.inject({
    method: "POST",
    url: `${url}/revoke`,
    headers: authHeader(token),
    payload: { reason: "integration test revoke" },
  });
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

function projectedAssignment(
  response: LightMyRequestResponse,
  userId: string,
  assignmentId: string,
): Record<string, unknown> | undefined {
  const users = response.json() as Array<{
    id: string;
    roleAssignments: Array<Record<string, unknown>>;
  }>;
  return users
    .find((user) => user.id === userId)
    ?.roleAssignments.find((assignment) => assignment.id === assignmentId);
}

/** Epic 4 Wave 3 — the six lifecycle fields every assignment projection now
 * carries, inert on any grant that was never revoked. */
function lifecycleFields(
  assignmentState: string,
  assignedBy: string | null,
): Record<string, unknown> {
  return {
    assignmentState,
    assignedAt: expect.any(String),
    assignedBy,
    revokedAt: null,
    revokedBy: null,
    revokeReason: null,
  };
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

    await activateAllModules(primary.id);
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

    managerToken = await tokenFor(tenantId, manager);
    readOnlyToken = await tokenFor(tenantId, readOnly);
    bareConsoleToken = await tokenFor(tenantId, bareConsole);
    noConsoleToken = await tokenFor(tenantId, noConsole);
    aggregateToken = await tokenFor(tenantId, aggregateActor);

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
    otherManagerToken = await tokenFor(otherTenantId, otherManager);

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
        token: await tokenFor(namesTenantId, user),
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
    guardAToken = await tokenFor(guardTenantId, guardA);
    guardBToken = await tokenFor(guardTenantId, guardB);
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
          method: "POST",
          url: `${removalUrl(target.id, targetBaseAssignmentId)}/revoke`,
          payload: { reason: "unauthenticated probe" },
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
      // Epic 4 Wave 2 (§4.4 D) rewired these four to the SAME visibility +
      // delegation policy as the Wave 2 surface, so a narrow actor is refused
      // by TARGET rather than by gate. The assertion still pins exactly what it
      // always pinned — that `user.read`/`user.role.manage` from the
      // Organization-Unit-scoped `narrowRole` cannot be aggregated with the
      // zero-permission tenant-wide `unrelatedTenantRole` into tenant-wide
      // authority:
      //
      //   GET /admin/users                 200 — the actor holds `user.read`,
      //                                    but the payload carries only Users
      //                                    inside their own OU subtree, which
      //                                    excludes `target` (customer-scope
      //                                    assignment only).
      //   GET .../permissions              403 — `config.read` is still demanded
      //                                    tenant-scoped, and it lives on no
      //                                    tenant-scoped assignment here.
      //   POST / DELETE                    404 — both are governed by
      //                                    `user.role.manage`, whose
      //                                    Organization-Unit visibility cannot
      //                                    reach a User with no live OU-scoped
      //                                    assignment. Out of visibility is
      //                                    deliberately indistinguishable from
      //                                    missing (§4.4 risk row 1).
      expect(responses.map((response) => response.statusCode)).toEqual([
        200, 403, 404, 404,
      ]);

      const listed = (await get("/admin/users", aggregateToken)).json() as Array<
        Record<string, unknown>
      >;
      expect(listed.map((user) => user.id)).not.toContain(target.id);
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
        roleState: "available",
        roleCode: assignableRole.code,
        roleName: assignableRole.name,
        scopeType: "customer",
        scopeState: "available",
        scopeOrganizationUnitId: null,
        scopeOrganizationUnitName: null,
        scopeCustomerId: customerId,
        scopeCustomerName: "P11F Customer PRIMARY",
        scopeLegalEntityId: null,
        scopeLegalEntityName: null,
        ...lifecycleFields("active", null),
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

    it("mixes internal scopes freely but never customer with internal, in either direction", async () => {
      const scopedTarget = await createUser(
        tenantId,
        "all-scopes",
        passwordHash,
      );
      const internalPayloads = [
        tenantPayload(assignableRole.code),
        {
          roleCode: assignableRole.code,
          scopeType: "organization_unit" as const,
          scopeOrganizationUnitId: organizationUnitId,
        },
      ];

      const created: Array<Record<string, unknown>> = [];
      for (const payload of internalPayloads) {
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
          roleState: "available",
          roleCode: assignableRole.code,
          roleName: assignableRole.name,
          scopeType: "tenant",
          scopeState: "available",
          scopeOrganizationUnitId: null,
          scopeOrganizationUnitName: null,
          scopeCustomerId: null,
          scopeCustomerName: null,
          scopeLegalEntityId: null,
          scopeLegalEntityName: null,
          ...lifecycleFields("active", manager.id),
        },
        {
          id: expect.any(String),
          roleState: "available",
          roleCode: assignableRole.code,
          roleName: assignableRole.name,
          scopeType: "organization_unit",
          scopeState: "available",
          scopeOrganizationUnitId: organizationUnitId,
          scopeOrganizationUnitName: "P11F Organization Unit Primary",
          scopeCustomerId: null,
          scopeCustomerName: null,
          scopeLegalEntityId: null,
          scopeLegalEntityName: null,
          ...lifecycleFields("active", manager.id),
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

      // §4.4 decision 6 — customer scope on a user holding a live internal
      // grant is refused 409, not 201, and writes nothing.
      const customerWhileInternal = await post(
        assignmentUrl(scopedTarget.id),
        managerToken,
        {
          roleCode: assignableRole.code,
          scopeType: "customer",
          scopeCustomerId: customerId,
        },
      );
      expect(customerWhileInternal.statusCode).toBe(409);
      expect(customerWhileInternal.json().error).toBe(
        "A User may not hold customer-scope and internal assignments at the same time",
      );
      const customerRowsWhileInternal = await pool.query(
        `SELECT id FROM user_role_assignments
          WHERE user_id = $1 AND scope_type = 'customer'`,
        [scopedTarget.id],
      );
      expect(customerRowsWhileInternal.rows).toHaveLength(0);

      // A revoked internal grant blocks nothing: soft revocation is exactly
      // what makes the exclusivity rule live-row based.
      for (const assignment of created) {
        const response = await remove(
          removalUrl(scopedTarget.id, assignment.id as string),
          managerToken,
        );
        expect(response.statusCode).toBe(204);
        expect(response.body).toBe("");
      }

      const customer = await post(assignmentUrl(scopedTarget.id), managerToken, {
        roleCode: assignableRole.code,
        scopeType: "customer",
        scopeCustomerId: customerId,
      });
      expect(customer.statusCode).toBe(201);
      const customerAssignmentId = customer.json().id as string;
      expect(customer.json()).toMatchObject({
        scopeCustomerId: customerId,
        scopeCustomerName: "P11F Customer PRIMARY",
      });

      // The mirrored direction: internal scope on a customer-scoped user.
      for (const payload of internalPayloads) {
        const response = await post(
          assignmentUrl(scopedTarget.id),
          managerToken,
          payload,
        );
        expect(response.statusCode, JSON.stringify(payload)).toBe(409);
        expect(response.json().error).toBe(
          "A User may not hold customer-scope and internal assignments at the same time",
        );
      }
      const internalRowsWhileCustomer = await pool.query(
        `SELECT id FROM user_role_assignments
          WHERE user_id = $1
            AND scope_type <> 'customer'
            AND revoked_at IS NULL`,
        [scopedTarget.id],
      );
      expect(internalRowsWhileCustomer.rows).toHaveLength(0);

      // And back again: revoke the customer grant, internal is allowed.
      expect(
        (
          await remove(
            removalUrl(scopedTarget.id, customerAssignmentId),
            managerToken,
          )
        ).statusCode,
      ).toBe(204);
      const internalAgain = await post(
        assignmentUrl(scopedTarget.id),
        managerToken,
        tenantPayload(assignableRole.code),
      );
      expect(internalAgain.statusCode).toBe(201);

      expect(
        (
          await remove(
            removalUrl(scopedTarget.id, internalAgain.json().id as string),
            managerToken,
          )
        ).statusCode,
      ).toBe(204);

      // Wave 3 — revocation retains every row as history; none grants access.
      // Three internal grants plus one customer grant, all revoked.
      const remaining = await pool.query(
        `SELECT revoked_at, revoked_by, revoke_reason
           FROM user_role_assignments
          WHERE user_id = $1
          ORDER BY revoked_at`,
        [scopedTarget.id],
      );
      expect(remaining.rows).toHaveLength(4);
      for (const row of remaining.rows) {
        expect(row.revoked_at).toBeInstanceOf(Date);
        expect(row.revoked_by).toBe(manager.id);
        expect(row.revoke_reason).toBe("integration test revoke");
      }
    });

    it("enforces the customer-scope Service Operation ceiling and its feature-flag override", async () => {
      // The manager's own Role does not carry customer.read, so its delegation
      // set cannot authorize a Role that does — a ceiling probe through that
      // actor would die on delegation first and assert the wrong message. A
      // dedicated assigner holds exactly the customer-portal shape.
      const ceilingAssignerRole = await createRole(
        tenantId,
        `CEILING_MANAGER_${codeStamp}`,
        "Ceiling assigner",
        [
          "admin.console.read",
          "user.role.manage",
          "user.read",
          "customer.read",
          "service_operations.read",
          "service_operations.optimization.read",
          "service_operations.optimization.apply",
        ],
      );
      const ceilingAssigner = await createUser(
        tenantId,
        "ceiling-manager",
        passwordHash,
      );
      await createAssignment(ceilingAssigner.id, ceilingAssignerRole.id, {
        scopeType: "tenant",
      });
      const ceilingToken = await tokenFor(tenantId, ceilingAssigner);

      const ceilingTarget = await createUser(
        tenantId,
        "ceiling-target",
        passwordHash,
      );
      const allowed = await post(assignmentUrl(ceilingTarget.id), ceilingToken, {
        roleCode: assignableRole.code,
        scopeType: "customer",
        scopeCustomerId: customerId,
      });
      expect(allowed.statusCode).toBe(201);

      // Roles carrying Service Operation codes, built directly (fixture
      // convention): one inside the allowlist, one beyond it.
      const ceilingRole = await createRole(
        tenantId,
        `CEILING_${codeStamp}`,
        "Ceiling probe role",
        ["customer.read", "service_operations.read"],
      );
      const fullSetRole = await createRole(
        tenantId,
        `FULL_SET_${codeStamp}`,
        "Full set probe role",
        ["customer.read", "service_operations.optimization.apply"],
      );
      // The in-allowlist Role proves the boundary is the code set, not
      // "customer scope + any Service Operation grant".
      const insideTarget = await createUser(
        tenantId,
        "ceiling-inside",
        passwordHash,
      );
      const inside = await post(assignmentUrl(insideTarget.id), ceilingToken, {
        roleCode: ceilingRole.code,
        scopeType: "customer",
        scopeCustomerId: customerId,
      });
      expect(inside.statusCode).toBe(201);

      const secondTarget = await createUser(
        tenantId,
        "ceiling-second",
        passwordHash,
      );
      const refused = await post(assignmentUrl(secondTarget.id), ceilingToken, {
        roleCode: fullSetRole.code,
        scopeType: "customer",
        scopeCustomerId: customerId,
      });
      expect(refused.statusCode).toBe(400);
      expect(refused.json().error).toContain(
        "customer scope is limited to service_operations.read and service_operations.optimization.read",
      );

      // Open the ceiling for this tenant and the same pair lands.
      await pool.query(
        `INSERT INTO tenant_feature_flags (tenant_id, feature_flag_id, is_enabled, scope_type)
         SELECT $1, ff.id, true, 'tenant'
           FROM feature_flags ff
          WHERE ff.code = 'customer_scope_full_permission_set'`,
        [tenantId],
      );
      const opened = await post(assignmentUrl(secondTarget.id), ceilingToken, {
        roleCode: fullSetRole.code,
        scopeType: "customer",
        scopeCustomerId: customerId,
      });
      expect(opened.statusCode).toBe(201);

      // Leaving the flag on would change every later tenant-grant test; the
      // fixture restores the settled default.
      await pool.query(
        `DELETE FROM tenant_feature_flags WHERE tenant_id = $1`,
        [tenantId],
      );
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

  describe("unavailable scope lifecycle and authorization reconciliation", () => {
    it("keeps an Organization Unit assignment visible but permanently inert through delete and restore", async () => {
      const scopedTarget = await createUser(
        tenantId,
        "ou-lifecycle",
        passwordHash,
      );
      const lifecycleOrganizationUnitId = await createOrganizationUnit(
        tenantId,
        "Lifecycle",
      );
      const created = await post(
        assignmentUrl(scopedTarget.id),
        managerToken,
        {
          roleCode: assignableRole.code,
          scopeType: "organization_unit",
          scopeOrganizationUnitId: lifecycleOrganizationUnitId,
        },
      );
      expect(created.statusCode).toBe(201);
      const assignmentId = created.json().id as string;
      expect(created.json()).toMatchObject({
        id: assignmentId,
        scopeState: "available",
        scopeOrganizationUnitId: lifecycleOrganizationUnitId,
        scopeOrganizationUnitName: "P11F Organization Unit Lifecycle",
      });
      expect(
        (
          await rbacRepository.getEffectivePermissionCodes(scopedTarget.id)
        ).has("user.read"),
      ).toBe(true);
      expect(
        (await rbacRepository.getAssignments(scopedTarget.id)).map(
          (assignment) => assignment.id,
        ),
      ).toContain(assignmentId);
      expect(
        await rbacRepository.listUserIdsWithPermissionInTenant(
          tenantId,
          "user.read",
        ),
      ).toContain(scopedTarget.id);
      expect(
        await rbacRepository.listUserIdsWithRoleInScope(
          tenantId,
          assignableRole.code,
          lifecycleOrganizationUnitId,
        ),
      ).toContain(scopedTarget.id);

      await pool.query(
        `UPDATE organization_units SET deleted_at = now() WHERE id = $1`,
        [lifecycleOrganizationUnitId],
      );
      const invalidated = await pool.query(
        `SELECT scope_invalidated_at
           FROM user_role_assignments
          WHERE id = $1`,
        [assignmentId],
      );
      expect(invalidated.rows[0].scope_invalidated_at).toBeInstanceOf(Date);
      const invalidatedAt = invalidated.rows[0].scope_invalidated_at as Date;

      const deletedProjectionResponse = await get("/admin/users", managerToken);
      expect(deletedProjectionResponse.statusCode).toBe(200);
      expect(
        projectedAssignment(
          deletedProjectionResponse,
          scopedTarget.id,
          assignmentId,
        ),
      ).toEqual({
        id: assignmentId,
        roleState: "available",
        roleCode: assignableRole.code,
        roleName: assignableRole.name,
        scopeType: "organization_unit",
        scopeState: "unavailable",
        scopeOrganizationUnitId: lifecycleOrganizationUnitId,
        scopeOrganizationUnitName: null,
        scopeCustomerId: null,
        scopeCustomerName: null,
        scopeLegalEntityId: null,
        scopeLegalEntityName: null,
        ...lifecycleFields("invalidated", manager.id),
      });
      expect(deletedProjectionResponse.body).not.toContain(
        "P11F Organization Unit Lifecycle",
      );
      expect(
        (
          await rbacRepository.getEffectivePermissionCodes(scopedTarget.id)
        ).has("user.read"),
      ).toBe(false);
      expect(await rbacRepository.getAssignments(scopedTarget.id)).toEqual([]);
      expect(
        await rbacRepository.listUserIdsWithPermissionInTenant(
          tenantId,
          "user.read",
        ),
      ).not.toContain(scopedTarget.id);
      expect(
        await rbacRepository.listUserIdsWithRoleInScope(
          tenantId,
          assignableRole.code,
          lifecycleOrganizationUnitId,
        ),
      ).not.toContain(scopedTarget.id);

      await pool.query(
        `UPDATE organization_units SET deleted_at = NULL WHERE id = $1`,
        [lifecycleOrganizationUnitId],
      );
      await pool.query(
        `UPDATE user_role_assignments
            SET scope_invalidated_at = NULL
          WHERE id = $1`,
        [assignmentId],
      );
      const restored = await pool.query(
        `SELECT scope_invalidated_at
           FROM user_role_assignments
          WHERE id = $1`,
        [assignmentId],
      );
      expect(
        (restored.rows[0].scope_invalidated_at as Date).getTime(),
      ).toBe(invalidatedAt.getTime());
      const restoredProjectionResponse = await get("/admin/users", managerToken);
      expect(
        projectedAssignment(
          restoredProjectionResponse,
          scopedTarget.id,
          assignmentId,
        ),
      ).toMatchObject({
        id: assignmentId,
        scopeState: "unavailable",
        scopeOrganizationUnitId: lifecycleOrganizationUnitId,
        scopeOrganizationUnitName: null,
      });
      expect(
        (
          await rbacRepository.getEffectivePermissionCodes(scopedTarget.id)
        ).has("user.read"),
      ).toBe(false);

      expect(
        (
          await remove(
            removalUrl(scopedTarget.id, assignmentId),
            managerToken,
          )
        ).statusCode,
      ).toBe(204);
      const reassigned = await post(
        assignmentUrl(scopedTarget.id),
        managerToken,
        {
          roleCode: assignableRole.code,
          scopeType: "organization_unit",
          scopeOrganizationUnitId: lifecycleOrganizationUnitId,
        },
      );
      expect(reassigned.statusCode).toBe(201);
      expect(reassigned.json()).toMatchObject({
        scopeState: "available",
        scopeOrganizationUnitName: "P11F Organization Unit Lifecycle",
      });
      expect(reassigned.json().id).not.toBe(assignmentId);
      expect(
        (
          await rbacRepository.getEffectivePermissionCodes(scopedTarget.id)
        ).has("user.read"),
      ).toBe(true);
      expect(
        (
          await remove(
            removalUrl(scopedTarget.id, reassigned.json().id),
            managerToken,
          )
        ).statusCode,
      ).toBe(204);
    });

    it("removes an unavailable Customer assignment before restore without reviving it", async () => {
      const scopedTarget = await createUser(
        tenantId,
        "customer-lifecycle",
        passwordHash,
      );
      const lifecycleCustomerId = await createCustomer(
        tenantId,
        "LIFECYCLE",
      );
      const created = await post(
        assignmentUrl(scopedTarget.id),
        managerToken,
        {
          roleCode: assignableRole.code,
          scopeType: "customer",
          scopeCustomerId: lifecycleCustomerId,
        },
      );
      expect(created.statusCode).toBe(201);
      const assignmentId = created.json().id as string;
      expect(created.json()).toMatchObject({
        scopeState: "available",
        scopeCustomerId: lifecycleCustomerId,
        scopeCustomerName: "P11F Customer LIFECYCLE",
      });
      expect(
        (
          await rbacRepository.getEffectivePermissionCodes(scopedTarget.id)
        ).has("user.read"),
      ).toBe(true);

      await pool.query(
        `UPDATE customers SET deleted_at = now() WHERE id = $1`,
        [lifecycleCustomerId],
      );
      const invalidated = await pool.query(
        `SELECT scope_invalidated_at
           FROM user_role_assignments
          WHERE id = $1`,
        [assignmentId],
      );
      expect(invalidated.rows[0].scope_invalidated_at).toBeInstanceOf(Date);
      const projectionResponse = await get("/admin/users", managerToken);
      expect(
        projectedAssignment(projectionResponse, scopedTarget.id, assignmentId),
      ).toEqual({
        id: assignmentId,
        roleState: "available",
        roleCode: assignableRole.code,
        roleName: assignableRole.name,
        scopeType: "customer",
        scopeState: "unavailable",
        scopeOrganizationUnitId: null,
        scopeOrganizationUnitName: null,
        scopeCustomerId: lifecycleCustomerId,
        scopeCustomerName: null,
        scopeLegalEntityId: null,
        scopeLegalEntityName: null,
        ...lifecycleFields("invalidated", manager.id),
      });
      expect(projectionResponse.body).not.toContain(
        "P11F Customer LIFECYCLE",
      );
      expect(
        (
          await rbacRepository.getEffectivePermissionCodes(scopedTarget.id)
        ).has("user.read"),
      ).toBe(false);
      expect(await rbacRepository.getAssignments(scopedTarget.id)).toEqual([]);

      expect(
        (
          await remove(
            removalUrl(scopedTarget.id, assignmentId),
            managerToken,
          )
        ).statusCode,
      ).toBe(204);
      await pool.query(`UPDATE customers SET deleted_at = NULL WHERE id = $1`, [
        lifecycleCustomerId,
      ]);
      // Wave 3 — revoke then restore must not revive the grant: the row is
      // retained and stays revoked, not deleted.
      expect(
        (
          await pool.query(
            `SELECT revoked_at FROM user_role_assignments WHERE id = $1`,
            [assignmentId],
          )
        ).rows[0].revoked_at,
      ).toBeInstanceOf(Date);
      expect(
        (
          await rbacRepository.getEffectivePermissionCodes(scopedTarget.id)
        ).has("user.read"),
      ).toBe(false);

      const reassigned = await post(
        assignmentUrl(scopedTarget.id),
        managerToken,
        {
          roleCode: assignableRole.code,
          scopeType: "customer",
          scopeCustomerId: lifecycleCustomerId,
        },
      );
      expect(reassigned.statusCode).toBe(201);
      expect(reassigned.json()).toMatchObject({
        scopeState: "available",
        scopeCustomerId: lifecycleCustomerId,
        scopeCustomerName: "P11F Customer LIFECYCLE",
      });
      expect(reassigned.json().id).not.toBe(assignmentId);
      expect(
        (
          await rbacRepository.getEffectivePermissionCodes(scopedTarget.id)
        ).has("user.read"),
      ).toBe(true);
      expect(
        (
          await remove(
            removalUrl(scopedTarget.id, reassigned.json().id),
            managerToken,
          )
        ).statusCode,
      ).toBe(204);
    });

    it("does not let a stale assignment grant beside or after a parallel valid assignment", async () => {
      const scopedTarget = await createUser(
        tenantId,
        "parallel-valid-stale",
        passwordHash,
      );
      const staleOrganizationUnitId = await createOrganizationUnit(
        tenantId,
        "Parallel stale",
      );
      const validOrganizationUnitId = await createOrganizationUnit(
        tenantId,
        "Parallel valid",
      );
      const staleAssignmentId = await createAssignment(
        scopedTarget.id,
        assignableRole.id,
        {
          scopeType: "organization_unit",
          scopeOrganizationUnitId: staleOrganizationUnitId,
        },
      );
      const validAssignmentId = await createAssignment(
        scopedTarget.id,
        assignableRole.id,
        {
          scopeType: "organization_unit",
          scopeOrganizationUnitId: validOrganizationUnitId,
        },
      );

      await pool.query(
        `UPDATE organization_units SET deleted_at = now() WHERE id = $1`,
        [staleOrganizationUnitId],
      );
      expect(
        (
          await rbacRepository.getEffectivePermissionCodes(scopedTarget.id)
        ).has("user.read"),
      ).toBe(true);
      expect(
        (await rbacRepository.getAssignments(scopedTarget.id)).map(
          (assignment) => assignment.id,
        ),
      ).toEqual([validAssignmentId]);
      expect(
        await rbacRepository.listUserIdsWithPermissionInTenant(
          tenantId,
          "user.read",
        ),
      ).toContain(scopedTarget.id);

      expect(
        (
          await remove(
            removalUrl(scopedTarget.id, validAssignmentId),
            managerToken,
          )
        ).statusCode,
      ).toBe(204);
      expect(
        (
          await rbacRepository.getEffectivePermissionCodes(scopedTarget.id)
        ).has("user.read"),
      ).toBe(false);
      expect(await rbacRepository.getAssignments(scopedTarget.id)).toEqual([]);
      expect(
        await rbacRepository.listUserIdsWithPermissionInTenant(
          tenantId,
          "user.read",
        ),
      ).not.toContain(scopedTarget.id);
      expect(
        (
          await remove(
            removalUrl(scopedTarget.id, staleAssignmentId),
            managerToken,
          )
        ).statusCode,
      ).toBe(204);
    });

    it("redacts and locally removes poisoned foreign OU and Customer references", async () => {
      for (const poisoned of [
        {
          suffix: "poisoned-ou",
          scope: {
            scopeType: "organization_unit" as const,
            scopeOrganizationUnitId: otherOrganizationUnitId,
          },
          storedKey: "scopeOrganizationUnitId",
          storedId: otherOrganizationUnitId,
          foreignName: "P11F Organization Unit Other",
        },
        {
          suffix: "poisoned-customer",
          scope: {
            scopeType: "customer" as const,
            scopeCustomerId: otherCustomerId,
          },
          storedKey: "scopeCustomerId",
          storedId: otherCustomerId,
          foreignName: "P11F Customer OTHER",
        },
      ]) {
        const poisonedTarget = await createUser(
          tenantId,
          poisoned.suffix,
          passwordHash,
        );
        const assignmentId = await createAssignment(
          poisonedTarget.id,
          assignableRole.id,
          poisoned.scope,
        );
        const persisted = await pool.query(
          `SELECT scope_invalidated_at
             FROM user_role_assignments
            WHERE id = $1`,
          [assignmentId],
        );
        expect(persisted.rows[0].scope_invalidated_at).toBeInstanceOf(Date);

        const localProjection = await get("/admin/users", managerToken);
        const assignment = projectedAssignment(
          localProjection,
          poisonedTarget.id,
          assignmentId,
        );
        expect(assignment).toMatchObject({
          id: assignmentId,
          scopeType: poisoned.scope.scopeType,
          scopeState: "unavailable",
          scopeOrganizationUnitName: null,
          scopeCustomerName: null,
          [poisoned.storedKey]: poisoned.storedId,
        });
        expect(localProjection.body).not.toContain(poisoned.foreignName);
        expect(
          (
            await rbacRepository.getEffectivePermissionCodes(poisonedTarget.id)
          ).has("user.read"),
        ).toBe(false);
        expect(await rbacRepository.getAssignments(poisonedTarget.id)).toEqual(
          [],
        );
        expect(
          await rbacRepository.listUserIdsWithPermissionInTenant(
            tenantId,
            "user.read",
          ),
        ).not.toContain(poisonedTarget.id);
        expect(
          await rbacRepository.listUserIdsWithRoleInScope(
            tenantId,
            assignableRole.code,
            otherOrganizationUnitId,
          ),
        ).not.toContain(poisonedTarget.id);

        const foreignProjection = await get(
          "/admin/users",
          otherManagerToken,
        );
        expect(foreignProjection.body).not.toContain(poisonedTarget.id);
        expect(foreignProjection.body).not.toContain(assignmentId);
        expect(
          (
            await remove(
              removalUrl(poisonedTarget.id, assignmentId),
              otherManagerToken,
            )
          ).statusCode,
        ).toBe(404);
        expect(
          (
            await remove(
              removalUrl(poisonedTarget.id, assignmentId),
              managerToken,
            )
          ).statusCode,
        ).toBe(204);
      }
    });

    it("permanently revokes assignments when their User moves between tenants", async () => {
      const movedTarget = await createUser(
        tenantId,
        "user-tenant-move",
        passwordHash,
      );
      const assignmentId = await createAssignment(
        movedTarget.id,
        assignableRole.id,
        { scopeType: "tenant" },
      );
      expect(
        (
          await rbacRepository.getEffectivePermissionCodes(movedTarget.id)
        ).has("user.read"),
      ).toBe(true);

      await pool.query(`UPDATE users SET tenant_id = $1 WHERE id = $2`, [
        otherTenantId,
        movedTarget.id,
      ]);
      const movedAwayProjection = await get("/admin/users", otherManagerToken);
      expect(
        projectedAssignment(
          movedAwayProjection,
          movedTarget.id,
          assignmentId,
        ),
      ).toEqual({
        id: assignmentId,
        roleState: "unavailable",
        roleCode: null,
        roleName: null,
        scopeType: "tenant",
        scopeState: "unavailable",
        scopeOrganizationUnitId: null,
        scopeOrganizationUnitName: null,
        scopeCustomerId: null,
        scopeCustomerName: null,
        scopeLegalEntityId: null,
        scopeLegalEntityName: null,
        ...lifecycleFields("invalidated", null),
      });
      expect(movedAwayProjection.body).not.toContain(assignableRole.code);
      expect(movedAwayProjection.body).not.toContain(assignableRole.name);
      expect((await get("/admin/users", managerToken)).body).not.toContain(
        assignmentId,
      );

      await pool.query(`UPDATE users SET tenant_id = $1 WHERE id = $2`, [
        tenantId,
        movedTarget.id,
      ]);
      const invalidated = await pool.query(
        `SELECT scope_invalidated_at
           FROM user_role_assignments
          WHERE id = $1`,
        [assignmentId],
      );
      expect(invalidated.rows[0].scope_invalidated_at).toBeInstanceOf(Date);
      const invalidatedAt = invalidated.rows[0].scope_invalidated_at as Date;
      await pool.query(
        `UPDATE user_role_assignments
            SET scope_invalidated_at = NULL
          WHERE id = $1`,
        [assignmentId],
      );
      const retained = await pool.query(
        `SELECT scope_invalidated_at
           FROM user_role_assignments
          WHERE id = $1`,
        [assignmentId],
      );
      expect(
        (retained.rows[0].scope_invalidated_at as Date).getTime(),
      ).toBe(invalidatedAt.getTime());
      expect(
        projectedAssignment(
          await get("/admin/users", managerToken),
          movedTarget.id,
          assignmentId,
        ),
      ).toMatchObject({
        id: assignmentId,
        roleState: "available",
        roleCode: assignableRole.code,
        roleName: assignableRole.name,
        scopeState: "unavailable",
      });
      expect(
        (
          await rbacRepository.getEffectivePermissionCodes(movedTarget.id)
        ).has("user.read"),
      ).toBe(false);
      expect(await rbacRepository.getAssignments(movedTarget.id)).toEqual([]);
      expect(
        await rbacRepository.listUserIdsWithPermissionInTenant(
          tenantId,
          "user.read",
        ),
      ).not.toContain(movedTarget.id);

      expect(
        (
          await remove(
            removalUrl(movedTarget.id, assignmentId),
            managerToken,
          )
        ).statusCode,
      ).toBe(204);
      const reassigned = await post(
        assignmentUrl(movedTarget.id),
        managerToken,
        tenantPayload(assignableRole.code),
      );
      expect(reassigned.statusCode).toBe(201);
      expect(reassigned.json()).toMatchObject({
        roleState: "available",
        roleCode: assignableRole.code,
        scopeState: "available",
      });
      expect(reassigned.json().id).not.toBe(assignmentId);
      expect(
        (
          await rbacRepository.getEffectivePermissionCodes(movedTarget.id)
        ).has("user.read"),
      ).toBe(true);
      expect(
        (
          await remove(
            removalUrl(movedTarget.id, reassigned.json().id),
            managerToken,
          )
        ).statusCode,
      ).toBe(204);
    });

    it("permanently revokes assignments when their Role moves between tenants", async () => {
      const movedTarget = await createUser(
        tenantId,
        "role-tenant-move",
        passwordHash,
      );
      const movedRole = await createRole(
        tenantId,
        `MOVED_ROLE_${codeStamp}`,
        "Role tenant move sentinel",
        ["user.read"],
      );
      const assignmentId = await createAssignment(movedTarget.id, movedRole.id, {
        scopeType: "organization_unit",
        scopeOrganizationUnitId: organizationUnitId,
      });
      expect(
        await rbacRepository.listUserIdsWithRoleInScope(
          tenantId,
          movedRole.code,
          organizationUnitId,
        ),
      ).toContain(movedTarget.id);

      await pool.query(`UPDATE roles SET tenant_id = $1 WHERE id = $2`, [
        otherTenantId,
        movedRole.id,
      ]);
      const movedAwayProjection = await get("/admin/users", managerToken);
      expect(
        projectedAssignment(
          movedAwayProjection,
          movedTarget.id,
          assignmentId,
        ),
      ).toEqual({
        id: assignmentId,
        roleState: "unavailable",
        roleCode: null,
        roleName: null,
        scopeType: "organization_unit",
        scopeState: "unavailable",
        scopeOrganizationUnitId: organizationUnitId,
        scopeOrganizationUnitName: null,
        scopeCustomerId: null,
        scopeCustomerName: null,
        scopeLegalEntityId: null,
        scopeLegalEntityName: null,
        ...lifecycleFields("invalidated", null),
      });
      expect(movedAwayProjection.body).not.toContain(movedRole.code);
      expect(movedAwayProjection.body).not.toContain(movedRole.name);
      expect((await get("/admin/users", otherManagerToken)).body).not.toContain(
        assignmentId,
      );
      expect(
        (
          await rbacRepository.getEffectivePermissionCodes(movedTarget.id)
        ).has("user.read"),
      ).toBe(false);
      expect(await rbacRepository.getAssignments(movedTarget.id)).toEqual([]);
      expect(
        await rbacRepository.listUserIdsWithRoleInScope(
          tenantId,
          movedRole.code,
          organizationUnitId,
        ),
      ).not.toContain(movedTarget.id);
      expect(
        await rbacRepository.listUserIdsWithPermissionInTenant(
          tenantId,
          "user.read",
        ),
      ).not.toContain(movedTarget.id);

      await pool.query(`UPDATE roles SET tenant_id = $1 WHERE id = $2`, [
        tenantId,
        movedRole.id,
      ]);
      const invalidated = await pool.query(
        `SELECT scope_invalidated_at
           FROM user_role_assignments
          WHERE id = $1`,
        [assignmentId],
      );
      expect(invalidated.rows[0].scope_invalidated_at).toBeInstanceOf(Date);
      const invalidatedAt = invalidated.rows[0].scope_invalidated_at as Date;
      await pool.query(
        `UPDATE user_role_assignments
            SET scope_invalidated_at = NULL
          WHERE id = $1`,
        [assignmentId],
      );
      const retained = await pool.query(
        `SELECT scope_invalidated_at
           FROM user_role_assignments
          WHERE id = $1`,
        [assignmentId],
      );
      expect(
        (retained.rows[0].scope_invalidated_at as Date).getTime(),
      ).toBe(invalidatedAt.getTime());
      expect(
        projectedAssignment(
          await get("/admin/users", managerToken),
          movedTarget.id,
          assignmentId,
        ),
      ).toMatchObject({
        id: assignmentId,
        roleState: "available",
        roleCode: movedRole.code,
        roleName: movedRole.name,
        scopeState: "unavailable",
        scopeOrganizationUnitId: organizationUnitId,
        scopeOrganizationUnitName: null,
      });
      expect(
        (
          await rbacRepository.getEffectivePermissionCodes(movedTarget.id)
        ).has("user.read"),
      ).toBe(false);

      expect(
        (
          await remove(
            removalUrl(movedTarget.id, assignmentId),
            managerToken,
          )
        ).statusCode,
      ).toBe(204);
      const reassigned = await post(
        assignmentUrl(movedTarget.id),
        managerToken,
        {
          roleCode: movedRole.code,
          scopeType: "organization_unit",
          scopeOrganizationUnitId: organizationUnitId,
        },
      );
      expect(reassigned.statusCode).toBe(201);
      expect(reassigned.json()).toMatchObject({
        roleState: "available",
        roleCode: movedRole.code,
        scopeState: "available",
        scopeOrganizationUnitId: organizationUnitId,
      });
      expect(reassigned.json().id).not.toBe(assignmentId);
      expect(
        (
          await rbacRepository.getEffectivePermissionCodes(movedTarget.id)
        ).has("user.read"),
      ).toBe(true);
      expect(
        (
          await remove(
            removalUrl(movedTarget.id, reassigned.json().id),
            managerToken,
          )
        ).statusCode,
      ).toBe(204);
    });

    it("redacts and locally removes a poisoned foreign Role assignment", async () => {
      const poisonedTarget = await createUser(
        tenantId,
        "poisoned-role",
        passwordHash,
      );
      const foreignRole = await createRole(
        otherTenantId,
        `POISONED_FOREIGN_ROLE_${codeStamp}`,
        "Foreign Role Identity Must Stay Hidden",
        ["user.read"],
      );
      const rolePermissionsBefore = await pool.query(
        `SELECT permission_id
           FROM role_permissions
          WHERE role_id = $1
          ORDER BY permission_id`,
        [foreignRole.id],
      );
      const assignmentId = await createAssignment(
        poisonedTarget.id,
        foreignRole.id,
        {
          scopeType: "organization_unit",
          scopeOrganizationUnitId: organizationUnitId,
        },
      );
      const persisted = await pool.query(
        `SELECT scope_invalidated_at
           FROM user_role_assignments
          WHERE id = $1`,
        [assignmentId],
      );
      expect(persisted.rows[0].scope_invalidated_at).toBeInstanceOf(Date);

      const localProjection = await get("/admin/users", managerToken);
      expect(
        projectedAssignment(
          localProjection,
          poisonedTarget.id,
          assignmentId,
        ),
      ).toEqual({
        id: assignmentId,
        roleState: "unavailable",
        roleCode: null,
        roleName: null,
        scopeType: "organization_unit",
        scopeState: "unavailable",
        scopeOrganizationUnitId: organizationUnitId,
        scopeOrganizationUnitName: null,
        scopeCustomerId: null,
        scopeCustomerName: null,
        scopeLegalEntityId: null,
        scopeLegalEntityName: null,
        ...lifecycleFields("invalidated", null),
      });
      expect(localProjection.body).not.toContain(foreignRole.code);
      expect(localProjection.body).not.toContain(foreignRole.name);
      expect((await get("/admin/users", otherManagerToken)).body).not.toContain(
        poisonedTarget.id,
      );
      expect((await get("/admin/users", otherManagerToken)).body).not.toContain(
        assignmentId,
      );
      expect(
        (
          await rbacRepository.getEffectivePermissionCodes(poisonedTarget.id)
        ).has("user.read"),
      ).toBe(false);
      expect(await rbacRepository.getAssignments(poisonedTarget.id)).toEqual([]);
      expect(
        await rbacRepository.listUserIdsWithPermissionInTenant(
          tenantId,
          "user.read",
        ),
      ).not.toContain(poisonedTarget.id);
      expect(
        await rbacRepository.listUserIdsWithRoleInScope(
          tenantId,
          foreignRole.code,
          organizationUnitId,
        ),
      ).not.toContain(poisonedTarget.id);
      expect(
        (
          await remove(
            removalUrl(poisonedTarget.id, assignmentId),
            otherManagerToken,
          )
        ).statusCode,
      ).toBe(404);
      expect(
        (
          await remove(
            removalUrl(poisonedTarget.id, assignmentId),
            managerToken,
          )
        ).statusCode,
      ).toBe(204);

      const removedAudit = await pool.query(
        `SELECT metadata
           FROM audit_log
          WHERE tenant_id = $1
            AND action = 'user.role_revoked'
            AND entity_id = $2`,
        [tenantId, poisonedTarget.id],
      );
      expect(removedAudit.rows).toHaveLength(1);
      expect(removedAudit.rows[0].metadata).toEqual({
        targetUserId: poisonedTarget.id,
        roleCode: null,
        scopeType: "organization_unit",
        scopeOrganizationUnitId: organizationUnitId,
        scopeCustomerId: null,
        before: {
          status: "invalidated",
          revokedAt: null,
          revokedBy: null,
          revokeReason: null,
        },
        after: {
          status: "revoked",
          revokedAt: expect.any(String),
          revokedBy: manager.id,
          revokeReason: "integration test revoke",
        },
        reason: "integration test revoke",
        assignmentId,
      });
      expect(JSON.stringify(removedAudit.rows[0].metadata)).not.toContain(
        foreignRole.code,
      );
      expect(JSON.stringify(removedAudit.rows[0].metadata)).not.toContain(
        foreignRole.name,
      );
      const rolePermissionsAfter = await pool.query(
        `SELECT permission_id
           FROM role_permissions
          WHERE role_id = $1
          ORDER BY permission_id`,
        [foreignRole.id],
      );
      expect(rolePermissionsAfter.rows).toEqual(rolePermissionsBefore.rows);
    });

    it("never synthesizes permissions from is_full_access after an actual grant is removed", async () => {
      const scopedTarget = await createUser(
        tenantId,
        "actual-grants-only",
        passwordHash,
      );
      const fullAccessRole = await createRole(
        tenantId,
        `FULL_ACCESS_WITH_GRANT_${codeStamp}`,
        "Full access marker with one actual grant",
        ["user.read"],
        true,
      );
      const assignmentId = await createAssignment(
        scopedTarget.id,
        fullAccessRole.id,
        { scopeType: "tenant" },
      );
      expect(
        (
          await rbacRepository.getEffectivePermissionCodes(scopedTarget.id)
        ).has("user.read"),
      ).toBe(true);

      await pool.query(
        `DELETE FROM role_permissions rp
          USING permissions p
          WHERE rp.permission_id = p.id
            AND rp.role_id = $1
            AND p.code = 'user.read'`,
        [fullAccessRole.id],
      );
      expect(
        (
          await rbacRepository.getEffectivePermissionCodes(scopedTarget.id)
        ).has("user.read"),
      ).toBe(false);
      expect(
        await rbacRepository.hasTenantScopedPermission(
          tenantId,
          scopedTarget.id,
          "user.read",
        ),
      ).toBe(false);
      expect(
        await rbacRepository.listUserIdsWithPermissionInTenant(
          tenantId,
          "user.read",
        ),
      ).not.toContain(scopedTarget.id);
      expect(
        (
          await remove(
            removalUrl(scopedTarget.id, assignmentId),
            managerToken,
          )
        ).statusCode,
      ).toBe(204);
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
        `SELECT ura.id, u.id AS user_id, u.status, u.deleted_at, ura.revoked_at
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
      // Wave 3 — the loser's row is retained but revoked, so "still live" now
      // means "not revoked" on top of the user-state conditions.
      const activeSurvivors = assignments.rows.filter(
        (row) =>
          row.status === "active" &&
          row.deleted_at === null &&
          row.revoked_at === null,
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
    it("writes exactly one allowlisted success audit event for create and revoke", async () => {
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
            AND action = 'user.role_revoked'
            AND entity_id = $2`,
        [tenantId, auditedTarget.id],
      );
      expect(removedAudit.rows).toHaveLength(1);
      // §4.4 step 21 — the revoke event carries the same legacy identity keys
      // plus the before/after lifecycle snapshots and the operator's reason.
      expect(removedAudit.rows[0]).toEqual({
        actor_user_id: manager.id,
        entity_type: "user",
        entity_id: auditedTarget.id,
        metadata: {
          ...(assignedAudit.rows[0].metadata as Record<string, unknown>),
          before: {
            status: "active",
            revokedAt: null,
            revokedBy: null,
            revokeReason: null,
          },
          after: {
            status: "revoked",
            revokedAt: expect.any(String),
            revokedBy: manager.id,
            revokeReason: "integration test revoke",
          },
          reason: "integration test revoke",
          assignmentId,
        },
      });
      expect(Object.keys(removedAudit.rows[0].metadata).sort()).toEqual(
        [
          "targetUserId",
          "roleCode",
          "scopeType",
          "scopeOrganizationUnitId",
          "scopeCustomerId",
          "before",
          "after",
          "reason",
          "assignmentId",
        ].sort(),
      );
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

    it("keeps the grant live when its namespaced revoke audit insert is forced to fail", async () => {
      const rollbackTarget = await createUser(
        tenantId,
        "removal-audit-rollback",
        passwordHash,
      );
      const sentinelRole = await createRole(
        tenantId,
        `REMOVE_AUDIT_FAIL_SENTINEL_${codeStamp}`,
        "Revoke audit failure sentinel",
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
             AND NEW.action = 'user.role_revoked'
             AND NEW.metadata->>'roleCode' = '${sentinelRole.code}' THEN
            RAISE EXCEPTION 'Phase 11F namespaced forced revoke audit failure';
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
      // The audit row and the revoke share one transaction: a failed audit
      // rolls the UPDATE back, so the grant must still be live and unmarked.
      const assignment = await pool.query(
        `SELECT id, user_id, role_id, revoked_at, revoked_by, revoke_reason
           FROM user_role_assignments
          WHERE id = $1
            AND user_id = $2
            AND role_id = $3`,
        [assignmentId, rollbackTarget.id, sentinelRole.id],
      );
      expect(assignment.rows).toHaveLength(1);
      expect(assignment.rows[0].revoked_at).toBeNull();
      expect(assignment.rows[0].revoked_by).toBeNull();
      expect(assignment.rows[0].revoke_reason).toBeNull();
      const audit = await pool.query(
        `SELECT 1
           FROM audit_log
          WHERE tenant_id = $1
            AND action = 'user.role_revoked'
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
