/**
 * Epic 4 Wave 3 — manual assignment revocation (CORE-ROADMAP.md §4.4,
 * Gelombang 3 step 17).
 *
 * `scope_invalidated_at` (1775000000000) answers a SYSTEM question: the role
 * or scope target no longer resolves, so the grant is inert. It deliberately
 * carries no actor or reason, and callers cannot distinguish which condition
 * fired. Wave 3 adds a separate OPERATOR lifecycle: an administrator revoking
 * access by hand. Three columns record when, who, and why, the row is
 * retained (step 18), and the authorization-effective view excludes it
 * (step 19) so the next permission check loses the grant without logout.
 *
 * The exact-assignment unique index (1774000000000) is rebuilt as a partial
 * index over live rows only. Before this migration every row was live
 * (removal was a hard DELETE), so the rebuild is data-neutral, but afterwards
 * a revoked pair may be granted again as a fresh decision with its own
 * history row — exactly what "revoke preserves history" requires.
 *
 * `enforce_role_assignment_scope_invalidation` is replaced to make
 * `revoked_at` monotonic the same way `scope_invalidated_at` is: revocation
 * cannot be silently undone by an UPDATE, and a revoked row skips the
 * availability re-check entirely (its access is already inert).
 */
exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.sql(`
    -- Same exclusive lifecycle-table window and lock order as
    -- 1775000000000, so the view/trigger swap cannot interleave with a
    -- concurrent scope move or governed write.
    LOCK TABLE users,
               roles,
               organization_units,
               customers,
               user_role_assignments
      IN ACCESS EXCLUSIVE MODE;

    -- revoked_by deliberately carries NO foreign key, matching created_by:
    -- provenance is a historical fact and must survive the eventual deletion
    -- of the Operator's User row. A FK here would also make the tenant-cascade
    -- cleanup path fail on a retained revocation.
    ALTER TABLE user_role_assignments
      ADD COLUMN revoked_at timestamptz,
      ADD COLUMN revoked_by uuid,
      ADD COLUMN revoke_reason text;

    -- Rebuild the exact-assignment key over live rows only. All existing rows
    -- are live (removal was DELETE-only until now), so no duplicate can arise
    -- from the switch itself; the guard below proves it before the swap.
    DO $$
    BEGIN
      IF EXISTS (
        SELECT 1
          FROM user_role_assignments
         GROUP BY user_id,
                  role_id,
                  scope_type,
                  scope_organization_unit_id,
                  scope_customer_id
        HAVING COUNT(*) > 1
      ) THEN
        RAISE EXCEPTION
          'Cannot install Epic 4 Wave 3: duplicate user role assignments exist';
      END IF;
    END $$;

    DROP INDEX user_role_assignments_exact_assignment_unique;

    CREATE UNIQUE INDEX user_role_assignments_exact_assignment_unique
      ON user_role_assignments
         (user_id, role_id, scope_type, scope_organization_unit_id, scope_customer_id)
      NULLS NOT DISTINCT
      WHERE revoked_at IS NULL
        AND scope_invalidated_at IS NULL;

    -- Revocation is monotonic, and a revoked row needs no availability
    -- re-check: the grant is inert either way.
    CREATE OR REPLACE FUNCTION enforce_role_assignment_scope_invalidation()
    RETURNS trigger
    LANGUAGE plpgsql
    AS $$
    DECLARE
      user_tenant_id uuid;
      role_tenant_id uuid;
      assignment_available boolean := false;
      target_available boolean := true;
    BEGIN
      -- Invalidation is monotonic. Restoring or moving a target back, or
      -- rewriting an assignment, cannot silently revive access once revoked.
      IF TG_OP = 'UPDATE' AND OLD.scope_invalidated_at IS NOT NULL THEN
        NEW.scope_invalidated_at := OLD.scope_invalidated_at;
      END IF;

      -- Revocation is monotonic the same way, and its provenance (who, why)
      -- is part of the retained history: an UPDATE may not erase or rewrite
      -- it. A fresh grant of the same pair is a NEW row, never a revival.
      IF TG_OP = 'UPDATE' AND OLD.revoked_at IS NOT NULL THEN
        NEW.revoked_at := OLD.revoked_at;
        NEW.revoked_by := OLD.revoked_by;
        NEW.revoke_reason := OLD.revoke_reason;
      END IF;

      IF NEW.scope_invalidated_at IS NOT NULL OR NEW.revoked_at IS NOT NULL THEN
        RETURN NEW;
      END IF;

      -- Lock both ownership endpoints even when their tenants do not match.
      -- Concurrent User/Role tenant moves therefore either happen first and
      -- are observed here, or happen afterward and their lifecycle trigger
      -- stamps this assignment before the move commits.
      SELECT u.tenant_id, r.tenant_id
        INTO user_tenant_id, role_tenant_id
        FROM users u
        CROSS JOIN roles r
       WHERE u.id = NEW.user_id
         AND r.id = NEW.role_id
         FOR SHARE OF u, r;
      assignment_available := FOUND AND user_tenant_id = role_tenant_id;

      IF NEW.scope_type = 'organization_unit' THEN
        PERFORM 1
          FROM organization_units ou
         WHERE ou.id = NEW.scope_organization_unit_id
           AND ou.tenant_id = user_tenant_id
           AND ou.deleted_at IS NULL
           FOR SHARE OF ou;
        target_available := FOUND;
      ELSIF NEW.scope_type = 'customer' THEN
        PERFORM 1
          FROM customers c
         WHERE c.id = NEW.scope_customer_id
           AND c.tenant_id = user_tenant_id
           AND c.deleted_at IS NULL
           FOR SHARE OF c;
        target_available := FOUND;
      END IF;

      IF NOT assignment_available OR NOT target_available THEN
        NEW.scope_invalidated_at := statement_timestamp();
      END IF;

      RETURN NEW;
    END;
    $$;

    -- Step 19 — the single authorization projection now excludes manually
    -- revoked rows too. Same composition as 1775000000000 plus the revoked
    -- predicate; revocation columns are not selected because a revoked row
    -- never passes the filter.
    DROP VIEW authorization_effective_user_role_assignments;

    CREATE VIEW authorization_effective_user_role_assignments AS
      SELECT ura.id,
             ura.user_id,
             ura.role_id,
             ura.scope_type,
             ura.scope_organization_unit_id,
             ura.scope_customer_id,
             ura.scope_invalidated_at,
             ura.created_by,
             ura.created_at,
             u.tenant_id
        FROM user_role_assignments ura
        JOIN users u
          ON u.id = ura.user_id
         AND u.deleted_at IS NULL
         AND u.status = 'active'
        JOIN roles r
          ON r.id = ura.role_id
         AND r.tenant_id = u.tenant_id
        LEFT JOIN organization_units ou
          ON ou.id = ura.scope_organization_unit_id
         AND ou.tenant_id = u.tenant_id
         AND ou.deleted_at IS NULL
        LEFT JOIN customers c
          ON c.id = ura.scope_customer_id
         AND c.tenant_id = u.tenant_id
         AND c.deleted_at IS NULL
       WHERE ura.scope_invalidated_at IS NULL
         AND ura.revoked_at IS NULL
         AND (
           (
             ura.scope_type = 'tenant'
             AND ura.scope_organization_unit_id IS NULL
             AND ura.scope_customer_id IS NULL
           )
           OR (
             ura.scope_type = 'organization_unit'
             AND ura.scope_organization_unit_id IS NOT NULL
             AND ura.scope_customer_id IS NULL
             AND ou.id IS NOT NULL
           )
           OR (
             ura.scope_type = 'customer'
             AND ura.scope_customer_id IS NOT NULL
             AND ura.scope_organization_unit_id IS NULL
             AND c.id IS NOT NULL
           )
         );
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    -- Same exclusive lifecycle-table window and lock order as up().
    LOCK TABLE users,
               roles,
               organization_units,
               customers,
               user_role_assignments
      IN ACCESS EXCLUSIVE MODE;

    -- Retained revocation history must never disappear while a row depends
    -- on it. Reconcile or re-grant explicitly before rolling back.
    DO $$
    BEGIN
      IF EXISTS (
        SELECT 1
          FROM user_role_assignments
         WHERE revoked_at IS NOT NULL
      ) THEN
        RAISE EXCEPTION
          'Cannot roll back Epic 4 Wave 3 while retained revoked role assignments exist';
      END IF;
    END $$;

    DROP VIEW IF EXISTS authorization_effective_user_role_assignments;

    CREATE VIEW authorization_effective_user_role_assignments AS
      SELECT ura.id,
             ura.user_id,
             ura.role_id,
             ura.scope_type,
             ura.scope_organization_unit_id,
             ura.scope_customer_id,
             ura.scope_invalidated_at,
             ura.created_by,
             ura.created_at,
             u.tenant_id
        FROM user_role_assignments ura
        JOIN users u
          ON u.id = ura.user_id
         AND u.deleted_at IS NULL
         AND u.status = 'active'
        JOIN roles r
          ON r.id = ura.role_id
         AND r.tenant_id = u.tenant_id
        LEFT JOIN organization_units ou
          ON ou.id = ura.scope_organization_unit_id
         AND ou.tenant_id = u.tenant_id
         AND ou.deleted_at IS NULL
        LEFT JOIN customers c
          ON c.id = ura.scope_customer_id
         AND c.tenant_id = u.tenant_id
         AND c.deleted_at IS NULL
       WHERE ura.scope_invalidated_at IS NULL
         AND (
           (
             ura.scope_type = 'tenant'
             AND ura.scope_organization_unit_id IS NULL
             AND ura.scope_customer_id IS NULL
           )
           OR (
             ura.scope_type = 'organization_unit'
             AND ura.scope_organization_unit_id IS NOT NULL
             AND ura.scope_customer_id IS NULL
             AND ou.id IS NOT NULL
           )
           OR (
             ura.scope_type = 'customer'
             AND ura.scope_customer_id IS NOT NULL
             AND ura.scope_organization_unit_id IS NULL
             AND c.id IS NOT NULL
           )
         );

    -- Restore the pre-Wave-3 trigger body (no revocation branch).
    CREATE OR REPLACE FUNCTION enforce_role_assignment_scope_invalidation()
    RETURNS trigger
    LANGUAGE plpgsql
    AS $$
    DECLARE
      user_tenant_id uuid;
      role_tenant_id uuid;
      assignment_available boolean := false;
      target_available boolean := true;
    BEGIN
      IF TG_OP = 'UPDATE' AND OLD.scope_invalidated_at IS NOT NULL THEN
        NEW.scope_invalidated_at := OLD.scope_invalidated_at;
      END IF;

      IF NEW.scope_invalidated_at IS NOT NULL THEN
        RETURN NEW;
      END IF;

      SELECT u.tenant_id, r.tenant_id
        INTO user_tenant_id, role_tenant_id
        FROM users u
        CROSS JOIN roles r
       WHERE u.id = NEW.user_id
         AND r.id = NEW.role_id
         FOR SHARE OF u, r;
      assignment_available := FOUND AND user_tenant_id = role_tenant_id;

      IF NEW.scope_type = 'organization_unit' THEN
        PERFORM 1
          FROM organization_units ou
         WHERE ou.id = NEW.scope_organization_unit_id
           AND ou.tenant_id = user_tenant_id
           AND ou.deleted_at IS NULL
           FOR SHARE OF ou;
        target_available := FOUND;
      ELSIF NEW.scope_type = 'customer' THEN
        PERFORM 1
          FROM customers c
         WHERE c.id = NEW.scope_customer_id
           AND c.tenant_id = user_tenant_id
           AND c.deleted_at IS NULL
           FOR SHARE OF c;
        target_available := FOUND;
      END IF;

      IF NOT assignment_available OR NOT target_available THEN
        NEW.scope_invalidated_at := statement_timestamp();
      END IF;

      RETURN NEW;
    END;
    $$;

    -- Back to the full (non-partial) exact-assignment key. The revoked-rows
    -- guard above proves every row is live, so the full index can be rebuilt
    -- without a duplicate check.
    DROP INDEX user_role_assignments_exact_assignment_unique;

    CREATE UNIQUE INDEX user_role_assignments_exact_assignment_unique
      ON user_role_assignments
         (user_id, role_id, scope_type, scope_organization_unit_id, scope_customer_id)
      NULLS NOT DISTINCT;

    ALTER TABLE user_role_assignments
      DROP COLUMN IF EXISTS revoked_at,
      DROP COLUMN IF EXISTS revoked_by,
      DROP COLUMN IF EXISTS revoke_reason;
  `);
};
