/**
 * Checkpoint 1E.1 — Complaint-to-Survey Assignment Integration schema.
 *
 * Two tables owned by a NEW application-layer orchestrator (`survey-
 * integration`) that sits BETWEEN Complaint Core and Survey Core. Neither
 * Core imports the other; the orchestrator subscribes to a domain event
 * and calls each Core's application port (one-way dependency, FD-1E §39).
 *
 *  - survey_integration_policies: finite, structured, Tenant-scoped
 *    Configuration (which source event, for which Survey Definition, how to
 *    resolve the respondent). NOT a rule engine / DSL — every field is a
 *    finite supported capability (FD-1E §7). Outcome/action fields are
 *    deliberately absent (YAGNI) — those belong to 1E.2 and may be added
 *    additively then.
 *
 *  - survey_integration_executions: the durable idempotency + observability
 *    record of every trigger the orchestrator handled. Because the in-
 *    process EventBus is fire-once and SWALLOWS subscriber exceptions, the
 *    DB — not the bus — is the final idempotency boundary (FD-1E §12/§15):
 *      * UNIQUE(policy_id, trigger_domain_event_id)      -> event-replay safe
 *      * partial UNIQUE(policy_id, source_entity_type,
 *        source_entity_id) WHERE status='assigned'       -> one-per-lifetime
 *
 * `gen_random_uuid()` comes from pgcrypto (migration 0001). No client-
 * specific content here (Build Once, Configure Per Client).
 */
exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE survey_integration_policies (
      id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id               uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      code                    text NOT NULL,
      name                    text NOT NULL,
      enabled                 boolean NOT NULL DEFAULT true,
      source_entity_type      text NOT NULL,
      source_event_type       text NOT NULL,
      survey_definition_code  text NOT NULL,
      respondent_resolution   text NOT NULL,
      one_per_entity_lifetime boolean NOT NULL DEFAULT true,
      created_at              timestamptz NOT NULL DEFAULT now(),
      updated_at              timestamptz NOT NULL DEFAULT now(),
      created_by              uuid,
      updated_by              uuid,
      UNIQUE (tenant_id, code)
    );

    CREATE INDEX idx_svy_intg_policies_tenant_enabled
      ON survey_integration_policies(tenant_id, enabled);
    CREATE INDEX idx_svy_intg_policies_source
      ON survey_integration_policies(tenant_id, source_entity_type, source_event_type);

    CREATE TABLE survey_integration_executions (
      id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id               uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      policy_id               uuid NOT NULL REFERENCES survey_integration_policies(id) ON DELETE CASCADE,
      trigger_domain_event_id uuid NOT NULL REFERENCES domain_events(id) ON DELETE CASCADE,
      source_entity_type      text NOT NULL,
      source_entity_id        uuid NOT NULL,
      survey_assignment_id    uuid REFERENCES survey_assignments(id) ON DELETE SET NULL,
      respondent_user_id      uuid REFERENCES users(id) ON DELETE SET NULL,
      status                  text NOT NULL,
      error_code              text,
      error_message           text,
      started_at              timestamptz NOT NULL DEFAULT now(),
      completed_at            timestamptz,
      created_at              timestamptz NOT NULL DEFAULT now()
    );

    -- Event-replay idempotency: a redelivered/reprocessed trigger event
    -- (same policy + same domain event) can never create a second row.
    CREATE UNIQUE INDEX uq_svy_intg_exec_policy_event
      ON survey_integration_executions(policy_id, trigger_domain_event_id);

    -- One-per-lifetime: at most ONE 'assigned' execution per (policy,
    -- source entity), so close -> reopen -> re-confirm does not produce a
    -- second survey. Partial so skipped/failed rows never block a retry.
    CREATE UNIQUE INDEX uq_svy_intg_exec_lifetime
      ON survey_integration_executions(policy_id, source_entity_type, source_entity_id)
      WHERE status = 'assigned';

    CREATE INDEX idx_svy_intg_exec_entity
      ON survey_integration_executions(tenant_id, source_entity_type, source_entity_id);
    CREATE INDEX idx_svy_intg_exec_assignment
      ON survey_integration_executions(survey_assignment_id);
    CREATE INDEX idx_svy_intg_exec_status
      ON survey_integration_executions(status);
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    DROP TABLE IF EXISTS survey_integration_executions;
    DROP TABLE IF EXISTS survey_integration_policies;
  `);
};
