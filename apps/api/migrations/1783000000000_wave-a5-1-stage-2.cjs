/**
 * Wave A5.1 Stage 2 — SCM enterprise completion: replacement delivery, service
 * acceptance, consignment consumption, governed disposal, and warehouse tasks.
 *
 * Unweighted enterprise-completion phase (ADR-0023). Supply Chain owns physical
 * stock custody, operational valuation, and immutable accounting-ready events;
 * Finance owns journal posting, account determination, GR/IR, AP, and fiscal
 * periods. No GL journal entries are created in this migration.
 */
exports.up = (pgm) => {
  pgm.sql(`
    -- -----------------------------------------------------------------------
    -- 1. Replacement Deliveries (after Return to Vendor)
    -- -----------------------------------------------------------------------
    CREATE TABLE scm_replacement_deliveries (
      id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id             UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      replacement_number    TEXT        NOT NULL,
      idempotency_key       TEXT        NOT NULL,
      return_to_vendor_id   UUID        NOT NULL,
      purchase_order_id     UUID,
      supplier_id           UUID        NOT NULL,
      warehouse_id          UUID        NOT NULL,
      location_id           UUID,
      received_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
      received_by           UUID,
      status                TEXT        NOT NULL DEFAULT 'received',
      notes                 TEXT,
      created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
      created_by            UUID,
      updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_by            UUID,

      FOREIGN KEY (tenant_id, return_to_vendor_id)
        REFERENCES scm_return_to_vendors(tenant_id, id) ON DELETE RESTRICT,
      FOREIGN KEY (tenant_id, purchase_order_id)
        REFERENCES purchase_orders(tenant_id, id) ON DELETE SET NULL (purchase_order_id),
      FOREIGN KEY (tenant_id, supplier_id)
        REFERENCES suppliers(tenant_id, id) ON DELETE RESTRICT,
      FOREIGN KEY (tenant_id, warehouse_id)
        REFERENCES scm_warehouses(tenant_id, id) ON DELETE RESTRICT,
      FOREIGN KEY (tenant_id, location_id)
        REFERENCES scm_warehouse_locations(tenant_id, id) ON DELETE RESTRICT,
      FOREIGN KEY (tenant_id, received_by)
        REFERENCES users(tenant_id, id) ON DELETE SET NULL (received_by),
      FOREIGN KEY (tenant_id, created_by)
        REFERENCES users(tenant_id, id) ON DELETE SET NULL (created_by),
      FOREIGN KEY (tenant_id, updated_by)
        REFERENCES users(tenant_id, id) ON DELETE SET NULL (updated_by),
      CONSTRAINT scm_replacement_deliveries_status_check
        CHECK (status IN ('received', 'partially_inspected', 'accepted', 'cancelled')),
      UNIQUE (tenant_id, replacement_number),
      UNIQUE (tenant_id, idempotency_key)
    );

    ALTER TABLE scm_replacement_deliveries
      ADD CONSTRAINT scm_replacement_deliveries_tenant_id_id_unique UNIQUE (tenant_id, id);
    CREATE INDEX idx_scm_replacement_deliveries_rtv
      ON scm_replacement_deliveries (tenant_id, return_to_vendor_id, received_at DESC);
    CREATE INDEX idx_scm_replacement_deliveries_supplier
      ON scm_replacement_deliveries (tenant_id, supplier_id, received_at DESC);

    CREATE TABLE scm_replacement_delivery_lines (
      id                              UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id                       UUID          NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      replacement_delivery_id         UUID          NOT NULL,
      return_to_vendor_line_id        UUID,
      purchase_order_line_id          UUID,
      item_id                         UUID          NOT NULL,
      warehouse_id                    UUID          NOT NULL,
      location_id                     UUID,
      batch_id                        UUID,
      stock_condition                 TEXT          NOT NULL DEFAULT 'quality_hold',
      owner_type                      TEXT          NOT NULL DEFAULT 'own',
      owner_party_id                  UUID,
      quantity                        NUMERIC(18,4) NOT NULL,
      unit_cost                       NUMERIC(18,4),
      currency                        TEXT          NOT NULL DEFAULT 'IDR',
      account_assignment_type         TEXT          NOT NULL DEFAULT 'stock',
      account_assignment_dimensions   JSONB         NOT NULL DEFAULT '{}'::jsonb,
      movement_id                     UUID,
      accounting_ready_event_id       UUID,
      notes                           TEXT,
      sort_order                      INTEGER       NOT NULL DEFAULT 0,

      FOREIGN KEY (tenant_id, replacement_delivery_id)
        REFERENCES scm_replacement_deliveries(tenant_id, id) ON DELETE CASCADE,
      FOREIGN KEY (tenant_id, return_to_vendor_line_id)
        REFERENCES scm_return_to_vendor_lines(tenant_id, id) ON DELETE SET NULL (return_to_vendor_line_id),
      FOREIGN KEY (tenant_id, purchase_order_line_id)
        REFERENCES purchase_order_lines(tenant_id, id) ON DELETE SET NULL (purchase_order_line_id),
      FOREIGN KEY (tenant_id, item_id)
        REFERENCES items(tenant_id, id) ON DELETE RESTRICT,
      FOREIGN KEY (tenant_id, warehouse_id)
        REFERENCES scm_warehouses(tenant_id, id) ON DELETE RESTRICT,
      FOREIGN KEY (tenant_id, location_id)
        REFERENCES scm_warehouse_locations(tenant_id, id) ON DELETE RESTRICT,
      FOREIGN KEY (tenant_id, batch_id)
        REFERENCES scm_item_batches(tenant_id, id) ON DELETE RESTRICT,
      FOREIGN KEY (tenant_id, movement_id)
        REFERENCES scm_advanced_stock_movements(tenant_id, id) ON DELETE SET NULL (movement_id),
      FOREIGN KEY (tenant_id, accounting_ready_event_id)
        REFERENCES scm_accounting_ready_events(tenant_id, id) ON DELETE SET NULL (accounting_ready_event_id),
      CONSTRAINT scm_replacement_lines_condition_check
        CHECK (stock_condition IN ('unrestricted', 'quality_hold', 'rejected', 'quarantined', 'blocked', 'in_transit', 'in_repair')),
      CONSTRAINT scm_replacement_lines_owner_type_check
        CHECK (owner_type IN ('own', 'supplier', 'customer')),
      CONSTRAINT scm_replacement_lines_owner_party_check
        CHECK ((owner_type = 'own' AND owner_party_id IS NULL) OR (owner_type <> 'own' AND owner_party_id IS NOT NULL)),
      CONSTRAINT scm_replacement_lines_assignment_type_check
        CHECK (account_assignment_type IN ('stock', 'expense', 'asset', 'project', 'work_order', 'service')),
      CONSTRAINT scm_replacement_lines_assignment_dims_check
        CHECK (jsonb_typeof(account_assignment_dimensions) = 'object'),
      CONSTRAINT scm_replacement_lines_qty_check CHECK (quantity > 0),
      CONSTRAINT scm_replacement_lines_unit_cost_check CHECK (unit_cost IS NULL OR unit_cost >= 0)
    );

    ALTER TABLE scm_replacement_delivery_lines
      ADD CONSTRAINT scm_replacement_delivery_lines_tenant_id_id_unique UNIQUE (tenant_id, id);
    CREATE INDEX idx_scm_replacement_lines_delivery
      ON scm_replacement_delivery_lines (tenant_id, replacement_delivery_id);
    CREATE INDEX idx_scm_replacement_lines_rtv_line
      ON scm_replacement_delivery_lines (tenant_id, return_to_vendor_line_id);

    -- -----------------------------------------------------------------------
    -- 2. Service Acceptances (Service Entry Sheets)
    -- -----------------------------------------------------------------------
    CREATE TABLE scm_service_acceptances (
      id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id             UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      acceptance_number     TEXT        NOT NULL,
      idempotency_key       TEXT        NOT NULL,
      purchase_order_id     UUID        NOT NULL,
      supplier_id           UUID        NOT NULL,
      organization_unit_id  UUID,
      status                TEXT        NOT NULL DEFAULT 'draft',
      workflow_instance_id  UUID,
      submitted_at          TIMESTAMPTZ,
      submitted_by          UUID,
      approved_at           TIMESTAMPTZ,
      approved_by           UUID,
      rejected_at           TIMESTAMPTZ,
      rejected_by           UUID,
      rejection_reason      TEXT,
      service_period_start  DATE,
      service_period_end    DATE,
      notes                 TEXT,
      created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
      created_by            UUID,
      updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_by            UUID,

      FOREIGN KEY (tenant_id, purchase_order_id)
        REFERENCES purchase_orders(tenant_id, id) ON DELETE RESTRICT,
      FOREIGN KEY (tenant_id, supplier_id)
        REFERENCES suppliers(tenant_id, id) ON DELETE RESTRICT,
      FOREIGN KEY (tenant_id, organization_unit_id)
        REFERENCES organization_units(tenant_id, id) ON DELETE SET NULL (organization_unit_id),
      FOREIGN KEY (tenant_id, workflow_instance_id)
        REFERENCES workflow_instances(tenant_id, id) ON DELETE SET NULL (workflow_instance_id),
      FOREIGN KEY (tenant_id, submitted_by)
        REFERENCES users(tenant_id, id) ON DELETE SET NULL (submitted_by),
      FOREIGN KEY (tenant_id, approved_by)
        REFERENCES users(tenant_id, id) ON DELETE SET NULL (approved_by),
      FOREIGN KEY (tenant_id, rejected_by)
        REFERENCES users(tenant_id, id) ON DELETE SET NULL (rejected_by),
      FOREIGN KEY (tenant_id, created_by)
        REFERENCES users(tenant_id, id) ON DELETE SET NULL (created_by),
      FOREIGN KEY (tenant_id, updated_by)
        REFERENCES users(tenant_id, id) ON DELETE SET NULL (updated_by),
      CONSTRAINT scm_service_acceptances_status_check
        CHECK (status IN ('draft', 'submitted', 'approved', 'rejected', 'cancelled')),
      CONSTRAINT scm_service_acceptances_period_check
        CHECK (service_period_start IS NULL OR service_period_end IS NULL OR service_period_start <= service_period_end),
      UNIQUE (tenant_id, acceptance_number),
      UNIQUE (tenant_id, idempotency_key)
    );

    ALTER TABLE scm_service_acceptances
      ADD CONSTRAINT scm_service_acceptances_tenant_id_id_unique UNIQUE (tenant_id, id);
    CREATE INDEX idx_scm_service_acceptances_po
      ON scm_service_acceptances (tenant_id, purchase_order_id, created_at DESC);
    CREATE INDEX idx_scm_service_acceptances_supplier
      ON scm_service_acceptances (tenant_id, supplier_id, status);
    CREATE INDEX idx_scm_service_acceptances_status
      ON scm_service_acceptances (tenant_id, status, created_at DESC);

    CREATE TABLE scm_service_acceptance_lines (
      id                              UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id                       UUID          NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      service_acceptance_id           UUID          NOT NULL,
      purchase_order_line_id          UUID          NOT NULL,
      description                     TEXT          NOT NULL,
      quantity                        NUMERIC(18,4) NOT NULL,
      unit_price                      NUMERIC(18,4) NOT NULL,
      currency                        TEXT          NOT NULL DEFAULT 'IDR',
      amount                          NUMERIC(18,4) NOT NULL,
      account_assignment_type         TEXT          NOT NULL DEFAULT 'service',
      account_assignment_dimensions   JSONB         NOT NULL DEFAULT '{}'::jsonb,
      frozen_account_assignment_at    TIMESTAMPTZ,
      accounting_ready_event_id       UUID,
      notes                           TEXT,
      sort_order                      INTEGER       NOT NULL DEFAULT 0,

      FOREIGN KEY (tenant_id, service_acceptance_id)
        REFERENCES scm_service_acceptances(tenant_id, id) ON DELETE CASCADE,
      FOREIGN KEY (tenant_id, purchase_order_line_id)
        REFERENCES purchase_order_lines(tenant_id, id) ON DELETE RESTRICT,
      FOREIGN KEY (tenant_id, accounting_ready_event_id)
        REFERENCES scm_accounting_ready_events(tenant_id, id) ON DELETE SET NULL (accounting_ready_event_id),
      CONSTRAINT scm_service_lines_assignment_type_check
        CHECK (account_assignment_type IN ('stock', 'expense', 'asset', 'project', 'work_order', 'service')),
      CONSTRAINT scm_service_lines_assignment_dims_check
        CHECK (jsonb_typeof(account_assignment_dimensions) = 'object'),
      CONSTRAINT scm_service_lines_qty_check CHECK (quantity > 0),
      CONSTRAINT scm_service_lines_unit_price_check CHECK (unit_price >= 0),
      CONSTRAINT scm_service_lines_amount_check CHECK (amount >= 0)
    );

    ALTER TABLE scm_service_acceptance_lines
      ADD CONSTRAINT scm_service_acceptance_lines_tenant_id_id_unique UNIQUE (tenant_id, id);
    CREATE INDEX idx_scm_service_lines_acceptance
      ON scm_service_acceptance_lines (tenant_id, service_acceptance_id);
    CREATE INDEX idx_scm_service_lines_po_line
      ON scm_service_acceptance_lines (tenant_id, purchase_order_line_id);

    -- Immutability trigger: approved service acceptance facts cannot change
    CREATE OR REPLACE FUNCTION scm_reject_approved_service_acceptance_changes()
    RETURNS trigger AS $$
    BEGIN
      IF OLD.status IN ('approved', 'rejected') AND (
        OLD.acceptance_number IS DISTINCT FROM NEW.acceptance_number OR
        OLD.purchase_order_id IS DISTINCT FROM NEW.purchase_order_id OR
        OLD.supplier_id IS DISTINCT FROM NEW.supplier_id OR
        OLD.approved_at IS DISTINCT FROM NEW.approved_at OR
        OLD.approved_by IS DISTINCT FROM NEW.approved_by
      ) THEN
        RAISE EXCEPTION 'Approved or rejected service acceptance facts cannot be changed';
      END IF;
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;

    CREATE TRIGGER trg_scm_service_acceptance_immutable
      BEFORE UPDATE ON scm_service_acceptances
      FOR EACH ROW EXECUTE FUNCTION scm_reject_approved_service_acceptance_changes();

    -- -----------------------------------------------------------------------
    -- 3. Consignment Settlements (consumption ownership transfers)
    -- -----------------------------------------------------------------------
    CREATE TABLE scm_consignment_settlements (
      id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id             UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      settlement_number     TEXT        NOT NULL,
      idempotency_key       TEXT        NOT NULL,
      supplier_id           UUID        NOT NULL,
      warehouse_id          UUID        NOT NULL,
      settled_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
      settled_by            UUID,
      status                TEXT        NOT NULL DEFAULT 'settled',
      notes                 TEXT,
      created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
      created_by            UUID,

      FOREIGN KEY (tenant_id, supplier_id)
        REFERENCES suppliers(tenant_id, id) ON DELETE RESTRICT,
      FOREIGN KEY (tenant_id, warehouse_id)
        REFERENCES scm_warehouses(tenant_id, id) ON DELETE RESTRICT,
      FOREIGN KEY (tenant_id, settled_by)
        REFERENCES users(tenant_id, id) ON DELETE SET NULL (settled_by),
      FOREIGN KEY (tenant_id, created_by)
        REFERENCES users(tenant_id, id) ON DELETE SET NULL (created_by),
      CONSTRAINT scm_consignment_settlements_status_check
        CHECK (status IN ('settled', 'cancelled')),
      UNIQUE (tenant_id, settlement_number),
      UNIQUE (tenant_id, idempotency_key)
    );

    ALTER TABLE scm_consignment_settlements
      ADD CONSTRAINT scm_consignment_settlements_tenant_id_id_unique UNIQUE (tenant_id, id);
    CREATE INDEX idx_scm_consignment_settlements_supplier
      ON scm_consignment_settlements (tenant_id, supplier_id, settled_at DESC);

    CREATE TABLE scm_consignment_settlement_lines (
      id                              UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id                       UUID          NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      consignment_settlement_id       UUID          NOT NULL,
      item_id                         UUID          NOT NULL,
      warehouse_id                    UUID          NOT NULL,
      location_id                     UUID,
      batch_id                        UUID,
      quantity                        NUMERIC(18,4) NOT NULL,
      unit_cost                       NUMERIC(18,4) NOT NULL,
      currency                        TEXT          NOT NULL DEFAULT 'IDR',
      amount                          NUMERIC(18,4) NOT NULL,
      supplier_out_movement_id        UUID,
      own_in_movement_id              UUID,
      valuation_layer_id              UUID,
      accounting_ready_event_id       UUID,
      sort_order                      INTEGER       NOT NULL DEFAULT 0,

      FOREIGN KEY (tenant_id, consignment_settlement_id)
        REFERENCES scm_consignment_settlements(tenant_id, id) ON DELETE CASCADE,
      FOREIGN KEY (tenant_id, item_id)
        REFERENCES items(tenant_id, id) ON DELETE RESTRICT,
      FOREIGN KEY (tenant_id, warehouse_id)
        REFERENCES scm_warehouses(tenant_id, id) ON DELETE RESTRICT,
      FOREIGN KEY (tenant_id, location_id)
        REFERENCES scm_warehouse_locations(tenant_id, id) ON DELETE RESTRICT,
      FOREIGN KEY (tenant_id, batch_id)
        REFERENCES scm_item_batches(tenant_id, id) ON DELETE RESTRICT,
      FOREIGN KEY (tenant_id, supplier_out_movement_id)
        REFERENCES scm_advanced_stock_movements(tenant_id, id) ON DELETE SET NULL (supplier_out_movement_id),
      FOREIGN KEY (tenant_id, own_in_movement_id)
        REFERENCES scm_advanced_stock_movements(tenant_id, id) ON DELETE SET NULL (own_in_movement_id),
      FOREIGN KEY (tenant_id, valuation_layer_id)
        REFERENCES scm_valuation_layers(tenant_id, id) ON DELETE SET NULL (valuation_layer_id),
      FOREIGN KEY (tenant_id, accounting_ready_event_id)
        REFERENCES scm_accounting_ready_events(tenant_id, id) ON DELETE SET NULL (accounting_ready_event_id),
      CONSTRAINT scm_consignment_lines_qty_check CHECK (quantity > 0),
      CONSTRAINT scm_consignment_lines_unit_cost_check CHECK (unit_cost >= 0),
      CONSTRAINT scm_consignment_lines_amount_check CHECK (amount >= 0)
    );

    ALTER TABLE scm_consignment_settlement_lines
      ADD CONSTRAINT scm_consignment_settlement_lines_tenant_id_id_unique UNIQUE (tenant_id, id);
    CREATE INDEX idx_scm_consignment_lines_settlement
      ON scm_consignment_settlement_lines (tenant_id, consignment_settlement_id);
    CREATE INDEX idx_scm_consignment_lines_item
      ON scm_consignment_settlement_lines (tenant_id, item_id, warehouse_id);

    -- -----------------------------------------------------------------------
    -- 4. Governed Inventory Disposals
    -- -----------------------------------------------------------------------
    CREATE TABLE scm_inventory_disposals (
      id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id             UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      disposal_number       TEXT        NOT NULL,
      idempotency_key       TEXT        NOT NULL,
      warehouse_id          UUID        NOT NULL,
      organization_unit_id  UUID,
      disposal_type         TEXT        NOT NULL DEFAULT 'write_off',
      reason                TEXT        NOT NULL,
      status                TEXT        NOT NULL DEFAULT 'draft',
      workflow_instance_id  UUID,
      submitted_at          TIMESTAMPTZ,
      submitted_by          UUID,
      approved_at           TIMESTAMPTZ,
      approved_by           UUID,
      executed_at           TIMESTAMPTZ,
      executed_by           UUID,
      rejected_at           TIMESTAMPTZ,
      rejected_by           UUID,
      rejection_reason      TEXT,
      notes                 TEXT,
      created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
      created_by            UUID,
      updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_by            UUID,

      FOREIGN KEY (tenant_id, warehouse_id)
        REFERENCES scm_warehouses(tenant_id, id) ON DELETE RESTRICT,
      FOREIGN KEY (tenant_id, organization_unit_id)
        REFERENCES organization_units(tenant_id, id) ON DELETE SET NULL (organization_unit_id),
      FOREIGN KEY (tenant_id, workflow_instance_id)
        REFERENCES workflow_instances(tenant_id, id) ON DELETE SET NULL (workflow_instance_id),
      FOREIGN KEY (tenant_id, submitted_by)
        REFERENCES users(tenant_id, id) ON DELETE SET NULL (submitted_by),
      FOREIGN KEY (tenant_id, approved_by)
        REFERENCES users(tenant_id, id) ON DELETE SET NULL (approved_by),
      FOREIGN KEY (tenant_id, executed_by)
        REFERENCES users(tenant_id, id) ON DELETE SET NULL (executed_by),
      FOREIGN KEY (tenant_id, rejected_by)
        REFERENCES users(tenant_id, id) ON DELETE SET NULL (rejected_by),
      FOREIGN KEY (tenant_id, created_by)
        REFERENCES users(tenant_id, id) ON DELETE SET NULL (created_by),
      FOREIGN KEY (tenant_id, updated_by)
        REFERENCES users(tenant_id, id) ON DELETE SET NULL (updated_by),
      CONSTRAINT scm_disposals_type_check
        CHECK (disposal_type IN ('write_off', 'scrap', 'donation', 'destruction', 'expired')),
      CONSTRAINT scm_disposals_status_check
        CHECK (status IN ('draft', 'submitted', 'approved', 'rejected', 'executed', 'cancelled')),
      UNIQUE (tenant_id, disposal_number),
      UNIQUE (tenant_id, idempotency_key)
    );

    ALTER TABLE scm_inventory_disposals
      ADD CONSTRAINT scm_inventory_disposals_tenant_id_id_unique UNIQUE (tenant_id, id);
    CREATE INDEX idx_scm_disposals_warehouse
      ON scm_inventory_disposals (tenant_id, warehouse_id, status);
    CREATE INDEX idx_scm_disposals_status
      ON scm_inventory_disposals (tenant_id, status, created_at DESC);

    CREATE TABLE scm_inventory_disposal_lines (
      id                              UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id                       UUID          NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      disposal_id                     UUID          NOT NULL,
      item_id                         UUID          NOT NULL,
      warehouse_id                    UUID          NOT NULL,
      location_id                     UUID,
      batch_id                        UUID,
      serial_id                       UUID,
      stock_condition                 TEXT          NOT NULL DEFAULT 'unrestricted',
      owner_type                      TEXT          NOT NULL DEFAULT 'own',
      owner_party_id                  UUID,
      quantity                        NUMERIC(18,4) NOT NULL,
      unit_cost                       NUMERIC(18,4),
      currency                        TEXT          NOT NULL DEFAULT 'IDR',
      amount                          NUMERIC(18,4),
      movement_id                     UUID,
      valuation_layer_allocation_id   UUID,
      accounting_ready_event_id       UUID,
      notes                           TEXT,
      sort_order                      INTEGER       NOT NULL DEFAULT 0,

      FOREIGN KEY (tenant_id, disposal_id)
        REFERENCES scm_inventory_disposals(tenant_id, id) ON DELETE CASCADE,
      FOREIGN KEY (tenant_id, item_id)
        REFERENCES items(tenant_id, id) ON DELETE RESTRICT,
      FOREIGN KEY (tenant_id, warehouse_id)
        REFERENCES scm_warehouses(tenant_id, id) ON DELETE RESTRICT,
      FOREIGN KEY (tenant_id, location_id)
        REFERENCES scm_warehouse_locations(tenant_id, id) ON DELETE RESTRICT,
      FOREIGN KEY (tenant_id, batch_id)
        REFERENCES scm_item_batches(tenant_id, id) ON DELETE RESTRICT,
      FOREIGN KEY (tenant_id, serial_id)
        REFERENCES scm_item_serials(tenant_id, id) ON DELETE SET NULL (serial_id),
      FOREIGN KEY (tenant_id, movement_id)
        REFERENCES scm_advanced_stock_movements(tenant_id, id) ON DELETE SET NULL (movement_id),
      FOREIGN KEY (tenant_id, valuation_layer_allocation_id)
        REFERENCES scm_valuation_layer_allocations(tenant_id, id) ON DELETE SET NULL (valuation_layer_allocation_id),
      FOREIGN KEY (tenant_id, accounting_ready_event_id)
        REFERENCES scm_accounting_ready_events(tenant_id, id) ON DELETE SET NULL (accounting_ready_event_id),
      CONSTRAINT scm_disposal_lines_condition_check
        CHECK (stock_condition IN ('unrestricted', 'quality_hold', 'rejected', 'quarantined', 'blocked', 'in_transit', 'in_repair')),
      CONSTRAINT scm_disposal_lines_owner_type_check
        CHECK (owner_type IN ('own', 'supplier', 'customer')),
      CONSTRAINT scm_disposal_lines_owner_party_check
        CHECK ((owner_type = 'own' AND owner_party_id IS NULL) OR (owner_type <> 'own' AND owner_party_id IS NOT NULL)),
      CONSTRAINT scm_disposal_lines_qty_check CHECK (quantity > 0),
      CONSTRAINT scm_disposal_lines_unit_cost_check CHECK (unit_cost IS NULL OR unit_cost >= 0),
      CONSTRAINT scm_disposal_lines_amount_check CHECK (amount IS NULL OR amount >= 0)
    );

    ALTER TABLE scm_inventory_disposal_lines
      ADD CONSTRAINT scm_inventory_disposal_lines_tenant_id_id_unique UNIQUE (tenant_id, id);
    CREATE INDEX idx_scm_disposal_lines_disposal
      ON scm_inventory_disposal_lines (tenant_id, disposal_id);
    CREATE INDEX idx_scm_disposal_lines_item
      ON scm_inventory_disposal_lines (tenant_id, item_id, warehouse_id);

    -- -----------------------------------------------------------------------
    -- 5. Warehouse Tasks (putaway, pick, pack, cycle count)
    -- -----------------------------------------------------------------------
    CREATE TABLE scm_warehouse_tasks (
      id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id             UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      task_number           TEXT        NOT NULL,
      idempotency_key       TEXT        NOT NULL,
      warehouse_id          UUID        NOT NULL,
      task_type             TEXT        NOT NULL,
      priority              TEXT        NOT NULL DEFAULT 'normal',
      status                TEXT        NOT NULL DEFAULT 'open',
      source_document_type  TEXT,
      source_document_id    UUID,
      assigned_to           UUID,
      assigned_at           TIMESTAMPTZ,
      started_at            TIMESTAMPTZ,
      completed_at          TIMESTAMPTZ,
      completed_by          UUID,
      cancelled_at          TIMESTAMPTZ,
      cancelled_by          UUID,
      cancellation_reason   TEXT,
      due_at                TIMESTAMPTZ,
      notes                 TEXT,
      created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
      created_by            UUID,
      updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_by            UUID,

      FOREIGN KEY (tenant_id, warehouse_id)
        REFERENCES scm_warehouses(tenant_id, id) ON DELETE RESTRICT,
      FOREIGN KEY (tenant_id, assigned_to)
        REFERENCES users(tenant_id, id) ON DELETE SET NULL (assigned_to),
      FOREIGN KEY (tenant_id, completed_by)
        REFERENCES users(tenant_id, id) ON DELETE SET NULL (completed_by),
      FOREIGN KEY (tenant_id, cancelled_by)
        REFERENCES users(tenant_id, id) ON DELETE SET NULL (cancelled_by),
      FOREIGN KEY (tenant_id, created_by)
        REFERENCES users(tenant_id, id) ON DELETE SET NULL (created_by),
      FOREIGN KEY (tenant_id, updated_by)
        REFERENCES users(tenant_id, id) ON DELETE SET NULL (updated_by),
      CONSTRAINT scm_warehouse_tasks_type_check
        CHECK (task_type IN ('putaway', 'pick', 'pack', 'cycle_count', 'replenishment', 'relocation')),
      CONSTRAINT scm_warehouse_tasks_priority_check
        CHECK (priority IN ('low', 'normal', 'high', 'urgent')),
      CONSTRAINT scm_warehouse_tasks_status_check
        CHECK (status IN ('open', 'assigned', 'in_progress', 'completed', 'cancelled')),
      UNIQUE (tenant_id, task_number),
      UNIQUE (tenant_id, idempotency_key)
    );

    ALTER TABLE scm_warehouse_tasks
      ADD CONSTRAINT scm_warehouse_tasks_tenant_id_id_unique UNIQUE (tenant_id, id);
    CREATE INDEX idx_scm_warehouse_tasks_warehouse
      ON scm_warehouse_tasks (tenant_id, warehouse_id, status);
    CREATE INDEX idx_scm_warehouse_tasks_assigned
      ON scm_warehouse_tasks (tenant_id, assigned_to, status)
      WHERE assigned_to IS NOT NULL;
    CREATE INDEX idx_scm_warehouse_tasks_due
      ON scm_warehouse_tasks (tenant_id, due_at)
      WHERE status IN ('open', 'assigned', 'in_progress');

    CREATE TABLE scm_warehouse_task_items (
      id                    UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id             UUID          NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      warehouse_task_id     UUID          NOT NULL,
      item_id               UUID          NOT NULL,
      from_location_id      UUID,
      to_location_id        UUID,
      batch_id              UUID,
      serial_id             UUID,
      expected_quantity     NUMERIC(18,4) NOT NULL,
      actual_quantity       NUMERIC(18,4),
      movement_id           UUID,
      status                TEXT          NOT NULL DEFAULT 'pending',
      notes                 TEXT,
      sort_order            INTEGER       NOT NULL DEFAULT 0,

      FOREIGN KEY (tenant_id, warehouse_task_id)
        REFERENCES scm_warehouse_tasks(tenant_id, id) ON DELETE CASCADE,
      FOREIGN KEY (tenant_id, item_id)
        REFERENCES items(tenant_id, id) ON DELETE RESTRICT,
      FOREIGN KEY (tenant_id, from_location_id)
        REFERENCES scm_warehouse_locations(tenant_id, id) ON DELETE RESTRICT,
      FOREIGN KEY (tenant_id, to_location_id)
        REFERENCES scm_warehouse_locations(tenant_id, id) ON DELETE RESTRICT,
      FOREIGN KEY (tenant_id, batch_id)
        REFERENCES scm_item_batches(tenant_id, id) ON DELETE RESTRICT,
      FOREIGN KEY (tenant_id, serial_id)
        REFERENCES scm_item_serials(tenant_id, id) ON DELETE SET NULL (serial_id),
      FOREIGN KEY (tenant_id, movement_id)
        REFERENCES scm_advanced_stock_movements(tenant_id, id) ON DELETE SET NULL (movement_id),
      CONSTRAINT scm_task_items_expected_qty_check CHECK (expected_quantity > 0),
      CONSTRAINT scm_task_items_actual_qty_check CHECK (actual_quantity IS NULL OR actual_quantity >= 0),
      CONSTRAINT scm_task_items_status_check
        CHECK (status IN ('pending', 'in_progress', 'completed', 'skipped'))
    );

    ALTER TABLE scm_warehouse_task_items
      ADD CONSTRAINT scm_warehouse_task_items_tenant_id_id_unique UNIQUE (tenant_id, id);
    CREATE INDEX idx_scm_task_items_task
      ON scm_warehouse_task_items (tenant_id, warehouse_task_id);
    CREATE INDEX idx_scm_task_items_item
      ON scm_warehouse_task_items (tenant_id, item_id);

    -- -----------------------------------------------------------------------
    -- 6. Expand movement_type CHECK to include Stage 2 types
    -- -----------------------------------------------------------------------
    ALTER TABLE scm_advanced_stock_movements
      DROP CONSTRAINT IF EXISTS scm_adv_movements_type_check;
    ALTER TABLE scm_advanced_stock_movements
      ADD CONSTRAINT scm_adv_movements_type_check
        CHECK (movement_type IN (
          'in', 'out', 'transfer_in', 'transfer_out', 'adjustment_in', 'adjustment_out', 'opname_in', 'opname_out',
          'inspection_hold_in', 'inspection_hold_out', 'inspection_release_in', 'inspection_release_out',
          'return_to_vendor_out', 'receipt_reversal_out', 'receipt_reversal_in', 'consignment_in', 'consignment_out',
          'replacement_in', 'disposal_out'
        ));

    -- -----------------------------------------------------------------------
    -- 7. Expand valuation layer allocation types for Stage 2
    -- -----------------------------------------------------------------------
    ALTER TABLE scm_valuation_layer_allocations
      DROP CONSTRAINT IF EXISTS scm_val_layer_alloc_type_check;
    ALTER TABLE scm_valuation_layer_allocations
      ADD CONSTRAINT scm_val_layer_alloc_type_check
        CHECK (allocation_type IN ('consume', 'return_to_vendor', 'receipt_reversal', 'restore', 'disposal', 'consignment_consumption'));

    -- -----------------------------------------------------------------------
    -- 8. Register Stage 2 permissions
    -- -----------------------------------------------------------------------
    INSERT INTO permissions (code, description) VALUES
      ('supply_chain.service_acceptance.read',    'View service acceptance records (Service Entry Sheets)'),
      ('supply_chain.service_acceptance.manage',  'Create and edit service acceptance records'),
      ('supply_chain.service_acceptance.approve', 'Submit and approve service acceptance records'),
      ('supply_chain.consignment.read',           'View consignment stock balances and settlement records'),
      ('supply_chain.consignment.manage',         'Execute consignment stock consumption and settlement'),
      ('supply_chain.disposal.read',              'View inventory disposal requests and execution records'),
      ('supply_chain.disposal.manage',            'Create inventory disposal requests'),
      ('supply_chain.disposal.approve',           'Approve and execute governed inventory disposals'),
      ('supply_chain.warehouse_task.read',        'View warehouse execution tasks'),
      ('supply_chain.warehouse_task.manage',      'Create and assign warehouse execution tasks'),
      ('supply_chain.warehouse_task.execute',     'Execute and complete warehouse tasks')
    ON CONFLICT (code) DO NOTHING;
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    -- Fail-closed rollback guard: refuse if Stage 2 operational data exists
    DO $$
    BEGIN
      -- Guard: replacement_in or disposal_out movements exist
      IF EXISTS (
        SELECT 1
          FROM scm_advanced_stock_movements
         WHERE movement_type IN ('replacement_in', 'disposal_out')
      ) THEN
        RAISE EXCEPTION 'Cannot rollback Wave A5.1 Stage 2: replacement_in or disposal_out stock movements exist';
      END IF;

      -- Guard: non-draft disposal records exist
      IF EXISTS (
        SELECT 1
          FROM scm_inventory_disposals
         WHERE status NOT IN ('draft', 'cancelled')
      ) THEN
        RAISE EXCEPTION 'Cannot rollback Wave A5.1 Stage 2: active inventory disposal records exist';
      END IF;

      -- Guard: settled consignment settlements exist
      IF EXISTS (
        SELECT 1
          FROM scm_consignment_settlements
         WHERE status = 'settled'
      ) THEN
        RAISE EXCEPTION 'Cannot rollback Wave A5.1 Stage 2: settled consignment records exist';
      END IF;

      -- Guard: approved or submitted service acceptances exist
      IF EXISTS (
        SELECT 1
          FROM scm_service_acceptances
         WHERE status NOT IN ('draft', 'cancelled')
      ) THEN
        RAISE EXCEPTION 'Cannot rollback Wave A5.1 Stage 2: active service acceptance records exist';
      END IF;

      -- Guard: non-open/cancelled warehouse tasks exist
      IF EXISTS (
        SELECT 1
          FROM scm_warehouse_tasks
         WHERE status NOT IN ('open', 'cancelled')
      ) THEN
        RAISE EXCEPTION 'Cannot rollback Wave A5.1 Stage 2: in-progress or completed warehouse tasks exist';
      END IF;

      -- Guard: replacement deliveries exist
      IF EXISTS (
        SELECT 1
          FROM scm_replacement_deliveries
      ) THEN
        RAISE EXCEPTION 'Cannot rollback Wave A5.1 Stage 2: replacement delivery records exist';
      END IF;

      -- Guard: consignment_consumption or disposal allocation types exist
      IF EXISTS (
        SELECT 1
          FROM scm_valuation_layer_allocations
         WHERE allocation_type IN ('disposal', 'consignment_consumption')
      ) THEN
        RAISE EXCEPTION 'Cannot rollback Wave A5.1 Stage 2: Stage 2 valuation layer allocations exist';
      END IF;
    END $$;

    -- Delete Stage 2 permissions
    DELETE FROM permissions WHERE code IN (
      'supply_chain.service_acceptance.read',
      'supply_chain.service_acceptance.manage',
      'supply_chain.service_acceptance.approve',
      'supply_chain.consignment.read',
      'supply_chain.consignment.manage',
      'supply_chain.disposal.read',
      'supply_chain.disposal.manage',
      'supply_chain.disposal.approve',
      'supply_chain.warehouse_task.read',
      'supply_chain.warehouse_task.manage',
      'supply_chain.warehouse_task.execute'
    );

    -- Restore pre-Stage-2 valuation layer allocation type check
    ALTER TABLE scm_valuation_layer_allocations
      DROP CONSTRAINT IF EXISTS scm_val_layer_alloc_type_check;
    ALTER TABLE scm_valuation_layer_allocations
      ADD CONSTRAINT scm_val_layer_alloc_type_check
        CHECK (allocation_type IN ('consume', 'return_to_vendor', 'receipt_reversal', 'restore'));

    -- Restore Stage 1 movement type check (without replacement_in, disposal_out)
    ALTER TABLE scm_advanced_stock_movements
      DROP CONSTRAINT IF EXISTS scm_adv_movements_type_check;
    ALTER TABLE scm_advanced_stock_movements
      ADD CONSTRAINT scm_adv_movements_type_check
        CHECK (movement_type IN (
          'in', 'out', 'transfer_in', 'transfer_out', 'adjustment_in', 'adjustment_out', 'opname_in', 'opname_out',
          'inspection_hold_in', 'inspection_hold_out', 'inspection_release_in', 'inspection_release_out',
          'return_to_vendor_out', 'receipt_reversal_out', 'receipt_reversal_in', 'consignment_in', 'consignment_out'
        ));

    -- Drop warehouse task tables
    DROP TABLE IF EXISTS scm_warehouse_task_items;
    DROP TABLE IF EXISTS scm_warehouse_tasks;

    -- Drop disposal tables
    DROP TABLE IF EXISTS scm_inventory_disposal_lines;
    DROP TABLE IF EXISTS scm_inventory_disposals;

    -- Drop consignment settlement tables
    DROP TABLE IF EXISTS scm_consignment_settlement_lines;
    DROP TABLE IF EXISTS scm_consignment_settlements;

    -- Drop service acceptance tables (trigger first)
    DROP TRIGGER IF EXISTS trg_scm_service_acceptance_immutable ON scm_service_acceptances;
    DROP FUNCTION IF EXISTS scm_reject_approved_service_acceptance_changes;
    DROP TABLE IF EXISTS scm_service_acceptance_lines;
    DROP TABLE IF EXISTS scm_service_acceptances;

    -- Drop replacement delivery tables
    DROP TABLE IF EXISTS scm_replacement_delivery_lines;
    DROP TABLE IF EXISTS scm_replacement_deliveries;
  `);
};
