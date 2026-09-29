/**
 * Epic 5 Gelombang 2 (§4.5 step 10) — Parent-child effective-date history and
 * the current projection.
 *
 * G0 contract `docs/plans/epic-5-g0-contract.md` migration M6 (stamp re-assigned
 * to 1789396000000 by the 2026-09-29 re-stamp commit) plus §6 "History Parity
 * Snapshot".
 *
 * §4.5 principle 7 locks the shape: "Riwayat struktur adalah data. Parent-child
 * harus memiliki range effective date, tidak hanya satu `parent_id` current.
 * Transaksi dapat menjelaskan struktur yang berlaku pada tanggal bisnisnya."
 * `organization_units.parent_id` therefore becomes the CURRENT PROJECTION of
 * this table rather than the source of truth: it stays for compatibility (every
 * existing query reads it) and the projection view below is what proves the two
 * agree after a publish.
 *
 * ── Three claims, three mechanisms ────────────────────────────────────────
 *
 *  1. `organization_unit_hierarchy_history` holds one row per (Organization
 *     Unit, effective range). `effective_from` is the business date the parent
 *     link starts to hold; `effective_to` is exclusive and NULL means "still in
 *     force".
 *  2. `organization_unit_hierarchy_no_overlap` (EXCLUDE USING gist) makes an
 *     overlapping range for the same unit unrepresentable — §4.5 structure
 *     limit: "Tidak boleh ada cycle, overlap rentang parent efektif, atau
 *     perubahan historis yang membuat root ganda." The upper bound is exclusive
 *     (`'[)'`), so a back-to-back publish is legal and a same-instant publish is
 *     not: with `effective_from` equal to an existing `effective_from`, the two
 *     ranges would both contain that instant.
 *  3. `organization_unit_parent_at(unit, at)` answers "which parent did this
 *     unit have on that business date" — the read the historical reports need
 *     (`§4.5`: "Laporan periode ... tidak boleh berubah diam-diam"). It is the
 *     single place the effective-date rule is written, so no caller re-derives
 *     it.
 *
 * ── Why `published_at` is separate from `effective_from` ──────────────────
 *
 * §4.5 principle 8: "Backdate tidak menyembunyikan waktu pencatatan. Backdate
 * hierarchy wajib menyimpan effective date, recorded/published date, actor,
 * reason, dan dampak. Audit tidak pernah di-backdate." A backdated publish has
 * `effective_from < published_at`; a future-dated one has `effective_from >
 * published_at`. Both are one row here, and the pair is what makes a correction
 * distinguishable from what the system knew at the time — the distinction §4.5
 * G requires reports to keep.
 *
 * ── Parity snapshot (G0 §6) ───────────────────────────────────────────────
 *
 * Every existing Organization Unit gets exactly one open row carrying its
 * current `parent_id`, so turning effective-dated reads on does not change a
 * single answer: the projection view resolves to the same hierarchy that
 * `parent_id` states today. Taken in one statement with ONE timestamp, so a
 * unit and its parent cannot land on different `effective_from` values.
 *
 * ── Ownership and delete semantics ────────────────────────────────────────
 *
 * `tenant_id` cascades from `tenants` for the same reason every other tenant
 * child does: destroying the Tenant boundary destroys its content. The unit
 * link is `ON DELETE CASCADE` rather than the contract's RESTRICT, and the
 * reason is stated rather than hidden: a history row is the unit's OWN
 * structural record, not an external business reference, and the reference
 * census that decides physical-delete eligibility (1789397000000) counts
 * external references only. A unit that is eligible for a physical delete has
 * no business references by definition, so its own structural rows go with it;
 * a unit that has any business reference can never reach a physical delete and
 * therefore never loses a history row either. Under RESTRICT every Tenant
 * teardown would abort (measured in G1, `1789320000000` header) — the same
 * accepted-risk class the Founder signed off for the address FK.
 *
 * Additive only: one table, three indexes, two functions, one backfill.
 */

exports.shorthands = undefined;

const REASON = "Epic 5 G2 parity snapshot — hierarchy state before effective-dated reads";

exports.up = (pgm) => {
  // The EXCLUDE constraint below needs gist index support for plain scalars.
  // Already installed by 1788500000000; this is a no-op there and keeps the
  // migration runnable on a database that only reaches this stamp.
  pgm.sql(`CREATE EXTENSION IF NOT EXISTS btree_gist;`);

  pgm.createTable("organization_unit_hierarchy_history", {
    id: { type: "uuid", primaryKey: true, default: pgm.func("gen_random_uuid()") },
    tenant_id: { type: "uuid", notNull: true, references: "tenants", onDelete: "CASCADE" },
    organization_unit_id: { type: "uuid", notNull: true },
    parent_organization_unit_id: { type: "uuid" },
    effective_from: { type: "timestamptz", notNull: true },
    effective_to: { type: "timestamptz" },
    // Null means "not in force any more". NULL is the OPEN range, so a unit has
    // at most one live parent link at a time.
    published_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
    published_by: { type: "uuid" },
    recorded_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
    reason: { type: "text", notNull: true },
    change_request_id: { type: "uuid" },
    created_by: { type: "uuid" },
    created_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
    updated_by: { type: "uuid" },
    updated_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
  });

  pgm.addConstraint("organization_unit_hierarchy_history", "organization_unit_hierarchy_history_range_check", {
    check: "effective_to IS NULL OR effective_to > effective_from",
  });

  // Composite FKs: the same-database ownership rule the rest of the schema uses
  // (`(tenant_id, id)` on organization_units, added by 1789310000000/1779000000000).
  pgm.sql(`
    ALTER TABLE organization_unit_hierarchy_history
      ADD CONSTRAINT organization_unit_hierarchy_history_unit_fkey
      FOREIGN KEY (tenant_id, organization_unit_id)
      REFERENCES organization_units (tenant_id, id)
      ON DELETE CASCADE;

    ALTER TABLE organization_unit_hierarchy_history
      ADD CONSTRAINT organization_unit_hierarchy_history_parent_fkey
      FOREIGN KEY (tenant_id, parent_organization_unit_id)
      REFERENCES organization_units (tenant_id, id)
      ON DELETE SET NULL (parent_organization_unit_id);

    ALTER TABLE organization_unit_hierarchy_history
      ADD CONSTRAINT organization_unit_hierarchy_no_overlap
      EXCLUDE USING gist (
        organization_unit_id WITH =,
        tstzrange(effective_from, effective_to, '[)') WITH &&
      );
  `);

  pgm.createIndex("organization_unit_hierarchy_history", ["organization_unit_id", "effective_from"], {
    name: "organization_unit_hierarchy_history_unit_from_idx",
  });
  pgm.createIndex("organization_unit_hierarchy_history", ["tenant_id", "parent_organization_unit_id"], {
    name: "organization_unit_hierarchy_history_parent_idx",
  });

  // 1. Parity snapshot: one open row per existing unit, one timestamp for all.
  pgm.sql(`
    WITH snapshot AS (SELECT now() AS at)
    INSERT INTO organization_unit_hierarchy_history
      (tenant_id, organization_unit_id, parent_organization_unit_id,
       effective_from, effective_to, published_at, published_by, recorded_at,
       reason, created_at, updated_at)
    SELECT ou.tenant_id, ou.id, ou.parent_id,
           snapshot.at, NULL, snapshot.at, NULL, snapshot.at,
           '${REASON}', snapshot.at, snapshot.at
      FROM organization_units ou, snapshot;
  `);

  // 2. The effective-date read. NULL when the unit did not exist yet on that
  //    date, so a caller can tell "no parent then" from "not known then".
  pgm.sql(`
    CREATE OR REPLACE FUNCTION organization_unit_parent_at(p_unit uuid, p_at timestamptz)
    RETURNS uuid AS $fn$
      SELECT h.parent_organization_unit_id
        FROM organization_unit_hierarchy_history h
       WHERE h.organization_unit_id = p_unit
         AND h.effective_from <= p_at
         AND (h.effective_to IS NULL OR h.effective_to > p_at)
       ORDER BY h.effective_from DESC
       LIMIT 1;
    $fn$ LANGUAGE sql STABLE;
  `);

  // 3. The current projection. `organization_units.parent_id` is kept in step
  //    with this view by the publish path; the view is the definition other
  //    readers (scope walks, validation) can rely on.
  pgm.sql(`
    CREATE OR REPLACE VIEW organization_unit_current_hierarchy AS
      SELECT h.tenant_id,
             h.organization_unit_id,
             h.parent_organization_unit_id AS parent_id,
             h.effective_from,
             h.published_at,
             h.published_by
        FROM organization_unit_hierarchy_history h
       WHERE h.effective_to IS NULL;
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    DROP VIEW IF EXISTS organization_unit_current_hierarchy;
    DROP FUNCTION IF EXISTS organization_unit_parent_at(uuid, timestamptz);
    DROP TABLE IF EXISTS organization_unit_hierarchy_history;
  `);
};
