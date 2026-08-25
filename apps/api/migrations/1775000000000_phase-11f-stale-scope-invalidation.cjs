exports.up = (pgm) => {
  pgm.sql(`
    -- Install the lifecycle projection inside one exclusive migration window.
    -- The lock order is shared with down(): lifecycle owners first, retained
    -- assignments last. It prevents a target move/delete from committing after
    -- the backfill inspected its assignment but before the matching trigger is
    -- installed. ACCESS EXCLUSIVE is intentional for this short DDL migration.
    LOCK TABLE users,
               roles,
               organization_units,
               customers,
               user_role_assignments
      IN ACCESS EXCLUSIVE MODE;

    ALTER TABLE user_role_assignments
      ADD COLUMN scope_invalidated_at timestamptz;

    -- Retain legacy assignments for administrative reconciliation, but make
    -- every assignment whose Role or scope is already unavailable to its User
    -- permanently authorization-inert. The reason is deliberately not
    -- persisted: callers must not be able to distinguish deleted, missing,
    -- foreign, moved, restored, or otherwise unresolved targets.
    UPDATE user_role_assignments ura
       SET scope_invalidated_at = statement_timestamp()
      FROM users u
     WHERE u.id = ura.user_id
       AND ura.scope_invalidated_at IS NULL
       AND (
         NOT EXISTS (
           SELECT 1
             FROM roles r
            WHERE r.id = ura.role_id
              AND r.tenant_id = u.tenant_id
         )
         OR (
           ura.scope_type = 'organization_unit'
           AND NOT EXISTS (
             SELECT 1
               FROM organization_units ou
              WHERE ou.id = ura.scope_organization_unit_id
                AND ou.tenant_id = u.tenant_id
                AND ou.deleted_at IS NULL
           )
         )
         OR (
           ura.scope_type = 'customer'
           AND NOT EXISTS (
             SELECT 1
               FROM customers c
              WHERE c.id = ura.scope_customer_id
                AND c.tenant_id = u.tenant_id
                AND c.deleted_at IS NULL
           )
         )
       );

    CREATE INDEX user_role_assignments_live_role_idx
      ON user_role_assignments (role_id)
      WHERE scope_invalidated_at IS NULL;

    CREATE INDEX user_role_assignments_live_organization_unit_scope_idx
      ON user_role_assignments (scope_organization_unit_id)
      WHERE scope_type = 'organization_unit'
        AND scope_invalidated_at IS NULL;

    CREATE INDEX user_role_assignments_live_customer_scope_idx
      ON user_role_assignments (scope_customer_id)
      WHERE scope_type = 'customer'
        AND scope_invalidated_at IS NULL;

    CREATE FUNCTION enforce_role_assignment_scope_invalidation()
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

      IF NEW.scope_invalidated_at IS NOT NULL THEN
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

    CREATE TRIGGER user_role_assignments_scope_invalidation_guard
      BEFORE INSERT OR UPDATE ON user_role_assignments
      FOR EACH ROW
      EXECUTE FUNCTION enforce_role_assignment_scope_invalidation();

    CREATE FUNCTION invalidate_organization_unit_role_assignments()
    RETURNS trigger
    LANGUAGE plpgsql
    AS $$
    BEGIN
      IF (
        OLD.deleted_at IS DISTINCT FROM NEW.deleted_at
        OR OLD.tenant_id IS DISTINCT FROM NEW.tenant_id
      ) THEN
        UPDATE user_role_assignments
           SET scope_invalidated_at = statement_timestamp()
         WHERE scope_type = 'organization_unit'
           AND scope_organization_unit_id = NEW.id
           AND scope_invalidated_at IS NULL;
      END IF;
      RETURN NEW;
    END;
    $$;

    CREATE TRIGGER organization_units_role_assignment_invalidation
      AFTER UPDATE OF deleted_at, tenant_id ON organization_units
      FOR EACH ROW
      EXECUTE FUNCTION invalidate_organization_unit_role_assignments();

    CREATE FUNCTION invalidate_customer_role_assignments()
    RETURNS trigger
    LANGUAGE plpgsql
    AS $$
    BEGIN
      IF (
        OLD.deleted_at IS DISTINCT FROM NEW.deleted_at
        OR OLD.tenant_id IS DISTINCT FROM NEW.tenant_id
      ) THEN
        UPDATE user_role_assignments
           SET scope_invalidated_at = statement_timestamp()
         WHERE scope_type = 'customer'
           AND scope_customer_id = NEW.id
           AND scope_invalidated_at IS NULL;
      END IF;
      RETURN NEW;
    END;
    $$;

    CREATE TRIGGER customers_role_assignment_invalidation
      AFTER UPDATE OF deleted_at, tenant_id ON customers
      FOR EACH ROW
      EXECUTE FUNCTION invalidate_customer_role_assignments();

    CREATE FUNCTION invalidate_user_tenant_role_assignments()
    RETURNS trigger
    LANGUAGE plpgsql
    AS $$
    BEGIN
      IF OLD.tenant_id IS DISTINCT FROM NEW.tenant_id THEN
        UPDATE user_role_assignments
           SET scope_invalidated_at = statement_timestamp()
         WHERE user_id = NEW.id
           AND scope_invalidated_at IS NULL;
      END IF;
      RETURN NEW;
    END;
    $$;

    CREATE TRIGGER users_role_assignment_tenant_invalidation
      AFTER UPDATE OF tenant_id ON users
      FOR EACH ROW
      EXECUTE FUNCTION invalidate_user_tenant_role_assignments();

    CREATE FUNCTION invalidate_role_tenant_role_assignments()
    RETURNS trigger
    LANGUAGE plpgsql
    AS $$
    BEGIN
      IF OLD.tenant_id IS DISTINCT FROM NEW.tenant_id THEN
        UPDATE user_role_assignments
           SET scope_invalidated_at = statement_timestamp()
         WHERE role_id = NEW.id
           AND scope_invalidated_at IS NULL;
      END IF;
      RETURN NEW;
    END;
    $$;

    CREATE TRIGGER roles_role_assignment_tenant_invalidation
      AFTER UPDATE OF tenant_id ON roles
      FOR EACH ROW
      EXECUTE FUNCTION invalidate_role_tenant_role_assignments();

    -- This is the single database-level authorization projection. Admin reads
    -- intentionally use the base table so unavailable rows remain visible and
    -- removable; all grant/scope readers use this view instead.
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
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    -- Use the same exclusive lifecycle-table window and lock order as up().
    -- This makes the precondition check and all trigger/view/column teardown
    -- atomic with respect to every operation that can invalidate an assignment.
    LOCK TABLE users,
               roles,
               organization_units,
               customers,
               user_role_assignments
      IN ACCESS EXCLUSIVE MODE;

    -- Permanent revocation state must never disappear while a retained row
    -- depends on it. Reconcile or remove invalidated assignments explicitly
    -- before rolling this migration back.
    DO $$
    BEGIN
      IF EXISTS (
        SELECT 1
          FROM user_role_assignments
         WHERE scope_invalidated_at IS NOT NULL
      ) THEN
        RAISE EXCEPTION
          'Cannot roll back Phase 11F stale-scope invalidation while retained invalidated role assignments exist';
      END IF;
    END $$;

    DROP VIEW IF EXISTS authorization_effective_user_role_assignments;

    DROP TRIGGER IF EXISTS roles_role_assignment_tenant_invalidation ON roles;
    DROP FUNCTION IF EXISTS invalidate_role_tenant_role_assignments();

    DROP TRIGGER IF EXISTS users_role_assignment_tenant_invalidation ON users;
    DROP FUNCTION IF EXISTS invalidate_user_tenant_role_assignments();

    DROP TRIGGER IF EXISTS customers_role_assignment_invalidation ON customers;
    DROP FUNCTION IF EXISTS invalidate_customer_role_assignments();

    DROP TRIGGER IF EXISTS organization_units_role_assignment_invalidation ON organization_units;
    DROP FUNCTION IF EXISTS invalidate_organization_unit_role_assignments();

    DROP TRIGGER IF EXISTS user_role_assignments_scope_invalidation_guard ON user_role_assignments;
    DROP FUNCTION IF EXISTS enforce_role_assignment_scope_invalidation();

    DROP INDEX IF EXISTS user_role_assignments_live_customer_scope_idx;
    DROP INDEX IF EXISTS user_role_assignments_live_organization_unit_scope_idx;
    DROP INDEX IF EXISTS user_role_assignments_live_role_idx;

    ALTER TABLE user_role_assignments
      DROP COLUMN IF EXISTS scope_invalidated_at;
  `);
};
