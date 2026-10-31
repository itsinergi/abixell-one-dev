/**
 * Generic drill-down list (`/drilldown`) — route window catalogue half only.
 *
 * Hidden route (status `tersembunyi`): reachable only from a dashboard card
 * target, never from navigation, so it needs no menu, menu-tree, or
 * terminology rows. Follows the same rename-chain UNION pattern as the
 * dashboard migration, with a fresh snapshot suffix (_a12 — dashboard used
 * _a11, nav-reorg used _a10).
 */
exports.shorthands = undefined;

exports.up = (pgm) => {
  // [path, name, permissions, parent_path, note]
  const ROUTES = [
    [
      "/drilldown",
      "Drill-down",
      ["reporting.read"],
      "/dashboard",
      "Generic drill-down list, reachable only from a dashboard card target.",
    ],
  ];

  function textArray(values) {
    return `ARRAY[${values.map((value) => `'${value.replace(/'/g, "''")}'`).join(", ")}]::text[]`;
  }
  function str(value) {
    return `'${String(value).replace(/'/g, "''")}'`;
  }

  const ROUTE_VALUES = ROUTES.map(
    ([path, name, permissions, parent, note]) =>
      `(${str(`route:${path}`)}, ${str(name)}, 'reporting_insight', 'tersembunyi',\n           ${textArray(permissions)},\n           ${parent ? str(parent) : "NULL"},\n           ${str(note)})`,
  ).join(",\n          ");

  const ROUTE_CODES = ROUTES.map(([path]) => str(`route:${path}`)).join(", ");

  pgm.sql(`
    -- 1. Snapshot the route-window catalogue as the dashboard migration left it
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
         WHERE p.proname = 'config_route_window_seed_a12'
           AND n.nspname = current_schema()
      ) THEN
        ALTER FUNCTION config_route_window_seed()
          RENAME TO config_route_window_seed_a12;
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
        FROM config_route_window_seed_a12() s
      UNION
      SELECT r.code, r.name, r.module_code, r.registration_status,
             r.required_permissions, r.parent_path, r.note
        FROM (VALUES
          ${ROUTE_VALUES}
        ) AS r(code, name, module_code, registration_status, required_permissions, parent_path, note);
    $seed$ LANGUAGE sql IMMUTABLE;

    -- 3. Backfill existing tenants (route window only) -----------------------
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
  `);
};

exports.down = (pgm) => {
  const ROUTE_CODES = ["route:/drilldown"]
    .map((code) => `'${code}'`)
    .join(", ");

  pgm.sql(`
    DELETE FROM app_windows
     WHERE code IN (${ROUTE_CODES});

    DROP FUNCTION IF EXISTS config_route_window_seed();
    ALTER FUNCTION config_route_window_seed_a12() RENAME TO config_route_window_seed;
  `);
};
