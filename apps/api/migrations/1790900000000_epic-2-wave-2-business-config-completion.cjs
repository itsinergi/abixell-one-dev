/**
 * Epic 2 Gelombang 2 — Business Configuration completion (CORE-ROADMAP.md §4.2).
 *
 * Closes the two Wave 2 gaps left open by the Configuration Core foundation
 * (1755700000000) and the menu terminology allowlist (1787500000000):
 *
 *   1. Reference Data needs the tenant-add marker §4.2 promises
 *      ("Reference data ... dengan penanda boleh ditambah tenant") plus a
 *      core/tenant-added distinction on individual items, so a UI can show
 *      which rows are Product Core (undeletable) versus Tenant-authored.
 *   2. The terminology allowlist Epic 3 built for menus only covers menus.
 *      Dictionary objects (Window/Tab/Table/Field) have no equivalent, so a
 *      tenant cannot rename a Window's label the same safe way it can rename
 *      a menu's.
 *
 * ── 1. Reference Data: classification, tenant-add marker, core items ───────
 *
 * `reference_data_types` gains three columns:
 *   - `allow_tenant_add`  (bool, default true)  — every existing type already
 *     behaves this way (nothing in the current catalog blocks a tenant from
 *     adding items), so the default preserves current behavior exactly.
 *   - `is_core`           (bool, default true)  — every row in this table is
 *     migration-seeded Product Core by construction; the column exists so a
 *     future type introduced through a different path (there is none today)
 *     is distinguishable without a schema change.
 *   - `classification`    (text, default 'other', CHECK IN
 *     ('category','type','status','unit','other')) — lets a configuration UI
 *     group types without hardcoding a switch on `code`. Backfilled below by
 *     matching each existing code's naming convention (`%_category` ->
 *     category, `%_type` -> type, `%_status` -> status, the two unit-of-
 *     measure codes -> unit); everything else stays 'other'.
 *
 * `tenant_reference_data_items` gains `is_core` (bool, default false). A row
 * created through `createReferenceDataItem` (the tenant-facing path) is never
 * core; the two generic Configuration Core types (`organization_unit_type`,
 * `priority_level`) get a handful of core items seeded for every tenant below,
 * matching the `config_route_window_seed()` catalogue-function + trigger +
 * backfill pattern already used for windows, dictionary rows, and menus.
 * Module-specific reference types (complaint_category, item_category, etc.)
 * are NOT seeded here — their core items, if any, belong to their own module.
 *
 * ── 2. Dictionary terminology allowlist ─────────────────────────────────────
 *
 * `app_dictionary_terminology_allowlist` is the Window/Tab/Table/Field
 * counterpart to `menu_terminology_allowlist`, same shape reasoning: not an
 * FK to the per-tenant catalog tables (`app_windows` etc. are re-seeded per
 * tenant; the allowlist states, once, which (object, field) pairs may ever be
 * overridden). Only `app_window` rows are seeded in this migration, sourced
 * from `config_route_window_seed()` — the same single source of truth the
 * Wave 1 window catalogue reads. Tab/Table/Field allowlist rows are left for
 * a later change; the table shape already supports them (`object_type` CHECK
 * covers all four), so adding those rows later is additive, not a schema
 * change.
 *
 * `object_key` is the object's canonical path, which is what makes it unique
 * across the dictionary: `<window code>` for a window, `<window code>.<tab
 * code>` for a tab (a tab code is only unique inside its window),
 * `<table code>` for a table, `<table code>.<field code>` for a field (a
 * field code repeats across tables — `name`, `code`). Only the window form is
 * populated here; the reader in `app-metadata.repository.pg.ts` already joins
 * all four with this convention, so seeding the rest later changes no code.
 *
 * Both additions satisfy `scripts/lib/platform-boundary-validator.mjs`:
 * `reference_data_types` and `tenant_reference_data_items` already exist as
 * catalog/tenant tables there (extending them needs no re-classification);
 * `app_dictionary_terminology_allowlist` is new and global (Product Core,
 * no tenant_id column) so it is added to `REVIEWED_NEW_GLOBAL_TABLES`
 * alongside `menu_terminology_allowlist` in the same change (see the
 * validator-config edit accompanying this migration).
 */

exports.shorthands = undefined;

const CORE_REFERENCE_ITEMS = `
  ('organization_unit_type', 'head_office', 'Head Office', 10),
  ('organization_unit_type', 'branch', 'Branch', 20),
  ('organization_unit_type', 'site', 'Site', 30),
  ('priority_level', 'low', 'Low', 10),
  ('priority_level', 'medium', 'Medium', 20),
  ('priority_level', 'high', 'High', 30),
  ('priority_level', 'critical', 'Critical', 40)
`;

exports.up = (pgm) => {
  // ==========================================================================
  // 1. reference_data_types — classification, tenant-add marker, core marker
  // ==========================================================================
  pgm.addColumns("reference_data_types", {
    allow_tenant_add: { type: "boolean", notNull: true, default: true },
    is_core: { type: "boolean", notNull: true, default: true },
    classification: { type: "text", notNull: true, default: "other" },
  });
  pgm.addConstraint("reference_data_types", "reference_data_types_classification_check", {
    check: "classification IN ('category', 'type', 'status', 'unit', 'other')",
  });
  pgm.sql(`
    UPDATE reference_data_types SET classification = CASE
      WHEN code LIKE '%\\_category' ESCAPE '\\' THEN 'category'
      WHEN code LIKE '%\\_type' ESCAPE '\\' OR code = 'organization_unit_type' THEN 'type'
      WHEN code LIKE '%\\_status' ESCAPE '\\' THEN 'status'
      WHEN code IN ('unit_of_measure', 'sales_unit_of_measure') THEN 'unit'
      ELSE 'other'
    END;
  `);

  // ==========================================================================
  // 2. tenant_reference_data_items — core vs tenant-added
  // ==========================================================================
  pgm.addColumns("tenant_reference_data_items", {
    is_core: { type: "boolean", notNull: true, default: false },
  });

  // ==========================================================================
  // 3. Core item catalogue — single source of truth, trigger + backfill
  // ==========================================================================
  pgm.sql(`
    CREATE OR REPLACE FUNCTION config_reference_data_item_seed()
    RETURNS TABLE (type_code TEXT, code TEXT, label TEXT, sort_order INT) AS $seed$
      SELECT * FROM (VALUES
        ${CORE_REFERENCE_ITEMS}
      ) AS s(type_code, code, label, sort_order);
    $seed$ LANGUAGE sql IMMUTABLE;

    CREATE OR REPLACE FUNCTION config_seed_reference_data_items_for_tenant()
    RETURNS TRIGGER AS $trg$
    BEGIN
      INSERT INTO tenant_reference_data_items
        (tenant_id, reference_data_type_id, code, label, sort_order, is_core)
      SELECT NEW.id, rdt.id, s.code, s.label, s.sort_order, true
        FROM config_reference_data_item_seed() s
        JOIN reference_data_types rdt ON rdt.code = s.type_code
      ON CONFLICT (tenant_id, reference_data_type_id, code) DO NOTHING;
      RETURN NEW;
    END;
    $trg$ LANGUAGE plpgsql;

    CREATE TRIGGER trg_config_seed_reference_data_items
      AFTER INSERT ON tenants
      FOR EACH ROW
      EXECUTE FUNCTION config_seed_reference_data_items_for_tenant();

    -- Backfill tenants that already exist.
    INSERT INTO tenant_reference_data_items
      (tenant_id, reference_data_type_id, code, label, sort_order, is_core)
    SELECT t.id, rdt.id, s.code, s.label, s.sort_order, true
      FROM tenants t
      CROSS JOIN config_reference_data_item_seed() s
      JOIN reference_data_types rdt ON rdt.code = s.type_code
    ON CONFLICT (tenant_id, reference_data_type_id, code) DO NOTHING;
  `);

  // ==========================================================================
  // 4. Dictionary terminology allowlist (Window/Tab/Table/Field)
  // ==========================================================================
  pgm.createTable("app_dictionary_terminology_allowlist", {
    id: { type: "uuid", primaryKey: true, default: pgm.func("gen_random_uuid()") },
    object_type: { type: "text", notNull: true },
    /** Stable object code (e.g. a Window's route code). Not an FK — the
     * allowlist is core, the per-tenant catalog tables are re-seeded. */
    object_key: { type: "text", notNull: true },
    field: { type: "text", notNull: true },
    terminology_key_id: {
      type: "uuid",
      notNull: true,
      references: "terminology_keys",
      onDelete: "CASCADE",
    },
    created_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
  });
  pgm.addConstraint(
    "app_dictionary_terminology_allowlist",
    "app_dictionary_terminology_allowlist_unique",
    { unique: ["object_type", "object_key", "field"] },
  );
  pgm.addConstraint(
    "app_dictionary_terminology_allowlist",
    "app_dictionary_terminology_allowlist_object_type_check",
    { check: "object_type IN ('app_window', 'app_tab', 'app_table', 'app_field')" },
  );
  pgm.addConstraint(
    "app_dictionary_terminology_allowlist",
    "app_dictionary_terminology_allowlist_field_check",
    { check: "field IN ('name', 'description')" },
  );

  // Seed — Windows only, from the Wave 1 catalogue function.
  pgm.sql(`
    INSERT INTO terminology_keys (code, default_label, description)
    SELECT 'window.' || s.code || '.name',
           s.name,
           'Tenant label override for the window ' || s.code || ' (Epic 2 Gelombang 2, §4.2).'
      FROM config_route_window_seed() s
    ON CONFLICT (code) DO NOTHING;

    INSERT INTO app_dictionary_terminology_allowlist (object_type, object_key, field, terminology_key_id)
    SELECT 'app_window', s.code, 'name', tk.id
      FROM config_route_window_seed() s
      JOIN terminology_keys tk ON tk.code = 'window.' || s.code || '.name';
  `);
};

exports.down = (pgm) => {
  // Reverse order: allowlist rows before the keys they reference, keys before
  // the table, table before the columns it was built to serve.
  pgm.dropTable("app_dictionary_terminology_allowlist");
  // Delete ONLY the window terminology keys this migration seeded.
  // If a later migration seeded other window.* keys, they are NOT deleted.
  pgm.sql(`
    DELETE FROM terminology_keys tk
      WHERE tk.code IN (
        SELECT 'window.' || s.code || '.name' FROM config_route_window_seed() s
      )
  `);

  pgm.sql(`
    DROP TRIGGER IF EXISTS trg_config_seed_reference_data_items ON tenants;
    DROP FUNCTION IF EXISTS config_seed_reference_data_items_for_tenant();
    -- Remove only the core items this migration seeded; a tenant-added item
    -- sharing the same (type, code) cannot exist because is_core rows are
    -- namespaced by the fixed catalogue above and ON CONFLICT DO NOTHING
    -- never let a tenant-added row collide with one of these codes.
    DELETE FROM tenant_reference_data_items tri
      USING reference_data_types rdt
     WHERE tri.reference_data_type_id = rdt.id
       AND tri.is_core = true
       AND (rdt.code, tri.code) IN (
         SELECT type_code, code FROM config_reference_data_item_seed()
       );
    DROP FUNCTION IF EXISTS config_reference_data_item_seed();
  `);

  pgm.dropColumns("tenant_reference_data_items", ["is_core"]);
  pgm.dropConstraint("reference_data_types", "reference_data_types_classification_check");
  pgm.dropColumns("reference_data_types", ["allow_tenant_add", "is_core", "classification"]);
};
