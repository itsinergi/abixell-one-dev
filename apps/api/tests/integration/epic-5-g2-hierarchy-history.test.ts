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

/**
 * Give a unit the shape EVERY unit that predates this wave has: its recorded
 * history begins later than the unit itself. The parity snapshot in
 * 1789396000000 opened each existing unit's first range at the migration
 * instant, which is long after the unit's own `created_at`, and the window
 * between the two is exactly the period a backdated correction can name.
 * (A unit created AFTER the snapshot has both values at its creation instant, so
 * no such window exists for it — which is why the pre-creation date is a named
 * refusal rather than a range.)
 */
async function makeHistoryStartAfterCreation(
  unitId: string,
  options: { createdDaysAgo: number; rangeStartDaysAgo: number },
) {
  await pool.query(
    `UPDATE organization_units SET created_at = now() - ($2 || ' days')::interval WHERE id = $1`,
    [unitId, String(options.createdDaysAgo)],
  );
  await pool.query(
    `UPDATE organization_unit_hierarchy_history
        SET effective_from = now() - ($2 || ' days')::interval
      WHERE organization_unit_id = $1 AND effective_to IS NULL`,
    [unitId, String(options.rangeStartDaysAgo)],
  );
}

/** The unit's history as `[from, to]` ISO pairs, oldest first. */
async function historyRanges(unitId: string): Promise<{ from: string; to: string | null }[]> {
  const result = await pool.query(
    `SELECT effective_from, effective_to FROM organization_unit_hierarchy_history
      WHERE organization_unit_id = $1 ORDER BY effective_from`,
    [unitId],
  );
  return result.rows.map((row) => ({
    from: new Date(row.effective_from).toISOString(),
    to: row.effective_to === null ? null : new Date(row.effective_to).toISOString(),
  }));
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
    // The state the proposal was in when the reviewer published it.
    expect(forwardMeta.fromStatus).toBe("pending_review");
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
    // The correction names a period BEFORE the version in force, which is the
    // shape a legacy unit has (see `makeHistoryStartAfterCreation`): the unit has
    // existed for a year and its recorded history begins ten days ago.
    await makeHistoryStartAfterCreation(regionC.id, { createdDaysAgo: 365, rangeStartDaysAgo: 10 });
    const backdatedAt = daysFromNow(-20);
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

/**
 * The corrections the wave's first round got wrong, each one a property rather
 * than a shape:
 *
 *   - a backdated version is bounded by the NEXT range after its effective date,
 *     so correcting a past period stays possible once the history has moved on;
 *   - a date before the unit existed is refused BY NAME, never by the EXCLUDE
 *     constraint surfacing as a 500;
 *   - a published request re-checks the unit it targets, so a proposal cannot
 *     outlive its unit's tombstone.
 */
describe("Epic 5 G2 — backdated corrections and the state a request was raised against", () => {
  it("records a backdated correction after the history has moved on, and a second one before it", async () => {
    const legalEntity = await createLegalEntity();
    const central = await rootCentralOf(legalEntity.id);
    const unit = await createUnit(legalEntity.id, { parentId: central, unitType: "Region" });
    const other = await createUnit(legalEntity.id, { parentId: central, unitType: "Region" });

    // Legacy shape: the unit is a year old, its recorded history begins 30 days ago.
    await makeHistoryStartAfterCreation(unit.id, { createdDaysAgo: 365, rangeStartDaysAgo: 30 });
    const rangeStart = (await historyRanges(unit.id))[0].from;

    // 1. A correction dated 60 days back: before the version in force, inside the
    //    90-day window, and after the unit was created. It is recorded as a
    //    CLOSED range ending where the version in force begins, and the current
    //    projection is NOT rewritten.
    const firstAt = daysFromNow(-60);
    const first = await propose(unit.id, {
      requestedAction: "move",
      proposedParentOrganizationUnitId: other.id,
      requestedEffectiveFrom: ISO(firstAt),
      reason: "Late correction of the structure before the recorded history",
      submitForReview: true,
    });
    expect(first.status, JSON.stringify(first.body)).toBe(201);
    const firstPublished = await publish(first.body.id as string);
    expect(firstPublished.status, JSON.stringify(firstPublished.body)).toBe(200);
    expect(firstPublished.body.backdated).toBe(true);
    expect(firstPublished.body.organizationUnit.parentId).toBe(central);

    let ranges = await historyRanges(unit.id);
    expect(ranges).toHaveLength(2);
    expect(ranges[0]).toEqual({ from: ISO(firstAt), to: rangeStart });
    expect(ranges[1]).toEqual({ from: rangeStart, to: null });
    const stillParented = await pool.query(`SELECT parent_id FROM organization_units WHERE id = $1`, [unit.id]);
    expect(stillParented.rows[0].parent_id).toBe(central);

    // 2. A forward-dated publish 10 hours ahead: the version in force is sealed
    //    at its effective date and the projection follows this time.
    const futureAt = hoursFromNow(10);
    const second = await propose(unit.id, {
      requestedAction: "move",
      proposedParentOrganizationUnitId: other.id,
      requestedEffectiveFrom: ISO(futureAt),
      reason: "Reorganisation from the effective date",
      submitForReview: true,
    });
    const secondPublished = await publish(second.body.id as string);
    expect(secondPublished.status, JSON.stringify(secondPublished.body)).toBe(200);
    expect(secondPublished.body.backdated).toBe(false);

    // 3. A SECOND correction, earlier than the first. Bounding a backdated range
    //    by the open range's start (the first round's bug) made this overlap the
    //    sealed [-60d, -30d) range: the exclusion constraint raised 23P01 and the
    //    caller saw 500. The bound is the NEXT range, so the correction is
    //    recorded and the partition stays gapless. 85 days back: inside the
    //    90-day policy window, and still before the version in force.
    const thirdAt = daysFromNow(-85);
    const third = await propose(unit.id, {
      requestedAction: "move",
      proposedParentOrganizationUnitId: other.id,
      requestedEffectiveFrom: ISO(thirdAt),
      reason: "Earlier correction of the same period",
      submitForReview: true,
    });
    expect(third.status, JSON.stringify(third.body)).toBe(201);
    const thirdPublished = await publish(third.body.id as string);
    expect(thirdPublished.status, JSON.stringify(thirdPublished.body)).toBe(200);
    expect(thirdPublished.body.backdated).toBe(true);

    ranges = await historyRanges(unit.id);
    expect(ranges).toHaveLength(4);
    expect(ranges[0]).toEqual({ from: ISO(thirdAt), to: ISO(firstAt) });
    expect(ranges[1]).toEqual({ from: ISO(firstAt), to: rangeStart });
    expect(ranges.filter((row) => row.to === null)).toHaveLength(1);
    // Every range boundary is shared, not doubled: the partition has no gap and
    // no overlap (which the EXCLUDE constraint would have refused anyway).
    for (let i = 1; i < ranges.length; i += 1) {
      expect(ranges[i].from).toBe(ranges[i - 1].to);
    }
  });

  it("refuses a change dated before the Organization Unit existed, by name", async () => {
    const legalEntity = await createLegalEntity();
    const central = await rootCentralOf(legalEntity.id);
    const unit = await createUnit(legalEntity.id, { parentId: central, unitType: "Region" });
    const other = await createUnit(legalEntity.id, { parentId: central, unitType: "Region" });

    // Inside the policy window (90 days) but before the unit was created: there
    // is no structure to record for a period with no unit. A named refusal — the
    // first round let this reach the exclusion constraint and answer 500.
    const proposed = await propose(unit.id, {
      requestedAction: "move",
      proposedParentOrganizationUnitId: other.id,
      requestedEffectiveFrom: ISO(daysFromNow(-20)),
      reason: "Correction dated before the unit existed",
      submitForReview: true,
    });
    expect(proposed.status, JSON.stringify(proposed.body)).toBe(201);

    const published = await publish(proposed.body.id as string);
    expect(published.status, JSON.stringify(published.body)).toBe(409);
    expect(String(published.body.error)).toContain("precedes the Organization Unit's own creation");

    // Nothing was written, and the request did not become terminal: refusing is
    // not publishing.
    expect(await historyRanges(unit.id)).toHaveLength(1);
    const request = await pool.query(`SELECT status FROM organization_unit_change_requests WHERE id = $1`, [
      proposed.body.id,
    ]);
    expect(request.rows[0].status).toBe("pending_review");
  });

  it("refuses publishing a request whose unit was tombstoned while it waited", async () => {
    const legalEntity = await createLegalEntity();
    const central = await rootCentralOf(legalEntity.id);
    const region = await createUnit(legalEntity.id, { parentId: central, unitType: "Region" });
    const site = await createUnit(legalEntity.id, { parentId: region.id, unitType: "Internal Site" });
    const replacement = await createUnit(legalEntity.id, { parentId: region.id, unitType: "Internal Site" });

    const pending = await propose(site.id, {
      requestedAction: "move",
      proposedParentOrganizationUnitId: replacement.id,
      requestedEffectiveFrom: ISO(hoursFromNow(2)),
      reason: "Reorganisation proposed while the site was live",
      submitForReview: true,
    });
    expect(pending.status, JSON.stringify(pending.body)).toBe(201);
    expect(pending.body.status).toBe("pending_review");

    const deactivated = await call("POST", `/organization-units/${site.id}/status`, {
      payload: { status: "inactive" },
    });
    expect(deactivated.status, JSON.stringify(deactivated.body)).toBe(200);
    const tombstoned = await call("POST", `/organization-units/${site.id}/tombstone`, {
      payload: { reason: "Site closed while a change request was open" },
    });
    expect(tombstoned.status, JSON.stringify(tombstoned.body)).toBe(200);

    const published = await publish(pending.body.id as string);
    expect(published.status, JSON.stringify(published.body)).toBe(409);
    expect(String(published.body.error)).toContain("structure changes are no longer accepted");

    // The tombstone survives untouched: the unit has no version in force, and its
    // parent was not moved by a request it outlived.
    const ranges = await historyRanges(site.id);
    expect(ranges.length).toBeGreaterThanOrEqual(1);
    expect(ranges.filter((row) => row.to === null)).toHaveLength(0);
    const unitRow = await pool.query(`SELECT status, parent_id FROM organization_units WHERE id = $1`, [site.id]);
    expect(unitRow.rows[0].status).toBe("tombstone");
    expect(unitRow.rows[0].parent_id).toBe(region.id);
  });

  it("refuses publishing a tombstone request for a unit that is active again", async () => {
    const legalEntity = await createLegalEntity();
    const central = await rootCentralOf(legalEntity.id);
    const region = await createUnit(legalEntity.id, { parentId: central, unitType: "Region" });
    const site = await createUnit(legalEntity.id, { parentId: region.id, unitType: "Internal Site" });

    const deactivated = await call("POST", `/organization-units/${site.id}/status`, {
      payload: { status: "inactive" },
    });
    expect(deactivated.status, JSON.stringify(deactivated.body)).toBe(200);
    const proposed = await propose(site.id, {
      requestedAction: "tombstone",
      requestedEffectiveFrom: ISO(hoursFromNow(1)),
      reason: "Delete requested while inactive",
      submitForReview: true,
    });
    expect(proposed.status, JSON.stringify(proposed.body)).toBe(201);

    // Putaran 4's order is "inactive first, then delete": the unit is active
    // again when the review happens, so the request may not delete it. (Activating
    // a unit needs its owning Legal Entity active — a Gelombang 1 rule, unrelated
    // to this wave.)
    const leActivated = await call("POST", `/legal-entities/${legalEntity.id}/activate`);
    expect(leActivated.status, JSON.stringify(leActivated.body)).toBe(200);
    const reactivated = await call("POST", `/organization-units/${site.id}/status`, {
      payload: { status: "active" },
    });
    expect(reactivated.status, JSON.stringify(reactivated.body)).toBe(200);

    const published = await publish(proposed.body.id as string);
    expect(published.status, JSON.stringify(published.body)).toBe(409);
    expect(String(published.body.error)).toContain("tombstoned from 'inactive'");
    const unitRow = await pool.query(`SELECT status FROM organization_units WHERE id = $1`, [site.id]);
    expect(unitRow.rows[0].status).toBe("active");
  });

  it("publishes a draft, and refuses to publish an already published request", async () => {
    const legalEntity = await createLegalEntity();
    const central = await rootCentralOf(legalEntity.id);
    const regionA = await createUnit(legalEntity.id, { parentId: central, unitType: "Region" });
    const regionB = await createUnit(legalEntity.id, { parentId: central, unitType: "Region" });

    // This wave ships no separate submit route, so the create-time flag IS the
    // submit step and a reviewer may publish a draft directly. What the status
    // set still separates is what can be edited/cancelled (draft,
    // pending_review) from what is terminal (published, rejected).
    const draft = await propose(regionA.id, {
      requestedAction: "move",
      proposedParentOrganizationUnitId: regionB.id,
      requestedEffectiveFrom: ISO(hoursFromNow(4)),
      reason: "Left in draft, published by the reviewer",
    });
    expect(draft.status, JSON.stringify(draft.body)).toBe(201);
    expect(draft.body.status).toBe("draft");

    const published = await publish(draft.body.id as string);
    expect(published.status, JSON.stringify(published.body)).toBe(200);
    expect(published.body.request).toMatchObject({ status: "published" });

    // The rule is stated once, in the domain (PUBLISHABLE_CHANGE_REQUEST_STATUSES);
    // the audit is what keeps a publish that skipped the proposer's signal from
    // being indistinguishable from one that waited for it.
    const draftAudit = await auditRows(
      draft.body.id as string,
      "organization_unit.change_request.published",
    );
    expect(draftAudit).toHaveLength(1);
    expect((draftAudit[0].metadata as Record<string, unknown>).fromStatus).toBe("draft");

    const again = await publish(draft.body.id as string);
    expect(again.status, JSON.stringify(again.body)).toBe(409);
    expect(String(again.body.error)).toContain("can no longer be published");

    const cancelled = await call(
      "POST",
      `/organization-unit-change-requests/${draft.body.id as string}/cancel`,
    );
    expect(cancelled.status, JSON.stringify(cancelled.body)).toBe(409);
  });

  it("refuses a tombstone dated before the version in force, so a tombstone never leaves a range in force", async () => {
    const legalEntity = await createLegalEntity();
    const central = await rootCentralOf(legalEntity.id);
    const unit = await createUnit(legalEntity.id, { parentId: central, unitType: "Region" });

    // The legacy shape again: a year-old unit whose recorded history begins ten
    // days ago, so a business date 60 days back precedes the version in force
    // without being covered by any range (it is inside the 90-day window).
    await makeHistoryStartAfterCreation(unit.id, { createdDaysAgo: 365, rangeStartDaysAgo: 10 });
    const deactivated = await call("POST", `/organization-units/${unit.id}/status`, {
      payload: { status: "inactive" },
    });
    expect(deactivated.status, JSON.stringify(deactivated.body)).toBe(200);

    // Putaran 4's delete has to END the version in force — that is what makes a
    // tombstone different from a deactivation. A business date before that version
    // would say the unit left the structure before it was put there, which no
    // range can express, and closing nothing would leave a tombstoned unit "in
    // force" for every reader. Refused by name; nothing is written.
    const refused = await call("POST", `/organization-units/${unit.id}/tombstone`, {
      payload: {
        reason: "Closed as of a date before the recorded history",
        effectiveFrom: ISO(daysFromNow(-60)),
      },
    });
    expect(refused.status, JSON.stringify(refused.body)).toBe(409);
    expect(String(refused.body.error)).toContain(
      "cannot leave the structure before the version that put it there",
    );

    const untouched = await pool.query(`SELECT status FROM organization_units WHERE id = $1`, [unit.id]);
    expect(untouched.rows[0].status).toBe("inactive");
    expect((await historyRanges(unit.id)).filter((row) => row.to === null)).toHaveLength(1);

    // The ordinary delete still works on the same unit, and it is the version in
    // force that ends: the invariant the suite asserts elsewhere holds here too.
    const tombstoned = await call("POST", `/organization-units/${unit.id}/tombstone`, {
      payload: { reason: "Closed from the recorded history on" },
    });
    expect(tombstoned.status, JSON.stringify(tombstoned.body)).toBe(200);
    expect(tombstoned.body.status).toBe("tombstone");
    expect((await historyRanges(unit.id)).filter((row) => row.to === null)).toHaveLength(0);
  });
});
