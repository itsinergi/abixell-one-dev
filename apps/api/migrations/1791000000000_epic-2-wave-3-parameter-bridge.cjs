/**
 * Epic 2 Gelombang 3 — Parameter bridge (CORE-ROADMAP.md §4.2).
 *
 * Gelombang 3 ("Logic lanjutan & parameter setup") is a bridge to Epic 8
 * (the full "Document Type, Numbering & Parameter Setup"). This migration
 * establishes the foundation: three-level parameter hierarchy (System →
 * Client → Organization per §4.8 #16), with guardrails, module ownership,
 * and Schema Registry validation.
 *
 * The bridge seeds three example parameters required by roadmap contracts:
 *   - document.backdate.max_days       (integer, Organization-overridable)
 *   - document.numbering.pattern_policy (string, Client/System only)
 *   - document.attachment.reference_required (boolean, guardrail, no org override)
 *
 * `app_parameters` holds the Product Core catalogue (code, schema, default).
 * `app_parameter_values` holds tenant-scoped overrides, one per (tenant, parameter, level).
 * Organization-level overrides require org_override_allowed=true.
 * Guardrail parameters block Organization-level writes entirely.
 *
 * Tenant-ownership via `app_parameter_values.tenant_id NOT NULL FK`.
 * Global catalogue via `app_parameters` (no tenant_id).
 * Satisfies platform-boundary-validator.mjs (update REVIEWED_NEW_GLOBAL_TABLES,
 * declare app_parameters as global/code-owned, app_parameter_values as direct tenant).
 */

exports.shorthands = undefined;

exports.up = (pgm) => {
  // ==========================================================================
  // 1. app_parameters — Product Core catalogue (global, code-owned)
  // ==========================================================================
  pgm.createTable("app_parameters", {
    id: { type: "uuid", primaryKey: true, default: pgm.func("gen_random_uuid()") },
    code: { type: "text", notNull: true, unique: true },
    name: { type: "text", notNull: true },
    description: { type: "text", notNull: true },
    module_code: { type: "text", notNull: true },
    parameter_type: {
      type: "text",
      notNull: true,
      check: "parameter_type IN ('boolean', 'integer', 'decimal', 'string', 'json')",
    },
    schema_area: { type: "text", notNull: true },
    schema_key: { type: "text", notNull: true },
    default_value: { type: "jsonb" },
    allowed_levels: {
      type: "text",
      notNull: true,
      default: "S,C,O",
      check: "allowed_levels IN ('S', 'C', 'O', 'S,C', 'S,O', 'C,O', 'S,C,O')",
    },
    org_override_allowed: { type: "boolean", notNull: true, default: true },
    is_guardrail: { type: "boolean", notNull: true, default: false },
    is_active: { type: "boolean", notNull: true, default: true },
    created_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
    updated_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
  });
  pgm.createIndex("app_parameters", "module_code");

  pgm.addConstraint("app_parameters", "fk_app_parameters_module_code", {
    foreignKeys: {
      columns: ["module_code"],
      references: "modules(code)",
      onDelete: "RESTRICT",
    },
  });

  // A guardrail parameter exists precisely to prevent Organization-level
  // tampering, so allowing an Organization override at the same time is
  // contradictory. The service already refuses it; this makes the schema
  // itself impossible to seed into that state.
  pgm.addConstraint("app_parameters", "app_parameters_guardrail_check", {
    check: "NOT is_guardrail OR NOT org_override_allowed",
  });

  // Composite FK: (schema_area, schema_key) must exist in metadata_registry
  pgm.addConstraint("app_parameters", "fk_app_parameters_metadata_registry", {
    foreignKeys: {
      columns: ["schema_area", "schema_key"],
      references: "metadata_registry(area, key)",
      onDelete: "RESTRICT",
    },
  });

  // ==========================================================================
  // 2. app_parameter_values — Tenant-scoped overrides (direct tenant-owned)
  // ==========================================================================
  pgm.createTable("app_parameter_values", {
    id: { type: "uuid", primaryKey: true, default: pgm.func("gen_random_uuid()") },
    tenant_id: {
      type: "uuid",
      notNull: true,
      references: "tenants",
      onDelete: "CASCADE",
    },
    parameter_id: {
      type: "uuid",
      notNull: true,
      references: "app_parameters",
      onDelete: "CASCADE",
    },
    level: {
      type: "text",
      notNull: true,
      check: "level IN ('S', 'C', 'O')",
    },
    // Client scope = tenant in this context (no separate Client entity exists).
    // System → Client → Organization precedence maps to S → tenant → OU.
    // Equality-checked below so this can never point at a different tenant.
    client_scope_id: {
      type: "uuid",
      references: "tenants",
      onDelete: "RESTRICT",
    },
    // Organization scope must belong to the same tenant. The composite FK added
    // below (tenant_id, organization_scope_id) -> organization_units(tenant_id, id)
    // enforces tenant-safety; this column needs no separate FK.
    organization_scope_id: {
      type: "uuid",
    },
    value: { type: "jsonb", notNull: true },
    updated_by: { type: "uuid" },
    updated_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
  });

  // Constraint: level consistency (mirrors tenant_feature_flags pattern)
  pgm.addConstraint(
    "app_parameter_values",
    "app_parameter_values_level_scope_check",
    {
      check: `
        (level = 'S' AND client_scope_id IS NULL AND organization_scope_id IS NULL)
        OR (level = 'C' AND client_scope_id IS NOT NULL AND organization_scope_id IS NULL)
        OR (level = 'O' AND client_scope_id IS NOT NULL AND organization_scope_id IS NOT NULL)
      `,
    },
  );

  // Tenant-safe scope guards: Client scope must equal the owning tenant (no
  // separate Client entity exists); Organization scope must belong to the
  // same tenant via the composite FK organization_units already exposes.
  pgm.addConstraint(
    "app_parameter_values",
    "app_parameter_values_client_scope_is_tenant",
    { check: "client_scope_id IS NULL OR client_scope_id = tenant_id" },
  );
  pgm.addConstraint("app_parameter_values", "fk_app_parameter_values_org_tenant_safe", {
    foreignKeys: {
      columns: ["tenant_id", "organization_scope_id"],
      references: "organization_units(tenant_id, id)",
      onDelete: "RESTRICT",
    },
  });

  // Partial unique indexes (pattern from tenant_feature_flags)
  pgm.sql(`
    CREATE UNIQUE INDEX app_parameter_values_tenant_param_s_unique
      ON app_parameter_values (tenant_id, parameter_id)
      WHERE level = 'S' AND client_scope_id IS NULL AND organization_scope_id IS NULL;

    CREATE UNIQUE INDEX app_parameter_values_tenant_param_c_unique
      ON app_parameter_values (tenant_id, parameter_id, client_scope_id)
      WHERE level = 'C' AND organization_scope_id IS NULL;

    CREATE UNIQUE INDEX app_parameter_values_tenant_param_o_unique
      ON app_parameter_values (tenant_id, parameter_id, client_scope_id, organization_scope_id)
      WHERE level = 'O';
  `);

  pgm.createIndex("app_parameter_values", "tenant_id");
  pgm.createIndex("app_parameter_values", "parameter_id");
  pgm.createIndex("app_parameter_values", "level");
  pgm.createIndex("app_parameter_values", ["tenant_id", "parameter_id"]);

  // ==========================================================================
  // 3. Metadata Registry entries for parameter values
  // ==========================================================================
  pgm.sql(`
    INSERT INTO metadata_registry (area, key, json_schema, description)
    VALUES
      (
        'app_parameter_values',
        'value_boolean',
        '{"type":"boolean"}'::jsonb,
        'Boolean parameter value'
      ),
      (
        'app_parameter_values',
        'value_integer',
        '{"type":"integer","minimum":0}'::jsonb,
        'Non-negative integer parameter value'
      ),
      (
        'app_parameter_values',
        'value_string',
        '{"type":"string","maxLength":500}'::jsonb,
        'String parameter value, max 500 characters'
      ),
      (
        'app_parameter_values',
        'value_decimal',
        '{"type":"number","minimum":0}'::jsonb,
        'Decimal parameter value, non-negative'
      ),
      (
        'app_parameter_values',
        'value_json',
        '{"type":"object"}'::jsonb,
        'JSON-serialized parameter value'
      )
    ON CONFLICT (area, key) DO NOTHING;
  `);

  // ==========================================================================
  // 4. Bridge parameter seed function
  // ==========================================================================
  pgm.sql(`
    CREATE OR REPLACE FUNCTION config_app_parameter_seed()
    RETURNS TABLE (
      code TEXT,
      name TEXT,
      description TEXT,
      module_code TEXT,
      parameter_type TEXT,
      schema_area TEXT,
      schema_key TEXT,
      default_value JSONB,
      allowed_levels TEXT,
      org_override_allowed BOOLEAN,
      is_guardrail BOOLEAN
    ) AS $seed$
      SELECT
        s.code,
        s.name,
        s.description,
        s.module_code,
        s.parameter_type,
        s.schema_area,
        s.schema_key,
        s.default_value,
        s.allowed_levels,
        s.org_override_allowed,
        s.is_guardrail
      FROM (VALUES
        (
          'document.backdate.max_days',
          'Document Backdate Max Days',
          'Maximum days in the past a document can be backdated',
          'platform',
          'integer',
          'app_parameter_values',
          'value_integer',
          '30'::jsonb,
          'S,C,O',
          true,
          false
        ),
        (
          'document.numbering.pattern_policy',
          'Document Numbering Pattern Policy',
          'Naming convention for auto-generated document numbers',
          'platform',
          'string',
          'app_parameter_values',
          'value_string',
          '"DOC-{YY}{MM}{SEQ:4}"'::jsonb,
          'S,C',
          false,
          false
        ),
        (
          'document.attachment.reference_required',
          'Document Attachment Reference Required',
          'Whether attachments must reference an entity (guardrail)',
          'platform',
          'boolean',
          'app_parameter_values',
          'value_boolean',
          'true'::jsonb,
          'S,C',
          false,
          true
        )
      ) AS s(
        code, name, description, module_code, parameter_type,
        schema_area, schema_key, default_value, allowed_levels,
        org_override_allowed, is_guardrail
      );
    $seed$ LANGUAGE sql IMMUTABLE;
  `);

  // ==========================================================================
  // 5. Seed bridge parameters into app_parameters
  // ==========================================================================
  pgm.sql(`
    INSERT INTO app_parameters
      (code, name, description, module_code, parameter_type,
       schema_area, schema_key, default_value, allowed_levels,
       org_override_allowed, is_guardrail, is_active)
    SELECT
      s.code, s.name, s.description, s.module_code, s.parameter_type,
      s.schema_area, s.schema_key, s.default_value, s.allowed_levels,
      s.org_override_allowed, s.is_guardrail, true
    FROM config_app_parameter_seed() s
    ON CONFLICT (code) DO NOTHING;
  `);

  // ============================================================================
  // 6. HTTP route dictionary parity for existing and future tenants
  // ============================================================================
  pgm.sql(`
    CREATE OR REPLACE FUNCTION config_parameter_api_resource_seed()
    RETURNS TABLE (code TEXT, name TEXT, module_code TEXT, http_method TEXT, path_pattern TEXT) AS $seed$
      SELECT * FROM (VALUES
        ('api:GET /config/parameters', 'GET /config/parameters', 'platform', 'GET', '/config/parameters'),
        ('api:GET /config/parameters/:code/effective', 'GET /config/parameters/:code/effective', 'platform', 'GET', '/config/parameters/:code/effective'),
        ('api:PUT /config/parameters/:code/values', 'PUT /config/parameters/:code/values', 'platform', 'PUT', '/config/parameters/:code/values')
      ) AS v(code, name, module_code, http_method, path_pattern);
    $seed$ LANGUAGE sql IMMUTABLE;

    CREATE OR REPLACE FUNCTION config_seed_parameter_api_resources_for_tenant()
    RETURNS trigger AS $trg$
    BEGIN
      INSERT INTO app_api_resources
        (tenant_id, code, name, module_code, http_method, path_pattern)
      SELECT NEW.id, s.code, s.name, s.module_code, s.http_method, s.path_pattern
        FROM config_parameter_api_resource_seed() s
      ON CONFLICT (tenant_id, code) DO NOTHING;
      RETURN NEW;
    END;
    $trg$ LANGUAGE plpgsql;

    CREATE TRIGGER trg_config_seed_parameter_api_resources
      AFTER INSERT ON tenants
      FOR EACH ROW EXECUTE FUNCTION config_seed_parameter_api_resources_for_tenant();

    INSERT INTO app_api_resources
      (tenant_id, code, name, module_code, http_method, path_pattern)
    SELECT t.id, s.code, s.name, s.module_code, s.http_method, s.path_pattern
      FROM tenants t
      CROSS JOIN config_parameter_api_resource_seed() s
    ON CONFLICT (tenant_id, code) DO NOTHING;
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    DO $$
    BEGIN
      IF EXISTS (SELECT 1 FROM app_parameter_values) THEN
        RAISE EXCEPTION 'Refusing to drop app_parameter_values: explicit tenant parameter values exist';
      END IF;
    END $$;

    DROP TRIGGER IF EXISTS trg_config_seed_parameter_api_resources ON tenants;
    DROP FUNCTION IF EXISTS config_seed_parameter_api_resources_for_tenant();
    DROP FUNCTION IF EXISTS config_parameter_api_resource_seed();

    DELETE FROM app_api_resources
     WHERE code IN (
       'api:GET /config/parameters',
       'api:GET /config/parameters/:code/effective',
       'api:PUT /config/parameters/:code/values'
     );
  `);

  pgm.dropTable("app_parameter_values");
  pgm.dropTable("app_parameters");

  pgm.sql(`
    DROP FUNCTION IF EXISTS config_app_parameter_seed();

    DELETE FROM metadata_registry
     WHERE area = 'app_parameter_values'
       AND key IN ('value_boolean', 'value_integer', 'value_string', 'value_decimal', 'value_json');
  `);
};
