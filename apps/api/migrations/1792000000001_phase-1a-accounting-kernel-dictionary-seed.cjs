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
         SELECT 1 FROM config_dictionary_process_seed_epic6_g0() l WHERE l.code = '${p.code}'
       )`,
).join("\n      UNION\n");

exports.up = (pgm) => {
  pgm.sql(`
    -- 1. Redefine the canonical Process catalogue as Epic 6 G0 + accounting rows
    --    (Epic 6 G0 migration already ran and created config_dictionary_process_seed_epic6_g0)
    CREATE OR REPLACE FUNCTION config_dictionary_process_seed()
    RETURNS TABLE (code TEXT, name TEXT, module_code TEXT) AS $seed$
      SELECT s.code, s.name, s.module_code
        FROM config_dictionary_process_seed_epic6_g0() s
      UNION
${PROCESS_ROWS};
    $seed$ LANGUAGE sql IMMUTABLE;

    -- 2. Existing tenants receive the new Process rows -----------------------
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

    -- Rebuild canonical from Epic 6 G0 only (no accounting rows)
    CREATE OR REPLACE FUNCTION config_dictionary_process_seed()
    RETURNS TABLE (code TEXT, name TEXT, module_code TEXT) AS $seed$
      SELECT s.code, s.name, s.module_code
        FROM config_dictionary_process_seed_epic6_g0() s;
    $seed$ LANGUAGE sql IMMUTABLE;

    -- Permission rows were inserted by 1792000000000 migration, reverted there.
  `);
};
