/**
 * Wave A6 WP-FIN-A6-03 — Budget control + accounting dimensions (ADR-0020).
 *
 * 1. `finance_budgets` — the governed budget scope: Legal Entity + fiscal
 *    year + scenario + the accounting dimensions it governs (cost center,
 *    project, site, account range). One row per scope per fiscal year.
 *
 * 2. `finance_budget_versions` — immutable versioned baselines (ADR-0020 §2).
 *    Draft revisions go through the Workflow Engine for maker-checker
 *    approval; approval makes a version `active` and supersedes the previous
 *    active one. Approved versions are never edited in place.
 *
 * 3. `finance_budget_lines` — period distribution per version, exact decimal
 *    (numeric 18,4). Residual absorption is deterministic in the service.
 *
 * 4. `finance_budget_policies` — control behavior per policy (ADR-0020 §3):
 *    'advisory' | 'escalation' | 'hard_stop', scoped by Legal Entity,
 *    document type, cost center, project, account range, amount threshold,
 *    and effective-dated. No universal hard-stop default is seeded.
 *
 * 5. `finance_budget_consumptions` — idempotent, concurrency-safe ledger of
 *    actual / commitment / adjustment / release rows (ADR-0020 §4). Releases
 *    are compensating rows (`reverses_id`), never deletes. Available budget
 *    is derived, never stored.
 */

exports.up = (pgm) => {
  pgm.createTable("finance_budgets", {
    id: { type: "uuid", primaryKey: true, default: pgm.func("gen_random_uuid()") },
    tenant_id: { type: "uuid", notNull: true, references: "tenants", onDelete: "CASCADE" },
    legal_entity_id: { type: "uuid", notNull: true },
    fiscal_year_code: { type: "varchar(20)", notNull: true },
    scenario: {
      type: "varchar(20)",
      notNull: true,
      default: "original",
      check: `scenario IN ('original', 'revision', 'forecast')`,
    },
    currency: { type: "varchar(3)", notNull: true, default: "IDR" },
    name: { type: "varchar(120)", notNull: true },
    owner_user_id: { type: "uuid" },
    // Accounting-dimension scope (ADR-0020 §1): never a Finance-only tree,
    // never encoded into a COA number. NULL = the whole Legal Entity.
    cost_center_id: { type: "uuid" },
    project_id: { type: "uuid" },
    site_id: { type: "uuid" },
    account_from: { type: "varchar(40)" },
    account_to: { type: "varchar(40)" },
    active_version_id: { type: "uuid" },
    created_by: { type: "uuid" },
    created_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
    updated_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
  });
  // One governed budget per scope key + fiscal year + scenario. COALESCE
  // because Postgres UNIQUE treats NULLs as distinct — a Legal-Entity-wide
  // budget (all-NULL dimensions) must not be duplicable either.
  pgm.sql(`
    CREATE UNIQUE INDEX finance_budgets_scope_unique
      ON finance_budgets (
        tenant_id, legal_entity_id, fiscal_year_code, scenario,
        COALESCE(cost_center_id, '00000000-0000-0000-0000-000000000000'::uuid),
        COALESCE(project_id, '00000000-0000-0000-0000-000000000000'::uuid),
        COALESCE(site_id, '00000000-0000-0000-0000-000000000000'::uuid),
        COALESCE(account_from, ''), COALESCE(account_to, '')
      );
  `);
  pgm.createIndex("finance_budgets", ["tenant_id", "legal_entity_id", "fiscal_year_code"]);
  // Composite key target for tenant-safe child FKs: a version, line or
  // consumption can never point at another tenant's budget (same posture as
  // finance_open_items in WP-FIN-A6-02).
  pgm.addConstraint("finance_budgets", "finance_budgets_tenant_id_unique", {
    unique: ["tenant_id", "id"],
  });

  pgm.createTable("finance_budget_versions", {
    id: { type: "uuid", primaryKey: true, default: pgm.func("gen_random_uuid()") },
    tenant_id: { type: "uuid", notNull: true, references: "tenants", onDelete: "CASCADE" },
    budget_id: {
      type: "uuid",
      notNull: true,
    },
    version_number: { type: "integer", notNull: true },
    status: {
      type: "varchar(20)",
      notNull: true,
      default: "draft",
      check: `status IN ('draft', 'active', 'superseded', 'rejected')`,
    },
    supersedes_version_id: { type: "uuid" },
    workflow_instance_id: { type: "uuid" },
    note: { type: "text" },
    created_by: { type: "uuid" },
    created_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
    approved_by: { type: "uuid" },
    approved_at: { type: "timestamptz" },
  });
  pgm.addConstraint("finance_budget_versions", "finance_budget_versions_budget_version_unique", {
    unique: ["budget_id", "version_number"],
  });
  pgm.addConstraint("finance_budget_versions", "finance_budget_versions_tenant_id_unique", {
    unique: ["tenant_id", "id"],
  });
  pgm.addConstraint("finance_budget_versions", "finance_bv_budget_tenant_safe", {
    foreignKeys: {
      columns: ["tenant_id", "budget_id"],
      references: "finance_budgets(tenant_id, id)",
      onDelete: "CASCADE",
    },
  });
  // At most ONE active version per budget (ADR-0020 §2) — enforced by the DB.
  pgm.createIndex(
    "finance_budget_versions",
    ["budget_id"],
    { unique: true, name: "finance_budget_versions_one_active", where: "status = 'active'" },
  );
  pgm.createIndex("finance_budget_versions", ["tenant_id", "budget_id"]);

  pgm.createTable("finance_budget_lines", {
    id: { type: "uuid", primaryKey: true, default: pgm.func("gen_random_uuid()") },
    tenant_id: { type: "uuid", notNull: true, references: "tenants", onDelete: "CASCADE" },
    budget_version_id: {
      type: "uuid",
      notNull: true,
    },
    period_code: { type: "varchar(20)", notNull: true },
    amount: { type: "numeric(18,4)", notNull: true, check: "amount >= 0" },
  });
  pgm.addConstraint("finance_budget_lines", "finance_budget_lines_version_period_unique", {
    unique: ["budget_version_id", "period_code"],
  });
  pgm.addConstraint("finance_budget_lines", "finance_bl_version_tenant_safe", {
    foreignKeys: {
      columns: ["tenant_id", "budget_version_id"],
      references: "finance_budget_versions(tenant_id, id)",
      onDelete: "CASCADE",
    },
  });
  pgm.createIndex("finance_budget_lines", ["tenant_id", "budget_version_id"]);

  pgm.createTable("finance_budget_policies", {
    id: { type: "uuid", primaryKey: true, default: pgm.func("gen_random_uuid()") },
    tenant_id: { type: "uuid", notNull: true, references: "tenants", onDelete: "CASCADE" },
    legal_entity_id: { type: "uuid", notNull: true },
    effect: {
      type: "varchar(20)",
      notNull: true,
      check: `effect IN ('advisory', 'escalation', 'hard_stop')`,
    },
    document_type: { type: "varchar(60)" },
    cost_center_id: { type: "uuid" },
    project_id: { type: "uuid" },
    account_from: { type: "varchar(40)" },
    account_to: { type: "varchar(40)" },
    amount_threshold: { type: "numeric(18,4)" },
    effective_from: { type: "date", notNull: true },
    effective_to: { type: "date" },
    created_by: { type: "uuid" },
    created_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
    updated_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
  });
  pgm.addConstraint("finance_budget_policies", "finance_budget_policies_window_check", {
    check: "effective_to IS NULL OR effective_to >= effective_from",
  });
  pgm.createIndex("finance_budget_policies", ["tenant_id", "legal_entity_id", "effect"]);

  pgm.createTable("finance_budget_consumptions", {
    id: { type: "uuid", primaryKey: true, default: pgm.func("gen_random_uuid()") },
    tenant_id: { type: "uuid", notNull: true, references: "tenants", onDelete: "CASCADE" },
    budget_version_id: {
      type: "uuid",
      notNull: true,
    },
    period_code: { type: "varchar(20)", notNull: true },
    kind: {
      type: "varchar(20)",
      notNull: true,
      check: `kind IN ('actual', 'commitment', 'adjustment', 'release')`,
    },
    amount: { type: "numeric(18,4)", notNull: true, check: "amount >= 0" },
    source_ref_table: { type: "varchar(60)" },
    source_ref_id: { type: "uuid" },
    idempotency_key: { type: "varchar(120)", notNull: true },
    // Compensating release points at the row it cancels (ADR-0020 §4):
    // history is never deleted, a release reverses it.
    reverses_id: {
      type: "uuid",
      references: "finance_budget_consumptions",
      onDelete: "RESTRICT",
    },
    note: { type: "text" },
    created_by: { type: "uuid" },
    created_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
  });
  // Idempotent intake: one row per idempotency key per tenant.
  pgm.addConstraint("finance_budget_consumptions", "finance_budget_consumptions_idem_unique", {
    unique: ["tenant_id", "idempotency_key"],
  });
  pgm.addConstraint("finance_budget_consumptions", "finance_bc_version_tenant_safe", {
    foreignKeys: {
      columns: ["tenant_id", "budget_version_id"],
      references: "finance_budget_versions(tenant_id, id)",
      onDelete: "CASCADE",
    },
  });
  pgm.createIndex("finance_budget_consumptions", ["tenant_id", "budget_version_id", "period_code"]);
};

exports.down = (pgm) => {
  pgm.dropTable("finance_budget_consumptions", { ifExists: true });
  pgm.dropTable("finance_budget_policies", { ifExists: true });
  pgm.dropTable("finance_budget_lines", { ifExists: true });
  pgm.dropTable("finance_budget_versions", { ifExists: true });
  pgm.dropTable("finance_budgets", { ifExists: true });
};
