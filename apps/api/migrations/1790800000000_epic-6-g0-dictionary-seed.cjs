/**
 * Epic 6 Gelombang 0 (§4.6 Product Core) — Application Dictionary seed for
 * Business Partner canonical party model, permissions, and API routes.
 *
 * Same three catalogues as prior waves. The dictionary is cumulative: this
 * migration wraps the Gelombang 2 catalogue (from Epic 5) as its own
 * `_epic6_g0` snapshot and redefines the canonical name as that snapshot UNION
 * the new rows.
 *
 * ── 1. API resources (14 new rows, all `platform`) ────────────────────────
 *
 *   Business Partner CRUD       GET /business-partners
 *                               GET /business-partners/:id
 *                               POST /business-partners
 *                               PATCH /business-partners/:id
 *                               DELETE /business-partners/:id
 *   Lifecycle transitions       POST /business-partners/:id/activate
 *                               POST /business-partners/:id/deactivate
 *   Role management             GET /business-partners/:id/roles
 *                               POST /business-partners/:id/roles
 *                               PATCH /business-partners/:id/roles/:roleId
 *                               DELETE /business-partners/:id/roles/:roleId
 *   Attachment references       GET /legal-entities/:id/attachment-references
 *                               POST /legal-entities/:id/attachment-references
 *                               PATCH /legal-entities/:id/attachment-references/:referenceId
 *
 * Business Partner routes are covered by the Window rule
 * `{ apiPath: "/business-partners" }` in `window-enforcement.ts` (matches on
 * segment boundary). Attachment reference routes are covered by the existing
 * `{ apiPath: "/legal-entities" }` rule. No new Window rule is needed.
 *
 * ── 2. Permissions ────────────────────────────────────────────────────────
 *
 * 26 new permissions inserted in 1790600000000_epic-6-g0-7-permissions.cjs.
 * This migration does NOT re-insert permissions (guarded by `ON CONFLICT DO NOTHING`
 * elsewhere). The permissions.cjs migration is the authoritative source.
 * This migration only seeds the corresponding app_processes and app_api_resources
 * rows to maintain parity with the permissions catalogue and route registry.
 *
 * ── 3. Processes ──────────────────────────────────────────────────────────
 *
 * Extended identically: each permission code becomes a process row in the
 * canonical seed function. The parity test asserts that `app_processes` and
 * `permissions` hold the same code set.
 *
 * Idempotent: every backfill is `ON CONFLICT DO NOTHING` and all renames are
 * guarded on the target name not already existing.
 */

exports.shorthands = undefined;

const API_RESOURCE_ADDITIONS = `
        ('api:GET /business-partners', 'platform', 'GET', '/business-partners'),
        ('api:GET /business-partners/:id', 'platform', 'GET', '/business-partners/:id'),
        ('api:POST /business-partners', 'platform', 'POST', '/business-partners'),
        ('api:PATCH /business-partners/:id', 'platform', 'PATCH', '/business-partners/:id'),
        ('api:DELETE /business-partners/:id', 'platform', 'DELETE', '/business-partners/:id'),
        ('api:POST /business-partners/:id/activate', 'platform', 'POST', '/business-partners/:id/activate'),
        ('api:POST /business-partners/:id/deactivate', 'platform', 'POST', '/business-partners/:id/deactivate'),
        ('api:GET /business-partners/:id/roles', 'platform', 'GET', '/business-partners/:id/roles'),
        ('api:POST /business-partners/:id/roles', 'platform', 'POST', '/business-partners/:id/roles'),
        ('api:PATCH /business-partners/:id/roles/:roleId', 'platform', 'PATCH', '/business-partners/:id/roles/:roleId'),
        ('api:DELETE /business-partners/:id/roles/:roleId', 'platform', 'DELETE', '/business-partners/:id/roles/:roleId'),
        ('api:GET /legal-entities/:id/attachment-references', 'platform', 'GET', '/legal-entities/:id/attachment-references'),
        ('api:POST /legal-entities/:id/attachment-references', 'platform', 'POST', '/legal-entities/:id/attachment-references'),
        ('api:PATCH /legal-entities/:id/attachment-references/:referenceId', 'platform', 'PATCH', '/legal-entities/:id/attachment-references/:referenceId')
`;

const PERMISSIONS = [
  { code: "business_partner.create", description: "Create a new Business Partner (party canonical)" },
  { code: "business_partner.read", description: "View Business Partner records (subject to Data Scope)" },
  { code: "business_partner.update", description: "Modify Business Partner details and lifecycle status" },
  { code: "business_partner.delete", description: "Hard-delete or tombstone Business Partner records" },
  { code: "business_partner.activate", description: "Transition Business Partner from draft to active" },
  { code: "business_partner.deactivate", description: "Transition Business Partner to inactive or tombstone" },

  { code: "bp_role.create", description: "Assign a role (employee/customer/vendor/etc.) to a Business Partner" },
  { code: "bp_role.read", description: "View Business Partner role assignments" },
  { code: "bp_role.update", description: "Modify role status (active/inactive)" },
  { code: "bp_role.delete", description: "Remove a role from a Business Partner" },

  { code: "bp_contact.create", description: "Create Contact under a Business Partner (Organization only)" },
  { code: "bp_contact.read", description: "View Business Partner Contacts" },
  { code: "bp_contact.update", description: "Modify Contact details and lifecycle status" },
  { code: "bp_contact.delete", description: "Remove or deactivate a Contact" },
  { code: "bp_contact.link_user", description: "Link a Contact to a platform User account" },

  { code: "bp_address.create", description: "Add an address to a Business Partner" },
  { code: "bp_address.read", description: "View Business Partner addresses" },
  { code: "bp_address.update", description: "Modify address details and effective dating" },
  { code: "bp_address.delete", description: "Deactivate or remove an address" },

  { code: "tax_registration.create", description: "Register a tax identifier (NPWP, NITKU, VAT, etc.)" },
  { code: "tax_registration.read", description: "View tax registrations" },
  { code: "tax_registration.update", description: "Modify tax registration details and effective dating" },
  { code: "tax_registration.delete", description: "Deactivate or remove a tax registration" },
  { code: "tax_registration.verify", description: "Mark a tax registration as verified or rejected" },

  { code: "employee_profile.read", description: "View Employee Profile details (sensitive; separate from workforce.read)" },
  { code: "employee_profile.manage", description: "Create and maintain Employee Profiles" },
];

const PROCESS_ROWS = PERMISSIONS.map(
  (p) => `      SELECT '${p.code}', '${p.description.replace(/'/g, "''")}', 'platform'
       WHERE NOT EXISTS (
         SELECT 1 FROM config_dictionary_process_seed_epic6_g0() l WHERE l.code = '${p.code}'
       )`,
).join("\n      UNION\n");

exports.up = (pgm) => {
  pgm.sql(`
    -- 1. Keep the Epic 5 G2 API-resource catalogue reachable under its own name
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
         WHERE p.proname = 'config_dictionary_api_resource_seed_epic6_g0'
           AND n.nspname = current_schema()
      ) THEN
        ALTER FUNCTION config_dictionary_api_resource_seed()
          RENAME TO config_dictionary_api_resource_seed_epic6_g0;
      END IF;
    END
    $$;

    -- 2. Extend the canonical API-resource catalogue -------------------------
    CREATE OR REPLACE FUNCTION config_dictionary_api_resource_seed()
    RETURNS TABLE (code TEXT, name TEXT, module_code TEXT, http_method TEXT, path_pattern TEXT) AS $seed$
      SELECT s.code, s.name, s.module_code, s.http_method, s.path_pattern
        FROM config_dictionary_api_resource_seed_epic6_g0() s
      UNION
      SELECT a.code, a.http_method || ' ' || a.path_pattern, a.module_code, a.http_method, a.path_pattern
        FROM (VALUES
          ${API_RESOURCE_ADDITIONS}
        ) AS a(code, module_code, http_method, path_pattern);
    $seed$ LANGUAGE sql IMMUTABLE;

    -- 3. Backfill the new rows for tenants that already exist ----------------
    INSERT INTO app_api_resources (tenant_id, code, name, module_code, http_method, path_pattern)
    SELECT t.id, a.code, a.http_method || ' ' || a.path_pattern, a.module_code, a.http_method, a.path_pattern
      FROM tenants t
      CROSS JOIN (VALUES
        ${API_RESOURCE_ADDITIONS}
      ) AS a(code, module_code, http_method, path_pattern)
    ON CONFLICT (tenant_id, code) DO NOTHING;

    -- 4. Keep the Epic 5 G2 Process catalogue reachable under its own name ---
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
         WHERE p.proname = 'config_dictionary_process_seed_epic6_g0'
           AND n.nspname = current_schema()
      ) THEN
        ALTER FUNCTION config_dictionary_process_seed()
          RENAME TO config_dictionary_process_seed_epic6_g0;
      END IF;
    END
    $$;

    -- 5. Redefine the canonical Process catalogue as legacy + the new rows ---
    CREATE OR REPLACE FUNCTION config_dictionary_process_seed()
    RETURNS TABLE (code TEXT, name TEXT, module_code TEXT) AS $seed$
      SELECT s.code, s.name, s.module_code
        FROM config_dictionary_process_seed_epic6_g0() s
      UNION
${PROCESS_ROWS};
    $seed$ LANGUAGE sql IMMUTABLE;

    -- 6. Existing tenants receive the new Process rows -----------------------
    INSERT INTO app_processes (tenant_id, code, name, module_code)
    SELECT t.id, s.code, s.name, s.module_code
      FROM tenants t
      CROSS JOIN config_dictionary_process_seed() s
    ON CONFLICT (tenant_id, code) DO NOTHING;
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    -- Reverse in the opposite order to up.
    DELETE FROM app_processes WHERE code IN (
      ${PERMISSIONS.map((p) => `'${p.code}'`).join(", ")}
    );

    DROP FUNCTION IF EXISTS config_dictionary_process_seed();

    ALTER FUNCTION config_dictionary_process_seed_epic6_g0()
      RENAME TO config_dictionary_process_seed;

    DELETE FROM app_api_resources
     WHERE code IN (
       SELECT a.code FROM (VALUES
         ${API_RESOURCE_ADDITIONS}
       ) AS a(code, module_code, http_method, path_pattern)
     );

    DROP FUNCTION IF EXISTS config_dictionary_api_resource_seed();

    ALTER FUNCTION config_dictionary_api_resource_seed_epic6_g0()
      RENAME TO config_dictionary_api_resource_seed;

    -- Permission rows belong to 1790600000000 and are reverted there, after
    -- this dictionary migration has been reverted.
  `);
};
