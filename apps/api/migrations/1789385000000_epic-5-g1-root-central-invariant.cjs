/**
 * Epic 5 Gelombang 1 (§4.5 step 8) — Root Central invariant.
 *
 * G0 contract `docs/plans/epic-5-g0-contract.md` §4 item 5 ("One root Central
 * per Legal Entity: no unique constraint exists yet") and the 2026-09-29 audit
 * correction: the root Central is created in the SAME transaction as the Legal
 * Entity, and the one-root-per-Legal-Entity rule is a unique partial index.
 *
 * §4.5 Putaran 4 locks the rule: "Setiap Legal Entity wajib memiliki tepat
 * satu root Organization Unit bernama Central. Dibuat otomatis saat Legal
 * Entity dibuat dan tidak boleh dihapus."
 *
 * Three separate mechanisms, because they are three separate claims:
 *
 *   1. `organization_units_one_central_per_legal_entity` — at most one live
 *      'Central' row per Legal Entity. "At least one" cannot be a table
 *      constraint (it is a property of a transaction, not of a row), so it is
 *      enforced where the Legal Entity is created — the service inserts the
 *      Legal Entity and its Central together inside one governed transaction.
 *   2. The structure trigger keeps the *links* honest at the database level:
 *      a parent must live in the same Tenant AND the same Legal Entity
 *      (§4.5 structure limit: "Anak dan parent harus berada pada Tenant dan
 *      Legal Entity yang sama"), and the root Central cannot be moved, retyped
 *      or deleted.
 *   3. The service layer adds the friendly ConflictError before the trigger
 *      ever fires, and audits the attempted action.
 *
 * ── Why the trigger is not stricter ───────────────────────────────────────
 *
 * It deliberately does NOT require every parentless row to be typed 'Central'.
 * 1789360000000 inventories legacy `unit_type` values instead of rewriting
 * them, so 480 existing Organization Units keep their stored type (none of
 * which is 'Central') and 45 Legal Entities still have two parentless units.
 * Rejecting that shape here would make the migration undeployable; §4.5 step 12
 * (Gelombang 2) owns hierarchy validation — cycles, orphan roots, overlap — and
 * this migration leaves it the room to remediate rather than the job of
 * unpicking a failed constraint.
 *
 * Consequence, reported rather than worked around: "exactly one root Central
 * per Legal Entity" holds for every Legal Entity created through the API from
 * Gelombang 1 onward (the creation path inserts Central in the same
 * transaction) and does NOT yet hold for the pre-existing Legal Entities — a
 * backfill is a Founder decision (the guard for this wave forbids rewriting
 * legacy values in a migration).
 *
 * The one-root index is created after a preflight that fails loudly if live
 * data would violate it, instead of failing with a bare relation error.
 *
 * ── What "cannot be deleted" means here ────────────────────────────────────
 *
 * §4.5 Putaran 4 locks "Root Central ... tidak boleh dihapus". The DELETE
 * trigger refuses every delete that is not the destruction of the Legal Entity
 * that owns the root: removing the owner is a different claim — a composition
 * whose owner is gone has no root to keep. The alternatives were measured on
 * the isolated database with rolled-back probes
 * (`C:/Users/engdi/AppData/Local/Temp/epic5g1r2/probe-trigger.log`):
 *
 *   - WITHOUT the cascade carve-out, `DELETE FROM tenants` is refused outright
 *     ("Root Central Organization Unit cannot be deleted"), so a Tenant that
 *     owns one Legal Entity could never be removed — no teardown, no
 *     offboarding. Unusable.
 *   - Carving out only "my owning Legal Entity row is already gone" instead of
 *     `pg_trigger_depth()` also survived the teardown probes, but it depends on
 *     the order in which PostgreSQL happens to run its referential actions, and
 *     nothing in this schema guarantees that order.
 *
 * So the carve-out is deliberate and stated rather than hidden, and the delete
 * semantics underneath it (cascade vs tombstone vs the reference-check registry,
 * §4.5 step 13, G0 §13 Q1–Q3) stay Gelombang 2/3 decisions: the G0 audit's
 * point 7 says not to settle them in G1, and Epic 5 performs no physical delete
 * at all. Refusing the direct DELETE is the part Gelombang 1 can state
 * truthfully.
 *
 * Founder sign-off 2026-09-29, item [3.2]: this carve-out ships as a temporary
 * accepted risk. Full protection — a root Central that may not disappear for as
 * long as its Legal Entity lives — is Wave 2 work, delivered together with the
 * tombstone + reference registry that replaces this guard (carry-forward (1)
 * and (2) of the Epic 5 accepted-risk record).
 *
 * Additive only: one index, two triggers, two functions.
 */

exports.shorthands = undefined;

exports.up = (pgm) => {
  // Preflight: the index below is a hard failure if any Legal Entity already
  // holds two live Central units. Fail with a message that names them.
  pgm.sql(`
    DO $$
    DECLARE
      offenders TEXT;
    BEGIN
      SELECT string_agg(legal_entity_id::text, ', ')
        INTO offenders
        FROM (
          SELECT legal_entity_id
            FROM organization_units
           WHERE unit_type = 'Central'
             AND deleted_at IS NULL
           GROUP BY legal_entity_id
          HAVING count(*) > 1
        ) dupes;

      IF offenders IS NOT NULL THEN
        RAISE EXCEPTION
          'Epic 5 G1 preflight failed: Legal Entities with more than one live Central root: %',
          offenders;
      END IF;
    END
    $$;
  `);

  pgm.sql(`
    CREATE UNIQUE INDEX organization_units_one_central_per_legal_entity
      ON organization_units (legal_entity_id)
      WHERE unit_type = 'Central' AND deleted_at IS NULL;
  `);

  pgm.sql(`
    CREATE OR REPLACE FUNCTION organization_units_enforce_structure()
    RETURNS trigger AS $trg$
    DECLARE
      parent_tenant uuid;
      parent_legal_entity uuid;
    BEGIN
      -- A parent must be in the same Tenant and the same Legal Entity.
      IF NEW.parent_id IS NOT NULL THEN
        SELECT ou.tenant_id, ou.legal_entity_id
          INTO parent_tenant, parent_legal_entity
          FROM organization_units ou
         WHERE ou.id = NEW.parent_id;

        IF NOT FOUND THEN
          RAISE EXCEPTION 'Organization Unit parent % does not exist', NEW.parent_id
            USING ERRCODE = '23514';
        END IF;

        IF parent_tenant <> NEW.tenant_id THEN
          RAISE EXCEPTION
            'Organization Unit parent % belongs to a different Tenant', NEW.parent_id
            USING ERRCODE = '23514';
        END IF;

        IF parent_legal_entity <> NEW.legal_entity_id THEN
          RAISE EXCEPTION
            'Organization Unit parent % belongs to a different Legal Entity', NEW.parent_id
            USING ERRCODE = '23514';
        END IF;
      END IF;

      -- The root Central is immovable, unretypable and undeletable.
      IF TG_OP = 'UPDATE'
         AND OLD.unit_type = 'Central'
         AND OLD.parent_id IS NULL
         AND OLD.deleted_at IS NULL THEN
        IF NEW.parent_id IS NOT NULL THEN
          RAISE EXCEPTION 'Root Central Organization Unit cannot be moved'
            USING ERRCODE = '23514';
        END IF;
        IF NEW.unit_type <> 'Central' THEN
          RAISE EXCEPTION 'Root Central Organization Unit cannot be re-typed'
            USING ERRCODE = '23514';
        END IF;
        IF NEW.deleted_at IS NOT NULL THEN
          RAISE EXCEPTION 'Root Central Organization Unit cannot be deleted'
            USING ERRCODE = '23514';
        END IF;
      END IF;

      RETURN NEW;
    END;
    $trg$ LANGUAGE plpgsql;

    CREATE TRIGGER trg_organization_units_structure
      BEFORE INSERT OR UPDATE ON organization_units
      FOR EACH ROW EXECUTE FUNCTION organization_units_enforce_structure();

    CREATE OR REPLACE FUNCTION organization_units_block_root_central_delete()
    RETURNS trigger AS $trg$
    BEGIN
      -- A direct DELETE of a root Central is refused. A DELETE that arrives
      -- from a foreign-key cascade is a different claim: it says the owning
      -- row is going away (the Legal Entity, or the Tenant itself), and
      -- refusing it would strand the parent delete half-done — the tenant
      -- teardown every integration suite performs in afterAll is exactly
      -- that shape. Referential cascades run inside another trigger, so
      -- pg_trigger_depth() > 1 identifies them; Gelombang 2 owns the real
      -- delete flow (tombstone + reference-check registry, §4.5 step 13).
      IF OLD.unit_type = 'Central'
         AND OLD.parent_id IS NULL
         AND pg_trigger_depth() <= 1 THEN
        RAISE EXCEPTION 'Root Central Organization Unit cannot be deleted'
          USING ERRCODE = '23514';
      END IF;
      RETURN OLD;
    END;
    $trg$ LANGUAGE plpgsql;

    CREATE TRIGGER trg_organization_units_block_root_central_delete
      BEFORE DELETE ON organization_units
      FOR EACH ROW EXECUTE FUNCTION organization_units_block_root_central_delete();
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    DROP TRIGGER IF EXISTS trg_organization_units_block_root_central_delete ON organization_units;
    DROP FUNCTION IF EXISTS organization_units_block_root_central_delete();
    DROP TRIGGER IF EXISTS trg_organization_units_structure ON organization_units;
    DROP FUNCTION IF EXISTS organization_units_enforce_structure();
    DROP INDEX IF EXISTS organization_units_one_central_per_legal_entity;
  `);
};
