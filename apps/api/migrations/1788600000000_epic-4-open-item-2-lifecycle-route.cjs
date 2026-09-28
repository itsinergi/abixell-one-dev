/**
 * Epic 4 open item 2 — the API Resource row for the Role lifecycle route.
 *
 * `POST /admin/roles/:roleCode/active-state` (deactivate/activate) was added
 * to `interfaces/http/routes/admin-console.ts` by the open-item-2 work. The
 * route is served but had no dictionary row, which
 * `tests/dictionary-seed-parity.test.ts` reports as "served routes with no
 * dictionary row" — the same drift 1788000000000 fixed for the other seven
 * Role-definition routes.
 *
 * Shape: identical composition to 1788000000000. The current canonical
 * function is renamed to a `_epic4_open_items` snapshot, and the canonical
 * name is redefined as that function with the one new row unioned over it.
 * `config_seed_dictionary_for_tenant()` resolves the catalogue function by
 * name at execution time, so future tenants are seeded complete without
 * touching the trigger; existing tenants are backfilled by a cross join.
 *
 * The row attributes to `platform`: `attributeApiPath("/admin/...")` resolves
 * through the `admin` prefix override in `module-attribution.ts`, the same as
 * every other route under `/admin`. No permission is introduced and no
 * `role_permissions` row is written — the route is governed by `role.manage`,
 * already attributed to `platform` by 1787700000000. Idempotent: the backfill
 * is `ON CONFLICT DO NOTHING` on `(tenant_id, code)`, and the rename is
 * guarded on the target name not already existing.
 */
exports.shorthands = undefined;

const ADDITIONS = `
        ('api:POST /admin/roles/:roleCode/active-state', 'platform', 'POST', '/admin/roles/:roleCode/active-state')
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
         WHERE p.proname = 'config_dictionary_api_resource_seed_epic4_open_items'
           AND n.nspname = current_schema()
      ) THEN
        ALTER FUNCTION config_dictionary_api_resource_seed()
          RENAME TO config_dictionary_api_resource_seed_epic4_open_items;
      END IF;
    END
    $$;

    -- 2. Extend the canonical catalogue -------------------------------------
    --    Same signature, so the tenant trigger picks it up unchanged.
    --    UNION, not UNION ALL, for the same reason 1788000000000 used it: a
    --    later correction promoting this path into an earlier snapshot must
    --    not emit the code twice.
    CREATE OR REPLACE FUNCTION config_dictionary_api_resource_seed()
    RETURNS TABLE (code TEXT, name TEXT, module_code TEXT, http_method TEXT, path_pattern TEXT) AS $seed$
      SELECT s.code, s.name, s.module_code, s.http_method, s.path_pattern
        FROM config_dictionary_api_resource_seed_epic4_open_items() s
      UNION
      SELECT a.code, a.http_method || ' ' || a.path_pattern, a.module_code, a.http_method, a.path_pattern
        FROM (VALUES
          ${ADDITIONS}
        ) AS a(code, module_code, http_method, path_pattern);
    $seed$ LANGUAGE sql IMMUTABLE;

    -- 3. Backfill the row for tenants that already exist --------------------
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
    DELETE FROM app_api_resources
     WHERE code IN (
       SELECT a.code FROM (VALUES
         ${ADDITIONS}
       ) AS a(code, module_code, http_method, path_pattern)
     );

    DROP FUNCTION IF EXISTS config_dictionary_api_resource_seed();

    ALTER FUNCTION config_dictionary_api_resource_seed_epic4_open_items()
      RENAME TO config_dictionary_api_resource_seed;
  `);
};
