/**
 * Epic 5 Gelombang 1 (§4.5 steps 5–9) — profile, ownership, lifecycle, root
 * Central and Department.
 *
 * The four properties this suite exists to hold, in the order the roadmap
 * gates them (docs/plans/CORE-ROADMAP.md §4.5 "Strategi mitigasi risiko" and
 * the G0 contract's acceptance table):
 *
 *   1. OWNERSHIP — an address, an Organization Unit and a Legal Entity are all
 *      inside one Tenant, and the database says so, not just the service. The
 *      composite foreign key `(tenant_id, legal_entity_id)` makes a cross-
 *      tenant address row unrepresentable; the API reports a foreign Legal
 *      Entity as absent rather than forbidden.
 *   2. ROOT CENTRAL — creating a Legal Entity produces exactly ONE root
 *      Organization Unit named Central, in the same transaction, and a second
 *      live Central for the same Legal Entity cannot be created.
 *   3. LIFECYCLE — `draft → active → inactive` is the only legal path, an
 *      inactive/deleted Legal Entity or Organization Unit refuses new work,
 *      and the guards that already existed (active children, inactive parent)
 *      still hold under the new `status` enum.
 *   4. DEPARTMENT ≠ SCOPE — a Department is a reporting dimension. Its id
 *      cannot be used as a Data Scope target, and there is no `department`
 *      scope type at all.
 *
 * Everything runs against the isolated test database (`SELECT current_database()`
 * is asserted by the runner before the suite, not by the suite itself — see the
 * task report). No fixture is deleted from `abixell_one_dev` by this file;
 * every row it writes hangs off a Tenant it created.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../../src/app.js";
import { pool } from "../../src/infrastructure/persistence/db.js";
import {
  activateAllModules,
  authHeader,
  bootstrapTenant,
  provisionFirstAdmin,
  sessionTokenFor,
} from "./helpers.js";

const stamp = `${Date.now().toString(36)}${randomUUID().replaceAll("-", "").slice(0, 6)}`;
const TENANT = `e5g1-${stamp}`;
const OTHER_TENANT = `e5g1o-${stamp}`;
const PASSWORD = "Passw0rd12345!";

const app = buildApp();

let tenantId: string;
let otherTenantId: string;
let adminToken: string;
let otherToken: string;

async function call(
  method: "GET" | "POST" | "PATCH",
  url: string,
  options: { token?: string; payload?: unknown } = {},
) {
  const response = await app.inject({
    method,
    url,
    headers: authHeader(options.token ?? adminToken),
    ...(options.payload === undefined ? {} : { payload: options.payload as object }),
  });
  return { status: response.statusCode, body: response.json() as Record<string, unknown> };
}

async function createLegalEntity(overrides: Record<string, unknown> = {}) {
  const result = await call("POST", "/legal-entities", {
    payload: { name: `LE ${stamp}`, baseCurrency: "IDR", ...overrides },
  });
  expect(result.status, JSON.stringify(result.body)).toBe(201);
  return result.body as { id: string; status: string; tenantId: string; baseCurrency: string | null };
}

async function rootUnitsOf(legalEntityId: string) {
  const result = await pool.query(
    `SELECT id, name, unit_type, parent_id, status, is_active
       FROM organization_units
      WHERE legal_entity_id = $1 AND parent_id IS NULL AND deleted_at IS NULL
      ORDER BY created_at ASC`,
    [legalEntityId],
  );
  return result.rows;
}

beforeAll(async () => {
  const tenant = await bootstrapTenant(app, TENANT, "Epic 5 G1 Profile and Lifecycle");
  tenantId = tenant.id;
  await activateAllModules(tenantId);
  const admin = await provisionFirstAdmin({
    tenantId,
    email: `admin-${stamp}@e5g1.test`,
    password: PASSWORD,
  });
  adminToken = await sessionTokenFor({ userId: admin.userId, tenantId });

  // A second Tenant exists so "same Tenant" can be tested as a real claim
  // rather than a comment: the same requests are replayed with a foreign
  // Tenant's token and must not reach the first Tenant's rows.
  const other = await bootstrapTenant(app, OTHER_TENANT, "Epic 5 G1 Other Tenant");
  otherTenantId = other.id;
  await activateAllModules(otherTenantId);
  const otherAdmin = await provisionFirstAdmin({
    tenantId: otherTenantId,
    email: `admin-${stamp}@e5g1-other.test`,
    password: PASSWORD,
  });
  otherToken = await sessionTokenFor({ userId: otherAdmin.userId, tenantId: otherTenantId });
}, 60_000);

afterAll(async () => {
  // Tenant teardown exercises the referential cascade: Legal Entities,
  // addresses and Organization Units all belong to these two Tenants and are
  // removed with them. Two mechanisms make that possible, both Founder-approved
  // as temporary accepted risks (2026-09-29, items [3.1] and [3.2]) and both
  // owned by Wave 2: the address FK is ON DELETE CASCADE where G0 M3 says
  // RESTRICT (1789320000000), and the root Central's DELETE guard exempts
  // referential cascades (1789385000000).
  await pool.query(`DELETE FROM tenants WHERE id = ANY($1::uuid[])`, [
    [tenantId, otherTenantId],
  ]);
  await app.close();
});

describe("Epic 5 G1 — Legal Entity profile and atomic root Central", () => {
  it("creates a Legal Entity with its profile and exactly one root Central, in one call", async () => {
    const legalEntity = await createLegalEntity({
      displayName: `Display ${stamp}`,
      country: "ID",
      timezone: "Asia/Jakarta",
      email: `legal-${stamp}@e5g1.test`,
      phone: "+6221000",
    });

    expect(legalEntity.tenantId).toBe(tenantId);
    expect(legalEntity.baseCurrency).toBe("IDR");

    const roots = await rootUnitsOf(legalEntity.id);
    expect(roots).toHaveLength(1);
    expect(roots[0].unit_type).toBe("Central");
    expect(roots[0].name).toBe("Central");
    expect(roots[0].status).toBe("active");
  });

  it("refuses a second live Central root for the same Legal Entity at the database level", async () => {
    const legalEntity = await createLegalEntity();
    const roots = await rootUnitsOf(legalEntity.id);

    await expect(
      pool.query(
        `INSERT INTO organization_units
           (tenant_id, legal_entity_id, parent_id, name, unit_type, status, is_active)
         VALUES ($1, $2, NULL, 'Central 2', 'Central', 'active', true)`,
        [tenantId, legalEntity.id],
      ),
    ).rejects.toThrow(/organization_units_one_central_per_legal_entity/);

    const after = await rootUnitsOf(legalEntity.id);
    expect(after.map((row) => row.id)).toEqual(roots.map((row) => row.id));
  });

  it("refuses a direct delete of the root Central, and allows the tenant cascade", async () => {
    const legalEntity = await createLegalEntity();
    const [root] = await rootUnitsOf(legalEntity.id);

    await expect(
      pool.query(`DELETE FROM organization_units WHERE id = $1`, [root.id]),
    ).rejects.toThrow(/Root Central Organization Unit cannot be deleted/);

    // The cascade path is the one afterAll uses; if it threw, this suite would
    // be unable to clean up after itself.
    const probe = await bootstrapTenant(app, `e5g1-c-${stamp}`, "Epic 5 G1 Cascade Probe");
    await activateAllModules(probe.id);
    const le = await pool.query(
      `INSERT INTO legal_entities (tenant_id, name, status, is_active)
       VALUES ($1, 'Probe LE', 'active', true) RETURNING id`,
      [probe.id],
    );
    await pool.query(
      `INSERT INTO organization_units
         (tenant_id, legal_entity_id, parent_id, name, unit_type, status, is_active)
       VALUES ($1, $2, NULL, 'Central', 'Central', 'active', true)`,
      [probe.id, le.rows[0].id],
    );
    await expect(
      pool.query(`DELETE FROM tenants WHERE id = $1`, [probe.id]),
    ).resolves.toBeDefined();
  });

  it("reports a foreign Tenant's Legal Entity as absent, never as forbidden", async () => {
    const legalEntity = await createLegalEntity();

    const read = await call("POST", `/legal-entities/${legalEntity.id}/addresses`, {
      token: otherToken,
      payload: { addressType: "registered", line1: "Jl. Lain 1" },
    });
    expect(read.status).toBe(404);

    const update = await call("PATCH", `/legal-entities/${legalEntity.id}`, {
      token: otherToken,
      payload: { name: "Hijacked" },
    });
    expect(update.status).toBe(404);

    const unchanged = await pool.query(`SELECT name FROM legal_entities WHERE id = $1`, [
      legalEntity.id,
    ]);
    expect(unchanged.rows[0].name).toBe(`LE ${stamp}`);
  });

  it("rejects a lifecycle transition that the policy does not define", async () => {
    // A new Legal Entity is `draft` (G0 §5, §4.5 Putaran 5), so the illegal
    // transition is exercised from an explicit state rather than from the
    // creation default: `active → draft` is not in the transition table.
    const legalEntity = await createLegalEntity();
    const activated = await call("POST", `/legal-entities/${legalEntity.id}/status`, {
      payload: { status: "active" },
    });
    expect(activated.status).toBe(200);

    const illegal = await call("POST", `/legal-entities/${legalEntity.id}/status`, {
      payload: { status: "draft" },
    });
    expect(illegal.status).toBe(409);
    expect(String(illegal.body.error ?? illegal.body.message)).toMatch(/transition/i);
  });

  it("creates a Legal Entity in `draft`, not directly active", async () => {
    const legalEntity = await createLegalEntity();
    expect(legalEntity.status).toBe("draft");

    const row = await pool.query(
      `SELECT status, is_active FROM legal_entities WHERE id = $1`,
      [legalEntity.id],
    );
    expect(row.rows[0]).toEqual({ status: "draft", is_active: false });
  });
});

describe("Epic 5 G1 — typed addresses with same-tenant ownership", () => {
  it("stores one active address per type and refuses a duplicate type", async () => {
    const legalEntity = await createLegalEntity();

    const first = await call("POST", `/legal-entities/${legalEntity.id}/addresses`, {
      payload: {
        addressType: "registered",
        line1: "Jl. Merdeka 1",
        city: "Bandung",
        country: "ID",
      },
    });
    expect(first.status).toBe(201);

    const duplicate = await call("POST", `/legal-entities/${legalEntity.id}/addresses`, {
      payload: { addressType: "registered", line1: "Jl. Merdeka 2" },
    });
    expect(duplicate.status).toBe(409);

    const other = await call("POST", `/legal-entities/${legalEntity.id}/addresses`, {
      payload: { addressType: "billing", line1: "Jl. Merdeka 3" },
    });
    expect(other.status).toBe(201);

    const listed = await call("GET", `/legal-entities/${legalEntity.id}/addresses`);
    expect(listed.status).toBe(200);
    expect((listed.body as unknown as unknown[]).length).toBe(2);
  });

  it("makes a cross-tenant address row unrepresentable", async () => {
    const mine = await createLegalEntity();
    const theirs = await call("POST", "/legal-entities", {
      token: otherToken,
      payload: { name: `LE other ${stamp}` },
    });
    expect(theirs.status).toBe(201);

    // The address claims my Tenant but points at the other Tenant's Legal
    // Entity. The composite FK `(tenant_id, legal_entity_id)` is what refuses
    // it — a single-column FK would have accepted this row.
    await expect(
      pool.query(
        `INSERT INTO legal_entity_addresses
           (tenant_id, legal_entity_id, address_type, line1)
         VALUES ($1, $2, 'operating', 'Jl. Salah 1')`,
        [tenantId, (theirs.body as { id: string }).id],
      ),
    ).rejects.toThrow(/legal_entity_addresses_legal_entity_fkey/);

    const stillMine = await call("GET", `/legal-entities/${mine.id}/addresses`);
    expect(stillMine.status).toBe(200);
  });

  it("keeps a superseded address readable instead of deleting it", async () => {
    const legalEntity = await createLegalEntity();
    const created = await call("POST", `/legal-entities/${legalEntity.id}/addresses`, {
      payload: { addressType: "operating", line1: "Jl. Lama 1" },
    });
    expect(created.status).toBe(201);
    const addressId = (created.body as { id: string }).id;

    const deactivated = await call(
      "POST",
      `/legal-entities/${legalEntity.id}/addresses/${addressId}/deactivate`,
    );
    expect(deactivated.status).toBe(200);

    const replacement = await call("POST", `/legal-entities/${legalEntity.id}/addresses`, {
      payload: { addressType: "operating", line1: "Jl. Baru 1" },
    });
    expect(replacement.status).toBe(201);

    const rows = await pool.query(
      `SELECT line1, is_active FROM legal_entity_addresses WHERE legal_entity_id = $1 ORDER BY created_at`,
      [legalEntity.id],
    );
    expect(rows.rows).toEqual([
      { line1: "Jl. Lama 1", is_active: false },
      { line1: "Jl. Baru 1", is_active: true },
    ]);
  });
});

describe("Epic 5 G1 — Organization Unit and Legal Entity lifecycle", () => {
  it("allows deactivating a Legal Entity when its only active unit is the root Central", async () => {
    const legalEntity = await createLegalEntity();
    const activated = await call("POST", `/legal-entities/${legalEntity.id}/status`, {
      payload: { status: "active" },
    });
    expect(activated.status).toBe(200);

    // `createLegalEntity` already produced the root Central. Phase 3 (line 377)
    // excludes the root Central from the active-units guard, so a Legal Entity
    // whose only live unit is that Central may now be deactivated through the
    // API.
    const roots = await rootUnitsOf(legalEntity.id);
    expect(roots).toHaveLength(1);

    const deactivated = await call("POST", `/legal-entities/${legalEntity.id}/status`, {
      payload: { status: "inactive" },
    });
    expect(deactivated.status).toBe(200);
    expect(deactivated.body.status).toBe("inactive");
  });

  it("blocks deactivating an Organization Unit that still has active children", async () => {
    const legalEntity = await createLegalEntity();
    const parent = await call("POST", "/organization-units", {
      payload: { legalEntityId: legalEntity.id, name: `Parent ${stamp}`, unitType: "Region" },
    });
    expect(parent.status).toBe(201);

    const child = await call("POST", "/organization-units", {
      payload: {
        legalEntityId: legalEntity.id,
        parentId: (parent.body as { id: string }).id,
        name: `Child ${stamp}`,
        unitType: "Internal Site",
      },
    });
    expect(child.status).toBe(201);

    const blocked = await call(
      "POST",
      `/organization-units/${(parent.body as { id: string }).id}/status`,
      { payload: { status: "inactive" } },
    );
    expect(blocked.status).toBe(409);
  });

  it("refuses to activate an Organization Unit whose parent is inactive", async () => {
    const legalEntity = await createLegalEntity();
    const parent = await call("POST", "/organization-units", {
      payload: { legalEntityId: legalEntity.id, name: `Region ${stamp}`, unitType: "Region" },
    });
    const parentId = (parent.body as { id: string }).id;

    const child = await call("POST", "/organization-units", {
      payload: {
        legalEntityId: legalEntity.id,
        parentId,
        name: `Site ${stamp}`,
        unitType: "Internal Site",
      },
    });
    const childId = (child.body as { id: string }).id;

    // Deactivate bottom-up, then try to bring the child back with its parent
    // still inactive.
    const childOff = await call("POST", `/organization-units/${childId}/status`, {
      payload: { status: "inactive" },
    });
    expect(childOff.status).toBe(200);
    const parentOff = await call("POST", `/organization-units/${parentId}/status`, {
      payload: { status: "inactive" },
    });
    expect(parentOff.status).toBe(200);

    const refused = await call("POST", `/organization-units/${childId}/status`, {
      payload: { status: "active" },
    });
    expect(refused.status).toBe(409);
    expect(String(refused.body.error ?? refused.body.message)).toMatch(/parent/i);
  });

  it("refuses new mutations against an inactive Organization Unit while reads still work", async () => {
    const legalEntity = await createLegalEntity();
    const unit = await call("POST", "/organization-units", {
      payload: { legalEntityId: legalEntity.id, name: `Site ${stamp}`, unitType: "Internal Site" },
    });
    const unitId = (unit.body as { id: string }).id;

    const off = await call("POST", `/organization-units/${unitId}/status`, {
      payload: { status: "inactive" },
    });
    expect(off.status).toBe(200);

    const refused = await call("PATCH", `/organization-units/${unitId}`, {
      payload: { name: "Renamed after deactivation" },
    });
    expect(refused.status).toBe(409);

    const stillReadable = await call("GET", "/organization-units");
    expect(stillReadable.status).toBe(200);
    expect(
      (stillReadable.body as unknown as { id: string }[]).some((row) => row.id === unitId),
    ).toBe(true);
  });

  it("never lets the root Central be deactivated or re-typed", async () => {
    const legalEntity = await createLegalEntity();
    const [root] = await rootUnitsOf(legalEntity.id);

    const deactivate = await call("POST", `/organization-units/${root.id}/status`, {
      payload: { status: "inactive" },
    });
    expect(deactivate.status).toBe(409);

    const retype = await call("PATCH", `/organization-units/${root.id}`, {
      payload: { name: "Central", unitType: "Internal Site" },
    });
    expect(retype.status).toBe(409);
  });
});

describe("Epic 5 G1 — Department is a reporting dimension, never a Data Scope", () => {
  it("manages Departments inside the Tenant with their own permissions", async () => {
    const created = await call("POST", "/departments", {
      payload: { name: `Operations ${stamp}`, code: `OPS-${stamp}`.slice(0, 32) },
    });
    expect(created.status).toBe(201);
    const departmentId = (created.body as { id: string }).id;

    const child = await call("POST", "/departments", {
      payload: { name: `Field ${stamp}`, parentDepartmentId: departmentId },
    });
    expect(child.status).toBe(201);

    const listed = await call("GET", "/departments");
    expect(listed.status).toBe(200);
    expect((listed.body as unknown as unknown[]).length).toBeGreaterThanOrEqual(2);

    const duplicate = await call("POST", "/departments", {
      payload: { name: `Operations copy ${stamp}`, code: `OPS-${stamp}`.slice(0, 32) },
    });
    expect(duplicate.status).toBe(409);

    const deactivated = await call("POST", `/departments/${departmentId}/deactivate`);
    expect(deactivated.status).toBe(200);
    const reactivated = await call("POST", `/departments/${departmentId}/activate`);
    expect(reactivated.status).toBe(200);
  });

  it("has no `department` scope type in the assignment table", async () => {
    const user = await pool.query(
      `SELECT id FROM users WHERE tenant_id = $1 LIMIT 1`,
      [tenantId],
    );
    const role = await pool.query(`SELECT id FROM roles WHERE tenant_id = $1 LIMIT 1`, [tenantId]);

    await expect(
      pool.query(
        `INSERT INTO user_role_assignments (user_id, role_id, scope_type)
         VALUES ($1, $2, 'department')`,
        [user.rows[0].id, role.rows[0].id],
      ),
    ).rejects.toThrow(/check constraint/);
  });

  it("refuses a Department id where a Data Scope target is required", async () => {
    const created = await call("POST", "/departments", {
      payload: { name: `Finance ${stamp}` },
    });
    const departmentId = (created.body as { id: string }).id;

    const user = await pool.query(`SELECT id FROM users WHERE tenant_id = $1 LIMIT 1`, [tenantId]);
    const role = await pool.query(`SELECT id FROM roles WHERE tenant_id = $1 LIMIT 1`, [tenantId]);

    // The only column that could hold a scope target is the Organization Unit
    // one, and its foreign key is the reason a Department id cannot be
    // smuggled in there: `department.id` is not in `organization_units`.
    await expect(
      pool.query(
        `INSERT INTO user_role_assignments
           (user_id, role_id, scope_type, scope_organization_unit_id)
         VALUES ($1, $2, 'organization_unit', $3)`,
        [user.rows[0].id, role.rows[0].id, departmentId],
      ),
    ).rejects.toThrow(/scope_organization_unit_id/);
  });
});
