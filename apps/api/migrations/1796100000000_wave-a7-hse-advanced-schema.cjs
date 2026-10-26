/**
 * Wave A7 — HSE Advanced schema (HSE-ADV-001…007).
 *
 * Layered on top of `hse_records` / `hse_follow_ups` (1768000000000) without
 * altering either. ADR-0027 §1: the Core follow-up action stays exactly as
 * delivered, and no Core path may require an Advanced table to exist. A tenant
 * with no investigation, no risk matrix, no permit, no programme, no monitoring
 * point and no CAPA behaves exactly as it did before this migration ran.
 *
 * The three boundary decisions this schema encodes:
 *
 *   §2 — Investigation methodology is versioned metadata. An investigation keeps
 *        the `framework_version` it was recorded under, so changing a taxonomy
 *        cannot rewrite history.
 *
 *   §3 — Risk rating is stored on the assessment. The matrix is tenant
 *        configuration (`hse_risk_matrices` + cells); the rating a matrix
 *        produced is written onto `hse_risk_assessments` at assessment time, so
 *        re-configuring the matrix does not silently re-rate the past.
 *
 *   §4 — Permit lifecycle is the Workflow Engine's, exclusively. `hse_permits`
 *        carries `workflow_instance_id` and NO status column. Validity dates and
 *        isolation conditions are content; state is the Engine's.
 *
 * Everything else is a plain record with tenant isolation and Data Scope.
 */
exports.up = (pgm) => {
  pgm.sql(`

    -- =======================================================================
    -- HSE-ADV-001 — structured investigation
    -- One investigation per HSE record. The methodology is chosen from a
    -- tenant-maintained catalog; the framework version is copied onto the
    -- investigation at creation and never updated afterwards.
    -- =======================================================================
    CREATE TABLE hse_investigation_frameworks (
      id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id             UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,

      code                  TEXT        NOT NULL,
      name                  TEXT        NOT NULL,
      description           TEXT,
      -- The cause taxonomy this framework prescribes, e.g. the category names a
      -- 5-Why or Fishbone investigation is expected to sort findings into.
      cause_categories      JSONB       NOT NULL DEFAULT '[]'::jsonb,

      version               INTEGER     NOT NULL DEFAULT 1 CHECK (version > 0),
      is_active             BOOLEAN     NOT NULL DEFAULT true,

      created_by_user_id    UUID        REFERENCES users(id) ON DELETE SET NULL,
      created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),

      CONSTRAINT uq_hse_investigation_frameworks UNIQUE (tenant_id, code, version)
    );

    CREATE TABLE hse_investigations (
      id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id             UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      hse_record_id         UUID        NOT NULL REFERENCES hse_records(id) ON DELETE CASCADE,

      framework_id          UUID        NOT NULL REFERENCES hse_investigation_frameworks(id) ON DELETE RESTRICT,
      -- Copied from the framework at creation. Historical investigations keep
      -- the version they were recorded under (ADR-0027 §2).
      framework_code        TEXT        NOT NULL,
      framework_version     INTEGER     NOT NULL CHECK (framework_version > 0),

      lead_investigator_user_id UUID    REFERENCES users(id) ON DELETE SET NULL,
      started_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
      concluded_at          TIMESTAMPTZ,

      -- Narrative findings and the determination itself.
      findings              TEXT,
      root_cause            TEXT,
      -- Each contributing factor: { category, description, isRootCause }.
      contributing_factors  JSONB       NOT NULL DEFAULT '[]'::jsonb,

      created_by_user_id    UUID        REFERENCES users(id) ON DELETE SET NULL,
      updated_by_user_id    UUID        REFERENCES users(id) ON DELETE SET NULL,
      created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),

      -- One live investigation per record. Re-opening a concluded one is an
      -- update, not a second row, so the record's story stays in one place.
      CONSTRAINT uq_hse_investigations_record UNIQUE (hse_record_id),
      CONSTRAINT ck_hse_investigations_concluded CHECK (
        concluded_at IS NULL OR concluded_at >= started_at
      )
    );

    CREATE INDEX idx_hse_investigations_tenant ON hse_investigations (tenant_id, started_at DESC);

    -- =======================================================================
    -- HSE-ADV-002 — risk matrix, JSA/HIRA assessments
    -- =======================================================================
    CREATE TABLE hse_risk_matrices (
      id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id             UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,

      code                  TEXT        NOT NULL,
      name                  TEXT        NOT NULL,
      -- Ordered scale definitions: { likelihood: [{value,label}], severity: [...] }.
      likelihood_scale      JSONB       NOT NULL,
      severity_scale        JSONB       NOT NULL,

      is_active             BOOLEAN     NOT NULL DEFAULT true,
      created_by_user_id    UUID        REFERENCES users(id) ON DELETE SET NULL,
      created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),

      CONSTRAINT uq_hse_risk_matrices_code UNIQUE (tenant_id, code)
    );

    -- At most one active matrix per tenant, so "which matrix rates this" is
    -- never ambiguous at assessment time.
    CREATE UNIQUE INDEX uq_hse_risk_matrices_one_active
      ON hse_risk_matrices (tenant_id) WHERE is_active;

    -- One row per (likelihood, severity) cell, naming the band it produces.
    CREATE TABLE hse_risk_matrix_cells (
      id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id             UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      matrix_id             UUID        NOT NULL REFERENCES hse_risk_matrices(id) ON DELETE CASCADE,

      likelihood            INTEGER     NOT NULL CHECK (likelihood > 0),
      severity              INTEGER     NOT NULL CHECK (severity > 0),
      -- The band this cell falls in, e.g. low / medium / high / extreme.
      band_code             TEXT        NOT NULL,
      -- The numeric score the cell carries; the band is what the UI shows.
      score                 NUMERIC(10,2) NOT NULL CHECK (score >= 0),

      CONSTRAINT uq_hse_risk_matrix_cells UNIQUE (matrix_id, likelihood, severity)
    );

    CREATE TABLE hse_risk_assessments (
      id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id             UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,

      -- A JSA/HIRA may hang off an HSE record, a project, or stand alone as a
      -- planned-task assessment. At least one anchor is required, because an
      -- assessment nobody can find is not a control.
      hse_record_id         UUID        REFERENCES hse_records(id) ON DELETE CASCADE,
      project_id            UUID        REFERENCES projects(id) ON DELETE SET NULL,

      assessment_type       TEXT        NOT NULL CHECK (assessment_type IN ('jsa', 'hira')),
      title                 TEXT        NOT NULL,
      task_description      TEXT,

      matrix_id             UUID        NOT NULL REFERENCES hse_risk_matrices(id) ON DELETE RESTRICT,
      likelihood            INTEGER     NOT NULL CHECK (likelihood > 0),
      severity              INTEGER     NOT NULL CHECK (severity > 0),

      -- Stored at assessment time, never recomputed on read (ADR-0027 §3).
      -- A later matrix edit therefore cannot re-rate a historical assessment.
      band_code             TEXT        NOT NULL,
      score                 NUMERIC(10,2) NOT NULL CHECK (score >= 0),

      -- Controls: [{ description, controlType, residualLikelihood, residualSeverity }].
      controls              JSONB       NOT NULL DEFAULT '[]'::jsonb,
      residual_likelihood   INTEGER     CHECK (residual_likelihood IS NULL OR residual_likelihood > 0),
      residual_severity     INTEGER     CHECK (residual_severity IS NULL OR residual_severity > 0),
      residual_band_code    TEXT,
      residual_score        NUMERIC(10,2) CHECK (residual_score IS NULL OR residual_score >= 0),

      assessed_by_user_id   UUID        REFERENCES users(id) ON DELETE SET NULL,
      assessed_at           TIMESTAMPTZ NOT NULL DEFAULT now(),

      created_by_user_id    UUID        REFERENCES users(id) ON DELETE SET NULL,
      updated_by_user_id    UUID        REFERENCES users(id) ON DELETE SET NULL,
      created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),

      CONSTRAINT ck_hse_risk_assessments_anchor CHECK (
        hse_record_id IS NOT NULL OR project_id IS NOT NULL
      ),
      -- Residual fields move together: a half-recorded residual is a rating
      -- nobody can act on.
      CONSTRAINT ck_hse_risk_assessments_residual CHECK (
        (residual_likelihood IS NULL AND residual_severity IS NULL
          AND residual_band_code IS NULL AND residual_score IS NULL)
        OR (residual_likelihood IS NOT NULL AND residual_severity IS NOT NULL
          AND residual_band_code IS NOT NULL AND residual_score IS NOT NULL)
      )
    );

    CREATE INDEX idx_hse_risk_assessments_record
      ON hse_risk_assessments (hse_record_id) WHERE hse_record_id IS NOT NULL;
    CREATE INDEX idx_hse_risk_assessments_project
      ON hse_risk_assessments (tenant_id, project_id) WHERE project_id IS NOT NULL;

    -- =======================================================================
    -- HSE-ADV-003 — Permit to Work
    -- No status column. Lifecycle is the Workflow Engine's, via
    -- 'workflow_instance_id' (ADR-0027 §4). 'valid_from'/'valid_to' are content
    -- the Engine's transitions consult, not a second state machine.
    -- =======================================================================
    CREATE TABLE hse_permits (
      id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id             UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,

      permit_number         TEXT        NOT NULL,
      permit_type_code      TEXT        NOT NULL,
      title                 TEXT        NOT NULL,
      description           TEXT,

      -- Where the work happens, on the same hierarchy the Core record uses.
      organization_unit_id  UUID        REFERENCES organization_units(id) ON DELETE SET NULL,
      project_id            UUID        REFERENCES projects(id) ON DELETE SET NULL,
      site_id               UUID        REFERENCES sites(id) ON DELETE SET NULL,
      location_detail       TEXT,

      valid_from            TIMESTAMPTZ NOT NULL,
      valid_to              TIMESTAMPTZ NOT NULL,

      -- Isolation / safety conditions: [{ conditionType, description, verifiedAt }].
      isolation_conditions  JSONB       NOT NULL DEFAULT '[]'::jsonb,
      -- Clean reference to the risk assessment this permit is issued against.
      risk_assessment_id    UUID        REFERENCES hse_risk_assessments(id) ON DELETE SET NULL,

      -- Lifecycle authority. Null until the Engine instance is started.
      workflow_instance_id  UUID        REFERENCES workflow_instances(id) ON DELETE SET NULL,

      requested_by_user_id  UUID        REFERENCES users(id) ON DELETE SET NULL,
      created_by_user_id    UUID        REFERENCES users(id) ON DELETE SET NULL,
      updated_by_user_id    UUID        REFERENCES users(id) ON DELETE SET NULL,
      created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),

      CONSTRAINT uq_hse_permits_number UNIQUE (tenant_id, permit_number),
      CONSTRAINT ck_hse_permits_validity CHECK (valid_to > valid_from)
    );

    CREATE INDEX idx_hse_permits_tenant ON hse_permits (tenant_id, valid_from DESC);
    CREATE INDEX idx_hse_permits_workflow
      ON hse_permits (workflow_instance_id) WHERE workflow_instance_id IS NOT NULL;
    CREATE INDEX idx_hse_permits_project
      ON hse_permits (tenant_id, project_id) WHERE project_id IS NOT NULL;

    -- =======================================================================
    -- HSE-ADV-004 — planned inspection and audit programmes
    -- =======================================================================
    CREATE TABLE hse_audit_programmes (
      id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id             UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,

      code                  TEXT        NOT NULL,
      name                  TEXT        NOT NULL,
      description           TEXT,
      programme_type        TEXT        NOT NULL DEFAULT 'inspection'
        CHECK (programme_type IN ('inspection', 'audit')),

      -- Frequency in days between due occurrences. The Scheduler owns when a
      -- job actually fires; this is the interval it is given (ADR-0027 §5).
      frequency_days        INTEGER     NOT NULL CHECK (frequency_days > 0),
      -- Checklist items: [{ code, question, isMandatory }].
      checklist             JSONB       NOT NULL DEFAULT '[]'::jsonb,

      organization_unit_id  UUID        REFERENCES organization_units(id) ON DELETE SET NULL,
      site_id               UUID        REFERENCES sites(id) ON DELETE SET NULL,
      owner_user_id         UUID        REFERENCES users(id) ON DELETE SET NULL,

      is_active             BOOLEAN     NOT NULL DEFAULT true,
      last_scheduled_for    DATE,

      created_by_user_id    UUID        REFERENCES users(id) ON DELETE SET NULL,
      updated_by_user_id    UUID        REFERENCES users(id) ON DELETE SET NULL,
      created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),

      CONSTRAINT uq_hse_audit_programmes_code UNIQUE (tenant_id, code)
    );

    CREATE TABLE hse_audit_occurrences (
      id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id             UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      programme_id          UUID        NOT NULL REFERENCES hse_audit_programmes(id) ON DELETE CASCADE,

      scheduled_for         DATE        NOT NULL,
      performed_at          TIMESTAMPTZ,
      performed_by_user_id  UUID        REFERENCES users(id) ON DELETE SET NULL,

      -- Per-item results: [{ itemCode, result, note }].
      results               JSONB       NOT NULL DEFAULT '[]'::jsonb,
      notes                 TEXT,

      created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),

      CONSTRAINT uq_hse_audit_occurrences UNIQUE (programme_id, scheduled_for)
    );

    CREATE INDEX idx_hse_audit_occurrences_programme
      ON hse_audit_occurrences (programme_id, scheduled_for DESC);

    -- A finding is a recorded gap. It may raise a CAPA; it never mutates
    -- incident or asset state (ADR-0027 §5).
    CREATE TABLE hse_audit_findings (
      id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id             UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      occurrence_id         UUID        NOT NULL REFERENCES hse_audit_occurrences(id) ON DELETE CASCADE,

      finding_type          TEXT        NOT NULL DEFAULT 'nonconformity'
        CHECK (finding_type IN ('observation', 'nonconformity', 'major_nonconformity')),
      checklist_item_code   TEXT,
      description           TEXT        NOT NULL,

      created_by_user_id    UUID        REFERENCES users(id) ON DELETE SET NULL,
      created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE INDEX idx_hse_audit_findings_occurrence ON hse_audit_findings (occurrence_id);

    -- =======================================================================
    -- HSE-ADV-005 — environmental monitoring
    -- Measurement plus threshold. A breach may raise a CAPA; this module keeps
    -- no corrective-action list of its own (ADR-0027 §6).
    -- =======================================================================
    CREATE TABLE hse_monitoring_points (
      id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id             UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,

      code                  TEXT        NOT NULL,
      name                  TEXT        NOT NULL,
      parameter_code        TEXT        NOT NULL,
      unit                  TEXT        NOT NULL,

      -- Threshold direction: a reading above max and/or below min is a breach.
      -- NULL means that side is unbounded, so one-sided limits are expressible.
      threshold_min         NUMERIC(20,4),
      threshold_max         NUMERIC(20,4),

      organization_unit_id  UUID        REFERENCES organization_units(id) ON DELETE SET NULL,
      site_id               UUID        REFERENCES sites(id) ON DELETE SET NULL,

      is_active             BOOLEAN     NOT NULL DEFAULT true,
      created_by_user_id    UUID        REFERENCES users(id) ON DELETE SET NULL,
      created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),

      CONSTRAINT uq_hse_monitoring_points_code UNIQUE (tenant_id, code),
      CONSTRAINT ck_hse_monitoring_points_threshold CHECK (
        threshold_min IS NULL OR threshold_max IS NULL OR threshold_max >= threshold_min
      )
    );

    CREATE TABLE hse_monitoring_readings (
      id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id             UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      point_id              UUID        NOT NULL REFERENCES hse_monitoring_points(id) ON DELETE CASCADE,

      measured_at           TIMESTAMPTZ NOT NULL,
      value                 NUMERIC(20,4) NOT NULL,
      -- Recorded at write time against the point's thresholds as they stood
      -- then, so a later threshold change does not rewrite a past breach.
      is_breach             BOOLEAN     NOT NULL DEFAULT false,

      recorded_by_user_id   UUID        REFERENCES users(id) ON DELETE SET NULL,
      note                  TEXT,
      created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),

      CONSTRAINT uq_hse_monitoring_readings UNIQUE (point_id, measured_at)
    );

    CREATE INDEX idx_hse_monitoring_readings_point
      ON hse_monitoring_readings (point_id, measured_at DESC);
    CREATE INDEX idx_hse_monitoring_readings_breach
      ON hse_monitoring_readings (tenant_id, measured_at DESC) WHERE is_breach;

    -- =======================================================================
    -- HSE-ADV-006 — formal CAPA
    -- A separate aggregate from 'hse_follow_ups' (ADR-0027 §1). It may carry a
    -- reference to a Core follow-up; it never mutates one, and no Core path
    -- requires a CAPA to exist.
    -- =======================================================================
    CREATE TABLE hse_capas (
      id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id             UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,

      capa_number           TEXT        NOT NULL,
      title                 TEXT        NOT NULL,
      description           TEXT,

      -- Any of the four sources may have raised it. At least one must, because
      -- a CAPA with no provenance cannot be closed on evidence.
      hse_record_id         UUID        REFERENCES hse_records(id) ON DELETE SET NULL,
      investigation_id      UUID        REFERENCES hse_investigations(id) ON DELETE SET NULL,
      audit_finding_id      UUID        REFERENCES hse_audit_findings(id) ON DELETE SET NULL,
      monitoring_reading_id UUID        REFERENCES hse_monitoring_readings(id) ON DELETE SET NULL,

      -- Optional link back to the lightweight Core action. Read-only here.
      core_follow_up_id     UUID        REFERENCES hse_follow_ups(id) ON DELETE SET NULL,

      -- The root cause this CAPA answers, copied so the CAPA survives the
      -- investigation being re-opened.
      root_cause            TEXT,
      action_type           TEXT        NOT NULL CHECK (action_type IN ('corrective', 'preventive')),

      status                TEXT        NOT NULL DEFAULT 'open'
        CHECK (status IN ('open', 'in_progress', 'verification', 'closed', 'cancelled')),

      owner_user_id         UUID        REFERENCES users(id) ON DELETE SET NULL,
      due_date              DATE,

      -- Effectiveness verification: a CAPA is not closed by doing the work, it
      -- is closed by showing the work worked.
      verification_notes    TEXT,
      verified_at           TIMESTAMPTZ,
      verified_by_user_id   UUID        REFERENCES users(id) ON DELETE SET NULL,
      closed_at             TIMESTAMPTZ,

      created_by_user_id    UUID        REFERENCES users(id) ON DELETE SET NULL,
      updated_by_user_id    UUID        REFERENCES users(id) ON DELETE SET NULL,
      created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),

      CONSTRAINT uq_hse_capas_number UNIQUE (tenant_id, capa_number),
      CONSTRAINT ck_hse_capas_source CHECK (
        hse_record_id IS NOT NULL OR investigation_id IS NOT NULL
        OR audit_finding_id IS NOT NULL OR monitoring_reading_id IS NOT NULL
      ),
      -- Closing requires the verification that justifies it.
      CONSTRAINT ck_hse_capas_closed CHECK (
        status <> 'closed'
        OR (closed_at IS NOT NULL AND verified_at IS NOT NULL)
      )
    );

    CREATE INDEX idx_hse_capas_tenant ON hse_capas (tenant_id, status, due_date);
    CREATE INDEX idx_hse_capas_record
      ON hse_capas (hse_record_id) WHERE hse_record_id IS NOT NULL;

    CREATE TABLE hse_capa_actions (
      id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id             UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      capa_id               UUID        NOT NULL REFERENCES hse_capas(id) ON DELETE CASCADE,

      description           TEXT        NOT NULL,
      owner_user_id         UUID        REFERENCES users(id) ON DELETE SET NULL,
      due_date              DATE,
      completed_at          TIMESTAMPTZ,
      completion_notes      TEXT,

      created_by_user_id    UUID        REFERENCES users(id) ON DELETE SET NULL,
      created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE INDEX idx_hse_capa_actions_capa ON hse_capa_actions (capa_id);

    -- =======================================================================
    -- HSE-ADV-007 — computed safety indicators
    -- Snapshots with the computation window recorded. Never operator-editable:
    -- the only writer is the indicator service, which derives every value from
    -- recorded facts (ADR-0027 §7).
    -- =======================================================================
    CREATE TABLE hse_indicator_snapshots (
      id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id             UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      organization_unit_id  UUID        REFERENCES organization_units(id) ON DELETE SET NULL,

      -- The window the figures were computed over. Recorded, not implied.
      window_start          DATE        NOT NULL,
      window_end            DATE        NOT NULL,
      -- The employee-hours denominator used for the rate indicators, when one
      -- was supplied. NULL means the rate indicators are reported as null
      -- rather than as a rate over an invented denominator.
      exposure_hours        NUMERIC(20,2) CHECK (exposure_hours IS NULL OR exposure_hours > 0),

      -- Leading
      near_miss_count       INTEGER     NOT NULL DEFAULT 0 CHECK (near_miss_count >= 0),
      observation_count     INTEGER     NOT NULL DEFAULT 0 CHECK (observation_count >= 0),
      inspection_count      INTEGER     NOT NULL DEFAULT 0 CHECK (inspection_count >= 0),
      capa_opened_count     INTEGER     NOT NULL DEFAULT 0 CHECK (capa_opened_count >= 0),
      capa_closed_count     INTEGER     NOT NULL DEFAULT 0 CHECK (capa_closed_count >= 0),
      capa_closure_rate     NUMERIC(10,4) CHECK (capa_closure_rate IS NULL OR capa_closure_rate >= 0),
      permit_count          INTEGER     NOT NULL DEFAULT 0 CHECK (permit_count >= 0),

      -- Lagging
      incident_count        INTEGER     NOT NULL DEFAULT 0 CHECK (incident_count >= 0),
      lost_time_incident_count INTEGER  NOT NULL DEFAULT 0 CHECK (lost_time_incident_count >= 0),
      lost_days             INTEGER     NOT NULL DEFAULT 0 CHECK (lost_days >= 0),
      -- Per 200,000 exposure hours, the conventional base for these rates.
      incident_frequency_rate NUMERIC(14,4) CHECK (incident_frequency_rate IS NULL OR incident_frequency_rate >= 0),
      severity_rate         NUMERIC(14,4) CHECK (severity_rate IS NULL OR severity_rate >= 0),

      computed_by_user_id   UUID        REFERENCES users(id) ON DELETE SET NULL,
      created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),

      CONSTRAINT ck_hse_indicator_snapshots_window CHECK (window_end >= window_start),
      CONSTRAINT ck_hse_indicator_snapshots_closure CHECK (
        capa_closed_count <= capa_opened_count OR capa_opened_count = 0
      )
    );

    CREATE INDEX idx_hse_indicator_snapshots_tenant
      ON hse_indicator_snapshots (tenant_id, window_end DESC);

    -- -----------------------------------------------------------------------
    -- Permissions (6 new capabilities)
    -- Advanced depth is separately grantable so a tenant can run Core HSE
    -- without exposing investigation, risk, permit, programme or CAPA.
    -- -----------------------------------------------------------------------
    INSERT INTO permissions (code, description) VALUES
      ('hse.advanced.read',     'View HSE investigations, risk assessments, permits, programmes, monitoring, CAPA, and indicators'),
      ('hse.advanced.manage',   'Manage HSE investigations, risk assessments, permit content, programmes, monitoring points, and CAPA'),
      ('hse.investigation.lead','Record findings and determine root cause on an HSE investigation'),
      ('hse.permit.request',    'Request a Permit to Work'),
      ('hse.capa.verify',       'Verify CAPA effectiveness and close a CAPA'),
      ('hse.indicator.compute', 'Compute and freeze HSE indicator snapshots')
    ON CONFLICT (code) DO NOTHING;

  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    DELETE FROM permissions WHERE code IN (
      'hse.advanced.read', 'hse.advanced.manage', 'hse.investigation.lead',
      'hse.permit.request', 'hse.capa.verify', 'hse.indicator.compute'
    );
    DROP TABLE IF EXISTS hse_indicator_snapshots;
    DROP TABLE IF EXISTS hse_capa_actions;
    DROP TABLE IF EXISTS hse_capas;
    DROP TABLE IF EXISTS hse_monitoring_readings;
    DROP TABLE IF EXISTS hse_monitoring_points;
    DROP TABLE IF EXISTS hse_audit_findings;
    DROP TABLE IF EXISTS hse_audit_occurrences;
    DROP TABLE IF EXISTS hse_audit_programmes;
    DROP TABLE IF EXISTS hse_permits;
    DROP TABLE IF EXISTS hse_risk_assessments;
    DROP TABLE IF EXISTS hse_risk_matrix_cells;
    DROP TABLE IF EXISTS hse_risk_matrices;
    DROP TABLE IF EXISTS hse_investigations;
    DROP TABLE IF EXISTS hse_investigation_frameworks;
  `);
};
