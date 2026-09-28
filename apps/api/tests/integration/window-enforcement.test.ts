/**
 * Epic 4 Wave 1 — Window read-only enforcement end-to-end (CORE-ROADMAP.md
 * §4.4 step 11b).
 *
 * Reaches the gate the way an attacker would — direct URL, ordinary actor, no
 * menu involved (§4.3 safe order item 8, inherited) — and against a database
 * separate from `abixell_one_dev` (§4.3 release gate, same pattern as
 * role-definition.test.ts).
 *
 * What §4.4 step 11b promises, asserted against the real app:
 *
 *   read   → always allowed on a read-only Window ("tetap dapat membuka")
 *   write  → 403 "Peran Anda hanya berhak membaca pada halaman ini."
 *   module gate order → an inactive module reports ITS reason, not the Window's
 *   enforcementStatus → read from the served-route census, never a literal
 *
 * Every module is activated first, so a 403 below can only come from the
 * Window gate — the module-activity gate would otherwise answer for it and the
 * test would prove nothing about 11b. The one test that NEEDS the module gate
 * turns `hse` off explicitly.
 *
 * Positive controls close the loop: the same write with a writable row must
 * succeed. Without them a gate that rejected everything would pass. The
 * pre-Epic1 "union allow" case — one writable Role among several held by the
 * user — no longer opens the write: since Epic 1 (§4.1 C) the lock is judged
 * on the ACTIVE assignment only, so a read-only active Role is refused and a
 * switch to the writable Role is what reopens the Window.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../../src/app.js";
import { pool } from "../../src/infrastructure/persistence/db.js";
import { activateAllModules, authHeader, bootstrapTenant, sessionTokenFor } from "./helpers.js";

const REQUIRED_DATABASE = "abixell_one_epic3_wave4";
const stamp = `${Date.now().toString(36)}${randomUUID().replaceAll("-", "").slice(0, 6)}`;
const TENANT = `we-${stamp}`;
const WINDOW_READ_ONLY_REASON = "Peran Anda hanya berhak membaca pada halaman ini.";
const MODULE_INACTIVE_REASON = "Modul ini tidak aktif untuk tenant Anda.";

/** `POST /customers` writes through this Window; `customer.manage` is the
 * permission its handler checks, so a 403 here is the Window gate's alone. */
const CUSTOMER_WINDOW = "route:/customer-commercial";
/** `POST /hse/records` is the report form, a Window of its own. */
const HSE_REPORT_WINDOW = "route:/hse/report";

const app = buildApp();

interface UserFixture {
  id: string;
}

function assertIsolatedDatabase() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error(`DATABASE_URL must target ${REQUIRED_DATABASE}`);
  }
  const databaseName = new URL(databaseUrl).pathname.replace(/^\//, "");
  if (databaseName !== REQUIRED_DATABASE) {
    throw new Error(
      `Window-enforcement integration tests require ${REQUIRED_DATABASE}, got ${databaseName}`,
    );
  }
}

async function createRole(
  tenantId: string,
  code: string,
  permissionCodes: string[],
): Promise<string> {
  const role = await pool.query(
    `INSERT INTO roles (tenant_id, code, name) VALUES ($1, $2, $2) RETURNING id`,
    [tenantId, code],
  );
  const roleId = role.rows[0].id as string;
  const rows = (
    await pool.query(`SELECT id FROM permissions WHERE code = ANY($1)`, [permissionCodes])
  ).rows;
  for (const permission of rows) {
    await pool.query(`INSERT INTO role_permissions (role_id, permission_id) VALUES ($1, $2)`, [
      roleId,
      permission.id,
    ]);
  }
  return roleId;
}

/** One `role_window_access` row — the 11a configuration the 11b gate reads. */
async function setWindowAccess(
  tenantId: string,
  roleId: string,
  windowCode: string,
  isReadWrite: boolean,
) {
  await pool.query(
    `INSERT INTO role_window_access (tenant_id, role_id, window_code, is_read_write, is_active)
     VALUES ($1, $2, $3, $4, true)
     ON CONFLICT (role_id, window_code)
     DO UPDATE SET is_read_write = EXCLUDED.is_read_write, is_active = true`,
    [tenantId, roleId, windowCode, isReadWrite],
  );
}

async function createUser(tenantId: string, name: string): Promise<UserFixture> {
  const user = await pool.query(
    `INSERT INTO users (tenant_id, email, password_hash, full_name)
     VALUES ($1, $2, 'fixture-password-hash', $3)
     RETURNING id`,
    [tenantId, `${name}.${stamp}@window.test`, `Window Enforcement ${name}`],
  );
  return user.rows[0] as UserFixture;
}

async function assignTenantRole(userId: string, roleId: string): Promise<string> {
  const result = await pool.query(
    `INSERT INTO user_role_assignments (user_id, role_id, scope_type)
     VALUES ($1, $2, 'tenant') RETURNING id`,
    [userId, roleId],
  );
  return result.rows[0].id as string;
}

function tokenFor(tenantId: string, user: UserFixture): Promise<string> {
  // Epic 1 (�4.1 F): a bearer token must name a session, so fixtures create
  // one the way the login endpoint does instead of signing a bare payload.
  return sessionTokenFor({ userId: user.id, tenantId });
}

describe("Epic 4 Wave 1 — Window read-only enforcement", () => {
  let tenantId: string;
  let readOnlyToken: string;
  let writerToken: string;
  let unionReadOnlyToken: string;
  let unionWriterToken: string;
  let readOnlyRoleId: string;
  let writerRoleId: string;
  let writerRoleCode: string;

  beforeAll(async () => {
    assertIsolatedDatabase();

    const tenant = await bootstrapTenant(app, TENANT, "Window enforcement test tenant");
    tenantId = tenant.id;

    // Every module active: the module-activity gate must not be the reason a
    // request is refused anywhere except in the one test that wants it.
    await activateAllModules(tenantId);
    await pool.query(
      `UPDATE tenant_module_activations tma
          SET is_active = false
         FROM modules m
        WHERE tma.tenant_id = $1
          AND tma.module_id = m.id
          AND m.code = 'hse'`,
      [tenantId],
    );

    // `customer.manage` gates POST /customers, `customer.read` gates
    // GET /customers (customer.service.ts:61 and :106) — the read probe needs
    // its own permission or it would 403 for a reason unrelated to the Window
    // lock and prove nothing. The two console permissions are for reading a
    // Role definition back in the status assertion.
    const consolePermissions = [
      "customer.manage",
      "customer.read",
      "admin.console.read",
      "config.read",
    ];
    readOnlyRoleId = await createRole(tenantId, `WE_RO_${stamp}`, consolePermissions);
    writerRoleCode = `WE_RW_${stamp}`;
    writerRoleId = await createRole(tenantId, writerRoleCode, consolePermissions);

    const readOnly = await createUser(tenantId, "read-only");
    await assignTenantRole(readOnly.id, readOnlyRoleId);
    readOnlyToken = await tokenFor(tenantId, readOnly);

    const writer = await createUser(tenantId, "writer");
    await assignTenantRole(writer.id, writerRoleId);
    writerToken = await tokenFor(tenantId, writer);

    const union = await createUser(tenantId, "union");
    const unionReadOnlyAssignmentId = await assignTenantRole(union.id, readOnlyRoleId);
    const unionWriterAssignmentId = await assignTenantRole(union.id, writerRoleId);
    // Epic 1 (§4.1 B): two sessions for the two-role user, each pinned to
    // one assignment — the same choice the role picker offers after login.
    unionReadOnlyToken = await sessionTokenFor({
      userId: union.id,
      tenantId,
      activeAssignmentId: unionReadOnlyAssignmentId,
    });
    unionWriterToken = await sessionTokenFor({
      userId: union.id,
      tenantId,
      activeAssignmentId: unionWriterAssignmentId,
    });
  });

  afterAll(async () => {
    if (tenantId) {
      // Tenant cascade removes roles, users, assignments and window rows.
      await pool.query(`DELETE FROM tenants WHERE id = $1`, [tenantId]);
    }
    await app.close();
    await pool.end();
  });

  it("passes through when the Window was never configured — day-one tenants keep working", async () => {
    // Asserted before any role_window_access row is written: the same write a
    // read-only row would block must succeed now, or shipping this gate would
    // lock every existing tenant out on deploy day.
    const response = await app.inject({
      method: "POST",
      url: "/customers",
      headers: authHeader(readOnlyToken),
      payload: { code: `WE-NOTCFG-${stamp}`, name: "Not configured yet" },
    });
    expect(response.statusCode).toBe(201);
  });

  it("rejects a write on a configured read-only Window with the §4.4 reason", async () => {
    await setWindowAccess(tenantId, readOnlyRoleId, CUSTOMER_WINDOW, false);

    const response = await app.inject({
      method: "POST",
      url: "/customers",
      headers: authHeader(readOnlyToken),
      payload: { code: `WE-RO-${stamp}`, name: "Should be refused" },
    });
    expect(response.statusCode).toBe(403);
    expect(response.json().error).toBe(WINDOW_READ_ONLY_REASON);
  });

  it("stops the request before the handler: the refused write creates no row", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/customers",
      headers: authHeader(readOnlyToken),
      payload: { code: `WE-NOROW-${stamp}`, name: "Must not exist" },
    });
    expect(response.statusCode).toBe(403);

    const rows = await pool.query(
      `SELECT COUNT(*)::int AS n FROM customers WHERE tenant_id = $1 AND code = $2`,
      [tenantId, `WE-NOROW-${stamp}`],
    );
    expect(rows.rows[0].n).toBe(0);
  });

  it("still opens the Window: reads on a read-only configuration stay allowed", async () => {
    // §4.4: "tetap dapat membuka Window-nya". A read on the very Window whose
    // writes are refused above must return 200.
    const response = await app.inject({
      method: "GET",
      url: "/customers",
      headers: authHeader(readOnlyToken),
    });
    expect(response.statusCode).toBe(200);
  });

  it("never trusts the browser for Window identity: the server resolves it from the route", async () => {
    // Nothing in this request names a Window except a header the client made
    // up. The gate still resolves route:/customer-commercial from the URL
    // pattern — §4.4: "selalu berasal dari resolusi route di server".
    const response = await app.inject({
      method: "POST",
      url: "/customers",
      headers: { ...authHeader(readOnlyToken), "x-window-code": "route:/admin" },
      payload: { code: `WE-SPOOF-${stamp}`, name: "Spoofed header" },
    });
    expect(response.statusCode).toBe(403);
    expect(response.json().error).toBe(WINDOW_READ_ONLY_REASON);
  });

  it("judges the lock on the ACTIVE Role: a read-only active Role refuses, switching to the writable Role reopens", async () => {
    // The user holds both the read-only Role and the writable one. Since
    // Epic 1 (§4.1 C) the lock reads only the session's active assignment, so
    // the read-only session is refused — holding a writable Role elsewhere is
    // not a union that opens this write.
    await setWindowAccess(tenantId, writerRoleId, CUSTOMER_WINDOW, true);

    const refused = await app.inject({
      method: "POST",
      url: "/customers",
      headers: authHeader(unionReadOnlyToken),
      payload: { code: `WE-ACTIVE-RO-${stamp}`, name: "Read-only active Role" },
    });
    expect(refused.statusCode).toBe(403);
    expect(refused.json().error).toBe(WINDOW_READ_ONLY_REASON);

    const opened = await app.inject({
      method: "POST",
      url: "/customers",
      headers: authHeader(unionWriterToken),
      payload: { code: `WE-ACTIVE-RW-${stamp}`, name: "Writable active Role" },
    });
    expect(opened.statusCode).toBe(201);
  });

  it("positive control: the writer's own write succeeds on the same Window", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/customers",
      headers: authHeader(writerToken),
      payload: { code: `WE-RW-${stamp}`, name: "Writer" },
    });
    expect(response.statusCode).toBe(201);
  });

  it("reports the other gate's reason first: an inactive module outranks the Window lock", async () => {
    // Both gates apply to POST /hse/records (module `hse`, Window
    // route:/hse/report). With the module inactive AND that Window read-only
    // for this Role, the actor must hear the module reason — activating the
    // module is the first thing they have to do.
    await setWindowAccess(tenantId, readOnlyRoleId, HSE_REPORT_WINDOW, false);

    const response = await app.inject({
      method: "POST",
      url: "/hse/records",
      headers: authHeader(readOnlyToken),
      payload: {
        recordType: "observation",
        occurredAt: new Date().toISOString(),
        title: "Order probe",
      },
    });
    expect(response.statusCode).toBe(403);
    expect(response.json().error).toBe(MODULE_INACTIVE_REASON);
  });

  it("reports enforcementStatus from the served-route census, never a literal", async () => {
    // The field used to be hard-coded "not_enforced", then derived from a gap
    // list someone maintained by hand. It is now read from the census the
    // enforcement plugin fills as Fastify declares each route: "enforced" while
    // no mutating route is unaccounted for, "partial" as soon as one is. The
    // window-enforcement-coverage test drives the other direction against the
    // real surface; here it only has to be reachable through the API.
    const response = await app.inject({
      method: "GET",
      url: `/admin/roles/${writerRoleCode}/definition`,
      headers: authHeader(readOnlyToken),
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().enforcementStatus).toBe("enforced");
  });
});
