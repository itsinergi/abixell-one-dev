/**
 * Wave A6 WP-FIN-A6-03 dictionary seed: budget control + accounting dimensions routes.
 * Uses the rename-chain UNION pattern from 1795200000010.
 *
 * No new permissions: routes are governed by the existing
 * finance.accounting.configure / .read / .approve family.
 *
 * Module attribution: `/accounting/*` maps to finance via the existing
 * first-segment rule in module-attribution.ts — no override needed.
 *
 * Routes (12):
 *   POST   /accounting/budgets
 *   GET    /accounting/budgets
 *   GET    /accounting/budgets/:id
 *   GET    /accounting/budgets/:id/utilization
 *   POST   /accounting/budgets/:id/versions
 *   GET    /accounting/budgets/:id/versions
 *   GET    /accounting/budget-versions/:id/lines
 *   POST   /accounting/budget-versions/:id/actions
 *   POST   /accounting/budget-policies
 *   GET    /accounting/budget-policies
 *   POST   /accounting/budget-consumptions
 *   POST   /accounting/budget-consumptions/:id/release
 */
exports.shorthands = undefined;

const API_RESOURCE_ROWS = `
      ('api:POST /accounting/budgets', 'finance', 'POST', '/accounting/budgets'),
      ('api:GET /accounting/budgets', 'finance', 'GET', '/accounting/budgets'),
      ('api:GET /accounting/budgets/:id', 'finance', 'GET', '/accounting/budgets/:id'),
      ('api:GET /accounting/budgets/:id/utilization', 'finance', 'GET', '/accounting/budgets/:id/utilization'),
      ('api:POST /accounting/budgets/:id/versions', 'finance', 'POST', '/accounting/budgets/:id/versions'),
      ('api:GET /accounting/budgets/:id/versions', 'finance', 'GET', '/accounting/budgets/:id/versions'),
      ('api:GET /accounting/budget-versions/:id/lines', 'finance', 'GET', '/accounting/budget-versions/:id/lines'),
      ('api:POST /accounting/budget-versions/:id/actions', 'finance', 'POST', '/accounting/budget-versions/:id/actions'),
      ('api:POST /accounting/budget-policies', 'finance', 'POST', '/accounting/budget-policies'),
      ('api:GET /accounting/budget-policies', 'finance', 'GET', '/accounting/budget-policies'),
      ('api:POST /accounting/budget-consumptions', 'finance', 'POST', '/accounting/budget-consumptions'),
      ('api:POST /accounting/budget-consumptions/:id/release', 'finance', 'POST', '/accounting/budget-consumptions/:id/release')
`;

const API_RESOURCE_CODES = `
       'api:POST /accounting/budgets',
       'api:GET /accounting/budgets',
       'api:GET /accounting/budgets/:id',
       'api:GET /accounting/budgets/:id/utilization',
       'api:POST /accounting/budgets/:id/versions',
       'api:GET /accounting/budgets/:id/versions',
       'api:GET /accounting/budget-versions/:id/lines',
       'api:POST /accounting/budget-versions/:id/actions',
       'api:POST /accounting/budget-policies',
       'api:GET /accounting/budget-policies',
       'api:POST /accounting/budget-consumptions',
       'api:POST /accounting/budget-consumptions/:id/release'
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
         WHERE p.proname = 'config_dictionary_api_resource_seed_wave_a6_03'
           AND n.nspname = current_schema()
      ) THEN
        ALTER FUNCTION config_dictionary_api_resource_seed()
          RENAME TO config_dictionary_api_resource_seed_wave_a6_03;
      END IF;
    END
    $$;

    CREATE OR REPLACE FUNCTION config_dictionary_api_resource_seed()
    RETURNS TABLE (code TEXT, name TEXT, module_code TEXT, http_method TEXT, path_pattern TEXT) AS $seed$
      SELECT s.code, s.name, s.module_code, s.http_method, s.path_pattern
        FROM config_dictionary_api_resource_seed_wave_a6_03() s
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
         WHERE p.proname = 'config_dictionary_api_resource_seed_wave_a6_03'
           AND n.nspname = current_schema()
      ) THEN
        ALTER FUNCTION config_dictionary_api_resource_seed()
          RENAME TO config_dictionary_api_resource_seed_tmp;
        ALTER FUNCTION config_dictionary_api_resource_seed_wave_a6_03()
          RENAME TO config_dictionary_api_resource_seed;
        DROP FUNCTION config_dictionary_api_resource_seed_tmp();
      END IF;
    END
    $$;
  `);
};
