/**
 * Epic 3 Wave 1 — Menu from the dictionary (CORE-ROADMAP.md §4.3).
 *
 * Today's navigation is a hardcoded array in the browser
 * (apps/web/src/lib/capabilities.ts). §4.3 moves the menu into the application
 * dictionary so that a page's existence, its place in the tree, and who may see
 * it come from one place, and so that a module a tenant has switched off can be
 * filtered server-side before it ever reaches a browser.
 *
 * Two tables, split the iDempiere way (§4.3 "Pemisahan ini diadopsi apa adanya"):
 *   app_menus     WHAT a menu is   — code, label, destination, module, flags
 *   app_menu_tree WHERE it hangs   — parent + order
 * Moving a menu therefore never changes its definition, and one page can appear
 * in two places later if that is ever needed.
 *
 * The catalogue below is a copy of the navigation declared in code —
 * NAV_GROUPS, MODULE_METADATA and NAV_SECTIONS in
 * apps/web/src/lib/capabilities.ts. That file stays the core definition
 * ("inti di kode", §4.2); this migration is the seed that carries it into the
 * database. apps/api/tests/menu-seed-parity.test.ts re-derives the catalogue
 * from the code and fails if the two ever disagree.
 *
 * Seed shape (57 rows): 3 groups + 13 module folders + 41 pages.
 *   - `is_summary = true` marks a folder: Grup (depth 1) and Modul (depth 2).
 *     The four-level limit (§4.3 "Batas empat tingkat dijaga di server") is
 *     enforced by a trigger on app_menu_tree, not by convention here.
 *   - `is_external_allowed` is the whitelist §4.3 asks for: default false, and
 *     only these are ever sent to an external Customer User. It replaces the two
 *     older negative flags (`requiresInternal` / `requiresCustomerScope`) with
 *     one flag whose default is closed. Today exactly 3 pages are external —
 *     Overview, Complaints, My Surveys — and a folder is external only when at
 *     least one page inside it is, so Operations/Complaints stays reachable
 *     while every internal branch stays closed.
 *   - `module_id` is mandatory for a page; the check constraint refuses a page
 *     without a window and a folder with one.
 *
 * No permission is introduced here and no role_permissions row is written. A
 * menu's required permissions are data read by the server-side filter; they are
 * never a grant.
 */

const MENU_ROWS = `
      ('nav-operations', 'Operations', NULL, true, NULL, true, ARRAY[]::text[], 'Day-to-day work, queues, services, and surveys.', NULL, 10),
      ('nav-customer_complaint', 'Customer Complaints', NULL, true, 'customer_complaint', true, ARRAY[]::text[], NULL, 'nav-operations', 20),
      ('nav-customer_complaint-complaints', 'Complaints', '/complaints', false, 'customer_complaint', true, ARRAY['complaint.read', 'complaint.manage']::text[], 'Raise and track the complaints you have submitted.', 'nav-customer_complaint', 10),
      ('nav-customer_complaint-queue', 'Queue', '/queue', false, 'customer_complaint', false, ARRAY['complaint.read', 'complaint.manage']::text[], 'Work the complaints assigned to you and your team.', 'nav-customer_complaint', 20),
      ('nav-customer_complaint-verification', 'Verification', '/verification', false, 'customer_complaint', false, ARRAY['workflow.instance.manage']::text[], 'Independently verify corrective actions awaiting sign-off.', 'nav-customer_complaint', 30),
      ('nav-customer_complaint-management', 'Management', '/management', false, 'customer_complaint', false, ARRAY['complaint.dashboard.read']::text[], 'Complaint performance, SLA, and escalation visibility.', 'nav-customer_complaint', 40),
      ('nav-customer_complaint-service-quality', 'Service Quality', '/service-quality', false, 'customer_complaint', false, ARRAY['service_quality.read', 'service_quality.configure']::text[], 'SLA performance, RCA categories, CAPA tracking, and recurrence analytics.', 'nav-customer_complaint', 50),
      ('nav-survey_assessment', 'Surveys & Assessments', NULL, true, 'survey_assessment', true, ARRAY[]::text[], NULL, 'nav-operations', 30),
      ('nav-survey_assessment-my-surveys', 'My Surveys', '/my-surveys', false, 'survey_assessment', true, ARRAY['survey.respond']::text[], 'Surveys assigned to you — respond and submit.', 'nav-survey_assessment', 10),
      ('nav-survey_assessment-surveys', 'Surveys', '/surveys', false, 'survey_assessment', false, ARRAY['survey.manage', 'survey.analytics.read']::text[], 'Author surveys, govern distribution, and review cross-survey analytics.', 'nav-survey_assessment', 20),
      ('nav-service_operations', 'Service Operations', NULL, true, 'service_operations', false, ARRAY[]::text[], NULL, 'nav-operations', 40),
      ('nav-service_operations-my-work', 'My Work', '/my-work', false, 'service_operations', false, ARRAY['service_operations.execute']::text[], 'The jobs assigned to you — record what you did in the field.', 'nav-service_operations', 10),
      ('nav-service_operations-work-orders', 'Work Orders', '/work-orders', false, 'service_operations', false, ARRAY['service_operations.manage', 'service_operations.read']::text[], 'Plan, assign, and follow the work your teams are delivering.', 'nav-service_operations', 20),
      ('nav-service_operations-service-types', 'Service Types', '/service-types', false, 'service_operations', false, ARRAY['service_operations.configure']::text[], 'Define the reusable services your teams deliver.', 'nav-service_operations', 30),
      ('nav-service_operations-service-packs', 'Service Packs', '/service-packs', false, 'service_operations', false, ARRAY['service_operations.pack.manage']::text[], 'Activate Catering, Housekeeping, Camp, and Facility service presets.', 'nav-service_operations', 40),
      ('nav-service_operations-service-optimization', 'Service Optimization', '/service-optimization', false, 'service_operations', false, ARRAY['service_operations.optimization.read', 'service_operations.optimization.apply']::text[], 'Generate assignment proposals, inspect rationale, then apply or dismiss explicitly.', 'nav-service_operations', 50),
      ('nav-overview', 'Overview', '/', false, NULL, true, ARRAY[]::text[], 'Your workspace at a glance.', 'nav-operations', 10),
      ('nav-enterprise-core', 'Enterprise Core', NULL, true, NULL, false, ARRAY[]::text[], 'Customers, people, resources, finance, safety, and delivery.', NULL, 20),
      ('nav-customer_commercial', 'Customers & Commercial', NULL, true, 'customer_commercial', false, ARRAY[]::text[], NULL, 'nav-enterprise-core', 10),
      ('nav-customer_commercial-customer-commercial', 'Customers', '/customer-commercial', false, 'customer_commercial', false, ARRAY['customer.read']::text[], 'Manage customers, contacts, contracts, projects, sites, and service links.', 'nav-customer_commercial', 10),
      ('nav-customer_commercial-sales-pipeline', 'Sales & Pipeline', '/sales', false, 'customer_commercial', false, ARRAY['sales.read', 'sales.manage']::text[], 'Opportunities, stage pipelines, quotations, and price books.', 'nav-customer_commercial', 20),
      ('nav-workforce', 'Workforce & HR', NULL, true, 'workforce', false, ARRAY[]::text[], NULL, 'nav-enterprise-core', 20),
      ('nav-workforce-employees', 'Employees', '/employees', false, 'workforce', false, ARRAY['workforce.read', 'workforce.manage']::text[], 'Who works here, and where they belong in the organisation.', 'nav-workforce', 10),
      ('nav-workforce-workforce-attendance', 'Attendance & Rosters', '/workforce/attendance', false, 'workforce', false, ARRAY['workforce.attendance.read', 'workforce.attendance.manage']::text[], 'Plan shifts and rosters, then record attendance outcomes.', 'nav-workforce', 20),
      ('nav-workforce-workforce-leave-overtime', 'Leave & Overtime', '/workforce/leave-overtime', false, 'workforce', false, ARRAY['workforce.leave.read', 'workforce.leave.manage', 'workforce.leave.approve']::text[], 'Manage leave balances, requests, overtime, and approvals.', 'nav-workforce', 30),
      ('nav-workforce-workforce-payroll', 'Payroll', '/workforce/payroll', false, 'workforce', false, ARRAY['workforce.payroll.read', 'workforce.payroll.manage', 'workforce.payroll.approve']::text[], 'Govern statutory policy, salary profiles, payroll runs, and payslips.', 'nav-workforce', 40),
      ('nav-workforce-workforce-recruitment', 'Recruitment', '/workforce/recruitment', false, 'workforce', false, ARRAY['workforce.recruitment.read', 'workforce.recruitment.manage']::text[], 'Publish openings and move candidates through the hiring pipeline.', 'nav-workforce', 50),
      ('nav-workforce-workforce-performance', 'Talent & Performance', '/workforce/performance', false, 'workforce', false, ARRAY['workforce.performance.read', 'workforce.performance.manage']::text[], 'Develop competency, training, performance, and career pathways.', 'nav-workforce', 60),
      ('nav-workforce-workforce-planning', 'Workforce Planning', '/workforce/planning', false, 'workforce', false, ARRAY['workforce.planning.read', 'workforce.planning.manage', 'workforce.planning.apply']::text[], 'Compare headcount and cost scenarios before an advisory decision.', 'nav-workforce', 70),
      ('nav-supply_chain', 'Supply Chain', NULL, true, 'supply_chain', false, ARRAY[]::text[], NULL, 'nav-enterprise-core', 30),
      ('nav-supply_chain-items', 'Items & Stock', '/items', false, 'supply_chain', false, ARRAY['supply_chain.read']::text[], 'What exists, how much of it, and what moved.', 'nav-supply_chain', 10),
      ('nav-supply_chain-suppliers', 'Suppliers', '/suppliers', false, 'supply_chain', false, ARRAY['supply_chain.read']::text[], 'Who you buy from.', 'nav-supply_chain', 20),
      ('nav-supply_chain-purchasing', 'Purchasing', '/purchasing', false, 'supply_chain', false, ARRAY['supply_chain.manage', 'supply_chain.stock.manage']::text[], 'Request, order, and receive what your teams need.', 'nav-supply_chain', 30),
      ('nav-warehouse_management', 'Warehouse Management', NULL, true, 'warehouse_management', false, ARRAY[]::text[], NULL, 'nav-enterprise-core', 40),
      ('nav-warehouse_management-scm-warehouses', 'Warehouses & Tracking', '/wms/warehouses', false, 'warehouse_management', false, ARRAY['supply_chain.warehouse.read', 'supply_chain.warehouse.manage']::text[], 'Multi-warehouse topology, bin locations, batch/lot, and serial tracking.', 'nav-warehouse_management', 10),
      ('nav-warehouse_management-scm-operations', 'Stock Operations', '/wms/operations', false, 'warehouse_management', false, ARRAY['supply_chain.inventory.read', 'supply_chain.inventory.manage', 'supply_chain.inventory.approve']::text[], 'Reorder alerts, stock reservations, warehouse transfers, and stock opname.', 'nav-warehouse_management', 20),
      ('nav-warehouse_management-scm-valuation', 'Valuation & Landed Cost', '/wms/valuation', false, 'warehouse_management', false, ARRAY['supply_chain.valuation.read', 'supply_chain.valuation.manage']::text[], 'FIFO/moving average layers, landed cost vouchers, and landed cost allocations.', 'nav-warehouse_management', 30),
      ('nav-procurement_management', 'Procurement Management', NULL, true, 'procurement_management', false, ARRAY[]::text[], NULL, 'nav-enterprise-core', 50),
      ('nav-procurement_management-scm-procurement', 'RFQ & Tendering', '/procurement/rfqs', false, 'procurement_management', false, ARRAY['supply_chain.procurement.read', 'supply_chain.procurement.manage', 'supply_chain.procurement.award']::text[], 'RFQs, tenders, supplier quotations, bid comparisons, and awarding.', 'nav-procurement_management', 10),
      ('nav-procurement_management-scm-contracts', 'Supplier Contracts & Scorecards', '/procurement/contracts', false, 'procurement_management', false, ARRAY['supply_chain.contract.read', 'supply_chain.contract.manage', 'supply_chain.contract.approve']::text[], 'Supplier performance evaluations, rating scorecards, and blanket purchasing contracts.', 'nav-procurement_management', 20),
      ('nav-procurement_management-scm-spend', 'Spend Analytics', '/procurement/spend-analytics', false, 'procurement_management', false, ARRAY['supply_chain.analytics.read']::text[], 'Procurement spend analytics, vendor breakdown, PO metrics, and purchasing trends.', 'nav-procurement_management', 30),
      ('nav-asset', 'Asset Management', NULL, true, 'asset', false, ARRAY[]::text[], NULL, 'nav-enterprise-core', 60),
      ('nav-asset-assets', 'Assets', '/assets', false, 'asset', false, ARRAY['asset.read', 'asset.manage', 'asset.move']::text[], 'What you own, where it is, and who holds it.', 'nav-asset', 10),
      ('nav-asset-asset-maintenance', 'Asset Maintenance', '/asset-maintenance', false, 'asset', false, ARRAY['asset.maintenance.read', 'asset.maintenance.manage', 'asset.meter.manage', 'asset.downtime.manage', 'asset.analytics.read']::text[], 'Schedules, work orders, parts, meter readings, downtime, and predictive maintenance.', 'nav-asset', 20),
      ('nav-finance', 'Finance', NULL, true, 'finance', false, ARRAY[]::text[], NULL, 'nav-enterprise-core', 70),
      ('nav-finance-finance-transactions', 'Transactions', '/finance/transactions', false, 'finance', false, ARRAY['finance.read', 'finance.manage']::text[], 'What came in, what went out, and what it was for.', 'nav-finance', 10),
      ('nav-finance-finance-cashflow', 'Cashflow', '/finance/cashflow', false, 'finance', false, ARRAY['finance.read']::text[], 'What moved this period, and where you stand now.', 'nav-finance', 20),
      ('nav-finance-finance-accounts', 'Cash & Bank', '/finance/accounts', false, 'finance', false, ARRAY['finance.configure', 'finance.read']::text[], 'Where the money actually sits.', 'nav-finance', 30),
      ('nav-hse', 'Health, Safety & Environment', NULL, true, 'hse', false, ARRAY[]::text[], NULL, 'nav-enterprise-core', 80),
      ('nav-hse-hse', 'HSE', '/hse', false, 'hse', false, ARRAY['hse.read']::text[], 'Record and review health, safety, and environmental activity.', 'nav-hse', 10),
      ('nav-project_delivery', 'Project Delivery', NULL, true, 'project_delivery', false, ARRAY[]::text[], NULL, 'nav-enterprise-core', 90),
      ('nav-project_delivery-project-delivery', 'Project Delivery', '/project-delivery', false, 'project_delivery', false, ARRAY['project_delivery.read', 'project_delivery.manage']::text[], 'Track project activities, milestones, and delivery progress.', 'nav-project_delivery', 10),
      ('nav-governance', 'Governance & Platform', NULL, true, NULL, false, ARRAY[]::text[], 'Reporting, administration, and tenant governance.', NULL, 30),
      ('nav-reporting_insight', 'Reporting & Insights', NULL, true, 'reporting_insight', false, ARRAY[]::text[], NULL, 'nav-governance', 10),
      ('nav-reporting_insight-reporting-insight', 'Reporting', '/reporting', false, 'reporting_insight', false, ARRAY['reporting.read', 'reporting.bi.manage', 'reporting.predictive.read']::text[], 'Scope-safe reports, governed BI, and deterministic predictive insight.', 'nav-reporting_insight', 10),
      ('nav-administration', 'Administration', '/administration', false, NULL, false, ARRAY['config.manage']::text[], 'Organization, users, configuration, and shared services.', 'nav-governance', 20),
      ('nav-admin-console', 'Admin Console', '/admin', false, NULL, false, ARRAY['admin.console.read']::text[], 'An overview of users, roles, access, modules, workflows, and activity. Changes are limited to separately permissioned controls.', 'nav-governance', 30)
`;

/** The catalogue of menus, stated once: both the backfill and the tenant
 * trigger read this function, so the 57 rows are not duplicated into two
 * places that could drift apart. */
const CREATE_SEED_FUNCTION = `
    CREATE OR REPLACE FUNCTION config_menu_seed()
    RETURNS TABLE (
      code                 TEXT,
      name                 TEXT,
      window_code          TEXT,
      is_summary           BOOLEAN,
      module_code          TEXT,
      is_external_allowed  BOOLEAN,
      required_permissions TEXT[],
      description          TEXT,
      parent_code          TEXT,
      seq_no               INTEGER
    ) AS $seed$
      SELECT * FROM (VALUES
${MENU_ROWS}
      ) AS v(code, name, window_code, is_summary, module_code,
             is_external_allowed, required_permissions, description,
             parent_code, seq_no);
    $seed$ LANGUAGE sql IMMUTABLE;
`;

/** Depth guard (§4.3 "Batas empat tingkat dijaga di server"). Depth is distance
 * from a root group: Grup 1, Modul 2, Halaman 3. A child of a page would be 4
 * and is refused. Enforced in a trigger rather than in the application so no
 * caller, present or future, can write a fifth level. */
const CREATE_DEPTH_GUARD = `
    CREATE OR REPLACE FUNCTION config_menu_depth(menu UUID) RETURNS INTEGER AS $depth$
    DECLARE
      current UUID := menu;
      depth   INTEGER := 0;
      parent  UUID;
    BEGIN
      WHILE current IS NOT NULL AND depth < 10 LOOP
        depth := depth + 1;
        SELECT t.parent_id INTO parent FROM app_menu_tree t WHERE t.menu_id = current;
        current := parent;
      END LOOP;
      RETURN depth;
    END;
    $depth$ LANGUAGE plpgsql;

    CREATE OR REPLACE FUNCTION config_guard_menu_depth() RETURNS trigger AS $guard$
    DECLARE
      child_depth INTEGER;
    BEGIN
      SELECT config_menu_depth(NEW.parent_id) INTO child_depth;
      IF child_depth + 1 > 3 THEN
        RAISE EXCEPTION 'Menu depth % exceeds the four-level limit (Grup > Modul > Sub-menu > Halaman)', child_depth + 1
          USING ERRCODE = 'check_violation';
      END IF;
      RETURN NEW;
    END;
    $guard$ LANGUAGE plpgsql;
`;

exports.up = async (pgm) => {
  // ==========================================================================
  // 1. app_menus — what a menu is (iDempiere: AD_Menu)
  // ==========================================================================
  pgm.createTable("app_menus", {
    id: { type: "uuid", primaryKey: true, default: pgm.func("gen_random_uuid()") },
    tenant_id: { type: "uuid", notNull: true, references: "tenants", onDelete: "CASCADE" },
    /** Stable identity, locked in code. Example: nav-operations-work-orders. */
    code: { type: "text", notNull: true },
    /** Core label; the tenant override comes later (§4.3 Wave 3). */
    name: { type: "text", notNull: true },
    description: { type: "text" },
    action: { type: "text", notNull: true, default: "window" },
    /** Destination window; NULL for a folder. */
    window_id: { type: "uuid", references: "app_windows", onDelete: "CASCADE" },
    /** true = folder (Grup, Modul). Only a folder may have children. */
    is_summary: { type: "boolean", notNull: true, default: false },
    /** Mandatory for a page, NULL for a folder (§4.3). */
    module_id: { type: "uuid", references: "modules", onDelete: "RESTRICT" },
    /** The external whitelist. Default closed. */
    is_external_allowed: { type: "boolean", notNull: true, default: false },
    /** "any of" permission codes for the server-side filter (Wave 2 step 7). */
    required_permissions: { type: "text[]", notNull: true, default: pgm.func("'{}'::text[]") },
    is_active: { type: "boolean", notNull: true, default: true },
    created_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
    updated_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
  });
  pgm.addConstraint("app_menus", "app_menus_action_check", {
    check: "action IN ('window', 'process', 'report', 'form')",
  });
  // §4.3: a folder names no destination; a page must name one.
  pgm.addConstraint("app_menus", "app_menus_summary_target_check", {
    check: "(is_summary AND window_id IS NULL) OR (NOT is_summary AND window_id IS NOT NULL)",
  });
  pgm.addConstraint("app_menus", "app_menus_tenant_code_unique", {
    unique: ["tenant_id", "code"],
  });
  pgm.createIndex("app_menus", ["tenant_id", "module_id"]);
  pgm.createIndex("app_menus", ["tenant_id", "window_id"]);

  // ==========================================================================
  // 2. app_menu_tree — where a menu hangs (iDempiere: AD_Tree_Menu)
  // ==========================================================================
  pgm.createTable("app_menu_tree", {
    id: { type: "uuid", primaryKey: true, default: pgm.func("gen_random_uuid()") },
    tenant_id: { type: "uuid", notNull: true, references: "tenants", onDelete: "CASCADE" },
    menu_id: { type: "uuid", notNull: true, references: "app_menus", onDelete: "CASCADE" },
    /** NULL = root (Grup). */
    parent_id: { type: "uuid", references: "app_menus", onDelete: "CASCADE" },
    seq_no: { type: "integer", notNull: true, default: 10 },
  });
  pgm.addConstraint("app_menu_tree", "app_menu_tree_tenant_menu_unique", {
    unique: ["tenant_id", "menu_id"],
  });
  pgm.createIndex("app_menu_tree", ["tenant_id", "parent_id"]);

  pgm.sql(`
    -- 3. The catalogue, stated once -----------------------------------------
${CREATE_SEED_FUNCTION}

    -- 4. Depth guard: four levels, enforced on write -------------------------
${CREATE_DEPTH_GUARD}

    CREATE TRIGGER trg_config_guard_menu_depth
      BEFORE INSERT OR UPDATE ON app_menu_tree
      FOR EACH ROW EXECUTE FUNCTION config_guard_menu_depth();

    -- 5. Seed one tenant's menus --------------------------------------------
    -- Resolves both foreign keys from codes: window_code -> app_windows,
    -- module_code -> modules. Two passes are enough: every app_menus row is
    -- inserted first, then tree placement resolves parents against the now
    -- complete set, so insertion order within the catalogue cannot matter.
    CREATE OR REPLACE FUNCTION config_seed_menus_for_tenant(p_tenant UUID)
    RETURNS VOID AS $body$
    DECLARE
      s RECORD;
    BEGIN
      FOR s IN SELECT * FROM config_menu_seed() LOOP
        INSERT INTO app_menus (
          tenant_id, code, name, description, action, window_id,
          is_summary, module_id, is_external_allowed, required_permissions
        )
        VALUES (
          p_tenant, s.code, s.name, s.description, 'window',
          (SELECT w.id FROM app_windows w
            WHERE w.tenant_id = p_tenant AND w.code = 'route:' || s.window_code),
          s.is_summary,
          (SELECT m.id FROM modules m WHERE m.code = s.module_code),
          s.is_external_allowed, s.required_permissions
        )
        ON CONFLICT (tenant_id, code) DO NOTHING;
      END LOOP;

      FOR s IN SELECT * FROM config_menu_seed() LOOP
        INSERT INTO app_menu_tree (tenant_id, menu_id, parent_id, seq_no)
        VALUES (
          p_tenant,
          (SELECT id FROM app_menus WHERE tenant_id = p_tenant AND code = s.code),
          (SELECT id FROM app_menus WHERE tenant_id = p_tenant AND code = s.parent_code),
          s.seq_no
        )
        ON CONFLICT (tenant_id, menu_id) DO NOTHING;
      END LOOP;
    END;
    $body$ LANGUAGE plpgsql;

    -- 6. Future tenants get their menus on insert ---------------------------
    CREATE OR REPLACE FUNCTION config_seed_menus_trigger() RETURNS trigger AS $trg$
    BEGIN
      PERFORM config_seed_menus_for_tenant(NEW.id);
      RETURN NEW;
    END;
    $trg$ LANGUAGE plpgsql;

    CREATE TRIGGER trg_config_seed_menus
      AFTER INSERT ON tenants
      FOR EACH ROW EXECUTE FUNCTION config_seed_menus_trigger();

    -- 7. Existing tenants are backfilled ------------------------------------
    SELECT config_seed_menus_for_tenant(id) FROM tenants;
  `);
};

exports.down = (pgm) => {
  // The seed owns these rows outright today. Once Wave 3 lets a tenant override
  // a menu label, a rollback would discard those overrides — revisit this then.
  pgm.sql(`
    DROP TRIGGER IF EXISTS trg_config_seed_menus ON tenants;
    DROP FUNCTION IF EXISTS config_seed_menus_trigger();
    DROP FUNCTION IF EXISTS config_seed_menus_for_tenant(UUID);

    DROP TRIGGER IF EXISTS trg_config_guard_menu_depth ON app_menu_tree;
    DROP FUNCTION IF EXISTS config_guard_menu_depth();
    DROP FUNCTION IF EXISTS config_menu_depth(UUID);
    DROP FUNCTION IF EXISTS config_menu_seed();
  `);
  pgm.dropTable("app_menu_tree");
  pgm.dropTable("app_menus");
};
