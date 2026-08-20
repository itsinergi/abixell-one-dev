/**
 * Phase 4 — Supply Chain Core schema (SCM-CORE-001…013).
 *
 * Core answers: what item exists, how much of it, what moved in and out,
 * what was requested, what was ordered, and from which supplier. Everything
 * about warehouse topology, batch/lot/serial, reservation, opname, and
 * valuation is Advanced and deliberately absent.
 *
 * Deliberate design decisions:
 *
 * - **Operational quantity, not accounting inventory.** No valuation, cost
 *   layer, FIFO/moving-average, or GL posting exists here. Purchase order
 *   unit price is procurement transaction data only.
 *
 * - **Movements are the ledger; balances are the fast read.** Every stock
 *   change writes an immutable stock_movements row AND updates
 *   stock_balances inside ONE transaction. A correction is a new
 *   compensating movement, never an edit (SCM-CORE-006).
 *
 * - **Stock location reuses Site.** There is no warehouse/zone/bin topology.
 *   A null site_id means tenant-level stock, so the two partial unique
 *   indexes below avoid the NULL-is-never-equal trap (same lesson as
 *   ADR-0006).
 *
 * - **Receipt is a movement, not a separate document.** Receiving against a
 *   purchase order line writes a goods-in movement referencing that line and
 *   advances quantity_received — no receipts table is needed (SCM-CORE-010).
 *
 * - **Purchase Request lifecycle is the Workflow Engine's** via
 *   workflow_instance_id (SCM-CORE-008); there is no status column. A
 *   Purchase Order has no competing state machine either: issued_at null
 *   means draft, set means issued and line-immutable.
 *
 * - **Supplier is not merged with Customer.** They are distinct business
 *   domains despite both being organisations.
 *
 * gen_random_uuid() comes from pgcrypto (migration 0001).
 */
exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE items (
      id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id        uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      code             text NOT NULL,
      name             text NOT NULL,
      description      text,
      category         text,
      unit_of_measure  text NOT NULL,
      is_active        boolean NOT NULL DEFAULT true,
      created_at       timestamptz NOT NULL DEFAULT now(),
      created_by       uuid,
      updated_at       timestamptz NOT NULL DEFAULT now(),
      updated_by       uuid,
      UNIQUE (tenant_id, code)
    );

    CREATE TABLE suppliers (
      id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id     uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      code          text NOT NULL,
      name          text NOT NULL,
      category      text,
      contact_name  text,
      email         text,
      phone         text,
      address       text,
      is_active     boolean NOT NULL DEFAULT true,
      created_at    timestamptz NOT NULL DEFAULT now(),
      created_by    uuid,
      updated_at    timestamptz NOT NULL DEFAULT now(),
      updated_by    uuid,
      UNIQUE (tenant_id, code)
    );

    -- Current quantity per item and stock location. Site is the location;
    -- there is no warehouse topology in Core.
    CREATE TABLE stock_balances (
      id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id   uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      item_id     uuid NOT NULL REFERENCES items(id) ON DELETE RESTRICT,
      site_id     uuid REFERENCES sites(id) ON DELETE RESTRICT,
      quantity    numeric(18,4) NOT NULL DEFAULT 0,
      updated_at  timestamptz NOT NULL DEFAULT now()
    );

    -- Two partial indexes because NULL never equals NULL in a plain UNIQUE.
    CREATE UNIQUE INDEX uq_stock_balances_item_site
      ON stock_balances(tenant_id, item_id, site_id) WHERE site_id IS NOT NULL;
    CREATE UNIQUE INDEX uq_stock_balances_item_tenant_level
      ON stock_balances(tenant_id, item_id) WHERE site_id IS NULL;

    -- Immutable ledger. Quantity is always POSITIVE; direction is the type.
    CREATE TABLE stock_movements (
      id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id                uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      item_id                  uuid NOT NULL REFERENCES items(id) ON DELETE RESTRICT,
      site_id                  uuid REFERENCES sites(id) ON DELETE RESTRICT,
      movement_type            text NOT NULL,
      quantity                 numeric(18,4) NOT NULL,
      reference                text,
      note                     text,
      purchase_order_id        uuid,
      purchase_order_line_id   uuid,
      occurred_at              timestamptz NOT NULL DEFAULT now(),
      created_by               uuid,
      created_at               timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT stock_movements_type_check CHECK (movement_type IN ('in', 'out')),
      CONSTRAINT stock_movements_qty_check CHECK (quantity > 0)
    );

    CREATE TABLE purchase_requests (
      id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id                   uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      request_number              text NOT NULL,
      organization_unit_id        uuid REFERENCES organization_units(id) ON DELETE SET NULL,
      project_id                  uuid REFERENCES projects(id) ON DELETE SET NULL,
      site_id                     uuid REFERENCES sites(id) ON DELETE SET NULL,
      justification               text NOT NULL,
      required_date               date,
      requested_by_user_id        uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
      -- The ONE link to the generic Workflow Engine (SCM-CORE-008).
      workflow_instance_id        uuid REFERENCES workflow_instances(id) ON DELETE SET NULL,
      converted_purchase_order_id uuid,
      converted_at                timestamptz,
      created_at                  timestamptz NOT NULL DEFAULT now(),
      created_by                  uuid,
      updated_at                  timestamptz NOT NULL DEFAULT now(),
      updated_by                  uuid,
      deleted_at                  timestamptz,
      UNIQUE (tenant_id, request_number)
    );

    CREATE TABLE purchase_request_lines (
      id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      purchase_request_id  uuid NOT NULL REFERENCES purchase_requests(id) ON DELETE CASCADE,
      item_id              uuid NOT NULL REFERENCES items(id) ON DELETE RESTRICT,
      quantity             numeric(18,4) NOT NULL,
      note                 text,
      sort_order           integer NOT NULL DEFAULT 0,
      CONSTRAINT purchase_request_lines_qty_check CHECK (quantity > 0)
    );

    CREATE TABLE purchase_orders (
      id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id            uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      order_number         text NOT NULL,
      supplier_id          uuid NOT NULL REFERENCES suppliers(id) ON DELETE RESTRICT,
      purchase_request_id  uuid REFERENCES purchase_requests(id) ON DELETE SET NULL,
      site_id              uuid REFERENCES sites(id) ON DELETE SET NULL,
      currency             text,
      order_date           date,
      expected_date        date,
      -- Derived state, NOT a lifecycle: null = draft, set = issued and
      -- line-immutable. No competing state machine.
      issued_at            timestamptz,
      issued_by_user_id    uuid REFERENCES users(id) ON DELETE SET NULL,
      cancelled_at         timestamptz,
      cancellation_reason  text,
      created_at           timestamptz NOT NULL DEFAULT now(),
      created_by           uuid,
      updated_at           timestamptz NOT NULL DEFAULT now(),
      updated_by           uuid,
      deleted_at           timestamptz,
      UNIQUE (tenant_id, order_number)
    );

    CREATE TABLE purchase_order_lines (
      id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      purchase_order_id   uuid NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
      item_id             uuid NOT NULL REFERENCES items(id) ON DELETE RESTRICT,
      quantity_ordered    numeric(18,4) NOT NULL,
      quantity_received   numeric(18,4) NOT NULL DEFAULT 0,
      unit_price          numeric(18,4),
      sort_order          integer NOT NULL DEFAULT 0,
      CONSTRAINT purchase_order_lines_qty_check CHECK (quantity_ordered > 0),
      CONSTRAINT purchase_order_lines_received_check CHECK (quantity_received >= 0)
    );

    ALTER TABLE purchase_requests
      ADD CONSTRAINT purchase_requests_converted_po_fk
      FOREIGN KEY (converted_purchase_order_id) REFERENCES purchase_orders(id) ON DELETE SET NULL;
    ALTER TABLE stock_movements
      ADD CONSTRAINT stock_movements_po_fk
      FOREIGN KEY (purchase_order_id) REFERENCES purchase_orders(id) ON DELETE SET NULL;
    ALTER TABLE stock_movements
      ADD CONSTRAINT stock_movements_po_line_fk
      FOREIGN KEY (purchase_order_line_id) REFERENCES purchase_order_lines(id) ON DELETE SET NULL;

    CREATE INDEX idx_items_tenant_active ON items(tenant_id, is_active);
    CREATE INDEX idx_suppliers_tenant_active ON suppliers(tenant_id, is_active);
    CREATE INDEX idx_stock_balances_tenant_item ON stock_balances(tenant_id, item_id);
    CREATE INDEX idx_stock_movements_tenant_item ON stock_movements(tenant_id, item_id, occurred_at DESC);
    CREATE INDEX idx_stock_movements_po_line ON stock_movements(purchase_order_line_id);
    CREATE INDEX idx_purchase_requests_tenant ON purchase_requests(tenant_id);
    CREATE INDEX idx_purchase_requests_workflow ON purchase_requests(workflow_instance_id);
    CREATE INDEX idx_purchase_request_lines_request ON purchase_request_lines(purchase_request_id);
    CREATE INDEX idx_purchase_orders_tenant ON purchase_orders(tenant_id);
    CREATE INDEX idx_purchase_orders_supplier ON purchase_orders(supplier_id);
    CREATE INDEX idx_purchase_order_lines_order ON purchase_order_lines(purchase_order_id);
  `);

  // --- Permissions (Product Core catalog, capability-based) -------------
  pgm.sql(`
    INSERT INTO permissions (code, description)
    SELECT v.code, v.description
      FROM (VALUES
        ('supply_chain.read', 'View items, suppliers, stock, purchase requests and orders (subject to Data Scope)'),
        ('supply_chain.configure', 'Maintain the item and supplier master'),
        ('supply_chain.manage', 'Create purchase requests and purchase orders, and issue orders'),
        ('supply_chain.stock.manage', 'Record goods received and goods issued')
      ) AS v(code, description)
     WHERE NOT EXISTS (SELECT 1 FROM permissions p WHERE p.code = v.code)
  `);

  // --- Reference Data types (Product Core registers the TYPE only) -------
  pgm.sql(`
    INSERT INTO reference_data_types (code, name, description)
    SELECT v.code, v.name, v.description
      FROM (VALUES
        ('item_category', 'Item Category', 'Tenant-configurable item category catalog'),
        ('unit_of_measure', 'Unit of Measure', 'Tenant-configurable unit catalog (no conversion engine in Core)'),
        ('supplier_category', 'Supplier Category', 'Tenant-configurable supplier classification')
      ) AS v(code, name, description)
     WHERE NOT EXISTS (SELECT 1 FROM reference_data_types t WHERE t.code = v.code)
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    DELETE FROM reference_data_types WHERE code IN ('item_category', 'unit_of_measure', 'supplier_category');
    DELETE FROM permissions WHERE code IN (
      'supply_chain.read', 'supply_chain.configure', 'supply_chain.manage', 'supply_chain.stock.manage'
    );
    ALTER TABLE purchase_requests DROP CONSTRAINT IF EXISTS purchase_requests_converted_po_fk;
    ALTER TABLE stock_movements DROP CONSTRAINT IF EXISTS stock_movements_po_fk;
    ALTER TABLE stock_movements DROP CONSTRAINT IF EXISTS stock_movements_po_line_fk;
    DROP TABLE IF EXISTS purchase_order_lines;
    DROP TABLE IF EXISTS purchase_orders;
    DROP TABLE IF EXISTS purchase_request_lines;
    DROP TABLE IF EXISTS purchase_requests;
    DROP TABLE IF EXISTS stock_movements;
    DROP TABLE IF EXISTS stock_balances;
    DROP TABLE IF EXISTS suppliers;
    DROP TABLE IF EXISTS items;
  `);
};
