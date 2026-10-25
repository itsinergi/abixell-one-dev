/**
 * Wave A6 WP-FIN-A6-06a dictionary seed: Indonesia tax baseline routes.
 * Uses the rename-chain UNION pattern from 1795500000010.
 *
 * No new permissions: routes are governed by the existing
 * finance.accounting.configure / .read / .approve family.
 *
 * Module attribution: `/accounting/*` maps to finance via the existing
 * first-segment rule in module-attribution.ts — no override needed.
 *
 * Routes (9):
 *   POST /accounting/tax-registrations
 *   GET  /accounting/tax-registrations
 *   POST /accounting/tax-rules
 *   GET  /accounting/tax-rules
 *   POST /accounting/tax-rules/:id/versions
 *   GET  /accounting/tax-rules/:id/versions
 *   POST /accounting/tax-rule-versions/:id/actions
 *   POST /accounting/tax-calculations
 *   GET  /accounting/tax-calculations
 */
exports.shorthands = undefined;

const API_RESOURCE_ROWS = `
      ('api:POST /accounting/tax-registrations', 'finance', 'POST', '/accounting/tax-registrations'),
      ('api:GET /accounting/tax-registrations', 'finance', 'GET', '/accounting/tax-registrations'),
      ('api:POST /accounting/tax-rules', 'finance', 'POST', '/accounting/tax-rules'),
      ('api:GET /accounting/tax-rules', 'finance', 'GET', '/accounting/tax-rules'),
      ('api:POST /accounting/tax-rules/:id/versions', 'finance', 'POST', '/accounting/tax-rules/:id/versions'),
      ('api:GET /accounting/tax-rules/:id/versions', 'finance', 'GET', '/accounting/tax-rules/:id/versions'),
      ('api:POST /accounting/tax-rule-versions/:id/actions', 'finance', 'POST', '/accounting/tax-rule-versions/:id/actions'),
      ('api:POST /accounting/tax-calculations', 'finance', 'POST', '/accounting/tax-calculations'),
      ('api:GET /accounting/tax-calculations', 'finance', 'GET', '/accounting/tax-calculations')
`;

const API_RESOURCE_CODES = `
       'api:POST /accounting/tax-registrations',
       'api:GET /accounting/tax-registrations',
       'api:POST /accounting/tax-rules',
       'api:GET /accounting/tax-rules',
       'api:POST /accounting/tax-rules/:id/versions',
       'api:GET /accounting/tax-rules/:id/versions',
       'api:POST /accounting/tax-rule-versions/:id/actions',
       'api:POST /accounting/tax-calculations',
       'api:GET /accounting/tax-calculations'
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
         WHERE p.proname = 'config_dictionary_api_resource_seed_wave_a6_06a'
           AND n.nspname = current_schema()
      ) THEN
        ALTER FUNCTION config_dictionary_api_resource_seed()
          RENAME TO config_dictionary_api_resource_seed_wave_a6_06a;
      END IF;
    END
    $$;

    CREATE OR REPLACE FUNCTION config_dictionary_api_resource_seed()
    RETURNS TABLE (code TEXT, name TEXT, module_code TEXT, http_method TEXT, path_pattern TEXT) AS $seed$
      SELECT s.code, s.name, s.module_code, s.http_method, s.path_pattern
        FROM config_dictionary_api_resource_seed_wave_a6_06a() s
      UNION
      SELECT a.code, a.http_method || ' ' || a.path_pattern, a.module_code, a.http_method, a.path_pattern
        FROM (VALUES
          ${API_RESOURCE_ROWS}
        ) AS a(code, module_code, http_method, path_pattern);
    $seed$ LANGUAGE sql IMMUTABLE;

    INSERT INTO app_api_resources (tenant_id, code, name, module_code, http_method, path_pattern)
    SELECT t.id, a.code, a.http_method || ' ' || a.path_pattern, a.module_code, a.http_method, a.path_pattern
      FROM tenants t
      CROSS JOIN (VALUES
        ${API_RESOURCE_ROWS}
      ) AS a(code, module_code, http_method, path_pattern)
    ON CONFLICT (tenant_id, code) DO NOTHING;
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    DELETE FROM app_api_resources
     WHERE code IN (
       ${API_RESOURCE_CODES}
     );

    DO $$
    BEGIN
      IF EXISTS (
        SELECT 1 FROM pg_proc p
          JOIN pg_namespace n ON n.oid = p.pronamespace
         WHERE p.proname = 'config_dictionary_api_resource_seed'
           AND n.nspname = current_schema()
      ) AND EXISTS (
        SELECT 1 FROM pg_proc p
          JOIN pg_namespace n ON n.oid = p.pronamespace
         WHERE p.proname = 'config_dictionary_api_resource_seed_wave_a6_06a'
           AND n.nspname = current_schema()
      ) THEN
        ALTER FUNCTION config_dictionary_api_resource_seed()
          RENAME TO config_dictionary_api_resource_seed_tmp;
        ALTER FUNCTION config_dictionary_api_resource_seed_wave_a6_06a()
          RENAME TO config_dictionary_api_resource_seed;
        DROP FUNCTION config_dictionary_api_resource_seed_tmp();
      END IF;
    END
    $$;
  `);
};
