/**
 * Settings navigation consolidation (user decision 2026-10-31): fold the two
 * admin surfaces — Admin Console (`/admin`) and Panel Admin (`/administration`)
 * — into one Settings surface (`/settings`).
 *
 *   /administration               -> /settings
 *   /admin                       -> /settings
 *   /admin/roles/:roleCode       -> /settings/roles/:roleCode
 *   /administration/complaints   -> /complaints/configuration
 *   nav-administration (menu)    -> nav-settings
 *   nav-admin-console   (menu)    -> nav-settings (merged into the one)
 *
 * Follows the rename-chain UNION pattern (same as the dashboard migration):
 * snapshot both canonical functions under a fresh suffix (_a13), redefine
 * canonical as the snapshot MINUS the retired rows UNION the replacement rows,
 * then backfill existing tenants.
 *
 * NOTE: the suffix must be unique across ALL menu/route migrations. drilldown
 * used _a12, dashboard _a11, nav-reorg _a10; reusing one would make the
 * `IF NOT EXISTS` guard skip the snapshot and redefine canonical from a stale
 * catalogue.
 */
exports.shorthands = undefined;

/** Route-window rows to retire (code). */
const RETIRED_ROUTE_CODES = ["route:/admin", "route:/admin/roles/:roleCode", "route:/administration", "route:/administration/complaints"];

/** Menu rows to retire (code). */
const RETIRED_MENU_CODES = ["nav-admin-console", "nav-administration"];

/** Replacement route-window rows: [code, name, module_code, status, permissions, parent_path, note] */
const ROUTES = [
  [
    "route:/settings",
    "Settings",
    "platform",
    "di_menu",
    [
      "config.manage",
      "config.module.read",
      "config.module.manage",
      "config.platform.read",
      "config.platform.manage",
      "config.org.read",
      "config.org.manage",
      "config.system.read",
      "config.system.manage",
      "config.user.read",
      "config.user.manage",
      "config.workflow.read",
      "config.workflow.manage",
      "config.notification.read",
      "config.notification.manage",
      "config.document.read",
      "config.document.manage",
      "admin.console.read",
    ],
    null,
    "Single Settings surface (consolidated Admin Console + Panel Admin). Granular config.<category>.* gates each tab; admin.console.read gates the governance overview. See CORE-ROADMAP.md §4.15 Decision #7.",
  ],
  [
    "route:/settings/roles/:roleCode",
    "Role Definition",
    "platform",
    "tersembunyi",
    ["admin.console.read"],
    "/settings",
    "Epic 4 Wave 1 — reached from the Settings Users & Access tab. Hidden because it is a drill-down, not a menu entry; it renders the same Window picker the tab shows, and the write path behind it is gated by `role_window_access` (step 11b).",
  ],
  [
    "route:/complaints/configuration",
    "Complaint Configuration",
    "customer_complaint",
    "tersembunyi",
    ["complaint.configure"],
    null,
    "SECURITY GAP CLOSED (Epic 3 §4.3): previously reachable with no client-side gate.",
  ],
];

/** Replacement menu rows: [code, name, window_code, is_summary, module_code, is_external_allowed, permissions, description, parent_code, seq_no] */
const MENUS = [
  [
    "nav-settings",
    "Settings",
    "/settings",
    false,
    null,
    false,
    [
      "config.manage",
      "config.module.read",
      "config.module.manage",
      "config.platform.read",
      "config.platform.manage",
      "config.org.read",
      "config.org.manage",
      "config.system.read",
      "config.system.manage",
      "config.user.read",
      "config.user.manage",
      "config.workflow.read",
      "config.workflow.manage",
      "config.notification.read",
      "config.notification.manage",
      "config.document.read",
      "config.document.manage",
      "admin.console.read",
    ],
    "Organization, users, access, configuration, shared services, backup, appearance, and documents.",
    "nav-governance",
    20,
  ],
];

function textArray(values) {
  return `ARRAY[${values.map((value) => `'${value.replace(/'/g, "''")}'`).join(", ")}]::text[]`;
}
function str(value) {
  return value === null || value === undefined ? "NULL" : `'${String(value).replace(/'/g, "''")}'`;
}

const ROUTE_VALUES = ROUTES.map(
  ([code, name, moduleCode, status, permissions, parent, note]) =>
    `(${str(code)}, ${str(name)}, ${str(moduleCode)}, ${str(status)},\n           ${textArray(permissions)},\n           ${str(parent)},\n           ${str(note)})`,
).join(",\n          ");

const MENU_VALUES = MENUS.map(
  ([code, name, windowCode, isSummary, moduleCode, external, permissions, description, parent, seq]) =>
    `(${str(code)},\n           ${str(name)},\n           ${str(windowCode)},\n           ${isSummary ? "true" : "false"},\n           ${str(moduleCode)},\n           ${external ? "true" : "false"},\n           ${textArray(permissions)},\n           ${str(description)},\n           ${str(parent)},\n           ${seq})`,
).join(",\n          ");

const RETIRED_ROUTE_SQL = RETIRED_ROUTE_CODES.map((c) => `'${c}'`).join(", ");
const RETIRED_MENU_SQL = RETIRED_MENU_CODES.map((c) => `'${c}'`).join(", ");
const NEW_ROUTE_SQL = ROUTES.map(([c]) => `'${c}'`).join(", ");
const NEW_MENU_SQL = MENUS.map(([c]) => `'${c}'`).join(", ");

exports.up = (pgm) => {
  pgm.sql(`
    -- 1. Snapshot both catalogues as drilldown left them ----------------------
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
         WHERE p.proname = 'config_route_window_seed_a13'
           AND n.nspname = current_schema()
      ) THEN
        ALTER FUNCTION config_route_window_seed()
          RENAME TO config_route_window_seed_a13;
      END IF;

      IF EXISTS (
        SELECT 1 FROM pg_proc p
          JOIN pg_namespace n ON n.oid = p.pronamespace
         WHERE p.proname = 'config_menu_seed'
           AND n.nspname = current_schema()
      ) AND NOT EXISTS (
        SELECT 1 FROM pg_proc p
          JOIN pg_namespace n ON n.oid = p.pronamespace
         WHERE p.proname = 'config_menu_seed_a13'
           AND n.nspname = current_schema()
      ) THEN
        ALTER FUNCTION config_menu_seed()
          RENAME TO config_menu_seed_a13;
      END IF;
    END
    $$;

    -- 2. Redefine the route-window catalogue: retire old, add new ------------
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
        FROM config_route_window_seed_a13() s
       WHERE s.code NOT IN (${RETIRED_ROUTE_SQL})
      UNION
      SELECT r.code, r.name, r.module_code, r.registration_status,
             r.required_permissions, r.parent_path, r.note
        FROM (VALUES
          ${ROUTE_VALUES}
        ) AS r(code, name, module_code, registration_status, required_permissions, parent_path, note);
    $seed$ LANGUAGE sql IMMUTABLE;

    -- 3. Redefine the menu catalogue: retire old, add new --------------------
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
        FROM config_menu_seed_a13() s
       WHERE s.code NOT IN (${RETIRED_MENU_SQL})
      UNION
      SELECT m.code, m.name, m.window_code, m.is_summary, m.module_code,
             m.is_external_allowed, m.required_permissions, m.description,
             m.parent_code, m.seq_no
        FROM (VALUES
          ${MENU_VALUES}
        ) AS m(code, name, window_code, is_summary, module_code,
               is_external_allowed, required_permissions, description,
               parent_code, seq_no);
    $seed$ LANGUAGE sql IMMUTABLE;

    -- 4. Backfill existing tenants -------------------------------------------
    -- Orphan rows (tenant_id not in tenants) are leftover test data; they
    -- trip the tenant FK on UPDATE below, so drop them (and their tree rows)
    -- first. Harmless in production, where none exist.
    DELETE FROM app_menu_tree
     WHERE tenant_id NOT IN (SELECT id FROM tenants);
    DELETE FROM app_menus
     WHERE tenant_id NOT IN (SELECT id FROM tenants);

    -- Retire the old windows (tree rows first, then the windows). The retired
    -- menus' terminology allowlist rows must go too, or the allowlist drifts
    -- from the seed catalogue (menu-terminology parity test asserts exact match).
    DELETE FROM app_menu_tree
     WHERE menu_id IN (SELECT id FROM app_menus WHERE code IN (${RETIRED_MENU_SQL}));
    DELETE FROM menu_terminology_allowlist
     WHERE menu_code IN (${RETIRED_MENU_SQL});
    DELETE FROM app_menus
     WHERE code IN (${RETIRED_MENU_SQL});
    DELETE FROM app_windows
     WHERE code IN (${RETIRED_ROUTE_SQL});

    -- Add the Settings window.
    INSERT INTO app_windows (
      tenant_id, code, name, module_code,
      registration_status, required_permissions, parent_path, description
    )
    SELECT t.id, s.code, s.name, s.module_code,
           s.registration_status, s.required_permissions, s.parent_path, s.note
      FROM tenants t
      CROSS JOIN config_route_window_seed() s
     WHERE s.code IN (${NEW_ROUTE_SQL})
    ON CONFLICT (tenant_id, code) DO NOTHING;

    -- Add the Settings menu.
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
     WHERE s.code IN (${NEW_MENU_SQL})
    ON CONFLICT (tenant_id, code) DO NOTHING;

    INSERT INTO app_menu_tree (tenant_id, menu_id, parent_id, seq_no)
    SELECT t.id,
           (SELECT id FROM app_menus WHERE tenant_id = t.id AND code = s.code),
           (SELECT id FROM app_menus WHERE tenant_id = t.id AND code = s.parent_code),
           s.seq_no
      FROM tenants t
      CROSS JOIN config_menu_seed() s
     WHERE s.code IN (${NEW_MENU_SQL})
    ON CONFLICT (tenant_id, menu_id) DO NOTHING;

    -- 5. Terminology keys and their allowlist rows for the new menu -----------
    INSERT INTO terminology_keys (code, default_label, description)
    SELECT 'menu.' || s.code || '.name',
           s.name,
           'Tenant label override for the menu ' || s.code || ' (Epic 3 Wave 3, step 11).'
      FROM config_menu_seed() s
     WHERE s.code IN (${NEW_MENU_SQL})
    ON CONFLICT (code) DO NOTHING;

    INSERT INTO terminology_keys (code, default_label, description)
    SELECT 'menu.' || s.code || '.description',
           s.description,
           'Tenant description override for the menu ' || s.code || ' (Epic 3 Wave 3, step 11).'
      FROM config_menu_seed() s
     WHERE s.code IN (${NEW_MENU_SQL})
       AND s.description IS NOT NULL
    ON CONFLICT (code) DO NOTHING;

    INSERT INTO menu_terminology_allowlist (menu_code, field, terminology_key_id)
    SELECT s.code, 'name', tk.id
      FROM config_menu_seed() s
      JOIN terminology_keys tk ON tk.code = 'menu.' || s.code || '.name'
     WHERE s.code IN (${NEW_MENU_SQL})
    ON CONFLICT (menu_code, field) DO NOTHING;

    INSERT INTO menu_terminology_allowlist (menu_code, field, terminology_key_id)
    SELECT s.code, 'description', tk.id
      FROM config_menu_seed() s
      JOIN terminology_keys tk ON tk.code = 'menu.' || s.code || '.description'
     WHERE s.code IN (${NEW_MENU_SQL})
       AND s.description IS NOT NULL
    ON CONFLICT (menu_code, field) DO NOTHING;
  `);
};

exports.down = (pgm) => {
  const ROUTE_CODES = ROUTES.map(([c]) => `'${c}'`).join(", ");
  const MENU_CODES = MENUS.map(([c]) => `'${c}'`).join(", ");
  const TERMINOLOGY_CODES = MENUS
    .flatMap(([c]) => [`'menu.${c}.name'`, `'menu.${c}.description'`])
    .join(", ");

  pgm.sql(`
    DELETE FROM menu_terminology_allowlist
     WHERE menu_code IN (${MENU_CODES});
    DELETE FROM terminology_keys
     WHERE code IN (${TERMINOLOGY_CODES});

    DELETE FROM app_menu_tree WHERE menu_id IN (
      SELECT id FROM app_menus WHERE code IN (${MENU_CODES})
    );
    DELETE FROM app_menus WHERE code IN (${MENU_CODES});
    DELETE FROM app_windows WHERE code IN (${ROUTE_CODES});

    DROP FUNCTION IF EXISTS config_menu_seed();
    ALTER FUNCTION config_menu_seed_a13() RENAME TO config_menu_seed;

    DROP FUNCTION IF EXISTS config_route_window_seed();
    ALTER FUNCTION config_route_window_seed_a13() RENAME TO config_route_window_seed;
  `);
};
