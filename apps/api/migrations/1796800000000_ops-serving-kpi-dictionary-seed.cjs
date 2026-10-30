/**
 * Dictionary seed for SO-CORE-016/017 routes shipped without dictionary rows.
 *
 * The serving phase (4 routes) and KPI dashboard (1 route) added HTTP routes
 * but never extended the dictionary seed, so
 * `tests/dictionary-seed-parity.test.ts` reports them as "served routes with
 * no dictionary row".
 *
 * Follows the rename-chain UNION pattern: snapshot the canonical function
 * under a fresh suffix (_a64), redefine canonical as that snapshot UNION the
 * new rows, then backfill existing tenants.
 *
 * Module attribution comes from `attributeApiPath` in module-attribution.ts:
 *   /work-orders/:id/serving   -> service_operations
 *   /dashboard/management       -> service_operations
 */
exports.shorthands = undefined;

const API_RESOURCE_ROWS = `
      ('api:POST /work-orders/:id/serving', 'service_operations', 'POST', '/work-orders/:id/serving'),
      ('api:GET /work-orders/:id/serving', 'service_operations', 'GET', '/work-orders/:id/serving'),
      ('api:PATCH /work-orders/:id/serving', 'service_operations', 'PATCH', '/work-orders/:id/serving'),
      ('api:GET /dashboard/management', 'service_operations', 'GET', '/dashboard/management')`;

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
         WHERE p.proname = 'config_dictionary_api_resource_seed_a64'
           AND n.nspname = current_schema()
      ) THEN
        ALTER FUNCTION config_dictionary_api_resource_seed()
          RENAME TO config_dictionary_api_resource_seed_a64;
      END IF;
    END
    $$;

    CREATE OR REPLACE FUNCTION config_dictionary_api_resource_seed()
    RETURNS TABLE (code TEXT, name TEXT, module_code TEXT, http_method TEXT, path_pattern TEXT) AS $seed$
      SELECT s.code, s.name, s.module_code, s.http_method, s.path_pattern
        FROM config_dictionary_api_resource_seed_a64() s
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
    DELETE FROM app_api_resources WHERE code IN (
      SELECT a.code FROM (VALUES
        ${API_RESOURCE_ROWS}
      ) AS a(code, module_code, http_method, path_pattern)
    );

    DROP FUNCTION IF EXISTS config_dictionary_api_resource_seed();
    ALTER FUNCTION config_dictionary_api_resource_seed_a64()
      RENAME TO config_dictionary_api_resource_seed;
  `);
};
