/**
 * Wave A6.2: the six Finance Advanced write routes and their menu entries.
 *
 * Wave A6 shipped these six work packages as an API-first surface, so every
 * `/accounting/*` route already exists and is already mapped to a Window by
 * `window-enforcement.ts`. Wave A6.1 gave two of them somewhere to look. This
 * migration gives the other six the same:
 *
 *   /finance/journals       FIN-ADV-001  journal draft, validate, post, reverse
 *   /finance/open-items     FIN-ADV-002  AP/AR open items and allocation
 *   /finance/budgets        FIN-ADV-003  budget versions and consumption
 *   /finance/bank-recon     FIN-ADV-004  statement import, matching, close
 *   /finance/fixed-assets   FIN-ADV-005  asset books, depreciation runs
 *   /finance/tax            FIN-ADV-006  PKP registration, rules, rates
 *
 * Shape follows 1795800000000, which follows 1788100000000: the current
 * canonical seed function is renamed to a dated snapshot and the canonical
 * name is redefined as that snapshot UNIONed with the new rows. Both tenant
 * triggers call the catalogue by name at execution time, so future tenants are
 * seeded complete without touching them. Existing tenants are backfilled
 * below, keyed on the conflict target so a re-run is a no-op.
 *
 * Why a second migration rather than editing A6.1: A6.1 is already merged and
 * may already have run somewhere. Rewriting it would leave those databases
 * with two pages and no way to notice the other six were meant to be there.
 *
 * Permissions. Every row names the permission the service layer actually
 * checks, not a broader one that happens to imply it:
 *   - journals      `finance.accounting.manage`  (accounting-kernel.service.ts)
 *   - open items    `finance.accounting.configure` (open-item.service.ts)
 *   - budgets       `finance.accounting.configure` (budget.service.ts)
 *   - bank recon    `finance.accounting.configure` (bank-recon.service.ts)
 *   - fixed assets  `finance.accounting.configure` (asset-book.service.ts)
 *   - tax           `finance.accounting.configure` (tax.service.ts)
 * All six also accept `finance.accounting.read`, because every one of them
 * lists before it writes. No permission is introduced and no `role_permissions`
 * row is written: these five were seeded by 1792000000000.
 *
 * Menu order is the order `NAV_SECTIONS` declares, and `menu-seed-parity.test.ts`
 * compares the two. The two A6.1 pages sit at seq 40 and 50 under nav-finance,
 * so the new six continue at 60..110 and stay below them.
 *
 * Terminology (1787500000000) seeds one key per menu code and
 * `menu-terminology.test.ts` asserts the allowlist and the catalogue have the
 * SAME number of rows. A menu added here is a menu the catalogue now has, so
 * step 5 seeds `menu.<code>.name` and `menu.<code>.description` for each, or
 * that test fails. Both descriptions are inside the 240-character bound the
 * Schema Registry sets on a description override.
 */
exports.shorthands = undefined;

const ROUTES = [
  ["/finance/journals", "Journals", ["finance.accounting.read", "finance.accounting.manage"],
    "Wave A6.2 journal lifecycle: draft, validate, post, reverse. The kernel is the only writer of the general ledger."],
  ["/finance/open-items", "Open Items", ["finance.accounting.read", "finance.accounting.configure"],
    "Wave A6.2 AP/AR open items and allocation. The kernel refuses any pair that is not credit-source to debit-target."],
  ["/finance/budgets", "Budgets", ["finance.accounting.read", "finance.accounting.configure"],
    "Wave A6.2 budget versions and consumption. Approval runs through the approval runtime, not through this page."],
  ["/finance/bank-recon", "Bank Reconciliation", ["finance.accounting.read", "finance.accounting.configure"],
    "Wave A6.2 statement import, match suggestions, manual matches, and close. The service owns the candidate score and the close decision."],
  ["/finance/fixed-assets", "Fixed Assets", ["finance.accounting.read", "finance.accounting.configure"],
    "Wave A6.2 asset books, depreciation runs, run reversal, and disposal. One run posts one journal for every active book."],
  ["/finance/tax", "Tax", ["finance.accounting.read", "finance.accounting.configure"],
    "Wave A6.2 PKP registration, tax rules and rate versions, and tax calculation. Rates are fractions; the service owns the rounding."],
];

const MENUS = [
  ["nav-finance-finance-journals", "Journals", "/finance/journals", 60,
    ["finance.accounting.read", "finance.accounting.manage"],
    "Draft a journal, check it against the kernel, post it, or reverse it."],
  ["nav-finance-finance-open-items", "Open Items", "/finance/open-items", 70,
    ["finance.accounting.read", "finance.accounting.configure"],
    "What customers still owe, what you still owe suppliers, and how they settle."],
  ["nav-finance-finance-budgets", "Budgets", "/finance/budgets", 80,
    ["finance.accounting.read", "finance.accounting.configure"],
    "The baseline for the year, and what has been consumed against it."],
  ["nav-finance-finance-bank-recon", "Bank Reconciliation", "/finance/bank-recon", 90,
    ["finance.accounting.read", "finance.accounting.configure"],
    "Pair the statement with the ledger until only real differences remain."],
  ["nav-finance-finance-fixed-assets", "Fixed Assets", "/finance/fixed-assets", 100,
    ["finance.accounting.read", "finance.accounting.configure"],
    "Asset books, their depreciation runs, and what has been disposed of."],
  ["nav-finance-finance-tax", "Tax", "/finance/tax", 110,
    ["finance.accounting.read", "finance.accounting.configure"],
    "PKP status, the rates in force, and what a basis amount is taxed."],
];

/** Postgres array literal for a text[] column, quoted so no value can break out. */
function textArray(values) {
  return `ARRAY[${values.map((value) => `'${value.replace(/'/g, "''")}'`).join(", ")}]::text[]`;
}

/** Single-quoted SQL string. */
function str(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

const ROUTE_CODES = ROUTES.map(([path]) => str(`route:${path}`)).join(", ");
const MENU_CODES = MENUS.map(([code]) => str(code)).join(", ");
const TERMINOLOGY_CODES = MENUS.flatMap(([code]) => [
  str(`menu.${code}.name`),
  str(`menu.${code}.description`),
]).join(",\n                    ");

exports.up = (pgm) => {
  pgm.sql(`
    -- 1. Snapshot the catalogue as A6.1 left it ------------------------------
    --    The predecessor here is A6.1's canonical function, NOT the epic-3
    --    one A6.1 itself snapshotted. Renaming to the epic-3 name would be a no-op
    --    (that name is taken), and step 3 would then UNION onto the epic-3
    --    catalogue, silently dropping the two A6.1 pages from the seed while
    --    their tenant rows stayed behind — a shape menu-seed-parity.test.ts
    --    catches, but only if something runs it. So each migration snapshots
    --    the name its own predecessor published, under a name of its own.
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
         WHERE p.proname = 'config_route_window_seed_a61'
           AND n.nspname = current_schema()
      ) THEN
        ALTER FUNCTION config_route_window_seed()
          RENAME TO config_route_window_seed_a61;
      END IF;

      IF EXISTS (
        SELECT 1 FROM pg_proc p
          JOIN pg_namespace n ON n.oid = p.pronamespace
         WHERE p.proname = 'config_menu_seed'
           AND n.nspname = current_schema()
      ) AND NOT EXISTS (
        SELECT 1 FROM pg_proc p
          JOIN pg_namespace n ON n.oid = p.pronamespace
         WHERE p.proname = 'config_menu_seed_a61'
           AND n.nspname = current_schema()
      ) THEN
        ALTER FUNCTION config_menu_seed()
          RENAME TO config_menu_seed_a61;
      END IF;
    END
    $$;

    -- 2. Extend the route window catalogue ---------------------------------
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
        FROM config_route_window_seed_a61() s
      UNION
      SELECT r.code, r.name, r.module_code, r.registration_status,
             r.required_permissions, r.parent_path, r.note
        FROM (VALUES
${ROUTES.map(
  ([path, name, perms, note]) =>
    `          (${str(`route:${path}`)}, ${str(name)}, 'finance', 'di_menu',\n           ${textArray(perms)},\n           NULL,\n           ${str(note)})`,
).join(",\n")}
        ) AS r(code, name, module_code, registration_status, required_permissions, parent_path, note);
    $seed$ LANGUAGE sql IMMUTABLE;

    -- 3. Extend the menu catalogue ------------------------------------------
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
        FROM config_menu_seed_a61() s
      UNION
      SELECT m.code, m.name, m.window_code, m.is_summary, m.module_code,
             m.is_external_allowed, m.required_permissions, m.description,
             m.parent_code, m.seq_no
        FROM (VALUES
${MENUS.map(
  ([code, name, windowCode, seq, perms, description]) =>
    `          (${str(code)},\n           ${str(name)},\n           ${str(windowCode)},\n           false,\n           'finance',\n           false,\n           ${textArray(perms)},\n           ${str(description)},\n           'nav-finance',\n           ${seq})`,
).join(",\n")}
        ) AS m(code, name, window_code, is_summary, module_code,
               is_external_allowed, required_permissions, description,
               parent_code, seq_no);
    $seed$ LANGUAGE sql IMMUTABLE;

    -- 4. Backfill existing tenants -------------------------------------------
    --    Windows first: the menu seed resolves window_id by joining the route
    --    window, so a menu inserted before its window would carry a NULL
    --    destination and fail the summary-target check.
    INSERT INTO app_windows (
      tenant_id, code, name, module_code,
      registration_status, required_permissions, parent_path, description
    )
    SELECT t.id, s.code, s.name, s.module_code,
           s.registration_status, s.required_permissions, s.parent_path, s.note
      FROM tenants t
      CROSS JOIN config_route_window_seed() s
     WHERE s.code IN (${ROUTE_CODES})
    ON CONFLICT (tenant_id, code) DO NOTHING;

    --    Then the menus, scoped to the six new codes rather than replaying the
    --    whole catalogue per tenant: config_seed_menus_for_tenant() walks every
    --    row of config_menu_seed() once per tenant, which is the right shape
    --    for bootstrapping and the wrong one for adding six pages.
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
     WHERE s.code IN (${MENU_CODES})
    ON CONFLICT (tenant_id, code) DO NOTHING;

    --    Tree placement last: parents resolve against the now complete set.
    INSERT INTO app_menu_tree (tenant_id, menu_id, parent_id, seq_no)
    SELECT t.id,
           (SELECT id FROM app_menus WHERE tenant_id = t.id AND code = s.code),
           (SELECT id FROM app_menus WHERE tenant_id = t.id AND code = s.parent_code),
           s.seq_no
      FROM tenants t
      CROSS JOIN config_menu_seed() s
     WHERE s.code IN (${MENU_CODES})
    ON CONFLICT (tenant_id, menu_id) DO NOTHING;

    -- 5. Terminology keys and their allowlist rows ---------------------------
    INSERT INTO terminology_keys (code, default_label, description)
    SELECT 'menu.' || s.code || '.name',
           s.name,
           'Tenant label override for the menu ' || s.code || ' (Epic 3 Wave 3, step 11).'
      FROM config_menu_seed() s
     WHERE s.code IN (${MENU_CODES})
    ON CONFLICT (code) DO NOTHING;

    INSERT INTO terminology_keys (code, default_label, description)
    SELECT 'menu.' || s.code || '.description',
           s.description,
           'Tenant description override for the menu ' || s.code || ' (Epic 3 Wave 3, step 11).'
      FROM config_menu_seed() s
     WHERE s.code IN (${MENU_CODES})
       AND s.description IS NOT NULL
    ON CONFLICT (code) DO NOTHING;

    INSERT INTO menu_terminology_allowlist (menu_code, field, terminology_key_id)
    SELECT s.code, 'name', tk.id
      FROM config_menu_seed() s
      JOIN terminology_keys tk ON tk.code = 'menu.' || s.code || '.name'
     WHERE s.code IN (${MENU_CODES})
    ON CONFLICT (menu_code, field) DO NOTHING;

    INSERT INTO menu_terminology_allowlist (menu_code, field, terminology_key_id)
    SELECT s.code, 'description', tk.id
      FROM config_menu_seed() s
      JOIN terminology_keys tk ON tk.code = 'menu.' || s.code || '.description'
     WHERE s.code IN (${MENU_CODES})
       AND s.description IS NOT NULL
    ON CONFLICT (menu_code, field) DO NOTHING;
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    -- Allowlist first: it references the terminology keys, and Postgres refuses
    -- to delete a referenced row while the reference is in place. Deleting the
    -- keys then cascades to any tenant override set against one, so a rollback
    -- cannot leave an override behind for a later re-apply to pick back up.
    DELETE FROM menu_terminology_allowlist
     WHERE menu_code IN (${MENU_CODES});
    DELETE FROM terminology_keys
     WHERE code IN (
                    ${TERMINOLOGY_CODES});

    DELETE FROM app_menu_tree WHERE menu_id IN (
      SELECT id FROM app_menus
       WHERE code IN (${MENU_CODES})
    );
    DELETE FROM app_menus
     WHERE code IN (${MENU_CODES});
    DELETE FROM app_windows
     WHERE code IN (${ROUTE_CODES});

    DROP FUNCTION IF EXISTS config_menu_seed();
    ALTER FUNCTION config_menu_seed_a61() RENAME TO config_menu_seed;

    DROP FUNCTION IF EXISTS config_route_window_seed();
    ALTER FUNCTION config_route_window_seed_a61() RENAME TO config_route_window_seed;
  `);
};
