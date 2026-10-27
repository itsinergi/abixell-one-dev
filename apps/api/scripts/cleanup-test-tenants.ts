/**
 * Cleanup Test Tenants
 *
 * Removes tenant records left over from vitest runs, matched against the
 * fixture-code prefixes every suite actually uses (see TEST_CODE_PATTERNS
 * below — 'test-%' alone misses most of them, e.g. 'wave-%', 't11fl-%').
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
 * that removes child rows whose parent is gone.
 *
 * The sweep walks the WHOLE foreign-key graph to a fixpoint, not just the edges
 * that point at `tenants`. Sweeping one hop was the original bug: it cleared
 * `tenant_id` children but left everything hanging off `roles`, `users`,
 * `workflow_instances` and friends. On 2026-10-27 that had accumulated to
 * 881,687 orphan rows, 726,069 of them in `role_permissions` (76 MB for what
 * should have been ~527 grants). Each pass deletes rows whose parent is
 * missing; passes repeat until one deletes nothing, because a row can only
 * become an orphan after its own parent is swept.
 *
 * Rows reachable from a live tenant are never swept: the predicate is "my
 * parent does not exist", and a live tenant's parent always does.
 *
 * Usage:
 *   npx tsx scripts/cleanup-test-tenants.ts            # sweep, then report
 *   npx tsx scripts/cleanup-test-tenants.ts --dry-run  # report only
 */

import { Pool } from "pg";
import dotenv from "dotenv";

dotenv.config();

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("DATABASE_URL not set in .env");
  process.exit(1);
}

// Prefixes the vitest suites create tenants under. Real tenants (demo-gs,
// UNIT-CAT-PILOT-01) match none of these.
const TEST_CODE_PATTERNS = [
  "test-%", "mf-%", "svc-%", "wave-%", "t11fl-%", "ep2w23-%", "tahap-%",
  "ak-%", "akrev-%", "bp-%", "e5g%", "ec-%", "mt-%", "p4sod-%",
];

type ForeignKey = {
  /** Child table, schema-qualified and quoted. */
  child: string;
  /** Parent table, schema-qualified and quoted. */
  parent: string;
  /** Child columns, in FK order. */
  childCols: string[];
  /** Parent columns, in FK order. */
  parentCols: string[];
};

/**
 * Every single- and multi-column foreign key in `public`, read from the
 * catalogue so a new tenant-scoped table is swept automatically.
 *
 * FKs between two non-public tables are skipped: nothing outside `public` can
 * hang off a tenant, and a cross-schema predicate would need permissions this
 * script should not require.
 */
async function allForeignKeys(client: import("pg").PoolClient): Promise<ForeignKey[]> {
  const { rows } = await client.query<{
    child: string;
    parent: string;
    child_cols: string[];
    parent_cols: string[];
  }>(
    `SELECT format('%I.%I', cn.nspname, c.relname)  AS child,
            format('%I.%I', pn.nspname, p.relname)  AS parent,
            array_agg(ca.attname::text ORDER BY k.ord) AS child_cols,
            array_agg(pa.attname::text ORDER BY k.ord) AS parent_cols
       FROM pg_constraint con
       JOIN pg_class c   ON c.oid = con.conrelid
       JOIN pg_namespace cn ON cn.oid = c.relnamespace
       JOIN pg_class p   ON p.oid = con.confrelid
       JOIN pg_namespace pn ON pn.oid = p.relnamespace
       LEFT JOIN LATERAL unnest(con.conkey, con.confkey)
              WITH ORDINALITY AS k(child_attnum, parent_attnum, ord) ON true
       JOIN pg_attribute ca ON ca.attrelid = con.conrelid
                           AND ca.attnum  = k.child_attnum
       JOIN pg_attribute pa ON pa.attrelid = con.confrelid
                           AND pa.attnum  = k.parent_attnum
      WHERE con.contype = 'f'
        AND cn.nspname = 'public'
        AND pn.nspname = 'public'
        AND p.relkind IN ('r', 'p')
      GROUP BY con.oid, cn.nspname, c.relname, pn.nspname, p.relname
      ORDER BY child, parent`,
  );
  return rows.map((r) => ({
    child: r.child,
    parent: r.parent,
    childCols: r.child_cols,
    parentCols: r.parent_cols,
  }));
}

/**
 * One pass: delete every child row whose parent is missing.
 *
 * `IS NOT DISTINCT FROM` rather than `=`, so a nullable FK column matches the
 * same way the FK constraint does. A row with any NULL in the key is skipped:
 * Postgres does not enforce a partially-NULL FK, so those rows are not orphans
 * and deleting them would destroy live data.
 */
async function sweepOnce(
  client: import("pg").PoolClient,
  fks: ForeignKey[],
  dryRun: boolean,
): Promise<number> {
  let total = 0;
  for (const fk of fks) {
    const notNull = fk.childCols.map((c) => `x."${c}" IS NOT NULL`).join(" AND ");
    const matches = fk.childCols
      .map((c, i) => `p."${fk.parentCols[i]}" IS NOT DISTINCT FROM x."${c}"`)
      .join(" AND ");
    const sql = dryRun
      ? `SELECT count(*)::int AS n FROM ${fk.child} x
          WHERE ${notNull}
            AND NOT EXISTS (SELECT 1 FROM ${fk.parent} p WHERE ${matches})`
      : `DELETE FROM ${fk.child} x
          WHERE ${notNull}
            AND NOT EXISTS (SELECT 1 FROM ${fk.parent} p WHERE ${matches})`;
    try {
      const res = await client.query<{ n: number }>(sql);
      const n = dryRun ? (res.rows[0]?.n ?? 0) : (res.rowCount ?? 0);
      if (n > 0) {
        total += n;
        console.log(`  ${dryRun ? "would delete" : "deleted"} ${n} orphan row(s) from ${fk.child}`);
      }
    } catch (err) {
      // A table can be locked or a trigger can refuse the delete; report and
      // keep sweeping rather than aborting the whole run.
      console.warn(`  skipped ${fk.child}: ${(err as Error).message}`);
    }
  }
  return total;
}

/** Repeat passes until one deletes nothing: an orphan can only appear after
 * its own parent was swept in an earlier pass. */
async function sweepOrphans(
  client: import("pg").PoolClient,
  dryRun: boolean,
): Promise<number> {
  const fks = await allForeignKeys(client);
  // A dry run cannot reach a fixpoint: nothing is deleted, so every pass finds
  // the same rows. One pass is the honest answer — it is also what the real run
  // would remove for rows orphaned today, before cascading removes the rest.
  if (dryRun) {
    const n = await sweepOnce(client, fks, true);
    console.log(
      `Dry run: ${n} orphan row(s) are orphaned right now; a real run also removes\n` +
        `rows that only become orphaned after their own parent is swept.`,
    );
    return n;
  }
  let grand = 0;
  for (let pass = 1; pass <= 12; pass++) {
    const n = await sweepOnce(client, fks, dryRun);
    grand += n;
    if (n === 0) {
      console.log(`Sweep settled after ${pass - 1} productive pass(es).`);
      break;
    }
    console.log(`Pass ${pass}: ${n} row(s).`);
  }
  return grand;
}

async function cleanupTestTenants() {
  const dryRun = process.argv.includes("--dry-run");
  const pool = new Pool({ connectionString: DATABASE_URL });
  const client = await pool.connect();

  try {
    const findResult = await client.query(
      `SELECT id, code, name, created_at FROM tenants WHERE code LIKE ANY($1) ORDER BY created_at DESC`,
      [TEST_CODE_PATTERNS],
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
      if (!dryRun) await client.query("SET LOCAL session_replication_role = replica");
      const deleteResult = dryRun
        ? await client.query<{ n: number }>(
            `SELECT count(*)::int AS n FROM tenants WHERE code LIKE ANY($1)`,
            [TEST_CODE_PATTERNS],
          )
        : await client.query(
            `DELETE FROM tenants WHERE code LIKE ANY($1)`,
            [TEST_CODE_PATTERNS],
          );
      const deleted = dryRun
        ? (deleteResult.rows[0]?.n ?? 0)
        : (deleteResult.rowCount ?? 0);

      console.log(`\nSweeping orphan rows across every foreign-key edge...`);
      const swept = await sweepOrphans(client, dryRun);

      if (dryRun) {
        await client.query("ROLLBACK");
        console.log(
          `\nDry run: would delete ${deleted} tenant(s) and ${swept} orphan row(s). Nothing was changed.`,
        );
      } else {
        await client.query("COMMIT");
        console.log(
          `\nDeleted ${deleted} tenant(s); swept ${swept} orphaned child row(s).`,
        );
      }
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
