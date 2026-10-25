/**
 * Wave A6 WP-FIN-A6-05 — Fixed asset book + depreciation (ADR-0019).
 *
 * 1. `finance_asset_books` — one row per asset per book. Wave A6 keeps exactly
 *    one book per asset (the statutory book); parallel tax books are excluded
 *    (ADR-0019 §2), so `book_code` is the tenant's own label and not a second
 *    dimension to reconcile.
 *
 *    `accumulated_depreciation` is a projection, not a source of truth: it is
 *    derived from the posted `finance_depreciation_run_lines` and exists so a
 *    list view does not have to aggregate every run. The run lines are what an
 *    audit reads.
 *
 *    The two GL accounts are configured per book rather than resolved from an
 *    asset-class table. An asset class with its own account mapping would be a
 *    second configuration surface for the same decision, and Wave A6 has no
 *    other consumer for it.
 *
 * 2. `finance_asset_book_events` — append-only capitalization / transfer /
 *    impairment / disposal facts. A correction is a reversal row via
 *    `reversal_of_id`, never an edit: the capitalization cost a disposal was
 *    computed from has to stay readable afterwards.
 *
 * 3. `finance_depreciation_runs` — one run per book per accounting period.
 *    Immutable once posted; a correction is a linked reversal run. The unique
 *    `idempotency_key` makes a retried run replay rather than post twice.
 *
 * 4. `finance_depreciation_run_lines` — the per-asset result of a run, carrying
 *    the amount and the accumulated balance before and after, so a single line
 *    explains itself without replaying the schedule.
 *
 * Money is exact 2-decimal integer cents (`numeric(18,2)`), matching
 * `general_ledger_entries`. A 4-decimal depreciation amount could never be
 * posted to a 2-decimal ledger without a rounding decision that this schema
 * would then hide.
 */

exports.up = (pgm) => {
  // Composite-key target for the ledger FK below. `accounting_ledgers` predates
  // the tenant-safe FK convention, so it gains one here rather than the asset
  // book carrying an unchecked `ledger_id`.
  pgm.addConstraint("accounting_ledgers", "accounting_ledgers_tenant_id_unique", {
    unique: ["tenant_id", "id"],
  });

  pgm.createTable("finance_asset_books", {
    id: { type: "uuid", primaryKey: true, default: pgm.func("gen_random_uuid()") },
    // Direct tenant ownership (GATE-3 migration-tenant-discipline).
    tenant_id: { type: "uuid", notNull: true, references: "tenants", onDelete: "CASCADE" },
    legal_entity_id: { type: "uuid", notNull: true },
    /** The ledger this book's postings belong to. */
    ledger_id: { type: "uuid", notNull: true },
    /** Asset Master parent — identity, custodian and location stay there. */
    asset_id: { type: "uuid", notNull: true },
    /** Tenant's own label for the book (e.g. "STATUTORY"). */
    book_code: { type: "varchar(40)", notNull: true },
    asset_class: { type: "varchar(60)", notNull: true },
    capitalization_date: { type: "date", notNull: true },
    /** Depreciation starts here; may follow capitalization when an asset is
     *  acquired before it is placed in service. */
    in_service_date: { type: "date", notNull: true },
    acquisition_cost: { type: "numeric(18,2)", notNull: true, check: "acquisition_cost >= 0" },
    residual_value: { type: "numeric(18,2)", notNull: true, default: "0.00", check: "residual_value >= 0" },
    useful_life_months: { type: "integer", notNull: true, check: "useful_life_months > 0" },
    /** Method is data, pinned to a version so a later method change cannot
     *  silently restate a posted schedule (ADR-0019 §3). */
    method_code: { type: "varchar(40)", notNull: true, default: "straight_line", check: `method_code IN ('straight_line')` },
    method_version: { type: "integer", notNull: true, default: 1, check: "method_version > 0" },
    /** Configured per book — see the table comment above. */
    depreciation_expense_account_id: { type: "uuid", notNull: true },
    accumulated_depreciation_account_id: { type: "uuid", notNull: true },
    status: {
      type: "varchar(20)",
      notNull: true,
      default: "draft",
      check: `status IN ('draft', 'active', 'disposed')`,
    },
    /** Projection of posted run lines. Never the basis for a posting. */
    accumulated_depreciation: { type: "numeric(18,2)", notNull: true, default: "0.00" },
    disposed_at: { type: "date" },
    created_by: { type: "uuid" },
    created_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
    updated_by: { type: "uuid" },
    updated_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
  });
  pgm.addConstraint("finance_asset_books", "finance_asset_books_life_check", {
    check: "in_service_date >= capitalization_date",
  });
  pgm.addConstraint("finance_asset_books", "finance_asset_books_residual_check", {
    check: "residual_value <= acquisition_cost",
  });
  // One book per asset in Wave A6 (parallel books are excluded).
  pgm.addConstraint("finance_asset_books", "finance_asset_books_asset_unique", {
    unique: ["tenant_id", "asset_id", "book_code"],
  });
  pgm.addConstraint("finance_asset_books", "finance_asset_books_tenant_id_unique", {
    unique: ["tenant_id", "id"],
  });
  pgm.addConstraint("finance_asset_books", "finance_ab_asset_tenant_safe", {
    foreignKeys: {
      columns: ["tenant_id", "asset_id"],
      references: "assets(tenant_id, id)",
      onDelete: "RESTRICT",
    },
  });
  pgm.addConstraint("finance_asset_books", "finance_ab_ledger_tenant_safe", {
    foreignKeys: {
      columns: ["tenant_id", "ledger_id"],
      references: "accounting_ledgers(tenant_id, id)",
      onDelete: "RESTRICT",
    },
  });
  pgm.addConstraint("finance_asset_books", "finance_ab_legal_entity_tenant_safe", {
    foreignKeys: {
      columns: ["tenant_id", "legal_entity_id"],
      references: "legal_entities(tenant_id, id)",
      onDelete: "CASCADE",
    },
  });
  pgm.addConstraint("finance_asset_books", "finance_ab_expense_account_tenant_safe", {
    foreignKeys: {
      columns: ["tenant_id", "depreciation_expense_account_id"],
      references: "accounting_accounts(tenant_id, id)",
      onDelete: "RESTRICT",
    },
  });
  pgm.addConstraint("finance_asset_books", "finance_ab_accum_account_tenant_safe", {
    foreignKeys: {
      columns: ["tenant_id", "accumulated_depreciation_account_id"],
      references: "accounting_accounts(tenant_id, id)",
      onDelete: "RESTRICT",
    },
  });
  pgm.createIndex("finance_asset_books", ["tenant_id", "legal_entity_id", "status"]);

  pgm.createTable("finance_asset_book_events", {
    id: { type: "uuid", primaryKey: true, default: pgm.func("gen_random_uuid()") },
    tenant_id: { type: "uuid", notNull: true, references: "tenants", onDelete: "CASCADE" },
    asset_book_id: { type: "uuid", notNull: true },
    event_type: {
      type: "varchar(20)",
      notNull: true,
      check: `event_type IN ('capitalization', 'transfer', 'impairment', 'disposal', 'reversal')`,
    },
    event_date: { type: "date", notNull: true },
    /** Signed amount for impairment/disposal; null for transfer. */
    amount: { type: "numeric(18,2)" },
    /** Evidence the event rests on — a document, not a free-text note. */
    evidence_document_id: { type: "uuid" },
    workflow_instance_id: { type: "uuid", references: "workflow_instances", onDelete: "SET NULL" },
    /** Journal the event produced, when it posted one. */
    journal_id: { type: "uuid" },
    /** A reversal points at the event it reverses. */
    reversal_of_id: { type: "uuid", references: "finance_asset_book_events", onDelete: "RESTRICT" },
    note: { type: "text" },
    idempotency_key: { type: "varchar(120)", notNull: true },
    created_by: { type: "uuid" },
    created_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
  });
  pgm.addConstraint("finance_asset_book_events", "finance_abe_idem_unique", {
    unique: ["tenant_id", "idempotency_key"],
  });
  pgm.addConstraint("finance_asset_book_events", "finance_abe_tenant_id_unique", {
    unique: ["tenant_id", "id"],
  });
  pgm.addConstraint("finance_asset_book_events", "finance_abe_book_tenant_safe", {
    foreignKeys: {
      columns: ["tenant_id", "asset_book_id"],
      references: "finance_asset_books(tenant_id, id)",
      onDelete: "CASCADE",
    },
  });
  pgm.createIndex("finance_asset_book_events", ["tenant_id", "asset_book_id", "event_date"]);

  pgm.createTable("finance_depreciation_runs", {
    id: { type: "uuid", primaryKey: true, default: pgm.func("gen_random_uuid()") },
    tenant_id: { type: "uuid", notNull: true, references: "tenants", onDelete: "CASCADE" },
    legal_entity_id: { type: "uuid", notNull: true },
    /** The tenant's book label. A run covers every active asset in that book
     *  for one period, so it is keyed by the label rather than by one asset's
     *  book row. */
    book_code: { type: "varchar(40)", notNull: true },
    period_id: { type: "uuid", notNull: true },
    status: {
      type: "varchar(20)",
      notNull: true,
      default: "posted",
      check: `status IN ('posted', 'reversed')`,
    },
    total_amount: { type: "numeric(18,2)", notNull: true },
    currency: { type: "varchar(3)", notNull: true },
    journal_id: { type: "uuid" },
    /** A reversing run points at the run it reverses. */
    reverses_run_id: { type: "uuid", references: "finance_depreciation_runs", onDelete: "RESTRICT" },
    idempotency_key: { type: "varchar(120)", notNull: true },
    created_by: { type: "uuid" },
    created_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
  });
  // One run per book per legal entity per period: a second run is a conflict,
  // not a correction. Scoped to the legal entity because a run posts one journal
  // and a journal belongs to exactly one legal entity.
  pgm.addConstraint("finance_depreciation_runs", "finance_dep_runs_period_unique", {
    unique: ["tenant_id", "legal_entity_id", "book_code", "period_id"],
  });
  pgm.addConstraint("finance_depreciation_runs", "finance_dep_runs_idem_unique", {
    unique: ["tenant_id", "idempotency_key"],
  });
  pgm.addConstraint("finance_depreciation_runs", "finance_dep_runs_tenant_id_unique", {
    unique: ["tenant_id", "id"],
  });
  pgm.addConstraint("finance_depreciation_runs", "finance_dr_legal_entity_tenant_safe", {
    foreignKeys: {
      columns: ["tenant_id", "legal_entity_id"],
      references: "legal_entities(tenant_id, id)",
      onDelete: "CASCADE",
    },
  });
  pgm.addConstraint("finance_depreciation_runs", "finance_dr_period_tenant_safe", {
    foreignKeys: {
      columns: ["tenant_id", "period_id"],
      references: "accounting_periods(tenant_id, id)",
      onDelete: "RESTRICT",
    },
  });

  pgm.createTable("finance_depreciation_run_lines", {
    id: { type: "uuid", primaryKey: true, default: pgm.func("gen_random_uuid()") },
    tenant_id: { type: "uuid", notNull: true, references: "tenants", onDelete: "CASCADE" },
    run_id: { type: "uuid", notNull: true },
    asset_book_id: { type: "uuid", notNull: true },
    amount: { type: "numeric(18,2)", notNull: true, check: "amount > 0" },
    accumulated_before: { type: "numeric(18,2)", notNull: true },
    accumulated_after: { type: "numeric(18,2)", notNull: true },
    /** True on the period that absorbs the rounding residual. */
    is_final_period: { type: "boolean", notNull: true, default: false },
    created_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
  });
  pgm.addConstraint("finance_depreciation_run_lines", "finance_drl_run_asset_unique", {
    unique: ["run_id", "asset_book_id"],
  });
  pgm.addConstraint("finance_depreciation_run_lines", "finance_drl_tenant_id_unique", {
    unique: ["tenant_id", "id"],
  });
  pgm.addConstraint("finance_depreciation_run_lines", "finance_drl_run_tenant_safe", {
    foreignKeys: {
      columns: ["tenant_id", "run_id"],
      references: "finance_depreciation_runs(tenant_id, id)",
      onDelete: "CASCADE",
    },
  });
  pgm.addConstraint("finance_depreciation_run_lines", "finance_drl_book_tenant_safe", {
    foreignKeys: {
      columns: ["tenant_id", "asset_book_id"],
      references: "finance_asset_books(tenant_id, id)",
      onDelete: "RESTRICT",
    },
  });
  pgm.createIndex("finance_depreciation_run_lines", ["tenant_id", "asset_book_id"]);
};

exports.down = (pgm) => {
  pgm.dropTable("finance_depreciation_run_lines", { ifExists: true });
  pgm.dropTable("finance_depreciation_runs", { ifExists: true });
  pgm.dropTable("finance_asset_book_events", { ifExists: true });
  pgm.dropTable("finance_asset_books", { ifExists: true });
  pgm.dropConstraint("accounting_ledgers", "accounting_ledgers_tenant_id_unique", { ifExists: true });
};
