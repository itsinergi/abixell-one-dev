/**
 * Wave A6 WP-FIN-A6-04 — Default posting rules for SCM stock movements.
 *
 * SCM emits the operational fact (ADR-0023); the Accounting Kernel owns the
 * journal. A rule is resolved by `trigger_event_type` alone, so each event type
 * that a stock movement can raise needs exactly one default formula:
 *
 *   inventory.goods_issued    reservation fulfilled → goods left the warehouse
 *   inventory.goods_received  stock appeared (opname surplus, receiving)
 *   inventory.adjusted        stock shrank (opname shrinkage)
 *
 * Accounts follow the existing SCM convention (RULE_LANDED_COST_APPLIED uses
 * 1301 as inventory) and 5100 is the one expense account present in BOTH the
 * SAK Umum and SAK EMKM templates, so the rule resolves for either.
 *
 * These are migration-owned defaults; a tenant may supersede them with its own
 * versioned rule (Epic 14 §4.14 #9: account mapping is tenant-admin data).
 */
const RULES = `
        ('RULE_SCM_GOODS_ISSUED',   'SCM Goods Issued',   'inventory.goods_issued',
          '[{"accountCode":"5100","side":"debit","amountExpression":"AMOUNT"},
            {"accountCode":"1301","side":"credit","amountExpression":"AMOUNT"}]'),
        ('RULE_SCM_GOODS_RECEIVED', 'SCM Goods Received', 'inventory.goods_received',
          '[{"accountCode":"1301","side":"debit","amountExpression":"AMOUNT"},
            {"accountCode":"5100","side":"credit","amountExpression":"AMOUNT"}]'),
        ('RULE_SCM_STOCK_ADJUSTED', 'SCM Stock Adjusted', 'inventory.adjusted',
          '[{"accountCode":"5100","side":"debit","amountExpression":"AMOUNT"},
            {"accountCode":"1301","side":"credit","amountExpression":"AMOUNT"}]')
`;

exports.up = (pgm) => {
  pgm.sql(`
    INSERT INTO posting_rules (
      tenant_id, rule_code, rule_name, rule_version, trigger_event_type,
      accounting_formula, requires_approval, effective_date, is_active
    )
    SELECT t.id, r.rule_code, r.rule_name, 'v1', r.trigger_event_type,
           r.accounting_formula::jsonb, false, '2026-01-01'::date, true
      FROM tenants t
      CROSS JOIN (VALUES ${RULES}) AS r(rule_code, rule_name, trigger_event_type, accounting_formula)
    ON CONFLICT (tenant_id, rule_code, rule_version) DO NOTHING;
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    DELETE FROM posting_rules
     WHERE rule_code IN ('RULE_SCM_GOODS_ISSUED', 'RULE_SCM_GOODS_RECEIVED', 'RULE_SCM_STOCK_ADJUSTED')
       AND rule_version = 'v1'
       AND created_by IS NULL;
  `);
};
