import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../../src/app.js";
import { pool } from "../../src/infrastructure/persistence/db.js";
import { authHeader, bootstrapTenant, createReadOnlyRole, login, provisionFirstAdmin } from "./helpers.js";

/**
 * Phase 5 — Asset Core (AST-CORE-001…010).
 *
 * Drives the real HTTP API: register a tagged asset → move it between
 * locations and custodians → change status → retire it, plus the optional
 * approval lifecycle a client may configure. The transactional invariant is
 * the point of this suite: current state can never contradict history, a
 * failed movement writes nothing, and concurrent transfers cannot lose an
 * update.
 */

const TENANT = `test-p5-${Date.now()}`;
const OTHER = `test-p5-other-${Date.now()}`;
const MOVE_WORKFLOW = "asset_movement_approval";

describe("Phase 5 — Asset Core", () => {
  const app = buildApp();

  let tenantId: string;
  let adminToken: string;
  let assetAdminToken: string;
  let moverToken: string;
  let readerToken: string;
  let docReaderToken: string;
  let scopedToken: string;

  let unitNorthId: string;
  let unitSouthId: string;
  let siteAId: string;
  let siteBId: string;
  let siteCId: string;
  let projectId: string;
  let aliceId: string;
  let bobId: string;

  let otherAdminToken: string;
  let otherAssetId: string;
  let otherSiteId: string;
  let otherEmployeeId: string;

  const post = (url: string, token: string, payload: unknown = {}) =>
    app.inject({ method: "POST", url, headers: authHeader(token), payload });
  const get = (url: string, token: string) => app.inject({ method: "GET", url, headers: authHeader(token) });
  const patch = (url: string, token: string, payload: unknown = {}) =>
    app.inject({ method: "PATCH", url, headers: authHeader(token), payload });

  /** Register an asset and return its detail view. */
  async function createAsset(token: string, body: Record<string, unknown>) {
    const created = await post("/assets", token, body);
    expect(created.statusCode).toBe(201);
    return created.json();
  }

  async function detail(token: string, id: string) {
    const response = await get(`/assets/${id}`, token);
    expect(response.statusCode).toBe(200);
    return response.json();
  }

  /** The approval lifecycle a client configures when it requires one. */
  async function buildMovementWorkflow(token: string) {
    await post("/workflow/definitions", token, {
      code: MOVE_WORKFLOW,
      name: "Asset Movement Approval",
      entityType: "asset_movement",
      description: "Phase 5 test approval lifecycle",
    });
    const addStep = (b: Record<string, unknown>) =>
      post(`/workflow/definitions/${MOVE_WORKFLOW}/versions/1/steps`, token, b);
    await addStep({ code: "REVIEW", name: "Review", stepType: "approval", isInitial: true, slaHours: 24 });
    await addStep({
      code: "APPROVED",
      name: "Approved",
      stepType: "end",
      isTerminal: true,
      terminalStatus: "approved",
    });
    await addStep({
      code: "REJECTED",
      name: "Rejected",
      stepType: "end",
      isTerminal: true,
      terminalStatus: "rejected",
    });

    const addTransition = (b: Record<string, unknown>) =>
      post(`/workflow/definitions/${MOVE_WORKFLOW}/versions/1/transitions`, token, b);
    await addTransition({ fromStepCode: "REVIEW", toStepCode: "APPROVED", actionCode: "approve", name: "Approve" });
    await addTransition({ fromStepCode: "REVIEW", toStepCode: "REJECTED", actionCode: "reject", name: "Reject" });

    await post(`/workflow/definitions/${MOVE_WORKFLOW}/versions/1/assignment-rules`, token, {
      stepCode: "REVIEW",
      assignmentType: "role",
      roleCode: "ADMIN",
      organizationUnitStrategy: "tenant",
    });
    const publish = await post(`/workflow/definitions/${MOVE_WORKFLOW}/versions/1/publish`, token);
    expect(publish.statusCode).toBe(200);
  }

  beforeAll(async () => {
    const t = await bootstrapTenant(app, TENANT, "Tenant P5");
    tenantId = t.id;
    await provisionFirstAdmin({ tenantId, email: "admin@p5.local", password: "Admin12345!" });
    adminToken = (await login(app, TENANT, "admin@p5.local", "Admin12345!")).body.accessToken;

    const legal = await post("/legal-entities", adminToken, { code: "LE-P5", name: "Legal Entity P5" });
    unitNorthId = (
      await post("/organization-units", adminToken, {
        legalEntityId: legal.json().id,
        code: "N-P5",
        name: "North P5",
      })
    ).json().id;
    unitSouthId = (
      await post("/organization-units", adminToken, {
        legalEntityId: legal.json().id,
        code: "S-P5",
        name: "South P5",
      })
    ).json().id;

    const customer = await post("/customers", adminToken, { code: "CUST-P5", name: "Customer P5" });
    const mkSite = async (code: string, name: string) =>
      (await post("/sites", adminToken, { customerId: customer.json().id, code, name })).json().id;
    siteAId = await mkSite("SITE-A-P5", "Site A P5");
    siteBId = await mkSite("SITE-B-P5", "Site B P5");
    siteCId = await mkSite("SITE-C-P5", "Site C P5");
    projectId = (
      await post("/projects", adminToken, {
        customerId: customer.json().id,
        code: "PRJ-P5",
        name: "Project P5",
      })
    ).json().id;

    await post("/config/numbering/asset", adminToken, { pattern: "AST-{SEQ:5}" });
    await post("/config/numbering/employee_number", adminToken, { pattern: "EMP-P5-{SEQ:5}" });
    aliceId = (await post("/employees", adminToken, { fullName: "Alice Custodian" })).json().id;
    bobId = (await post("/employees", adminToken, { fullName: "Bob Custodian" })).json().id;

    await createReadOnlyRole(tenantId, "ASSET_ADMIN_P5", [
      "asset.read",
      "asset.manage",
      "asset.move",
      "workforce.read",
    ]);
    await createReadOnlyRole(tenantId, "ASSET_MOVER_P5", ["asset.read", "asset.move"]);
    await createReadOnlyRole(tenantId, "ASSET_READER_P5", ["asset.read"]);
    await createReadOnlyRole(tenantId, "ASSET_DOCS_P5", [
      "asset.read",
      "asset.documents.read",
      "document.read",
      "document.manage",
    ]);

    const mkUser = (email: string, roleCode: string, scope: Record<string, unknown> = { scopeType: "tenant" }) =>
      post("/users", adminToken, { email, fullName: email, password: "Passw0rd12345!", roleCode, ...scope });
    await mkUser("assets@p5.local", "ASSET_ADMIN_P5");
    await mkUser("mover@p5.local", "ASSET_MOVER_P5");
    await mkUser("reader@p5.local", "ASSET_READER_P5");
    await mkUser("docs@p5.local", "ASSET_DOCS_P5");
    await mkUser("scoped@p5.local", "ASSET_ADMIN_P5", {
      scopeType: "organization_unit",
      scopeOrganizationUnitId: unitNorthId,
    });

    const tok = async (email: string) => (await login(app, TENANT, email, "Passw0rd12345!")).body.accessToken;
    assetAdminToken = await tok("assets@p5.local");
    moverToken = await tok("mover@p5.local");
    readerToken = await tok("reader@p5.local");
    docReaderToken = await tok("docs@p5.local");
    scopedToken = await tok("scoped@p5.local");

    // Second tenant: cross-tenant isolation AND the optional approval
    // lifecycle, so both "no approval configured" and "approval configured"
    // postures are exercised in one suite.
    const ot = await bootstrapTenant(app, OTHER, "Tenant P5 Other");
    await provisionFirstAdmin({ tenantId: ot.id, email: "admin@p5other.local", password: "Admin12345!" });
    otherAdminToken = (await login(app, OTHER, "admin@p5other.local", "Admin12345!")).body.accessToken;
    await post("/config/numbering/asset", otherAdminToken, { pattern: "AST-O-{SEQ:5}" });
    await post("/config/numbering/employee_number", otherAdminToken, { pattern: "EMP-O-{SEQ:5}" });

    const otherLegal = await post("/legal-entities", otherAdminToken, { code: "LE-O", name: "Other LE" });
    await post("/organization-units", otherAdminToken, {
      legalEntityId: otherLegal.json().id,
      code: "O-UNIT",
      name: "Other Unit",
    });
    const otherCustomer = await post("/customers", otherAdminToken, { code: "CUST-O", name: "Other Customer" });
    otherSiteId = (
      await post("/sites", otherAdminToken, {
        customerId: otherCustomer.json().id,
        code: "SITE-O",
        name: "Other Site",
      })
    ).json().id;
    otherEmployeeId = (await post("/employees", otherAdminToken, { fullName: "Other Person" })).json().id;
    otherAssetId = (await createAsset(otherAdminToken, { name: "Other tenant generator" })).asset.id;

    await buildMovementWorkflow(otherAdminToken);
  });

  afterAll(async () => {
    await app.close();
    await pool.end();
  });

  // --- AST-CORE-001/002: register + identity ----------------------------

  it("AST-CORE-001/002: registers an asset with a generated number, an optional tag, and acquisition data", async () => {
    const view = await createAsset(assetAdminToken, {
      name: "Compressor 40kW",
      assetTag: "TAG-C40",
      description: "Screw compressor",
      category: "machinery",
      organizationUnitId: unitNorthId,
      siteId: siteAId,
      projectId,
      locationDetail: "Utility room",
      custodianEmployeeId: aliceId,
      acquisitionReference: "PO-2026-0001",
      acquiredAt: "2026-02-01",
    });

    expect(view.asset.assetNumber).toMatch(/^AST-\d{5}$/);
    expect(view.asset.assetTag).toBe("TAG-C40");
    expect(view.asset.status).toBe("in_use");
    expect(view.asset.version).toBe(0);
    expect(view.asset.siteId).toBe(siteAId);
    expect(view.asset.locationDetail).toBe("Utility room");
    // Calendar date must not drift a day across the timezone boundary.
    expect(view.asset.acquiredAt).toBe("2026-02-01");
    expect(view.asset.acquisitionReference).toBe("PO-2026-0001");
    // Custodian is a reference, never a copy of workforce data.
    expect(view.custodian).toMatchObject({ id: aliceId, fullName: "Alice Custodian" });
    expect(view.custodian).not.toHaveProperty("email");
    expect(view.movements).toEqual([]);
  });

  it("AST-CORE-001: a physical tag is unique per tenant, and a blank tag is simply absent", async () => {
    await createAsset(assetAdminToken, { name: "Tagged one", assetTag: "TAG-UNIQUE" });

    const duplicate = await post("/assets", assetAdminToken, { name: "Tagged two", assetTag: "TAG-UNIQUE" });
    expect(duplicate.statusCode).toBe(409);

    const blank = await createAsset(assetAdminToken, { name: "Untagged", assetTag: "   " });
    expect(blank.asset.assetTag).toBeNull();

    // The same tag in ANOTHER tenant is a different asset entirely.
    const elsewhere = await post("/assets", otherAdminToken, { name: "Their tagged one", assetTag: "TAG-UNIQUE" });
    expect(elsewhere.statusCode).toBe(201);
  });

  it("AST-CORE-002: descriptive fields update in place; placement never does", async () => {
    const view = await createAsset(assetAdminToken, { name: "Forklift", siteId: siteAId });

    const updated = await patch(`/assets/${view.asset.id}`, assetAdminToken, {
      name: "Forklift 2.5t",
      category: "vehicle",
      assetTag: "TAG-FORK",
      acquisitionReference: "Donation 2026",
    });
    expect(updated.statusCode).toBe(200);
    expect(updated.json().asset.name).toBe("Forklift 2.5t");
    expect(updated.json().asset.category).toBe("vehicle");

    // Attempting to smuggle a location change through the master update is
    // ignored, and the asset never gains a history-free move.
    await patch(`/assets/${view.asset.id}`, assetAdminToken, { siteId: siteBId });
    const after = await detail(assetAdminToken, view.asset.id);
    expect(after.asset.siteId).toBe(siteAId);
    expect(after.asset.version).toBe(0);
    expect(after.movements).toEqual([]);
  });

  // --- AST-CORE-003/004/006: movement + history -------------------------

  it("AST-CORE-003/004/006: movement updates current state and writes an unbroken history chain", async () => {
    const view = await createAsset(assetAdminToken, {
      name: "Survey drone",
      organizationUnitId: unitNorthId,
      siteId: siteAId,
      custodianEmployeeId: aliceId,
    });
    const id = view.asset.id;

    const toB = await post(`/assets/${id}/movements`, moverToken, {
      siteId: siteBId,
      reason: "Deployed to Site B",
      effectiveDate: "2026-03-01",
    });
    expect(toB.statusCode).toBe(201);

    const toC = await post(`/assets/${id}/movements`, moverToken, {
      siteId: siteCId,
      custodianEmployeeId: bobId,
      reason: "Handed over to Bob at Site C",
    });
    expect(toC.statusCode).toBe(201);

    const after = await detail(assetAdminToken, id);
    expect(after.asset.siteId).toBe(siteCId);
    expect(after.asset.custodianEmployeeId).toBe(bobId);
    expect(after.asset.version).toBe(2);
    expect(after.custodian.fullName).toBe("Bob Custodian");

    const [first, second] = after.movements;
    expect(after.movements).toHaveLength(2);
    expect(first.sequence).toBe(1);
    expect(first.fromSiteId).toBe(siteAId);
    expect(first.toSiteId).toBe(siteBId);
    expect(first.effectiveDate).toBe("2026-03-01");
    expect(first.reason).toBe("Deployed to Site B");
    expect(first.appliedAt).not.toBeNull();
    expect(first.requestedByUserId).toBeTruthy();

    expect(second.sequence).toBe(2);
    // The chain is unbroken: B is where the previous movement left it.
    expect(second.fromSiteId).toBe(first.toSiteId);
    expect(second.toSiteId).toBe(siteCId);
    expect(second.fromCustodianEmployeeId).toBe(aliceId);
    expect(second.toCustodianEmployeeId).toBe(bobId);
    // Current state agrees with the latest movement.
    expect(after.asset.siteId).toBe(second.toSiteId);
    expect(after.asset.version).toBe(second.sequence);
  });

  it("AST-CORE-006: a movement that fails validation writes nothing at all", async () => {
    const view = await createAsset(assetAdminToken, { name: "Untouched analyser", siteId: siteAId });
    const id = view.asset.id;

    // Another tenant's site is not a valid destination.
    const crossTenant = await post(`/assets/${id}/movements`, moverToken, { siteId: otherSiteId });
    expect(crossTenant.statusCode).toBe(404);

    // Nor is another tenant's employee a valid custodian.
    const crossCustodian = await post(`/assets/${id}/movements`, moverToken, {
      custodianEmployeeId: otherEmployeeId,
    });
    expect(crossCustodian.statusCode).toBe(404);

    // A movement that changes nothing is not a movement.
    const empty = await post(`/assets/${id}/movements`, moverToken, { reason: "no-op" });
    expect(empty.statusCode).toBe(400);

    const after = await detail(assetAdminToken, id);
    expect(after.asset.siteId).toBe(siteAId);
    expect(after.asset.version).toBe(0);
    expect(after.movements).toEqual([]);
  });

  it("AST-CORE-006: concurrent transfers keep history and current state consistent — no lost update", async () => {
    const view = await createAsset(assetAdminToken, { name: "Contested crane", siteId: siteAId });
    const id = view.asset.id;

    // Six genuinely parallel transfers against one asset.
    const targets = [siteBId, siteCId, siteAId, siteBId, siteCId, siteAId];
    const results = await Promise.all(
      targets.map((siteId, i) =>
        post(`/assets/${id}/movements`, moverToken, { siteId, reason: `race ${i}` }),
      ),
    );
    expect(results.filter((r) => r.statusCode === 201)).toHaveLength(6);

    const after = await detail(assetAdminToken, id);
    expect(after.movements).toHaveLength(6);
    // Every transfer took effect exactly once — nothing was lost, nothing
    // was applied twice.
    expect(after.asset.version).toBe(6);
    expect(after.movements.map((m: { sequence: number }) => m.sequence)).toEqual([1, 2, 3, 4, 5, 6]);

    // The chain is unbroken from the original location to the current one.
    let expectedFrom = siteAId;
    for (const movement of after.movements) {
      expect(movement.fromSiteId).toBe(expectedFrom);
      expect(movement.appliedAt).not.toBeNull();
      expectedFrom = movement.toSiteId;
    }
    // Current state is exactly what the last applied movement says.
    expect(after.asset.siteId).toBe(after.movements[5].toSiteId);
  });

  // --- AST-CORE-005: status + retirement --------------------------------

  it("AST-CORE-005: a status change is recorded in the same ledger as a transfer", async () => {
    const view = await createAsset(assetAdminToken, { name: "Standby pump", siteId: siteAId });
    const id = view.asset.id;

    const idle = await post(`/assets/${id}/status`, moverToken, { status: "idle", reason: "Season ended" });
    expect(idle.statusCode).toBe(200);

    const after = await detail(assetAdminToken, id);
    expect(after.asset.status).toBe("idle");
    expect(after.movements).toHaveLength(1);
    expect(after.movements[0]).toMatchObject({
      movementType: "status_change",
      fromStatus: "in_use",
      toStatus: "idle",
      sequence: 1,
    });
    // A status change does not silently relocate the asset.
    expect(after.movements[0].fromSiteId).toBe(siteAId);
    expect(after.movements[0].toSiteId).toBe(siteAId);

    // Maintenance conditions are not Core status values.
    const maintenance = await post(`/assets/${id}/status`, moverToken, { status: "under_repair" });
    expect(maintenance.statusCode).toBe(400);
    // Retirement has its own deliberate, high-impact action.
    const sneaky = await post(`/assets/${id}/status`, moverToken, { status: "disposed" });
    expect(sneaky.statusCode).toBe(400);
  });

  it("AST-CORE-005/006: a retired asset stays readable with its history, and stops moving", async () => {
    const view = await createAsset(assetAdminToken, { name: "Old chiller", siteId: siteAId });
    const id = view.asset.id;
    await post(`/assets/${id}/movements`, moverToken, { siteId: siteBId, reason: "Relocated before retirement" });

    const retired = await post(`/assets/${id}/retirement`, moverToken, { reason: "End of life" });
    expect(retired.statusCode).toBe(200);
    expect(retired.json().asset.status).toBe("retired");
    expect(retired.json().asset.retiredAt).not.toBeNull();

    // Still fully readable, history intact.
    const after = await detail(assetAdminToken, id);
    expect(after.asset.status).toBe("retired");
    expect(after.movements).toHaveLength(2);
    expect(after.movements[1]).toMatchObject({ toStatus: "retired", movementType: "status_change" });
    expect(after.movements[0].toSiteId).toBe(siteBId);

    // …but it never moves again.
    expect((await post(`/assets/${id}/movements`, moverToken, { siteId: siteCId })).statusCode).toBe(409);
    expect((await post(`/assets/${id}/status`, moverToken, { status: "idle" })).statusCode).toBe(409);
    expect((await post(`/assets/${id}/retirement`, moverToken, { status: "disposed" })).statusCode).toBe(409);

    // There is no delete endpoint — a retired asset is never destroyed.
    const deleted = await app.inject({
      method: "DELETE",
      url: `/assets/${id}`,
      headers: authHeader(assetAdminToken),
    });
    expect(deleted.statusCode).toBe(404);

    // A retired asset drops out of the default working list but is
    // retrievable on request.
    const defaultList = await get("/assets", assetAdminToken);
    expect(defaultList.json().assets.map((a: { id: string }) => a.id)).not.toContain(id);
    const withTerminal = await get("/assets?includeTerminal=true", assetAdminToken);
    expect(withTerminal.json().assets.map((a: { id: string }) => a.id)).toContain(id);
  });

  // --- AST-CORE-007: optional approval lifecycle ------------------------

  it("AST-CORE-007: where the client configures approval, a movement only takes effect once approved", async () => {
    const view = await createAsset(otherAdminToken, { name: "Approved excavator", siteId: otherSiteId });
    const id = view.asset.id;

    const requested = await post(`/assets/${id}/movements`, otherAdminToken, {
      custodianEmployeeId: otherEmployeeId,
      reason: "Assigned to site lead",
    });
    expect(requested.statusCode).toBe(201);

    // Nothing has moved yet: the movement is waiting on the lifecycle.
    const pendingView = requested.json();
    expect(pendingView.asset.custodianEmployeeId).toBeNull();
    expect(pendingView.asset.version).toBe(0);
    expect(pendingView.pendingMovement).not.toBeNull();
    expect(pendingView.pendingMovement.status.instanceStatus).toBe("in_progress");
    expect(pendingView.movements[0].appliedAt).toBeNull();
    expect(pendingView.movements[0].sequence).toBeNull();

    // A second request while one is open is refused.
    const second = await post(`/assets/${id}/movements`, otherAdminToken, { siteId: otherSiteId });
    expect(second.statusCode).toBe(409);

    const movementId = pendingView.pendingMovement.movement.id;
    const approved = await post(`/asset-movements/${movementId}/actions/approve`, otherAdminToken, {});
    expect(approved.statusCode).toBe(200);

    const after = approved.json();
    expect(after.asset.custodianEmployeeId).toBe(otherEmployeeId);
    expect(after.asset.version).toBe(1);
    expect(after.pendingMovement).toBeNull();
    expect(after.movements[0]).toMatchObject({ sequence: 1, toCustodianEmployeeId: otherEmployeeId });
    expect(after.movements[0].appliedAt).not.toBeNull();
    // Approving twice cannot apply it twice.
    expect((await post(`/asset-movements/${movementId}/actions/approve`, otherAdminToken, {})).statusCode).toBe(409);
  });

  it("AST-CORE-007: a rejected movement leaves the asset exactly as it was", async () => {
    const view = await createAsset(otherAdminToken, { name: "Rejected loader" });
    const id = view.asset.id;

    const requested = await post(`/assets/${id}/movements`, otherAdminToken, {
      siteId: otherSiteId,
      reason: "Requested relocation",
    });
    const movementId = requested.json().pendingMovement.movement.id;

    const rejected = await post(`/asset-movements/${movementId}/actions/reject`, otherAdminToken, {
      comment: "Not this quarter",
    });
    expect(rejected.statusCode).toBe(200);

    const after = rejected.json();
    expect(after.asset.siteId).toBeNull();
    expect(after.asset.version).toBe(0);
    expect(after.pendingMovement).toBeNull();
    expect(after.movements[0].appliedAt).toBeNull();
    expect(after.movements[0].sequence).toBeNull();

    // …and a rejected request does not block the next one.
    const retry = await post(`/assets/${id}/movements`, otherAdminToken, { siteId: otherSiteId });
    expect(retry.statusCode).toBe(201);
  });

  // --- AST-CORE-009: authorization, scope, isolation ---------------------

  it("AST-CORE-009: every mutation needs its own capability", async () => {
    const view = await createAsset(assetAdminToken, { name: "Guarded lathe", siteId: siteAId });
    const id = view.asset.id;

    expect((await post("/assets", readerToken, { name: "Sneaky" })).statusCode).toBe(403);
    expect((await patch(`/assets/${id}`, readerToken, { name: "Hacked" })).statusCode).toBe(403);
    expect((await post(`/assets/${id}/movements`, readerToken, { siteId: siteBId })).statusCode).toBe(403);
    expect((await post(`/assets/${id}/status`, readerToken, { status: "idle" })).statusCode).toBe(403);
    expect((await post(`/assets/${id}/retirement`, readerToken, {})).statusCode).toBe(403);

    // A mover may move but not re-describe the register.
    expect((await patch(`/assets/${id}`, moverToken, { name: "Renamed" })).statusCode).toBe(403);
    expect((await post(`/assets/${id}/movements`, moverToken, { siteId: siteBId })).statusCode).toBe(201);

    // Reading still works for a plain reader.
    expect((await get(`/assets/${id}`, readerToken)).statusCode).toBe(200);
  });

  it("AST-CORE-009: Data Scope limits what a scoped user sees and where they may move an asset", async () => {
    const north = await createAsset(assetAdminToken, {
      name: "North press",
      organizationUnitId: unitNorthId,
      siteId: siteAId,
    });
    const south = await createAsset(assetAdminToken, {
      name: "South press",
      organizationUnitId: unitSouthId,
      siteId: siteAId,
    });

    const listed = await get("/assets", scopedToken);
    const ids = listed.json().assets.map((a: { id: string }) => a.id);
    expect(ids).toContain(north.asset.id);
    expect(ids).not.toContain(south.asset.id);

    // A direct read of an out-of-scope asset is refused, so its history
    // (previous locations and custodians) never leaks either.
    expect((await get(`/assets/${south.asset.id}`, scopedToken)).statusCode).toBe(403);
    expect((await post(`/assets/${south.asset.id}/movements`, scopedToken, { siteId: siteBId })).statusCode).toBe(403);

    // Moving an in-scope asset OUT to a unit the actor cannot see is refused.
    const outward = await post(`/assets/${north.asset.id}/movements`, scopedToken, {
      organizationUnitId: unitSouthId,
    });
    expect(outward.statusCode).toBe(403);

    // …and nothing was written by that refusal.
    const untouched = await detail(assetAdminToken, north.asset.id);
    expect(untouched.asset.organizationUnitId).toBe(unitNorthId);
    expect(untouched.movements).toEqual([]);

    // Within scope, the same user moves freely.
    expect(
      (await post(`/assets/${north.asset.id}/movements`, scopedToken, { siteId: siteBId })).statusCode,
    ).toBe(201);
  });

  it("Cross-tenant: another tenant's asset is invisible, immutable, and immovable", async () => {
    expect((await get(`/assets/${otherAssetId}`, assetAdminToken)).statusCode).toBe(404);
    expect((await patch(`/assets/${otherAssetId}`, assetAdminToken, { name: "X" })).statusCode).toBe(404);
    expect((await post(`/assets/${otherAssetId}/movements`, assetAdminToken, { siteId: siteAId })).statusCode).toBe(
      404,
    );
    expect((await post(`/assets/${otherAssetId}/status`, assetAdminToken, { status: "idle" })).statusCode).toBe(404);
    expect((await post(`/assets/${otherAssetId}/retirement`, assetAdminToken, {})).statusCode).toBe(404);

    const listed = await get("/assets?includeTerminal=true", assetAdminToken);
    expect(listed.json().assets.map((a: { id: string }) => a.id)).not.toContain(otherAssetId);

    // Cross-tenant references are refused at creation too.
    expect((await post("/assets", assetAdminToken, { name: "X", siteId: otherSiteId })).statusCode).toBe(404);
    expect(
      (await post("/assets", assetAdminToken, { name: "X", custodianEmployeeId: otherEmployeeId })).statusCode,
    ).toBe(404);
  });

  // --- AST-CORE-008: documents ------------------------------------------

  it("AST-CORE-008: asset documents need the dedicated capability and honour the asset's authorization", async () => {
    const view = await createAsset(assetAdminToken, {
      name: "Documented transformer",
      organizationUnitId: unitNorthId,
    });
    const id = view.asset.id;

    const upload = await app.inject({
      method: "POST",
      url: "/documents",
      headers: { ...authHeader(docReaderToken), "content-type": "multipart/form-data; boundary=----p5b" },
      payload: Buffer.from(
        `------p5b\r\nContent-Disposition: form-data; name="entityType"\r\n\r\nasset\r\n` +
          `------p5b\r\nContent-Disposition: form-data; name="entityId"\r\n\r\n${id}\r\n` +
          `------p5b\r\nContent-Disposition: form-data; name="file"; filename="ownership.txt"\r\n` +
          `Content-Type: text/plain\r\n\r\nproof of ownership\r\n------p5b--\r\n`,
      ),
    });
    expect(upload.statusCode).toBe(201);

    const allowed = await get(`/documents?entityType=asset&entityId=${id}`, docReaderToken);
    expect(allowed.statusCode).toBe(200);
    expect(allowed.json().length).toBeGreaterThan(0);

    // asset.read alone is NOT enough to see asset documentation.
    const denied = await get(`/documents?entityType=asset&entityId=${id}`, readerToken);
    expect([403, 404]).toContain(denied.statusCode);

    // …and no other tenant can reach them.
    const crossTenant = await get(`/documents?entityType=asset&entityId=${id}`, otherAdminToken);
    expect([403, 404]).toContain(crossTenant.statusCode);
  });

  // --- AST-CORE-010: usable register surface -----------------------------

  it("AST-CORE-010: the register is searchable and filterable by tag, status, site, and custodian", async () => {
    const searchable = await createAsset(assetAdminToken, {
      name: "Zephyr theodolite",
      assetTag: "TAG-ZEPH",
      category: "instrument",
      siteId: siteCId,
      custodianEmployeeId: aliceId,
    });
    const id = searchable.asset.id;

    const byName = await get("/assets?search=Zephyr", assetAdminToken);
    expect(byName.json().assets.map((a: { id: string }) => a.id)).toContain(id);

    const byTag = await get("/assets?search=TAG-ZEPH", assetAdminToken);
    expect(byTag.json().assets.map((a: { id: string }) => a.id)).toContain(id);

    const byNumber = await get(`/assets?search=${searchable.asset.assetNumber}`, assetAdminToken);
    expect(byNumber.json().assets).toHaveLength(1);

    const byCategory = await get("/assets?category=instrument", assetAdminToken);
    expect(byCategory.json().assets.every((a: { category: string }) => a.category === "instrument")).toBe(true);

    const bySite = await get(`/assets?siteId=${siteCId}`, assetAdminToken);
    expect(bySite.json().assets.map((a: { id: string }) => a.id)).toContain(id);

    const byCustodian = await get(`/assets?custodianEmployeeId=${aliceId}`, assetAdminToken);
    expect(byCustodian.json().assets.map((a: { id: string }) => a.id)).toContain(id);
    // The list resolves custodians in one batch rather than per row.
    expect(byCustodian.json().custodians.map((c: { id: string }) => c.id)).toContain(aliceId);

    const byStatus = await get("/assets?status=in_use", assetAdminToken);
    expect(byStatus.json().assets.every((a: { status: string }) => a.status === "in_use")).toBe(true);
  });

  it("Validation: unknown references and impossible values are rejected before anything is written", async () => {
    const missingUnit = await post("/assets", assetAdminToken, {
      name: "Bad unit",
      organizationUnitId: "00000000-0000-0000-0000-000000000000",
    });
    expect(missingUnit.statusCode).toBe(404);

    const badStatus = await post("/assets", assetAdminToken, { name: "Bad status", status: "broken" });
    expect(badStatus.statusCode).toBe(400);

    const badDate = await post("/assets", assetAdminToken, { name: "Bad date", acquiredAt: "not-a-date" });
    expect(badDate.statusCode).toBe(400);

    const noName = await post("/assets", assetAdminToken, {});
    expect(noName.statusCode).toBe(400);

    const missingAsset = await get("/assets/00000000-0000-0000-0000-000000000000", assetAdminToken);
    expect(missingAsset.statusCode).toBe(404);
  });

  // --- Audit ------------------------------------------------------------

  it("Audit: creation, movement, status change, and retirement are all recorded", async () => {
    const view = await createAsset(assetAdminToken, { name: "Audited genset", siteId: siteAId });
    const id = view.asset.id;
    await post(`/assets/${id}/movements`, moverToken, { siteId: siteBId });
    await post(`/assets/${id}/status`, moverToken, { status: "idle" });
    await post(`/assets/${id}/retirement`, moverToken, { status: "disposed" });

    const actions = (
      await pool.query(`SELECT action FROM audit_log WHERE entity_id = $1 ORDER BY created_at`, [id])
    ).rows.map((r: { action: string }) => r.action);

    expect(actions).toContain("asset.created");
    expect(actions).toContain("asset.moved");
    expect(actions).toContain("asset.status.changed");
    expect(actions).toContain("asset.retired");
  });

  // --- Closure invariant -------------------------------------------------

  it("Invariant: across every asset this suite touched, current state equals the latest applied movement", async () => {
    const violations = await pool.query(
      `WITH latest AS (
         SELECT DISTINCT ON (asset_id) *
           FROM asset_movements
          WHERE applied_at IS NOT NULL
          ORDER BY asset_id, sequence DESC
       )
       SELECT a.asset_number
         FROM assets a
         LEFT JOIN latest m ON m.asset_id = a.id
        WHERE a.tenant_id = $1
          AND (
            -- version must equal the highest applied sequence (0 if none)
            a.version <> COALESCE(m.sequence, 0)
            -- current placement must equal what that movement resolved to
            OR (m.id IS NOT NULL AND (
                 a.organization_unit_id IS DISTINCT FROM m.to_organization_unit_id
              OR a.custodian_employee_id IS DISTINCT FROM m.to_custodian_employee_id
              OR a.project_id IS DISTINCT FROM m.to_project_id
              OR a.site_id IS DISTINCT FROM m.to_site_id
              OR a.location_detail IS DISTINCT FROM m.to_location_detail
              OR a.status IS DISTINCT FROM m.to_status))
            -- terminal status and the retirement stamp move together
            OR (a.status IN ('retired','disposed')) <> (a.retired_at IS NOT NULL)
          )`,
      [tenantId],
    );
    expect(violations.rows).toEqual([]);

    // An unapplied movement never claims a sequence, and an applied one
    // always does — the ledger has no half-written rows.
    const halfWritten = await pool.query(
      `SELECT id FROM asset_movements
        WHERE tenant_id = $1
          AND ((applied_at IS NULL) <> (sequence IS NULL))`,
      [tenantId],
    );
    expect(halfWritten.rows).toEqual([]);
  });
});
