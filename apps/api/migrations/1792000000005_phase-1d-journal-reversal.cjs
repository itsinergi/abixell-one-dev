/**
 * Phase 1D — Accounting Kernel — Journal Reversal (WP-FIN-02)
 *
 * Adds reversals of posted journals as linked entries (ADR-0016 §2/§3):
 * never edit/delete posted facts; a correction is a new journal pointing
 * back to the original via `reversal_of_id`.
 *
 * Two reversal modes (Epic 14 §4.14):
 *   - reverse_correct: original date, original period (fails if period closed)
 *   - reverse_accrual: running date, next open period (deferred into open/future)
 *
 * Adds columns to `journal_headers`:
 *   - reversal_reason: motivation (reason code, memo, etc.)
 *   - reversal_type: "reverse_correct" | "reverse_accrual"
 *   - reversed_by: operator who triggered the reversal (FK users)
 *
 * Extends the API-resource dictionary to 14 routes following the Phase 1B
 * pattern (rename prior seed function, UNION-extend, backfill).
 *
 * POL-FIN-001 ACTIVE (Financial Control — Accounting Kernel).
 * POL-FIN-ADDENDUM-001 ACTIVE (Debit/credit invariant).
 */

exports.shorthands = undefined;

const NEW_API_RESOURCE = `
        ('api:POST /accounting/journals/:id/reverse', 'finance', 'POST', '/accounting/journals/:id/reverse')
`;

exports.up = (pgm) => {
  // 1. Add reversal metadata columns to journal_headers ----------------------
  pgm.sql(`
    ALTER TABLE journal_headers
      ADD COLUMN IF NOT EXISTS reversal_reason text,
      ADD COLUMN IF NOT EXISTS reversal_type text
        CHECK (reversal_type IS NULL OR reversal_type IN ('reverse_correct', 'reverse_accrual')),
      ADD COLUMN IF NOT EXISTS reversed_by uuid
        REFERENCES users(id) ON DELETE SET NULL;
  `);

  // 1b. Enforce the one-time-reversal invariant at the schema level: at most
  //     one live (pending/posted) reversal child may exist per original journal.
  //     Also serves as the supporting index for the repository's existence check.
  pgm.sql(`
    CREATE UNIQUE INDEX IF NOT EXISTS journal_headers_one_live_reversal_idx
      ON journal_headers (tenant_id, reversal_of_id)
      WHERE reversal_of_id IS NOT NULL AND status IN ('pending', 'posted');
  `);

  // 2. Extend API-resource dictionary seed ------------------------------------
  //    Keep Phase 1C under its own name; canonical defined as UNION.
  pgm.sql(`
    DO $$
    BEGIN
      IF EXISTS (
        SELECT 1 FROM pg_proc p
          JOIN pg_namespace n ON n.oid = p.pronamespace
         WHERE p.proname = 'config_dictionary_api_resource_seed'
           AND n.nspname = current_schema()
      ) AND NOT EXISTS (
        SELECT 1 FROM pg_proc p
          JOIN pg_namespace n ON n.oid = p.pronamespace
         WHERE p.proname = 'config_dictionary_api_resource_seed_phase1c'
           AND n.nspname = current_schema()
      ) THEN
        ALTER FUNCTION config_dictionary_api_resource_seed()
          RENAME TO config_dictionary_api_resource_seed_phase1c;
      END IF;
    END
    $$;

    CREATE OR REPLACE FUNCTION config_dictionary_api_resource_seed()
    RETURNS TABLE (code TEXT, name TEXT, module_code TEXT, http_method TEXT, path_pattern TEXT) AS $seed$
      SELECT s.code, s.name, s.module_code, s.http_method, s.path_pattern
        FROM config_dictionary_api_resource_seed_phase1c() s
      UNION
      SELECT a.code, a.http_method || ' ' || a.path_pattern, a.module_code, a.http_method, a.path_pattern
        FROM (VALUES
          ${NEW_API_RESOURCE}
        ) AS a(code, module_code, http_method, path_pattern);
    $seed$ LANGUAGE sql IMMUTABLE;

    INSERT INTO app_api_resources (tenant_id, code, name, module_code, http_method, path_pattern)
    SELECT t.id, a.code, a.http_method || ' ' || a.path_pattern, a.module_code, a.http_method, a.path_pattern
      FROM tenants t
      CROSS JOIN (VALUES
        ${NEW_API_RESOURCE}
      ) AS a(code, module_code, http_method, path_pattern)
    ON CONFLICT (tenant_id, code) DO NOTHING;
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    -- Delete the Phase 1D route from app_api_resources
    DELETE FROM app_api_resources
     WHERE code IN (
       SELECT a.code FROM (VALUES
         ${NEW_API_RESOURCE}
       ) AS a(code, module_code, http_method, path_pattern)
     );

    -- Restore Phase 1C seed function as canonical
    DROP FUNCTION IF EXISTS config_dictionary_api_resource_seed();

    ALTER FUNCTION config_dictionary_api_resource_seed_phase1c()
      RENAME TO config_dictionary_api_resource_seed;
  `);

  pgm.sql(`
    DROP INDEX IF EXISTS journal_headers_one_live_reversal_idx;
  `);

  // Refuse to drop reversal metadata while reversal records exist: the
  // columns carry the audit trail (reason, mode, operator) for linked
  // corrections, and dropping them would destroy it irreversibly.
  pgm.sql(`
    DO $$
    BEGIN
      IF EXISTS (
        SELECT 1 FROM journal_headers
         WHERE reversal_of_id IS NOT NULL
            OR reversal_reason IS NOT NULL
            OR reversal_type IS NOT NULL
            OR reversed_by IS NOT NULL
            OR status = 'reversed'
      ) THEN
        RAISE EXCEPTION
          'Cannot roll back Phase 1D journal reversal: reversal records exist. Archive or reverse them explicitly first.';
      END IF;
    END
    $$;
  `);

  pgm.sql(`
    ALTER TABLE journal_headers
      DROP COLUMN IF EXISTS reversed_by,
      DROP COLUMN IF EXISTS reversal_type,
      DROP COLUMN IF EXISTS reversal_reason;
  `);
};
