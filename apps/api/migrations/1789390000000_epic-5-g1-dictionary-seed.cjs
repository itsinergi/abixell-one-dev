/**
 * Epic 5 Gelombang 1 (§4.5 steps 5 and 7) — Application Dictionary seed for the
 * routes and permissions this wave adds.
 *
 * Three catalogues move together, and the migration that declares a surface is
 * the one that seeds it — `apps/api/tests/dictionary-seed-parity.test.ts`
 * re-derives both lists from their real sources (Fastify's `app.routes` and the
 * `permissions` table) and fails loudly on any drift, so a route or permission
 * left unserialised is a red test rather than a silent gap.
 *
 * ── 1. API resources (11 new rows, all `platform`) ────────────────────────
 *
 *   Department master          POST/GET /departments, PATCH /departments/:id,
 *                              POST /departments/:id/deactivate,
 *                              POST /departments/:id/activate
 *   Legal Entity addresses     GET/POST /legal-entities/:id/addresses,
 *                              PATCH /legal-entities/:id/addresses/:addressId,
 *                              POST .../deactivate
 *   Lifecycle transitions      POST /legal-entities/:id/status,
 *                              POST /organization-units/:id/status
 *
 * The address and status routes are covered by the EXISTING
 * `{ apiPath: "/legal-entities" }` and `{ apiPath: "/organization-units" }`
 * Window rules in `window-enforcement.ts`, which match on a segment boundary —
 * so no Window rule is duplicated here, and none is missing. The `/departments`
 * rule is added there because it is a new first segment.
 *
 * Shape, copied exactly from 1789200000000: the current canonical function is
 * renamed to an `_epic5_g1` snapshot and the canonical name is redefined as that
 * snapshot UNION the new rows. `config_seed_dictionary_for_tenant()` resolves
 * the catalogue function by NAME at execution time, so future tenants are
 * seeded complete without touching the trigger; existing tenants are backfilled
 * by a cross join.
 *
 * ── 2. Permissions ────────────────────────────────────────────────────────
 *
 * `department.read`, `department.create` and `department.update` are inserted
 * with `ON CONFLICT (code) DO NOTHING`, the precedent from
 * 1785000000000_tahap-b-lifecycle-soft-delete.cjs. No `role_permissions` row is
 * written: `scripts/sync-role-permissions.ts` remains the only sanctioned bulk
 * writer, and the test helper `provisionFirstAdmin` grants every catalogued
 * permission to ADMIN, so no role seeding is needed here.
 *
 * ── 3. Processes ──────────────────────────────────────────────────────────
 *
 * Extended the same way 1787700000000_epic-4-wave-1-role-definition.cjs does it,
 * for the same reason it explains there: the parity test asserts that
 * `app_processes` and `permissions` hold exactly the same code set, so a new
 * permission that is not also a seeded Process fails that test.
 *
 * Idempotent: every backfill is `ON CONFLICT DO NOTHING`, and each rename is
 * guarded on the target name not already existing.
 */

exports.shorthands = undefined;

const API_RESOURCE_ADDITIONS = `
        ('api:POST /departments', 'platform', 'POST', '/departments'),
        ('api:GET /departments', 'platform', 'GET', '/departments'),
        ('api:PATCH /departments/:id', 'platform', 'PATCH', '/departments/:id'),
        ('api:POST /departments/:id/deactivate', 'platform', 'POST', '/departments/:id/deactivate'),
        ('api:POST /departments/:id/activate', 'platform', 'POST', '/departments/:id/activate'),
        ('api:GET /legal-entities/:id/addresses', 'platform', 'GET', '/legal-entities/:id/addresses'),
        ('api:POST /legal-entities/:id/addresses', 'platform', 'POST', '/legal-entities/:id/addresses'),
        ('api:PATCH /legal-entities/:id/addresses/:addressId', 'platform', 'PATCH', '/legal-entities/:id/addresses/:addressId'),
        ('api:POST /legal-entities/:id/addresses/:addressId/deactivate', 'platform', 'POST', '/legal-entities/:id/addresses/:addressId/deactivate'),
        ('api:POST /legal-entities/:id/status', 'platform', 'POST', '/legal-entities/:id/status'),
        ('api:POST /organization-units/:id/status', 'platform', 'POST', '/organization-units/:id/status')
`;

exports.up = (pgm) => {
  pgm.sql(`
    -- 1. Keep the previous API-resource snapshot reachable under its own name --
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
         WHERE p.proname = 'config_dictionary_api_resource_seed_epic5_g1'
           AND n.nspname = current_schema()
      ) THEN
        ALTER FUNCTION config_dictionary_api_resource_seed()
          RENAME TO config_dictionary_api_resource_seed_epic5_g1;
      END IF;
    END
    $$;

    -- 2. Extend the canonical API-resource catalogue -------------------------
    CREATE OR REPLACE FUNCTION config_dictionary_api_resource_seed()
    RETURNS TABLE (code TEXT, name TEXT, module_code TEXT, http_method TEXT, path_pattern TEXT) AS $seed$
      SELECT s.code, s.name, s.module_code, s.http_method, s.path_pattern
        FROM config_dictionary_api_resource_seed_epic5_g1() s
      UNION
      SELECT a.code, a.http_method || ' ' || a.path_pattern, a.module_code, a.http_method, a.path_pattern
        FROM (VALUES
          ${API_RESOURCE_ADDITIONS}
        ) AS a(code, module_code, http_method, path_pattern);
    $seed$ LANGUAGE sql IMMUTABLE;

    -- 3. Backfill the new rows for tenants that already exist ----------------
    INSERT INTO app_api_resources (tenant_id, code, name, module_code, http_method, path_pattern)
    SELECT t.id, a.code, a.http_method || ' ' || a.path_pattern, a.module_code, a.http_method, a.path_pattern
      FROM tenants t
      CROSS JOIN (VALUES
        ${API_RESOURCE_ADDITIONS}
      ) AS a(code, module_code, http_method, path_pattern)
    ON CONFLICT (tenant_id, code) DO NOTHING;

    -- 4. Keep the previous Process catalogue reachable under its own name ----
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
         WHERE p.proname = 'config_dictionary_process_seed_epic5_g1'
           AND n.nspname = current_schema()
      ) THEN
        ALTER FUNCTION config_dictionary_process_seed()
          RENAME TO config_dictionary_process_seed_epic5_g1;
      END IF;
    END
    $$;

    -- 5. Redefine the canonical Process catalogue as legacy + the new rows ---
    --    Same signature, so the tenant trigger picks it up unchanged. UNION
    --    (not UNION ALL) plus the NOT EXISTS guards make each code unique for
    --    two independent reasons.
    CREATE OR REPLACE FUNCTION config_dictionary_process_seed()
    RETURNS TABLE (code TEXT, name TEXT, module_code TEXT) AS $seed$
      SELECT s.code, s.name, s.module_code
        FROM config_dictionary_process_seed_epic5_g1() s
      UNION
      SELECT 'department.read', 'Read Departments', 'platform'
       WHERE NOT EXISTS (
         SELECT 1 FROM config_dictionary_process_seed_epic5_g1() l
          WHERE l.code = 'department.read'
       )
      UNION
      SELECT 'department.create', 'Create Department', 'platform'
       WHERE NOT EXISTS (
         SELECT 1 FROM config_dictionary_process_seed_epic5_g1() l
          WHERE l.code = 'department.create'
       )
      UNION
      SELECT 'department.update',
             'Edit Department (name, code, hierarchy, activate/deactivate)',
             'platform'
       WHERE NOT EXISTS (
         SELECT 1 FROM config_dictionary_process_seed_epic5_g1() l
          WHERE l.code = 'department.update'
       );
    $seed$ LANGUAGE sql IMMUTABLE;

    -- 6. The permissions themselves ------------------------------------------
    --    'department.read' raises an endpoint; 'department.create' and
    --    'department.update' mutate the master. None of them is a Data Scope:
    --    see domain/department/department.entity.ts (section 4.5 principle 4).
    INSERT INTO permissions (code, description) VALUES
      ('department.read', 'Read Departments'),
      ('department.create', 'Create Department'),
      ('department.update', 'Edit Department (name, code, hierarchy, activate/deactivate)')
    ON CONFLICT (code) DO NOTHING;

    -- 7. Existing tenants receive the new Process rows -----------------------
    --    ON CONFLICT DO NOTHING keeps every already-seeded row untouched, so
    --    this is safe to re-run and does not resurrect rows a tenant removed.
    INSERT INTO app_processes (tenant_id, code, name, module_code)
    SELECT t.id, s.code, s.name, s.module_code
      FROM tenants t
      CROSS JOIN config_dictionary_process_seed() s
    ON CONFLICT (tenant_id, code) DO NOTHING;
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    -- Reverse in the opposite order to up. Each wrapper function is dropped
    -- before its snapshot name is restored, because two functions cannot both
    -- hold the canonical name at once.
    DELETE FROM app_processes WHERE code IN (
      'department.read', 'department.create', 'department.update'
    );

    DROP FUNCTION IF EXISTS config_dictionary_process_seed();

    ALTER FUNCTION config_dictionary_process_seed_epic5_g1()
      RENAME TO config_dictionary_process_seed;

    DELETE FROM app_api_resources
     WHERE code IN (
       SELECT a.code FROM (VALUES
         ${API_RESOURCE_ADDITIONS}
       ) AS a(code, module_code, http_method, path_pattern)
     );

    DROP FUNCTION IF EXISTS config_dictionary_api_resource_seed();

    ALTER FUNCTION config_dictionary_api_resource_seed_epic5_g1()
      RENAME TO config_dictionary_api_resource_seed;

    -- Guarded like 1786000000000_tenant-name-update-permission.cjs: once a
    -- Role has been granted one of these permissions, a plain delete would
    -- cascade through \`role_permissions\` and revoke the grant from a live Role
    -- with no trace. A leftover catalogue row is harmless; a silent revocation
    -- is not (§4.4 G).
    DELETE FROM permissions p
    WHERE p.code IN (
      'department.read', 'department.create', 'department.update'
    )
    AND NOT EXISTS (
      SELECT 1 FROM role_permissions rp WHERE rp.permission_id = p.id
    );
  `);
};
