/**
 * Epic 1 Wave 1 (CORE-ROADMAP.md §4.1 A) — the Role, assignment and hierarchy
 * columns the approval-authority half of the epic reads.
 *
 * Every column mirrors one verified iDempiere field:
 *
 * - `roles.amt_approval`            <- AD_Role.AmtApproval (line 210): the
 *   per-Role approval limit. NULL means the Role carries no monetary
 *   authority at all, which is exactly how `MWFActivity.getApprovalUser`
 *   treats a null/zero role amount (`:769-770` — role skipped).
 * - `roles.amt_approval_accum`      <- AD_Role.AmtApprovalAccum (line 223),
 *   `roles.days_approval_accum` <- AD_Role.DaysApprovalAccum (line 281):
 *   accumulation window. Both must be > 0 for the window to apply, matching
 *   the `:786-798` guard.
 * - `roles.currency_code`           <- AD_Role.C_Currency_ID (line 236): the
 *   currency the limit is expressed in. ISO-4217 alpha code because the
 *   product has no currency dictionary yet; `quotation` and the finance
 *   kernel already carry `currencyCode` strings.
 * - `roles.is_can_approve_own_doc`  <- AD_Role.IsCanApproveOwnDoc (line 342).
 *   Default FALSE so no existing Role silently gains self-approval the day
 *   this column lands — separation of duties is the safe failure mode.
 * - `roles.is_manual`, `roles.is_access_all_orgs`, `roles.user_level` <-
 *   AD_Role.IsManual (425), IsAccessAllOrgs (316) and UserLevel: carried for
 *   contract completeness; Epic 1 does not enforce them (no whitelist engine,
 *   no org-access short-circuit yet). Storing them now keeps the later waves
 *   additive instead of another ALTER.
 * - `user_role_assignments.is_read_only` <- AD_Role_OrgAccess.IsReadOnly:
 *   read-only per scope, on the assignment row because scope lives there.
 * - `users.supervisor_user_id`          <- AD_User.Supervisor_ID (I_AD_User
 *   line 825), `organization_units.supervisor_user_id` <-
 *   AD_OrgInfo.Supervisor_ID (I_AD_OrgInfo line 286): the two escalation
 *   rungs `MWFActivity.getApprovalUser` walks (`:807-822`).
 *
 * Money discipline: `numeric(18,2)`, matching every other money column in
 * the product (1767000000000). Amounts stay strings in TypeScript; the
 * comparison math runs on scaled integers, never binary floats.
 *
 * No permission, no dictionary row, no grant is written — this is pure
 * schema. Down migration drops the columns; no data loss beyond the columns
 * themselves, which no other object depends on yet.
 */
exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE roles
      ADD COLUMN is_manual BOOLEAN NOT NULL DEFAULT false,
      ADD COLUMN is_can_approve_own_doc BOOLEAN NOT NULL DEFAULT false,
      ADD COLUMN amt_approval NUMERIC(18,2),
      ADD COLUMN amt_approval_accum NUMERIC(18,2),
      ADD COLUMN days_approval_accum INTEGER,
      ADD COLUMN currency_code VARCHAR(3),
      ADD COLUMN is_access_all_orgs BOOLEAN NOT NULL DEFAULT false,
      ADD COLUMN user_level VARCHAR(20);

    -- Accumulation only applies when BOTH the amount and the window are
    -- positive, mirroring the getApprovalUser guard: one-sided configuration
    -- must not create a window that silently never or always fires.
    ALTER TABLE roles
      ADD CONSTRAINT roles_approval_accum_check CHECK (
        (amt_approval_accum IS NULL AND days_approval_accum IS NULL)
        OR (amt_approval_accum > 0 AND days_approval_accum > 0)
      );

    ALTER TABLE user_role_assignments
      ADD COLUMN is_read_only BOOLEAN NOT NULL DEFAULT false;

    -- Self-reference: a supervisor is a User of the same tenant in normal
    -- operation, but the product has no cross-tenant supervisor concept, so
    -- the FK is plain user-scoped and ON DELETE SET NULL: deleting a user
    -- must not take their subordinates' escalation chain down with it.
    ALTER TABLE users
      ADD COLUMN supervisor_user_id UUID REFERENCES users(id) ON DELETE SET NULL;

    ALTER TABLE organization_units
      ADD COLUMN supervisor_user_id UUID REFERENCES users(id) ON DELETE SET NULL;
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    ALTER TABLE organization_units DROP COLUMN IF EXISTS supervisor_user_id;
    ALTER TABLE users DROP COLUMN IF EXISTS supervisor_user_id;
    ALTER TABLE user_role_assignments DROP COLUMN IF EXISTS is_read_only;
    ALTER TABLE roles
      DROP CONSTRAINT IF EXISTS roles_approval_accum_check;
    ALTER TABLE roles
      DROP COLUMN IF EXISTS user_level,
      DROP COLUMN IF EXISTS is_access_all_orgs,
      DROP COLUMN IF EXISTS currency_code,
      DROP COLUMN IF EXISTS days_approval_accum,
      DROP COLUMN IF EXISTS amt_approval_accum,
      DROP COLUMN IF EXISTS amt_approval,
      DROP COLUMN IF EXISTS is_can_approve_own_doc,
      DROP COLUMN IF EXISTS is_manual;
  `);
};
