/**
 * Checkpoint 1C.5 — Management Dashboard permission (FD-1C-02).
 *
 * Adds the generic, client-neutral Product Core permission the Management
 * Dashboard is gated on. `complaint.configure` is added to the catalog at
 * the same time (FD-1C-02 approved both) so the permission catalog is
 * complete and `sync-role-permissions` can grant them to is_full_access
 * roles in one pass — but its FUNCTIONAL use is reserved for Checkpoint
 * 1C.6 (Admin Configuration); nothing in 1C.5 enforces it.
 *
 * Data-only migration (no new table): the baseline table count is
 * unchanged. Additive and idempotent (WHERE NOT EXISTS), so it is safe on
 * an already-seeded database. After migrating, run
 * `npm run sync-permissions` to grant these to every is_full_access role
 * (e.g. ADMIN), exactly the ADR-0010 mechanism used for every prior
 * permission-adding migration.
 */
exports.up = (pgm) => {
  pgm.sql(`
    INSERT INTO permissions (code, description)
    SELECT v.code, v.description
      FROM (VALUES
        ('complaint.dashboard.read', 'View the Complaint Management Dashboard: aggregate KPIs, breakdowns, and action center (subject to Customer Data Scope)'),
        ('complaint.configure', 'Configure Complaint metadata/rules (reserved for Admin Configuration, Checkpoint 1C.6)')
      ) AS v(code, description)
     WHERE NOT EXISTS (SELECT 1 FROM permissions p WHERE p.code = v.code)
  `);
};

exports.down = (pgm) => {
  pgm.sql(`DELETE FROM permissions WHERE code IN ('complaint.dashboard.read', 'complaint.configure')`);
};
