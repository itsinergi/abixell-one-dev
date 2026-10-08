/**
 * Phase 1A — Accounting Kernel — Dictionary seed extension
 *
 * Migration 1792000000000 (phase-1a-accounting-kernel.cjs) inserted 5 accounting
 * permissions into the permissions catalogue, but did not extend the dictionary
 * process seed function (config_dictionary_process_seed). This migration
 * completes the pattern: extending the canonical process catalogue with one
 * row per accounting permission, and backfilling existing tenants with
 * matching app_processes rows.
 *
 * The permissions are catalogued by module-attribution rule:
 *   - finance.accounting.* → "finance" module (via "finance." prefix in
 *     PERMISSION_MODULE_PREFIXES, module-attribution.ts line 179)
 *
 * This migration follows the pattern established by Epic 6 G0 (1790800000000):
 * keep the prior seed function under its own name, extend canonical as UNION.
 *
 * Correction (2026-10-08): the first version of this migration referenced
 * `config_dictionary_process_seed_epic6_g0()` directly instead of snapshotting
 * the then-current canonical first. That name was already taken — by
 * 1790800000000's OWN snapshot of the pre-Business-Partner state — so this
 * migration was silently reading the WRONG, older snapshot and dropping all
 * 26 bp_* rows Epic 6 G0 had added when it overwrote canonical. Fixed by
 * adding the missing rename step, same as every other dictionary-seed
 * migration (1789390000000, 1789399000000, 1790800000000).
 */

exports.shorthands = undefined;

const PERMISSIONS = [
  { code: "finance.accounting.read", description: "View accounting GL, journals, periods, trial balance (subject to Data Scope)" },
  { code: "finance.accounting.manage", description: "Create and edit draft journals, post balanced journals" },
  { code: "finance.accounting.approve", description: "Approve journal posting, lock periods" },
  { code: "finance.accounting.configure", description: "Maintain chart of accounts, posting rules" },
  { code: "finance.accounting.period.lock", description: "Lock/reopen accounting periods (restricted role)" },
];

const PROCESS_ROWS = PERMISSIONS.map(
  (p) => `      SELECT '${p.code}', '${p.description.replace(/'/g, "''")}', 'finance'
       WHERE NOT EXISTS (
         SELECT 1 FROM config_dictionary_process_seed_phase1a() l WHERE l.code = '${p.code}'
       )`,
).join("\n      UNION\n");

exports.up = (pgm) => {
  pgm.sql(`
    -- 1. Keep the prior (Epic 6 G0, bp_*-inclusive) Process catalogue
    --    reachable under its own name.
    DO $$
    BEGIN
      IF EXISTS (
        SELECT 1 FROM pg_proc p
          JOIN pg_namespace n ON n.oid = p.pronamespace
         WHERE p.proname = 'config_dictionary_process_seed'
           AND n.nspname = current_schema()
      ) AND NOT EXISTS (
        SELECT 1 FROM pg_proc p
          JOIN pg_namespace n ON n.oid = p.pronamespace
         WHERE p.proname = 'config_dictionary_process_seed_phase1a'
           AND n.nspname = current_schema()
      ) THEN
        ALTER FUNCTION config_dictionary_process_seed()
          RENAME TO config_dictionary_process_seed_phase1a;
      END IF;
    END
    $$;

    -- 2. Redefine the canonical Process catalogue as that snapshot + accounting
    CREATE OR REPLACE FUNCTION config_dictionary_process_seed()
    RETURNS TABLE (code TEXT, name TEXT, module_code TEXT) AS $seed$
      SELECT s.code, s.name, s.module_code
        FROM config_dictionary_process_seed_phase1a() s
      UNION
${PROCESS_ROWS};
    $seed$ LANGUAGE sql IMMUTABLE;

    -- 3. Existing tenants receive the new Process rows -----------------------
    INSERT INTO app_processes (tenant_id, code, name, module_code)
    SELECT t.id, s.code, s.name, s.module_code
      FROM tenants t
      CROSS JOIN config_dictionary_process_seed() s
    ON CONFLICT (tenant_id, code) DO NOTHING;
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    -- Reverse in the opposite order to up.
    DELETE FROM app_processes WHERE code IN (
      ${PERMISSIONS.map((p) => `'${p.code}'`).join(", ")}
    );

    DROP FUNCTION IF EXISTS config_dictionary_process_seed();

    ALTER FUNCTION config_dictionary_process_seed_phase1a()
      RENAME TO config_dictionary_process_seed;

    -- Permission rows were inserted by 1792000000000 migration, reverted there.
  `);
};
