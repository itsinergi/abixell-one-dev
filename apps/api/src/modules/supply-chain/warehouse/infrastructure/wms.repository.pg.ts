import type { Pool } from "pg";
import type {
  ApplyScmLandedCostInput,
  ConsumeScmValuationLayerInput,
  CreateScmAccountingReadyEventInput,
  CreateScmConsignmentSettlementInput,
  CreateScmDiscrepancyRecordInput,
  CreateScmInspectionInput,
  CreateScmInventoryDisposalInput,
  CreateScmItemBatchInput,
  CreateScmItemSerialInput,
  CreateScmLandedCostInput,
  CreateScmReceiptReversalInput,
  CreateScmReceivingRecordInput,
  CreateScmReplacementDeliveryInput,
  CreateScmReturnToVendorInput,
  CreateScmStockOpnameInput,
  CreateScmStockReservationInput,
  CreateScmStockTransferInput,
  CreateScmValuationLayerAllocationInput,
  CreateScmValuationLayerInput,
  CreateScmWarehouseInput,
  CreateScmWarehouseLocationInput,
  CreateScmWarehouseTaskInput,
  RecordScmAdvancedStockMovementInput,
  RecordScmStockOpnameCountInput,
  RecordScmStockTransferReceiptInput,
  RecordScmStockTransferShipmentInput,
  ResolveScmDiscrepancyRecordInput,
  ScmAccountingReadyEvent,
  ScmAccountingReadyEventFilter,
  ScmAccountingReadyEventStateTransition,
  ScmAdvancedStockBalance,
  ScmAdvancedStockBalanceFilter,
  ScmAdvancedStockMovement,
  ScmAdvancedStockMovementFilter,
  ScmConsignmentSettlement,
  ScmConsignmentSettlementFilter,
  ScmConsignmentSettlementLine,
  ScmDiscrepancyRecord,
  ScmDiscrepancyRecordFilter,
  ScmInspection,
  ScmInventoryAgingBucket,
  ScmInventoryAgingFilter,
  ScmInventoryDisposal,
  ScmInventoryDisposalFilter,
  ScmInventoryDisposalLine,
  ScmItemBatch,
  ScmItemBatchListFilter,
  ScmItemSerial,
  ScmItemSerialListFilter,
  ScmLandedCost,
  ScmLandedCostAllocation,
  ScmLandedCostFilter,
  ScmReceiptReversal,
  ScmReceiptReversalLine,
  ScmReceivingLine,
  ScmReceivingRecord,
  ScmReceivingRecordFilter,
  ScmReorderPolicy,
  ScmReorderPolicyFilter,
  ScmReplacementDelivery,
  ScmReplacementDeliveryFilter,
  ScmReplacementDeliveryLine,
  ScmReturnToVendor,
  ScmReturnToVendorFilter,
  ScmReturnToVendorLine,
  ScmStockOpname,
  ScmStockOpnameFilter,
  ScmStockOpnameLine,
  ScmStockReservation,
  ScmStockReservationFilter,
  ScmStockTransfer,
  ScmStockTransferFilter,
  ScmStockTransferLine,
  ScmValuationLayer,
  ScmValuationLayerAllocation,
  ScmValuationLayerAllocationFilter,
  ScmValuationLayerFilter,
  ScmWarehouse,
  ScmWarehouseListFilter,
  ScmWarehouseLocation,
  ScmWarehouseLocationListFilter,
  ScmWarehouseTask,
  ScmWarehouseTaskFilter,
  ScmWarehouseTaskItem,
  UpdateScmAccountingReadyEventStateInput,
  UpdateScmInventoryDisposalStatusInput,
  UpdateScmItemSerialInput,
  UpdateScmReceivingLineInspectionProjectionInput,
  UpdateScmReceivingRecordStatusInput,
  UpdateScmStockOpnameProjectionInput,
  UpdateScmStockTransferProjectionInput,
  UpdateScmWarehouseInput,
  UpdateScmWarehouseLocationInput,
  UpdateScmWarehouseTaskItemInput,
  UpdateScmWarehouseTaskStatusInput,
  UpsertScmReorderPolicyInput,
} from "../../advanced/domain/supply-chain-advanced.entity.js";
import { PgSupplyChainAdvancedRepository } from "../../advanced/infrastructure/supply-chain-advanced.repository.pg.js";
import type { IUnitOfWork } from "../../ports/unit-of-work.js";
import { PgUnitOfWork } from "../../ports/unit-of-work.js";

/**
 * WMS Repository interface specifying all database access for the
 * Warehouse Management (WMS) bounded context (36 physical tables).
 */
export interface WmsRepository {
  // 1. Topology (Warehouses & Locations)
  createWarehouse(tenantId: string, input: CreateScmWarehouseInput): Promise<ScmWarehouse>;
  updateWarehouse(tenantId: string, warehouseId: string, input: UpdateScmWarehouseInput): Promise<ScmWarehouse | null>;
  findWarehouseById(tenantId: string, warehouseId: string): Promise<ScmWarehouse | null>;
  findWarehouseByCode(tenantId: string, code: string): Promise<ScmWarehouse | null>;
  listWarehouses(tenantId: string, filter?: ScmWarehouseListFilter): Promise<ScmWarehouse[]>;
  createWarehouseLocation(tenantId: string, input: CreateScmWarehouseLocationInput): Promise<ScmWarehouseLocation>;
  updateWarehouseLocation(tenantId: string, locationId: string, input: UpdateScmWarehouseLocationInput): Promise<ScmWarehouseLocation | null>;
  findWarehouseLocationById(tenantId: string, locationId: string): Promise<ScmWarehouseLocation | null>;
  listWarehouseLocations(tenantId: string, filter: ScmWarehouseLocationListFilter): Promise<ScmWarehouseLocation[]>;

  // 2. Tracking (Batches & Serials)
  createItemBatch(tenantId: string, input: CreateScmItemBatchInput): Promise<ScmItemBatch>;
  findItemBatchById(tenantId: string, batchId: string): Promise<ScmItemBatch | null>;
  listItemBatches(tenantId: string, filter?: ScmItemBatchListFilter): Promise<ScmItemBatch[]>;
  createItemSerial(tenantId: string, input: CreateScmItemSerialInput): Promise<ScmItemSerial>;
  updateItemSerial(tenantId: string, serialId: string, input: UpdateScmItemSerialInput): Promise<ScmItemSerial | null>;
  findItemSerialById(tenantId: string, serialId: string): Promise<ScmItemSerial | null>;
  listItemSerials(tenantId: string, filter?: ScmItemSerialListFilter): Promise<ScmItemSerial[]>;

  // 3. Stock Ledger & Balances
  findAdvancedStockBalance(tenantId: string, itemId: string, warehouseId: string, locationId?: string, batchId?: string): Promise<ScmAdvancedStockBalance | null>;
  listAdvancedStockBalances(tenantId: string, filter?: ScmAdvancedStockBalanceFilter): Promise<ScmAdvancedStockBalance[]>;
  recordAdvancedStockMovement(tenantId: string, input: RecordScmAdvancedStockMovementInput): Promise<{ movement: ScmAdvancedStockMovement; balance: ScmAdvancedStockBalance }>;
  listAdvancedStockMovements(tenantId: string, filter?: ScmAdvancedStockMovementFilter): Promise<ScmAdvancedStockMovement[]>;

  // 4. Reorder Policies & Reservations
  upsertReorderPolicy(tenantId: string, input: UpsertScmReorderPolicyInput): Promise<ScmReorderPolicy>;
  listReorderPolicies(tenantId: string, filter?: ScmReorderPolicyFilter): Promise<ScmReorderPolicy[]>;
  createStockReservation(tenantId: string, input: CreateScmStockReservationInput): Promise<ScmStockReservation>;
  findStockReservationById(tenantId: string, reservationId: string): Promise<ScmStockReservation | null>;
  listStockReservations(tenantId: string, filter?: ScmStockReservationFilter): Promise<ScmStockReservation[]>;

  // 5. Transfers & Opnames
  createStockTransfer(tenantId: string, input: CreateScmStockTransferInput): Promise<{ transfer: ScmStockTransfer; lines: ScmStockTransferLine[] }>;
  updateStockTransferProjection(tenantId: string, input: UpdateScmStockTransferProjectionInput): Promise<ScmStockTransfer | null>;
  deleteStockTransferWithoutWorkflow(tenantId: string, transferId: string): Promise<void>;
  recordStockTransferShipment(tenantId: string, input: RecordScmStockTransferShipmentInput): Promise<ScmStockTransferLine[]>;
  recordStockTransferReceipt(tenantId: string, input: RecordScmStockTransferReceiptInput): Promise<ScmStockTransferLine[]>;
  findStockTransferById(tenantId: string, transferId: string): Promise<{ transfer: ScmStockTransfer; lines: ScmStockTransferLine[] } | null>;
  listStockTransfers(tenantId: string, filter?: ScmStockTransferFilter): Promise<ScmStockTransfer[]>;
  createStockOpname(tenantId: string, input: CreateScmStockOpnameInput): Promise<{ opname: ScmStockOpname; lines: ScmStockOpnameLine[] }>;
  updateStockOpnameProjection(tenantId: string, input: UpdateScmStockOpnameProjectionInput): Promise<ScmStockOpname | null>;
  deleteStockOpnameWithoutWorkflow(tenantId: string, opnameId: string): Promise<void>;
  recordStockOpnameCount(tenantId: string, input: RecordScmStockOpnameCountInput): Promise<ScmStockOpnameLine | null>;
  findStockOpnameById(tenantId: string, opnameId: string): Promise<{ opname: ScmStockOpname; lines: ScmStockOpnameLine[] } | null>;
  listStockOpnames(tenantId: string, filter?: ScmStockOpnameFilter): Promise<ScmStockOpname[]>;

  // 6. Valuation Layers & Landed Costs
  createValuationLayer(tenantId: string, input: CreateScmValuationLayerInput): Promise<ScmValuationLayer>;
  updateValuationLayerRemainingQuantity(tenantId: string, input: ConsumeScmValuationLayerInput): Promise<ScmValuationLayer | null>;
  findValuationLayerById(tenantId: string, layerId: string): Promise<ScmValuationLayer | null>;
  listValuationLayers(tenantId: string, filter?: ScmValuationLayerFilter): Promise<ScmValuationLayer[]>;
  createLandedCost(tenantId: string, input: CreateScmLandedCostInput): Promise<{ landedCost: ScmLandedCost; allocations: ScmLandedCostAllocation[] }>;
  applyLandedCost(tenantId: string, input: ApplyScmLandedCostInput): Promise<ScmLandedCost | null>;
  findLandedCostById(tenantId: string, landedCostId: string): Promise<{ landedCost: ScmLandedCost; allocations: ScmLandedCostAllocation[] } | null>;
  listLandedCosts(tenantId: string, filter?: ScmLandedCostFilter): Promise<ScmLandedCost[]>;
  createValuationLayerAllocation(tenantId: string, input: CreateScmValuationLayerAllocationInput): Promise<ScmValuationLayerAllocation>;
  listValuationLayerAllocations(tenantId: string, filter?: ScmValuationLayerAllocationFilter): Promise<ScmValuationLayerAllocation[]>;

  // 7. Receiving & QA Inspections
  createReceivingRecord(tenantId: string, input: CreateScmReceivingRecordInput): Promise<{ receiving: ScmReceivingRecord; lines: ScmReceivingLine[] }>;
  updateReceivingRecordStatus(tenantId: string, input: UpdateScmReceivingRecordStatusInput): Promise<ScmReceivingRecord | null>;
  updateReceivingLineInspectionProjection(tenantId: string, input: UpdateScmReceivingLineInspectionProjectionInput): Promise<ScmReceivingLine | null>;
  findReceivingRecordById(tenantId: string, receivingRecordId: string): Promise<{ receiving: ScmReceivingRecord; lines: ScmReceivingLine[] } | null>;
  findReceivingRecordByIdempotencyKey(tenantId: string, idempotencyKey: string): Promise<{ receiving: ScmReceivingRecord; lines: ScmReceivingLine[] } | null>;
  listReceivingRecords(tenantId: string, filter?: ScmReceivingRecordFilter): Promise<ScmReceivingRecord[]>;
  createInspection(tenantId: string, input: CreateScmInspectionInput): Promise<ScmInspection>;
  findInspectionByReceivingLineId(tenantId: string, receivingLineId: string): Promise<ScmInspection | null>;
  findInspectionByIdempotencyKey(tenantId: string, idempotencyKey: string): Promise<ScmInspection | null>;
  createDiscrepancyRecord(tenantId: string, input: CreateScmDiscrepancyRecordInput): Promise<ScmDiscrepancyRecord>;
  resolveDiscrepancyRecord(tenantId: string, input: ResolveScmDiscrepancyRecordInput): Promise<ScmDiscrepancyRecord | null>;
  listDiscrepancyRecords(tenantId: string, filter?: ScmDiscrepancyRecordFilter): Promise<ScmDiscrepancyRecord[]>;

  // 8. Returns, Reversals, Replacements
  createReturnToVendor(tenantId: string, input: CreateScmReturnToVendorInput): Promise<{ returnToVendor: ScmReturnToVendor; lines: ScmReturnToVendorLine[] }>;
  findReturnToVendorById(tenantId: string, returnId: string): Promise<{ returnToVendor: ScmReturnToVendor; lines: ScmReturnToVendorLine[] } | null>;
  findReturnToVendorByIdempotencyKey(tenantId: string, idempotencyKey: string): Promise<{ returnToVendor: ScmReturnToVendor; lines: ScmReturnToVendorLine[] } | null>;
  listReturnToVendors(tenantId: string, filter?: ScmReturnToVendorFilter): Promise<ScmReturnToVendor[]>;
  createReceiptReversal(tenantId: string, input: CreateScmReceiptReversalInput): Promise<{ reversal: ScmReceiptReversal; lines: ScmReceiptReversalLine[] }>;
  findReceiptReversalByReceivingRecordId(tenantId: string, receivingRecordId: string): Promise<{ reversal: ScmReceiptReversal; lines: ScmReceiptReversalLine[] } | null>;
  findReceiptReversalByIdempotencyKey(tenantId: string, idempotencyKey: string): Promise<{ reversal: ScmReceiptReversal; lines: ScmReceiptReversalLine[] } | null>;
  createReplacementDelivery(tenantId: string, input: CreateScmReplacementDeliveryInput): Promise<{ replacement: ScmReplacementDelivery; lines: ScmReplacementDeliveryLine[] }>;
  findReplacementDeliveryById(tenantId: string, replacementId: string): Promise<{ replacement: ScmReplacementDelivery; lines: ScmReplacementDeliveryLine[] } | null>;
  findReplacementDeliveryByIdempotencyKey(tenantId: string, idempotencyKey: string): Promise<{ replacement: ScmReplacementDelivery; lines: ScmReplacementDeliveryLine[] } | null>;
  listReplacementDeliveries(tenantId: string, filter?: ScmReplacementDeliveryFilter): Promise<ScmReplacementDelivery[]>;

  // 9. Consignment Settlements
  createConsignmentSettlement(tenantId: string, input: CreateScmConsignmentSettlementInput): Promise<{ settlement: ScmConsignmentSettlement; lines: ScmConsignmentSettlementLine[] }>;
  findConsignmentSettlementById(tenantId: string, settlementId: string): Promise<{ settlement: ScmConsignmentSettlement; lines: ScmConsignmentSettlementLine[] } | null>;
  findConsignmentSettlementByIdempotencyKey(tenantId: string, idempotencyKey: string): Promise<{ settlement: ScmConsignmentSettlement; lines: ScmConsignmentSettlementLine[] } | null>;
  listConsignmentSettlements(tenantId: string, filter?: ScmConsignmentSettlementFilter): Promise<ScmConsignmentSettlement[]>;

  // 10. Disposals & Aging
  createInventoryDisposal(tenantId: string, input: CreateScmInventoryDisposalInput): Promise<{ disposal: ScmInventoryDisposal; lines: ScmInventoryDisposalLine[] }>;
  deleteInventoryDisposalWithoutWorkflow(tenantId: string, disposalId: string): Promise<void>;
  updateInventoryDisposalStatus(tenantId: string, input: UpdateScmInventoryDisposalStatusInput): Promise<ScmInventoryDisposal | null>;
  updateInventoryDisposalLineExecution(tenantId: string, lineId: string, movementId: string, valuationLayerAllocationId: string | null, accountingReadyEventId: string | null, unitCost: number | null, amount: number | null): Promise<ScmInventoryDisposalLine | null>;
  findInventoryDisposalById(tenantId: string, disposalId: string): Promise<{ disposal: ScmInventoryDisposal; lines: ScmInventoryDisposalLine[] } | null>;
  findInventoryDisposalByIdempotencyKey(tenantId: string, idempotencyKey: string): Promise<{ disposal: ScmInventoryDisposal; lines: ScmInventoryDisposalLine[] } | null>;
  listInventoryDisposals(tenantId: string, filter?: ScmInventoryDisposalFilter): Promise<ScmInventoryDisposal[]>;
  getInventoryAgingBuckets(tenantId: string, filter?: ScmInventoryAgingFilter): Promise<ScmInventoryAgingBucket[]>;

  // 11. Warehouse Execution Tasks
  createWarehouseTask(tenantId: string, input: CreateScmWarehouseTaskInput): Promise<{ task: ScmWarehouseTask; items: ScmWarehouseTaskItem[] }>;
  updateWarehouseTaskStatus(tenantId: string, input: UpdateScmWarehouseTaskStatusInput): Promise<ScmWarehouseTask | null>;
  updateWarehouseTaskItem(tenantId: string, input: UpdateScmWarehouseTaskItemInput): Promise<ScmWarehouseTaskItem | null>;
  findWarehouseTaskById(tenantId: string, taskId: string): Promise<{ task: ScmWarehouseTask; items: ScmWarehouseTaskItem[] } | null>;
  findWarehouseTaskByIdempotencyKey(tenantId: string, idempotencyKey: string): Promise<{ task: ScmWarehouseTask; items: ScmWarehouseTaskItem[] } | null>;
  listWarehouseTasks(tenantId: string, filter?: ScmWarehouseTaskFilter): Promise<ScmWarehouseTask[]>;

  // 12. Accounting-Ready Outbox Events
  createAccountingReadyEvent(tenantId: string, input: CreateScmAccountingReadyEventInput): Promise<ScmAccountingReadyEvent>;
  updateAccountingReadyEventState(tenantId: string, input: UpdateScmAccountingReadyEventStateInput): Promise<{ event: ScmAccountingReadyEvent; transition: ScmAccountingReadyEventStateTransition } | null>;
  findAccountingReadyEventById(tenantId: string, eventId: string): Promise<ScmAccountingReadyEvent | null>;
  findAccountingReadyEventByIdempotencyKey(tenantId: string, idempotencyKey: string): Promise<ScmAccountingReadyEvent | null>;
  listAccountingReadyEvents(tenantId: string, filter?: ScmAccountingReadyEventFilter): Promise<ScmAccountingReadyEvent[]>;

  // Helper: Organization unit hierarchy
  listOrganizationUnitDescendantIds(tenantId: string, rootIds: string[]): Promise<string[]>;
}

export class PgWmsRepository implements WmsRepository {
  private readonly delegate: PgSupplyChainAdvancedRepository;
  readonly unitOfWork: IUnitOfWork;

  constructor(pool: Pool) {
    this.delegate = new PgSupplyChainAdvancedRepository(pool);
    this.unitOfWork = new PgUnitOfWork(pool);
  }

  createWarehouse(tenantId: string, input: CreateScmWarehouseInput) {
    return this.delegate.createWarehouse(tenantId, input);
  }
  updateWarehouse(tenantId: string, warehouseId: string, input: UpdateScmWarehouseInput) {
    return this.delegate.updateWarehouse(tenantId, warehouseId, input);
  }
  findWarehouseById(tenantId: string, warehouseId: string) {
    return this.delegate.findWarehouseById(tenantId, warehouseId);
  }
  findWarehouseByCode(tenantId: string, code: string) {
    return this.delegate.findWarehouseByCode(tenantId, code);
  }
  listWarehouses(tenantId: string, filter?: ScmWarehouseListFilter) {
    return this.delegate.listWarehouses(tenantId, filter);
  }
  createWarehouseLocation(tenantId: string, input: CreateScmWarehouseLocationInput) {
    return this.delegate.createWarehouseLocation(tenantId, input);
  }
  updateWarehouseLocation(tenantId: string, locationId: string, input: UpdateScmWarehouseLocationInput) {
    return this.delegate.updateWarehouseLocation(tenantId, locationId, input);
  }
  findWarehouseLocationById(tenantId: string, locationId: string) {
    return this.delegate.findWarehouseLocationById(tenantId, locationId);
  }
  listWarehouseLocations(tenantId: string, filter: ScmWarehouseLocationListFilter) {
    return this.delegate.listWarehouseLocations(tenantId, filter);
  }

  createItemBatch(tenantId: string, input: CreateScmItemBatchInput) {
    return this.delegate.createItemBatch(tenantId, input);
  }
  findItemBatchById(tenantId: string, batchId: string) {
    return this.delegate.findItemBatchById(tenantId, batchId);
  }
  listItemBatches(tenantId: string, filter?: ScmItemBatchListFilter) {
    return this.delegate.listItemBatches(tenantId, filter);
  }
  createItemSerial(tenantId: string, input: CreateScmItemSerialInput) {
    return this.delegate.createItemSerial(tenantId, input);
  }
  updateItemSerial(tenantId: string, serialId: string, input: UpdateScmItemSerialInput) {
    return this.delegate.updateItemSerial(tenantId, serialId, input);
  }
  findItemSerialById(tenantId: string, serialId: string) {
    return this.delegate.findItemSerialById(tenantId, serialId);
  }
  listItemSerials(tenantId: string, filter?: ScmItemSerialListFilter) {
    return this.delegate.listItemSerials(tenantId, filter);
  }

  findAdvancedStockBalance(tenantId: string, itemId: string, warehouseId: string, locationId?: string, batchId?: string) {
    return this.delegate.findAdvancedStockBalance(tenantId, itemId, warehouseId, locationId, batchId);
  }
  listAdvancedStockBalances(tenantId: string, filter?: ScmAdvancedStockBalanceFilter) {
    return this.delegate.listAdvancedStockBalances(tenantId, filter);
  }
  recordAdvancedStockMovement(tenantId: string, input: RecordScmAdvancedStockMovementInput) {
    return this.delegate.recordAdvancedStockMovement(tenantId, input);
  }
  listAdvancedStockMovements(tenantId: string, filter?: ScmAdvancedStockMovementFilter) {
    return this.delegate.listAdvancedStockMovements(tenantId, filter);
  }

  upsertReorderPolicy(tenantId: string, input: UpsertScmReorderPolicyInput) {
    return this.delegate.upsertReorderPolicy(tenantId, input);
  }
  listReorderPolicies(tenantId: string, filter?: ScmReorderPolicyFilter) {
    return this.delegate.listReorderPolicies(tenantId, filter);
  }
  createStockReservation(tenantId: string, input: CreateScmStockReservationInput) {
    return this.delegate.createStockReservation(tenantId, input);
  }
  findStockReservationById(tenantId: string, reservationId: string) {
    return this.delegate.findStockReservationById(tenantId, reservationId);
  }
  listStockReservations(tenantId: string, filter?: ScmStockReservationFilter) {
    return this.delegate.listStockReservations(tenantId, filter);
  }

  createStockTransfer(tenantId: string, input: CreateScmStockTransferInput) {
    return this.delegate.createStockTransfer(tenantId, input);
  }
  updateStockTransferProjection(tenantId: string, input: UpdateScmStockTransferProjectionInput) {
    return this.delegate.updateStockTransferProjection(tenantId, input);
  }
  deleteStockTransferWithoutWorkflow(tenantId: string, transferId: string) {
    return this.delegate.deleteStockTransferWithoutWorkflow(tenantId, transferId);
  }
  recordStockTransferShipment(tenantId: string, input: RecordScmStockTransferShipmentInput) {
    return this.delegate.recordStockTransferShipment(tenantId, input);
  }
  recordStockTransferReceipt(tenantId: string, input: RecordScmStockTransferReceiptInput) {
    return this.delegate.recordStockTransferReceipt(tenantId, input);
  }
  findStockTransferById(tenantId: string, transferId: string) {
    return this.delegate.findStockTransferById(tenantId, transferId);
  }
  listStockTransfers(tenantId: string, filter?: ScmStockTransferFilter) {
    return this.delegate.listStockTransfers(tenantId, filter);
  }

  createStockOpname(tenantId: string, input: CreateScmStockOpnameInput) {
    return this.delegate.createStockOpname(tenantId, input);
  }
  updateStockOpnameProjection(tenantId: string, input: UpdateScmStockOpnameProjectionInput) {
    return this.delegate.updateStockOpnameProjection(tenantId, input);
  }
  deleteStockOpnameWithoutWorkflow(tenantId: string, opnameId: string) {
    return this.delegate.deleteStockOpnameWithoutWorkflow(tenantId, opnameId);
  }
  recordStockOpnameCount(tenantId: string, input: RecordScmStockOpnameCountInput) {
    return this.delegate.recordStockOpnameCount(tenantId, input);
  }
  findStockOpnameById(tenantId: string, opnameId: string) {
    return this.delegate.findStockOpnameById(tenantId, opnameId);
  }
  listStockOpnames(tenantId: string, filter?: ScmStockOpnameFilter) {
    return this.delegate.listStockOpnames(tenantId, filter);
  }

  createValuationLayer(tenantId: string, input: CreateScmValuationLayerInput) {
    return this.delegate.createValuationLayer(tenantId, input);
  }
  updateValuationLayerRemainingQuantity(tenantId: string, input: ConsumeScmValuationLayerInput) {
    return this.delegate.updateValuationLayerRemainingQuantity(tenantId, input);
  }
  findValuationLayerById(tenantId: string, layerId: string) {
    return this.delegate.findValuationLayerById(tenantId, layerId);
  }
  listValuationLayers(tenantId: string, filter?: ScmValuationLayerFilter) {
    return this.delegate.listValuationLayers(tenantId, filter);
  }
  createLandedCost(tenantId: string, input: CreateScmLandedCostInput) {
    return this.delegate.createLandedCost(tenantId, input);
  }
  applyLandedCost(tenantId: string, input: ApplyScmLandedCostInput) {
    return this.delegate.applyLandedCost(tenantId, input);
  }
  findLandedCostById(tenantId: string, landedCostId: string) {
    return this.delegate.findLandedCostById(tenantId, landedCostId);
  }
  listLandedCosts(tenantId: string, filter?: ScmLandedCostFilter) {
    return this.delegate.listLandedCosts(tenantId, filter);
  }
  createValuationLayerAllocation(tenantId: string, input: CreateScmValuationLayerAllocationInput) {
    return this.delegate.createValuationLayerAllocation(tenantId, input);
  }
  listValuationLayerAllocations(tenantId: string, filter?: ScmValuationLayerAllocationFilter) {
    return this.delegate.listValuationLayerAllocations(tenantId, filter);
  }

  createReceivingRecord(tenantId: string, input: CreateScmReceivingRecordInput) {
    return this.delegate.createReceivingRecord(tenantId, input);
  }
  updateReceivingRecordStatus(tenantId: string, input: UpdateScmReceivingRecordStatusInput) {
    return this.delegate.updateReceivingRecordStatus(tenantId, input);
  }
  updateReceivingLineInspectionProjection(tenantId: string, input: UpdateScmReceivingLineInspectionProjectionInput) {
    return this.delegate.updateReceivingLineInspectionProjection(tenantId, input);
  }
  findReceivingRecordById(tenantId: string, receivingRecordId: string) {
    return this.delegate.findReceivingRecordById(tenantId, receivingRecordId);
  }
  findReceivingRecordByIdempotencyKey(tenantId: string, idempotencyKey: string) {
    return this.delegate.findReceivingRecordByIdempotencyKey(tenantId, idempotencyKey);
  }
  listReceivingRecords(tenantId: string, filter?: ScmReceivingRecordFilter) {
    return this.delegate.listReceivingRecords(tenantId, filter);
  }
  createInspection(tenantId: string, input: CreateScmInspectionInput) {
    return this.delegate.createInspection(tenantId, input);
  }
  findInspectionByReceivingLineId(tenantId: string, receivingLineId: string) {
    return this.delegate.findInspectionByReceivingLineId(tenantId, receivingLineId);
  }
  findInspectionByIdempotencyKey(tenantId: string, idempotencyKey: string) {
    return this.delegate.findInspectionByIdempotencyKey(tenantId, idempotencyKey);
  }
  createDiscrepancyRecord(tenantId: string, input: CreateScmDiscrepancyRecordInput) {
    return this.delegate.createDiscrepancyRecord(tenantId, input);
  }
  resolveDiscrepancyRecord(tenantId: string, input: ResolveScmDiscrepancyRecordInput) {
    return this.delegate.resolveDiscrepancyRecord(tenantId, input);
  }
  listDiscrepancyRecords(tenantId: string, filter?: ScmDiscrepancyRecordFilter) {
    return this.delegate.listDiscrepancyRecords(tenantId, filter);
  }

  createReturnToVendor(tenantId: string, input: CreateScmReturnToVendorInput) {
    return this.delegate.createReturnToVendor(tenantId, input);
  }
  findReturnToVendorById(tenantId: string, returnId: string) {
    return this.delegate.findReturnToVendorById(tenantId, returnId);
  }
  findReturnToVendorByIdempotencyKey(tenantId: string, idempotencyKey: string) {
    return this.delegate.findReturnToVendorByIdempotencyKey(tenantId, idempotencyKey);
  }
  listReturnToVendors(tenantId: string, filter?: ScmReturnToVendorFilter) {
    return this.delegate.listReturnToVendors(tenantId, filter);
  }
  createReceiptReversal(tenantId: string, input: CreateScmReceiptReversalInput) {
    return this.delegate.createReceiptReversal(tenantId, input);
  }
  findReceiptReversalByReceivingRecordId(tenantId: string, receivingRecordId: string) {
    return this.delegate.findReceiptReversalByReceivingRecordId(tenantId, receivingRecordId);
  }
  findReceiptReversalByIdempotencyKey(tenantId: string, idempotencyKey: string) {
    return this.delegate.findReceiptReversalByIdempotencyKey(tenantId, idempotencyKey);
  }
  createReplacementDelivery(tenantId: string, input: CreateScmReplacementDeliveryInput) {
    return this.delegate.createReplacementDelivery(tenantId, input);
  }
  findReplacementDeliveryById(tenantId: string, replacementId: string) {
    return this.delegate.findReplacementDeliveryById(tenantId, replacementId);
  }
  findReplacementDeliveryByIdempotencyKey(tenantId: string, idempotencyKey: string) {
    return this.delegate.findReplacementDeliveryByIdempotencyKey(tenantId, idempotencyKey);
  }
  listReplacementDeliveries(tenantId: string, filter?: ScmReplacementDeliveryFilter) {
    return this.delegate.listReplacementDeliveries(tenantId, filter);
  }

  createConsignmentSettlement(tenantId: string, input: CreateScmConsignmentSettlementInput) {
    return this.delegate.createConsignmentSettlement(tenantId, input);
  }
  findConsignmentSettlementById(tenantId: string, settlementId: string) {
    return this.delegate.findConsignmentSettlementById(tenantId, settlementId);
  }
  findConsignmentSettlementByIdempotencyKey(tenantId: string, idempotencyKey: string) {
    return this.delegate.findConsignmentSettlementByIdempotencyKey(tenantId, idempotencyKey);
  }
  listConsignmentSettlements(tenantId: string, filter?: ScmConsignmentSettlementFilter) {
    return this.delegate.listConsignmentSettlements(tenantId, filter);
  }

  createInventoryDisposal(tenantId: string, input: CreateScmInventoryDisposalInput) {
    return this.delegate.createInventoryDisposal(tenantId, input);
  }
  deleteInventoryDisposalWithoutWorkflow(tenantId: string, disposalId: string) {
    return this.delegate.deleteInventoryDisposalWithoutWorkflow(tenantId, disposalId);
  }
  updateInventoryDisposalStatus(tenantId: string, input: UpdateScmInventoryDisposalStatusInput) {
    return this.delegate.updateInventoryDisposalStatus(tenantId, input);
  }
  updateInventoryDisposalLineExecution(tenantId: string, lineId: string, movementId: string, valuationLayerAllocationId: string | null, accountingReadyEventId: string | null, unitCost: number | null, amount: number | null) {
    return this.delegate.updateInventoryDisposalLineExecution(tenantId, lineId, movementId, valuationLayerAllocationId, accountingReadyEventId, unitCost, amount);
  }
  findInventoryDisposalById(tenantId: string, disposalId: string) {
    return this.delegate.findInventoryDisposalById(tenantId, disposalId);
  }
  findInventoryDisposalByIdempotencyKey(tenantId: string, idempotencyKey: string) {
    return this.delegate.findInventoryDisposalByIdempotencyKey(tenantId, idempotencyKey);
  }
  listInventoryDisposals(tenantId: string, filter?: ScmInventoryDisposalFilter) {
    return this.delegate.listInventoryDisposals(tenantId, filter);
  }
  getInventoryAgingBuckets(tenantId: string, filter?: ScmInventoryAgingFilter) {
    return this.delegate.getInventoryAgingBuckets(tenantId, filter);
  }

  createWarehouseTask(tenantId: string, input: CreateScmWarehouseTaskInput) {
    return this.delegate.createWarehouseTask(tenantId, input);
  }
  updateWarehouseTaskStatus(tenantId: string, input: UpdateScmWarehouseTaskStatusInput) {
    return this.delegate.updateWarehouseTaskStatus(tenantId, input);
  }
  updateWarehouseTaskItem(tenantId: string, input: UpdateScmWarehouseTaskItemInput) {
    return this.delegate.updateWarehouseTaskItem(tenantId, input);
  }
  findWarehouseTaskById(tenantId: string, taskId: string) {
    return this.delegate.findWarehouseTaskById(tenantId, taskId);
  }
  findWarehouseTaskByIdempotencyKey(tenantId: string, idempotencyKey: string) {
    return this.delegate.findWarehouseTaskByIdempotencyKey(tenantId, idempotencyKey);
  }
  listWarehouseTasks(tenantId: string, filter?: ScmWarehouseTaskFilter) {
    return this.delegate.listWarehouseTasks(tenantId, filter);
  }

  createAccountingReadyEvent(tenantId: string, input: CreateScmAccountingReadyEventInput) {
    return this.delegate.createAccountingReadyEvent(tenantId, input);
  }
  updateAccountingReadyEventState(tenantId: string, input: UpdateScmAccountingReadyEventStateInput) {
    return this.delegate.updateAccountingReadyEventState(tenantId, input);
  }
  findAccountingReadyEventById(tenantId: string, eventId: string) {
    return this.delegate.findAccountingReadyEventById(tenantId, eventId);
  }
  findAccountingReadyEventByIdempotencyKey(tenantId: string, idempotencyKey: string) {
    return this.delegate.findAccountingReadyEventByIdempotencyKey(tenantId, idempotencyKey);
  }
  listAccountingReadyEvents(tenantId: string, filter?: ScmAccountingReadyEventFilter) {
    return this.delegate.listAccountingReadyEvents(tenantId, filter);
  }

  listOrganizationUnitDescendantIds(tenantId: string, rootIds: string[]) {
    return this.delegate.listOrganizationUnitDescendantIds(tenantId, rootIds);
  }
}
