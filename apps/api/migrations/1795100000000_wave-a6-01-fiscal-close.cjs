/**
 * Wave A6 WP-FIN-A6-01 — Fiscal close + ledger governance (ADR-0015 + ADR-0016).
 *
 * 1. `fiscal_closings` — append-only record of each month-end / year-end close
 *    run: the checklist evidence, the carry-forward totals (year-end), and the
 *    operator who ran it. Idempotent via UNIQUE(tenant_id, period_id, close_kind):
 *    a second run for the same period fails closed instead of double-closing.
 *
 * 2. `accounting_ledgers` — one active primary ledger per Legal Entity
 *    (ADR-0015 §3). Multi-ledger readiness is a contract only: the schema
 *    admits additional ledger rows, but `is_primary = true` is guarded to at
 *    most one per (tenant, legal entity) and only 'primary' may be active.
 *    Secondary/parallel/tax ledgers require separate Founder approval.
 */

exports.up = (pgm) => {
  // Tenant-safe composite FK target: accounting_periods was created with only
  // PRIMARY KEY(id) plus a business-key unique on (tenant, LE, FY, period_code).
  // Postgres requires an exact (tenant_id, id) unique to satisfy the composite
  // FK below — same pattern as accounting_accounts_tenant_id_unique.
  pgm.addConstraint("accounting_periods", "accounting_periods_tenant_id_unique", {
    unique: ["tenant_id", "id"],
  });

  pgm.createTable("fiscal_closings", {
    id: { type: "uuid", primaryKey: true, default: pgm.func("gen_random_uuid()") },
    tenant_id: { type: "uuid", notNull: true },
    legal_entity_id: { type: "uuid", notNull: true },
    period_id: { type: "uuid", notNull: true },
    fiscal_year_code: { type: "varchar(20)", notNull: true },
    close_kind: {
      type: "varchar(20)",
      notNull: true,
      check: `close_kind IN ('month_end', 'year_end')`,
    },
    /** Checklist evidence snapshot: counts per checkpoint at close time. */
    checklist: { type: "jsonb", notNull: true, default: "{}" },
    /** Year-end only: income/expense totals carried to retained earnings. */
    income_total: { type: "numeric(18,2)" },
    expense_total: { type: "numeric(18,2)" },
    retained_earnings_delta: { type: "numeric(18,2)" },
    /** Year-end only: the closing journal (income/expense -> Laba Ditahan). */
    closing_journal_id: { type: "uuid" },
    closed_by: { type: "uuid" },
    closed_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
    created_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
  });

  pgm.addConstraint("fiscal_closings", "fiscal_closings_period_kind_unique", {
    unique: ["tenant_id", "period_id", "close_kind"],
  });
  pgm.addConstraint("fiscal_closings", "fk_fiscal_closings_period_tenant_safe", {
    foreignKeys: {
      columns: ["tenant_id", "period_id"],
      references: "accounting_periods(tenant_id, id)",
      // Closings are period-owned history: they disappear with the period
      // (and thus with the tenant), same as every other tenant-safe FK here.
      onDelete: "cascade",
    },
  });
  pgm.createIndex("fiscal_closings", ["tenant_id", "legal_entity_id", "fiscal_year_code"]);

  pgm.createTable("accounting_ledgers", {
    id: { type: "uuid", primaryKey: true, default: pgm.func("gen_random_uuid()") },
    tenant_id: { type: "uuid", notNull: true },
    legal_entity_id: { type: "uuid", notNull: true },
    ledger_code: { type: "varchar(40)", notNull: true },
    ledger_name: { type: "varchar(120)", notNull: true },
    /**
     * 'primary' is the only runtime-active role in Wave A6. The check is the
     * multi-ledger compatibility seam (ADR-0015 §3): future roles are added
     * by a migration that widens this check with separate Founder approval.
     */
    ledger_role: {
      type: "varchar(20)",
      notNull: true,
      default: "primary",
      check: `ledger_role IN ('primary')`,
    },
    is_primary: { type: "boolean", notNull: true, default: true },
    is_active: { type: "boolean", notNull: true, default: true },
    currency: { type: "varchar(3)", notNull: true, default: "IDR" },
    created_by: { type: "uuid" },
    created_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
    updated_by: { type: "uuid" },
    updated_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
  });

  // At most ONE active primary ledger per (tenant, legal entity) — the ADR-0015
  // "one active primary ledger per Legal Entity" rule, enforced by the DB.
  pgm.createIndex(
    "accounting_ledgers",
    ["tenant_id", "legal_entity_id"],
    {
      unique: true,
      name: "accounting_ledgers_one_active_primary",
      where: "is_primary = true AND is_active = true",
    },
  );
  pgm.createIndex("accounting_ledgers", ["tenant_id", "legal_entity_id"]);

  // Tenant ownership: ledgers are tenant rows and must disappear with the
  // tenant (test cleanup relies on tenant CASCADE deletes).
  pgm.addConstraint("accounting_ledgers", "fk_accounting_ledgers_tenant", {
    foreignKeys: {
      columns: ["tenant_id"],
      references: "tenants(id)",
      onDelete: "cascade",
    },
  });
};

exports.down = (pgm) => {
  pgm.dropTable("accounting_ledgers", { ifExists: true });
  pgm.dropTable("fiscal_closings", { ifExists: true });
  pgm.dropConstraint("accounting_periods", "accounting_periods_tenant_id_unique", {
    ifExists: true,
  });
};
