/**
 * Epic 3 Wave 3 — correction of API resource module attribution for the
 * `/supply-chain/advanced` alias namespace.
 *
 * The Epic 2 dictionary seed (1787300000000) snapshotted `app_api_resources`
 * while module attribution was a pure first-path-segment lookup. That rule is
 * right everywhere except one namespace: `/supply-chain/advanced/*` is a
 * backward-compatibility shim which mounts three modules' registrars under a
 * single first segment
 * (`supply-chain/advanced/api/supply-chain-advanced.routes.ts`:
 * `registerWmsRoutes(app, deps, "/supply-chain/advanced")`,
 * `registerProcurementRoutes(app, deps, "/supply-chain/advanced")`, plus the
 * legacy-only account-assignment-config routes). Every route beneath it was
 * therefore recorded as `supply_chain`, even where the handler belongs to
 * warehouse or procurement.
 *
 * Epic 3 Wave 3 (CORE-ROADMAP.md §4.3 step 9) makes that mistake load-bearing:
 * `requireModuleActive` enforces the module ceiling per route, so a stale
 * attribution lets a tenant that disabled `warehouse_management` still post
 * inventory movements through the alias URL, while the same handler is refused
 * at the canonical `/wms/*` path — and the reverse case, `supply_chain`
 * disabled alone, wrongly 403s routes the tenant should still reach.
 *
 * `API_PATH_MODULE_OVERRIDES` in
 * `src/domain/configuration/module-attribution.ts` states the correction;
 * `module-namespace-parity.test.ts` derives the same pairs from the live route
 * tree and fails if the table and the registrars ever disagree. This migration
 * carries the correction into the rows already written.
 *
 * Shape: the original catalogue function is renamed, and the canonical name is
 * redefined as that legacy function with the corrected rows joined over it.
 * The 617-row VALUES list is not restated — a correction table plus a join is
 * the whole change, and the original snapshot stays readable in place.
 * `config_seed_dictionary_for_tenant()` resolves the catalogue function by name
 * at execution time, so every tenant created from now on is seeded corrected
 * without touching the trigger.
 *
 * `app_processes` is untouched: permission attribution never used the path
 * rule. No permission is introduced, no `role_permissions` row is written, and
 * the only column that changes is `module_code`. Idempotent — the UPDATE is
 * guarded on change, and the rename is guarded on the legacy name not already
 * existing.
 */
exports.shorthands = undefined;

/** The corrected attributions: row code → module it belongs to. Generated from
 * `API_PATH_MODULE_OVERRIDES` against the live route tree. */
const CORRECTIONS = `
      ('api:GET /supply-chain/advanced/accounting-ready-events', 'warehouse_management'),
      ('api:GET /supply-chain/advanced/accounting-ready-events/:id', 'warehouse_management'),
      ('api:GET /supply-chain/advanced/balances', 'warehouse_management'),
      ('api:GET /supply-chain/advanced/batches', 'warehouse_management'),
      ('api:GET /supply-chain/advanced/batches/:id', 'warehouse_management'),
      ('api:GET /supply-chain/advanced/bids', 'procurement_management'),
      ('api:GET /supply-chain/advanced/bids/:id', 'procurement_management'),
      ('api:GET /supply-chain/advanced/consignment/balances', 'warehouse_management'),
      ('api:GET /supply-chain/advanced/consignment/settlements', 'warehouse_management'),
      ('api:GET /supply-chain/advanced/consignment/settlements/:id', 'warehouse_management'),
      ('api:GET /supply-chain/advanced/contracts', 'procurement_management'),
      ('api:GET /supply-chain/advanced/contracts/:id', 'procurement_management'),
      ('api:GET /supply-chain/advanced/discrepancies', 'warehouse_management'),
      ('api:GET /supply-chain/advanced/disposals', 'warehouse_management'),
      ('api:GET /supply-chain/advanced/disposals/:id', 'warehouse_management'),
      ('api:GET /supply-chain/advanced/evaluations', 'procurement_management'),
      ('api:GET /supply-chain/advanced/evaluations/:id', 'procurement_management'),
      ('api:GET /supply-chain/advanced/inspections/by-receiving-line/:receivingLineId', 'warehouse_management'),
      ('api:GET /supply-chain/advanced/inventory/aging', 'warehouse_management'),
      ('api:GET /supply-chain/advanced/landed-costs', 'warehouse_management'),
      ('api:GET /supply-chain/advanced/landed-costs/:id', 'warehouse_management'),
      ('api:GET /supply-chain/advanced/movements', 'warehouse_management'),
      ('api:GET /supply-chain/advanced/opnames', 'warehouse_management'),
      ('api:GET /supply-chain/advanced/opnames/:id', 'warehouse_management'),
      ('api:GET /supply-chain/advanced/receipt-reversals/by-receiving-record/:receivingRecordId', 'warehouse_management'),
      ('api:GET /supply-chain/advanced/receiving-records', 'warehouse_management'),
      ('api:GET /supply-chain/advanced/receiving-records/:id', 'warehouse_management'),
      ('api:GET /supply-chain/advanced/reorder-alerts', 'warehouse_management'),
      ('api:GET /supply-chain/advanced/reorder-policies', 'warehouse_management'),
      ('api:GET /supply-chain/advanced/replacements', 'warehouse_management'),
      ('api:GET /supply-chain/advanced/replacements/:id', 'warehouse_management'),
      ('api:GET /supply-chain/advanced/reservations', 'warehouse_management'),
      ('api:GET /supply-chain/advanced/returns-to-vendor', 'warehouse_management'),
      ('api:GET /supply-chain/advanced/returns-to-vendor/:id', 'warehouse_management'),
      ('api:GET /supply-chain/advanced/rfqs', 'procurement_management'),
      ('api:GET /supply-chain/advanced/rfqs/:id', 'procurement_management'),
      ('api:GET /supply-chain/advanced/serials', 'warehouse_management'),
      ('api:GET /supply-chain/advanced/serials/:id', 'warehouse_management'),
      ('api:GET /supply-chain/advanced/service-acceptances', 'procurement_management'),
      ('api:GET /supply-chain/advanced/service-acceptances/:id', 'procurement_management'),
      ('api:GET /supply-chain/advanced/spend-analytics', 'procurement_management'),
      ('api:GET /supply-chain/advanced/spend-analytics/:id', 'procurement_management'),
      ('api:GET /supply-chain/advanced/transfers', 'warehouse_management'),
      ('api:GET /supply-chain/advanced/transfers/:id', 'warehouse_management'),
      ('api:GET /supply-chain/advanced/valuation-layers', 'warehouse_management'),
      ('api:GET /supply-chain/advanced/warehouse-locations', 'warehouse_management'),
      ('api:GET /supply-chain/advanced/warehouse-locations/:id', 'warehouse_management'),
      ('api:GET /supply-chain/advanced/warehouse-tasks', 'warehouse_management'),
      ('api:GET /supply-chain/advanced/warehouse-tasks/:id', 'warehouse_management'),
      ('api:GET /supply-chain/advanced/warehouses', 'warehouse_management'),
      ('api:GET /supply-chain/advanced/warehouses/:id', 'warehouse_management'),
      ('api:PATCH /supply-chain/advanced/accounting-ready-events/:id/state', 'warehouse_management'),
      ('api:PATCH /supply-chain/advanced/bids/:id/score', 'procurement_management'),
      ('api:PATCH /supply-chain/advanced/discrepancies/:id/resolve', 'warehouse_management'),
      ('api:PATCH /supply-chain/advanced/serials/:id', 'warehouse_management'),
      ('api:PATCH /supply-chain/advanced/warehouse-locations/:id', 'warehouse_management'),
      ('api:PATCH /supply-chain/advanced/warehouse-tasks/:id/assign', 'warehouse_management'),
      ('api:PATCH /supply-chain/advanced/warehouses/:id', 'warehouse_management'),
      ('api:POST /supply-chain/advanced/accounting-ready-events', 'warehouse_management'),
      ('api:POST /supply-chain/advanced/batches', 'warehouse_management'),
      ('api:POST /supply-chain/advanced/bids', 'procurement_management'),
      ('api:POST /supply-chain/advanced/bids/award', 'procurement_management'),
      ('api:POST /supply-chain/advanced/consignment/consume', 'warehouse_management'),
      ('api:POST /supply-chain/advanced/consignment/settlements', 'warehouse_management'),
      ('api:POST /supply-chain/advanced/contracts', 'procurement_management'),
      ('api:POST /supply-chain/advanced/contracts/:id/act', 'procurement_management'),
      ('api:POST /supply-chain/advanced/contracts/:id/spend', 'procurement_management'),
      ('api:POST /supply-chain/advanced/discrepancies', 'warehouse_management'),
      ('api:POST /supply-chain/advanced/disposals', 'warehouse_management'),
      ('api:POST /supply-chain/advanced/disposals/:id/approve', 'warehouse_management'),
      ('api:POST /supply-chain/advanced/disposals/:id/submit', 'warehouse_management'),
      ('api:POST /supply-chain/advanced/evaluations', 'procurement_management'),
      ('api:POST /supply-chain/advanced/evaluations/:id/act', 'procurement_management'),
      ('api:POST /supply-chain/advanced/inspections', 'warehouse_management'),
      ('api:POST /supply-chain/advanced/landed-costs', 'warehouse_management'),
      ('api:POST /supply-chain/advanced/landed-costs/:id/apply', 'warehouse_management'),
      ('api:POST /supply-chain/advanced/movements', 'warehouse_management'),
      ('api:POST /supply-chain/advanced/opnames', 'warehouse_management'),
      ('api:POST /supply-chain/advanced/opnames/:id/act', 'warehouse_management'),
      ('api:POST /supply-chain/advanced/opnames/counts', 'warehouse_management'),
      ('api:POST /supply-chain/advanced/receipt-reversals', 'warehouse_management'),
      ('api:POST /supply-chain/advanced/receiving-records', 'warehouse_management'),
      ('api:POST /supply-chain/advanced/replacements', 'warehouse_management'),
      ('api:POST /supply-chain/advanced/reservations', 'warehouse_management'),
      ('api:POST /supply-chain/advanced/reservations/:id/cancel', 'warehouse_management'),
      ('api:POST /supply-chain/advanced/reservations/:id/fulfill', 'warehouse_management'),
      ('api:POST /supply-chain/advanced/returns-to-vendor', 'warehouse_management'),
      ('api:POST /supply-chain/advanced/rfqs', 'procurement_management'),
      ('api:POST /supply-chain/advanced/rfqs/:id/act', 'procurement_management'),
      ('api:POST /supply-chain/advanced/serials', 'warehouse_management'),
      ('api:POST /supply-chain/advanced/service-acceptances', 'procurement_management'),
      ('api:POST /supply-chain/advanced/service-acceptances/:id/approve', 'procurement_management'),
      ('api:POST /supply-chain/advanced/service-acceptances/:id/submit', 'procurement_management'),
      ('api:POST /supply-chain/advanced/spend-analytics/compute', 'procurement_management'),
      ('api:POST /supply-chain/advanced/transfers', 'warehouse_management'),
      ('api:POST /supply-chain/advanced/transfers/:id/act', 'warehouse_management'),
      ('api:POST /supply-chain/advanced/transfers/receipts', 'warehouse_management'),
      ('api:POST /supply-chain/advanced/transfers/shipments', 'warehouse_management'),
      ('api:POST /supply-chain/advanced/valuation-layers', 'warehouse_management'),
      ('api:POST /supply-chain/advanced/valuation-layers/consume', 'warehouse_management'),
      ('api:POST /supply-chain/advanced/warehouse-locations', 'warehouse_management'),
      ('api:POST /supply-chain/advanced/warehouse-tasks', 'warehouse_management'),
      ('api:POST /supply-chain/advanced/warehouse-tasks/:id/complete', 'warehouse_management'),
      ('api:POST /supply-chain/advanced/warehouses', 'warehouse_management'),
      ('api:PUT /supply-chain/advanced/reorder-policies', 'warehouse_management')
`;

/** The attribution each corrected row had before, so `down` restores the exact
 * prior state rather than assuming `supply_chain`. */
const PREVIOUS = `
      ('api:GET /supply-chain/advanced/accounting-ready-events', 'supply_chain'),
      ('api:GET /supply-chain/advanced/accounting-ready-events/:id', 'supply_chain'),
      ('api:GET /supply-chain/advanced/balances', 'supply_chain'),
      ('api:GET /supply-chain/advanced/batches', 'supply_chain'),
      ('api:GET /supply-chain/advanced/batches/:id', 'supply_chain'),
      ('api:GET /supply-chain/advanced/bids', 'supply_chain'),
      ('api:GET /supply-chain/advanced/bids/:id', 'supply_chain'),
      ('api:GET /supply-chain/advanced/consignment/balances', 'supply_chain'),
      ('api:GET /supply-chain/advanced/consignment/settlements', 'supply_chain'),
      ('api:GET /supply-chain/advanced/consignment/settlements/:id', 'supply_chain'),
      ('api:GET /supply-chain/advanced/contracts', 'supply_chain'),
      ('api:GET /supply-chain/advanced/contracts/:id', 'supply_chain'),
      ('api:GET /supply-chain/advanced/discrepancies', 'supply_chain'),
      ('api:GET /supply-chain/advanced/disposals', 'supply_chain'),
      ('api:GET /supply-chain/advanced/disposals/:id', 'supply_chain'),
      ('api:GET /supply-chain/advanced/evaluations', 'supply_chain'),
      ('api:GET /supply-chain/advanced/evaluations/:id', 'supply_chain'),
      ('api:GET /supply-chain/advanced/inspections/by-receiving-line/:receivingLineId', 'supply_chain'),
      ('api:GET /supply-chain/advanced/inventory/aging', 'supply_chain'),
      ('api:GET /supply-chain/advanced/landed-costs', 'supply_chain'),
      ('api:GET /supply-chain/advanced/landed-costs/:id', 'supply_chain'),
      ('api:GET /supply-chain/advanced/movements', 'supply_chain'),
      ('api:GET /supply-chain/advanced/opnames', 'supply_chain'),
      ('api:GET /supply-chain/advanced/opnames/:id', 'supply_chain'),
      ('api:GET /supply-chain/advanced/receipt-reversals/by-receiving-record/:receivingRecordId', 'supply_chain'),
      ('api:GET /supply-chain/advanced/receiving-records', 'supply_chain'),
      ('api:GET /supply-chain/advanced/receiving-records/:id', 'supply_chain'),
      ('api:GET /supply-chain/advanced/reorder-alerts', 'supply_chain'),
      ('api:GET /supply-chain/advanced/reorder-policies', 'supply_chain'),
      ('api:GET /supply-chain/advanced/replacements', 'supply_chain'),
      ('api:GET /supply-chain/advanced/replacements/:id', 'supply_chain'),
      ('api:GET /supply-chain/advanced/reservations', 'supply_chain'),
      ('api:GET /supply-chain/advanced/returns-to-vendor', 'supply_chain'),
      ('api:GET /supply-chain/advanced/returns-to-vendor/:id', 'supply_chain'),
      ('api:GET /supply-chain/advanced/rfqs', 'supply_chain'),
      ('api:GET /supply-chain/advanced/rfqs/:id', 'supply_chain'),
      ('api:GET /supply-chain/advanced/serials', 'supply_chain'),
      ('api:GET /supply-chain/advanced/serials/:id', 'supply_chain'),
      ('api:GET /supply-chain/advanced/service-acceptances', 'supply_chain'),
      ('api:GET /supply-chain/advanced/service-acceptances/:id', 'supply_chain'),
      ('api:GET /supply-chain/advanced/spend-analytics', 'supply_chain'),
      ('api:GET /supply-chain/advanced/spend-analytics/:id', 'supply_chain'),
      ('api:GET /supply-chain/advanced/transfers', 'supply_chain'),
      ('api:GET /supply-chain/advanced/transfers/:id', 'supply_chain'),
      ('api:GET /supply-chain/advanced/valuation-layers', 'supply_chain'),
      ('api:GET /supply-chain/advanced/warehouse-locations', 'supply_chain'),
      ('api:GET /supply-chain/advanced/warehouse-locations/:id', 'supply_chain'),
      ('api:GET /supply-chain/advanced/warehouse-tasks', 'supply_chain'),
      ('api:GET /supply-chain/advanced/warehouse-tasks/:id', 'supply_chain'),
      ('api:GET /supply-chain/advanced/warehouses', 'supply_chain'),
      ('api:GET /supply-chain/advanced/warehouses/:id', 'supply_chain'),
      ('api:PATCH /supply-chain/advanced/accounting-ready-events/:id/state', 'supply_chain'),
      ('api:PATCH /supply-chain/advanced/bids/:id/score', 'supply_chain'),
      ('api:PATCH /supply-chain/advanced/discrepancies/:id/resolve', 'supply_chain'),
      ('api:PATCH /supply-chain/advanced/serials/:id', 'supply_chain'),
      ('api:PATCH /supply-chain/advanced/warehouse-locations/:id', 'supply_chain'),
      ('api:PATCH /supply-chain/advanced/warehouse-tasks/:id/assign', 'supply_chain'),
      ('api:PATCH /supply-chain/advanced/warehouses/:id', 'supply_chain'),
      ('api:POST /supply-chain/advanced/accounting-ready-events', 'supply_chain'),
      ('api:POST /supply-chain/advanced/batches', 'supply_chain'),
      ('api:POST /supply-chain/advanced/bids', 'supply_chain'),
      ('api:POST /supply-chain/advanced/bids/award', 'supply_chain'),
      ('api:POST /supply-chain/advanced/consignment/consume', 'supply_chain'),
      ('api:POST /supply-chain/advanced/consignment/settlements', 'supply_chain'),
      ('api:POST /supply-chain/advanced/contracts', 'supply_chain'),
      ('api:POST /supply-chain/advanced/contracts/:id/act', 'supply_chain'),
      ('api:POST /supply-chain/advanced/contracts/:id/spend', 'supply_chain'),
      ('api:POST /supply-chain/advanced/discrepancies', 'supply_chain'),
      ('api:POST /supply-chain/advanced/disposals', 'supply_chain'),
      ('api:POST /supply-chain/advanced/disposals/:id/approve', 'supply_chain'),
      ('api:POST /supply-chain/advanced/disposals/:id/submit', 'supply_chain'),
      ('api:POST /supply-chain/advanced/evaluations', 'supply_chain'),
      ('api:POST /supply-chain/advanced/evaluations/:id/act', 'supply_chain'),
      ('api:POST /supply-chain/advanced/inspections', 'supply_chain'),
      ('api:POST /supply-chain/advanced/landed-costs', 'supply_chain'),
      ('api:POST /supply-chain/advanced/landed-costs/:id/apply', 'supply_chain'),
      ('api:POST /supply-chain/advanced/movements', 'supply_chain'),
      ('api:POST /supply-chain/advanced/opnames', 'supply_chain'),
      ('api:POST /supply-chain/advanced/opnames/:id/act', 'supply_chain'),
      ('api:POST /supply-chain/advanced/opnames/counts', 'supply_chain'),
      ('api:POST /supply-chain/advanced/receipt-reversals', 'supply_chain'),
      ('api:POST /supply-chain/advanced/receiving-records', 'supply_chain'),
      ('api:POST /supply-chain/advanced/replacements', 'supply_chain'),
      ('api:POST /supply-chain/advanced/reservations', 'supply_chain'),
      ('api:POST /supply-chain/advanced/reservations/:id/cancel', 'supply_chain'),
      ('api:POST /supply-chain/advanced/reservations/:id/fulfill', 'supply_chain'),
      ('api:POST /supply-chain/advanced/returns-to-vendor', 'supply_chain'),
      ('api:POST /supply-chain/advanced/rfqs', 'supply_chain'),
      ('api:POST /supply-chain/advanced/rfqs/:id/act', 'supply_chain'),
      ('api:POST /supply-chain/advanced/serials', 'supply_chain'),
      ('api:POST /supply-chain/advanced/service-acceptances', 'supply_chain'),
      ('api:POST /supply-chain/advanced/service-acceptances/:id/approve', 'supply_chain'),
      ('api:POST /supply-chain/advanced/service-acceptances/:id/submit', 'supply_chain'),
      ('api:POST /supply-chain/advanced/spend-analytics/compute', 'supply_chain'),
      ('api:POST /supply-chain/advanced/transfers', 'supply_chain'),
      ('api:POST /supply-chain/advanced/transfers/:id/act', 'supply_chain'),
      ('api:POST /supply-chain/advanced/transfers/receipts', 'supply_chain'),
      ('api:POST /supply-chain/advanced/transfers/shipments', 'supply_chain'),
      ('api:POST /supply-chain/advanced/valuation-layers', 'supply_chain'),
      ('api:POST /supply-chain/advanced/valuation-layers/consume', 'supply_chain'),
      ('api:POST /supply-chain/advanced/warehouse-locations', 'supply_chain'),
      ('api:POST /supply-chain/advanced/warehouse-tasks', 'supply_chain'),
      ('api:POST /supply-chain/advanced/warehouse-tasks/:id/complete', 'supply_chain'),
      ('api:POST /supply-chain/advanced/warehouses', 'supply_chain'),
      ('api:PUT /supply-chain/advanced/reorder-policies', 'supply_chain')
`;

exports.up = (pgm) => {
  pgm.sql(`
    -- 1. Keep the seed snapshot reachable under a legacy name --------------
    --    Guarded so a re-run (or a database that already ran this) is a no-op
    --    rather than an error.
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
         WHERE p.proname = 'config_dictionary_api_resource_seed_legacy'
           AND n.nspname = current_schema()
      ) THEN
        ALTER FUNCTION config_dictionary_api_resource_seed()
          RENAME TO config_dictionary_api_resource_seed_legacy;
      END IF;
    END
    $$;

    -- 2. Redefine the canonical catalogue as legacy + corrections ----------
    --    Same signature, so the tenant trigger picks it up unchanged.
    CREATE OR REPLACE FUNCTION config_dictionary_api_resource_seed()
    RETURNS TABLE (code TEXT, name TEXT, module_code TEXT, http_method TEXT, path_pattern TEXT) AS $seed$
      SELECT s.code,
             s.name,
             COALESCE(c.module_code, s.module_code),
             s.http_method,
             s.path_pattern
        FROM config_dictionary_api_resource_seed_legacy() s
        LEFT JOIN (VALUES
          ${CORRECTIONS}
        ) AS c(code, module_code) ON c.code = s.code;
    $seed$ LANGUAGE sql IMMUTABLE;

    -- 3. Correct the rows already written -----------------------------------
    UPDATE app_api_resources AS r
       SET module_code = c.module_code
      FROM (VALUES
        ${CORRECTIONS}
      ) AS c(code, module_code)
     WHERE r.code = c.code
       AND r.module_code IS DISTINCT FROM c.module_code;
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    -- Reverse the row correction first, so the catalogue function is the only
    -- thing left pointing at the corrected values when it is dropped.
    UPDATE app_api_resources AS r
       SET module_code = c.module_code
      FROM (VALUES
        ${PREVIOUS}
      ) AS c(code, module_code)
     WHERE r.code = c.code
       AND r.module_code IS DISTINCT FROM c.module_code;

    DROP FUNCTION IF EXISTS config_dictionary_api_resource_seed();

    ALTER FUNCTION config_dictionary_api_resource_seed_legacy()
      RENAME TO config_dictionary_api_resource_seed;
  `);
};
