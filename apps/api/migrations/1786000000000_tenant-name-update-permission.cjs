exports.up = (pgm) => {
  pgm.sql(`
    INSERT INTO permissions (code, description)
    VALUES ('tenant.update', 'Edit Tenant Name')
    ON CONFLICT (code) DO NOTHING;
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    DELETE FROM permissions p
    WHERE p.code = 'tenant.update'
      AND NOT EXISTS (
        SELECT 1 FROM role_permissions rp WHERE rp.permission_id = p.id
      );
  `);
};
