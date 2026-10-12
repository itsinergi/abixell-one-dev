/**
 * WP-OPS-03 Phase 6 dictionary seed: Billing/AR routes and permission.
 * Uses the rename-chain UNION pattern from 1794300000020.
 *
 * Route governance: POST create-invoice requires
 * service_operations.billing.manage; GET invoice uses the read tier.
 *
 * Routes (2):
 *   POST /work-orders/:id/create-invoice
 *   GET  /work-orders/:id/invoice
 */
exports.shorthands = undefined;

const API_RESOURCE_ROWS = `
      ('api:POST /work-orders/:id/create-invoice', 'service_operations', 'POST', '/work-orders/:id/create-invoice'),
      ('api:GET /work-orders/:id/invoice', 'service_operations', 'GET', '/work-orders/:id/invoice')
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
         WHERE p.proname = 'config_dictionary_api_resource_seed_phase6_ops03'
           AND n.nspname = current_schema()
      ) THEN
        ALTER FUNCTION config_dictionary_api_resource_seed()
          RENAME TO config_dictionary_api_resource_seed_phase6_ops03;
      END IF;
    END
    $$;

    CREATE OR REPLACE FUNCTION config_dictionary_api_resource_seed()
    RETURNS TABLE (code TEXT, name TEXT, module_code TEXT, http_method TEXT, path_pattern TEXT) AS $seed$
      SELECT s.code, s.name, s.module_code, s.http_method, s.path_pattern
        FROM config_dictionary_api_resource_seed_phase6_ops03() s
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

    -- Process seed: service_operations.billing.manage was added as a permission
    -- in 1794400000000; the dictionary parity gate requires every permission to
    -- have a matching app_processes row, so extend the process-seed UNION chain
    -- the same way the API-resource chain above is extended.
    DO $$
    BEGIN
      IF EXISTS (
        SELECT 1 FROM pg_proc p
          JOIN pg_namespace n ON n.oid = p.pronamespace
         WHERE p.proname = 'config_dictionary_process_seed'
           AND n.nspname = current_schema()
      ) AND NOT EXISTS (
        SELECT 1 FROM pg_proc p
          JOIN pg_namespace n ON n.oid = p.pronamespace
         WHERE p.proname = 'config_dictionary_process_seed_phase6_ops03'
           AND n.nspname = current_schema()
      ) THEN
        ALTER FUNCTION config_dictionary_process_seed()
          RENAME TO config_dictionary_process_seed_phase6_ops03;
      END IF;
    END
    $$;

    CREATE OR REPLACE FUNCTION config_dictionary_process_seed()
    RETURNS TABLE (code TEXT, name TEXT, module_code TEXT) AS $seed$
      SELECT s.code, s.name, s.module_code
        FROM config_dictionary_process_seed_phase6_ops03() s
      UNION
      SELECT 'service_operations.billing.manage',
             'Manage Service Operations Billing / AR',
             'service_operations'
       WHERE NOT EXISTS (
         SELECT 1 FROM config_dictionary_process_seed_phase6_ops03() l
          WHERE l.code = 'service_operations.billing.manage'
       );
    $seed$ LANGUAGE sql IMMUTABLE;

    INSERT INTO app_processes (tenant_id, code, name, module_code)
    SELECT t.id, s.code, s.name, s.module_code
      FROM tenants t
      CROSS JOIN config_dictionary_process_seed() s
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

    DELETE FROM app_processes WHERE code = 'service_operations.billing.manage';

    -- Restore the canonical functions only when this migration's chain
    -- actually renamed them. A guard is required because an older revision of
    -- this migration (already applied on some databases) touched only the
    -- API-resource chain; there the canonical process function was never
    -- renamed, and dropping it would lose the whole catalogue.
    DO $$
    BEGIN
      IF EXISTS (
        SELECT 1 FROM pg_proc p
          JOIN pg_namespace n ON n.oid = p.pronamespace
         WHERE p.proname = 'config_dictionary_api_resource_seed_phase6_ops03'
           AND n.nspname = current_schema()
      ) THEN
        DROP FUNCTION IF EXISTS config_dictionary_api_resource_seed();
        ALTER FUNCTION config_dictionary_api_resource_seed_phase6_ops03()
          RENAME TO config_dictionary_api_resource_seed;
      END IF;
    END
    $$;

    DO $$
    BEGIN
      IF EXISTS (
        SELECT 1 FROM pg_proc p
          JOIN pg_namespace n ON n.oid = p.pronamespace
         WHERE p.proname = 'config_dictionary_process_seed_phase6_ops03'
           AND n.nspname = current_schema()
      ) THEN
        DROP FUNCTION IF EXISTS config_dictionary_process_seed();
        ALTER FUNCTION config_dictionary_process_seed_phase6_ops03()
          RENAME TO config_dictionary_process_seed;
      END IF;
    END
    $$;
  `);
};
