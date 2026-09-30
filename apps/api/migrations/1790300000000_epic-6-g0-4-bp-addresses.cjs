/**
 * Epic 6 Gelombang 0 — Business Partner addresses (4/8).
 *
 * Address collection for Business Partners (and can be referenced by Tax
 * Registrations). Follows the effective-dated pattern from Legal Entity:
 * effective_from … effective_to (null = current).
 *
 * Address types: primary, billing, shipping, registered, operating, tax, etc.
 * (free-form by design; tenant configuration can extend the vocabulary).
 *
 * is_primary is a convenience flag: at most one address per type+BP should have
 * is_primary = true at any given time. Enforcement is at the application layer.
 *
 * When an address changes (e.g., new registered address), the old one is
 * deactivated (effective_to set to today), and a new row is inserted. History
 * is never overwritten.
 */
exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE bp_addresses (
      id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id         UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      business_partner_id UUID NOT NULL,
      address_type      TEXT NOT NULL DEFAULT 'primary',
      line_1            TEXT NOT NULL,
      line_2            TEXT NULL,
      city              TEXT NULL,
      state             TEXT NULL,
      postal_code       TEXT NULL,
      country_code      TEXT NOT NULL DEFAULT 'ID',
      effective_from    DATE NOT NULL DEFAULT CURRENT_DATE,
      effective_to      DATE NULL,
      is_primary        BOOLEAN NOT NULL DEFAULT FALSE,
      created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE(tenant_id, id),
      FOREIGN KEY (tenant_id, business_partner_id)
        REFERENCES business_partners(tenant_id, id) ON DELETE CASCADE
    );

    CREATE INDEX idx_bp_addresses_tenant ON bp_addresses(tenant_id);
    CREATE INDEX idx_bp_addresses_business_partner ON bp_addresses(business_partner_id);
    CREATE INDEX idx_bp_addresses_effective ON bp_addresses(business_partner_id, effective_from DESC);
    -- Partial unique index: WHERE clause not allowed on inline table UNIQUE
    -- constraints. Keeps one primary address per type per BP at a time.
    CREATE UNIQUE INDEX ux_bp_addresses_one_primary
      ON bp_addresses(tenant_id, business_partner_id, address_type)
      WHERE is_primary = true AND effective_to IS NULL;
  `);
};

exports.down = (pgm) => {
  pgm.dropTable("bp_addresses", { ifExists: true });
};
