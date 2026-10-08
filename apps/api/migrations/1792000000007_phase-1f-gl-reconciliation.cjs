/**
 * Phase 1F — Accounting Kernel — GL Reconciliation (WP-FIN-04)
 *
 * Adds the API-resource dictionary row for the read-only GL reconciliation
 * endpoint. No schema change: `general_ledger_entries` already carries
 * `journal_line_id NOT NULL` + FK RESTRICT + UNIQUE, which structurally
 * prevents orphan GL entries; `gl_balances` is already maintained by
 * `refreshGlBalance` on every post/reverse. This migration only registers
 * the route so RBAC/dictionary parity stays satisfied.
 *
 * Follows the rename-chain pattern (1792000000006): the prior canonical
 * `config_dictionary_api_resource_seed` is preserved as `_phase1e`, and the
 * new canonical is a UNION over it plus the new row.
 *
 * Also adds one supporting index: reconciliation and gl-entries queries
 * filter `general_ledger_entries` on (tenant_id, period_id) without an
 * account; the existing (tenant_id, account_id, period_id) index cannot
 * serve those account-less scans.
 *
 * POL-FIN-001 ACTIVE (Financial Control — Accounting Kernel).
 */

exports.shorthands = undefined;

const NEW_API_RESOURCES = `
        ('api:GET /accounting/periods/:id/reconciliation', 'finance', 'GET', '/accounting/periods/:id/reconciliation')
`;

exports.up = (pgm) => {
  pgm.sql(`
    DO $$
    BEGIN
      IF EXISTS (
        SELECT 1 FROM pg_proc p
          JOIN pg_namespace n ON n.oid = p.pronamespace
         WHERE p.proname = 'config_dictionary_api_resource_seed'
           AND n.nspname = current_schema()
      ) AND NOT EXISTS (
        SELECT 1 FROM pg_proc p
          JOIN pg_namespace n ON n.oid = p.pronamespace
         WHERE p.proname = 'config_dictionary_api_resource_seed_phase1e'
           AND n.nspname = current_schema()
      ) THEN
        ALTER FUNCTION config_dictionary_api_resource_seed()
          RENAME TO config_dictionary_api_resource_seed_phase1e;
      END IF;
    END
    $$;

    CREATE OR REPLACE FUNCTION config_dictionary_api_resource_seed()
    RETURNS TABLE (code TEXT, name TEXT, module_code TEXT, http_method TEXT, path_pattern TEXT) AS $seed$
      SELECT s.code, s.name, s.module_code, s.http_method, s.path_pattern
        FROM config_dictionary_api_resource_seed_phase1e() s
      UNION
      SELECT a.code, a.http_method || ' ' || a.path_pattern, a.module_code, a.http_method, a.path_pattern
        FROM (VALUES
          ${NEW_API_RESOURCES}
        ) AS a(code, module_code, http_method, path_pattern);
    $seed$ LANGUAGE sql IMMUTABLE;

    INSERT INTO app_api_resources (tenant_id, code, name, module_code, http_method, path_pattern)
    SELECT t.id, a.code, a.http_method || ' ' || a.path_pattern, a.module_code, a.http_method, a.path_pattern
      FROM tenants t
      CROSS JOIN (VALUES
        ${NEW_API_RESOURCES}
      ) AS a(code, module_code, http_method, path_pattern)
    ON CONFLICT (tenant_id, code) DO NOTHING;
  `);

  pgm.createIndex(
    "general_ledger_entries",
    ["tenant_id", "period_id"],
    { name: "general_ledger_entries_tenant_period_idx" },
  );
};

exports.down = (pgm) => {
  pgm.dropIndex("general_ledger_entries", "general_ledger_entries_tenant_period_idx", { ifExists: true });

  pgm.sql(`
    DELETE FROM app_api_resources
     WHERE code IN (
       SELECT a.code FROM (VALUES
         ${NEW_API_RESOURCES}
       ) AS a(code, module_code, http_method, path_pattern)
     );

    DROP FUNCTION IF EXISTS config_dictionary_api_resource_seed();

    ALTER FUNCTION config_dictionary_api_resource_seed_phase1e()
      RENAME TO config_dictionary_api_resource_seed;
  `);
};
