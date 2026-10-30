/**
 * Add preferred_locale column to users table.
 *
 * Cross-device locale persistence for bilingual UI (W0–W7).
 * Default 'id' per DESIGN.md §6: "Bahasa Indonesia untuk seluruh copy produk".
 * Column is NOT NULL with CHECK constraint to enforce valid values.
 */
exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE users
      ADD COLUMN preferred_locale TEXT NOT NULL DEFAULT 'id'
        CHECK (preferred_locale IN ('en', 'id'));
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    ALTER TABLE users DROP COLUMN preferred_locale;
  `);
};