/**
 * Epic 4 Wave 1 — Role-to-window configuration (CORE-ROADMAP.md §4.4,
 * Gelombang 1 step 11a).
 *
 * This table configures which registered application windows a Role may use.
 * Runtime window enforcement is deliberately not enabled in this wave; the
 * API returns enforcementStatus: 'not_enforced' until the later guard wave.
 *
 * Tenant ownership is explicit on every row. The Role foreign key is composite
 * so a row can never bind a Role from another Tenant. Deleting a Role cascades
 * its configuration; deleting a Tenant cascades its owned rows. Dictionary
 * deletion remains restrictive through the app_windows foreign key, so a
 * configured window cannot disappear silently. No grants or backfill rows are
 * written here.
 *
 * PostgreSQL requires the referenced column pair of a composite foreign key to
 * carry a unique constraint that matches it exactly. `roles` historically has
 * only `roles_pkey (id)` and `roles_tenant_code_unique (tenant_id, code)`, so
 * this migration also adds `roles_id_tenant_unique (id, tenant_id)` before the
 * composite key can reference it. Semantically redundant (id is already the
 * primary key) but structurally required by PostgreSQL.
 */
exports.up = (pgm) => {
  pgm.addConstraint("roles", "roles_id_tenant_unique", {
    unique: ["id", "tenant_id"],
  });

  pgm.createTable("role_window_access", {
    tenant_id: {
      type: "uuid",
      notNull: true,
      references: "tenants",
      onDelete: "CASCADE",
    },
    role_id: {
      type: "uuid",
      notNull: true,
    },
    window_code: {
      type: "text",
      notNull: true,
    },
    is_read_write: {
      type: "boolean",
      notNull: true,
      default: false,
    },
    is_active: {
      type: "boolean",
      notNull: true,
      default: true,
    },
  });

  pgm.addConstraint("role_window_access", "role_window_access_pk", {
    primaryKey: ["role_id", "window_code"],
  });
  pgm.addConstraint("role_window_access", "role_window_access_role_fk", {
    foreignKeys: {
      columns: ["role_id", "tenant_id"],
      references: "roles(id, tenant_id)",
      onDelete: "CASCADE",
    },
  });
  // RESTRICT (not the default NO ACTION) so deleting a dictionary Window that
  // a Role is configured against fails loudly instead of silently dropping the
  // configuration, matching the roadmap's "no silent cascade" rule.
  pgm.addConstraint("role_window_access", "role_window_access_window_fk", {
    foreignKeys: {
      columns: ["tenant_id", "window_code"],
      references: "app_windows(tenant_id, code)",
      onDelete: "RESTRICT",
    },
  });
};

exports.down = (pgm) => {
  // The table must go first: its composite foreign key depends on
  // roles_id_tenant_unique, so the constraint cannot be dropped while rows
  // (or the FK itself) still reference it.
  pgm.dropTable("role_window_access");
  pgm.dropConstraint("roles", "roles_id_tenant_unique");
};
