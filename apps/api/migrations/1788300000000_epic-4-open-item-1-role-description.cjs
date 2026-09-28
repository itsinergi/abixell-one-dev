/**
 * Epic 4 open item 1 — editable Role metadata (CORE-ROADMAP.md §4.4).
 *
 * The item asked which Role fields a tenant may edit besides `code` and the
 * permission set. Settled 2026-09-28: `name` and `description`. `code` stays
 * fixed because it appears in operator-facing error messages and in audit
 * metadata, where a rename would silently rewrite the meaning of an existing
 * record; permissions keep their own governed path (`role_permissions` plus
 * the window mapping), not a free-text field.
 *
 * `description` is deliberately NULLABLE and carries no default. A Role that
 * never had a description reads back as `null`, which is a different fact from
 * "someone typed an empty string", and the API surfaces that distinction
 * rather than flattening it.
 *
 * This is METADATA, not authorization. Nothing in the effective-assignment
 * view, the delegation ceiling, or the window mapping reads this column, so
 * the migration adds a column and stops. 1787700000000 declined to add a
 * second column here precisely because this item was still open; the comment
 * there named the condition for revisiting it, and this migration is that.
 */
exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.sql(`
    -- Same exclusive lifecycle-table window as the Epic 4 migrations before
    -- it, so the ALTER cannot interleave with a governed Role write that is
    -- mid-transaction against the same catalog.
    LOCK TABLE roles IN ACCESS EXCLUSIVE MODE;

    ALTER TABLE roles ADD COLUMN description text;

    -- Bounded for the same reason every free-text field the operator controls
    -- is bounded: an unbounded column becomes storage. 500 matches the
    -- revocation reason's ceiling, which is the other operator-authored
    -- string in this feature area.
    ALTER TABLE roles
      ADD CONSTRAINT roles_description_length_check
      CHECK (description IS NULL OR char_length(description) <= 500);
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    LOCK TABLE roles IN ACCESS EXCLUSIVE MODE;

    ALTER TABLE roles DROP CONSTRAINT IF EXISTS roles_description_length_check;
    ALTER TABLE roles DROP COLUMN IF EXISTS description;
  `);
};
