/**
 * Checkpoint 0C — Configuration & Metadata Foundation.
 *
 * Implements 05-Configuration-Metadata-Engine.md's three-layer model:
 *   1. Schema Registry   -> `metadata_registry` (Product Core, versioned
 *      via migration — defines the VALID SHAPE of each configuration
 *      area/key; never tenant-editable).
 *   2. Tenant Configuration Store -> the `tenant_*` tables below (actual
 *      values per Tenant, validated against the Schema Registry by
 *      ConfigurationService before being written).
 *   3. Configuration API -> apps/api/src/interfaces/http/routes/config.ts
 *      (Checkpoint 0C code), consumed by both backend (RBAC/workflow —
 *      future) and frontend (this checkpoint's Dashboard panel).
 *
 * Areas covered, per Founder instruction for 0C: Module Activation,
 * Feature Flags (with Configuration Scope: tenant default + optional
 * Organization Unit override), Terminology, Status/Reference Data,
 * Numbering. Configuration Scope is demonstrated fully on Feature Flags;
 * the other areas remain tenant-level-only in 0C (documented
 * simplification, same pattern as the 0B Data Scope ADR — see
 * ADR-0006/0007 and docs/decision-log.md).
 *
 * Catalog tables (modules, feature_flags, terminology_keys,
 * reference_data_types) are Product Core: what CAN be configured. They
 * are seeded by migration, not by any Tenant. Tenant-scoped tables hold
 * what a given Tenant actually chose.
 */

exports.up = (pgm) => {
  // --- Schema Registry (Product Core) -------------------------------
  pgm.createTable("metadata_registry", {
    id: { type: "uuid", primaryKey: true, default: pgm.func("gen_random_uuid()") },
    area: { type: "text", notNull: true },
    key: { type: "text", notNull: true },
    json_schema: { type: "jsonb", notNull: true },
    description: { type: "text", notNull: true },
    created_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
  });
  pgm.addConstraint("metadata_registry", "metadata_registry_area_key_unique", {
    unique: ["area", "key"],
  });

  // --- Module Activation ----------------------------------------------
  pgm.createTable("modules", {
    id: { type: "uuid", primaryKey: true, default: pgm.func("gen_random_uuid()") },
    code: { type: "text", notNull: true, unique: true },
    name: { type: "text", notNull: true },
    description: { type: "text", notNull: true },
    created_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
  });

  pgm.createTable("tenant_module_activations", {
    id: { type: "uuid", primaryKey: true, default: pgm.func("gen_random_uuid()") },
    tenant_id: { type: "uuid", notNull: true, references: "tenants", onDelete: "CASCADE" },
    module_id: { type: "uuid", notNull: true, references: "modules", onDelete: "CASCADE" },
    is_active: { type: "boolean", notNull: true, default: false },
    updated_by: { type: "uuid" },
    updated_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
  });
  pgm.addConstraint("tenant_module_activations", "tenant_module_activations_unique", {
    unique: ["tenant_id", "module_id"],
  });

  // --- Feature Flags (Configuration Scope demonstrated here) -----------
  pgm.createTable("feature_flags", {
    id: { type: "uuid", primaryKey: true, default: pgm.func("gen_random_uuid()") },
    code: { type: "text", notNull: true, unique: true },
    name: { type: "text", notNull: true },
    description: { type: "text", notNull: true },
    default_enabled: { type: "boolean", notNull: true, default: false },
    created_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
  });

  pgm.createTable("tenant_feature_flags", {
    id: { type: "uuid", primaryKey: true, default: pgm.func("gen_random_uuid()") },
    tenant_id: { type: "uuid", notNull: true, references: "tenants", onDelete: "CASCADE" },
    feature_flag_id: { type: "uuid", notNull: true, references: "feature_flags", onDelete: "CASCADE" },
    is_enabled: { type: "boolean", notNull: true },
    // 'tenant' = applies to the whole Tenant (the default); 'organization_unit'
    // = overrides the tenant default for exactly one Organization Unit
    // (exact-match, same simplification as 0B Data Scope — see ADR-0007).
    scope_type: { type: "text", notNull: true, default: "tenant" },
    scope_organization_unit_id: { type: "uuid", references: "organization_units", onDelete: "CASCADE" },
    updated_by: { type: "uuid" },
    updated_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
  });
  pgm.addConstraint("tenant_feature_flags", "tenant_feature_flags_scope_type_check", {
    check: "scope_type IN ('tenant', 'organization_unit')",
  });
  pgm.addConstraint("tenant_feature_flags", "tenant_feature_flags_scope_consistency_check", {
    check:
      "(scope_type = 'organization_unit' AND scope_organization_unit_id IS NOT NULL) OR (scope_type = 'tenant' AND scope_organization_unit_id IS NULL)",
  });
  // Partial unique indexes: at most one tenant-wide row per (tenant, flag),
  // and at most one row per (tenant, flag, specific org unit). A plain
  // UNIQUE constraint would NOT work here because Postgres treats NULL as
  // distinct from NULL, so multiple tenant-scope rows (scope_org_unit_id
  // IS NULL) would silently NOT collide — this is the same class of
  // mistake fixed in Checkpoint 0B (see migration 1755600100000).
  pgm.createIndex("tenant_feature_flags", ["tenant_id", "feature_flag_id"], {
    name: "tenant_feature_flags_tenant_scope_unique",
    unique: true,
    where: "scope_type = 'tenant'",
  });
  pgm.createIndex(
    "tenant_feature_flags",
    ["tenant_id", "feature_flag_id", "scope_organization_unit_id"],
    {
      name: "tenant_feature_flags_org_unit_scope_unique",
      unique: true,
      where: "scope_type = 'organization_unit'",
    },
  );

  // --- Terminology ------------------------------------------------------
  pgm.createTable("terminology_keys", {
    id: { type: "uuid", primaryKey: true, default: pgm.func("gen_random_uuid()") },
    code: { type: "text", notNull: true, unique: true },
    default_label: { type: "text", notNull: true },
    description: { type: "text", notNull: true },
    created_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
  });

  pgm.createTable("tenant_terminology_overrides", {
    id: { type: "uuid", primaryKey: true, default: pgm.func("gen_random_uuid()") },
    tenant_id: { type: "uuid", notNull: true, references: "tenants", onDelete: "CASCADE" },
    terminology_key_id: { type: "uuid", notNull: true, references: "terminology_keys", onDelete: "CASCADE" },
    value: { type: "text", notNull: true },
    updated_by: { type: "uuid" },
    updated_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
  });
  pgm.addConstraint("tenant_terminology_overrides", "tenant_terminology_overrides_unique", {
    unique: ["tenant_id", "terminology_key_id"],
  });

  // --- Status / Reference Data ------------------------------------------
  pgm.createTable("reference_data_types", {
    id: { type: "uuid", primaryKey: true, default: pgm.func("gen_random_uuid()") },
    code: { type: "text", notNull: true, unique: true },
    name: { type: "text", notNull: true },
    description: { type: "text", notNull: true },
    created_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
  });

  pgm.createTable("tenant_reference_data_items", {
    id: { type: "uuid", primaryKey: true, default: pgm.func("gen_random_uuid()") },
    tenant_id: { type: "uuid", notNull: true, references: "tenants", onDelete: "CASCADE" },
    reference_data_type_id: { type: "uuid", notNull: true, references: "reference_data_types", onDelete: "CASCADE" },
    code: { type: "text", notNull: true },
    label: { type: "text", notNull: true },
    sort_order: { type: "integer", notNull: true, default: 0 },
    is_active: { type: "boolean", notNull: true, default: true },
    created_by: { type: "uuid" },
    created_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
    updated_by: { type: "uuid" },
    updated_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
  });
  pgm.addConstraint(
    "tenant_reference_data_items",
    "tenant_reference_data_items_unique",
    { unique: ["tenant_id", "reference_data_type_id", "code"] },
  );

  // --- Numbering ----------------------------------------------------------
  pgm.createTable("numbering_sequences", {
    id: { type: "uuid", primaryKey: true, default: pgm.func("gen_random_uuid()") },
    tenant_id: { type: "uuid", notNull: true, references: "tenants", onDelete: "CASCADE" },
    code: { type: "text", notNull: true },
    // Pattern tokens: {YYYY} four-digit year, {MM} two-digit month,
    // {SEQ:N} sequence number zero-padded to width N. Validated against
    // metadata_registry (area='numbering', key='pattern') before save.
    pattern: { type: "text", notNull: true },
    current_sequence: { type: "bigint", notNull: true, default: 0 },
    created_by: { type: "uuid" },
    created_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
    updated_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
  });
  pgm.addConstraint("numbering_sequences", "numbering_sequences_unique", {
    unique: ["tenant_id", "code"],
  });

  // --- New permissions (Product Core catalog, appended) ------------------
  pgm.sql(`
    INSERT INTO permissions (code, description) VALUES
      ('config.read', 'Read Configuration & Metadata (module activation, feature flags, terminology, reference data, numbering)'),
      ('config.manage', 'Manage Configuration & Metadata (activate modules, set feature flags, override terminology, manage reference data and numbering)')
  `);

  // --- Seed the Schema Registry (Product Core, migration-versioned) ------
  pgm.sql(`
    INSERT INTO metadata_registry (area, key, json_schema, description) VALUES
      ('terminology', 'value', '${JSON.stringify({
        type: "string",
        minLength: 1,
        maxLength: 60,
      })}', 'A Terminology override value: a short display label shown in place of the Product Core default term.'),
      ('reference_data', 'item', '${JSON.stringify({
        type: "object",
        required: ["code", "label"],
        additionalProperties: false,
        properties: {
          code: { type: "string", minLength: 1, maxLength: 40, pattern: "^[a-z0-9_]+$" },
          label: { type: "string", minLength: 1, maxLength: 80 },
          sortOrder: { type: "integer", minimum: 0 },
        },
      })}', 'A single Reference Data item: a code/label pair belonging to a Reference Data Type.'),
      ('numbering', 'pattern', '${JSON.stringify({
        type: "string",
        minLength: 1,
        pattern: ".*\\{SEQ(:\\d+)?\\}.*",
      })}', 'A Numbering pattern: must contain a {SEQ} or {SEQ:N} token so generated numbers are actually unique.'),
      ('feature_flag', 'value', '${JSON.stringify({ type: "boolean" })}', 'A Feature Flag value: on or off.')
  `);

  // --- Seed the Module / Feature Flag / Terminology / Reference Data
  // catalogs (Product Core — generic, not tied to any one industry or to
  // the Complaint/Survey pilot's business logic; Phase 0 builds no
  // business modules, per the blueprint).
  pgm.sql(`
    INSERT INTO modules (code, name, description) VALUES
      ('customer_complaint', 'Customer Complaint Management', 'Pilot module — not implemented in Phase 0, activation only'),
      ('survey_assessment', 'Survey & Assessment', 'Pilot module — not implemented in Phase 0, activation only')
  `);

  pgm.sql(`
    INSERT INTO feature_flags (code, name, description, default_enabled) VALUES
      ('offline_field_mode', 'Offline Field Mode', 'PWA offline-first capture for field users (readiness only in Phase 0)', false),
      ('dashboard_beta_widgets', 'Dashboard Beta Widgets', 'Show experimental dashboard widgets', false)
  `);

  pgm.sql(`
    INSERT INTO terminology_keys (code, default_label, description) VALUES
      ('organization_unit.label', 'Organization Unit', 'Display label for the Organization Unit level of the org hierarchy'),
      ('site.label', 'Site', 'Display label for a Site / Location'),
      ('legal_entity.label', 'Legal Entity', 'Display label for a Legal Entity')
  `);

  pgm.sql(`
    INSERT INTO reference_data_types (code, name, description) VALUES
      ('organization_unit_type', 'Organization Unit Type', 'Selectable types for an Organization Unit, e.g. Head Office, Branch, Site'),
      ('priority_level', 'Priority Level', 'Generic priority levels usable by any future workflow (not Complaint-specific)')
  `);
};

exports.down = (pgm) => {
  pgm.dropTable("numbering_sequences");
  pgm.dropTable("tenant_reference_data_items");
  pgm.dropTable("reference_data_types");
  pgm.dropTable("tenant_terminology_overrides");
  pgm.dropTable("terminology_keys");
  pgm.dropTable("tenant_feature_flags");
  pgm.dropTable("feature_flags");
  pgm.dropTable("tenant_module_activations");
  pgm.dropTable("modules");
  pgm.dropTable("metadata_registry");
  pgm.sql(`DELETE FROM permissions WHERE code IN ('config.read', 'config.manage')`);
};
