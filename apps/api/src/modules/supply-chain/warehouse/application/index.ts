/**
 * Warehouse Management (WMS) — Application Layer Barrel.
 *
 * Aggregates the 12 decomposed WMS sub-service facades that together
 * form the Warehouse Management bounded context. Each facade delegates
 * to the existing `SupplyChainAdvancedService` during the Strangler Fig
 * migration (Fase 2); the route layer (Fase 4) will mount `/wms/*`
 * endpoints against these facades.
 */
export { WarehouseTopologyService } from "./warehouse-topology.service.js";
export { ItemTrackingService } from "./item-tracking.service.js";
export { StockLedgerService } from "./stock-ledger.service.js";
export { ReorderReservationService } from "./reorder-reservation.service.js";
export { TransferOpnameService } from "./transfer-opname.service.js";
export { ValuationService } from "./valuation.service.js";
export { ReceivingInspectionService } from "./receiving-inspection.service.js";
export { ReturnsReversalsService } from "./returns-reversals.service.js";
export { ConsignmentService } from "./consignment.service.js";
export { DisposalService } from "./disposal.service.js";
export { WarehouseTaskService } from "./warehouse-task.service.js";
export { AccountingEventService } from "./accounting-event.service.js";
