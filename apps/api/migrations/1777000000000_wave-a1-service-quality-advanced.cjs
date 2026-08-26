exports.up = (pgm) => {
  pgm.sql(`

    -- Composite candidate keys let every Wave A1 foreign key bind tenant and
    -- entity identity together. The pre-existing UUID primary keys remain the
    -- canonical identifiers; these constraints only prevent a child row from
    -- pairing Tenant A with a parent owned by Tenant B.
    ALTER TABLE users              ADD CONSTRAINT users_tenant_id_id_unique UNIQUE (tenant_id, id);
    ALTER TABLE customers          ADD CONSTRAINT customers_tenant_id_id_unique UNIQUE (tenant_id, id);
    ALTER TABLE contracts          ADD CONSTRAINT contracts_tenant_id_id_unique UNIQUE (tenant_id, id);
    ALTER TABLE complaints         ADD CONSTRAINT complaints_tenant_id_id_unique UNIQUE (tenant_id, id);
    ALTER TABLE workflow_instances ADD CONSTRAINT workflow_instances_tenant_id_id_unique UNIQUE (tenant_id, id);

    -- -----------------------------------------------------------------------
    -- Wave A1 — Service Quality Advanced (SQ-ADV-001…004).
    --
    -- SQ-ADV-001 Multidimensional SLA: a Tenant-authored policy matrix over
    --   customer x contract x severity x category, resolved against a business
    --   calendar with timezone, workweek, and holidays. The generic Workflow
    --   Engine keeps owning step-level SLA (workflow_steps.sla_hours); this
    --   adds the complaint-level commercial commitment the engine cannot
    --   express, without replacing it.
    -- SQ-ADV-002 Structured RCA taxonomy and advanced CAPA, with CAPA
    --   lifecycle delegated to the Workflow Engine (no competing state
    --   machine) and evidence delegated to Document Core.
    -- SQ-ADV-003 Recurring-problem detection with explainable, configurable
    --   criteria and deterministic bounded aggregation.
    -- SQ-ADV-004 Feedback-driven domain mutation, which is PROPOSAL-ONLY:
    --   automation never mutates another domain directly. It records a
    --   proposal that an explicitly authorized human approves, and the apply
    --   step is idempotent and fully audited.
    --
    -- Business history is soft-deleted only; RCA/CAPA evidence and decisions
    -- are never hard-deleted.
    -- -----------------------------------------------------------------------

    -- --- SQ-ADV-001: business calendar -------------------------------------

    -- Timezone is an IANA identifier resolved with the platform's own ICU
    -- data; no calendar library is introduced.
    CREATE TABLE service_business_calendars (
      id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id             UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,

      code                  TEXT        NOT NULL,
      name                  TEXT        NOT NULL,
      description           TEXT,
      time_zone             TEXT        NOT NULL,

      -- When true, elapsed time is wall-clock and workweek/holidays are
      -- ignored. Lets a Tenant express a genuine 24x7 commitment without
      -- inventing seven all-day workweek rows.
      is_continuous         BOOLEAN     NOT NULL DEFAULT false,
      is_default            BOOLEAN     NOT NULL DEFAULT false,
      is_active             BOOLEAN     NOT NULL DEFAULT true,

      created_by            UUID        REFERENCES users(id) ON DELETE SET NULL,
      created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_by            UUID        REFERENCES users(id) ON DELETE SET NULL,
      updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
      deleted_by            UUID        REFERENCES users(id) ON DELETE SET NULL,
      deleted_at            TIMESTAMPTZ
    );

    ALTER TABLE service_business_calendars
      ADD CONSTRAINT service_business_calendars_tenant_id_id_unique UNIQUE (tenant_id, id);
    CREATE UNIQUE INDEX service_business_calendars_tenant_code_unique
      ON service_business_calendars (tenant_id, code) WHERE deleted_at IS NULL;
    CREATE UNIQUE INDEX service_business_calendars_tenant_default_unique
      ON service_business_calendars (tenant_id) WHERE is_default AND deleted_at IS NULL;
    CREATE INDEX idx_service_business_calendars_tenant
      ON service_business_calendars (tenant_id) WHERE deleted_at IS NULL;
    ALTER TABLE service_business_calendars
      ADD CONSTRAINT service_business_calendars_tenant_created_by_fk
        FOREIGN KEY (tenant_id, created_by) REFERENCES users(tenant_id, id) ON DELETE SET NULL (created_by),
      ADD CONSTRAINT service_business_calendars_tenant_updated_by_fk
        FOREIGN KEY (tenant_id, updated_by) REFERENCES users(tenant_id, id) ON DELETE SET NULL (updated_by),
      ADD CONSTRAINT service_business_calendars_tenant_deleted_by_fk
        FOREIGN KEY (tenant_id, deleted_by) REFERENCES users(tenant_id, id) ON DELETE SET NULL (deleted_by);

    -- One row per working window. day_of_week follows ISO-8601: 1 = Monday.
    -- Minutes-from-midnight avoids any TIME/timezone coercion ambiguity.
    CREATE TABLE service_calendar_workweek (
      id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id             UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      calendar_id           UUID        NOT NULL,
      FOREIGN KEY (tenant_id, calendar_id)
        REFERENCES service_business_calendars(tenant_id, id) ON DELETE CASCADE,

      day_of_week           INTEGER     NOT NULL CHECK (day_of_week BETWEEN 1 AND 7),
      start_minute          INTEGER     NOT NULL CHECK (start_minute BETWEEN 0 AND 1440),
      end_minute            INTEGER     NOT NULL CHECK (end_minute BETWEEN 0 AND 1440),
      CHECK (end_minute > start_minute),

      created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE UNIQUE INDEX service_calendar_workweek_unique
      ON service_calendar_workweek (calendar_id, day_of_week, start_minute);
    CREATE INDEX idx_service_calendar_workweek_calendar
      ON service_calendar_workweek (calendar_id, day_of_week);

    -- Non-working dates, expressed in the calendar's own timezone.
    CREATE TABLE service_calendar_holidays (
      id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id             UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      calendar_id           UUID        NOT NULL,
      FOREIGN KEY (tenant_id, calendar_id)
        REFERENCES service_business_calendars(tenant_id, id) ON DELETE CASCADE,

      holiday_date          DATE        NOT NULL,
      name                  TEXT        NOT NULL,

      created_by            UUID        REFERENCES users(id) ON DELETE SET NULL,
      created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE UNIQUE INDEX service_calendar_holidays_unique
      ON service_calendar_holidays (calendar_id, holiday_date);
    CREATE INDEX idx_service_calendar_holidays_calendar
      ON service_calendar_holidays (calendar_id, holiday_date);
    ALTER TABLE service_calendar_holidays
      ADD CONSTRAINT service_calendar_holidays_tenant_created_by_fk
        FOREIGN KEY (tenant_id, created_by) REFERENCES users(tenant_id, id) ON DELETE SET NULL (created_by);

    -- --- SQ-ADV-001: SLA policy matrix -------------------------------------

    CREATE TABLE service_sla_policies (
      id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id             UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,

      code                  TEXT        NOT NULL,
      name                  TEXT        NOT NULL,
      description           TEXT,
      calendar_id           UUID        NOT NULL,
      FOREIGN KEY (tenant_id, calendar_id)
        REFERENCES service_business_calendars(tenant_id, id) ON DELETE RESTRICT,

      is_active             BOOLEAN     NOT NULL DEFAULT true,

      created_by            UUID        REFERENCES users(id) ON DELETE SET NULL,
      created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_by            UUID        REFERENCES users(id) ON DELETE SET NULL,
      updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
      deleted_by            UUID        REFERENCES users(id) ON DELETE SET NULL,
      deleted_at            TIMESTAMPTZ
    );

    ALTER TABLE service_sla_policies
      ADD CONSTRAINT service_sla_policies_tenant_id_id_unique UNIQUE (tenant_id, id);
    CREATE UNIQUE INDEX service_sla_policies_tenant_code_unique
      ON service_sla_policies (tenant_id, code) WHERE deleted_at IS NULL;
    CREATE INDEX idx_service_sla_policies_tenant
      ON service_sla_policies (tenant_id) WHERE deleted_at IS NULL;
    ALTER TABLE service_sla_policies
      ADD CONSTRAINT service_sla_policies_tenant_created_by_fk
        FOREIGN KEY (tenant_id, created_by) REFERENCES users(tenant_id, id) ON DELETE SET NULL (created_by),
      ADD CONSTRAINT service_sla_policies_tenant_updated_by_fk
        FOREIGN KEY (tenant_id, updated_by) REFERENCES users(tenant_id, id) ON DELETE SET NULL (updated_by),
      ADD CONSTRAINT service_sla_policies_tenant_deleted_by_fk
        FOREIGN KEY (tenant_id, deleted_by) REFERENCES users(tenant_id, id) ON DELETE SET NULL (deleted_by);

    -- One rule = one cell of the multidimensional matrix. Every dimension is
    -- nullable and NULL means "any", so a Tenant states only the dimensions
    -- it cares about. Resolution is deterministic and explainable: the rule
    -- with the highest specificity (count of non-null dimensions) wins, with
    -- an explicit priority column and then code as documented tiebreakers.
    -- Severity and category are Reference Data codes, never hardcoded terms.
    CREATE TABLE service_sla_rules (
      id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id             UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      policy_id             UUID        NOT NULL,
      FOREIGN KEY (tenant_id, policy_id)
        REFERENCES service_sla_policies(tenant_id, id) ON DELETE CASCADE,

      code                  TEXT        NOT NULL,

      customer_id           UUID,
      contract_id           UUID,
      FOREIGN KEY (tenant_id, customer_id)
        REFERENCES customers(tenant_id, id) ON DELETE CASCADE,
      FOREIGN KEY (tenant_id, contract_id)
        REFERENCES contracts(tenant_id, id) ON DELETE CASCADE,
      severity_code         TEXT,
      category_code         TEXT,

      -- Two independent commitments per rule; either may be omitted.
      response_minutes      INTEGER     CHECK (response_minutes IS NULL OR response_minutes > 0),
      resolution_minutes    INTEGER     CHECK (resolution_minutes IS NULL OR resolution_minutes > 0),
      CHECK (response_minutes IS NOT NULL OR resolution_minutes IS NOT NULL),

      priority              INTEGER     NOT NULL DEFAULT 0,
      is_active             BOOLEAN     NOT NULL DEFAULT true,

      created_by            UUID        REFERENCES users(id) ON DELETE SET NULL,
      created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_by            UUID        REFERENCES users(id) ON DELETE SET NULL,
      updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
      deleted_by            UUID        REFERENCES users(id) ON DELETE SET NULL,
      deleted_at            TIMESTAMPTZ
    );

    ALTER TABLE service_sla_rules
      ADD CONSTRAINT service_sla_rules_tenant_id_id_unique UNIQUE (tenant_id, id);
    CREATE UNIQUE INDEX service_sla_rules_policy_code_unique
      ON service_sla_rules (policy_id, code) WHERE deleted_at IS NULL;
    CREATE INDEX idx_service_sla_rules_policy
      ON service_sla_rules (policy_id) WHERE deleted_at IS NULL;
    CREATE INDEX idx_service_sla_rules_tenant_match
      ON service_sla_rules (tenant_id, customer_id, severity_code, category_code) WHERE deleted_at IS NULL;
    ALTER TABLE service_sla_rules
      ADD CONSTRAINT service_sla_rules_tenant_created_by_fk
        FOREIGN KEY (tenant_id, created_by) REFERENCES users(tenant_id, id) ON DELETE SET NULL (created_by),
      ADD CONSTRAINT service_sla_rules_tenant_updated_by_fk
        FOREIGN KEY (tenant_id, updated_by) REFERENCES users(tenant_id, id) ON DELETE SET NULL (updated_by),
      ADD CONSTRAINT service_sla_rules_tenant_deleted_by_fk
        FOREIGN KEY (tenant_id, deleted_by) REFERENCES users(tenant_id, id) ON DELETE SET NULL (deleted_by);

    -- The per-complaint SLA snapshot. Targets are frozen at assignment time
    -- so later policy edits cannot retroactively rewrite whether a historical
    -- complaint met its commitment.
    CREATE TABLE complaint_sla_targets (
      id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id             UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      complaint_id          UUID        NOT NULL,
      FOREIGN KEY (tenant_id, complaint_id)
        REFERENCES complaints(tenant_id, id) ON DELETE RESTRICT,

      policy_id             UUID,
      rule_id               UUID,
      calendar_id           UUID,
      FOREIGN KEY (tenant_id, policy_id)
        REFERENCES service_sla_policies(tenant_id, id) ON DELETE RESTRICT,
      FOREIGN KEY (tenant_id, rule_id)
        REFERENCES service_sla_rules(tenant_id, id) ON DELETE RESTRICT,
      FOREIGN KEY (tenant_id, calendar_id)
        REFERENCES service_business_calendars(tenant_id, id) ON DELETE RESTRICT,

      -- Snapshot of the matched inputs and the resolution explanation, so a
      -- reviewer can see WHY this target applied without re-running matching.
      policy_code_snapshot  TEXT,
      rule_code_snapshot    TEXT,
      calendar_code_snapshot TEXT,
      time_zone_snapshot    TEXT,
      matched_dimensions    JSONB       NOT NULL DEFAULT '{}'::jsonb,

      started_at            TIMESTAMPTZ NOT NULL,
      response_minutes      INTEGER     CHECK (response_minutes IS NULL OR response_minutes > 0),
      resolution_minutes    INTEGER     CHECK (resolution_minutes IS NULL OR resolution_minutes > 0),
      response_due_at       TIMESTAMPTZ,
      resolution_due_at     TIMESTAMPTZ,

      first_response_at     TIMESTAMPTZ,
      resolved_at           TIMESTAMPTZ,
      response_breached     BOOLEAN     NOT NULL DEFAULT false,
      resolution_breached   BOOLEAN     NOT NULL DEFAULT false,

      created_by            UUID        REFERENCES users(id) ON DELETE SET NULL,
      created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE UNIQUE INDEX complaint_sla_targets_complaint_unique
      ON complaint_sla_targets (complaint_id);
    CREATE INDEX idx_complaint_sla_targets_tenant
      ON complaint_sla_targets (tenant_id);
    CREATE INDEX idx_complaint_sla_targets_resolution_due
      ON complaint_sla_targets (tenant_id, resolution_due_at) WHERE resolved_at IS NULL;
    ALTER TABLE complaint_sla_targets
      ADD CONSTRAINT complaint_sla_targets_tenant_created_by_fk
        FOREIGN KEY (tenant_id, created_by) REFERENCES users(tenant_id, id) ON DELETE SET NULL (created_by);

    -- Durable subscriber receipts close the EventBus process-crash window.
    -- The Domain Event remains the source of truth; this table records only
    -- that the Service Quality projection handled that exact event.
    CREATE TABLE service_quality_event_receipts (
      tenant_id             UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      domain_event_id       UUID        NOT NULL REFERENCES domain_events(id) ON DELETE CASCADE,
      processed_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (tenant_id, domain_event_id)
    );
    CREATE INDEX idx_service_quality_event_receipts_processed
      ON service_quality_event_receipts (tenant_id, processed_at);

    -- Reconcile after restart or subscriber failure. The generic Scheduler
    -- stores only this reviewed handler key — never Tenant-authored code.
    INSERT INTO scheduled_jobs
      (job_code, name, description, interval_seconds, handler_key, is_enabled)
    VALUES (
      'service-quality-sla-reconciliation',
      'Service Quality SLA Reconciliation',
      'Replays unprocessed Complaint lifecycle Domain Events into the idempotent commercial SLA projection.',
      60,
      'service-quality-sla-reconciliation',
      true
    )
    ON CONFLICT (job_code) DO NOTHING;

    -- --- SQ-ADV-002: structured RCA + advanced CAPA ------------------------

    -- Hierarchical, Tenant-authored root-cause taxonomy. Replaces nothing:
    -- complaints.root_cause free text stays for narrative, while the coded
    -- finding below makes recurrence analysis possible.
    CREATE TABLE service_root_cause_categories (
      id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id             UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,

      code                  TEXT        NOT NULL,
      name                  TEXT        NOT NULL,
      description           TEXT,
      parent_id             UUID,

      sort_order            INTEGER     NOT NULL DEFAULT 0,
      is_active             BOOLEAN     NOT NULL DEFAULT true,

      created_by            UUID        REFERENCES users(id) ON DELETE SET NULL,
      created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_by            UUID        REFERENCES users(id) ON DELETE SET NULL,
      updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
      deleted_by            UUID        REFERENCES users(id) ON DELETE SET NULL,
      deleted_at            TIMESTAMPTZ
    );

    ALTER TABLE service_root_cause_categories
      ADD CONSTRAINT service_root_cause_categories_tenant_id_id_unique UNIQUE (tenant_id, id);
    ALTER TABLE service_root_cause_categories
      ADD CONSTRAINT service_root_cause_categories_tenant_parent_fk
      FOREIGN KEY (tenant_id, parent_id)
      REFERENCES service_root_cause_categories(tenant_id, id) ON DELETE RESTRICT;
    CREATE UNIQUE INDEX service_root_cause_categories_tenant_code_unique
      ON service_root_cause_categories (tenant_id, code) WHERE deleted_at IS NULL;
    CREATE INDEX idx_service_root_cause_categories_tenant
      ON service_root_cause_categories (tenant_id) WHERE deleted_at IS NULL;
    CREATE INDEX idx_service_root_cause_categories_parent
      ON service_root_cause_categories (parent_id) WHERE parent_id IS NOT NULL AND deleted_at IS NULL;
    ALTER TABLE service_root_cause_categories
      ADD CONSTRAINT service_root_cause_categories_tenant_created_by_fk
        FOREIGN KEY (tenant_id, created_by) REFERENCES users(tenant_id, id) ON DELETE SET NULL (created_by),
      ADD CONSTRAINT service_root_cause_categories_tenant_updated_by_fk
        FOREIGN KEY (tenant_id, updated_by) REFERENCES users(tenant_id, id) ON DELETE SET NULL (updated_by),
      ADD CONSTRAINT service_root_cause_categories_tenant_deleted_by_fk
        FOREIGN KEY (tenant_id, deleted_by) REFERENCES users(tenant_id, id) ON DELETE SET NULL (deleted_by);

    -- A coded RCA finding recorded against a complaint.
    CREATE TABLE complaint_rca_findings (
      id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id             UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      complaint_id          UUID        NOT NULL,
      root_cause_category_id UUID        NOT NULL,
      FOREIGN KEY (tenant_id, complaint_id)
        REFERENCES complaints(tenant_id, id) ON DELETE RESTRICT,
      FOREIGN KEY (tenant_id, root_cause_category_id)
        REFERENCES service_root_cause_categories(tenant_id, id) ON DELETE RESTRICT,
      -- Tenant Reference Data: which structured method produced the finding.
      analysis_method_code  TEXT,
      statement             TEXT        NOT NULL,
      evidence_summary      TEXT,
      is_primary            BOOLEAN     NOT NULL DEFAULT false,

      identified_by         UUID        REFERENCES users(id) ON DELETE SET NULL,
      identified_at         TIMESTAMPTZ NOT NULL DEFAULT now(),

      created_by            UUID        REFERENCES users(id) ON DELETE SET NULL,
      created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_by            UUID        REFERENCES users(id) ON DELETE SET NULL,
      updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
      deleted_by            UUID        REFERENCES users(id) ON DELETE SET NULL,
      deleted_at            TIMESTAMPTZ
    );

    ALTER TABLE complaint_rca_findings
      ADD CONSTRAINT complaint_rca_findings_tenant_id_id_unique UNIQUE (tenant_id, id);
    CREATE INDEX idx_complaint_rca_findings_complaint
      ON complaint_rca_findings (complaint_id) WHERE deleted_at IS NULL;
    CREATE INDEX idx_complaint_rca_findings_tenant_category
      ON complaint_rca_findings (tenant_id, root_cause_category_id) WHERE deleted_at IS NULL;
    CREATE UNIQUE INDEX complaint_rca_findings_primary_unique
      ON complaint_rca_findings (complaint_id) WHERE is_primary AND deleted_at IS NULL;
    ALTER TABLE complaint_rca_findings
      ADD CONSTRAINT complaint_rca_findings_tenant_identified_by_fk
        FOREIGN KEY (tenant_id, identified_by) REFERENCES users(tenant_id, id) ON DELETE SET NULL (identified_by),
      ADD CONSTRAINT complaint_rca_findings_tenant_created_by_fk
        FOREIGN KEY (tenant_id, created_by) REFERENCES users(tenant_id, id) ON DELETE SET NULL (created_by),
      ADD CONSTRAINT complaint_rca_findings_tenant_updated_by_fk
        FOREIGN KEY (tenant_id, updated_by) REFERENCES users(tenant_id, id) ON DELETE SET NULL (updated_by),
      ADD CONSTRAINT complaint_rca_findings_tenant_deleted_by_fk
        FOREIGN KEY (tenant_id, deleted_by) REFERENCES users(tenant_id, id) ON DELETE SET NULL (deleted_by);

    -- CAPA action. Lifecycle is owned by the Workflow Engine via
    -- workflow_instance_id; effectiveness verification is a separate,
    -- explicitly permissioned step so "done" never silently means "worked".
    CREATE TABLE complaint_capa_actions (
      id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id             UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      complaint_id          UUID        NOT NULL,
      rca_finding_id        UUID,
      FOREIGN KEY (tenant_id, complaint_id)
        REFERENCES complaints(tenant_id, id) ON DELETE RESTRICT,
      FOREIGN KEY (tenant_id, rca_finding_id)
        REFERENCES complaint_rca_findings(tenant_id, id) ON DELETE RESTRICT,

      action_number         TEXT        NOT NULL,
      action_type           TEXT        NOT NULL CHECK (action_type IN ('corrective', 'preventive')),
      title                 TEXT        NOT NULL,
      description           TEXT,

      owner_user_id         UUID,
      due_date              DATE,

      -- This is a read projection of the authoritative Workflow Instance, not
      -- an independently writable lifecycle. Repository transitions must be
      -- conditional and mirrored only after reading Workflow state.
      status                TEXT        NOT NULL DEFAULT 'open'
        CHECK (status IN ('open', 'in_progress', 'completed', 'verified', 'ineffective', 'cancelled')),
      completed_at          TIMESTAMPTZ,
      completion_note       TEXT,

      effectiveness_verdict TEXT
        CHECK (effectiveness_verdict IS NULL OR effectiveness_verdict IN ('effective', 'ineffective')),
      effectiveness_note    TEXT,
      verified_by           UUID,
      verified_at           TIMESTAMPTZ,

      workflow_instance_id  UUID,

      created_by            UUID,
      created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_by            UUID,
      updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
      deleted_by            UUID,
      deleted_at            TIMESTAMPTZ,

      FOREIGN KEY (tenant_id, owner_user_id)
        REFERENCES users(tenant_id, id) ON DELETE SET NULL (owner_user_id),
      FOREIGN KEY (tenant_id, verified_by)
        REFERENCES users(tenant_id, id) ON DELETE SET NULL (verified_by),
      FOREIGN KEY (tenant_id, workflow_instance_id)
        REFERENCES workflow_instances(tenant_id, id) ON DELETE RESTRICT,
      FOREIGN KEY (tenant_id, created_by)
        REFERENCES users(tenant_id, id),
      FOREIGN KEY (tenant_id, updated_by)
        REFERENCES users(tenant_id, id),
      FOREIGN KEY (tenant_id, deleted_by)
        REFERENCES users(tenant_id, id),

      CHECK (
        (status IN ('open', 'in_progress', 'cancelled') AND completed_at IS NULL)
        OR (status IN ('completed', 'verified', 'ineffective') AND completed_at IS NOT NULL)
      ),
      CHECK (
        (effectiveness_verdict IS NULL AND verified_by IS NULL AND verified_at IS NULL)
        OR (effectiveness_verdict IS NOT NULL AND verified_by IS NOT NULL AND verified_at IS NOT NULL)
      ),
      CHECK (
        (status = 'verified' AND effectiveness_verdict = 'effective')
        OR (status = 'ineffective' AND effectiveness_verdict = 'ineffective')
        OR (status NOT IN ('verified', 'ineffective') AND effectiveness_verdict IS NULL)
      )
    );

    ALTER TABLE complaint_capa_actions
      ADD CONSTRAINT complaint_capa_actions_tenant_id_id_unique UNIQUE (tenant_id, id);
    CREATE UNIQUE INDEX complaint_capa_actions_tenant_number_unique
      ON complaint_capa_actions (tenant_id, action_number);
    CREATE INDEX idx_complaint_capa_actions_complaint
      ON complaint_capa_actions (complaint_id) WHERE deleted_at IS NULL;
    CREATE INDEX idx_complaint_capa_actions_tenant_status
      ON complaint_capa_actions (tenant_id, status) WHERE deleted_at IS NULL;
    CREATE INDEX idx_complaint_capa_actions_owner
      ON complaint_capa_actions (tenant_id, owner_user_id) WHERE owner_user_id IS NOT NULL AND deleted_at IS NULL;

    -- --- SQ-ADV-003: recurring-problem detection ---------------------------

    -- An explainable, Tenant-authored detection rule. Criteria are explicit
    -- columns, not an expression language: the platform forbids DSL/scripting,
    -- and a fixed grouping vocabulary keeps every query bounded and indexable.
    CREATE TABLE service_recurrence_rules (
      id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id             UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,

      code                  TEXT        NOT NULL,
      name                  TEXT        NOT NULL,
      description           TEXT,

      group_by              TEXT        NOT NULL
        CHECK (group_by IN ('category', 'severity', 'customer', 'site', 'service', 'root_cause')),
      window_days           INTEGER     NOT NULL CHECK (window_days BETWEEN 1 AND 365),
      minimum_occurrences   INTEGER     NOT NULL CHECK (minimum_occurrences >= 2),

      -- Optional narrowing so a rule can watch one customer or one severity.
      customer_id           UUID,
      severity_code         TEXT,
      category_code         TEXT,

      is_active             BOOLEAN     NOT NULL DEFAULT true,

      created_by            UUID,
      created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_by            UUID,
      updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
      deleted_by            UUID,
      deleted_at            TIMESTAMPTZ,

      FOREIGN KEY (tenant_id, customer_id)
        REFERENCES customers(tenant_id, id) ON DELETE RESTRICT,
      FOREIGN KEY (tenant_id, created_by)
        REFERENCES users(tenant_id, id),
      FOREIGN KEY (tenant_id, updated_by)
        REFERENCES users(tenant_id, id),
      FOREIGN KEY (tenant_id, deleted_by)
        REFERENCES users(tenant_id, id)
    );

    ALTER TABLE service_recurrence_rules
      ADD CONSTRAINT service_recurrence_rules_tenant_id_id_unique UNIQUE (tenant_id, id);
    CREATE UNIQUE INDEX service_recurrence_rules_tenant_code_unique
      ON service_recurrence_rules (tenant_id, code) WHERE deleted_at IS NULL;
    CREATE INDEX idx_service_recurrence_rules_tenant
      ON service_recurrence_rules (tenant_id) WHERE deleted_at IS NULL;

    -- --- SQ-ADV-004: Founder-gated feedback automation ---------------------

    -- An automation rule that may only ever PROPOSE. requires_approval is
    -- CHECK-pinned to true at the database level, so no configuration path,
    -- API payload, or future code change can silently turn this into
    -- autonomous cross-domain mutation.
    CREATE TABLE service_feedback_automation_rules (
      id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id             UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,

      code                  TEXT        NOT NULL,
      name                  TEXT        NOT NULL,
      description           TEXT,

      -- Which observed feedback signal arms the rule.
      trigger_event         TEXT        NOT NULL
        CHECK (trigger_event IN ('survey_score_below_threshold', 'complaint_reopened', 'sla_resolution_breached')),
      score_threshold       NUMERIC(6, 2),

      -- The single mutation this rule may propose. Deliberately a closed,
      -- reviewed vocabulary — never an arbitrary target table or column.
      proposed_action       TEXT        NOT NULL
        CHECK (proposed_action IN ('reopen_complaint', 'raise_complaint_severity', 'create_capa_action')),
      action_parameters     JSONB       NOT NULL DEFAULT '{}'::jsonb
        CHECK (jsonb_typeof(action_parameters) = 'object'),

      requires_approval     BOOLEAN     NOT NULL DEFAULT true CHECK (requires_approval),
      is_active             BOOLEAN     NOT NULL DEFAULT false,

      created_by            UUID,
      created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_by            UUID,
      updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
      deleted_by            UUID,
      deleted_at            TIMESTAMPTZ,

      FOREIGN KEY (tenant_id, created_by)
        REFERENCES users(tenant_id, id),
      FOREIGN KEY (tenant_id, updated_by)
        REFERENCES users(tenant_id, id),
      FOREIGN KEY (tenant_id, deleted_by)
        REFERENCES users(tenant_id, id),
      CHECK (
        (trigger_event = 'survey_score_below_threshold' AND score_threshold IS NOT NULL)
        OR (trigger_event <> 'survey_score_below_threshold' AND score_threshold IS NULL)
      )
    );

    ALTER TABLE service_feedback_automation_rules
      ADD CONSTRAINT service_feedback_automation_rules_tenant_id_id_unique
        UNIQUE (tenant_id, id),
      ADD CONSTRAINT service_feedback_automation_rules_tenant_id_action_unique
        UNIQUE (tenant_id, id, proposed_action);
    CREATE UNIQUE INDEX service_feedback_automation_rules_tenant_code_unique
      ON service_feedback_automation_rules (tenant_id, code) WHERE deleted_at IS NULL;
    CREATE INDEX idx_service_feedback_automation_rules_tenant_trigger
      ON service_feedback_automation_rules (tenant_id, trigger_event) WHERE deleted_at IS NULL;

    -- A recorded proposal awaiting an explicit human decision. idempotency_key
    -- is uniquely indexed so replaying the same source event can never create
    -- a duplicate proposal or apply an effect twice.
    CREATE TABLE service_feedback_automation_proposals (
      id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id             UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      rule_id               UUID        NOT NULL,

      idempotency_key       TEXT        NOT NULL,

      source_entity_type    TEXT        NOT NULL,
      source_entity_id      UUID        NOT NULL,
      target_entity_type    TEXT        NOT NULL,
      target_entity_id      UUID        NOT NULL,

      proposed_action       TEXT        NOT NULL
        CHECK (proposed_action IN ('reopen_complaint', 'raise_complaint_severity', 'create_capa_action')),
      action_parameters     JSONB       NOT NULL DEFAULT '{}'::jsonb
        CHECK (jsonb_typeof(action_parameters) = 'object'),
      -- Plain-language justification shown to the approver.
      rationale             TEXT        NOT NULL,

      -- Approval and effect application are separate claims. Only a worker
      -- that atomically acquires approved -> applying may invoke the owning
      -- domain, preventing duplicate effects under concurrent delivery.
      status                TEXT        NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'approved', 'rejected', 'applying', 'applied', 'failed', 'superseded')),
      decided_by            UUID,
      decided_at            TIMESTAMPTZ,
      decision_note         TEXT,
      applied_at            TIMESTAMPTZ,
      failure_reason        TEXT,

      created_by            UUID,
      created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_by            UUID,
      updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),

      FOREIGN KEY (tenant_id, rule_id, proposed_action)
        REFERENCES service_feedback_automation_rules(tenant_id, id, proposed_action) ON DELETE RESTRICT,
      FOREIGN KEY (tenant_id, decided_by)
        REFERENCES users(tenant_id, id) ON DELETE SET NULL (decided_by),
      FOREIGN KEY (tenant_id, created_by)
        REFERENCES users(tenant_id, id),
      FOREIGN KEY (tenant_id, updated_by)
        REFERENCES users(tenant_id, id),
      CHECK (
        (status = 'pending' AND decided_by IS NULL AND decided_at IS NULL AND applied_at IS NULL AND failure_reason IS NULL)
        OR (status IN ('approved', 'rejected', 'superseded') AND decided_by IS NOT NULL AND decided_at IS NOT NULL AND applied_at IS NULL AND failure_reason IS NULL)
        OR (status = 'applying' AND decided_by IS NOT NULL AND decided_at IS NOT NULL AND applied_at IS NULL AND failure_reason IS NULL)
        OR (status = 'applied' AND decided_by IS NOT NULL AND decided_at IS NOT NULL AND applied_at IS NOT NULL AND failure_reason IS NULL)
        OR (status = 'failed' AND decided_by IS NOT NULL AND decided_at IS NOT NULL AND applied_at IS NULL AND failure_reason IS NOT NULL)
      )
    );

    ALTER TABLE service_feedback_automation_proposals
      ADD CONSTRAINT service_feedback_automation_proposals_tenant_id_id_unique UNIQUE (tenant_id, id);
    CREATE UNIQUE INDEX service_feedback_automation_proposals_idempotency_unique
      ON service_feedback_automation_proposals (tenant_id, idempotency_key);
    CREATE INDEX idx_service_feedback_automation_proposals_tenant_status
      ON service_feedback_automation_proposals (tenant_id, status);
    CREATE INDEX idx_service_feedback_automation_proposals_target
      ON service_feedback_automation_proposals (tenant_id, target_entity_type, target_entity_id);

    -- -----------------------------------------------------------------------
    -- Reference Data types (TYPE only; Tenants author the ITEMS through the
    -- existing /config/reference-data API — no client-specific SLA, severity,
    -- or analysis vocabulary is seeded here).
    -- -----------------------------------------------------------------------
    INSERT INTO reference_data_types (code, name, description)
    SELECT v.code, v.name, v.description
      FROM (VALUES
        ('rca_analysis_method', 'RCA Analysis Method', 'Tenant-configurable catalog of structured root-cause analysis methods')
      ) AS v(code, name, description)
     WHERE NOT EXISTS (SELECT 1 FROM reference_data_types t WHERE t.code = v.code);

    INSERT INTO permissions (code, description) VALUES
      ('service_quality.read',            'View SLA targets, RCA findings, CAPA actions, and service quality analytics'),
      ('service_quality.configure',       'Maintain business calendars, SLA policies, RCA taxonomy, and recurrence rules'),
      ('service_quality.rca.manage',      'Record and maintain structured root-cause findings'),
      ('service_quality.capa.manage',     'Create and progress corrective and preventive actions'),
      ('service_quality.capa.verify',     'Verify the effectiveness of completed corrective and preventive actions'),
      ('service_quality.automation.read', 'View feedback automation rules and proposed domain mutations'),
      ('service_quality.automation.approve', 'Approve or reject a proposed automatic domain mutation from feedback')
    ON CONFLICT (code) DO NOTHING;

  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    DELETE FROM scheduled_jobs WHERE job_code = 'service-quality-sla-reconciliation';

    DROP TABLE IF EXISTS service_feedback_automation_proposals;
    DROP TABLE IF EXISTS service_feedback_automation_rules;
    DROP TABLE IF EXISTS service_recurrence_rules;
    DROP TABLE IF EXISTS complaint_capa_actions;
    DROP TABLE IF EXISTS complaint_rca_findings;
    DROP TABLE IF EXISTS service_root_cause_categories;
    DROP TABLE IF EXISTS service_quality_event_receipts;
    DROP TABLE IF EXISTS complaint_sla_targets;
    DROP TABLE IF EXISTS service_sla_rules;
    DROP TABLE IF EXISTS service_sla_policies;
    DROP TABLE IF EXISTS service_calendar_holidays;
    DROP TABLE IF EXISTS service_calendar_workweek;
    DROP TABLE IF EXISTS service_business_calendars;

    ALTER TABLE workflow_instances DROP CONSTRAINT IF EXISTS workflow_instances_tenant_id_id_unique;
    ALTER TABLE complaints         DROP CONSTRAINT IF EXISTS complaints_tenant_id_id_unique;
    ALTER TABLE contracts          DROP CONSTRAINT IF EXISTS contracts_tenant_id_id_unique;
    ALTER TABLE customers          DROP CONSTRAINT IF EXISTS customers_tenant_id_id_unique;
    ALTER TABLE users              DROP CONSTRAINT IF EXISTS users_tenant_id_id_unique;

    DELETE FROM reference_data_types WHERE code IN ('rca_analysis_method');

    DELETE FROM permissions
     WHERE code IN (
       'service_quality.read',
       'service_quality.configure',
       'service_quality.rca.manage',
       'service_quality.capa.manage',
       'service_quality.capa.verify',
       'service_quality.automation.read',
       'service_quality.automation.approve'
     );
  `);
};
