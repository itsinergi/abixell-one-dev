/**
 * WP-MD-01 — Finance master data: cost centers + payment terms.
 *
 * K1 (founder 2026-10-11): cost center hierarchy is parent-child, one level
 * deep (enforced by a trigger so parent rows can never themselves have a
 * parent). K2: existing `journal_lines.cost_center_id` values are uuid
 * already; no text backfill is needed, so this migration only adds the FK
 * where the dimension lives. Effective dating is enforced in the service
 * layer (overlap check) and by a CHECK that the window is ordered.
 */
exports.up = (pgm) => {
  pgm.createTable("finance_cost_centers", {
    id: { type: "uuid", primaryKey: true, default: pgm.func("gen_random_uuid()") },
    tenant_id: { type: "uuid", notNull: true, references: "tenants", onDelete: "CASCADE" },
    code: { type: "text", notNull: true },
    name: { type: "text", notNull: true },
    type: {
      type: "text",
      notNull: true,
      default: "cost",
      check: "type IN ('cost', 'profit')",
    },
    // K1: parent-child, one level. A child references a parent in the same
    // tenant; the trigger below refuses a parent that itself has a parent.
    parent_id: { type: "uuid", references: "finance_cost_centers", onDelete: "SET NULL" },
    legal_entity_id: { type: "uuid", references: "legal_entities", onDelete: "SET NULL" },
    org_unit_id: { type: "uuid", references: "organization_units", onDelete: "SET NULL" },
    status: {
      type: "text",
      notNull: true,
      default: "active",
      check: "status IN ('active', 'inactive')",
    },
    effective_from: { type: "date", notNull: true },
    effective_to: { type: "date" },
    created_by: { type: "uuid" },
    created_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
    updated_by: { type: "uuid" },
    updated_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
  });
  pgm.addConstraint("finance_cost_centers", "finance_cost_centers_unique", {
    unique: ["tenant_id", "code"],
  });
  pgm.addConstraint("finance_cost_centers", "finance_cost_centers_window_check", {
    check: "effective_to IS NULL OR effective_to >= effective_from",
  });
  pgm.sql(`
    CREATE FUNCTION guard_cost_center_depth() RETURNS trigger AS $$
    BEGIN
      IF NEW.parent_id IS NOT NULL THEN
        IF NEW.parent_id = NEW.id THEN
          RAISE EXCEPTION 'cost center cannot be its own parent';
        END IF;
        IF EXISTS (SELECT 1 FROM finance_cost_centers p
                    WHERE p.id = NEW.parent_id AND p.parent_id IS NOT NULL) THEN
          RAISE EXCEPTION 'cost center hierarchy is limited to one level (K1)';
        END IF;
      END IF;
      RETURN NEW;
    END $$ LANGUAGE plpgsql;

    CREATE TRIGGER trg_cost_center_depth
      BEFORE INSERT OR UPDATE ON finance_cost_centers
      FOR EACH ROW EXECUTE FUNCTION guard_cost_center_depth();
  `);
  pgm.createIndex("finance_cost_centers", ["tenant_id", "status"]);

  pgm.createTable("finance_payment_terms", {
    id: { type: "uuid", primaryKey: true, default: pgm.func("gen_random_uuid()") },
    tenant_id: { type: "uuid", notNull: true, references: "tenants", onDelete: "CASCADE" },
    code: { type: "text", notNull: true },
    name: { type: "text", notNull: true },
    net_days: { type: "integer", notNull: true, check: "net_days >= 0" },
    discount_days: { type: "integer", check: "discount_days IS NULL OR discount_days >= 0" },
    discount_percent: {
      type: "numeric(5,2)",
      check: "discount_percent IS NULL OR (discount_percent >= 0 AND discount_percent <= 100)",
    },
    effective_from: { type: "date", notNull: true },
    effective_to: { type: "date" },
    created_by: { type: "uuid" },
    created_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
    updated_by: { type: "uuid" },
    updated_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
  });
  pgm.addConstraint("finance_payment_terms", "finance_payment_terms_unique", {
    unique: ["tenant_id", "code"],
  });
  pgm.addConstraint("finance_payment_terms", "finance_payment_terms_window_check", {
    check: "effective_to IS NULL OR effective_to >= effective_from",
  });
  pgm.createIndex("finance_payment_terms", ["tenant_id"]);

  // Wire the deferred dimension: journal_lines.cost_center_id (Phase 1A,
  // "cost_center deferred") now points at the master. Existing rows keep
  // their values; uuid → uuid needs no backfill.
  pgm.addConstraint("journal_lines", "fk_journal_lines_cost_center", {
    foreignKeys: {
      columns: ["cost_center_id"],
      references: "finance_cost_centers(id)",
      onDelete: "SET NULL",
    },
  });
};

exports.down = (pgm) => {
  pgm.sql(`ALTER TABLE journal_lines DROP CONSTRAINT IF EXISTS fk_journal_lines_cost_center;`);
  pgm.sql(`DROP TRIGGER IF EXISTS trg_cost_center_depth ON finance_cost_centers;`);
  pgm.sql(`DROP FUNCTION IF EXISTS guard_cost_center_depth();`);
  pgm.dropTable("finance_payment_terms", { ifExists: true });
  pgm.dropTable("finance_cost_centers", { ifExists: true });
};
