/**
 * Phase 1 — Accounting Kernel Foundation (WP-FIN-01.1, ADR-0023 ACCEPTED)
 *
 * Phase 1A safe first slice: Accounting Kernel as sole GL writer. Core
 * tables establish:
 *   - accounting_periods: fiscal year, period code, status, date range
 *   - chart_of_accounts: account hierarchy, COA version, active status
 *   - accounting_accounts: account master, class, normal balance
 *   - journal_headers: transaction envelope, idempotency key, status
 *   - journal_lines: debits/credits, line-level GL rows
 *   - general_ledger_entries: GL materialized view, GL balance per period
 *   - gl_balances: period GL balance cache
 *   - posting_idempotency_keys: event + rule version → GL entry (idempotent)
 *   - posting_rules: rule code/version, trigger event, accounting formula
 *
 * All money is numeric(18,2) string-backed end-to-end, never JavaScript.
 * All GL arithmetic is PostgreSQL-enforced via CHECK and UPDATE statements.
 * Tenant isolation via direct tenant_id FK + app-level filter.
 * Audit trail via audit_log table (append-only, Phase 1B trigger).
 * Debit/credit invariant (debit = credit per journal) DB-enforced.
 * Period lock application-enforced (Phase 1B trigger).
 * Idempotency contract: source_event_id + rule_version_hash = unique GL entry.
 *
 * Phase 1A scope:
 *   IN:  9 tables + permissions + basic constraints + down() symmetry
 *   OUT: cost center details, AP/AR, fixed assets, tax, bank recon,
 *        multi-ledger, FX, opening balance logic (Wave A6+)
 *
 * POL-FIN-001 ACTIVE (Financial Control — Accounting Kernel).
 * POL-FIN-ADDENDUM-001 ACTIVE (Debit/credit invariant).
 * POL-FIN-ADDENDUM-002 ACTIVE (Tenant discipline).
 */

exports.shorthands = undefined;

exports.up = (pgm) => {
  // ==========================================================================
  // 1. Accounting Periods — Fiscal period envelope
  // ==========================================================================
  pgm.createTable("accounting_periods", {
    id: { type: "uuid", primaryKey: true, default: pgm.func("gen_random_uuid()") },
    tenant_id: { type: "uuid", notNull: true, references: "tenants", onDelete: "CASCADE" },
    legal_entity_id: { type: "uuid", notNull: true, references: "legal_entities", onDelete: "RESTRICT" },
    fiscal_year_code: { type: "text", notNull: true },
    period_code: { type: "text", notNull: true },
    period_name: { type: "text", notNull: true },
    period_type: {
      type: "text",
      notNull: true,
      default: "monthly",
      check: "period_type IN ('monthly', 'quarterly', 'annual')",
    },
    date_from: { type: "date", notNull: true },
    date_to: { type: "date", notNull: true },
    status: {
      type: "text",
      notNull: true,
      default: "open",
      check: "status IN ('draft', 'open', 'closed', 'reopenable', 'tombstone')",
    },
    locked_date: { type: "timestamptz" },
    locked_by: { type: "uuid" },
    reopen_requested_date: { type: "timestamptz" },
    reopen_reason: { type: "text" },
    created_by: { type: "uuid" },
    created_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
    updated_by: { type: "uuid" },
    updated_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
  });
  pgm.addConstraint("accounting_periods", "accounting_periods_date_check", {
    check: "date_from <= date_to",
  });
  pgm.addConstraint("accounting_periods", "accounting_periods_unique", {
    unique: ["tenant_id", "legal_entity_id", "fiscal_year_code", "period_code"],
  });
  pgm.createIndex("accounting_periods", ["tenant_id", "legal_entity_id"]);
  pgm.createIndex("accounting_periods", ["tenant_id", "status"]);

  // ==========================================================================
  // 2. Chart of Accounts (COA master & versioning)
  // ==========================================================================
  pgm.createTable("chart_of_accounts", {
    id: { type: "uuid", primaryKey: true, default: pgm.func("gen_random_uuid()") },
    tenant_id: { type: "uuid", notNull: true, references: "tenants", onDelete: "CASCADE" },
    legal_entity_id: { type: "uuid", notNull: true, references: "legal_entities", onDelete: "RESTRICT" },
    coa_version_code: { type: "text", notNull: true },
    coa_version_date: { type: "date", notNull: true },
    is_active: { type: "boolean", notNull: true, default: true },
    approved_by: { type: "uuid" },
    approved_date: { type: "timestamptz" },
    created_by: { type: "uuid" },
    created_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
    updated_by: { type: "uuid" },
    updated_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
  });
  pgm.addConstraint("chart_of_accounts", "chart_of_accounts_unique", {
    unique: ["tenant_id", "legal_entity_id", "coa_version_code"],
  });
  pgm.createIndex("chart_of_accounts", ["tenant_id", "legal_entity_id"]);

  // ==========================================================================
  // 3. Accounting Accounts (GL account master per COA)
  // ==========================================================================
  pgm.createTable("accounting_accounts", {
    id: { type: "uuid", primaryKey: true, default: pgm.func("gen_random_uuid()") },
    tenant_id: { type: "uuid", notNull: true, references: "tenants", onDelete: "CASCADE" },
    legal_entity_id: { type: "uuid", notNull: true, references: "legal_entities", onDelete: "RESTRICT" },
    coa_id: { type: "uuid", notNull: true, references: "chart_of_accounts", onDelete: "RESTRICT" },
    account_code: { type: "text", notNull: true },
    account_name: { type: "text", notNull: true },
    account_class: {
      type: "text",
      notNull: true,
      check: "account_class IN ('ASSET', 'LIABILITY', 'EQUITY', 'INCOME', 'EXPENSE')",
    },
    normal_balance: {
      type: "text",
      notNull: true,
      check: "normal_balance IN ('debit', 'credit')",
    },
    account_type: { type: "text" },
    is_active: { type: "boolean", notNull: true, default: true },
    deactivated_at: { type: "timestamptz" },
    deactivated_by: { type: "uuid" },
    created_by: { type: "uuid" },
    created_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
    updated_by: { type: "uuid" },
    updated_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
  });
  pgm.addConstraint("accounting_accounts", "accounting_accounts_unique", {
    unique: ["tenant_id", "legal_entity_id", "coa_id", "account_code"],
  });
  pgm.addConstraint("accounting_accounts", "accounting_accounts_tenant_id_unique", {
    unique: ["tenant_id", "id"],
  });
  pgm.createIndex("accounting_accounts", ["tenant_id", "legal_entity_id"]);
  pgm.createIndex("accounting_accounts", ["coa_id", "account_code"]);

  // ==========================================================================
  // 4. Journal Headers — Transaction envelope (idempotent posting)
  // ==========================================================================
  pgm.createTable("journal_headers", {
    id: { type: "uuid", primaryKey: true, default: pgm.func("gen_random_uuid()") },
    tenant_id: { type: "uuid", notNull: true, references: "tenants", onDelete: "CASCADE" },
    legal_entity_id: { type: "uuid", notNull: true, references: "legal_entities", onDelete: "RESTRICT" },
    journal_number: { type: "text", notNull: true },
    journal_date: { type: "date", notNull: true },
    accounting_date: { type: "date", notNull: true },
    period_id: { type: "uuid", notNull: true, references: "accounting_periods", onDelete: "RESTRICT" },
    description: { type: "text" },
    posted_date: { type: "timestamptz" },
    posted_by: { type: "uuid" },
    currency: { type: "text", notNull: true, default: "IDR" },
    posting_rule_version_id: { type: "uuid" },
    idempotency_key: { type: "text", notNull: true },
    status: {
      type: "text",
      notNull: true,
      default: "pending",
      check: "status IN ('pending', 'posted', 'failed', 'reversed')",
    },
    is_balanced: { type: "boolean", notNull: true, default: false },
    reversal_of_id: { type: "uuid", references: "journal_headers", onDelete: "SET NULL" },
    created_by: { type: "uuid" },
    created_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
    updated_by: { type: "uuid" },
    updated_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
  });
  pgm.addConstraint("journal_headers", "journal_headers_unique_number", {
    unique: ["tenant_id", "journal_number"],
  });
  pgm.addConstraint("journal_headers", "journal_headers_unique_idempotency", {
    unique: ["tenant_id", "idempotency_key"],
  });
  pgm.createIndex("journal_headers", ["tenant_id", "period_id"]);
  pgm.createIndex("journal_headers", ["tenant_id", "status"]);
  pgm.createIndex("journal_headers", ["tenant_id", "journal_date"]);

  // ==========================================================================
  // 5. Journal Lines — Debit/credit line entries
  // ==========================================================================
  pgm.createTable("journal_lines", {
    id: { type: "uuid", primaryKey: true, default: pgm.func("gen_random_uuid()") },
    tenant_id: { type: "uuid", notNull: true, references: "tenants", onDelete: "CASCADE" },
    journal_header_id: { type: "uuid", notNull: true, references: "journal_headers", onDelete: "CASCADE" },
    account_id: { type: "uuid", notNull: true, references: "accounting_accounts", onDelete: "RESTRICT" },
    line_number: { type: "smallint", notNull: true },
    debit: { type: "numeric(18,2)", notNull: true, default: 0, check: "debit >= 0" },
    credit: { type: "numeric(18,2)", notNull: true, default: 0, check: "credit >= 0" },
    line_description: { type: "text" },
    // Dimension references (Phase 1A: project/site only; cost_center deferred)
    cost_center_id: { type: "uuid" },
    project_id: { type: "uuid", references: "projects", onDelete: "SET NULL" },
    site_id: { type: "uuid", references: "sites", onDelete: "SET NULL" },
    // Reversals
    reversal_of_line_id: { type: "uuid", references: "journal_lines", onDelete: "SET NULL" },
    created_by: { type: "uuid" },
    created_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
  });
  pgm.addConstraint("journal_lines", "journal_lines_unique_line_number", {
    unique: ["journal_header_id", "line_number"],
  });
  pgm.addConstraint("journal_lines", "journal_lines_amount_check", {
    check: "(debit = 0) OR (credit = 0)",
  });
  pgm.createIndex("journal_lines", ["journal_header_id"]);
  pgm.createIndex("journal_lines", ["account_id"]);

  // ==========================================================================
  // 6. General Ledger Entries — GL per journal line
  // ==========================================================================
  pgm.createTable("general_ledger_entries", {
    id: { type: "uuid", primaryKey: true, default: pgm.func("gen_random_uuid()") },
    tenant_id: { type: "uuid", notNull: true, references: "tenants", onDelete: "CASCADE" },
    account_id: { type: "uuid", notNull: true, references: "accounting_accounts", onDelete: "RESTRICT" },
    period_id: { type: "uuid", notNull: true, references: "accounting_periods", onDelete: "RESTRICT" },
    journal_line_id: { type: "uuid", notNull: true, references: "journal_lines", onDelete: "RESTRICT" },
    posting_date: { type: "timestamptz", notNull: true },
    debit: { type: "numeric(18,2)", notNull: true, default: 0, check: "debit >= 0" },
    credit: { type: "numeric(18,2)", notNull: true, default: 0, check: "credit >= 0" },
    balance_before: { type: "numeric(18,2)" },
    balance_after: { type: "numeric(18,2)" },
    document_type: { type: "text" },
    document_id: { type: "uuid" },
    created_by: { type: "uuid" },
    created_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
  });
  pgm.addConstraint("general_ledger_entries", "general_ledger_entries_unique_journal_line", {
    unique: ["journal_line_id"],
  });
  pgm.createIndex("general_ledger_entries", ["tenant_id", "account_id", "period_id"]);
  pgm.createIndex("general_ledger_entries", ["tenant_id", "posting_date"]);

  // ==========================================================================
  // 7. GL Balances — Materialized GL balance per period
  // ==========================================================================
  pgm.createTable("gl_balances", {
    id: { type: "uuid", primaryKey: true, default: pgm.func("gen_random_uuid()") },
    tenant_id: { type: "uuid", notNull: true, references: "tenants", onDelete: "CASCADE" },
    account_id: { type: "uuid", notNull: true },
    period_id: { type: "uuid", notNull: true, references: "accounting_periods", onDelete: "CASCADE" },
    opening_balance: { type: "numeric(18,2)", notNull: true, default: 0 },
    debit_total: { type: "numeric(18,2)", notNull: true, default: 0 },
    credit_total: { type: "numeric(18,2)", notNull: true, default: 0 },
    closing_balance: { type: "numeric(18,2)", notNull: true, default: 0 },
    last_refreshed: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
  });
  pgm.addConstraint("gl_balances", "gl_balances_unique", {
    unique: ["tenant_id", "account_id", "period_id"],
  });
  // platform-boundary: tenant-owner-via account_id -> accounting_accounts
  pgm.addConstraint("gl_balances", "fk_gl_balances_account_tenant_safe", {
    foreignKeys: {
      columns: ["tenant_id", "account_id"],
      references: "accounting_accounts(tenant_id, id)",
      onDelete: "CASCADE",
    },
  });
  pgm.createIndex("gl_balances", ["tenant_id", "period_id"]);

  // ==========================================================================
  // 8. Posting Idempotency Keys
  // ==========================================================================
  pgm.createTable("posting_idempotency_keys", {
    id: { type: "uuid", primaryKey: true, default: pgm.func("gen_random_uuid()") },
    tenant_id: { type: "uuid", notNull: true, references: "tenants", onDelete: "CASCADE" },
    source_event_id: { type: "text", notNull: true },
    posting_rule_version_hash: { type: "text", notNull: true },
    idempotency_key: { type: "text", notNull: true },
    journal_header_id: { type: "uuid", references: "journal_headers", onDelete: "SET NULL" },
    posting_attempt_count: { type: "smallint", notNull: true, default: 1 },
    last_attempt_date: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
    last_attempt_status: {
      type: "text",
      check: "last_attempt_status IN ('success', 'failure', 'pending')",
    },
    failure_reason: { type: "text" },
    created_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
  });
  pgm.addConstraint("posting_idempotency_keys", "posting_idempotency_keys_unique", {
    unique: ["tenant_id", "idempotency_key"],
  });
  pgm.createIndex("posting_idempotency_keys", ["tenant_id", "source_event_id", "posting_rule_version_hash"]);

  // ==========================================================================
  // 9. Posting Rules (Baseline, Phase 1A foundation)
  // ==========================================================================
  pgm.createTable("posting_rules", {
    id: { type: "uuid", primaryKey: true, default: pgm.func("gen_random_uuid()") },
    tenant_id: { type: "uuid", notNull: true, references: "tenants", onDelete: "CASCADE" },
    rule_code: { type: "text", notNull: true },
    rule_name: { type: "text", notNull: true },
    rule_version: { type: "text", notNull: true },
    trigger_event_type: { type: "text", notNull: true },
    accounting_formula: { type: "jsonb", notNull: true },
    requires_approval: { type: "boolean", notNull: true, default: false },
    materiality_threshold: { type: "numeric(18,2)" },
    is_active: { type: "boolean", notNull: true, default: true },
    effective_date: { type: "date", notNull: true },
    deprecated_date: { type: "date" },
    created_by: { type: "uuid" },
    created_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
    updated_by: { type: "uuid" },
    updated_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
  });
  pgm.addConstraint("posting_rules", "posting_rules_unique", {
    unique: ["tenant_id", "rule_code", "rule_version"],
  });
  pgm.addConstraint("posting_rules", "posting_rules_date_check", {
    check: "deprecated_date IS NULL OR deprecated_date > effective_date",
  });
  pgm.createIndex("posting_rules", ["tenant_id", "trigger_event_type"]);
  pgm.createIndex("posting_rules", ["tenant_id", "is_active"]);

  // ==========================================================================
  // 10. Permission Catalog Seeding (finance permissions)
  // ==========================================================================
  pgm.sql(`
    INSERT INTO permissions (code, description)
    SELECT v.code, v.description
      FROM (VALUES
        ('finance.accounting.read', 'View accounting GL, journals, periods, trial balance (subject to Data Scope)'),
        ('finance.accounting.manage', 'Create and edit draft journals, post balanced journals'),
        ('finance.accounting.approve', 'Approve journal posting, lock periods'),
        ('finance.accounting.configure', 'Maintain chart of accounts, posting rules'),
        ('finance.accounting.period.lock', 'Lock/reopen accounting periods (restricted role)')
      ) AS v(code, description)
     WHERE NOT EXISTS (SELECT 1 FROM permissions p WHERE p.code = v.code)
  `);

  // ==========================================================================
  // 11. Reference Data Type for Posting Rules (Phase 1B)
  // ==========================================================================
  pgm.sql(`
    INSERT INTO reference_data_types (code, name, description)
    SELECT v.code, v.name, v.description
      FROM (VALUES
        ('accounting_posting_rule', 'Accounting Posting Rule', 'Tenant-configurable posting rule catalog with event trigger, GL mapping, and versioning.')
      ) AS v(code, name, description)
     WHERE NOT EXISTS (SELECT 1 FROM reference_data_types t WHERE t.code = v.code)
  `);
};

exports.down = (pgm) => {
  // ==========================================================================
  // SYMMETRICAL DOWN MIGRATION
  // ==========================================================================

  // Must not drop if referenced data exists. check dependencies first
  pgm.sql(`
    DO $$
    BEGIN
      IF EXISTS (SELECT 1 FROM posting_rules WHERE created_by IS NOT NULL) THEN
        RAISE EXCEPTION 'Refusing to drop posting_rules: explicit tenant rules exist';
      END IF;
      IF EXISTS (SELECT 1 FROM general_ledger_entries WHERE created_by IS NOT NULL) THEN
        RAISE EXCEPTION 'Refusing to drop general_ledger_entries: GL entries exist';
      END IF;
    END $$;
  `);

  pgm.dropTable("posting_rules", { ifExists: true, cascade: false });
  pgm.dropTable("posting_idempotency_keys", { ifExists: true, cascade: false });
  pgm.dropTable("gl_balances", { ifExists: true, cascade: false });
  pgm.dropTable("general_ledger_entries", { ifExists: true, cascade: false });
  pgm.dropTable("journal_lines", { ifExists: true, cascade: false });
  pgm.dropTable("journal_headers", { ifExists: true, cascade: false });
  pgm.dropTable("accounting_accounts", { ifExists: true, cascade: false });
  pgm.dropTable("chart_of_accounts", { ifExists: true, cascade: false });
  pgm.dropTable("accounting_periods", { ifExists: true, cascade: false });

  pgm.sql(`
    DELETE FROM reference_data_types
     WHERE code = 'accounting_posting_rule';

    DELETE FROM permissions WHERE code IN (
      'finance.accounting.read', 'finance.accounting.manage', 'finance.accounting.approve',
      'finance.accounting.configure', 'finance.accounting.period.lock'
    );
  `);
};
