exports.up = (pgm) => {
  pgm.sql(`
    -- Refuse to add the canonical key until legacy duplicate assignments have
    -- been resolved deliberately. The diagnostic is intentionally bounded and
    -- contains only identifiers/scope dimensions, never user profile data.
    DO $$
    DECLARE duplicate_group record;
    BEGIN
      SELECT user_id,
             role_id,
             scope_type,
             scope_organization_unit_id,
             scope_customer_id,
             COUNT(*) AS duplicate_count
        INTO duplicate_group
        FROM user_role_assignments
       GROUP BY user_id,
                role_id,
                scope_type,
                scope_organization_unit_id,
                scope_customer_id
      HAVING COUNT(*) > 1
       ORDER BY user_id,
                role_id,
                scope_type,
                scope_organization_unit_id NULLS FIRST,
                scope_customer_id NULLS FIRST
       LIMIT 1;

      IF FOUND THEN
        RAISE EXCEPTION
          'Cannot install Phase 11F: duplicate user role assignment (user_id=%, role_id=%, scope_type=%, scope_organization_unit_id=%, scope_customer_id=%, count=%)',
          duplicate_group.user_id,
          duplicate_group.role_id,
          duplicate_group.scope_type,
          duplicate_group.scope_organization_unit_id,
          duplicate_group.scope_customer_id,
          duplicate_group.duplicate_count;
      END IF;
    END $$;

    CREATE UNIQUE INDEX user_role_assignments_exact_assignment_unique
      ON user_role_assignments
         (user_id, role_id, scope_type, scope_organization_unit_id, scope_customer_id)
      NULLS NOT DISTINCT;

    INSERT INTO permissions (code, description) VALUES
      ('user.role.manage', 'Assign and remove tenant-governed User Role assignments')
    ON CONFLICT (code) DO NOTHING;
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    DROP INDEX IF EXISTS user_role_assignments_exact_assignment_unique;
    DELETE FROM permissions WHERE code IN ('user.role.manage');
  `);
};
