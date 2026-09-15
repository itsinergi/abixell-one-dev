/**
 * Wave A5.1 Stage 3 — SCM Decomposition Module Catalog.
 *
 * Registers two new module codes for the decomposed Supply Chain bounded
 * contexts (Warehouse Management and Procurement Management) so frontend
 * navigation gates and module activation can reference them independently.
 *
 * These modules split the legacy `supply_chain` module's responsibilities:
 *   - warehouse_management: physical inventory custody, valuation, receiving,
 *     transfers, opnames, disposals, consignment, tasks
 *   - procurement_management: strategic sourcing, RFQ bidding, contracts,
 *     supplier governance, service acceptance, spend analytics
 *
 * Shared master data (items, suppliers, purchase requests/orders) remains
 * under the `supply_chain` module.
 */
exports.up = (pgm) => {
  pgm.sql(`
    INSERT INTO modules (code, name, description) VALUES
      ('warehouse_management', 'Warehouse Management', 'Physical inventory custody, movements, valuation, receiving, transfers, and warehouse task execution'),
      ('procurement_management', 'Procurement Management', 'Strategic sourcing, RFQ bidding, supplier contracts, evaluations, service acceptance, and spend analytics')
    ON CONFLICT (code) DO UPDATE
      SET name = EXCLUDED.name,
          description = EXCLUDED.description;
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    DELETE FROM modules WHERE code IN ('warehouse_management', 'procurement_management');
  `);
};
