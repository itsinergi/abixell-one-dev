/**
 * Epic 2 Wave 1: Application Dictionary Foundation
 *
 * Creates the application dictionary (kamus aplikasi) tables per
 * CORE-ROADMAP.md §4.2 Gelombang 1:
 * - app_windows: pages/routes in the application
 * - app_tabs: sections within each page
 * - app_processes: actions/buttons
 * - app_tables: data tables
 * - app_fields: fields on tables
 * - app_api_resources: API entry points
 * - app_field_rules_versions: versioned structured field rules (no DSL)
 * - app_field_rules: field rule instances linked to a version
 *
 * Naming per locked decision: "Nama Abixell" (app_windows, app_tabs, ...)
 * with the iDempiere mapping documented in CORE-ROADMAP.md §4.2.
 *
 * Access definitions (Page/API Resource/Table/Field access) come from
 * CODE ONLY (locked decision: "Batas wewenang super admin" — super admin
 * may not edit access definitions from the UI). This migration seeds the
 * core definitions for the 13 existing modules; tenant overrides come
 * later (Wave 2).
 *
 * All app_* tables are tenant-scoped (tenant_id NOT NULL) per the
 * platform-boundary validator contract.
 *
 * Seeds permission codes for dictionary reading (read/manage) and
 * metadata_registry schema entries for Ajv validation of rule payloads.
 */

const RULE_OPERATORS = ["eq", "neq", "gt", "gte", "lt", "lte", "in"];

exports.up = async (pgm) => {
  // ============================================================================
  // 1. app_windows — pages/routes (iDempiere: AD_Window, konsep adopted)
  // ============================================================================
  pgm.createTable("app_windows", {
    id: { type: "uuid", primaryKey: true, default: pgm.func("gen_random_uuid()") },
    tenant_id: { type: "uuid", notNull: true, references: "tenants", onDelete: "CASCADE" },
    code: { type: "text", notNull: true },
    name: { type: "text", notNull: true },
    description: { type: "text" },
    module_code: { type: "text", notNull: true },
    // Epic 3 menu guard reads this; default false (fail-closed)
    is_external_allowed: { type: "boolean", notNull: true, default: false },
    is_active: { type: "boolean", notNull: true, default: true },
    created_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
    updated_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
  });
  pgm.addConstraint("app_windows", "app_windows_tenant_code_unique", {
    unique: ["tenant_id", "code"],
  });
  pgm.createIndex("app_windows", ["tenant_id", "module_code"]);

  // ============================================================================
  // 2. app_tabs — sections within a window (iDempiere: AD_Tab)
  //    Locked decision: Window = satu halaman/route. Tab = bagian di dalam
  //    halaman itu. Konfigurasi muncul sebagai card di dalam Tab. Wizard
  //    hanya untuk konfigurasi berurutan dan saling bergantung.
  // ============================================================================
  pgm.createTable("app_tabs", {
    id: { type: "uuid", primaryKey: true, default: pgm.func("gen_random_uuid()") },
    tenant_id: { type: "uuid", notNull: true, references: "tenants", onDelete: "CASCADE" },
    window_id: { type: "uuid", notNull: true, references: "app_windows", onDelete: "CASCADE" },
    code: { type: "text", notNull: true },
    name: { type: "text", notNull: true },
    description: { type: "text" },
    sequence_no: { type: "integer", notNull: true, default: 10 },
    tab_type: { type: "text", notNull: true, default: "fields" },
    is_active: { type: "boolean", notNull: true, default: true },
    created_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
    updated_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
  });
  pgm.addConstraint("app_tabs", "app_tabs_type_check", {
    check: "tab_type IN ('fields', 'cards', 'wizard')",
  });
  pgm.addConstraint("app_tabs", "app_tabs_tenant_window_code_unique", {
    unique: ["tenant_id", "window_id", "code"],
  });
  pgm.createIndex("app_tabs", ["tenant_id", "window_id"]);

  // ============================================================================
  // 3. app_processes — actions/buttons (iDempiere: AD_Process)
  // ============================================================================
  pgm.createTable("app_processes", {
    id: { type: "uuid", primaryKey: true, default: pgm.func("gen_random_uuid()") },
    tenant_id: { type: "uuid", notNull: true, references: "tenants", onDelete: "CASCADE" },
    code: { type: "text", notNull: true },
    name: { type: "text", notNull: true },
    description: { type: "text" },
    module_code: { type: "text", notNull: true },
    is_active: { type: "boolean", notNull: true, default: true },
    created_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
    updated_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
  });
  pgm.addConstraint("app_processes", "app_processes_tenant_code_unique", {
    unique: ["tenant_id", "code"],
  });
  pgm.createIndex("app_processes", ["tenant_id", "module_code"]);

  // ============================================================================
  // 4. app_tables — data tables (iDempiere: AD_Table)
  // ============================================================================
  pgm.createTable("app_tables", {
    id: { type: "uuid", primaryKey: true, default: pgm.func("gen_random_uuid()") },
    tenant_id: { type: "uuid", notNull: true, references: "tenants", onDelete: "CASCADE" },
    code: { type: "text", notNull: true },
    name: { type: "text", notNull: true },
    description: { type: "text" },
    module_code: { type: "text", notNull: true },
    physical_table_name: { type: "text" },
    is_active: { type: "boolean", notNull: true, default: true },
    created_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
    updated_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
  });
  pgm.addConstraint("app_tables", "app_tables_tenant_code_unique", {
    unique: ["tenant_id", "code"],
  });
  pgm.createIndex("app_tables", ["tenant_id", "module_code"]);

  // ============================================================================
  // 5. app_fields — fields on tables (iDempiere: AD_Column/AD_Field).
  //    Default mandatory/readonly/visible state here; conditional behavior
  //    lives in app_field_rules_versions (structured rules, never text).
  // ============================================================================
  pgm.createTable("app_fields", {
    id: { type: "uuid", primaryKey: true, default: pgm.func("gen_random_uuid()") },
    tenant_id: { type: "uuid", notNull: true, references: "tenants", onDelete: "CASCADE" },
    table_id: { type: "uuid", notNull: true, references: "app_tables", onDelete: "CASCADE" },
    code: { type: "text", notNull: true },
    name: { type: "text", notNull: true },
    description: { type: "text" },
    sequence_no: { type: "integer", notNull: true, default: 10 },
    field_type: { type: "text", notNull: true },
    is_mandatory: { type: "boolean", notNull: true, default: false },
    is_readonly: { type: "boolean", notNull: true, default: false },
    is_visible: { type: "boolean", notNull: true, default: true },
    is_active: { type: "boolean", notNull: true, default: true },
    created_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
    updated_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
  });
  pgm.addConstraint("app_fields", "app_fields_tenant_table_code_unique", {
    unique: ["tenant_id", "table_id", "code"],
  });
  pgm.createIndex("app_fields", ["tenant_id", "table_id"]);

  // ============================================================================
  // 6. app_api_resources — API entry points (lapis ketiga dari keputusan
  //    "Tiga lapis: Page/Window, API Resource, Table")
  // ============================================================================
  pgm.createTable("app_api_resources", {
    id: { type: "uuid", primaryKey: true, default: pgm.func("gen_random_uuid()") },
    tenant_id: { type: "uuid", notNull: true, references: "tenants", onDelete: "CASCADE" },
    code: { type: "text", notNull: true },
    name: { type: "text", notNull: true },
    description: { type: "text" },
    module_code: { type: "text", notNull: true },
    http_method: { type: "text", notNull: true },
    path_pattern: { type: "text", notNull: true },
    is_active: { type: "boolean", notNull: true, default: true },
    created_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
    updated_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
  });
  pgm.addConstraint("app_api_resources", "app_api_resources_tenant_code_unique", {
    unique: ["tenant_id", "code"],
  });
  pgm.addConstraint("app_api_resources", "app_api_resources_method_check", {
    check: "http_method IN ('GET', 'POST', 'PUT', 'PATCH', 'DELETE')",
  });
  pgm.createIndex("app_api_resources", ["tenant_id", "module_code"]);

  // ============================================================================
  // 7. app_field_rules_versions — versioned structured field rules.
  //    Created BEFORE app_field_rules (app_field_rules.version_id FK).
  //    Locked decision: "Aturan terstruktur, bukan rumus teks" — stored as
  //    JSON data, validated against the metadata_registry schema, never
  //    executed as text. Operators open item #1 resolved: eq, neq, gt,
  //    gte, lt, lte, in (same set as the workflow condition evaluator).
  //    Open item #2 resolved: wizard ditandai pada Tab (tab_type='wizard'),
  //    tidak ada objek kamus terpisah.
  // ============================================================================
  pgm.createTable("app_field_rules_versions", {
    id: { type: "uuid", primaryKey: true, default: pgm.func("gen_random_uuid()") },
    tenant_id: { type: "uuid", notNull: true, references: "tenants", onDelete: "CASCADE" },
    table_id: { type: "uuid", notNull: true, references: "app_tables", onDelete: "CASCADE" },
    version_number: { type: "integer", notNull: true },
    status: { type: "text", notNull: true, default: "draft" },
    is_current: { type: "boolean", notNull: true, default: false },
    rules_definition: { type: "jsonb", notNull: true, default: "{}" },
    published_by: { type: "uuid", references: "users", onDelete: "SET NULL" },
    published_at: { type: "timestamptz" },
    created_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
    updated_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
  });
  pgm.addConstraint("app_field_rules_versions", "app_field_rules_versions_status_check", {
    check: "status IN ('draft', 'published', 'retired')",
  });
  pgm.addConstraint("app_field_rules_versions", "app_field_rules_versions_version_number_check", {
    check: "version_number > 0",
  });
  pgm.addConstraint("app_field_rules_versions", "app_field_rules_versions_tenant_table_version_unique", {
    unique: ["tenant_id", "table_id", "version_number"],
  });
  // One current version per table (partial unique index — same pattern as
  // workflow versions in 1755800000000_workflow-approval-engine-foundation.cjs)
  pgm.createIndex(
    "app_field_rules_versions",
    ["tenant_id", "table_id"],
    {
      unique: true,
      name: "app_field_rules_versions_one_current_per_table",
      where: "is_current = true",
    },
  );
  pgm.createIndex("app_field_rules_versions", ["tenant_id", "table_id", "status"]);

  // ============================================================================
  // 8. app_field_rules — rule instances: which field, which rule type,
  //    resolved by which version
  // ============================================================================
  pgm.createTable("app_field_rules", {
    id: { type: "uuid", primaryKey: true, default: pgm.func("gen_random_uuid()") },
    tenant_id: { type: "uuid", notNull: true, references: "tenants", onDelete: "CASCADE" },
    table_id: { type: "uuid", notNull: true, references: "app_tables", onDelete: "CASCADE" },
    field_id: { type: "uuid", notNull: true, references: "app_fields", onDelete: "CASCADE" },
    rule_type: { type: "text", notNull: true },
    version_id: { type: "uuid", notNull: true, references: "app_field_rules_versions", onDelete: "CASCADE" },
    created_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
    updated_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
  });
  pgm.addConstraint("app_field_rules", "app_field_rules_type_check", {
    check: "rule_type IN ('mandatory', 'readonly', 'visible')",
  });
  pgm.addConstraint("app_field_rules", "app_field_rules_field_version_unique", {
    unique: ["field_id", "rule_type", "version_id"],
  });
  pgm.createIndex("app_field_rules", ["tenant_id", "version_id"]);

  // ============================================================================
  // 9. Permission codes
  //    permissions(code, description); sync-role-permissions.ts auto-grants
  //    these to full-access roles after migration.
  // ============================================================================
  pgm.sql(`
    INSERT INTO permissions (code, description) VALUES
      ('config.app_dictionary.read', 'Read the Application Dictionary (windows, tabs, processes, tables, fields, API resources, field rules)'),
      ('config.app_dictionary.manage', 'Manage Application Dictionary drafts and publish versions')
    ON CONFLICT (code) DO NOTHING;
  `);

  // ============================================================================
  // 10. metadata_registry schema entries — Ajv validation of rule payloads.
  //     Column shape per 1755700000000: area, key, json_schema, description.
  // ============================================================================
  await pgm.db.query(
    `INSERT INTO metadata_registry (area, key, json_schema, description)
     VALUES ('app_field_rules', 'rules_definition', $1, $2)
     ON CONFLICT (area, key) DO UPDATE SET json_schema = $1, description = $2`,
    [
      JSON.stringify({
        type: "object",
        properties: {
          rules: {
            type: "array",
            items: {
              type: "object",
              properties: {
                field: { type: "string", minLength: 1 },
                ruleType: { enum: ["mandatory", "readonly", "visible"] },
                conditions: {
                  type: "object",
                  properties: {
                    combinator: { enum: ["AND", "OR"] },
                    rules: {
                      type: "array",
                      items: {
                        type: "object",
                        properties: {
                          field: { type: "string", minLength: 1 },
                          operator: { enum: RULE_OPERATORS },
                          value: {},
                        },
                        required: ["field", "operator", "value"],
                        additionalProperties: false,
                      },
                    },
                  },
                  required: ["rules", "combinator"],
                  additionalProperties: false,
                },
              },
              required: ["field", "ruleType", "conditions"],
              additionalProperties: false,
            },
          },
        },
        required: ["rules"],
        additionalProperties: false,
      }),
      "Structured field rule conditions: {field, operator, value} grouped with an explicit AND/OR combinator. No expression text is ever executed.",
    ],
  );
};

exports.down = async (pgm) => {
  // Reverse dependency order
  pgm.dropTable("app_field_rules", { ifExists: true, cascade: true });
  pgm.dropTable("app_field_rules_versions", { ifExists: true, cascade: true });
  pgm.dropTable("app_api_resources", { ifExists: true, cascade: true });
  pgm.dropTable("app_fields", { ifExists: true, cascade: true });
  pgm.dropTable("app_tables", { ifExists: true, cascade: true });
  pgm.dropTable("app_processes", { ifExists: true, cascade: true });
  pgm.dropTable("app_tabs", { ifExists: true, cascade: true });
  pgm.dropTable("app_windows", { ifExists: true, cascade: true });

  // Remove permission codes only if unreferenced (same guard as
  // 1786000000000_tenant-name-update-permission.cjs)
  pgm.sql(`
    DELETE FROM permissions p
    WHERE p.code IN ('config.app_dictionary.read', 'config.app_dictionary.manage')
      AND NOT EXISTS (
        SELECT 1 FROM role_permissions rp WHERE rp.permission_id = p.id
      );
  `);

  pgm.sql(`
    DELETE FROM metadata_registry
    WHERE area = 'app_field_rules' AND key = 'rules_definition';
  `);
};
