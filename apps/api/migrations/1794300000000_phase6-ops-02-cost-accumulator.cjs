/**
 * WP-OPS-02 Phase 6 — Cost Accumulator (FR-OPS-002, E2EGAP-015).
 *
 * Service cost recording:
 *   - New `work_order_cost_items` table — child rows per cost type
 *     (material, labor, overhead) with quantity, unit_cost, total_cost.
 *   - Columns on `work_orders` — `costs_finalized_at` + `costs_total`
 *     to mark when cost accumulation closed and lock further adds.
 *   - New outbox event type `work_order.cost_accumulated` (amount real,
 *     with legalEntityId + periodId in payload so consumer can post to GL).
 *   - Existing `work_order.accepted` event left unchanged (amount 0,
 *     no legalEntityId/periodId, immutable). Both events live forever.
 */
exports.up = (pgm) => {
  // 1. Create work_order_cost_items table.
  pgm.sql(`
    CREATE TABLE work_order_cost_items (
      id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id      uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      work_order_id  uuid NOT NULL REFERENCES work_orders(id) ON DELETE CASCADE,
      cost_type      text NOT NULL,
      description    text,
      quantity       numeric(18,4) NOT NULL,
      unit_cost      numeric(18,4) NOT NULL,
      total_cost     numeric(18,4) NOT NULL GENERATED ALWAYS AS (quantity * unit_cost) STORED,
      cost_center_id uuid REFERENCES finance_cost_centers(id) ON DELETE SET NULL,
      recorded_by    uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
      recorded_at    timestamptz NOT NULL DEFAULT now(),
      created_at     timestamptz NOT NULL DEFAULT now(),
      updated_at     timestamptz NOT NULL DEFAULT now(),

      CONSTRAINT work_order_cost_items_type_check
        CHECK (cost_type IN ('material', 'labor', 'overhead')),
      CONSTRAINT work_order_cost_items_total_check
        CHECK (total_cost > 0)
    );

    CREATE INDEX idx_wo_cost_items_tenant_wo
      ON work_order_cost_items(tenant_id, work_order_id);
  `);

  // 2. Add columns to work_orders to track cost accumulation state.
  pgm.sql(`
    ALTER TABLE work_orders
      ADD COLUMN costs_finalized_at timestamptz,
      ADD COLUMN costs_total        numeric(18,4);
  `);

  // 3. Widen the Accounting Ready outbox constraint to accept
  // 'work_order.cost_accumulated' (#15 in the list).
  pgm.sql(`
    ALTER TABLE scm_accounting_ready_events
      DROP CONSTRAINT scm_accounting_events_type_check;

    ALTER TABLE scm_accounting_ready_events
      ADD CONSTRAINT scm_accounting_events_type_check
        CHECK (event_type IN (
          'inventory.goods_received', 'inventory.goods_issued', 'inventory.transferred', 'inventory.adjusted',
          'inventory.returned_to_vendor', 'inventory.receipt_reversed', 'inventory.landed_cost_applied',
          'inventory.consignment_consumed', 'service.accepted', 'inventory.disposed',
          'vendor.invoice.approved', 'vendor.invoice.payment_approved', 'payroll.run_posted',
          'work_order.accepted', 'work_order.cost_accumulated'
        ));
  `);
};

exports.down = (pgm) => {
  // Reverse in dependency order: constraint → columns → table.
  pgm.sql(`
    -- Outbox cleanup (mirror WP-OPS-01/payroll pattern).
    DELETE FROM scm_accounting_ready_event_state_transitions
     WHERE accounting_event_id IN (
       SELECT id FROM scm_accounting_ready_events
        WHERE event_type = 'work_order.cost_accumulated'
     );

    ALTER TABLE scm_accounting_ready_events
      DISABLE TRIGGER trg_scm_accounting_ready_events_immutable_facts;

    DELETE FROM scm_accounting_ready_events
     WHERE event_type = 'work_order.cost_accumulated';

    ALTER TABLE scm_accounting_ready_events
      ENABLE TRIGGER trg_scm_accounting_ready_events_immutable_facts;

    ALTER TABLE scm_accounting_ready_events
      DROP CONSTRAINT scm_accounting_events_type_check;

    ALTER TABLE scm_accounting_ready_events
      ADD CONSTRAINT scm_accounting_events_type_check
        CHECK (event_type IN (
          'inventory.goods_received', 'inventory.goods_issued', 'inventory.transferred', 'inventory.adjusted',
          'inventory.returned_to_vendor', 'inventory.receipt_reversed', 'inventory.landed_cost_applied',
          'inventory.consignment_consumed', 'service.accepted', 'inventory.disposed',
          'vendor.invoice.approved', 'vendor.invoice.payment_approved', 'payroll.run_posted',
          'work_order.accepted'
        ));

    ALTER TABLE work_orders
      DROP COLUMN IF EXISTS costs_total,
      DROP COLUMN IF EXISTS costs_finalized_at;

    DROP TABLE IF EXISTS work_order_cost_items;
  `);
};
