/**
 * Epic 1 (§4.1 E) — dictionary row for POST /auth/switch-role.
 *
 * The switch-role route Epic 1 added to `interfaces/http/routes/auth.ts` was
 * served but had no `app_api_resources` row, which
 * `tests/dictionary-seed-parity.test.ts` reports as "served routes with no
 * dictionary row" — the same drift 1788700000000 closed for the Epic 4
 * assignment surface. One row, attributed to `platform` the same way every
 * other `/auth` route is (the `platform` module owns identity plumbing).
 *
 * Shape: identical composition to 1788000000000/1788600000000/1788700000000.
 * The current canonical function is renamed to an `_epic1` snapshot, and the
 * canonical name is redefined as that function with the new row unioned over
 * it. `config_seed_dictionary_for_tenant()` resolves the catalogue function by
 * name at execution time, so future tenants are seeded complete without
 * touching the trigger; existing tenants are backfilled by a cross join.
 *
 * No permission is introduced and no `role_permissions` row is written — the
 * route is governed by authentication alone (the assignment must be one the
 * caller's own session holds), which is exactly what the window-enforcement
 * mapping records: `WINDOW_RULES` maps it to `route:/profile`, so it is not
 * part of the exemption list.
 *
 * Idempotent: the backfill is `ON CONFLICT DO NOTHING` on `(tenant_id, code)`,
 * and the rename is guarded on the target name not already existing.
 */
exports.shorthands = undefined;

const ADDITIONS = `
        ('api:POST /auth/switch-role', 'platform', 'POST', '/auth/switch-role')
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
         WHERE p.proname = 'config_dictionary_api_resource_seed_epic1'
           AND n.nspname = current_schema()
      ) THEN
        ALTER FUNCTION config_dictionary_api_resource_seed()
          RENAME TO config_dictionary_api_resource_seed_epic1;
      END IF;
    END
    $$;

    -- 2. Extend the canonical catalogue -------------------------------------
    CREATE OR REPLACE FUNCTION config_dictionary_api_resource_seed()
    RETURNS TABLE (code TEXT, name TEXT, module_code TEXT, http_method TEXT, path_pattern TEXT) AS $seed$
      SELECT s.code, s.name, s.module_code, s.http_method, s.path_pattern
        FROM config_dictionary_api_resource_seed_epic1() s
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

    ALTER FUNCTION config_dictionary_api_resource_seed_epic1()
      RENAME TO config_dictionary_api_resource_seed;
  `);
};
