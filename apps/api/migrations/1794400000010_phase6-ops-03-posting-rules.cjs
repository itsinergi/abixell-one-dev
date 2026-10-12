/**
 * WP-OPS-03 Phase 6 posting rules — make invoice/PPN outbox events
 * postable by AccountingEventPoster.
 */
exports.up = (pgm) => {
  pgm.sql(`
    INSERT INTO posting_rules (
      tenant_id, rule_code, rule_name, rule_version, trigger_event_type,
      accounting_formula, requires_approval, effective_date, is_active
    )
    SELECT
      t.id,
      'RULE_WO_INVOICED',
      'Work Order Invoiced',
      'v1',
      'work_order.invoiced',
      '[
        {"accountCode":"1210","side":"debit","amountExpression":"AMOUNT"},
        {"accountCode":"4100","side":"credit","amountExpression":"AMOUNT"}
      ]'::jsonb,
      false,
      '2026-01-01'::date,
      true
    FROM tenants t
    ON CONFLICT (tenant_id, rule_code, rule_version) DO NOTHING;

    INSERT INTO posting_rules (
      tenant_id, rule_code, rule_name, rule_version, trigger_event_type,
      accounting_formula, requires_approval, effective_date, is_active
    )
    SELECT
      t.id,
      'RULE_WO_INVOICE_TAX',
      'Work Order Invoice Tax',
      'v1',
      'work_order.invoice_tax',
      '[
        {"accountCode":"1210","side":"debit","amountExpression":"AMOUNT"},
        {"accountCode":"2410","side":"credit","amountExpression":"AMOUNT"}
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
    DELETE FROM posting_rules
     WHERE rule_code IN ('RULE_WO_INVOICED', 'RULE_WO_INVOICE_TAX')
       AND rule_version = 'v1'
       AND trigger_event_type IN ('work_order.invoiced', 'work_order.invoice_tax')
       AND created_by IS NULL;
  `);
};
