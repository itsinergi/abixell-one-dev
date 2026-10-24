/**
 * Wave A6 WP-FIN-A6-02 — AP/AR open-item settlement + aging (ADR-0017).
 *
 * Two append-only tables. Nothing here is ever updated in place:
 *
 * 1. `finance_open_items` — one row per instrument (invoice, payment, credit
 *    note, debit note, down payment, withholding deduction). `original_amount`
 *    is a positive magnitude; `direction` says whether it increases or
 *    decreases the open position. There is deliberately NO mutable
 *    remaining-amount column: the remaining balance is a projection of
 *    `original_amount` against the allocation history, computed inside the
 *    settlement transaction under row locks (ADR-0017 §1, §3).
 *
 * 2. `finance_open_item_allocations` — immutable settlement events. Reversal
 *    inserts a compensating row pointed at the original via `reverses_id`;
 *    it never deletes or edits the original.
 *
 * Money is numeric(18,4) to match the source documents (`scm_vendor_invoices`
 * and `customer_invoices` both carry 4 decimal places). Rounding down to 2
 * here would make AR/AP totals disagree with the invoice they came from.
 */

exports.up = (pgm) => {
  pgm.createTable("finance_open_items", {
    id: { type: "uuid", primaryKey: true, default: pgm.func("gen_random_uuid()") },
    // Direct tenant ownership (GATE-3 migration-tenant-discipline).
    tenant_id: { type: "uuid", notNull: true, references: "tenants", onDelete: "CASCADE" },
    legal_entity_id: { type: "uuid", notNull: true },
    side: { type: "varchar(2)", notNull: true, check: `side IN ('AR','AP')` },
    /**
     * 'debit' increases the open position (an invoice), 'credit' reduces it
     * (a payment, credit note or withholding). Settlement always nets a
     * credit-direction item against a debit-direction one on the same side.
     */
    direction: { type: "varchar(6)", notNull: true, check: `direction IN ('debit','credit')` },
    source_kind: {
      type: "varchar(24)",
      notNull: true,
      check: `source_kind IN ('invoice','payment','credit_note','debit_note','down_payment','withholding','unapplied')`,
    },
    /**
     * Polymorphic pointer at the originating document. No FK on purpose: the
     * source rows live in three different modules (`scm_vendor_invoices`,
     * `scm_payment_lines`, `customer_invoices`) and each keeps its own
     * authority. `source_ref_table` is whitelisted at the service boundary.
     */
    source_ref_table: { type: "varchar(64)", notNull: true },
    source_ref_id: { type: "uuid", notNull: true },
    party_type: { type: "varchar(12)", notNull: true, check: `party_type IN ('customer','supplier')` },
    party_id: { type: "uuid", notNull: true },
    document_no: { type: "varchar(80)", notNull: true },
    document_date: { type: "date", notNull: true },
    /** NULL on instruments with no due date (unapplied receipts, down payments). */
    due_date: { type: "date" },
    currency: { type: "varchar(3)", notNull: true },
    original_amount: { type: "numeric(18,4)", notNull: true, check: "original_amount > 0" },
    created_by: { type: "uuid" },
    created_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
  });

  // Idempotent intake: one open item per originating document line.
  pgm.addConstraint("finance_open_items", "finance_open_items_source_unique", {
    unique: ["tenant_id", "source_ref_table", "source_ref_id"],
  });
  // Tenant-safe composite FK target: the allocation FKs below reference
  // (tenant_id, id), which needs an exact unique on those two columns.
  pgm.addConstraint("finance_open_items", "finance_open_items_tenant_id_unique", {
    unique: ["tenant_id", "id"],
  });
  pgm.addConstraint("finance_open_items", "finance_open_items_legal_entity_tenant_safe", {
    foreignKeys: {
      columns: ["tenant_id", "legal_entity_id"],
      references: "legal_entities(tenant_id, id)",
      onDelete: "cascade",
    },
  });
  pgm.createIndex("finance_open_items", ["tenant_id", "side", "legal_entity_id"]);
  pgm.createIndex("finance_open_items", ["tenant_id", "party_type", "party_id"]);
  // Aging reads walk documents effective on or before an asOfDate.
  pgm.createIndex("finance_open_items", ["tenant_id", "side", "document_date"]);

  pgm.createTable("finance_open_item_allocations", {
    id: { type: "uuid", primaryKey: true, default: pgm.func("gen_random_uuid()") },
    // Direct tenant ownership (GATE-3 migration-tenant-discipline).
    tenant_id: { type: "uuid", notNull: true, references: "tenants", onDelete: "CASCADE" },
    /** The credit-direction item being applied (payment, credit note, ...). */
    source_open_item_id: { type: "uuid", notNull: true },
    /** The debit-direction item being settled (invoice, debit note, ...). */
    target_open_item_id: { type: "uuid", notNull: true },
    amount: { type: "numeric(18,4)", notNull: true, check: "amount > 0" },
    currency: { type: "varchar(3)", notNull: true },
    allocation_date: { type: "date", notNull: true },
    /** Settlement idempotency key; a replay must fail closed, not double-apply. */
    idempotency_key: { type: "varchar(120)", notNull: true },
    /** Compensating allocation points at the row it reverses. */
    reverses_id: { type: "uuid" },
    reversal_reason: { type: "text" },
    created_by: { type: "uuid" },
    created_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
  });

  pgm.addConstraint("finance_open_item_allocations", "finance_open_item_allocations_idem_unique", {
    unique: ["tenant_id", "idempotency_key"],
  });
  // An allocation may not link across tenants or dangle.
  pgm.addConstraint("finance_open_item_allocations", "finance_oa_source_tenant_safe", {
    foreignKeys: {
      columns: ["tenant_id", "source_open_item_id"],
      references: "finance_open_items(tenant_id, id)",
      onDelete: "restrict",
    },
  });
  pgm.addConstraint("finance_open_item_allocations", "finance_oa_target_tenant_safe", {
    foreignKeys: {
      columns: ["tenant_id", "target_open_item_id"],
      references: "finance_open_items(tenant_id, id)",
      onDelete: "restrict",
    },
  });
  pgm.createIndex("finance_open_item_allocations", ["tenant_id", "target_open_item_id", "allocation_date"]);
  pgm.createIndex("finance_open_item_allocations", ["tenant_id", "source_open_item_id", "allocation_date"]);
};

exports.down = (pgm) => {
  pgm.dropTable("finance_open_item_allocations", { ifExists: true });
  pgm.dropTable("finance_open_items", { ifExists: true });
};
