/**
 * Epic 6 Gelombang 0 — Tax registrations (5/8).
 *
 * Tax registration collection, child of either a Business Partner or a Legal
 * Entity (but not both). Composite CHECK ensures exactly one parent.
 *
 * tax_type: 'npwp' (Nomor Pokok Wajib Pajak — Indonesia main tax ID),
 * 'nitku' (NITU Kecil Usaha — micro-enterprise ID), 'vat', etc.
 *
 * normalized_number: the tax_type-specific normalized form for comparison
 * and lookup (e.g., NPWP without hyphens/spaces). Uniqueness applies to
 * normalized_number per (jurisdiction, tax_type, owner).
 *
 * Effective-dated: effective_from … effective_to (null = current). One active
 * NPWP per owner+jurisdiction is enforced by a partial unique index.
 *
 * registered_address_id is optional: if present, references a bp_address
 * (the registered address for the tax ID). Can be NULL if unknown.
 *
 * supporting_doc_ref: free-form reference (URL, document code, etc.) to
 * where the supporting document is stored (future: document/file epic).
 *
 * Composite FKs enforce cross-Tenant ownership:
 * - (tenant_id, business_partner_id) → business_partners(tenant_id, id)
 * - (tenant_id, legal_entity_id) → legal_entities(tenant_id, id)
 * - (tenant_id, registered_address_id) → bp_addresses(tenant_id, id)
 * A row naming Tenant A but pointing at a BP/LE/Address in Tenant B is
 * unrepresentable, so the constraint itself is the ownership gate.
 */
exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE tax_registrations (
      id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id             UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      business_partner_id   UUID NULL,
      legal_entity_id       UUID NULL,
      jurisdiction          TEXT NOT NULL DEFAULT 'ID',
      tax_type              TEXT NOT NULL,
      registration_number   TEXT NOT NULL,
      normalized_number     TEXT NOT NULL,
      issuing_authority     TEXT NULL,
      registered_address_id UUID NULL,
      effective_from        DATE NOT NULL DEFAULT CURRENT_DATE,
      effective_to          DATE NULL,
      is_primary            BOOLEAN NOT NULL DEFAULT FALSE,
      verification_status   TEXT NOT NULL DEFAULT 'unverified'
        CHECK (verification_status IN ('unverified', 'verified', 'rejected')),
      supporting_doc_ref    TEXT NULL,
      created_by            UUID NULL,
      created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_by            UUID NULL,
      updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
      CHECK (
        (business_partner_id IS NOT NULL AND legal_entity_id IS NULL) OR
        (business_partner_id IS NULL AND legal_entity_id IS NOT NULL)
      ),
      FOREIGN KEY (tenant_id, business_partner_id)
        REFERENCES business_partners(tenant_id, id) ON DELETE CASCADE,
      FOREIGN KEY (tenant_id, legal_entity_id)
        REFERENCES legal_entities(tenant_id, id) ON DELETE CASCADE,
      FOREIGN KEY (tenant_id, registered_address_id)
        REFERENCES bp_addresses(tenant_id, id) ON DELETE SET NULL (registered_address_id)
    );

    CREATE UNIQUE INDEX ux_tax_reg_one_npwp_per_owner
      ON tax_registrations(
        jurisdiction,
        tax_type,
        normalized_number,
        COALESCE(business_partner_id::text, ''),
        COALESCE(legal_entity_id::text, '')
      )
      WHERE effective_to IS NULL AND tax_type = 'npwp';

    CREATE INDEX idx_tax_registrations_tenant ON tax_registrations(tenant_id);
    CREATE INDEX idx_tax_registrations_business_partner ON tax_registrations(business_partner_id);
    CREATE INDEX idx_tax_registrations_legal_entity ON tax_registrations(legal_entity_id);
    CREATE INDEX idx_tax_registrations_effective ON tax_registrations(COALESCE(business_partner_id::text, COALESCE(legal_entity_id::text, '')), effective_from DESC);
  `);
};

exports.down = (pgm) => {
  pgm.dropTable("tax_registrations", { ifExists: true });
};
