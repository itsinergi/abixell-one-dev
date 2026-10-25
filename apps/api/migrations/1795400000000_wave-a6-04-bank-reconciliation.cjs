/**
 * Wave A6 WP-FIN-A6-04 — Bank reconciliation (ADR-0018).
 *
 * 1. `finance_bank_accounts` — the Bank Master → House Bank → Account ID →
 *    Bank Account hierarchy, flattened into one governed row per real bank
 *    account. Each row belongs to one tenant and Legal Entity, maps to an
 *    authorized ledger account, carries currency, a masked account identity,
 *    effective dates and a reconciliation policy (ADR-0018 §1).
 *
 * 2. `finance_bank_statement_imports` — one row per imported source file.
 *    Holds the source-file identity and import hash so a re-import is
 *    idempotent; a duplicate fails closed at the unique index (ADR-0018 §2).
 *
 * 3. `finance_bank_statement_lines` — immutable imported statement facts.
 *    These are the *statement* side of the reconciliation and never touch the
 *    ledger. A line whose external id was already imported lands in the
 *    review queue instead of being dropped or double-counted.
 *
 *    `bank_account_id` is denormalized from the import on purpose: a duplicate
 *    external id is a duplicate *for one bank account*, and the re-import that
 *    exposes it usually lands in a different import row. Scoping the unique
 *    index through `import_id` would let the same bank transaction in twice
 *    through two files and double-count it.
 *
 * 4. `finance_bank_reconciliations` — one reconciliation per bank account per
 *    accounting period. Closing freezes the match set; correction is a
 *    governed reopen, never an edit (ADR-0018 §3).
 *
 * 5. `finance_bank_matches` — append-only match events linking a statement
 *    line to a GL entry. Split and many-to-one matching both fall out of the
 *    shape: several rows may point at one statement line, and several
 *    statement lines may point at one GL entry. A reversal is a compensating
 *    row via `reverses_id`, never a delete.
 *
 * Amounts are numeric(18,2) because the ledger side (`general_ledger_entries`)
 * is numeric(18,2): comparing a 4-decimal statement amount against a 2-decimal
 * ledger amount would produce permanent false mismatches.
 */

exports.up = (pgm) => {
  pgm.createTable("finance_bank_accounts", {
    id: { type: "uuid", primaryKey: true, default: pgm.func("gen_random_uuid()") },
    // Direct tenant ownership (GATE-3 migration-tenant-discipline).
    tenant_id: { type: "uuid", notNull: true, references: "tenants", onDelete: "CASCADE" },
    legal_entity_id: { type: "uuid", notNull: true },
    /** Bank Master. */
    bank_name: { type: "varchar(120)", notNull: true },
    /** House Bank — the bank relationship the company holds. */
    house_bank_code: { type: "varchar(40)", notNull: true },
    /** Account ID at the bank (its own identifier, not ours). */
    bank_account_id: { type: "varchar(80)", notNull: true },
    /** Only the masked identity is ever stored (ADR-0018 §1). */
    account_number_masked: { type: "varchar(40)", notNull: true },
    name: { type: "varchar(120)", notNull: true },
    currency: { type: "varchar(3)", notNull: true },
    /** The authorized GL account whose book balance this statement is measured
     *  against. Never inferred from the account name. */
    ledger_account_id: { type: "uuid", notNull: true },
    /**
     * 'manual' — matches are recorded by hand only;
     * 'suggested' — the service may propose candidates, still advisory until
     * confirmed (ADR-0018 §3).
     */
    reconciliation_policy: {
      type: "varchar(20)",
      notNull: true,
      default: "manual",
      check: `reconciliation_policy IN ('manual', 'suggested')`,
    },
    effective_from: { type: "date", notNull: true },
    effective_to: { type: "date" },
    is_active: { type: "boolean", notNull: true, default: true },
    created_by: { type: "uuid" },
    created_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
    updated_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
  });
  pgm.addConstraint("finance_bank_accounts", "finance_bank_accounts_window_check", {
    check: "effective_to IS NULL OR effective_to >= effective_from",
  });
  // One row per real bank account: the bank's own identity plus the house bank
  // is the natural key. Re-registering the same account is a conflict, not a
  // second account.
  pgm.addConstraint("finance_bank_accounts", "finance_bank_accounts_identity_unique", {
    unique: ["tenant_id", "legal_entity_id", "house_bank_code", "bank_account_id"],
  });
  // Composite key target for tenant-safe child FKs.
  pgm.addConstraint("finance_bank_accounts", "finance_bank_accounts_tenant_id_unique", {
    unique: ["tenant_id", "id"],
  });
  pgm.addConstraint("finance_bank_accounts", "finance_ba_ledger_tenant_safe", {
    foreignKeys: {
      columns: ["tenant_id", "ledger_account_id"],
      references: "accounting_accounts(tenant_id, id)",
      onDelete: "RESTRICT",
    },
  });
  pgm.addConstraint("finance_bank_accounts", "finance_ba_legal_entity_tenant_safe", {
    foreignKeys: {
      columns: ["tenant_id", "legal_entity_id"],
      references: "legal_entities(tenant_id, id)",
      onDelete: "CASCADE",
    },
  });
  pgm.createIndex("finance_bank_accounts", ["tenant_id", "legal_entity_id"]);

  pgm.createTable("finance_bank_statement_imports", {
    id: { type: "uuid", primaryKey: true, default: pgm.func("gen_random_uuid()") },
    tenant_id: { type: "uuid", notNull: true, references: "tenants", onDelete: "CASCADE" },
    bank_account_id: { type: "uuid", notNull: true },
    /** Explicit format profile — CSV only in Wave A6 (ADR-0018 §2). */
    format_profile: { type: "varchar(40)", notNull: true, default: "csv_v1" },
    source_file_name: { type: "varchar(255)", notNull: true },
    /** Digest of the source bytes: re-importing the same file is a conflict. */
    import_hash: { type: "varchar(64)", notNull: true },
    line_count: { type: "integer", notNull: true, default: 0 },
    duplicate_line_count: { type: "integer", notNull: true, default: 0 },
    imported_by: { type: "uuid" },
    created_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
  });
  // Idempotent import: the same file cannot be imported twice for one account.
  pgm.addConstraint("finance_bank_statement_imports", "finance_bank_imports_hash_unique", {
    unique: ["tenant_id", "bank_account_id", "import_hash"],
  });
  pgm.addConstraint("finance_bank_statement_imports", "finance_bank_imports_tenant_id_unique", {
    unique: ["tenant_id", "id"],
  });
  pgm.addConstraint("finance_bank_statement_imports", "finance_bi_account_tenant_safe", {
    foreignKeys: {
      columns: ["tenant_id", "bank_account_id"],
      references: "finance_bank_accounts(tenant_id, id)",
      onDelete: "CASCADE",
    },
  });

  pgm.createTable("finance_bank_statement_lines", {
    id: { type: "uuid", primaryKey: true, default: pgm.func("gen_random_uuid()") },
    tenant_id: { type: "uuid", notNull: true, references: "tenants", onDelete: "CASCADE" },
    import_id: { type: "uuid", notNull: true },
    /** Denormalized from the import so duplicate detection can key on the
     *  account instead of one file (see the table comment above). */
    bank_account_id: { type: "uuid", notNull: true },
    /** Bank's own transaction id, when the file carries one. */
    external_transaction_id: { type: "varchar(120)" },
    value_date: { type: "date", notNull: true },
    booking_date: { type: "date" },
    /** Always positive; `direction` carries the sign. */
    amount: { type: "numeric(18,2)", notNull: true, check: "amount > 0" },
    direction: { type: "varchar(6)", notNull: true, check: `direction IN ('debit','credit')` },
    currency: { type: "varchar(3)", notNull: true },
    reference: { type: "varchar(255)" },
    counterparty: { type: "varchar(255)" },
    /** Raw source row, kept verbatim for provenance and dispute handling. */
    raw_source: { type: "text", notNull: true },
    /**
     * 'accepted' — a new fact;
     * 'review_queue' — an external id that was already imported. Held for a
     * human instead of being silently dropped or double-counted.
     */
    duplicate_status: {
      type: "varchar(20)",
      notNull: true,
      default: "accepted",
      check: `duplicate_status IN ('accepted', 'review_queue')`,
    },
    created_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
  });
  // A bank transaction id is unique per bank account; a repeat lands in review.
  // Partial because many statements carry no external id at all, and because
  // the review-queue row deliberately repeats one.
  pgm.sql(`
    CREATE UNIQUE INDEX finance_bank_lines_external_unique
      ON finance_bank_statement_lines (tenant_id, bank_account_id, external_transaction_id)
      WHERE external_transaction_id IS NOT NULL AND duplicate_status = 'accepted';
  `);
  pgm.addConstraint("finance_bank_statement_lines", "finance_bank_lines_tenant_id_unique", {
    unique: ["tenant_id", "id"],
  });
  pgm.addConstraint("finance_bank_statement_lines", "finance_bl_import_tenant_safe", {
    foreignKeys: {
      columns: ["tenant_id", "import_id"],
      references: "finance_bank_statement_imports(tenant_id, id)",
      onDelete: "CASCADE",
    },
  });
  pgm.addConstraint("finance_bank_statement_lines", "finance_bl_account_tenant_safe", {
    foreignKeys: {
      columns: ["tenant_id", "bank_account_id"],
      references: "finance_bank_accounts(tenant_id, id)",
      onDelete: "CASCADE",
    },
  });
  pgm.createIndex("finance_bank_statement_lines", ["tenant_id", "import_id", "value_date"]);
  pgm.createIndex("finance_bank_statement_lines", ["tenant_id", "bank_account_id", "value_date"]);

  pgm.createTable("finance_bank_reconciliations", {
    id: { type: "uuid", primaryKey: true, default: pgm.func("gen_random_uuid()") },
    tenant_id: { type: "uuid", notNull: true, references: "tenants", onDelete: "CASCADE" },
    bank_account_id: { type: "uuid", notNull: true },
    period_id: { type: "uuid", notNull: true },
    status: {
      type: "varchar(20)",
      notNull: true,
      default: "open",
      check: `status IN ('open', 'closed')`,
    },
    /** Statement closing balance as claimed by the imported statement. */
    statement_balance: { type: "numeric(18,2)" },
    closed_by: { type: "uuid" },
    closed_at: { type: "timestamptz" },
    closed_book_balance: { type: "numeric(18,2)" },
    closed_statement_balance: { type: "numeric(18,2)" },
    created_by: { type: "uuid" },
    created_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
  });
  // One reconciliation per bank account per accounting period.
  pgm.addConstraint("finance_bank_reconciliations", "finance_bank_recon_period_unique", {
    unique: ["tenant_id", "bank_account_id", "period_id"],
  });
  pgm.addConstraint("finance_bank_reconciliations", "finance_bank_recon_tenant_id_unique", {
    unique: ["tenant_id", "id"],
  });
  pgm.addConstraint("finance_bank_reconciliations", "finance_br_account_tenant_safe", {
    foreignKeys: {
      columns: ["tenant_id", "bank_account_id"],
      references: "finance_bank_accounts(tenant_id, id)",
      onDelete: "CASCADE",
    },
  });
  pgm.addConstraint("finance_bank_reconciliations", "finance_br_period_tenant_safe", {
    foreignKeys: {
      columns: ["tenant_id", "period_id"],
      references: "accounting_periods(tenant_id, id)",
      onDelete: "RESTRICT",
    },
  });

  pgm.createTable("finance_bank_matches", {
    id: { type: "uuid", primaryKey: true, default: pgm.func("gen_random_uuid()") },
    tenant_id: { type: "uuid", notNull: true, references: "tenants", onDelete: "CASCADE" },
    reconciliation_id: { type: "uuid", notNull: true },
    statement_line_id: { type: "uuid", notNull: true },
    /** Ledger side. No composite FK: `general_ledger_entries` has no
     *  (tenant_id, id) unique, so ownership is checked at write time inside the
     *  same transaction instead. */
    gl_entry_id: { type: "uuid", notNull: true },
    /** Matched portion. Less than the statement amount = split match. */
    amount: { type: "numeric(18,2)", notNull: true, check: "amount > 0" },
    /**
     * How the match was decided. 'manual' — a human picked both sides;
     * 'confirmed' — a human accepted a candidate the service suggested. An
     * unconfirmed suggestion is a read-model, never a row (ADR-0018 §3).
     */
    match_kind: {
      type: "varchar(20)",
      notNull: true,
      default: "manual",
      check: `match_kind IN ('manual', 'confirmed')`,
    },
    /** Why the candidate matched — kept so a match stays explainable. */
    match_reason: { type: "text" },
    idempotency_key: { type: "varchar(120)", notNull: true },
    /** Compensating unmatch points at the row it reverses. */
    reverses_id: { type: "uuid", references: "finance_bank_matches", onDelete: "RESTRICT" },
    note: { type: "text" },
    created_by: { type: "uuid" },
    created_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
  });
  pgm.addConstraint("finance_bank_matches", "finance_bank_matches_idem_unique", {
    unique: ["tenant_id", "idempotency_key"],
  });
  pgm.addConstraint("finance_bank_matches", "finance_bm_recon_tenant_safe", {
    foreignKeys: {
      columns: ["tenant_id", "reconciliation_id"],
      references: "finance_bank_reconciliations(tenant_id, id)",
      onDelete: "CASCADE",
    },
  });
  pgm.addConstraint("finance_bank_matches", "finance_bm_line_tenant_safe", {
    foreignKeys: {
      columns: ["tenant_id", "statement_line_id"],
      references: "finance_bank_statement_lines(tenant_id, id)",
      onDelete: "RESTRICT",
    },
  });
  pgm.createIndex("finance_bank_matches", ["tenant_id", "reconciliation_id"]);
  pgm.createIndex("finance_bank_matches", ["tenant_id", "statement_line_id"]);
  pgm.createIndex("finance_bank_matches", ["tenant_id", "gl_entry_id"]);
};

exports.down = (pgm) => {
  pgm.dropTable("finance_bank_matches", { ifExists: true });
  pgm.dropTable("finance_bank_reconciliations", { ifExists: true });
  pgm.dropTable("finance_bank_statement_lines", { ifExists: true });
  pgm.dropTable("finance_bank_statement_imports", { ifExists: true });
  pgm.dropTable("finance_bank_accounts", { ifExists: true });
};
