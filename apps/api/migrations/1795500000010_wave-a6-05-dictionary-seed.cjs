/**
 * Wave A6 WP-FIN-A6-05 dictionary seed: fixed asset book + depreciation routes.
 * Uses the rename-chain UNION pattern from 1795200000010.
 *
 * No new permissions: routes are governed by the existing
 * finance.accounting.configure / .read / .approve family.
 *
 * Module attribution: `/accounting/*` maps to finance via the existing
 * first-segment rule in module-attribution.ts — no override needed.
 *
 * Routes (11):
 *   POST /accounting/asset-books
 *   GET  /accounting/asset-books
 *   GET  /accounting/asset-books/:id
 *   POST /accounting/asset-books/:id/activate
 *   POST /accounting/asset-book-events
 *   GET  /accounting/asset-book-events
 *   POST /accounting/asset-books/:id/dispose
 *   POST /accounting/depreciation-runs
 *   GET  /accounting/depreciation-runs
 *   GET  /accounting/depreciation-runs/:id
 *   POST /accounting/depreciation-runs/:id/reverse
 */
exports.shorthands = undefined;

const API_RESOURCE_ROWS = `
      ('api:POST /accounting/asset-books', 'finance', 'POST', '/accounting/asset-books'),
      ('api:GET /accounting/asset-books', 'finance', 'GET', '/accounting/asset-books'),
      ('api:GET /accounting/asset-books/:id', 'finance', 'GET', '/accounting/asset-books/:id'),
      ('api:POST /accounting/asset-books/:id/activate', 'finance', 'POST', '/accounting/asset-books/:id/activate'),
      ('api:POST /accounting/asset-books/:id/dispose', 'finance', 'POST', '/accounting/asset-books/:id/dispose'),
      ('api:POST /accounting/asset-book-events', 'finance', 'POST', '/accounting/asset-book-events'),
      ('api:GET /accounting/asset-book-events', 'finance', 'GET', '/accounting/asset-book-events'),
      ('api:POST /accounting/depreciation-runs', 'finance', 'POST', '/accounting/depreciation-runs'),
      ('api:GET /accounting/depreciation-runs', 'finance', 'GET', '/accounting/depreciation-runs'),
      ('api:GET /accounting/depreciation-runs/:id', 'finance', 'GET', '/accounting/depreciation-runs/:id'),
      ('api:POST /accounting/depreciation-runs/:id/reverse', 'finance', 'POST', '/accounting/depreciation-runs/:id/reverse')
`;

const API_RESOURCE_CODES = `
       'api:POST /accounting/asset-books',
       'api:GET /accounting/asset-books',
       'api:GET /accounting/asset-books/:id',
       'api:POST /accounting/asset-books/:id/activate',
       'api:POST /accounting/asset-books/:id/dispose',
       'api:POST /accounting/asset-book-events',
       'api:GET /accounting/asset-book-events',
       'api:POST /accounting/depreciation-runs',
       'api:GET /accounting/depreciation-runs',
       'api:GET /accounting/depreciation-runs/:id',
       'api:POST /accounting/depreciation-runs/:id/reverse'
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
         WHERE p.proname = 'config_dictionary_api_resource_seed_wave_a6_05'
           AND n.nspname = current_schema()
      ) THEN
        ALTER FUNCTION config_dictionary_api_resource_seed()
          RENAME TO config_dictionary_api_resource_seed_wave_a6_05;
      END IF;
    END
    $$;

    CREATE OR REPLACE FUNCTION config_dictionary_api_resource_seed()
    RETURNS TABLE (code TEXT, name TEXT, module_code TEXT, http_method TEXT, path_pattern TEXT) AS $seed$
      SELECT s.code, s.name, s.module_code, s.http_method, s.path_pattern
        FROM config_dictionary_api_resource_seed_wave_a6_05() s
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
         WHERE p.proname = 'config_dictionary_api_resource_seed_wave_a6_05'
           AND n.nspname = current_schema()
      ) THEN
        ALTER FUNCTION config_dictionary_api_resource_seed()
          RENAME TO config_dictionary_api_resource_seed_tmp;
        ALTER FUNCTION config_dictionary_api_resource_seed_wave_a6_05()
          RENAME TO config_dictionary_api_resource_seed;
        DROP FUNCTION config_dictionary_api_resource_seed_tmp();
      END IF;
    END
    $$;
  `);
};
