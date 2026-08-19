/**
 * Checkpoint 1D.1 — Survey Engine permissions (FD-1D-01).
 *
 * Adds the three generic, client-neutral Product Core permissions. Kept as a
 * SEPARATE data-only migration from the schema (clear separation, §23).
 * Additive + idempotent (WHERE NOT EXISTS), so safe on an already-seeded DB.
 * After migrating, run `npm run sync-permissions` to grant them to every
 * is_full_access role (ADR-0010), same mechanism as the 1C.5 permission
 * migration. Roles that are curated (not full-access) are granted explicitly
 * in the seed — never mechanically here.
 */
exports.up = (pgm) => {
  pgm.sql(`
    INSERT INTO permissions (code, description)
    SELECT v.code, v.description
      FROM (VALUES
        ('survey.manage', 'Create/version/publish/retire Survey Definitions and create Survey Assignments'),
        ('survey.respond', 'Respond to (save/submit) Survey Assignments assigned to oneself'),
        ('survey.results.read', 'View Survey results/scores (subject to tenant and any context Data Scope)')
      ) AS v(code, description)
     WHERE NOT EXISTS (SELECT 1 FROM permissions p WHERE p.code = v.code)
  `);
};

exports.down = (pgm) => {
  pgm.sql(`DELETE FROM permissions WHERE code IN ('survey.manage', 'survey.respond', 'survey.results.read')`);
};
