/**
 * Epic 4 Wave 1 — Role definition (CORE-ROADMAP.md §4.4, Gelombang 1 steps
 * 5–9). This migration carries only the schema and catalogue half of those
 * steps: the repository, service and routes that use them land separately.
 *
 * Two changes, both load-bearing for the waves that follow:
 *
 * 1. `roles.version` — step 9 requires an optimistic version check, and the
 *    definition a reviewer approved in the impact preview must be the exact
 *    definition the commit applies to. Without a version column the server
 *    cannot tell "another admin changed this role while you were reading it"
 *    from "you changed it yourself", so the preview would be a lie whenever
 *    two administrators work at once. This is a concurrency token, not
 *    editable metadata: Epic 4 open item 1 governs which role fields a tenant
 *    may edit, and that item is still open, so no second column is added here.
 *
 * 2. `role.manage` — §4.4 Putaran 3 lets Super Admin and delegated Admin
 *    Tenant create, edit and copy Roles. `user.role.manage` (Phase 11F)
 *    deliberately grants only assignment/removal of Roles that already exist
 *    (docs/HANDOFF-9ROUTER-CC.md, high-risk table), so mutating a Role
 *    definition needs its own code. Reusing the assignment permission would
 *    silently widen an authority Phase 11F scoped on purpose.
 *
 * The dictionary half exists because Epic 2 Wave 1 bound these two catalogues
 * to each other: `apps/api/tests/dictionary-seed-parity.test.ts` asserts
 * `app_processes` and `permissions` hold exactly the same code set. A new
 * permission that is not also a seeded Process fails that test, so the seed
 * catalogue function is extended here in the same migration that declares the
 * permission. The alternative — leaving the seed alone and re-running it later
 * — is what the parity test is designed to catch.
 *
 * Shape, copied from 1787600000000: the existing catalogue function is renamed
 * to a `_legacy` name and the canonical name is redefined over it plus the new
 * row. The 164-row VALUES list is not restated; a fresh install renaming an
 * empty function would be the only way this differs, and it cannot happen
 * because 1787300000000 always runs first.
 *
 * Code and description are written as SQL literals rather than interpolated
 * constants: the platform boundary validator reads the migration source, and
 * a `'${CONST}'` pair is invisible to it.
 *
 * No `role_permissions` row is written. Clone-on-copy is runtime behaviour and
 * `scripts/sync-role-permissions.ts` remains the only sanctioned bulk writer;
 * the platform boundary validator rejects a migration that grants tenant
 * Roles.
 */
exports.up = (pgm) => {
  pgm.sql(`
    -- 1. Optimistic-concurrency token for role definition edits --------------
    --    Existing roles are definition-version 1; the value advances on every
    --    accepted definition change, never on a read.
    ALTER TABLE roles ADD COLUMN version INTEGER NOT NULL DEFAULT 1;

    -- 2. Keep the seeded permission catalogue reachable under a legacy name --
    --    Guarded so a database that already ran this is a no-op rather than an
    --    error.
    DO $$
    BEGIN
      IF EXISTS (
        SELECT 1 FROM pg_proc p
          JOIN pg_namespace n ON n.oid = p.pronamespace
         WHERE p.proname = 'config_dictionary_process_seed'
           AND n.nspname = current_schema()
      ) AND NOT EXISTS (
        SELECT 1 FROM pg_proc p
          JOIN pg_namespace n ON n.oid = p.pronamespace
         WHERE p.proname = 'config_dictionary_process_seed_legacy'
           AND n.nspname = current_schema()
      ) THEN
        ALTER FUNCTION config_dictionary_process_seed()
          RENAME TO config_dictionary_process_seed_legacy;
      END IF;
    END
    $$;

    -- 3. Redefine the canonical catalogue as legacy + the new Process --------
    --    Same signature, so the tenant trigger picks it up unchanged. UNION
    --    (not UNION ALL) plus the NOT EXISTS guard makes the code unique for
    --    two independent reasons: the guard is what stops a redefinition from
    --    inventing a second copy of a row the legacy list already carries, and
    --    UNION keeps the result a set even if that guard were ever defeated.
    CREATE OR REPLACE FUNCTION config_dictionary_process_seed()
    RETURNS TABLE (code TEXT, name TEXT, module_code TEXT) AS $seed$
      SELECT s.code, s.name, s.module_code
        FROM config_dictionary_process_seed_legacy() s
      UNION
      SELECT 'role.manage',
             'Manage tenant Role definitions (create, edit, copy, delete)',
             'platform'
       WHERE NOT EXISTS (
         SELECT 1 FROM config_dictionary_process_seed_legacy() l
          WHERE l.code = 'role.manage'
       );
    $seed$ LANGUAGE sql IMMUTABLE;

    -- 4. The permission itself ----------------------------------------------
    INSERT INTO permissions (code, description) VALUES
      ('role.manage', 'Manage tenant Role definitions (create, edit, copy, delete)')
    ON CONFLICT (code) DO NOTHING;

    -- 5. Existing tenants receive the new Process row ------------------------
    --    ON CONFLICT DO NOTHING keeps every already-seeded row untouched, so
    --    this is safe to re-run and does not resurrect rows a tenant removed.
    INSERT INTO app_processes (tenant_id, code, name, module_code)
    SELECT t.id, s.code, s.name, s.module_code
      FROM tenants t
      CROSS JOIN config_dictionary_process_seed() s
    ON CONFLICT (tenant_id, code) DO NOTHING;
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    -- Reverse in the opposite order to up. The wrapper function is dropped
    -- before the legacy name is restored, because two functions cannot both
    -- hold the canonical name at once.
    DELETE FROM app_processes WHERE code = 'role.manage';

    DROP FUNCTION IF EXISTS config_dictionary_process_seed();

    ALTER FUNCTION config_dictionary_process_seed_legacy()
      RENAME TO config_dictionary_process_seed;

    -- Guarded like 1786000000000_tenant-name-update-permission.cjs: once a
    -- Role has been granted \`role.manage\`, a plain delete would cascade through
    -- \`role_permissions\` and revoke the grant from a live Role with no trace.
    -- A leftover catalogue row is harmless; a silent revocation is not (§4.4 G).
    DELETE FROM permissions p
    WHERE p.code = 'role.manage'
      AND NOT EXISTS (
        SELECT 1 FROM role_permissions rp WHERE rp.permission_id = p.id
      );

    ALTER TABLE roles DROP COLUMN version;
  `);
};
