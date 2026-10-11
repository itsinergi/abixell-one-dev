/**
 * WP-HR-01 — Payroll approval/close accounting-ready event and posting rule.
 *
 * Payroll uses the same outbox consumed by the Accounting Kernel as Supply
 * Chain. The baseline rule keeps account mapping tenant data while providing a
 * deterministic default for tenants that have not configured a replacement.
 */
exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE scm_accounting_ready_events
      DROP CONSTRAINT scm_accounting_events_type_check;

    ALTER TABLE scm_accounting_ready_events
      ADD CONSTRAINT scm_accounting_events_type_check
        CHECK (event_type IN (
          'inventory.goods_received', 'inventory.goods_issued', 'inventory.transferred', 'inventory.adjusted',
          'inventory.returned_to_vendor', 'inventory.receipt_reversed', 'inventory.landed_cost_applied',
          'inventory.consignment_consumed', 'service.accepted', 'inventory.disposed',
          'vendor.invoice.approved', 'vendor.invoice.payment_approved', 'payroll.run_posted'
        ));

    INSERT INTO posting_rules (
      tenant_id, rule_code, rule_name, rule_version, trigger_event_type,
      accounting_formula, requires_approval, effective_date, is_active
    )
    SELECT
      t.id,
      'RULE_PAYROLL_RUN_POSTED',
      'Payroll Run Posted',
      'v1',
      'payroll.run_posted',
      '[
        {"accountCode":"6101","side":"debit","amountExpression":"AMOUNT"},
        {"accountCode":"2101","side":"credit","amountExpression":"AMOUNT"}
      ]'::jsonb,
      false,
      '2026-01-01'::date,
      true
    FROM tenants t
    ON CONFLICT (tenant_id, rule_code, rule_version) DO NOTHING;
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    DELETE FROM scm_accounting_ready_event_state_transitions
     WHERE tenant_id IS NOT NULL
       AND accounting_event_id IN (
         SELECT id
           FROM scm_accounting_ready_events
          WHERE event_type = 'payroll.run_posted'
       );

    ALTER TABLE scm_accounting_ready_events
      DISABLE TRIGGER trg_scm_accounting_ready_events_immutable_facts;

    DELETE FROM scm_accounting_ready_events
     WHERE event_type = 'payroll.run_posted';

    ALTER TABLE scm_accounting_ready_events
      ENABLE TRIGGER trg_scm_accounting_ready_events_immutable_facts;

    DELETE FROM posting_rules
     WHERE rule_code = 'RULE_PAYROLL_RUN_POSTED'
       AND rule_version = 'v1'
       AND trigger_event_type = 'payroll.run_posted'
       AND created_by IS NULL;

    ALTER TABLE scm_accounting_ready_events
      DROP CONSTRAINT scm_accounting_events_type_check;

    ALTER TABLE scm_accounting_ready_events
      ADD CONSTRAINT scm_accounting_events_type_check
        CHECK (event_type IN (
          'inventory.goods_received', 'inventory.goods_issued', 'inventory.transferred', 'inventory.adjusted',
          'inventory.returned_to_vendor', 'inventory.receipt_reversed', 'inventory.landed_cost_applied',
          'inventory.consignment_consumed', 'service.accepted', 'inventory.disposed',
          'vendor.invoice.approved', 'vendor.invoice.payment_approved'
        ));
  `);
};
