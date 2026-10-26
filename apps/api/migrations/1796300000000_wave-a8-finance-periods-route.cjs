/**
 * Wave A8 — Finance Periods lifecycle: locking, reopen requests/approvals/rejections,
 * month-end and year-end closing, ledger creation.
 *
 * Routes: all seven operations map to existing windows (route:/finance/accounts and
 * route:/finance/transactions, set by window-enforcement.ts). No new window rule needed.
 *
 * Permissions: The seven operations span four service-level requirements:
 * - Lock period, request reopen → finance.accounting.period.lock
 * - Close month/year → finance.accounting.period.lock + finance.accounting.approve (both required for year)
 * - Create ledger, approve chart → finance.accounting.configure / finance.accounting.approve
 * - Reverse bank match → finance.accounting.approve
 * - Read (list periods) → finance.accounting.read
 *
 * The page's permission gate is the union: read + period.lock + configure + approve.
 * The page itself lives at /finance/periods.
 *
 * Governance: "Every row names the permission the service layer actually checks, not a broader
 * one that happens to imply it." (A6.2 pattern). The ROUTES row names all four write permissions
 * to avoid a wide but misleading permission list; MENUS rows follow the same principle.
 * All permissions are pre-seeded by migrations 1792000000000 and 1792000000001.
 *
 * Snapshot base: A6.2 (1795900000000_wave-a6-2-finance-advanced-write-routes.cjs).
 * This migration snapshots to _a62, extends the catalogue, and backfills all tenants.
 */

exports.up = (pgm) => {
  const ROUTES = [
    ["/finance/periods", "Periods & Closing",
      ["finance.accounting.read", "finance.accounting.period.lock", "finance.accounting.configure", "finance.accounting.approve"],
      "Wave A8 period lifecycle: lock periods, request their reopen, approve or reject requests, close month or year, and manage ledgers and charts. All seven operations enforce maker-checker and use the kernel for state transitions."],
  ];

  const MENUS = [
    ["nav-finance-finance-periods", "Periods & Closing", "/finance/periods", 120,
      ["finance.accounting.read", "finance.accounting.period.lock", "finance.accounting.configure", "finance.accounting.approve"],
      "Wave A8 period lifecycle: lock periods, request their reopen, approve or reject requests, close month or year, and manage ledgers and charts."],
  ];

  function textArray(values) {
    return `ARRAY[${values.map((value) => `'${value.replace(/'/g, "''")}'`).join(", ")}]::text[]`;
  }
  function str(value) {
    return `'${String(value).replace(/'/g, "''")}'`;
  }
  const ROUTE_CODES = ROUTES.map(([path]) => str(`route:${path}`)).join(", ");
  const MENU_CODES = MENUS.map(([code]) => str(code)).join(", ");
  const TERMINOLOGY_CODES = MENUS.flatMap(([code]) => [
    str(`menu.${code}.name`),
    str(`menu.${code}.description`),
  ]).join(",\n                    ");

  pgm.sql(`
    -- 1. Snapshot the catalogue as A6.2 left it (if not already done) ---------
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
         WHERE p.proname = 'config_route_window_seed_a62'
           AND n.nspname = current_schema()
      ) THEN
        ALTER FUNCTION config_route_window_seed()
          RENAME TO config_route_window_seed_a62;
      END IF;

      IF EXISTS (
        SELECT 1 FROM pg_proc p
          JOIN pg_namespace n ON n.oid = p.pronamespace
         WHERE p.proname = 'config_menu_seed'
           AND n.nspname = current_schema()
      ) AND NOT EXISTS (
        SELECT 1 FROM pg_proc p
          JOIN pg_namespace n ON n.oid = p.pronamespace
         WHERE p.proname = 'config_menu_seed_a62'
           AND n.nspname = current_schema()
      ) THEN
        ALTER FUNCTION config_menu_seed()
          RENAME TO config_menu_seed_a62;
      END IF;
    END
    $$;

    -- 2. Extend the route window catalogue ---------------------------------
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
        FROM config_route_window_seed_a62() s
      UNION
      SELECT r.code, r.name, r.module_code, r.registration_status,
             r.required_permissions, r.parent_path, r.note
        FROM (VALUES
          (${str("route:/finance/periods")}, ${str("Periods & Closing")}, 'finance', 'di_menu',
           ${textArray(ROUTES[0][2])},
           NULL,
           ${str(ROUTES[0][3])})
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
        FROM config_menu_seed_a62() s
      UNION
      SELECT m.code, m.name, m.window_code, m.is_summary, m.module_code,
             m.is_external_allowed, m.required_permissions, m.description,
             m.parent_code, m.seq_no
        FROM (VALUES
          (${str(MENUS[0][0])},
           ${str(MENUS[0][1])},
           ${str(MENUS[0][2])},
           false,
           'finance',
           false,
           ${textArray(MENUS[0][4])},
           ${str(MENUS[0][5])},
           'nav-finance',
           ${MENUS[0][3]})
        ) AS m(code, name, window_code, is_summary, module_code,
               is_external_allowed, required_permissions, description,
               parent_code, seq_no);
    $seed$ LANGUAGE sql IMMUTABLE;

    -- 4. Backfill existing tenants -------------------------------------------
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
  const MENU_CODES = "'nav-finance-finance-periods'";
  const ROUTE_CODES = "'route:/finance/periods'";
  const TERMINOLOGY_CODES = "'menu.nav-finance-finance-periods.name', 'menu.nav-finance-finance-periods.description'";

  pgm.sql(`
    DELETE FROM menu_terminology_allowlist
     WHERE menu_code IN (${MENU_CODES});
    DELETE FROM terminology_keys
     WHERE code IN (${TERMINOLOGY_CODES});

    DELETE FROM app_menu_tree WHERE menu_id IN (
      SELECT id FROM app_menus
       WHERE code IN (${MENU_CODES})
    );
    DELETE FROM app_menus
     WHERE code IN (${MENU_CODES});
    DELETE FROM app_windows
     WHERE code IN (${ROUTE_CODES});

    DROP FUNCTION IF EXISTS config_menu_seed();
    ALTER FUNCTION config_menu_seed_a62() RENAME TO config_menu_seed;

    DROP FUNCTION IF EXISTS config_route_window_seed();
    ALTER FUNCTION config_route_window_seed_a62() RENAME TO config_route_window_seed;
  `);
};
