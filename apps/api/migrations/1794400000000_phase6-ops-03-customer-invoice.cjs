/**
 * WP-OPS-03 Phase 6 — Billing / Accounts Receivable (FR-FIN-008, E2EGAP-018).
 *
 * Completes the DEC-009 chain acceptance → cost → invoice → AR:
 *   - New `customer_invoices` table — one invoice per Work Order
 *     (unique (tenant_id, work_order_id)), value = cost × (1 + markup).
 *   - Two new outbox event types so the single-AMOUNT posting rule can post
 *     both legs: `work_order.invoiced` (base → debit AR 1210 / credit 4100)
 *     and `work_order.invoice_tax` (tax → debit AR 1210 / credit 2410, only
 *     when tax_amount > 0).
 *   - Permission `service_operations.billing.manage` (code seed only — role
 *     assignment is tenant runtime configuration, never seeded).
 *   - Parameter `service_operations.invoice.default_markup` (decimal, tenant
 *     default markup rate).
 */
exports.up = (pgm) => {
  // 1. Create customer_invoices table. Money is calculated in SQL NUMERIC —
  // never in JS floats. Composite FKs enforce tenant isolation at the DB
  // level; work_orders/customers/legal_entities all have UNIQUE(tenant_id, id).
  pgm.sql(`
    CREATE TABLE customer_invoices (
      id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id       uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      work_order_id   uuid NOT NULL,
      invoice_number  text NOT NULL,
      customer_id     uuid NOT NULL,
      legal_entity_id uuid NOT NULL,
      period_id       uuid NOT NULL REFERENCES accounting_periods(id) ON DELETE RESTRICT,
      cost_basis      numeric(18,4) NOT NULL CHECK (cost_basis > 0),
      markup_rate     numeric(8,6)  NOT NULL CHECK (markup_rate >= 0 AND markup_rate <= 1),
      base_amount     numeric(18,4) NOT NULL CHECK (base_amount > 0),
      is_taxable      boolean NOT NULL DEFAULT false,
      tax_rate        numeric(8,6) CHECK (tax_rate IS NULL OR (tax_rate >= 0 AND tax_rate <= 1)),
      tax_amount      numeric(18,4) NOT NULL DEFAULT 0 CHECK (tax_amount >= 0),
      total_amount    numeric(18,4) NOT NULL CHECK (total_amount > 0),
      currency        text NOT NULL DEFAULT 'IDR',
      ar_status       text NOT NULL DEFAULT 'open' CHECK (ar_status IN ('open','settled','cancelled')),
      issued_at       timestamptz NOT NULL DEFAULT now(),
      issued_by       uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
      created_at      timestamptz NOT NULL DEFAULT now(),
      updated_at      timestamptz NOT NULL DEFAULT now(),

      CONSTRAINT customer_invoices_wo_unique   UNIQUE (tenant_id, work_order_id),
      CONSTRAINT customer_invoices_number_uq   UNIQUE (tenant_id, invoice_number),
      CONSTRAINT customer_invoices_total_check CHECK (total_amount = base_amount + tax_amount),
      CONSTRAINT customer_invoices_taxable_rate_check CHECK (is_taxable = false OR tax_rate IS NOT NULL),
      CONSTRAINT customer_invoices_work_order_fk FOREIGN KEY (tenant_id, work_order_id)
        REFERENCES work_orders(tenant_id, id) ON DELETE CASCADE,
      CONSTRAINT customer_invoices_customer_fk FOREIGN KEY (tenant_id, customer_id)
        REFERENCES customers(tenant_id, id) ON DELETE RESTRICT,
      CONSTRAINT customer_invoices_legal_entity_fk FOREIGN KEY (tenant_id, legal_entity_id)
        REFERENCES legal_entities(tenant_id, id) ON DELETE RESTRICT
    );

    -- The work-order FK is served by customer_invoices_wo_unique.
    CREATE INDEX idx_customer_invoices_tenant_status
      ON customer_invoices(tenant_id, ar_status);
    CREATE INDEX idx_customer_invoices_customer
      ON customer_invoices(tenant_id, customer_id);
    CREATE INDEX idx_customer_invoices_legal_entity
      ON customer_invoices(tenant_id, legal_entity_id);
    CREATE INDEX idx_customer_invoices_period
      ON customer_invoices(period_id);
  `);

  // 2. Widen the Accounting Ready outbox constraint (#17/#18 in the list).
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
          'work_order.accepted', 'work_order.cost_accumulated',
          'work_order.invoiced', 'work_order.invoice_tax'
        ));
  `);

  // 3. Permission code seed (no role assignment in migrations).
  pgm.sql(`
    INSERT INTO permissions (code, description)
    SELECT v.code, v.description
      FROM (VALUES
        ('service_operations.billing.manage', 'Create customer invoices from finalized Work Orders')
      ) AS v(code, description)
     WHERE NOT EXISTS (SELECT 1 FROM permissions p WHERE p.code = v.code);
  `);

  // 4. Default-markup parameter (tenant default; per-invoice request can
  // override). Decimal stored as a JSON string to avoid float coercion.
  pgm.sql(`
    INSERT INTO app_parameters
      (code, name, description, module_code, parameter_type,
       schema_area, schema_key, default_value, allowed_levels,
       org_override_allowed, is_guardrail, is_active)
    VALUES
      ('service_operations.invoice.default_markup',
       'Default Invoice Markup Rate',
       'Default markup rate applied when invoicing a cost-finalized Work Order (0 = cost price; 0.15 = 15% markup)',
       'service_operations',
       'decimal',
       'app_parameter_values',
       'value_decimal',
       '"0"'::jsonb,
       'S,C',
       false,
       false,
       true)
    ON CONFLICT (code) DO NOTHING;
  `);
};

exports.down = (pgm) => {
  // Reverse in dependency order: parameter values → parameter → permission
  // → outbox cleanup → constraint → table.
  pgm.sql(`
    DELETE FROM app_parameter_values
     WHERE parameter_id IN (
       SELECT id FROM app_parameters
        WHERE code = 'service_operations.invoice.default_markup'
     );

    DELETE FROM app_parameters
     WHERE code = 'service_operations.invoice.default_markup';

    DELETE FROM permissions WHERE code = 'service_operations.billing.manage';

    DELETE FROM scm_accounting_ready_event_state_transitions
     WHERE accounting_event_id IN (
       SELECT id FROM scm_accounting_ready_events
        WHERE event_type IN ('work_order.invoiced', 'work_order.invoice_tax')
     );

    ALTER TABLE scm_accounting_ready_events
      DISABLE TRIGGER trg_scm_accounting_ready_events_immutable_facts;

    DELETE FROM scm_accounting_ready_events
     WHERE event_type IN ('work_order.invoiced', 'work_order.invoice_tax');

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
          'work_order.accepted', 'work_order.cost_accumulated'
        ));

    DROP TABLE IF EXISTS customer_invoices;
  `);
};
