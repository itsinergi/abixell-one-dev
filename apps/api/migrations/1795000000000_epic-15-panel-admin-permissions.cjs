/**
 * Epic 15 — Panel Admin granular configuration permissions.
 *
 * CORE-ROADMAP.md §4.15 Decision #7: "Permission granular per kategori
 * (`config.<category>.manage`), bukan `config.manage` monolitik."
 *
 * This migration replaces the monolithic `config.manage` with eight granular
 * category-scoped permission codes for Panel Admin sections:
 *   - config.module.manage — Module configuration (activation, feature flags)
 *   - config.platform.manage — Platform settings (terminology, reference data)
 *   - config.org.manage — Organization & Legal Entity data
 *   - config.system.manage — System-wide settings and metadata
 *   - config.user.manage — User & Access management (roles, assignments)
 *   - config.workflow.manage — Workflow & Approval rules and templates
 *   - config.notification.manage — Notification channels and templates
 *   - config.document.manage — Document templates and policies
 *
 * Each category carries a separate `.read` permission for visibility control.
 * The 8 categories align with Panel Admin section structure and MODULE_METADATA
 * in apps/web/src/lib/capabilities.ts (13 modules mapped to 8 config categories).
 *
 * Authorization enforcement:
 *   - Backend: RbacService.requirePermission(actor, "config.<category>.manage")
 *   - Frontend: NavSection.requiresAnyOf checks, ProtectedRoute components
 *   - No change to RBAC engine; permission codes are just strings in the catalog
 *
 * Backward compatibility:
 *   - Old `config.manage` permission remains (for existing roles, migrations).
 *   - New routes in Panel Admin check the 8 new codes; old routes stay on
 *     `config.manage` until refactored (Wave 2 of Epic 15).
 *   - Existing role assignments with `config.manage` do NOT auto-expand to
 *     all 8 new codes; that is a tenant-level decision (update template role
 *     grants in a separate schema migration per tenant if needed).
 */

exports.up = (pgm) => {
  // --- 1. Define the 8 new granular permission codes ----------------------
  // Each category gets a .read (visibility) and .manage (edit) permission.
  pgm.sql(`
    INSERT INTO permissions (code, description) VALUES
      -- Module configuration
      ('config.module.read', 'View Module activation, feature flags, and module metadata'),
      ('config.module.manage', 'Manage Module activation, feature flags, and module metadata'),
      -- Platform settings (terminology, reference data)
      ('config.platform.read', 'View Platform settings, terminology overrides, reference data, and numbering'),
      ('config.platform.manage', 'Manage Platform settings, terminology overrides, reference data, and numbering patterns'),
      -- Organization & Legal Entity
      ('config.org.read', 'View Organization Units, Legal Entities, and organizational structure'),
      ('config.org.manage', 'Manage Organization Units, Legal Entities, and organizational structure'),
      -- System-wide settings
      ('config.system.read', 'View System settings, metadata registry, and configuration metadata'),
      ('config.system.manage', 'Manage System settings, metadata registry, and configuration metadata'),
      -- User & Access management
      ('config.user.read', 'View Users, Roles, and Access assignments'),
      ('config.user.manage', 'Manage Users, Roles, Assignments, and Approvals Authority (role definitions, access grants)'),
      -- Workflow & Approval rules
      ('config.workflow.read', 'View Workflow definitions, approval rules, and SoD policies'),
      ('config.workflow.manage', 'Manage Workflow definitions, approval rules, thresholds, and Segregation of Duties policies'),
      -- Notification channels & templates
      ('config.notification.read', 'View Notification channels, templates, and send logs'),
      ('config.notification.manage', 'Manage Notification channels, templates, presets, and send policies'),
      -- Document templates & policies
      ('config.document.read', 'View Document templates and policies'),
      ('config.document.manage', 'Manage Document templates, artifacts, and retention policies')
    ON CONFLICT (code) DO NOTHING;
  `);

  // --- 2. Extend the dictionary process seed to include the 8 new permissions
  //    This follows the pattern from Epic 4 (1787700000000_epic-4-wave-1-role-definition.cjs):
  //    save the old function, create a new one that combines old + new, then
  //    re-map the canonical name to the new function.
  pgm.sql(`
    -- Save the old seed function
    ALTER FUNCTION config_dictionary_process_seed()
      RENAME TO config_dictionary_process_seed_epic14;

    -- Create new seed function that includes the 8 new permission codes
    CREATE OR REPLACE FUNCTION config_dictionary_process_seed()
    RETURNS TABLE (code TEXT, name TEXT, module_code TEXT) AS $seed$
      SELECT s.code, s.name, s.module_code
        FROM config_dictionary_process_seed_epic14() s
      UNION
      -- 8 new granular config category permissions (16 rows: 8 read + 8 manage)
      SELECT 'config.module.read',
             'View Module activation, feature flags, and module metadata',
             'platform'
       WHERE NOT EXISTS (
         SELECT 1 FROM config_dictionary_process_seed_epic14() l
          WHERE l.code = 'config.module.read'
       )
      UNION
      SELECT 'config.module.manage',
             'Manage Module activation, feature flags, and module metadata',
             'platform'
       WHERE NOT EXISTS (
         SELECT 1 FROM config_dictionary_process_seed_epic14() l
          WHERE l.code = 'config.module.manage'
       )
      UNION
      SELECT 'config.platform.read',
             'View Platform settings, terminology overrides, reference data, and numbering',
             'platform'
       WHERE NOT EXISTS (
         SELECT 1 FROM config_dictionary_process_seed_epic14() l
          WHERE l.code = 'config.platform.read'
       )
      UNION
      SELECT 'config.platform.manage',
             'Manage Platform settings, terminology overrides, reference data, and numbering patterns',
             'platform'
       WHERE NOT EXISTS (
         SELECT 1 FROM config_dictionary_process_seed_epic14() l
          WHERE l.code = 'config.platform.manage'
       )
      UNION
      SELECT 'config.org.read',
             'View Organization Units, Legal Entities, and organizational structure',
             'platform'
       WHERE NOT EXISTS (
         SELECT 1 FROM config_dictionary_process_seed_epic14() l
          WHERE l.code = 'config.org.read'
       )
      UNION
      SELECT 'config.org.manage',
             'Manage Organization Units, Legal Entities, and organizational structure',
             'platform'
       WHERE NOT EXISTS (
         SELECT 1 FROM config_dictionary_process_seed_epic14() l
          WHERE l.code = 'config.org.manage'
       )
      UNION
      SELECT 'config.system.read',
             'View System settings, metadata registry, and configuration metadata',
             'platform'
       WHERE NOT EXISTS (
         SELECT 1 FROM config_dictionary_process_seed_epic14() l
          WHERE l.code = 'config.system.read'
       )
      UNION
      SELECT 'config.system.manage',
             'Manage System settings, metadata registry, and configuration metadata',
             'platform'
       WHERE NOT EXISTS (
         SELECT 1 FROM config_dictionary_process_seed_epic14() l
          WHERE l.code = 'config.system.manage'
       )
      UNION
      SELECT 'config.user.read',
             'View Users, Roles, and Access assignments',
             'platform'
       WHERE NOT EXISTS (
         SELECT 1 FROM config_dictionary_process_seed_epic14() l
          WHERE l.code = 'config.user.read'
       )
      UNION
      SELECT 'config.user.manage',
             'Manage Users, Roles, Assignments, and Approvals Authority (role definitions, access grants)',
             'platform'
       WHERE NOT EXISTS (
         SELECT 1 FROM config_dictionary_process_seed_epic14() l
          WHERE l.code = 'config.user.manage'
       )
      UNION
      SELECT 'config.workflow.read',
             'View Workflow definitions, approval rules, and SoD policies',
             'platform'
       WHERE NOT EXISTS (
         SELECT 1 FROM config_dictionary_process_seed_epic14() l
          WHERE l.code = 'config.workflow.read'
       )
      UNION
      SELECT 'config.workflow.manage',
             'Manage Workflow definitions, approval rules, thresholds, and Segregation of Duties policies',
             'platform'
       WHERE NOT EXISTS (
         SELECT 1 FROM config_dictionary_process_seed_epic14() l
          WHERE l.code = 'config.workflow.manage'
       )
      UNION
      SELECT 'config.notification.read',
             'View Notification channels, templates, and send logs',
             'platform'
       WHERE NOT EXISTS (
         SELECT 1 FROM config_dictionary_process_seed_epic14() l
          WHERE l.code = 'config.notification.read'
       )
      UNION
      SELECT 'config.notification.manage',
             'Manage Notification channels, templates, presets, and send policies',
             'platform'
       WHERE NOT EXISTS (
         SELECT 1 FROM config_dictionary_process_seed_epic14() l
          WHERE l.code = 'config.notification.manage'
       )
      UNION
      SELECT 'config.document.read',
             'View Document templates and policies',
             'platform'
       WHERE NOT EXISTS (
         SELECT 1 FROM config_dictionary_process_seed_epic14() l
          WHERE l.code = 'config.document.read'
       )
      UNION
      SELECT 'config.document.manage',
             'Manage Document templates, artifacts, and retention policies',
             'platform'
       WHERE NOT EXISTS (
         SELECT 1 FROM config_dictionary_process_seed_epic14() l
          WHERE l.code = 'config.document.manage'
       );
    $seed$ LANGUAGE sql IMMUTABLE;
  `);

  // --- 3. Seed the 16 new permission rows to existing tenants' app_processes
  //    This is idempotent: ON CONFLICT DO NOTHING keeps already-seeded rows.
  pgm.sql(`
    INSERT INTO app_processes (tenant_id, code, name, module_code)
    SELECT t.id, s.code, s.name, s.module_code
      FROM tenants t
      CROSS JOIN config_dictionary_process_seed() s
    ON CONFLICT (tenant_id, code) DO NOTHING;
  `);
};

exports.down = (pgm) => {
  // --- Reverse in opposite order of up
  // 1. Remove the 16 new process rows from all tenants
  pgm.sql(`
    DELETE FROM app_processes WHERE code IN (
      'config.module.read', 'config.module.manage',
      'config.platform.read', 'config.platform.manage',
      'config.org.read', 'config.org.manage',
      'config.system.read', 'config.system.manage',
      'config.user.read', 'config.user.manage',
      'config.workflow.read', 'config.workflow.manage',
      'config.notification.read', 'config.notification.manage',
      'config.document.read', 'config.document.manage'
    );
  `);

  // 2. Restore the old seed function as the canonical name
  pgm.sql(`
    DROP FUNCTION IF EXISTS config_dictionary_process_seed();

    ALTER FUNCTION config_dictionary_process_seed_epic14()
      RENAME TO config_dictionary_process_seed;
  `);

  // 3. Remove the 16 permission codes from the catalog.
  //    Guarded like earlier permission deletions: only delete if no role_permissions
  //    reference the permission. This prevents silent permission revocation.
  pgm.sql(`
    DELETE FROM permissions p
    WHERE p.code IN (
      'config.module.read', 'config.module.manage',
      'config.platform.read', 'config.platform.manage',
      'config.org.read', 'config.org.manage',
      'config.system.read', 'config.system.manage',
      'config.user.read', 'config.user.manage',
      'config.workflow.read', 'config.workflow.manage',
      'config.notification.read', 'config.notification.manage',
      'config.document.read', 'config.document.manage'
    )
      AND NOT EXISTS (
        SELECT 1 FROM role_permissions rp WHERE rp.permission_id = p.id
      );
  `);
};
