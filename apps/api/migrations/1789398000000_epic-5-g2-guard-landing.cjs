/**
 * Epic 5 Gelombang 2 (§4.5 step 13) — Landing the two Gelombang 1 temporary
 * accepted risks, now that the tombstone flow and the reference-check registry
 * exist to land them WITH.
 *
 * Carry-forward items (1) and (2) of the Epic 5 accepted-risk record, recorded
 * in G1's own migration headers and re-stated in the G2 card:
 *
 *   (1) `1789320000000_epic-5-g1-legal-entity-addresses.cjs` ships
 *       `legal_entity_addresses.legal_entity_id ON DELETE CASCADE` where G0 M3
 *       says RESTRICT.
 *   (2) `1789385000000000_epic-5-g1-root-central-invariant.cjs` refuses a
 *       direct delete of the root Central but exempts EVERY referential
 *       cascade with `pg_trigger_depth() > 1`.
 *
 * Both are replaced here. Neither is replaced by guesswork: both replacements
 * were measured on the isolated database with rolled-back probes
 * (`probe-g2-guards.sql`, output captured in the task's evidence), because both
 * questions are ordering questions that only the database can answer.
 *
 * ── (1) Address FK, and why it is DEFERRABLE NO ACTION rather than RESTRICT ─
 *
 * The claim is Putaran 4's: an address that a document or an invoice referenced
 * must not vanish because somebody deleted its Legal Entity. The claim RESTRICT
 * encodes is "the owner cannot go while the address is still here". Two
 * measurements decide the form:
 *
 *   - E1 (baseline, CASCADE): `DELETE FROM tenants` succeeds.
 *   - RESTRICT cannot be written here at all: it is non-deferrable, so the
 *     Tenant cascade reaches `legal_entities` while the address rows are still
 *     present and the whole teardown aborts. That is the shape G1 measured and
 *     the Founder accepted as a temporary risk — a Tenant that owns one address
 *     becomes undeletable, with no teardown and no offboarding path.
 *   - E3/E4 (this migration's shape): the FK is `NO ACTION DEFERRABLE
 *     INITIALLY DEFERRED` and `tenant_id` gains its own `ON DELETE CASCADE` to
 *     `tenants`. A direct `DELETE FROM legal_entities` is now refused — E4
 *     measures the refusal, and it arrives at COMMIT under the constraint's own
 *     name — while `DELETE FROM tenants` still succeeds (E3b), because the
 *     address rows are removed by the Tenant cascade in the same transaction
 *     and the deferred check finds nothing left.
 *
 * So the owner-delete claim is now true, and Tenant teardown survives. The
 * difference from a literal `RESTRICT` is the timing of the refusal and the one
 * deletion that is still allowed: destroying the Tenant destroys its addresses,
 * which is the same "removing the owner is a different claim" argument the root
 * Central guard already rests on. The API never deletes a Legal Entity at all —
 * it tombstones — so this constraint is the backstop, not the flow.
 *
 * ── (2) Root Central delete guard, keyed on the owner instead of on depth ──
 *
 * G1's guard could not tell "a direct DELETE of a root Central" from "the
 * cascade that removes its owner", so it exempted anything running inside
 * another trigger. The replacement asks the real question: is the owning Legal
 * Entity still there?
 *
 *   - E2b: with the owner present, a direct `DELETE FROM organization_units`
 *     of the root is refused — the refusal G1 stated survives.
 *   - E2a: `DELETE FROM tenants` still succeeds, so the teardown the guard was
 *     carved out for keeps working. The cascade from the Legal Entity is what
 *     removes the unit, and by then the owner row is gone.
 *
 * The guard therefore no longer depends on `pg_trigger_depth()` — which G1's
 * header itself called a proxy for the claim rather than the claim — and a
 * cascade is allowed exactly when its owner has already gone, which is the
 * property the founder's sign-off [3.2] asked Wave 2 to deliver together with
 * the tombstone + registry flow.
 *
 * Additive at the row level: no data is rewritten, no row is deleted. DDL only.
 */

exports.shorthands = undefined;

exports.up = (pgm) => {
  // ── (1) Address FK ──────────────────────────────────────────────────────
  pgm.sql(`
    -- The Tenant cascade needs its own path to the address rows, otherwise the
    -- deferred ownership check below has nothing left to satisfy it.
    ALTER TABLE legal_entity_addresses
      ADD CONSTRAINT legal_entity_addresses_tenant_fkey
      FOREIGN KEY (tenant_id) REFERENCES tenants (id) ON DELETE CASCADE;

    ALTER TABLE legal_entity_addresses
      DROP CONSTRAINT legal_entity_addresses_legal_entity_fkey;

    ALTER TABLE legal_entity_addresses
      ADD CONSTRAINT legal_entity_addresses_legal_entity_fkey
      FOREIGN KEY (tenant_id, legal_entity_id) REFERENCES legal_entities (tenant_id, id)
      ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED;
  `);

  // ── (2) Root Central delete guard ───────────────────────────────────────
  pgm.sql(`
    CREATE OR REPLACE FUNCTION organization_units_block_root_central_delete()
    RETURNS trigger AS $trg$
    BEGIN
      -- §4.5 Putaran 4: "Root Central ... tidak boleh dihapus." Refused while
      -- the owning Legal Entity is still here: that is a direct delete of the
      -- structure anchor. A cascade from the Legal Entity (or from the Tenant
      -- that owns it) is a different claim — the owner is going away, and the
      -- unit goes with it — and is allowed, because by then the owner row is
      -- gone. The tombstone flow (1789397000000 + the service) is the ordinary
      -- way an Organization Unit leaves the system; this guard is the backstop
      -- against a blind DELETE.
      IF OLD.unit_type = 'Central' AND OLD.parent_id IS NULL THEN
        IF EXISTS (
          SELECT 1 FROM legal_entities le
           WHERE le.id = OLD.legal_entity_id
             AND le.tenant_id = OLD.tenant_id
        ) THEN
          RAISE EXCEPTION 'Root Central Organization Unit cannot be deleted'
            USING ERRCODE = '23514';
        END IF;
      END IF;
      RETURN OLD;
    END;
    $trg$ LANGUAGE plpgsql;
  `);
};

exports.down = (pgm) => {
  // Restore G1's guard, so `down` returns the database to the exact state
  // Gelombang 1 left it in.
  pgm.sql(`
    CREATE OR REPLACE FUNCTION organization_units_block_root_central_delete()
    RETURNS trigger AS $trg$
    BEGIN
      IF OLD.unit_type = 'Central'
         AND OLD.parent_id IS NULL
         AND pg_trigger_depth() <= 1 THEN
        RAISE EXCEPTION 'Root Central Organization Unit cannot be deleted'
          USING ERRCODE = '23514';
      END IF;
      RETURN OLD;
    END;
    $trg$ LANGUAGE plpgsql;

    ALTER TABLE legal_entity_addresses
      DROP CONSTRAINT legal_entity_addresses_legal_entity_fkey;

    ALTER TABLE legal_entity_addresses
      ADD CONSTRAINT legal_entity_addresses_legal_entity_fkey
      FOREIGN KEY (tenant_id, legal_entity_id) REFERENCES legal_entities (tenant_id, id)
      ON DELETE CASCADE;

    ALTER TABLE legal_entity_addresses
      DROP CONSTRAINT legal_entity_addresses_tenant_fkey;
  `);
};
