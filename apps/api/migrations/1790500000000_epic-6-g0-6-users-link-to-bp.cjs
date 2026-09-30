/**
 * Epic 6 Gelombang 0 — Link users to Business Partners (6/8).
 *
 * Extends the `users` table with:
 * - business_partner_id: optional FK to Business Partner. A User may have no
 *   BP link (e.g., system integrations, super admin). When present, the User
 *   represents that BP's login account (or a Contact's login).
 * - user_type: categorizes the user account for role assignment constraints.
 *   'internal' = employee/admin (default, can use all role types within tenant).
 *   'external' = customer/vendor contact (limited to external_role roles).
 *   'integration' = service-to-service (limited to integration_role roles).
 *   'superadmin' = platform super admin (can see/manage all tenants).
 *
 * Columns added as nullable with a NOT NULL DEFAULT so existing rows are
 * unaffected.
 */
exports.up = (pgm) => {
  pgm.addColumn("users", {
    business_partner_id: { type: "UUID" },
    user_type: {
      type: "TEXT",
      notNull: true,
      default: "internal",
      check: "user_type IN ('internal', 'external', 'integration', 'superadmin')",
    },
  });

  // Composite FK: a User's business_partner_id must belong to the same
  // Tenant. A single-column FK to business_partners(id) would let a row
  // with tenant_id = Tenant A point at a BP owned by Tenant B.
  pgm.sql(`
    ALTER TABLE users
      ADD CONSTRAINT users_business_partner_tenant_fk
      FOREIGN KEY (tenant_id, business_partner_id)
      REFERENCES business_partners(tenant_id, id)
      ON DELETE SET NULL (business_partner_id);
  `);

  pgm.createIndex("users", ["business_partner_id"]);
  pgm.createIndex("users", ["tenant_id", "user_type"]);
};

exports.down = (pgm) => {
  pgm.dropIndex("users", ["business_partner_id"]);
  pgm.dropIndex("users", ["tenant_id", "user_type"]);
  pgm.dropConstraint("users", "users_business_partner_tenant_fk");
  pgm.dropColumn("users", "business_partner_id");
  pgm.dropColumn("users", "user_type");
};
