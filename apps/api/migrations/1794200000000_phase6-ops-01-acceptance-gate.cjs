/**
 * WP-OPS-01 Phase 6 — Customer Acceptance Gate (FR-OPS-001, E2EGAP-014).
 *
 * Formal customer sign-off on a work order:
 *   - Business facts on `work_orders` (customer_accepted_at/via/comment,
 *     customer_rejected_at/reason). State itself remains in the Workflow
 *     Instance (SO-CORE-004); these are evidence columns, like verified_at.
 *   - A per-WO acceptance token (`work_order_acceptance_tokens`) powers the
 *     public, authless accept/reject link given to the customer. SHA256 hash
 *     only — the raw token is handed back once at issue and never persisted.
 *   - Outbox event type `work_order.accepted` added to the Accounting Ready
 *     constraint. Journal rule (SERVICE_ACCEPTED_WO) is NOT seeded here:
 *     amounts are 0 until WP-OPS-02 attaches the cost accumulator; the
 *     consumer treats "no active rule" as `skipped` (observability).
 *   - CSAT auto-assignment: per-tenant seed of a `CSAT_POST_ACCEPTANCE`
 *     survey definition (one rating question, version published and current)
 *     + a `survey_integration_policies` row that subscribes to
 *     `work_order.accepted`. Keeps all client-neutral content in Core.
 *
 * All seeds use INSERT … SELECT FROM tenants ON CONFLICT DO NOTHING, so the
 * migration is idempotent and existing tenants are backfilled on apply.
 */
exports.up = (pgm) => {
  // 1. Business facts on work_orders.
  pgm.sql(`
    ALTER TABLE work_orders
      ADD COLUMN customer_accepted_at         timestamptz,
      ADD COLUMN customer_accepted_via        text,
      ADD COLUMN customer_acceptance_comment  text,
      ADD COLUMN customer_rejected_at         timestamptz,
      ADD COLUMN customer_rejection_reason    text;

    ALTER TABLE work_orders
      ADD CONSTRAINT work_orders_customer_accepted_via_check
      CHECK (customer_accepted_via IS NULL
             OR customer_accepted_via IN ('token', 'internal'));
  `);

  // 2. Public-token aggregate for the customer sign-off link.
  pgm.sql(`
    CREATE TABLE work_order_acceptance_tokens (
      id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id      uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      work_order_id  uuid NOT NULL REFERENCES work_orders(id) ON DELETE CASCADE,
      token_hash     text NOT NULL UNIQUE,
      expires_at     timestamptz NOT NULL,
      used_at        timestamptz,
      revoked_at     timestamptz,
      created_by     uuid REFERENCES users(id) ON DELETE SET NULL,
      created_at     timestamptz NOT NULL DEFAULT now()
    );

    CREATE INDEX idx_wo_accept_tokens_wo
      ON work_order_acceptance_tokens(tenant_id, work_order_id);
    -- Live-token lookup: hash is already unique globally; this partial
    -- index speeds up the "is there an unused, unrevoked token for this
    -- WO" check used by issueAcceptanceToken.
    CREATE INDEX idx_wo_accept_tokens_live
      ON work_order_acceptance_tokens(tenant_id, work_order_id)
      WHERE used_at IS NULL AND revoked_at IS NULL;
  `);

  // 3. Widen the Accounting Ready outbox constraint to accept the new
  // event type. Pattern is identical to migration 1793100000010 (payroll):
  // DROP + ADD the whole CHECK list. Keep the latest 13-type baseline in
  // step with that migration and append 'work_order.accepted' as #14.
  pgm.sql(`
    ALTER TABLE scm_accounting_ready_events
      DROP CONSTRAINT scm_accounting_events_type_check;

    ALTER TABLE scm_accounting_ready_events
      ADD CONSTRAINT scm_accounting_events_type_check
        CHECK (event_type IN (
          'inventory.goods_received', 'inventory.goods_issued', 'inventory.transferred', 'inventory.adjusted',
          'inventory.returned_to_vendor', 'inventory.receipt_reversed', 'inventory.landed_cost_applied',
          'inventory.consignment_consumed', 'service.accepted', 'inventory.disposed',
          'vendor.invoice.approved', 'vendor.invoice.payment_approved', 'payroll.run_posted',
          'work_order.accepted'
        ));
  `);

  // 4. CSAT survey definition per tenant (K9). Idempotent via UNIQUE
  // (tenant_id, code) on survey_definitions and the matching UNIQUEs on
  // its children. One Likert-5 rating question is enough as a baseline;
  // tenants can publish a new VERSION later through the Survey admin UI
  // without ever touching this seed row.
  pgm.sql(`
    INSERT INTO survey_definitions (tenant_id, code, name, description, is_active)
    SELECT t.id, 'CSAT_POST_ACCEPTANCE',
           'Customer Satisfaction — Post Work Order Acceptance',
           'Short CSAT survey auto-assigned after a work order is accepted by the customer.',
           true
      FROM tenants t
      ON CONFLICT (tenant_id, code) DO NOTHING;

    INSERT INTO survey_versions (survey_definition_id, version_number, status, is_current, published_at)
    SELECT d.id, 1, 'published', true, now()
      FROM survey_definitions d
     WHERE d.code = 'CSAT_POST_ACCEPTANCE'
       AND NOT EXISTS (
         SELECT 1 FROM survey_versions v
          WHERE v.survey_definition_id = d.id AND v.version_number = 1
       );

    INSERT INTO survey_sections (survey_version_id, code, title, sort_order)
    SELECT v.id, 'MAIN', 'Satisfaction', 0
      FROM survey_versions v
      JOIN survey_definitions d ON d.id = v.survey_definition_id
     WHERE d.code = 'CSAT_POST_ACCEPTANCE' AND v.version_number = 1
       AND NOT EXISTS (
         SELECT 1 FROM survey_sections s
          WHERE s.survey_version_id = v.id AND s.code = 'MAIN'
       );

    INSERT INTO survey_questions
      (survey_version_id, section_id, code, text, question_type, is_required, config, sort_order)
    SELECT v.id, s.id, 'OVERALL',
           'How satisfied are you with the completed work?',
           'rating', true,
           '{"scale":{"min":1,"max":5}}'::jsonb,
           0
      FROM survey_versions v
      JOIN survey_definitions d ON d.id = v.survey_definition_id
      JOIN survey_sections s ON s.survey_version_id = v.id AND s.code = 'MAIN'
     WHERE d.code = 'CSAT_POST_ACCEPTANCE' AND v.version_number = 1
       AND NOT EXISTS (
         SELECT 1 FROM survey_questions q
          WHERE q.survey_version_id = v.id AND q.code = 'OVERALL'
       );
  `);

  // 5. Survey-integration policy per tenant — subscribes to the new event
  // and auto-assigns the CSAT survey, one per entity lifetime (DEC-K9).
  pgm.sql(`
    INSERT INTO survey_integration_policies
      (tenant_id, code, name, enabled, source_entity_type, source_event_type,
       survey_definition_code, respondent_resolution, one_per_entity_lifetime)
    SELECT t.id, 'CSAT_POST_ACCEPTANCE_WO',
           'Auto-assign CSAT when a work order is accepted',
           true, 'work_order', 'work_order.accepted',
           'CSAT_POST_ACCEPTANCE', 'source_event_actor', true
      FROM tenants t
      ON CONFLICT (tenant_id, code) DO NOTHING;
  `);
};

exports.down = (pgm) => {
  // Reverse in dependency order: policy → survey content → constraint →
  // token table → work_orders columns. Children of the survey definition
  // go via ON DELETE CASCADE when the definition row is removed.
  pgm.sql(`
    DELETE FROM survey_integration_policies
     WHERE code = 'CSAT_POST_ACCEPTANCE_WO';

    DELETE FROM survey_definitions
     WHERE code = 'CSAT_POST_ACCEPTANCE';

    -- Outbox cleanup mirrors migration 1793100000010: the immutability
    -- trigger must be disabled to drop existing event rows, then
    -- re-enabled before releasing the constraint change.
    DELETE FROM scm_accounting_ready_event_state_transitions
     WHERE accounting_event_id IN (
       SELECT id FROM scm_accounting_ready_events
        WHERE event_type = 'work_order.accepted'
     );

    ALTER TABLE scm_accounting_ready_events
      DISABLE TRIGGER trg_scm_accounting_ready_events_immutable_facts;

    DELETE FROM scm_accounting_ready_events
     WHERE event_type = 'work_order.accepted';

    ALTER TABLE scm_accounting_ready_events
      ENABLE TRIGGER trg_scm_accounting_ready_events_immutable_facts;

    ALTER TABLE scm_accounting_ready_events
      DROP CONSTRAINT scm_accounting_events_type_check;

    ALTER TABLE scm_accounting_ready_events
      ADD CONSTRAINT scm_accounting_events_type_check
        CHECK (event_type IN (
          'inventory.goods_received', 'inventory.goods_issued', 'inventory.transferred', 'inventory.adjusted',
          'inventory.returned_to_vendor', 'inventory.receipt_reversed', 'inventory.landed_cost_applied',
          'inventory.consignment_consumed', 'service.accepted', 'inventory.disposed',
          'vendor.invoice.approved', 'vendor.invoice.payment_approved', 'payroll.run_posted'
        ));

    DROP TABLE IF EXISTS work_order_acceptance_tokens;

    ALTER TABLE work_orders
      DROP CONSTRAINT IF EXISTS work_orders_customer_accepted_via_check,
      DROP COLUMN IF EXISTS customer_rejection_reason,
      DROP COLUMN IF EXISTS customer_rejected_at,
      DROP COLUMN IF EXISTS customer_acceptance_comment,
      DROP COLUMN IF EXISTS customer_accepted_via,
      DROP COLUMN IF EXISTS customer_accepted_at;
  `);
};
