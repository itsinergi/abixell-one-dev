/**
 * Wave A4 — Workforce Advanced (HR-ADV-001…009).
 *
 * Workforce Core (`employees`, `positions`, `employee_assignments`) answers
 * **identity and placement** only. Everything time-, money-, or
 * evaluation-related is Advanced and lands here:
 *
 *   - Attendance, shift & roster          (HR-ADV-001, HR-ADV-002)
 *   - Leave & overtime                    (HR-ADV-003, HR-ADV-004)
 *   - Payroll, BPJS & PPh 21              (HR-ADV-005)
 *   - Recruitment                         (HR-ADV-006)
 *   - Performance, competency, training,
 *     and career                          (HR-ADV-007, HR-ADV-008)
 *   - Manpower planning                   (HR-ADV-009)
 *
 * Binding design decisions:
 *
 * - **Core stays independent.** Every table here references Core one way
 *   (`employee_id`, `position_id`); Core references nothing in this file, so
 *   dropping Advanced leaves Core fully functional (ADV-GEN-001).
 *
 * - **No competing state machines.** Leave requests, overtime requests,
 *   payroll runs, job postings, and performance reviews carry
 *   `workflow_instance_id` and NO local status column that could disagree
 *   with the Workflow Engine. Local timestamps are projections of workflow
 *   transitions, never the authority.
 *
 * - **Exact decimal money.** All monetary and rate columns are `numeric`.
 *   Statutory contribution rates, caps, PTKP amounts, and PPh 21 brackets are
 *   DATA (`workforce_statutory_policies`), effective-dated and versioned — not
 *   constants in code — so a regulation change is a row, not a deploy.
 *
 * - **Advisory manpower planning.** `workforce_manpower_plans` projects
 *   headcount and cost gaps. Applying a plan never synthesises employee rows;
 *   it records the decision and its projection (ADV-GEN-003).
 *
 * - **Documents stay in Document Core.** `*_document_id` columns are loose
 *   references to `documents` and deliberately carry no foreign key, so
 *   Workforce Advanced never constrains Document Core's lifecycle.
 *
 * Composite candidate keys `(tenant_id, id)` on `users`, `workflow_instances`,
 * and `organization_units` were already added by Waves A1 and A3; this
 * migration adds only the two Workforce Core tables that still lack them.
 */
exports.up = (pgm) => {
  pgm.sql(`
    -- Composite candidate keys bind tenant and entity identity together so a
    -- child row can never reference a parent owned by another tenant.
    ALTER TABLE employees ADD CONSTRAINT employees_tenant_id_id_unique UNIQUE (tenant_id, id);
    ALTER TABLE positions ADD CONSTRAINT positions_tenant_id_id_unique UNIQUE (tenant_id, id);

    -- === Shifts, Roster & Attendance (HR-ADV-001, HR-ADV-002) ===============

    CREATE TABLE workforce_shifts (
      id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id      UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      shift_code     TEXT        NOT NULL,
      name           TEXT        NOT NULL,
      start_time     TIME        NOT NULL,
      end_time       TIME        NOT NULL,
      break_minutes  INTEGER     NOT NULL DEFAULT 0,
      is_overnight   BOOLEAN     NOT NULL DEFAULT false,
      is_active      BOOLEAN     NOT NULL DEFAULT true,
      created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
      created_by     UUID,
      updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_by     UUID,

      FOREIGN KEY (tenant_id, created_by)
        REFERENCES users(tenant_id, id) ON DELETE SET NULL (created_by),
      FOREIGN KEY (tenant_id, updated_by)
        REFERENCES users(tenant_id, id) ON DELETE SET NULL (updated_by),
      CONSTRAINT workforce_shifts_break_check CHECK (break_minutes >= 0 AND break_minutes < 1440),
      UNIQUE (tenant_id, shift_code)
    );

    ALTER TABLE workforce_shifts
      ADD CONSTRAINT workforce_shifts_tenant_id_id_unique UNIQUE (tenant_id, id);
    CREATE INDEX idx_workforce_shifts_tenant
      ON workforce_shifts (tenant_id) WHERE is_active;

    CREATE TABLE workforce_rosters (
      id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id             UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      employee_id           UUID        NOT NULL,
      shift_id              UUID        NOT NULL,
      roster_date           DATE        NOT NULL,
      organization_unit_id  UUID,
      notes                 TEXT,
      created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
      created_by            UUID,
      updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_by            UUID,

      FOREIGN KEY (tenant_id, employee_id)
        REFERENCES employees(tenant_id, id) ON DELETE CASCADE,
      FOREIGN KEY (tenant_id, shift_id)
        REFERENCES workforce_shifts(tenant_id, id) ON DELETE RESTRICT,
      FOREIGN KEY (tenant_id, organization_unit_id)
        REFERENCES organization_units(tenant_id, id) ON DELETE SET NULL (organization_unit_id),
      FOREIGN KEY (tenant_id, created_by)
        REFERENCES users(tenant_id, id) ON DELETE SET NULL (created_by),
      FOREIGN KEY (tenant_id, updated_by)
        REFERENCES users(tenant_id, id) ON DELETE SET NULL (updated_by),
      -- One roster assignment per employee per day; re-rostering updates it.
      UNIQUE (tenant_id, employee_id, roster_date)
    );

    ALTER TABLE workforce_rosters
      ADD CONSTRAINT workforce_rosters_tenant_id_id_unique UNIQUE (tenant_id, id);
    CREATE INDEX idx_workforce_rosters_date
      ON workforce_rosters (tenant_id, roster_date);
    CREATE INDEX idx_workforce_rosters_employee
      ON workforce_rosters (employee_id, roster_date DESC);
    CREATE INDEX idx_workforce_rosters_org_unit
      ON workforce_rosters (organization_unit_id, roster_date);

    CREATE TABLE workforce_attendance_records (
      id                UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id         UUID          NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      employee_id       UUID          NOT NULL,
      attendance_date   DATE          NOT NULL,
      shift_id          UUID,
      clock_in          TIMESTAMPTZ,
      clock_out         TIMESTAMPTZ,
      worked_minutes    INTEGER,
      late_minutes      INTEGER       NOT NULL DEFAULT 0,
      early_out_minutes INTEGER       NOT NULL DEFAULT 0,
      status            TEXT          NOT NULL DEFAULT 'present',
      source            TEXT          NOT NULL DEFAULT 'manual',
      notes             TEXT,
      created_at        TIMESTAMPTZ   NOT NULL DEFAULT now(),
      created_by        UUID,
      updated_at        TIMESTAMPTZ   NOT NULL DEFAULT now(),
      updated_by        UUID,

      FOREIGN KEY (tenant_id, employee_id)
        REFERENCES employees(tenant_id, id) ON DELETE CASCADE,
      FOREIGN KEY (tenant_id, shift_id)
        REFERENCES workforce_shifts(tenant_id, id) ON DELETE SET NULL (shift_id),
      FOREIGN KEY (tenant_id, created_by)
        REFERENCES users(tenant_id, id) ON DELETE SET NULL (created_by),
      FOREIGN KEY (tenant_id, updated_by)
        REFERENCES users(tenant_id, id) ON DELETE SET NULL (updated_by),
      CONSTRAINT workforce_attendance_status_check
        CHECK (status IN ('present', 'late', 'absent', 'leave', 'holiday', 'day_off')),
      -- 'device' is reserved for a future biometric/terminal ingestion port;
      -- no device integration exists in this wave.
      CONSTRAINT workforce_attendance_source_check
        CHECK (source IN ('manual', 'self_service', 'import', 'device')),
      CONSTRAINT workforce_attendance_worked_check
        CHECK (worked_minutes IS NULL OR worked_minutes >= 0),
      UNIQUE (tenant_id, employee_id, attendance_date)
    );

    ALTER TABLE workforce_attendance_records
      ADD CONSTRAINT workforce_attendance_records_tenant_id_id_unique UNIQUE (tenant_id, id);
    CREATE INDEX idx_workforce_attendance_date
      ON workforce_attendance_records (tenant_id, attendance_date);
    CREATE INDEX idx_workforce_attendance_employee
      ON workforce_attendance_records (employee_id, attendance_date DESC);

    -- === Leave & Overtime (HR-ADV-003, HR-ADV-004) ==========================

    CREATE TABLE workforce_leave_types (
      id                     UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id              UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      code                   TEXT        NOT NULL,
      name                   TEXT        NOT NULL,
      annual_allowance_days  NUMERIC(6,2) NOT NULL DEFAULT 0,
      is_paid                BOOLEAN     NOT NULL DEFAULT true,
      requires_attachment    BOOLEAN     NOT NULL DEFAULT false,
      is_active              BOOLEAN     NOT NULL DEFAULT true,
      created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
      created_by             UUID,
      updated_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_by             UUID,

      FOREIGN KEY (tenant_id, created_by)
        REFERENCES users(tenant_id, id) ON DELETE SET NULL (created_by),
      FOREIGN KEY (tenant_id, updated_by)
        REFERENCES users(tenant_id, id) ON DELETE SET NULL (updated_by),
      CONSTRAINT workforce_leave_types_allowance_check CHECK (annual_allowance_days >= 0),
      UNIQUE (tenant_id, code)
    );

    ALTER TABLE workforce_leave_types
      ADD CONSTRAINT workforce_leave_types_tenant_id_id_unique UNIQUE (tenant_id, id);
    CREATE INDEX idx_workforce_leave_types_tenant
      ON workforce_leave_types (tenant_id) WHERE is_active;

    CREATE TABLE workforce_leave_balances (
      id              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id       UUID         NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      employee_id     UUID         NOT NULL,
      leave_type_id   UUID         NOT NULL,
      balance_year    INTEGER      NOT NULL,
      allocated_days  NUMERIC(6,2) NOT NULL DEFAULT 0,
      used_days       NUMERIC(6,2) NOT NULL DEFAULT 0,
      pending_days    NUMERIC(6,2) NOT NULL DEFAULT 0,
      created_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),
      updated_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),

      FOREIGN KEY (tenant_id, employee_id)
        REFERENCES employees(tenant_id, id) ON DELETE CASCADE,
      FOREIGN KEY (tenant_id, leave_type_id)
        REFERENCES workforce_leave_types(tenant_id, id) ON DELETE RESTRICT,
      CONSTRAINT workforce_leave_balances_nonneg_check
        CHECK (allocated_days >= 0 AND used_days >= 0 AND pending_days >= 0),
      CONSTRAINT workforce_leave_balances_year_check
        CHECK (balance_year BETWEEN 1900 AND 2999),
      UNIQUE (tenant_id, employee_id, leave_type_id, balance_year)
    );

    ALTER TABLE workforce_leave_balances
      ADD CONSTRAINT workforce_leave_balances_tenant_id_id_unique UNIQUE (tenant_id, id);
    CREATE INDEX idx_workforce_leave_balances_employee
      ON workforce_leave_balances (employee_id, balance_year DESC);

    CREATE TABLE workforce_leave_requests (
      id                      UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id               UUID         NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      request_number          TEXT         NOT NULL,
      employee_id             UUID         NOT NULL,
      leave_type_id           UUID         NOT NULL,
      start_date              DATE         NOT NULL,
      end_date                DATE         NOT NULL,
      total_days              NUMERIC(6,2) NOT NULL,
      reason                  TEXT,
      attachment_document_id  UUID,
      workflow_instance_id    UUID,
      submitted_at            TIMESTAMPTZ  NOT NULL DEFAULT now(),
      approved_at             TIMESTAMPTZ,
      rejected_at             TIMESTAMPTZ,
      cancelled_at            TIMESTAMPTZ,
      created_at              TIMESTAMPTZ  NOT NULL DEFAULT now(),
      created_by              UUID,
      updated_at              TIMESTAMPTZ  NOT NULL DEFAULT now(),
      updated_by              UUID,

      FOREIGN KEY (tenant_id, employee_id)
        REFERENCES employees(tenant_id, id) ON DELETE RESTRICT,
      FOREIGN KEY (tenant_id, leave_type_id)
        REFERENCES workforce_leave_types(tenant_id, id) ON DELETE RESTRICT,
      FOREIGN KEY (tenant_id, workflow_instance_id)
        REFERENCES workflow_instances(tenant_id, id) ON DELETE SET NULL (workflow_instance_id),
      FOREIGN KEY (tenant_id, created_by)
        REFERENCES users(tenant_id, id) ON DELETE SET NULL (created_by),
      FOREIGN KEY (tenant_id, updated_by)
        REFERENCES users(tenant_id, id) ON DELETE SET NULL (updated_by),
      CONSTRAINT workforce_leave_requests_range_check CHECK (end_date >= start_date),
      CONSTRAINT workforce_leave_requests_days_check CHECK (total_days > 0),
      UNIQUE (tenant_id, request_number)
    );

    ALTER TABLE workforce_leave_requests
      ADD CONSTRAINT workforce_leave_requests_tenant_id_id_unique UNIQUE (tenant_id, id);
    CREATE INDEX idx_workforce_leave_requests_employee
      ON workforce_leave_requests (employee_id, start_date DESC);
    CREATE INDEX idx_workforce_leave_requests_tenant
      ON workforce_leave_requests (tenant_id, submitted_at DESC);
    CREATE INDEX idx_workforce_leave_requests_workflow
      ON workforce_leave_requests (workflow_instance_id);

    CREATE TABLE workforce_overtime_requests (
      id                    UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id             UUID         NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      request_number        TEXT         NOT NULL,
      employee_id           UUID         NOT NULL,
      overtime_date         DATE         NOT NULL,
      start_time            TIME         NOT NULL,
      end_time              TIME         NOT NULL,
      estimated_hours       NUMERIC(6,2) NOT NULL,
      actual_hours          NUMERIC(6,2),
      reason                TEXT,
      workflow_instance_id  UUID,
      submitted_at          TIMESTAMPTZ  NOT NULL DEFAULT now(),
      approved_at           TIMESTAMPTZ,
      rejected_at           TIMESTAMPTZ,
      cancelled_at          TIMESTAMPTZ,
      created_at            TIMESTAMPTZ  NOT NULL DEFAULT now(),
      created_by            UUID,
      updated_at            TIMESTAMPTZ  NOT NULL DEFAULT now(),
      updated_by            UUID,

      FOREIGN KEY (tenant_id, employee_id)
        REFERENCES employees(tenant_id, id) ON DELETE RESTRICT,
      FOREIGN KEY (tenant_id, workflow_instance_id)
        REFERENCES workflow_instances(tenant_id, id) ON DELETE SET NULL (workflow_instance_id),
      FOREIGN KEY (tenant_id, created_by)
        REFERENCES users(tenant_id, id) ON DELETE SET NULL (created_by),
      FOREIGN KEY (tenant_id, updated_by)
        REFERENCES users(tenant_id, id) ON DELETE SET NULL (updated_by),
      CONSTRAINT workforce_overtime_estimated_check CHECK (estimated_hours > 0),
      CONSTRAINT workforce_overtime_actual_check
        CHECK (actual_hours IS NULL OR actual_hours >= 0),
      UNIQUE (tenant_id, request_number)
    );

    ALTER TABLE workforce_overtime_requests
      ADD CONSTRAINT workforce_overtime_requests_tenant_id_id_unique UNIQUE (tenant_id, id);
    CREATE INDEX idx_workforce_overtime_employee
      ON workforce_overtime_requests (employee_id, overtime_date DESC);
    CREATE INDEX idx_workforce_overtime_tenant
      ON workforce_overtime_requests (tenant_id, overtime_date DESC);
    CREATE INDEX idx_workforce_overtime_workflow
      ON workforce_overtime_requests (workflow_instance_id);

    -- === Payroll, BPJS & PPh 21 (HR-ADV-005) ================================
    --
    -- Statutory parameters are effective-dated DATA, never code constants:
    -- a regulation change is a new policy row, not a deployment. Rates are
    -- numeric(9,6) fractions (0.040000 = 4%); PTKP amounts and PPh 21
    -- progressive brackets are JSONB so the shape can evolve per country
    -- without a schema migration.

    CREATE TABLE workforce_statutory_policies (
      id                              UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id                       UUID          NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      policy_code                     TEXT          NOT NULL,
      name                            TEXT          NOT NULL,
      country_code                    TEXT          NOT NULL DEFAULT 'ID',
      effective_from                  DATE          NOT NULL,
      effective_to                    DATE,
      bpjs_kesehatan_rate_employer    NUMERIC(9,6)  NOT NULL DEFAULT 0,
      bpjs_kesehatan_rate_employee    NUMERIC(9,6)  NOT NULL DEFAULT 0,
      bpjs_kesehatan_cap              NUMERIC(15,2),
      bpjs_tk_jht_rate_employer       NUMERIC(9,6)  NOT NULL DEFAULT 0,
      bpjs_tk_jht_rate_employee       NUMERIC(9,6)  NOT NULL DEFAULT 0,
      bpjs_tk_jkk_rate                NUMERIC(9,6)  NOT NULL DEFAULT 0,
      bpjs_tk_jkm_rate                NUMERIC(9,6)  NOT NULL DEFAULT 0,
      bpjs_tk_jp_rate_employer        NUMERIC(9,6)  NOT NULL DEFAULT 0,
      bpjs_tk_jp_rate_employee        NUMERIC(9,6)  NOT NULL DEFAULT 0,
      bpjs_tk_jp_cap                  NUMERIC(15,2),
      occupational_cost_rate          NUMERIC(9,6)  NOT NULL DEFAULT 0,
      occupational_cost_monthly_cap   NUMERIC(15,2),
      ptkp_annual_amounts             JSONB         NOT NULL DEFAULT '{}'::jsonb,
      pph21_brackets                  JSONB         NOT NULL DEFAULT '[]'::jsonb,
      pph21_ter_brackets              JSONB         NOT NULL DEFAULT '[]'::jsonb,
      non_npwp_surcharge_rate         NUMERIC(9,6)  NOT NULL DEFAULT 0,
      pph21_method                    TEXT          NOT NULL DEFAULT 'annualized',
      rounding_mode                   TEXT          NOT NULL DEFAULT 'half_up',
      is_active                       BOOLEAN       NOT NULL DEFAULT true,
      created_at                      TIMESTAMPTZ   NOT NULL DEFAULT now(),
      created_by                      UUID,
      updated_at                      TIMESTAMPTZ   NOT NULL DEFAULT now(),
      updated_by                      UUID,

      FOREIGN KEY (tenant_id, created_by)
        REFERENCES users(tenant_id, id) ON DELETE SET NULL (created_by),
      FOREIGN KEY (tenant_id, updated_by)
        REFERENCES users(tenant_id, id) ON DELETE SET NULL (updated_by),
      CONSTRAINT workforce_statutory_method_check
        CHECK (pph21_method IN ('annualized', 'ter')),
      CONSTRAINT workforce_statutory_rounding_check
        CHECK (rounding_mode IN ('half_up', 'down', 'up')),
      CONSTRAINT workforce_statutory_effective_check
        CHECK (effective_to IS NULL OR effective_to >= effective_from),
      UNIQUE (tenant_id, policy_code, effective_from)
    );

    ALTER TABLE workforce_statutory_policies
      ADD CONSTRAINT workforce_statutory_policies_tenant_id_id_unique UNIQUE (tenant_id, id);
    CREATE INDEX idx_workforce_statutory_effective
      ON workforce_statutory_policies (tenant_id, effective_from DESC) WHERE is_active;

    CREATE TABLE workforce_employee_salary_profiles (
      id                     UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id              UUID          NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      employee_id            UUID          NOT NULL,
      base_salary            NUMERIC(15,2) NOT NULL DEFAULT 0,
      fixed_allowance        NUMERIC(15,2) NOT NULL DEFAULT 0,
      overtime_hourly_rate   NUMERIC(15,2),
      ptkp_status            TEXT          NOT NULL DEFAULT 'TK/0',
      has_npwp               BOOLEAN       NOT NULL DEFAULT false,
      bpjs_kesehatan_number  TEXT,
      bpjs_tk_number         TEXT,
      bank_name              TEXT,
      bank_account_number    TEXT,
      effective_from         DATE          NOT NULL,
      effective_to           DATE,
      created_at             TIMESTAMPTZ   NOT NULL DEFAULT now(),
      created_by             UUID,
      updated_at             TIMESTAMPTZ   NOT NULL DEFAULT now(),
      updated_by             UUID,

      FOREIGN KEY (tenant_id, employee_id)
        REFERENCES employees(tenant_id, id) ON DELETE CASCADE,
      FOREIGN KEY (tenant_id, created_by)
        REFERENCES users(tenant_id, id) ON DELETE SET NULL (created_by),
      FOREIGN KEY (tenant_id, updated_by)
        REFERENCES users(tenant_id, id) ON DELETE SET NULL (updated_by),
      CONSTRAINT workforce_salary_profile_amounts_check
        CHECK (base_salary >= 0 AND fixed_allowance >= 0),
      CONSTRAINT workforce_salary_profile_ptkp_check
        CHECK (ptkp_status IN ('TK/0','TK/1','TK/2','TK/3','K/0','K/1','K/2','K/3')),
      CONSTRAINT workforce_salary_profile_effective_check
        CHECK (effective_to IS NULL OR effective_to >= effective_from),
      UNIQUE (tenant_id, employee_id, effective_from)
    );

    ALTER TABLE workforce_employee_salary_profiles
      ADD CONSTRAINT workforce_employee_salary_profiles_tenant_id_id_unique UNIQUE (tenant_id, id);
    -- At most one OPEN salary profile per employee; closed history is free.
    CREATE UNIQUE INDEX uq_workforce_salary_profile_open
      ON workforce_employee_salary_profiles (tenant_id, employee_id)
      WHERE effective_to IS NULL;
    CREATE INDEX idx_workforce_salary_profile_employee
      ON workforce_employee_salary_profiles (employee_id, effective_from DESC);

    CREATE TABLE workforce_payroll_runs (
      id                            UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id                     UUID          NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      run_number                    TEXT          NOT NULL,
      period_month                  INTEGER       NOT NULL,
      period_year                   INTEGER       NOT NULL,
      organization_unit_id          UUID,
      statutory_policy_id           UUID,
      workflow_instance_id          UUID,
      employee_count                INTEGER       NOT NULL DEFAULT 0,
      total_gross                   NUMERIC(18,2) NOT NULL DEFAULT 0,
      total_deductions              NUMERIC(18,2) NOT NULL DEFAULT 0,
      total_net                     NUMERIC(18,2) NOT NULL DEFAULT 0,
      total_employer_contributions  NUMERIC(18,2) NOT NULL DEFAULT 0,
      calculated_at                 TIMESTAMPTZ,
      approved_at                   TIMESTAMPTZ,
      closed_at                     TIMESTAMPTZ,
      created_at                    TIMESTAMPTZ   NOT NULL DEFAULT now(),
      created_by                    UUID,
      updated_at                    TIMESTAMPTZ   NOT NULL DEFAULT now(),
      updated_by                    UUID,

      FOREIGN KEY (tenant_id, organization_unit_id)
        REFERENCES organization_units(tenant_id, id) ON DELETE SET NULL (organization_unit_id),
      FOREIGN KEY (tenant_id, statutory_policy_id)
        REFERENCES workforce_statutory_policies(tenant_id, id) ON DELETE RESTRICT,
      FOREIGN KEY (tenant_id, workflow_instance_id)
        REFERENCES workflow_instances(tenant_id, id) ON DELETE SET NULL (workflow_instance_id),
      FOREIGN KEY (tenant_id, created_by)
        REFERENCES users(tenant_id, id) ON DELETE SET NULL (created_by),
      FOREIGN KEY (tenant_id, updated_by)
        REFERENCES users(tenant_id, id) ON DELETE SET NULL (updated_by),
      CONSTRAINT workforce_payroll_runs_month_check CHECK (period_month BETWEEN 1 AND 12),
      CONSTRAINT workforce_payroll_runs_year_check CHECK (period_year BETWEEN 1900 AND 2999),
      UNIQUE (tenant_id, run_number)
    );

    ALTER TABLE workforce_payroll_runs
      ADD CONSTRAINT workforce_payroll_runs_tenant_id_id_unique UNIQUE (tenant_id, id);
    CREATE INDEX idx_workforce_payroll_runs_period
      ON workforce_payroll_runs (tenant_id, period_year DESC, period_month DESC);
    CREATE INDEX idx_workforce_payroll_runs_workflow
      ON workforce_payroll_runs (workflow_instance_id);

    CREATE TABLE workforce_payslips (
      id                        UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id                 UUID          NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      payroll_run_id            UUID          NOT NULL,
      employee_id               UUID          NOT NULL,
      base_salary               NUMERIC(15,2) NOT NULL DEFAULT 0,
      allowances                NUMERIC(15,2) NOT NULL DEFAULT 0,
      overtime_hours            NUMERIC(8,2)  NOT NULL DEFAULT 0,
      overtime_pay              NUMERIC(15,2) NOT NULL DEFAULT 0,
      gross_salary              NUMERIC(15,2) NOT NULL DEFAULT 0,
      bpjs_kesehatan_employee   NUMERIC(15,2) NOT NULL DEFAULT 0,
      bpjs_kesehatan_employer   NUMERIC(15,2) NOT NULL DEFAULT 0,
      bpjs_tk_jht_employee      NUMERIC(15,2) NOT NULL DEFAULT 0,
      bpjs_tk_jht_employer      NUMERIC(15,2) NOT NULL DEFAULT 0,
      bpjs_tk_jkk_employer      NUMERIC(15,2) NOT NULL DEFAULT 0,
      bpjs_tk_jkm_employer      NUMERIC(15,2) NOT NULL DEFAULT 0,
      bpjs_tk_jp_employee       NUMERIC(15,2) NOT NULL DEFAULT 0,
      bpjs_tk_jp_employer       NUMERIC(15,2) NOT NULL DEFAULT 0,
      pph21_withheld            NUMERIC(15,2) NOT NULL DEFAULT 0,
      other_deductions          NUMERIC(15,2) NOT NULL DEFAULT 0,
      total_deductions          NUMERIC(15,2) NOT NULL DEFAULT 0,
      employer_contributions    NUMERIC(15,2) NOT NULL DEFAULT 0,
      net_salary                NUMERIC(15,2) NOT NULL DEFAULT 0,
      ptkp_status               TEXT,
      calculation_breakdown     JSONB         NOT NULL DEFAULT '{}'::jsonb,
      created_at                TIMESTAMPTZ   NOT NULL DEFAULT now(),

      FOREIGN KEY (tenant_id, payroll_run_id)
        REFERENCES workforce_payroll_runs(tenant_id, id) ON DELETE CASCADE,
      FOREIGN KEY (tenant_id, employee_id)
        REFERENCES employees(tenant_id, id) ON DELETE RESTRICT,
      -- One payslip per employee per run: recalculation replaces, never duplicates.
      UNIQUE (tenant_id, payroll_run_id, employee_id)
    );

    ALTER TABLE workforce_payslips
      ADD CONSTRAINT workforce_payslips_tenant_id_id_unique UNIQUE (tenant_id, id);
    CREATE INDEX idx_workforce_payslips_run
      ON workforce_payslips (payroll_run_id);
    CREATE INDEX idx_workforce_payslips_employee
      ON workforce_payslips (employee_id, created_at DESC);

    -- === Recruitment (HR-ADV-006) ===========================================

    CREATE TABLE workforce_job_postings (
      id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id             UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      posting_code          TEXT        NOT NULL,
      title                 TEXT        NOT NULL,
      position_id           UUID,
      organization_unit_id  UUID,
      headcount_target      INTEGER     NOT NULL DEFAULT 1,
      employment_type       TEXT,
      job_description       TEXT,
      status                TEXT        NOT NULL DEFAULT 'draft',
      workflow_instance_id  UUID,
      published_at          TIMESTAMPTZ,
      closed_at             TIMESTAMPTZ,
      created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
      created_by            UUID,
      updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_by            UUID,

      FOREIGN KEY (tenant_id, position_id)
        REFERENCES positions(tenant_id, id) ON DELETE SET NULL (position_id),
      FOREIGN KEY (tenant_id, organization_unit_id)
        REFERENCES organization_units(tenant_id, id) ON DELETE SET NULL (organization_unit_id),
      FOREIGN KEY (tenant_id, workflow_instance_id)
        REFERENCES workflow_instances(tenant_id, id) ON DELETE SET NULL (workflow_instance_id),
      FOREIGN KEY (tenant_id, created_by)
        REFERENCES users(tenant_id, id) ON DELETE SET NULL (created_by),
      FOREIGN KEY (tenant_id, updated_by)
        REFERENCES users(tenant_id, id) ON DELETE SET NULL (updated_by),
      CONSTRAINT workforce_job_postings_status_check
        CHECK (status IN ('draft', 'published', 'closed', 'cancelled')),
      CONSTRAINT workforce_job_postings_headcount_check CHECK (headcount_target > 0),
      UNIQUE (tenant_id, posting_code)
    );

    ALTER TABLE workforce_job_postings
      ADD CONSTRAINT workforce_job_postings_tenant_id_id_unique UNIQUE (tenant_id, id);
    CREATE INDEX idx_workforce_job_postings_tenant
      ON workforce_job_postings (tenant_id, created_at DESC);
    CREATE INDEX idx_workforce_job_postings_status
      ON workforce_job_postings (tenant_id, status);

    CREATE TABLE workforce_job_applications (
      id                   UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id            UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      job_posting_id       UUID        NOT NULL,
      candidate_name       TEXT        NOT NULL,
      candidate_email      TEXT,
      candidate_phone      TEXT,
      resume_document_id   UUID,
      stage                TEXT        NOT NULL DEFAULT 'applied',
      rating               INTEGER,
      interviewer_notes    TEXT,
      hired_employee_id    UUID,
      applied_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
      decided_at           TIMESTAMPTZ,
      created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
      created_by           UUID,
      updated_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_by           UUID,

      FOREIGN KEY (tenant_id, job_posting_id)
        REFERENCES workforce_job_postings(tenant_id, id) ON DELETE CASCADE,
      FOREIGN KEY (tenant_id, hired_employee_id)
        REFERENCES employees(tenant_id, id) ON DELETE SET NULL (hired_employee_id),
      FOREIGN KEY (tenant_id, created_by)
        REFERENCES users(tenant_id, id) ON DELETE SET NULL (created_by),
      FOREIGN KEY (tenant_id, updated_by)
        REFERENCES users(tenant_id, id) ON DELETE SET NULL (updated_by),
      CONSTRAINT workforce_job_applications_stage_check
        CHECK (stage IN ('applied', 'screening', 'interview', 'offer', 'hired', 'rejected', 'withdrawn')),
      CONSTRAINT workforce_job_applications_rating_check
        CHECK (rating IS NULL OR rating BETWEEN 1 AND 5)
    );

    ALTER TABLE workforce_job_applications
      ADD CONSTRAINT workforce_job_applications_tenant_id_id_unique UNIQUE (tenant_id, id);
    CREATE INDEX idx_workforce_job_applications_posting
      ON workforce_job_applications (job_posting_id, applied_at DESC);
    CREATE INDEX idx_workforce_job_applications_stage
      ON workforce_job_applications (tenant_id, stage);

    -- === Competency, Training, Performance & Career (HR-ADV-007, HR-ADV-008)

    CREATE TABLE workforce_competencies (
      id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id    UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      code         TEXT        NOT NULL,
      name         TEXT        NOT NULL,
      category     TEXT,
      description  TEXT,
      scale_min    INTEGER     NOT NULL DEFAULT 1,
      scale_max    INTEGER     NOT NULL DEFAULT 5,
      is_active    BOOLEAN     NOT NULL DEFAULT true,
      created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
      created_by   UUID,
      updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_by   UUID,

      FOREIGN KEY (tenant_id, created_by)
        REFERENCES users(tenant_id, id) ON DELETE SET NULL (created_by),
      FOREIGN KEY (tenant_id, updated_by)
        REFERENCES users(tenant_id, id) ON DELETE SET NULL (updated_by),
      CONSTRAINT workforce_competencies_scale_check CHECK (scale_max > scale_min),
      UNIQUE (tenant_id, code)
    );

    ALTER TABLE workforce_competencies
      ADD CONSTRAINT workforce_competencies_tenant_id_id_unique UNIQUE (tenant_id, id);
    CREATE INDEX idx_workforce_competencies_tenant
      ON workforce_competencies (tenant_id) WHERE is_active;

    CREATE TABLE workforce_employee_competencies (
      id                   UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id            UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      employee_id          UUID        NOT NULL,
      competency_id        UUID        NOT NULL,
      proficiency_level    INTEGER     NOT NULL,
      last_assessed_date   DATE,
      assessed_by_user_id  UUID,
      notes                TEXT,
      created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at           TIMESTAMPTZ NOT NULL DEFAULT now(),

      FOREIGN KEY (tenant_id, employee_id)
        REFERENCES employees(tenant_id, id) ON DELETE CASCADE,
      FOREIGN KEY (tenant_id, competency_id)
        REFERENCES workforce_competencies(tenant_id, id) ON DELETE CASCADE,
      FOREIGN KEY (tenant_id, assessed_by_user_id)
        REFERENCES users(tenant_id, id) ON DELETE SET NULL (assessed_by_user_id),
      CONSTRAINT workforce_employee_competencies_level_check CHECK (proficiency_level >= 0),
      UNIQUE (tenant_id, employee_id, competency_id)
    );

    ALTER TABLE workforce_employee_competencies
      ADD CONSTRAINT workforce_employee_competencies_tenant_id_id_unique UNIQUE (tenant_id, id);
    CREATE INDEX idx_workforce_employee_competencies_employee
      ON workforce_employee_competencies (employee_id);
    CREATE INDEX idx_workforce_employee_competencies_competency
      ON workforce_employee_competencies (competency_id);

    CREATE TABLE workforce_training_courses (
      id              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id       UUID         NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      course_code     TEXT         NOT NULL,
      title           TEXT         NOT NULL,
      provider        TEXT,
      duration_hours  NUMERIC(8,2) NOT NULL DEFAULT 0,
      competency_id   UUID,
      description     TEXT,
      is_active       BOOLEAN      NOT NULL DEFAULT true,
      created_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),
      created_by      UUID,
      updated_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),
      updated_by      UUID,

      FOREIGN KEY (tenant_id, competency_id)
        REFERENCES workforce_competencies(tenant_id, id) ON DELETE SET NULL (competency_id),
      FOREIGN KEY (tenant_id, created_by)
        REFERENCES users(tenant_id, id) ON DELETE SET NULL (created_by),
      FOREIGN KEY (tenant_id, updated_by)
        REFERENCES users(tenant_id, id) ON DELETE SET NULL (updated_by),
      CONSTRAINT workforce_training_courses_duration_check CHECK (duration_hours >= 0),
      UNIQUE (tenant_id, course_code)
    );

    ALTER TABLE workforce_training_courses
      ADD CONSTRAINT workforce_training_courses_tenant_id_id_unique UNIQUE (tenant_id, id);
    CREATE INDEX idx_workforce_training_courses_tenant
      ON workforce_training_courses (tenant_id) WHERE is_active;

    CREATE TABLE workforce_training_enrollments (
      id                       UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id                UUID         NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      training_course_id       UUID         NOT NULL,
      employee_id              UUID         NOT NULL,
      status                   TEXT         NOT NULL DEFAULT 'enrolled',
      enrolled_at              TIMESTAMPTZ  NOT NULL DEFAULT now(),
      completion_date          DATE,
      score                    NUMERIC(6,2),
      certificate_document_id  UUID,
      notes                    TEXT,
      created_at               TIMESTAMPTZ  NOT NULL DEFAULT now(),
      created_by               UUID,
      updated_at               TIMESTAMPTZ  NOT NULL DEFAULT now(),
      updated_by               UUID,

      FOREIGN KEY (tenant_id, training_course_id)
        REFERENCES workforce_training_courses(tenant_id, id) ON DELETE CASCADE,
      FOREIGN KEY (tenant_id, employee_id)
        REFERENCES employees(tenant_id, id) ON DELETE CASCADE,
      FOREIGN KEY (tenant_id, created_by)
        REFERENCES users(tenant_id, id) ON DELETE SET NULL (created_by),
      FOREIGN KEY (tenant_id, updated_by)
        REFERENCES users(tenant_id, id) ON DELETE SET NULL (updated_by),
      CONSTRAINT workforce_training_enrollments_status_check
        CHECK (status IN ('enrolled', 'in_progress', 'completed', 'failed', 'cancelled')),
      CONSTRAINT workforce_training_enrollments_score_check
        CHECK (score IS NULL OR score >= 0),
      UNIQUE (tenant_id, training_course_id, employee_id)
    );

    ALTER TABLE workforce_training_enrollments
      ADD CONSTRAINT workforce_training_enrollments_tenant_id_id_unique UNIQUE (tenant_id, id);
    CREATE INDEX idx_workforce_training_enrollments_course
      ON workforce_training_enrollments (training_course_id);
    CREATE INDEX idx_workforce_training_enrollments_employee
      ON workforce_training_enrollments (employee_id, enrolled_at DESC);

    CREATE TABLE workforce_performance_reviews (
      id                    UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id             UUID         NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      review_code           TEXT         NOT NULL,
      employee_id           UUID         NOT NULL,
      period_start          DATE         NOT NULL,
      period_end            DATE         NOT NULL,
      reviewer_user_id      UUID,
      goals_score           NUMERIC(5,2),
      competency_score      NUMERIC(5,2),
      overall_rating        NUMERIC(5,2),
      review_notes          TEXT,
      development_plan      TEXT,
      workflow_instance_id  UUID,
      submitted_at          TIMESTAMPTZ,
      finalized_at          TIMESTAMPTZ,
      created_at            TIMESTAMPTZ  NOT NULL DEFAULT now(),
      created_by            UUID,
      updated_at            TIMESTAMPTZ  NOT NULL DEFAULT now(),
      updated_by            UUID,

      FOREIGN KEY (tenant_id, employee_id)
        REFERENCES employees(tenant_id, id) ON DELETE CASCADE,
      FOREIGN KEY (tenant_id, reviewer_user_id)
        REFERENCES users(tenant_id, id) ON DELETE SET NULL (reviewer_user_id),
      FOREIGN KEY (tenant_id, workflow_instance_id)
        REFERENCES workflow_instances(tenant_id, id) ON DELETE SET NULL (workflow_instance_id),
      FOREIGN KEY (tenant_id, created_by)
        REFERENCES users(tenant_id, id) ON DELETE SET NULL (created_by),
      FOREIGN KEY (tenant_id, updated_by)
        REFERENCES users(tenant_id, id) ON DELETE SET NULL (updated_by),
      CONSTRAINT workforce_performance_reviews_period_check CHECK (period_end >= period_start),
      UNIQUE (tenant_id, review_code)
    );

    ALTER TABLE workforce_performance_reviews
      ADD CONSTRAINT workforce_performance_reviews_tenant_id_id_unique UNIQUE (tenant_id, id);
    CREATE INDEX idx_workforce_performance_reviews_employee
      ON workforce_performance_reviews (employee_id, period_end DESC);
    CREATE INDEX idx_workforce_performance_reviews_tenant
      ON workforce_performance_reviews (tenant_id, period_end DESC);
    CREATE INDEX idx_workforce_performance_reviews_workflow
      ON workforce_performance_reviews (workflow_instance_id);

    CREATE TABLE workforce_career_paths (
      id                       UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id                UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      from_position_id         UUID        NOT NULL,
      to_position_id           UUID        NOT NULL,
      required_tenure_months   INTEGER     NOT NULL DEFAULT 0,
      required_competency_ids  JSONB       NOT NULL DEFAULT '[]'::jsonb,
      guidelines               TEXT,
      is_active                BOOLEAN     NOT NULL DEFAULT true,
      created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
      created_by               UUID,
      updated_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_by               UUID,

      FOREIGN KEY (tenant_id, from_position_id)
        REFERENCES positions(tenant_id, id) ON DELETE CASCADE,
      FOREIGN KEY (tenant_id, to_position_id)
        REFERENCES positions(tenant_id, id) ON DELETE CASCADE,
      FOREIGN KEY (tenant_id, created_by)
        REFERENCES users(tenant_id, id) ON DELETE SET NULL (created_by),
      FOREIGN KEY (tenant_id, updated_by)
        REFERENCES users(tenant_id, id) ON DELETE SET NULL (updated_by),
      CONSTRAINT workforce_career_paths_distinct_check CHECK (from_position_id <> to_position_id),
      CONSTRAINT workforce_career_paths_tenure_check CHECK (required_tenure_months >= 0),
      UNIQUE (tenant_id, from_position_id, to_position_id)
    );

    ALTER TABLE workforce_career_paths
      ADD CONSTRAINT workforce_career_paths_tenant_id_id_unique UNIQUE (tenant_id, id);
    CREATE INDEX idx_workforce_career_paths_from
      ON workforce_career_paths (from_position_id) WHERE is_active;

    -- === Manpower Planning (HR-ADV-009) =====================================
    --
    -- Advisory only. Applying a plan records the decision and freezes the
    -- projection; it never creates, mutates, or terminates employee records.

    CREATE TABLE workforce_manpower_plans (
      id                        UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id                 UUID          NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      plan_number               TEXT          NOT NULL,
      plan_year                 INTEGER       NOT NULL,
      organization_unit_id      UUID,
      title                     TEXT          NOT NULL,
      status                    TEXT          NOT NULL DEFAULT 'draft',
      parameters                JSONB         NOT NULL DEFAULT '{}'::jsonb,
      current_headcount         INTEGER       NOT NULL DEFAULT 0,
      planned_headcount         INTEGER       NOT NULL DEFAULT 0,
      variance_headcount        INTEGER       NOT NULL DEFAULT 0,
      current_cost_projection   NUMERIC(18,2) NOT NULL DEFAULT 0,
      planned_cost_projection   NUMERIC(18,2) NOT NULL DEFAULT 0,
      variance_cost_projection  NUMERIC(18,2) NOT NULL DEFAULT 0,
      gap_analysis              JSONB         NOT NULL DEFAULT '[]'::jsonb,
      computed_at               TIMESTAMPTZ,
      applied_at                TIMESTAMPTZ,
      applied_by                UUID,
      created_at                TIMESTAMPTZ   NOT NULL DEFAULT now(),
      created_by                UUID,
      updated_at                TIMESTAMPTZ   NOT NULL DEFAULT now(),
      updated_by                UUID,

      FOREIGN KEY (tenant_id, organization_unit_id)
        REFERENCES organization_units(tenant_id, id) ON DELETE SET NULL (organization_unit_id),
      FOREIGN KEY (tenant_id, applied_by)
        REFERENCES users(tenant_id, id) ON DELETE SET NULL (applied_by),
      FOREIGN KEY (tenant_id, created_by)
        REFERENCES users(tenant_id, id) ON DELETE SET NULL (created_by),
      FOREIGN KEY (tenant_id, updated_by)
        REFERENCES users(tenant_id, id) ON DELETE SET NULL (updated_by),
      CONSTRAINT workforce_manpower_plans_status_check
        CHECK (status IN ('draft', 'computed', 'applied', 'dismissed')),
      CONSTRAINT workforce_manpower_plans_year_check
        CHECK (plan_year BETWEEN 1900 AND 2999),
      UNIQUE (tenant_id, plan_number)
    );

    ALTER TABLE workforce_manpower_plans
      ADD CONSTRAINT workforce_manpower_plans_tenant_id_id_unique UNIQUE (tenant_id, id);
    CREATE INDEX idx_workforce_manpower_plans_tenant
      ON workforce_manpower_plans (tenant_id, plan_year DESC);
    CREATE INDEX idx_workforce_manpower_plans_org_unit
      ON workforce_manpower_plans (organization_unit_id, plan_year DESC);

    -- === Permissions ========================================================
    --
    -- Bounded on purpose: payroll and leave approval are separated from their
    -- read/manage counterparts so preparing a payroll run never implies the
    -- authority to approve it (segregation of duties).

    INSERT INTO permissions (code, description) VALUES
      ('workforce.attendance.read',    'View shifts, rosters, and attendance records'),
      ('workforce.attendance.manage',  'Maintain shifts, rosters, and attendance records'),
      ('workforce.leave.read',         'View leave types, balances, leave requests, and overtime requests'),
      ('workforce.leave.manage',       'Maintain leave types, balances, and submit leave/overtime requests'),
      ('workforce.leave.approve',      'Act on leave and overtime approval assignments'),
      ('workforce.payroll.read',       'View statutory policies, salary profiles, payroll runs, and payslips'),
      ('workforce.payroll.manage',     'Maintain statutory policies, salary profiles, and calculate payroll runs'),
      ('workforce.payroll.approve',    'Act on payroll run approval assignments and close payroll periods'),
      ('workforce.recruitment.read',   'View job postings and candidate applications'),
      ('workforce.recruitment.manage', 'Maintain job postings and progress candidate applications'),
      ('workforce.performance.read',   'View competencies, training, performance reviews, and career paths'),
      ('workforce.performance.manage', 'Maintain competencies, training, performance reviews, and career paths'),
      ('workforce.planning.read',      'View manpower plans and headcount/cost gap analysis'),
      ('workforce.planning.manage',    'Create and compute manpower planning scenarios'),
      ('workforce.planning.apply',     'Apply or dismiss advisory manpower planning outcomes')
    ON CONFLICT (code) DO NOTHING;
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    -- Drop in reverse dependency order.

    DELETE FROM permissions WHERE code IN (
      'workforce.attendance.read',
      'workforce.attendance.manage',
      'workforce.leave.read',
      'workforce.leave.manage',
      'workforce.leave.approve',
      'workforce.payroll.read',
      'workforce.payroll.manage',
      'workforce.payroll.approve',
      'workforce.recruitment.read',
      'workforce.recruitment.manage',
      'workforce.performance.read',
      'workforce.performance.manage',
      'workforce.planning.read',
      'workforce.planning.manage',
      'workforce.planning.apply'
    );

    DROP TABLE IF EXISTS workforce_manpower_plans;
    DROP TABLE IF EXISTS workforce_career_paths;
    DROP TABLE IF EXISTS workforce_performance_reviews;
    DROP TABLE IF EXISTS workforce_training_enrollments;
    DROP TABLE IF EXISTS workforce_training_courses;
    DROP TABLE IF EXISTS workforce_employee_competencies;
    DROP TABLE IF EXISTS workforce_competencies;
    DROP TABLE IF EXISTS workforce_job_applications;
    DROP TABLE IF EXISTS workforce_job_postings;
    DROP TABLE IF EXISTS workforce_payslips;
    DROP TABLE IF EXISTS workforce_payroll_runs;
    DROP TABLE IF EXISTS workforce_employee_salary_profiles;
    DROP TABLE IF EXISTS workforce_statutory_policies;
    DROP TABLE IF EXISTS workforce_overtime_requests;
    DROP TABLE IF EXISTS workforce_leave_requests;
    DROP TABLE IF EXISTS workforce_leave_balances;
    DROP TABLE IF EXISTS workforce_leave_types;
    DROP TABLE IF EXISTS workforce_attendance_records;
    DROP TABLE IF EXISTS workforce_rosters;
    DROP TABLE IF EXISTS workforce_shifts;

    ALTER TABLE positions DROP CONSTRAINT IF EXISTS positions_tenant_id_id_unique;
    ALTER TABLE employees DROP CONSTRAINT IF EXISTS employees_tenant_id_id_unique;
  `);
};
