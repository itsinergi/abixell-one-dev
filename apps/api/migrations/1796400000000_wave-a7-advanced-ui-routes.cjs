/**
 * Wave A7 — Advanced UI: the five client routes the A7 API has been serving
 * since 1796000000000 / 1796100000000 without a page to open.
 *
 * Wave A7's ledger entry says it "deliberately delivers no Advanced UI for
 * either module". This migration is that UI's catalogue half: the route rows,
 * the menu rows, and their terminology keys, so a tenant that holds an Advanced
 * permission actually sees the pages.
 *
 * No new permission is introduced and no role_permissions row is written. The
 * menu's required permissions are data read by the server-side filter; they are
 * never a grant. The five permissions named here were catalogued by the A7
 * schema migrations (1796000000000, 1796100000000).
 *
 * Windows: all five pages read and write through API paths the A7 window rules
 * already cover — `/hse/advanced/*` under `route:/hse`, `/project-delivery/*`
 * under `route:/project-delivery` and its named siblings. No new window rule,
 * hence no change to window-enforcement.ts.
 *
 * Snapshot base: A8 (1796300000000_wave-a8-finance-periods-route.cjs).
 * Rename-chain UNION pattern: snapshot the canonical function under `_a8`,
 * redefine canonical as that snapshot UNION the new rows, then backfill.
 */
exports.shorthands = undefined;

exports.up = (pgm) => {
  // [path, name, permissions, note]
  const ROUTES = [
    [
      "/hse/advanced/investigations",
      "Investigations & Risk",
      ["hse.advanced.read", "hse.advanced.manage", "hse.investigation.lead"],
      "Wave A7 HSE Advanced. Versioned investigation frameworks, findings and root cause, the tenant risk matrix, and JSA/HIRA assessments.",
    ],
    [
      "/hse/advanced/permits-audit",
      "Permits & Audit",
      ["hse.advanced.read", "hse.advanced.manage", "hse.permit.request"],
      "Wave A7 HSE Advanced. Work permits whose lifecycle the Workflow Engine owns (ADR-0027 §4), plus audit programmes, occurrences and findings.",
    ],
    [
      "/hse/advanced/monitoring-capa",
      "Monitoring & CAPA",
      ["hse.advanced.read", "hse.advanced.manage", "hse.capa.verify"],
      "Wave A7 HSE Advanced. Threshold monitoring with breach flags written at reading time (ADR-0027 §6), CAPA anchored by reference (§1), and frozen indicator snapshots.",
    ],
    [
      "/project-delivery/advanced/planning",
      "Planning & Scheduling",
      [
        "project_delivery.advanced.read",
        "project_delivery.advanced.manage",
        "project_delivery.read",
        "project_delivery.manage",
      ],
      "Wave A7 Project Delivery Advanced (PRJ-ADV-001…004). The work breakdown, dependencies, Gantt, resource loading, and baseline variance.",
    ],
    [
      "/project-delivery/advanced/cost-ev",
      "Cost & Earned Value",
      [
        "project_delivery.cost.read",
        "project_delivery.cost.manage",
        "project_delivery.advanced.read",
        "project_delivery.advanced.manage",
      ],
      "Wave A7 Project Delivery Advanced (PRJ-ADV-005…008). Cost entries and position, earned value, and the snapshot history it is measured against.",
    ],
  ];

  // [code, name, path, seq_no, parent_code, module_code, permissions, description]
  const MENUS = [
    [
      "nav-hse-hse-advanced-investigations",
      "Investigations & Risk",
      "/hse/advanced/investigations",
      20,
      "nav-hse",
      "hse",
      ["hse.advanced.read", "hse.advanced.manage", "hse.investigation.lead"],
      "Versioned investigation frameworks, root cause, and JSA/HIRA risk assessments.",
    ],
    [
      "nav-hse-hse-advanced-permits-audit",
      "Permits & Audit",
      "/hse/advanced/permits-audit",
      30,
      "nav-hse",
      "hse",
      ["hse.advanced.read", "hse.advanced.manage", "hse.permit.request"],
      "Work permits on the Workflow Engine, plus audit programmes, occurrences and findings.",
    ],
    [
      "nav-hse-hse-advanced-monitoring-capa",
      "Monitoring & CAPA",
      "/hse/advanced/monitoring-capa",
      40,
      "nav-hse",
      "hse",
      ["hse.advanced.read", "hse.advanced.manage", "hse.capa.verify"],
      "Threshold monitoring with breach flags, corrective and preventive actions, and indicator snapshots.",
    ],
    [
      "nav-project_delivery-project-delivery-advanced-planning",
      "Planning & Scheduling",
      "/project-delivery/advanced/planning",
      20,
      "nav-project_delivery",
      "project_delivery",
      [
        "project_delivery.advanced.read",
        "project_delivery.advanced.manage",
        "project_delivery.read",
        "project_delivery.manage",
      ],
      "The work breakdown, dependencies, the Gantt view, resource loading, and baseline variance.",
    ],
    [
      "nav-project_delivery-project-delivery-advanced-cost-ev",
      "Cost & Earned Value",
      "/project-delivery/advanced/cost-ev",
      30,
      "nav-project_delivery",
      "project_delivery",
      [
        "project_delivery.cost.read",
        "project_delivery.cost.manage",
        "project_delivery.advanced.read",
        "project_delivery.advanced.manage",
      ],
      "Cost entries and position, earned value, and the snapshot history it is measured against.",
    ],
  ];

  function textArray(values) {
    return `ARRAY[${values.map((value) => `'${value.replace(/'/g, "''")}'`).join(", ")}]::text[]`;
  }
  function str(value) {
    return `'${String(value).replace(/'/g, "''")}'`;
  }

  const ROUTE_VALUES = ROUTES.map(
    ([path, name, permissions, note]) =>
      `(${str(`route:${path}`)}, ${str(name)}, '${path.split("/")[1] === "hse" ? "hse" : "project_delivery"}', 'di_menu',\n           ${textArray(permissions)},\n           NULL,\n           ${str(note)})`,
  ).join(",\n          ");

  const MENU_VALUES = MENUS.map(
    ([code, name, path, seq, parent, moduleCode, permissions, description]) =>
      `(${str(code)},\n           ${str(name)},\n           ${str(path)},\n           false,\n           '${moduleCode}',\n           false,\n           ${textArray(permissions)},\n           ${str(description)},\n           ${str(parent)},\n           ${seq})`,
  ).join(",\n          ");

  const ROUTE_CODES = ROUTES.map(([path]) => str(`route:${path}`)).join(", ");
  const MENU_CODES = MENUS.map(([code]) => str(code)).join(",\n               ");
  const TERMINOLOGY_CODES = MENUS.flatMap(([code]) => [
    str(`menu.${code}.name`),
    str(`menu.${code}.description`),
  ]).join(",\n               ");

  pgm.sql(`
    -- 1. Snapshot the catalogue as A8 left it (if not already done) ---------
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
         WHERE p.proname = 'config_route_window_seed_a8'
           AND n.nspname = current_schema()
      ) THEN
        ALTER FUNCTION config_route_window_seed()
          RENAME TO config_route_window_seed_a8;
      END IF;

      IF EXISTS (
        SELECT 1 FROM pg_proc p
          JOIN pg_namespace n ON n.oid = p.pronamespace
         WHERE p.proname = 'config_menu_seed'
           AND n.nspname = current_schema()
      ) AND NOT EXISTS (
        SELECT 1 FROM pg_proc p
          JOIN pg_namespace n ON n.oid = p.pronamespace
         WHERE p.proname = 'config_menu_seed_a8'
           AND n.nspname = current_schema()
      ) THEN
        ALTER FUNCTION config_menu_seed()
          RENAME TO config_menu_seed_a8;
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
        FROM config_route_window_seed_a8() s
      UNION
      SELECT r.code, r.name, r.module_code, r.registration_status,
             r.required_permissions, r.parent_path, r.note
        FROM (VALUES
          ${ROUTE_VALUES}
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
        FROM config_menu_seed_a8() s
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
  const MENU_CODES = [
    "nav-hse-hse-advanced-investigations",
    "nav-hse-hse-advanced-permits-audit",
    "nav-hse-hse-advanced-monitoring-capa",
    "nav-project_delivery-project-delivery-advanced-planning",
    "nav-project_delivery-project-delivery-advanced-cost-ev",
  ]
    .map((code) => `'${code}'`)
    .join(", ");

  const ROUTE_CODES = [
    "route:/hse/advanced/investigations",
    "route:/hse/advanced/permits-audit",
    "route:/hse/advanced/monitoring-capa",
    "route:/project-delivery/advanced/planning",
    "route:/project-delivery/advanced/cost-ev",
  ]
    .map((code) => `'${code}'`)
    .join(", ");

  const TERMINOLOGY_CODES = [
    "nav-hse-hse-advanced-investigations",
    "nav-hse-hse-advanced-permits-audit",
    "nav-hse-hse-advanced-monitoring-capa",
    "nav-project_delivery-project-delivery-advanced-planning",
    "nav-project_delivery-project-delivery-advanced-cost-ev",
  ]
    .flatMap((code) => [`'menu.${code}.name'`, `'menu.${code}.description'`])
    .join(", ");

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
    ALTER FUNCTION config_menu_seed_a8() RENAME TO config_menu_seed;

    DROP FUNCTION IF EXISTS config_route_window_seed();
    ALTER FUNCTION config_route_window_seed_a8() RENAME TO config_route_window_seed;
  `);
};
