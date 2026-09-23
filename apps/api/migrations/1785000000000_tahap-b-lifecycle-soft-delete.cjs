/**
 * Tahap B — Lifecycle soft-delete and activation/deactivation.
 *
 * Adds lifecycle properties to Organization Units, Legal Entities, and Users:
 * - is_active (boolean, default true) + deactivated_at/deactivated_by for OU and LE.
 * - deactivated_at/deactivated_by for users (status TEXT already exists).
 *
 * New permissions: organization_unit.{update,activate,deactivate},
 * legal_entity.{update,activate,deactivate},
 * user.update, user.email.update, user.password.reset,
 * user.{activate,deactivate,delete}.
 *
 * Schema follows existing conventions:
 * - is_active BOOLEAN NOT NULL DEFAULT true (matches service_definitions, positions, etc.).
 * - Soft-delete via deleted_at/deleted_by (existing pattern for documents, users, etc.).
 * - Deactivation tracked separately: deactivated_at/deactivated_by.
 */

exports.up = (pgm) => {
  // --- Organization Units: Add lifecycle columns ---
  pgm.addColumns("organization_units", {
    is_active: {
      type: "boolean",
      notNull: true,
      default: true,
    },
    deactivated_at: {
      type: "timestamptz",
    },
    deactivated_by: {
      type: "uuid",
    },
  });

  // --- Legal Entities: Add lifecycle columns ---
  pgm.addColumns("legal_entities", {
    is_active: {
      type: "boolean",
      notNull: true,
      default: true,
    },
    deactivated_at: {
      type: "timestamptz",
    },
    deactivated_by: {
      type: "uuid",
    },
  });

  // --- Users: Add deactivation tracking columns ---
  pgm.addColumns("users", {
    deactivated_at: {
      type: "timestamptz",
    },
    deactivated_by: {
      type: "uuid",
    },
  });

  // --- Insert new permissions into the global catalog ---
  // Tahap B approved permissions: OU/LE activate/deactivate (no delete),
  // granular user permissions (name, email, password, activate, deactivate, delete).
  pgm.sql(`
    INSERT INTO permissions (code, description) VALUES
      ('organization_unit.update', 'Edit Organization Unit'),
      ('organization_unit.activate', 'Activate Organization Unit'),
      ('organization_unit.deactivate', 'Deactivate Organization Unit'),
      ('legal_entity.update', 'Edit Legal Entity'),
      ('legal_entity.activate', 'Activate Legal Entity'),
      ('legal_entity.deactivate', 'Deactivate Legal Entity'),
      ('user.update', 'Update User Profile (name)'),
      ('user.email.update', 'Update User Email'),
      ('user.password.reset', 'Reset User Password'),
      ('user.activate', 'Activate User'),
      ('user.deactivate', 'Deactivate User'),
      ('user.delete', 'Delete User')
    ON CONFLICT (code) DO NOTHING;
  `);
};

exports.down = (pgm) => {
  // --- Remove new permissions ---
  // up() used ON CONFLICT DO NOTHING, so a code may predate this migration
  // or have been granted to a role since. Only drop codes this migration
  // introduced AND that no role still references.
  pgm.sql(`
    DELETE FROM permissions p
    WHERE p.code IN (
      'organization_unit.update',
      'organization_unit.activate',
      'organization_unit.deactivate',
      'legal_entity.update',
      'legal_entity.activate',
      'legal_entity.deactivate',
      'user.update',
      'user.email.update',
      'user.password.reset',
      'user.activate',
      'user.deactivate',
      'user.delete'
    )
    AND NOT EXISTS (
      SELECT 1 FROM role_permissions rp WHERE rp.permission_id = p.id
    );
  `);

  // --- Remove columns from users ---
  pgm.dropColumns("users", ["deactivated_at", "deactivated_by"]);

  // --- Remove columns from legal_entities ---
  pgm.dropColumns("legal_entities", ["is_active", "deactivated_at", "deactivated_by"]);

  // --- Remove columns from organization_units ---
  pgm.dropColumns("organization_units", ["is_active", "deactivated_at", "deactivated_by"]);
};
