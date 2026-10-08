/**
 * Phase 1E — Accounting Kernel — Period Reopen (WP-FIN-03, Epic 14 §4.14)
 *
 * Makes a closed period reopenable only through a maker-checker flow, and
 * closes the DB-level hole that let a raw UPDATE flip a closed period back to
 * open without any recorded approval.
 *
 * Epic 14 §4.14 (verbatim): "Pembukaan ulang periode yang sudah tutup adalah
 * alur maker-checker tersendiri: pengaju dan penyetuju harus dua orang
 * berbeda, alasan wajib, bukti dampak wajib, dan seluruh jejaknya append-only.
 * Super Admin tidak punya jalan pintas yang melewati alur ini."
 *
 * Pieces:
 *   1. Reopen-trail columns on `accounting_periods` (requester, approver,
 *      rejecter + their timestamps and the impact evidence). The request date
 *      and reason already exist from Phase 1A (1792000000000).
 *   2. `check_period_not_locked()` widened to refuse postings to a period in
 *      `closed` OR `reopenable` (a pending-reopen period must still fail
 *      closed: "Periode tertutup gagal secara tertutup").
 *   3. `guard_period_reopen()` — a BEFORE UPDATE trigger that refuses a
 *      transition to `open` from any status other than `draft` unless a
 *      `reopen_approved_by` is being stamped in the same statement. This is
 *      what makes "Super Admin tidak punya jalan pintas" true at the storage
 *      layer, not merely in the service.
 *   4. Three API-resource dictionary rows for the new reopen routes, following
 *      the Phase 1D rename-chain pattern (1792000000005).
 *
 * POL-FIN-001 ACTIVE (Financial Control — Accounting Kernel).
 * POL-FIN-ADDENDUM-001 ACTIVE (Debit/credit invariant).
 * POL-FIN-ADDENDUM-002 ACTIVE (Tenant discipline).
 */

exports.shorthands = undefined;

const NEW_API_RESOURCES = `
        ('api:POST /accounting/periods/:id/reopen', 'finance', 'POST', '/accounting/periods/:id/reopen'),
        ('api:POST /accounting/periods/:id/reopen/approve', 'finance', 'POST', '/accounting/periods/:id/reopen/approve'),
        ('api:POST /accounting/periods/:id/reopen/reject', 'finance', 'POST', '/accounting/periods/:id/reopen/reject')
`;

exports.up = (pgm) => {
  // 1. Reopen-trail columns ------------------------------------------------
  pgm.sql(`
    ALTER TABLE accounting_periods
      ADD COLUMN IF NOT EXISTS reopen_requested_by uuid
        REFERENCES users(id) ON DELETE SET NULL,
      ADD COLUMN IF NOT EXISTS reopen_impact_evidence text,
      ADD COLUMN IF NOT EXISTS reopen_approved_by uuid
        REFERENCES users(id) ON DELETE SET NULL,
      ADD COLUMN IF NOT EXISTS reopen_approved_date timestamptz,
      ADD COLUMN IF NOT EXISTS reopen_rejected_by uuid
        REFERENCES users(id) ON DELETE SET NULL,
      ADD COLUMN IF NOT EXISTS reopen_rejected_date timestamptz,
      ADD COLUMN IF NOT EXISTS reopen_reject_reason text;
  `);

  // 2. Widen the posting guard: `closed` AND `reopenable` both refuse ------
  pgm.sql(`
    CREATE OR REPLACE FUNCTION check_period_not_locked()
    RETURNS TRIGGER AS $$
    BEGIN
      IF EXISTS (
        SELECT 1 FROM accounting_periods
          WHERE id = NEW.period_id
            AND status IN ('closed', 'reopenable')
      ) THEN
        RAISE EXCEPTION 'Cannot post to a non-open accounting period (period_id=%)', NEW.period_id
          USING ERRCODE = 'check_violation';
      END IF;
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;
  `);

  // 3. Guard the reopen transition itself ----------------------------------
  //    A period may only become `open` from a fresh `draft`, or when the same
  //    UPDATE stamps a NEW approver (`IS DISTINCT FROM` — a stale
  //    `reopen_approved_by` left over from an earlier cycle does NOT count).
  //    The service writes `reopen_approved_by` only after the maker-checker
  //    SoD check passes, so no status-only UPDATE (by a Super Admin or
  //    otherwise) can bypass the flow.
  pgm.sql(`
    CREATE OR REPLACE FUNCTION guard_period_reopen()
    RETURNS TRIGGER AS $$
    BEGIN
      IF NEW.status = 'open'
         AND OLD.status <> 'open'
         AND OLD.status <> 'draft'
         AND (NEW.reopen_approved_by IS NULL
              OR NEW.reopen_approved_by IS NOT DISTINCT FROM OLD.reopen_approved_by
              OR NEW.reopen_approved_by IS NOT DISTINCT FROM OLD.reopen_requested_by) THEN
        RAISE EXCEPTION 'Cannot reopen a period without a recorded maker-checker approval (period_id=%)', NEW.id
          USING ERRCODE = 'check_violation';
      END IF;
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;

    DROP TRIGGER IF EXISTS guard_period_reopen ON accounting_periods;
    CREATE TRIGGER guard_period_reopen
      BEFORE UPDATE ON accounting_periods
      FOR EACH ROW EXECUTE FUNCTION guard_period_reopen();
  `);

  // 4. Extend the API-resource dictionary seed -----------------------------
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
         WHERE p.proname = 'config_dictionary_api_resource_seed_phase1d'
           AND n.nspname = current_schema()
      ) THEN
        ALTER FUNCTION config_dictionary_api_resource_seed()
          RENAME TO config_dictionary_api_resource_seed_phase1d;
      END IF;
    END
    $$;

    CREATE OR REPLACE FUNCTION config_dictionary_api_resource_seed()
    RETURNS TABLE (code TEXT, name TEXT, module_code TEXT, http_method TEXT, path_pattern TEXT) AS $seed$
      SELECT s.code, s.name, s.module_code, s.http_method, s.path_pattern
        FROM config_dictionary_api_resource_seed_phase1d() s
      UNION
      SELECT a.code, a.http_method || ' ' || a.path_pattern, a.module_code, a.http_method, a.path_pattern
        FROM (VALUES
          ${NEW_API_RESOURCES}
        ) AS a(code, module_code, http_method, path_pattern);
    $seed$ LANGUAGE sql IMMUTABLE;

    INSERT INTO app_api_resources (tenant_id, code, name, module_code, http_method, path_pattern)
    SELECT t.id, a.code, a.http_method || ' ' || a.path_pattern, a.module_code, a.http_method, a.path_pattern
      FROM tenants t
      CROSS JOIN (VALUES
        ${NEW_API_RESOURCES}
      ) AS a(code, module_code, http_method, path_pattern)
    ON CONFLICT (tenant_id, code) DO NOTHING;
  `);
};

exports.down = (pgm) => {
  // Remove the reopen routes from app_api_resources
  pgm.sql(`
    DELETE FROM app_api_resources
     WHERE code IN (
       SELECT a.code FROM (VALUES
         ${NEW_API_RESOURCES}
       ) AS a(code, module_code, http_method, path_pattern)
     );

    -- Restore the Phase 1D seed function as canonical
    DROP FUNCTION IF EXISTS config_dictionary_api_resource_seed();

    ALTER FUNCTION config_dictionary_api_resource_seed_phase1d()
      RENAME TO config_dictionary_api_resource_seed;
  `);

  // Drop the reopen-transition guard
  pgm.sql(`
    DROP TRIGGER IF EXISTS guard_period_reopen ON accounting_periods;
    DROP FUNCTION IF EXISTS guard_period_reopen();
  `);

  // Restore the narrower (closed-only) posting guard from Phase 1B
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

  // Refuse to drop the reopen trail while reopen records exist: the columns
  // carry the maker-checker audit trail (who asked, who approved, evidence,
  // rejection), and dropping them would destroy it irreversibly.
  pgm.sql(`
    DO $$
    BEGIN
      IF EXISTS (
        SELECT 1 FROM accounting_periods
         WHERE status = 'reopenable'
            OR reopen_requested_by IS NOT NULL
            OR reopen_approved_by IS NOT NULL
            OR reopen_rejected_by IS NOT NULL
      ) THEN
        RAISE EXCEPTION
          'Cannot roll back Phase 1E period reopen: reopen records exist. Resolve them explicitly first.';
      END IF;
    END
    $$;
  `);

  pgm.sql(`
    ALTER TABLE accounting_periods
      DROP COLUMN IF EXISTS reopen_reject_reason,
      DROP COLUMN IF EXISTS reopen_rejected_date,
      DROP COLUMN IF EXISTS reopen_rejected_by,
      DROP COLUMN IF EXISTS reopen_approved_date,
      DROP COLUMN IF EXISTS reopen_approved_by,
      DROP COLUMN IF EXISTS reopen_impact_evidence,
      DROP COLUMN IF EXISTS reopen_requested_by;
  `);
};