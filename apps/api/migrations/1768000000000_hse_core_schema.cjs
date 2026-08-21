/**
 * Phase 7 — HSE Core schema (HSE-CORE-001…010).
 *
 * Core is CAPTURE AND FOLLOW-UP. It answers: what incident or observation
 * occurred, when and where, who reported it, how is it classified, what
 * evidence exists, what basic follow-up is required, and what is its
 * lifecycle state.
 *
 * Deliberately absent (Advanced):
 *   Investigation methodology · root-cause analysis · CAPA engine ·
 *   risk assessment (JSA/HIRA/HIRADC) · permit to work · inspection/audit ·
 *   environmental monitoring · occupational health / medical · LTIFR/TRIFR ·
 *   leading/lagging indicators · predictive safety · regulatory reporting.
 *
 * Design decisions:
 *
 * - ONE authoritative `hse_records` table with a `record_type` column
 *   (`incident | observation`). PRD CORE-001/002 both have the same lifecycle
 *   — one table, one Workflow Engine link — avoids two nearly-identical
 *   aggregates (prompt §9/§10).
 *
 * - NO status column. Lifecycle state is owned by the Workflow Engine via
 *   `workflow_instance_id` (BC-GEN-003, prompt §25/§26). The finite enum
 *   `record_type` is NOT lifecycle — it is classification.
 *
 * - Category and severity use Reference Data (prompt §12/§13). No
 *   industry-specific taxonomy is hardcoded.
 *
 * - Location is carried by nullable FK references to the existing
 *   `organization_units`, `projects`, `sites` tables — no hse_sites
 *   duplicate (prompt §14).
 *
 * - Reporter = authenticated user (`reported_by_user_id`). Persons involved
 *   are tracked in `hse_persons_involved` with an optional
 *   `employee_id` FK (clean reference port, no Workforce internals imported —
 *   same pattern as Asset custodian, prompt §15/§64).
 *
 * - Evidence reuses Document Core (PC-9, ADR-0012). The entity type
 *   `hse_record` is registered in the Entity Authorization Resolver
 *   (prompt §19/§20).
 *
 * - `hse_follow_ups` is a separate table for basic actions (CORE-007:
 *   owner + target date + completion). NOT a CAPA table. No root-cause
 *   linkage, no effectiveness verification, no action hierarchy (prompt §22).
 *
 * - Numbering via Numbering Core (`hse_record` sequence, CORE-008).
 *
 * - 6 capability permissions added to the global catalog (CORE-009/010):
 *   hse.read, hse.report, hse.manage, hse.close, hse.configure,
 *   hse.documents.read.
 *
 * - Correction/immutability: after closure (terminal Workflow state), the
 *   core event facts are preserved by the absence of a PATCH surface on
 *   them. occurred_at, record_type, category, severity are not freely editable
 *   once the record reaches terminal workflow state (enforced at the application
 *   layer — not an additional DB constraint to keep schema simple).
 *
 * - Historical records are never hard-deleted (prompt §30). No DELETE surface.
 *
 * gen_random_uuid() comes from pgcrypto (migration 0001).
 */
exports.up = (pgm) => {
  pgm.sql(`

    -- -----------------------------------------------------------------------
    -- hse_records
    -- The one authoritative HSE record aggregate (CORE-001/002).
    -- -----------------------------------------------------------------------
    CREATE TABLE hse_records (
      id                        UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id                 UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,

      -- Business reference (CORE-008) — populated by Numbering Core.
      record_number             TEXT        NOT NULL,

      -- Classification (CORE-001/002): incident vs observation.
      -- Client terminology is configurable via Reference Data for the
      -- *category* dimension; this is the structural type.
      record_type               TEXT        NOT NULL CHECK (record_type IN ('incident', 'observation')),

      -- Category and severity use Reference Data (CORE-001, prompt §12/§13).
      -- These are tenant-configurable; no industry terminology hardcoded.
      category_code             TEXT,
      severity_code             TEXT,

      -- Occurrence and reporting timestamps (CORE-001, prompt §17).
      -- occurred_at is when the event actually happened.
      -- reported_at is when it was entered into the system.
      occurred_at               TIMESTAMPTZ NOT NULL,
      reported_at               TIMESTAMPTZ NOT NULL DEFAULT now(),

      -- Narrative (CORE-001, prompt §18). Enough to understand the event.
      title                     TEXT        NOT NULL,
      summary                   TEXT,
      description               TEXT,
      -- Basic immediate follow-up note (prompt §18). Not a CAPA field.
      immediate_action          TEXT,

      -- Location context (CORE-003). Reuses existing hierarchy tables.
      organization_unit_id      UUID        REFERENCES organization_units(id) ON DELETE SET NULL,
      project_id                UUID        REFERENCES projects(id) ON DELETE SET NULL,
      site_id                   UUID        REFERENCES sites(id) ON DELETE SET NULL,
      -- Lightweight free-text location detail (e.g. "North pit access road").
      location_detail           TEXT,

      -- Reporter (CORE-001, prompt §15). Authenticated user who filed the report.
      reported_by_user_id       UUID        NOT NULL REFERENCES users(id) ON DELETE RESTRICT,

      -- Responsible party for primary follow-up (prompt §16). Clean reference.
      responsible_user_id       UUID        REFERENCES users(id) ON DELETE SET NULL,
      responsible_org_unit_id   UUID        REFERENCES organization_units(id) ON DELETE SET NULL,

      -- Lifecycle: Workflow Engine is the only lifecycle authority (CORE-006).
      -- No status column. Applied_at / terminal state come from the Workflow
      -- instance. A record's lifecycle state is read from the Workflow Engine.
      workflow_instance_id      UUID        REFERENCES workflow_instances(id) ON DELETE SET NULL,

      -- Audit / ownership.
      created_by_user_id        UUID        REFERENCES users(id) ON DELETE SET NULL,
      updated_by_user_id        UUID        REFERENCES users(id) ON DELETE SET NULL,
      created_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at                TIMESTAMPTZ NOT NULL DEFAULT now(),

      -- Tenant + business-number uniqueness.
      CONSTRAINT uq_hse_record_number_per_tenant UNIQUE (tenant_id, record_number)
    );

    CREATE INDEX idx_hse_records_tenant ON hse_records (tenant_id);
    CREATE INDEX idx_hse_records_tenant_type ON hse_records (tenant_id, record_type);
    CREATE INDEX idx_hse_records_tenant_occurred ON hse_records (tenant_id, occurred_at DESC);
    CREATE INDEX idx_hse_records_reported_by ON hse_records (tenant_id, reported_by_user_id);
    CREATE INDEX idx_hse_records_org_unit ON hse_records (tenant_id, organization_unit_id) WHERE organization_unit_id IS NOT NULL;
    CREATE INDEX idx_hse_records_project ON hse_records (tenant_id, project_id) WHERE project_id IS NOT NULL;
    CREATE INDEX idx_hse_records_workflow ON hse_records (workflow_instance_id) WHERE workflow_instance_id IS NOT NULL;

    -- -----------------------------------------------------------------------
    -- hse_persons_involved (CORE-004)
    -- Optional persons linked to an HSE record.
    -- employee_id is a clean reference (no Workforce internals imported).
    -- -----------------------------------------------------------------------
    CREATE TABLE hse_persons_involved (
      id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
      hse_record_id   UUID        NOT NULL REFERENCES hse_records(id) ON DELETE CASCADE,
      -- Optional link to the workforce employee master.
      employee_id     UUID,
      -- Free-text name for external persons or when employee link is absent.
      person_name     TEXT,
      person_role     TEXT,
      created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE INDEX idx_hse_persons_record ON hse_persons_involved (hse_record_id);

    -- -----------------------------------------------------------------------
    -- hse_follow_ups (CORE-007)
    -- Basic follow-up actions: owner, due date, completion. NOT CAPA.
    -- No root-cause linkage, no effectiveness verification, no action hierarchy.
    -- -----------------------------------------------------------------------
    CREATE TABLE hse_follow_ups (
      id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id         UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      hse_record_id     UUID        NOT NULL REFERENCES hse_records(id) ON DELETE CASCADE,

      -- What needs to be done.
      title             TEXT        NOT NULL,
      description       TEXT,

      -- Owner (prompt §16). Clean user + org unit references.
      assigned_to_user_id   UUID    REFERENCES users(id) ON DELETE SET NULL,
      assigned_to_org_unit_id UUID  REFERENCES organization_units(id) ON DELETE SET NULL,

      -- Static due date (CORE-007, prompt §41). Not an SLA engine.
      due_date          DATE,

      -- Completion (CORE-007).
      completed_at      TIMESTAMPTZ,
      completed_by_user_id UUID     REFERENCES users(id) ON DELETE SET NULL,
      completion_notes  TEXT,

      -- Audit.
      created_by_user_id UUID       REFERENCES users(id) ON DELETE SET NULL,
      updated_by_user_id UUID       REFERENCES users(id) ON DELETE SET NULL,
      created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE INDEX idx_hse_follow_ups_record ON hse_follow_ups (hse_record_id);
    CREATE INDEX idx_hse_follow_ups_tenant ON hse_follow_ups (tenant_id);
    CREATE INDEX idx_hse_follow_ups_assignee ON hse_follow_ups (tenant_id, assigned_to_user_id) WHERE assigned_to_user_id IS NOT NULL;
    CREATE INDEX idx_hse_follow_ups_due ON hse_follow_ups (tenant_id, due_date) WHERE due_date IS NOT NULL AND completed_at IS NULL;

    -- -----------------------------------------------------------------------
    -- Permissions (CORE-009/010)
    -- 6 capabilities added to the global permission catalog.
    -- -----------------------------------------------------------------------
    INSERT INTO permissions (code, description) VALUES
      ('hse.read',          'View HSE records and register'),
      ('hse.report',        'Report new HSE incidents and observations'),
      ('hse.manage',        'Update and classify HSE records, assign follow-up'),
      ('hse.close',         'Close an HSE record through the workflow'),
      ('hse.configure',     'Configure HSE categories, workflow, numbering'),
      ('hse.documents.read','Read HSE evidence documents (beyond hse.read)')
    ON CONFLICT (code) DO NOTHING;

  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    DELETE FROM permissions WHERE code IN (
      'hse.read','hse.report','hse.manage','hse.close','hse.configure','hse.documents.read'
    );
    DROP TABLE IF EXISTS hse_follow_ups;
    DROP TABLE IF EXISTS hse_persons_involved;
    DROP TABLE IF EXISTS hse_records;
  `);
};
