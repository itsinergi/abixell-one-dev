/**
 * Epic 5 Gelombang 3 (§4.5 step 14, Putaran 4 "Legal Entity Data Scope") —
 * `legal_entity` becomes a fourth Data Scope on `user_role_assignments`.
 *
 * G0 contract `docs/plans/epic-5-g0-contract.md` migration **M10**
 * (stamp 1789400000000).
 *
 * Contract shape: ADD `scope_legal_entity_id` (nullable), widen the
 * `scope_type` CHECK to include `legal_entity`, and add the consistency CHECK
 * `(scope_type='legal_entity' AND scope_legal_entity_id IS NOT NULL AND
 * scope_organization_unit_id IS NULL AND scope_customer_id IS NULL)`.
 *
 * Deviations from the contract text, each deliberate and measured:
 *
 * 1. **One combined scope CHECK, not a fourth disjoint one.** The two checks
 *    1757000000000 left behind (`user_role_assignments_scope_type_check` and
 *    `user_role_assignments_scope_org_unit_required_check`) are dropped and
 *    replaced by `user_role_assignments_scope_consistency_check`, which states
 *    all four branches in one place. Widening an enumerating CHECK and adding a
 *    second, overlapping CHECK would let a later writer satisfy one and violate
 *    the other; the disjoint form is what the four scope families actually are.
 *    The pre-flight block below refuses to install over any row that does not
 *    already satisfy the widened rule, so this is not a silent rewrite.
 *
 * 2. **`ON DELETE CASCADE`, not the contract's `SET NULL`.** The contract is
 *    internally inconsistent here: a `SET NULL` action on
 *    `scope_legal_entity_id` would leave a row with `scope_type='legal_entity'`
 *    and a NULL target, which the CHECK added by the same migration rejects —
 *    so a Legal Entity delete would fail with a raw 23514 instead of doing what
 *    the action says. `CASCADE` is also what the nearest precedent uses
 *    (`scope_customer_id`, 1757000000000:196) and what keeps `DELETE FROM
 *    tenants` working, since `legal_entities.tenant_id` is ON DELETE CASCADE:
 *    the assignment rows go with the Legal Entity they can no longer mean.
 *
 * 3. **Ownership is validated by the existing write-time guard, not by a
 *    composite FK.** A composite FK `(tenant_id, scope_legal_entity_id) →
 *    legal_entities(tenant_id, id)` (G0 risk R4) would need a `tenant_id`
 *    column on `user_role_assignments`, which the table deliberately does not
 *    have: tenancy is inherited through `users`, and adding it would touch
 *    every INSERT in the repositories and in the test fixtures for no gain over
 *    the mechanism this table already ships for exactly this question. G0 open
 *    item Q1 named the trigger option; this migration takes it by extending
 *    `enforce_role_assignment_scope_invalidation()` — the BEFORE INSERT OR
 *    UPDATE guard from 1775000000000 that already answers "is this assignment's
 *    target real, in MY tenant, and still available" for `organization_unit`
 *    and `customer` scope — with the `legal_entity` branch. A cross-Tenant or
 *    deleted Legal Entity reference therefore lands `scope_invalidated_at` on
 *    the row (monotonic, grants nothing) exactly like the two existing scope
 *    families, instead of introducing a fourth mechanism.
 *
 * Inactivity is deliberately NOT folded in here: `scope_invalidated_at` is
 * permanent, and contract §D forbids using it as a stand-in for the lifecycle.
 * A deactivated Legal Entity is handled where every other availability
 * question is answered — the authorization projection rebuilt in
 * 1789420000000 — and at grant time by the repository, which refuses an
 * inactive target.
 *
 * Locking: ACCESS EXCLUSIVE over the lifecycle tables and the assignment table,
 * with the lock order shared by `up()` and `down()` (users, roles,
 * organization_units, customers, legal_entities, user_role_assignments) so the
 * guard swap cannot interleave with a concurrent grant or target move. Same
 * window as 1788400000000 / 1788500000000.
 */

exports.shorthands = undefined;

/** The four scope families, in one place: `up()` installs it, `down()` and the
 * pre-flight read it, so the three can never disagree about what is legal. */
const SCOPE_CONSISTENCY =
  "(scope_type = 'tenant' AND scope_legal_entity_id IS NULL AND scope_organization_unit_id IS NULL AND scope_customer_id IS NULL) " +
  "OR (scope_type = 'legal_entity' AND scope_legal_entity_id IS NOT NULL AND scope_organization_unit_id IS NULL AND scope_customer_id IS NULL) " +
  "OR (scope_type = 'organization_unit' AND scope_legal_entity_id IS NULL AND scope_organization_unit_id IS NOT NULL AND scope_customer_id IS NULL) " +
  "OR (scope_type = 'customer' AND scope_legal_entity_id IS NULL AND scope_organization_unit_id IS NULL AND scope_customer_id IS NOT NULL)";

/** The rule 1757000000000 shipped, restored verbatim on rollback. Written out
 * rather than derived from `SCOPE_CONSISTENCY`: a rollback that reconstructs
 * the old rule by string surgery is a rollback nobody can read. */
const SCOPE_CONSISTENCY_PRE_G3 =
  "(scope_type = 'tenant' AND scope_organization_unit_id IS NULL AND scope_customer_id IS NULL) " +
  "OR (scope_type = 'organization_unit' AND scope_organization_unit_id IS NOT NULL AND scope_customer_id IS NULL) " +
  "OR (scope_type = 'customer' AND scope_customer_id IS NOT NULL AND scope_organization_unit_id IS NULL)";

exports.up = (pgm) => {
  pgm.sql(`
    LOCK TABLE users,
               roles,
               organization_units,
               customers,
               legal_entities,
               user_role_assignments
      IN ACCESS EXCLUSIVE MODE;

    -- Refuse to install over data that already violates the widened rule. Every
    -- row written so far belongs to one of the three pre-Epic-5 families and
    -- satisfies it; anything that does not is a row the operator must look at
    -- before the constraint can be trusted. Runs AFTER the column exists and
    -- BEFORE the constraint swap, which is the only order in which the widened
    -- rule can be stated in terms of the new column at all.
    ALTER TABLE user_role_assignments
      ADD COLUMN scope_legal_entity_id uuid REFERENCES legal_entities (id) ON DELETE CASCADE;

    DO $$
    DECLARE
      offending_rows integer;
    BEGIN
      SELECT COUNT(*)::integer
        INTO offending_rows
        FROM user_role_assignments ura
       WHERE NOT (${SCOPE_CONSISTENCY});

      IF offending_rows > 0 THEN
        RAISE EXCEPTION
          'Cannot install the Legal Entity scope CHECK: % existing assignment(s) violate the consistency rule',
          offending_rows;
      END IF;
    END $$;

    ALTER TABLE user_role_assignments
      DROP CONSTRAINT user_role_assignments_scope_type_check,
      DROP CONSTRAINT user_role_assignments_scope_org_unit_required_check;

    ALTER TABLE user_role_assignments
      ADD CONSTRAINT user_role_assignments_scope_consistency_check
      CHECK (${SCOPE_CONSISTENCY});

    -- The same partial-index shape the other two scope families got in
    -- 1775000000000, so the invalidation sweep and the admin reads that filter
    -- by "live grant on a target" stay indexed.
    CREATE INDEX user_role_assignments_live_legal_entity_scope_idx
      ON user_role_assignments (scope_legal_entity_id)
      WHERE scope_type = 'legal_entity'
        AND scope_invalidated_at IS NULL;

    -- The CURRENT guard body — 1788200000000's, not 1775000000000's — plus the
    -- legal_entity branch. The current one carries the Wave 3 revocation
    -- monotonicity rules (a later UPDATE may neither clear nor rewrite
    -- revoked_at / revoked_by / revoke_reason), and replacing the function with
    -- an older body would silently delete them: the revocation suite's "an
    -- UPDATE cannot clear or rewrite its provenance" case is the regression that
    -- catches it.
    --
    -- Replaced rather than re-created under a second name: the trigger
    -- user_role_assignments_scope_invalidation_guard already calls this
    -- function on every INSERT/UPDATE of the table, so the new scope family is
    -- guarded from the first row written without a second trigger to keep in
    -- step. Availability here means the same three things it means for the
    -- other families: the target exists, it is in the assignment User's Tenant,
    -- and it is not deleted.
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
      ELSIF NEW.scope_type = 'legal_entity' THEN
        PERFORM 1
          FROM legal_entities le
         WHERE le.id = NEW.scope_legal_entity_id
           AND le.tenant_id = user_tenant_id
           AND le.deleted_at IS NULL
           FOR SHARE OF le;
        target_available := FOUND;
      END IF;

      IF NOT assignment_available OR NOT target_available THEN
        NEW.scope_invalidated_at := statement_timestamp();
      END IF;

      RETURN NEW;
    END;
    $$;
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    -- Same exclusive window and lock order as up(), so the rollback cannot
    -- interleave with a grant, a target move, or a Legal Entity delete.
    LOCK TABLE users,
               roles,
               organization_units,
               customers,
               legal_entities,
               user_role_assignments
      IN ACCESS EXCLUSIVE MODE;

    -- Refuse to roll back over live Legal Entity scope: the CHECK the rollback
    -- restores cannot express it, so dropping the column would silently
    -- invalidate grants the operator can still see in the console.
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
          'Cannot roll back Legal Entity scope: % assignment(s) still carry it',
          remaining_rows;
      END IF;
    END $$;

    -- Back to the 1788200000000 guard body verbatim: the Wave 3 revocation
    -- monotonicity rules stay, only the legal_entity branch goes.
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

      IF TG_OP = 'UPDATE' AND OLD.revoked_at IS NOT NULL THEN
        NEW.revoked_at := OLD.revoked_at;
        NEW.revoked_by := OLD.revoked_by;
        NEW.revoke_reason := OLD.revoke_reason;
      END IF;

      IF NEW.scope_invalidated_at IS NOT NULL OR NEW.revoked_at IS NOT NULL THEN
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

    DROP INDEX user_role_assignments_live_legal_entity_scope_idx;

    ALTER TABLE user_role_assignments
      DROP CONSTRAINT user_role_assignments_scope_consistency_check;

    ALTER TABLE user_role_assignments
      ADD CONSTRAINT user_role_assignments_scope_type_check
      CHECK (scope_type IN ('tenant', 'organization_unit', 'customer'));

    ALTER TABLE user_role_assignments
      ADD CONSTRAINT user_role_assignments_scope_org_unit_required_check
      CHECK (${SCOPE_CONSISTENCY_PRE_G3});

    ALTER TABLE user_role_assignments
      DROP COLUMN scope_legal_entity_id;
  `);
};
