/**
 * Phase H2 — Production Platform Hardening.
 *
 * PH-8 adds a durable, per-endpoint outbound delivery record. Domain Events
 * remain the source of truth and the existing in-process EventBus remains the
 * immediate dispatch point; the reconciliation job closes the process-crash
 * window between recording a Domain Event and creating its delivery records.
 *
 * One delivery per (Domain Event, outbound Endpoint) is enforced in PostgreSQL.
 * Claims use status transitions plus SKIP LOCKED in the repository, retries are
 * persisted, stale claims can be recovered, and terminal failures are visible
 * in the outbox while successful/terminal outcomes are mirrored idempotently to
 * the existing Integration event log.
 */

exports.up = (pgm) => {
  pgm.createTable("integration_outbox_deliveries", {
    id: { type: "uuid", primaryKey: true, default: pgm.func("gen_random_uuid()") },
    tenant_id: { type: "uuid", notNull: true, references: "tenants", onDelete: "CASCADE" },
    domain_event_id: {
      type: "uuid",
      notNull: true,
      references: "domain_events",
      onDelete: "CASCADE",
    },
    integration_endpoint_id: {
      type: "uuid",
      notNull: true,
      references: "integration_endpoints",
      onDelete: "CASCADE",
    },
    status: {
      type: "text",
      notNull: true,
      default: "pending",
      check: "status IN ('pending', 'processing', 'retry', 'succeeded', 'terminal_failed')",
    },
    attempt_count: { type: "integer", notNull: true, default: 0, check: "attempt_count >= 0" },
    next_attempt_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
    locked_at: { type: "timestamptz", notNull: false },
    last_error: { type: "text", notNull: false },
    last_log_status: {
      type: "text",
      notNull: false,
      check: "last_log_status IN ('sent', 'failed')",
    },
    completed_at: { type: "timestamptz", notNull: false },
    created_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
    updated_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
  });
  pgm.addConstraint(
    "integration_outbox_deliveries",
    "integration_outbox_deliveries_event_endpoint_unique",
    { unique: ["domain_event_id", "integration_endpoint_id"] },
  );
  pgm.createIndex(
    "integration_outbox_deliveries",
    ["tenant_id", "status", "next_attempt_at"],
    { name: "integration_outbox_deliveries_due_idx" },
  );
  pgm.createIndex(
    "integration_outbox_deliveries",
    ["status", "locked_at"],
    { name: "integration_outbox_deliveries_stale_claim_idx" },
  );

  pgm.sql(`
    INSERT INTO scheduled_jobs
      (job_code, name, description, interval_seconds, handler_key, is_enabled)
    VALUES (
      'integration-outbox-reconciliation',
      'Integration Outbox Reconciliation',
      'Reconciles durable Domain Events with active outbound Integration Endpoints and safely processes due or interrupted deliveries.',
      60,
      'integration-outbox-reconciliation',
      true
    )
    ON CONFLICT (job_code) DO NOTHING
  `);
};

exports.down = (pgm) => {
  pgm.sql(`DELETE FROM scheduled_jobs WHERE job_code = 'integration-outbox-reconciliation'`);
  pgm.dropTable("integration_outbox_deliveries");
};
