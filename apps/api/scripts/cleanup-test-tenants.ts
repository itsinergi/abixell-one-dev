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
      console.log("No test tenants found. Database is clean.");
      return;
    }

    console.log(`Found ${testTenants.length} test tenant(s):\n`);
    testTenants.forEach((tenant, idx) => {
      console.log(`  ${idx + 1}. ${tenant.code} (id: ${tenant.id}, name: "${tenant.name}", created: ${tenant.created_at})`);
    });

    console.log(`\nDeleting ${testTenants.length} test tenant(s)...`);

    await client.query("BEGIN");
    try {
      // Session-local: disables FK enforcement and row triggers for this
      // transaction only. Reset automatically on COMMIT/ROLLBACK.
      await client.query("SET LOCAL session_replication_role = replica");
      const deleteResult = await client.query(
        `DELETE FROM tenants WHERE code LIKE $1`,
        [TEST_CODE_PATTERN],
      );
      await client.query("COMMIT");
      console.log(`Deleted ${deleteResult.rowCount} tenant(s) (with cascaded child rows).`);
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
