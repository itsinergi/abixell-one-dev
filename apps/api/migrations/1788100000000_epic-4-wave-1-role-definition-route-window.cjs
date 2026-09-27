/**
 * Epic 4 Wave 1 — the Role Definition route window.
 *
 * `config_route_window_seed()` (1787200000000) holds one `app_windows` row per
 * client route. Epic 4 Wave 1 added `/admin/roles/:roleCode` to `App.tsx` — a
 * drill-down from the Admin Console Roles section so a definition survives a
 * reload and can be linked to directly. The route has no catalogue row, which
 * `tests/route-registry-parity.test.ts` and
 * `tests/integration/app-metadata.test.ts` both report as drift: a route the
 * app serves but the catalogue does not describe.
 *
 * The window matters beyond bookkeeping. The page renders the Window picker
 * that writes `role_window_access`, and its seven API routes are mapped to a
 * Window by `window-enforcement.ts` — while this row is missing, a Role can be
 * pointed at a Window by hand without that Window appearing as its own row in
 * the tenant's catalogue.
 *
 * Shape: identical composition to 1788000000000. The current canonical
 * function is renamed to `config_route_window_seed_epic3`, and the canonical
 * name is redefined as that function with the new row unioned over it.
 * `config_seed_app_windows_for_tenant()` — as redefined by 1787900000000 —
 * calls the catalogue by name at execution time, so future tenants are seeded
 * complete without touching the trigger; existing tenants are backfilled by a
 * cross join. The `ON CONFLICT (tenant_id, code) DO NOTHING` key makes both
 * idempotent.
 *
 * No other row changes, no permission is introduced, and no `role_permissions`
 * row is written. The status is `tersembunyi`, matching the label the browser
 * mirror already carries: the page is reached from the console, never from the
 * menu, so it must not appear in the nav.
 */
exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.sql(`
    -- 1. Keep the previous snapshot reachable under its own name -----------
    DO $$
    BEGIN
      IF EXISTS (
        SELECT 1 FROM pg_proc p
          JOIN pg_namespace n ON n.oid = p.pronamespace
         WHERE p.proname = 'config_route_window_seed'
           AND n.nspname = current_schema()
      ) AND NOT EXISTS (
        SELECT 1 FROM pg_proc p
          JOIN pg_namespace n ON n.oid = p.pronamespace
         WHERE p.proname = 'config_route_window_seed_epic3'
           AND n.nspname = current_schema()
      ) THEN
        ALTER FUNCTION config_route_window_seed()
          RENAME TO config_route_window_seed_epic3;
      END IF;
    END
    $$;

    -- 2. Extend the canonical catalogue -------------------------------------
    --    Same signature, so the tenant trigger picks it up unchanged.
    --    UNION, not UNION ALL: if a later correction ever promotes this path
    --    into the Epic 3 snapshot, the catalogue would otherwise emit the same
    --    code twice. The inserts below key on (tenant_id, code) with
    --    ON CONFLICT DO NOTHING, so a duplicate would be silently absorbed and
    --    stay invisible until something counted the catalogue itself.
    CREATE OR REPLACE FUNCTION config_route_window_seed()
    RETURNS TABLE (
      code                TEXT,
      name                TEXT,
      module_code         TEXT,
      registration_status TEXT,
      required_permissions TEXT[],
      parent_path         TEXT,
      note                TEXT
    ) AS $seed$
      SELECT s.code, s.name, s.module_code, s.registration_status,
             s.required_permissions, s.parent_path, s.note
        FROM config_route_window_seed_epic3() s
      UNION
      SELECT r.code, r.name, r.module_code, r.registration_status,
             r.required_permissions, r.parent_path, r.note
        FROM (VALUES
          ('route:/admin/roles/:roleCode',
           'Role Definition',
           'platform',
           'tersembunyi',
           ARRAY['admin.console.read']::text[],
           '/admin',
           'Epic 4 Wave 1 — reached from the Admin Console Roles section, never from the menu. Carries the Window picker that writes role_window_access; the write behind it is enforced server-side (step 11b).')
        ) AS r(code, name, module_code, registration_status, required_permissions, parent_path, note);
    $seed$ LANGUAGE sql IMMUTABLE;

    -- 3. Backfill the row for tenants that already exist --------------------
    INSERT INTO app_windows (
      tenant_id, code, name, module_code,
      registration_status, required_permissions, parent_path, description
    )
    SELECT t.id, s.code, s.name, s.module_code,
           s.registration_status, s.required_permissions, s.parent_path, s.note
      FROM tenants t
      CROSS JOIN config_route_window_seed() s
     WHERE s.code = 'route:/admin/roles/:roleCode'
    ON CONFLICT (tenant_id, code) DO NOTHING;
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    -- Remove the rows this migration created before dropping the function that
    -- produced them. Unscoped by tenant on purpose: the up migration seeds
    -- every tenant, so the teardown has to match it. A tenant created after
    -- this migration ran is not affected, because rolling back also restores
    -- the seed function that no longer knows this code.
    DELETE FROM app_windows WHERE code = 'route:/admin/roles/:roleCode';

    DROP FUNCTION IF EXISTS config_route_window_seed();

    ALTER FUNCTION config_route_window_seed_epic3()
      RENAME TO config_route_window_seed;
  `);
};
