/**
 * Epic 4 customer scope — scope exclusivity and the permission ceiling
 * (CORE-ROADMAP.md §4.4, interview settled 2026-09-28).
 *
 * Two decisions land here, the two that can be enforced without any
 * Service Operation query existing yet:
 *
 * 1. **A customer-scoped user is never also an internal user.** Decision 6
 *    settled that customer scope may not coexist with tenant or
 *    organization-unit scope. The roadmap described this as a partial unique
 *    index on `user_id`; that shape cannot express the rule. An index on
 *    `(user_id)` restricted to customer rows would forbid a user from holding
 *    TWO customer assignments, which is not the rule, and an index on
 *    `(user_id, is_customer)` would forbid two internal assignments, which is
 *    ordinary and correct (two Roles in two Organization Units). An exclusion
 *    constraint would fit, but it needs `btree_gist`, which this database
 *    does not have. A BEFORE trigger is therefore the mechanism, and it is the
 *    same mechanism already guarding this table's scope invalidation.
 *
 *    "Live" means the same thing everywhere else in this schema:
 *    `scope_invalidated_at IS NULL AND revoked_at IS NULL`. A revoked
 *    customer grant does not block an internal grant, because it grants
 *    nothing; that is what soft revocation bought in Wave 3.
 *
 * 2. **The Service Operation permission ceiling.** Decision 2 settled that a
 *    Role granted at customer scope may carry `service_operations.read` and
 *    `service_operations.optimization.read`, and the other six Service
 *    Operation permissions are refused at grant until the ceiling is opened.
 *    The ceiling is enforced in the repository (it is a per-grant decision
 *    with an operator-facing message, not a row shape), and the OPENING is a
 *    Feature Flag so the product owner flips it without a migration. This
 *    migration seeds that flag, disabled, which is the safe direction: a
 *    tenant that never touches it gets the settled default.
 *
 *    The ceiling governs the SERVICE OPERATION module only. Permissions from
 *    other modules are untouched — `customer.read`, `contract.read`,
 *    `project.read`, `site.read` and `service.read` are what the Customer User
 *    Portal is built on, and the demo seed's CUSTOMER_USER Role already holds
 *    them. Reading a customer's own row is not the thing decision 2 bounded;
 *    driving the operation is.
 *
 * The third piece of the customer-scope contract — filtering the closed
 * internal surfaces (audit trail, internal notes, other customers' rows, the
 * internal staff directory) — has no query to attach to until the Service
 * Operation module exists. It is recorded as a required deliverable of that
 * module in the roadmap, not built here against no caller.
 *
 * No permission or route is introduced, so nothing in the process or API
 * Resource catalogue changes: a Feature Flag is configuration, not a
 * governance primitive, and `dictionary-seed-parity.test.ts` compares
 * `app_processes` against the live `permissions` table — a set this migration
 * leaves exactly as it found it. The flag row is seeded straight into
 * `feature_flags`, the same way 1755700000000 seeded the flags that shipped
 * with the configuration surface.
 */
exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.sql(`
    -- Same exclusive lifecycle-table window as the other Epic 4 migrations: the
    -- new trigger must not observe a half-applied write, and the backfill
    -- check below must not race a concurrent grant.
    LOCK TABLE user_role_assignments, users, roles IN ACCESS EXCLUSIVE MODE;

    -- Refuse to install over data that already violates the rule. A silent
    -- install would leave the trigger unable to fire for the rows that needed
    -- it most, and the operator would have no way to know.
    DO $$
    DECLARE
      offending_users integer;
    BEGIN
      SELECT COUNT(*)::integer
        INTO offending_users
        FROM (
          SELECT ura.user_id
            FROM user_role_assignments ura
           WHERE ura.scope_invalidated_at IS NULL
             AND ura.revoked_at IS NULL
           GROUP BY ura.user_id
          HAVING COUNT(*) FILTER (WHERE ura.scope_type = 'customer') > 0
             AND COUNT(*) FILTER (WHERE ura.scope_type <> 'customer') > 0
        ) mixed;

      IF offending_users > 0 THEN
        RAISE EXCEPTION
          'Cannot install customer-scope exclusivity: % user(s) hold both customer-scope and internal assignments',
          offending_users;
      END IF;
    END $$;

    -- Scope exclusivity, in both directions. Written as a trigger rather than
    -- an index because the rule is "these two rows may not coexist", which is
    -- a constraint between rows, not a shape within one.
    CREATE OR REPLACE FUNCTION enforce_customer_scope_exclusivity()
    RETURNS trigger
    LANGUAGE plpgsql
    AS $$
    DECLARE
      conflicting_assignment_id uuid;
    BEGIN
      -- Only LIVE rows participate. A revoked or invalidated row grants
      -- nothing, so it cannot conflict with anything.
      IF NEW.scope_invalidated_at IS NOT NULL OR NEW.revoked_at IS NOT NULL THEN
        RETURN NEW;
      END IF;

      IF NEW.scope_type = 'customer' THEN
        SELECT other.id
          INTO conflicting_assignment_id
          FROM user_role_assignments other
         WHERE other.user_id = NEW.user_id
           AND other.id <> NEW.id
           AND other.scope_type <> 'customer'
           AND other.scope_invalidated_at IS NULL
           AND other.revoked_at IS NULL
         LIMIT 1;
      ELSE
        SELECT other.id
          INTO conflicting_assignment_id
          FROM user_role_assignments other
         WHERE other.user_id = NEW.user_id
           AND other.id <> NEW.id
           AND other.scope_type = 'customer'
           AND other.scope_invalidated_at IS NULL
           AND other.revoked_at IS NULL
         LIMIT 1;
      END IF;

      IF conflicting_assignment_id IS NOT NULL THEN
        RAISE EXCEPTION USING
          ERRCODE = '23514',
          CONSTRAINT = 'user_role_assignments_scope_exclusivity_check',
          MESSAGE = 'A User may not hold customer-scope and internal assignments at the same time';
      END IF;

      RETURN NEW;
    END;
    $$;

    -- Fires on INSERT and on UPDATE, like the table's other lifecycle trigger:
    -- an UPDATE that revives a row, or moves one between the two families,
    -- must be caught too.
    DROP TRIGGER IF EXISTS user_role_assignments_customer_scope_exclusivity
      ON user_role_assignments;

    CREATE TRIGGER user_role_assignments_customer_scope_exclusivity
      BEFORE INSERT OR UPDATE ON user_role_assignments
      FOR EACH ROW
      EXECUTE FUNCTION enforce_customer_scope_exclusivity();

    -- The ceiling-opening switch. Disabled by default: the settled decision is
    -- the restricted set, and opening it is a deliberate act by the product
    -- owner through the existing Feature Flag surface (config.manage).
    INSERT INTO feature_flags (code, name, description, default_enabled) VALUES
      ('customer_scope_full_permission_set',
       'Customer Scope — Full Service Operation Permission Set',
       'Allows a Role granted at customer scope to carry every Service Operation permission, instead of only service_operations.read and service_operations.optimization.read. Off means the restricted customer portal.',
       false)
    ON CONFLICT (code) DO NOTHING;
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    LOCK TABLE user_role_assignments, users, roles IN ACCESS EXCLUSIVE MODE;

    DROP TRIGGER IF EXISTS user_role_assignments_customer_scope_exclusivity
      ON user_role_assignments;
    DROP FUNCTION IF EXISTS enforce_customer_scope_exclusivity();

    -- The flag is tenant-overridable data. Removing the catalog row cascades
    -- through tenant_feature_flags, so a tenant that had opened the ceiling
    -- loses that override — which is correct on rollback: the repository code
    -- that read the flag is going away too.
    DELETE FROM feature_flags WHERE code = 'customer_scope_full_permission_set';
  `);
};
