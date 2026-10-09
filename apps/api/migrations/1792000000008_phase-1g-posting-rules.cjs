/**
 * Phase 1G — Accounting Kernel — Posting Rule Engine (WP-FIN-05)
 *
 * Adds the API-resource dictionary rows for the posting-rule CRUD + resolve +
 * generate endpoints. No schema change: `posting_rules` and
 * `journal_headers.posting_rule_version_id` already exist since Phase 1A
 * (1792000000000). This migration only registers the new routes so
 * RBAC/dictionary parity stays satisfied.
 *
 * Follows the rename-chain pattern (1792000000007): the prior canonical
 * `config_dictionary_api_resource_seed` is preserved as `_phase1f`, and the
 * new canonical is a UNION over it plus the new rows.
 *
 * Epic 14 §4.14 keputusan #9 ACTIVE (account mapping is tenant-admin data,
 * not code; enforcement in DB/services, not UI).
 */

exports.shorthands = undefined;

const NEW_API_RESOURCES = `
        ('api:POST /accounting/posting-rules', 'finance', 'POST', '/accounting/posting-rules'),
        ('api:GET /accounting/posting-rules', 'finance', 'GET', '/accounting/posting-rules'),
        ('api:POST /accounting/posting-rules/:id/deprecate', 'finance', 'POST', '/accounting/posting-rules/:id/deprecate'),
        ('api:POST /accounting/posting-rules/resolve', 'finance', 'POST', '/accounting/posting-rules/resolve'),
        ('api:POST /accounting/posting-rules/generate', 'finance', 'POST', '/accounting/posting-rules/generate')
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
         WHERE p.proname = 'config_dictionary_api_resource_seed_phase1f'
           AND n.nspname = current_schema()
      ) THEN
        ALTER FUNCTION config_dictionary_api_resource_seed()
          RENAME TO config_dictionary_api_resource_seed_phase1f;
      END IF;
    END
    $$;

    CREATE OR REPLACE FUNCTION config_dictionary_api_resource_seed()
    RETURNS TABLE (code TEXT, name TEXT, module_code TEXT, http_method TEXT, path_pattern TEXT) AS $seed$
      SELECT s.code, s.name, s.module_code, s.http_method, s.path_pattern
        FROM config_dictionary_api_resource_seed_phase1f() s
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
};

exports.down = (pgm) => {
  pgm.sql(`
    DELETE FROM app_api_resources
     WHERE code IN (
       SELECT a.code FROM (VALUES
         ${NEW_API_RESOURCES}
       ) AS a(code, module_code, http_method, path_pattern)
     );

    DROP FUNCTION IF EXISTS config_dictionary_api_resource_seed();

    ALTER FUNCTION config_dictionary_api_resource_seed_phase1f()
      RENAME TO config_dictionary_api_resource_seed;
  `);
};
