/**
 * Checkpoint 0B — Identity & Organization Vertical Slice.
 *
 * Tables introduced here follow 01-Tenant-Legal-Entity-Organization-Model.md,
 * 02-Identity-Security-RBAC-Foundation.md, and 03-Core-Data-Foundation.md.
 *
 * Scope kept intentionally minimal for the first vertical slice:
 * - Organization hierarchy: Tenant -> Legal Entity -> Organization Unit
 *   (recursive via parent_id). Project / Site are NOT introduced yet —
 *   they are not required to prove the Auth/RBAC/Audit slice and are left
 *   for the next foundation expansion, to avoid over-building ahead of need.
 * - RBAC: Role + Permission + Role-Permission + User-Role-Assignment, with
 *   an assignment-level Data Scope (tenant | organization_unit). Descendant-
 *   aware scope (a Regional Manager auto-covering all Sites under their
 *   Organization Unit) is NOT implemented yet — see docs/decision-log.md
 *   gap analysis. Scope in 0B is exact-match only (tenant-wide, or one
 *   specific organization_unit).
 * - Audit: a single append-only audit_log table, per the Audit-First
 *   Design in 02-Identity-Security-RBAC-Foundation.md.
 */

exports.up = (pgm) => {
  // --- Tenant -------------------------------------------------------
  pgm.createTable("tenants", {
    id: { type: "uuid", primaryKey: true, default: pgm.func("gen_random_uuid()") },
    code: { type: "text", notNull: true, unique: true },
    name: { type: "text", notNull: true },
    status: { type: "text", notNull: true, default: "active" },
    created_by: { type: "uuid" },
    created_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
    updated_by: { type: "uuid" },
    updated_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
    deleted_by: { type: "uuid" },
    deleted_at: { type: "timestamptz" },
  });

  // --- Legal Entity ---------------------------------------------------
  pgm.createTable("legal_entities", {
    id: { type: "uuid", primaryKey: true, default: pgm.func("gen_random_uuid()") },
    tenant_id: { type: "uuid", notNull: true, references: "tenants", onDelete: "CASCADE" },
    name: { type: "text", notNull: true },
    registration_no: { type: "text" },
    created_by: { type: "uuid" },
    created_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
    updated_by: { type: "uuid" },
    updated_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
    deleted_by: { type: "uuid" },
    deleted_at: { type: "timestamptz" },
  });
  pgm.createIndex("legal_entities", "tenant_id");

  // --- Organization Unit (recursive) -----------------------------------
  pgm.createTable("organization_units", {
    id: { type: "uuid", primaryKey: true, default: pgm.func("gen_random_uuid()") },
    tenant_id: { type: "uuid", notNull: true, references: "tenants", onDelete: "CASCADE" },
    legal_entity_id: { type: "uuid", notNull: true, references: "legal_entities", onDelete: "CASCADE" },
    parent_id: { type: "uuid", references: "organization_units", onDelete: "CASCADE" },
    name: { type: "text", notNull: true },
    // Free-text unit type label (HO, Branch, Division, ...). Terminology
    // override per Tenant belongs to the Configuration Engine (Checkpoint
    // 0C) — this column stores the raw value only.
    unit_type: { type: "text", notNull: true, default: "Organization Unit" },
    created_by: { type: "uuid" },
    created_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
    updated_by: { type: "uuid" },
    updated_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
    deleted_by: { type: "uuid" },
    deleted_at: { type: "timestamptz" },
  });
  pgm.createIndex("organization_units", "tenant_id");
  pgm.createIndex("organization_units", "parent_id");

  // --- User -------------------------------------------------------------
  pgm.createTable("users", {
    id: { type: "uuid", primaryKey: true, default: pgm.func("gen_random_uuid()") },
    tenant_id: { type: "uuid", notNull: true, references: "tenants", onDelete: "CASCADE" },
    email: { type: "text", notNull: true },
    password_hash: { type: "text", notNull: true },
    full_name: { type: "text", notNull: true },
    status: { type: "text", notNull: true, default: "active" },
    created_by: { type: "uuid" },
    created_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
    updated_by: { type: "uuid" },
    updated_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
    deleted_by: { type: "uuid" },
    deleted_at: { type: "timestamptz" },
  });
  pgm.addConstraint("users", "users_tenant_email_unique", {
    unique: ["tenant_id", "email"],
  });

  // --- RBAC: Role ---------------------------------------------------
  pgm.createTable("roles", {
    id: { type: "uuid", primaryKey: true, default: pgm.func("gen_random_uuid()") },
    tenant_id: { type: "uuid", notNull: true, references: "tenants", onDelete: "CASCADE" },
    code: { type: "text", notNull: true },
    name: { type: "text", notNull: true },
    created_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
    updated_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
  });
  pgm.addConstraint("roles", "roles_tenant_code_unique", {
    unique: ["tenant_id", "code"],
  });

  // --- RBAC: Permission (global catalog — Product Core, not per-tenant) --
  pgm.createTable("permissions", {
    id: { type: "uuid", primaryKey: true, default: pgm.func("gen_random_uuid()") },
    code: { type: "text", notNull: true, unique: true },
    description: { type: "text", notNull: true },
  });

  pgm.createTable("role_permissions", {
    role_id: { type: "uuid", notNull: true, references: "roles", onDelete: "CASCADE" },
    permission_id: { type: "uuid", notNull: true, references: "permissions", onDelete: "CASCADE" },
  });
  pgm.addConstraint("role_permissions", "role_permissions_pk", {
    primaryKey: ["role_id", "permission_id"],
  });

  // --- RBAC: User <-> Role assignment with Data Scope --------------------
  pgm.createTable("user_role_assignments", {
    id: { type: "uuid", primaryKey: true, default: pgm.func("gen_random_uuid()") },
    user_id: { type: "uuid", notNull: true, references: "users", onDelete: "CASCADE" },
    role_id: { type: "uuid", notNull: true, references: "roles", onDelete: "CASCADE" },
    // 'tenant' = whole Tenant; 'organization_unit' = exactly the referenced
    // organization unit (non-recursive in 0B — see migration header note).
    scope_type: { type: "text", notNull: true },
    scope_organization_unit_id: { type: "uuid", references: "organization_units" },
    created_by: { type: "uuid" },
    created_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
  });
  pgm.addConstraint("user_role_assignments", "user_role_assignments_scope_type_check", {
    check: "scope_type IN ('tenant', 'organization_unit')",
  });
  pgm.addConstraint(
    "user_role_assignments",
    "user_role_assignments_scope_org_unit_required_check",
    {
      check:
        "(scope_type = 'organization_unit' AND scope_organization_unit_id IS NOT NULL) OR (scope_type = 'tenant' AND scope_organization_unit_id IS NULL)",
    },
  );
  pgm.createIndex("user_role_assignments", "user_id");

  // --- Refresh tokens (session management) --------------------------------
  pgm.createTable("refresh_tokens", {
    id: { type: "uuid", primaryKey: true, default: pgm.func("gen_random_uuid()") },
    user_id: { type: "uuid", notNull: true, references: "users", onDelete: "CASCADE" },
    token_hash: { type: "text", notNull: true },
    expires_at: { type: "timestamptz", notNull: true },
    revoked_at: { type: "timestamptz" },
    created_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
  });
  pgm.createIndex("refresh_tokens", "user_id");

  // --- Audit Trail (append-only) -----------------------------------------
  pgm.createTable("audit_log", {
    id: { type: "uuid", primaryKey: true, default: pgm.func("gen_random_uuid()") },
    tenant_id: { type: "uuid", references: "tenants", onDelete: "CASCADE" },
    actor_user_id: { type: "uuid" },
    action: { type: "text", notNull: true },
    entity_type: { type: "text", notNull: true },
    entity_id: { type: "uuid" },
    metadata: { type: "jsonb", notNull: true, default: "{}" },
    created_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
  });
  pgm.createIndex("audit_log", "tenant_id");
  pgm.createIndex("audit_log", ["entity_type", "entity_id"]);

  // Seed the global Permission catalog (Product Core, versioned via
  // migration — not editable via Client Configuration).
  pgm.sql(`
    INSERT INTO permissions (code, description) VALUES
      ('tenant.create', 'Create a Tenant'),
      ('tenant.read', 'Read Tenant data'),
      ('legal_entity.create', 'Create a Legal Entity'),
      ('legal_entity.read', 'Read Legal Entity data'),
      ('organization_unit.create', 'Create an Organization Unit'),
      ('organization_unit.read', 'Read Organization Unit data'),
      ('user.create', 'Create a User'),
      ('user.read', 'Read User data'),
      ('audit_log.read', 'Read Audit Trail entries')
  `);
};

exports.down = (pgm) => {
  pgm.dropTable("audit_log");
  pgm.dropTable("refresh_tokens");
  pgm.dropTable("user_role_assignments");
  pgm.dropTable("role_permissions");
  pgm.dropTable("permissions");
  pgm.dropTable("roles");
  pgm.dropTable("users");
  pgm.dropTable("organization_units");
  pgm.dropTable("legal_entities");
  pgm.dropTable("tenants");
};
