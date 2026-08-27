exports.up = (pgm) => {
  pgm.sql(`

    -- -----------------------------------------------------------------------
    -- Wave A2 — Survey & Reporting Advanced (SUR-ADV-003…007, RPT-ADV-001…002)
    --
    -- Survey Advanced: conditional branching, matrix/grid questions, weighted/
    -- section/NPS scoring, anonymous/public-token distribution, multi-language
    -- content, cross-survey analytics.
    --
    -- Reporting Advanced: governed self-service BI metadata surface (no
    -- arbitrary SQL, no query editor, no DSL) and deterministic predictive
    -- analytics foundation (bounded, tenant-isolated, no autonomous mutation).
    --
    -- Every new table carries tenant_id with CASCADE delete to tenants.
    -- No hard-delete of historical survey/response/score/report evidence.
    -- Anonymous identity is never stored or leaked.
    -- -----------------------------------------------------------------------

    -- === SUR-ADV-003: Conditional branching ================================

    CREATE TABLE survey_branching_rules (
      id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id             UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      survey_version_id     UUID        NOT NULL REFERENCES survey_versions(id) ON DELETE CASCADE,
      source_question_id    UUID        NOT NULL REFERENCES survey_questions(id) ON DELETE CASCADE,

      condition_operator    TEXT        NOT NULL,
      condition_value       JSONB       NOT NULL DEFAULT '[]'::jsonb,

      target_action         TEXT        NOT NULL DEFAULT 'jump_to_question',
      target_question_id    UUID        REFERENCES survey_questions(id) ON DELETE CASCADE,
      target_section_id     UUID        REFERENCES survey_sections(id) ON DELETE CASCADE,

      priority              INTEGER     NOT NULL DEFAULT 0,
      created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    ALTER TABLE survey_branching_rules
      ADD CONSTRAINT survey_branching_rules_tenant_id_id_unique UNIQUE (tenant_id, id);
    CREATE INDEX idx_survey_branching_rules_version
      ON survey_branching_rules (survey_version_id);
    CREATE INDEX idx_survey_branching_rules_source
      ON survey_branching_rules (source_question_id);

    -- === SUR-ADV-003: Matrix/grid questions =================================

    CREATE TABLE survey_matrix_rows (
      id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id             UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      survey_question_id    UUID        NOT NULL REFERENCES survey_questions(id) ON DELETE CASCADE,

      code                  TEXT        NOT NULL,
      label                 TEXT        NOT NULL,
      sort_order            INTEGER     NOT NULL DEFAULT 0,

      UNIQUE (survey_question_id, code)
    );

    ALTER TABLE survey_matrix_rows
      ADD CONSTRAINT survey_matrix_rows_tenant_id_id_unique UNIQUE (tenant_id, id);
    CREATE INDEX idx_survey_matrix_rows_question
      ON survey_matrix_rows (survey_question_id);

    CREATE TABLE survey_matrix_answers (
      id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id             UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      survey_assignment_id  UUID        NOT NULL REFERENCES survey_assignments(id) ON DELETE CASCADE,
      survey_question_id    UUID        NOT NULL REFERENCES survey_questions(id) ON DELETE RESTRICT,
      matrix_row_id         UUID        NOT NULL REFERENCES survey_matrix_rows(id) ON DELETE RESTRICT,

      value_text            TEXT,
      value_numeric         NUMERIC,
      selected_option_id    UUID        REFERENCES survey_question_options(id) ON DELETE RESTRICT,

      answered_at           TIMESTAMPTZ NOT NULL DEFAULT now(),

      UNIQUE (survey_assignment_id, survey_question_id, matrix_row_id)
    );

    ALTER TABLE survey_matrix_answers
      ADD CONSTRAINT survey_matrix_answers_tenant_id_id_unique UNIQUE (tenant_id, id);
    CREATE INDEX idx_survey_matrix_answers_assignment
      ON survey_matrix_answers (survey_assignment_id);

    -- === SUR-ADV-004: Section-level scoring =================================

    -- Add scoring config to survey_versions and weight to survey_questions
    ALTER TABLE survey_versions
      ADD COLUMN scoring_model TEXT NOT NULL DEFAULT 'sum';

    ALTER TABLE survey_sections
      ADD COLUMN scoring_model TEXT,
      ADD COLUMN weight        NUMERIC(5,2) NOT NULL DEFAULT 1;

    ALTER TABLE survey_questions
      ADD COLUMN weight NUMERIC(5,2) NOT NULL DEFAULT 1;

    CREATE TABLE survey_section_scores (
      id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id             UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      survey_assignment_id  UUID        NOT NULL REFERENCES survey_assignments(id) ON DELETE CASCADE,
      survey_section_id     UUID        NOT NULL REFERENCES survey_sections(id) ON DELETE RESTRICT,

      raw_score             NUMERIC,
      max_score             NUMERIC,
      percentage_score      NUMERIC(5,2),
      weighted_score        NUMERIC,

      created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),

      UNIQUE (survey_assignment_id, survey_section_id)
    );

    ALTER TABLE survey_section_scores
      ADD CONSTRAINT survey_section_scores_tenant_id_id_unique UNIQUE (tenant_id, id);
    CREATE INDEX idx_survey_section_scores_assignment
      ON survey_section_scores (survey_assignment_id);

    -- NPS score stored alongside total_score on assignment
    ALTER TABLE survey_assignments
      ADD COLUMN nps_score         NUMERIC,
      ADD COLUMN scoring_breakdown JSONB;

    -- === SUR-ADV-005: Anonymous and public-token distribution ================

    CREATE TABLE survey_distribution_tokens (
      id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id             UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      survey_version_id     UUID        NOT NULL REFERENCES survey_versions(id) ON DELETE RESTRICT,

      token_hash            TEXT        NOT NULL,
      channel               TEXT        NOT NULL DEFAULT 'link',
      recipient_label       TEXT,
      max_uses              INTEGER,
      used_count            INTEGER     NOT NULL DEFAULT 0,
      expires_at            TIMESTAMPTZ,
      revoked_at            TIMESTAMPTZ,
      metadata              JSONB       NOT NULL DEFAULT '{}'::jsonb,

      created_by            UUID        REFERENCES users(id) ON DELETE SET NULL,
      created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    ALTER TABLE survey_distribution_tokens
      ADD CONSTRAINT survey_distribution_tokens_tenant_id_id_unique UNIQUE (tenant_id, id);
    CREATE UNIQUE INDEX idx_survey_distribution_tokens_hash
      ON survey_distribution_tokens (token_hash);
    CREATE INDEX idx_survey_distribution_tokens_version
      ON survey_distribution_tokens (survey_version_id);

    -- Extend respondent type to allow anonymous / public_link
    -- The CHECK constraint on the column (if any) is not present because
    -- survey_assignments.respondent_type is a plain text column.
    -- Application layer enforces valid respondent types.

    -- Add token reference to assignments for public submissions
    ALTER TABLE survey_assignments
      ADD COLUMN distribution_token_id UUID REFERENCES survey_distribution_tokens(id) ON DELETE SET NULL;

    -- === SUR-ADV-006: Multi-language survey content ==========================

    CREATE TABLE survey_translations (
      id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id             UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      survey_version_id     UUID        NOT NULL REFERENCES survey_versions(id) ON DELETE CASCADE,

      locale                TEXT        NOT NULL,
      entity_type           TEXT        NOT NULL,
      entity_id             UUID        NOT NULL,
      field_name            TEXT        NOT NULL,
      translated_text       TEXT        NOT NULL,

      created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),

      UNIQUE (survey_version_id, locale, entity_type, entity_id, field_name)
    );

    ALTER TABLE survey_translations
      ADD CONSTRAINT survey_translations_tenant_id_id_unique UNIQUE (tenant_id, id);
    CREATE INDEX idx_survey_translations_version_locale
      ON survey_translations (survey_version_id, locale);

    -- Default locale stored on survey_versions
    ALTER TABLE survey_versions
      ADD COLUMN default_locale TEXT NOT NULL DEFAULT 'id-ID';

    -- === RPT-ADV-001: Governed self-service BI metadata =====================

    CREATE TABLE bi_datasets (
      id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id             UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,

      code                  TEXT        NOT NULL,
      name                  TEXT        NOT NULL,
      description           TEXT,
      module_code           TEXT        NOT NULL,
      base_query            TEXT        NOT NULL,
      required_permissions  TEXT[]      NOT NULL DEFAULT '{}',
      is_active             BOOLEAN     NOT NULL DEFAULT true,

      created_by            UUID        REFERENCES users(id) ON DELETE SET NULL,
      created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),

      UNIQUE (tenant_id, code)
    );

    ALTER TABLE bi_datasets
      ADD CONSTRAINT bi_datasets_tenant_id_id_unique UNIQUE (tenant_id, id);
    CREATE INDEX idx_bi_datasets_tenant
      ON bi_datasets (tenant_id) WHERE is_active;

    CREATE TABLE bi_dataset_fields (
      id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id             UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      dataset_id            UUID        NOT NULL,
      FOREIGN KEY (tenant_id, dataset_id) REFERENCES bi_datasets(tenant_id, id) ON DELETE CASCADE,

      code                  TEXT        NOT NULL,
      name                  TEXT        NOT NULL,
      field_type            TEXT        NOT NULL DEFAULT 'text',
      sql_expression        TEXT        NOT NULL,
      is_dimension          BOOLEAN     NOT NULL DEFAULT false,
      is_measure            BOOLEAN     NOT NULL DEFAULT false,
      is_filterable         BOOLEAN     NOT NULL DEFAULT true,
      aggregation           TEXT,

      sort_order            INTEGER     NOT NULL DEFAULT 0,

      UNIQUE (dataset_id, code)
    );

    ALTER TABLE bi_dataset_fields
      ADD CONSTRAINT bi_dataset_fields_tenant_id_id_unique UNIQUE (tenant_id, id);
    CREATE INDEX idx_bi_dataset_fields_dataset
      ON bi_dataset_fields (dataset_id);

    CREATE TABLE bi_saved_reports (
      id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id             UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      dataset_id            UUID        NOT NULL,
      FOREIGN KEY (tenant_id, dataset_id) REFERENCES bi_datasets(tenant_id, id) ON DELETE RESTRICT,

      code                  TEXT        NOT NULL,
      title                 TEXT        NOT NULL,
      description           TEXT,
      config                JSONB       NOT NULL DEFAULT '{}'::jsonb,
      is_shared             BOOLEAN     NOT NULL DEFAULT false,

      created_by            UUID        REFERENCES users(id) ON DELETE SET NULL,
      created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
      deleted_at            TIMESTAMPTZ,

      UNIQUE (tenant_id, code)
    );

    ALTER TABLE bi_saved_reports
      ADD CONSTRAINT bi_saved_reports_tenant_id_id_unique UNIQUE (tenant_id, id);
    CREATE INDEX idx_bi_saved_reports_tenant
      ON bi_saved_reports (tenant_id) WHERE deleted_at IS NULL;
    CREATE INDEX idx_bi_saved_reports_dataset
      ON bi_saved_reports (dataset_id) WHERE deleted_at IS NULL;

    -- === RPT-ADV-002: Predictive analytics snapshots ========================

    CREATE TABLE predictive_forecast_snapshots (
      id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id             UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,

      model_code            TEXT        NOT NULL,
      forecast_period_start DATE        NOT NULL,
      forecast_period_end   DATE        NOT NULL,

      input_params          JSONB       NOT NULL DEFAULT '{}'::jsonb,
      data_points           JSONB       NOT NULL DEFAULT '[]'::jsonb,
      metrics               JSONB       NOT NULL DEFAULT '{}'::jsonb,
      confidence_intervals  JSONB       NOT NULL DEFAULT '[]'::jsonb,
      status                TEXT        NOT NULL DEFAULT 'completed',

      generated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
      generated_by          UUID        REFERENCES users(id) ON DELETE SET NULL,

      created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    ALTER TABLE predictive_forecast_snapshots
      ADD CONSTRAINT predictive_forecast_snapshots_tenant_id_id_unique UNIQUE (tenant_id, id);
    CREATE INDEX idx_predictive_forecast_snapshots_tenant_model
      ON predictive_forecast_snapshots (tenant_id, model_code);
    CREATE INDEX idx_predictive_forecast_snapshots_period
      ON predictive_forecast_snapshots (tenant_id, forecast_period_start, forecast_period_end);

    -- === Permissions ========================================================

    INSERT INTO permissions (code, description) VALUES
      ('survey.analytics.read',     'View cross-survey analytics, benchmarking, and NPS breakdown'),
      ('reporting.bi.manage',       'Create, edit, and execute self-service BI reports from governed datasets'),
      ('reporting.predictive.read', 'View predictive analytics forecast snapshots')
    ON CONFLICT (code) DO NOTHING;

  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    -- Drop in reverse dependency order

    DELETE FROM permissions WHERE code IN (
      'survey.analytics.read',
      'reporting.bi.manage',
      'reporting.predictive.read'
    );

    DROP TABLE IF EXISTS predictive_forecast_snapshots;
    DROP TABLE IF EXISTS bi_saved_reports;
    DROP TABLE IF EXISTS bi_dataset_fields;
    DROP TABLE IF EXISTS bi_datasets;

    DROP TABLE IF EXISTS survey_translations;
    DROP TABLE IF EXISTS survey_section_scores;
    DROP TABLE IF EXISTS survey_matrix_answers;
    DROP TABLE IF EXISTS survey_matrix_rows;
    DROP TABLE IF EXISTS survey_branching_rules;

    -- survey_assignments.distribution_token_id references
    -- survey_distribution_tokens, so the column must be dropped before the
    -- table it references, or this DROP TABLE would fail on the live FK.
    ALTER TABLE survey_assignments DROP COLUMN IF EXISTS distribution_token_id;
    DROP TABLE IF EXISTS survey_distribution_tokens;

    ALTER TABLE survey_assignments DROP COLUMN IF EXISTS nps_score;
    ALTER TABLE survey_assignments DROP COLUMN IF EXISTS scoring_breakdown;

    ALTER TABLE survey_questions DROP COLUMN IF EXISTS weight;

    ALTER TABLE survey_sections DROP COLUMN IF EXISTS scoring_model;
    ALTER TABLE survey_sections DROP COLUMN IF EXISTS weight;

    ALTER TABLE survey_versions DROP COLUMN IF EXISTS scoring_model;
    ALTER TABLE survey_versions DROP COLUMN IF EXISTS default_locale;
  `);
};
