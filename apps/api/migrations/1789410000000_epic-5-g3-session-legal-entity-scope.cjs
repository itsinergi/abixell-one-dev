/**
 * Epic 5 Gelombang 3 (§4.5 step 14) — the active session context carries the
 * Legal Entity scope.
 *
 * G0 contract `docs/plans/epic-5-g0-contract.md` migration **M11**
 * (stamp 1789410000000).
 *
 * `sessions.organization_unit_id` is the precedent: the active scope is
 * denormalized onto the session row at login/switch so a session can be read
 * back without re-deriving the assignment, and `ON DELETE SET NULL` is used for
 * the same reason epic 1 chose it for `active_assignment_id` — an entity that
 * disappears must leave the session with NO scope, never with a stale one.
 *
 * This column is a MIRROR, not the enforcement source. Authorization reads
 * `authorization_effective_user_role_assignments` (rebuilt in 1789420000000)
 * on every request, so revocation, role deactivation and Legal Entity
 * deactivation take effect on the next check without a re-login — the property
 * Epic 4 Wave 3 established. `session.service.ts` keeps this column in step
 * with the assignment it names; nothing authorizes from it.
 *
 * Additive only.
 */

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.sql(`
    LOCK TABLE sessions, legal_entities IN ACCESS EXCLUSIVE MODE;

    ALTER TABLE sessions
      ADD COLUMN scope_legal_entity_id uuid REFERENCES legal_entities (id) ON DELETE SET NULL;

    -- Backfill from the assignment each session already points at, so a session
    -- that is live across this deploy reads the same context it would after a
    -- switch. Only legal_entity-scoped assignments fill it; every other
    -- session keeps NULL, which is the same "no Legal Entity scope" state a new
    -- login into any other scope starts in.
    UPDATE sessions s
       SET scope_legal_entity_id = ura.scope_legal_entity_id
      FROM user_role_assignments ura
     WHERE ura.id = s.active_assignment_id
       AND ura.scope_type = 'legal_entity';
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    LOCK TABLE sessions, legal_entities IN ACCESS EXCLUSIVE MODE;
    ALTER TABLE sessions DROP COLUMN scope_legal_entity_id;
  `);
};
