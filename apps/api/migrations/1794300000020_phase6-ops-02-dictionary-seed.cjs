/**
 * WP-OPS-02 Phase 6 dictionary seed — registers the cost-accumulator routes
 * in the API-resource dictionary, rename-chain UNION pattern (1794200000010).
 * No new permissions: the routes are governed by the existing
 * service_operations.read / .manage / .verify family.
 *
 * Module attribution: `/work-orders/*` maps to service_operations via the
 * existing first-segment rule in module-attribution.ts — no override needed.
 *
 * Routes (3):
 *   POST /work-orders/:id/cost-items
 *   GET  /work-orders/:id/cost-items
 *   POST /work-orders/:id/finalize-costs
 */
exports.shorthands = undefined;

const API_RESOURCE_ROWS = `
      ('api:POST /work-orders/:id/cost-items', 'service_operations', 'POST', '/work-orders/:id/cost-items'),
      ('api:GET /work-orders/:id/cost-items', 'service_operations', 'GET', '/work-orders/:id/cost-items'),
      ('api:POST /work-orders/:id/finalize-costs', 'service_operations', 'POST', '/work-orders/:id/finalize-costs')
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
         WHERE p.proname = 'config_dictionary_api_resource_seed_phase6_ops02'
           AND n.nspname = current_schema()
      ) THEN
        ALTER FUNCTION config_dictionary_api_resource_seed()
          RENAME TO config_dictionary_api_resource_seed_phase6_ops02;
      END IF;
    END
    $$;

    CREATE OR REPLACE FUNCTION config_dictionary_api_resource_seed()
    RETURNS TABLE (code TEXT, name TEXT, module_code TEXT, http_method TEXT, path_pattern TEXT) AS $seed$
      SELECT s.code, s.name, s.module_code, s.http_method, s.path_pattern
        FROM config_dictionary_api_resource_seed_phase6_ops02() s
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
         WHERE p.proname = 'config_dictionary_api_resource_seed_phase6_ops02'
           AND n.nspname = current_schema()
      ) THEN
        ALTER FUNCTION config_dictionary_api_resource_seed_phase6_ops02()
          RENAME TO config_dictionary_api_resource_seed;
      END IF;
    END
    $$;
  `);
};
