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
  | "opname_out";

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

/** `availableQuantity` is always `quantity - reservedQty`, computed at read time. */
export interface ScmAdvancedStockBalance {
  id: string;
  tenantId: string;
  itemId: string;
  warehouseId: string;
  locationId: string | null;
  batchId: string | null;
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
  quantity: number;
  unitCost: number | null;
  totalCost: number | null;
  referenceType: string | null;
  referenceId: string | null;
  referenceNumber: string | null;
  notes: string | null;
  occurredAt: Date;
  createdBy: string | null;
  createdAt: Date;
}

export interface RecordScmAdvancedStockMovementInput {
  itemId: string;
  warehouseId: string;
  locationId?: string | null;
  batchId?: string | null;
  serialId?: string | null;
  movementType: ScmAdvancedStockMovementType;
  quantity: number;
  unitCost?: number | null;
  totalCost?: number | null;
  referenceType?: string | null;
  referenceId?: string | null;
  referenceNumber?: string | null;
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
  warehouseIds?: string[] | null;
}

export interface ScmAdvancedStockMovementFilter {
  itemId?: string;
  warehouseId?: string;
  warehouseIds?: string[] | null;
  movementType?: ScmAdvancedStockMovementType;
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
  ): Promise<ScmAdvancedStockBalance | null>;
  listAdvancedStockBalances(tenantId: string, filter?: ScmAdvancedStockBalanceFilter): Promise<ScmAdvancedStockBalance[]>;

  /** Writes an immutable movement row and applies the balance delta in one transaction. */
  recordAdvancedStockMovement(
    tenantId: string,
    input: RecordScmAdvancedStockMovementInput,
  ): Promise<{ movement: ScmAdvancedStockMovement; balance: ScmAdvancedStockBalance }>;
  listAdvancedStockMovements(tenantId: string, filter?: ScmAdvancedStockMovementFilter): Promise<ScmAdvancedStockMovement[]>;

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
