/** Epic 5 G3 — Legal Entity Data Scope and authorization projection. */
exports.up = (pgm) => {
  pgm.addColumns("user_role_assignments", {
    tenant_id: { type: "uuid" },
    scope_legal_entity_id: { type: "uuid" },
  });

  pgm.sql(`UPDATE user_role_assignments ura SET tenant_id = u.tenant_id FROM users u WHERE u.id = ura.user_id`);
  pgm.alterColumn("user_role_assignments", "tenant_id", { notNull: true });
  pgm.addConstraint("user_role_assignments", "user_role_assignments_tenant_fk", {
    foreignKeys: { columns: "tenant_id", references: "tenants(id)", onDelete: "CASCADE" },
  });

  // Composite scope FK needs a matching parent key. `id` alone does not
  // prove tenant ownership. G1 (1789310000000) already adds this constraint;
  // guard so this migration is idempotent against a DB where G1 has run.
  pgm.sql(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'legal_entities_tenant_id_id_unique'
      ) THEN
        ALTER TABLE legal_entities ADD CONSTRAINT legal_entities_tenant_id_id_unique UNIQUE (tenant_id, id);
      END IF;
    END $$;
  `);

  pgm.addConstraint("user_role_assignments", "user_role_assignments_scope_legal_entity_fk", {
    foreignKeys: {
      columns: ["tenant_id", "scope_legal_entity_id"],
      references: "legal_entities(tenant_id, id)",
      onDelete: "CASCADE",
    },
  });

  pgm.dropConstraint("user_role_assignments", "user_role_assignments_scope_org_unit_required_check");
  pgm.dropConstraint("user_role_assignments", "user_role_assignments_scope_type_check");
  pgm.addConstraint("user_role_assignments", "user_role_assignments_scope_consistency_check", {
    check: `
      (scope_type = 'tenant' AND scope_legal_entity_id IS NULL AND scope_organization_unit_id IS NULL AND scope_customer_id IS NULL)
      OR (scope_type = 'legal_entity' AND scope_legal_entity_id IS NOT NULL AND scope_organization_unit_id IS NULL AND scope_customer_id IS NULL)
      OR (scope_type = 'organization_unit' AND scope_legal_entity_id IS NULL AND scope_organization_unit_id IS NOT NULL AND scope_customer_id IS NULL)
      OR (scope_type = 'customer' AND scope_legal_entity_id IS NULL AND scope_organization_unit_id IS NULL AND scope_customer_id IS NOT NULL)
    `,
  });

  pgm.sql(`
    DROP VIEW IF EXISTS authorization_effective_user_role_assignments;
    CREATE VIEW authorization_effective_user_role_assignments AS
      SELECT ura.id, ura.user_id, ura.role_id, ura.scope_type,
             ura.scope_legal_entity_id, ura.scope_organization_unit_id,
             ura.scope_customer_id, ura.scope_invalidated_at,
             ura.created_by, ura.created_at, u.tenant_id
        FROM user_role_assignments ura
        JOIN users u ON u.id = ura.user_id AND u.deleted_at IS NULL AND u.status = 'active'
        JOIN roles r ON r.id = ura.role_id AND r.tenant_id = u.tenant_id AND r.is_active = true
        LEFT JOIN legal_entities le ON le.id = ura.scope_legal_entity_id
          AND le.tenant_id = u.tenant_id AND le.deleted_at IS NULL
          AND le.is_active = true
        LEFT JOIN organization_units ou ON ou.id = ura.scope_organization_unit_id
          AND ou.tenant_id = u.tenant_id AND ou.deleted_at IS NULL AND ou.status = 'active'
        LEFT JOIN customers c ON c.id = ura.scope_customer_id
          AND c.tenant_id = u.tenant_id AND c.deleted_at IS NULL
       WHERE ura.scope_invalidated_at IS NULL
         AND ((ura.scope_type = 'tenant' AND ura.scope_legal_entity_id IS NULL AND ura.scope_organization_unit_id IS NULL AND ura.scope_customer_id IS NULL)
           OR (ura.scope_type = 'legal_entity' AND le.id IS NOT NULL)
           OR (ura.scope_type = 'organization_unit' AND ou.id IS NOT NULL)
           OR (ura.scope_type = 'customer' AND c.id IS NOT NULL));
  `);
};

exports.down = (pgm) => {
  pgm.sql(`DROP VIEW IF EXISTS authorization_effective_user_role_assignments`);
  pgm.sql(`
    CREATE VIEW authorization_effective_user_role_assignments AS
      SELECT ura.id, ura.user_id, ura.role_id, ura.scope_type,
             ura.scope_organization_unit_id, ura.scope_customer_id,
             ura.scope_invalidated_at, ura.created_by, ura.created_at, u.tenant_id
        FROM user_role_assignments ura
        JOIN users u ON u.id = ura.user_id AND u.deleted_at IS NULL AND u.status = 'active'
        JOIN roles r ON r.id = ura.role_id AND r.tenant_id = u.tenant_id AND r.is_active = true
        LEFT JOIN organization_units ou ON ou.id = ura.scope_organization_unit_id
          AND ou.tenant_id = u.tenant_id AND ou.deleted_at IS NULL
        LEFT JOIN customers c ON c.id = ura.scope_customer_id
          AND c.tenant_id = u.tenant_id AND c.deleted_at IS NULL
       WHERE ura.scope_invalidated_at IS NULL
         AND ((ura.scope_type = 'tenant' AND ura.scope_organization_unit_id IS NULL AND ura.scope_customer_id IS NULL)
           OR (ura.scope_type = 'organization_unit' AND ou.id IS NOT NULL)
           OR (ura.scope_type = 'customer' AND c.id IS NOT NULL));
  `);
  pgm.dropConstraint("user_role_assignments", "user_role_assignments_scope_consistency_check");
  pgm.addConstraint("user_role_assignments", "user_role_assignments_scope_org_unit_required_check", {
    check: `(scope_type = 'tenant' AND scope_organization_unit_id IS NULL AND scope_customer_id IS NULL) OR (scope_type = 'organization_unit' AND scope_organization_unit_id IS NOT NULL AND scope_customer_id IS NULL) OR (scope_type = 'customer' AND scope_customer_id IS NOT NULL AND scope_organization_unit_id IS NULL)`,
  });
  pgm.dropConstraint("user_role_assignments", "user_role_assignments_scope_legal_entity_fk");
  pgm.dropConstraint("user_role_assignments", "user_role_assignments_tenant_fk");
  pgm.dropConstraint("legal_entities", "legal_entities_tenant_id_id_unique");
  pgm.dropColumns("user_role_assignments", ["tenant_id"]);
  pgm.dropColumns("user_role_assignments", ["scope_legal_entity_id"]);
};
