/**
 * WP-OPS-02 Phase 6 posting rule — makes `work_order.cost_accumulated`
 * postable by AccountingEventPoster. Without an active rule, the consumer
 * hard-fails via `resolvePostingRuleInternal` NotFoundError.
 */
exports.up = (pgm) => {
  pgm.sql(`
    INSERT INTO posting_rules (
      tenant_id, rule_code, rule_name, rule_version, trigger_event_type,
      accounting_formula, requires_approval, effective_date, is_active
    )
    SELECT
      t.id,
      'RULE_WO_COST_ACCUMULATED',
      'Work Order Cost Accumulated',
      'v1',
      'work_order.cost_accumulated',
      '[
        {"accountCode":"6200","side":"debit","amountExpression":"AMOUNT"},
        {"accountCode":"2500","side":"credit","amountExpression":"AMOUNT"}
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
          WHERE event_type = 'work_order.cost_accumulated'
       );

    ALTER TABLE scm_accounting_ready_events
      DISABLE TRIGGER trg_scm_accounting_ready_events_immutable_facts;

    DELETE FROM scm_accounting_ready_events
     WHERE event_type = 'work_order.cost_accumulated';

    ALTER TABLE scm_accounting_ready_events
      ENABLE TRIGGER trg_scm_accounting_ready_events_immutable_facts;

    DELETE FROM posting_rules
     WHERE rule_code = 'RULE_WO_COST_ACCUMULATED'
       AND rule_version = 'v1'
       AND trigger_event_type = 'work_order.cost_accumulated'
       AND created_by IS NULL;
  `);
};
