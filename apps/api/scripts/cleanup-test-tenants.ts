/**
 * Cleanup Test Tenants
 *
 * Removes tenant records left over from vitest runs (code LIKE 'test-%').
 * Shows every match before deleting anything.
 *
 * A plain `DELETE FROM tenants WHERE code LIKE 'test-%'` can fail two ways:
 * (1) immutability triggers on some child tables (e.g. supply-chain movements,
 *     accounting-ready events, service acceptance) reject cascade deletes;
 * (2) a few RESTRICT/NO ACTION FK edges exist *inside* the tenant cascade set
 *     (e.g. purchase_request_lines.item_id -> items), so Postgres can try to
 *     cascade a parent before a sibling child that still references it.
 * `session_replication_role = replica` (session/transaction-local) disables
 * both FK enforcement and row triggers, so the delete always succeeds without
 * touching any tenant not matched by the LIKE filter. Verified 2026-09-23.
 *
 * Disabling FK enforcement also disables ON DELETE CASCADE, so the tenant rows
 * go and every child row stays. That is why the delete is followed by a sweep
 * that removes child rows whose tenant is gone. Without it each run leaves
 * orphans behind — app_windows alone contributes one row per registered route
 * per tenant, so the leak is large enough to distort row counts.
 *
 * Usage:
 *   npx tsx scripts/cleanup-test-tenants.ts
 */

import { Pool } from "pg";
import dotenv from "dotenv";

dotenv.config();

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("DATABASE_URL not set in .env");
  process.exit(1);
}

const TEST_CODE_PATTERN = "test-%";

/**
 * Tables holding a direct FK to tenants (no intermediate hop). Read from the
 * catalogue rather than hardcoded, so a new tenant-scoped table is swept
 * automatically instead of silently joining the orphan set.
 */
async function tenantScopedTables(client: import("pg").PoolClient): Promise<string[]> {
  const result = await client.query<{ tbl: string }>(
    `SELECT DISTINCT c.relname AS tbl
       FROM pg_constraint con
       JOIN pg_class c ON c.oid = con.conrelid
       JOIN pg_class rt ON rt.oid = con.confrelid
       JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE con.contype = 'f'
        AND rt.relname = 'tenants'
        AND n.nspname = 'public'
      ORDER BY 1`,
  );
  return result.rows.map((r) => r.tbl);
}

async function cleanupTestTenants() {
  const pool = new Pool({ connectionString: DATABASE_URL });
  const client = await pool.connect();

  try {
    const findResult = await client.query(
      `SELECT id, code, name, created_at FROM tenants WHERE code LIKE $1 ORDER BY created_at DESC`,
      [TEST_CODE_PATTERN],
    );

    const testTenants = findResult.rows;
    if (testTenants.length === 0) {
      console.log("No test tenants found.");
    } else {
      console.log(`Found ${testTenants.length} test tenant(s):\n`);
      testTenants.forEach((tenant, idx) => {
        console.log(`  ${idx + 1}. ${tenant.code} (id: ${tenant.id}, name: "${tenant.name}", created: ${tenant.created_at})`);
      });
      console.log(`\nDeleting ${testTenants.length} test tenant(s)...`);
    }

    // Always runs, even with no tenants to delete: orphan child rows from an
    // earlier run are exactly what needs sweeping, and that run may be the one
    // that deleted the tenants.
    await client.query("BEGIN");
    try {
      // Session-local: disables FK enforcement and row triggers for this
      // transaction only. Reset automatically on COMMIT/ROLLBACK. Note this
      // also disables ON DELETE CASCADE, which is why the sweep below exists.
      await client.query("SET LOCAL session_replication_role = replica");
      const deleteResult = await client.query(
        `DELETE FROM tenants WHERE code LIKE $1`,
        [TEST_CODE_PATTERN],
      );
      let swept = 0;
      for (const table of await tenantScopedTables(client)) {
        const res = await client.query(
          `DELETE FROM "${table}" WHERE tenant_id NOT IN (SELECT id FROM tenants)`,
        );
        swept += res.rowCount ?? 0;
      }
      await client.query("COMMIT");
      console.log(`Deleted ${deleteResult.rowCount} tenant(s); swept ${swept} orphaned child row(s).`);
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    }
  } catch (err) {
    console.error("Cleanup failed:", err);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

cleanupTestTenants();
