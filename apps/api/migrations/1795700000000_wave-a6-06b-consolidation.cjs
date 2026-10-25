/**
 * Wave A6 WP-FIN-A6-06b — Consolidation baseline (ADR-0022 §1).
 *
 * Same-tenant only, by construction: every table carries `tenant_id` and every
 * child references its parent through `(tenant_id, id)`, so a group can never
 * name an entity from another tenant.
 *
 * 1. `finance_consolidation_groups` — the group itself, with ONE reporting
 *    currency. A group is activation-gated through the Workflow Engine: it is a
 *    reporting perimeter, and a perimeter nobody approved would silently widen
 *    who sees whose numbers.
 *
 * 2. `finance_consolidation_group_entities` — effective-dated membership. An
 *    entity leaving the group closes its row rather than being deleted, so a
 *    report dated before the change still resolves the perimeter it had.
 *
 * 3. `finance_fsv_versions` / `finance_fsv_lines` — the Financial Statement
 *    Version: a closed metamodel mapping accounts to named lines. There is no
 *    expression, formula or script column anywhere: a line is a set of accounts
 *    summed with a stated sign (ADR-0022 §4). Versions are effective-dated and
 *    approval-gated, and a version used by a closed period is never edited — a
 *    change is a new version.
 *
 * 4. `finance_fx_rate_sets` / `finance_fx_rates` — effective-dated rate sets.
 *    A rate is `numeric(18,8)`, kept exact as a string; a set carries one rate
 *    per currency pair per type (closing / average / historical).
 *
 * 5. `finance_translation_runs` / `finance_translation_run_lines` — one run per
 *    group per period. Every translated amount and the rate that produced it
 *    are stored on the line, so a historical report never has to re-derive a
 *    rate that has since changed. The residual is a column, not a guess.
 *
 * 6. `finance_eliminations` — a governed elimination is a real journal, so this
 *    table holds the perimeter and the lifecycle and points at the kernel's
 *    journal for the amounts. The Accounting Kernel stays the sole GL writer
 *    (ADR-0023): the elimination is drafted there and posted there.
 *
 * Money is `numeric(18,2)` to match `general_ledger_entries`; a translated
 * figure that cannot be posted to the ledger is not a reporting figure.
 */

exports.up = (pgm) => {
  // `accounting_accounts_tenant_id_unique` and `accounting_periods_tenant_id_unique`
  // already exist (phase-1a kernel), which is what lets the composite
  // `(tenant_id, id)` FKs below be tenant-safe.

  // ---------------------------------------------------------------------
  // 1. Group
  // ---------------------------------------------------------------------
  pgm.createTable("finance_consolidation_groups", {
    id: { type: "uuid", primaryKey: true, default: pgm.func("gen_random_uuid()") },
    tenant_id: { type: "uuid", notNull: true, references: "tenants", onDelete: "CASCADE" },
    group_code: { type: "varchar(40)", notNull: true },
    name: { type: "varchar(200)", notNull: true },
    /** The single currency every member is translated into (ADR-0022 §1). */
    reporting_currency: { type: "varchar(3)", notNull: true },
    /** The account a translation residual lands in. Configured, never derived. */
    translation_difference_account_id: { type: "uuid" },
    status: { type: "varchar(16)", notNull: true, default: "draft", check: `status IN ('draft','active','archived')` },
    workflow_instance_id: { type: "uuid", references: "workflow_instances", onDelete: "SET NULL" },
    approved_by: { type: "uuid" },
    approved_at: { type: "timestamp with time zone" },
    created_by: { type: "uuid" },
    created_at: { type: "timestamp with time zone", notNull: true, default: pgm.func("now()") },
    updated_at: { type: "timestamp with time zone", notNull: true, default: pgm.func("now()") },
  });
  pgm.addConstraint("finance_consolidation_groups", "fcg_code_unique", {
    unique: ["tenant_id", "group_code"],
  });
  pgm.addConstraint("finance_consolidation_groups", "fcg_tenant_id_unique", {
    unique: ["tenant_id", "id"],
  });
  pgm.addConstraint("finance_consolidation_groups", "fcg_td_account_tenant_safe", {
    foreignKeys: {
      columns: ["tenant_id", "translation_difference_account_id"],
      references: "accounting_accounts(tenant_id, id)",
      onDelete: "RESTRICT",
    },
  });

  // ---------------------------------------------------------------------
  // 2. Membership
  // ---------------------------------------------------------------------
  pgm.createTable("finance_consolidation_group_entities", {
    id: { type: "uuid", primaryKey: true, default: pgm.func("gen_random_uuid()") },
    tenant_id: { type: "uuid", notNull: true, references: "tenants", onDelete: "CASCADE" },
    group_id: { type: "uuid", notNull: true },
    legal_entity_id: { type: "uuid", notNull: true },
    effective_from: { type: "date", notNull: true },
    /** Exclusive: the day an entity leaves belongs to nobody. */
    effective_to: { type: "date" },
    created_by: { type: "uuid" },
    created_at: { type: "timestamp with time zone", notNull: true, default: pgm.func("now()") },
  });
  pgm.addConstraint("finance_consolidation_group_entities", "fcge_membership_unique", {
    unique: ["tenant_id", "group_id", "legal_entity_id", "effective_from"],
  });
  pgm.addConstraint("finance_consolidation_group_entities", "fcge_window_check", {
    check: "effective_to IS NULL OR effective_to > effective_from",
  });
  pgm.addConstraint("finance_consolidation_group_entities", "fcge_group_tenant_safe", {
    foreignKeys: {
      columns: ["tenant_id", "group_id"],
      references: "finance_consolidation_groups(tenant_id, id)",
      onDelete: "CASCADE",
    },
  });
  pgm.addConstraint("finance_consolidation_group_entities", "fcge_entity_tenant_safe", {
    foreignKeys: {
      columns: ["tenant_id", "legal_entity_id"],
      references: "legal_entities(tenant_id, id)",
      onDelete: "CASCADE",
    },
  });

  // ---------------------------------------------------------------------
  // 3. Financial Statement Version
  // ---------------------------------------------------------------------
  pgm.createTable("finance_fsv_versions", {
    id: { type: "uuid", primaryKey: true, default: pgm.func("gen_random_uuid()") },
    tenant_id: { type: "uuid", notNull: true, references: "tenants", onDelete: "CASCADE" },
    fsv_code: { type: "varchar(40)", notNull: true },
    version_number: { type: "integer", notNull: true, check: "version_number > 0" },
    description: { type: "text" },
    status: { type: "varchar(16)", notNull: true, default: "draft", check: `status IN ('draft','approved','superseded')` },
    effective_from: { type: "date", notNull: true },
    effective_to: { type: "date" },
    workflow_instance_id: { type: "uuid", references: "workflow_instances", onDelete: "SET NULL" },
    approved_by: { type: "uuid" },
    approved_at: { type: "timestamp with time zone" },
    created_by: { type: "uuid" },
    created_at: { type: "timestamp with time zone", notNull: true, default: pgm.func("now()") },
  });
  pgm.addConstraint("finance_fsv_versions", "ffv_version_unique", {
    unique: ["tenant_id", "fsv_code", "version_number"],
  });
  pgm.addConstraint("finance_fsv_versions", "ffv_tenant_id_unique", {
    unique: ["tenant_id", "id"],
  });
  pgm.addConstraint("finance_fsv_versions", "ffv_window_check", {
    check: "effective_to IS NULL OR effective_to > effective_from",
  });

  pgm.createTable("finance_fsv_lines", {
    id: { type: "uuid", primaryKey: true, default: pgm.func("gen_random_uuid()") },
    tenant_id: { type: "uuid", notNull: true, references: "tenants", onDelete: "CASCADE" },
    fsv_version_id: { type: "uuid", notNull: true },
    line_code: { type: "varchar(40)", notNull: true },
    line_name: { type: "varchar(200)", notNull: true },
    statement_type: {
      type: "varchar(20)",
      notNull: true,
      check: `statement_type IN ('trial_balance','balance_sheet','profit_loss','cash_flow')`,
    },
    /** Null for a line that only totals its children. */
    account_id: { type: "uuid" },
    /** Closed metamodel: a line sums, or it flips the sign. Nothing else. */
    sign: { type: "varchar(8)", notNull: true, default: "as_is", check: `sign IN ('as_is','flip')` },
    sequence_order: { type: "integer", notNull: true, default: 0 },
    /** The parent line this one totals into, within the same version. */
    parent_line_code: { type: "varchar(40)" },
    created_at: { type: "timestamp with time zone", notNull: true, default: pgm.func("now()") },
  });
  pgm.addConstraint("finance_fsv_lines", "ffl_line_unique", {
    unique: ["tenant_id", "fsv_version_id", "line_code"],
  });
  pgm.addConstraint("finance_fsv_lines", "ffl_version_tenant_safe", {
    foreignKeys: {
      columns: ["tenant_id", "fsv_version_id"],
      references: "finance_fsv_versions(tenant_id, id)",
      onDelete: "CASCADE",
    },
  });
  pgm.addConstraint("finance_fsv_lines", "ffl_account_tenant_safe", {
    foreignKeys: {
      columns: ["tenant_id", "account_id"],
      references: "accounting_accounts(tenant_id, id)",
      onDelete: "RESTRICT",
    },
  });

  // ---------------------------------------------------------------------
  // 4. Exchange rates
  // ---------------------------------------------------------------------
  pgm.createTable("finance_fx_rate_sets", {
    id: { type: "uuid", primaryKey: true, default: pgm.func("gen_random_uuid()") },
    tenant_id: { type: "uuid", notNull: true, references: "tenants", onDelete: "CASCADE" },
    set_code: { type: "varchar(40)", notNull: true },
    name: { type: "varchar(200)", notNull: true },
    effective_from: { type: "date", notNull: true },
    effective_to: { type: "date" },
    status: { type: "varchar(16)", notNull: true, default: "active", check: `status IN ('active','archived')` },
    created_by: { type: "uuid" },
    created_at: { type: "timestamp with time zone", notNull: true, default: pgm.func("now()") },
  });
  pgm.addConstraint("finance_fx_rate_sets", "ffrs_code_unique", {
    unique: ["tenant_id", "set_code", "effective_from"],
  });
  pgm.addConstraint("finance_fx_rate_sets", "ffrs_tenant_id_unique", {
    unique: ["tenant_id", "id"],
  });
  pgm.addConstraint("finance_fx_rate_sets", "ffrs_window_check", {
    check: "effective_to IS NULL OR effective_to > effective_from",
  });

  pgm.createTable("finance_fx_rates", {
    id: { type: "uuid", primaryKey: true, default: pgm.func("gen_random_uuid()") },
    tenant_id: { type: "uuid", notNull: true, references: "tenants", onDelete: "CASCADE" },
    rate_set_id: { type: "uuid", notNull: true },
    from_currency: { type: "varchar(3)", notNull: true },
    to_currency: { type: "varchar(3)", notNull: true },
    /** Closing for the balance sheet, average for the P&L, historical for
     *  equity — the three a translation needs, and no more. */
    rate_type: { type: "varchar(12)", notNull: true, check: `rate_type IN ('closing','average','historical')` },
    /** Exact decimal, never a float. 1 from_currency = `rate` to_currency. */
    rate: { type: "numeric(18,8)", notNull: true, check: "rate > 0" },
    created_at: { type: "timestamp with time zone", notNull: true, default: pgm.func("now()") },
  });
  pgm.addConstraint("finance_fx_rates", "ffr_rate_unique", {
    unique: ["tenant_id", "rate_set_id", "from_currency", "to_currency", "rate_type"],
  });
  pgm.addConstraint("finance_fx_rates", "ffr_set_tenant_safe", {
    foreignKeys: {
      columns: ["tenant_id", "rate_set_id"],
      references: "finance_fx_rate_sets(tenant_id, id)",
      onDelete: "CASCADE",
    },
  });

  // ---------------------------------------------------------------------
  // 5. Translation
  // ---------------------------------------------------------------------
  pgm.createTable("finance_translation_runs", {
    id: { type: "uuid", primaryKey: true, default: pgm.func("gen_random_uuid()") },
    tenant_id: { type: "uuid", notNull: true, references: "tenants", onDelete: "CASCADE" },
    group_id: { type: "uuid", notNull: true },
    period_id: { type: "uuid", notNull: true },
    rate_set_id: { type: "uuid", notNull: true },
    fsv_version_id: { type: "uuid", notNull: true },
    reporting_currency: { type: "varchar(3)", notNull: true },
    /** Sum of translated amounts per member, in the reporting currency. */
    translated_total: { type: "numeric(18,2)", notNull: true, default: "0.00" },
    /** What the translation could not place — posted to the configured account. */
    residual_amount: { type: "numeric(18,2)", notNull: true, default: "0.00" },
    status: { type: "varchar(16)", notNull: true, default: "computed", check: `status IN ('computed','posted','reversed')` },
    journal_id: { type: "uuid" },
    idempotency_key: { type: "varchar(120)", notNull: true },
    created_by: { type: "uuid" },
    created_at: { type: "timestamp with time zone", notNull: true, default: pgm.func("now()") },
  });
  pgm.addConstraint("finance_translation_runs", "ftr_idempotency_unique", {
    unique: ["tenant_id", "idempotency_key"],
  });
  pgm.addConstraint("finance_translation_runs", "ftr_tenant_id_unique", {
    unique: ["tenant_id", "id"],
  });
  pgm.addConstraint("finance_translation_runs", "ftr_group_tenant_safe", {
    foreignKeys: {
      columns: ["tenant_id", "group_id"],
      references: "finance_consolidation_groups(tenant_id, id)",
      onDelete: "CASCADE",
    },
  });
  pgm.addConstraint("finance_translation_runs", "ftr_period_tenant_safe", {
    foreignKeys: {
      columns: ["tenant_id", "period_id"],
      references: "accounting_periods(tenant_id, id)",
      onDelete: "RESTRICT",
    },
  });
  pgm.addConstraint("finance_translation_runs", "ftr_rate_set_tenant_safe", {
    foreignKeys: {
      columns: ["tenant_id", "rate_set_id"],
      references: "finance_fx_rate_sets(tenant_id, id)",
      onDelete: "RESTRICT",
    },
  });
  pgm.addConstraint("finance_translation_runs", "ftr_fsv_tenant_safe", {
    foreignKeys: {
      columns: ["tenant_id", "fsv_version_id"],
      references: "finance_fsv_versions(tenant_id, id)",
      onDelete: "RESTRICT",
    },
  });

  pgm.createTable("finance_translation_run_lines", {
    id: { type: "uuid", primaryKey: true, default: pgm.func("gen_random_uuid()") },
    tenant_id: { type: "uuid", notNull: true, references: "tenants", onDelete: "CASCADE" },
    run_id: { type: "uuid", notNull: true },
    legal_entity_id: { type: "uuid", notNull: true },
    account_id: { type: "uuid", notNull: true },
    source_currency: { type: "varchar(3)", notNull: true },
    source_amount: { type: "numeric(18,2)", notNull: true },
    rate: { type: "numeric(18,8)", notNull: true },
    rate_type: { type: "varchar(12)", notNull: true },
    translated_amount: { type: "numeric(18,2)", notNull: true },
    created_at: { type: "timestamp with time zone", notNull: true, default: pgm.func("now()") },
  });
  pgm.addConstraint("finance_translation_run_lines", "ftrl_unique", {
    unique: ["tenant_id", "run_id", "legal_entity_id", "account_id"],
  });
  pgm.addConstraint("finance_translation_run_lines", "ftrl_run_tenant_safe", {
    foreignKeys: {
      columns: ["tenant_id", "run_id"],
      references: "finance_translation_runs(tenant_id, id)",
      onDelete: "CASCADE",
    },
  });
  pgm.addConstraint("finance_translation_run_lines", "ftrl_account_tenant_safe", {
    foreignKeys: {
      columns: ["tenant_id", "account_id"],
      references: "accounting_accounts(tenant_id, id)",
      onDelete: "RESTRICT",
    },
  });

  // ---------------------------------------------------------------------
  // 6. Eliminations
  // ---------------------------------------------------------------------
  pgm.createTable("finance_eliminations", {
    id: { type: "uuid", primaryKey: true, default: pgm.func("gen_random_uuid()") },
    tenant_id: { type: "uuid", notNull: true, references: "tenants", onDelete: "CASCADE" },
    group_id: { type: "uuid", notNull: true },
    period_id: { type: "uuid", notNull: true },
    description: { type: "text", notNull: true },
    amount: { type: "numeric(18,2)", notNull: true, check: "amount > 0" },
    currency: { type: "varchar(3)", notNull: true },
    /** The journal this elimination drafted; the kernel owns the amounts. */
    journal_id: { type: "uuid" },
    status: { type: "varchar(16)", notNull: true, default: "draft", check: `status IN ('draft','approved','posted','reversed')` },
    workflow_instance_id: { type: "uuid", references: "workflow_instances", onDelete: "SET NULL" },
    approved_by: { type: "uuid" },
    approved_at: { type: "timestamp with time zone" },
    idempotency_key: { type: "varchar(120)", notNull: true },
    created_by: { type: "uuid" },
    created_at: { type: "timestamp with time zone", notNull: true, default: pgm.func("now()") },
  });
  pgm.addConstraint("finance_eliminations", "felim_idempotency_unique", {
    unique: ["tenant_id", "idempotency_key"],
  });
  pgm.addConstraint("finance_eliminations", "felim_group_tenant_safe", {
    foreignKeys: {
      columns: ["tenant_id", "group_id"],
      references: "finance_consolidation_groups(tenant_id, id)",
      onDelete: "CASCADE",
    },
  });
  pgm.addConstraint("finance_eliminations", "felim_period_tenant_safe", {
    foreignKeys: {
      columns: ["tenant_id", "period_id"],
      references: "accounting_periods(tenant_id, id)",
      onDelete: "RESTRICT",
    },
  });

  pgm.createIndex("finance_consolidation_group_entities", ["tenant_id", "legal_entity_id"]);
  pgm.createIndex("finance_fsv_lines", ["tenant_id", "fsv_version_id", "statement_type"]);
  pgm.createIndex("finance_eliminations", ["tenant_id", "group_id", "period_id"]);
};

exports.down = (pgm) => {
  pgm.dropTable("finance_eliminations");
  pgm.dropTable("finance_translation_run_lines");
  pgm.dropTable("finance_translation_runs");
  pgm.dropTable("finance_fx_rates");
  pgm.dropTable("finance_fx_rate_sets");
  pgm.dropTable("finance_fsv_lines");
  pgm.dropTable("finance_fsv_versions");
  pgm.dropTable("finance_consolidation_group_entities");
  pgm.dropTable("finance_consolidation_groups");
};
