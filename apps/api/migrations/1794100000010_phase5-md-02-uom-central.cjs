/**
 * WP-MD-02 — UoM central: units_of_measure + unit_conversions.
 *
 * K3 (founder 2026-10-11): existing free-text `items.unit_of_measure`
 * values are auto-created as distinct unit rows (code = upper-trimmed
 * text), then the item rows are linked through the new FK column. Rows
 * that could not be resolved keep `unit_of_measure_needs_review = true`.
 * K4: conversion is a simple factor only (no density/composite).
 */
exports.up = (pgm) => {
  pgm.createTable("units_of_measure", {
    id: { type: "uuid", primaryKey: true, default: pgm.func("gen_random_uuid()") },
    tenant_id: { type: "uuid", notNull: true, references: "tenants", onDelete: "CASCADE" },
    code: { type: "text", notNull: true },
    name: { type: "text", notNull: true },
    base_unit_code: { type: "text", notNull: true },
    category: {
      type: "text",
      notNull: true,
      check: "category IN ('qty', 'vol', 'mass', 'length')",
    },
    is_active: { type: "boolean", notNull: true, default: true },
    created_by: { type: "uuid" },
    created_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
    updated_by: { type: "uuid" },
    updated_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
  });
  pgm.addConstraint("units_of_measure", "units_of_measure_unique", {
    unique: ["tenant_id", "code"],
  });
  pgm.createIndex("units_of_measure", ["tenant_id", "category"]);

  pgm.createTable("unit_conversions", {
    id: { type: "uuid", primaryKey: true, default: pgm.func("gen_random_uuid()") },
    tenant_id: { type: "uuid", notNull: true, references: "tenants", onDelete: "CASCADE" },
    from_unit_id: { type: "uuid", notNull: true, references: "units_of_measure", onDelete: "CASCADE" },
    to_unit_id: { type: "uuid", notNull: true, references: "units_of_measure", onDelete: "CASCADE" },
    // Simple factor (K4): 1 from_unit = factor to_unit. Composite conversions
    // (density, temperature) are deliberately out of scope.
    factor: { type: "numeric(18,6)", notNull: true, check: "factor > 0" },
    effective_from: { type: "date", notNull: true },
    effective_to: { type: "date" },
    created_by: { type: "uuid" },
    created_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
    updated_by: { type: "uuid" },
    updated_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
  });
  pgm.addConstraint("unit_conversions", "unit_conversions_unique_pair", {
    unique: ["tenant_id", "from_unit_id", "to_unit_id"],
  });
  pgm.addConstraint("unit_conversions", "unit_conversions_window_check", {
    check: "effective_to IS NULL OR effective_to >= effective_from",
  });
  pgm.addConstraint("unit_conversions", "unit_conversions_no_self", {
    check: "from_unit_id <> to_unit_id",
  });
  pgm.createIndex("unit_conversions", ["tenant_id", "from_unit_id", "to_unit_id"]);

  // K3 backfill: one unit row per distinct existing free-text value.
  // Orphan `items` rows (tenant_id with no `tenants` row — present in older
  // local/dev databases) are skipped: they cannot satisfy the tenant FK.
  pgm.sql(`
    INSERT INTO units_of_measure (tenant_id, code, name, base_unit_code, category)
    SELECT DISTINCT i.tenant_id,
           upper(btrim(i.unit_of_measure)),
           btrim(i.unit_of_measure),
           upper(btrim(i.unit_of_measure)),
           'qty'
      FROM items i
      JOIN tenants t ON t.id = i.tenant_id
      WHERE i.unit_of_measure IS NOT NULL AND btrim(i.unit_of_measure) <> ''
    ON CONFLICT (tenant_id, code) DO NOTHING;
  `);
  pgm.sql(`
    ALTER TABLE items ADD COLUMN unit_of_measure_id uuid REFERENCES units_of_measure(id) ON DELETE RESTRICT;
    ALTER TABLE items ADD COLUMN unit_of_measure_needs_review boolean NOT NULL DEFAULT false;

    UPDATE items i SET unit_of_measure_id = u.id,
                       unit_of_measure_needs_review = false
      FROM units_of_measure u
     WHERE i.tenant_id = u.tenant_id
       AND upper(btrim(i.unit_of_measure)) = u.code;

    UPDATE items SET unit_of_measure_needs_review = true
     WHERE unit_of_measure_id IS NULL;
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    ALTER TABLE items DROP COLUMN IF EXISTS unit_of_measure_needs_review;
    ALTER TABLE items DROP COLUMN IF EXISTS unit_of_measure_id;
  `);
  pgm.dropTable("unit_conversions", { ifExists: true });
  pgm.dropTable("units_of_measure", { ifExists: true });
};
