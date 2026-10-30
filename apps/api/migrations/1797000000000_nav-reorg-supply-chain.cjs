/**
 * Nav reorganization (user request 2026-10-30): fold Supply Chain's nav
 * contents into Warehouse Management and Procurement Management, then drop
 * the now-empty Supply Chain nav folder.
 *
 *   Items & Stock      -> Warehouse Management    (module warehouse_management)
 *   Suppliers           -> Procurement Management  (module procurement_management)
 *   Purchasing          -> Procurement Management  (module procurement_management)
 *   Supply Chain folder -> deleted
 *
 * Menu codes follow the frontend derivation `nav-<moduleCode>-<key>`, so the
 * three leaves are renamed as well as re-moduled/reparented. The backend
 * `supply_chain` module stays: it still owns the supply_chain.* permissions
 * and API segments those pages require. Only the nav folder and the frontend
 * nav metadata are removed (capabilities.ts ModuleCode / MODULE_METADATA,
 * navLabels.ts, route registries).
 *
 * Follows the rename-chain pattern: snapshot config_menu_seed() under a fresh
 * suffix (_a10), redefine canonical as a transformed view of it, then backfill
 * existing tenants (rename, reparent, re-module, retag terminology, delete the
 * folder).
 */
exports.shorthands = undefined;

/** Old code → new code for the three moved leaves. */
const RENAMES = [
  ["nav-supply_chain-items", "nav-warehouse_management-items"],
  ["nav-supply_chain-suppliers", "nav-procurement_management-suppliers"],
  ["nav-supply_chain-purchasing", "nav-procurement_management-purchasing"],
];

/** Old code → new module code. */
const MODULES = {
  "nav-supply_chain-items": "warehouse_management",
  "nav-supply_chain-suppliers": "procurement_management",
  "nav-supply_chain-purchasing": "procurement_management",
};

/** Old code → new parent code. */
const PARENTS = {
  "nav-supply_chain-items": "nav-warehouse_management",
  "nav-supply_chain-suppliers": "nav-procurement_management",
  "nav-supply_chain-purchasing": "nav-procurement_management",
};

/** Old code → new seq_no. */
const SEQS = {
  "nav-supply_chain-items": 5,
  "nav-supply_chain-suppliers": 40,
  "nav-supply_chain-purchasing": 50,
};

exports.up = (pgm) => {
  const renamed = RENAMES.map(([, n]) => `'${n}'`).join(", ");
  const oldCodes = RENAMES.map(([o]) => `'${o}'`).join(", ");

  pgm.sql(`
    -- 1. Snapshot the catalogue as A9 left it ---------------------------------
    DO $$
    BEGIN
      IF EXISTS (
        SELECT 1 FROM pg_proc p
          JOIN pg_namespace n ON n.oid = p.pronamespace
         WHERE p.proname = 'config_menu_seed'
           AND n.nspname = current_schema()
      ) AND NOT EXISTS (
        SELECT 1 FROM pg_proc p
          JOIN pg_namespace n ON n.oid = p.pronamespace
         WHERE p.proname = 'config_menu_seed_a10'
           AND n.nspname = current_schema()
      ) THEN
        ALTER FUNCTION config_menu_seed()
          RENAME TO config_menu_seed_a10;
      END IF;
    END
    $$;

    -- 2. Redefine the catalogue: rename, reparent, re-module, drop the folder --
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
      SELECT
             CASE s.code
               WHEN 'nav-supply_chain-items' THEN 'nav-warehouse_management-items'
               WHEN 'nav-supply_chain-suppliers' THEN 'nav-procurement_management-suppliers'
               WHEN 'nav-supply_chain-purchasing' THEN 'nav-procurement_management-purchasing'
               ELSE s.code
             END,
             s.name, s.window_code, s.is_summary,
             CASE s.code
               WHEN 'nav-supply_chain-items' THEN 'warehouse_management'
               WHEN 'nav-supply_chain-suppliers' THEN 'procurement_management'
               WHEN 'nav-supply_chain-purchasing' THEN 'procurement_management'
               ELSE s.module_code
             END,
             s.is_external_allowed, s.required_permissions, s.description,
             CASE s.code
               WHEN 'nav-supply_chain-items' THEN 'nav-warehouse_management'
               WHEN 'nav-supply_chain-suppliers' THEN 'nav-procurement_management'
               WHEN 'nav-supply_chain-purchasing' THEN 'nav-procurement_management'
               ELSE s.parent_code
             END,
             CASE s.code
               WHEN 'nav-supply_chain-items' THEN 5
               WHEN 'nav-supply_chain-suppliers' THEN 40
               WHEN 'nav-supply_chain-purchasing' THEN 50
               ELSE s.seq_no
             END
        FROM config_menu_seed_a10() s
       WHERE s.code <> 'nav-supply_chain';
    $seed$ LANGUAGE sql IMMUTABLE;

    -- 3. Backfill existing tenants -------------------------------------------
    -- Orphan rows (tenant_id not in tenants) are leftover test data; they
    -- trip the tenant FK on UPDATE below, so drop them (and their tree rows)
    -- first. Harmless in production, where none exist.
    DELETE FROM app_menu_tree
     WHERE tenant_id NOT IN (SELECT id FROM tenants);
    DELETE FROM app_menus
     WHERE tenant_id NOT IN (SELECT id FROM tenants);

    -- Rename the three menu codes.
    UPDATE app_menus SET code = 'nav-warehouse_management-items'
     WHERE code = 'nav-supply_chain-items';
    UPDATE app_menus SET code = 'nav-procurement_management-suppliers'
     WHERE code = 'nav-supply_chain-suppliers';
    UPDATE app_menus SET code = 'nav-procurement_management-purchasing'
     WHERE code = 'nav-supply_chain-purchasing';

    -- Re-module the three moved leaves.
    UPDATE app_menus
       SET module_id = (SELECT id FROM modules WHERE code = 'warehouse_management')
     WHERE code = 'nav-warehouse_management-items';
    UPDATE app_menus
       SET module_id = (SELECT id FROM modules WHERE code = 'procurement_management')
     WHERE code IN ('nav-procurement_management-suppliers', 'nav-procurement_management-purchasing');

    -- Reparent the three moved leaves (tree first, so the folder can go).
    UPDATE app_menu_tree t
       SET parent_id = (SELECT id FROM app_menus m
                         WHERE m.tenant_id = t.tenant_id AND m.code = 'nav-warehouse_management'),
           seq_no = 5
      FROM app_menus m
     WHERE m.id = t.menu_id
       AND m.code = 'nav-warehouse_management-items';

    UPDATE app_menu_tree t
       SET parent_id = (SELECT id FROM app_menus m
                         WHERE m.tenant_id = t.tenant_id AND m.code = 'nav-procurement_management'),
           seq_no = 40
      FROM app_menus m
     WHERE m.id = t.menu_id
       AND m.code = 'nav-procurement_management-suppliers';

    UPDATE app_menu_tree t
       SET parent_id = (SELECT id FROM app_menus m
                         WHERE m.tenant_id = t.tenant_id AND m.code = 'nav-procurement_management'),
           seq_no = 50
      FROM app_menus m
     WHERE m.id = t.menu_id
       AND m.code = 'nav-procurement_management-purchasing';

    -- Drop the now-empty Supply Chain folder (tree row first, then the menu).
    DELETE FROM app_menu_tree
     WHERE menu_id IN (SELECT id FROM app_menus WHERE code = 'nav-supply_chain');
    DELETE FROM app_menus WHERE code = 'nav-supply_chain';

    -- Retag terminology keys and allowlist rows for the three moved leaves.
    UPDATE terminology_keys
       SET code = 'menu.nav-warehouse_management-items.name'
     WHERE code = 'menu.nav-supply_chain-items.name';
    UPDATE terminology_keys
       SET code = 'menu.nav-warehouse_management-items.description'
     WHERE code = 'menu.nav-supply_chain-items.description';
    UPDATE terminology_keys
       SET code = 'menu.nav-procurement_management-suppliers.name'
     WHERE code = 'menu.nav-supply_chain-suppliers.name';
    UPDATE terminology_keys
       SET code = 'menu.nav-procurement_management-suppliers.description'
     WHERE code = 'menu.nav-supply_chain-suppliers.description';
    UPDATE terminology_keys
       SET code = 'menu.nav-procurement_management-purchasing.name'
     WHERE code = 'menu.nav-supply_chain-purchasing.name';
    UPDATE terminology_keys
       SET code = 'menu.nav-procurement_management-purchasing.description'
     WHERE code = 'menu.nav-supply_chain-purchasing.description';

    UPDATE menu_terminology_allowlist
       SET menu_code = 'nav-warehouse_management-items'
     WHERE menu_code = 'nav-supply_chain-items';
    UPDATE menu_terminology_allowlist
       SET menu_code = 'nav-procurement_management-suppliers'
     WHERE menu_code = 'nav-supply_chain-suppliers';
    UPDATE menu_terminology_allowlist
       SET menu_code = 'nav-procurement_management-purchasing'
     WHERE menu_code = 'nav-supply_chain-purchasing';

    -- Remove the folder's terminology keys and their allowlist rows.
    DELETE FROM menu_terminology_allowlist
     WHERE menu_code = 'nav-supply_chain';
    DELETE FROM terminology_keys
     WHERE code IN ('menu.nav-supply_chain.name', 'menu.nav-supply_chain.description');
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    -- Restore the folder row in app_menus.
    INSERT INTO app_menus (
      tenant_id, code, name, description, action, window_id,
      is_summary, module_id, is_external_allowed, required_permissions
    )
    SELECT t.id, 'nav-supply_chain', 'Supply Chain', NULL, 'window', NULL,
           true, (SELECT id FROM modules WHERE code = 'supply_chain'), false, '{}'::text[]
      FROM tenants t
    ON CONFLICT (tenant_id, code) DO NOTHING;

    -- Reparent the three leaves back under the folder.
    UPDATE app_menu_tree t
       SET parent_id = (SELECT id FROM app_menus m
                         WHERE m.tenant_id = t.tenant_id AND m.code = 'nav-supply_chain'),
           seq_no = CASE m.code
             WHEN 'nav-warehouse_management-items' THEN 10
             WHEN 'nav-procurement_management-suppliers' THEN 20
             ELSE 30 END
      FROM app_menus m
     WHERE m.id = t.menu_id
       AND m.code IN ('nav-warehouse_management-items','nav-procurement_management-suppliers','nav-procurement_management-purchasing');

    -- Re-module.
    UPDATE app_menus
       SET module_id = (SELECT id FROM modules WHERE code = 'supply_chain')
     WHERE code IN ('nav-warehouse_management-items','nav-procurement_management-suppliers','nav-procurement_management-purchasing');

    -- Rename the menu codes back.
    UPDATE app_menus SET code = 'nav-supply_chain-items' WHERE code = 'nav-warehouse_management-items';
    UPDATE app_menus SET code = 'nav-supply_chain-suppliers' WHERE code = 'nav-procurement_management-suppliers';
    UPDATE app_menus SET code = 'nav-supply_chain-purchasing' WHERE code = 'nav-procurement_management-purchasing';

    -- Restore terminology keys.
    UPDATE terminology_keys SET code = 'menu.nav-supply_chain-items.name' WHERE code = 'menu.nav-warehouse_management-items.name';
    UPDATE terminology_keys SET code = 'menu.nav-supply_chain-items.description' WHERE code = 'menu.nav-warehouse_management-items.description';
    UPDATE terminology_keys SET code = 'menu.nav-supply_chain-suppliers.name' WHERE code = 'menu.nav-procurement_management-suppliers.name';
    UPDATE terminology_keys SET code = 'menu.nav-supply_chain-suppliers.description' WHERE code = 'menu.nav-procurement_management-suppliers.description';
    UPDATE terminology_keys SET code = 'menu.nav-supply_chain-purchasing.name' WHERE code = 'menu.nav-procurement_management-purchasing.name';
    UPDATE terminology_keys SET code = 'menu.nav-supply_chain-purchasing.description' WHERE code = 'menu.nav-procurement_management-purchasing.description';

    UPDATE menu_terminology_allowlist SET menu_code = 'nav-supply_chain-items' WHERE menu_code = 'nav-warehouse_management-items';
    UPDATE menu_terminology_allowlist SET menu_code = 'nav-supply_chain-suppliers' WHERE menu_code = 'nav-procurement_management-suppliers';
    UPDATE menu_terminology_allowlist SET menu_code = 'nav-supply_chain-purchasing' WHERE menu_code = 'nav-procurement_management-purchasing';

    -- Restore the folder's terminology keys and allowlist.
    INSERT INTO terminology_keys (code, default_label, description)
    VALUES ('menu.nav-supply_chain.name', 'Supply Chain', 'Tenant label override for the menu nav-supply_chain (Epic 3 Wave 3, step 11).')
    ON CONFLICT (code) DO NOTHING;

    INSERT INTO menu_terminology_allowlist (menu_code, field, terminology_key_id)
    SELECT 'nav-supply_chain', 'name', tk.id
      FROM terminology_keys tk
     WHERE tk.code = 'menu.nav-supply_chain.name'
    ON CONFLICT (menu_code, field) DO NOTHING;

    -- Restore the canonical function.
    DROP FUNCTION IF EXISTS config_menu_seed();
    ALTER FUNCTION config_menu_seed_a10() RENAME TO config_menu_seed;
  `);
};
