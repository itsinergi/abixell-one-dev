import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../../src/app.js";
import { pool } from "../../src/infrastructure/persistence/db.js";
import { bootstrapTenant, provisionFirstAdmin } from "./helpers.js";

/**
 * WP-APR-04 — Business Partner canonical consolidation.
 *
 * The backfill lives entirely in migration
 * `1793000000000_phase4-apr-04-bp-canonical-backfill.cjs`; there is no service
 * method (the plan's `backfillFromLegacy` was folded into the migration SQL).
 * What this test can prove is the invariant that matters: the backfill steps
 * are IDEMPOTENT — re-running the same INSERT..SELECT block creates nothing
 * new, because every step filters on `bp_legacy_links` membership.
 *
 * It reproduces the migration's supplier steps verbatim against a fresh
 * tenant's legacy rows, runs them twice, and asserts the counts are identical
 * after the second pass.
 */

const stamp = `${Date.now().toString(36)}_${process.pid}_${randomUUID().replaceAll("-", "").slice(0, 8)}`;
const TENANT = `p4bp-${stamp}`;

const app = buildApp();

/** The migration's supplier steps, runnable in a test (1: link matched, 2:
 * create remainder, 3: link created, 4: attach vendor role). */
async function runSupplierBackfill(tenantId: string) {
  await pool.query(
    `INSERT INTO bp_legacy_links
       (tenant_id, legacy_table, legacy_id, business_partner_id, created_by_backfill)
     SELECT s.tenant_id, 'suppliers', s.id, b.id, false
     FROM suppliers s
     JOIN business_partners b
       ON b.tenant_id = s.tenant_id AND b.code = s.code AND b.name = s.name
     WHERE s.tenant_id = $1
       AND NOT EXISTS (
         SELECT 1 FROM bp_legacy_links l
         WHERE l.tenant_id = s.tenant_id
           AND l.legacy_table = 'suppliers'
           AND l.legacy_id = s.id
       )`,
    [tenantId],
  );

  await pool.query(
    `INSERT INTO business_partners (tenant_id, code, bp_type, name, lifecycle_status, is_active)
     SELECT s.tenant_id,
            CASE
              WHEN EXISTS (SELECT 1 FROM business_partners b
                           WHERE b.tenant_id = s.tenant_id AND b.code = s.code)
              THEN s.code || '~' || substring(s.id::text, 1, 8)
              ELSE s.code
            END,
            'organization', s.name,
            CASE WHEN s.is_active THEN 'active' ELSE 'inactive' END,
            s.is_active
     FROM suppliers s
     WHERE s.tenant_id = $1
       AND NOT EXISTS (
         SELECT 1 FROM bp_legacy_links l
         WHERE l.tenant_id = s.tenant_id
           AND l.legacy_table = 'suppliers'
           AND l.legacy_id = s.id
       )`,
    [tenantId],
  );

  await pool.query(
    `INSERT INTO bp_legacy_links
       (tenant_id, legacy_table, legacy_id, business_partner_id, created_by_backfill)
     SELECT s.tenant_id, 'suppliers', s.id, b.id, true
     FROM suppliers s
     JOIN business_partners b
       ON b.tenant_id = s.tenant_id
      AND (b.code = s.code OR b.code = s.code || '~' || substring(s.id::text, 1, 8))
      AND b.name = s.name
     WHERE s.tenant_id = $1
       AND NOT EXISTS (
         SELECT 1 FROM bp_legacy_links l
         WHERE l.tenant_id = s.tenant_id
           AND l.legacy_table = 'suppliers'
           AND l.legacy_id = s.id
       )`,
    [tenantId],
  );

  await pool.query(
    `WITH created AS (
       INSERT INTO bp_roles (tenant_id, business_partner_id, role_type)
       SELECT l.tenant_id, l.business_partner_id, 'vendor'
       FROM bp_legacy_links l
       WHERE l.legacy_table = 'suppliers' AND l.tenant_id = $1
       ON CONFLICT DO NOTHING
       RETURNING tenant_id, business_partner_id
     )
     UPDATE bp_legacy_links l
        SET role_created_by_backfill = true
       FROM created c
      WHERE l.legacy_table = 'suppliers'
        AND l.tenant_id = c.tenant_id
        AND l.business_partner_id = c.business_partner_id`,
    [tenantId],
  );
}

async function counts(tenantId: string) {
  const links = await pool.query(
    `SELECT count(*)::int AS n FROM bp_legacy_links
      WHERE tenant_id = $1 AND legacy_table = 'suppliers'`,
    [tenantId],
  );
  const bps = await pool.query(
    `SELECT count(*)::int AS n FROM business_partners WHERE tenant_id = $1`,
    [tenantId],
  );
  const roles = await pool.query(
    `SELECT count(*)::int AS n FROM bp_roles
      WHERE tenant_id = $1 AND role_type = 'vendor'`,
    [tenantId],
  );
  return {
    links: links.rows[0].n as number,
    bps: bps.rows[0].n as number,
    roles: roles.rows[0].n as number,
  };
}

describe("WP-APR-04 — BP canonical backfill", () => {
  let tenantId: string;

  beforeAll(async () => {
    const primary = await bootstrapTenant(app, TENANT, "Tenant Phase 4 BP");
    tenantId = primary.id;
    await provisionFirstAdmin({
      tenantId,
      email: `p4bp-admin.${stamp}@p4bp.local`,
      password: "Passw0rd12345!",
    });
  });

  afterAll(async () => {
    await pool.query(`DELETE FROM tenants WHERE code = ANY($1::text[])`, [
      [TENANT],
    ]);
    await app.close();
    await pool.end();
  });

  it("creates one canonical BP + vendor role per unlinked legacy supplier", async () => {
    await pool.query(
      `INSERT INTO suppliers (tenant_id, code, name, is_active)
       VALUES ($1, 'SUP-A', 'Supplier A', true),
              ($1, 'SUP-B', 'Supplier B', false)`,
      [tenantId],
    );

    await runSupplierBackfill(tenantId);
    const first = await counts(tenantId);
    expect(first.links).toBe(2);
    expect(first.bps).toBe(2);
    expect(first.roles).toBe(2);

    // Lifecycle mirrors is_active.
    const rows = await pool.query(
      `SELECT b.code, b.lifecycle_status, b.is_active
         FROM business_partners b WHERE b.tenant_id = $1 ORDER BY b.code`,
      [tenantId],
    );
    expect(rows.rows).toEqual([
      { code: "SUP-A", lifecycle_status: "active", is_active: true },
      { code: "SUP-B", lifecycle_status: "inactive", is_active: false },
    ]);
  });

  it("is idempotent — a second run creates nothing", async () => {
    const before = await counts(tenantId);
    await runSupplierBackfill(tenantId);
    const after = await counts(tenantId);
    expect(after).toEqual(before);
  });

  it("links to an existing same-code BP instead of minting a fallback code", async () => {
    // A BP already exists with the legacy code; the backfill must MATCH it
    // (step 1), never create a `code~<id>` orphan.
    await pool.query(
      `INSERT INTO business_partners (tenant_id, code, bp_type, name, lifecycle_status, is_active)
       VALUES ($1, 'SUP-C', 'organization', 'Supplier C', 'active', true)`,
      [tenantId],
    );
    await pool.query(
      `INSERT INTO suppliers (tenant_id, code, name, is_active)
       VALUES ($1, 'SUP-C', 'Supplier C', true)`,
      [tenantId],
    );

    await runSupplierBackfill(tenantId);

    const link = await pool.query(
      `SELECT l.created_by_backfill, b.code
         FROM bp_legacy_links l
         JOIN business_partners b ON b.id = l.business_partner_id
        WHERE l.tenant_id = $1 AND l.legacy_table = 'suppliers'`,
      [tenantId],
    );
    const supC = link.rows.find((r) => r.code === "SUP-C")!;
    expect(supC).toBeDefined();
    expect(supC.created_by_backfill).toBe(false); // matched, not created

    // No fallback-suffixed code was minted.
    const orphan = await pool.query(
      `SELECT count(*)::int AS n FROM business_partners
        WHERE tenant_id = $1 AND code LIKE 'SUP-C~%'`,
      [tenantId],
    );
    expect(orphan.rows[0].n).toBe(0);
  });
});
