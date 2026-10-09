/**
 * Phase 2 WP-PRO-01 — Dictionary seed extension (permissions + API resources)
 *
 * Migration 1792000000010 (phase2-pro-01-vendor-invoice.cjs) inserted 3 vendor
 * invoice permissions into the permissions catalogue and registered 5 HTTP routes
 * in procurement.routes.ts, but did not extend the dictionary seed functions.
 * This migration completes the pattern: extending both the process and API resource
 * catalogues with vendor invoice entries, and backfilling existing tenants.
 *
 * Permissions (3):
 *   - supply_chain.vendor_invoice.read    → procurement_management module
 *   - supply_chain.vendor_invoice.manage  → procurement_management module
 *   - supply_chain.vendor_invoice.approve → procurement_management module
 *
 * Routes (10 total, canonical + alias paths):
 *   POST   /procurement/invoices                        (canonical)
 *   GET    /procurement/invoices/:id                    (canonical)
 *   GET    /procurement/invoices                        (canonical)
 *   POST   /procurement/invoices/:id/submit             (canonical)
 *   POST   /procurement/invoices/:id/approve            (canonical)
 *   POST   /supply-chain/advanced/invoices              (alias)
 *   GET    /supply-chain/advanced/invoices/:id          (alias)
 *   GET    /supply-chain/advanced/invoices              (alias)
 *   POST   /supply-chain/advanced/invoices/:id/submit   (alias)
 *   POST   /supply-chain/advanced/invoices/:id/approve  (alias)
 *
 * Follows the pattern from Phase 1A (1792000000001) and 1B (1792000000003):
 * keep the prior seed functions under their own names, extend canonical as UNION,
 * backfill via ON CONFLICT DO NOTHING.
 *
 * Snapshot-name note: the Process seed chain last snapshotted under
 * config_dictionary_process_seed_phase1a (migration 0001), and no migration
 * between 0002 and 0010 touched config_dictionary_process_seed. Reusing that
 * name here would collide with 0001's snapshot and silently skip the rename,
 * rebuilding canonical from the stale pre-accounting state. We therefore
 * snapshot under a fresh name, config_dictionary_process_seed_phase2_pro01.
 * The API Resource chain last snapshotted under config_dictionary_api_resource_seed_phase1g
 * (migration 0009); phase1b is free and used here for consistency with the
 * Phase 1B numbering, but it too is a fresh name in that chain.
 */

exports.shorthands = undefined;

const PROCESS_ROWS = `
      ('supply_chain.vendor_invoice.read', 'View vendor invoice (AP invoice) records', 'procurement_management'),
      ('supply_chain.vendor_invoice.manage', 'Create and edit vendor invoice records', 'procurement_management'),
      ('supply_chain.vendor_invoice.approve', 'Submit and approve vendor invoices', 'procurement_management')
`;

const PHASE_1A_PROCESS_ROWS = `
      ('finance.accounting.read', 'View accounting GL, journals, periods, trial balance (subject to Data Scope)', 'finance'),
      ('finance.accounting.manage', 'Create and edit draft journals, post balanced journals', 'finance'),
      ('finance.accounting.approve', 'Approve journal posting, lock periods', 'finance'),
      ('finance.accounting.configure', 'Maintain chart of accounts, posting rules', 'finance'),
      ('finance.accounting.period.lock', 'Lock/reopen accounting periods (restricted role)', 'finance')
`;

const API_RESOURCE_ROWS = `
      ('api:POST /procurement/invoices', 'procurement_management', 'POST', '/procurement/invoices'),
      ('api:GET /procurement/invoices/:id', 'procurement_management', 'GET', '/procurement/invoices/:id'),
      ('api:GET /procurement/invoices', 'procurement_management', 'GET', '/procurement/invoices'),
      ('api:POST /procurement/invoices/:id/submit', 'procurement_management', 'POST', '/procurement/invoices/:id/submit'),
      ('api:POST /procurement/invoices/:id/approve', 'procurement_management', 'POST', '/procurement/invoices/:id/approve'),
      ('api:POST /supply-chain/advanced/invoices', 'procurement_management', 'POST', '/supply-chain/advanced/invoices'),
      ('api:GET /supply-chain/advanced/invoices/:id', 'procurement_management', 'GET', '/supply-chain/advanced/invoices/:id'),
      ('api:GET /supply-chain/advanced/invoices', 'procurement_management', 'GET', '/supply-chain/advanced/invoices'),
      ('api:POST /supply-chain/advanced/invoices/:id/submit', 'procurement_management', 'POST', '/supply-chain/advanced/invoices/:id/submit'),
      ('api:POST /supply-chain/advanced/invoices/:id/approve', 'procurement_management', 'POST', '/supply-chain/advanced/invoices/:id/approve')
`;

exports.up = (pgm) => {
  pgm.sql(`
    -- -----------------------------------------------------------------------
    -- 1. Extend Process seed function
    -- -----------------------------------------------------------------------
    -- 1a. Keep the prior Process catalogue reachable under its own name
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
         WHERE p.proname = 'config_dictionary_process_seed_phase2_pro01'
           AND n.nspname = current_schema()
      ) THEN
        ALTER FUNCTION config_dictionary_process_seed()
          RENAME TO config_dictionary_process_seed_phase2_pro01;
      END IF;
    END
    $$;

    -- 1b. Redefine the canonical Process catalogue as prior + WP-PRO-01
    CREATE OR REPLACE FUNCTION config_dictionary_process_seed()
    RETURNS TABLE (code TEXT, name TEXT, module_code TEXT) AS $seed$
      SELECT s.code, s.name, s.module_code
        FROM config_dictionary_process_seed_phase2_pro01() s
      UNION
      SELECT a.code, a.name, a.module_code
        FROM (VALUES
          ${PROCESS_ROWS}
        ) AS a(code, name, module_code);
    $seed$ LANGUAGE sql IMMUTABLE;

    -- 1c. Backfill app_processes for existing tenants
    INSERT INTO app_processes (tenant_id, code, name, module_code)
    SELECT t.id, a.code, a.name, a.module_code
      FROM tenants t
      CROSS JOIN (VALUES
        ${PROCESS_ROWS}
      ) AS a(code, name, module_code)
    ON CONFLICT (tenant_id, code) DO NOTHING;

    -- -----------------------------------------------------------------------
    -- 2. Extend API Resource seed function
    -- -----------------------------------------------------------------------
    -- 2a. Keep the prior API Resource catalogue reachable under its own name
    DO $$
    BEGIN
      IF EXISTS (
        SELECT 1 FROM pg_proc p
          JOIN pg_namespace n ON n.oid = p.pronamespace
         WHERE p.proname = 'config_dictionary_api_resource_seed'
           AND n.nspname = current_schema()
      ) AND NOT EXISTS (
        SELECT 1 FROM pg_proc p
          JOIN pg_namespace n ON n.oid = p.pronamespace
         WHERE p.proname = 'config_dictionary_api_resource_seed_phase1b'
           AND n.nspname = current_schema()
      ) THEN
        ALTER FUNCTION config_dictionary_api_resource_seed()
          RENAME TO config_dictionary_api_resource_seed_phase1b;
      END IF;
    END
    $$;

    -- 2b. Redefine the canonical API Resource catalogue as Phase 1B + WP-PRO-01
    CREATE OR REPLACE FUNCTION config_dictionary_api_resource_seed()
    RETURNS TABLE (code TEXT, name TEXT, module_code TEXT, http_method TEXT, path_pattern TEXT) AS $seed$
      SELECT s.code, s.name, s.module_code, s.http_method, s.path_pattern
        FROM config_dictionary_api_resource_seed_phase1b() s
      UNION
      SELECT a.code, a.http_method || ' ' || a.path_pattern, a.module_code, a.http_method, a.path_pattern
        FROM (VALUES
          ${API_RESOURCE_ROWS}
        ) AS a(code, module_code, http_method, path_pattern);
    $seed$ LANGUAGE sql IMMUTABLE;

    -- 2c. Backfill app_api_resources for existing tenants
    INSERT INTO app_api_resources (tenant_id, code, name, module_code, http_method, path_pattern)
    SELECT t.id, a.code, a.http_method || ' ' || a.path_pattern, a.module_code, a.http_method, a.path_pattern
      FROM tenants t
      CROSS JOIN (VALUES
        ${API_RESOURCE_ROWS}
      ) AS a(code, module_code, http_method, path_pattern)
    ON CONFLICT (tenant_id, code) DO NOTHING;
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    -- Reverse in opposite order: API resources first, then processes

    -- 1. Revert API Resource catalogue
    DELETE FROM app_api_resources
     WHERE code IN (
       SELECT a.code FROM (VALUES
         ${API_RESOURCE_ROWS}
       ) AS a(code, module_code, http_method, path_pattern)
     );

    DROP FUNCTION IF EXISTS config_dictionary_api_resource_seed();

    ALTER FUNCTION config_dictionary_api_resource_seed_phase1b()
      RENAME TO config_dictionary_api_resource_seed;

    -- 2. Revert Process catalogue
    DELETE FROM app_processes
     WHERE code IN (
       SELECT a.code FROM (VALUES
         ${PROCESS_ROWS}
       ) AS a(code, name, module_code)
     );

    DROP FUNCTION IF EXISTS config_dictionary_process_seed();

    -- The rename in up() only happens when the snapshot name is free. If a
    -- database previously ran a broken variant of this migration whose
    -- snapshot name collided (e.g. phase1a), phase2_pro01 never existed —
    -- in that case rebuild canonical from the Phase 1A snapshot plus the
    -- finance rows it is supposed to carry, so the rollback restores the same
    -- catalogue the Phase 1 chain left behind.
    DO $$
    BEGIN
      IF EXISTS (
        SELECT 1 FROM pg_proc p
          JOIN pg_namespace n ON n.oid = p.pronamespace
         WHERE p.proname = 'config_dictionary_process_seed_phase2_pro01'
           AND n.nspname = current_schema()
      ) THEN
        ALTER FUNCTION config_dictionary_process_seed_phase2_pro01()
          RENAME TO config_dictionary_process_seed;
      ELSE
        CREATE OR REPLACE FUNCTION config_dictionary_process_seed()
        RETURNS TABLE (code TEXT, name TEXT, module_code TEXT) AS $seed$
          SELECT s.code, s.name, s.module_code
            FROM config_dictionary_process_seed_phase1a() s
          UNION
          SELECT a.code, a.name, a.module_code
            FROM (VALUES
              ${PHASE_1A_PROCESS_ROWS}
            ) AS a(code, name, module_code);
        $seed$ LANGUAGE sql IMMUTABLE;
      END IF;
    END
    $$;
  `);
};
