/**
 * Wave A5.1 Stage 1 — SCM accounting readiness, receiving, return, and reversal.
 *
 * Controlled Full scope, unweighted. This migration keeps Supply Chain on the
 * operational side of the SCM–Finance boundary (ADR-0023): SCM owns immutable
 * stock custody/valuation facts and accounting-ready business events; Finance
 * remains the owner of journal posting, account determination, GR/IR, AP, tax,
 * settlement, fiscal periods, and financial statements.
 */
exports.up = (pgm) => {
  pgm.sql(`
    -- Purchase order lines become tenant-safe parents for Stage 1 receiving
    -- records. Existing rows are backfilled from their purchase order header;
    -- runtime inserts are updated in the Stage 1 repository implementation.
    ALTER TABLE purchase_order_lines ADD COLUMN tenant_id UUID;
    UPDATE purchase_order_lines pol
       SET tenant_id = po.tenant_id
      FROM purchase_orders po
     WHERE po.id = pol.purchase_order_id;
    ALTER TABLE purchase_order_lines ALTER COLUMN tenant_id SET NOT NULL;
    ALTER TABLE purchase_order_lines
      ADD CONSTRAINT purchase_order_lines_tenant_id_id_unique UNIQUE (tenant_id, id),
      ADD CONSTRAINT purchase_order_lines_tenant_order_fk
        FOREIGN KEY (tenant_id, purchase_order_id)
        REFERENCES purchase_orders(tenant_id, id) ON DELETE CASCADE,
      ADD CONSTRAINT purchase_order_lines_tenant_item_fk
        FOREIGN KEY (tenant_id, item_id)
        REFERENCES items(tenant_id, id) ON DELETE RESTRICT;
    CREATE INDEX idx_purchase_order_lines_tenant_order
      ON purchase_order_lines (tenant_id, purchase_order_id);

    -- Existing Advanced balances become condition- and ownership-aware. Existing
    -- rows are unrestricted own stock, preserving Wave A5 behavior while allowing
    -- inspection quarantine and consignment custody in later A5.1 stages.
    ALTER TABLE scm_advanced_stock_balances
      ADD COLUMN stock_condition TEXT NOT NULL DEFAULT 'unrestricted',
      ADD COLUMN owner_type      TEXT NOT NULL DEFAULT 'own',
      ADD COLUMN owner_party_id  UUID,
      ADD COLUMN condition_since TIMESTAMPTZ NOT NULL DEFAULT now();

    ALTER TABLE scm_advanced_stock_balances
      ADD CONSTRAINT scm_adv_stock_balances_condition_check
        CHECK (stock_condition IN ('unrestricted', 'quality_hold', 'rejected', 'quarantined', 'blocked', 'in_transit', 'in_repair')),
      ADD CONSTRAINT scm_adv_stock_balances_owner_type_check
        CHECK (owner_type IN ('own', 'supplier', 'customer')),
      ADD CONSTRAINT scm_adv_stock_balances_owner_party_check
        CHECK ((owner_type = 'own' AND owner_party_id IS NULL) OR (owner_type <> 'own' AND owner_party_id IS NOT NULL)),
      ADD CONSTRAINT scm_adv_stock_balances_reserved_available_check
        CHECK (reserved_qty = 0 OR (stock_condition = 'unrestricted' AND owner_type = 'own'));

    CREATE UNIQUE INDEX uq_scm_adv_balances_condition_owner_key
      ON scm_advanced_stock_balances (
        tenant_id,
        item_id,
        warehouse_id,
        location_id,
        batch_id,
        stock_condition,
        owner_type,
        owner_party_id
      ) NULLS NOT DISTINCT;

    DROP INDEX IF EXISTS uq_scm_adv_balances_full;
    DROP INDEX IF EXISTS uq_scm_adv_balances_loc_only;
    DROP INDEX IF EXISTS uq_scm_adv_balances_batch_only;
    DROP INDEX IF EXISTS uq_scm_adv_balances_wh_only;

    CREATE INDEX idx_scm_adv_balances_available
      ON scm_advanced_stock_balances (tenant_id, item_id, warehouse_id)
      WHERE stock_condition = 'unrestricted' AND owner_type = 'own';
    CREATE INDEX idx_scm_adv_balances_condition_owner
      ON scm_advanced_stock_balances (tenant_id, warehouse_id, stock_condition, owner_type);

    ALTER TABLE scm_advanced_stock_movements
      ADD COLUMN stock_condition             TEXT NOT NULL DEFAULT 'unrestricted',
      ADD COLUMN owner_type                  TEXT NOT NULL DEFAULT 'own',
      ADD COLUMN owner_party_id              UUID,
      ADD COLUMN reversed_movement_id        UUID,
      ADD COLUMN accounting_ready_event_id   UUID;

    ALTER TABLE scm_advanced_stock_movements
      DROP CONSTRAINT IF EXISTS scm_adv_movements_type_check;
    ALTER TABLE scm_advanced_stock_movements
      ADD CONSTRAINT scm_adv_movements_type_check
        CHECK (movement_type IN (
          'in', 'out', 'transfer_in', 'transfer_out', 'adjustment_in', 'adjustment_out', 'opname_in', 'opname_out',
          'inspection_hold_in', 'inspection_hold_out', 'inspection_release_in', 'inspection_release_out',
          'return_to_vendor_out', 'receipt_reversal_out', 'receipt_reversal_in', 'consignment_in', 'consignment_out'
        )),
      ADD CONSTRAINT scm_adv_movements_condition_check
        CHECK (stock_condition IN ('unrestricted', 'quality_hold', 'rejected', 'quarantined', 'blocked', 'in_transit', 'in_repair')),
      ADD CONSTRAINT scm_adv_movements_owner_type_check
        CHECK (owner_type IN ('own', 'supplier', 'customer')),
      ADD CONSTRAINT scm_adv_movements_owner_party_check
        CHECK ((owner_type = 'own' AND owner_party_id IS NULL) OR (owner_type <> 'own' AND owner_party_id IS NOT NULL)),
      ADD CONSTRAINT scm_adv_movements_no_self_reversal_check
        CHECK (reversed_movement_id IS NULL OR reversed_movement_id <> id),
      ADD CONSTRAINT scm_adv_movements_reversed_fk
        FOREIGN KEY (tenant_id, reversed_movement_id)
        REFERENCES scm_advanced_stock_movements(tenant_id, id) ON DELETE RESTRICT;

    CREATE INDEX idx_scm_adv_movements_condition_owner
      ON scm_advanced_stock_movements (tenant_id, warehouse_id, stock_condition, owner_type, occurred_at DESC);
    CREATE INDEX idx_scm_adv_movements_reversed
      ON scm_advanced_stock_movements (tenant_id, reversed_movement_id);

    CREATE OR REPLACE FUNCTION scm_reject_stock_movement_update_delete()
    RETURNS trigger AS $$
    BEGIN
      RAISE EXCEPTION 'SCM advanced stock movements are immutable; record a compensating movement instead';
    END;
    $$ LANGUAGE plpgsql;

    CREATE TRIGGER trg_scm_adv_movements_immutable
      BEFORE UPDATE OR DELETE ON scm_advanced_stock_movements
      FOR EACH ROW EXECUTE FUNCTION scm_reject_stock_movement_update_delete();

    -- Procurement account-assignment policy. SCM validates and freezes the
    -- dimensions carried by procurement/receipt/service documents; it does not
    -- resolve accounts or create accounting postings.
    CREATE TABLE scm_account_assignment_configs (
      id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id             UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      assignment_type       TEXT        NOT NULL,
      required_dimensions   JSONB       NOT NULL DEFAULT '[]'::jsonb,
      inventory_relevant    BOOLEAN     NOT NULL DEFAULT false,
      is_active             BOOLEAN     NOT NULL DEFAULT true,
      created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
      created_by            UUID,
      updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_by            UUID,

      FOREIGN KEY (tenant_id, created_by)
        REFERENCES users(tenant_id, id) ON DELETE SET NULL (created_by),
      FOREIGN KEY (tenant_id, updated_by)
        REFERENCES users(tenant_id, id) ON DELETE SET NULL (updated_by),
      CONSTRAINT scm_account_assignment_type_check
        CHECK (assignment_type IN ('stock', 'expense', 'asset', 'project', 'work_order', 'service')),
      CONSTRAINT scm_account_assignment_dims_array_check
        CHECK (jsonb_typeof(required_dimensions) = 'array'),
      UNIQUE (tenant_id, assignment_type)
    );

    ALTER TABLE scm_account_assignment_configs
      ADD CONSTRAINT scm_account_assignment_configs_tenant_id_id_unique UNIQUE (tenant_id, id);

    CREATE INDEX idx_scm_account_assignment_configs_active
      ON scm_account_assignment_configs (tenant_id, is_active);

    CREATE OR REPLACE FUNCTION scm_seed_account_assignment_configs_for_tenant()
    RETURNS trigger AS $$
    BEGIN
      INSERT INTO scm_account_assignment_configs (tenant_id, assignment_type, required_dimensions, inventory_relevant)
      SELECT NEW.id, v.assignment_type, v.required_dimensions::jsonb, v.inventory_relevant
        FROM (VALUES
          ('stock',      '["organizationUnitId", "warehouseId"]', true),
          ('expense',    '["organizationUnitId", "costCenterId"]', false),
          ('asset',      '["organizationUnitId", "assetId"]', false),
          ('project',    '["organizationUnitId", "projectId"]', false),
          ('work_order', '["organizationUnitId", "workOrderId"]', false),
          ('service',    '["organizationUnitId", "costCenterId"]', false)
        ) AS v(assignment_type, required_dimensions, inventory_relevant)
      ON CONFLICT (tenant_id, assignment_type) DO NOTHING;
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;

    CREATE TRIGGER trg_scm_seed_account_assignment_configs
      AFTER INSERT ON tenants
      FOR EACH ROW EXECUTE FUNCTION scm_seed_account_assignment_configs_for_tenant();

    INSERT INTO scm_account_assignment_configs (tenant_id, assignment_type, required_dimensions, inventory_relevant)
    SELECT t.id, v.assignment_type, v.required_dimensions::jsonb, v.inventory_relevant
      FROM tenants t
      CROSS JOIN (VALUES
        ('stock',      '["organizationUnitId", "warehouseId"]', true),
        ('expense',    '["organizationUnitId", "costCenterId"]', false),
        ('asset',      '["organizationUnitId", "assetId"]', false),
        ('project',    '["organizationUnitId", "projectId"]', false),
        ('work_order', '["organizationUnitId", "workOrderId"]', false),
        ('service',    '["organizationUnitId", "costCenterId"]', false)
      ) AS v(assignment_type, required_dimensions, inventory_relevant)
    ON CONFLICT (tenant_id, assignment_type) DO NOTHING;

    ALTER TABLE purchase_order_lines
      ADD COLUMN account_assignment_type       TEXT NOT NULL DEFAULT 'stock',
      ADD COLUMN account_assignment_dimensions JSONB NOT NULL DEFAULT '{}'::jsonb,
      ADD COLUMN account_assignment_frozen_at  TIMESTAMPTZ,
      ADD COLUMN account_assignment_frozen_by  UUID;

    ALTER TABLE purchase_order_lines
      ADD CONSTRAINT purchase_order_lines_account_assignment_type_check
        CHECK (account_assignment_type IN ('stock', 'expense', 'asset', 'project', 'work_order', 'service')),
      ADD CONSTRAINT purchase_order_lines_assignment_dims_object_check
        CHECK (jsonb_typeof(account_assignment_dimensions) = 'object'),
      ADD CONSTRAINT purchase_order_lines_assignment_frozen_by_fk
        FOREIGN KEY (tenant_id, account_assignment_frozen_by)
        REFERENCES users(tenant_id, id) ON DELETE SET NULL (account_assignment_frozen_by);

    CREATE INDEX idx_po_lines_account_assignment_type
      ON purchase_order_lines (tenant_id, account_assignment_type);

    CREATE OR REPLACE FUNCTION scm_reject_frozen_po_line_assignment_changes()
    RETURNS trigger AS $$
    BEGIN
      IF OLD.account_assignment_frozen_at IS NOT NULL AND (
        OLD.account_assignment_type IS DISTINCT FROM NEW.account_assignment_type OR
        OLD.account_assignment_dimensions IS DISTINCT FROM NEW.account_assignment_dimensions OR
        OLD.account_assignment_frozen_at IS DISTINCT FROM NEW.account_assignment_frozen_at OR
        OLD.account_assignment_frozen_by IS DISTINCT FROM NEW.account_assignment_frozen_by
      ) THEN
        RAISE EXCEPTION 'Frozen purchase order account assignment cannot be edited; create a governed revision instead';
      END IF;
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;

    CREATE TRIGGER trg_scm_po_line_assignment_freeze
      BEFORE UPDATE ON purchase_order_lines
      FOR EACH ROW EXECUTE FUNCTION scm_reject_frozen_po_line_assignment_changes();

    CREATE TABLE scm_receiving_records (
      id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id             UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      receipt_number        TEXT        NOT NULL,
      idempotency_key       TEXT        NOT NULL,
      purchase_order_id     UUID        NOT NULL,
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

      FOREIGN KEY (tenant_id, purchase_order_id)
        REFERENCES purchase_orders(tenant_id, id) ON DELETE RESTRICT,
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
      CONSTRAINT scm_receiving_records_status_check
        CHECK (status IN ('received', 'partially_inspected', 'accepted', 'rejected', 'reversed')),
      UNIQUE (tenant_id, receipt_number),
      UNIQUE (tenant_id, idempotency_key)
    );

    ALTER TABLE scm_receiving_records
      ADD CONSTRAINT scm_receiving_records_tenant_id_id_unique UNIQUE (tenant_id, id);
    CREATE INDEX idx_scm_receiving_records_po
      ON scm_receiving_records (tenant_id, purchase_order_id, received_at DESC);
    CREATE INDEX idx_scm_receiving_records_wh_status
      ON scm_receiving_records (tenant_id, warehouse_id, status);

    CREATE TABLE scm_receiving_lines (
      id                              UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id                       UUID          NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      receiving_record_id             UUID          NOT NULL,
      purchase_order_line_id          UUID          NOT NULL,
      item_id                         UUID          NOT NULL,
      warehouse_id                    UUID          NOT NULL,
      location_id                     UUID,
      batch_id                        UUID,
      stock_condition                 TEXT          NOT NULL DEFAULT 'quality_hold',
      owner_type                      TEXT          NOT NULL DEFAULT 'own',
      owner_party_id                  UUID,
      quantity_received               NUMERIC(18,4) NOT NULL,
      quantity_accepted               NUMERIC(18,4) NOT NULL DEFAULT 0,
      quantity_rejected               NUMERIC(18,4) NOT NULL DEFAULT 0,
      quantity_quarantined            NUMERIC(18,4) NOT NULL DEFAULT 0,
      quantity_returned               NUMERIC(18,4) NOT NULL DEFAULT 0,
      quantity_reversed               NUMERIC(18,4) NOT NULL DEFAULT 0,
      unit_cost                       NUMERIC(18,4),
      currency                        TEXT          NOT NULL DEFAULT 'IDR',
      account_assignment_type         TEXT          NOT NULL,
      account_assignment_dimensions   JSONB         NOT NULL DEFAULT '{}'::jsonb,
      frozen_account_assignment_at    TIMESTAMPTZ   NOT NULL DEFAULT now(),
      inspection_required             BOOLEAN       NOT NULL DEFAULT true,
      hold_movement_id                UUID,
      acceptance_movement_id          UUID,
      valuation_layer_id              UUID,
      notes                           TEXT,
      sort_order                      INTEGER       NOT NULL DEFAULT 0,

      FOREIGN KEY (tenant_id, receiving_record_id)
        REFERENCES scm_receiving_records(tenant_id, id) ON DELETE CASCADE,
      FOREIGN KEY (tenant_id, purchase_order_line_id)
        REFERENCES purchase_order_lines(tenant_id, id) ON DELETE RESTRICT,
      FOREIGN KEY (tenant_id, item_id)
        REFERENCES items(tenant_id, id) ON DELETE RESTRICT,
      FOREIGN KEY (tenant_id, warehouse_id)
        REFERENCES scm_warehouses(tenant_id, id) ON DELETE RESTRICT,
      FOREIGN KEY (tenant_id, location_id)
        REFERENCES scm_warehouse_locations(tenant_id, id) ON DELETE RESTRICT,
      FOREIGN KEY (tenant_id, batch_id)
        REFERENCES scm_item_batches(tenant_id, id) ON DELETE RESTRICT,
      FOREIGN KEY (tenant_id, hold_movement_id)
        REFERENCES scm_advanced_stock_movements(tenant_id, id) ON DELETE SET NULL (hold_movement_id),
      FOREIGN KEY (tenant_id, acceptance_movement_id)
        REFERENCES scm_advanced_stock_movements(tenant_id, id) ON DELETE SET NULL (acceptance_movement_id),
      FOREIGN KEY (tenant_id, valuation_layer_id)
        REFERENCES scm_valuation_layers(tenant_id, id) ON DELETE SET NULL (valuation_layer_id),
      CONSTRAINT scm_receiving_lines_condition_check
        CHECK (stock_condition IN ('quality_hold', 'rejected', 'quarantined', 'blocked')),
      CONSTRAINT scm_receiving_lines_owner_type_check
        CHECK (owner_type IN ('own', 'supplier', 'customer')),
      CONSTRAINT scm_receiving_lines_owner_party_check
        CHECK ((owner_type = 'own' AND owner_party_id IS NULL) OR (owner_type <> 'own' AND owner_party_id IS NOT NULL)),
      CONSTRAINT scm_receiving_lines_assignment_type_check
        CHECK (account_assignment_type IN ('stock', 'expense', 'asset', 'project', 'work_order', 'service')),
      CONSTRAINT scm_receiving_lines_assignment_dims_object_check
        CHECK (jsonb_typeof(account_assignment_dimensions) = 'object'),
      CONSTRAINT scm_receiving_lines_qty_received_check CHECK (quantity_received > 0),
      CONSTRAINT scm_receiving_lines_qty_accept_check CHECK (quantity_accepted >= 0),
      CONSTRAINT scm_receiving_lines_qty_reject_check CHECK (quantity_rejected >= 0),
      CONSTRAINT scm_receiving_lines_qty_quarantine_check CHECK (quantity_quarantined >= 0),
      CONSTRAINT scm_receiving_lines_qty_returned_check CHECK (quantity_returned >= 0),
      CONSTRAINT scm_receiving_lines_qty_reversed_check CHECK (quantity_reversed >= 0),
      CONSTRAINT scm_receiving_lines_unit_cost_check CHECK (unit_cost IS NULL OR unit_cost >= 0),
      CONSTRAINT scm_receiving_lines_qty_total_check
        CHECK (quantity_accepted + quantity_rejected + quantity_quarantined <= quantity_received),
      CONSTRAINT scm_receiving_lines_returned_limit_check
        CHECK (quantity_returned <= quantity_accepted + quantity_rejected + quantity_quarantined),
      CONSTRAINT scm_receiving_lines_reversed_limit_check
        CHECK (quantity_reversed <= quantity_received)
    );

    ALTER TABLE scm_receiving_lines
      ADD CONSTRAINT scm_receiving_lines_tenant_id_id_unique UNIQUE (tenant_id, id);
    CREATE INDEX idx_scm_receiving_lines_receipt
      ON scm_receiving_lines (tenant_id, receiving_record_id);
    CREATE INDEX idx_scm_receiving_lines_po_line
      ON scm_receiving_lines (tenant_id, purchase_order_line_id);
    CREATE INDEX idx_scm_receiving_lines_item
      ON scm_receiving_lines (tenant_id, item_id, warehouse_id);

    ALTER TABLE scm_valuation_layers
      ADD COLUMN receiving_line_id     UUID,
      ADD COLUMN source_inspection_id  UUID,
      ADD COLUMN stock_condition       TEXT NOT NULL DEFAULT 'unrestricted',
      ADD COLUMN owner_type            TEXT NOT NULL DEFAULT 'own',
      ADD COLUMN owner_party_id        UUID,
      ADD COLUMN layer_status          TEXT NOT NULL DEFAULT 'open';

    ALTER TABLE scm_valuation_layers
      ADD CONSTRAINT scm_valuation_layers_receiving_line_fk
        FOREIGN KEY (tenant_id, receiving_line_id)
        REFERENCES scm_receiving_lines(tenant_id, id) ON DELETE SET NULL (receiving_line_id),
      ADD CONSTRAINT scm_valuation_layers_stock_condition_check
        CHECK (stock_condition IN ('unrestricted', 'quality_hold', 'rejected', 'quarantined', 'blocked', 'in_transit', 'in_repair')),
      ADD CONSTRAINT scm_valuation_layers_owner_type_check
        CHECK (owner_type IN ('own', 'supplier', 'customer')),
      ADD CONSTRAINT scm_valuation_layers_owner_party_check
        CHECK ((owner_type = 'own' AND owner_party_id IS NULL) OR (owner_type <> 'own' AND owner_party_id IS NOT NULL)),
      ADD CONSTRAINT scm_valuation_layers_status_check
        CHECK (layer_status IN ('open', 'consumed', 'reversed', 'closed'));

    CREATE INDEX idx_scm_val_layers_receiving_line
      ON scm_valuation_layers (tenant_id, receiving_line_id);
    CREATE INDEX idx_scm_val_layers_condition_owner
      ON scm_valuation_layers (tenant_id, item_id, stock_condition, owner_type, received_date ASC)
      WHERE remaining_quantity > 0;

    CREATE TABLE scm_inspections (
      id                    UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id             UUID          NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      receiving_line_id     UUID          NOT NULL,
      inspection_number     TEXT          NOT NULL,
      idempotency_key       TEXT          NOT NULL,
      inspected_at          TIMESTAMPTZ   NOT NULL DEFAULT now(),
      inspected_by          UUID,
      quantity_accepted     NUMERIC(18,4) NOT NULL DEFAULT 0,
      quantity_rejected     NUMERIC(18,4) NOT NULL DEFAULT 0,
      quantity_quarantined  NUMERIC(18,4) NOT NULL DEFAULT 0,
      result                TEXT          NOT NULL,
      reason                TEXT,
      created_at            TIMESTAMPTZ   NOT NULL DEFAULT now(),
      created_by            UUID,

      FOREIGN KEY (tenant_id, receiving_line_id)
        REFERENCES scm_receiving_lines(tenant_id, id) ON DELETE RESTRICT,
      FOREIGN KEY (tenant_id, inspected_by)
        REFERENCES users(tenant_id, id) ON DELETE SET NULL (inspected_by),
      FOREIGN KEY (tenant_id, created_by)
        REFERENCES users(tenant_id, id) ON DELETE SET NULL (created_by),
      CONSTRAINT scm_inspections_result_check CHECK (result IN ('accepted', 'rejected', 'mixed', 'quarantined')),
      CONSTRAINT scm_inspections_qty_accept_check CHECK (quantity_accepted >= 0),
      CONSTRAINT scm_inspections_qty_reject_check CHECK (quantity_rejected >= 0),
      CONSTRAINT scm_inspections_qty_quarantine_check CHECK (quantity_quarantined >= 0),
      CONSTRAINT scm_inspections_positive_total_check
        CHECK (quantity_accepted + quantity_rejected + quantity_quarantined > 0),
      UNIQUE (tenant_id, inspection_number),
      UNIQUE (tenant_id, idempotency_key),
      UNIQUE (tenant_id, receiving_line_id)
    );

    ALTER TABLE scm_inspections
      ADD CONSTRAINT scm_inspections_tenant_id_id_unique UNIQUE (tenant_id, id);
    ALTER TABLE scm_valuation_layers
      ADD CONSTRAINT scm_valuation_layers_source_inspection_fk
        FOREIGN KEY (tenant_id, source_inspection_id)
        REFERENCES scm_inspections(tenant_id, id) ON DELETE SET NULL (source_inspection_id);
    CREATE INDEX idx_scm_inspections_receiving_line
      ON scm_inspections (tenant_id, receiving_line_id, inspected_at DESC);

    CREATE TABLE scm_discrepancy_records (
      id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id             UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      receiving_line_id     UUID        NOT NULL,
      discrepancy_type      TEXT        NOT NULL,
      quantity              NUMERIC(18,4),
      description           TEXT        NOT NULL,
      status                TEXT        NOT NULL DEFAULT 'open',
      resolved_at           TIMESTAMPTZ,
      resolved_by           UUID,
      resolution_notes      TEXT,
      created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
      created_by            UUID,

      FOREIGN KEY (tenant_id, receiving_line_id)
        REFERENCES scm_receiving_lines(tenant_id, id) ON DELETE RESTRICT,
      FOREIGN KEY (tenant_id, resolved_by)
        REFERENCES users(tenant_id, id) ON DELETE SET NULL (resolved_by),
      FOREIGN KEY (tenant_id, created_by)
        REFERENCES users(tenant_id, id) ON DELETE SET NULL (created_by),
      CONSTRAINT scm_discrepancies_type_check
        CHECK (discrepancy_type IN ('shortage', 'overage', 'damage', 'quality', 'document')),
      CONSTRAINT scm_discrepancies_status_check CHECK (status IN ('open', 'resolved', 'cancelled')),
      CONSTRAINT scm_discrepancies_qty_check CHECK (quantity IS NULL OR quantity >= 0)
    );

    ALTER TABLE scm_discrepancy_records
      ADD CONSTRAINT scm_discrepancy_records_tenant_id_id_unique UNIQUE (tenant_id, id);
    CREATE INDEX idx_scm_discrepancies_receiving_line
      ON scm_discrepancy_records (tenant_id, receiving_line_id, status);

    CREATE TABLE scm_accounting_ready_events (
      id                            UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id                     UUID          NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      event_type                    TEXT          NOT NULL,
      source_document_type          TEXT          NOT NULL,
      source_document_id            UUID          NOT NULL,
      source_document_line_id       UUID,
      source_movement_id            UUID,
      source_document_revision      INTEGER       NOT NULL DEFAULT 1,
      effective_at                  TIMESTAMPTZ   NOT NULL DEFAULT now(),
      currency                      TEXT          NOT NULL DEFAULT 'IDR',
      amount                        NUMERIC(18,4) NOT NULL DEFAULT 0,
      quantity                      NUMERIC(18,4),
      unit_cost                     NUMERIC(18,4),
      account_assignment_type       TEXT,
      account_assignment_dimensions JSONB         NOT NULL DEFAULT '{}'::jsonb,
      idempotency_key               TEXT          NOT NULL,
      reversal_of_event_id          UUID,
      outbox_state                  TEXT          NOT NULL DEFAULT 'pending',
      reconciliation_state          TEXT          NOT NULL DEFAULT 'unmatched',
      payload                       JSONB         NOT NULL DEFAULT '{}'::jsonb,
      created_at                    TIMESTAMPTZ   NOT NULL DEFAULT now(),
      created_by                    UUID,

      CONSTRAINT scm_accounting_ready_events_tenant_id_id_unique UNIQUE (tenant_id, id),
      FOREIGN KEY (tenant_id, source_movement_id)
        REFERENCES scm_advanced_stock_movements(tenant_id, id) ON DELETE SET NULL (source_movement_id) DEFERRABLE INITIALLY DEFERRED,
      FOREIGN KEY (tenant_id, reversal_of_event_id)
        REFERENCES scm_accounting_ready_events(tenant_id, id) ON DELETE RESTRICT,
      FOREIGN KEY (tenant_id, created_by)
        REFERENCES users(tenant_id, id) ON DELETE SET NULL (created_by),
      CONSTRAINT scm_accounting_events_type_check
        CHECK (event_type IN (
          'inventory.goods_received', 'inventory.goods_issued', 'inventory.transferred', 'inventory.adjusted',
          'inventory.returned_to_vendor', 'inventory.receipt_reversed', 'inventory.landed_cost_applied',
          'inventory.consignment_consumed', 'service.accepted', 'inventory.disposed'
        )),
      CONSTRAINT scm_accounting_events_assignment_type_check
        CHECK (account_assignment_type IS NULL OR account_assignment_type IN ('stock', 'expense', 'asset', 'project', 'work_order', 'service')),
      CONSTRAINT scm_accounting_events_dims_object_check CHECK (jsonb_typeof(account_assignment_dimensions) = 'object'),
      CONSTRAINT scm_accounting_events_revision_check CHECK (source_document_revision > 0),
      CONSTRAINT scm_accounting_events_amount_check CHECK (amount >= 0),
      CONSTRAINT scm_accounting_events_quantity_check CHECK (quantity IS NULL OR quantity >= 0),
      CONSTRAINT scm_accounting_events_unit_cost_check CHECK (unit_cost IS NULL OR unit_cost >= 0),
      CONSTRAINT scm_accounting_events_state_check CHECK (outbox_state IN ('pending', 'published', 'failed', 'suppressed')),
      CONSTRAINT scm_accounting_events_recon_state_check CHECK (reconciliation_state IN ('unmatched', 'matched', 'reversed', 'ignored')),
      UNIQUE (tenant_id, idempotency_key)
    );

    ALTER TABLE scm_advanced_stock_movements
      ADD CONSTRAINT scm_adv_movements_accounting_event_fk
        FOREIGN KEY (tenant_id, accounting_ready_event_id)
        REFERENCES scm_accounting_ready_events(tenant_id, id) ON DELETE SET NULL (accounting_ready_event_id) DEFERRABLE INITIALLY DEFERRED;

    CREATE TABLE scm_accounting_ready_event_state_transitions (
      id                 UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id          UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      accounting_event_id UUID       NOT NULL,
      state_kind         TEXT        NOT NULL,
      from_state         TEXT,
      to_state           TEXT        NOT NULL,
      reason             TEXT,
      occurred_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
      occurred_by        UUID,

      FOREIGN KEY (tenant_id, accounting_event_id)
        REFERENCES scm_accounting_ready_events(tenant_id, id) ON DELETE CASCADE,
      FOREIGN KEY (tenant_id, occurred_by)
        REFERENCES users(tenant_id, id) ON DELETE SET NULL (occurred_by),
      CONSTRAINT scm_accounting_event_state_kind_check CHECK (state_kind IN ('outbox', 'reconciliation'))
    );

    ALTER TABLE scm_accounting_ready_event_state_transitions
      ADD CONSTRAINT scm_accounting_ready_event_state_transitions_tenant_id_id_unique UNIQUE (tenant_id, id);
    CREATE INDEX idx_scm_accounting_event_state_transitions_event
      ON scm_accounting_ready_event_state_transitions (tenant_id, accounting_event_id, occurred_at DESC);

    CREATE OR REPLACE FUNCTION scm_reject_accounting_ready_event_fact_changes()
    RETURNS trigger AS $$
    BEGIN
      IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'SCM accounting-ready events are immutable; record a compensating event instead';
      END IF;

      IF OLD.event_type IS DISTINCT FROM NEW.event_type
        OR OLD.source_document_type IS DISTINCT FROM NEW.source_document_type
        OR OLD.source_document_id IS DISTINCT FROM NEW.source_document_id
        OR OLD.source_document_line_id IS DISTINCT FROM NEW.source_document_line_id
        OR OLD.source_movement_id IS DISTINCT FROM NEW.source_movement_id
        OR OLD.source_document_revision IS DISTINCT FROM NEW.source_document_revision
        OR OLD.effective_at IS DISTINCT FROM NEW.effective_at
        OR OLD.currency IS DISTINCT FROM NEW.currency
        OR OLD.amount IS DISTINCT FROM NEW.amount
        OR OLD.quantity IS DISTINCT FROM NEW.quantity
        OR OLD.unit_cost IS DISTINCT FROM NEW.unit_cost
        OR OLD.account_assignment_type IS DISTINCT FROM NEW.account_assignment_type
        OR OLD.account_assignment_dimensions IS DISTINCT FROM NEW.account_assignment_dimensions
        OR OLD.idempotency_key IS DISTINCT FROM NEW.idempotency_key
        OR OLD.reversal_of_event_id IS DISTINCT FROM NEW.reversal_of_event_id
        OR OLD.payload IS DISTINCT FROM NEW.payload
        OR OLD.created_at IS DISTINCT FROM NEW.created_at
        OR OLD.created_by IS DISTINCT FROM NEW.created_by THEN
        RAISE EXCEPTION 'SCM accounting-ready event facts are immutable; only delivery/reconciliation state may change';
      END IF;

      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;

    CREATE TRIGGER trg_scm_accounting_ready_events_immutable_facts
      BEFORE UPDATE OR DELETE ON scm_accounting_ready_events
      FOR EACH ROW EXECUTE FUNCTION scm_reject_accounting_ready_event_fact_changes();

    CREATE INDEX idx_scm_accounting_events_source
      ON scm_accounting_ready_events (tenant_id, source_document_type, source_document_id);
    CREATE INDEX idx_scm_accounting_events_state
      ON scm_accounting_ready_events (tenant_id, outbox_state, created_at);
    CREATE INDEX idx_scm_accounting_events_recon_state
      ON scm_accounting_ready_events (tenant_id, reconciliation_state, created_at);

    CREATE TABLE scm_return_to_vendors (
      id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id             UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      return_number         TEXT        NOT NULL,
      idempotency_key       TEXT        NOT NULL,
      supplier_id           UUID        NOT NULL,
      purchase_order_id     UUID,
      warehouse_id          UUID        NOT NULL,
      returned_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
      returned_by           UUID,
      reason                TEXT        NOT NULL,
      status                TEXT        NOT NULL DEFAULT 'executed',
      notes                 TEXT,
      created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
      created_by            UUID,

      FOREIGN KEY (tenant_id, supplier_id)
        REFERENCES suppliers(tenant_id, id) ON DELETE RESTRICT,
      FOREIGN KEY (tenant_id, purchase_order_id)
        REFERENCES purchase_orders(tenant_id, id) ON DELETE SET NULL (purchase_order_id),
      FOREIGN KEY (tenant_id, warehouse_id)
        REFERENCES scm_warehouses(tenant_id, id) ON DELETE RESTRICT,
      FOREIGN KEY (tenant_id, returned_by)
        REFERENCES users(tenant_id, id) ON DELETE SET NULL (returned_by),
      FOREIGN KEY (tenant_id, created_by)
        REFERENCES users(tenant_id, id) ON DELETE SET NULL (created_by),
      CONSTRAINT scm_rtv_status_check CHECK (status IN ('executed', 'cancelled')),
      UNIQUE (tenant_id, return_number),
      UNIQUE (tenant_id, idempotency_key)
    );

    ALTER TABLE scm_return_to_vendors
      ADD CONSTRAINT scm_return_to_vendors_tenant_id_id_unique UNIQUE (tenant_id, id);
    CREATE INDEX idx_scm_rtv_supplier
      ON scm_return_to_vendors (tenant_id, supplier_id, returned_at DESC);

    CREATE TABLE scm_return_to_vendor_lines (
      id                        UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id                 UUID          NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      return_to_vendor_id       UUID          NOT NULL,
      receiving_line_id         UUID,
      item_id                   UUID          NOT NULL,
      warehouse_id              UUID          NOT NULL,
      location_id               UUID,
      batch_id                  UUID,
      stock_condition           TEXT          NOT NULL DEFAULT 'unrestricted',
      owner_type                TEXT          NOT NULL DEFAULT 'own',
      owner_party_id            UUID,
      quantity                  NUMERIC(18,4) NOT NULL,
      movement_id               UUID,
      accounting_ready_event_id UUID,
      notes                     TEXT,
      sort_order                INTEGER       NOT NULL DEFAULT 0,

      FOREIGN KEY (tenant_id, return_to_vendor_id)
        REFERENCES scm_return_to_vendors(tenant_id, id) ON DELETE CASCADE,
      FOREIGN KEY (tenant_id, receiving_line_id)
        REFERENCES scm_receiving_lines(tenant_id, id) ON DELETE SET NULL (receiving_line_id),
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
      CONSTRAINT scm_rtv_lines_condition_check
        CHECK (stock_condition IN ('unrestricted', 'quality_hold', 'rejected', 'quarantined', 'blocked', 'in_transit', 'in_repair')),
      CONSTRAINT scm_rtv_lines_owner_type_check
        CHECK (owner_type IN ('own', 'supplier', 'customer')),
      CONSTRAINT scm_rtv_lines_owner_party_check
        CHECK ((owner_type = 'own' AND owner_party_id IS NULL) OR (owner_type <> 'own' AND owner_party_id IS NOT NULL)),
      CONSTRAINT scm_rtv_lines_qty_check CHECK (quantity > 0)
    );

    ALTER TABLE scm_return_to_vendor_lines
      ADD CONSTRAINT scm_return_to_vendor_lines_tenant_id_id_unique UNIQUE (tenant_id, id);
    CREATE INDEX idx_scm_rtv_lines_return
      ON scm_return_to_vendor_lines (tenant_id, return_to_vendor_id);
    CREATE INDEX idx_scm_rtv_lines_receiving_line
      ON scm_return_to_vendor_lines (tenant_id, receiving_line_id);

    CREATE TABLE scm_receipt_reversals (
      id                      UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id               UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      reversal_number         TEXT        NOT NULL,
      idempotency_key         TEXT        NOT NULL,
      receiving_record_id     UUID        NOT NULL,
      reason                  TEXT        NOT NULL,
      reversed_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
      reversed_by             UUID,
      reversal_event_id       UUID,
      created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
      created_by              UUID,

      FOREIGN KEY (tenant_id, receiving_record_id)
        REFERENCES scm_receiving_records(tenant_id, id) ON DELETE RESTRICT,
      FOREIGN KEY (tenant_id, reversed_by)
        REFERENCES users(tenant_id, id) ON DELETE SET NULL (reversed_by),
      FOREIGN KEY (tenant_id, created_by)
        REFERENCES users(tenant_id, id) ON DELETE SET NULL (created_by),
      UNIQUE (tenant_id, reversal_number),
      UNIQUE (tenant_id, idempotency_key),
      UNIQUE (tenant_id, receiving_record_id)
    );

    ALTER TABLE scm_receipt_reversals
      ADD CONSTRAINT scm_receipt_reversals_tenant_id_id_unique UNIQUE (tenant_id, id);

    CREATE TABLE scm_receipt_reversal_lines (
      id                    UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id             UUID          NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      reversal_id           UUID          NOT NULL,
      receiving_line_id     UUID          NOT NULL,
      quantity              NUMERIC(18,4) NOT NULL,
      movement_id           UUID,
      restored_layer_id     UUID,
      sort_order            INTEGER       NOT NULL DEFAULT 0,

      FOREIGN KEY (tenant_id, reversal_id)
        REFERENCES scm_receipt_reversals(tenant_id, id) ON DELETE CASCADE,
      FOREIGN KEY (tenant_id, receiving_line_id)
        REFERENCES scm_receiving_lines(tenant_id, id) ON DELETE RESTRICT,
      FOREIGN KEY (tenant_id, movement_id)
        REFERENCES scm_advanced_stock_movements(tenant_id, id) ON DELETE SET NULL (movement_id),
      FOREIGN KEY (tenant_id, restored_layer_id)
        REFERENCES scm_valuation_layers(tenant_id, id) ON DELETE SET NULL (restored_layer_id),
      CONSTRAINT scm_receipt_reversal_lines_qty_check CHECK (quantity > 0),
      UNIQUE (tenant_id, reversal_id, receiving_line_id)
    );

    ALTER TABLE scm_receipt_reversal_lines
      ADD CONSTRAINT scm_receipt_reversal_lines_tenant_id_id_unique UNIQUE (tenant_id, id);

    ALTER TABLE scm_receipt_reversals
      ADD CONSTRAINT scm_receipt_reversals_event_fk
        FOREIGN KEY (tenant_id, reversal_event_id)
        REFERENCES scm_accounting_ready_events(tenant_id, id) ON DELETE SET NULL (reversal_event_id);

    CREATE TABLE scm_valuation_layer_allocations (
      id                       UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id                UUID          NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      valuation_layer_id       UUID          NOT NULL,
      movement_id              UUID          NOT NULL,
      allocation_type          TEXT          NOT NULL,
      quantity                 NUMERIC(18,4) NOT NULL,
      unit_cost                NUMERIC(18,4) NOT NULL,
      amount                   NUMERIC(18,4) NOT NULL,
      reverses_allocation_id   UUID,
      created_at               TIMESTAMPTZ   NOT NULL DEFAULT now(),
      created_by               UUID,

      CONSTRAINT scm_valuation_layer_allocations_tenant_id_id_unique UNIQUE (tenant_id, id),
      FOREIGN KEY (tenant_id, valuation_layer_id)
        REFERENCES scm_valuation_layers(tenant_id, id) ON DELETE RESTRICT,
      FOREIGN KEY (tenant_id, movement_id)
        REFERENCES scm_advanced_stock_movements(tenant_id, id) ON DELETE RESTRICT,
      FOREIGN KEY (tenant_id, reverses_allocation_id)
        REFERENCES scm_valuation_layer_allocations(tenant_id, id) ON DELETE RESTRICT,
      FOREIGN KEY (tenant_id, created_by)
        REFERENCES users(tenant_id, id) ON DELETE SET NULL (created_by),
      CONSTRAINT scm_val_layer_alloc_type_check
        CHECK (allocation_type IN ('consume', 'return_to_vendor', 'receipt_reversal', 'restore')),
      CONSTRAINT scm_val_layer_alloc_qty_check CHECK (quantity > 0),
      CONSTRAINT scm_val_layer_alloc_unit_cost_check CHECK (unit_cost >= 0),
      CONSTRAINT scm_val_layer_alloc_amount_check CHECK (amount >= 0)
    );

    CREATE INDEX idx_scm_val_layer_allocations_layer
      ON scm_valuation_layer_allocations (tenant_id, valuation_layer_id, created_at);
    CREATE INDEX idx_scm_val_layer_allocations_movement
      ON scm_valuation_layer_allocations (tenant_id, movement_id);

    INSERT INTO permissions (code, description) VALUES
      ('supply_chain.receiving.read',           'View receiving records, inspection decisions, and receiving discrepancies'),
      ('supply_chain.receiving.manage',         'Create inspection-gated receiving records without Finance posting'),
      ('supply_chain.receiving.inspect',        'Accept, reject, or quarantine received quantities'),
      ('supply_chain.receiving.reverse',        'Record governed receipt reversals through compensating movements'),
      ('supply_chain.return.read',              'View return-to-vendor records and compensating stock movements'),
      ('supply_chain.return.manage',            'Execute return-to-vendor operations for eligible received stock'),
      ('supply_chain.return.approve',           'Approve controlled return-to-vendor exceptions'),
      ('supply_chain.account_assignment.read',  'View SCM account-assignment validation policies and frozen procurement dimensions'),
      ('supply_chain.account_assignment.manage','Maintain SCM account-assignment validation policies without Finance account resolution'),
      ('supply_chain.accounting_event.read',    'View Supply Chain accounting-ready events and Finance posting unavailable states')
    ON CONFLICT (code) DO NOTHING;
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    DO $$
    BEGIN
      IF EXISTS (
        SELECT 1
          FROM scm_advanced_stock_movements
         WHERE movement_type NOT IN ('in', 'out', 'transfer_in', 'transfer_out', 'adjustment_in', 'adjustment_out', 'opname_in', 'opname_out')
      ) THEN
        RAISE EXCEPTION 'Cannot rollback Wave A5.1 Stage 1: A5.1 stock movement types exist';
      END IF;

      IF EXISTS (
        SELECT 1
          FROM scm_advanced_stock_balances
         WHERE stock_condition <> 'unrestricted'
            OR owner_type <> 'own'
            OR owner_party_id IS NOT NULL
      ) THEN
        RAISE EXCEPTION 'Cannot rollback Wave A5.1 Stage 1: non-default stock condition or ownership balances exist';
      END IF;

      IF EXISTS (
        SELECT 1
          FROM scm_advanced_stock_balances
         GROUP BY tenant_id, item_id, warehouse_id, location_id, batch_id
        HAVING COUNT(*) > 1
      ) THEN
        RAISE EXCEPTION 'Cannot rollback Wave A5.1 Stage 1: balances would collide under pre-A5.1 uniqueness';
      END IF;
    END $$;

    DELETE FROM permissions WHERE code IN (
      'supply_chain.receiving.read',
      'supply_chain.receiving.manage',
      'supply_chain.receiving.inspect',
      'supply_chain.receiving.reverse',
      'supply_chain.return.read',
      'supply_chain.return.manage',
      'supply_chain.return.approve',
      'supply_chain.account_assignment.read',
      'supply_chain.account_assignment.manage',
      'supply_chain.accounting_event.read'
    );

    ALTER TABLE scm_receipt_reversals DROP CONSTRAINT IF EXISTS scm_receipt_reversals_event_fk;
    ALTER TABLE scm_advanced_stock_movements DROP CONSTRAINT IF EXISTS scm_adv_movements_accounting_event_fk;
    DROP TRIGGER IF EXISTS trg_scm_accounting_ready_events_immutable_facts ON scm_accounting_ready_events;
    DROP FUNCTION IF EXISTS scm_reject_accounting_ready_event_fact_changes;

    DROP TABLE IF EXISTS scm_valuation_layer_allocations;
    DROP TABLE IF EXISTS scm_accounting_ready_event_state_transitions;
    DROP TABLE IF EXISTS scm_receipt_reversal_lines;
    DROP TABLE IF EXISTS scm_receipt_reversals;
    DROP TABLE IF EXISTS scm_return_to_vendor_lines;
    DROP TABLE IF EXISTS scm_return_to_vendors;
    DROP TABLE IF EXISTS scm_accounting_ready_events;
    DROP TABLE IF EXISTS scm_discrepancy_records;

    ALTER TABLE scm_valuation_layers DROP CONSTRAINT IF EXISTS scm_valuation_layers_source_inspection_fk;
    DROP TABLE IF EXISTS scm_inspections;
    ALTER TABLE scm_valuation_layers DROP CONSTRAINT IF EXISTS scm_valuation_layers_receiving_line_fk;
    DROP TABLE IF EXISTS scm_receiving_lines;
    DROP TABLE IF EXISTS scm_receiving_records;

    ALTER TABLE scm_valuation_layers
      DROP CONSTRAINT IF EXISTS scm_valuation_layers_status_check,
      DROP CONSTRAINT IF EXISTS scm_valuation_layers_owner_party_check,
      DROP CONSTRAINT IF EXISTS scm_valuation_layers_owner_type_check,
      DROP CONSTRAINT IF EXISTS scm_valuation_layers_stock_condition_check;
    DROP INDEX IF EXISTS idx_scm_val_layers_condition_owner;
    DROP INDEX IF EXISTS idx_scm_val_layers_receiving_line;
    ALTER TABLE scm_valuation_layers
      DROP COLUMN IF EXISTS layer_status,
      DROP COLUMN IF EXISTS owner_party_id,
      DROP COLUMN IF EXISTS owner_type,
      DROP COLUMN IF EXISTS stock_condition,
      DROP COLUMN IF EXISTS source_inspection_id,
      DROP COLUMN IF EXISTS receiving_line_id;

    DROP TRIGGER IF EXISTS trg_scm_po_line_assignment_freeze ON purchase_order_lines;
    DROP FUNCTION IF EXISTS scm_reject_frozen_po_line_assignment_changes;

    ALTER TABLE purchase_order_lines
      DROP CONSTRAINT IF EXISTS purchase_order_lines_assignment_frozen_by_fk,
      DROP CONSTRAINT IF EXISTS purchase_order_lines_assignment_dims_object_check,
      DROP CONSTRAINT IF EXISTS purchase_order_lines_account_assignment_type_check,
      DROP COLUMN IF EXISTS account_assignment_frozen_by,
      DROP COLUMN IF EXISTS account_assignment_frozen_at,
      DROP COLUMN IF EXISTS account_assignment_dimensions,
      DROP COLUMN IF EXISTS account_assignment_type;
    DROP INDEX IF EXISTS idx_po_lines_account_assignment_type;

    DROP TRIGGER IF EXISTS trg_scm_seed_account_assignment_configs ON tenants;
    DROP FUNCTION IF EXISTS scm_seed_account_assignment_configs_for_tenant;
    DROP TABLE IF EXISTS scm_account_assignment_configs;

    DROP TRIGGER IF EXISTS trg_scm_adv_movements_immutable ON scm_advanced_stock_movements;
    DROP FUNCTION IF EXISTS scm_reject_stock_movement_update_delete;

    ALTER TABLE scm_advanced_stock_movements
      DROP CONSTRAINT IF EXISTS scm_adv_movements_reversed_fk,
      DROP CONSTRAINT IF EXISTS scm_adv_movements_no_self_reversal_check,
      DROP CONSTRAINT IF EXISTS scm_adv_movements_owner_party_check,
      DROP CONSTRAINT IF EXISTS scm_adv_movements_owner_type_check,
      DROP CONSTRAINT IF EXISTS scm_adv_movements_condition_check,
      DROP CONSTRAINT IF EXISTS scm_adv_movements_type_check;

    ALTER TABLE scm_advanced_stock_movements
      ADD CONSTRAINT scm_adv_movements_type_check
        CHECK (movement_type IN ('in', 'out', 'transfer_in', 'transfer_out', 'adjustment_in', 'adjustment_out', 'opname_in', 'opname_out'));

    DROP INDEX IF EXISTS idx_scm_adv_movements_reversed;
    DROP INDEX IF EXISTS idx_scm_adv_movements_condition_owner;
    ALTER TABLE scm_advanced_stock_movements
      DROP COLUMN IF EXISTS accounting_ready_event_id,
      DROP COLUMN IF EXISTS reversed_movement_id,
      DROP COLUMN IF EXISTS owner_party_id,
      DROP COLUMN IF EXISTS owner_type,
      DROP COLUMN IF EXISTS stock_condition;

    ALTER TABLE scm_advanced_stock_balances
      DROP CONSTRAINT IF EXISTS scm_adv_stock_balances_reserved_available_check,
      DROP CONSTRAINT IF EXISTS scm_adv_stock_balances_owner_party_check,
      DROP CONSTRAINT IF EXISTS scm_adv_stock_balances_owner_type_check,
      DROP CONSTRAINT IF EXISTS scm_adv_stock_balances_condition_check;

    DROP INDEX IF EXISTS uq_scm_adv_balances_condition_owner_key;
    DROP INDEX IF EXISTS idx_scm_adv_balances_available;
    DROP INDEX IF EXISTS idx_scm_adv_balances_condition_owner;

    ALTER TABLE scm_advanced_stock_balances
      DROP COLUMN IF EXISTS condition_since,
      DROP COLUMN IF EXISTS owner_party_id,
      DROP COLUMN IF EXISTS owner_type,
      DROP COLUMN IF EXISTS stock_condition;

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

    ALTER TABLE purchase_order_lines
      DROP CONSTRAINT IF EXISTS purchase_order_lines_tenant_item_fk,
      DROP CONSTRAINT IF EXISTS purchase_order_lines_tenant_order_fk,
      DROP CONSTRAINT IF EXISTS purchase_order_lines_tenant_id_id_unique;
    DROP INDEX IF EXISTS idx_purchase_order_lines_tenant_order;
    ALTER TABLE purchase_order_lines DROP COLUMN IF EXISTS tenant_id;
  `);
};
