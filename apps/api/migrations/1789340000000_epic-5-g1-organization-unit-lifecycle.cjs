/**
 * Epic 5 Gelombang 1 (§4.5 step 7) — Organization Unit lifecycle.
 *
 * G0 contract `docs/plans/epic-5-g0-contract.md` migration M5.
 *
 * Same lifecycle shape as the Legal Entity migration (1789310000000):
 * `status` becomes the authoritative enum while `is_active` stays in step with
 * it, and the backfill is the G0 contract's mapping table. Organization Unit
 * lifecycle is §4.5 Putaran 6: "draft → active → inactive → tombstone/deleted;
 * replacement optional".
 *
 * `replacement_organization_unit_id` is the "optional replacement" from
 * Putaran 4 ("Bila merger/penggantian terjadi, simpan referensi unit
 * pengganti"). It is nullable and self-referencing, and the composite FK
 * `(tenant_id, replacement_organization_unit_id) → organization_units(tenant_id,
 * id)` keeps a replacement inside its own Tenant — the same ownership rule the
 * parent link needs, stated here for the one link Gelombang 1 introduces.
 * It is NOT used to re-parent anything in Gelombang 1: tombstone and the
 * replacement flow are Gelombang 2 (§4.5 step 13), and this column is the
 * contract they will write into.
 *
 * `timezone` is the per-unit override §4.5 Putaran 3 allows ("Legal Entity dan
 * Organization Unit dapat override bila perlu"); NULL means inherit from the
 * Legal Entity, which inherits from the Tenant.
 *
 * `status` is added with DEFAULT 'active' and the `status IN (...)` CHECK, but
 * the *transitions* are not constrained here: §4.5 requires inactive units to
 * keep reading historically, and the transition policy (which move is legal
 * from which state) belongs to the service layer where it can lock rows and
 * audit the before/after. A CHECK that tried to encode transitions in the
 * database could not see the child units a deactivation must refuse over
 * (§4.5 lifecycle guard: "active → inactive (deactivate; blocked if active
 * children)").
 *
 * Additive only.
 */

exports.shorthands = undefined;

const STATUSES = "'draft','active','inactive','tombstone','deleted'";

exports.up = (pgm) => {
  pgm.addColumns("organization_units", {
    status: { type: "text", notNull: true, default: "active" },
    replacement_organization_unit_id: { type: "uuid" },
    timezone: { type: "text" },
  });

  pgm.sql(`
    UPDATE organization_units
       SET status = CASE
                      WHEN deleted_at IS NOT NULL THEN 'deleted'
                      WHEN is_active = false THEN 'inactive'
                      ELSE 'active'
                    END;
  `);

  pgm.addConstraint(
    "organization_units",
    "organization_units_status_check",
    {
      check: `status IN (${STATUSES})`,
    },
  );

  pgm.addConstraint("organization_units", "organization_units_status_is_active_check", {
    check: "is_active = (status = 'active')",
  });

  // Same dual-representation bridge as `legal_entities` (1789310000000): the
  // pre-Epic-5 writers and fixtures set `is_active`, the new code reads
  // `status`, and a writer that touches only one of them gets the other
  // derived so the CHECK can never fire on a legal combination.
  pgm.sql(`
    CREATE OR REPLACE FUNCTION organization_units_sync_status_is_active()
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

    CREATE TRIGGER trg_organization_units_sync_status_is_active
      BEFORE INSERT OR UPDATE ON organization_units
      FOR EACH ROW EXECUTE FUNCTION organization_units_sync_status_is_active();
  `);

  // Raw SQL, not `pgm.addConstraint`: PostgreSQL 16 requires a composite FK's
  // ON DELETE SET NULL to name the column it nulls, and node-pg-migrate's
  // `foreignKeys` shorthand cannot express the column list. Same shape as the
  // composite FKs already used since 1779000000000.
  pgm.sql(`
    ALTER TABLE organization_units
      ADD CONSTRAINT organization_units_replacement_fkey
      FOREIGN KEY (tenant_id, replacement_organization_unit_id)
      REFERENCES organization_units (tenant_id, id)
      ON DELETE SET NULL (replacement_organization_unit_id);
  `);

  pgm.createIndex("organization_units", ["tenant_id", "status"], {
    name: "organization_units_tenant_status_idx",
  });
};

exports.down = (pgm) => {
  pgm.dropIndex("organization_units", ["tenant_id", "status"], {
    name: "organization_units_tenant_status_idx",
  });
  pgm.dropConstraint("organization_units", "organization_units_replacement_fkey");
  pgm.dropConstraint("organization_units", "organization_units_status_is_active_check");
  pgm.dropConstraint("organization_units", "organization_units_status_check");
  pgm.dropColumns("organization_units", [
    "timezone",
    "replacement_organization_unit_id",
    "status",
  ]);
};
