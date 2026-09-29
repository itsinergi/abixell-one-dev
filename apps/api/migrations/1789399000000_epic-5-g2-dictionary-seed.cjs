/**
 * Epic 5 Gelombang 2 (§4.5 steps 10–13) — Application Dictionary seed for the
 * routes and permissions this wave adds.
 *
 * Same three catalogues, same reason, same shape as the Gelombang 1 seed
 * (1789390000000): `tests/dictionary-seed-parity.test.ts` re-derives the API
 * resource list from Fastify's own `app.routes` and the permission list from the
 * `permissions` table, and `tests/window-enforcement-coverage.test.ts` re-derives
 * the Window rules from the registered routes. A surface that is declared in code
 * and not seeded here is a red test, not a silent gap. The dictionary is
 * cumulative, so this migration wraps the Gelombang 1 catalogue as its own
 * `_epic5_g2` snapshot and redefines the canonical name as that snapshot UNION
 * the new rows.
 *
 * ── 1. API resources (8 new rows, all `platform`) ─────────────────────────
 *
 *   Structure change proposal   POST /organization-units/:id/change-requests,
 *                               GET  /organization-units/:id/change-requests
 *   Effective-dated history     GET  /organization-units/:id/hierarchy
 *   Tombstone / replacement     POST /organization-units/:id/tombstone
 *   Review queue                GET  /organization-unit-change-requests,
 *                               POST /organization-unit-change-requests/:id/publish,
 *                               POST /organization-unit-change-requests/:id/reject,
 *                               POST /organization-unit-change-requests/:id/cancel
 *
 * `/organization-units/:id/...` stays inside the EXISTING
 * `{ apiPath: "/organization-units" }` Window rule (it matches on a segment
 * boundary), so the only new Window rule is for the review queue's first
 * segment, `/organization-unit-change-requests`, added in
 * `window-enforcement.ts` together with its module attribution.
 *
 * ── 2. Permissions ────────────────────────────────────────────────────────
 *
 * Three codes, and the split between them IS §4.5 principle 12: "Proposal bukan
 * publish. Admin Tenant dapat menyusun draft perubahan dalam batasnya; hanya
 * Super Admin dapat menerbitkan perubahan struktur."
 *
 *   `organization_unit.change_request.create`  — propose (Admin Tenant)
 *   `organization_unit.change_request.review`  — publish / reject (Super Admin)
 *   `organization_unit.tombstone`              — the delete of §4.5 step 13
 *
 * `organization_unit.change_request.review` is deliberately NOT implied by
 * `create`: holding the first and not the second is exactly the Admin Tenant
 * shape the roadmap locks, so a deployment that grants `create` broadly does not
 * accidentally grant publishing. As in Gelombang 1, no `role_permissions` row is
 * written — `scripts/sync-role-permissions.ts` remains the only sanctioned bulk
 * writer, and the test fixture grants every catalogued permission to its ADMIN
 * role.
 *
 * ── 3. Processes ──────────────────────────────────────────────────────────
 *
 * Extended identically, because the parity test asserts that `app_processes` and
 * `permissions` hold the same code set.
 *
 * Idempotent: every backfill is `ON CONFLICT DO NOTHING` and both renames are
 * guarded on the target name not already existing.
 */

exports.shorthands = undefined;

const API_RESOURCE_ADDITIONS = `
        ('api:POST /organization-units/:id/change-requests', 'platform', 'POST', '/organization-units/:id/change-requests'),
        ('api:GET /organization-units/:id/change-requests', 'platform', 'GET', '/organization-units/:id/change-requests'),
        ('api:GET /organization-units/:id/hierarchy', 'platform', 'GET', '/organization-units/:id/hierarchy'),
        ('api:POST /organization-units/:id/tombstone', 'platform', 'POST', '/organization-units/:id/tombstone'),
        ('api:GET /organization-unit-change-requests', 'platform', 'GET', '/organization-unit-change-requests'),
        ('api:POST /organization-unit-change-requests/:id/publish', 'platform', 'POST', '/organization-unit-change-requests/:id/publish'),
        ('api:POST /organization-unit-change-requests/:id/reject', 'platform', 'POST', '/organization-unit-change-requests/:id/reject'),
        ('api:POST /organization-unit-change-requests/:id/cancel', 'platform', 'POST', '/organization-unit-change-requests/:id/cancel')
`;

const PERMISSIONS = [
  {
    code: "organization_unit.change_request.create",
    description: "Propose an Organization Unit structure change (Admin Tenant)",
  },
  {
    code: "organization_unit.change_request.review",
    description: "Publish or reject an Organization Unit structure change (Super Admin)",
  },
  {
    code: "organization_unit.tombstone",
    description: "Tombstone an Organization Unit with replacement and reference check",
  },
];

const PROCESS_ROWS = PERMISSIONS.map(
  (p) => `      SELECT '${p.code}', '${p.description.replace(/'/g, "''")}', 'platform'
       WHERE NOT EXISTS (
         SELECT 1 FROM config_dictionary_process_seed_epic5_g2() l WHERE l.code = '${p.code}'
       )`,
).join("\n      UNION\n");

exports.up = (pgm) => {
  pgm.sql(`
    -- 1. Keep the Gelombang 1 API-resource catalogue reachable under its own name
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
         WHERE p.proname = 'config_dictionary_api_resource_seed_epic5_g2'
           AND n.nspname = current_schema()
      ) THEN
        ALTER FUNCTION config_dictionary_api_resource_seed()
          RENAME TO config_dictionary_api_resource_seed_epic5_g2;
      END IF;
    END
    $$;

    -- 2. Extend the canonical API-resource catalogue -------------------------
    CREATE OR REPLACE FUNCTION config_dictionary_api_resource_seed()
    RETURNS TABLE (code TEXT, name TEXT, module_code TEXT, http_method TEXT, path_pattern TEXT) AS $seed$
      SELECT s.code, s.name, s.module_code, s.http_method, s.path_pattern
        FROM config_dictionary_api_resource_seed_epic5_g2() s
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

    -- 4. Keep the Gelombang 1 Process catalogue reachable under its own name --
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
         WHERE p.proname = 'config_dictionary_process_seed_epic5_g2'
           AND n.nspname = current_schema()
      ) THEN
        ALTER FUNCTION config_dictionary_process_seed()
          RENAME TO config_dictionary_process_seed_epic5_g2;
      END IF;
    END
    $$;

    -- 5. Redefine the canonical Process catalogue as legacy + the new rows ---
    CREATE OR REPLACE FUNCTION config_dictionary_process_seed()
    RETURNS TABLE (code TEXT, name TEXT, module_code TEXT) AS $seed$
      SELECT s.code, s.name, s.module_code
        FROM config_dictionary_process_seed_epic5_g2() s
      UNION
${PROCESS_ROWS};
    $seed$ LANGUAGE sql IMMUTABLE;

    -- 6. The permissions themselves ------------------------------------------
    INSERT INTO permissions (code, description) VALUES
      ${PERMISSIONS.map((p) => `('${p.code}', '${p.description.replace(/'/g, "''")}')`).join(
        ",\n      ",
      )}
    ON CONFLICT (code) DO NOTHING;

    -- 7. Existing tenants receive the new Process rows -----------------------
    INSERT INTO app_processes (tenant_id, code, name, module_code)
    SELECT t.id, s.code, s.name, s.module_code
      FROM tenants t
      CROSS JOIN config_dictionary_process_seed() s
    ON CONFLICT (tenant_id, code) DO NOTHING;
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    -- Reverse in the opposite order to up.
    DELETE FROM app_processes WHERE code IN (
      ${PERMISSIONS.map((p) => `'${p.code}'`).join(", ")}
    );

    DROP FUNCTION IF EXISTS config_dictionary_process_seed();

    ALTER FUNCTION config_dictionary_process_seed_epic5_g2()
      RENAME TO config_dictionary_process_seed;

    DELETE FROM app_api_resources
     WHERE code IN (
       SELECT a.code FROM (VALUES
         ${API_RESOURCE_ADDITIONS}
       ) AS a(code, module_code, http_method, path_pattern)
     );

    DROP FUNCTION IF EXISTS config_dictionary_api_resource_seed();

    ALTER FUNCTION config_dictionary_api_resource_seed_epic5_g2()
      RENAME TO config_dictionary_api_resource_seed;

    -- Guarded like 1786000000000_tenant-name-update-permission.cjs: deleting a
    -- permission that a live Role was granted cascades through role_permissions
    -- and silently revokes it.
    DELETE FROM permissions p
    WHERE p.code IN (
      ${PERMISSIONS.map((p) => `'${p.code}'`).join(", ")}
    )
    AND NOT EXISTS (
      SELECT 1 FROM role_permissions rp WHERE rp.permission_id = p.id
    );
  `);
};
