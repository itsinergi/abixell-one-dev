/**
 * Checkpoint 1B — Generic Customer Complaint Engine.
 *
 * A single `complaints` table (Customer-context: customer/contract/
 * project/site/service, all nullable except customer_id, per doc
 * section 9's "tidak semua field wajib"). Deliberately does NOT
 * duplicate anything the Workflow Engine (0D/0E) already owns:
 *
 * - **Lifecycle / status** — NOT a column here. A Complaint's current
 *   status IS its linked `workflow_instances.current_step` (via
 *   `workflow_instance_id`). Reading it always goes through
 *   `ComplaintService`/`WorkflowService`, so it can never drift out of
 *   sync with a column that has to be kept updated by hand. This is the
 *   literal meaning of "Workflow tidak boleh hardcoded di Complaint
 *   Service" applied to storage, not just code: Complaint Service does
 *   not own the state machine's state.
 * - **Assignment (current/history)** — NOT a column. Lives in
 *   `workflow_instance_assignments`/`workflow_history`, reached via
 *   `workflow_instance_id`.
 * - **SLA** — NOT new columns/tables. Reuses `workflow_steps.sla_hours`
 *   (per-Step SLA, already escalation-ready since 0D/0E) — the
 *   Acknowledgement/Assignment/Response/Resolution/Verification SLAs
 *   the Phase 1 instruction lists are each just the `sla_hours`
 *   configured on the matching Step (Acknowledged/Assigned/In
 *   Investigation/Corrective Action/Verification). A multi-dimensional
 *   SLA MATRIX (resolved from Customer x Contract x Service x Category x
 *   Priority x Severity, per doc section 11) is explicitly OUT of scope
 *   for this checkpoint — documented in decision-log.md as a deliberate,
 *   proportional simplification (Future Enhancement), not silently
 *   dropped.
 * - **Category / Priority / Severity** — NOT enums. `category`/
 *   `severity` are free-text columns whose valid values come from the
 *   EXISTING generic Reference Data mechanism (Checkpoint 0C) — this
 *   migration only registers two new `reference_data_types` catalog
 *   rows (`complaint_category`, `complaint_severity`); the ITEMS
 *   (e.g. dummy "Catering"/"Housekeeping") are Tenant Configuration,
 *   created via the existing `/config/reference-data` API, never
 *   hardcoded here. `priority` reuses the `priority_level` reference
 *   data type 0C already registered — zero new schema for Priority.
 * - **Numbering** — NOT new code. `complaint_number` is generated via
 *   the existing Numbering Sequence mechanism (0C); this migration adds
 *   no numbering-specific schema, only the seed script registers a
 *   `complaint_number` sequence (Tenant Configuration data).
 * - **Evidence/Attachment** — NOT a table here at all. Reuses the
 *   Document Service (0E) with a new `complaint` Entity Authorization
 *   Resolver (ADR-0012 pattern, same as `customer` in 1A) —
 *   `entityType='complaint'`, `entityId=complaints.id`.
 *
 * `submitted_by_user_id` is who actually submitted the Complaint (a
 * Customer User in the common case, but nothing here assumes that —
 * could be an internal user filing on a Customer's behalf). It doubles
 * as the "submitter" for `SpecificUserSource='submitter'` Assignment
 * Rules (e.g. the Customer Confirmation step routes back to whoever
 * submitted, an EXISTING 0D mechanism, not new).
 */

exports.up = (pgm) => {
  pgm.createTable("complaints", {
    id: { type: "uuid", primaryKey: true, default: pgm.func("gen_random_uuid()") },
    tenant_id: { type: "uuid", notNull: true, references: "tenants", onDelete: "CASCADE" },
    complaint_number: { type: "text", notNull: true },

    customer_id: { type: "uuid", notNull: true, references: "customers", onDelete: "RESTRICT" },
    customer_contact_id: { type: "uuid", references: "customer_contacts", onDelete: "SET NULL" },
    contract_id: { type: "uuid", references: "contracts", onDelete: "SET NULL" },
    project_id: { type: "uuid", references: "projects", onDelete: "SET NULL" },
    site_id: { type: "uuid", references: "sites", onDelete: "SET NULL" },
    service_id: { type: "uuid", references: "services", onDelete: "SET NULL" },

    category: { type: "text", notNull: true },
    subcategory: { type: "text" },
    description: { type: "text", notNull: true },
    priority: { type: "text", notNull: true },
    severity: { type: "text", notNull: true },
    source: { type: "text" },
    channel: { type: "text" },

    submitted_by_user_id: { type: "uuid", notNull: true, references: "users", onDelete: "RESTRICT" },
    submitted_at: { type: "timestamptz" },

    // Investigation / CAPA-lite (doc section 13 — "jangan bangun full
    // CAPA enterprise", so this is intentionally flat fields, not a
    // separate versioned Investigation/CAPA aggregate).
    root_cause: { type: "text" },
    corrective_action: { type: "text" },
    preventive_action: { type: "text" },
    corrective_action_owner_user_id: { type: "uuid", references: "users", onDelete: "SET NULL" },
    corrective_action_target_date: { type: "date" },

    verification_note: { type: "text" },
    verified_by_user_id: { type: "uuid", references: "users", onDelete: "SET NULL" },
    verified_at: { type: "timestamptz" },

    customer_confirmation_note: { type: "text" },
    customer_confirmed_at: { type: "timestamptz" },

    closure_date: { type: "timestamptz" },

    // The ONE link to the generic Workflow Engine — everything about
    // "what state is this Complaint in / who is it assigned to right
    // now / its full history" is reached through this, never duplicated
    // onto this table (see migration header).
    workflow_instance_id: { type: "uuid", references: "workflow_instances", onDelete: "SET NULL" },

    created_by: { type: "uuid" },
    created_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
    updated_by: { type: "uuid" },
    updated_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
    deleted_by: { type: "uuid" },
    deleted_at: { type: "timestamptz" },
  });
  pgm.addConstraint("complaints", "complaints_tenant_number_unique", {
    unique: ["tenant_id", "complaint_number"],
  });
  pgm.createIndex("complaints", "customer_id");
  pgm.createIndex("complaints", "workflow_instance_id");

  // --- Permissions (Product Core catalog) -----------------------------
  pgm.sql(`
    INSERT INTO permissions (code, description) VALUES
      ('complaint.read', 'View Complaints (subject to Customer Data Scope, enforced in ComplaintService)'),
      ('complaint.manage', 'Create/update Complaints, record Investigation/Corrective Action fields, reopen')
  `);

  // --- Reference Data types (Product Core registers the TYPE; a Tenant
  // populates the ITEMS via the existing /config/reference-data API —
  // zero business-specific values hardcoded here, per doc section 10/30).
  pgm.sql(`
    INSERT INTO reference_data_types (code, name, description) VALUES
      ('complaint_category', 'Complaint Category', 'Tenant-configurable Complaint category catalog (e.g. dummy: Catering, Housekeeping, Camp, Facility — Client Configuration, not Product Core content)'),
      ('complaint_severity', 'Complaint Severity', 'Tenant-configurable Complaint severity catalog (distinct from Priority — see ADR-0013)')
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    DELETE FROM reference_data_types WHERE code IN ('complaint_category', 'complaint_severity')
  `);
  pgm.sql(`DELETE FROM permissions WHERE code IN ('complaint.read', 'complaint.manage')`);
  pgm.dropTable("complaints");
};
