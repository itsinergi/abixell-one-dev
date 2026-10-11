/**
 * WP-WMS-02 — Landed-cost accounting-ready event baseline rule.
 *
 * SCM emits the operational fact; the Accounting Kernel owns journal posting.
 * Tenants may supersede this migration-owned default with their own rule.
 */
exports.up = (pgm) => {
  pgm.sql(`
    INSERT INTO posting_rules (
      tenant_id, rule_code, rule_name, rule_version, trigger_event_type,
      accounting_formula, requires_approval, effective_date, is_active
    )
    SELECT
      t.id,
      'RULE_LANDED_COST_APPLIED',
      'Inventory Landed Cost Applied',
      'v1',
      'inventory.landed_cost_applied',
      '[
        {"accountCode":"1301","side":"debit","amountExpression":"AMOUNT"},
        {"accountCode":"2401","side":"credit","amountExpression":"AMOUNT"}
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
          WHERE event_type = 'inventory.landed_cost_applied'
            AND idempotency_key LIKE 'landed-cost:%:apply'
       );

    ALTER TABLE scm_accounting_ready_events
      DISABLE TRIGGER trg_scm_accounting_ready_events_immutable_facts;

    DELETE FROM scm_accounting_ready_events
     WHERE event_type = 'inventory.landed_cost_applied'
       AND idempotency_key LIKE 'landed-cost:%:apply';

    ALTER TABLE scm_accounting_ready_events
      ENABLE TRIGGER trg_scm_accounting_ready_events_immutable_facts;

    DELETE FROM posting_rules
     WHERE rule_code = 'RULE_LANDED_COST_APPLIED'
       AND rule_version = 'v1'
       AND trigger_event_type = 'inventory.landed_cost_applied'
       AND created_by IS NULL;
  `);
};

