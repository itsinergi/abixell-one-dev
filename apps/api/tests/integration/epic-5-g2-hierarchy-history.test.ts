/**
 * Epic 5 Gelombang 2 (§4.5 steps 10–13) — effective-dated hierarchy history,
 * change requests, publish/reject, and tombstone with the reference check.
 *
 * The properties this suite exists to hold, in the order §4.5 states them:
 *
 *   1. HISTORY IS DATA (principle 7) — a unit's parent link is effective-dated.
 *      The version in force BEFORE a publish keeps answering for the business
 *      dates it covered, and the new version answers from its effective date on.
 *      A single `parent_id` cannot do that, which is why the read is asserted
 *      against `organization_unit_parent_at`, not against the current row.
 *   2. PROPOSAL IS NOT PUBLISH (principle 12) — an Admin Tenant may propose and
 *      may NOT publish. The refusal is a real 403 from the same-assignment check,
 *      not a hidden button.
 *   3. BACKDATE IS RECORDED, NOT HIDDEN (principle 8) — a backdated publish
 *      keeps `effectiveFrom` and `publishedAt` apart and flags the difference in
 *      the audit row; an unbounded backdate is refused.
 *   4. STRUCTURE LIMITS (Putaran 6 / principle 7) — a cycle, an overlap in the
 *      effective range, and a parent from another Legal Entity are all refused.
 *   5. TOMBSTONE DOES NOT BREAK HISTORY (principle 10) — a tombstoned unit keeps
 *      its minimum identity, and the rows that referenced it still read,
 *      together with why and when it went.
 *
 * Everything runs against the isolated Epic 5 G2 database; the runner asserts
 * `SELECT current_database()` before the suite. No row of another Tenant is
 * touched, read or deleted: every write hangs off a Tenant this file creates, and
 * the teardown exercises the referential delete the wave was responsible for
 * (2026-09-29 carry-forwards (1) and (2)).
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../../src/app.js";
import { pool } from "../../src/infrastructure/persistence/db.js";
import {
  activateAllModules,
  authHeader,
  bootstrapTenant,
  createInternalUser,
  createReadOnlyRole,
  provisionFirstAdmin,
  sessionTokenFor,
} from "./helpers.js";

const stamp = `${Date.now().toString(36)}${randomUUID().replaceAll("-", "").slice(0, 6)}`;
const TENANT = `e5g2-${stamp}`;
const OTHER_TENANT = `e5g2o-${stamp}`;
const PASSWORD = "Passw0rd12345!";

const app = buildApp();

let tenantId: string;
let otherTenantId: string;
let adminToken: string;
let proposerToken: string;

const ISO = (date: Date) => date.toISOString();
const hoursFromNow = (hours: number) => new Date(Date.now() + hours * 60 * 60 * 1000);
const daysFromNow = (days: number) => new Date(Date.now() + days * 24 * 60 * 60 * 1000);

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

async function createLegalEntity(token = adminToken, overrides: Record<string, unknown> = {}) {
  const result = await call("POST", "/legal-entities", {
    token,
    payload: { name: `LE ${stamp} ${randomUUID().slice(0, 4)}`, baseCurrency: "IDR", ...overrides },
  });
  expect(result.status, JSON.stringify(result.body)).toBe(201);
  return result.body as { id: string; tenantId: string; status: string };
}

async function createUnit(
  legalEntityId: string,
  payload: Record<string, unknown> = {},
): Promise<{ id: string; parentId: string | null; status: string; unitType: string }> {
  const result = await call("POST", "/organization-units", {
    payload: {
      legalEntityId,
      name: `Unit ${randomUUID().slice(0, 6)}`,
      unitType: "Region",
      ...payload,
    },
  });
  expect(result.status, JSON.stringify(result.body)).toBe(201);
  return result.body as { id: string; parentId: string | null; status: string; unitType: string };
}

async function propose(
  unitId: string,
  payload: Record<string, unknown>,
  token = adminToken,
) {
  return call("POST", `/organization-units/${unitId}/change-requests`, { token, payload });
}

async function publish(requestId: string, token = adminToken) {
  return call("POST", `/organization-unit-change-requests/${requestId}/publish`, { token });
}

async function rootCentralOf(legalEntityId: string): Promise<string> {
  const result = await pool.query(
    `SELECT id FROM organization_units
      WHERE legal_entity_id = $1 AND parent_id IS NULL AND unit_type = 'Central' AND deleted_at IS NULL`,
    [legalEntityId],
  );
  expect(result.rows.length, "exactly one root Central").toBe(1);
  return result.rows[0].id as string;
}

async function auditRows(entityId: string, action: string) {
  const result = await pool.query(
    `SELECT actor_user_id, metadata FROM audit_log
      WHERE entity_id = $1 AND action = $2 ORDER BY created_at DESC`,
    [entityId, action],
  );
  return result.rows as { actor_user_id: string; metadata: Record<string, unknown> }[];
}

beforeAll(async () => {
  const tenant = await bootstrapTenant(app, TENANT, "Epic 5 G2 Hierarchy History");
  tenantId = tenant.id;
  await activateAllModules(tenantId);
  const admin = await provisionFirstAdmin({
    tenantId,
    email: `admin-${stamp}@e5g2.test`,
    password: PASSWORD,
  });
  adminToken = await sessionTokenFor({ userId: admin.userId, tenantId });

  // A second Tenant proves "same Tenant" as a claim: the same requests replayed
  // with a foreign Tenant's Legal Entity must not reach this Tenant's rows.
  const other = await bootstrapTenant(app, OTHER_TENANT, "Epic 5 G2 Other Tenant");
  otherTenantId = other.id;
  await activateAllModules(otherTenantId);

  // A proposer role: proposes and reads, cannot review. This is the Admin Tenant
  // shape §4.5 principle 12 describes, expressed as the permission split the
  // migration seeds.
  const proposerRoleCode = `PROPOSER-${stamp}`.toUpperCase();
  await createReadOnlyRole(tenantId, proposerRoleCode, [
    "organization_unit.read",
    "organization_unit.create",
    "organization_unit.update",
    "organization_unit.change_request.create",
  ]);
  const proposer = await createInternalUser(app, adminToken, {
    email: `proposer-${stamp}@e5g2.test`,
    fullName: "Structure Proposer",
    password: PASSWORD,
    roleCode: proposerRoleCode,
    scopeType: "tenant",
  });
  proposerToken = await sessionTokenFor({ userId: proposer.user.id, tenantId });
}, 90_000);

afterAll(async () => {
  // Teardown is the referential delete Wave 2 was responsible for: the Tenant
  // owns a Legal Entity, addresses, Organization Units, their history rows and
  // their change requests. The address FK is now REFUSING (deferrable NO ACTION)
  // rather than CASCADE, and the root Central's DELETE guard no longer exempts
  // every cascade — it allows exactly the cascade whose owner has gone. If either
  // replacement were wrong, this line is where it would show.
  await pool.query(`DELETE FROM tenants WHERE id = ANY($1::uuid[])`, [[tenantId, otherTenantId]]);
  await app.close();
});

describe("Epic 5 G2 — effective-dated hierarchy history", () => {
  it("snapshots every existing unit into one open range, so the projection matches parent_id", async () => {
    const legalEntity = await createLegalEntity();
    const central = await rootCentralOf(legalEntity.id);
    const region = await createUnit(legalEntity.id, { parentId: central, unitType: "Region" });

    const history = await call("GET", `/organization-units/${region.id}/hierarchy`);
    expect(history.status, JSON.stringify(history.body)).toBe(200);
    const rows = history.body as unknown as {
      parentOrganizationUnitId: string | null;
      effectiveTo: string | null;
      reason: string;
    }[];
    expect(rows).toHaveLength(1);
    expect(rows[0].parentOrganizationUnitId).toBe(central);
    expect(rows[0].effectiveTo).toBeNull();

    // The projection and the unit row agree: the snapshot did not move anything.
    const parents = await pool.query(
      `SELECT ou.parent_id,
              (SELECT parent_id FROM organization_unit_current_hierarchy h
                WHERE h.organization_unit_id = ou.id) AS projected
         FROM organization_units ou WHERE ou.id = $1`,
      [region.id],
    );
    expect(parents.rows[0].projected).toBe(parents.rows[0].parent_id);
  });

  it("a future-dated publish re-parents from its effective date on, and keeps answering before it", async () => {
    const legalEntity = await createLegalEntity();
    const central = await rootCentralOf(legalEntity.id);
    const regionA = await createUnit(legalEntity.id, { parentId: central, unitType: "Region" });
    const regionB = await createUnit(legalEntity.id, { parentId: central, unitType: "Region" });
    const site = await createUnit(legalEntity.id, { parentId: regionA.id, unitType: "Internal Site" });

    const effectiveFrom = hoursFromNow(6);
    const proposed = await propose(site.id, {
      requestedAction: "move",
      proposedParentOrganizationUnitId: regionB.id,
      requestedEffectiveFrom: ISO(effectiveFrom),
      reason: "Reorganisation: the site reports to Region B from the effective date",
      submitForReview: true,
    });
    expect(proposed.status, JSON.stringify(proposed.body)).toBe(201);
    expect(proposed.body.status).toBe("pending_review");

    const published = await publish(proposed.body.id as string);
    expect(published.status, JSON.stringify(published.body)).toBe(200);
    expect(published.body.backdated).toBe(false);

    // Before the effective date the structure still reads as it was.
    const before = await pool.query(`SELECT organization_unit_parent_at($1, $2) AS parent`, [
      site.id,
      new Date(effectiveFrom.getTime() - 60_000),
    ]);
    expect(before.rows[0].parent).toBe(regionA.id);

    // From the effective date on it reads as published.
    const after = await pool.query(`SELECT organization_unit_parent_at($1, $2) AS parent`, [
      site.id,
      new Date(effectiveFrom.getTime() + 60_000),
    ]);
    expect(after.rows[0].parent).toBe(regionB.id);

    // And the current projection (the `parent_id` column) is the new version.
    const unit = await pool.query(`SELECT parent_id FROM organization_units WHERE id = $1`, [site.id]);
    expect(unit.rows[0].parent_id).toBe(regionB.id);

    // Two ranges, no overlap, exactly one open.
    const ranges = await pool.query(
      `SELECT effective_from, effective_to FROM organization_unit_hierarchy_history
        WHERE organization_unit_id = $1 ORDER BY effective_from`,
      [site.id],
    );
    expect(ranges.rows).toHaveLength(2);
    expect(ranges.rows.filter((r) => r.effective_to === null)).toHaveLength(1);
    expect(new Date(ranges.rows[0].effective_to).getTime()).toBe(effectiveFrom.getTime());
  });

  it("records publish and backdate audits with both dates, the reason and before/after", async () => {
    const legalEntity = await createLegalEntity();
    const central = await rootCentralOf(legalEntity.id);
    const regionA = await createUnit(legalEntity.id, { parentId: central, unitType: "Region" });
    const regionB = await createUnit(legalEntity.id, { parentId: central, unitType: "Region" });

    // Forward-dated publish: recorded as not backdated.
    const forward = await propose(regionA.id, {
      requestedAction: "move",
      proposedParentOrganizationUnitId: regionB.id,
      requestedEffectiveFrom: ISO(hoursFromNow(12)),
      reason: "Forward-dated reorganisation",
      submitForReview: true,
    });
    const forwardPublished = await publish(forward.body.id as string);
    expect(forwardPublished.status, JSON.stringify(forwardPublished.body)).toBe(200);
    expect(forwardPublished.body.backdated).toBe(false);

    const forwardAudit = await auditRows(forward.body.id as string, "organization_unit.change_request.published");
    expect(forwardAudit).toHaveLength(1);
    const forwardMeta = forwardAudit[0].metadata as Record<string, unknown>;
    expect(forwardMeta.effectiveFrom).toBeDefined();
    expect(forwardMeta.publishedAt).toBeDefined();
    expect(forwardMeta.backdated).toBe(false);
    expect(forwardMeta.reason).toBe("Forward-dated reorganisation");
    expect(forwardMeta.before).toMatchObject({ parentId: central });
    expect(forwardMeta.after).toMatchObject({ parentId: regionB.id });
    // §4.5 principle 8: the business date is NOT the recording date.
    expect(new Date(String(forwardMeta.effectiveFrom)).getTime()).toBeGreaterThan(
      new Date(String(forwardMeta.publishedAt)).getTime(),
    );

    // Backdated publish: both dates kept, difference flagged. Two fresh units,
    // because the forward publish above already moved Region A under Region B in
    // the current projection — the projection carries the latest PUBLISHED
    // version, so moving it back would be a cycle.
    const regionC = await createUnit(legalEntity.id, { parentId: central, unitType: "Region" });
    const regionD = await createUnit(legalEntity.id, { parentId: central, unitType: "Region" });
    const backdatedAt = daysFromNow(-5);
    const backdated = await propose(regionC.id, {
      requestedAction: "move",
      proposedParentOrganizationUnitId: regionD.id,
      requestedEffectiveFrom: ISO(backdatedAt),
      reason: "Late correction of the Q3 structure",
      submitForReview: true,
    });
    const backdatedPublished = await publish(backdated.body.id as string);
    expect(backdatedPublished.status, JSON.stringify(backdatedPublished.body)).toBe(200);
    expect(backdatedPublished.body.backdated).toBe(true);

    const backdatedAudit = await auditRows(
      backdated.body.id as string,
      "organization_unit.change_request.published",
    );
    const backdatedMeta = backdatedAudit[0].metadata as Record<string, unknown>;
    expect(backdatedMeta.backdated).toBe(true);
    expect(new Date(String(backdatedMeta.effectiveFrom)).getTime()).toBeLessThan(
      new Date(String(backdatedMeta.publishedAt)).getTime(),
    );
    // The business date survived the recording: the history row carries it.
    const history = await call("GET", `/organization-units/${regionC.id}/hierarchy`);
    const rows = history.body as unknown as { effectiveFrom: string; parentOrganizationUnitId: string | null }[];
    expect(rows.some((row) => row.effectiveFrom === ISO(backdatedAt))).toBe(true);

    // §4.5 G: the correction is recorded against the period it names, and the
    // structure in force TODAY is not rewritten by it.
    expect(backdatedMeta.appliedToCurrentProjection).toBe(false);
    const projection = await pool.query(`SELECT parent_id FROM organization_units WHERE id = $1`, [
      regionC.id,
    ]);
    expect(projection.rows[0].parent_id).toBe(central);
  });

  it("refuses a backdate beyond the policy window", async () => {
    const legalEntity = await createLegalEntity();
    const central = await rootCentralOf(legalEntity.id);
    const regionA = await createUnit(legalEntity.id, { parentId: central, unitType: "Region" });
    const regionB = await createUnit(legalEntity.id, { parentId: central, unitType: "Region" });

    const refused = await propose(regionA.id, {
      requestedAction: "move",
      proposedParentOrganizationUnitId: regionB.id,
      requestedEffectiveFrom: ISO(daysFromNow(-120)),
      reason: "Too old to be accepted",
      submitForReview: true,
    });
    expect(refused.status, JSON.stringify(refused.body)).toBe(409);
    expect(String(refused.body.error)).toContain("Backdated hierarchy changes are limited to");
  });
});

describe("Epic 5 G2 — structure limits and the proposal/publish split", () => {
  it("refuses a cycle: a unit may not be moved under its own descendant", async () => {
    const legalEntity = await createLegalEntity();
    const central = await rootCentralOf(legalEntity.id);
    const region = await createUnit(legalEntity.id, { parentId: central, unitType: "Region" });
    const site = await createUnit(legalEntity.id, { parentId: region.id, unitType: "Internal Site" });

    const proposed = await propose(region.id, {
      requestedAction: "move",
      proposedParentOrganizationUnitId: site.id,
      requestedEffectiveFrom: ISO(hoursFromNow(2)),
      reason: "Would create a cycle",
      submitForReview: true,
    });
    expect(proposed.status, JSON.stringify(proposed.body)).toBe(201);

    const published = await publish(proposed.body.id as string);
    expect(published.status, JSON.stringify(published.body)).toBe(409);
    expect(String(published.body.error)).toContain("cycle");
  });

  it("refuses an effective date that overlaps the range in force", async () => {
    const legalEntity = await createLegalEntity();
    const central = await rootCentralOf(legalEntity.id);
    const regionA = await createUnit(legalEntity.id, { parentId: central, unitType: "Region" });
    const regionB = await createUnit(legalEntity.id, { parentId: central, unitType: "Region" });

    const future = hoursFromNow(10);
    const first = await propose(regionA.id, {
      requestedAction: "move",
      proposedParentOrganizationUnitId: regionB.id,
      requestedEffectiveFrom: ISO(future),
      reason: "First move",
      submitForReview: true,
    });
    expect((await publish(first.body.id as string)).status).toBe(200);

    // A second move dated before the range that is now in force: publishing it
    // would rewrite the version that answers for those dates.
    const overlapping = await propose(regionA.id, {
      requestedAction: "move",
      proposedParentOrganizationUnitId: central,
      requestedEffectiveFrom: ISO(new Date(future.getTime() - 60_000)),
      reason: "Overlaps the range in force",
      submitForReview: true,
    });
    const published = await publish(overlapping.body.id as string);
    expect(published.status, JSON.stringify(published.body)).toBe(409);
    expect(String(published.body.error)).toContain("overlaps this change");
  });

  it("refuses a parent from another Legal Entity", async () => {
    const legalEntity = await createLegalEntity();
    const central = await rootCentralOf(legalEntity.id);
    const region = await createUnit(legalEntity.id, { parentId: central, unitType: "Region" });

    const otherEntity = await createLegalEntity();
    const otherCentral = await rootCentralOf(otherEntity.id);

    const proposed = await propose(region.id, {
      requestedAction: "move",
      proposedParentOrganizationUnitId: otherCentral,
      requestedEffectiveFrom: ISO(hoursFromNow(3)),
      reason: "Cross Legal Entity parent",
      submitForReview: true,
    });
    expect(proposed.status, JSON.stringify(proposed.body)).toBe(403);
    expect(String(proposed.body.error)).toContain("different Legal Entity");
  });

  it("refuses a proposal that targets another Tenant's Organization Unit", async () => {
    const legalEntity = await createLegalEntity();
    const central = await rootCentralOf(legalEntity.id);
    const region = await createUnit(legalEntity.id, { parentId: central, unitType: "Region" });

    const otherEntity = await createLegalEntity();
    const otherCentral = await rootCentralOf(otherEntity.id);

    // The other Tenant's token cannot see this Tenant's unit at all.
    const other = await bootstrapTenant(app, `${OTHER_TENANT}-x`, "Epic 5 G2 Third Tenant");
    await activateAllModules(other.id);
    const foreignAdmin = await provisionFirstAdmin({
      tenantId: other.id,
      email: `admin-${stamp}@e5g2-foreign.test`,
      password: PASSWORD,
    });
    const foreignToken = await sessionTokenFor({ userId: foreignAdmin.userId, tenantId: other.id });

    const attempted = await propose(region.id, {
      requestedAction: "move",
      proposedParentOrganizationUnitId: otherCentral,
      requestedEffectiveFrom: ISO(hoursFromNow(3)),
      reason: "Cross Tenant",
      submitForReview: true,
    }, foreignToken);
    expect(attempted.status).toBe(404);

    await pool.query(`DELETE FROM tenants WHERE id = $1`, [other.id]);
  });

  it("refuses publishing to a proposer who holds no review permission (§4.5 principle 12)", async () => {
    const legalEntity = await createLegalEntity();
    const central = await rootCentralOf(legalEntity.id);
    const regionA = await createUnit(legalEntity.id, { parentId: central, unitType: "Region" });
    const regionB = await createUnit(legalEntity.id, { parentId: central, unitType: "Region" });

    const proposed = await propose(regionA.id, {
      requestedAction: "move",
      proposedParentOrganizationUnitId: regionB.id,
      requestedEffectiveFrom: ISO(hoursFromNow(4)),
      reason: "Proposer drafts, reviewer publishes",
      submitForReview: true,
    }, proposerToken);
    expect(proposed.status, JSON.stringify(proposed.body)).toBe(201);

    const refused = await publish(proposed.body.id as string, proposerToken);
    expect(refused.status, JSON.stringify(refused.body)).toBe(403);

    // The reviewer can still publish the same request.
    const published = await publish(proposed.body.id as string);
    expect(published.status, JSON.stringify(published.body)).toBe(200);

    // A rejection needs a reviewer too, and leaves the structure untouched.
    const second = await propose(regionB.id, {
      requestedAction: "move",
      proposedParentOrganizationUnitId: regionA.id,
      requestedEffectiveFrom: ISO(hoursFromNow(5)),
      reason: "To be rejected",
      submitForReview: true,
    }, proposerToken);
    const rejected = await call(
      "POST",
      `/organization-unit-change-requests/${second.body.id as string}/reject`,
      { payload: { reviewReason: "Not aligned with the current plan" } },
    );
    expect(rejected.status, JSON.stringify(rejected.body)).toBe(200);
    expect(rejected.body.status).toBe("rejected");
    expect(rejected.body.reviewReason).toBe("Not aligned with the current plan");
  });
});

describe("Epic 5 G2 — tombstone, replacement and the reference check", () => {
  it("tombstones an inactive unit, reports the reference census, and keeps the historical read intact", async () => {
    const legalEntity = await createLegalEntity();
    const central = await rootCentralOf(legalEntity.id);
    const region = await createUnit(legalEntity.id, { parentId: central, unitType: "Region" });
    const closing = await createUnit(legalEntity.id, { parentId: region.id, unitType: "Internal Site" });
    const replacement = await createUnit(legalEntity.id, { parentId: region.id, unitType: "Internal Site" });

    // A row that references the unit: this is the "transaction" whose readability
    // §4.5 Putaran 4 protects ("transaksi tetap menunjuk unit historis tersebut").
    const session = await pool.query(
      `SELECT id FROM sessions WHERE tenant_id = $1 LIMIT 1`,
      [tenantId],
    );
    const sessionId = session.rows[0].id as string;
    await pool.query(`UPDATE sessions SET organization_unit_id = $1 WHERE id = $2`, [
      closing.id,
      sessionId,
    ]);

    // Putaran 4 fixes the order: inactive first, then the Super Admin deletes.
    const stillActive = await call("POST", `/organization-units/${closing.id}/tombstone`, {
      payload: { reason: "Closed", replacementOrganizationUnitId: replacement.id },
    });
    expect(stillActive.status, JSON.stringify(stillActive.body)).toBe(409);
    expect(String(stillActive.body.error)).toContain("inactive");

    const deactivated = await call("POST", `/organization-units/${closing.id}/status`, {
      payload: { status: "inactive" },
    });
    expect(deactivated.status, JSON.stringify(deactivated.body)).toBe(200);

    const tombstoned = await call("POST", `/organization-units/${closing.id}/tombstone`, {
      payload: {
        reason: "Site closed after the merger",
        replacementOrganizationUnitId: replacement.id,
      },
    });
    expect(tombstoned.status, JSON.stringify(tombstoned.body)).toBe(200);
    expect(tombstoned.body.status).toBe("tombstone");
    expect(tombstoned.body.replacementOrganizationUnitId).toBe(replacement.id);

    // The reference-check registry: the session still points at the unit, so the
    // unit could NOT have been physically deleted (§4.5 principle 6) — and the
    // census is the measurement that says so.
    const references = tombstoned.body.references as { table: string; column: string; count: number }[];
    expect(references).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ table: "sessions", column: "organization_unit_id", count: 1 }),
      ]),
    );
    expect(tombstoned.body.eligibleForPhysicalDelete).toBe(false);

    // Historical read: the referencing row and the unit both still resolve, with
    // the status and the reason that explain why it is gone.
    const readable = await pool.query(
      `SELECT ou.status, ou.tombstoned_at, ou.tombstone_reason, ou.replacement_organization_unit_id,
              s.organization_unit_id IS NOT NULL AS still_referenced
         FROM organization_units ou
         JOIN sessions s ON s.organization_unit_id = ou.id
        WHERE ou.id = $1 AND s.id = $2`,
      [closing.id, sessionId],
    );
    expect(readable.rows).toHaveLength(1);
    expect(readable.rows[0].status).toBe("tombstone");
    expect(readable.rows[0].tombstone_reason).toBe("Site closed after the merger");
    expect(readable.rows[0].tombstoned_at).not.toBeNull();
    expect(readable.rows[0].replacement_organization_unit_id).toBe(replacement.id);
    expect(readable.rows[0].still_referenced).toBe(true);

    // The unit's own history is still readable, and the range that was in force
    // is closed at the tombstone date: the unit has no version in force any more,
    // which is exactly what "it is gone, and here is when" means.
    const history = await call("GET", `/organization-units/${closing.id}/hierarchy`);
    expect(history.status).toBe(200);
    const rows = history.body as unknown as { effectiveTo: string | null }[];
    expect(rows.length).toBeGreaterThanOrEqual(1);
    expect(rows.filter((row) => row.effectiveTo === null)).toHaveLength(0);

    // Cleanup for the next test in this file: the session reference is a fixture,
    // not a claim about the product.
    await pool.query(`UPDATE sessions SET organization_unit_id = NULL WHERE id = $1`, [sessionId]);
  });

  it("refuses to tombstone the root Central", async () => {
    const legalEntity = await createLegalEntity();
    const central = await rootCentralOf(legalEntity.id);

    const deactivated = await call("POST", `/organization-units/${central}/status`, {
      payload: { status: "inactive" },
    });
    // The root Central cannot even be deactivated: it is the structure anchor.
    expect(deactivated.status, JSON.stringify(deactivated.body)).toBe(409);

    const attempted = await call("POST", `/organization-units/${central}/tombstone`, {
      payload: { reason: "Should never happen" },
    });
    expect(attempted.status, JSON.stringify(attempted.body)).toBe(409);
  });

  it("refuses a tombstone proposal that is not backed by an inactive unit at creation time", async () => {
    const legalEntity = await createLegalEntity();
    const central = await rootCentralOf(legalEntity.id);
    const region = await createUnit(legalEntity.id, { parentId: central, unitType: "Region" });
    const site = await createUnit(legalEntity.id, { parentId: region.id, unitType: "Internal Site" });

    const refused = await propose(site.id, {
      requestedAction: "tombstone",
      requestedEffectiveFrom: ISO(hoursFromNow(1)),
      reason: "Delete request while still active",
      submitForReview: true,
    });
    expect(refused.status, JSON.stringify(refused.body)).toBe(409);
    expect(String(refused.body.error)).toContain("inactive");
  });
});
