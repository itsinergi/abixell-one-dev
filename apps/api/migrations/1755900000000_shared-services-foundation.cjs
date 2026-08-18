/**
 * Checkpoint 0E — Enterprise Shared Services.
 *
 * Implements 06-Notification-Document-Audit-Foundation.md's Notification
 * Engine + Document/File Service (Audit Trail itself was already built in
 * Checkpoint 0B — this checkpoint does not touch `audit_log`), plus
 * 07-API-Integration-Foundation.md's Event System + Integration Boundary,
 * plus a Scheduler/Background Jobs foundation and an Observability layer
 * — none of which had a home yet. All six are cross-cutting: reusable by
 * any future business module, none of it knows about Complaint, Survey,
 * Procurement, or any other business module. Where a concrete example is
 * needed, this checkpoint reuses Checkpoint 0D's `demo_transactions` /
 * Workflow Engine rather than inventing a second dummy object.
 *
 * --- Event Foundation ---------------------------------------------------
 * `domain_events` is the durable, queryable log doc 07 describes
 * ("peristiwa penting dipublikasikan sebagai domain event"). The
 * in-process publish/subscribe mechanism itself (`EventBus`) is plain
 * TypeScript, not a DB table — this table is what makes publication
 * durable/inspectable (Observability) independent of which subscribers
 * happened to be registered at the time.
 *
 * --- Notification Engine -------------------------------------------------
 * `notification_templates` is Tenant Configuration (per doc 05's
 * pattern: template content is data, not code) keyed by
 * (tenant, event_type, channel). `notifications` is the send log doc 06
 * asks for ("mencatat status pengiriman sent/failed/read"). Channels
 * (email/push/whatsapp/sms/in_app) are Notification-ready in Phase 0:
 * every channel actually resolves a template and writes a row with a
 * real status, but only the `in_app` channel has anywhere for a user to
 * read it in this checkpoint's frontend — email/push/whatsapp/sms
 * dispatch is a structured log entry (`status='sent'`, no real
 * transport), which is the same "ready hook, not a full integration"
 * posture Checkpoint 0D used for Notification-ready hooks.
 *
 * --- Document / File Service ---------------------------------------------
 * `documents` is a polymorphic attachment table (entity_type/entity_id),
 * exactly like `workflow_instances.entity_id` in 0D — deliberately
 * reused pattern, not a new concept. Files are stored on local disk in
 * this Phase 0 implementation environment (see
 * `infrastructure/storage/local-file-storage.ts`); doc 09's at-rest
 * encryption and doc 06's automatic photo compression are documented
 * gaps (no object storage / image-processing infra exists yet in this
 * workspace), not implemented here — this is the same class of
 * "hook exists, infra wiring is future work" gap as 0D's Escalation
 * sweep before this checkpoint's Scheduler.
 *
 * --- Scheduler / Background Jobs ------------------------------------------
 * `scheduled_jobs` is a generic job registry (job_code -> handler_key,
 * interval), `scheduled_job_runs` is its run history (this doubles as
 * Observability for background work). The runner itself is an
 * in-process interval loop (`application/scheduler/scheduler.ts`) — no
 * external queue/cron infra exists in this workspace, so "Scheduler" in
 * Phase 0 means "the API process runs timers while it's up", explicitly
 * documented as a gap for production (needs a real job runner e.g.
 * pg-boss/BullMQ or an OS-level cron hitting an endpoint).
 *
 * --- Integration Boundary -------------------------------------------------
 * `integration_endpoints` (Tenant Configuration: which third-party
 * integrations exist, outbound or inbound) + `integration_event_log`
 * (every outbound attempt and inbound receipt, mirroring doc 07's
 * requirement that third-party integration never touches the domain
 * layer directly). No real third-party call is made in Phase 0 (no
 * pilot client integration credentials exist yet per doc 07's "Yang
 * Belum Diputuskan") — outbound is a logged stub, inbound is a real,
 * signature-validated webhook endpoint that only ever produces a
 * `domain_event`, never writes directly to any domain table.
 *
 * --- Claim/Lock evaluation (Founder-requested, ADR-0008) ------------------
 * Two nullable columns added to `workflow_instance_assignments`
 * (`claimed_by_user_id`, `claimed_at`) — purely additive, does not change
 * the Role+Scope queue routing model from ADR-0007. See
 * docs/adr/0008-workflow-assignment-claim-lock.md for the full
 * evaluation of why this is opt-in, TTL-based, and non-breaking.
 */

exports.up = (pgm) => {
  // --- New permissions (Product Core catalog, appended) ------------------
  pgm.sql(`
    INSERT INTO permissions (code, description) VALUES
      ('notification.template.manage', 'Author Notification Templates per Tenant/event/channel'),
      ('notification.read', 'Read the Notification send log (own notifications and, with tenant scope, the tenant log)'),
      ('document.manage', 'Upload and delete Documents/Attachments'),
      ('document.read', 'Read/download Documents/Attachments'),
      ('scheduler.manage', 'View and manually trigger Scheduled Jobs, enable/disable them'),
      ('integration.manage', 'Manage Integration Endpoints (outbound/inbound third-party integration config)'),
      ('integration.read', 'Read the Integration event log (outbound attempts, inbound receipts)'),
      ('observability.read', 'Read cross-cutting Observability data: domain event log, Scheduled Job run history')
  `);

  // --- Event Foundation ----------------------------------------------------
  pgm.createTable("domain_events", {
    id: { type: "uuid", primaryKey: true, default: pgm.func("gen_random_uuid()") },
    tenant_id: { type: "uuid", notNull: true, references: "tenants", onDelete: "CASCADE" },
    event_type: { type: "text", notNull: true },
    entity_type: { type: "text", notNull: true },
    entity_id: { type: "uuid", notNull: false },
    payload: { type: "jsonb", notNull: true, default: "{}" },
    occurred_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
    created_by: { type: "uuid", notNull: false, references: "users", onDelete: "CASCADE" },
  });
  pgm.createIndex("domain_events", ["tenant_id", "occurred_at"]);
  pgm.createIndex("domain_events", ["event_type"]);

  // --- Notification Engine --------------------------------------------------
  pgm.createTable("notification_templates", {
    id: { type: "uuid", primaryKey: true, default: pgm.func("gen_random_uuid()") },
    tenant_id: { type: "uuid", notNull: true, references: "tenants", onDelete: "CASCADE" },
    event_type: { type: "text", notNull: true },
    channel: {
      type: "text",
      notNull: true,
      check: "channel IN ('email', 'push', 'whatsapp', 'sms', 'in_app')",
    },
    subject_template: { type: "text", notNull: false },
    body_template: { type: "text", notNull: true },
    is_active: { type: "boolean", notNull: true, default: true },
    created_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
  });
  pgm.addConstraint("notification_templates", "notification_templates_unique_scope", {
    unique: ["tenant_id", "event_type", "channel"],
  });

  pgm.createTable("notifications", {
    id: { type: "uuid", primaryKey: true, default: pgm.func("gen_random_uuid()") },
    tenant_id: { type: "uuid", notNull: true, references: "tenants", onDelete: "CASCADE" },
    domain_event_id: { type: "uuid", notNull: false, references: "domain_events", onDelete: "CASCADE" },
    event_type: { type: "text", notNull: true },
    channel: {
      type: "text",
      notNull: true,
      check: "channel IN ('email', 'push', 'whatsapp', 'sms', 'in_app')",
    },
    recipient_user_id: { type: "uuid", notNull: false, references: "users", onDelete: "CASCADE" },
    subject: { type: "text", notNull: false },
    body: { type: "text", notNull: true },
    status: {
      type: "text",
      notNull: true,
      check: "status IN ('sent', 'failed', 'skipped')",
    },
    error_message: { type: "text", notNull: false },
    sent_at: { type: "timestamptz", notNull: false },
    read_at: { type: "timestamptz", notNull: false },
    created_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
  });
  pgm.createIndex("notifications", ["tenant_id", "recipient_user_id", "created_at"]);

  // --- Document / File Service -----------------------------------------------
  pgm.createTable("documents", {
    id: { type: "uuid", primaryKey: true, default: pgm.func("gen_random_uuid()") },
    tenant_id: { type: "uuid", notNull: true, references: "tenants", onDelete: "CASCADE" },
    entity_type: { type: "text", notNull: true },
    entity_id: { type: "uuid", notNull: true },
    file_name: { type: "text", notNull: true },
    mime_type: { type: "text", notNull: true },
    size_bytes: { type: "bigint", notNull: true },
    storage_path: { type: "text", notNull: true },
    checksum: { type: "text", notNull: true },
    uploaded_by: { type: "uuid", notNull: false, references: "users", onDelete: "CASCADE" },
    created_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
    deleted_at: { type: "timestamptz", notNull: false },
  });
  pgm.createIndex("documents", ["tenant_id", "entity_type", "entity_id"]);

  // --- Scheduler / Background Jobs -------------------------------------------
  pgm.createTable("scheduled_jobs", {
    id: { type: "uuid", primaryKey: true, default: pgm.func("gen_random_uuid()") },
    job_code: { type: "text", notNull: true, unique: true },
    name: { type: "text", notNull: true },
    description: { type: "text", notNull: true },
    interval_seconds: { type: "integer", notNull: true },
    handler_key: { type: "text", notNull: true },
    is_enabled: { type: "boolean", notNull: true, default: true },
    last_run_at: { type: "timestamptz", notNull: false },
    last_status: { type: "text", notNull: false },
    last_duration_ms: { type: "integer", notNull: false },
    last_error: { type: "text", notNull: false },
    created_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
    updated_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
  });

  pgm.createTable("scheduled_job_runs", {
    id: { type: "uuid", primaryKey: true, default: pgm.func("gen_random_uuid()") },
    scheduled_job_id: { type: "uuid", notNull: true, references: "scheduled_jobs", onDelete: "CASCADE" },
    trigger: { type: "text", notNull: true, check: "trigger IN ('scheduler', 'manual')" },
    triggered_by: { type: "uuid", notNull: false, references: "users", onDelete: "CASCADE" },
    started_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
    finished_at: { type: "timestamptz", notNull: false },
    status: { type: "text", notNull: true, check: "status IN ('running', 'success', 'failed')" },
    result_summary: { type: "jsonb", notNull: false },
    error_message: { type: "text", notNull: false },
  });
  pgm.createIndex("scheduled_job_runs", ["scheduled_job_id", "started_at"]);

  // --- Integration Boundary ---------------------------------------------------
  pgm.createTable("integration_endpoints", {
    id: { type: "uuid", primaryKey: true, default: pgm.func("gen_random_uuid()") },
    tenant_id: { type: "uuid", notNull: true, references: "tenants", onDelete: "CASCADE" },
    code: { type: "text", notNull: true },
    name: { type: "text", notNull: true },
    direction: { type: "text", notNull: true, check: "direction IN ('outbound', 'inbound')" },
    base_url: { type: "text", notNull: false },
    webhook_secret: { type: "text", notNull: false },
    is_active: { type: "boolean", notNull: true, default: true },
    created_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
  });
  pgm.addConstraint("integration_endpoints", "integration_endpoints_unique_code", {
    unique: ["tenant_id", "code"],
  });

  pgm.createTable("integration_event_log", {
    id: { type: "uuid", primaryKey: true, default: pgm.func("gen_random_uuid()") },
    tenant_id: { type: "uuid", notNull: true, references: "tenants", onDelete: "CASCADE" },
    integration_endpoint_id: {
      type: "uuid",
      notNull: false,
      references: "integration_endpoints",
      onDelete: "CASCADE",
    },
    direction: { type: "text", notNull: true, check: "direction IN ('outbound', 'inbound')" },
    event_type: { type: "text", notNull: true },
    payload: { type: "jsonb", notNull: true },
    status: {
      type: "text",
      notNull: true,
      check: "status IN ('sent', 'failed', 'received', 'rejected')",
    },
    error_message: { type: "text", notNull: false },
    created_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
  });
  pgm.createIndex("integration_event_log", ["tenant_id", "created_at"]);

  // --- ADR-0008: additive claim/lock columns on Workflow Assignment ----------
  pgm.addColumns("workflow_instance_assignments", {
    claimed_by_user_id: { type: "uuid", notNull: false, references: "users", onDelete: "CASCADE" },
    claimed_at: { type: "timestamptz", notNull: false },
  });

  // --- Scheduled Job registry entry (Product Core, not Tenant data) -------
  // 120s interval so the Founder-requested "prove escalation sweep runs
  // automatically" demonstration is observable within a couple of
  // minutes rather than requiring a long wait; a real deployment would
  // tune this (or move to a proper cron/queue, see migration file
  // header) once real SLA hours are in play.
  pgm.sql(`
    INSERT INTO scheduled_jobs (job_code, name, description, interval_seconds, handler_key, is_enabled)
    VALUES (
      'workflow-escalation-sweep',
      'Workflow Escalation Sweep',
      'Automatically escalates every overdue pending Workflow Assignment (SLA exceeded) across all Tenants, per each Step''s Escalation Rule — the same sweep 0D exposed as a manual RBAC-gated endpoint, now also run on a timer.',
      120,
      'workflow-escalation-sweep',
      true
    )
  `);
};

exports.down = (pgm) => {
  pgm.dropColumns("workflow_instance_assignments", ["claimed_by_user_id", "claimed_at"]);
  pgm.dropTable("integration_event_log");
  pgm.dropTable("integration_endpoints");
  pgm.dropTable("scheduled_job_runs");
  pgm.dropTable("scheduled_jobs");
  pgm.dropTable("documents");
  pgm.dropTable("notifications");
  pgm.dropTable("notification_templates");
  pgm.dropTable("domain_events");
  pgm.sql(`
    DELETE FROM permissions WHERE code IN (
      'notification.template.manage', 'notification.read',
      'document.manage', 'document.read',
      'scheduler.manage',
      'integration.manage', 'integration.read',
      'observability.read'
    )
  `);
};
