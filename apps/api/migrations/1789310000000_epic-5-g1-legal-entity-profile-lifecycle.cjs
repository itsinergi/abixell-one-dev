/**
 * Epic 5 Gelombang 1 (§4.5 step 5 and 7) — Legal Entity profile and lifecycle.
 *
 * G0 contract `docs/plans/epic-5-g0-contract.md` migrations M2 (profile +
 * status enum) and the `(tenant_id, id)` uniqueness M3 needs for its composite
 * ownership FK.
 *
 * Profile (§4.5 Putaran 2 "Profil Legal Entity"): legal name, display/trade
 * name, registration number, country, timezone, base currency, email, phone,
 * status. `name` and `registration_no` already exist; the rest are added here.
 * Every profile column is nullable: existing Legal Entities have no profile
 * and Gelombang 1 does not invent one — R8 in the G0 risk list is the same
 * point (seed/profile completion is a follow-up, not a migration rewrite).
 *
 * Lifecycle (§4.5 Putaran 6): `draft → active → inactive → tombstone/deleted`.
 * The pre-Epic-5 representation was `is_active` boolean + `deleted_at`
 * soft-delete (1785000000000), and it stays: the G0 contract's transition
 * policy keeps `is_active` for backward compatibility while `status` becomes
 * authoritative. The mapping backfilled here is the contract's own table:
 *
 *   is_active=true,  deleted_at IS NULL → 'active'
 *   is_active=false, deleted_at IS NULL → 'inactive'
 *   deleted_at IS NOT NULL              → 'deleted'
 *
 * `legal_entities_status_is_active_check` pins the two representations
 * together, so no writer can leave a row that says `status='active'` while
 * `is_active=false` (or the reverse). The check is safe to add because the
 * only writers of `is_active` on this table are
 * `PgLegalEntityRepository.setActive` and this migration, and the preflight
 * measured zero rows that disagree (see the task report: 0 of 309 Legal
 * Entities in the legacy copy carry `deleted_at IS NOT NULL AND is_active`).
 *
 * `legal_entities_tenant_id_id_unique` is required by M3: a composite foreign
 * key can only reference a unique tuple, and that is what makes
 * "address.tenant_id = legal_entity.tenant_id" a database fact rather than a
 * repository convention. It follows the precedent already used for
 * `organization_units` in 1779000000000.
 *
 * Additive only: no dropped column, no rewritten row beyond the status
 * backfill the contract prescribes (and `is_active`/`deleted_at` are
 * untouched).
 */

exports.shorthands = undefined;

const STATUSES = "'draft','active','inactive','tombstone','deleted'";

exports.up = (pgm) => {
  pgm.addColumns("legal_entities", {
    display_name: { type: "text" },
    country: { type: "text" },
    timezone: { type: "text" },
    base_currency: { type: "text" },
    email: { type: "text" },
    phone: { type: "text" },
    status: { type: "text", notNull: true, default: "active" },
  });

  // Backfill from the representation that is already in the table.
  pgm.sql(`
    UPDATE legal_entities
       SET status = CASE
                      WHEN deleted_at IS NOT NULL THEN 'deleted'
                      WHEN is_active = false THEN 'inactive'
                      ELSE 'active'
                    END;
  `);

  pgm.addConstraint("legal_entities", "legal_entities_status_check", {
    check: `status IN (${STATUSES})`,
  });

  pgm.addConstraint("legal_entities", "legal_entities_status_is_active_check", {
    check: "is_active = (status = 'active')",
  });

  // The two representations are kept in step by a trigger, not by hoping every
  // writer updates both. `is_active` is what the pre-Epic-5 code and every
  // existing fixture write; `status` is what the new code reads. A writer that
  // touches one and not the other is derived, so the CHECK above can never be
  // reached from a legal combination: writing `is_active = false` alone lands
  // on `status = 'inactive'`, writing `status = 'inactive'` alone lands on
  // `is_active = false`, and a writer that states both inconsistently is
  // rejected rather than silently corrected.
  pgm.sql(`
    CREATE OR REPLACE FUNCTION legal_entities_sync_status_is_active()
    RETURNS trigger AS $trg$
    BEGIN
      IF TG_OP = 'INSERT' THEN
        IF NEW.is_active = false AND NEW.status = 'active' THEN
          NEW.status := 'inactive';
        ELSIF NEW.is_active = true AND NEW.status <> 'active' THEN
          NEW.is_active := (NEW.status = 'active');
        END IF;
      ELSE
        IF NEW.is_active IS DISTINCT FROM OLD.is_active
           AND NEW.status IS NOT DISTINCT FROM OLD.status THEN
          NEW.status := CASE WHEN NEW.is_active THEN 'active' ELSE 'inactive' END;
        ELSIF NEW.status IS DISTINCT FROM OLD.status
              AND NEW.is_active IS NOT DISTINCT FROM OLD.is_active THEN
          NEW.is_active := (NEW.status = 'active');
        END IF;
      END IF;
      RETURN NEW;
    END;
    $trg$ LANGUAGE plpgsql;

    CREATE TRIGGER trg_legal_entities_sync_status_is_active
      BEFORE INSERT OR UPDATE ON legal_entities
      FOR EACH ROW EXECUTE FUNCTION legal_entities_sync_status_is_active();
  `);

  pgm.addConstraint("legal_entities", "legal_entities_base_currency_format_check", {
    check: "base_currency IS NULL OR base_currency ~ '^[A-Z]{3}$'",
  });

  pgm.createIndex("legal_entities", ["tenant_id", "status"], {
    name: "legal_entities_tenant_status_idx",
  });

  pgm.addConstraint("legal_entities", "legal_entities_tenant_id_id_unique", {
    unique: ["tenant_id", "id"],
  });
};

exports.down = (pgm) => {
  pgm.dropConstraint("legal_entities", "legal_entities_tenant_id_id_unique");
  pgm.dropIndex("legal_entities", ["tenant_id", "status"], {
    name: "legal_entities_tenant_status_idx",
  });
  pgm.dropConstraint("legal_entities", "legal_entities_base_currency_format_check");
  pgm.dropConstraint("legal_entities", "legal_entities_status_is_active_check");
  pgm.dropConstraint("legal_entities", "legal_entities_status_check");
  pgm.dropColumns("legal_entities", [
    "status",
    "phone",
    "email",
    "base_currency",
    "timezone",
    "country",
    "display_name",
  ]);
};
