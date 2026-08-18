/**
 * Checkpoint 0A — connectivity scaffold only.
 *
 * This migration intentionally creates no business tables yet. Domain
 * tables (tenants, legal_entities, organization_units, users, roles, ...)
 * are introduced in Checkpoint 0B per
 * 01-Tenant-Legal-Entity-Organization-Model.md and
 * 02-Identity-Security-RBAC-Foundation.md. It only enables the extension
 * every future table will need for primary keys, proving the migration
 * pipeline works end-to-end against the real database.
 */

exports.up = (pgm) => {
  pgm.createExtension("pgcrypto", { ifNotExists: true });
};

exports.down = (pgm) => {
  pgm.dropExtension("pgcrypto", { ifExists: true });
};
