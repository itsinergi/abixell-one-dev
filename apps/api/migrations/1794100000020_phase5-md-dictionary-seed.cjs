/**
 * Phase 5 master data dictionary seed — WP-MD-01/02.
 *
 * Registers the new master-data routes in the API-resource dictionary,
 * following the rename-chain UNION pattern (1793000000012). No new
 * permissions: the surfaces are governed by finance.configure/read and
 * supply_chain.configure/read.
 *
 * Routes (15):
 *   POST   /finance/cost-centers
 *   GET    /finance/cost-centers
 *   GET    /finance/cost-centers/:code
 *   PATCH  /finance/cost-centers/:code
 *   POST   /finance/payment-terms
 *   GET    /finance/payment-terms
 *   GET    /finance/payment-terms/:code
 *   PATCH  /finance/payment-terms/:code
 *   POST   /units-of-measure
 *   GET    /units-of-measure
 *   GET    /units-of-measure/:code
 *   DELETE /units-of-measure/:code
 *   POST   /unit-conversions
 *   GET    /unit-conversions
 *   POST   /unit-conversions/convert
 */
exports.shorthands = undefined;

const API_RESOURCE_ROWS = `
      ('api:POST /finance/cost-centers', 'finance', 'POST', '/finance/cost-centers'),
      ('api:GET /finance/cost-centers', 'finance', 'GET', '/finance/cost-centers'),
      ('api:GET /finance/cost-centers/:code', 'finance', 'GET', '/finance/cost-centers/:code'),
      ('api:PATCH /finance/cost-centers/:code', 'finance', 'PATCH', '/finance/cost-centers/:code'),
      ('api:POST /finance/payment-terms', 'finance', 'POST', '/finance/payment-terms'),
      ('api:GET /finance/payment-terms', 'finance', 'GET', '/finance/payment-terms'),
      ('api:GET /finance/payment-terms/:code', 'finance', 'GET', '/finance/payment-terms/:code'),
      ('api:PATCH /finance/payment-terms/:code', 'finance', 'PATCH', '/finance/payment-terms/:code'),
      ('api:POST /units-of-measure', 'supply_chain', 'POST', '/units-of-measure'),
      ('api:GET /units-of-measure', 'supply_chain', 'GET', '/units-of-measure'),
      ('api:GET /units-of-measure/:code', 'supply_chain', 'GET', '/units-of-measure/:code'),
      ('api:DELETE /units-of-measure/:code', 'supply_chain', 'DELETE', '/units-of-measure/:code'),
      ('api:POST /unit-conversions', 'supply_chain', 'POST', '/unit-conversions'),
      ('api:GET /unit-conversions', 'supply_chain', 'GET', '/unit-conversions'),
      ('api:POST /unit-conversions/convert', 'supply_chain', 'POST', '/unit-conversions/convert')
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
         WHERE p.proname = 'config_dictionary_api_resource_seed_phase5'
           AND n.nspname = current_schema()
      ) THEN
        ALTER FUNCTION config_dictionary_api_resource_seed()
          RENAME TO config_dictionary_api_resource_seed_phase5;
      END IF;
    END
    $$;

    CREATE OR REPLACE FUNCTION config_dictionary_api_resource_seed()
    RETURNS TABLE (code TEXT, name TEXT, module_code TEXT, http_method TEXT, path_pattern TEXT) AS $seed$
      SELECT s.code, s.name, s.module_code, s.http_method, s.path_pattern
        FROM config_dictionary_api_resource_seed_phase5() s
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
       SELECT a.code FROM (VALUES
         ${API_RESOURCE_ROWS}
       ) AS a(code, module_code, http_method, path_pattern)
     );

    DROP FUNCTION IF EXISTS config_dictionary_api_resource_seed();

    DO $$
    BEGIN
      IF EXISTS (
        SELECT 1 FROM pg_proc p
          JOIN pg_namespace n ON n.oid = p.pronamespace
         WHERE p.proname = 'config_dictionary_api_resource_seed_phase5'
           AND n.nspname = current_schema()
      ) THEN
        ALTER FUNCTION config_dictionary_api_resource_seed_phase5()
          RENAME TO config_dictionary_api_resource_seed;
      END IF;
    END
    $$;
  `);
};
