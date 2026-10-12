/**
 * WP-OPS-02 Phase 6 — Cost accumulator DB hardening (review follow-up).
 *
 * Tightens the `work_order_cost_items` schema shipped by
 * `1794300000000_phase6-ops-02-cost-accumulator.cjs`:
 *
 *  - Tenant-safe FK to `work_orders(tenant_id, id)` so a cost item can never
 *    be reparented to another tenant's Work Order through id-only joins. The
 *    existing simple FK `work_order_id → work_orders(id)` is kept alongside
 *    for ON DELETE CASCADE semantics (composite FKs don't repeat that here,
 *    the cascade from `work_orders` deletion already fans out).
 *  - CHECK (quantity > 0 AND unit_cost > 0) — the GENERATED `total_cost >
 *    0` CHECK on 1794300000000 is a weaker guard: two negatives would still
 *    multiply to a positive total. The zod regex blocks negative input at
 *    the API, this makes the invariant a DB fact as well.
 *
 * No new columns, no data migration. Separate from the create migration so
 * it stays reversible after prior environments have already applied the
 * table without these constraints.
 */
exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE work_order_cost_items
      ADD CONSTRAINT work_order_cost_items_tenant_wo_fk
      FOREIGN KEY (tenant_id, work_order_id)
      REFERENCES work_orders(tenant_id, id)
      ON DELETE CASCADE;

    ALTER TABLE work_order_cost_items
      ADD CONSTRAINT work_order_cost_items_quantity_check
      CHECK (quantity > 0);

    ALTER TABLE work_order_cost_items
      ADD CONSTRAINT work_order_cost_items_unit_cost_check
      CHECK (unit_cost > 0);
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    ALTER TABLE work_order_cost_items
      DROP CONSTRAINT IF EXISTS work_order_cost_items_unit_cost_check;

    ALTER TABLE work_order_cost_items
      DROP CONSTRAINT IF EXISTS work_order_cost_items_quantity_check;

    ALTER TABLE work_order_cost_items
      DROP CONSTRAINT IF EXISTS work_order_cost_items_tenant_wo_fk;
  `);
};
