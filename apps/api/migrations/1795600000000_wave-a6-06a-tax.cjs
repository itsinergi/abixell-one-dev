/**
 * Wave A6 WP-FIN-A6-06a — Indonesia tax baseline (ADR-0019).
 *
 * 1. `finance_tax_registrations` — per Legal Entity, PKP or Non-PKP, effective
 *    dated. A status change closes the open row and opens a new one; it never
 *    edits history (ADR-0019 §1), so a posting dated before the change still
 *    resolves the status that applied to it.
 *
 * 2. `finance_tax_rules` — the stable identity of a rule ("PPN output 11%").
 *    Only the code, type and description live here. Nothing a calculation
 *    depends on does.
 *
 * 3. `finance_tax_rule_versions` — everything a calculation depends on: rate,
 *    basis, rounding, effective window, account mapping, and whether the rule
 *    needs PKP status. Versioned and approval-gated (ADR-0019 §3). A version is
 *    never updated after it is drafted; a change is a new version. That is the
 *    structural half of "immutable after first use" — the other half is that a
 *    posting stores the exact version id it used.
 *
 * 4. `finance_tax_calculations` — the evidence row. Basis, rate, rounding mode,
 *    result and the rule version are all stored, so an audited calculation
 *    reproduces itself without re-deriving the rate that was in force then.
 *
 * Rates are `numeric(9,6)` — a fraction, so 11% is 0.110000. Six decimals
 * covers every PPN and withholding rate in the baseline without a scale that
 * would let a typo hide; the calculation converts it to integer micro-units and
 * never touches binary floating point (ADR-0019 §3).
 *
 * Excluded by decision: PPh Badan (needs separate authorization), PPh 21
 * (Workforce owns it), and any live Coretax / DJP / e-Faktur integration
 * (ADR-0019 §2, §4).
 */

exports.up = (pgm) => {
  pgm.createTable("finance_tax_registrations", {
    id: { type: "uuid", primaryKey: true, default: pgm.func("gen_random_uuid()") },
    // Direct tenant ownership (GATE-3 migration-tenant-discipline).
    tenant_id: { type: "uuid", notNull: true, references: "tenants", onDelete: "CASCADE" },
    legal_entity_id: { type: "uuid", notNull: true },
    taxpayer_status: { type: "varchar(10)", notNull: true, check: `taxpayer_status IN ('pkp','non_pkp')` },
    /** NPWP / NIK-NPWP. Null for an entity that has not registered one yet. */
    registration_number: { type: "varchar(40)" },
    effective_from: { type: "date", notNull: true },
    /** Exclusive end: null means "still in force". */
    effective_to: { type: "date" },
    /** Evidence the status rests on — a document, not a free-text claim. */
    evidence_document_id: { type: "uuid" },
    status: {
      type: "varchar(12)",
      notNull: true,
      default: "active",
      check: `status IN ('active','superseded')`,
    },
    workflow_instance_id: { type: "uuid", references: "workflow_instances", onDelete: "SET NULL" },
    created_by: { type: "uuid" },
    created_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
  });
  pgm.addConstraint("finance_tax_registrations", "finance_tr_tenant_id_unique", {
    unique: ["tenant_id", "id"],
  });
  // One registration per entity per start date: a second row for the same day
  // is a correction to the first, not a second status.
  pgm.addConstraint("finance_tax_registrations", "finance_tr_effective_unique", {
    unique: ["tenant_id", "legal_entity_id", "effective_from"],
  });
  pgm.addConstraint("finance_tax_registrations", "finance_tr_legal_entity_tenant_safe", {
    foreignKeys: {
      columns: ["tenant_id", "legal_entity_id"],
      references: "legal_entities(tenant_id, id)",
      onDelete: "CASCADE",
    },
  });
  pgm.addConstraint("finance_tax_registrations", "finance_tr_window_check", {
    check: "effective_to IS NULL OR effective_to > effective_from",
  });
  pgm.createIndex("finance_tax_registrations", ["tenant_id", "legal_entity_id", "effective_from"]);

  pgm.createTable("finance_tax_rules", {
    id: { type: "uuid", primaryKey: true, default: pgm.func("gen_random_uuid()") },
    tenant_id: { type: "uuid", notNull: true, references: "tenants", onDelete: "CASCADE" },
    legal_entity_id: { type: "uuid", notNull: true },
    rule_code: { type: "varchar(60)", notNull: true },
    /**
     * PPN and the withholding taxes ADR-0019 §2 includes. PPh Badan and PPh 21
     * are absent on purpose — the check constraint is the boundary, not a
     * comment someone can forget.
     */
    tax_type: {
      type: "varchar(10)",
      notNull: true,
      check: `tax_type IN ('ppn','pph22','pph23','pph26')`,
    },
    description: { type: "text" },
    created_by: { type: "uuid" },
    created_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
  });
  pgm.addConstraint("finance_tax_rules", "finance_tax_rules_code_unique", {
    unique: ["tenant_id", "legal_entity_id", "rule_code"],
  });
  pgm.addConstraint("finance_tax_rules", "finance_tax_rules_tenant_id_unique", {
    unique: ["tenant_id", "id"],
  });
  pgm.addConstraint("finance_tax_rules", "finance_tax_rules_legal_entity_tenant_safe", {
    foreignKeys: {
      columns: ["tenant_id", "legal_entity_id"],
      references: "legal_entities(tenant_id, id)",
      onDelete: "CASCADE",
    },
  });

  pgm.createTable("finance_tax_rule_versions", {
    id: { type: "uuid", primaryKey: true, default: pgm.func("gen_random_uuid()") },
    tenant_id: { type: "uuid", notNull: true, references: "tenants", onDelete: "CASCADE" },
    tax_rule_id: { type: "uuid", notNull: true },
    version_number: { type: "integer", notNull: true, check: "version_number > 0" },
    /** A fraction: 11% is 0.110000, never 11. */
    rate: { type: "numeric(9,6)", notNull: true, check: "rate >= 0 AND rate < 1" },
    basis: { type: "varchar(10)", notNull: true, check: `basis IN ('gross','net','dpp')` },
    rounding_mode: {
      type: "varchar(12)",
      notNull: true,
      default: "half_up",
      check: `rounding_mode IN ('half_up','half_even','truncate')`,
    },
    /** True when the rule may only be applied to a PKP entity. */
    requires_pkp: { type: "boolean", notNull: true, default: false },
    /** Where the tax lands in the ledger. */
    account_id: { type: "uuid", notNull: true },
    effective_from: { type: "date", notNull: true },
    effective_to: { type: "date" },
    status: {
      type: "varchar(12)",
      notNull: true,
      default: "draft",
      check: `status IN ('draft','approved','superseded')`,
    },
    workflow_instance_id: { type: "uuid", references: "workflow_instances", onDelete: "SET NULL" },
    created_by: { type: "uuid" },
    created_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
    approved_by: { type: "uuid" },
    approved_at: { type: "timestamptz" },
  });
  pgm.addConstraint("finance_tax_rule_versions", "finance_trv_version_unique", {
    unique: ["tenant_id", "tax_rule_id", "version_number"],
  });
  pgm.addConstraint("finance_tax_rule_versions", "finance_trv_tenant_id_unique", {
    unique: ["tenant_id", "id"],
  });
  pgm.addConstraint("finance_tax_rule_versions", "finance_trv_rule_tenant_safe", {
    foreignKeys: {
      columns: ["tenant_id", "tax_rule_id"],
      references: "finance_tax_rules(tenant_id, id)",
      onDelete: "CASCADE",
    },
  });
  pgm.addConstraint("finance_tax_rule_versions", "finance_trv_account_tenant_safe", {
    foreignKeys: {
      columns: ["tenant_id", "account_id"],
      references: "accounting_accounts(tenant_id, id)",
      onDelete: "RESTRICT",
    },
  });
  pgm.addConstraint("finance_tax_rule_versions", "finance_trv_window_check", {
    check: "effective_to IS NULL OR effective_to > effective_from",
  });
  pgm.createIndex("finance_tax_rule_versions", ["tenant_id", "tax_rule_id", "status"]);

  pgm.createTable("finance_tax_calculations", {
    id: { type: "uuid", primaryKey: true, default: pgm.func("gen_random_uuid()") },
    tenant_id: { type: "uuid", notNull: true, references: "tenants", onDelete: "CASCADE" },
    legal_entity_id: { type: "uuid", notNull: true },
    /** The exact approved version used — the audit trail's anchor. */
    rule_version_id: { type: "uuid", notNull: true },
    /** The registration status in force at `calculation_date`. */
    taxpayer_status: { type: "varchar(10)", notNull: true, check: `taxpayer_status IN ('pkp','non_pkp')` },
    basis_amount: { type: "numeric(18,2)", notNull: true, check: "basis_amount >= 0" },
    rate: { type: "numeric(9,6)", notNull: true },
    rounding_mode: { type: "varchar(12)", notNull: true },
    tax_amount: { type: "numeric(18,2)", notNull: true, check: "tax_amount >= 0" },
    currency: { type: "varchar(3)", notNull: true },
    calculation_date: { type: "date", notNull: true },
    /** Polymorphic pointer at the document being taxed; whitelisted in service. */
    document_ref_table: { type: "varchar(64)" },
    document_ref_id: { type: "uuid" },
    idempotency_key: { type: "varchar(120)", notNull: true },
    created_by: { type: "uuid" },
    created_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
  });
  pgm.addConstraint("finance_tax_calculations", "finance_tc_idem_unique", {
    unique: ["tenant_id", "idempotency_key"],
  });
  pgm.addConstraint("finance_tax_calculations", "finance_tc_tenant_id_unique", {
    unique: ["tenant_id", "id"],
  });
  pgm.addConstraint("finance_tax_calculations", "finance_tc_version_tenant_safe", {
    foreignKeys: {
      columns: ["tenant_id", "rule_version_id"],
      references: "finance_tax_rule_versions(tenant_id, id)",
      onDelete: "RESTRICT",
    },
  });
  pgm.addConstraint("finance_tax_calculations", "finance_tc_legal_entity_tenant_safe", {
    foreignKeys: {
      columns: ["tenant_id", "legal_entity_id"],
      references: "legal_entities(tenant_id, id)",
      onDelete: "CASCADE",
    },
  });
  pgm.createIndex("finance_tax_calculations", ["tenant_id", "legal_entity_id", "calculation_date"]);
};

exports.down = (pgm) => {
  pgm.dropTable("finance_tax_calculations", { ifExists: true });
  pgm.dropTable("finance_tax_rule_versions", { ifExists: true });
  pgm.dropTable("finance_tax_rules", { ifExists: true });
  pgm.dropTable("finance_tax_registrations", { ifExists: true });
};
