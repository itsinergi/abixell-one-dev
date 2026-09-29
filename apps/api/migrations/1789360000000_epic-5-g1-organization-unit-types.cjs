/**
 * Epic 5 Gelombang 1 (§4.5 step 5, "Jenis Organization Unit") — Platform-owned
 * Organization Unit types with a tenant-facing label.
 *
 * G0 contract `docs/plans/epic-5-g0-contract.md` migration M7.
 *
 * Locked decision (§4.5 Putaran 2): "Jenis inti dan aturan hierarchy dikunci
 * platform; Tenant boleh mengganti label lewat terminology yang diizinkan."
 * The platform core set is the one §4.5's target model draws: `Central`,
 * `Region`, `Internal Site/Branch`. `unit_type` becomes that closed set for new
 * work (security never reads free text) and `unit_type_label` carries the
 * tenant-facing name.
 *
 * ── Existing rows are inventoried, NOT rewritten ──────────────────────────
 *
 * An earlier draft of this migration normalised existing `unit_type` values in
 * place: it copied each non-core value into `unit_type_label` and then set the
 * core equivalent. That is a data rewrite of a business field, and the
 * operator's guard for this wave forbids it: "unit_type lama TIDAK boleh
 * diubah/dihapus — hanya inventaris dan laporkan ke Founder." Rewriting them
 * would also destroy the evidence the Founder needs to decide how each legacy
 * type maps, and it would silently reclassify 20 Organization Units typed
 * `department` — which §4.5 says are not Organization Units at all. The
 * rewrite is therefore removed. This migration only:
 *
 *   1. adds `unit_type_label` (additive, for tenant terminology);
 *   2. moves the column default to `'Internal Site'` (affects new rows only —
 *      `ALTER COLUMN ... SET DEFAULT` does not touch stored values);
 *   3. adds the CHECK **`NOT VALID`**, so it constrains every future write and
 *      validates nothing that is already stored.
 *
 * ── Inventory (measured on the legacy copy, never on `abixell_one_dev`) ────
 *
 *   'Organization Unit'  458 rows    ← the old column default
 *   'department'          20 rows    ← §4.5: a Department is NOT an OU
 *   'Head Office'          1 row
 *   'Site'                 1 row
 *
 * Those four spellings are listed in `GRANDFATHERED_TYPES` so a legacy row can
 * still be edited through the API (a row that is UPDATEd must satisfy the
 * constraint) without this migration deciding what it *should* have been.
 * They are grandfathered, not adopted: the Founder decides the mapping, and
 * Gelombang 2's hierarchy validation (§4.5 step 12) is where a normalisation
 * with a stated mapping would belong. Recorded in the task report for the
 * Founder: 480 of 480 Organization Units carry a non-core `unit_type` today,
 * and 45 Legal Entities have two parentless units, so "exactly one Central per
 * Legal Entity" is true for newly created Legal Entities and **not yet** true
 * for existing ones — a backfill is a Founder decision, not a migration
 * side-effect.
 *
 * ── Widen or narrow later ─────────────────────────────────────────────────
 *
 * Adding a fifth core type is a DROP + ADD of the CHECK (the audit's point 2:
 * constraint replacement is a metadata rebuild, not an additive append), which
 * is why the allowed set is written exactly once, in the two constants below.
 *
 * Additive: one column, one default, one constraint. No row is modified, none
 * is deleted, and no parent link changes.
 */

exports.shorthands = undefined;

/** The platform set for new work (§4.5 target model). */
const CORE_TYPES = "'Central','Region','Internal Site'";

/**
 * Spellings that already exist in stored data and in other suites' fixtures.
 * Accepted so nothing that exists today becomes un-editable; no value here is
 * promoted to a core type by this migration.
 */
const GRANDFATHERED_TYPES = "'Organization Unit','department','Head Office','Site','Branch'";

exports.up = (pgm) => {
  pgm.addColumn("organization_units", { unit_type_label: { type: "text" } });

  pgm.sql(`ALTER TABLE organization_units ALTER COLUMN unit_type SET DEFAULT 'Internal Site';`);

  // NOT VALID: stored rows are never validated, so legacy free text survives
  // untouched; every INSERT/UPDATE from now on must land in the allowed set.
  pgm.sql(`
    ALTER TABLE organization_units
      ADD CONSTRAINT organization_units_unit_type_check
      CHECK (unit_type IN (${CORE_TYPES}) OR unit_type IN (${GRANDFATHERED_TYPES}))
      NOT VALID;
  `);
};

exports.down = (pgm) => {
  pgm.sql(`ALTER TABLE organization_units DROP CONSTRAINT organization_units_unit_type_check;`);
  pgm.sql(`ALTER TABLE organization_units ALTER COLUMN unit_type SET DEFAULT 'Organization Unit';`);
  pgm.dropColumn("organization_units", "unit_type_label");
};
