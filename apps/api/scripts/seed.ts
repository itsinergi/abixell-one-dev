/**
 * Checkpoint 0B demo/testing seed.
 *
 * Creates one demo Tenant with a minimal but complete Identity &
 * Organization structure so the vertical slice (Tenant -> Legal Entity ->
 * Organization Unit -> User -> Auth -> RBAC -> Audit) can be exercised
 * from the thin frontend or integration tests without hand-crafting data
 * through the API every time.
 *
 * Idempotent: safe to re-run, skips creation if the demo Tenant already
 * exists.
 *
 * Usage: npm run seed -w apps/api
 */
import "dotenv/config";
import { pool } from "../src/infrastructure/persistence/db.js";
import { hashPassword } from "../src/infrastructure/security/password.js";

const DEMO_TENANT_CODE = "demo-gs";

async function main() {
  const existing = await pool.query("SELECT id FROM tenants WHERE code = $1", [
    DEMO_TENANT_CODE,
  ]);
  if (existing.rows[0]) {
    console.log(`Seed skipped: tenant '${DEMO_TENANT_CODE}' already exists.`);
    await pool.end();
    return;
  }

  const tenant = (
    await pool.query(
      `INSERT INTO tenants (code, name) VALUES ($1, $2) RETURNING id`,
      [DEMO_TENANT_CODE, "Demo Enterprise Client"],
    )
  ).rows[0];

  const legalEntity = (
    await pool.query(
      `INSERT INTO legal_entities (tenant_id, name) VALUES ($1, $2) RETURNING id`,
      [tenant.id, "Demo Legal Entity Pte Ltd"],
    )
  ).rows[0];

  const headOffice = (
    await pool.query(
      `INSERT INTO organization_units (tenant_id, legal_entity_id, parent_id, name, unit_type)
       VALUES ($1, $2, NULL, $3, $4) RETURNING id`,
      [tenant.id, legalEntity.id, "Head Office", "Head Office"],
    )
  ).rows[0];

  const siteA = (
    await pool.query(
      `INSERT INTO organization_units (tenant_id, legal_entity_id, parent_id, name, unit_type)
       VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [tenant.id, legalEntity.id, headOffice.id, "Site A", "Site"],
    )
  ).rows[0];

  // Checkpoint 0F / ADR-0010: ADMIN is marked is_full_access = true —
  // its intent is "every permission that exists", so
  // scripts/sync-role-permissions.ts can keep it in sync with new
  // Product Core permissions on a LIVE tenant without ever deleting
  // data, replacing the reseed pattern this exact role hit in 0C/0D/0E.
  const adminRole = (
    await pool.query(
      `INSERT INTO roles (tenant_id, code, name, is_full_access) VALUES ($1, 'ADMIN', 'Administrator', true) RETURNING id`,
      [tenant.id],
    )
  ).rows[0];

  const supervisorRole = (
    await pool.query(
      `INSERT INTO roles (tenant_id, code, name) VALUES ($1, 'SUPERVISOR', 'Site Supervisor') RETURNING id`,
      [tenant.id],
    )
  ).rows[0];

  const allPermissions = (await pool.query(`SELECT id FROM permissions`)).rows;
  for (const p of allPermissions) {
    await pool.query(
      `INSERT INTO role_permissions (role_id, permission_id) VALUES ($1, $2)`,
      [adminRole.id, p.id],
    );
  }

  // Supervisor: read-only. No *.create/*.manage permissions — proves the
  // backend rejects create/manage attempts from this role, not just
  // hides the button.
  const readOnlyPermissionCodes = [
    "organization_unit.read",
    "user.read",
    "tenant.read",
    "config.read",
  ];
  const readOnlyPermissions = (
    await pool.query(`SELECT id FROM permissions WHERE code = ANY($1)`, [
      readOnlyPermissionCodes,
    ])
  ).rows;
  for (const p of readOnlyPermissions) {
    await pool.query(
      `INSERT INTO role_permissions (role_id, permission_id) VALUES ($1, $2)`,
      [supervisorRole.id, p.id],
    );
  }

  // Checkpoint 0D demo roles: WORKFLOW_REVIEWER (Site A scope) and
  // WORKFLOW_MANAGER (tenant-wide) — proves Workflow Assignment routing
  // to a role+scope "queue" (not a pre-picked user) and the hierarchical
  // Escalation target, reusing the same Site A / Head Office structure
  // Checkpoints 0B/0C already demonstrate Data Scope and Configuration
  // Scope with.
  const workflowReviewerRole = (
    await pool.query(
      `INSERT INTO roles (tenant_id, code, name) VALUES ($1, 'WORKFLOW_REVIEWER', 'Workflow Reviewer') RETURNING id`,
      [tenant.id],
    )
  ).rows[0];
  const workflowManagerRole = (
    await pool.query(
      `INSERT INTO roles (tenant_id, code, name) VALUES ($1, 'WORKFLOW_MANAGER', 'Workflow Manager') RETURNING id`,
      [tenant.id],
    )
  ).rows[0];
  // Checkpoint 0E: also grant the two demo Workflow roles read access to
  // their own Notifications and Documents — they are exactly the kind of
  // recipient/attachment-reader these Shared Services exist for, and
  // without this permission the events fired during the Workflow demo
  // (e.g. workflow.assigned) create real `notifications` rows the demo
  // user still can't view via the API — a real gap, not a nitpick.
  const workflowPermissionCodes = [
    "workflow.instance.read",
    "workflow.instance.act",
    "notification.read",
    "document.read",
  ];
  const workflowPermissions = (
    await pool.query(`SELECT id FROM permissions WHERE code = ANY($1)`, [workflowPermissionCodes])
  ).rows;
  for (const p of workflowPermissions) {
    await pool.query(`INSERT INTO role_permissions (role_id, permission_id) VALUES ($1, $2)`, [
      workflowReviewerRole.id,
      p.id,
    ]);
    await pool.query(`INSERT INTO role_permissions (role_id, permission_id) VALUES ($1, $2)`, [
      workflowManagerRole.id,
      p.id,
    ]);
  }

  const adminPasswordHash = await hashPassword("Admin12345!");
  const admin = (
    await pool.query(
      `INSERT INTO users (tenant_id, email, password_hash, full_name)
       VALUES ($1, 'admin@demo.local', $2, 'Demo Administrator') RETURNING id`,
      [tenant.id, adminPasswordHash],
    )
  ).rows[0];
  await pool.query(
    `INSERT INTO user_role_assignments (user_id, role_id, scope_type)
     VALUES ($1, $2, 'tenant')`,
    [admin.id, adminRole.id],
  );

  const supervisorPasswordHash = await hashPassword("Supervisor12345!");
  const supervisor = (
    await pool.query(
      `INSERT INTO users (tenant_id, email, password_hash, full_name)
       VALUES ($1, 'supervisor@demo.local', $2, 'Demo Site Supervisor') RETURNING id`,
      [tenant.id, supervisorPasswordHash],
    )
  ).rows[0];
  await pool.query(
    `INSERT INTO user_role_assignments
       (user_id, role_id, scope_type, scope_organization_unit_id)
     VALUES ($1, $2, 'organization_unit', $3)`,
    [supervisor.id, supervisorRole.id, siteA.id],
  );

  const workflowReviewerPasswordHash = await hashPassword("Reviewer12345!");
  const workflowReviewer = (
    await pool.query(
      `INSERT INTO users (tenant_id, email, password_hash, full_name)
       VALUES ($1, 'reviewer@demo.local', $2, 'Demo Workflow Reviewer') RETURNING id`,
      [tenant.id, workflowReviewerPasswordHash],
    )
  ).rows[0];
  await pool.query(
    `INSERT INTO user_role_assignments
       (user_id, role_id, scope_type, scope_organization_unit_id)
     VALUES ($1, $2, 'organization_unit', $3)`,
    [workflowReviewer.id, workflowReviewerRole.id, siteA.id],
  );

  const workflowManagerPasswordHash = await hashPassword("Manager12345!");
  const workflowManager = (
    await pool.query(
      `INSERT INTO users (tenant_id, email, password_hash, full_name)
       VALUES ($1, 'manager@demo.local', $2, 'Demo Workflow Manager') RETURNING id`,
      [tenant.id, workflowManagerPasswordHash],
    )
  ).rows[0];
  await pool.query(
    `INSERT INTO user_role_assignments (user_id, role_id, scope_type)
     VALUES ($1, $2, 'tenant')`,
    [workflowManager.id, workflowManagerRole.id],
  );

  await pool.query(
    `INSERT INTO audit_log (tenant_id, actor_user_id, action, entity_type, entity_id, metadata)
     VALUES ($1, NULL, 'tenant.seeded', 'tenant', $1, $2)`,
    [tenant.id, JSON.stringify({ source: "seed script" })],
  );

  // --- Checkpoint 0C: Configuration & Metadata demo data ---------------------
  // Demonstrates that Module Activation, Feature Flags (with Configuration
  // Scope precedence), Terminology, Reference Data, and Numbering are all
  // genuinely tenant-specific -- nothing here is hardcoded in Product Core,
  // it is all rows created for THIS demo tenant against the Product Core
  // catalog seeded by the migration.

  // Module Activation: activate "customer_complaint" for this tenant only.
  const complaintModule = (
    await pool.query(`SELECT id FROM modules WHERE code = 'customer_complaint'`)
  ).rows[0];
  if (complaintModule) {
    await pool.query(
      `INSERT INTO tenant_module_activations (tenant_id, module_id, is_active)
       VALUES ($1, $2, true)`,
      [tenant.id, complaintModule.id],
    );
  }

  // Feature Flag: set a tenant-wide value, then override it at Site A to
  // prove Configuration Scope precedence (Organization Unit > Tenant).
  const offlineFlag = (
    await pool.query(`SELECT id FROM feature_flags WHERE code = 'offline_field_mode'`)
  ).rows[0];
  if (offlineFlag) {
    await pool.query(
      `INSERT INTO tenant_feature_flags
         (tenant_id, feature_flag_id, scope_type, scope_organization_unit_id, is_enabled)
       VALUES ($1, $2, 'tenant', NULL, false)`,
      [tenant.id, offlineFlag.id],
    );
    await pool.query(
      `INSERT INTO tenant_feature_flags
         (tenant_id, feature_flag_id, scope_type, scope_organization_unit_id, is_enabled)
       VALUES ($1, $2, 'organization_unit', $3, true)`,
      [tenant.id, offlineFlag.id, siteA.id],
    );
  }

  // Terminology: rename "Organization Unit" to a client-specific term to
  // prove UI labels come from Terminology, not hardcoded strings.
  const orgUnitTerm = (
    await pool.query(`SELECT id FROM terminology_keys WHERE code = 'organization_unit.label'`)
  ).rows[0];
  if (orgUnitTerm) {
    await pool.query(
      `INSERT INTO tenant_terminology_overrides (tenant_id, terminology_key_id, value)
       VALUES ($1, $2, 'Site')`,
      [tenant.id, orgUnitTerm.id],
    );
  }

  // Reference Data: seed two Priority Level items for this tenant.
  const priorityType = (
    await pool.query(`SELECT id FROM reference_data_types WHERE code = 'priority_level'`)
  ).rows[0];
  if (priorityType) {
    await pool.query(
      `INSERT INTO tenant_reference_data_items
         (tenant_id, reference_data_type_id, code, label, sort_order)
       VALUES ($1, $2, 'high', 'High', 1), ($1, $2, 'low', 'Low', 2)`,
      [tenant.id, priorityType.id],
    );
  }

  // Numbering: a tenant-specific ticket numbering sequence, e.g.
  // TCK-2026-00001, proving numbering patterns are per-tenant configuration.
  await pool.query(
    `INSERT INTO numbering_sequences (tenant_id, code, pattern, current_sequence)
     VALUES ($1, 'demo_ticket', 'TCK-{YYYY}-{SEQ:5}', 0)`,
    [tenant.id],
  );

  // --- Checkpoint 0D: Workflow & Approval Engine demo definition --------------
  // A single, fully published Workflow Definition proving every required
  // capability end-to-end against the generic `demo_transactions` object
  // ONLY (no Complaint/Survey/Procurement business logic, per explicit
  // Founder instruction): Versioning (this is version 1, published +
  // current), Step/State (REVIEW/REVISE/COMPLETE/REJECTED), Transition
  // (approve/reject/return/resubmit), Condition (category=high_risk
  // routes to WORKFLOW_MANAGER instead of the default WORKFLOW_REVIEWER),
  // Assignment (role+scope AND specific_user types both used), Approval
  // (approve -> COMPLETE), Reject (reject -> REJECTED), Return (return ->
  // REVISE -> resubmit loops back to REVIEW), Escalation (4h SLA on
  // REVIEW, escalates to WORKFLOW_MANAGER tenant-wide), SLA-ready hook
  // (sla_hours -> due_at), Notification-ready hook (fires on every
  // assign/approve/reject/return/escalate/complete).
  const workflowDefinition = (
    await pool.query(
      `INSERT INTO workflow_definitions (tenant_id, code, name, entity_type, description, created_by)
       VALUES ($1, 'demo_approval_workflow', 'Demo Generic Approval Workflow', 'demo_transaction',
               'Checkpoint 0D engine-proof workflow — routes a generic dummy transaction through Review, with Condition-based dynamic assignment, Escalation, and a Return/Resubmit rework loop.',
               $2)
       RETURNING id`,
      [tenant.id, admin.id],
    )
  ).rows[0];

  const workflowVersion = (
    await pool.query(
      `INSERT INTO workflow_versions (workflow_definition_id, version_number, status, is_current, created_by, published_at)
       VALUES ($1, 1, 'published', true, $2, now())
       RETURNING id`,
      [workflowDefinition.id, admin.id],
    )
  ).rows[0];

  const reviewStep = (
    await pool.query(
      `INSERT INTO workflow_steps
         (workflow_version_id, code, name, step_type, is_initial, is_terminal, sla_hours, sequence_order)
       VALUES ($1, 'REVIEW', 'Review', 'approval', true, false, 4, 1)
       RETURNING id`,
      [workflowVersion.id],
    )
  ).rows[0];
  const reviseStep = (
    await pool.query(
      `INSERT INTO workflow_steps
         (workflow_version_id, code, name, step_type, is_initial, is_terminal, sequence_order)
       VALUES ($1, 'REVISE', 'Revise', 'task', false, false, 2)
       RETURNING id`,
      [workflowVersion.id],
    )
  ).rows[0];
  const completeStep = (
    await pool.query(
      `INSERT INTO workflow_steps
         (workflow_version_id, code, name, step_type, is_initial, is_terminal, terminal_status, sequence_order)
       VALUES ($1, 'COMPLETE', 'Complete', 'end', false, true, 'approved', 3)
       RETURNING id`,
      [workflowVersion.id],
    )
  ).rows[0];
  const rejectedStep = (
    await pool.query(
      `INSERT INTO workflow_steps
         (workflow_version_id, code, name, step_type, is_initial, is_terminal, terminal_status, sequence_order)
       VALUES ($1, 'REJECTED', 'Rejected', 'end', false, true, 'rejected', 4)
       RETURNING id`,
      [workflowVersion.id],
    )
  ).rows[0];

  await pool.query(
    `INSERT INTO workflow_transitions (workflow_version_id, from_step_id, to_step_id, action_code, name, sort_order)
     VALUES
       ($1, $2, $4, 'approve', 'Approve', 1),
       ($1, $2, $5, 'reject', 'Reject', 2),
       ($1, $2, $3, 'return', 'Return for revision', 3),
       ($1, $3, $2, 'resubmit', 'Resubmit after revision', 1)`,
    [workflowVersion.id, reviewStep.id, reviseStep.id, completeStep.id, rejectedStep.id],
  );

  // Condition-based dynamic routing (doc 04 "Dynamic Routing"): a
  // high_risk transaction skips the local Reviewer and goes straight to
  // the tenant-wide Manager; everything else defaults to the Site-scoped
  // Reviewer. Rules are evaluated in sort_order — first match wins.
  await pool.query(
    `INSERT INTO workflow_assignment_rules
       (workflow_step_id, sort_order, condition_expression, assignment_type, role_code, organization_unit_strategy)
     VALUES
       ($1, 1, $2, 'role', 'WORKFLOW_MANAGER', 'tenant'),
       ($1, 2, NULL, 'role', 'WORKFLOW_REVIEWER', 'submitter_unit')`,
    [reviewStep.id, JSON.stringify({ field: "category", operator: "eq", value: "high_risk" })],
  );
  // REVISE is routed back to whoever originally started the instance —
  // proves the 'specific_user' assignment type, distinct from role+scope.
  await pool.query(
    `INSERT INTO workflow_assignment_rules
       (workflow_step_id, sort_order, assignment_type, specific_user_source)
     VALUES ($1, 1, 'specific_user', 'submitter')`,
    [reviseStep.id],
  );

  // Escalation hook: REVIEW's 4-hour SLA, if exceeded, reassigns to
  // WORKFLOW_MANAGER tenant-wide (a Site-level task escalating up the
  // Organization Hierarchy, per doc 04's "Escalate jika lewat SLA").
  await pool.query(
    `INSERT INTO workflow_escalation_rules
       (workflow_step_id, escalate_after_hours, escalate_to_role_code, escalate_to_organization_unit_strategy, note)
     VALUES ($1, 4, 'WORKFLOW_MANAGER', 'tenant', 'SLA exceeded at Review — escalate to tenant-wide Workflow Manager')`,
    [reviewStep.id],
  );

  // --- Checkpoint 0E: Notification Templates + Integration Endpoints ---------
  // Notification Templates are Tenant Configuration (doc 06) — these three
  // prove the Notification Engine actually renders and delivers against
  // the Workflow events 0D/0E now publish (workflow.assigned on Assignment
  // creation, workflow.completed on terminal Step, workflow.escalated on
  // the Scheduler-driven sweep), without any business-module involvement.
  await pool.query(
    `INSERT INTO notification_templates (tenant_id, event_type, channel, subject_template, body_template)
     VALUES
       ($1, 'workflow.assigned', 'in_app', 'New task assigned',
        'A workflow task (instance {{workflowInstanceId}}) has been assigned to you.'),
       ($1, 'workflow.completed', 'in_app', 'Workflow completed',
        'Your submission (instance {{workflowInstanceId}}) has been {{terminalStatus}}.'),
       ($1, 'workflow.escalated', 'in_app', 'Task escalated to you',
        'A workflow task at step {{stepCode}} was escalated to your role after its SLA was exceeded.')`,
    [tenant.id],
  );

  // Integration Boundary demo data (doc 07): one active outbound Endpoint
  // (proves the EventBus wildcard subscriber logs a stub dispatch per
  // Domain Event) and one active inbound Endpoint with a generated
  // webhook secret (proves the signed webhook receiver end-to-end via
  // `curl` — see docs/implementation-notes.md for a worked example).
  await pool.query(
    `INSERT INTO integration_endpoints (tenant_id, code, name, direction, base_url, is_active)
     VALUES ($1, 'demo-erp-sync', 'Demo ERP Sync (outbound stub)', 'outbound', 'https://example-erp.local/api', true)`,
    [tenant.id],
  );
  const inboundWebhookSecret = "demo-webhook-secret-0e";
  await pool.query(
    `INSERT INTO integration_endpoints (tenant_id, code, name, direction, webhook_secret, is_active)
     VALUES ($1, 'demo-inbound', 'Demo Inbound Webhook', 'inbound', $2, true)`,
    [tenant.id, inboundWebhookSecret],
  );

  // --- Checkpoint 1A: Customer Experience Foundation demo data ---------------
  // Proves the full 1A E2E target end to end: Customer -> Contact ->
  // Contract/Project/Site -> Service Assigned -> Customer User login ->
  // Data Scope Applied. `ownerOrganizationUnitId = siteA` means the
  // existing SUPERVISOR (Site A org-unit scope) and WORKFLOW_MANAGER/
  // ADMIN (tenant-wide) can all reach this Customer through
  // `RbacService.requireCustomerContextScope`'s org-unit branch; the new
  // Customer User below reaches it through the `customer` scope branch
  // instead — two different Data Scope axes converging on the same
  // authorization decision, per ADR-0011.
  const customer = (
    await pool.query(
      `INSERT INTO customers (tenant_id, code, name, owner_organization_unit_id)
       VALUES ($1, 'CUST-001', 'PT Demo Client Indonesia', $2) RETURNING id`,
      [tenant.id, siteA.id],
    )
  ).rows[0];

  const customerContact = (
    await pool.query(
      `INSERT INTO customer_contacts (tenant_id, customer_id, name, email, phone, is_primary)
       VALUES ($1, $2, 'Budi Santoso', 'budi.santoso@democlient.local', '+62-811-0000-0001', true)
       RETURNING id`,
      [tenant.id, customer.id],
    )
  ).rows[0];

  const contract = (
    await pool.query(
      `INSERT INTO contracts (tenant_id, customer_id, code, name, start_date, status)
       VALUES ($1, $2, 'CTR-2026-001', 'Demo Service Agreement 2026', '2026-01-01', 'active')
       RETURNING id`,
      [tenant.id, customer.id],
    )
  ).rows[0];

  const project = (
    await pool.query(
      `INSERT INTO projects (tenant_id, customer_id, contract_id, code, name)
       VALUES ($1, $2, $3, 'PRJ-001', 'Site Operations Support') RETURNING id`,
      [tenant.id, customer.id, contract.id],
    )
  ).rows[0];

  const customerSite = (
    await pool.query(
      `INSERT INTO sites (tenant_id, customer_id, project_id, code, name, address)
       VALUES ($1, $2, $3, 'SITE-001', 'Demo Client Site 1', 'Jl. Demo No. 1, Jakarta')
       RETURNING id`,
      [tenant.id, customer.id, project.id],
    )
  ).rows[0];

  const service = (
    await pool.query(
      `INSERT INTO services (tenant_id, code, name, description)
       VALUES ($1, 'SVC-GENERAL', 'General Services', 'Dummy Service catalog entry — Client Configuration, not Product Core content')
       RETURNING id`,
      [tenant.id],
    )
  ).rows[0];

  await pool.query(
    `INSERT INTO customer_service_links
       (tenant_id, customer_id, service_id, contract_id, project_id, site_id, internal_pic_user_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [tenant.id, customer.id, service.id, contract.id, project.id, customerSite.id, supervisor.id],
  );

  // CUSTOMER_USER role: read-only over its own Customer's foundation
  // data. Deliberately does NOT include any `document.*` permission —
  // Document access for entityType='customer' goes entirely through the
  // Entity Authorization Resolver (ADR-0012), not this permission catalog
  // (the Checkpoint 1A binding decision: "attachment tidak memiliki
  // independent business authorization yang terpisah dari parent
  // business entity").
  const customerUserRole = (
    await pool.query(
      `INSERT INTO roles (tenant_id, code, name) VALUES ($1, 'CUSTOMER_USER', 'Customer User') RETURNING id`,
      [tenant.id],
    )
  ).rows[0];
  const customerUserPermissionCodes = [
    "customer.read",
    "contract.read",
    "project.read",
    "site.read",
    "service.read",
  ];
  const customerUserPermissions = (
    await pool.query(`SELECT id FROM permissions WHERE code = ANY($1)`, [
      customerUserPermissionCodes,
    ])
  ).rows;
  for (const p of customerUserPermissions) {
    await pool.query(`INSERT INTO role_permissions (role_id, permission_id) VALUES ($1, $2)`, [
      customerUserRole.id,
      p.id,
    ]);
  }

  const customerUserPasswordHash = await hashPassword("CustomerUser12345!");
  const customerUser = (
    await pool.query(
      `INSERT INTO users (tenant_id, email, password_hash, full_name)
       VALUES ($1, 'customeruser@democlient.local', $2, 'Demo Customer User') RETURNING id`,
      [tenant.id, customerUserPasswordHash],
    )
  ).rows[0];
  await pool.query(
    `INSERT INTO user_role_assignments (user_id, role_id, scope_type, scope_customer_id)
     VALUES ($1, $2, 'customer', $3)`,
    [customerUser.id, customerUserRole.id, customer.id],
  );

  await pool.query(
    `INSERT INTO audit_log (tenant_id, actor_user_id, action, entity_type, entity_id, metadata)
     VALUES ($1, NULL, 'customer.seeded', 'customer', $2, $3)`,
    [tenant.id, customer.id, JSON.stringify({ source: "seed script", code: "CUST-001" })],
  );

  console.log("Seed complete:");
  console.log(`  Tenant code:        ${DEMO_TENANT_CODE}`);
  console.log(`  Legal Entity:       ${legalEntity.id}`);
  console.log(`  Organization Units: Head Office=${headOffice.id}, Site A=${siteA.id}`);
  console.log(`  Admin login:        admin@demo.local / Admin12345! (tenant-wide scope)`);
  console.log(
    `  Supervisor login:   supervisor@demo.local / Supervisor12345! (Site A scope only, read-only permissions)`,
  );
  console.log(
    `  Reviewer login:     reviewer@demo.local / Reviewer12345! (WORKFLOW_REVIEWER, Site A scope)`,
  );
  console.log(
    `  Manager login:      manager@demo.local / Manager12345! (WORKFLOW_MANAGER, tenant-wide scope)`,
  );
  console.log(`  Workflow demo:      demo_approval_workflow v1 (published)`);
  console.log(`  Inbound webhook:    POST /integration/webhook/${DEMO_TENANT_CODE}/demo-inbound`);
  console.log(`    Signature header: X-Webhook-Signature = HMAC-SHA256(secret, rawBody) hex`);
  console.log(`    Secret (dev-only): ${inboundWebhookSecret}`);
  console.log(`  Customer demo:      ${customer.id} (CUST-001, owner org unit = Site A)`);
  console.log(
    `  Customer User login: customeruser@democlient.local / CustomerUser12345! (customer scope = CUST-001 only)`,
  );

  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
