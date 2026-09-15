/**
 * Warehouse Management (WMS) — Infrastructure Barrel.
 *
 * Re-exports the WMS repository contract and its PostgreSQL adapter.
 * The repository delegates to the existing `PgSupplyChainAdvancedRepository`
 * during the Strangler Fig migration (Fase 2); Fase 6 will inline the
 * 36-table data-access logic and retire the monolith delegate.
 */
export type { WmsRepository } from "./wms.repository.pg.js";
export { PgWmsRepository } from "./wms.repository.pg.js";
