/**
 * Wave A6 WP-FIN-A6-01 dictionary seed: fiscal close + ledger governance routes.
 * Uses the rename-chain UNION pattern from 1794600000010.
 *
 * No new permissions: routes are governed by the existing
 * finance.accounting.configure / .read / .period.lock / .approve family.
 *
 * Module attribution: `/accounting/*` maps to finance via the existing
 * first-segment rule in module-attribution.ts — no override needed.
 *
 * Routes (5):
 *   GET  /accounting/fiscal-closings
 *   POST /accounting/periods/:id/close-month-end
 *   POST /accounting/periods/:id/close-year-end
 *   GET  /accounting/ledgers
 *   POST /accounting/ledgers
 */
exports.shorthands = undefined;

const API_RESOURCE_ROWS = `
      ('api:GET /accounting/fiscal-closings', 'finance', 'GET', '/accounting/fiscal-closings'),
      ('api:POST /accounting/periods/:id/close-month-end', 'finance', 'POST', '/accounting/periods/:id/close-month-end'),
      ('api:POST /accounting/periods/:id/close-year-end', 'finance', 'POST', '/accounting/periods/:id/close-year-end'),
      ('api:GET /accounting/ledgers', 'finance', 'GET', '/accounting/ledgers'),
      ('api:POST /accounting/ledgers', 'finance', 'POST', '/accounting/ledgers')
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
         WHERE p.proname = 'config_dictionary_api_resource_seed_wave_a6_01'
           AND n.nspname = current_schema()
      ) THEN
        ALTER FUNCTION config_dictionary_api_resource_seed()
          RENAME TO config_dictionary_api_resource_seed_wave_a6_01;
      END IF;
    END
    $$;

    CREATE OR REPLACE FUNCTION config_dictionary_api_resource_seed()
    RETURNS TABLE (code TEXT, name TEXT, module_code TEXT, http_method TEXT, path_pattern TEXT) AS $seed$
      SELECT s.code, s.name, s.module_code, s.http_method, s.path_pattern
        FROM config_dictionary_api_resource_seed_wave_a6_01() s
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
       'api:GET /accounting/fiscal-closings',
       'api:POST /accounting/periods/:id/close-month-end',
       'api:POST /accounting/periods/:id/close-year-end',
       'api:GET /accounting/ledgers',
       'api:POST /accounting/ledgers'
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
         WHERE p.proname = 'config_dictionary_api_resource_seed_wave_a6_01'
           AND n.nspname = current_schema()
      ) THEN
        ALTER FUNCTION config_dictionary_api_resource_seed()
          RENAME TO config_dictionary_api_resource_seed_tmp;
        ALTER FUNCTION config_dictionary_api_resource_seed_wave_a6_01()
          RENAME TO config_dictionary_api_resource_seed;
        DROP FUNCTION config_dictionary_api_resource_seed_tmp();
      END IF;
    END
    $$;
  `);
};
