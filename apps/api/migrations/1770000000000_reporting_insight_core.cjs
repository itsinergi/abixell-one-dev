exports.up = (pgm) => {
  pgm.sql(`

    -- -----------------------------------------------------------------------
    -- Phase 9 — Reporting & Operational Insight Core (RPT-CORE-001…008)
    -- Read-only cross-module reporting foundation. No reporting warehouse,
    -- self-service BI schema, scheduled distribution queue, predictive store,
    -- or cross-module mutation table is introduced here.
    -- -----------------------------------------------------------------------

    INSERT INTO modules (code, name, description) VALUES
      ('customer_commercial', 'Customer & Commercial', 'Customer, contract, project, site, and service assignment operational context'),
      ('customer_complaint', 'Customer Complaint Management', 'Complaint lifecycle and service quality operations'),
      ('survey_assessment', 'Survey & Assessment', 'Survey definition, assignment, response, and scoring operations'),
      ('service_operations', 'Service Operations', 'Service request and work order execution'),
      ('workforce', 'Workforce', 'Employee master and organisational placement'),
      ('supply_chain', 'Supply Chain', 'Item, stock, purchasing, and supplier operations'),
      ('asset', 'Asset', 'Asset register and movement status'),
      ('finance', 'Finance', 'Operational cash and bank transaction visibility'),
      ('hse', 'HSE', 'Incident and observation capture with follow-up'),
      ('project_delivery', 'Project Delivery', 'Project activity, milestone, and delivery progress tracking'),
      ('reporting_insight', 'Reporting & Operational Insight', 'Scope-safe standard reports, exports, and executive dashboard')
    ON CONFLICT (code) DO UPDATE
      SET name = EXCLUDED.name,
          description = EXCLUDED.description;

    INSERT INTO permissions (code, description) VALUES
      ('reporting.read',   'View scope-safe standard reports and executive dashboard'),
      ('reporting.export', 'Export scope-safe report results')
    ON CONFLICT (code) DO NOTHING;

  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    DELETE FROM permissions WHERE code IN ('reporting.read', 'reporting.export');
    DELETE FROM modules WHERE code = 'reporting_insight';
  `);
};
