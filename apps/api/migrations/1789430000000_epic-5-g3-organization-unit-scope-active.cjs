/**
 * Epic 5 Gelombang 3, enforcement batch (t_e1a1984c) — the authorization
 * projection stops authorizing through an inactive or deleted Organization
 * Unit scope.
 *
 * Why this stamp exists at all: M12 (1789420000000) made the **Legal Entity**
 * branch fail-closed (`le.deleted_at IS NULL AND le.is_active`) and left the
 * `organization_unit` branch with the predicate it had shipped with since
 * 1788400000000 (`ou.deleted_at IS NULL`, no lifecycle filter). That asymmetry
 * was deliberate in the M12 hand-off — the Legal Entity scope had no legacy
 * behaviour to preserve, the Organization Unit family did — and it was handed
 * to this batch, whose card requires "inactive/deleted entity guards so
 * authorization fails closed on inactive or deleted Legal Entities,
 * Organization Units, assignments".
 *
 * What changes: one predicate in the `organization_units` LEFT JOIN. An
 * assignment whose `scope_organization_unit_id` names a unit that is not
 * `status = 'active'` (inactive, tombstoned or deleted) is no longer part of
 * `authorization_effective_user_role_assignments`, so it confers no permission
 * and no Data Scope — exactly the rule M12 already applies to a Legal Entity
 * scope. `status` is the authoritative lifecycle column: 1789340000000 pins
 * `is_active = (status = 'active')` with a CHECK and a sync trigger, and its
 * backfill maps a lifecycle row onto `status`, so `status = 'active'` is the
 * strict reading of "usable" (a legacy row with `deleted_at` set and
 * `is_active = true` is caught by this, `is_active` alone would not catch it).
 *
 * Consequences, stated so they are not discovered as surprises:
 * - `resolveActor` joins this view, so a session whose active assignment is
 *   scoped to an inactive unit resolves to `assignmentId: null` on its NEXT
 *   request: the session stays authenticated (401 is not the answer) and every
 *   permissioned route answers 403. No stale authority survives.
 * - A live Role assignment on an inactive unit is still *visible and
 *   manageable* in the admin console: the admin reads deliberately read the
 *   base table (`user_role_assignments`), not this projection, exactly as M12
 *   documents.
 * - Nothing here refuses the lifecycle transitions themselves. Deactivating a
 *   unit is done BY a tenant-wide actor (the unit service's own guard), and the
 *   inactive → active / inactive → tombstone paths keep working because the
 *   transition guards read the base table through the repositories.
 *
 * Rebuild shape and lock order are M12's: the view is dropped and recreated
 * under an ACCESS EXCLUSIVE lock over the same six tables in the same order.
 * A view rebuild is a metadata rebuild with no row loss — but see the rollback
 * refusal below.
 */

exports.shorthands = undefined;

/**
 * The projection this migration installs. Only the `organization_units` join
 * differs from M12's body: `AND ou.status = 'active'`.
 */
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
     AND ou.status = 'active'
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

/** M12's body (1789420000000), restored verbatim on rollback. */
const VIEW_BODY_PRE_ENFORCEMENT = `
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

/** The lifecycle tables the projection reads, plus the assignment table it
 * projects — the same set and order M12 locks, so the two migrations can never
 * deadlock against each other. */
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

    DROP VIEW authorization_effective_user_role_assignments;

    CREATE VIEW authorization_effective_user_role_assignments AS
${VIEW_BODY_PRE_ENFORCEMENT};
  `);
};
