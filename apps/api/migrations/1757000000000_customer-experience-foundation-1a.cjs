/**
 * Checkpoint 1A — Document Scope & Customer Experience Foundation.
 *
 * Two independent things, both prerequisites for Complaint/Survey (1B/1D):
 *
 * --- 1. Customer Foundation -------------------------------------------
 * Generic entities per 07-Phase-1 instruction section 2 ("Customer
 * Foundation"): Customer, Customer Contact/PIC, Contract, Project,
 * Site/Location, Service (catalog), and a Service Assignment link
 * (Customer <-> Service, optionally narrowed to a Contract/Project/Site
 * and an Internal PIC). No duplicate master data: Customer User reuses
 * the EXISTING `users` table (Founder instruction: "Gunakan entity Phase
 * 0 yang sudah tersedia") — a Customer User is simply a `users` row whose
 * Role assignment carries the new `customer` Data Scope (see #2 below),
 * not a separate identity table.
 *
 * Contract/Project/Site deliberately do NOT carry their own
 * `owner_organization_unit_id` — they resolve authorization through
 * their parent Customer's scope (Customer.owner_organization_unit_id +
 * Customer Data Scope), per the Phase 1 instruction's "buat relationship
 * generik dan configurable, tidak semua field wajib" guidance. This
 * keeps the foundation proportionate to what 1A needs to prove; a
 * business need for an independently-scoped Contract would be a Client
 * Configuration / Client Extension decision, not a Product Core change.
 *
 * --- 2. Customer Data Scope (new Data Scope dimension) -----------------
 * ADR-0011. Phase 0's Data Scope (ADR-0009) only knows how to answer
 * "which Organization Units can this user act on" (the INTERNAL side of
 * the org hierarchy). A Customer User is not inside that hierarchy at
 * all — they need to be scoped to exactly one Customer (their own),
 * never its "descendants" (a Customer has none). Rather than bolt this
 * onto `users` as a special-cased column, it is modeled as a third
 * `user_role_assignments.scope_type`, symmetric with `tenant` and
 * `organization_unit`: `customer` + `scope_customer_id`. This lets
 * `RbacService` treat it as just another Data Scope axis (exact-match,
 * no hierarchy needed) instead of a parallel, bespoke authorization path
 * — and lets a future Internal PIC / Supervisor role ALSO be scoped by
 * Customer directly, not only by Organization Unit, without another
 * schema change.
 *
 * The three-way CHECK constraint below replaces (not narrows) the 0B
 * constraint: `tenant` still requires both nullable columns null,
 * `organization_unit` still requires exactly `scope_organization_unit_id`,
 * and the new `customer` requires exactly `scope_customer_id`. Existing
 * 0B/0F rows (`tenant`/`organization_unit` only) are unaffected — purely
 * additive, same posture as ADR-0008/ADR-0009/ADR-0010.
 */

exports.up = (pgm) => {
  // --- Customer Foundation ------------------------------------------
  pgm.createTable("customers", {
    id: { type: "uuid", primaryKey: true, default: pgm.func("gen_random_uuid()") },
    tenant_id: { type: "uuid", notNull: true, references: "tenants", onDelete: "CASCADE" },
    code: { type: "text", notNull: true },
    name: { type: "text", notNull: true },
    // Customer Account Status (doc section 2): generic text, not an enum,
    // so a Client Configuration can extend the vocabulary later without a
    // migration — same posture as `users.status`/`contracts.status` below.
    status: { type: "text", notNull: true, default: "active" },
    owner_organization_unit_id: {
      type: "uuid",
      references: "organization_units",
      onDelete: "SET NULL",
    },
    notes: { type: "text" },
    created_by: { type: "uuid" },
    created_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
    updated_by: { type: "uuid" },
    updated_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
    deleted_by: { type: "uuid" },
    deleted_at: { type: "timestamptz" },
  });
  pgm.addConstraint("customers", "customers_tenant_code_unique", {
    unique: ["tenant_id", "code"],
  });

  pgm.createTable("customer_contacts", {
    id: { type: "uuid", primaryKey: true, default: pgm.func("gen_random_uuid()") },
    tenant_id: { type: "uuid", notNull: true, references: "tenants", onDelete: "CASCADE" },
    customer_id: { type: "uuid", notNull: true, references: "customers", onDelete: "CASCADE" },
    name: { type: "text", notNull: true },
    email: { type: "text" },
    phone: { type: "text" },
    is_primary: { type: "boolean", notNull: true, default: false },
    created_by: { type: "uuid" },
    created_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
    updated_by: { type: "uuid" },
    updated_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
    deleted_by: { type: "uuid" },
    deleted_at: { type: "timestamptz" },
  });

  pgm.createTable("contracts", {
    id: { type: "uuid", primaryKey: true, default: pgm.func("gen_random_uuid()") },
    tenant_id: { type: "uuid", notNull: true, references: "tenants", onDelete: "CASCADE" },
    customer_id: { type: "uuid", notNull: true, references: "customers", onDelete: "CASCADE" },
    code: { type: "text", notNull: true },
    name: { type: "text", notNull: true },
    start_date: { type: "date" },
    end_date: { type: "date" },
    status: { type: "text", notNull: true, default: "active" },
    created_by: { type: "uuid" },
    created_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
    updated_by: { type: "uuid" },
    updated_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
    deleted_by: { type: "uuid" },
    deleted_at: { type: "timestamptz" },
  });
  pgm.addConstraint("contracts", "contracts_customer_code_unique", {
    unique: ["customer_id", "code"],
  });

  pgm.createTable("projects", {
    id: { type: "uuid", primaryKey: true, default: pgm.func("gen_random_uuid()") },
    tenant_id: { type: "uuid", notNull: true, references: "tenants", onDelete: "CASCADE" },
    customer_id: { type: "uuid", notNull: true, references: "customers", onDelete: "CASCADE" },
    contract_id: { type: "uuid", references: "contracts", onDelete: "SET NULL" },
    code: { type: "text", notNull: true },
    name: { type: "text", notNull: true },
    status: { type: "text", notNull: true, default: "active" },
    created_by: { type: "uuid" },
    created_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
    updated_by: { type: "uuid" },
    updated_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
    deleted_by: { type: "uuid" },
    deleted_at: { type: "timestamptz" },
  });
  pgm.addConstraint("projects", "projects_customer_code_unique", {
    unique: ["customer_id", "code"],
  });

  pgm.createTable("sites", {
    id: { type: "uuid", primaryKey: true, default: pgm.func("gen_random_uuid()") },
    tenant_id: { type: "uuid", notNull: true, references: "tenants", onDelete: "CASCADE" },
    customer_id: { type: "uuid", notNull: true, references: "customers", onDelete: "CASCADE" },
    project_id: { type: "uuid", references: "projects", onDelete: "SET NULL" },
    code: { type: "text", notNull: true },
    name: { type: "text", notNull: true },
    address: { type: "text" },
    status: { type: "text", notNull: true, default: "active" },
    created_by: { type: "uuid" },
    created_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
    updated_by: { type: "uuid" },
    updated_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
    deleted_by: { type: "uuid" },
    deleted_at: { type: "timestamptz" },
  });
  pgm.addConstraint("sites", "sites_customer_code_unique", {
    unique: ["customer_id", "code"],
  });

  // Service catalog — Tenant-level Product/Client Configuration data
  // (names like "Catering", "Housekeeping" are dummy/example values a
  // real Tenant configures; Product Core does not hardcode them, per
  // Founder instruction section 10/30 — this table is the mechanism, not
  // the content).
  pgm.createTable("services", {
    id: { type: "uuid", primaryKey: true, default: pgm.func("gen_random_uuid()") },
    tenant_id: { type: "uuid", notNull: true, references: "tenants", onDelete: "CASCADE" },
    code: { type: "text", notNull: true },
    name: { type: "text", notNull: true },
    description: { type: "text" },
    is_active: { type: "boolean", notNull: true, default: true },
    created_by: { type: "uuid" },
    created_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
    updated_by: { type: "uuid" },
    updated_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
  });
  pgm.addConstraint("services", "services_tenant_code_unique", {
    unique: ["tenant_id", "code"],
  });

  // Service Assignment ("Service Assigned" step of the 1A E2E target):
  // links a Service to a Customer, optionally narrowed to a Contract/
  // Project/Site, optionally with an Internal PIC. All narrowing columns
  // nullable by design ("Tidak semua field wajib pada setiap
  // transaction").
  pgm.createTable("customer_service_links", {
    id: { type: "uuid", primaryKey: true, default: pgm.func("gen_random_uuid()") },
    tenant_id: { type: "uuid", notNull: true, references: "tenants", onDelete: "CASCADE" },
    customer_id: { type: "uuid", notNull: true, references: "customers", onDelete: "CASCADE" },
    service_id: { type: "uuid", notNull: true, references: "services", onDelete: "RESTRICT" },
    contract_id: { type: "uuid", references: "contracts", onDelete: "SET NULL" },
    project_id: { type: "uuid", references: "projects", onDelete: "SET NULL" },
    site_id: { type: "uuid", references: "sites", onDelete: "SET NULL" },
    internal_pic_user_id: { type: "uuid", references: "users", onDelete: "SET NULL" },
    status: { type: "text", notNull: true, default: "active" },
    created_by: { type: "uuid" },
    created_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
    updated_by: { type: "uuid" },
    updated_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
  });

  // --- Customer Data Scope (ADR-0011) --------------------------------
  pgm.addColumns("user_role_assignments", {
    scope_customer_id: { type: "uuid", references: "customers", onDelete: "CASCADE" },
  });
  pgm.dropConstraint("user_role_assignments", "user_role_assignments_scope_type_check");
  pgm.dropConstraint("user_role_assignments", "user_role_assignments_scope_org_unit_required_check");
  pgm.addConstraint("user_role_assignments", "user_role_assignments_scope_type_check", {
    check: "scope_type IN ('tenant', 'organization_unit', 'customer')",
  });
  pgm.addConstraint("user_role_assignments", "user_role_assignments_scope_org_unit_required_check", {
    check: `
      (scope_type = 'tenant' AND scope_organization_unit_id IS NULL AND scope_customer_id IS NULL)
      OR (scope_type = 'organization_unit' AND scope_organization_unit_id IS NOT NULL AND scope_customer_id IS NULL)
      OR (scope_type = 'customer' AND scope_customer_id IS NOT NULL AND scope_organization_unit_id IS NULL)
    `,
  });

  // --- Permissions (Product Core catalog) -----------------------------
  pgm.sql(`
    INSERT INTO permissions (code, description) VALUES
      ('customer.read', 'View Customers, Customer Contacts, and their Data Scope'),
      ('customer.manage', 'Create/update Customers and Customer Contacts'),
      ('contract.read', 'View Contracts'),
      ('contract.manage', 'Create/update Contracts'),
      ('project.read', 'View Projects'),
      ('project.manage', 'Create/update Projects'),
      ('site.read', 'View Sites/Locations'),
      ('site.manage', 'Create/update Sites/Locations'),
      ('service.read', 'View the Service catalog and Service Assignments'),
      ('service.manage', 'Manage the Service catalog and Service Assignments')
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    DELETE FROM permissions WHERE code IN (
      'customer.read', 'customer.manage', 'contract.read', 'contract.manage',
      'project.read', 'project.manage', 'site.read', 'site.manage',
      'service.read', 'service.manage'
    )
  `);

  pgm.dropConstraint("user_role_assignments", "user_role_assignments_scope_org_unit_required_check");
  pgm.dropConstraint("user_role_assignments", "user_role_assignments_scope_type_check");
  pgm.addConstraint("user_role_assignments", "user_role_assignments_scope_type_check", {
    check: "scope_type IN ('tenant', 'organization_unit')",
  });
  pgm.addConstraint("user_role_assignments", "user_role_assignments_scope_org_unit_required_check", {
    check:
      "(scope_type = 'organization_unit' AND scope_organization_unit_id IS NOT NULL) OR (scope_type = 'tenant' AND scope_organization_unit_id IS NULL)",
  });
  pgm.dropColumns("user_role_assignments", ["scope_customer_id"]);

  pgm.dropTable("customer_service_links");
  pgm.dropTable("services");
  pgm.dropTable("sites");
  pgm.dropTable("projects");
  pgm.dropTable("contracts");
  pgm.dropTable("customer_contacts");
  pgm.dropTable("customers");
};
