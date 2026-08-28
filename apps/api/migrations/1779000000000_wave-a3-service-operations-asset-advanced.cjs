exports.up = (pgm) => {
  pgm.sql(`
    -- Composite candidate keys let every Wave A3 foreign key bind tenant and
    -- entity identity together, preventing child rows from referencing a parent
    -- owned by another tenant at the database level.
    ALTER TABLE organization_units ADD CONSTRAINT organization_units_tenant_id_id_unique UNIQUE (tenant_id, id);
    ALTER TABLE assets             ADD CONSTRAINT assets_tenant_id_id_unique UNIQUE (tenant_id, id);
    ALTER TABLE items              ADD CONSTRAINT items_tenant_id_id_unique UNIQUE (tenant_id, id);
    ALTER TABLE work_orders        ADD CONSTRAINT work_orders_tenant_id_id_unique UNIQUE (tenant_id, id);

    -- -----------------------------------------------------------------------
    -- Wave A3 — Service Operations & Asset Advanced
    -- (PACK-001…004, SO-ADV-002…005, AST-ADV-001…007)
    --
    -- Service Operations Advanced:
    --   - Vertical Service Packs (Catering, Housekeeping, Camp, Facility)
    --   - Route, Roster, Capacity & Workload Optimization (advisory proposals)
    --   - Note: SO-ADV-006 (Offline Field PWA) is deferred per Founder decision
    --
    -- Asset Advanced:
    --   - Preventive & Corrective Maintenance Work Orders (workflow-delegated)
    --   - Maintenance Schedules (calendar and meter-triggered)
    --   - Spare Parts Consumption (referencing Supply Chain items)
    --   - Monotonic Meter Readings (hours, km, cycles)
    --   - Downtime Tracking
    --   - Reliability Metrics (MTBF, MTTR, Availability) & Predictive Snapshots
    --
    -- Every new table carries tenant_id with CASCADE delete to tenants.
    -- No competing state machine: maintenance work order lifecycle is owned
    -- exclusively by the generic Workflow Engine via workflow_instance_id.
    -- -----------------------------------------------------------------------

    -- === Vertical Service Packs (PACK-001…004) =============================

    CREATE TABLE service_pack_activations (
      id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id     UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      pack_code     TEXT        NOT NULL,
      is_active     BOOLEAN     NOT NULL DEFAULT true,
      activated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
      activated_by  UUID,
      created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),

      FOREIGN KEY (tenant_id, activated_by)
        REFERENCES users(tenant_id, id) ON DELETE SET NULL (activated_by),
      UNIQUE (tenant_id, pack_code)
    );

    ALTER TABLE service_pack_activations
      ADD CONSTRAINT service_pack_activations_tenant_id_id_unique UNIQUE (tenant_id, id);
    CREATE INDEX idx_service_pack_activations_tenant
      ON service_pack_activations (tenant_id) WHERE is_active;

    -- === Route, Roster & Workload Optimization (SO-ADV-002…005) ============

    CREATE TABLE service_optimization_runs (
      id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id             UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      run_number            TEXT        NOT NULL,
      target_date           DATE        NOT NULL,
      organization_unit_id  UUID,
      parameters            JSONB       NOT NULL DEFAULT '{}'::jsonb,
      proposals             JSONB       NOT NULL DEFAULT '[]'::jsonb,
      status                TEXT        NOT NULL DEFAULT 'proposed',
      applied_at            TIMESTAMPTZ,
      applied_by            UUID,
      created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
      created_by            UUID,

      FOREIGN KEY (tenant_id, organization_unit_id)
        REFERENCES organization_units(tenant_id, id) ON DELETE SET NULL (organization_unit_id),
      FOREIGN KEY (tenant_id, applied_by)
        REFERENCES users(tenant_id, id) ON DELETE SET NULL (applied_by),
      FOREIGN KEY (tenant_id, created_by)
        REFERENCES users(tenant_id, id) ON DELETE SET NULL (created_by),
      CONSTRAINT service_optimization_runs_status_check
        CHECK (status IN ('proposed', 'applied', 'dismissed')),
      UNIQUE (tenant_id, run_number)
    );

    ALTER TABLE service_optimization_runs
      ADD CONSTRAINT service_optimization_runs_tenant_id_id_unique UNIQUE (tenant_id, id);
    CREATE INDEX idx_service_optimization_runs_tenant
      ON service_optimization_runs (tenant_id, created_at DESC);
    CREATE INDEX idx_service_optimization_runs_target
      ON service_optimization_runs (tenant_id, target_date);

    -- === Asset Maintenance Schedules (AST-ADV-001) ==========================

    CREATE TABLE asset_maintenance_schedules (
      id                  UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id           UUID          NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      asset_id            UUID          NOT NULL,
      schedule_code       TEXT          NOT NULL,
      title               TEXT          NOT NULL,
      description         TEXT,
      frequency_type      TEXT          NOT NULL,
      interval_days       INTEGER,
      meter_interval      NUMERIC(18,4),
      meter_type          TEXT,
      last_performed_at   TIMESTAMPTZ,
      last_meter_reading  NUMERIC(18,4),
      next_due_date       DATE,
      next_due_meter      NUMERIC(18,4),
      is_active           BOOLEAN       NOT NULL DEFAULT true,
      created_at          TIMESTAMPTZ   NOT NULL DEFAULT now(),
      updated_at          TIMESTAMPTZ   NOT NULL DEFAULT now(),
      created_by          UUID,

      FOREIGN KEY (tenant_id, asset_id)
        REFERENCES assets(tenant_id, id) ON DELETE CASCADE,
      FOREIGN KEY (tenant_id, created_by)
        REFERENCES users(tenant_id, id) ON DELETE SET NULL (created_by),
      CONSTRAINT asset_maint_sched_freq_check
        CHECK (frequency_type IN ('calendar', 'meter')),
      UNIQUE (tenant_id, schedule_code)
    );

    ALTER TABLE asset_maintenance_schedules
      ADD CONSTRAINT asset_maintenance_schedules_tenant_id_id_unique UNIQUE (tenant_id, id);
    CREATE INDEX idx_asset_maintenance_schedules_asset
      ON asset_maintenance_schedules (asset_id);
    CREATE INDEX idx_asset_maintenance_schedules_due_date
      ON asset_maintenance_schedules (tenant_id, next_due_date) WHERE is_active;
    CREATE INDEX idx_asset_maintenance_schedules_due_meter
      ON asset_maintenance_schedules (tenant_id, next_due_meter) WHERE is_active;

    -- === Asset Maintenance Work Orders (AST-ADV-001, AST-ADV-002) ===========

    CREATE TABLE asset_maintenance_work_orders (
      id                    UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id             UUID          NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      order_number          TEXT          NOT NULL,
      asset_id              UUID          NOT NULL,
      schedule_id           UUID,
      maintenance_type      TEXT          NOT NULL,
      priority              TEXT          NOT NULL DEFAULT 'medium',
      title                 TEXT          NOT NULL,
      description           TEXT,
      assigned_to_user_id   UUID,
      assigned_at           TIMESTAMPTZ,
      assigned_by_user_id   UUID,
      started_at            TIMESTAMPTZ,
      started_by_user_id    UUID,
      completed_at          TIMESTAMPTZ,
      completed_by_user_id  UUID,
      completion_notes      TEXT,
      verified_at           TIMESTAMPTZ,
      verified_by_user_id   UUID,
      verification_notes    TEXT,
      downtime_hours        NUMERIC(10,2) NOT NULL DEFAULT 0,
      cost_estimate         NUMERIC(15,2),
      actual_cost           NUMERIC(15,2),
      workflow_instance_id  UUID,
      created_at            TIMESTAMPTZ   NOT NULL DEFAULT now(),
      created_by            UUID,
      updated_at            TIMESTAMPTZ   NOT NULL DEFAULT now(),
      updated_by            UUID,
      deleted_at            TIMESTAMPTZ,

      FOREIGN KEY (tenant_id, asset_id)
        REFERENCES assets(tenant_id, id) ON DELETE RESTRICT,
      FOREIGN KEY (tenant_id, schedule_id)
        REFERENCES asset_maintenance_schedules(tenant_id, id) ON DELETE SET NULL (schedule_id),
      FOREIGN KEY (tenant_id, assigned_to_user_id)
        REFERENCES users(tenant_id, id) ON DELETE SET NULL (assigned_to_user_id),
      FOREIGN KEY (tenant_id, assigned_by_user_id)
        REFERENCES users(tenant_id, id) ON DELETE SET NULL (assigned_by_user_id),
      FOREIGN KEY (tenant_id, started_by_user_id)
        REFERENCES users(tenant_id, id) ON DELETE SET NULL (started_by_user_id),
      FOREIGN KEY (tenant_id, completed_by_user_id)
        REFERENCES users(tenant_id, id) ON DELETE SET NULL (completed_by_user_id),
      FOREIGN KEY (tenant_id, verified_by_user_id)
        REFERENCES users(tenant_id, id) ON DELETE SET NULL (verified_by_user_id),
      FOREIGN KEY (tenant_id, workflow_instance_id)
        REFERENCES workflow_instances(tenant_id, id) ON DELETE SET NULL (workflow_instance_id),
      FOREIGN KEY (tenant_id, created_by)
        REFERENCES users(tenant_id, id) ON DELETE SET NULL (created_by),
      FOREIGN KEY (tenant_id, updated_by)
        REFERENCES users(tenant_id, id) ON DELETE SET NULL (updated_by),
      CONSTRAINT asset_maint_wo_type_check
        CHECK (maintenance_type IN ('preventive', 'corrective', 'emergency')),
      CONSTRAINT asset_maint_wo_priority_check
        CHECK (priority IN ('low', 'medium', 'high', 'critical')),
      UNIQUE (tenant_id, order_number)
    );

    ALTER TABLE asset_maintenance_work_orders
      ADD CONSTRAINT asset_maintenance_work_orders_tenant_id_id_unique UNIQUE (tenant_id, id);
    CREATE INDEX idx_asset_maint_wo_tenant
      ON asset_maintenance_work_orders (tenant_id, created_at DESC) WHERE deleted_at IS NULL;
    CREATE INDEX idx_asset_maint_wo_asset
      ON asset_maintenance_work_orders (asset_id) WHERE deleted_at IS NULL;
    CREATE INDEX idx_asset_maint_wo_assignee
      ON asset_maintenance_work_orders (assigned_to_user_id) WHERE deleted_at IS NULL;
    CREATE INDEX idx_asset_maint_wo_workflow
      ON asset_maintenance_work_orders (workflow_instance_id);

    -- === Spare Parts Management (AST-ADV-004) ===============================

    CREATE TABLE asset_maintenance_parts (
      id                          UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id                   UUID          NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      maintenance_work_order_id   UUID          NOT NULL,
      item_id                     UUID          NOT NULL,
      quantity                    NUMERIC(18,4) NOT NULL,
      unit_cost                   NUMERIC(15,2),
      notes                       TEXT,
      recorded_at                 TIMESTAMPTZ   NOT NULL DEFAULT now(),
      recorded_by_user_id         UUID,

      FOREIGN KEY (tenant_id, maintenance_work_order_id)
        REFERENCES asset_maintenance_work_orders(tenant_id, id) ON DELETE CASCADE,
      FOREIGN KEY (tenant_id, item_id)
        REFERENCES items(tenant_id, id) ON DELETE RESTRICT,
      FOREIGN KEY (tenant_id, recorded_by_user_id)
        REFERENCES users(tenant_id, id) ON DELETE SET NULL (recorded_by_user_id),
      CONSTRAINT asset_maint_parts_qty_check CHECK (quantity > 0),
      UNIQUE (tenant_id, maintenance_work_order_id, item_id)
    );

    ALTER TABLE asset_maintenance_parts
      ADD CONSTRAINT asset_maintenance_parts_tenant_id_id_unique UNIQUE (tenant_id, id);
    CREATE INDEX idx_asset_maint_parts_wo
      ON asset_maintenance_parts (maintenance_work_order_id);
    CREATE INDEX idx_asset_maint_parts_item
      ON asset_maintenance_parts (item_id);

    -- === Monotonic Meter Readings (AST-ADV-003) =============================

    CREATE TABLE asset_meter_readings (
      id                    UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id             UUID          NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      asset_id              UUID          NOT NULL,
      reading_type          TEXT          NOT NULL,
      reading_value         NUMERIC(18,4) NOT NULL,
      reading_date          TIMESTAMPTZ   NOT NULL,
      recorded_by_user_id   UUID,
      notes                 TEXT,
      created_at            TIMESTAMPTZ   NOT NULL DEFAULT now(),

      FOREIGN KEY (tenant_id, asset_id)
        REFERENCES assets(tenant_id, id) ON DELETE CASCADE,
      FOREIGN KEY (tenant_id, recorded_by_user_id)
        REFERENCES users(tenant_id, id) ON DELETE SET NULL (recorded_by_user_id),
      CONSTRAINT asset_meter_reading_type_check
        CHECK (reading_type IN ('hours', 'km', 'cycles')),
      CONSTRAINT asset_meter_reading_val_check
        CHECK (reading_value >= 0)
    );

    ALTER TABLE asset_meter_readings
      ADD CONSTRAINT asset_meter_readings_tenant_id_id_unique UNIQUE (tenant_id, id);
    CREATE INDEX idx_asset_meter_readings_asset_date
      ON asset_meter_readings (asset_id, reading_type, reading_date DESC);

    -- === Downtime Tracking (AST-ADV-005) ====================================

    CREATE TABLE asset_downtime_records (
      id                          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id                   UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      asset_id                    UUID        NOT NULL,
      maintenance_work_order_id   UUID,
      start_time                  TIMESTAMPTZ NOT NULL,
      end_time                    TIMESTAMPTZ,
      duration_minutes            INTEGER,
      reason_category             TEXT        NOT NULL,
      notes                       TEXT,
      created_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
      created_by                  UUID,

      FOREIGN KEY (tenant_id, asset_id)
        REFERENCES assets(tenant_id, id) ON DELETE CASCADE,
      FOREIGN KEY (tenant_id, maintenance_work_order_id)
        REFERENCES asset_maintenance_work_orders(tenant_id, id) ON DELETE SET NULL (maintenance_work_order_id),
      FOREIGN KEY (tenant_id, created_by)
        REFERENCES users(tenant_id, id) ON DELETE SET NULL (created_by),
      CONSTRAINT asset_downtime_reason_check
        CHECK (reason_category IN ('breakdown', 'scheduled_maintenance', 'power_failure', 'operator_error', 'other'))
    );

    ALTER TABLE asset_downtime_records
      ADD CONSTRAINT asset_downtime_records_tenant_id_id_unique UNIQUE (tenant_id, id);
    CREATE INDEX idx_asset_downtime_asset_time
      ON asset_downtime_records (asset_id, start_time DESC);

    -- === Reliability Metrics & Predictive Snapshots (AST-ADV-006, AST-ADV-007)

    CREATE TABLE asset_predictive_snapshots (
      id                    UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id             UUID          NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      asset_id              UUID          NOT NULL,
      analysis_date         DATE          NOT NULL,
      mtbf_hours            NUMERIC(12,2),
      mttr_hours            NUMERIC(12,2),
      availability_pct      NUMERIC(5,2),
      health_score          INTEGER       NOT NULL,
      predicted_failure_date DATE,
      confidence_pct        NUMERIC(5,2),
      recommendation        TEXT,
      algorithm_version     TEXT          NOT NULL DEFAULT 'v1.0-deterministic',
      created_at            TIMESTAMPTZ   NOT NULL DEFAULT now(),
      created_by            UUID,

      FOREIGN KEY (tenant_id, asset_id)
        REFERENCES assets(tenant_id, id) ON DELETE CASCADE,
      FOREIGN KEY (tenant_id, created_by)
        REFERENCES users(tenant_id, id) ON DELETE SET NULL (created_by)
    );

    ALTER TABLE asset_predictive_snapshots
      ADD CONSTRAINT asset_predictive_snapshots_tenant_id_id_unique UNIQUE (tenant_id, id);
    CREATE INDEX idx_asset_predictive_snapshots_asset
      ON asset_predictive_snapshots (asset_id, analysis_date DESC);
    CREATE INDEX idx_asset_predictive_snapshots_tenant
      ON asset_predictive_snapshots (tenant_id, analysis_date DESC);

    -- === Permissions ========================================================

    INSERT INTO permissions (code, description) VALUES
      ('service_operations.pack.manage',        'Manage activation and templating for vertical service packs'),
      ('service_operations.optimization.read',  'View capacity analysis and route/roster optimization proposals'),
      ('service_operations.optimization.apply', 'Apply confirmed route/roster/workload optimization proposals'),
      ('asset.maintenance.read',                'View asset maintenance schedules, work orders, parts, meter readings, and downtime'),
      ('asset.maintenance.manage',              'Create and maintain preventive schedules, maintenance work orders, and parts usage'),
      ('asset.meter.manage',                    'Record and manage asset meter readings and usage tracking'),
      ('asset.downtime.manage',                 'Record and manage asset downtime periods'),
      ('asset.analytics.read',                  'View asset MTBF, MTTR, availability, and predictive maintenance analysis')
    ON CONFLICT (code) DO NOTHING;
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    -- Drop in reverse dependency order

    DELETE FROM permissions WHERE code IN (
      'service_operations.pack.manage',
      'service_operations.optimization.read',
      'service_operations.optimization.apply',
      'asset.maintenance.read',
      'asset.maintenance.manage',
      'asset.meter.manage',
      'asset.downtime.manage',
      'asset.analytics.read'
    );

    DROP TABLE IF EXISTS asset_predictive_snapshots;
    DROP TABLE IF EXISTS asset_downtime_records;
    DROP TABLE IF EXISTS asset_meter_readings;
    DROP TABLE IF EXISTS asset_maintenance_parts;
    DROP TABLE IF EXISTS asset_maintenance_work_orders;
    DROP TABLE IF EXISTS asset_maintenance_schedules;
    DROP TABLE IF EXISTS service_optimization_runs;
    DROP TABLE IF EXISTS service_pack_activations;

    ALTER TABLE work_orders        DROP CONSTRAINT IF EXISTS work_orders_tenant_id_id_unique;
    ALTER TABLE items              DROP CONSTRAINT IF EXISTS items_tenant_id_id_unique;
    ALTER TABLE assets             DROP CONSTRAINT IF EXISTS assets_tenant_id_id_unique;
    ALTER TABLE organization_units DROP CONSTRAINT IF EXISTS organization_units_tenant_id_id_unique;
  `);
};
