/**
 * Wave A7 — Project Delivery Advanced schema (PRJ-ADV-001…008).
 *
 * Layered on top of `project_delivery_activities` / `project_delivery_milestones`
 * (1769000000000) without altering either. ADR-0026 §4: the Core activity and
 * milestone surface is untouched, and no Core path may require an Advanced table
 * to exist. A project with no WBS, no dependency edge, no baseline and no cost
 * entry behaves exactly as it did before this migration ran.
 *
 * Ownership (ADR-0026 §1/§2):
 *   - Project Delivery owns project cost truth: budget, commitment, actual cost.
 *   - Finance owns ledger truth. This module never writes `journal_entries`,
 *     `journal_lines`, `accounting_periods`, or any chart-of-accounts table.
 *     `project.cost_incurred` is emitted into the shared outbox and the
 *     Accounting Kernel posts it, exactly as Supply Chain and Workforce do.
 *
 * Money and quantity are NUMERIC, never float (ADR-0026 §5). The application
 * layer parses them through `toCents`/`toUnits` in
 * `modules/project-delivery/advanced/domain/` so no authoritative amount is ever
 * held in binary floating point.
 *
 * There is no DELETE surface for cost entries. A mistake is corrected by a
 * `reversal` row that names the row it compensates (`reverses_id`); the original
 * is never mutated. That is the same shape the Accounting Kernel uses for
 * journal reversal, and it is what makes a cost position reproducible.
 */
exports.up = (pgm) => {
  pgm.sql(`

    -- -----------------------------------------------------------------------
    -- project_wbs_nodes (PRJ-ADV-001)
    -- Hierarchical decomposition. 'depth' is derived from the parent chain at
    -- write time by the service, never trusted from the request body.
    -- -----------------------------------------------------------------------
    CREATE TABLE project_wbs_nodes (
      id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id             UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      project_id            UUID        NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
      parent_id             UUID        REFERENCES project_wbs_nodes(id) ON DELETE RESTRICT,

      code                  TEXT        NOT NULL,
      name                  TEXT        NOT NULL,
      description           TEXT,
      depth                 INTEGER     NOT NULL DEFAULT 0 CHECK (depth BETWEEN 0 AND 12),
      sort_order            INTEGER     NOT NULL DEFAULT 0,

      created_by_user_id    UUID        REFERENCES users(id) ON DELETE SET NULL,
      updated_by_user_id    UUID        REFERENCES users(id) ON DELETE SET NULL,
      created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),

      CONSTRAINT uq_project_wbs_nodes_code UNIQUE (tenant_id, project_id, code)
    );

    CREATE INDEX idx_project_wbs_nodes_project
      ON project_wbs_nodes (tenant_id, project_id, sort_order);
    CREATE INDEX idx_project_wbs_nodes_parent
      ON project_wbs_nodes (parent_id) WHERE parent_id IS NOT NULL;

    -- An activity may hang off one WBS node, or none. Nullable on purpose: the
    -- Core activity surface predates WBS and must keep working untouched.
    ALTER TABLE project_delivery_activities
      ADD COLUMN wbs_node_id UUID REFERENCES project_wbs_nodes(id) ON DELETE SET NULL;

    CREATE INDEX idx_project_delivery_activities_wbs
      ON project_delivery_activities (wbs_node_id) WHERE wbs_node_id IS NOT NULL;

    -- -----------------------------------------------------------------------
    -- project_activity_dependencies (PRJ-ADV-002)
    -- One edge per (predecessor, successor) pair. Lag may be negative (a lead).
    -- -----------------------------------------------------------------------
    CREATE TABLE project_activity_dependencies (
      id                        UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id                 UUID    NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      project_id                UUID    NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
      predecessor_activity_id   UUID    NOT NULL REFERENCES project_delivery_activities(id) ON DELETE CASCADE,
      successor_activity_id     UUID    NOT NULL REFERENCES project_delivery_activities(id) ON DELETE CASCADE,

      dependency_type           TEXT    NOT NULL DEFAULT 'FS'
        CHECK (dependency_type IN ('FS', 'SS', 'FF', 'SF')),
      lag_days                  INTEGER NOT NULL DEFAULT 0,

      created_by_user_id        UUID    REFERENCES users(id) ON DELETE SET NULL,
      created_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at                TIMESTAMPTZ NOT NULL DEFAULT now(),

      CONSTRAINT ck_project_activity_dependencies_distinct
        CHECK (predecessor_activity_id <> successor_activity_id),
      CONSTRAINT uq_project_activity_dependencies_edge
        UNIQUE (project_id, predecessor_activity_id, successor_activity_id)
    );

    CREATE INDEX idx_project_activity_dependencies_project
      ON project_activity_dependencies (tenant_id, project_id);
    CREATE INDEX idx_project_activity_dependencies_successor
      ON project_activity_dependencies (successor_activity_id);

    -- -----------------------------------------------------------------------
    -- project_resources + project_resource_assignments (PRJ-ADV-004)
    -- A resource is tenant-scoped, not project-scoped: the same crew or crane is
    -- levelled across every project it is booked on.
    -- -----------------------------------------------------------------------
    CREATE TABLE project_resources (
      id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id             UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,

      code                  TEXT        NOT NULL,
      name                  TEXT        NOT NULL,
      resource_type         TEXT        NOT NULL DEFAULT 'labor'
        CHECK (resource_type IN ('labor', 'equipment', 'material', 'other')),
      unit                  TEXT        NOT NULL,

      -- NULL capacity means "unbounded": an unbounded resource can never be
      -- overallocated, so levelling simply has nothing to say about it.
      capacity_per_day      NUMERIC(20,4) CHECK (capacity_per_day IS NULL OR capacity_per_day >= 0),
      cost_rate             NUMERIC(20,2) CHECK (cost_rate IS NULL OR cost_rate >= 0),

      is_active             BOOLEAN     NOT NULL DEFAULT true,

      created_by_user_id    UUID        REFERENCES users(id) ON DELETE SET NULL,
      updated_by_user_id    UUID        REFERENCES users(id) ON DELETE SET NULL,
      created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),

      CONSTRAINT uq_project_resources_code UNIQUE (tenant_id, code)
    );

    CREATE TABLE project_resource_assignments (
      id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id             UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      project_id            UUID        NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
      activity_id           UUID        NOT NULL REFERENCES project_delivery_activities(id) ON DELETE CASCADE,
      resource_id           UUID        NOT NULL REFERENCES project_resources(id) ON DELETE RESTRICT,

      planned_units         NUMERIC(20,4) NOT NULL CHECK (planned_units > 0),
      start_date            DATE        NOT NULL,
      end_date              DATE        NOT NULL,

      created_by_user_id    UUID        REFERENCES users(id) ON DELETE SET NULL,
      created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),

      CONSTRAINT ck_project_resource_assignments_range CHECK (end_date >= start_date)
    );

    CREATE INDEX idx_project_resource_assignments_project
      ON project_resource_assignments (tenant_id, project_id);
    CREATE INDEX idx_project_resource_assignments_resource
      ON project_resource_assignments (tenant_id, resource_id, start_date, end_date);

    -- -----------------------------------------------------------------------
    -- project_baselines + project_baseline_lines (PRJ-ADV-005)
    -- A baseline is a frozen snapshot of the plan. Approving a new one
    -- supersedes the previous approved row; the partial unique index is what
    -- makes "at most one approved baseline per project" a database fact rather
    -- than a service convention.
    -- -----------------------------------------------------------------------
    CREATE TABLE project_baselines (
      id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id             UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      project_id            UUID        NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,

      version               INTEGER     NOT NULL CHECK (version > 0),
      name                  TEXT        NOT NULL,
      status                TEXT        NOT NULL DEFAULT 'draft'
        CHECK (status IN ('draft', 'approved', 'superseded')),
      notes                 TEXT,

      approved_at           TIMESTAMPTZ,
      approved_by_user_id   UUID        REFERENCES users(id) ON DELETE SET NULL,

      created_by_user_id    UUID        REFERENCES users(id) ON DELETE SET NULL,
      created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),

      CONSTRAINT uq_project_baselines_version UNIQUE (tenant_id, project_id, version),
      CONSTRAINT ck_project_baselines_approved CHECK (
        (status = 'approved' AND approved_at IS NOT NULL)
        OR status <> 'approved'
      )
    );

    CREATE UNIQUE INDEX uq_project_baselines_one_approved
      ON project_baselines (project_id) WHERE status = 'approved';

    CREATE TABLE project_baseline_lines (
      id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id             UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      baseline_id           UUID        NOT NULL REFERENCES project_baselines(id) ON DELETE CASCADE,
      activity_id           UUID        NOT NULL REFERENCES project_delivery_activities(id) ON DELETE CASCADE,

      planned_start         DATE,
      planned_finish        DATE,
      planned_cost          NUMERIC(20,2) NOT NULL DEFAULT 0 CHECK (planned_cost >= 0),
      planned_units         NUMERIC(20,4) NOT NULL DEFAULT 0 CHECK (planned_units >= 0),

      CONSTRAINT uq_project_baseline_lines_activity UNIQUE (baseline_id, activity_id)
    );

    CREATE INDEX idx_project_baseline_lines_baseline ON project_baseline_lines (baseline_id);

    -- -----------------------------------------------------------------------
    -- project_cost_entries (PRJ-ADV-006/007)
    -- The append-only project cost ledger. 'amount' is always non-negative; the
    -- entry type carries the direction. A correction is a 'reversal' row naming
    -- the row it compensates, never an UPDATE of that row.
    -- -----------------------------------------------------------------------
    CREATE TABLE project_cost_entries (
      id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id             UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      project_id            UUID        NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
      activity_id           UUID        REFERENCES project_delivery_activities(id) ON DELETE SET NULL,

      entry_type            TEXT        NOT NULL
        CHECK (entry_type IN ('actual', 'commitment', 'adjustment', 'reversal')),
      amount                NUMERIC(20,2) NOT NULL CHECK (amount >= 0),
      currency              TEXT        NOT NULL CHECK (char_length(currency) = 3),
      entry_date            DATE        NOT NULL,

      source_document_type  TEXT,
      source_document_id    UUID,
      reverses_id           UUID        REFERENCES project_cost_entries(id) ON DELETE RESTRICT,

      -- Caller-supplied. Makes recording the same invoice twice a no-op rather
      -- than a duplicate cost line.
      idempotency_key       TEXT        NOT NULL,
      note                  TEXT,

      created_by_user_id    UUID        REFERENCES users(id) ON DELETE SET NULL,
      created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),

      CONSTRAINT uq_project_cost_entries_idempotency UNIQUE (tenant_id, idempotency_key),
      CONSTRAINT ck_project_cost_entries_reversal CHECK (
        (entry_type = 'reversal' AND reverses_id IS NOT NULL)
        OR (entry_type <> 'reversal' AND reverses_id IS NULL)
      )
    );

    CREATE INDEX idx_project_cost_entries_project
      ON project_cost_entries (tenant_id, project_id, entry_date);
    CREATE INDEX idx_project_cost_entries_activity
      ON project_cost_entries (activity_id) WHERE activity_id IS NOT NULL;
    CREATE INDEX idx_project_cost_entries_reverses
      ON project_cost_entries (reverses_id) WHERE reverses_id IS NOT NULL;

    -- -----------------------------------------------------------------------
    -- project_earned_value_snapshots (PRJ-ADV-006)
    -- Stored rather than recomputed on read: a later baseline change or cost
    -- entry must not silently rewrite a period that has already been reported.
    -- -----------------------------------------------------------------------
    CREATE TABLE project_earned_value_snapshots (
      id                        UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id                 UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      project_id                UUID        NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,

      as_of_date                DATE        NOT NULL,
      currency                  TEXT        NOT NULL CHECK (char_length(currency) = 3),

      planned_value             NUMERIC(20,2) NOT NULL,
      earned_value              NUMERIC(20,2) NOT NULL,
      actual_cost               NUMERIC(20,2) NOT NULL,
      schedule_variance         NUMERIC(20,2) NOT NULL,
      cost_variance             NUMERIC(20,2) NOT NULL,

      schedule_performance_index NUMERIC(14,4),
      cost_performance_index     NUMERIC(14,4),

      budget_at_completion      NUMERIC(20,2) NOT NULL,
      estimate_at_completion    NUMERIC(20,2),
      estimate_to_complete      NUMERIC(20,2),
      variance_at_completion    NUMERIC(20,2),

      notes                     TEXT,
      computed_by_user_id       UUID        REFERENCES users(id) ON DELETE SET NULL,
      created_at                TIMESTAMPTZ NOT NULL DEFAULT now(),

      CONSTRAINT uq_project_earned_value_snapshot UNIQUE (tenant_id, project_id, as_of_date)
    );

    CREATE INDEX idx_project_earned_value_project
      ON project_earned_value_snapshots (tenant_id, project_id, as_of_date DESC);

    -- -----------------------------------------------------------------------
    -- project_cost_postings (PRJ-ADV-008)
    -- The local record that a cost entry was handed to the Accounting Kernel.
    -- Deliberately separate from 'scm_accounting_ready_events': this table says
    -- "we emitted", the outbox says "the kernel has it". A failed emission
    -- leaves no posting row and must surface, not be swallowed.
    -- -----------------------------------------------------------------------
    CREATE TABLE project_cost_postings (
      id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id             UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      project_id            UUID        NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
      cost_entry_id         UUID        NOT NULL REFERENCES project_cost_entries(id) ON DELETE RESTRICT,

      idempotency_key       TEXT        NOT NULL,
      status                TEXT        NOT NULL
        CHECK (status IN ('emitted', 'skipped_duplicate')),

      created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),

      CONSTRAINT uq_project_cost_postings_idempotency UNIQUE (tenant_id, idempotency_key)
    );

    CREATE INDEX idx_project_cost_postings_project ON project_cost_postings (tenant_id, project_id);

    -- -----------------------------------------------------------------------
    -- Permissions (4 new capabilities)
    -- Advanced depth is separately grantable so a tenant can run Core project
    -- delivery without exposing WBS, scheduling, cost or earned value.
    -- -----------------------------------------------------------------------
    INSERT INTO permissions (code, description) VALUES
      ('project_delivery.advanced.read',   'View project WBS, schedule, critical path, resources, baselines, and earned value'),
      ('project_delivery.advanced.manage', 'Manage project WBS, dependencies, resources, baselines, and earned-value snapshots'),
      ('project_delivery.cost.read',       'View project cost entries, commitments, and cost position'),
      ('project_delivery.cost.manage',     'Record and reverse project cost entries and emit them to the Accounting Kernel')
    ON CONFLICT (code) DO NOTHING;

    -- -----------------------------------------------------------------------
    -- Outbox event type (PRJ-ADV-008)
    -- The outbox is shared and its CHECK is the closed list of facts any domain
    -- may hand the Accounting Kernel. Widening it is the only change Project
    -- Delivery makes to a Finance-adjacent object, and it grants no write path
    -- to the ledger (ADR-0026 §2).
    -- -----------------------------------------------------------------------
    ALTER TABLE scm_accounting_ready_events
      DROP CONSTRAINT scm_accounting_events_type_check;

    ALTER TABLE scm_accounting_ready_events
      ADD CONSTRAINT scm_accounting_events_type_check
        CHECK (event_type IN (
          'inventory.goods_received', 'inventory.goods_issued', 'inventory.transferred', 'inventory.adjusted',
          'inventory.returned_to_vendor', 'inventory.receipt_reversed', 'inventory.landed_cost_applied',
          'inventory.consignment_consumed', 'service.accepted', 'inventory.disposed',
          'vendor.invoice.approved', 'vendor.invoice.payment_approved', 'payroll.run_posted',
          'work_order.accepted', 'work_order.cost_accumulated',
          'work_order.invoiced', 'work_order.invoice_tax',
          'project.cost_incurred'
        ));

    -- -----------------------------------------------------------------------
    -- Posting rule for the new event
    -- 5100 (Harga Pokok Penjualan) and 2100 (Utang Usaha) are the only codes
    -- present in BOTH the SAK_UMUM and SAK_EMKM templates, so the rule resolves
    -- on any tenant's chart rather than only on the full template. The rule is
    -- a default: a tenant may version its own, which is why the seed is
    -- ON CONFLICT DO NOTHING rather than an upsert.
    -- -----------------------------------------------------------------------
    INSERT INTO posting_rules (
      tenant_id, rule_code, rule_name, rule_version, trigger_event_type,
      accounting_formula, requires_approval, effective_date, is_active
    )
    SELECT
      t.id,
      'RULE_PROJECT_COST_INCURRED',
      'Project Cost Incurred',
      'v1',
      'project.cost_incurred',
      '[
        {"accountCode":"5100","side":"debit","amountExpression":"AMOUNT"},
        {"accountCode":"2100","side":"credit","amountExpression":"AMOUNT"}
      ]'::jsonb,
      false,
      '2026-01-01'::date,
      true
    FROM tenants t
    ON CONFLICT (tenant_id, rule_code, rule_version) DO NOTHING;

  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    DELETE FROM posting_rules
     WHERE rule_code = 'RULE_PROJECT_COST_INCURRED' AND rule_version = 'v1';

    -- The outbox is append-only and its facts are immutable; narrow the CHECK
    -- back only once nothing of this type remains, or the ALTER fails and says
    -- so rather than silently dropping facts.
    DELETE FROM scm_accounting_ready_events WHERE event_type = 'project.cost_incurred';

    ALTER TABLE scm_accounting_ready_events
      DROP CONSTRAINT scm_accounting_events_type_check;

    ALTER TABLE scm_accounting_ready_events
      ADD CONSTRAINT scm_accounting_events_type_check
        CHECK (event_type IN (
          'inventory.goods_received', 'inventory.goods_issued', 'inventory.transferred', 'inventory.adjusted',
          'inventory.returned_to_vendor', 'inventory.receipt_reversed', 'inventory.landed_cost_applied',
          'inventory.consignment_consumed', 'service.accepted', 'inventory.disposed',
          'vendor.invoice.approved', 'vendor.invoice.payment_approved', 'payroll.run_posted',
          'work_order.accepted', 'work_order.cost_accumulated',
          'work_order.invoiced', 'work_order.invoice_tax'
        ));

    DELETE FROM permissions WHERE code IN (
      'project_delivery.advanced.read',
      'project_delivery.advanced.manage',
      'project_delivery.cost.read',
      'project_delivery.cost.manage'
    );
    DROP TABLE IF EXISTS project_cost_postings;
    DROP TABLE IF EXISTS project_earned_value_snapshots;
    DROP TABLE IF EXISTS project_cost_entries;
    DROP TABLE IF EXISTS project_baseline_lines;
    DROP TABLE IF EXISTS project_baselines;
    DROP TABLE IF EXISTS project_resource_assignments;
    DROP TABLE IF EXISTS project_resources;
    DROP TABLE IF EXISTS project_activity_dependencies;
    ALTER TABLE project_delivery_activities DROP COLUMN IF EXISTS wbs_node_id;
    DROP TABLE IF EXISTS project_wbs_nodes;
  `);
};
