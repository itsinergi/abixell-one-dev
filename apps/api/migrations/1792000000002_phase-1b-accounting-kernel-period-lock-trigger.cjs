/**
 * Phase 1B — Accounting Kernel — Period lock trigger & workflow column
 *
 * Defense-in-depth enforcement of the closed-period invariant:
 *   - A trigger on `general_ledger_entries` refuses INSERT when the
 *     referenced period has status = 'closed'.
 *   - A trigger on `journal_headers` refuses INSERT when the referenced
 *     period has status = 'closed' (prevents draft creation in a closed
 *     period).
 *
 * The application layer also checks (ConflictError) — both deliberate per A4.
 *
 * Adds a nullable `workflow_instance_id` column to `accounting_periods` so a
 * maker-checker period-lock workflow can stamp the instance that governs the
 * reopen decision (Phase 1B SoD). The column is nullable and has no impact on
 * the tenant-owned classification of `accounting_periods` (direct `tenant_id`
 * ownership established in Phase 1A migration 1792000000000).
 *
 * POL-FIN-001 ACTIVE (Financial Control — Accounting Kernel).
 * POL-FIN-ADDENDUM-002 ACTIVE (Tenant discipline).
 */

exports.shorthands = undefined;

exports.up = (pgm) => {
  // 1. Workflow instance linkage column -------------------------------
  pgm.sql(`
    ALTER TABLE accounting_periods
      ADD COLUMN IF NOT EXISTS workflow_instance_id uuid
        REFERENCES workflow_instances(id) ON DELETE SET NULL;
  `);

  // 2. Trigger function: prevent posting to a closed period -----------
  pgm.sql(`
    CREATE OR REPLACE FUNCTION check_period_not_locked()
    RETURNS TRIGGER AS $$
    BEGIN
      IF EXISTS (
        SELECT 1 FROM accounting_periods
          WHERE id = NEW.period_id
            AND status = 'closed'
      ) THEN
        RAISE EXCEPTION 'Cannot post to a closed accounting period (period_id=%)', NEW.period_id
          USING ERRCODE = 'check_violation';
      END IF;
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;
  `);

  // 3. Trigger: GL entries cannot be inserted for a closed period -----
  pgm.sql(`
    DROP TRIGGER IF EXISTS prevent_posting_to_locked_period ON general_ledger_entries;
    CREATE TRIGGER prevent_posting_to_locked_period
      BEFORE INSERT ON general_ledger_entries
      FOR EACH ROW
      EXECUTE FUNCTION check_period_not_locked();
  `);

  // 4. Trigger: journal headers cannot be created against a closed period
  pgm.sql(`
    DROP TRIGGER IF EXISTS prevent_journal_in_closed_period ON journal_headers;
    CREATE TRIGGER prevent_journal_in_closed_period
      BEFORE INSERT ON journal_headers
      FOR EACH ROW
      EXECUTE FUNCTION check_period_not_locked();
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    DROP TRIGGER IF EXISTS prevent_journal_in_closed_period ON journal_headers;
    DROP TRIGGER IF EXISTS prevent_posting_to_locked_period ON general_ledger_entries;
    DROP FUNCTION IF EXISTS check_period_not_locked();
    ALTER TABLE accounting_periods DROP COLUMN IF EXISTS workflow_instance_id;
  `);
};
