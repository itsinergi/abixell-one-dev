/**
 * Phase 2 — Service Operations & Work Management Core schema (SO-CORE-001…015).
 *
 * The generic service-delivery spine. Vertical Service Packs (Catering,
 * Housekeeping, Camp, Facility) compose over this later through Configuration
 * — so NOTHING industry-specific may appear here.
 *
 * Aggregates:
 *   Service Definition (template)  -> service_definitions
 *                                  -> service_definition_checklist_items
 *   Work Request (demand/intake)   -> work_requests
 *   Work Order (executable work)   -> work_orders
 *                                  -> work_order_checklist_items
 *
 * Deliberate design decisions:
 *
 * - **No second lifecycle engine (SO-CORE-004).** `work_orders.workflow_
 *   instance_id` is the ONE link to the generic Workflow Engine; there is no
 *   status column on work_orders. Completion/verification columns record
 *   business FACTS (who/when/what), exactly as `complaints` does — the STATE
 *   itself is owned by the Workflow Instance.
 *
 * - **Work Request has no state machine either.** Its state is derived from
 *   `converted_work_order_id` / `cancelled_at`, so intake bookkeeping can
 *   never drift into a competing lifecycle.
 *
 * - **Checklist is snapshotted onto the Work Order** at creation
 *   (code/label/is_required copied). Editing a Service Definition afterwards
 *   must never rewrite history of already-executed work.
 *
 * - **Evidence reuses Document Core** (`documents` with entity_type
 *   'work_order') — no attachment subsystem here.
 *
 * `gen_random_uuid()` comes from pgcrypto (migration 0001).
 */
exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE service_definitions (
      id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id       uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      code            text NOT NULL,
      name            text NOT NULL,
      description     text,
      category        text,
      is_active       boolean NOT NULL DEFAULT true,
      created_at      timestamptz NOT NULL DEFAULT now(),
      created_by      uuid,
      updated_at      timestamptz NOT NULL DEFAULT now(),
      updated_by      uuid,
      UNIQUE (tenant_id, code)
    );

    CREATE TABLE service_definition_checklist_items (
      id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      service_definition_id  uuid NOT NULL REFERENCES service_definitions(id) ON DELETE CASCADE,
      code                   text NOT NULL,
      label                  text NOT NULL,
      is_required            boolean NOT NULL DEFAULT false,
      sort_order             integer NOT NULL DEFAULT 0,
      created_at             timestamptz NOT NULL DEFAULT now(),
      UNIQUE (service_definition_id, code)
    );

    CREATE TABLE work_requests (
      id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id                uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      request_number           text NOT NULL,
      customer_id              uuid NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
      contract_id              uuid REFERENCES contracts(id) ON DELETE SET NULL,
      project_id               uuid REFERENCES projects(id) ON DELETE SET NULL,
      site_id                  uuid REFERENCES sites(id) ON DELETE SET NULL,
      service_definition_id    uuid NOT NULL REFERENCES service_definitions(id) ON DELETE RESTRICT,
      description              text NOT NULL,
      priority                 text,
      requested_by_user_id     uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
      requested_at             timestamptz NOT NULL DEFAULT now(),
      -- Derived state (NOT a lifecycle): open | converted | cancelled
      converted_work_order_id  uuid,
      converted_at             timestamptz,
      cancelled_at             timestamptz,
      cancellation_reason      text,
      created_at               timestamptz NOT NULL DEFAULT now(),
      created_by               uuid,
      updated_at               timestamptz NOT NULL DEFAULT now(),
      updated_by               uuid,
      deleted_at               timestamptz,
      UNIQUE (tenant_id, request_number)
    );

    CREATE TABLE work_orders (
      id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id                uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      work_order_number        text NOT NULL,
      work_request_id          uuid REFERENCES work_requests(id) ON DELETE SET NULL,
      customer_id              uuid NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
      contract_id              uuid REFERENCES contracts(id) ON DELETE SET NULL,
      project_id               uuid REFERENCES projects(id) ON DELETE SET NULL,
      site_id                  uuid REFERENCES sites(id) ON DELETE SET NULL,
      service_definition_id    uuid NOT NULL REFERENCES service_definitions(id) ON DELETE RESTRICT,
      title                    text NOT NULL,
      description              text,
      priority                 text,
      -- Basic scheduling only (SO-CORE-006). No capacity/route/recurrence.
      planned_start_at         timestamptz,
      planned_end_at           timestamptz,
      due_at                   timestamptz,
      -- Assignment (SO-CORE-005).
      assigned_to_user_id      uuid REFERENCES users(id) ON DELETE SET NULL,
      assigned_at              timestamptz,
      assigned_by_user_id      uuid REFERENCES users(id) ON DELETE SET NULL,
      -- Execution facts (SO-CORE-008/010). STATE lives in the Workflow Instance.
      started_at               timestamptz,
      started_by_user_id       uuid REFERENCES users(id) ON DELETE SET NULL,
      completion_notes         text,
      completed_at             timestamptz,
      completed_by_user_id     uuid REFERENCES users(id) ON DELETE SET NULL,
      verification_notes       text,
      verified_at              timestamptz,
      verified_by_user_id      uuid REFERENCES users(id) ON DELETE SET NULL,
      -- The ONE link to the generic Workflow Engine (SO-CORE-004).
      workflow_instance_id     uuid REFERENCES workflow_instances(id) ON DELETE SET NULL,
      created_at               timestamptz NOT NULL DEFAULT now(),
      created_by               uuid,
      updated_at               timestamptz NOT NULL DEFAULT now(),
      updated_by               uuid,
      deleted_at               timestamptz,
      UNIQUE (tenant_id, work_order_number)
    );

    ALTER TABLE work_requests
      ADD CONSTRAINT work_requests_converted_work_order_fk
      FOREIGN KEY (converted_work_order_id) REFERENCES work_orders(id) ON DELETE SET NULL;

    CREATE TABLE work_order_checklist_items (
      id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      work_order_id             uuid NOT NULL REFERENCES work_orders(id) ON DELETE CASCADE,
      source_checklist_item_id  uuid REFERENCES service_definition_checklist_items(id) ON DELETE SET NULL,
      code                      text NOT NULL,
      label                     text NOT NULL,
      is_required               boolean NOT NULL DEFAULT false,
      sort_order                integer NOT NULL DEFAULT 0,
      is_completed              boolean NOT NULL DEFAULT false,
      note                      text,
      completed_at              timestamptz,
      completed_by_user_id      uuid REFERENCES users(id) ON DELETE SET NULL,
      UNIQUE (work_order_id, code)
    );

    CREATE INDEX idx_service_definitions_tenant_active ON service_definitions(tenant_id, is_active);
    CREATE INDEX idx_work_requests_tenant ON work_requests(tenant_id);
    CREATE INDEX idx_work_requests_customer ON work_requests(customer_id);
    CREATE INDEX idx_work_orders_tenant ON work_orders(tenant_id);
    CREATE INDEX idx_work_orders_customer ON work_orders(customer_id);
    CREATE INDEX idx_work_orders_assignee ON work_orders(assigned_to_user_id);
    CREATE INDEX idx_work_orders_workflow_instance ON work_orders(workflow_instance_id);
    CREATE INDEX idx_work_orders_due ON work_orders(tenant_id, due_at);
    CREATE INDEX idx_wo_checklist_work_order ON work_order_checklist_items(work_order_id);
  `);

  // --- Permissions (Product Core catalog, capability-based) -------------
  pgm.sql(`
    INSERT INTO permissions (code, description)
    SELECT v.code, v.description
      FROM (VALUES
        ('service_operations.read', 'View Work Requests and Work Orders (subject to Customer Data Scope)'),
        ('service_operations.manage', 'Create Work Requests/Orders, assign, and schedule work'),
        ('service_operations.execute', 'Record execution: start work, complete checklist items, complete work'),
        ('service_operations.verify', 'Verify completed work'),
        ('service_operations.configure', 'Manage Service Definitions and their checklist templates')
      ) AS v(code, description)
     WHERE NOT EXISTS (SELECT 1 FROM permissions p WHERE p.code = v.code)
  `);

  // --- Reference Data types (Product Core registers the TYPE only; a
  // Tenant populates ITEMS through the existing /config/reference-data API.
  // No industry-specific values are seeded here.) ------------------------
  pgm.sql(`
    INSERT INTO reference_data_types (code, name, description)
    SELECT v.code, v.name, v.description
      FROM (VALUES
        ('service_category', 'Service Category', 'Tenant-configurable catalog grouping Service Definitions'),
        ('work_priority', 'Work Priority', 'Tenant-configurable priority catalog for Work Requests and Work Orders')
      ) AS v(code, name, description)
     WHERE NOT EXISTS (SELECT 1 FROM reference_data_types t WHERE t.code = v.code)
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    DELETE FROM reference_data_types WHERE code IN ('service_category', 'work_priority');
    DELETE FROM permissions WHERE code IN (
      'service_operations.read', 'service_operations.manage', 'service_operations.execute',
      'service_operations.verify', 'service_operations.configure'
    );
    ALTER TABLE work_requests DROP CONSTRAINT IF EXISTS work_requests_converted_work_order_fk;
    DROP TABLE IF EXISTS work_order_checklist_items;
    DROP TABLE IF EXISTS work_orders;
    DROP TABLE IF EXISTS work_requests;
    DROP TABLE IF EXISTS service_definition_checklist_items;
    DROP TABLE IF EXISTS service_definitions;
  `);
};
