import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../../src/app.js";
import { pool } from "../../src/infrastructure/persistence/db.js";
import { activateAllModules, authHeader, bootstrapTenant, createReadOnlyRole, login, provisionFirstAdmin } from "./helpers.js";

/**
 * Phase 3 — Workforce / HR Core (HR-CORE-001…010).
 *
 * Drives the real HTTP API: positions → employee master → organisational
 * placement → placement history → optional user-account link → employee
 * documents → deactivation. Plus authorization, hierarchical Data Scope,
 * cross-tenant isolation, validation, and the Employee-is-not-a-User
 * boundary.
 */

const TENANT = `test-p3-${Date.now()}`;
const OTHER = `test-p3-other-${Date.now()}`;

describe("Phase 3 — Workforce / HR Core", () => {
  const app = buildApp();

  let tenantId: string;
  let adminToken: string;
  let hrToken: string;
  let readerToken: string;
  let scopedToken: string;
  let docReaderToken: string;
  let legalEntityId: string;
  let unitNorthId: string;
  let unitNorthChildId: string;
  let unitSouthId: string;
  let plainUserId: string;
  let secondUserId: string;

  let otherTenantAdminToken: string;
  let otherTenantUserId: string;
  let otherTenantEmployeeId: string;
  let otherTenantUnitId: string;

  const post = (url: string, token: string, payload: unknown = {}) =>
    app.inject({ method: "POST", url, headers: authHeader(token), payload });
  const get = (url: string, token: string) => app.inject({ method: "GET", url, headers: authHeader(token) });
  const patch = (url: string, token: string, payload: unknown = {}) =>
    app.inject({ method: "PATCH", url, headers: authHeader(token), payload });

  beforeAll(async () => {
    const t = await bootstrapTenant(app, TENANT, "Tenant P3");
    await activateAllModules(t.id);
    tenantId = t.id;
    await provisionFirstAdmin({ tenantId, email: "admin@p3.local", password: "Admin12345!" });
    adminToken = (await login(app, TENANT, "admin@p3.local", "Admin12345!")).body.accessToken;

    const legal = await post("/legal-entities", adminToken, { code: "LE-P3", name: "Legal Entity P3" });
    legalEntityId = legal.json().id;
    const north = await post("/organization-units", adminToken, {
      legalEntityId,
      code: "NORTH",
      name: "North Region",
    });
    unitNorthId = north.json().id;
    const northChild = await post("/organization-units", adminToken, {
      legalEntityId,
      code: "NORTH-A",
      name: "North Site A",
      parentId: unitNorthId,
    });
    unitNorthChildId = northChild.json().id;
    const south = await post("/organization-units", adminToken, {
      legalEntityId,
      code: "SOUTH",
      name: "South Region",
    });
    unitSouthId = south.json().id;

    await createReadOnlyRole(tenantId, "HR_P3", [
      "workforce.read",
      "workforce.manage",
      "workforce.configure",
      "organization_unit.read",
      "legal_entity.read",
    ]);
    await createReadOnlyRole(tenantId, "READER_P3", ["workforce.read"]);
    await createReadOnlyRole(tenantId, "DOCS_P3", [
      "workforce.read",
      "workforce.documents.read",
      "document.read",
      "document.manage",
    ]);

    const mkUser = (email: string, roleCode: string, scope: Record<string, unknown> = { scopeType: "tenant" }) =>
      post("/admin/users", adminToken, { email, fullName: email, password: "Passw0rd12345!", pairs: [{ roleCode, ...scope }] });

    await mkUser("hr@p3.local", "HR_P3");
    await mkUser("reader@p3.local", "READER_P3");
    await mkUser("docs@p3.local", "DOCS_P3");
    // HR user scoped to the NORTH branch only — hierarchical Data Scope.
    await mkUser("scoped@p3.local", "HR_P3", {
      scopeType: "organization_unit",
      scopeOrganizationUnitId: unitNorthId,
    });
    plainUserId = (await mkUser("person1@p3.local", "READER_P3")).json().user.id;
    secondUserId = (await mkUser("person2@p3.local", "READER_P3")).json().user.id;

    const tok = async (email: string) => (await login(app, TENANT, email, "Passw0rd12345!")).body.accessToken;
    hrToken = await tok("hr@p3.local");
    readerToken = await tok("reader@p3.local");
    docReaderToken = await tok("docs@p3.local");
    scopedToken = await tok("scoped@p3.local");

    await post("/config/numbering/employee_number", adminToken, { pattern: "EMP-{SEQ:5}" });
    await post("/positions", adminToken, { code: "supervisor", name: "Supervisor" });
    await post("/positions", adminToken, { code: "technician", name: "Technician" });

    // Second tenant for cross-tenant checks.
    const ot = await bootstrapTenant(app, OTHER, "Tenant P3 Other");
    await activateAllModules(ot.id);
    otherTenantUserId = (
      await provisionFirstAdmin({ tenantId: ot.id, email: "admin@p3other.local", password: "Admin12345!" })
    ).userId;
    otherTenantAdminToken = (await login(app, OTHER, "admin@p3other.local", "Admin12345!")).body.accessToken;
    const otherLegal = await post("/legal-entities", otherTenantAdminToken, { code: "LE-O", name: "Other LE" });
    const otherUnit = await post("/organization-units", otherTenantAdminToken, {
      legalEntityId: otherLegal.json().id,
      code: "OU-O",
      name: "Other Unit",
    });
    otherTenantUnitId = otherUnit.json().id;
    await post("/config/numbering/employee_number", otherTenantAdminToken, { pattern: "EMP-O-{SEQ:5}" });
    otherTenantEmployeeId = (
      await post("/employees", otherTenantAdminToken, { fullName: "Other Tenant Person" })
    ).json().id;
  });

  afterAll(async () => {
    await pool.end();
  });

  // --- HR-CORE-001/002/004/005/011 -------------------------------------

  it("HR-CORE-001/004: creates an employee with a generated number, position, and placement", async () => {
    const created = await post("/employees", hrToken, {
      fullName: "Ana Pereira",
      email: "ana@example.test",
      phone: "+10000000",
      employmentType: "permanent",
      joinedAt: "2026-01-05",
      legalEntityId,
      organizationUnitId: unitNorthId,
      positionCode: "supervisor",
    });
    expect(created.statusCode).toBe(201);
    const body = created.json();
    expect(body.employeeNumber).toMatch(/^EMP-\d{5}$/);
    expect(body.employmentStatus).toBe("active");
    expect(body.userId).toBeNull(); // Employee is NOT a system user by default

    const detail = await get(`/employees/${body.id}`, hrToken);
    expect(detail.statusCode).toBe(200);
    expect(detail.json().position.code).toBe("supervisor");
    // Opening placement period recorded immediately (HR-CORE-007).
    expect(detail.json().history).toHaveLength(1);
    expect(detail.json().history[0].effectiveTo).toBeNull();
    expect(detail.json().history[0].effectiveFrom).toBe("2026-01-05");
  });

  it("HR-CORE-001: an explicit employee number is honoured and duplicates are rejected", async () => {
    const first = await post("/employees", hrToken, { fullName: "Bo Nguyen", employeeNumber: "MANUAL-1" });
    expect(first.statusCode).toBe(201);
    const dup = await post("/employees", hrToken, { fullName: "Someone Else", employeeNumber: "MANUAL-1" });
    expect(dup.statusCode).toBe(409);
  });

  it("Employee exists without any login account (Employee ≠ User)", async () => {
    const created = await post("/employees", hrToken, { fullName: "No Login Person" });
    expect(created.statusCode).toBe(201);
    expect(created.json().userId).toBeNull();
    const users = await get("/users", adminToken);
    const emails = users.json().map((u: { email: string }) => u.email);
    expect(emails).not.toContain("no login person");
  });

  // --- HR-CORE-003/007 --------------------------------------------------

  it("HR-CORE-003/007: a placement change closes the old period and opens a new one", async () => {
    const employee = (await post("/employees", hrToken, {
      fullName: "Cara Silva",
      organizationUnitId: unitNorthId,
      positionCode: "technician",
      joinedAt: "2026-02-01",
    })).json();

    const moved = await post(`/employees/${employee.id}/placement`, hrToken, {
      organizationUnitId: unitSouthId,
      positionCode: "supervisor",
      effectiveFrom: "2026-06-01",
      note: "Promotion and transfer",
    });
    expect(moved.statusCode).toBe(200);

    const detail = moved.json();
    expect(detail.employee.organizationUnitId).toBe(unitSouthId);
    expect(detail.position.code).toBe("supervisor");
    expect(detail.history).toHaveLength(2);

    const open = detail.history.find((h: { effectiveTo: string | null }) => h.effectiveTo === null);
    const closed = detail.history.find((h: { effectiveTo: string | null }) => h.effectiveTo !== null);
    // The historical period keeps its ORIGINAL facts — not rewritten.
    expect(closed.organizationUnitId).toBe(unitNorthId);
    expect(closed.effectiveFrom).toBe("2026-02-01");
    expect(closed.effectiveTo).toBe("2026-06-01");
    expect(open.organizationUnitId).toBe(unitSouthId);
    expect(open.effectiveFrom).toBe("2026-06-01");
  });

  it("HR-CORE-002: ending employment preserves history and does not delete the record", async () => {
    const employee = (await post("/employees", hrToken, {
      fullName: "Dan Alves",
      organizationUnitId: unitNorthId,
      joinedAt: "2026-01-01",
    })).json();

    const ended = await post(`/employees/${employee.id}/placement`, hrToken, {
      employmentStatus: "ended",
      effectiveFrom: "2026-09-30",
      note: "Contract completed",
    });
    expect(ended.statusCode).toBe(200);
    expect(ended.json().employee.employmentStatus).toBe("ended");
    expect(ended.json().employee.endedAt).toBe("2026-09-30");

    // Still readable, with full history intact.
    const detail = await get(`/employees/${employee.id}`, hrToken);
    expect(detail.statusCode).toBe(200);
    expect(detail.json().history.length).toBeGreaterThanOrEqual(2);

    const events = (
      await pool.query(`SELECT event_type FROM domain_events WHERE entity_type = 'employee' AND entity_id = $1`, [
        employee.id,
      ])
    ).rows.map((r) => r.event_type);
    expect(events).toEqual(expect.arrayContaining(["workforce.employee.created", "workforce.employee.deactivated"]));
  });

  // --- HR-CORE-008 ------------------------------------------------------

  it("HR-CORE-008: user-account link is optional, one-to-one, and tenant-bound", async () => {
    const employee = (await post("/employees", hrToken, { fullName: "Eve Larsen" })).json();

    const linked = await post(`/employees/${employee.id}/user-link`, hrToken, { userId: plainUserId });
    expect(linked.statusCode).toBe(200);
    expect(linked.json().userId).toBe(plainUserId);

    // The same account cannot be linked to a second employee.
    const other = (await post("/employees", hrToken, { fullName: "Finn Bauer" })).json();
    const clash = await post(`/employees/${other.id}/user-link`, hrToken, { userId: plainUserId });
    expect(clash.statusCode).toBe(409);

    // A different account is fine.
    expect((await post(`/employees/${other.id}/user-link`, hrToken, { userId: secondUserId })).statusCode).toBe(200);

    // Unlinking never touches the account itself.
    const unlinked = await post(`/employees/${employee.id}/user-link`, hrToken, { userId: null });
    expect(unlinked.json().userId).toBeNull();
    const stillThere = await get("/users", adminToken);
    expect(stillThere.json().some((u: { id: string }) => u.id === plainUserId)).toBe(true);
  });

  it("HR-CORE-008: a user from another tenant cannot be linked", async () => {
    const employee = (await post("/employees", hrToken, { fullName: "Gus Meyer" })).json();
    const denied = await post(`/employees/${employee.id}/user-link`, hrToken, { userId: otherTenantUserId });
    expect(denied.statusCode).toBe(403);
  });

  it("Minimum self-service: a linked user sees their own record; an unlinked user gets 404", async () => {
    const employee = (await post("/employees", hrToken, {
      fullName: "Person One",
      organizationUnitId: unitSouthId,
    })).json();
    await post(`/employees/${employee.id}/user-link`, hrToken, { userId: plainUserId });

    const personToken = (await login(app, TENANT, "person1@p3.local", "Passw0rd12345!")).body.accessToken;
    const mine = await get("/employees/me", personToken);
    expect(mine.statusCode).toBe(200);
    expect(mine.json().employee.id).toBe(employee.id);

    const unlinkedToken = (await login(app, TENANT, "reader@p3.local", "Passw0rd12345!")).body.accessToken;
    expect((await get("/employees/me", unlinkedToken)).statusCode).toBe(404);
  });

  // --- HR-CORE-009 (Data Scope) ----------------------------------------

  it("HR-CORE-009: organisation Data Scope is hierarchical and excludes unrelated units", async () => {
    const inNorth = (await post("/employees", hrToken, {
      fullName: "North Person",
      organizationUnitId: unitNorthId,
    })).json();
    const inNorthChild = (await post("/employees", hrToken, {
      fullName: "North Child Person",
      organizationUnitId: unitNorthChildId,
    })).json();
    const inSouth = (await post("/employees", hrToken, {
      fullName: "South Person",
      organizationUnitId: unitSouthId,
    })).json();

    const listed = await get("/employees", scopedToken);
    expect(listed.statusCode).toBe(200);
    const ids = listed.json().map((e: { id: string }) => e.id);
    expect(ids).toContain(inNorth.id);
    expect(ids).toContain(inNorthChild.id); // descendant unit is covered
    expect(ids).not.toContain(inSouth.id);

    expect((await get(`/employees/${inNorthChild.id}`, scopedToken)).statusCode).toBe(200);
    expect((await get(`/employees/${inSouth.id}`, scopedToken)).statusCode).toBe(403);
  });

  it("HR-CORE-009: an employee cannot be transferred into a unit outside the actor's scope", async () => {
    const employee = (await post("/employees", hrToken, {
      fullName: "Transfer Guard",
      organizationUnitId: unitNorthId,
    })).json();
    const denied = await post(`/employees/${employee.id}/placement`, scopedToken, {
      organizationUnitId: unitSouthId,
    });
    expect(denied.statusCode).toBe(403);
  });

  // --- Authorization ----------------------------------------------------

  it("Authorization: a read-only user cannot create or change employees", async () => {
    expect((await post("/employees", readerToken, { fullName: "Nope" })).statusCode).toBe(403);
    expect((await post("/positions", readerToken, { code: "x", name: "X" })).statusCode).toBe(403);

    const employee = (await post("/employees", hrToken, { fullName: "Guarded Person" })).json();
    expect((await patch(`/employees/${employee.id}`, readerToken, { fullName: "Hacked" })).statusCode).toBe(403);
    expect((await post(`/employees/${employee.id}/placement`, readerToken, {})).statusCode).toBe(403);
  });

  // --- HR-CORE-006 (documents) -----------------------------------------

  it("HR-CORE-006: employee documents need the dedicated capability, not just workforce.read", async () => {
    const employee = (await post("/employees", hrToken, { fullName: "Doc Subject" })).json();

    const upload = await app.inject({
      method: "POST",
      url: "/documents",
      headers: { ...authHeader(docReaderToken), "content-type": "multipart/form-data; boundary=----p3b" },
      payload: Buffer.from(
        `------p3b\r\nContent-Disposition: form-data; name="entityType"\r\n\r\nemployee\r\n` +
          `------p3b\r\nContent-Disposition: form-data; name="entityId"\r\n\r\n${employee.id}\r\n` +
          `------p3b\r\nContent-Disposition: form-data; name="file"; filename="contract.txt"\r\n` +
          `Content-Type: text/plain\r\n\r\nemployment contract\r\n------p3b--\r\n`,
      ),
    });
    expect(upload.statusCode).toBe(201);

    // Holder of the dedicated capability can list them…
    const allowed = await get(`/documents?entityType=employee&entityId=${employee.id}`, docReaderToken);
    expect(allowed.statusCode).toBe(200);
    expect(allowed.json().length).toBeGreaterThan(0);

    // …while an HR user WITHOUT workforce.documents.read cannot.
    const denied = await get(`/documents?entityType=employee&entityId=${employee.id}`, hrToken);
    expect([403, 404]).toContain(denied.statusCode);
  });

  // --- Cross-tenant -----------------------------------------------------

  it("Cross-tenant: another tenant's employee is invisible and immutable", async () => {
    expect((await get(`/employees/${otherTenantEmployeeId}`, hrToken)).statusCode).toBe(404);
    expect((await patch(`/employees/${otherTenantEmployeeId}`, hrToken, { fullName: "X" })).statusCode).toBe(404);
    expect((await post(`/employees/${otherTenantEmployeeId}/placement`, hrToken, {})).statusCode).toBe(404);

    const listed = await get("/employees", hrToken);
    expect(listed.json().map((e: { id: string }) => e.id)).not.toContain(otherTenantEmployeeId);
  });

  it("Cross-tenant: an Organization Unit from another tenant cannot be used for placement", async () => {
    const denied = await post("/employees", hrToken, {
      fullName: "Cross Tenant Unit",
      organizationUnitId: otherTenantUnitId,
    });
    expect(denied.statusCode).toBe(404);
  });

  // --- Validation -------------------------------------------------------

  it("Validation: bad status, unknown position, inactive position, and backdated placement are rejected", async () => {
    expect(
      (await post("/employees", hrToken, { fullName: "Bad Status", employmentStatus: "retired" })).statusCode,
    ).toBe(400);
    expect(
      (await post("/employees", hrToken, { fullName: "Bad Position", positionCode: "does_not_exist" })).statusCode,
    ).toBe(404);

    await post("/positions", adminToken, { code: "retired_role", name: "Retired Role" });
    await patch("/positions/retired_role/active", adminToken, { isActive: false });
    expect(
      (await post("/employees", hrToken, { fullName: "Inactive Position", positionCode: "retired_role" })).statusCode,
    ).toBe(409);

    const employee = (await post("/employees", hrToken, {
      fullName: "Backdate Guard",
      joinedAt: "2026-05-01",
    })).json();
    const backdated = await post(`/employees/${employee.id}/placement`, hrToken, { effectiveFrom: "2026-01-01" });
    expect(backdated.statusCode).toBe(400);
  });

  it("Search and status filtering work on the employee list", async () => {
    await post("/employees", hrToken, { fullName: "Zaphod Searchable", employeeNumber: "SEARCH-1" });
    const byName = await get("/employees?search=Searchable", hrToken);
    expect(byName.json().length).toBeGreaterThan(0);
    expect(byName.json().every((e: { fullName: string }) => e.fullName.includes("Searchable"))).toBe(true);

    const ended = await get("/employees?employmentStatus=ended", hrToken);
    expect(ended.json().every((e: { employmentStatus: string }) => e.employmentStatus === "ended")).toBe(true);
  });
});
