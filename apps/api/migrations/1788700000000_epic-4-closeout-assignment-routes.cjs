/**
 * Epic 4 close-out — API resource rows for the Waves 2–3 assignment surface.
 *
 * The seven routes Epic 4 Waves 2–3 added to
 * `interfaces/http/routes/admin-console.ts` (assignment read models, user
 * creation, batch preview/confirm, and revoke) were served but had no
 * dictionary row, which `tests/dictionary-seed-parity.test.ts` reports as
 * "served routes with no dictionary row" — the same drift 1788000000000 fixed
 * for the Wave 1 Role-definition routes and 1788600000000 for the lifecycle
 * route. This closes the last known gap, so the parity assertion runs green.
 *
 * Wave 3 also retired the old DELETE revoke route: revocation became
 * `POST /admin/users/:userId/role-assignments/:assignmentId/revoke` with a
 * mandatory reason, but the dictionary still carries the 1787300000000 row
 * `api:DELETE /admin/users/:userId/role-assignments/:assignmentId` for a
 * route the server no longer serves (the other side of the parity
 * assertion). That row is removed from the snapshot and deleted from every
 * existing tenant alongside the backfill.
 *
 * Shape: identical composition to 1788000000000/1788600000000. The current
 * canonical function is renamed to a `_epic4_closeout` snapshot, and the
 * canonical name is redefined as that function with the seven new rows
 * unioned over it. `config_seed_dictionary_for_tenant()` resolves the
 * catalogue function by name at execution time, so future tenants are seeded
 * complete without touching the trigger; existing tenants are backfilled by
 * a cross join.
 *
 * All seven rows attribute to `platform`: `attributeApiPath("/admin/...")`
 * resolves through the `admin` prefix override in `module-attribution.ts`,
 * the same as every other route under `/admin`. No permission is introduced
 * and no `role_permissions` row is written — these routes are governed by
 * permissions (`user.role.manage`, `user.read`, `admin.console.read`)
 * already attributed to `platform` by earlier migrations. Idempotent: the
 * backfill is `ON CONFLICT DO NOTHING` on `(tenant_id, code)`, and the
 * rename is guarded on the target name not already existing.
 */
exports.shorthands = undefined;

const ADDITIONS = `
        ('api:GET /admin/assignment-options', 'platform', 'GET', '/admin/assignment-options'),
        ('api:GET /admin/assignments', 'platform', 'GET', '/admin/assignments'),
        ('api:GET /admin/users/:userId/access', 'platform', 'GET', '/admin/users/:userId/access'),
        ('api:POST /admin/users', 'platform', 'POST', '/admin/users'),
        ('api:POST /admin/users/:userId/assignment-batches', 'platform', 'POST', '/admin/users/:userId/assignment-batches'),
        ('api:POST /admin/users/:userId/assignment-previews', 'platform', 'POST', '/admin/users/:userId/assignment-previews'),
        ('api:POST /admin/users/:userId/role-assignments/:assignmentId/revoke', 'platform', 'POST', '/admin/users/:userId/role-assignments/:assignmentId/revoke')
`;

/** The retired route: served when 1787300000000 wrote the snapshot, gone from
 * the server after Wave 3 replaced it with the reason-carrying POST. */
const RETIRED = `
        ('api:DELETE /admin/users/:userId/role-assignments/:assignmentId')
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
         WHERE p.proname = 'config_dictionary_api_resource_seed_epic4_closeout'
           AND n.nspname = current_schema()
      ) THEN
        ALTER FUNCTION config_dictionary_api_resource_seed()
          RENAME TO config_dictionary_api_resource_seed_epic4_closeout;
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
        FROM config_dictionary_api_resource_seed_epic4_closeout() s
       WHERE s.code NOT IN (
         SELECT r.code FROM (VALUES
           ${RETIRED}
         ) AS r(code)
       )
      UNION
      SELECT a.code, a.http_method || ' ' || a.path_pattern, a.module_code, a.http_method, a.path_pattern
        FROM (VALUES
          ${ADDITIONS}
        ) AS a(code, module_code, http_method, path_pattern);
    $seed$ LANGUAGE sql IMMUTABLE;

    -- 3. Backfill the rows for tenants that already exist ------------------
    INSERT INTO app_api_resources (tenant_id, code, name, module_code, http_method, path_pattern)
    SELECT t.id, a.code, a.http_method || ' ' || a.path_pattern, a.module_code, a.http_method, a.path_pattern
      FROM tenants t
      CROSS JOIN (VALUES
        ${ADDITIONS}
      ) AS a(code, module_code, http_method, path_pattern)
    ON CONFLICT (tenant_id, code) DO NOTHING;

    -- 4. Retire the stale row from tenants that already exist --------------
    DELETE FROM app_api_resources
     WHERE code IN (
       SELECT r.code FROM (VALUES
         ${RETIRED}
       ) AS r(code)
     );
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

    -- Restore the retired row: the snapshot under the closeout name still
    -- carries it, so re-seeding tenants puts it back.
    INSERT INTO app_api_resources (tenant_id, code, name, module_code, http_method, path_pattern)
    SELECT t.id, s.code, s.name, s.module_code, s.http_method, s.path_pattern
      FROM tenants t
      CROSS JOIN config_dictionary_api_resource_seed_epic4_closeout() s
     WHERE s.code IN (
       SELECT r.code FROM (VALUES
         ${RETIRED}
       ) AS r(code)
     )
    ON CONFLICT (tenant_id, code) DO NOTHING;

    ALTER FUNCTION config_dictionary_api_resource_seed_epic4_closeout()
      RENAME TO config_dictionary_api_resource_seed;
  `);
};
