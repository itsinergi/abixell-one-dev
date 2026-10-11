/**
 * WP-OPS-01 Phase 6 dictionary seed — registers the acceptance-gate routes in
 * the API-resource dictionary, rename-chain UNION pattern (1794100000040).
 * No new permissions: the authenticated surfaces are governed by the existing
 * service_operations.verify/manage family; the public routes are token-bounded
 * entry points (see WINDOW_ENFORCEMENT_EXEMPTIONS).
 *
 * Module attribution: `/public/work-orders/*` is a Work Order write, so these
 * rows carry service_operations — matched by the `/public/work-orders`
 * override in module-attribution.ts, not the `public` first-segment row.
 *
 * Routes (6):
 *   POST /work-orders/:id/acceptance-token
 *   POST /work-orders/:id/customer-accept
 *   POST /work-orders/:id/customer-reject
 *   GET  /public/work-orders/acceptance/:token
 *   POST /public/work-orders/acceptance/:token/accept
 *   POST /public/work-orders/acceptance/:token/reject
 */
exports.shorthands = undefined;

const API_RESOURCE_ROWS = `
      ('api:POST /work-orders/:id/acceptance-token', 'service_operations', 'POST', '/work-orders/:id/acceptance-token'),
      ('api:POST /work-orders/:id/customer-accept', 'service_operations', 'POST', '/work-orders/:id/customer-accept'),
      ('api:POST /work-orders/:id/customer-reject', 'service_operations', 'POST', '/work-orders/:id/customer-reject'),
      ('api:GET /public/work-orders/acceptance/:token', 'service_operations', 'GET', '/public/work-orders/acceptance/:token'),
      ('api:POST /public/work-orders/acceptance/:token/accept', 'service_operations', 'POST', '/public/work-orders/acceptance/:token/accept'),
      ('api:POST /public/work-orders/acceptance/:token/reject', 'service_operations', 'POST', '/public/work-orders/acceptance/:token/reject')
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
         WHERE p.proname = 'config_dictionary_api_resource_seed_phase6_ops01'
           AND n.nspname = current_schema()
      ) THEN
        ALTER FUNCTION config_dictionary_api_resource_seed()
          RENAME TO config_dictionary_api_resource_seed_phase6_ops01;
      END IF;
    END
    $$;

    CREATE OR REPLACE FUNCTION config_dictionary_api_resource_seed()
    RETURNS TABLE (code TEXT, name TEXT, module_code TEXT, http_method TEXT, path_pattern TEXT) AS $seed$
      SELECT s.code, s.name, s.module_code, s.http_method, s.path_pattern
        FROM config_dictionary_api_resource_seed_phase6_ops01() s
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
         WHERE p.proname = 'config_dictionary_api_resource_seed_phase6_ops01'
           AND n.nspname = current_schema()
      ) THEN
        ALTER FUNCTION config_dictionary_api_resource_seed_phase6_ops01()
          RENAME TO config_dictionary_api_resource_seed;
      END IF;
    END
    $$;
  `);
};
