exports.up = (pgm) => {
  pgm.sql(`

    -- -----------------------------------------------------------------------
    -- Phase 8 — Project Delivery Core (PRJ-CORE-001…010)
    -- Adds delivery execution records linked to the existing Customer &
    -- Commercial project master. This migration deliberately does NOT create
    -- a competing project/customer/commercial model.
    -- -----------------------------------------------------------------------

    CREATE TABLE project_delivery_activities (
      id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id             UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      project_id            UUID        NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,

      title                 TEXT        NOT NULL,
      description           TEXT,
      activity_type_code    TEXT,

      pic_user_id           UUID        REFERENCES users(id) ON DELETE SET NULL,
      -- Clean reference to Workforce. No FK on purpose: Project Delivery checks
      -- the employee by repository port and does not import Workforce internals.
      pic_employee_id       UUID,
      CHECK (pic_user_id IS NOT NULL OR pic_employee_id IS NOT NULL),

      planned_start_date    DATE,
      planned_end_date      DATE,
      actual_start_date     DATE,
      actual_end_date       DATE,

      status                TEXT        NOT NULL DEFAULT 'planned'
        CHECK (status IN ('planned', 'in_progress', 'completed', 'on_hold', 'cancelled')),
      progress_percent      INTEGER     NOT NULL DEFAULT 0 CHECK (progress_percent BETWEEN 0 AND 100),

      created_by_user_id    UUID        REFERENCES users(id) ON DELETE SET NULL,
      updated_by_user_id    UUID        REFERENCES users(id) ON DELETE SET NULL,
      created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE INDEX idx_project_delivery_activities_tenant ON project_delivery_activities (tenant_id);
    CREATE INDEX idx_project_delivery_activities_project ON project_delivery_activities (tenant_id, project_id);
    CREATE INDEX idx_project_delivery_activities_status ON project_delivery_activities (tenant_id, status);
    CREATE INDEX idx_project_delivery_activities_pic_user ON project_delivery_activities (tenant_id, pic_user_id) WHERE pic_user_id IS NOT NULL;

    CREATE TABLE project_delivery_milestones (
      id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id             UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      project_id            UUID        NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,

      title                 TEXT        NOT NULL,
      description           TEXT,
      milestone_type_code   TEXT,
      planned_date          DATE,

      status                TEXT        NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'achieved', 'missed', 'cancelled')),
      achieved_at           TIMESTAMPTZ,
      achieved_by_user_id   UUID        REFERENCES users(id) ON DELETE SET NULL,
      achievement_note      TEXT,

      created_by_user_id    UUID        REFERENCES users(id) ON DELETE SET NULL,
      updated_by_user_id    UUID        REFERENCES users(id) ON DELETE SET NULL,
      created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE INDEX idx_project_delivery_milestones_tenant ON project_delivery_milestones (tenant_id);
    CREATE INDEX idx_project_delivery_milestones_project ON project_delivery_milestones (tenant_id, project_id);
    CREATE INDEX idx_project_delivery_milestones_status ON project_delivery_milestones (tenant_id, status);

    INSERT INTO permissions (code, description) VALUES
      ('project_delivery.read',           'View project delivery activities, milestones, and progress'),
      ('project_delivery.manage',         'Create and update project delivery activities and milestones'),
      ('project_delivery.documents.read', 'Read project delivery activity and milestone documents')
    ON CONFLICT (code) DO NOTHING;

  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    DELETE FROM permissions WHERE code IN (
      'project_delivery.read',
      'project_delivery.manage',
      'project_delivery.documents.read'
    );
    DROP TABLE IF EXISTS project_delivery_milestones;
    DROP TABLE IF EXISTS project_delivery_activities;
  `);
};
