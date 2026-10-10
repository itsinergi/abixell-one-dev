/**
 * Phase 4 dictionary seed — WP-APR-02/03/01.
 *
 * Registers the new HTTP routes in the API-resource dictionary and the
 * approval-ceiling feature config in the tenant configuration, following the
 * rename-chain UNION pattern (1792000000011). No new permissions: the SoD and
 * rule-registry surfaces are governed by config.read/config.manage, the
 * workflow ceiling is wired inside WorkflowService.
 *
 * Routes (7):
 *   GET    /sod/rules
 *   POST   /sod/rules
 *   DELETE /sod/rules/:id
 *   GET    /sod/violations
 *   GET    /rule-registry/:key
 *   POST   /rule-registry
 *   PATCH  /rule-registry/:id/status
 */
exports.shorthands = undefined;

const API_RESOURCE_ROWS = `
      ('api:GET /sod/rules', 'platform', 'GET', '/sod/rules'),
      ('api:POST /sod/rules', 'platform', 'POST', '/sod/rules'),
      ('api:DELETE /sod/rules/:id', 'platform', 'DELETE', '/sod/rules/:id'),
      ('api:GET /sod/violations', 'platform', 'GET', '/sod/violations'),
      ('api:GET /rule-registry/:key', 'platform', 'GET', '/rule-registry/:key'),
      ('api:POST /rule-registry', 'platform', 'POST', '/rule-registry'),
      ('api:PATCH /rule-registry/:id/status', 'platform', 'PATCH', '/rule-registry/:id/status')
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
         WHERE p.proname = 'config_dictionary_api_resource_seed_phase4'
           AND n.nspname = current_schema()
      ) THEN
        ALTER FUNCTION config_dictionary_api_resource_seed()
          RENAME TO config_dictionary_api_resource_seed_phase4;
      END IF;
    END
    $$;

    CREATE OR REPLACE FUNCTION config_dictionary_api_resource_seed()
    RETURNS TABLE (code TEXT, name TEXT, module_code TEXT, http_method TEXT, path_pattern TEXT) AS $seed$
      SELECT s.code, s.name, s.module_code, s.http_method, s.path_pattern
        FROM config_dictionary_api_resource_seed_phase4() s
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
         WHERE p.proname = 'config_dictionary_api_resource_seed_phase4'
           AND n.nspname = current_schema()
      ) THEN
        ALTER FUNCTION config_dictionary_api_resource_seed_phase4()
          RENAME TO config_dictionary_api_resource_seed;
      END IF;
    END
    $$;
  `);
};
