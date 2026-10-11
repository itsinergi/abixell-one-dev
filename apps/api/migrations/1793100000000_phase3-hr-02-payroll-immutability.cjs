/**
 * WP-HR-02 — Payroll run/payslip database-hard immutability.
 *
 * RSK-003: payroll integrity must not depend on a service being the only
 * writer. The same posture as `trg_scm_payment_batch_immutable`
 * (1792000000012) is applied to the payroll tables: once a run is approved its
 * money facts are frozen, and once it is closed the run cannot be reopened or
 * deleted at all. Payslips follow their parent run — a payslip of an approved
 * run is frozen too, so the detail can never drift away from the frozen
 * totals.
 *
 * The first transition is deliberately allowed: approving moves `approved_at`
 * from NULL to a value (OLD is NULL, so the guard does not fire), and closing
 * moves `closed_at` from NULL to a value. Everything after that is blocked.
 *
 * ON DELETE CASCADE from the run to its payslips still works: the cascade
 * deletes the parent first, so the payslip guard's parent lookup finds nothing
 * and lets the delete through for unlocked runs.
 */
exports.up = (pgm) => {
  pgm.sql(`
    CREATE OR REPLACE FUNCTION workforce_reject_locked_payroll_run_changes()
    RETURNS trigger AS $$
    BEGIN
      IF TG_OP = 'DELETE' THEN
        IF OLD.approved_at IS NOT NULL OR OLD.closed_at IS NOT NULL THEN
          RAISE EXCEPTION 'Locked payroll run % cannot be deleted', OLD.run_number;
        END IF;
        RETURN OLD;
      END IF;

      -- Money and identity facts freeze the moment the run is approved.
      IF OLD.approved_at IS NOT NULL AND (
        OLD.run_number IS DISTINCT FROM NEW.run_number OR
        OLD.period_month IS DISTINCT FROM NEW.period_month OR
        OLD.period_year IS DISTINCT FROM NEW.period_year OR
        OLD.organization_unit_id IS DISTINCT FROM NEW.organization_unit_id OR
        OLD.statutory_policy_id IS DISTINCT FROM NEW.statutory_policy_id OR
        OLD.employee_count IS DISTINCT FROM NEW.employee_count OR
        OLD.total_gross IS DISTINCT FROM NEW.total_gross OR
        OLD.total_deductions IS DISTINCT FROM NEW.total_deductions OR
        OLD.total_net IS DISTINCT FROM NEW.total_net OR
        OLD.total_employer_contributions IS DISTINCT FROM NEW.total_employer_contributions OR
        OLD.approved_at IS DISTINCT FROM NEW.approved_at
      ) THEN
        RAISE EXCEPTION 'Approved payroll run % facts cannot be changed', OLD.run_number;
      END IF;

      -- Closing is final: the close stamp itself can never move.
      IF OLD.closed_at IS NOT NULL AND OLD.closed_at IS DISTINCT FROM NEW.closed_at THEN
        RAISE EXCEPTION 'Closed payroll run % cannot be reopened', OLD.run_number;
      END IF;

      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;

    DROP TRIGGER IF EXISTS trg_workforce_payroll_run_immutable
      ON workforce_payroll_runs;
    CREATE TRIGGER trg_workforce_payroll_run_immutable
      BEFORE UPDATE OR DELETE ON workforce_payroll_runs
      FOR EACH ROW EXECUTE FUNCTION workforce_reject_locked_payroll_run_changes();

    CREATE OR REPLACE FUNCTION workforce_reject_locked_payslip_changes()
    RETURNS trigger AS $$
    BEGIN
      IF EXISTS (
        SELECT 1 FROM workforce_payroll_runs r
        WHERE r.tenant_id = OLD.tenant_id
          AND r.id = OLD.payroll_run_id
          AND r.approved_at IS NOT NULL
      ) THEN
        RAISE EXCEPTION 'Payslips of an approved payroll run cannot be changed';
      END IF;

      IF TG_OP = 'DELETE' THEN
        RETURN OLD;
      END IF;
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;

    DROP TRIGGER IF EXISTS trg_workforce_payslip_immutable
      ON workforce_payslips;
    CREATE TRIGGER trg_workforce_payslip_immutable
      BEFORE UPDATE OR DELETE ON workforce_payslips
      FOR EACH ROW EXECUTE FUNCTION workforce_reject_locked_payslip_changes();
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    DROP TRIGGER IF EXISTS trg_workforce_payslip_immutable
      ON workforce_payslips;
    DROP FUNCTION IF EXISTS workforce_reject_locked_payslip_changes();

    DROP TRIGGER IF EXISTS trg_workforce_payroll_run_immutable
      ON workforce_payroll_runs;
    DROP FUNCTION IF EXISTS workforce_reject_locked_payroll_run_changes();
  `);
};
