exports.up = (pgm) => {
  pgm.sql(`

    -- -----------------------------------------------------------------------
    -- Phase 11C — Business Admin Console Foundation
    -- Declares the single read-only permission that gates the tenant-local
    -- Business Admin Console. No table, no Builder surface, no manifest
    -- runtime, and no mutation capability is introduced here: the console
    -- reads existing tenant-scoped data through existing services only.
    --
    -- This is deliberately NOT a superuser grant. It confers read access to
    -- administrative SUMMARIES within the actor's own tenant; every
    -- underlying record remains subject to its own permission and Data
    -- Scope rules. No role_permissions grant is made here — assigning this
    -- permission to a role stays an explicit tenant administration act
    -- (ADR-0010 keeps full-access role synchronisation in
    -- apps/api/scripts/sync-role-permissions.ts).
    -- -----------------------------------------------------------------------

    INSERT INTO permissions (code, description) VALUES
      ('admin.console.read', 'View the tenant-local Business Admin Console overview and read-only administration summaries')
    ON CONFLICT (code) DO NOTHING;

  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    DELETE FROM permissions WHERE code IN ('admin.console.read');
  `);
};
