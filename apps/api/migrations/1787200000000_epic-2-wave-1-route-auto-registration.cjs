/**
 * Epic 2 Wave 1 — Automatic route registration (CORE-ROADMAP.md §4.2, §4.3).
 *
 * Locked decision (option C): the route guard ships first in REPORT mode.
 * Every client route is inventoried and its resolution checked, but nothing
 * blocks rendering yet. After every route resolves cleanly, flipping
 * GUARD_ENFORCE in apps/web/src/lib/routeRegistry.ts turns the same guard
 * fail-closed with no schema change.
 *
 * Auto-registration is the point: a page does not have to be entered by hand
 * to exist in the dictionary. This migration
 *   1. widens app_windows with the three columns a route needs to describe
 *      itself (registration status, required permissions, parent route),
 *   2. registers the `platform` module the shell-level windows belong to,
 *   3. seeds one window row per route for every existing tenant, and
 *   4. installs the tenant trigger that does the same for every future tenant.
 *
 * One row per route comes from ROUTE_REGISTRY in
 * apps/api/src/domain/configuration/route-registry.ts. The catalogue below is a
 * copy of that file; apps/api/tests/integration/app-metadata.test.ts compares
 * the seeded rows against the registry and fails if the two ever disagree.
 *
 * Statuses (§4.3 "Status resmi setiap route"):
 *   di_menu / tersembunyi / belum_terdaftar.
 *
 * No permission is introduced (149 before and after); no role_permissions row
 * is written. A route's required permissions are data on its window row, read
 * by the guard — never a grant.
 */

const SEED_ROWS = `
      ('route:/', 'Overview', 'platform', 'di_menu', ARRAY[]::text[], NULL, 'Landing page; cards themselves are filtered by each section''s permission.'),
      ('route:/profile', 'Profile', 'platform', 'tersembunyi', ARRAY[]::text[], NULL, 'Self-service profile. Authenticated only — a user always sees their own page.'),
      ('route:/complaints', 'Complaints', 'customer_complaint', 'di_menu', ARRAY['complaint.read', 'complaint.manage']::text[], NULL, NULL),
      ('route:/complaints/new', 'Raise a Complaint', 'customer_complaint', 'tersembunyi', ARRAY['complaint.read', 'complaint.manage']::text[], '/complaints', NULL),
      ('route:/complaints/:complaintId', 'Complaint Detail', 'customer_complaint', 'tersembunyi', ARRAY['complaint.read', 'complaint.manage']::text[], '/complaints', NULL),
      ('route:/queue', 'Queue', 'customer_complaint', 'di_menu', ARRAY['complaint.read', 'complaint.manage']::text[], NULL, NULL),
      ('route:/queue/:complaintId', 'Queue Item', 'customer_complaint', 'tersembunyi', ARRAY['complaint.read', 'complaint.manage']::text[], '/queue', NULL),
      ('route:/verification', 'Verification', 'customer_complaint', 'di_menu', ARRAY['workflow.instance.manage']::text[], NULL, 'Gated on workflow.instance.manage until a dedicated verifier permission lands.'),
      ('route:/verification/:complaintId', 'Verification Detail', 'customer_complaint', 'tersembunyi', ARRAY['workflow.instance.manage']::text[], '/verification', NULL),
      ('route:/management', 'Management Dashboard', 'customer_complaint', 'di_menu', ARRAY['complaint.dashboard.read']::text[], NULL, NULL),
      ('route:/service-quality', 'Service Quality', 'customer_complaint', 'di_menu', ARRAY['service_quality.read', 'service_quality.configure']::text[], NULL, NULL),
      ('route:/administration/complaints', 'Complaint Configuration', 'customer_complaint', 'tersembunyi', ARRAY['complaint.configure']::text[], NULL, 'SECURITY GAP CLOSED (Epic 3 §4.3): previously reachable with no client-side gate.'),
      ('route:/surveys', 'Surveys', 'survey_assessment', 'di_menu', ARRAY['survey.manage', 'survey.analytics.read']::text[], NULL, NULL),
      ('route:/surveys/:code', 'Survey Detail', 'survey_assessment', 'tersembunyi', ARRAY['survey.manage', 'survey.analytics.read']::text[], '/surveys', NULL),
      ('route:/my-surveys', 'My Surveys', 'survey_assessment', 'di_menu', ARRAY['survey.respond']::text[], NULL, NULL),
      ('route:/my-surveys/:assignmentId', 'Survey Response', 'survey_assessment', 'tersembunyi', ARRAY['survey.respond']::text[], '/my-surveys', NULL),
      ('route:/work-orders', 'Work Orders', 'service_operations', 'di_menu', ARRAY['service_operations.manage', 'service_operations.read']::text[], NULL, NULL),
      ('route:/work-orders/:workOrderId', 'Work Order Detail', 'service_operations', 'tersembunyi', ARRAY['service_operations.manage', 'service_operations.read']::text[], '/work-orders', NULL),
      ('route:/my-work', 'My Work', 'service_operations', 'di_menu', ARRAY['service_operations.execute']::text[], NULL, NULL),
      ('route:/my-work/:workOrderId', 'My Work Detail', 'service_operations', 'tersembunyi', ARRAY['service_operations.execute']::text[], '/my-work', NULL),
      ('route:/service-types', 'Service Types', 'service_operations', 'di_menu', ARRAY['service_operations.configure']::text[], NULL, NULL),
      ('route:/service-packs', 'Service Packs', 'service_operations', 'di_menu', ARRAY['service_operations.pack.manage']::text[], NULL, NULL),
      ('route:/service-optimization', 'Service Optimization', 'service_operations', 'di_menu', ARRAY['service_operations.optimization.read', 'service_operations.optimization.apply']::text[], NULL, NULL),
      ('route:/service-optimization/:runId', 'Optimization Run Detail', 'service_operations', 'tersembunyi', ARRAY['service_operations.optimization.read', 'service_operations.optimization.apply']::text[], '/service-optimization', NULL),
      ('route:/customer-commercial', 'Customers', 'customer_commercial', 'di_menu', ARRAY['customer.read']::text[], NULL, NULL),
      ('route:/sales', 'Sales & Pipeline', 'customer_commercial', 'di_menu', ARRAY['sales.read', 'sales.manage']::text[], NULL, NULL),
      ('route:/employees', 'Employees', 'workforce', 'di_menu', ARRAY['workforce.read', 'workforce.manage']::text[], NULL, NULL),
      ('route:/employees/:employeeId', 'Employee Detail', 'workforce', 'tersembunyi', ARRAY['workforce.read', 'workforce.manage']::text[], '/employees', NULL),
      ('route:/workforce/attendance', 'Attendance & Rosters', 'workforce', 'di_menu', ARRAY['workforce.attendance.read', 'workforce.attendance.manage']::text[], NULL, NULL),
      ('route:/workforce/leave-overtime', 'Leave & Overtime', 'workforce', 'di_menu', ARRAY['workforce.leave.read', 'workforce.leave.manage', 'workforce.leave.approve']::text[], NULL, NULL),
      ('route:/workforce/payroll', 'Payroll', 'workforce', 'di_menu', ARRAY['workforce.payroll.read', 'workforce.payroll.manage', 'workforce.payroll.approve']::text[], NULL, NULL),
      ('route:/workforce/recruitment', 'Recruitment', 'workforce', 'di_menu', ARRAY['workforce.recruitment.read', 'workforce.recruitment.manage']::text[], NULL, NULL),
      ('route:/workforce/performance', 'Talent & Performance', 'workforce', 'di_menu', ARRAY['workforce.performance.read', 'workforce.performance.manage']::text[], NULL, NULL),
      ('route:/workforce/planning', 'Workforce Planning', 'workforce', 'di_menu', ARRAY['workforce.planning.read', 'workforce.planning.manage', 'workforce.planning.apply']::text[], NULL, NULL),
      ('route:/items', 'Items & Stock', 'supply_chain', 'di_menu', ARRAY['supply_chain.read']::text[], NULL, NULL),
      ('route:/suppliers', 'Suppliers', 'supply_chain', 'di_menu', ARRAY['supply_chain.read']::text[], NULL, NULL),
      ('route:/purchasing', 'Purchasing', 'supply_chain', 'di_menu', ARRAY['supply_chain.manage', 'supply_chain.stock.manage']::text[], NULL, NULL),
      ('route:/wms/warehouses', 'Warehouses & Tracking', 'warehouse_management', 'di_menu', ARRAY['supply_chain.warehouse.read', 'supply_chain.warehouse.manage']::text[], NULL, NULL),
      ('route:/wms/operations', 'Stock Operations', 'warehouse_management', 'di_menu', ARRAY['supply_chain.inventory.read', 'supply_chain.inventory.manage', 'supply_chain.inventory.approve']::text[], NULL, NULL),
      ('route:/wms/valuation', 'Valuation & Landed Cost', 'warehouse_management', 'di_menu', ARRAY['supply_chain.valuation.read', 'supply_chain.valuation.manage']::text[], NULL, NULL),
      ('route:/supply-chain/warehouses', 'Warehouses (legacy path)', 'warehouse_management', 'tersembunyi', ARRAY['supply_chain.warehouse.read', 'supply_chain.warehouse.manage']::text[], NULL, 'Redirect to /wms/warehouses.'),
      ('route:/supply-chain/operations', 'Stock Operations (legacy path)', 'warehouse_management', 'tersembunyi', ARRAY['supply_chain.inventory.read', 'supply_chain.inventory.manage', 'supply_chain.inventory.approve']::text[], NULL, 'Redirect to /wms/operations.'),
      ('route:/supply-chain/valuation', 'Valuation (legacy path)', 'warehouse_management', 'tersembunyi', ARRAY['supply_chain.valuation.read', 'supply_chain.valuation.manage']::text[], NULL, 'Redirect to /wms/valuation.'),
      ('route:/procurement/rfqs', 'RFQ & Tendering', 'procurement_management', 'di_menu', ARRAY['supply_chain.procurement.read', 'supply_chain.procurement.manage', 'supply_chain.procurement.award']::text[], NULL, NULL),
      ('route:/procurement/contracts', 'Supplier Contracts & Scorecards', 'procurement_management', 'di_menu', ARRAY['supply_chain.contract.read', 'supply_chain.contract.manage', 'supply_chain.contract.approve']::text[], NULL, NULL),
      ('route:/procurement/spend-analytics', 'Spend Analytics', 'procurement_management', 'di_menu', ARRAY['supply_chain.analytics.read']::text[], NULL, NULL),
      ('route:/supply-chain/procurement', 'RFQ (legacy path)', 'procurement_management', 'tersembunyi', ARRAY['supply_chain.procurement.read', 'supply_chain.procurement.manage', 'supply_chain.procurement.award']::text[], NULL, 'Redirect to /procurement/rfqs.'),
      ('route:/supply-chain/contracts', 'Contracts (legacy path)', 'procurement_management', 'tersembunyi', ARRAY['supply_chain.contract.read', 'supply_chain.contract.manage', 'supply_chain.contract.approve']::text[], NULL, 'Redirect to /procurement/contracts.'),
      ('route:/supply-chain/spend-analytics', 'Spend Analytics (legacy path)', 'procurement_management', 'tersembunyi', ARRAY['supply_chain.analytics.read']::text[], NULL, 'Redirect to /procurement/spend-analytics.'),
      ('route:/assets', 'Assets', 'asset', 'di_menu', ARRAY['asset.read', 'asset.manage', 'asset.move']::text[], NULL, NULL),
      ('route:/assets/:assetId', 'Asset Detail', 'asset', 'tersembunyi', ARRAY['asset.read', 'asset.manage', 'asset.move']::text[], '/assets', NULL),
      ('route:/asset-maintenance', 'Asset Maintenance', 'asset', 'di_menu', ARRAY['asset.maintenance.read', 'asset.maintenance.manage']::text[], NULL, NULL),
      ('route:/asset-maintenance/work-orders/:workOrderId', 'Maintenance Work Order Detail', 'asset', 'tersembunyi', ARRAY['asset.maintenance.read', 'asset.maintenance.manage']::text[], '/asset-maintenance', NULL),
      ('route:/asset-maintenance/assets/:assetId', 'Asset Performance', 'asset', 'tersembunyi', ARRAY['asset.meter.manage', 'asset.downtime.manage', 'asset.analytics.read']::text[], '/asset-maintenance', 'Narrower than the parent: reads meters, downtime, and performance analytics.'),
      ('route:/finance/accounts', 'Cash & Bank', 'finance', 'di_menu', ARRAY['finance.configure', 'finance.read']::text[], NULL, NULL),
      ('route:/finance/transactions', 'Transactions', 'finance', 'di_menu', ARRAY['finance.read', 'finance.manage']::text[], NULL, NULL),
      ('route:/finance/transactions/:transactionId', 'Transaction Detail', 'finance', 'tersembunyi', ARRAY['finance.read', 'finance.manage']::text[], '/finance/transactions', 'Read-only exception (§4.3): own window identity so it can be locked apart from the list.'),
      ('route:/finance/cashflow', 'Cashflow', 'finance', 'di_menu', ARRAY['finance.read']::text[], NULL, NULL),
      ('route:/hse', 'HSE', 'hse', 'di_menu', ARRAY['hse.read']::text[], NULL, NULL),
      ('route:/hse/report', 'Report an Incident', 'hse', 'tersembunyi', ARRAY['hse.report', 'hse.manage']::text[], '/hse', 'The create form is gated server-side by \`hse.report\` (hse.service.ts:110), not \`hse.manage\`; both are accepted here so an assignee can also open it to correct a record.'),
      ('route:/hse/records/:recordId', 'HSE Record Detail', 'hse', 'tersembunyi', ARRAY['hse.read']::text[], '/hse', NULL),
      ('route:/project-delivery', 'Project Delivery', 'project_delivery', 'di_menu', ARRAY['project_delivery.read', 'project_delivery.manage']::text[], NULL, NULL),
      ('route:/project-delivery/:projectId', 'Project Detail', 'project_delivery', 'tersembunyi', ARRAY['project_delivery.read', 'project_delivery.manage']::text[], '/project-delivery', NULL),
      ('route:/reporting', 'Reporting', 'reporting_insight', 'di_menu', ARRAY['reporting.read', 'reporting.bi.manage', 'reporting.predictive.read']::text[], NULL, NULL),
      ('route:/administration', 'Administration', 'platform', 'di_menu', ARRAY['config.manage']::text[], NULL, 'Deliberately stricter than the Phase 0 admin endpoints, which mostly read \`config.read\`. Over-strict is a false deny the user can see; the reverse would be a silent grant.'),
      ('route:/admin', 'Admin Console', 'platform', 'di_menu', ARRAY['admin.console.read']::text[], NULL, 'Internal only; each console section carries its own permission server-side.'),
      ('route:/login', 'Sign In', 'platform', 'tersembunyi', ARRAY[]::text[], NULL, 'Entry flow. Unauthenticated by design.'),
      ('route:/select-workspace', 'Select Workspace', 'platform', 'tersembunyi', ARRAY[]::text[], NULL, 'Entry flow. Runs after sign-in, before the shell.'),
      ('route:/public/surveys/:token', 'Public Survey Response', 'survey_assessment', 'tersembunyi', ARRAY[]::text[], NULL, 'Entry flow. Reached by token, never by an authenticated session.'),
      ('route:*', 'Not Found (redirect to Overview)', 'platform', 'tersembunyi', ARRAY[]::text[], NULL, 'Wildcard route; redirects to /. Registered so the guard has nothing to report as unregistered.')
`;

exports.up = (pgm) => {
  pgm.sql(`
    -- 1. A route window describes itself -------------------------------------
    ALTER TABLE app_windows
      ADD COLUMN registration_status   TEXT    NOT NULL DEFAULT 'belum_terdaftar',
      ADD COLUMN required_permissions  TEXT[]  NOT NULL DEFAULT '{}'::text[],
      ADD COLUMN parent_path           TEXT;

    ALTER TABLE app_windows
      ADD CONSTRAINT app_windows_registration_status_check
        CHECK (registration_status IN ('di_menu', 'tersembunyi', 'belum_terdaftar'));

    -- 2. The platform module the shell-level windows belong to ---------------
    -- Overview, Profile, Administration and the Admin Console are cross-module
    -- surfaces; module_code is NOT NULL, so they need a real catalog row.
    INSERT INTO modules (code, name, description) VALUES
      ('platform', 'Platform', 'Cross-module shell surfaces: overview, personal profile, administration, and the admin console')
    ON CONFLICT (code) DO UPDATE
      SET name = EXCLUDED.name,
          description = EXCLUDED.description;

    -- 3. The catalogue of route windows, stated once -------------------------
    -- Both the trigger and the backfill read this, so the 70 rows are not
    -- duplicated into two places that could drift apart.
    CREATE OR REPLACE FUNCTION config_route_window_seed()
    RETURNS TABLE (
      code                TEXT,
      name                TEXT,
      module_code         TEXT,
      registration_status TEXT,
      required_permissions TEXT[],
      parent_path         TEXT,
      note                TEXT
    ) AS $seed$
      SELECT * FROM (VALUES
${SEED_ROWS}
      ) AS v(code, name, module_code, registration_status, required_permissions, parent_path, note);
    $seed$ LANGUAGE sql IMMUTABLE;

    -- 4. Future tenants get their windows on insert --------------------------
    CREATE OR REPLACE FUNCTION config_seed_app_windows_for_tenant()
    RETURNS trigger AS $trg$
    BEGIN
      INSERT INTO app_windows (
        tenant_id, code, name, module_code,
        registration_status, required_permissions, parent_path, description
      )
      SELECT NEW.id, s.code, s.name, s.module_code,
             s.registration_status, s.required_permissions, s.parent_path, s.note
        FROM config_route_window_seed() s
      ON CONFLICT (tenant_id, code) DO NOTHING;
      RETURN NEW;
    END;
    $trg$ LANGUAGE plpgsql;

    CREATE TRIGGER trg_config_seed_app_windows
      AFTER INSERT ON tenants
      FOR EACH ROW EXECUTE FUNCTION config_seed_app_windows_for_tenant();

    -- 5. Existing tenants are backfilled ------------------------------------
    INSERT INTO app_windows (
      tenant_id, code, name, module_code,
      registration_status, required_permissions, parent_path, description
    )
    SELECT t.id, s.code, s.name, s.module_code,
           s.registration_status, s.required_permissions, s.parent_path, s.note
      FROM tenants t
      CROSS JOIN config_route_window_seed() s
    ON CONFLICT (tenant_id, code) DO NOTHING;
  `);
};

exports.down = (pgm) => {
  // Note: this removes every `route:%` window, which is the intended set today
  // because the seed owns them outright. Wave 2 ("penimpa di database") makes
  // tenants able to override these rows, and those overrides would be lost
  // here. Revisit this down before Wave 2 lands.
  pgm.sql(`
    DROP TRIGGER IF EXISTS trg_config_seed_app_windows ON tenants;
    DROP FUNCTION IF EXISTS config_seed_app_windows_for_tenant();
    DROP FUNCTION IF EXISTS config_route_window_seed();

    DELETE FROM app_windows WHERE code LIKE 'route:%';

    ALTER TABLE app_windows DROP CONSTRAINT IF EXISTS app_windows_registration_status_check;
    ALTER TABLE app_windows
      DROP COLUMN IF EXISTS registration_status,
      DROP COLUMN IF EXISTS required_permissions,
      DROP COLUMN IF EXISTS parent_path;

    DELETE FROM modules WHERE code = 'platform';
  `);
};
