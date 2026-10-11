/**
 * WP-MD-03 catering dictionary seed — registers the catering vertical routes
 * in the API-resource dictionary, rename-chain UNION pattern (1794100000020).
 * No new permissions: the surfaces are governed by the existing
 * service_operations.configure/read/manage family.
 *
 * Routes (13):
 *   POST   /catering/menus
 *   GET    /catering/menus
 *   POST   /catering/recipes
 *   GET    /catering/recipes
 *   GET    /catering/recipes/:code
 *   PUT    /catering/recipes/:code/ingredients
 *   GET    /catering/recipes/:code/ingredients
 *   POST   /catering/recipes/:code/cost
 *   POST   /catering/meal-plans
 *   GET    /catering/meal-plans
 *   POST   /catering/meal-batches
 *   GET    /catering/meal-batches
 *   POST   /catering/meal-batches/:batchNumber/status
 */
exports.shorthands = undefined;

const API_RESOURCE_ROWS = `
      ('api:POST /catering/menus', 'service_operations', 'POST', '/catering/menus'),
      ('api:GET /catering/menus', 'service_operations', 'GET', '/catering/menus'),
      ('api:POST /catering/recipes', 'service_operations', 'POST', '/catering/recipes'),
      ('api:GET /catering/recipes', 'service_operations', 'GET', '/catering/recipes'),
      ('api:GET /catering/recipes/:code', 'service_operations', 'GET', '/catering/recipes/:code'),
      ('api:PUT /catering/recipes/:code/ingredients', 'service_operations', 'PUT', '/catering/recipes/:code/ingredients'),
      ('api:GET /catering/recipes/:code/ingredients', 'service_operations', 'GET', '/catering/recipes/:code/ingredients'),
      ('api:POST /catering/recipes/:code/cost', 'service_operations', 'POST', '/catering/recipes/:code/cost'),
      ('api:POST /catering/meal-plans', 'service_operations', 'POST', '/catering/meal-plans'),
      ('api:GET /catering/meal-plans', 'service_operations', 'GET', '/catering/meal-plans'),
      ('api:POST /catering/meal-batches', 'service_operations', 'POST', '/catering/meal-batches'),
      ('api:GET /catering/meal-batches', 'service_operations', 'GET', '/catering/meal-batches'),
      ('api:POST /catering/meal-batches/:batchNumber/status', 'service_operations', 'POST', '/catering/meal-batches/:batchNumber/status')
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
         WHERE p.proname = 'config_dictionary_api_resource_seed_phase5_md03'
           AND n.nspname = current_schema()
      ) THEN
        ALTER FUNCTION config_dictionary_api_resource_seed()
          RENAME TO config_dictionary_api_resource_seed_phase5_md03;
      END IF;
    END
    $$;

    CREATE OR REPLACE FUNCTION config_dictionary_api_resource_seed()
    RETURNS TABLE (code TEXT, name TEXT, module_code TEXT, http_method TEXT, path_pattern TEXT) AS $seed$
      SELECT s.code, s.name, s.module_code, s.http_method, s.path_pattern
        FROM config_dictionary_api_resource_seed_phase5_md03() s
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
         WHERE p.proname = 'config_dictionary_api_resource_seed_phase5_md03'
           AND n.nspname = current_schema()
      ) THEN
        ALTER FUNCTION config_dictionary_api_resource_seed_phase5_md03()
          RENAME TO config_dictionary_api_resource_seed;
      END IF;
    END
    $$;
  `);
};
