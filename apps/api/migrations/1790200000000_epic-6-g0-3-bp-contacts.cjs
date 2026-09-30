/**
 * Epic 6 Gelombang 0 — Business Partner contacts (3/8).
 *
 * Contacts are persons associated with an Organization-type Business Partner.
 * Individuals (bp_type = 'individual') do not have contacts; an Individual's
 * own name/email/phone are on the Business Partner record or Employee Profile.
 *
 * Each contact has a multi-value `purpose` array (primary, billing, shipping,
 * operational, portal_admin, etc.). A single contact can serve multiple purposes.
 *
 * linked_user_id is optional and one-to-one per tenant: a Contact may become
 * a platform User (for portal login). The uniqueness is enforced at the
 * application layer (only one User per Contact per Tenant).
 *
 * Lifecycle: draft → active → inactive. An Inactive contact with a linked User
 * triggers the User suspension (default safe action).
 */
exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE bp_contacts (
      id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id         UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      business_partner_id UUID NOT NULL,
      full_name         TEXT NOT NULL,
      email             TEXT NULL,
      phone             TEXT NULL,
      purpose           TEXT[] NOT NULL DEFAULT ARRAY['primary'::text],
      status            TEXT NOT NULL DEFAULT 'draft'
        CHECK (status IN ('draft', 'active', 'inactive')),
      linked_user_id    UUID NULL,
      created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
      FOREIGN KEY (tenant_id, business_partner_id)
        REFERENCES business_partners(tenant_id, id) ON DELETE CASCADE,
      FOREIGN KEY (tenant_id, linked_user_id)
        REFERENCES users(tenant_id, id) ON DELETE SET NULL (linked_user_id)
    );

    CREATE INDEX idx_bp_contacts_tenant ON bp_contacts(tenant_id);
    CREATE INDEX idx_bp_contacts_business_partner ON bp_contacts(business_partner_id);
    CREATE INDEX idx_bp_contacts_linked_user ON bp_contacts(tenant_id, linked_user_id);
    -- Partial unique index: WHERE clause not allowed on inline table UNIQUE
    -- constraints, so a separate index enforces one User per Tenant per Contact.
    CREATE UNIQUE INDEX ux_bp_contacts_tenant_linked_user
      ON bp_contacts(tenant_id, linked_user_id) WHERE linked_user_id IS NOT NULL;
  `);
};

exports.down = (pgm) => {
  pgm.dropTable("bp_contacts", { ifExists: true });
};
