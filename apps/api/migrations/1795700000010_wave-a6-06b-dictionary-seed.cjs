/**
 * Wave A6 WP-FIN-A6-06b dictionary seed: consolidation routes.
 * Uses the rename-chain UNION pattern from 1795600000010.
 *
 * No new permissions: routes are governed by the existing
 * finance.accounting.configure / .read / .approve family.
 *
 * Module attribution: `/accounting/*` maps to finance via the existing
 * first-segment rule in module-attribution.ts — no override needed.
 *
 * Routes (20):
 *   POST   /accounting/consolidation-groups
 *   GET    /accounting/consolidation-groups
 *   GET    /accounting/consolidation-groups/:id
 *   POST   /accounting/consolidation-groups/:id/actions
 *   POST   /accounting/consolidation-groups/:id/members
 *   GET    /accounting/consolidation-groups/:id/members
 *   DELETE /accounting/consolidation-groups/:id/members/:legalEntityId
 *   POST   /accounting/fsv-versions
 *   GET    /accounting/fsv-versions
 *   GET    /accounting/fsv-versions/:id/lines
 *   POST   /accounting/fsv-versions/:id/actions
 *   POST   /accounting/fx-rate-sets
 *   GET    /accounting/fx-rate-sets
 *   GET    /accounting/fx-rate-sets/:id/rates
 *   POST   /accounting/translation-runs
 *   GET    /accounting/translation-runs
 *   GET    /accounting/translation-runs/:id
 *   POST   /accounting/eliminations
 *   GET    /accounting/eliminations
 *   POST   /accounting/eliminations/:id/actions
 */
exports.shorthands = undefined;

const API_RESOURCE_ROWS = `
      ('api:POST /accounting/consolidation-groups', 'finance', 'POST', '/accounting/consolidation-groups'),
      ('api:GET /accounting/consolidation-groups', 'finance', 'GET', '/accounting/consolidation-groups'),
      ('api:GET /accounting/consolidation-groups/:id', 'finance', 'GET', '/accounting/consolidation-groups/:id'),
      ('api:POST /accounting/consolidation-groups/:id/actions', 'finance', 'POST', '/accounting/consolidation-groups/:id/actions'),
      ('api:POST /accounting/consolidation-groups/:id/members', 'finance', 'POST', '/accounting/consolidation-groups/:id/members'),
      ('api:GET /accounting/consolidation-groups/:id/members', 'finance', 'GET', '/accounting/consolidation-groups/:id/members'),
      ('api:DELETE /accounting/consolidation-groups/:id/members/:legalEntityId', 'finance', 'DELETE', '/accounting/consolidation-groups/:id/members/:legalEntityId'),
      ('api:POST /accounting/fsv-versions', 'finance', 'POST', '/accounting/fsv-versions'),
      ('api:GET /accounting/fsv-versions', 'finance', 'GET', '/accounting/fsv-versions'),
      ('api:GET /accounting/fsv-versions/:id/lines', 'finance', 'GET', '/accounting/fsv-versions/:id/lines'),
      ('api:POST /accounting/fsv-versions/:id/actions', 'finance', 'POST', '/accounting/fsv-versions/:id/actions'),
      ('api:POST /accounting/fx-rate-sets', 'finance', 'POST', '/accounting/fx-rate-sets'),
      ('api:GET /accounting/fx-rate-sets', 'finance', 'GET', '/accounting/fx-rate-sets'),
      ('api:GET /accounting/fx-rate-sets/:id/rates', 'finance', 'GET', '/accounting/fx-rate-sets/:id/rates'),
      ('api:POST /accounting/translation-runs', 'finance', 'POST', '/accounting/translation-runs'),
      ('api:GET /accounting/translation-runs', 'finance', 'GET', '/accounting/translation-runs'),
      ('api:GET /accounting/translation-runs/:id', 'finance', 'GET', '/accounting/translation-runs/:id'),
      ('api:POST /accounting/eliminations', 'finance', 'POST', '/accounting/eliminations'),
      ('api:GET /accounting/eliminations', 'finance', 'GET', '/accounting/eliminations'),
      ('api:POST /accounting/eliminations/:id/actions', 'finance', 'POST', '/accounting/eliminations/:id/actions')
`;

const API_RESOURCE_CODES = `
       'api:POST /accounting/consolidation-groups',
       'api:GET /accounting/consolidation-groups',
       'api:GET /accounting/consolidation-groups/:id',
       'api:POST /accounting/consolidation-groups/:id/actions',
       'api:POST /accounting/consolidation-groups/:id/members',
       'api:GET /accounting/consolidation-groups/:id/members',
       'api:DELETE /accounting/consolidation-groups/:id/members/:legalEntityId',
       'api:POST /accounting/fsv-versions',
       'api:GET /accounting/fsv-versions',
       'api:GET /accounting/fsv-versions/:id/lines',
       'api:POST /accounting/fsv-versions/:id/actions',
       'api:POST /accounting/fx-rate-sets',
       'api:GET /accounting/fx-rate-sets',
       'api:GET /accounting/fx-rate-sets/:id/rates',
       'api:POST /accounting/translation-runs',
       'api:GET /accounting/translation-runs',
       'api:GET /accounting/translation-runs/:id',
       'api:POST /accounting/eliminations',
       'api:GET /accounting/eliminations',
       'api:POST /accounting/eliminations/:id/actions'
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
         WHERE p.proname = 'config_dictionary_api_resource_seed_wave_a6_06b'
           AND n.nspname = current_schema()
      ) THEN
        ALTER FUNCTION config_dictionary_api_resource_seed()
          RENAME TO config_dictionary_api_resource_seed_wave_a6_06b;
      END IF;
    END
    $$;

    CREATE OR REPLACE FUNCTION config_dictionary_api_resource_seed()
    RETURNS TABLE (code TEXT, name TEXT, module_code TEXT, http_method TEXT, path_pattern TEXT) AS $seed$
      SELECT s.code, s.name, s.module_code, s.http_method, s.path_pattern
        FROM config_dictionary_api_resource_seed_wave_a6_06b() s
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
         WHERE p.proname = 'config_dictionary_api_resource_seed_wave_a6_06b'
           AND n.nspname = current_schema()
      ) THEN
        ALTER FUNCTION config_dictionary_api_resource_seed()
          RENAME TO config_dictionary_api_resource_seed_tmp;
        ALTER FUNCTION config_dictionary_api_resource_seed_wave_a6_06b()
          RENAME TO config_dictionary_api_resource_seed;
        DROP FUNCTION config_dictionary_api_resource_seed_tmp();
      END IF;
    END
    $$;
  `);
};
