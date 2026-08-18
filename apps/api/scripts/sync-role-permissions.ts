/**
 * Checkpoint 0F / ADR-0010: production permission migration.
 *
 * Every Role with `is_full_access = true` is granted any permission in
 * the `permissions` catalog it is currently missing — additive only,
 * `ON CONFLICT DO NOTHING`, never revokes anything, never touches
 * Roles with `is_full_access = false` (those are curated on purpose and
 * a new permission being granted to them is a business decision, not a
 * mechanical one — this script deliberately does not guess).
 *
 * This is the fix for a gap that recurred in Checkpoints 0C, 0D, and 0E:
 * each time a migration added new permission codes, the only way to get
 * them onto the demo tenant's ADMIN role was delete-and-reseed —
 * explicitly documented every time as "not a production migration
 * strategy". A live production tenant can now run this script (idempotent,
 * safe to run any number of times, safe to run before OR after a given
 * Role exists) instead.
 *
 * Usage: npm run sync-permissions -w apps/api
 * (Intended to run once per deployment, right after `npm run migrate`,
 * whenever a Product Core migration adds new permission codes.)
 */
import "dotenv/config";
import { pool } from "../src/infrastructure/persistence/db.js";

async function main() {
  const result = await pool.query(
    `INSERT INTO role_permissions (role_id, permission_id)
       SELECT r.id, p.id
         FROM roles r
         CROSS JOIN permissions p
        WHERE r.is_full_access = true
     ON CONFLICT DO NOTHING
     RETURNING role_id`,
  );

  console.log(
    `sync-role-permissions: ${result.rowCount ?? 0} new (role, permission) grant(s) added ` +
      `across every is_full_access role. 0 is a healthy result if nothing changed since the last run.`,
  );

  await pool.end();
}

main().catch((err) => {
  console.error("sync-role-permissions failed:", err);
  process.exitCode = 1;
});
