/**
 * Checkpoint 1E.2 — Survey outcome evaluation + Management Attention.
 *
 * Purely ADDITIVE to the two tables approved in 1E.1 (no third table, no
 * destructive change, existing 1E.1 rows stay valid — every new column is
 * nullable, FD-1E §47/§48/§49).
 *
 *  - survey_integration_policies gains the finite outcome configuration:
 *    one question code + one numeric operator + one threshold, plus the
 *    target action and the capability used to resolve management
 *    recipients. Explicit columns, NOT a JSONB/DSL (FD-1E §9/§10).
 *
 *  - survey_integration_executions gains (a) a SNAPSHOT of that outcome
 *    configuration, taken when the Assignment is created, so editing a
 *    policy afterwards cannot retroactively change how an already-assigned
 *    survey is judged (FD-1E §29 — assignment-lifecycle policy semantics),
 *    and (b) the second-half lifecycle: which submission was evaluated,
 *    what the outcome was, and what happened to the management attention.
 *    One execution row therefore traces the whole lineage:
 *      trigger event -> assignment -> submission -> outcome -> action.
 *
 * Exactly-once for the action is enforced without a new table or index: the
 * orchestrator claims an execution with a conditional UPDATE
 * (`WHERE outcome IS NULL`), so a replayed `survey.submitted` loses the
 * compare-and-set and performs no second action (FD-1E §25 — DB is the
 * final idempotency boundary).
 */
exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE survey_integration_policies
      ADD COLUMN IF NOT EXISTS outcome_question_code    text,
      ADD COLUMN IF NOT EXISTS outcome_operator         text,
      ADD COLUMN IF NOT EXISTS outcome_numeric_value    numeric,
      ADD COLUMN IF NOT EXISTS target_action            text,
      ADD COLUMN IF NOT EXISTS attention_permission_code text;

    ALTER TABLE survey_integration_executions
      -- Snapshot of the policy's outcome configuration at assignment time.
      ADD COLUMN IF NOT EXISTS outcome_question_code     text,
      ADD COLUMN IF NOT EXISTS outcome_operator          text,
      ADD COLUMN IF NOT EXISTS outcome_numeric_value     numeric,
      ADD COLUMN IF NOT EXISTS target_action             text,
      ADD COLUMN IF NOT EXISTS attention_permission_code text,
      -- Second half: submission -> outcome -> action.
      ADD COLUMN IF NOT EXISTS submitted_domain_event_id uuid REFERENCES domain_events(id) ON DELETE SET NULL,
      ADD COLUMN IF NOT EXISTS outcome                   text,
      ADD COLUMN IF NOT EXISTS outcome_value             numeric,
      ADD COLUMN IF NOT EXISTS outcome_error_code        text,
      ADD COLUMN IF NOT EXISTS outcome_evaluated_at      timestamptz,
      ADD COLUMN IF NOT EXISTS attention_status          text,
      ADD COLUMN IF NOT EXISTS attention_event_id        uuid REFERENCES domain_events(id) ON DELETE SET NULL,
      ADD COLUMN IF NOT EXISTS attention_recipient_count integer;

    CREATE INDEX IF NOT EXISTS idx_svy_intg_exec_outcome
      ON survey_integration_executions(outcome);
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    DROP INDEX IF EXISTS idx_svy_intg_exec_outcome;

    ALTER TABLE survey_integration_executions
      DROP COLUMN IF EXISTS attention_recipient_count,
      DROP COLUMN IF EXISTS attention_event_id,
      DROP COLUMN IF EXISTS attention_status,
      DROP COLUMN IF EXISTS outcome_evaluated_at,
      DROP COLUMN IF EXISTS outcome_error_code,
      DROP COLUMN IF EXISTS outcome_value,
      DROP COLUMN IF EXISTS outcome,
      DROP COLUMN IF EXISTS submitted_domain_event_id,
      DROP COLUMN IF EXISTS attention_permission_code,
      DROP COLUMN IF EXISTS target_action,
      DROP COLUMN IF EXISTS outcome_numeric_value,
      DROP COLUMN IF EXISTS outcome_operator,
      DROP COLUMN IF EXISTS outcome_question_code;

    ALTER TABLE survey_integration_policies
      DROP COLUMN IF EXISTS attention_permission_code,
      DROP COLUMN IF EXISTS target_action,
      DROP COLUMN IF EXISTS outcome_numeric_value,
      DROP COLUMN IF EXISTS outcome_operator,
      DROP COLUMN IF EXISTS outcome_question_code;
  `);
};
