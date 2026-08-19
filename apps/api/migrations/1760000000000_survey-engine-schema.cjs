/**
 * Checkpoint 1D.1 — Generic Survey & Assessment Engine schema.
 *
 * Product Core, reusable across modules/clients (Build Once, Configure Per
 * Client). Two aggregates:
 *   - Definition (template, immutable once published):
 *       survey_definitions -> survey_versions -> survey_sections
 *                                              -> survey_questions -> survey_question_options
 *   - Assignment (instance + response container, FD-1D-02):
 *       survey_assignments -> survey_answers -> survey_answer_options
 *
 * Tenant ownership lives on the aggregate ROOTS (survey_definitions,
 * survey_assignments). Sub-entities inherit tenancy through their root and
 * are tenant-guarded in the application layer + tests (FD/§5) — no composite
 * keys. `gen_random_uuid()` comes from pgcrypto (migration 0001).
 *
 * No survey numbering (FD-1D-07 — UUID is sufficient). No client-specific
 * content here — catalogs/wording are Configuration/seed data.
 */
exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE survey_definitions (
      id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id    uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      code         text NOT NULL,
      name         text NOT NULL,
      description  text,
      is_active    boolean NOT NULL DEFAULT true,
      created_by   uuid,
      created_at   timestamptz NOT NULL DEFAULT now(),
      updated_by   uuid,
      updated_at   timestamptz NOT NULL DEFAULT now(),
      UNIQUE (tenant_id, code)
    );

    CREATE TABLE survey_versions (
      id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      survey_definition_id   uuid NOT NULL REFERENCES survey_definitions(id) ON DELETE CASCADE,
      version_number         integer NOT NULL,
      status                 text NOT NULL DEFAULT 'draft',
      is_current             boolean NOT NULL DEFAULT false,
      published_at           timestamptz,
      created_by             uuid,
      created_at             timestamptz NOT NULL DEFAULT now(),
      UNIQUE (survey_definition_id, version_number)
    );

    CREATE TABLE survey_sections (
      id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      survey_version_id  uuid NOT NULL REFERENCES survey_versions(id) ON DELETE CASCADE,
      code               text NOT NULL,
      title              text NOT NULL,
      description        text,
      sort_order         integer NOT NULL DEFAULT 0,
      UNIQUE (survey_version_id, code)
    );

    CREATE TABLE survey_questions (
      id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      survey_version_id  uuid NOT NULL REFERENCES survey_versions(id) ON DELETE CASCADE,
      section_id         uuid REFERENCES survey_sections(id) ON DELETE SET NULL,
      code               text NOT NULL,
      text               text NOT NULL,
      question_type      text NOT NULL,
      is_required        boolean NOT NULL DEFAULT false,
      config             jsonb NOT NULL DEFAULT '{}'::jsonb,
      sort_order         integer NOT NULL DEFAULT 0,
      UNIQUE (survey_version_id, code)
    );

    CREATE TABLE survey_question_options (
      id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      survey_question_id  uuid NOT NULL REFERENCES survey_questions(id) ON DELETE CASCADE,
      code                text NOT NULL,
      label               text NOT NULL,
      score               numeric,
      sort_order          integer NOT NULL DEFAULT 0,
      UNIQUE (survey_question_id, code)
    );

    CREATE TABLE survey_assignments (
      id                              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id                       uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      survey_version_id               uuid NOT NULL REFERENCES survey_versions(id) ON DELETE RESTRICT,
      respondent_type                 text NOT NULL,
      respondent_user_id              uuid REFERENCES users(id) ON DELETE SET NULL,
      respondent_customer_contact_id  uuid REFERENCES customer_contacts(id) ON DELETE SET NULL,
      context_entity_type             text,
      context_entity_id               uuid,
      status                          text NOT NULL DEFAULT 'pending',
      due_at                          timestamptz,
      total_score                     numeric,
      assigned_by                     uuid,
      created_at                      timestamptz NOT NULL DEFAULT now(),
      submitted_at                    timestamptz
    );

    CREATE TABLE survey_answers (
      id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      survey_assignment_id uuid NOT NULL REFERENCES survey_assignments(id) ON DELETE CASCADE,
      survey_question_id   uuid NOT NULL REFERENCES survey_questions(id) ON DELETE RESTRICT,
      value_text           text,
      value_numeric        numeric,
      answered_at          timestamptz NOT NULL DEFAULT now(),
      updated_at           timestamptz NOT NULL DEFAULT now(),
      UNIQUE (survey_assignment_id, survey_question_id)
    );

    CREATE TABLE survey_answer_options (
      id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      survey_answer_id          uuid NOT NULL REFERENCES survey_answers(id) ON DELETE CASCADE,
      survey_question_option_id uuid NOT NULL REFERENCES survey_question_options(id) ON DELETE RESTRICT,
      UNIQUE (survey_answer_id, survey_question_option_id)
    );

    -- Indexes (§24) — FK lookups + the queries the vertical slice runs.
    CREATE INDEX idx_survey_definitions_tenant ON survey_definitions(tenant_id);
    CREATE INDEX idx_survey_versions_definition_current ON survey_versions(survey_definition_id, is_current);
    CREATE INDEX idx_survey_sections_version ON survey_sections(survey_version_id);
    CREATE INDEX idx_survey_questions_version ON survey_questions(survey_version_id);
    CREATE INDEX idx_survey_question_options_question ON survey_question_options(survey_question_id);
    CREATE INDEX idx_survey_assignments_tenant_status ON survey_assignments(tenant_id, status);
    CREATE INDEX idx_survey_assignments_respondent_user ON survey_assignments(respondent_user_id);
    CREATE INDEX idx_survey_assignments_version ON survey_assignments(survey_version_id);
    CREATE INDEX idx_survey_assignments_context ON survey_assignments(context_entity_type, context_entity_id);
    CREATE INDEX idx_survey_answers_assignment ON survey_answers(survey_assignment_id);
    CREATE INDEX idx_survey_answer_options_answer ON survey_answer_options(survey_answer_id);
  `);
};

exports.down = (pgm) => {
  // Drop in FK-dependency order (children first). Rollback-safe.
  pgm.sql(`
    DROP TABLE IF EXISTS survey_answer_options;
    DROP TABLE IF EXISTS survey_answers;
    DROP TABLE IF EXISTS survey_assignments;
    DROP TABLE IF EXISTS survey_question_options;
    DROP TABLE IF EXISTS survey_questions;
    DROP TABLE IF EXISTS survey_sections;
    DROP TABLE IF EXISTS survey_versions;
    DROP TABLE IF EXISTS survey_definitions;
  `);
};
