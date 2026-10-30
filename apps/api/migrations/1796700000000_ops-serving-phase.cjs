/**
 * Service Operations — Serving Phase (SO-CORE-016, E2EGAP-018).
 *
 * Last-mile meal tracking for catering: distribution → serving → consumption.
 *
 * Entities:
 *   - `work_order_serving_logs` — per meal service event (opening time, closing,
 *     received qty, served qty, returned, wasted, remaining).
 *   - Columns on `work_orders` — `serving_recorded_at` + `serving_supervisor_user_id`
 *     to track the serving phase completion.
 *
 * Fields per PRD §Serving Fields (lines 79-92):
 *   - Serving Number, Service Point (site), Meal Date, Meal Type, Opening Time,
 *     Closing Time, Received Qty, Served Qty, Returned Qty, Remaining Qty,
 *     Wasted Qty, Serving Supervisor.
 *
 * Invariants:
 *   - `served_qty + returned_qty + wasted_qty <= received_qty`
 *   - `remaining_qty = received_qty - served_qty - returned_qty - wasted_qty`
 *   - All quantities NUMERIC(18,4), validated > 0 at service layer.
 */
exports.up = (pgm) => {
  // 1. Create work_order_serving_logs table (one per WO, not one per meal type).
  pgm.sql(`
    CREATE TABLE work_order_serving_logs (
      id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id             uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      work_order_id         uuid NOT NULL REFERENCES work_orders(id) ON DELETE CASCADE,
      serving_number        text NOT NULL,
      service_point_id      uuid REFERENCES sites(id) ON DELETE SET NULL,
      meal_date             date NOT NULL,
      meal_type             text NOT NULL,
      opening_time          timestamptz NOT NULL,
      closing_time          timestamptz,
      received_qty          numeric(18,4) NOT NULL,
      served_qty            numeric(18,4) NOT NULL DEFAULT 0,
      returned_qty          numeric(18,4) NOT NULL DEFAULT 0,
      wasted_qty            numeric(18,4) NOT NULL DEFAULT 0,
      remaining_qty         numeric(18,4) NOT NULL GENERATED ALWAYS AS (
        received_qty - served_qty - returned_qty - wasted_qty
      ) STORED,
      serving_supervisor_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
      notes                 text,
      recorded_by           uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
      recorded_at           timestamptz NOT NULL DEFAULT now(),
      created_at            timestamptz NOT NULL DEFAULT now(),
      updated_at            timestamptz NOT NULL DEFAULT now(),

      UNIQUE(tenant_id, work_order_id),

      CONSTRAINT work_order_serving_logs_meal_type_check
        CHECK (meal_type IN ('breakfast', 'lunch', 'dinner', 'snack')),
      CONSTRAINT work_order_serving_logs_qty_check
        CHECK (received_qty > 0 AND served_qty >= 0 AND returned_qty >= 0 AND wasted_qty >= 0),
      CONSTRAINT work_order_serving_logs_total_check
        CHECK (served_qty + returned_qty + wasted_qty <= received_qty)
    );

    CREATE INDEX idx_wo_serving_tenant_wo
      ON work_order_serving_logs(tenant_id, work_order_id);
    CREATE INDEX idx_wo_serving_meal_date
      ON work_order_serving_logs(tenant_id, meal_date);
  `);

  // 2. Add columns to work_orders to track serving state.
  pgm.sql(`
    ALTER TABLE work_orders
      ADD COLUMN serving_recorded_at          timestamptz,
      ADD COLUMN serving_supervisor_user_id   uuid REFERENCES users(id) ON DELETE SET NULL;
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    ALTER TABLE work_orders
      DROP COLUMN IF EXISTS serving_supervisor_user_id,
      DROP COLUMN IF EXISTS serving_recorded_at;

    DROP TABLE IF EXISTS work_order_serving_logs;
  `);
};
