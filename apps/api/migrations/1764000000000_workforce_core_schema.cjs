/**
 * Phase 3 — Workforce / HR Core schema (HR-CORE-001…010).
 *
 * Core stops at **identity and placement**: who the employee is, what their
 * employment relationship is, where they sit organisationally, what position
 * they hold, and what basic records/documents exist. Everything time-,
 * money-, or evaluation-related (attendance, shift/roster, leave, overtime,
 * payroll, recruitment, performance, competency, manpower planning) is
 * Advanced and is deliberately absent from this schema.
 *
 * Deliberate design decisions:
 *
 * - **Employee is NOT a system user.** `employees.user_id` is nullable: an
 *   employee may exist with no login at all. When linked, a partial unique
 *   index keeps the relationship one-to-one per tenant.
 *
 * - **Organisation is not duplicated.** Placement references the existing
 *   `legal_entities` and `organization_units` (Platform Core). There is no
 *   `hr_companies` / `hr_departments` shadow hierarchy.
 *
 * - **History without a temporal database.** `employees` carries the CURRENT
 *   placement for querying; `employee_assignments` records every placement /
 *   status period (`effective_from` … `effective_to`, null = current). A
 *   placement change closes the open row and opens a new one, so history is
 *   never overwritten.
 *
 * - **Documents reuse Document Core** (`documents` with entity_type
 *   'employee') — no attachment storage here. Employee documents are gated
 *   by a dedicated capability because they are more sensitive than ordinary
 *   business records.
 *
 * - **No country-specific compliance.** No statutory identifiers, tax,
 *   social-security, or bank fields — Workforce Core must stay
 *   internationally reusable. Data minimisation is deliberate: no religion,
 *   marital status, medical, biometric, or family fields.
 *
 * `gen_random_uuid()` comes from pgcrypto (migration 0001).
 */
exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE positions (
      id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id    uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      code         text NOT NULL,
      name         text NOT NULL,
      description  text,
      is_active    boolean NOT NULL DEFAULT true,
      created_at   timestamptz NOT NULL DEFAULT now(),
      created_by   uuid,
      updated_at   timestamptz NOT NULL DEFAULT now(),
      updated_by   uuid,
      UNIQUE (tenant_id, code)
    );

    CREATE TABLE employees (
      id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id             uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      employee_number       text NOT NULL,
      full_name             text NOT NULL,
      email                 text,
      phone                 text,
      -- Employment relationship. employment_type is Tenant Configuration
      -- (reference data); employment_status is a finite Core value because
      -- it drives behaviour.
      employment_type       text,
      employment_status     text NOT NULL DEFAULT 'active',
      joined_at             date,
      ended_at              date,
      -- CURRENT placement (history lives in employee_assignments).
      legal_entity_id       uuid REFERENCES legal_entities(id) ON DELETE RESTRICT,
      organization_unit_id  uuid REFERENCES organization_units(id) ON DELETE RESTRICT,
      position_id           uuid REFERENCES positions(id) ON DELETE RESTRICT,
      -- OPTIONAL link to a platform user account (HR-CORE-008).
      user_id               uuid REFERENCES users(id) ON DELETE SET NULL,
      created_at            timestamptz NOT NULL DEFAULT now(),
      created_by            uuid,
      updated_at            timestamptz NOT NULL DEFAULT now(),
      updated_by            uuid,
      deleted_at            timestamptz,
      UNIQUE (tenant_id, employee_number)
    );

    -- One employee per linked user account, per tenant. Partial so the many
    -- employees WITHOUT a login do not collide.
    CREATE UNIQUE INDEX uq_employees_tenant_user
      ON employees(tenant_id, user_id) WHERE user_id IS NOT NULL;

    CREATE TABLE employee_assignments (
      id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      employee_id           uuid NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
      legal_entity_id       uuid REFERENCES legal_entities(id) ON DELETE SET NULL,
      organization_unit_id  uuid REFERENCES organization_units(id) ON DELETE SET NULL,
      position_id           uuid REFERENCES positions(id) ON DELETE SET NULL,
      employment_status     text NOT NULL,
      effective_from        date NOT NULL,
      effective_to          date,
      note                  text,
      created_at            timestamptz NOT NULL DEFAULT now(),
      created_by            uuid
    );

    -- At most one OPEN period per employee; closed history rows are free.
    CREATE UNIQUE INDEX uq_employee_assignments_open
      ON employee_assignments(employee_id) WHERE effective_to IS NULL;

    CREATE INDEX idx_positions_tenant_active ON positions(tenant_id, is_active);
    CREATE INDEX idx_employees_tenant ON employees(tenant_id);
    CREATE INDEX idx_employees_org_unit ON employees(organization_unit_id);
    CREATE INDEX idx_employees_legal_entity ON employees(legal_entity_id);
    CREATE INDEX idx_employees_status ON employees(tenant_id, employment_status);
    CREATE INDEX idx_employee_assignments_employee ON employee_assignments(employee_id, effective_from DESC);
  `);

  // --- Permissions (Product Core catalog, capability-based) -------------
  // `workforce.documents.read` is separate on purpose: employee documents
  // are more sensitive than ordinary business records, so holding
  // `workforce.read` must not by itself grant access to them.
  pgm.sql(`
    INSERT INTO permissions (code, description)
    SELECT v.code, v.description
      FROM (VALUES
        ('workforce.read', 'View employees and their organisational placement (subject to Data Scope)'),
        ('workforce.manage', 'Create and maintain employees, placement, and employment status'),
        ('workforce.configure', 'Manage Positions and Workforce reference configuration'),
        ('workforce.documents.read', 'Access employee documents (more restricted than workforce.read)')
      ) AS v(code, description)
     WHERE NOT EXISTS (SELECT 1 FROM permissions p WHERE p.code = v.code)
  `);

  // --- Reference Data type (Product Core registers the TYPE only) -------
  pgm.sql(`
    INSERT INTO reference_data_types (code, name, description)
    SELECT v.code, v.name, v.description
      FROM (VALUES
        ('employment_type', 'Employment Type', 'Tenant-configurable employment type catalog (e.g. permanent, contract, probation)')
      ) AS v(code, name, description)
     WHERE NOT EXISTS (SELECT 1 FROM reference_data_types t WHERE t.code = v.code)
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    DELETE FROM reference_data_types WHERE code = 'employment_type';
    DELETE FROM permissions WHERE code IN (
      'workforce.read', 'workforce.manage', 'workforce.configure', 'workforce.documents.read'
    );
    DROP TABLE IF EXISTS employee_assignments;
    DROP TABLE IF EXISTS employees;
    DROP TABLE IF EXISTS positions;
  `);
};
