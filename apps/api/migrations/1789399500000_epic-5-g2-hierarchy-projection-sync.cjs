/**
 * Epic 5 Gelombang 2 (§4.5 step 10) — the projection keeps itself in step.
 *
 * `1789396000000` created `organization_unit_hierarchy_history` and snapshotted
 * every Organization Unit that existed at that moment. It left one gap, found by
 * the Gelombang 2 acceptance suite rather than by inspection: a unit created
 * AFTER the snapshot had no row at all, so `GET /organization-units/:id/hierarchy`
 * answered an empty history for a brand-new unit and
 * `organization_unit_parent_at` could not answer for it either. A history table
 * that only records the past is not what §4.5 principle 7 asks for ("Riwayat
 * struktur adalah data").
 *
 * Two writes have to open or close a range, and both are placed in the database
 * rather than in one service, because more than one writer creates Organization
 * Units (the unit endpoint, the Legal Entity creation that inserts its root
 * Central in the same transaction, and fixture writers):
 *
 *   1. INSERT — the unit starts its life with one open range carrying its
 *      initial parent. The range's `effective_from` is the row's own creation
 *      instant, which is what makes the range honest: the structure was not in
 *      force before the unit existed.
 *   2. UPDATE of `parent_id` — if the publisher has already opened the new
 *      version (which is what `publishChangeRequest` does: it seals the old range
 *      and opens the new one BEFORE moving the column), the open range already
 *      names the new parent and this trigger does nothing. Any OTHER writer that
 *      moves `parent_id` directly still gets a correct history: the range in
 *      force is closed at `now()` and a new one is opened, so no writer can
 *      change the structure without the history saying so.
 *
 * A guarded backfill runs first, for the units created between the snapshot and
 * this trigger — in a database migrated from zero there are none, and in a
 * database that already served writes there may be; either way the invariant
 * after this migration is the same.
 *
 * ── Stamp ─────────────────────────────────────────────────────────────────
 *
 * 1789396000000/1789397000000 are the G0 contract's re-stamped M6/M9 slots, and
 * 1789398000000/1789399000000 carry this wave's content. This migration is the
 * same class of content (no contract slot), so it takes the next free stamp below
 * Wave 3's reserved M10 (1789400000000). Nothing above a reserved stamp is used,
 * and every stamp here is above Gelombang 1's last applied stamp, which is what
 * `node-pg-migrate` requires.
 *
 * Additive: one trigger, one function, and backfill only for rows that have no
 * history at all.
 */

exports.shorthands = undefined;

exports.up = (pgm) => {
  // Backfill: units created after the snapshot in 1789396000000 have no row.
  pgm.sql(`
    WITH snapshot AS (SELECT now() AS at)
    INSERT INTO organization_unit_hierarchy_history
      (tenant_id, organization_unit_id, parent_organization_unit_id,
       effective_from, effective_to, published_at, published_by, recorded_at,
       reason, created_at, updated_at)
    SELECT ou.tenant_id, ou.id, ou.parent_id,
           snapshot.at, NULL, snapshot.at, NULL, snapshot.at,
           'Epic 5 G2 history backfill — unit created after the parity snapshot',
           snapshot.at, snapshot.at
      FROM organization_units ou, snapshot
     WHERE NOT EXISTS (
       SELECT 1 FROM organization_unit_hierarchy_history h
        WHERE h.organization_unit_id = ou.id
     );
  `);

  pgm.sql(`
    CREATE OR REPLACE FUNCTION organization_units_sync_hierarchy_history()
    RETURNS trigger AS $trg$
    DECLARE
      open_id uuid;
      open_parent uuid;
      at timestamptz := now();
    BEGIN
      IF TG_OP = 'INSERT' THEN
        INSERT INTO organization_unit_hierarchy_history
          (tenant_id, organization_unit_id, parent_organization_unit_id,
           effective_from, effective_to, published_at, published_by, recorded_at,
           reason, created_by, updated_by)
        VALUES (NEW.tenant_id, NEW.id, NEW.parent_id,
                at, NULL, at, NEW.created_by, at,
                'Organization Unit created', NEW.created_by, NEW.created_by);
        RETURN NEW;
      END IF;

      -- UPDATE with no structural change: nothing to record.
      IF NEW.parent_id IS NOT DISTINCT FROM OLD.parent_id THEN
        RETURN NEW;
      END IF;

      SELECT id, parent_organization_unit_id
        INTO open_id, open_parent
        FROM organization_unit_hierarchy_history
       WHERE organization_unit_id = NEW.id AND effective_to IS NULL
       ORDER BY effective_from DESC
       LIMIT 1
       FOR UPDATE;

      -- The publisher already opened the version that names the new parent.
      IF open_id IS NOT NULL AND open_parent IS NOT DISTINCT FROM NEW.parent_id THEN
        RETURN NEW;
      END IF;

      IF open_id IS NOT NULL THEN
        UPDATE organization_unit_hierarchy_history
           SET effective_to = at, updated_by = NEW.updated_by, updated_at = at
         WHERE id = open_id;
      END IF;

      INSERT INTO organization_unit_hierarchy_history
        (tenant_id, organization_unit_id, parent_organization_unit_id,
         effective_from, effective_to, published_at, published_by, recorded_at,
         reason, created_by, updated_by)
      VALUES (NEW.tenant_id, NEW.id, NEW.parent_id,
              at, NULL, at, NEW.updated_by, at,
              'Parent changed outside a change request', NEW.updated_by, NEW.updated_by);
      RETURN NEW;
    END;
    $trg$ LANGUAGE plpgsql;

    CREATE TRIGGER trg_organization_units_sync_hierarchy_history
      AFTER INSERT OR UPDATE OF parent_id ON organization_units
      FOR EACH ROW EXECUTE FUNCTION organization_units_sync_hierarchy_history();
  `);

  // The read path walks one row per unit; the partial index keeps the "range in
  // force" lookup cheap for a large tree.
  pgm.sql(`
    CREATE INDEX IF NOT EXISTS organization_unit_hierarchy_history_open_idx
      ON organization_unit_hierarchy_history (organization_unit_id)
      WHERE effective_to IS NULL;
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    DROP INDEX IF EXISTS organization_unit_hierarchy_history_open_idx;
    DROP TRIGGER IF EXISTS trg_organization_units_sync_hierarchy_history ON organization_units;
    DROP FUNCTION IF EXISTS organization_units_sync_hierarchy_history();
  `);
};
