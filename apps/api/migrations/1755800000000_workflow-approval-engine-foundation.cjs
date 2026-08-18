/**
 * Checkpoint 0D — Workflow & Approval Engine Foundation.
 *
 * Implements 04-Workflow-Approval-Engine-Foundation.md's generic engine:
 * Workflow Definition -> Version -> Step -> Transition -> Condition ->
 * Assignment -> Approval -> Reject/Return -> Escalation -> History, all
 * as Tenant Configuration (Workflow Definition is authored per Tenant,
 * per doc 04: "Approval matrix ... disimpan sebagai data konfigurasi per
 * Tenant — bukan logic di kode").
 *
 * Proven in this checkpoint against a generic dummy object
 * (`demo_transactions`) only — per explicit Founder instruction, no
 * Complaint/Survey/Procurement business logic is introduced here. A real
 * business module later just needs to point its own entity_type/entity_id
 * at a Workflow Definition; nothing in this schema is dummy-object-specific
 * except the `demo_transactions` table itself, which exists purely to give
 * the engine something real to reference (workflow_instances.entity_id is
 * an opaque polymorphic reference, same pattern doc 06 describes for
 * Document/File Service attachments).
 *
 * Versioning (doc 04): "Definisi lama tetap menyelesaikan transaksi
 * berjalan; definisi baru berlaku untuk transaksi baru" — modeled as
 * multiple `workflow_versions` rows per definition, at most one flagged
 * `is_current` (the one new instances use). Running instances keep
 * pointing at the version they started with (`workflow_instances.
 * workflow_version_id`), so publishing a new version never disturbs them.
 *
 * SLA-ready / Escalation hooks: `workflow_steps.sla_hours` and
 * `workflow_instance_assignments.due_at` are real, computed fields — an
 * escalation sweep (`WorkflowService.escalateOverdueAssignments`) genuinely
 * reassigns overdue tasks per `workflow_escalation_rules` when invoked.
 * What is NOT in Phase 0: an automatic background scheduler invoking that
 * sweep on a timer — no cron/scheduler infrastructure exists yet in this
 * implementation workspace (same class of gap as "no CI/CD yet" from
 * 0A/0B). The sweep is exposed as an explicit, RBAC-gated API operation,
 * which is what "hook" means here: the mechanism works end-to-end today,
 * automatic invocation is a future wiring, not a redesign.
 *
 * Notification-ready hooks: `workflow_notification_hooks` records the
 * event + payload every time the engine WOULD notify someone (assigned,
 * escalated, approved, rejected, returned, completed) — proving the hook
 * point fires at the right moments with the right data, ready for the
 * real Notification Engine (doc 06, not built in Phase 0) to consume.
 */

exports.up = (pgm) => {
  // --- New permissions (Product Core catalog, appended) ------------------
  pgm.sql(`
    INSERT INTO permissions (code, description) VALUES
      ('workflow.definition.manage', 'Author Workflow Definitions: versions, steps, transitions, assignment rules, escalation rules, publish'),
      ('workflow.definition.read', 'Read Workflow Definitions and their published/draft versions'),
      ('workflow.instance.start', 'Start a new Workflow Instance against a generic transaction/object'),
      ('workflow.instance.read', 'Read Workflow Instances, their assignments, and History'),
      ('workflow.instance.act', 'Act on a Workflow Assignment: approve, reject, return, resubmit'),
      ('workflow.instance.manage', 'Administrative control over Workflow Instances: cancel, trigger the escalation sweep')
  `);

  // --- Workflow Definition (Tenant Configuration, per doc 04) -----------
  pgm.createTable("workflow_definitions", {
    id: { type: "uuid", primaryKey: true, default: pgm.func("gen_random_uuid()") },
    tenant_id: { type: "uuid", notNull: true, references: "tenants", onDelete: "CASCADE" },
    code: { type: "text", notNull: true },
    name: { type: "text", notNull: true },
    // Opaque label for the kind of object this definition routes — e.g.
    // 'demo_transaction' in this checkpoint. The engine never branches on
    // this value; it only ever compares it for display/filtering.
    entity_type: { type: "text", notNull: true },
    description: { type: "text", notNull: true },
    is_active: { type: "boolean", notNull: true, default: true },
    created_by: { type: "uuid" },
    created_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
    updated_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
  });
  pgm.addConstraint("workflow_definitions", "workflow_definitions_tenant_code_unique", {
    unique: ["tenant_id", "code"],
  });

  // --- Workflow Version ----------------------------------------------------
  pgm.createTable("workflow_versions", {
    id: { type: "uuid", primaryKey: true, default: pgm.func("gen_random_uuid()") },
    workflow_definition_id: {
      type: "uuid",
      notNull: true,
      references: "workflow_definitions",
      onDelete: "CASCADE",
    },
    version_number: { type: "integer", notNull: true },
    status: { type: "text", notNull: true, default: "draft" },
    // At most one version per definition is "current" (used for NEW
    // instances). Old versions stay 'published' (not retired) as long as
    // any instance still references them, per doc 04's versioning rule.
    is_current: { type: "boolean", notNull: true, default: false },
    created_by: { type: "uuid" },
    created_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
    published_at: { type: "timestamptz" },
  });
  pgm.addConstraint("workflow_versions", "workflow_versions_status_check", {
    check: "status IN ('draft', 'published', 'retired')",
  });
  pgm.addConstraint("workflow_versions", "workflow_versions_unique", {
    unique: ["workflow_definition_id", "version_number"],
  });
  // Partial unique index, same house pattern as ADR-0006: at most one
  // is_current=true row per definition, without a plain unique constraint
  // colliding on every is_current=false row.
  pgm.createIndex("workflow_versions", ["workflow_definition_id"], {
    name: "workflow_versions_current_unique",
    unique: true,
    where: "is_current = true",
  });

  // --- Workflow Step ---------------------------------------------------------
  pgm.createTable("workflow_steps", {
    id: { type: "uuid", primaryKey: true, default: pgm.func("gen_random_uuid()") },
    workflow_version_id: {
      type: "uuid",
      notNull: true,
      references: "workflow_versions",
      onDelete: "CASCADE",
    },
    code: { type: "text", notNull: true },
    name: { type: "text", notNull: true },
    step_type: { type: "text", notNull: true },
    is_initial: { type: "boolean", notNull: true, default: false },
    is_terminal: { type: "boolean", notNull: true, default: false },
    // Only set when is_terminal — what the owning Workflow Instance's
    // overall status becomes upon reaching this step.
    terminal_status: { type: "text" },
    // SLA-ready hook: hours allowed at this step before an assignment is
    // considered overdue. NULL = no SLA tracked for this step.
    sla_hours: { type: "integer" },
    sequence_order: { type: "integer", notNull: true, default: 0 },
  });
  pgm.addConstraint("workflow_steps", "workflow_steps_type_check", {
    check: "step_type IN ('task', 'approval', 'end')",
  });
  pgm.addConstraint("workflow_steps", "workflow_steps_terminal_status_check", {
    check:
      "(is_terminal = false AND terminal_status IS NULL) OR (is_terminal = true AND terminal_status IN ('approved', 'rejected', 'cancelled'))",
  });
  pgm.addConstraint("workflow_steps", "workflow_steps_unique", {
    unique: ["workflow_version_id", "code"],
  });

  // --- Workflow Transition (with Condition) -----------------------------------
  pgm.createTable("workflow_transitions", {
    id: { type: "uuid", primaryKey: true, default: pgm.func("gen_random_uuid()") },
    workflow_version_id: {
      type: "uuid",
      notNull: true,
      references: "workflow_versions",
      onDelete: "CASCADE",
    },
    from_step_id: { type: "uuid", notNull: true, references: "workflow_steps", onDelete: "CASCADE" },
    to_step_id: { type: "uuid", notNull: true, references: "workflow_steps", onDelete: "CASCADE" },
    // What action taken at from_step triggers this transition, e.g.
    // 'approve', 'reject', 'return', 'resubmit'.
    action_code: { type: "text", notNull: true },
    name: { type: "text", notNull: true },
    // Condition: simple {field, operator, value} JSON evaluated against
    // the Workflow Instance's context_data (see workflow_instances below).
    // NULL = unconditional (always matches, used as the default/fallback
    // transition for a given action_code).
    condition_expression: { type: "jsonb" },
    sort_order: { type: "integer", notNull: true, default: 0 },
  });

  // --- Assignment (with Condition — dynamic routing per doc 04) ---------------
  pgm.createTable("workflow_assignment_rules", {
    id: { type: "uuid", primaryKey: true, default: pgm.func("gen_random_uuid()") },
    workflow_step_id: { type: "uuid", notNull: true, references: "workflow_steps", onDelete: "CASCADE" },
    sort_order: { type: "integer", notNull: true, default: 0 },
    condition_expression: { type: "jsonb" },
    assignment_type: { type: "text", notNull: true },
    // assignment_type = 'role': route to whoever holds role_code within
    // organization_unit_strategy's scope ('submitter_unit' = the
    // Organization Unit carried in the instance's context_data;
    // 'tenant' = tenant-wide, any holder of the role).
    role_code: { type: "text" },
    organization_unit_strategy: { type: "text" },
    // assignment_type = 'specific_user': route to exactly one user.
    // specific_user_source = 'submitter' resolves to whoever started the
    // instance; 'fixed' resolves to fixed_user_id.
    specific_user_source: { type: "text" },
    fixed_user_id: { type: "uuid", references: "users", onDelete: "CASCADE" },
  });
  pgm.addConstraint("workflow_assignment_rules", "workflow_assignment_rules_type_check", {
    check: "assignment_type IN ('role', 'specific_user')",
  });
  pgm.addConstraint("workflow_assignment_rules", "workflow_assignment_rules_org_strategy_check", {
    check: "organization_unit_strategy IS NULL OR organization_unit_strategy IN ('submitter_unit', 'tenant')",
  });
  pgm.addConstraint("workflow_assignment_rules", "workflow_assignment_rules_user_source_check", {
    check: "specific_user_source IS NULL OR specific_user_source IN ('submitter', 'fixed')",
  });

  // --- Escalation (hooks) ------------------------------------------------------
  pgm.createTable("workflow_escalation_rules", {
    id: { type: "uuid", primaryKey: true, default: pgm.func("gen_random_uuid()") },
    workflow_step_id: { type: "uuid", notNull: true, references: "workflow_steps", onDelete: "CASCADE" },
    escalate_after_hours: { type: "integer", notNull: true },
    escalate_to_role_code: { type: "text", notNull: true },
    escalate_to_organization_unit_strategy: { type: "text", notNull: true, default: "tenant" },
    note: { type: "text" },
  });
  pgm.addConstraint(
    "workflow_escalation_rules",
    "workflow_escalation_rules_org_strategy_check",
    { check: "escalate_to_organization_unit_strategy IN ('submitter_unit', 'tenant')" },
  );

  // --- Generic dummy object, for proving the engine only ----------------------
  pgm.createTable("demo_transactions", {
    id: { type: "uuid", primaryKey: true, default: pgm.func("gen_random_uuid()") },
    tenant_id: { type: "uuid", notNull: true, references: "tenants", onDelete: "CASCADE" },
    title: { type: "text", notNull: true },
    created_by: { type: "uuid", notNull: true, references: "users", onDelete: "CASCADE" },
    created_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
  });

  // --- Workflow Instance (runtime) --------------------------------------------
  pgm.createTable("workflow_instances", {
    id: { type: "uuid", primaryKey: true, default: pgm.func("gen_random_uuid()") },
    tenant_id: { type: "uuid", notNull: true, references: "tenants", onDelete: "CASCADE" },
    workflow_definition_id: {
      type: "uuid",
      notNull: true,
      references: "workflow_definitions",
      onDelete: "CASCADE",
    },
    workflow_version_id: { type: "uuid", notNull: true, references: "workflow_versions" },
    entity_type: { type: "text", notNull: true },
    entity_id: { type: "uuid", notNull: true },
    current_step_id: { type: "uuid", references: "workflow_steps" },
    status: { type: "text", notNull: true, default: "in_progress" },
    // Arbitrary caller-supplied context (e.g. { category, organizationUnitId })
    // used to evaluate Conditions on Transitions and Assignment Rules. This
    // is what keeps the engine entity-agnostic — it never queries
    // demo_transactions or any other business table itself.
    context_data: { type: "jsonb", notNull: true, default: "{}" },
    started_by: { type: "uuid", notNull: true, references: "users", onDelete: "CASCADE" },
    started_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
    completed_at: { type: "timestamptz" },
  });
  pgm.addConstraint("workflow_instances", "workflow_instances_status_check", {
    check: "status IN ('in_progress', 'approved', 'rejected', 'cancelled')",
  });
  pgm.createIndex("workflow_instances", ["tenant_id", "entity_type", "entity_id"]);

  // --- Workflow Instance Assignment (task queue + Approval decision) ----------
  pgm.createTable("workflow_instance_assignments", {
    id: { type: "uuid", primaryKey: true, default: pgm.func("gen_random_uuid()") },
    workflow_instance_id: {
      type: "uuid",
      notNull: true,
      references: "workflow_instances",
      onDelete: "CASCADE",
    },
    step_id: { type: "uuid", notNull: true, references: "workflow_steps" },
    assignment_type: { type: "text", notNull: true },
    assigned_role_code: { type: "text" },
    // NULL = tenant-wide task; set = scoped to exactly one Organization
    // Unit (exact-match, same simplification as ADR-0005).
    // ON DELETE CASCADE — same NULL-is-fine-but-FK-must-cascade lesson as
    // Checkpoint 0B (migration 1755600100000): a full Tenant deletion
    // (integration test cleanup, or real deprovisioning) cascades Tenant
    // -> Organization Units, and any Assignment scoped to a deleted unit
    // must cascade away too rather than blocking the delete.
    assigned_organization_unit_id: {
      type: "uuid",
      references: "organization_units",
      onDelete: "CASCADE",
    },
    assigned_user_id: { type: "uuid", references: "users", onDelete: "CASCADE" },
    assigned_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
    // SLA-ready hook: computed from workflow_steps.sla_hours at assignment
    // time. NULL when the step has no SLA configured.
    due_at: { type: "timestamptz" },
    status: { type: "text", notNull: true, default: "pending" },
    decided_by: { type: "uuid", references: "users", onDelete: "CASCADE" },
    decided_at: { type: "timestamptz" },
    decision_action_code: { type: "text" },
    comment: { type: "text" },
  });
  pgm.addConstraint("workflow_instance_assignments", "workflow_instance_assignments_type_check", {
    check: "assignment_type IN ('role', 'specific_user')",
  });
  pgm.addConstraint("workflow_instance_assignments", "workflow_instance_assignments_status_check", {
    check: "status IN ('pending', 'approved', 'rejected', 'returned', 'escalated', 'superseded')",
  });
  pgm.createIndex("workflow_instance_assignments", ["workflow_instance_id", "status"]);
  pgm.createIndex("workflow_instance_assignments", ["assigned_role_code", "status"]);
  pgm.createIndex("workflow_instance_assignments", ["assigned_user_id", "status"]);

  // --- Workflow History (full journey — part of Audit Trail per doc 04/06) ---
  pgm.createTable("workflow_history", {
    id: { type: "uuid", primaryKey: true, default: pgm.func("gen_random_uuid()") },
    workflow_instance_id: {
      type: "uuid",
      notNull: true,
      references: "workflow_instances",
      onDelete: "CASCADE",
    },
    from_step_id: { type: "uuid", references: "workflow_steps" },
    to_step_id: { type: "uuid", references: "workflow_steps" },
    action_code: { type: "text", notNull: true },
    // NULL actor = system-triggered (the escalation sweep), never a
    // human decision misattributed to "nobody".
    actor_user_id: { type: "uuid", references: "users", onDelete: "CASCADE" },
    comment: { type: "text" },
    metadata: { type: "jsonb" },
    occurred_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
  });
  pgm.createIndex("workflow_history", ["workflow_instance_id", "occurred_at"]);

  // --- Notification-ready hooks -------------------------------------------
  pgm.createTable("workflow_notification_hooks", {
    id: { type: "uuid", primaryKey: true, default: pgm.func("gen_random_uuid()") },
    workflow_instance_id: {
      type: "uuid",
      notNull: true,
      references: "workflow_instances",
      onDelete: "CASCADE",
    },
    event_type: { type: "text", notNull: true },
    payload: { type: "jsonb", notNull: true },
    created_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
  });
};

exports.down = (pgm) => {
  pgm.dropTable("workflow_notification_hooks");
  pgm.dropTable("workflow_history");
  pgm.dropTable("workflow_instance_assignments");
  pgm.dropTable("workflow_instances");
  pgm.dropTable("demo_transactions");
  pgm.dropTable("workflow_escalation_rules");
  pgm.dropTable("workflow_assignment_rules");
  pgm.dropTable("workflow_transitions");
  pgm.dropTable("workflow_steps");
  pgm.dropTable("workflow_versions");
  pgm.dropTable("workflow_definitions");
  pgm.sql(`
    DELETE FROM permissions WHERE code IN (
      'workflow.definition.manage', 'workflow.definition.read',
      'workflow.instance.start', 'workflow.instance.read',
      'workflow.instance.act', 'workflow.instance.manage'
    )
  `);
};
