/**
 * Phase 2 WP-PRO-01: AP Invoice (Vendor Invoice PO-based)
 *
 * Implements AP invoice creation, PO/GR linking, idempotency, state machine
 * (draft → submitted → approved/rejected), and accounting-ready event emission
 * on approval. Lines freeze on approval (immutable account assignment thereafter).
 *
 * Follows scm_service_acceptances pattern: immutability trigger on approved rows,
 * UNIQUE idempotency key, FK to PO + supplier, workflow instance for approval routing.
 */
exports.up = (pgm) => {
  pgm.sql(`
    -- -----------------------------------------------------------------------
    -- 1. Vendor Invoices (AP Invoice header)
    -- -----------------------------------------------------------------------
    CREATE TABLE scm_vendor_invoices (
      id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id             UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      invoice_number        TEXT        NOT NULL,
      idempotency_key       TEXT        NOT NULL,
      purchase_order_id     UUID        NOT NULL,
      receiving_record_id   UUID        NOT NULL,
      supplier_id           UUID        NOT NULL,
      invoice_amount        NUMERIC(18,4) NOT NULL,
      currency              TEXT        NOT NULL DEFAULT 'IDR',
      status                TEXT        NOT NULL DEFAULT 'draft',
      workflow_instance_id  UUID,
      submitted_at          TIMESTAMPTZ,
      submitted_by          UUID,
      approved_at           TIMESTAMPTZ,
      approved_by           UUID,
      rejected_at           TIMESTAMPTZ,
      rejected_by           UUID,
      rejection_reason      TEXT,
      notes                 TEXT,
      created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
      created_by            UUID,
      updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_by            UUID,

      FOREIGN KEY (tenant_id, purchase_order_id)
        REFERENCES purchase_orders(tenant_id, id) ON DELETE RESTRICT,
      FOREIGN KEY (tenant_id, receiving_record_id)
        REFERENCES scm_receiving_records(tenant_id, id) ON DELETE RESTRICT,
      FOREIGN KEY (tenant_id, supplier_id)
        REFERENCES suppliers(tenant_id, id) ON DELETE RESTRICT,
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
      CONSTRAINT scm_vendor_invoices_status_check
        CHECK (status IN ('draft', 'submitted', 'approved', 'rejected', 'cancelled')),
      CONSTRAINT scm_vendor_invoices_amount_check CHECK (invoice_amount >= 0),
      UNIQUE (tenant_id, invoice_number),
      UNIQUE (tenant_id, idempotency_key)
    );

    ALTER TABLE scm_vendor_invoices
      ADD CONSTRAINT scm_vendor_invoices_tenant_id_id_unique UNIQUE (tenant_id, id);
    CREATE INDEX idx_scm_vendor_invoices_po
      ON scm_vendor_invoices (tenant_id, purchase_order_id, created_at DESC);
    CREATE INDEX idx_scm_vendor_invoices_supplier
      ON scm_vendor_invoices (tenant_id, supplier_id, status);
    CREATE INDEX idx_scm_vendor_invoices_status
      ON scm_vendor_invoices (tenant_id, status, created_at DESC);

    -- Immutability trigger: approved vendor invoice facts cannot change
    CREATE OR REPLACE FUNCTION scm_reject_approved_vendor_invoice_changes()
    RETURNS trigger AS $$
    BEGIN
      IF OLD.status IN ('approved', 'rejected') AND (
        OLD.invoice_number IS DISTINCT FROM NEW.invoice_number OR
        OLD.purchase_order_id IS DISTINCT FROM NEW.purchase_order_id OR
        OLD.receiving_record_id IS DISTINCT FROM NEW.receiving_record_id OR
        OLD.supplier_id IS DISTINCT FROM NEW.supplier_id OR
        OLD.invoice_amount IS DISTINCT FROM NEW.invoice_amount OR
        OLD.approved_at IS DISTINCT FROM NEW.approved_at OR
        OLD.approved_by IS DISTINCT FROM NEW.approved_by
      ) THEN
        RAISE EXCEPTION 'Approved or rejected vendor invoice facts cannot be changed';
      END IF;
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;

    CREATE TRIGGER trg_scm_vendor_invoice_immutable
      BEFORE UPDATE ON scm_vendor_invoices
      FOR EACH ROW EXECUTE FUNCTION scm_reject_approved_vendor_invoice_changes();

    -- -----------------------------------------------------------------------
    -- 2. Vendor Invoice Lines
    -- -----------------------------------------------------------------------
    CREATE TABLE scm_vendor_invoice_lines (
      id                              UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id                       UUID          NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      vendor_invoice_id               UUID          NOT NULL,
      purchase_order_line_id          UUID          NOT NULL,
      receiving_line_id               UUID,
      description                     TEXT          NOT NULL,
      quantity_invoiced               NUMERIC(18,4) NOT NULL,
      unit_price                      NUMERIC(18,4) NOT NULL,
      currency                        TEXT          NOT NULL DEFAULT 'IDR',
      line_amount                     NUMERIC(18,4) NOT NULL,
      account_assignment_type         TEXT          NOT NULL DEFAULT 'expense',
      account_assignment_dimensions   JSONB         NOT NULL DEFAULT '{}'::jsonb,
      frozen_account_assignment_at    TIMESTAMPTZ,
      accounting_ready_event_id       UUID,
      notes                           TEXT,
      sort_order                      INTEGER       NOT NULL DEFAULT 0,

      FOREIGN KEY (tenant_id, vendor_invoice_id)
        REFERENCES scm_vendor_invoices(tenant_id, id) ON DELETE CASCADE,
      FOREIGN KEY (tenant_id, purchase_order_line_id)
        REFERENCES purchase_order_lines(tenant_id, id) ON DELETE RESTRICT,
      FOREIGN KEY (tenant_id, receiving_line_id)
        REFERENCES scm_receiving_lines(tenant_id, id) ON DELETE SET NULL (receiving_line_id),
      FOREIGN KEY (tenant_id, accounting_ready_event_id)
        REFERENCES scm_accounting_ready_events(tenant_id, id) ON DELETE SET NULL (accounting_ready_event_id),
      CONSTRAINT scm_vendor_invoice_lines_assignment_type_check
        CHECK (account_assignment_type IN ('stock', 'expense', 'asset', 'project', 'work_order', 'service')),
      CONSTRAINT scm_vendor_invoice_lines_assignment_dims_check
        CHECK (jsonb_typeof(account_assignment_dimensions) = 'object'),
      CONSTRAINT scm_vendor_invoice_lines_qty_check CHECK (quantity_invoiced > 0),
      CONSTRAINT scm_vendor_invoice_lines_unit_price_check CHECK (unit_price >= 0),
      CONSTRAINT scm_vendor_invoice_lines_amount_check CHECK (line_amount >= 0)
    );

    ALTER TABLE scm_vendor_invoice_lines
      ADD CONSTRAINT scm_vendor_invoice_lines_tenant_id_id_unique UNIQUE (tenant_id, id);
    CREATE INDEX idx_scm_vendor_invoice_lines_invoice
      ON scm_vendor_invoice_lines (tenant_id, vendor_invoice_id);
    CREATE INDEX idx_scm_vendor_invoice_lines_po_line
      ON scm_vendor_invoice_lines (tenant_id, purchase_order_line_id);
    CREATE INDEX idx_scm_vendor_invoice_lines_receiving_line
      ON scm_vendor_invoice_lines (tenant_id, receiving_line_id);

    -- -----------------------------------------------------------------------
    -- 3. Register WP-PRO-01 permissions
    -- -----------------------------------------------------------------------
    INSERT INTO permissions (code, description) VALUES
      ('supply_chain.vendor_invoice.read',    'View vendor invoice (AP invoice) records'),
      ('supply_chain.vendor_invoice.manage',  'Create and edit vendor invoice records'),
      ('supply_chain.vendor_invoice.approve', 'Submit and approve vendor invoices')
    ON CONFLICT (code) DO NOTHING;

    -- -----------------------------------------------------------------------
    -- 4. Extend scm_accounting_ready_events.event_type to accept AP invoice events
    -- -----------------------------------------------------------------------
    ALTER TABLE scm_accounting_ready_events
      DROP CONSTRAINT scm_accounting_events_type_check;
    ALTER TABLE scm_accounting_ready_events
      ADD CONSTRAINT scm_accounting_events_type_check
        CHECK (event_type IN (
          'inventory.goods_received', 'inventory.goods_issued', 'inventory.transferred', 'inventory.adjusted',
          'inventory.returned_to_vendor', 'inventory.receipt_reversed', 'inventory.landed_cost_applied',
          'inventory.consignment_consumed', 'service.accepted', 'inventory.disposed',
          'vendor.invoice.approved'
        ));
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    -- Fail-closed rollback guard: refuse if vendor invoice operational data exists
    DO $$
    BEGIN
      -- Guard: approved or submitted invoices exist
      IF EXISTS (
        SELECT 1
          FROM scm_vendor_invoices
         WHERE status NOT IN ('draft', 'cancelled')
      ) THEN
        RAISE EXCEPTION 'Cannot rollback Phase 2 WP-PRO-01: active vendor invoice records exist';
      END IF;

      -- Guard: vendor invoices with accounting events exist
      IF EXISTS (
        SELECT 1
          FROM scm_vendor_invoice_lines
         WHERE accounting_ready_event_id IS NOT NULL
      ) THEN
        RAISE EXCEPTION 'Cannot rollback Phase 2 WP-PRO-01: vendor invoice lines with accounting events exist';
      END IF;
    END $$;

    -- Delete WP-PRO-01 permissions
    DELETE FROM permissions WHERE code IN (
      'supply_chain.vendor_invoice.read',
      'supply_chain.vendor_invoice.manage',
      'supply_chain.vendor_invoice.approve'
    );

    -- Drop vendor invoice line tables and triggers
    DROP TABLE IF EXISTS scm_vendor_invoice_lines;
    DROP TRIGGER IF EXISTS trg_scm_vendor_invoice_immutable ON scm_vendor_invoices;
    DROP FUNCTION IF EXISTS scm_reject_approved_vendor_invoice_changes;
    DROP TABLE IF EXISTS scm_vendor_invoices;
  `);
};
