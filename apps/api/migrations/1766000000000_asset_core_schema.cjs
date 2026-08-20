/**
 * Phase 5 — Asset Core schema (AST-CORE-001…010).
 *
 * Core is a REGISTER, not a maintenance system. It answers: what asset
 * exists, what is its identity/tag, where is it, who is responsible for it,
 * what is its status, and how did it move. Preventive/corrective
 * maintenance, work orders, meters, downtime, reliability metrics,
 * depreciation and fixed-asset accounting are Advanced and deliberately
 * absent.
 *
 * Deliberate design decisions:
 *
 * - **Responsibility and location are modelled separately.** The
 *   organisation unit carries responsibility (and is the Data Scope
 *   anchor); project / site / location detail carry physical placement. A
 *   site is never treated as an organisational owner.
 *
 * - **Identity is two-part.** asset_number is minted by Numbering Core and
 *   is always present; asset_tag is the OPTIONAL physical identifier a
 *   client sticks on the equipment. Both are unique per tenant — the tag
 *   through a partial unique index, because NULL never equals NULL
 *   (same lesson as ADR-0006).
 *
 * - **Current state + immutable ledger.** assets holds the current
 *   placement for fast reads; asset_movements is the history. Every applied
 *   movement snapshots the real previous state (from_*), records the
 *   resolved new state (to_*), and bumps assets.version — all inside ONE
 *   transaction, so history can never contradict current state.
 *
 * - **sequence is the lost-update guard.** An applied movement takes
 *   sequence = the asset version it produced, and the partial unique index
 *   makes two concurrent applies at the same version impossible at the
 *   database level rather than by convention.
 *
 * - **Approval is optional and belongs to the Workflow Engine**
 *   (AST-CORE-007: "where the client requires one"). If the tenant has
 *   published an asset_movement_approval definition, the movement is
 *   recorded unapplied with a workflow_instance_id and is applied on
 *   approval. There is no status column on the movement: pending / approved
 *   / rejected is read from the Workflow instance, and "took effect" is
 *   applied_at. No second lifecycle engine.
 *
 * - **requested_change holds what was asked**, so a movement awaiting
 *   approval does not freeze a stale absolute target; the from and to
 *   snapshots are the resolved facts, written at apply time.
 *
 * - **Acquisition reference is free text.** Asset Core does not link to
 *   Supply Chain: not every asset originates from a purchase order, and
 *   automatic PO-to-asset creation is cross-domain integration, not Core.
 *
 * - **No destructive delete.** Retirement/disposal is a terminal status
 *   recorded through the same ledger; the record and its history stay
 *   readable.
 *
 * gen_random_uuid() comes from pgcrypto (migration 0001).
 */
exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE assets (
      id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id                 uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      -- Identity (AST-CORE-001): system reference + optional physical tag.
      asset_number              text NOT NULL,
      asset_tag                 text,
      name                      text NOT NULL,
      description               text,
      -- Tenant-configurable classification (reference data asset_category).
      category                  text,
      -- Finite Core lifecycle: it drives behaviour, so it is NOT free
      -- configuration. Maintenance conditions (under repair, breakdown,
      -- maintenance due) are Advanced and deliberately not values here.
      status                    text NOT NULL DEFAULT 'in_use',
      -- Responsibility (AST-CORE-004) + Data Scope anchor.
      organization_unit_id      uuid REFERENCES organization_units(id) ON DELETE SET NULL,
      custodian_employee_id     uuid REFERENCES employees(id) ON DELETE SET NULL,
      -- Physical location (AST-CORE-003). No warehouse/bin/GIS topology.
      project_id                uuid REFERENCES projects(id) ON DELETE SET NULL,
      site_id                   uuid REFERENCES sites(id) ON DELETE SET NULL,
      location_detail           text,
      -- Acquisition (AST-CORE-002). Free text on purpose: no Supply Chain FK.
      acquisition_reference     text,
      acquired_at               date,
      -- Bumped by every applied movement; pairs with asset_movements.sequence.
      version                   integer NOT NULL DEFAULT 0,
      retired_at                timestamptz,
      created_at                timestamptz NOT NULL DEFAULT now(),
      created_by                uuid,
      updated_at                timestamptz NOT NULL DEFAULT now(),
      updated_by                uuid,
      CONSTRAINT assets_status_check
        CHECK (status IN ('in_use', 'idle', 'retired', 'disposed')),
      UNIQUE (tenant_id, asset_number)
    );

    -- A tag is optional, but when present it is a unique physical identifier.
    CREATE UNIQUE INDEX uq_assets_tenant_tag
      ON assets(tenant_id, asset_tag) WHERE asset_tag IS NOT NULL;

    -- Immutable history (AST-CORE-006). Rows are never edited: from_*/to_*
    -- are written once, at apply time, and applied_at/sequence only move
    -- from NULL to their final value.
    CREATE TABLE asset_movements (
      id                         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id                  uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      asset_id                   uuid NOT NULL REFERENCES assets(id) ON DELETE RESTRICT,
      -- Assigned at apply time; equals the asset version this movement made.
      sequence                   integer,
      movement_type              text NOT NULL,
      reason                     text,
      effective_date             date,
      -- What was asked for. Absent keys mean "keep whatever is current".
      requested_change           jsonb NOT NULL DEFAULT '{}'::jsonb,
      from_organization_unit_id  uuid REFERENCES organization_units(id) ON DELETE SET NULL,
      from_custodian_employee_id uuid REFERENCES employees(id) ON DELETE SET NULL,
      from_project_id            uuid REFERENCES projects(id) ON DELETE SET NULL,
      from_site_id               uuid REFERENCES sites(id) ON DELETE SET NULL,
      from_location_detail       text,
      from_status                text,
      to_organization_unit_id    uuid REFERENCES organization_units(id) ON DELETE SET NULL,
      to_custodian_employee_id   uuid REFERENCES employees(id) ON DELETE SET NULL,
      to_project_id              uuid REFERENCES projects(id) ON DELETE SET NULL,
      to_site_id                 uuid REFERENCES sites(id) ON DELETE SET NULL,
      to_location_detail         text,
      to_status                  text,
      -- The ONE link to the generic Workflow Engine (AST-CORE-007). NULL
      -- means this tenant does not require movement approval.
      workflow_instance_id       uuid REFERENCES workflow_instances(id) ON DELETE SET NULL,
      requested_by_user_id       uuid REFERENCES users(id) ON DELETE SET NULL,
      applied_at                 timestamptz,
      applied_by_user_id         uuid REFERENCES users(id) ON DELETE SET NULL,
      created_at                 timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT asset_movements_type_check
        CHECK (movement_type IN ('transfer', 'status_change'))
    );

    -- Two applied movements can never claim the same asset version. This is
    -- the database-level no-lost-update guarantee, not a convention.
    CREATE UNIQUE INDEX uq_asset_movements_sequence
      ON asset_movements(asset_id, sequence) WHERE sequence IS NOT NULL;

    CREATE INDEX idx_assets_tenant_status ON assets(tenant_id, status);
    CREATE INDEX idx_assets_tenant_unit ON assets(tenant_id, organization_unit_id);
    CREATE INDEX idx_assets_tenant_site ON assets(tenant_id, site_id);
    CREATE INDEX idx_assets_custodian ON assets(custodian_employee_id);
    CREATE INDEX idx_asset_movements_asset ON asset_movements(asset_id, sequence DESC);
    CREATE INDEX idx_asset_movements_tenant ON asset_movements(tenant_id, created_at DESC);
    CREATE INDEX idx_asset_movements_workflow ON asset_movements(workflow_instance_id);
  `);

  // --- Permissions (Product Core catalog, capability-based) -------------
  pgm.sql(`
    INSERT INTO permissions (code, description)
    SELECT v.code, v.description
      FROM (VALUES
        ('asset.read', 'View the asset register and movement history (subject to Data Scope)'),
        ('asset.manage', 'Create and maintain asset master records'),
        ('asset.move', 'Record asset movements, status changes, and retirement'),
        ('asset.documents.read', 'Access documents attached to an asset')
      ) AS v(code, description)
     WHERE NOT EXISTS (SELECT 1 FROM permissions p WHERE p.code = v.code)
  `);

  // --- Reference Data types (Product Core registers the TYPE only) -------
  pgm.sql(`
    INSERT INTO reference_data_types (code, name, description)
    SELECT v.code, v.name, v.description
      FROM (VALUES
        ('asset_category', 'Asset Category', 'Tenant-configurable asset category catalog'),
        ('asset_movement_reason', 'Asset Movement Reason', 'Tenant-configurable reason catalog for asset movements')
      ) AS v(code, name, description)
     WHERE NOT EXISTS (SELECT 1 FROM reference_data_types t WHERE t.code = v.code)
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    DELETE FROM reference_data_types WHERE code IN ('asset_category', 'asset_movement_reason');
    DELETE FROM permissions WHERE code IN (
      'asset.read', 'asset.manage', 'asset.move', 'asset.documents.read'
    );
    DROP TABLE IF EXISTS asset_movements;
    DROP TABLE IF EXISTS assets;
  `);
};
