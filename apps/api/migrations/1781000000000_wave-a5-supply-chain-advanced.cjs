/**
 * Wave A5 — Supply Chain Advanced (SCM-ADV-001…008).
 *
 * Supply Chain Core (`items`, `suppliers`, `stock_balances`, `stock_movements`,
 * `purchase_requests`, `purchase_orders`) answers **what item exists, how much,
 * what moved in/out, and what was purchased from whom** at tenant/site level.
 * Everything topology-, tracking-, valuation-, sourcing-, and spend-analytics-related
 * is Advanced and lands here across six capability groups:
 *
 *   1. Multi-warehouse, bin/location, batch/lot & serial tracking (SCM-ADV-001/002/003, XL=5)
 *   2. Reservation, reorder points, transfers & stock opname        (SCM-ADV-004, L=3)
 *   3. Inventory valuation & landed cost                          (SCM-ADV-005, L=3)
 *   4. RFQ, tender & bid comparison                               (SCM-ADV-006, XL=5)
 *   5. Supplier evaluation & contract purchasing                  (SCM-ADV-007, L=3)
 *   6. Spend analytics                                            (SCM-ADV-008, L=3)
 *
 * Binding design decisions:
 *
 * - **Core stays independent.** Every table here references Core one way
 *   (`item_id`, `supplier_id`, `purchase_order_id`, `purchase_request_id`);
 *   Core references nothing in this file, so dropping Advanced leaves Core
 *   fully functional (ADV-GEN-001).
 *
 * - **Immutable Advanced Stock Ledger.** Warehouse/bin/batch/serial movements
 *   write immutable `scm_advanced_stock_movements` rows and update
 *   `scm_advanced_stock_balances` in one transaction. Corrections are compensating
 *   movements, never edits (SCM-CORE-006 / SCM-ADV-001..003). Core's `stock_balances`
 *   and `stock_movements` are NOT mutated by Advanced.
 *
 * - **No competing state machines.** RFQs, Tenders, Supplier Contracts, and
 *   Stock Opname carry `workflow_instance_id` (or one-way transition timestamps)
 *   and NO local status column that could disagree with the Workflow Engine.
 *   Local timestamps (`awarded_at`, `approved_at`, `closed_at`, etc.) are
 *   projections of workflow transitions, never the authority.
 *
 * - **Exact decimal arithmetic.** All valuation, cost per unit, landed cost allocations,
 *   bid prices, contract pricing, and spend amounts use `NUMERIC(18,4)` or `NUMERIC(18,2)`
 *   columns with fixed-point arithmetic in domain services.
 *
 * - **Tenant isolation & Data Scope.** Composite `(tenant_id, id)` foreign keys bind
 *   tenant and entity identity together. Warehouses, RFQs, and Contracts optionally
 *   bind to `organization_units` for hierarchical Data Scope enforcement.
 *
 * - **Documents stay in Document Core.** `*_document_id` columns are loose references
 *   to `documents` without foreign keys (ADR-0012).
 */
exports.up = (pgm) => {
  pgm.sql(`
    -- Composite candidate keys bind tenant and entity identity together so child
    -- rows cannot cross tenant boundaries. (items, users, workflow_instances, and
    -- organization_units were added in earlier waves; suppliers, purchase_orders,
    -- and purchase_requests are added here).
    ALTER TABLE suppliers         ADD CONSTRAINT suppliers_tenant_id_id_unique UNIQUE (tenant_id, id);
    ALTER TABLE purchase_orders   ADD CONSTRAINT purchase_orders_tenant_id_id_unique UNIQUE (tenant_id, id);
    ALTER TABLE purchase_requests ADD CONSTRAINT purchase_requests_tenant_id_id_unique UNIQUE (tenant_id, id);

    -- === 1. Multi-Warehouse, Bin, Batch/Lot & Serial (SCM-ADV-001/002/003) ===

    CREATE TABLE scm_warehouses (
      id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id             UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      code                  TEXT        NOT NULL,
      name                  TEXT        NOT NULL,
      site_id               UUID        REFERENCES sites(id) ON DELETE SET NULL,
      organization_unit_id  UUID,
      address               TEXT,
      is_active             BOOLEAN     NOT NULL DEFAULT true,
      created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
      created_by            UUID,
      updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_by            UUID,

      FOREIGN KEY (tenant_id, organization_unit_id)
        REFERENCES organization_units(tenant_id, id) ON DELETE SET NULL (organization_unit_id),
      FOREIGN KEY (tenant_id, created_by)
        REFERENCES users(tenant_id, id) ON DELETE SET NULL (created_by),
      FOREIGN KEY (tenant_id, updated_by)
        REFERENCES users(tenant_id, id) ON DELETE SET NULL (updated_by),
      UNIQUE (tenant_id, code)
    );

    ALTER TABLE scm_warehouses
      ADD CONSTRAINT scm_warehouses_tenant_id_id_unique UNIQUE (tenant_id, id);
    CREATE INDEX idx_scm_warehouses_tenant
      ON scm_warehouses (tenant_id) WHERE is_active;
    CREATE INDEX idx_scm_warehouses_org_unit
      ON scm_warehouses (organization_unit_id);
    CREATE INDEX idx_scm_warehouses_site
      ON scm_warehouses (site_id);

    CREATE TABLE scm_warehouse_locations (
      id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id     UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      warehouse_id  UUID        NOT NULL,
      code          TEXT        NOT NULL,
      zone          TEXT,
      aisle         TEXT,
      rack          TEXT,
      shelf         TEXT,
      bin           TEXT,
      is_active     BOOLEAN     NOT NULL DEFAULT true,
      created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
      created_by    UUID,
      updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_by    UUID,

      FOREIGN KEY (tenant_id, warehouse_id)
        REFERENCES scm_warehouses(tenant_id, id) ON DELETE CASCADE,
      FOREIGN KEY (tenant_id, created_by)
        REFERENCES users(tenant_id, id) ON DELETE SET NULL (created_by),
      FOREIGN KEY (tenant_id, updated_by)
        REFERENCES users(tenant_id, id) ON DELETE SET NULL (updated_by),
      UNIQUE (tenant_id, warehouse_id, code)
    );

    ALTER TABLE scm_warehouse_locations
      ADD CONSTRAINT scm_warehouse_locations_tenant_id_id_unique UNIQUE (tenant_id, id);
    CREATE INDEX idx_scm_wh_locations_warehouse
      ON scm_warehouse_locations (tenant_id, warehouse_id);

    CREATE TABLE scm_item_batches (
      id                UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id         UUID          NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      item_id           UUID          NOT NULL,
      batch_number      TEXT          NOT NULL,
      manufactured_date DATE,
      expiry_date       DATE,
      supplier_id       UUID,
      notes             TEXT,
      is_active         BOOLEAN       NOT NULL DEFAULT true,
      created_at        TIMESTAMPTZ   NOT NULL DEFAULT now(),
      created_by        UUID,
      updated_at        TIMESTAMPTZ   NOT NULL DEFAULT now(),
      updated_by        UUID,

      FOREIGN KEY (tenant_id, item_id)
        REFERENCES items(tenant_id, id) ON DELETE RESTRICT,
      FOREIGN KEY (tenant_id, supplier_id)
        REFERENCES suppliers(tenant_id, id) ON DELETE SET NULL (supplier_id),
      FOREIGN KEY (tenant_id, created_by)
        REFERENCES users(tenant_id, id) ON DELETE SET NULL (created_by),
      FOREIGN KEY (tenant_id, updated_by)
        REFERENCES users(tenant_id, id) ON DELETE SET NULL (updated_by),
      UNIQUE (tenant_id, item_id, batch_number)
    );

    ALTER TABLE scm_item_batches
      ADD CONSTRAINT scm_item_batches_tenant_id_id_unique UNIQUE (tenant_id, id);
    CREATE INDEX idx_scm_item_batches_item
      ON scm_item_batches (tenant_id, item_id);
    CREATE INDEX idx_scm_item_batches_expiry
      ON scm_item_batches (tenant_id, expiry_date);

    CREATE TABLE scm_item_serials (
      id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id             UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      item_id               UUID        NOT NULL,
      serial_number         TEXT        NOT NULL,
      batch_id              UUID,
      warehouse_id          UUID,
      location_id           UUID,
      status                TEXT        NOT NULL DEFAULT 'in_stock',
      warranty_expiry_date  DATE,
      notes                 TEXT,
      created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
      created_by            UUID,
      updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_by            UUID,

      FOREIGN KEY (tenant_id, item_id)
        REFERENCES items(tenant_id, id) ON DELETE RESTRICT,
      FOREIGN KEY (tenant_id, batch_id)
        REFERENCES scm_item_batches(tenant_id, id) ON DELETE SET NULL (batch_id),
      FOREIGN KEY (tenant_id, warehouse_id)
        REFERENCES scm_warehouses(tenant_id, id) ON DELETE SET NULL (warehouse_id),
      FOREIGN KEY (tenant_id, location_id)
        REFERENCES scm_warehouse_locations(tenant_id, id) ON DELETE SET NULL (location_id),
      FOREIGN KEY (tenant_id, created_by)
        REFERENCES users(tenant_id, id) ON DELETE SET NULL (created_by),
      FOREIGN KEY (tenant_id, updated_by)
        REFERENCES users(tenant_id, id) ON DELETE SET NULL (updated_by),
      CONSTRAINT scm_item_serials_status_check
        CHECK (status IN ('in_stock', 'reserved', 'issued', 'in_transit', 'disposed', 'maintenance')),
      UNIQUE (tenant_id, item_id, serial_number)
    );

    ALTER TABLE scm_item_serials
      ADD CONSTRAINT scm_item_serials_tenant_id_id_unique UNIQUE (tenant_id, id);
    CREATE INDEX idx_scm_item_serials_item
      ON scm_item_serials (tenant_id, item_id, status);
    CREATE INDEX idx_scm_item_serials_warehouse
      ON scm_item_serials (tenant_id, warehouse_id);

    -- Granular stock balance per item, warehouse, location, and batch.
    CREATE TABLE scm_advanced_stock_balances (
      id            UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id     UUID          NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      item_id       UUID          NOT NULL,
      warehouse_id  UUID          NOT NULL,
      location_id   UUID,
      batch_id      UUID,
      quantity      NUMERIC(18,4) NOT NULL DEFAULT 0,
      reserved_qty  NUMERIC(18,4) NOT NULL DEFAULT 0,
      updated_at    TIMESTAMPTZ   NOT NULL DEFAULT now(),

      FOREIGN KEY (tenant_id, item_id)
        REFERENCES items(tenant_id, id) ON DELETE RESTRICT,
      FOREIGN KEY (tenant_id, warehouse_id)
        REFERENCES scm_warehouses(tenant_id, id) ON DELETE RESTRICT,
      FOREIGN KEY (tenant_id, location_id)
        REFERENCES scm_warehouse_locations(tenant_id, id) ON DELETE RESTRICT,
      FOREIGN KEY (tenant_id, batch_id)
        REFERENCES scm_item_batches(tenant_id, id) ON DELETE RESTRICT,
      CONSTRAINT scm_adv_stock_balances_qty_check CHECK (quantity >= 0),
      CONSTRAINT scm_adv_stock_balances_reserved_check CHECK (reserved_qty >= 0 AND reserved_qty <= quantity)
    );

    ALTER TABLE scm_advanced_stock_balances
      ADD CONSTRAINT scm_adv_stock_balances_tenant_id_id_unique UNIQUE (tenant_id, id);

    -- Partial unique indexes for granular balance lookup handling nullable location/batch
    CREATE UNIQUE INDEX uq_scm_adv_balances_full
      ON scm_advanced_stock_balances (tenant_id, item_id, warehouse_id, location_id, batch_id)
      WHERE location_id IS NOT NULL AND batch_id IS NOT NULL;
    CREATE UNIQUE INDEX uq_scm_adv_balances_loc_only
      ON scm_advanced_stock_balances (tenant_id, item_id, warehouse_id, location_id)
      WHERE location_id IS NOT NULL AND batch_id IS NULL;
    CREATE UNIQUE INDEX uq_scm_adv_balances_batch_only
      ON scm_advanced_stock_balances (tenant_id, item_id, warehouse_id, batch_id)
      WHERE location_id IS NULL AND batch_id IS NOT NULL;
    CREATE UNIQUE INDEX uq_scm_adv_balances_wh_only
      ON scm_advanced_stock_balances (tenant_id, item_id, warehouse_id)
      WHERE location_id IS NULL AND batch_id IS NULL;

    CREATE INDEX idx_scm_adv_balances_item
      ON scm_advanced_stock_balances (tenant_id, item_id);
    CREATE INDEX idx_scm_adv_balances_warehouse
      ON scm_advanced_stock_balances (tenant_id, warehouse_id);

    -- Immutable Advanced Stock Ledger. Quantity is always positive; direction is movement_type.
    CREATE TABLE scm_advanced_stock_movements (
      id                    UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id             UUID          NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      item_id               UUID          NOT NULL,
      warehouse_id          UUID          NOT NULL,
      location_id           UUID,
      batch_id              UUID,
      serial_id             UUID,
      movement_type         TEXT          NOT NULL,
      quantity              NUMERIC(18,4) NOT NULL,
      unit_cost             NUMERIC(18,4),
      total_cost            NUMERIC(18,4),
      reference_type        TEXT,
      reference_id          UUID,
      reference_number      TEXT,
      notes                 TEXT,
      occurred_at           TIMESTAMPTZ   NOT NULL DEFAULT now(),
      created_by            UUID,
      created_at            TIMESTAMPTZ   NOT NULL DEFAULT now(),

      FOREIGN KEY (tenant_id, item_id)
        REFERENCES items(tenant_id, id) ON DELETE RESTRICT,
      FOREIGN KEY (tenant_id, warehouse_id)
        REFERENCES scm_warehouses(tenant_id, id) ON DELETE RESTRICT,
      FOREIGN KEY (tenant_id, location_id)
        REFERENCES scm_warehouse_locations(tenant_id, id) ON DELETE RESTRICT,
      FOREIGN KEY (tenant_id, batch_id)
        REFERENCES scm_item_batches(tenant_id, id) ON DELETE RESTRICT,
      FOREIGN KEY (tenant_id, serial_id)
        REFERENCES scm_item_serials(tenant_id, id) ON DELETE RESTRICT,
      FOREIGN KEY (tenant_id, created_by)
        REFERENCES users(tenant_id, id) ON DELETE SET NULL (created_by),
      CONSTRAINT scm_adv_movements_type_check
        CHECK (movement_type IN ('in', 'out', 'transfer_in', 'transfer_out', 'adjustment_in', 'adjustment_out', 'opname_in', 'opname_out')),
      CONSTRAINT scm_adv_movements_qty_check CHECK (quantity > 0)
    );

    ALTER TABLE scm_advanced_stock_movements
      ADD CONSTRAINT scm_adv_stock_movements_tenant_id_id_unique UNIQUE (tenant_id, id);
    CREATE INDEX idx_scm_adv_movements_item
      ON scm_advanced_stock_movements (tenant_id, item_id, occurred_at DESC);
    CREATE INDEX idx_scm_adv_movements_warehouse
      ON scm_advanced_stock_movements (tenant_id, warehouse_id, occurred_at DESC);
    CREATE INDEX idx_scm_adv_movements_ref
      ON scm_advanced_stock_movements (tenant_id, reference_type, reference_id);

    -- === 2. Reservation, Reorder, Transfers & Stock Opname (SCM-ADV-004) =====

    CREATE TABLE scm_reorder_policies (
      id                    UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id             UUID          NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      item_id               UUID          NOT NULL,
      warehouse_id          UUID,
      min_quantity          NUMERIC(18,4) NOT NULL DEFAULT 0,
      reorder_point         NUMERIC(18,4) NOT NULL DEFAULT 0,
      reorder_quantity      NUMERIC(18,4) NOT NULL DEFAULT 0,
      safety_stock          NUMERIC(18,4) NOT NULL DEFAULT 0,
      lead_time_days        INTEGER       NOT NULL DEFAULT 0,
      is_active             BOOLEAN       NOT NULL DEFAULT true,
      created_at            TIMESTAMPTZ   NOT NULL DEFAULT now(),
      created_by            UUID,
      updated_at            TIMESTAMPTZ   NOT NULL DEFAULT now(),
      updated_by            UUID,

      FOREIGN KEY (tenant_id, item_id)
        REFERENCES items(tenant_id, id) ON DELETE CASCADE,
      FOREIGN KEY (tenant_id, warehouse_id)
        REFERENCES scm_warehouses(tenant_id, id) ON DELETE CASCADE,
      FOREIGN KEY (tenant_id, created_by)
        REFERENCES users(tenant_id, id) ON DELETE SET NULL (created_by),
      FOREIGN KEY (tenant_id, updated_by)
        REFERENCES users(tenant_id, id) ON DELETE SET NULL (updated_by),
      CONSTRAINT scm_reorder_min_check CHECK (min_quantity >= 0),
      CONSTRAINT scm_reorder_point_check CHECK (reorder_point >= 0),
      CONSTRAINT scm_reorder_qty_check CHECK (reorder_quantity >= 0),
      CONSTRAINT scm_reorder_safety_check CHECK (safety_stock >= 0),
      CONSTRAINT scm_reorder_lead_check CHECK (lead_time_days >= 0)
    );

    ALTER TABLE scm_reorder_policies
      ADD CONSTRAINT scm_reorder_policies_tenant_id_id_unique UNIQUE (tenant_id, id);
    CREATE UNIQUE INDEX uq_scm_reorder_item_wh
      ON scm_reorder_policies (tenant_id, item_id, warehouse_id) WHERE warehouse_id IS NOT NULL;
    CREATE UNIQUE INDEX uq_scm_reorder_item_global
      ON scm_reorder_policies (tenant_id, item_id) WHERE warehouse_id IS NULL;

    CREATE TABLE scm_stock_reservations (
      id                    UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id             UUID          NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      reservation_number    TEXT          NOT NULL,
      item_id               UUID          NOT NULL,
      warehouse_id          UUID          NOT NULL,
      location_id           UUID,
      batch_id              UUID,
      quantity              NUMERIC(18,4) NOT NULL,
      reserved_for_type     TEXT          NOT NULL,
      reserved_for_id       UUID,
      reserved_for_number   TEXT,
      status                TEXT          NOT NULL DEFAULT 'active',
      valid_until           TIMESTAMPTZ,
      fulfilled_at          TIMESTAMPTZ,
      cancelled_at          TIMESTAMPTZ,
      notes                 TEXT,
      created_at            TIMESTAMPTZ   NOT NULL DEFAULT now(),
      created_by            UUID,
      updated_at            TIMESTAMPTZ   NOT NULL DEFAULT now(),
      updated_by            UUID,

      FOREIGN KEY (tenant_id, item_id)
        REFERENCES items(tenant_id, id) ON DELETE RESTRICT,
      FOREIGN KEY (tenant_id, warehouse_id)
        REFERENCES scm_warehouses(tenant_id, id) ON DELETE RESTRICT,
      FOREIGN KEY (tenant_id, location_id)
        REFERENCES scm_warehouse_locations(tenant_id, id) ON DELETE RESTRICT,
      FOREIGN KEY (tenant_id, batch_id)
        REFERENCES scm_item_batches(tenant_id, id) ON DELETE RESTRICT,
      FOREIGN KEY (tenant_id, created_by)
        REFERENCES users(tenant_id, id) ON DELETE SET NULL (created_by),
      FOREIGN KEY (tenant_id, updated_by)
        REFERENCES users(tenant_id, id) ON DELETE SET NULL (updated_by),
      CONSTRAINT scm_reservations_status_check
        CHECK (status IN ('active', 'fulfilled', 'cancelled', 'expired')),
      CONSTRAINT scm_reservations_qty_check CHECK (quantity > 0),
      UNIQUE (tenant_id, reservation_number)
    );

    ALTER TABLE scm_stock_reservations
      ADD CONSTRAINT scm_stock_reservations_tenant_id_id_unique UNIQUE (tenant_id, id);
    CREATE INDEX idx_scm_reservations_item_wh
      ON scm_stock_reservations (tenant_id, item_id, warehouse_id, status);
    CREATE INDEX idx_scm_reservations_ref
      ON scm_stock_reservations (tenant_id, reserved_for_type, reserved_for_id);

    CREATE TABLE scm_stock_transfers (
      id                    UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id             UUID          NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      transfer_number       TEXT          NOT NULL,
      from_warehouse_id     UUID          NOT NULL,
      to_warehouse_id       UUID          NOT NULL,
      status                TEXT          NOT NULL DEFAULT 'draft',
      shipped_at            TIMESTAMPTZ,
      received_at           TIMESTAMPTZ,
      cancelled_at          TIMESTAMPTZ,
      workflow_instance_id  UUID,
      notes                 TEXT,
      created_at            TIMESTAMPTZ   NOT NULL DEFAULT now(),
      created_by            UUID,
      updated_at            TIMESTAMPTZ   NOT NULL DEFAULT now(),
      updated_by            UUID,

      FOREIGN KEY (tenant_id, from_warehouse_id)
        REFERENCES scm_warehouses(tenant_id, id) ON DELETE RESTRICT,
      FOREIGN KEY (tenant_id, to_warehouse_id)
        REFERENCES scm_warehouses(tenant_id, id) ON DELETE RESTRICT,
      FOREIGN KEY (tenant_id, workflow_instance_id)
        REFERENCES workflow_instances(tenant_id, id) ON DELETE SET NULL (workflow_instance_id),
      FOREIGN KEY (tenant_id, created_by)
        REFERENCES users(tenant_id, id) ON DELETE SET NULL (created_by),
      FOREIGN KEY (tenant_id, updated_by)
        REFERENCES users(tenant_id, id) ON DELETE SET NULL (updated_by),
      CONSTRAINT scm_transfers_status_check
        CHECK (status IN ('draft', 'approved', 'in_transit', 'received', 'cancelled')),
      CONSTRAINT scm_transfers_distinct_wh CHECK (from_warehouse_id <> to_warehouse_id),
      UNIQUE (tenant_id, transfer_number)
    );

    ALTER TABLE scm_stock_transfers
      ADD CONSTRAINT scm_stock_transfers_tenant_id_id_unique UNIQUE (tenant_id, id);
    CREATE INDEX idx_scm_transfers_tenant
      ON scm_stock_transfers (tenant_id, status);

    CREATE TABLE scm_stock_transfer_lines (
      id                  UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id           UUID          NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      transfer_id         UUID          NOT NULL,
      item_id             UUID          NOT NULL,
      from_location_id    UUID,
      to_location_id      UUID,
      batch_id            UUID,
      quantity_requested  NUMERIC(18,4) NOT NULL,
      quantity_shipped    NUMERIC(18,4) NOT NULL DEFAULT 0,
      quantity_received   NUMERIC(18,4) NOT NULL DEFAULT 0,
      notes               TEXT,
      sort_order          INTEGER       NOT NULL DEFAULT 0,

      FOREIGN KEY (tenant_id, transfer_id)
        REFERENCES scm_stock_transfers(tenant_id, id) ON DELETE CASCADE,
      FOREIGN KEY (tenant_id, item_id)
        REFERENCES items(tenant_id, id) ON DELETE RESTRICT,
      FOREIGN KEY (tenant_id, from_location_id)
        REFERENCES scm_warehouse_locations(tenant_id, id) ON DELETE RESTRICT,
      FOREIGN KEY (tenant_id, to_location_id)
        REFERENCES scm_warehouse_locations(tenant_id, id) ON DELETE RESTRICT,
      FOREIGN KEY (tenant_id, batch_id)
        REFERENCES scm_item_batches(tenant_id, id) ON DELETE RESTRICT,
      CONSTRAINT scm_transfer_lines_req_check CHECK (quantity_requested > 0),
      CONSTRAINT scm_transfer_lines_ship_check CHECK (quantity_shipped >= 0 AND quantity_shipped <= quantity_requested),
      CONSTRAINT scm_transfer_lines_recv_check CHECK (quantity_received >= 0 AND quantity_received <= quantity_shipped)
    );

    ALTER TABLE scm_stock_transfer_lines
      ADD CONSTRAINT scm_stock_transfer_lines_tenant_id_id_unique UNIQUE (tenant_id, id);
    CREATE INDEX idx_scm_transfer_lines_transfer
      ON scm_stock_transfer_lines (tenant_id, transfer_id);

    CREATE TABLE scm_stock_opnames (
      id                    UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id             UUID          NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      opname_number         TEXT          NOT NULL,
      warehouse_id          UUID          NOT NULL,
      opname_date           DATE          NOT NULL,
      status                TEXT          NOT NULL DEFAULT 'draft',
      workflow_instance_id  UUID,
      completed_at          TIMESTAMPTZ,
      completed_by          UUID,
      notes                 TEXT,
      created_at            TIMESTAMPTZ   NOT NULL DEFAULT now(),
      created_by            UUID,
      updated_at            TIMESTAMPTZ   NOT NULL DEFAULT now(),
      updated_by            UUID,

      FOREIGN KEY (tenant_id, warehouse_id)
        REFERENCES scm_warehouses(tenant_id, id) ON DELETE RESTRICT,
      FOREIGN KEY (tenant_id, workflow_instance_id)
        REFERENCES workflow_instances(tenant_id, id) ON DELETE SET NULL (workflow_instance_id),
      FOREIGN KEY (tenant_id, completed_by)
        REFERENCES users(tenant_id, id) ON DELETE SET NULL (completed_by),
      FOREIGN KEY (tenant_id, created_by)
        REFERENCES users(tenant_id, id) ON DELETE SET NULL (created_by),
      FOREIGN KEY (tenant_id, updated_by)
        REFERENCES users(tenant_id, id) ON DELETE SET NULL (updated_by),
      CONSTRAINT scm_opnames_status_check
        CHECK (status IN ('draft', 'in_progress', 'completed', 'approved', 'adjusted', 'cancelled')),
      UNIQUE (tenant_id, opname_number)
    );

    ALTER TABLE scm_stock_opnames
      ADD CONSTRAINT scm_stock_opnames_tenant_id_id_unique UNIQUE (tenant_id, id);
    CREATE INDEX idx_scm_opnames_tenant_wh
      ON scm_stock_opnames (tenant_id, warehouse_id, opname_date DESC);

    CREATE TABLE scm_stock_opname_lines (
      id                  UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id           UUID          NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      opname_id           UUID          NOT NULL,
      item_id             UUID          NOT NULL,
      location_id         UUID,
      batch_id            UUID,
      system_quantity     NUMERIC(18,4) NOT NULL DEFAULT 0,
      physical_quantity   NUMERIC(18,4),
      variance_quantity   NUMERIC(18,4),
      adjustment_movement_id UUID,
      notes               TEXT,
      sort_order          INTEGER       NOT NULL DEFAULT 0,

      FOREIGN KEY (tenant_id, opname_id)
        REFERENCES scm_stock_opnames(tenant_id, id) ON DELETE CASCADE,
      FOREIGN KEY (tenant_id, item_id)
        REFERENCES items(tenant_id, id) ON DELETE RESTRICT,
      FOREIGN KEY (tenant_id, location_id)
        REFERENCES scm_warehouse_locations(tenant_id, id) ON DELETE RESTRICT,
      FOREIGN KEY (tenant_id, batch_id)
        REFERENCES scm_item_batches(tenant_id, id) ON DELETE RESTRICT,
      FOREIGN KEY (tenant_id, adjustment_movement_id)
        REFERENCES scm_advanced_stock_movements(tenant_id, id) ON DELETE SET NULL (adjustment_movement_id),
      CONSTRAINT scm_opname_lines_sys_qty_check CHECK (system_quantity >= 0),
      CONSTRAINT scm_opname_lines_phys_qty_check CHECK (physical_quantity IS NULL OR physical_quantity >= 0)
    );

    ALTER TABLE scm_stock_opname_lines
      ADD CONSTRAINT scm_stock_opname_lines_tenant_id_id_unique UNIQUE (tenant_id, id);
    CREATE INDEX idx_scm_opname_lines_opname
      ON scm_stock_opname_lines (tenant_id, opname_id);

    -- === 3. Inventory Valuation & Landed Cost (SCM-ADV-005) ==================

    CREATE TABLE scm_valuation_layers (
      id                    UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id             UUID          NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      item_id               UUID          NOT NULL,
      warehouse_id          UUID,
      receipt_movement_id   UUID,
      received_date         DATE          NOT NULL,
      original_quantity     NUMERIC(18,4) NOT NULL,
      remaining_quantity    NUMERIC(18,4) NOT NULL,
      unit_cost             NUMERIC(18,4) NOT NULL,
      landed_cost_added     NUMERIC(18,4) NOT NULL DEFAULT 0,
      effective_unit_cost   NUMERIC(18,4) NOT NULL,
      total_value           NUMERIC(18,4) NOT NULL,
      created_at            TIMESTAMPTZ   NOT NULL DEFAULT now(),

      FOREIGN KEY (tenant_id, item_id)
        REFERENCES items(tenant_id, id) ON DELETE RESTRICT,
      FOREIGN KEY (tenant_id, warehouse_id)
        REFERENCES scm_warehouses(tenant_id, id) ON DELETE RESTRICT,
      FOREIGN KEY (tenant_id, receipt_movement_id)
        REFERENCES scm_advanced_stock_movements(tenant_id, id) ON DELETE SET NULL (receipt_movement_id),
      CONSTRAINT scm_val_layers_orig_qty_check CHECK (original_quantity > 0),
      CONSTRAINT scm_val_layers_rem_qty_check CHECK (remaining_quantity >= 0 AND remaining_quantity <= original_quantity),
      CONSTRAINT scm_val_layers_unit_cost_check CHECK (unit_cost >= 0),
      CONSTRAINT scm_val_layers_landed_check CHECK (landed_cost_added >= 0),
      CONSTRAINT scm_val_layers_eff_cost_check CHECK (effective_unit_cost >= 0),
      CONSTRAINT scm_val_layers_val_check CHECK (total_value >= 0)
    );

    ALTER TABLE scm_valuation_layers
      ADD CONSTRAINT scm_valuation_layers_tenant_id_id_unique UNIQUE (tenant_id, id);
    CREATE INDEX idx_scm_val_layers_item_date
      ON scm_valuation_layers (tenant_id, item_id, received_date ASC) WHERE remaining_quantity > 0;
    CREATE INDEX idx_scm_val_layers_warehouse
      ON scm_valuation_layers (tenant_id, warehouse_id);

    CREATE TABLE scm_landed_costs (
      id                    UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id             UUID          NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      voucher_number        TEXT          NOT NULL,
      purchase_order_id     UUID          NOT NULL,
      cost_type             TEXT          NOT NULL,
      currency              TEXT          NOT NULL DEFAULT 'IDR',
      amount                NUMERIC(18,4) NOT NULL,
      allocation_method     TEXT          NOT NULL DEFAULT 'by_value',
      status                TEXT          NOT NULL DEFAULT 'draft',
      applied_at            TIMESTAMPTZ,
      notes                 TEXT,
      created_at            TIMESTAMPTZ   NOT NULL DEFAULT now(),
      created_by            UUID,
      updated_at            TIMESTAMPTZ   NOT NULL DEFAULT now(),
      updated_by            UUID,

      FOREIGN KEY (tenant_id, purchase_order_id)
        REFERENCES purchase_orders(tenant_id, id) ON DELETE RESTRICT,
      FOREIGN KEY (tenant_id, created_by)
        REFERENCES users(tenant_id, id) ON DELETE SET NULL (created_by),
      FOREIGN KEY (tenant_id, updated_by)
        REFERENCES users(tenant_id, id) ON DELETE SET NULL (updated_by),
      CONSTRAINT scm_landed_costs_status_check
        CHECK (status IN ('draft', 'applied', 'cancelled')),
      CONSTRAINT scm_landed_costs_alloc_method_check
        CHECK (allocation_method IN ('by_value', 'by_quantity', 'by_weight', 'equal')),
      CONSTRAINT scm_landed_costs_amount_check CHECK (amount > 0),
      UNIQUE (tenant_id, voucher_number)
    );

    ALTER TABLE scm_landed_costs
      ADD CONSTRAINT scm_landed_costs_tenant_id_id_unique UNIQUE (tenant_id, id);
    CREATE INDEX idx_scm_landed_costs_po
      ON scm_landed_costs (tenant_id, purchase_order_id);

    CREATE TABLE scm_landed_cost_allocations (
      id                    UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id             UUID          NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      landed_cost_id        UUID          NOT NULL,
      item_id               UUID          NOT NULL,
      valuation_layer_id    UUID,
      allocated_amount      NUMERIC(18,4) NOT NULL,
      cost_per_unit_added   NUMERIC(18,4) NOT NULL,

      FOREIGN KEY (tenant_id, landed_cost_id)
        REFERENCES scm_landed_costs(tenant_id, id) ON DELETE CASCADE,
      FOREIGN KEY (tenant_id, item_id)
        REFERENCES items(tenant_id, id) ON DELETE RESTRICT,
      FOREIGN KEY (tenant_id, valuation_layer_id)
        REFERENCES scm_valuation_layers(tenant_id, id) ON DELETE SET NULL (valuation_layer_id),
      CONSTRAINT scm_landed_alloc_amount_check CHECK (allocated_amount >= 0),
      CONSTRAINT scm_landed_alloc_unit_cost_check CHECK (cost_per_unit_added >= 0)
    );

    ALTER TABLE scm_landed_cost_allocations
      ADD CONSTRAINT scm_landed_cost_allocations_tenant_id_id_unique UNIQUE (tenant_id, id);
    CREATE INDEX idx_scm_landed_alloc_cost
      ON scm_landed_cost_allocations (tenant_id, landed_cost_id);

    -- === 4. Advanced Procurement: RFQ, Tender & Bid Comparison (SCM-ADV-006) =

    CREATE TABLE scm_rfqs (
      id                    UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id             UUID          NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      rfq_number            TEXT          NOT NULL,
      title                 TEXT          NOT NULL,
      procurement_type      TEXT          NOT NULL DEFAULT 'rfq',
      organization_unit_id  UUID,
      purchase_request_id   UUID,
      submission_deadline   TIMESTAMPTZ   NOT NULL,
      status                TEXT          NOT NULL DEFAULT 'draft',
      workflow_instance_id  UUID,
      awarded_at            TIMESTAMPTZ,
      cancelled_at          TIMESTAMPTZ,
      notes                 TEXT,
      created_at            TIMESTAMPTZ   NOT NULL DEFAULT now(),
      created_by            UUID,
      updated_at            TIMESTAMPTZ   NOT NULL DEFAULT now(),
      updated_by            UUID,

      FOREIGN KEY (tenant_id, organization_unit_id)
        REFERENCES organization_units(tenant_id, id) ON DELETE SET NULL (organization_unit_id),
      FOREIGN KEY (tenant_id, purchase_request_id)
        REFERENCES purchase_requests(tenant_id, id) ON DELETE SET NULL (purchase_request_id),
      FOREIGN KEY (tenant_id, workflow_instance_id)
        REFERENCES workflow_instances(tenant_id, id) ON DELETE SET NULL (workflow_instance_id),
      FOREIGN KEY (tenant_id, created_by)
        REFERENCES users(tenant_id, id) ON DELETE SET NULL (created_by),
      FOREIGN KEY (tenant_id, updated_by)
        REFERENCES users(tenant_id, id) ON DELETE SET NULL (updated_by),
      CONSTRAINT scm_rfqs_type_check
        CHECK (procurement_type IN ('rfq', 'tender', 'direct_sourcing')),
      CONSTRAINT scm_rfqs_status_check
        CHECK (status IN ('draft', 'published', 'in_evaluation', 'awarded', 'cancelled', 'closed')),
      UNIQUE (tenant_id, rfq_number)
    );

    ALTER TABLE scm_rfqs
      ADD CONSTRAINT scm_rfqs_tenant_id_id_unique UNIQUE (tenant_id, id);
    CREATE INDEX idx_scm_rfqs_tenant
      ON scm_rfqs (tenant_id, status);
    CREATE INDEX idx_scm_rfqs_org_unit
      ON scm_rfqs (organization_unit_id);

    CREATE TABLE scm_rfq_items (
      id                    UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id             UUID          NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      rfq_id                UUID          NOT NULL,
      item_id               UUID          NOT NULL,
      target_quantity       NUMERIC(18,4) NOT NULL,
      target_unit_price     NUMERIC(18,4),
      specifications        TEXT,
      sort_order            INTEGER       NOT NULL DEFAULT 0,

      FOREIGN KEY (tenant_id, rfq_id)
        REFERENCES scm_rfqs(tenant_id, id) ON DELETE CASCADE,
      FOREIGN KEY (tenant_id, item_id)
        REFERENCES items(tenant_id, id) ON DELETE RESTRICT,
      CONSTRAINT scm_rfq_items_qty_check CHECK (target_quantity > 0)
    );

    ALTER TABLE scm_rfq_items
      ADD CONSTRAINT scm_rfq_items_tenant_id_id_unique UNIQUE (tenant_id, id);
    CREATE INDEX idx_scm_rfq_items_rfq
      ON scm_rfq_items (tenant_id, rfq_id);

    CREATE TABLE scm_rfq_invited_suppliers (
      id                    UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id             UUID          NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      rfq_id                UUID          NOT NULL,
      supplier_id           UUID          NOT NULL,
      invited_at            TIMESTAMPTZ   NOT NULL DEFAULT now(),
      responded_at          TIMESTAMPTZ,

      FOREIGN KEY (tenant_id, rfq_id)
        REFERENCES scm_rfqs(tenant_id, id) ON DELETE CASCADE,
      FOREIGN KEY (tenant_id, supplier_id)
        REFERENCES suppliers(tenant_id, id) ON DELETE RESTRICT,
      UNIQUE (tenant_id, rfq_id, supplier_id)
    );

    ALTER TABLE scm_rfq_invited_suppliers
      ADD CONSTRAINT scm_rfq_invited_suppliers_tenant_id_id_unique UNIQUE (tenant_id, id);

    CREATE TABLE scm_supplier_bids (
      id                    UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id             UUID          NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      bid_number            TEXT          NOT NULL,
      rfq_id                UUID          NOT NULL,
      supplier_id           UUID          NOT NULL,
      submitted_at          TIMESTAMPTZ   NOT NULL DEFAULT now(),
      currency              TEXT          NOT NULL DEFAULT 'IDR',
      total_amount          NUMERIC(18,4) NOT NULL DEFAULT 0,
      lead_time_days        INTEGER       NOT NULL DEFAULT 0,
      valid_until           DATE,
      status                TEXT          NOT NULL DEFAULT 'submitted',
      technical_score       NUMERIC(5,2),
      commercial_score      NUMERIC(5,2),
      final_score           NUMERIC(5,2),
      rank                  INTEGER,
      is_winning_bid        BOOLEAN       NOT NULL DEFAULT false,
      resulting_po_id       UUID,
      notes                 TEXT,
      created_at            TIMESTAMPTZ   NOT NULL DEFAULT now(),
      created_by            UUID,
      updated_at            TIMESTAMPTZ   NOT NULL DEFAULT now(),
      updated_by            UUID,

      FOREIGN KEY (tenant_id, rfq_id)
        REFERENCES scm_rfqs(tenant_id, id) ON DELETE CASCADE,
      FOREIGN KEY (tenant_id, supplier_id)
        REFERENCES suppliers(tenant_id, id) ON DELETE RESTRICT,
      FOREIGN KEY (tenant_id, resulting_po_id)
        REFERENCES purchase_orders(tenant_id, id) ON DELETE SET NULL (resulting_po_id),
      FOREIGN KEY (tenant_id, created_by)
        REFERENCES users(tenant_id, id) ON DELETE SET NULL (created_by),
      FOREIGN KEY (tenant_id, updated_by)
        REFERENCES users(tenant_id, id) ON DELETE SET NULL (updated_by),
      CONSTRAINT scm_bids_status_check
        CHECK (status IN ('submitted', 'evaluated', 'shortlisted', 'awarded', 'rejected')),
      CONSTRAINT scm_bids_amount_check CHECK (total_amount >= 0),
      CONSTRAINT scm_bids_lead_time_check CHECK (lead_time_days >= 0),
      UNIQUE (tenant_id, bid_number),
      UNIQUE (tenant_id, rfq_id, supplier_id)
    );

    ALTER TABLE scm_supplier_bids
      ADD CONSTRAINT scm_supplier_bids_tenant_id_id_unique UNIQUE (tenant_id, id);
    CREATE INDEX idx_scm_bids_rfq
      ON scm_supplier_bids (tenant_id, rfq_id, status);

    CREATE TABLE scm_supplier_bid_lines (
      id                    UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id             UUID          NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      bid_id                UUID          NOT NULL,
      rfq_item_id           UUID          NOT NULL,
      offered_quantity      NUMERIC(18,4) NOT NULL,
      offered_unit_price    NUMERIC(18,4) NOT NULL,
      offered_total_price   NUMERIC(18,4) NOT NULL,
      remarks               TEXT,

      FOREIGN KEY (tenant_id, bid_id)
        REFERENCES scm_supplier_bids(tenant_id, id) ON DELETE CASCADE,
      FOREIGN KEY (tenant_id, rfq_item_id)
        REFERENCES scm_rfq_items(tenant_id, id) ON DELETE RESTRICT,
      CONSTRAINT scm_bid_lines_qty_check CHECK (offered_quantity > 0),
      CONSTRAINT scm_bid_lines_price_check CHECK (offered_unit_price >= 0),
      CONSTRAINT scm_bid_lines_total_check CHECK (offered_total_price >= 0)
    );

    ALTER TABLE scm_supplier_bid_lines
      ADD CONSTRAINT scm_supplier_bid_lines_tenant_id_id_unique UNIQUE (tenant_id, id);
    CREATE INDEX idx_scm_bid_lines_bid
      ON scm_supplier_bid_lines (tenant_id, bid_id);

    -- === 5. Supplier Evaluation & Contract Purchasing (SCM-ADV-007) ==========

    CREATE TABLE scm_supplier_evaluations (
      id                    UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id             UUID          NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      evaluation_number     TEXT          NOT NULL,
      supplier_id           UUID          NOT NULL,
      evaluation_period     TEXT          NOT NULL,
      period_start_date     DATE          NOT NULL,
      period_end_date       DATE          NOT NULL,
      quality_score         NUMERIC(5,2)  NOT NULL DEFAULT 0,
      delivery_score        NUMERIC(5,2)  NOT NULL DEFAULT 0,
      pricing_score         NUMERIC(5,2)  NOT NULL DEFAULT 0,
      service_score         NUMERIC(5,2)  NOT NULL DEFAULT 0,
      overall_score         NUMERIC(5,2)  NOT NULL DEFAULT 0,
      rating_grade          TEXT          NOT NULL DEFAULT 'B',
      status                TEXT          NOT NULL DEFAULT 'draft',
      workflow_instance_id  UUID,
      notes                 TEXT,
      evaluated_by          UUID,
      evaluated_at          TIMESTAMPTZ,
      created_at            TIMESTAMPTZ   NOT NULL DEFAULT now(),
      created_by            UUID,
      updated_at            TIMESTAMPTZ   NOT NULL DEFAULT now(),
      updated_by            UUID,

      FOREIGN KEY (tenant_id, supplier_id)
        REFERENCES suppliers(tenant_id, id) ON DELETE RESTRICT,
      FOREIGN KEY (tenant_id, workflow_instance_id)
        REFERENCES workflow_instances(tenant_id, id) ON DELETE SET NULL (workflow_instance_id),
      FOREIGN KEY (tenant_id, evaluated_by)
        REFERENCES users(tenant_id, id) ON DELETE SET NULL (evaluated_by),
      FOREIGN KEY (tenant_id, created_by)
        REFERENCES users(tenant_id, id) ON DELETE SET NULL (created_by),
      FOREIGN KEY (tenant_id, updated_by)
        REFERENCES users(tenant_id, id) ON DELETE SET NULL (updated_by),
      CONSTRAINT scm_evaluations_status_check
        CHECK (status IN ('draft', 'submitted', 'approved', 'rejected')),
      CONSTRAINT scm_evaluations_grade_check
        CHECK (rating_grade IN ('A', 'B', 'C', 'D', 'E')),
      UNIQUE (tenant_id, evaluation_number),
      UNIQUE (tenant_id, supplier_id, evaluation_period)
    );

    ALTER TABLE scm_supplier_evaluations
      ADD CONSTRAINT scm_supplier_evaluations_tenant_id_id_unique UNIQUE (tenant_id, id);
    CREATE INDEX idx_scm_evaluations_supplier
      ON scm_supplier_evaluations (tenant_id, supplier_id, period_end_date DESC);

    CREATE TABLE scm_supplier_contracts (
      id                    UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id             UUID          NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      contract_number       TEXT          NOT NULL,
      supplier_id           UUID          NOT NULL,
      title                 TEXT          NOT NULL,
      contract_type         TEXT          NOT NULL DEFAULT 'blanket_po',
      start_date            DATE          NOT NULL,
      end_date              DATE          NOT NULL,
      currency              TEXT          NOT NULL DEFAULT 'IDR',
      committed_amount      NUMERIC(18,4) NOT NULL DEFAULT 0,
      spent_amount          NUMERIC(18,4) NOT NULL DEFAULT 0,
      status                TEXT          NOT NULL DEFAULT 'draft',
      workflow_instance_id  UUID,
      terms_and_conditions  TEXT,
      approved_at           TIMESTAMPTZ,
      closed_at             TIMESTAMPTZ,
      created_at            TIMESTAMPTZ   NOT NULL DEFAULT now(),
      created_by            UUID,
      updated_at            TIMESTAMPTZ   NOT NULL DEFAULT now(),
      updated_by            UUID,

      FOREIGN KEY (tenant_id, supplier_id)
        REFERENCES suppliers(tenant_id, id) ON DELETE RESTRICT,
      FOREIGN KEY (tenant_id, workflow_instance_id)
        REFERENCES workflow_instances(tenant_id, id) ON DELETE SET NULL (workflow_instance_id),
      FOREIGN KEY (tenant_id, created_by)
        REFERENCES users(tenant_id, id) ON DELETE SET NULL (created_by),
      FOREIGN KEY (tenant_id, updated_by)
        REFERENCES users(tenant_id, id) ON DELETE SET NULL (updated_by),
      CONSTRAINT scm_contracts_type_check
        CHECK (contract_type IN ('blanket_po', 'fixed_price', 'service_rate', 'consignment')),
      CONSTRAINT scm_contracts_status_check
        CHECK (status IN ('draft', 'pending_approval', 'active', 'expired', 'terminated', 'closed')),
      CONSTRAINT scm_contracts_dates_check CHECK (end_date >= start_date),
      CONSTRAINT scm_contracts_committed_check CHECK (committed_amount >= 0),
      CONSTRAINT scm_contracts_spent_check CHECK (spent_amount >= 0),
      UNIQUE (tenant_id, contract_number)
    );

    ALTER TABLE scm_supplier_contracts
      ADD CONSTRAINT scm_supplier_contracts_tenant_id_id_unique UNIQUE (tenant_id, id);
    CREATE INDEX idx_scm_contracts_supplier
      ON scm_supplier_contracts (tenant_id, supplier_id, status);

    CREATE TABLE scm_supplier_contract_items (
      id                    UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id             UUID          NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      contract_id           UUID          NOT NULL,
      item_id               UUID          NOT NULL,
      agreed_unit_price     NUMERIC(18,4) NOT NULL,
      min_order_quantity    NUMERIC(18,4) NOT NULL DEFAULT 1,
      max_order_quantity    NUMERIC(18,4),
      lead_time_days        INTEGER       NOT NULL DEFAULT 0,
      notes                 TEXT,

      FOREIGN KEY (tenant_id, contract_id)
        REFERENCES scm_supplier_contracts(tenant_id, id) ON DELETE CASCADE,
      FOREIGN KEY (tenant_id, item_id)
        REFERENCES items(tenant_id, id) ON DELETE RESTRICT,
      CONSTRAINT scm_contract_items_price_check CHECK (agreed_unit_price >= 0),
      CONSTRAINT scm_contract_items_min_qty_check CHECK (min_order_quantity > 0),
      UNIQUE (tenant_id, contract_id, item_id)
    );

    ALTER TABLE scm_supplier_contract_items
      ADD CONSTRAINT scm_supplier_contract_items_tenant_id_id_unique UNIQUE (tenant_id, id);
    CREATE INDEX idx_scm_contract_items_contract
      ON scm_supplier_contract_items (tenant_id, contract_id);

    -- === 6. Spend Analytics (SCM-ADV-008) =====================================

    CREATE TABLE scm_spend_analytics_snapshots (
      id                    UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id             UUID          NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      snapshot_date         DATE          NOT NULL,
      period_type           TEXT          NOT NULL DEFAULT 'monthly',
      period_key            TEXT          NOT NULL,
      organization_unit_id  UUID,
      supplier_id           UUID,
      item_category         TEXT,
      total_spend           NUMERIC(18,4) NOT NULL DEFAULT 0,
      po_count              INTEGER       NOT NULL DEFAULT 0,
      items_purchased_count INTEGER       NOT NULL DEFAULT 0,
      avg_po_value          NUMERIC(18,4) NOT NULL DEFAULT 0,
      created_at            TIMESTAMPTZ   NOT NULL DEFAULT now(),
      created_by            UUID,

      FOREIGN KEY (tenant_id, organization_unit_id)
        REFERENCES organization_units(tenant_id, id) ON DELETE SET NULL (organization_unit_id),
      FOREIGN KEY (tenant_id, supplier_id)
        REFERENCES suppliers(tenant_id, id) ON DELETE SET NULL (supplier_id),
      FOREIGN KEY (tenant_id, created_by)
        REFERENCES users(tenant_id, id) ON DELETE SET NULL (created_by),
      CONSTRAINT scm_spend_period_type_check
        CHECK (period_type IN ('monthly', 'quarterly', 'yearly')),
      CONSTRAINT scm_spend_total_check CHECK (total_spend >= 0),
      CONSTRAINT scm_spend_po_count_check CHECK (po_count >= 0)
    );

    ALTER TABLE scm_spend_analytics_snapshots
      ADD CONSTRAINT scm_spend_analytics_snapshots_tenant_id_id_unique UNIQUE (tenant_id, id);
    CREATE INDEX idx_scm_spend_tenant_period
      ON scm_spend_analytics_snapshots (tenant_id, period_key);
    CREATE INDEX idx_scm_spend_supplier
      ON scm_spend_analytics_snapshots (tenant_id, supplier_id);
    CREATE INDEX idx_scm_spend_org_unit
      ON scm_spend_analytics_snapshots (tenant_id, organization_unit_id);

    -- === Permissions ========================================================

    INSERT INTO permissions (code, description) VALUES
      ('supply_chain.warehouse.read',     'View warehouses, locations, batches, serials, and advanced stock balances'),
      ('supply_chain.warehouse.manage',   'Maintain warehouses, storage locations, batches, and serial tracking'),
      ('supply_chain.inventory.read',     'View reorder policies, stock reservations, transfers, and opnames'),
      ('supply_chain.inventory.manage',   'Maintain reorder policies, create reservations, transfers, and stock opnames'),
      ('supply_chain.inventory.approve',  'Approve stock transfers, adjustments, and opname reconciliation'),
      ('supply_chain.valuation.read',     'View inventory valuation layers, landed costs, and COGS projections'),
      ('supply_chain.valuation.manage',   'Create and apply landed cost vouchers and valuation adjustments'),
      ('supply_chain.procurement.read',   'View RFQs, tenders, vendor quotations, and bid comparisons'),
      ('supply_chain.procurement.manage', 'Create and maintain RFQs, tenders, invite suppliers, and score bids'),
      ('supply_chain.procurement.award',  'Award RFQs/tenders and convert winning bids to purchase orders'),
      ('supply_chain.contract.read',      'View supplier evaluations, scorecards, and blanket contracts'),
      ('supply_chain.contract.manage',    'Maintain supplier evaluations and purchasing contracts'),
      ('supply_chain.contract.approve',   'Approve supplier evaluations and blanket purchasing contracts'),
      ('supply_chain.analytics.read',     'View spend analytics, supplier metrics, and purchasing reports')
    ON CONFLICT (code) DO NOTHING;
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    -- Drop permissions
    DELETE FROM permissions WHERE code IN (
      'supply_chain.warehouse.read',
      'supply_chain.warehouse.manage',
      'supply_chain.inventory.read',
      'supply_chain.inventory.manage',
      'supply_chain.inventory.approve',
      'supply_chain.valuation.read',
      'supply_chain.valuation.manage',
      'supply_chain.procurement.read',
      'supply_chain.procurement.manage',
      'supply_chain.procurement.award',
      'supply_chain.contract.read',
      'supply_chain.contract.manage',
      'supply_chain.contract.approve',
      'supply_chain.analytics.read'
    );

    -- Drop tables in reverse dependency order
    DROP TABLE IF EXISTS scm_spend_analytics_snapshots;
    DROP TABLE IF EXISTS scm_supplier_contract_items;
    DROP TABLE IF EXISTS scm_supplier_contracts;
    DROP TABLE IF EXISTS scm_supplier_evaluations;
    DROP TABLE IF EXISTS scm_supplier_bid_lines;
    DROP TABLE IF EXISTS scm_supplier_bids;
    DROP TABLE IF EXISTS scm_rfq_invited_suppliers;
    DROP TABLE IF EXISTS scm_rfq_items;
    DROP TABLE IF EXISTS scm_rfqs;
    DROP TABLE IF EXISTS scm_landed_cost_allocations;
    DROP TABLE IF EXISTS scm_landed_costs;
    DROP TABLE IF EXISTS scm_valuation_layers;
    DROP TABLE IF EXISTS scm_stock_opname_lines;
    DROP TABLE IF EXISTS scm_stock_opnames;
    DROP TABLE IF EXISTS scm_stock_transfer_lines;
    DROP TABLE IF EXISTS scm_stock_transfers;
    DROP TABLE IF EXISTS scm_stock_reservations;
    DROP TABLE IF EXISTS scm_reorder_policies;
    DROP TABLE IF EXISTS scm_advanced_stock_movements;
    DROP TABLE IF EXISTS scm_advanced_stock_balances;
    DROP TABLE IF EXISTS scm_item_serials;
    DROP TABLE IF EXISTS scm_item_batches;
    DROP TABLE IF EXISTS scm_warehouse_locations;
    DROP TABLE IF EXISTS scm_warehouses;

    -- Drop composite candidate keys added in this migration
    ALTER TABLE purchase_requests DROP CONSTRAINT IF EXISTS purchase_requests_tenant_id_id_unique;
    ALTER TABLE purchase_orders   DROP CONSTRAINT IF EXISTS purchase_orders_tenant_id_id_unique;
    ALTER TABLE suppliers         DROP CONSTRAINT IF EXISTS suppliers_tenant_id_id_unique;
  `);
};
