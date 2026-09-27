/**
 * Epic 4 Wave 1 — API resource rows for the Role Definition surface.
 *
 * `config_dictionary_api_resource_seed()` (1787300000000, corrected by
 * 1787600000000) holds one row per governed HTTP route. The seven routes Epic 4
 * Wave 1 added to `interfaces/http/routes/admin-console.ts` were served but had
 * no dictionary row, which `tests/dictionary-seed-parity.test.ts` reports as
 * "served routes with no dictionary row". A dictionary that describes an
 * application that no longer exists is exactly the drift §4.2 exists to make
 * visible, so the snapshot is extended here rather than amended in place.
 *
 * Shape: the current canonical function is renamed, and the canonical name is
 * redefined as that function with the seven new rows unioned over it, the same
 * composition 1787600000000 used. `config_seed_dictionary_for_tenant()`
 * resolves the catalogue function by name at execution time, so future tenants
 * are seeded complete without touching the trigger; existing tenants are
 * backfilled by a cross join.
 *
 * All seven rows attribute to `platform`: `attributeApiPath("/admin/...")`
 * resolves through the `admin` prefix override in `module-attribution.ts`, and
 * `role.manage` is already attributed to `platform` by 1787700000000. No
 * permission is introduced, no `role_permissions` row is written, and no other
 * row changes. Idempotent — the backfill is `ON CONFLICT DO NOTHING` on the
 * `(tenant_id, code)` key, and the rename is guarded on the target name not
 * already existing.
 */
exports.shorthands = undefined;

/** The routes this migration adds: code → module, method, path. `name` is the
 * `METHOD /path` form the existing rows use. */
const ADDITIONS = `
        ('api:DELETE /admin/roles/:roleCode/definition', 'platform', 'DELETE', '/admin/roles/:roleCode/definition'),
        ('api:GET /admin/role-definition-options', 'platform', 'GET', '/admin/role-definition-options'),
        ('api:GET /admin/roles/:roleCode/definition', 'platform', 'GET', '/admin/roles/:roleCode/definition'),
        ('api:POST /admin/roles', 'platform', 'POST', '/admin/roles'),
        ('api:POST /admin/roles/:roleCode/copy', 'platform', 'POST', '/admin/roles/:roleCode/copy'),
        ('api:POST /admin/roles/:roleCode/preview', 'platform', 'POST', '/admin/roles/:roleCode/preview'),
        ('api:PUT /admin/roles/:roleCode/definition', 'platform', 'PUT', '/admin/roles/:roleCode/definition')
`;

exports.up = (pgm) => {
  pgm.sql(`
    -- 1. Keep the previous snapshot reachable under its own name -----------
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
         WHERE p.proname = 'config_dictionary_api_resource_seed_epic3'
           AND n.nspname = current_schema()
      ) THEN
        ALTER FUNCTION config_dictionary_api_resource_seed()
          RENAME TO config_dictionary_api_resource_seed_epic3;
      END IF;
    END
    $$;

    -- 2. Extend the canonical catalogue -------------------------------------
    --    Same signature, so the tenant trigger picks it up unchanged.
    --    UNION, not UNION ALL: if a later correction ever promotes one of
    --    these paths into the Epic 3 snapshot, the catalogue would otherwise
    --    emit the same code twice. The app_api_resources table keys on
    --    (tenant_id, code) and the inserts below are ON CONFLICT DO NOTHING,
    --    so a duplicate would be silently absorbed and stay invisible until
    --    something counted the catalogue itself.
    CREATE OR REPLACE FUNCTION config_dictionary_api_resource_seed()
    RETURNS TABLE (code TEXT, name TEXT, module_code TEXT, http_method TEXT, path_pattern TEXT) AS $seed$
      SELECT s.code, s.name, s.module_code, s.http_method, s.path_pattern
        FROM config_dictionary_api_resource_seed_epic3() s
      UNION
      SELECT a.code, a.http_method || ' ' || a.path_pattern, a.module_code, a.http_method, a.path_pattern
        FROM (VALUES
          ${ADDITIONS}
        ) AS a(code, module_code, http_method, path_pattern);
    $seed$ LANGUAGE sql IMMUTABLE;

    -- 3. Backfill the rows for tenants that already exist --------------------
    INSERT INTO app_api_resources (tenant_id, code, name, module_code, http_method, path_pattern)
    SELECT t.id, a.code, a.http_method || ' ' || a.path_pattern, a.module_code, a.http_method, a.path_pattern
      FROM tenants t
      CROSS JOIN (VALUES
        ${ADDITIONS}
      ) AS a(code, module_code, http_method, path_pattern)
    ON CONFLICT (tenant_id, code) DO NOTHING;
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    -- Remove the rows this migration created before dropping the function
    -- that produced them. Unscoped by tenant on purpose: the up migration
    -- seeds every tenant, so the teardown has to match it. A tenant created
    -- after this migration ran is not affected, because rolling back also
    -- restores the seed function that no longer knows these codes.
    DELETE FROM app_api_resources
     WHERE code IN (
       SELECT a.code FROM (VALUES
         ${ADDITIONS}
       ) AS a(code, module_code, http_method, path_pattern)
     );

    DROP FUNCTION IF EXISTS config_dictionary_api_resource_seed();

    ALTER FUNCTION config_dictionary_api_resource_seed_epic3()
      RENAME TO config_dictionary_api_resource_seed;
  `);
};
