/**
 * Epic 6 Gelombang 0 — Business Partner roles (2/8).
 *
 * Role flags per Business Partner. Each BP can have multiple roles
 * (e.g., a company can be both a Customer and a Vendor). Each role is
 * independently active/inactive.
 *
 * role_type enum covers all party archetypes: employee, customer, vendor,
 * service_provider, outsourcing_provider, salesperson, prospect.
 *
 * role_number is optional and role-specific: for an 'employee' role, it might
 * be the employee number; for a 'customer' role, it might be the customer
 * account number. Uniqueness per role_type + tenant is enforced at the
 * business logic layer.
 */
exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE bp_roles (
      id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id         UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      business_partner_id UUID NOT NULL,
      role_type         TEXT NOT NULL
        CHECK (role_type IN (
          'employee', 'customer', 'vendor', 'service_provider',
          'outsourcing_provider', 'salesperson', 'prospect'
        )),
      status            TEXT NOT NULL DEFAULT 'active'
        CHECK (status IN ('active', 'inactive')),
      role_number       TEXT NULL,
      created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE(tenant_id, business_partner_id, role_type),
      FOREIGN KEY (tenant_id, business_partner_id)
        REFERENCES business_partners(tenant_id, id) ON DELETE CASCADE
    );

    CREATE INDEX idx_bp_roles_tenant ON bp_roles(tenant_id);
    CREATE INDEX idx_bp_roles_business_partner ON bp_roles(business_partner_id);
    CREATE INDEX idx_bp_roles_tenant_status ON bp_roles(tenant_id, status);
    CREATE UNIQUE INDEX ux_bp_roles_tenant_type_number
      ON bp_roles(tenant_id, role_type, role_number)
      WHERE role_number IS NOT NULL;
  `);
};

exports.down = (pgm) => {
  pgm.dropTable("bp_roles", { ifExists: true });
};
