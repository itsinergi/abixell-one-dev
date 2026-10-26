/**
 * Wave A7 dictionary seed: Project Delivery Advanced + HSE Advanced.
 *
 * The schema migrations (1796000000000, 1796100000000) catalogued 10 new
 * permissions and registered 61 new HTTP routes, but neither extends the
 * dictionary seed functions. Without this migration a fresh tenant gets a
 * dictionary that describes an application that no longer exists — the exact
 * drift `tests/dictionary-seed-parity.test.ts` exists to make visible.
 *
 * Follows the rename-chain UNION pattern of 1795700000010: snapshot the
 * canonical function under a fresh suffix, then redefine canonical as that
 * snapshot UNION the new rows, then backfill existing tenants.
 *
 * Module attribution comes from the existing prefix / first-segment rules in
 * module-attribution.ts — `project_delivery.` and `hse.` prefixes, and the
 * `/project-delivery` / `/hse` first segments — so no override is needed.
 *
 * Permissions (10):
 *   project_delivery.advanced.read
 *   project_delivery.advanced.manage
 *   project_delivery.cost.read
 *   project_delivery.cost.manage
 *   hse.advanced.read
 *   hse.advanced.manage
 *   hse.investigation.lead
 *   hse.permit.request
 *   hse.capa.verify
 *   hse.indicator.compute
 *
 * Routes (61): see API_RESOURCE_ROWS.
 */
exports.shorthands = undefined;

const API_RESOURCE_ROWS = `
      ('api:DELETE /project-delivery/dependencies/:id', 'project_delivery', 'DELETE', '/project-delivery/dependencies/:id'),
      ('api:GET /hse/advanced/capas', 'hse', 'GET', '/hse/advanced/capas'),
      ('api:GET /hse/advanced/capas/:id', 'hse', 'GET', '/hse/advanced/capas/:id'),
      ('api:GET /hse/advanced/frameworks', 'hse', 'GET', '/hse/advanced/frameworks'),
      ('api:GET /hse/advanced/indicators', 'hse', 'GET', '/hse/advanced/indicators'),
      ('api:GET /hse/advanced/investigations', 'hse', 'GET', '/hse/advanced/investigations'),
      ('api:GET /hse/advanced/investigations/:id', 'hse', 'GET', '/hse/advanced/investigations/:id'),
      ('api:GET /hse/advanced/monitoring-points', 'hse', 'GET', '/hse/advanced/monitoring-points'),
      ('api:GET /hse/advanced/monitoring-points/:id/readings', 'hse', 'GET', '/hse/advanced/monitoring-points/:id/readings'),
      ('api:GET /hse/advanced/occurrences/:id/findings', 'hse', 'GET', '/hse/advanced/occurrences/:id/findings'),
      ('api:GET /hse/advanced/permits', 'hse', 'GET', '/hse/advanced/permits'),
      ('api:GET /hse/advanced/permits/:id', 'hse', 'GET', '/hse/advanced/permits/:id'),
      ('api:GET /hse/advanced/programmes', 'hse', 'GET', '/hse/advanced/programmes'),
      ('api:GET /hse/advanced/programmes/:id/occurrences', 'hse', 'GET', '/hse/advanced/programmes/:id/occurrences'),
      ('api:GET /hse/advanced/risk-assessments', 'hse', 'GET', '/hse/advanced/risk-assessments'),
      ('api:GET /hse/advanced/risk-assessments/:id', 'hse', 'GET', '/hse/advanced/risk-assessments/:id'),
      ('api:GET /hse/advanced/risk-matrix', 'hse', 'GET', '/hse/advanced/risk-matrix'),
      ('api:GET /project-delivery/projects/:projectId/baseline-variance', 'project_delivery', 'GET', '/project-delivery/projects/:projectId/baseline-variance'),
      ('api:GET /project-delivery/projects/:projectId/baselines', 'project_delivery', 'GET', '/project-delivery/projects/:projectId/baselines'),
      ('api:GET /project-delivery/projects/:projectId/cost-entries', 'project_delivery', 'GET', '/project-delivery/projects/:projectId/cost-entries'),
      ('api:GET /project-delivery/projects/:projectId/cost-position', 'project_delivery', 'GET', '/project-delivery/projects/:projectId/cost-position'),
      ('api:GET /project-delivery/projects/:projectId/dependencies', 'project_delivery', 'GET', '/project-delivery/projects/:projectId/dependencies'),
      ('api:GET /project-delivery/projects/:projectId/earned-value', 'project_delivery', 'GET', '/project-delivery/projects/:projectId/earned-value'),
      ('api:GET /project-delivery/projects/:projectId/earned-value-snapshots', 'project_delivery', 'GET', '/project-delivery/projects/:projectId/earned-value-snapshots'),
      ('api:GET /project-delivery/projects/:projectId/gantt', 'project_delivery', 'GET', '/project-delivery/projects/:projectId/gantt'),
      ('api:GET /project-delivery/projects/:projectId/resource-loading', 'project_delivery', 'GET', '/project-delivery/projects/:projectId/resource-loading'),
      ('api:GET /project-delivery/projects/:projectId/schedule', 'project_delivery', 'GET', '/project-delivery/projects/:projectId/schedule'),
      ('api:GET /project-delivery/projects/:projectId/wbs', 'project_delivery', 'GET', '/project-delivery/projects/:projectId/wbs'),
      ('api:GET /project-delivery/resources', 'project_delivery', 'GET', '/project-delivery/resources'),
      ('api:PATCH /hse/advanced/capas/:id/status', 'hse', 'PATCH', '/hse/advanced/capas/:id/status'),
      ('api:PATCH /hse/advanced/investigations/:id', 'hse', 'PATCH', '/hse/advanced/investigations/:id'),
      ('api:PATCH /hse/advanced/permits/:id', 'hse', 'PATCH', '/hse/advanced/permits/:id'),
      ('api:PATCH /project-delivery/wbs/:id', 'project_delivery', 'PATCH', '/project-delivery/wbs/:id'),
      ('api:POST /hse/advanced/capas', 'hse', 'POST', '/hse/advanced/capas'),
      ('api:POST /hse/advanced/capas/:id/actions', 'hse', 'POST', '/hse/advanced/capas/:id/actions'),
      ('api:POST /hse/advanced/capas/:id/actions/:actionId/complete', 'hse', 'POST', '/hse/advanced/capas/:id/actions/:actionId/complete'),
      ('api:POST /hse/advanced/frameworks', 'hse', 'POST', '/hse/advanced/frameworks'),
      ('api:POST /hse/advanced/indicators', 'hse', 'POST', '/hse/advanced/indicators'),
      ('api:POST /hse/advanced/monitoring-points', 'hse', 'POST', '/hse/advanced/monitoring-points'),
      ('api:POST /hse/advanced/monitoring-points/:id/readings', 'hse', 'POST', '/hse/advanced/monitoring-points/:id/readings'),
      ('api:POST /hse/advanced/occurrences/:id/complete', 'hse', 'POST', '/hse/advanced/occurrences/:id/complete'),
      ('api:POST /hse/advanced/occurrences/:id/findings', 'hse', 'POST', '/hse/advanced/occurrences/:id/findings'),
      ('api:POST /hse/advanced/permits', 'hse', 'POST', '/hse/advanced/permits'),
      ('api:POST /hse/advanced/permits/:id/act', 'hse', 'POST', '/hse/advanced/permits/:id/act'),
      ('api:POST /hse/advanced/permits/:id/start-lifecycle', 'hse', 'POST', '/hse/advanced/permits/:id/start-lifecycle'),
      ('api:POST /hse/advanced/programmes', 'hse', 'POST', '/hse/advanced/programmes'),
      ('api:POST /hse/advanced/programmes/:id/occurrences', 'hse', 'POST', '/hse/advanced/programmes/:id/occurrences'),
      ('api:POST /hse/advanced/records/:recordId/investigations', 'hse', 'POST', '/hse/advanced/records/:recordId/investigations'),
      ('api:POST /hse/advanced/risk-assessments', 'hse', 'POST', '/hse/advanced/risk-assessments'),
      ('api:POST /hse/advanced/risk-matrices', 'hse', 'POST', '/hse/advanced/risk-matrices'),
      ('api:POST /project-delivery/baselines/:id/approve', 'project_delivery', 'POST', '/project-delivery/baselines/:id/approve'),
      ('api:POST /project-delivery/cost-entries/:id/post', 'project_delivery', 'POST', '/project-delivery/cost-entries/:id/post'),
      ('api:POST /project-delivery/cost-entries/:id/reverse', 'project_delivery', 'POST', '/project-delivery/cost-entries/:id/reverse'),
      ('api:POST /project-delivery/projects/:projectId/baselines', 'project_delivery', 'POST', '/project-delivery/projects/:projectId/baselines'),
      ('api:POST /project-delivery/projects/:projectId/cost-entries', 'project_delivery', 'POST', '/project-delivery/projects/:projectId/cost-entries'),
      ('api:POST /project-delivery/projects/:projectId/dependencies', 'project_delivery', 'POST', '/project-delivery/projects/:projectId/dependencies'),
      ('api:POST /project-delivery/projects/:projectId/earned-value-snapshots', 'project_delivery', 'POST', '/project-delivery/projects/:projectId/earned-value-snapshots'),
      ('api:POST /project-delivery/projects/:projectId/resource-assignments', 'project_delivery', 'POST', '/project-delivery/projects/:projectId/resource-assignments'),
      ('api:POST /project-delivery/projects/:projectId/wbs', 'project_delivery', 'POST', '/project-delivery/projects/:projectId/wbs'),
      ('api:POST /project-delivery/resources', 'project_delivery', 'POST', '/project-delivery/resources'),
      ('api:PUT /project-delivery/activities/:activityId/wbs-node', 'project_delivery', 'PUT', '/project-delivery/activities/:activityId/wbs-node')
`;

const PROCESS_ROWS = `
      SELECT 'project_delivery.advanced.read', 'View project WBS, schedule, critical path, resources, baselines, and earned value', 'project_delivery'
       WHERE NOT EXISTS (
         SELECT 1 FROM config_dictionary_process_seed_wave_a7() l WHERE l.code = 'project_delivery.advanced.read'
       )
      UNION
      SELECT 'project_delivery.advanced.manage', 'Manage project WBS, dependencies, resources, baselines, and earned-value snapshots', 'project_delivery'
       WHERE NOT EXISTS (
         SELECT 1 FROM config_dictionary_process_seed_wave_a7() l WHERE l.code = 'project_delivery.advanced.manage'
       )
      UNION
      SELECT 'project_delivery.cost.read', 'View project cost entries, commitments, and cost position', 'project_delivery'
       WHERE NOT EXISTS (
         SELECT 1 FROM config_dictionary_process_seed_wave_a7() l WHERE l.code = 'project_delivery.cost.read'
       )
      UNION
      SELECT 'project_delivery.cost.manage', 'Record and reverse project cost entries and emit them to the Accounting Kernel', 'project_delivery'
       WHERE NOT EXISTS (
         SELECT 1 FROM config_dictionary_process_seed_wave_a7() l WHERE l.code = 'project_delivery.cost.manage'
       )
      UNION
      SELECT 'hse.advanced.read', 'View HSE investigations, risk assessments, permits, programmes, monitoring, CAPA, and indicators', 'hse'
       WHERE NOT EXISTS (
         SELECT 1 FROM config_dictionary_process_seed_wave_a7() l WHERE l.code = 'hse.advanced.read'
       )
      UNION
      SELECT 'hse.advanced.manage', 'Manage HSE investigations, risk assessments, permit content, programmes, monitoring points, and CAPA', 'hse'
       WHERE NOT EXISTS (
         SELECT 1 FROM config_dictionary_process_seed_wave_a7() l WHERE l.code = 'hse.advanced.manage'
       )
      UNION
      SELECT 'hse.investigation.lead', 'Record findings and determine root cause on an HSE investigation', 'hse'
       WHERE NOT EXISTS (
         SELECT 1 FROM config_dictionary_process_seed_wave_a7() l WHERE l.code = 'hse.investigation.lead'
       )
      UNION
      SELECT 'hse.permit.request', 'Request a Permit to Work', 'hse'
       WHERE NOT EXISTS (
         SELECT 1 FROM config_dictionary_process_seed_wave_a7() l WHERE l.code = 'hse.permit.request'
       )
      UNION
      SELECT 'hse.capa.verify', 'Verify CAPA effectiveness and close a CAPA', 'hse'
       WHERE NOT EXISTS (
         SELECT 1 FROM config_dictionary_process_seed_wave_a7() l WHERE l.code = 'hse.capa.verify'
       )
      UNION
      SELECT 'hse.indicator.compute', 'Compute and freeze HSE indicator snapshots', 'hse'
       WHERE NOT EXISTS (
         SELECT 1 FROM config_dictionary_process_seed_wave_a7() l WHERE l.code = 'hse.indicator.compute'
       )
`;

const PERMISSION_CODES = `
       'project_delivery.advanced.read',
       'project_delivery.advanced.manage',
       'project_delivery.cost.read',
       'project_delivery.cost.manage',
       'hse.advanced.read',
       'hse.advanced.manage',
       'hse.investigation.lead',
       'hse.permit.request',
       'hse.capa.verify',
       'hse.indicator.compute'
`;

exports.up = (pgm) => {
  pgm.sql(`
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
         WHERE p.proname = 'config_dictionary_process_seed_wave_a7'
           AND n.nspname = current_schema()
      ) THEN
        ALTER FUNCTION config_dictionary_process_seed()
          RENAME TO config_dictionary_process_seed_wave_a7;
      END IF;
    END
    $$;

    CREATE OR REPLACE FUNCTION config_dictionary_process_seed()
    RETURNS TABLE (code TEXT, name TEXT, module_code TEXT) AS $seed$
      SELECT s.code, s.name, s.module_code
        FROM config_dictionary_process_seed_wave_a7() s
      UNION
${PROCESS_ROWS};
    $seed$ LANGUAGE sql IMMUTABLE;

    INSERT INTO app_processes (tenant_id, code, name, module_code)
    SELECT t.id, s.code, s.name, s.module_code
      FROM tenants t
      CROSS JOIN config_dictionary_process_seed() s
    ON CONFLICT (tenant_id, code) DO NOTHING;

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
         WHERE p.proname = 'config_dictionary_api_resource_seed_wave_a7'
           AND n.nspname = current_schema()
      ) THEN
        ALTER FUNCTION config_dictionary_api_resource_seed()
          RENAME TO config_dictionary_api_resource_seed_wave_a7;
      END IF;
    END
    $$;

    CREATE OR REPLACE FUNCTION config_dictionary_api_resource_seed()
    RETURNS TABLE (code TEXT, name TEXT, module_code TEXT, http_method TEXT, path_pattern TEXT) AS $seed$
      SELECT s.code, s.name, s.module_code, s.http_method, s.path_pattern
        FROM config_dictionary_api_resource_seed_wave_a7() s
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

    DELETE FROM app_processes WHERE code IN (
      ${PERMISSION_CODES}
    );

    DROP FUNCTION IF EXISTS config_dictionary_process_seed();
    DROP FUNCTION IF EXISTS config_dictionary_api_resource_seed();

    DO $$
    BEGIN
      IF EXISTS (
        SELECT 1 FROM pg_proc p
          JOIN pg_namespace n ON n.oid = p.pronamespace
         WHERE p.proname = 'config_dictionary_process_seed_wave_a7'
           AND n.nspname = current_schema()
      ) THEN
        ALTER FUNCTION config_dictionary_process_seed_wave_a7()
          RENAME TO config_dictionary_process_seed;
      END IF;

      IF EXISTS (
        SELECT 1 FROM pg_proc p
          JOIN pg_namespace n ON n.oid = p.pronamespace
         WHERE p.proname = 'config_dictionary_api_resource_seed_wave_a7'
           AND n.nspname = current_schema()
      ) THEN
        ALTER FUNCTION config_dictionary_api_resource_seed_wave_a7()
          RENAME TO config_dictionary_api_resource_seed;
      END IF;
    END
    $$;
  `);
};
