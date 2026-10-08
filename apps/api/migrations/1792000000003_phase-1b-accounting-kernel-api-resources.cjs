/**
 * Phase 1B — Accounting Kernel — API resource dictionary seed
 *
 * Establishes one row per HTTP route served by the Accounting Kernel module,
 * extending the canonical `app_api_resources` catalogue and seeding existing
 * tenants. Follows the Epic 6 G0 pattern (1790800000000_epic-6-g0-dictionary-seed):
 * prior seed function kept under its own name; canonical defined as UNION;
 * existing tenants backfilled with ON CONFLICT DO NOTHING.
 *
 * Routes by method and path (12 total):
 *   POST   /accounting/periods
 *   GET    /accounting/periods
 *   POST   /accounting/periods/:id/lock
 *   POST   /accounting/accounts
 *   GET    /accounting/accounts
 *   POST   /accounting/journals
 *   GET    /accounting/journals
 *   GET    /accounting/journals/:id
 *   POST   /accounting/journals/:id/post
 *   POST   /accounting/journals/:id/validate
 *   GET    /accounting/gl-entries
 *   GET    /accounting/gl-balance/:accountId/:periodId
 *
 * POL-FIN-001 ACTIVE (Financial Control — Accounting Kernel).
 */

exports.shorthands = undefined;

const API_RESOURCE_ADDITIONS = `
        ('api:POST /accounting/periods', 'finance', 'POST', '/accounting/periods'),
        ('api:GET /accounting/periods', 'finance', 'GET', '/accounting/periods'),
        ('api:POST /accounting/periods/:id/lock', 'finance', 'POST', '/accounting/periods/:id/lock'),
        ('api:POST /accounting/accounts', 'finance', 'POST', '/accounting/accounts'),
        ('api:GET /accounting/accounts', 'finance', 'GET', '/accounting/accounts'),
        ('api:POST /accounting/journals', 'finance', 'POST', '/accounting/journals'),
        ('api:GET /accounting/journals', 'finance', 'GET', '/accounting/journals'),
        ('api:GET /accounting/journals/:id', 'finance', 'GET', '/accounting/journals/:id'),
        ('api:POST /accounting/journals/:id/post', 'finance', 'POST', '/accounting/journals/:id/post'),
        ('api:POST /accounting/journals/:id/validate', 'finance', 'POST', '/accounting/journals/:id/validate'),
        ('api:GET /accounting/gl-entries', 'finance', 'GET', '/accounting/gl-entries'),
        ('api:GET /accounting/gl-balance/:accountId/:periodId', 'finance', 'GET', '/accounting/gl-balance/:accountId/:periodId')
`;

exports.up = (pgm) => {
  pgm.sql(`
    -- 1. Keep the prior API-resource catalogue reachable under its own name
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
         WHERE p.proname = 'config_dictionary_api_resource_seed_phase1a'
           AND n.nspname = current_schema()
      ) THEN
        ALTER FUNCTION config_dictionary_api_resource_seed()
          RENAME TO config_dictionary_api_resource_seed_phase1a;
      END IF;
    END
    $$;

    -- 2. Extend the canonical API-resource catalogue -------------------------
    CREATE OR REPLACE FUNCTION config_dictionary_api_resource_seed()
    RETURNS TABLE (code TEXT, name TEXT, module_code TEXT, http_method TEXT, path_pattern TEXT) AS $seed$
      SELECT s.code, s.name, s.module_code, s.http_method, s.path_pattern
        FROM config_dictionary_api_resource_seed_phase1a() s
      UNION
      SELECT a.code, a.http_method || ' ' || a.path_pattern, a.module_code, a.http_method, a.path_pattern
        FROM (VALUES
          ${API_RESOURCE_ADDITIONS}
        ) AS a(code, module_code, http_method, path_pattern);
    $seed$ LANGUAGE sql IMMUTABLE;

    -- 3. Backfill the new rows for tenants that already exist ----------------
    INSERT INTO app_api_resources (tenant_id, code, name, module_code, http_method, path_pattern)
    SELECT t.id, a.code, a.http_method || ' ' || a.path_pattern, a.module_code, a.http_method, a.path_pattern
      FROM tenants t
      CROSS JOIN (VALUES
        ${API_RESOURCE_ADDITIONS}
      ) AS a(code, module_code, http_method, path_pattern)
    ON CONFLICT (tenant_id, code) DO NOTHING;
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    -- Reverse in the opposite order to up.
    DELETE FROM app_api_resources
     WHERE code IN (
       SELECT a.code FROM (VALUES
         ${API_RESOURCE_ADDITIONS}
       ) AS a(code, module_code, http_method, path_pattern)
     );

    DROP FUNCTION IF EXISTS config_dictionary_api_resource_seed();

    ALTER FUNCTION config_dictionary_api_resource_seed_phase1a()
      RENAME TO config_dictionary_api_resource_seed;
  `);
};
