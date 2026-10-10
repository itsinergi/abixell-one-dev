/**
 * Phase 2 WP-PRO-03: AP Payment Batch + GL Posting
 *
 * Implements AP payment batches for vendor invoices: batch creation, approval workflow,
 * GL posting via accounting-ready events (vendor.invoice.payment_approved),
 * nominal-limit enforcement (DEC-004-FU), and audit trail.
 *
 * Follows scm_vendor_invoices pattern: workflow instance for approval routing,
 * immutability trigger on approved/cancelled rows, UNIQUE idempotency key,
 * FK to vendor invoices.
 *
 * Accounting event goes through scm_accounting_ready_events outbox (consumed by
 * Accounting Kernel), NOT through Finance Core. Period ID resolved via open-period
 * date-range match; legal_entity_id resolved from organization_unit_id.
 *
 * Dictionary seed extension (process + API resource catalogues), following the
 * pattern from 1792000000011 (WP-PRO-01): snapshot prior seed function under a
 * fresh name, redefine canonical as UNION, backfill existing tenants.
 *
 * Routes (12 total, canonical + alias):
 *   POST   /procurement/payments                        (canonical)
 *   GET    /procurement/payments/:id                    (canonical)
 *   GET    /procurement/payments                        (canonical)
 *   POST   /procurement/payments/:id/submit             (canonical)
 *   POST   /procurement/payments/:id/approve            (canonical)
 *   POST   /procurement/payments/:id/cancel             (canonical)
 *   POST   /supply-chain/advanced/payments                       (alias)
 *   GET    /supply-chain/advanced/payments/:id                   (alias)
 *   GET    /supply-chain/advanced/payments                       (alias)
 *   POST   /supply-chain/advanced/payments/:id/submit             (alias)
 *   POST   /supply-chain/advanced/payments/:id/approve            (alias)
 *   POST   /supply-chain/advanced/payments/:id/cancel             (alias)
 */
exports.shorthands = undefined;

const PROCESS_ROWS = `
      ('supply_chain.payment.read', 'View AP payment batch records', 'procurement_management'),
      ('supply_chain.payment.manage', 'Create and edit AP payment batches', 'procurement_management'),
      ('supply_chain.payment.approve', 'Submit and approve AP payment batches', 'procurement_management')
`;

const API_RESOURCE_ROWS = `
      ('api:POST /procurement/payments', 'procurement_management', 'POST', '/procurement/payments'),
      ('api:GET /procurement/payments/:id', 'procurement_management', 'GET', '/procurement/payments/:id'),
      ('api:GET /procurement/payments', 'procurement_management', 'GET', '/procurement/payments'),
      ('api:POST /procurement/payments/:id/submit', 'procurement_management', 'POST', '/procurement/payments/:id/submit'),
      ('api:POST /procurement/payments/:id/approve', 'procurement_management', 'POST', '/procurement/payments/:id/approve'),
      ('api:POST /procurement/payments/:id/cancel', 'procurement_management', 'POST', '/procurement/payments/:id/cancel'),
      ('api:POST /supply-chain/advanced/payments', 'procurement_management', 'POST', '/supply-chain/advanced/payments'),
      ('api:GET /supply-chain/advanced/payments/:id', 'procurement_management', 'GET', '/supply-chain/advanced/payments/:id'),
      ('api:GET /supply-chain/advanced/payments', 'procurement_management', 'GET', '/supply-chain/advanced/payments'),
      ('api:POST /supply-chain/advanced/payments/:id/submit', 'procurement_management', 'POST', '/supply-chain/advanced/payments/:id/submit'),
      ('api:POST /supply-chain/advanced/payments/:id/approve', 'procurement_management', 'POST', '/supply-chain/advanced/payments/:id/approve'),
      ('api:POST /supply-chain/advanced/payments/:id/cancel', 'procurement_management', 'POST', '/supply-chain/advanced/payments/:id/cancel')
`;

exports.up = (pgm) => {
  pgm.sql(`
    -- -----------------------------------------------------------------------
    -- 1. Payment Batches (AP Payment header)
    -- -----------------------------------------------------------------------
    CREATE TABLE scm_payment_batches (
      id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id             UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      batch_number          TEXT        NOT NULL,
      idempotency_key       TEXT        NOT NULL,
      organization_unit_id  UUID        NOT NULL,
      status                TEXT        NOT NULL DEFAULT 'draft',
      approved_amount       NUMERIC(18,4) NOT NULL DEFAULT 0,
      currency              TEXT        NOT NULL DEFAULT 'IDR',
      workflow_instance_id  UUID,
      finance_transaction_id UUID,
      submitted_at          TIMESTAMPTZ,
      submitted_by          UUID,
      approved_at           TIMESTAMPTZ,
      approved_by           UUID,
      cancelled_at          TIMESTAMPTZ,
      cancelled_by          UUID,
      created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
      created_by            UUID,
      updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_by            UUID,

      FOREIGN KEY (tenant_id, organization_unit_id)
        REFERENCES organization_units(tenant_id, id) ON DELETE RESTRICT,
      FOREIGN KEY (tenant_id, workflow_instance_id)
        REFERENCES workflow_instances(tenant_id, id) ON DELETE SET NULL (workflow_instance_id),
      FOREIGN KEY (tenant_id, submitted_by)
        REFERENCES users(tenant_id, id) ON DELETE SET NULL (submitted_by),
      FOREIGN KEY (tenant_id, approved_by)
        REFERENCES users(tenant_id, id) ON DELETE SET NULL (approved_by),
      FOREIGN KEY (tenant_id, cancelled_by)
        REFERENCES users(tenant_id, id) ON DELETE SET NULL (cancelled_by),
      FOREIGN KEY (tenant_id, created_by)
        REFERENCES users(tenant_id, id) ON DELETE SET NULL (created_by),
      FOREIGN KEY (tenant_id, updated_by)
        REFERENCES users(tenant_id, id) ON DELETE SET NULL (updated_by),
      CONSTRAINT scm_payment_batches_status_check
        CHECK (status IN ('draft', 'submitted', 'approved', 'cancelled')),
      CONSTRAINT scm_payment_batches_amount_check CHECK (approved_amount >= 0),
      UNIQUE (tenant_id, batch_number),
      UNIQUE (tenant_id, idempotency_key)
    );

    ALTER TABLE scm_payment_batches
      ADD CONSTRAINT scm_payment_batches_tenant_id_id_unique UNIQUE (tenant_id, id);
    CREATE INDEX idx_scm_payment_batches_org_unit
      ON scm_payment_batches (tenant_id, organization_unit_id, created_at DESC);
    CREATE INDEX idx_scm_payment_batches_status
      ON scm_payment_batches (tenant_id, status, created_at DESC);

    -- Immutability trigger: approved/cancelled payment batch facts cannot change
    CREATE OR REPLACE FUNCTION scm_reject_approved_payment_batch_changes()
    RETURNS trigger AS $$
    BEGIN
      IF OLD.status IN ('approved', 'cancelled') AND (
        OLD.status IS DISTINCT FROM NEW.status OR
        OLD.batch_number IS DISTINCT FROM NEW.batch_number OR
        OLD.approved_amount IS DISTINCT FROM NEW.approved_amount OR
        OLD.approved_at IS DISTINCT FROM NEW.approved_at OR
        OLD.approved_by IS DISTINCT FROM NEW.approved_by
      ) THEN
        RAISE EXCEPTION 'Approved or cancelled payment batch facts cannot be changed';
      END IF;
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;

    CREATE TRIGGER trg_scm_payment_batch_immutable
      BEFORE UPDATE ON scm_payment_batches
      FOR EACH ROW EXECUTE FUNCTION scm_reject_approved_payment_batch_changes();

    -- -----------------------------------------------------------------------
    -- 2. Payment Lines (items per batch)
    -- -----------------------------------------------------------------------
    CREATE TABLE scm_payment_lines (
      id                        UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id                 UUID          NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      payment_batch_id          UUID          NOT NULL,
      vendor_invoice_id         UUID          NOT NULL,
      amount                    NUMERIC(18,4) NOT NULL,
      currency                  TEXT          NOT NULL DEFAULT 'IDR',
      approval_override_reason  TEXT,
      created_at                TIMESTAMPTZ   NOT NULL DEFAULT now(),

      FOREIGN KEY (tenant_id, payment_batch_id)
        REFERENCES scm_payment_batches(tenant_id, id) ON DELETE CASCADE,
      FOREIGN KEY (tenant_id, vendor_invoice_id)
        REFERENCES scm_vendor_invoices(tenant_id, id) ON DELETE RESTRICT,
      CONSTRAINT scm_payment_lines_amount_check CHECK (amount >= 0),
      UNIQUE (tenant_id, payment_batch_id, vendor_invoice_id)
    );

    ALTER TABLE scm_payment_lines
      ADD CONSTRAINT scm_payment_lines_tenant_id_id_unique UNIQUE (tenant_id, id);
    CREATE INDEX idx_scm_payment_lines_batch
      ON scm_payment_lines (tenant_id, payment_batch_id);
    CREATE INDEX idx_scm_payment_lines_invoice
      ON scm_payment_lines (tenant_id, vendor_invoice_id);

    -- -----------------------------------------------------------------------
    -- 3. Payment Approval Limits (DEC-004-FU nominal enforcement)
    -- -----------------------------------------------------------------------
    CREATE TABLE scm_payment_approval_limits (
      tenant_id     UUID          NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      role_code     TEXT          NOT NULL,
      nominal_limit NUMERIC(18,4),

      FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
      CONSTRAINT scm_payment_approval_limits_amount_check
        CHECK (nominal_limit IS NULL OR nominal_limit >= 0),
      PRIMARY KEY (tenant_id, role_code)
    );

    CREATE INDEX idx_scm_payment_approval_limits_role
      ON scm_payment_approval_limits (tenant_id, role_code);

    -- -----------------------------------------------------------------------
    -- 4. Register WP-PRO-03 permissions
    -- -----------------------------------------------------------------------
    INSERT INTO permissions (code, description) VALUES
      ('supply_chain.payment.read',    'View AP payment batch records'),
      ('supply_chain.payment.manage',  'Create and edit AP payment batches'),
      ('supply_chain.payment.approve', 'Submit and approve AP payment batches')
    ON CONFLICT (code) DO NOTHING;

    -- -----------------------------------------------------------------------
    -- 5. Extend scm_accounting_ready_events.event_type to accept payment events
    -- -----------------------------------------------------------------------
    ALTER TABLE scm_accounting_ready_events
      DROP CONSTRAINT scm_accounting_events_type_check;
    ALTER TABLE scm_accounting_ready_events
      ADD CONSTRAINT scm_accounting_events_type_check
        CHECK (event_type IN (
          'inventory.goods_received', 'inventory.goods_issued', 'inventory.transferred', 'inventory.adjusted',
          'inventory.returned_to_vendor', 'inventory.receipt_reversed', 'inventory.landed_cost_applied',
          'inventory.consignment_consumed', 'service.accepted', 'inventory.disposed',
          'vendor.invoice.approved', 'vendor.invoice.payment_approved'
        ));
  `);

  pgm.sql(`
    -- -----------------------------------------------------------------------
    -- 6. Extend Process seed function
    -- -----------------------------------------------------------------------
    -- 6a. Keep the prior Process catalogue reachable under its own name
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
         WHERE p.proname = 'config_dictionary_process_seed_phase2_pro03'
           AND n.nspname = current_schema()
      ) THEN
        ALTER FUNCTION config_dictionary_process_seed()
          RENAME TO config_dictionary_process_seed_phase2_pro03;
      END IF;
    END
    $$;

    -- 6b. Redefine the canonical Process catalogue as prior + WP-PRO-03
    CREATE OR REPLACE FUNCTION config_dictionary_process_seed()
    RETURNS TABLE (code TEXT, name TEXT, module_code TEXT) AS $seed$
      SELECT s.code, s.name, s.module_code
        FROM config_dictionary_process_seed_phase2_pro03() s
      UNION
      SELECT a.code, a.name, a.module_code
        FROM (VALUES
          ${PROCESS_ROWS}
        ) AS a(code, name, module_code);
    $seed$ LANGUAGE sql IMMUTABLE;

    -- 6c. Backfill app_processes for existing tenants
    INSERT INTO app_processes (tenant_id, code, name, module_code)
    SELECT t.id, a.code, a.name, a.module_code
      FROM tenants t
      CROSS JOIN (VALUES
        ${PROCESS_ROWS}
      ) AS a(code, name, module_code)
    ON CONFLICT (tenant_id, code) DO NOTHING;

    -- -----------------------------------------------------------------------
    -- 7. Extend API Resource seed function
    -- -----------------------------------------------------------------------
    -- 7a. Keep the prior API Resource catalogue reachable under its own name
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
         WHERE p.proname = 'config_dictionary_api_resource_seed_phase2_pro03'
           AND n.nspname = current_schema()
      ) THEN
        ALTER FUNCTION config_dictionary_api_resource_seed()
          RENAME TO config_dictionary_api_resource_seed_phase2_pro03;
      END IF;
    END
    $$;

    -- 7b. Redefine the canonical API Resource catalogue as prior + WP-PRO-03
    CREATE OR REPLACE FUNCTION config_dictionary_api_resource_seed()
    RETURNS TABLE (code TEXT, name TEXT, module_code TEXT, http_method TEXT, path_pattern TEXT) AS $seed$
      SELECT s.code, s.name, s.module_code, s.http_method, s.path_pattern
        FROM config_dictionary_api_resource_seed_phase2_pro03() s
      UNION
      SELECT a.code, a.http_method || ' ' || a.path_pattern, a.module_code, a.http_method, a.path_pattern
        FROM (VALUES
          ${API_RESOURCE_ROWS}
        ) AS a(code, module_code, http_method, path_pattern);
    $seed$ LANGUAGE sql IMMUTABLE;

    -- 7c. Backfill app_api_resources for existing tenants
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
    -- Fail-closed rollback guard: refuse if payment operational data exists
    DO $$
    BEGIN
      -- Guard: approved or submitted payment batches exist
      IF EXISTS (
        SELECT 1
          FROM scm_payment_batches
         WHERE status NOT IN ('draft', 'cancelled')
      ) THEN
        RAISE EXCEPTION 'Cannot rollback Phase 2 WP-PRO-03: active payment batch records exist';
      END IF;

      -- Guard: payment batches with accounting events exist
      IF EXISTS (
        SELECT 1
          FROM scm_accounting_ready_events
         WHERE event_type = 'vendor.invoice.payment_approved'
      ) THEN
        RAISE EXCEPTION 'Cannot rollback Phase 2 WP-PRO-03: payment accounting events exist';
      END IF;
    END $$;

    -- Delete WP-PRO-03 permissions
    DELETE FROM permissions WHERE code IN (
      'supply_chain.payment.read',
      'supply_chain.payment.manage',
      'supply_chain.payment.approve'
    );

    -- Revert API Resource catalogue
    DELETE FROM app_api_resources
     WHERE code IN (
       SELECT a.code FROM (VALUES
         ${API_RESOURCE_ROWS}
       ) AS a(code, module_code, http_method, path_pattern)
     );

    DROP FUNCTION IF EXISTS config_dictionary_api_resource_seed();

    ALTER FUNCTION config_dictionary_api_resource_seed_phase2_pro03()
      RENAME TO config_dictionary_api_resource_seed;

    -- Revert Process catalogue
    DELETE FROM app_processes
     WHERE code IN (
       SELECT a.code FROM (VALUES
         ${PROCESS_ROWS}
       ) AS a(code, name, module_code)
     );

    DROP FUNCTION IF EXISTS config_dictionary_process_seed();

    ALTER FUNCTION config_dictionary_process_seed_phase2_pro03()
      RENAME TO config_dictionary_process_seed;

    -- Drop tables and triggers
    DROP TABLE IF EXISTS scm_payment_lines;
    DROP TRIGGER IF EXISTS trg_scm_payment_batch_immutable ON scm_payment_batches;
    DROP FUNCTION IF EXISTS scm_reject_approved_payment_batch_changes;
    DROP TABLE IF EXISTS scm_payment_batches;
    DROP TABLE IF EXISTS scm_payment_approval_limits;

    -- Restore event type CHECK to pre-WP-PRO-03 state
    ALTER TABLE scm_accounting_ready_events
      DROP CONSTRAINT scm_accounting_events_type_check;
    ALTER TABLE scm_accounting_ready_events
      ADD CONSTRAINT scm_accounting_events_type_check
        CHECK (event_type IN (
          'inventory.goods_received', 'inventory.goods_issued', 'inventory.transferred', 'inventory.adjusted',
          'inventory.returned_to_vendor', 'inventory.receipt_reversed', 'inventory.landed_cost_applied',
          'inventory.consignment_consumed', 'service.accepted', 'inventory.disposed',
          'vendor.invoice.approved'
        ));
  `);
};
