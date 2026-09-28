/**
 * Epic 4 open item 2 — Role deactivation (CORE-ROADMAP.md §4.4).
 *
 * Settled 2026-09-28: a Role may be deactivated only while no LIVE assignment
 * references it. The mirror of the delete guard (§4.4 G), which counts every
 * RETAINED row because the FK would cascade them away; deactivation keeps the
 * rows, so its guard counts only rows that still grant access.
 *
 * `roles.is_active` therefore has two jobs:
 *
 * 1. Lifecycle switch for the definition: false means the Role exists (history
 *    keeps resolving, projections keep naming it) but may not be granted
 *    again and grants that reference it stop authorizing.
 *
 * 2. A filter inside the single authorization projection. The predicate lives
 *    in the JOIN clause, not the WHERE clause, on purpose: a Role going
 *    inactive must make the assignment's ROLE state unavailable exactly the
 *    way a revoked row makes the ASSIGNMENT state unavailable, not make the
 *    user row vanish from administrative reads. The read model stays honest
 *    (`roleState: "unavailable"`), the permission check stays blind to why.
 *
 * Deactivation takes effect on the next permission check without logout — the
 * same liveness property Wave 3 revocation established, for the same reason:
 * an access-revoking change that only applies at next login is not an access
 * control.
 *
 * Existing rows are ACTIVE. Every Role written so far was grantable, so the
 * default must not silently retire anything.
 */
exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.sql(`
    -- Same exclusive lifecycle-table window and lock order as 1788200000000,
    -- so the view swap cannot interleave with a concurrent scope move or a
    -- governed write.
    LOCK TABLE users,
               roles,
               organization_units,
               customers,
               user_role_assignments
      IN ACCESS EXCLUSIVE MODE;

    ALTER TABLE roles
      ADD COLUMN is_active boolean NOT NULL DEFAULT true;

    -- Step 19 composition, plus the inactive-Role predicate in the join. The
    -- join to roles now requires an active Role; an inactive one detaches
    -- the assignment from the projection the same way a soft-deleted user
    -- does, without touching the assignment row itself.
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
       AND r.is_active = true
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

    DROP VIEW IF EXISTS authorization_effective_user_role_assignments;

    -- Back to the Wave 3 view body: same composition without the is_active
    -- predicate.
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

    ALTER TABLE roles DROP COLUMN is_active;
  `);
};
