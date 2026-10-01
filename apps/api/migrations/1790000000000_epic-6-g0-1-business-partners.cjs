/**
 * Epic 6 Gelombang 0 — Business Partner canonical party (1/8).
 *
 * Introduces `business_partners` table as the canonical source for all party
 * types: individuals (employees, customers, etc.) and organizations (vendors,
 * service providers, outsourcing partners, etc.).
 *
 * Lifecycle status follows Legal Entity model: draft → active → inactive →
 * tombstone → deleted. The `code` field is unique per tenant and serves as the
 * human-readable business partner identifier (e.g., "BP-00001", "CUST-ACME").
 *
 * The `is_active` boolean is a convenience denormalization (true iff
 * lifecycle_status = 'active'). Always keep them in sync.
 *
 * bp_group_id is reserved for future hierarchical grouping (e.g., if a
 * holding company owns multiple BPs). Currently NULL.
 *
 * UNIQUE(tenant_id, id) lets every child table (bp_roles, bp_contacts,
 * bp_addresses, tax_registrations, employee_profiles) declare a composite
 * FK `(tenant_id, business_partner_id) REFERENCES business_partners(tenant_id,
 * id)`, so a child row naming a different Tenant than its BP is
 * unrepresentable. Same pattern as `legal_entities_tenant_id_id_unique`.
 */
exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE business_partners (
      id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id         UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      code              TEXT NOT NULL,
      bp_type           TEXT NOT NULL
        CHECK (bp_type IN ('individual', 'organization')),
      name              TEXT NOT NULL,
      bp_group_id       UUID NULL,
      lifecycle_status  TEXT NOT NULL DEFAULT 'draft'
        CHECK (lifecycle_status IN ('draft', 'active', 'inactive', 'tombstone', 'deleted')),
      is_active         BOOLEAN NOT NULL DEFAULT FALSE,
      created_by        UUID NULL,
      created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_by        UUID NULL,
      updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
      deleted_at        TIMESTAMPTZ NULL,
      deleted_by        UUID NULL,
      UNIQUE(tenant_id, code),
      UNIQUE(tenant_id, id)
    );

    CREATE INDEX idx_business_partners_tenant ON business_partners(tenant_id);
    CREATE INDEX idx_business_partners_tenant_status ON business_partners(tenant_id, lifecycle_status);
    CREATE INDEX idx_business_partners_tenant_active ON business_partners(tenant_id, is_active);
    CREATE INDEX idx_business_partners_code ON business_partners(tenant_id, code);
  `);
};

exports.down = (pgm) => {
  pgm.dropTable("business_partners", { ifExists: true });
};
