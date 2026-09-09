/**
 * Supply Chain Advanced — domain types and repository port (Wave A5).
 *
 * Mirrors the schema in
 * `apps/api/migrations/1781000000000_wave-a5-supply-chain-advanced.cjs`
 * exactly — field names, nullability, and enumerations below must stay in
 * sync with that migration's CHECK constraints and columns.
 *
 * Scope:
 * - Multi-warehouse, bin/location, batch/lot, and serial tracking.
 * - Reservation, reorder, transfer, and stock opname.
 * - Inventory valuation and landed cost allocation.
 * - RFQ, tender, and bid comparison.
 * - Supplier evaluation and contract purchasing.
 * - Spend analytics snapshots.
 *
 * Architectural constraints:
 * - Advanced stock movements are immutable ledger rows; corrections are append-only.
 * - Workflow-owned lifecycles (transfers, opnames, RFQs, evaluations, contracts) use
 *   `workflowInstanceId` as the source of truth; local `status` columns are projections
 *   of workflow transitions, never independently authoritative.
 * - All entities are tenant-owned and must be enforced with centralized Data Scope.
 * - Monetary and valuation fields use exact-decimal numeric storage (NUMERIC(18,4)).
 */

export type ScmSerialStatus =
  | "in_stock"
  | "reserved"
  | "issued"
  | "in_transit"
  | "disposed"
  | "maintenance";

export type ScmAdvancedStockMovementType =
  | "in"
  | "out"
  | "transfer_in"
  | "transfer_out"
  | "adjustment_in"
  | "adjustment_out"
  | "opname_in"
  | "opname_out"
  | "inspection_hold_in"
  | "inspection_hold_out"
  | "inspection_release_in"
  | "inspection_release_out"
  | "return_to_vendor_out"
  | "receipt_reversal_out"
  | "receipt_reversal_in"
  | "consignment_in"
  | "consignment_out";

export type ScmStockCondition =
  | "unrestricted"
  | "quality_hold"
  | "rejected"
  | "quarantined"
  | "blocked"
  | "in_transit"
  | "in_repair";
export type ScmStockOwnerType = "own" | "supplier" | "customer";
export type ScmAccountAssignmentType = "stock" | "expense" | "asset" | "project" | "work_order" | "service";
export type ScmReceivingStatus = "received" | "partially_inspected" | "accepted" | "rejected" | "reversed";
export type ScmInspectionResult = "accepted" | "rejected" | "mixed" | "quarantined";
export type ScmDiscrepancyType = "shortage" | "overage" | "damage" | "quality" | "document";
export type ScmDiscrepancyStatus = "open" | "resolved" | "cancelled";
export type ScmAccountingReadyEventType =
  | "inventory.goods_received"
  | "inventory.goods_issued"
  | "inventory.transferred"
  | "inventory.adjusted"
  | "inventory.returned_to_vendor"
  | "inventory.receipt_reversed"
  | "inventory.landed_cost_applied"
  | "inventory.consignment_consumed"
  | "service.accepted"
  | "inventory.disposed";
export type ScmAccountingOutboxState = "pending" | "published" | "failed" | "suppressed";
export type ScmAccountingReconciliationState = "unmatched" | "matched" | "reversed" | "ignored";
export type ScmAccountingEventStateKind = "outbox" | "reconciliation";
export type ScmReturnToVendorStatus = "executed" | "cancelled";
export type ScmValuationLayerStatus = "open" | "consumed" | "reversed" | "closed";
export type ScmValuationAllocationType = "consume" | "return_to_vendor" | "receipt_reversal" | "restore";

export type ScmReservationStatus = "active" | "fulfilled" | "cancelled" | "expired";
export type ScmTransferStatus = "draft" | "approved" | "in_transit" | "received" | "cancelled";
export type ScmOpnameStatus = "draft" | "in_progress" | "completed" | "approved" | "adjusted" | "cancelled";
export type ScmProcurementType = "rfq" | "tender" | "direct_sourcing";
export type ScmRfqStatus = "draft" | "published" | "in_evaluation" | "awarded" | "cancelled" | "closed";
export type ScmSupplierBidStatus = "submitted" | "evaluated" | "shortlisted" | "awarded" | "rejected";
export type ScmSupplierEvaluationStatus = "draft" | "submitted" | "approved" | "rejected";
export type ScmSupplierRatingGrade = "A" | "B" | "C" | "D" | "E";
export type ScmSupplierContractType = "blanket_po" | "fixed_price" | "service_rate" | "consignment";
export type ScmSupplierContractStatus = "draft" | "pending_approval" | "active" | "expired" | "terminated" | "closed";
export type ScmLandedCostStatus = "draft" | "applied" | "cancelled";
export type ScmLandedCostAllocationMethod = "by_value" | "by_quantity" | "by_weight" | "equal";
export type ScmSpendAnalyticsPeriodType = "monthly" | "quarterly" | "yearly";

// === 1. Multi-Warehouse, Bin, Batch/Lot & Serial ===========================

export interface ScmWarehouse {
  id: string;
  tenantId: string;
  code: string;
  name: string;
  siteId: string | null;
  organizationUnitId: string | null;
  address: string | null;
  isActive: boolean;
  createdAt: Date;
  createdBy: string | null;
  updatedAt: Date;
  updatedBy: string | null;
}

export interface CreateScmWarehouseInput {
  code: string;
  name: string;
  siteId?: string | null;
  organizationUnitId?: string | null;
  address?: string | null;
  isActive?: boolean;
  createdBy?: string | null;
}

export interface UpdateScmWarehouseInput {
  name?: string;
  siteId?: string | null;
  organizationUnitId?: string | null;
  address?: string | null;
  isActive?: boolean;
  updatedBy?: string | null;
}

export interface ScmWarehouseLocation {
  id: string;
  tenantId: string;
  warehouseId: string;
  code: string;
  zone: string | null;
  aisle: string | null;
  rack: string | null;
  shelf: string | null;
  bin: string | null;
  isActive: boolean;
  createdAt: Date;
  createdBy: string | null;
  updatedAt: Date;
  updatedBy: string | null;
}

export interface CreateScmWarehouseLocationInput {
  warehouseId: string;
  code: string;
  zone?: string | null;
  aisle?: string | null;
  rack?: string | null;
  shelf?: string | null;
  bin?: string | null;
  isActive?: boolean;
  createdBy?: string | null;
}

export interface UpdateScmWarehouseLocationInput {
  zone?: string | null;
  aisle?: string | null;
  rack?: string | null;
  shelf?: string | null;
  bin?: string | null;
  isActive?: boolean;
  updatedBy?: string | null;
}

export interface ScmItemBatch {
  id: string;
  tenantId: string;
  itemId: string;
  batchNumber: string;
  manufacturedDate: string | null;
  expiryDate: string | null;
  supplierId: string | null;
  notes: string | null;
  isActive: boolean;
  createdAt: Date;
  createdBy: string | null;
  updatedAt: Date;
  updatedBy: string | null;
}

export interface CreateScmItemBatchInput {
  itemId: string;
  batchNumber: string;
  manufacturedDate?: string | null;
  expiryDate?: string | null;
  supplierId?: string | null;
  notes?: string | null;
  isActive?: boolean;
  createdBy?: string | null;
}

export interface ScmItemSerial {
  id: string;
  tenantId: string;
  itemId: string;
  serialNumber: string;
  batchId: string | null;
  warehouseId: string | null;
  locationId: string | null;
  status: ScmSerialStatus;
  warrantyExpiryDate: string | null;
  notes: string | null;
  createdAt: Date;
  createdBy: string | null;
  updatedAt: Date;
  updatedBy: string | null;
}

export interface CreateScmItemSerialInput {
  itemId: string;
  serialNumber: string;
  batchId?: string | null;
  warehouseId?: string | null;
  locationId?: string | null;
  status?: ScmSerialStatus;
  warrantyExpiryDate?: string | null;
  notes?: string | null;
  createdBy?: string | null;
}

export interface UpdateScmItemSerialInput {
  batchId?: string | null;
  warehouseId?: string | null;
  locationId?: string | null;
  status?: ScmSerialStatus;
  warrantyExpiryDate?: string | null;
  notes?: string | null;
  updatedBy?: string | null;
}

/** Only unrestricted company-owned stock contributes to `availableQuantity`. */
export interface ScmAdvancedStockBalance {
  id: string;
  tenantId: string;
  itemId: string;
  warehouseId: string;
  locationId: string | null;
  batchId: string | null;
  stockCondition: ScmStockCondition;
  ownerType: ScmStockOwnerType;
  ownerPartyId: string | null;
  conditionSince: Date;
  quantity: number;
  reservedQty: number;
  onHandQuantity?: number;
  reservedQuantity?: number;
  availableQuantity: number;
  updatedAt: Date;
}

/** Immutable ledger row. Quantity is always positive; direction is movement_type. */
export interface ScmAdvancedStockMovement {
  id: string;
  tenantId: string;
  itemId: string;
  warehouseId: string;
  locationId: string | null;
  batchId: string | null;
  serialId: string | null;
  movementType: ScmAdvancedStockMovementType;
  stockCondition: ScmStockCondition;
  ownerType: ScmStockOwnerType;
  ownerPartyId: string | null;
  quantity: number;
  unitCost: number | null;
  totalCost: number | null;
  referenceType: string | null;
  referenceId: string | null;
  referenceNumber: string | null;
  reversedMovementId: string | null;
  accountingReadyEventId: string | null;
  notes: string | null;
  occurredAt: Date;
  createdBy: string | null;
  createdAt: Date;
}

export interface ScmStockPositionKey {
  itemId: string;
  warehouseId: string;
  locationId?: string | null;
  batchId?: string | null;
  stockCondition?: ScmStockCondition;
  ownerType?: ScmStockOwnerType;
  ownerPartyId?: string | null;
}

export interface RecordScmAdvancedStockMovementInput extends ScmStockPositionKey {
  serialId?: string | null;
  movementType: ScmAdvancedStockMovementType;
  quantity: number;
  unitCost?: number | null;
  totalCost?: number | null;
  referenceType?: string | null;
  referenceId?: string | null;
  referenceNumber?: string | null;
  reversedMovementId?: string | null;
  accountingReadyEventId?: string | null;
  notes?: string | null;
  occurredAt?: Date;
  createdBy?: string | null;
}

// === 2. Reservation, Reorder, Transfers & Stock Opname ======================

export interface ScmReorderPolicy {
  id: string;
  tenantId: string;
  itemId: string;
  warehouseId: string | null;
  minQuantity: number;
  reorderPoint: number;
  reorderQuantity: number;
  safetyStock: number;
  leadTimeDays: number;
  isActive: boolean;
  createdAt: Date;
  createdBy: string | null;
  updatedAt: Date;
  updatedBy: string | null;
}

export interface UpsertScmReorderPolicyInput {
  itemId: string;
  warehouseId?: string | null;
  minQuantity: number;
  reorderPoint: number;
  reorderQuantity: number;
  safetyStock?: number;
  leadTimeDays?: number;
  isActive?: boolean;
  createdBy?: string | null;
  updatedBy?: string | null;
}

export interface ScmStockReservation {
  id: string;
  tenantId: string;
  reservationNumber: string;
  itemId: string;
  warehouseId: string;
  locationId: string | null;
  batchId: string | null;
  quantity: number;
  reservedForType: string;
  reservedForId: string | null;
  reservedForNumber: string | null;
  status: ScmReservationStatus;
  validUntil: Date | null;
  fulfilledAt: Date | null;
  cancelledAt: Date | null;
  notes: string | null;
  createdAt: Date;
  createdBy: string | null;
  updatedAt: Date;
  updatedBy: string | null;
}

export interface CreateScmStockReservationInput {
  reservationNumber: string;
  itemId: string;
  warehouseId: string;
  locationId?: string | null;
  batchId?: string | null;
  quantity: number;
  reservedForType: string;
  reservedForId?: string | null;
  reservedForNumber?: string | null;
  validUntil?: Date | null;
  notes?: string | null;
  createdBy?: string | null;
}

export interface ScmStockTransfer {
  id: string;
  tenantId: string;
  transferNumber: string;
  fromWarehouseId: string;
  toWarehouseId: string;
  status: ScmTransferStatus;
  shippedAt: Date | null;
  receivedAt: Date | null;
  cancelledAt: Date | null;
  workflowInstanceId: string | null;
  notes: string | null;
  createdAt: Date;
  createdBy: string | null;
  updatedAt: Date;
  updatedBy: string | null;
}

export interface CreateScmStockTransferInput {
  transferNumber: string;
  fromWarehouseId: string;
  toWarehouseId: string;
  notes?: string | null;
  createdBy?: string | null;
  lines: CreateScmStockTransferLineInput[];
}

export interface UpdateScmStockTransferProjectionInput {
  transferId: string;
  status: ScmTransferStatus;
  workflowInstanceId?: string | null;
  shippedAt?: Date | null;
  receivedAt?: Date | null;
  cancelledAt?: Date | null;
  notes?: string | null;
  updatedBy?: string | null;
}

export interface ScmStockTransferLine {
  id: string;
  tenantId: string;
  transferId: string;
  itemId: string;
  fromLocationId: string | null;
  toLocationId: string | null;
  batchId: string | null;
  quantityRequested: number;
  quantityShipped: number;
  quantityReceived: number;
  notes: string | null;
  sortOrder: number;
}

export interface CreateScmStockTransferLineInput {
  itemId: string;
  fromLocationId?: string | null;
  toLocationId?: string | null;
  batchId?: string | null;
  quantityRequested: number;
  notes?: string | null;
  sortOrder?: number;
}

export interface RecordScmStockTransferShipmentInput {
  transferId: string;
  lineShipments: Array<{ lineId: string; quantityShipped: number }>;
}

export interface RecordScmStockTransferReceiptInput {
  transferId: string;
  lineReceipts: Array<{ lineId: string; quantityReceived: number }>;
}

export interface ScmStockOpname {
  id: string;
  tenantId: string;
  opnameNumber: string;
  warehouseId: string;
  opnameDate: string;
  status: ScmOpnameStatus;
  workflowInstanceId: string | null;
  completedAt: Date | null;
  completedBy: string | null;
  notes: string | null;
  createdAt: Date;
  createdBy: string | null;
  updatedAt: Date;
  updatedBy: string | null;
}

export interface CreateScmStockOpnameInput {
  opnameNumber: string;
  warehouseId: string;
  opnameDate: string;
  notes?: string | null;
  createdBy?: string | null;
  lines: CreateScmStockOpnameLineInput[];
}

export interface UpdateScmStockOpnameProjectionInput {
  opnameId: string;
  status: ScmOpnameStatus;
  workflowInstanceId?: string | null;
  completedAt?: Date | null;
  completedBy?: string | null;
  notes?: string | null;
  updatedBy?: string | null;
}

export interface ScmStockOpnameLine {
  id: string;
  tenantId: string;
  opnameId: string;
  itemId: string;
  locationId: string | null;
  batchId: string | null;
  systemQuantity: number;
  physicalQuantity: number | null;
  varianceQuantity: number | null;
  adjustmentMovementId: string | null;
  notes: string | null;
  sortOrder: number;
}

export interface CreateScmStockOpnameLineInput {
  itemId: string;
  locationId?: string | null;
  batchId?: string | null;
  systemQuantity: number;
  physicalQuantity?: number | null;
  notes?: string | null;
  sortOrder?: number;
}

export interface RecordScmStockOpnameCountInput {
  lineId: string;
  physicalQuantity: number;
}

// === 3. Inventory Valuation & Landed Cost ===================================

export interface ScmValuationLayer {
  id: string;
  tenantId: string;
  itemId: string;
  warehouseId: string | null;
  receiptMovementId: string | null;
  receivingLineId: string | null;
  sourceInspectionId: string | null;
  stockCondition: ScmStockCondition;
  ownerType: ScmStockOwnerType;
  ownerPartyId: string | null;
  layerStatus: ScmValuationLayerStatus;
  receivedDate: string;
  originalQuantity: number;
  remainingQuantity: number;
  unitCost: number;
  landedCostAdded: number;
  effectiveUnitCost: number;
  totalValue: number;
  createdAt: Date;
}

export interface CreateScmValuationLayerInput {
  itemId: string;
  warehouseId?: string | null;
  receiptMovementId?: string | null;
  receivingLineId?: string | null;
  sourceInspectionId?: string | null;
  stockCondition?: ScmStockCondition;
  ownerType?: ScmStockOwnerType;
  ownerPartyId?: string | null;
  layerStatus?: ScmValuationLayerStatus;
  receivedDate: string;
  originalQuantity: number;
  remainingQuantity?: number;
  unitCost: number;
  landedCostAdded?: number;
  effectiveUnitCost?: number;
  totalValue?: number;
}

export interface ConsumeScmValuationLayerInput {
  layerId: string;
  remainingQuantity: number;
}

export interface ScmLandedCost {
  id: string;
  tenantId: string;
  voucherNumber: string;
  purchaseOrderId: string;
  costType: string;
  currency: string;
  amount: number;
  allocationMethod: ScmLandedCostAllocationMethod;
  status: ScmLandedCostStatus;
  appliedAt: Date | null;
  notes: string | null;
  createdAt: Date;
  createdBy: string | null;
  updatedAt: Date;
  updatedBy: string | null;
}

export interface CreateScmLandedCostInput {
  voucherNumber: string;
  purchaseOrderId: string;
  costType: string;
  currency?: string;
  amount: number;
  allocationMethod: ScmLandedCostAllocationMethod;
  notes?: string | null;
  createdBy?: string | null;
  allocations: CreateScmLandedCostAllocationInput[];
}

export interface ScmLandedCostAllocation {
  id: string;
  tenantId: string;
  landedCostId: string;
  itemId: string;
  valuationLayerId: string | null;
  allocatedAmount: number;
  costPerUnitAdded: number;
}

export interface CreateScmLandedCostAllocationInput {
  itemId: string;
  valuationLayerId?: string | null;
  allocatedAmount: number;
  costPerUnitAdded: number;
}

export interface ApplyScmLandedCostInput {
  landedCostId: string;
  appliedAt?: Date;
}

// === 4. RFQ, Tender & Bid Comparison ========================================

export interface ScmRfq {
  id: string;
  tenantId: string;
  rfqNumber: string;
  title: string;
  procurementType: ScmProcurementType;
  organizationUnitId: string | null;
  purchaseRequestId: string | null;
  submissionDeadline: Date;
  status: ScmRfqStatus;
  workflowInstanceId: string | null;
  awardedAt: Date | null;
  cancelledAt: Date | null;
  notes: string | null;
  createdAt: Date;
  createdBy: string | null;
  updatedAt: Date;
  updatedBy: string | null;
}

export interface CreateScmRfqInput {
  rfqNumber: string;
  title: string;
  procurementType: ScmProcurementType;
  organizationUnitId?: string | null;
  purchaseRequestId?: string | null;
  submissionDeadline: Date;
  notes?: string | null;
  createdBy?: string | null;
  items: CreateScmRfqItemInput[];
  invitedSuppliers: CreateScmRfqInvitedSupplierInput[];
}

export interface UpdateScmRfqProjectionInput {
  rfqId: string;
  status: ScmRfqStatus;
  workflowInstanceId?: string | null;
  awardedAt?: Date | null;
  cancelledAt?: Date | null;
  notes?: string | null;
  updatedBy?: string | null;
}

export interface ScmRfqItem {
  id: string;
  tenantId: string;
  rfqId: string;
  itemId: string;
  targetQuantity: number;
  targetUnitPrice: number | null;
  specifications: string | null;
  sortOrder: number;
}

export interface CreateScmRfqItemInput {
  itemId: string;
  targetQuantity: number;
  targetUnitPrice?: number | null;
  specifications?: string | null;
  sortOrder?: number;
}

export interface ScmRfqInvitedSupplier {
  id: string;
  tenantId: string;
  rfqId: string;
  supplierId: string;
  invitedAt: Date;
  respondedAt: Date | null;
}

export interface CreateScmRfqInvitedSupplierInput {
  supplierId: string;
  respondedAt?: Date | null;
}

export interface ScmSupplierBid {
  id: string;
  tenantId: string;
  bidNumber: string;
  rfqId: string;
  supplierId: string;
  submittedAt: Date;
  currency: string;
  totalAmount: number;
  leadTimeDays: number;
  validUntil: string | null;
  status: ScmSupplierBidStatus;
  technicalScore: number | null;
  commercialScore: number | null;
  finalScore: number | null;
  rank: number | null;
  isWinningBid: boolean;
  resultingPurchaseOrderId: string | null;
  notes: string | null;
  createdAt: Date;
  createdBy: string | null;
  updatedAt: Date;
  updatedBy: string | null;
}

export interface CreateScmSupplierBidInput {
  bidNumber: string;
  rfqId: string;
  supplierId: string;
  currency?: string;
  totalAmount?: number;
  leadTimeDays?: number;
  validUntil?: string | null;
  notes?: string | null;
  createdBy?: string | null;
  lines: CreateScmSupplierBidLineInput[];
}

export interface UpdateScmSupplierBidScoreInput {
  bidId: string;
  technicalScore?: number | null;
  commercialScore?: number | null;
  finalScore?: number | null;
  rank?: number | null;
  status?: ScmSupplierBidStatus;
  updatedBy?: string | null;
}

export interface AwardScmSupplierBidInput {
  bidId: string;
  resultingPurchaseOrderId?: string | null;
  updatedBy?: string | null;
}

export interface ScmSupplierBidLine {
  id: string;
  tenantId: string;
  bidId: string;
  rfqItemId: string;
  offeredQuantity: number;
  offeredUnitPrice: number;
  offeredTotalPrice: number;
  remarks: string | null;
}

export interface CreateScmSupplierBidLineInput {
  rfqItemId: string;
  offeredQuantity: number;
  offeredUnitPrice: number;
  offeredTotalPrice: number;
  remarks?: string | null;
}

// === 5. Supplier Evaluation & Contract Purchasing ===========================

export interface ScmSupplierEvaluation {
  id: string;
  tenantId: string;
  evaluationNumber: string;
  supplierId: string;
  evaluationPeriod: string;
  periodStartDate: string;
  periodEndDate: string;
  qualityScore: number;
  deliveryScore: number;
  pricingScore: number;
  serviceScore: number;
  overallScore: number;
  ratingGrade: ScmSupplierRatingGrade;
  status: ScmSupplierEvaluationStatus;
  workflowInstanceId: string | null;
  notes: string | null;
  evaluatedBy: string | null;
  evaluatedAt: Date | null;
  createdAt: Date;
  createdBy: string | null;
  updatedAt: Date;
  updatedBy: string | null;
}

export interface CreateScmSupplierEvaluationInput {
  evaluationNumber: string;
  supplierId: string;
  evaluationPeriod: string;
  periodStartDate: string;
  periodEndDate: string;
  qualityScore?: number;
  deliveryScore?: number;
  pricingScore?: number;
  serviceScore?: number;
  overallScore?: number;
  ratingGrade?: ScmSupplierRatingGrade;
  notes?: string | null;
  evaluatedBy?: string | null;
  evaluatedAt?: Date | null;
  createdBy?: string | null;
}

export interface UpdateScmSupplierEvaluationProjectionInput {
  evaluationId: string;
  status: ScmSupplierEvaluationStatus;
  workflowInstanceId?: string | null;
  notes?: string | null;
  updatedBy?: string | null;
}

export interface ScmSupplierContract {
  id: string;
  tenantId: string;
  contractNumber: string;
  supplierId: string;
  title: string;
  contractType: ScmSupplierContractType;
  startDate: string;
  endDate: string;
  currency: string;
  committedAmount: number;
  spentAmount: number;
  status: ScmSupplierContractStatus;
  workflowInstanceId: string | null;
  termsAndConditions: string | null;
  approvedAt: Date | null;
  closedAt: Date | null;
  createdAt: Date;
  createdBy: string | null;
  updatedAt: Date;
  updatedBy: string | null;
}

export interface CreateScmSupplierContractInput {
  contractNumber: string;
  supplierId: string;
  title: string;
  contractType: ScmSupplierContractType;
  startDate: string;
  endDate: string;
  currency?: string;
  committedAmount?: number;
  termsAndConditions?: string | null;
  createdBy?: string | null;
  items: CreateScmSupplierContractItemInput[];
}

export interface UpdateScmSupplierContractProjectionInput {
  contractId: string;
  status: ScmSupplierContractStatus;
  workflowInstanceId?: string | null;
  approvedAt?: Date | null;
  closedAt?: Date | null;
  updatedBy?: string | null;
}

export interface RecordScmSupplierContractSpendInput {
  contractId: string;
  additionalSpentAmount: number;
}

export interface ScmSupplierContractItem {
  id: string;
  tenantId: string;
  contractId: string;
  itemId: string;
  agreedUnitPrice: number;
  minOrderQuantity: number;
  maxOrderQuantity: number | null;
  leadTimeDays: number;
  notes: string | null;
}

export interface CreateScmSupplierContractItemInput {
  itemId: string;
  agreedUnitPrice: number;
  minOrderQuantity?: number;
  maxOrderQuantity?: number | null;
  leadTimeDays?: number;
  notes?: string | null;
}

// === 6. Spend Analytics ======================================================

export interface ScmSpendAnalyticsSnapshot {
  id: string;
  tenantId: string;
  snapshotDate: string;
  periodType: ScmSpendAnalyticsPeriodType;
  periodKey: string;
  organizationUnitId: string | null;
  supplierId: string | null;
  itemCategory: string | null;
  totalSpend: number;
  poCount: number;
  itemsPurchasedCount: number;
  avgPoValue: number;
  createdAt: Date;
  createdBy: string | null;
}

export interface CreateScmSpendAnalyticsSnapshotInput {
  snapshotDate: string;
  periodType: ScmSpendAnalyticsPeriodType;
  periodKey: string;
  organizationUnitId?: string | null;
  supplierId?: string | null;
  itemCategory?: string | null;
  totalSpend: number;
  poCount: number;
  itemsPurchasedCount: number;
  avgPoValue: number;
  createdBy?: string | null;
}

// === 7. Wave A5.1 Stage 1: Receiving, Returns & Accounting Readiness ========

export type ScmAccountAssignmentDimensions = Record<string, unknown>;
export type ScmAccountingReadyPayload = Record<string, unknown>;

export interface ScmAccountAssignmentConfig {
  id: string;
  tenantId: string;
  assignmentType: ScmAccountAssignmentType;
  requiredDimensions: string[];
  inventoryRelevant: boolean;
  isActive: boolean;
  createdAt: Date;
  createdBy: string | null;
  updatedAt: Date;
  updatedBy: string | null;
}

export interface UpdateScmAccountAssignmentConfigInput {
  assignmentType: ScmAccountAssignmentType;
  requiredDimensions?: string[];
  inventoryRelevant?: boolean;
  isActive?: boolean;
  updatedBy?: string | null;
}

export interface ScmReceivingRecord {
  id: string;
  tenantId: string;
  receiptNumber: string;
  idempotencyKey: string;
  purchaseOrderId: string;
  supplierId: string;
  warehouseId: string;
  locationId: string | null;
  receivedAt: Date;
  receivedBy: string | null;
  status: ScmReceivingStatus;
  notes: string | null;
  createdAt: Date;
  createdBy: string | null;
  updatedAt: Date;
  updatedBy: string | null;
}

export interface ScmReceivingLine {
  id: string;
  tenantId: string;
  receivingRecordId: string;
  purchaseOrderLineId: string;
  itemId: string;
  warehouseId: string;
  locationId: string | null;
  batchId: string | null;
  stockCondition: ScmStockCondition;
  ownerType: ScmStockOwnerType;
  ownerPartyId: string | null;
  quantityReceived: number;
  quantityAccepted: number;
  quantityRejected: number;
  quantityQuarantined: number;
  quantityReturned: number;
  quantityReversed: number;
  unitCost: number | null;
  currency: string;
  accountAssignmentType: ScmAccountAssignmentType;
  accountAssignmentDimensions: ScmAccountAssignmentDimensions;
  frozenAccountAssignmentAt: Date;
  inspectionRequired: boolean;
  holdMovementId: string | null;
  acceptanceMovementId: string | null;
  valuationLayerId: string | null;
  notes: string | null;
  sortOrder: number;
}

export interface CreateScmReceivingRecordInput {
  receiptNumber: string;
  idempotencyKey: string;
  purchaseOrderId: string;
  supplierId: string;
  warehouseId: string;
  locationId?: string | null;
  receivedAt?: Date;
  receivedBy?: string | null;
  notes?: string | null;
  createdBy?: string | null;
  lines: CreateScmReceivingLineInput[];
}

export interface CreateScmReceivingLineInput {
  purchaseOrderLineId: string;
  itemId: string;
  warehouseId?: string | null;
  locationId?: string | null;
  batchId?: string | null;
  stockCondition?: ScmStockCondition;
  ownerType?: ScmStockOwnerType;
  ownerPartyId?: string | null;
  quantityReceived: number;
  unitCost?: number | null;
  currency?: string;
  accountAssignmentType: ScmAccountAssignmentType;
  accountAssignmentDimensions?: ScmAccountAssignmentDimensions;
  inspectionRequired?: boolean;
  holdMovementId?: string | null;
  notes?: string | null;
  sortOrder?: number;
}

export interface UpdateScmReceivingLineInspectionProjectionInput {
  receivingLineId: string;
  quantityAccepted?: number;
  quantityRejected?: number;
  quantityQuarantined?: number;
  stockCondition?: ScmStockCondition;
  acceptanceMovementId?: string | null;
  valuationLayerId?: string | null;
}

export interface UpdateScmReceivingRecordStatusInput {
  receivingRecordId: string;
  status: ScmReceivingStatus;
  updatedBy?: string | null;
}

export interface ScmInspection {
  id: string;
  tenantId: string;
  receivingLineId: string;
  inspectionNumber: string;
  idempotencyKey: string;
  inspectedAt: Date;
  inspectedBy: string | null;
  quantityAccepted: number;
  quantityRejected: number;
  quantityQuarantined: number;
  result: ScmInspectionResult;
  reason: string | null;
  createdAt: Date;
  createdBy: string | null;
}

export interface CreateScmInspectionInput {
  receivingLineId: string;
  inspectionNumber: string;
  idempotencyKey: string;
  inspectedAt?: Date;
  inspectedBy?: string | null;
  quantityAccepted?: number;
  quantityRejected?: number;
  quantityQuarantined?: number;
  result: ScmInspectionResult;
  reason?: string | null;
  createdBy?: string | null;
}

export interface ScmDiscrepancyRecord {
  id: string;
  tenantId: string;
  receivingLineId: string;
  discrepancyType: ScmDiscrepancyType;
  quantity: number | null;
  description: string;
  status: ScmDiscrepancyStatus;
  resolvedAt: Date | null;
  resolvedBy: string | null;
  resolutionNotes: string | null;
  createdAt: Date;
  createdBy: string | null;
}

export interface CreateScmDiscrepancyRecordInput {
  receivingLineId: string;
  discrepancyType: ScmDiscrepancyType;
  quantity?: number | null;
  description: string;
  createdBy?: string | null;
}

export interface ResolveScmDiscrepancyRecordInput {
  discrepancyId: string;
  status: ScmDiscrepancyStatus;
  resolvedAt?: Date | null;
  resolvedBy?: string | null;
  resolutionNotes?: string | null;
}

export interface ScmAccountingReadyEvent {
  id: string;
  tenantId: string;
  eventType: ScmAccountingReadyEventType;
  sourceDocumentType: string;
  sourceDocumentId: string;
  sourceDocumentLineId: string | null;
  sourceMovementId: string | null;
  sourceDocumentRevision: number;
  effectiveAt: Date;
  currency: string;
  amount: number;
  quantity: number | null;
  unitCost: number | null;
  accountAssignmentType: ScmAccountAssignmentType | null;
  accountAssignmentDimensions: ScmAccountAssignmentDimensions;
  idempotencyKey: string;
  reversalOfEventId: string | null;
  outboxState: ScmAccountingOutboxState;
  reconciliationState: ScmAccountingReconciliationState;
  payload: ScmAccountingReadyPayload;
  createdAt: Date;
  createdBy: string | null;
}

export interface CreateScmAccountingReadyEventInput {
  eventType: ScmAccountingReadyEventType;
  sourceDocumentType: string;
  sourceDocumentId: string;
  sourceDocumentLineId?: string | null;
  sourceMovementId?: string | null;
  sourceDocumentRevision?: number;
  effectiveAt?: Date;
  currency?: string;
  amount?: number;
  quantity?: number | null;
  unitCost?: number | null;
  accountAssignmentType?: ScmAccountAssignmentType | null;
  accountAssignmentDimensions?: ScmAccountAssignmentDimensions;
  idempotencyKey: string;
  reversalOfEventId?: string | null;
  payload?: ScmAccountingReadyPayload;
  createdBy?: string | null;
}

export interface ScmAccountingReadyEventStateTransition {
  id: string;
  tenantId: string;
  accountingEventId: string;
  stateKind: ScmAccountingEventStateKind;
  fromState: string | null;
  toState: string;
  reason: string | null;
  occurredAt: Date;
  occurredBy: string | null;
}

export interface UpdateScmAccountingReadyEventStateInput {
  accountingEventId: string;
  stateKind: ScmAccountingEventStateKind;
  toState: ScmAccountingOutboxState | ScmAccountingReconciliationState;
  reason?: string | null;
  occurredAt?: Date;
  occurredBy?: string | null;
}

export interface ScmReturnToVendor {
  id: string;
  tenantId: string;
  returnNumber: string;
  idempotencyKey: string;
  supplierId: string;
  purchaseOrderId: string | null;
  warehouseId: string;
  returnedAt: Date;
  returnedBy: string | null;
  reason: string;
  status: ScmReturnToVendorStatus;
  notes: string | null;
  createdAt: Date;
  createdBy: string | null;
}

export interface ScmReturnToVendorLine {
  id: string;
  tenantId: string;
  returnToVendorId: string;
  receivingLineId: string | null;
  itemId: string;
  warehouseId: string;
  locationId: string | null;
  batchId: string | null;
  stockCondition: ScmStockCondition;
  ownerType: ScmStockOwnerType;
  ownerPartyId: string | null;
  quantity: number;
  movementId: string | null;
  accountingReadyEventId: string | null;
  notes: string | null;
  sortOrder: number;
}

export interface CreateScmReturnToVendorInput {
  returnNumber: string;
  idempotencyKey: string;
  supplierId: string;
  purchaseOrderId?: string | null;
  warehouseId: string;
  returnedAt?: Date;
  returnedBy?: string | null;
  reason: string;
  notes?: string | null;
  createdBy?: string | null;
  lines: CreateScmReturnToVendorLineInput[];
}

export interface CreateScmReturnToVendorLineInput extends ScmStockPositionKey {
  receivingLineId?: string | null;
  quantity: number;
  movementId?: string | null;
  accountingReadyEventId?: string | null;
  notes?: string | null;
  sortOrder?: number;
}

export interface ScmReceiptReversal {
  id: string;
  tenantId: string;
  reversalNumber: string;
  idempotencyKey: string;
  receivingRecordId: string;
  reason: string;
  reversedAt: Date;
  reversedBy: string | null;
  reversalEventId: string | null;
  createdAt: Date;
  createdBy: string | null;
}

export interface ScmReceiptReversalLine {
  id: string;
  tenantId: string;
  reversalId: string;
  receivingLineId: string;
  quantity: number;
  movementId: string | null;
  restoredLayerId: string | null;
  sortOrder: number;
}

export interface CreateScmReceiptReversalInput {
  reversalNumber: string;
  idempotencyKey: string;
  receivingRecordId: string;
  reason: string;
  reversedAt?: Date;
  reversedBy?: string | null;
  reversalEventId?: string | null;
  createdBy?: string | null;
  lines: CreateScmReceiptReversalLineInput[];
}

export interface CreateScmReceiptReversalLineInput {
  receivingLineId: string;
  quantity: number;
  movementId?: string | null;
  restoredLayerId?: string | null;
  sortOrder?: number;
}

export interface ScmValuationLayerAllocation {
  id: string;
  tenantId: string;
  valuationLayerId: string;
  movementId: string;
  allocationType: ScmValuationAllocationType;
  quantity: number;
  unitCost: number;
  amount: number;
  reversesAllocationId: string | null;
  createdAt: Date;
  createdBy: string | null;
}

export interface CreateScmValuationLayerAllocationInput {
  valuationLayerId: string;
  movementId: string;
  allocationType: ScmValuationAllocationType;
  quantity: number;
  unitCost: number;
  amount: number;
  reversesAllocationId?: string | null;
  createdBy?: string | null;
}

// === List filters ============================================================

export interface ScmWarehouseListFilter {
  organizationUnitIds?: string[] | null;
  siteId?: string;
  activeOnly?: boolean;
}

export interface ScmWarehouseLocationListFilter {
  warehouseId?: string;
  activeOnly?: boolean;
}

export interface ScmItemBatchListFilter {
  itemId?: string;
  includeExpired?: boolean;
}

export interface ScmItemSerialListFilter {
  itemId?: string;
  warehouseId?: string;
  warehouseIds?: string[] | null;
  locationId?: string | null;
  batchId?: string | null;
  status?: ScmSerialStatus;
}

export interface ScmAdvancedStockBalanceFilter {
  itemId?: string;
  warehouseId?: string;
  locationId?: string | null;
  batchId?: string | null;
  stockCondition?: ScmStockCondition;
  ownerType?: ScmStockOwnerType;
  ownerPartyId?: string | null;
  warehouseIds?: string[] | null;
}

export interface ScmAdvancedStockMovementFilter {
  itemId?: string;
  warehouseId?: string;
  warehouseIds?: string[] | null;
  locationId?: string | null;
  batchId?: string | null;
  movementType?: ScmAdvancedStockMovementType;
  stockCondition?: ScmStockCondition;
  ownerType?: ScmStockOwnerType;
  ownerPartyId?: string | null;
  referenceType?: string;
  referenceId?: string;
  occurredFrom?: Date;
  occurredTo?: Date;
  limit?: number;
}

export interface ScmReorderPolicyFilter {
  itemId?: string;
  warehouseId?: string | null;
  warehouseIds?: string[] | null;
  activeOnly?: boolean;
}

export interface ScmStockReservationFilter {
  itemId?: string;
  warehouseId?: string;
  warehouseIds?: string[] | null;
  status?: ScmReservationStatus;
  reservedForType?: string;
  reservedForId?: string;
}

export interface ScmStockTransferFilter {
  fromWarehouseId?: string;
  toWarehouseId?: string;
  warehouseIds?: string[] | null;
  status?: ScmTransferStatus;
}

export interface ScmStockOpnameFilter {
  warehouseId?: string;
  warehouseIds?: string[] | null;
  status?: ScmOpnameStatus;
}

export interface ScmValuationLayerFilter {
  itemId?: string;
  warehouseId?: string;
  warehouseIds?: string[] | null;
  onlyWithRemaining?: boolean;
}

export interface ScmLandedCostFilter {
  purchaseOrderId?: string;
  status?: ScmLandedCostStatus;
}

export interface ScmRfqFilter {
  purchaseRequestId?: string;
  procurementType?: ScmProcurementType;
  organizationUnitIds?: string[] | null;
  status?: ScmRfqStatus;
}

export interface ScmSupplierBidFilter {
  rfqId?: string;
  supplierId?: string;
  status?: ScmSupplierBidStatus;
  winningOnly?: boolean;
}

export interface ScmSupplierEvaluationFilter {
  supplierId?: string;
  status?: ScmSupplierEvaluationStatus;
  ratingGrade?: ScmSupplierRatingGrade;
}

export interface ScmSupplierContractFilter {
  supplierId?: string;
  contractType?: ScmSupplierContractType;
  status?: ScmSupplierContractStatus;
}

export interface ScmSpendAnalyticsSnapshotFilter {
  snapshotDateFrom?: string;
  snapshotDateTo?: string;
  periodType?: ScmSpendAnalyticsPeriodType;
  organizationUnitIds?: string[] | null;
  supplierId?: string;
  itemCategory?: string;
  limit?: number;
}

export interface ScmReceivingRecordFilter {
  purchaseOrderId?: string;
  supplierId?: string;
  warehouseId?: string;
  warehouseIds?: string[] | null;
  status?: ScmReceivingStatus;
  receivedFrom?: Date;
  receivedTo?: Date;
  limit?: number;
}

export interface ScmDiscrepancyRecordFilter {
  receivingLineId?: string;
  status?: ScmDiscrepancyStatus;
  discrepancyType?: ScmDiscrepancyType;
}

export interface ScmAccountingReadyEventFilter {
  eventType?: ScmAccountingReadyEventType;
  sourceDocumentType?: string;
  sourceDocumentId?: string;
  outboxState?: ScmAccountingOutboxState;
  reconciliationState?: ScmAccountingReconciliationState;
  createdFrom?: Date;
  createdTo?: Date;
  limit?: number;
}

export interface ScmReturnToVendorFilter {
  supplierId?: string;
  purchaseOrderId?: string;
  warehouseId?: string;
  warehouseIds?: string[] | null;
  status?: ScmReturnToVendorStatus;
  returnedFrom?: Date;
  returnedTo?: Date;
  limit?: number;
}

export interface ScmValuationLayerAllocationFilter {
  valuationLayerId?: string;
  movementId?: string;
  allocationType?: ScmValuationAllocationType;
  limit?: number;
}

// === Repository port ==========================================================

export interface SupplyChainAdvancedRepository {
  // Warehouses & locations
  createWarehouse(tenantId: string, input: CreateScmWarehouseInput): Promise<ScmWarehouse>;
  updateWarehouse(tenantId: string, warehouseId: string, input: UpdateScmWarehouseInput): Promise<ScmWarehouse | null>;
  findWarehouseById(tenantId: string, warehouseId: string): Promise<ScmWarehouse | null>;
  findWarehouseByCode(tenantId: string, code: string): Promise<ScmWarehouse | null>;
  listWarehouses(tenantId: string, filter?: ScmWarehouseListFilter): Promise<ScmWarehouse[]>;

  createWarehouseLocation(tenantId: string, input: CreateScmWarehouseLocationInput): Promise<ScmWarehouseLocation>;
  updateWarehouseLocation(
    tenantId: string,
    locationId: string,
    input: UpdateScmWarehouseLocationInput,
  ): Promise<ScmWarehouseLocation | null>;
  findWarehouseLocationById(tenantId: string, locationId: string): Promise<ScmWarehouseLocation | null>;
  listWarehouseLocations(tenantId: string, filter?: ScmWarehouseLocationListFilter): Promise<ScmWarehouseLocation[]>;

  // Batches & serials
  createItemBatch(tenantId: string, input: CreateScmItemBatchInput): Promise<ScmItemBatch>;
  findItemBatchById(tenantId: string, batchId: string): Promise<ScmItemBatch | null>;
  listItemBatches(tenantId: string, filter?: ScmItemBatchListFilter): Promise<ScmItemBatch[]>;

  createItemSerial(tenantId: string, input: CreateScmItemSerialInput): Promise<ScmItemSerial>;
  updateItemSerial(tenantId: string, serialId: string, input: UpdateScmItemSerialInput): Promise<ScmItemSerial | null>;
  findItemSerialById(tenantId: string, serialId: string): Promise<ScmItemSerial | null>;
  listItemSerials(tenantId: string, filter?: ScmItemSerialListFilter): Promise<ScmItemSerial[]>;

  // Advanced stock balances & immutable ledger
  findAdvancedStockBalance(
    tenantId: string,
    itemId: string,
    warehouseId: string,
    locationId?: string | null,
    batchId?: string | null,
    stockCondition?: ScmStockCondition,
    ownerType?: ScmStockOwnerType,
    ownerPartyId?: string | null,
  ): Promise<ScmAdvancedStockBalance | null>;
  listAdvancedStockBalances(tenantId: string, filter?: ScmAdvancedStockBalanceFilter): Promise<ScmAdvancedStockBalance[]>;

  /** Writes an immutable movement row and applies the balance delta in one transaction. */
  recordAdvancedStockMovement(
    tenantId: string,
    input: RecordScmAdvancedStockMovementInput,
  ): Promise<{ movement: ScmAdvancedStockMovement; balance: ScmAdvancedStockBalance }>;
  listAdvancedStockMovements(tenantId: string, filter?: ScmAdvancedStockMovementFilter): Promise<ScmAdvancedStockMovement[]>;

  // Account assignment readiness
  listAccountAssignmentConfigs(tenantId: string, activeOnly?: boolean): Promise<ScmAccountAssignmentConfig[]>;
  findAccountAssignmentConfig(
    tenantId: string,
    assignmentType: ScmAccountAssignmentType,
  ): Promise<ScmAccountAssignmentConfig | null>;
  updateAccountAssignmentConfig(
    tenantId: string,
    input: UpdateScmAccountAssignmentConfigInput,
  ): Promise<ScmAccountAssignmentConfig | null>;

  // Receiving, inspection & discrepancy tracking
  createReceivingRecord(
    tenantId: string,
    input: CreateScmReceivingRecordInput,
  ): Promise<{ receiving: ScmReceivingRecord; lines: ScmReceivingLine[] }>;
  updateReceivingRecordStatus(
    tenantId: string,
    input: UpdateScmReceivingRecordStatusInput,
  ): Promise<ScmReceivingRecord | null>;
  updateReceivingLineInspectionProjection(
    tenantId: string,
    input: UpdateScmReceivingLineInspectionProjectionInput,
  ): Promise<ScmReceivingLine | null>;
  findReceivingRecordById(
    tenantId: string,
    receivingRecordId: string,
  ): Promise<{ receiving: ScmReceivingRecord; lines: ScmReceivingLine[] } | null>;
  findReceivingRecordByIdempotencyKey(
    tenantId: string,
    idempotencyKey: string,
  ): Promise<{ receiving: ScmReceivingRecord; lines: ScmReceivingLine[] } | null>;
  listReceivingRecords(tenantId: string, filter?: ScmReceivingRecordFilter): Promise<ScmReceivingRecord[]>;
  createInspection(tenantId: string, input: CreateScmInspectionInput): Promise<ScmInspection>;
  findInspectionByReceivingLineId(tenantId: string, receivingLineId: string): Promise<ScmInspection | null>;
  findInspectionByIdempotencyKey(tenantId: string, idempotencyKey: string): Promise<ScmInspection | null>;
  createDiscrepancyRecord(tenantId: string, input: CreateScmDiscrepancyRecordInput): Promise<ScmDiscrepancyRecord>;
  resolveDiscrepancyRecord(
    tenantId: string,
    input: ResolveScmDiscrepancyRecordInput,
  ): Promise<ScmDiscrepancyRecord | null>;
  listDiscrepancyRecords(tenantId: string, filter?: ScmDiscrepancyRecordFilter): Promise<ScmDiscrepancyRecord[]>;

  // Accounting-ready events (SCM facts only; no Finance posting)
  createAccountingReadyEvent(tenantId: string, input: CreateScmAccountingReadyEventInput): Promise<ScmAccountingReadyEvent>;
  updateAccountingReadyEventState(
    tenantId: string,
    input: UpdateScmAccountingReadyEventStateInput,
  ): Promise<{
    event: ScmAccountingReadyEvent;
    transition: ScmAccountingReadyEventStateTransition;
  } | null>;
  findAccountingReadyEventById(tenantId: string, eventId: string): Promise<ScmAccountingReadyEvent | null>;
  findAccountingReadyEventByIdempotencyKey(
    tenantId: string,
    idempotencyKey: string,
  ): Promise<ScmAccountingReadyEvent | null>;
  listAccountingReadyEvents(tenantId: string, filter?: ScmAccountingReadyEventFilter): Promise<ScmAccountingReadyEvent[]>;

  // Return to vendor & receipt reversal
  createReturnToVendor(
    tenantId: string,
    input: CreateScmReturnToVendorInput,
  ): Promise<{ returnToVendor: ScmReturnToVendor; lines: ScmReturnToVendorLine[] }>;
  findReturnToVendorById(
    tenantId: string,
    returnToVendorId: string,
  ): Promise<{ returnToVendor: ScmReturnToVendor; lines: ScmReturnToVendorLine[] } | null>;
  findReturnToVendorByIdempotencyKey(
    tenantId: string,
    idempotencyKey: string,
  ): Promise<{ returnToVendor: ScmReturnToVendor; lines: ScmReturnToVendorLine[] } | null>;
  listReturnToVendors(tenantId: string, filter?: ScmReturnToVendorFilter): Promise<ScmReturnToVendor[]>;
  createReceiptReversal(
    tenantId: string,
    input: CreateScmReceiptReversalInput,
  ): Promise<{ reversal: ScmReceiptReversal; lines: ScmReceiptReversalLine[] }>;
  findReceiptReversalByReceivingRecordId(
    tenantId: string,
    receivingRecordId: string,
  ): Promise<{ reversal: ScmReceiptReversal; lines: ScmReceiptReversalLine[] } | null>;
  findReceiptReversalByIdempotencyKey(
    tenantId: string,
    idempotencyKey: string,
  ): Promise<{ reversal: ScmReceiptReversal; lines: ScmReceiptReversalLine[] } | null>;
  createValuationLayerAllocation(
    tenantId: string,
    input: CreateScmValuationLayerAllocationInput,
  ): Promise<ScmValuationLayerAllocation>;
  listValuationLayerAllocations(
    tenantId: string,
    filter?: ScmValuationLayerAllocationFilter,
  ): Promise<ScmValuationLayerAllocation[]>;

  // Reorder policies
  upsertReorderPolicy(tenantId: string, input: UpsertScmReorderPolicyInput): Promise<ScmReorderPolicy>;
  listReorderPolicies(tenantId: string, filter?: ScmReorderPolicyFilter): Promise<ScmReorderPolicy[]>;

  // Reservations
  createStockReservation(tenantId: string, input: CreateScmStockReservationInput): Promise<ScmStockReservation>;
  updateStockReservationStatus(
    tenantId: string,
    reservationId: string,
    status: ScmReservationStatus,
    timestamp: Date,
  ): Promise<ScmStockReservation | null>;
  findStockReservationById(tenantId: string, reservationId: string): Promise<ScmStockReservation | null>;
  listStockReservations(tenantId: string, filter?: ScmStockReservationFilter): Promise<ScmStockReservation[]>;

  // Transfers
  createStockTransfer(
    tenantId: string,
    input: CreateScmStockTransferInput,
  ): Promise<{ transfer: ScmStockTransfer; lines: ScmStockTransferLine[] }>;
  updateStockTransferProjection(
    tenantId: string,
    input: UpdateScmStockTransferProjectionInput,
  ): Promise<ScmStockTransfer | null>;
  deleteStockTransferWithoutWorkflow(tenantId: string, transferId: string): Promise<void>;
  recordStockTransferShipment(
    tenantId: string,
    input: RecordScmStockTransferShipmentInput,
  ): Promise<ScmStockTransferLine[]>;
  recordStockTransferReceipt(
    tenantId: string,
    input: RecordScmStockTransferReceiptInput,
  ): Promise<ScmStockTransferLine[]>;
  findStockTransferById(
    tenantId: string,
    transferId: string,
  ): Promise<{ transfer: ScmStockTransfer; lines: ScmStockTransferLine[] } | null>;
  listStockTransfers(tenantId: string, filter?: ScmStockTransferFilter): Promise<ScmStockTransfer[]>;

  // Stock opname
  createStockOpname(
    tenantId: string,
    input: CreateScmStockOpnameInput,
  ): Promise<{ opname: ScmStockOpname; lines: ScmStockOpnameLine[] }>;
  updateStockOpnameProjection(
    tenantId: string,
    input: UpdateScmStockOpnameProjectionInput,
  ): Promise<ScmStockOpname | null>;
  deleteStockOpnameWithoutWorkflow(tenantId: string, opnameId: string): Promise<void>;
  recordStockOpnameCount(
    tenantId: string,
    input: RecordScmStockOpnameCountInput,
  ): Promise<ScmStockOpnameLine | null>;
  linkOpnameLineAdjustmentMovement(
    tenantId: string,
    lineId: string,
    adjustmentMovementId: string,
  ): Promise<ScmStockOpnameLine | null>;
  findStockOpnameById(
    tenantId: string,
    opnameId: string,
  ): Promise<{ opname: ScmStockOpname; lines: ScmStockOpnameLine[] } | null>;
  listStockOpnames(tenantId: string, filter?: ScmStockOpnameFilter): Promise<ScmStockOpname[]>;

  // Valuation & landed cost
  createValuationLayer(tenantId: string, input: CreateScmValuationLayerInput): Promise<ScmValuationLayer>;
  updateValuationLayerRemainingQuantity(
    tenantId: string,
    input: ConsumeScmValuationLayerInput,
  ): Promise<ScmValuationLayer | null>;
  findValuationLayerById(tenantId: string, layerId: string): Promise<ScmValuationLayer | null>;
  listValuationLayers(tenantId: string, filter?: ScmValuationLayerFilter): Promise<ScmValuationLayer[]>;

  createLandedCost(
    tenantId: string,
    input: CreateScmLandedCostInput,
  ): Promise<{ landedCost: ScmLandedCost; allocations: ScmLandedCostAllocation[] }>;
  applyLandedCost(tenantId: string, input: ApplyScmLandedCostInput): Promise<ScmLandedCost | null>;
  findLandedCostById(
    tenantId: string,
    landedCostId: string,
  ): Promise<{ landedCost: ScmLandedCost; allocations: ScmLandedCostAllocation[] } | null>;
  listLandedCosts(tenantId: string, filter?: ScmLandedCostFilter): Promise<ScmLandedCost[]>;

  // RFQ / tender / bids
  createRfq(tenantId: string, input: CreateScmRfqInput): Promise<{
    rfq: ScmRfq;
    items: ScmRfqItem[];
    invitedSuppliers: ScmRfqInvitedSupplier[];
  }>;
  updateRfqProjection(tenantId: string, input: UpdateScmRfqProjectionInput): Promise<ScmRfq | null>;
  deleteRfqWithoutWorkflow(tenantId: string, rfqId: string): Promise<void>;
  findRfqById(tenantId: string, rfqId: string): Promise<{
    rfq: ScmRfq;
    items: ScmRfqItem[];
    invitedSuppliers: ScmRfqInvitedSupplier[];
  } | null>;
  listRfqs(tenantId: string, filter?: ScmRfqFilter): Promise<ScmRfq[]>;

  createSupplierBid(
    tenantId: string,
    input: CreateScmSupplierBidInput,
  ): Promise<{ bid: ScmSupplierBid; lines: ScmSupplierBidLine[] }>;
  updateSupplierBidScore(tenantId: string, input: UpdateScmSupplierBidScoreInput): Promise<ScmSupplierBid | null>;
  awardSupplierBid(tenantId: string, input: AwardScmSupplierBidInput): Promise<ScmSupplierBid | null>;
  findSupplierBidById(
    tenantId: string,
    bidId: string,
  ): Promise<{ bid: ScmSupplierBid; lines: ScmSupplierBidLine[] } | null>;
  listSupplierBids(tenantId: string, filter?: ScmSupplierBidFilter): Promise<ScmSupplierBid[]>;

  // Supplier evaluation & contracts
  createSupplierEvaluation(tenantId: string, input: CreateScmSupplierEvaluationInput): Promise<ScmSupplierEvaluation>;
  updateSupplierEvaluationProjection(
    tenantId: string,
    input: UpdateScmSupplierEvaluationProjectionInput,
  ): Promise<ScmSupplierEvaluation | null>;
  deleteSupplierEvaluationWithoutWorkflow(tenantId: string, evaluationId: string): Promise<void>;
  findSupplierEvaluationById(tenantId: string, evaluationId: string): Promise<ScmSupplierEvaluation | null>;
  listSupplierEvaluations(tenantId: string, filter?: ScmSupplierEvaluationFilter): Promise<ScmSupplierEvaluation[]>;

  createSupplierContract(
    tenantId: string,
    input: CreateScmSupplierContractInput,
  ): Promise<{ contract: ScmSupplierContract; items: ScmSupplierContractItem[] }>;
  updateSupplierContractProjection(
    tenantId: string,
    input: UpdateScmSupplierContractProjectionInput,
  ): Promise<ScmSupplierContract | null>;
  deleteSupplierContractWithoutWorkflow(tenantId: string, contractId: string): Promise<void>;
  recordSupplierContractSpend(
    tenantId: string,
    input: RecordScmSupplierContractSpendInput,
  ): Promise<ScmSupplierContract | null>;
  findSupplierContractById(
    tenantId: string,
    contractId: string,
  ): Promise<{ contract: ScmSupplierContract; items: ScmSupplierContractItem[] } | null>;
  listSupplierContracts(tenantId: string, filter?: ScmSupplierContractFilter): Promise<ScmSupplierContract[]>;

  // Spend analytics
  createSpendAnalyticsSnapshot(
    tenantId: string,
    input: CreateScmSpendAnalyticsSnapshotInput,
  ): Promise<ScmSpendAnalyticsSnapshot>;
  computeSpendAnalyticsSnapshot(
    tenantId: string,
    input: {
      periodType: ScmSpendAnalyticsPeriodType;
      periodStart: string;
      periodEnd: string;
      organizationUnitId?: string | null;
      createdBy?: string | null;
    },
  ): Promise<ScmSpendAnalyticsSnapshot>;
  findSpendAnalyticsSnapshotById(
    tenantId: string,
    snapshotId: string,
  ): Promise<ScmSpendAnalyticsSnapshot | null>;
  listSpendAnalyticsSnapshots(
    tenantId: string,
    filter?: ScmSpendAnalyticsSnapshotFilter,
  ): Promise<ScmSpendAnalyticsSnapshot[]>;

  // Data Scope support
  listOrganizationUnitDescendantIds(tenantId: string, rootIds: string[]): Promise<string[]>;

  // Cross-domain reference checks (mirrors Core's pattern)
  itemExists(tenantId: string, itemId: string): Promise<boolean>;
  supplierExists(tenantId: string, supplierId: string): Promise<boolean>;
  purchaseOrderExists(tenantId: string, purchaseOrderId: string): Promise<boolean>;
  purchaseRequestExists(tenantId: string, purchaseRequestId: string): Promise<boolean>;
  organizationUnitExists(tenantId: string, organizationUnitId: string): Promise<boolean>;
}
