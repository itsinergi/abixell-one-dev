/**
 * Epic 5 Gelombang 3 (§4.5 step 14) — the authorization-effective projection
 * learns the Legal Entity scope.
 *
 * G0 contract `docs/plans/epic-5-g0-contract.md` migration **M12**
 * (stamp 1789420000000).
 *
 * `authorization_effective_user_role_assignments` is the single database-level
 * authorization projection: every permission, scope and queue predicate reads
 * it, and the admin reads deliberately read the base table so unavailable rows
 * stay visible and removable. Rebuilding it is therefore a **metadata rebuild
 * with no row loss**, not a purely additive change — the view is dropped and
 * recreated under an ACCESS EXCLUSIVE lock, exactly the shape and lock order
 * 1788200000000 / 1788400000000 used.
 *
 * Three changes, and one deliberate non-change:
 *
 * 1. `scope_legal_entity_id` joins the projection.
 * 2. A `LEFT JOIN legal_entities` on `(id, tenant_id)` — the same
 *    same-tenant condition the Organization Unit and Customer joins already
 *    carry, so a Legal Entity of another Tenant can never satisfy the join.
 *    The join also requires `deleted_at IS NULL` **and `is_active`**: a
 *    deactivated Legal Entity still authorizes nothing, which is the
 *    fail-closed rule §4.5 Putaran 6 states for inactive entities ("tidak boleh
 *    dipakai transaksi baru") applied to the authorization read. `is_active`
 *    is the column 1789310000000 pins to `status` with a CHECK and a sync
 *    trigger, so it is the reliable reading of lifecycle state here.
 * 3. A `legal_entity` branch in the WHERE clause. The branch requires the
 *    target to be present on the row and every other scope column to be NULL:
 *    the view states the same four-way exclusivity the base table's CHECK
 *    enforces, so a malformed row can never become an authorization input even
 *    if a future writer bypasses the CHECK.
 *
 * The non-change: the `organization_unit` branch keeps the predicate it
 * shipped with (`ou.deleted_at IS NULL`, no lifecycle filter). Tightening
 * inactive-Organization-Unit behaviour would change live authorization for an
 * operationally different family with its own history and its own suite, and
 * §4.5 principle 10 says an inactive entity closes NEW work — which is the
 * repository's grant-time refusal, not a rewrite of the OU predicate. The Legal
 * Entity scope has no legacy behaviour to preserve, so it ships fail-closed.
 */

exports.shorthands = undefined;

const VIEW_BODY = `
  SELECT ura.id,
         ura.user_id,
         ura.role_id,
         ura.scope_type,
         ura.scope_legal_entity_id,
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
    LEFT JOIN legal_entities le
      ON le.id = ura.scope_legal_entity_id
     AND le.tenant_id = u.tenant_id
     AND le.deleted_at IS NULL
     AND le.is_active
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
         AND ura.scope_legal_entity_id IS NULL
         AND ura.scope_organization_unit_id IS NULL
         AND ura.scope_customer_id IS NULL
       )
       OR (
         ura.scope_type = 'legal_entity'
         AND ura.scope_legal_entity_id IS NOT NULL
         AND ura.scope_organization_unit_id IS NULL
         AND ura.scope_customer_id IS NULL
         AND le.id IS NOT NULL
       )
       OR (
         ura.scope_type = 'organization_unit'
         AND ura.scope_legal_entity_id IS NULL
         AND ura.scope_organization_unit_id IS NOT NULL
         AND ura.scope_customer_id IS NULL
         AND ou.id IS NOT NULL
       )
       OR (
         ura.scope_type = 'customer'
         AND ura.scope_legal_entity_id IS NULL
         AND ura.scope_organization_unit_id IS NULL
         AND ura.scope_customer_id IS NOT NULL
         AND c.id IS NOT NULL
       )
     )`;

/** The 1788400000000 body, restored verbatim on rollback. */
const VIEW_BODY_PRE_G3 = `
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
     )`;

/** The three lifecycle tables the projection reads, plus the assignment table
 * it projects — locked in one order by both directions of this migration. */
const LOCK = `
    LOCK TABLE users,
               roles,
               organization_units,
               customers,
               legal_entities,
               user_role_assignments
      IN ACCESS EXCLUSIVE MODE;`;

exports.up = (pgm) => {
  pgm.sql(`
${LOCK}

    DROP VIEW authorization_effective_user_role_assignments;

    CREATE VIEW authorization_effective_user_role_assignments AS
${VIEW_BODY};
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
${LOCK}

    -- Refuse to roll back while a Legal Entity-scoped grant is live: the
    -- pre-G3 projection cannot express it, so the grant would silently stop
    -- authorizing rather than being reported as unmigratable.
    DO $$
    DECLARE
      remaining_rows integer;
    BEGIN
      SELECT COUNT(*)::integer
        INTO remaining_rows
        FROM user_role_assignments
       WHERE scope_type = 'legal_entity' OR scope_legal_entity_id IS NOT NULL;

      IF remaining_rows > 0 THEN
        RAISE EXCEPTION
          'Cannot roll back the Legal Entity scope projection: % assignment(s) still carry it',
          remaining_rows;
      END IF;
    END $$;

    DROP VIEW authorization_effective_user_role_assignments;

    CREATE VIEW authorization_effective_user_role_assignments AS
${VIEW_BODY_PRE_G3};
  `);
};
