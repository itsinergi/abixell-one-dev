/**
 * Wave A6 WP-FIN-A6-04 dictionary seed: bank reconciliation routes.
 * Uses the rename-chain UNION pattern from 1795200000010.
 *
 * No new permissions: routes are governed by the existing
 * finance.accounting.configure / .read / .approve family.
 *
 * Module attribution: `/accounting/*` maps to finance via the existing
 * first-segment rule in module-attribution.ts — no override needed.
 *
 * Routes (14):
 *   POST   /accounting/bank-accounts
 *   GET    /accounting/bank-accounts
 *   GET    /accounting/bank-accounts/:id
 *   POST   /accounting/bank-statements/import
 *   GET    /accounting/bank-statement-lines
 *   GET    /accounting/bank-statement-lines/:id/candidates
 *   POST   /accounting/bank-reconciliations
 *   GET    /accounting/bank-reconciliations
 *   GET    /accounting/bank-reconciliations/:id
 *   GET    /accounting/bank-reconciliations/:id/matches
 *   POST   /accounting/bank-reconciliations/:id/close
 *   POST   /accounting/bank-matches
 *   POST   /accounting/bank-matches/:id/reverse
 *   GET    /accounting/bank-period-movement
 */
exports.shorthands = undefined;

const API_RESOURCE_ROWS = `
      ('api:POST /accounting/bank-accounts', 'finance', 'POST', '/accounting/bank-accounts'),
      ('api:GET /accounting/bank-accounts', 'finance', 'GET', '/accounting/bank-accounts'),
      ('api:GET /accounting/bank-accounts/:id', 'finance', 'GET', '/accounting/bank-accounts/:id'),
      ('api:POST /accounting/bank-statements/import', 'finance', 'POST', '/accounting/bank-statements/import'),
      ('api:GET /accounting/bank-statement-lines', 'finance', 'GET', '/accounting/bank-statement-lines'),
      ('api:GET /accounting/bank-statement-lines/:id/candidates', 'finance', 'GET', '/accounting/bank-statement-lines/:id/candidates'),
      ('api:POST /accounting/bank-reconciliations', 'finance', 'POST', '/accounting/bank-reconciliations'),
      ('api:GET /accounting/bank-reconciliations', 'finance', 'GET', '/accounting/bank-reconciliations'),
      ('api:GET /accounting/bank-reconciliations/:id', 'finance', 'GET', '/accounting/bank-reconciliations/:id'),
      ('api:GET /accounting/bank-reconciliations/:id/matches', 'finance', 'GET', '/accounting/bank-reconciliations/:id/matches'),
      ('api:POST /accounting/bank-reconciliations/:id/close', 'finance', 'POST', '/accounting/bank-reconciliations/:id/close'),
      ('api:POST /accounting/bank-matches', 'finance', 'POST', '/accounting/bank-matches'),
      ('api:POST /accounting/bank-matches/:id/reverse', 'finance', 'POST', '/accounting/bank-matches/:id/reverse'),
      ('api:GET /accounting/bank-period-movement', 'finance', 'GET', '/accounting/bank-period-movement')
`;

const API_RESOURCE_CODES = `
       'api:POST /accounting/bank-accounts',
       'api:GET /accounting/bank-accounts',
       'api:GET /accounting/bank-accounts/:id',
       'api:POST /accounting/bank-statements/import',
       'api:GET /accounting/bank-statement-lines',
       'api:GET /accounting/bank-statement-lines/:id/candidates',
       'api:POST /accounting/bank-reconciliations',
       'api:GET /accounting/bank-reconciliations',
       'api:GET /accounting/bank-reconciliations/:id',
       'api:GET /accounting/bank-reconciliations/:id/matches',
       'api:POST /accounting/bank-reconciliations/:id/close',
       'api:POST /accounting/bank-matches',
       'api:POST /accounting/bank-matches/:id/reverse',
       'api:GET /accounting/bank-period-movement'
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
         WHERE p.proname = 'config_dictionary_api_resource_seed_wave_a6_04'
           AND n.nspname = current_schema()
      ) THEN
        ALTER FUNCTION config_dictionary_api_resource_seed()
          RENAME TO config_dictionary_api_resource_seed_wave_a6_04;
      END IF;
    END
    $$;

    CREATE OR REPLACE FUNCTION config_dictionary_api_resource_seed()
    RETURNS TABLE (code TEXT, name TEXT, module_code TEXT, http_method TEXT, path_pattern TEXT) AS $seed$
      SELECT s.code, s.name, s.module_code, s.http_method, s.path_pattern
        FROM config_dictionary_api_resource_seed_wave_a6_04() s
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
         WHERE p.proname = 'config_dictionary_api_resource_seed_wave_a6_04'
           AND n.nspname = current_schema()
      ) THEN
        ALTER FUNCTION config_dictionary_api_resource_seed()
          RENAME TO config_dictionary_api_resource_seed_tmp;
        ALTER FUNCTION config_dictionary_api_resource_seed_wave_a6_04()
          RENAME TO config_dictionary_api_resource_seed;
        DROP FUNCTION config_dictionary_api_resource_seed_tmp();
      END IF;
    END
    $$;
  `);
};