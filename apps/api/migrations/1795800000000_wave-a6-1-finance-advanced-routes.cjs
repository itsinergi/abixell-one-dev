/**
 * Wave A6.1: the two Finance Advanced routes and their menu entries.
 *
 * Wave A6 delivered six Finance work packages as an API-first surface, so
 * every `/accounting/*` route already exists and is already mapped to a Window
 * by `window-enforcement.ts`. What was missing was somewhere to look at them.
 * This migration adds exactly two pages:
 *
 *   /finance/accounting   periods, fiscal closings, ledgers, charts, accounts
 *   /finance/statements   aging, journals, GL postings, consolidation
 *
 * Four things have to agree for those pages to exist, and this migration owns
 * the last two:
 *   1. `App.tsx` declares the route.
 *   2. `routeRegistry.ts` (browser mirror) and `route-registry.ts` (server)
 *      describe it identically: `tests/route-registry-parity.test.ts`.
 *   3. `config_route_window_seed()` gives it an `app_windows` row.
 *   4. `config_menu_seed()` gives it an `app_menus` row. The FK from menu to
 *      window is by `window_id`, so (4) cannot land before (3).
 *      `tests/menu-seed-parity.test.ts` compares the served tree against
 *      `NAV_SECTIONS` and fails on any drift in either direction.
 *
 * Shape follows 1788100000000: the current canonical seed function is renamed
 * to a dated snapshot and the canonical name is redefined as that snapshot
 * UNIONed with the new rows. Both tenant triggers call the catalogue by name at
 * execution time, so future tenants are seeded complete without touching them.
 * Existing tenants are backfilled below, keyed on the conflict target so a
 * re-run is a no-op.
 *
 * Permissions: `finance.accounting.read` and `finance.accounting.configure`
 * already exist (1792000000000) and are what the kernel services actually
 * check. No permission is introduced, and no `role_permissions` row is written.
 *
 * Terminology (1787500000000) seeded one key per menu code in the catalogue as
 * it stood then, and `menu-terminology.test.ts` asserts that the allowlist and
 * the catalogue have the SAME number of rows, on purpose: a menu without a key
 * would be a label no tenant could ever override, and a key without a menu
 * would be a term pointing at nothing. A menu added here is a menu the
 * catalogue now has, so it needs its key and its allowlist row or that test
 * fails. Step 5 therefore seeds `menu.<code>.name` for both pages and
 * `menu.<code>.description` for each, since both carry a description.
 *
 * That makes these two labels tenant-overridable. That is the intended
 * default for every menu in this app, not a decision made here: the allowlist
 * is core data derived from the catalogue, and opting a menu out would mean
 * inventing an exclusion mechanism that does not exist. Which labels are
 * overridable is answered by "all of them", in 1787500000000.
 */
exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.sql(`
    -- 1. Keep both previous catalogues reachable under their own names ------
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
         WHERE p.proname = 'config_route_window_seed_epic4'
           AND n.nspname = current_schema()
      ) THEN
        ALTER FUNCTION config_route_window_seed()
          RENAME TO config_route_window_seed_epic4;
      END IF;

      IF EXISTS (
        SELECT 1 FROM pg_proc p
          JOIN pg_namespace n ON n.oid = p.pronamespace
         WHERE p.proname = 'config_menu_seed'
           AND n.nspname = current_schema()
      ) AND NOT EXISTS (
        SELECT 1 FROM pg_proc p
          JOIN pg_namespace n ON n.oid = p.pronamespace
         WHERE p.proname = 'config_menu_seed_epic3'
           AND n.nspname = current_schema()
      ) THEN
        ALTER FUNCTION config_menu_seed()
          RENAME TO config_menu_seed_epic3;
      END IF;
    END
    $$;

    -- 2. Extend the route window catalogue ---------------------------------
    --    Same signature, so the tenant trigger picks it up unchanged.
    --    UNION, not UNION ALL: a duplicate code would be absorbed silently by
    --    ON CONFLICT DO NOTHING and stay invisible until something counted the
    --    catalogue itself.
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
        FROM config_route_window_seed_epic4() s
      UNION
      SELECT r.code, r.name, r.module_code, r.registration_status,
             r.required_permissions, r.parent_path, r.note
        FROM (VALUES
          ('route:/finance/accounting',
           'Accounting',
           'finance',
           'di_menu',
           ARRAY['finance.accounting.read', 'finance.accounting.configure']::text[],
           NULL,
           'Wave A6.1: periods, fiscal closings, ledgers, charts, and accounts. Reads the Accounting Kernel; every mutation stays on the API.'),
          ('route:/finance/statements',
           'Financial Statements',
           'finance',
           'di_menu',
           ARRAY['finance.accounting.read']::text[],
           NULL,
           'Wave A6.1: aging, journals, GL postings, consolidation groups, translation runs, eliminations, and statement line versions.')
        ) AS r(code, name, module_code, registration_status, required_permissions, parent_path, note);
    $seed$ LANGUAGE sql IMMUTABLE;

    -- 3. Extend the menu catalogue ------------------------------------------
    --    Both rows hang under the existing Finance folder (nav-finance) at
    --    seq 40 and 50, after Cash & Bank at 30. Order here is the order
    --    NAV_SECTIONS declares, and the parity test compares the two.
    CREATE OR REPLACE FUNCTION config_menu_seed()
    RETURNS TABLE (
      code                 TEXT,
      name                 TEXT,
      window_code          TEXT,
      is_summary           BOOLEAN,
      module_code          TEXT,
      is_external_allowed  BOOLEAN,
      required_permissions TEXT[],
      description          TEXT,
      parent_code          TEXT,
      seq_no               INTEGER
    ) AS $seed$
      SELECT s.code, s.name, s.window_code, s.is_summary, s.module_code,
             s.is_external_allowed, s.required_permissions, s.description,
             s.parent_code, s.seq_no
        FROM config_menu_seed_epic3() s
      UNION
      SELECT m.code, m.name, m.window_code, m.is_summary, m.module_code,
             m.is_external_allowed, m.required_permissions, m.description,
             m.parent_code, m.seq_no
        FROM (VALUES
          ('nav-finance-finance-accounting',
           'Accounting',
           '/finance/accounting',
           false,
           'finance',
           false,
           ARRAY['finance.accounting.read', 'finance.accounting.configure']::text[],
           'The periods you keep, the ledgers behind them, and the chart in force.',
           'nav-finance',
           40),
          ('nav-finance-finance-statements',
           'Financial Statements',
           '/finance/statements',
           false,
           'finance',
           false,
           ARRAY['finance.accounting.read']::text[],
           'What is still owed, what has been posted, and how the group reports.',
           'nav-finance',
           50)
        ) AS m(code, name, window_code, is_summary, module_code,
               is_external_allowed, required_permissions, description,
               parent_code, seq_no);
    $seed$ LANGUAGE sql IMMUTABLE;

    -- 4. Backfill existing tenants -------------------------------------------
    --    Windows first: the menu seed resolves window_id by joining the
    --    route window, so a menu inserted before its window would carry a NULL
    --    destination and fail the summary-target check.
    INSERT INTO app_windows (
      tenant_id, code, name, module_code,
      registration_status, required_permissions, parent_path, description
    )
    SELECT t.id, s.code, s.name, s.module_code,
           s.registration_status, s.required_permissions, s.parent_path, s.note
      FROM tenants t
      CROSS JOIN config_route_window_seed() s
     WHERE s.code IN ('route:/finance/accounting', 'route:/finance/statements')
    ON CONFLICT (tenant_id, code) DO NOTHING;

    --    Then the menus, scoped to the two new codes rather than replaying the
    --    whole catalogue per tenant: config_seed_menus_for_tenant() walks every
    --    row of config_menu_seed() once per tenant, which is the right shape
    --    for bootstrapping and the wrong one for adding two pages.
    INSERT INTO app_menus (
      tenant_id, code, name, description, action, window_id,
      is_summary, module_id, is_external_allowed, required_permissions
    )
    SELECT t.id, s.code, s.name, s.description, 'window',
           (SELECT w.id FROM app_windows w
             WHERE w.tenant_id = t.id AND w.code = 'route:' || s.window_code),
           s.is_summary,
           (SELECT m.id FROM modules m WHERE m.code = s.module_code),
           s.is_external_allowed, s.required_permissions
      FROM tenants t
      CROSS JOIN config_menu_seed() s
     WHERE s.code IN ('nav-finance-finance-accounting', 'nav-finance-finance-statements')
    ON CONFLICT (tenant_id, code) DO NOTHING;

    --    Tree placement last: parents resolve against the now complete set.
    INSERT INTO app_menu_tree (tenant_id, menu_id, parent_id, seq_no)
    SELECT t.id,
           (SELECT id FROM app_menus WHERE tenant_id = t.id AND code = s.code),
           (SELECT id FROM app_menus WHERE tenant_id = t.id AND code = s.parent_code),
           s.seq_no
      FROM tenants t
      CROSS JOIN config_menu_seed() s
     WHERE s.code IN ('nav-finance-finance-accounting', 'nav-finance-finance-statements')
    ON CONFLICT (tenant_id, menu_id) DO NOTHING;

    -- 5. Terminology keys and their allowlist rows ---------------------------
    --    Allowlist rows are core (one per menu code, no tenant_id), but the
    --    keys themselves are read by the served tree through a join, so they
    --    live here rather than in step 4's per-tenant loop.
    --
    --    The schema Registry bounds a description override at 240 characters
    --    (1787500000000); both descriptions below are well inside that.
    INSERT INTO terminology_keys (code, default_label, description)
    SELECT 'menu.' || s.code || '.name',
           s.name,
           'Tenant label override for the menu ' || s.code || ' (Epic 3 Wave 3, step 11).'
      FROM config_menu_seed() s
     WHERE s.code IN ('nav-finance-finance-accounting', 'nav-finance-finance-statements')
    ON CONFLICT (code) DO NOTHING;

    INSERT INTO terminology_keys (code, default_label, description)
    SELECT 'menu.' || s.code || '.description',
           s.description,
           'Tenant description override for the menu ' || s.code || ' (Epic 3 Wave 3, step 11).'
      FROM config_menu_seed() s
     WHERE s.code IN ('nav-finance-finance-accounting', 'nav-finance-finance-statements')
       AND s.description IS NOT NULL
    ON CONFLICT (code) DO NOTHING;

    INSERT INTO menu_terminology_allowlist (menu_code, field, terminology_key_id)
    SELECT s.code, 'name', tk.id
      FROM config_menu_seed() s
      JOIN terminology_keys tk ON tk.code = 'menu.' || s.code || '.name'
     WHERE s.code IN ('nav-finance-finance-accounting', 'nav-finance-finance-statements')
    ON CONFLICT (menu_code, field) DO NOTHING;

    INSERT INTO menu_terminology_allowlist (menu_code, field, terminology_key_id)
    SELECT s.code, 'description', tk.id
      FROM config_menu_seed() s
      JOIN terminology_keys tk ON tk.code = 'menu.' || s.code || '.description'
     WHERE s.code IN ('nav-finance-finance-accounting', 'nav-finance-finance-statements')
       AND s.description IS NOT NULL
    ON CONFLICT (menu_code, field) DO NOTHING;
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    -- Remove the rows this migration created before dropping the functions
    -- that produced them. Unscoped by tenant on purpose: the up migration
    -- seeds every tenant, so the teardown has to match it.
    --
    -- Allowlist first: it references the terminology keys, and Postgres
    -- refuses to delete a referenced row while the reference is in place.
    -- Deleting the keys then cascades to any tenant override set against one,
    -- so a rollback cannot leave an override behind for a later re-apply to
    -- pick back up.
    DELETE FROM menu_terminology_allowlist
     WHERE menu_code IN ('nav-finance-finance-accounting', 'nav-finance-finance-statements');
    DELETE FROM terminology_keys
     WHERE code IN ('menu.nav-finance-finance-accounting.name',
                    'menu.nav-finance-finance-accounting.description',
                    'menu.nav-finance-finance-statements.name',
                    'menu.nav-finance-finance-statements.description');

    DELETE FROM app_menu_tree WHERE menu_id IN (
      SELECT id FROM app_menus
       WHERE code IN ('nav-finance-finance-accounting', 'nav-finance-finance-statements')
    );
    DELETE FROM app_menus
     WHERE code IN ('nav-finance-finance-accounting', 'nav-finance-finance-statements');
    DELETE FROM app_windows
     WHERE code IN ('route:/finance/accounting', 'route:/finance/statements');

    DROP FUNCTION IF EXISTS config_menu_seed();
    ALTER FUNCTION config_menu_seed_epic3() RENAME TO config_menu_seed;

    DROP FUNCTION IF EXISTS config_route_window_seed();
    ALTER FUNCTION config_route_window_seed_epic4() RENAME TO config_route_window_seed;
  `);
};
