/**
 * Epic 6 Gelombang 0 — Employee Profile extension table (8/8).
 *
 * Employee Profile is a role-specific profile for a Business Partner with an
 * 'employee' role. One Employee Profile per Business Partner (one-to-one).
 *
 * Fields:
 * - employment_type: permanent, contract, outsourced, intern, freelance
 *   (tenant-configurable reference data; Product Core lists the standard set).
 * - employee_number: role-specific ID (unique per tenant).
 * - hire_date, end_date: employment tenure.
 * - status: lifecycle (draft → active → on_leave → suspended → ended).
 * - sensitive_data: JSONB for fields masked in general projections
 *   (e.g., medical, religion, family).
 *
 * Note: Employee Profile is distinct from Workforce Advanced (payroll,
 * shift/roster, leave, performance, competency, training, etc.). Separating
 * them keeps the Core minimal and reusable.
 */
exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE employee_profiles (
      id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id             UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      business_partner_id   UUID NOT NULL,
      employment_type       TEXT NOT NULL DEFAULT 'permanent'
        CHECK (employment_type IN ('permanent', 'contract', 'outsourced', 'intern', 'freelance')),
      employee_number       TEXT NULL,
      hire_date             DATE NULL,
      end_date              DATE NULL,
      status                TEXT NOT NULL DEFAULT 'draft'
        CHECK (status IN ('draft', 'active', 'on_leave', 'suspended', 'ended')),
      sensitive_data        JSONB NULL,
      created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE(tenant_id, business_partner_id),
      FOREIGN KEY (tenant_id, business_partner_id)
        REFERENCES business_partners(tenant_id, id) ON DELETE CASCADE
    );

    CREATE INDEX idx_employee_profiles_tenant ON employee_profiles(tenant_id);
    CREATE INDEX idx_employee_profiles_business_partner ON employee_profiles(business_partner_id);
    CREATE INDEX idx_employee_profiles_status ON employee_profiles(tenant_id, status);
    -- Partial unique index: WHERE clause not allowed on inline table UNIQUE
    -- constraints. Employee Number unique per Tenant, only when set.
    CREATE UNIQUE INDEX ux_employee_profiles_tenant_number
      ON employee_profiles(tenant_id, employee_number) WHERE employee_number IS NOT NULL;
  `);
};

exports.down = (pgm) => {
  pgm.dropTable("employee_profiles", { ifExists: true });
};
