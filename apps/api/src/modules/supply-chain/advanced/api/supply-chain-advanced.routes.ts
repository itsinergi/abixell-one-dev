import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { SupplyChainAdvancedService } from "../application/supply-chain-advanced.service.js";
import type {
  CreateScmAccountingReadyEventInput,
  CreateScmInspectionInput,
  CreateScmReceivingRecordInput,
  CreateScmReceiptReversalInput,
  CreateScmReturnToVendorInput,
  ScmAccountAssignmentType,
  ScmAccountingOutboxState,
  ScmAccountingReadyEventType,
  ScmAccountingReconciliationState,
  ScmAdvancedStockMovementType,
  ScmDiscrepancyStatus,
  ScmDiscrepancyType,
  ScmLandedCostStatus,
  ScmOpnameStatus,
  ScmProcurementType,
  ScmReceivingStatus,
  ScmReservationStatus,
  ScmReturnToVendorStatus,
  ScmRfqStatus,
  ScmSerialStatus,
  ScmSpendAnalyticsPeriodType,
  ScmSupplierContractStatus,
  ScmSupplierContractType,
  ScmSupplierEvaluationStatus,
  ScmSupplierRatingGrade,
  ScmTransferStatus,
} from "../domain/supply-chain-advanced.entity.js";

/**
 * Supply Chain Advanced HTTP routes (Wave A5: SCM-ADV-001…008).
 *
 * Scope:
 * - SCM-ADV-001/002/003: Multi-warehouse, Bin/Location, Batch/Lot & Serial tracking
 * - SCM-ADV-004: Reservation, Reorder, Transfer, and Stock Opname
 * - SCM-ADV-005: Inventory Valuation & Landed Cost
 * - SCM-ADV-006: RFQ, Tender & Bid Comparison
 * - SCM-ADV-007: Supplier Evaluation & Contract Purchasing
 * - SCM-ADV-008: Spend Analytics Snapshots
 */

const dateOnlyRegex = /^\d{4}-\d{2}-\d{2}$/;

const idParamSchema = z.object({ id: z.string().uuid() });
const actionSchema = z.object({
  actionCode: z.string().min(1),
  comment: z.string().nullable().optional(),
});

// 1. Warehouses & Locations
const createWarehouseSchema = z.object({
  code: z.string().min(1),
  name: z.string().min(1),
  siteId: z.string().uuid().nullable().optional(),
  organizationUnitId: z.string().uuid().nullable().optional(),
  address: z.string().nullable().optional(),
  isActive: z.boolean().optional(),
});
const updateWarehouseSchema = z.object({
  name: z.string().min(1).optional(),
  siteId: z.string().uuid().nullable().optional(),
  organizationUnitId: z.string().uuid().nullable().optional(),
  address: z.string().nullable().optional(),
  isActive: z.boolean().optional(),
});

const createWarehouseLocationSchema = z.object({
  warehouseId: z.string().uuid(),
  code: z.string().min(1),
  zone: z.string().nullable().optional(),
  aisle: z.string().nullable().optional(),
  rack: z.string().nullable().optional(),
  shelf: z.string().nullable().optional(),
  bin: z.string().nullable().optional(),
  isActive: z.boolean().optional(),
});
const updateWarehouseLocationSchema = z.object({
  zone: z.string().nullable().optional(),
  aisle: z.string().nullable().optional(),
  rack: z.string().nullable().optional(),
  shelf: z.string().nullable().optional(),
  bin: z.string().nullable().optional(),
  isActive: z.boolean().optional(),
});

// Batches & Serials
const createItemBatchSchema = z.object({
  itemId: z.string().uuid(),
  batchNumber: z.string().optional(),
  manufacturedDate: z.string().regex(dateOnlyRegex).nullable().optional(),
  expiryDate: z.string().regex(dateOnlyRegex).nullable().optional(),
  supplierId: z.string().uuid().nullable().optional(),
  notes: z.string().nullable().optional(),
  isActive: z.boolean().optional(),
});

const createItemSerialSchema = z.object({
  itemId: z.string().uuid(),
  serialNumber: z.string().min(1),
  batchId: z.string().uuid().nullable().optional(),
  warehouseId: z.string().uuid().nullable().optional(),
  locationId: z.string().uuid().nullable().optional(),
  status: z
    .enum(["in_stock", "reserved", "issued", "in_transit", "disposed", "maintenance"])
    .optional(),
  warrantyExpiryDate: z.string().regex(dateOnlyRegex).nullable().optional(),
  notes: z.string().nullable().optional(),
});
const updateItemSerialSchema = z.object({
  batchId: z.string().uuid().nullable().optional(),
  warehouseId: z.string().uuid().nullable().optional(),
  locationId: z.string().uuid().nullable().optional(),
  status: z
    .enum(["in_stock", "reserved", "issued", "in_transit", "disposed", "maintenance"])
    .optional(),
  warrantyExpiryDate: z.string().regex(dateOnlyRegex).nullable().optional(),
  notes: z.string().nullable().optional(),
});

// Advanced Stock Movement
const recordAdvancedMovementSchema = z.object({
  itemId: z.string().uuid(),
  warehouseId: z.string().uuid(),
  locationId: z.string().uuid().nullable().optional(),
  batchId: z.string().uuid().nullable().optional(),
  serialId: z.string().uuid().nullable().optional(),
  movementType: z.enum([
    "in",
    "out",
    "transfer_in",
    "transfer_out",
    "adjustment_in",
    "adjustment_out",
    "opname_in",
    "opname_out",
  ]),
  quantity: z.number().refine((n) => n !== 0, { message: "quantity cannot be zero" }),
  unitCost: z.number().nonnegative().optional(),
  totalCost: z.number().nonnegative().optional(),
  referenceType: z.string().nullable().optional(),
  referenceId: z.string().uuid().nullable().optional(),
  referenceNumber: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
  occurredAt: z.string().datetime().optional().transform((d) => (d ? new Date(d) : undefined)),
});

// Reorder Policies
const upsertReorderPolicySchema = z.object({
  itemId: z.string().uuid(),
  warehouseId: z.string().uuid().nullable().optional(),
  minQuantity: z.number().nonnegative(),
  reorderPoint: z.number().nonnegative(),
  reorderQuantity: z.number().positive(),
  safetyStock: z.number().nonnegative().optional(),
  leadTimeDays: z.number().int().nonnegative().optional(),
  isActive: z.boolean().optional(),
});

// Reservations
const createStockReservationSchema = z.object({
  reservationNumber: z.string().min(1),
  itemId: z.string().uuid(),
  warehouseId: z.string().uuid(),
  locationId: z.string().uuid().nullable().optional(),
  batchId: z.string().uuid().nullable().optional(),
  quantity: z.number().positive(),
  reservedForType: z.string().min(1),
  reservedForId: z.string().uuid().nullable().optional(),
  reservedForNumber: z.string().nullable().optional(),
  validUntil: z.string().datetime().nullable().optional().transform((d) => (d ? new Date(d) : null)),
  notes: z.string().nullable().optional(),
});

// Transfers
const createStockTransferSchema = z.object({
  fromWarehouseId: z.string().uuid(),
  toWarehouseId: z.string().uuid(),
  transferNumber: z.string().optional(),
  notes: z.string().nullable().optional(),
  lines: z
    .array(
      z.object({
        itemId: z.string().uuid(),
        quantityRequested: z.number().positive(),
        batchId: z.string().uuid().nullable().optional(),
        fromLocationId: z.string().uuid().nullable().optional(),
        toLocationId: z.string().uuid().nullable().optional(),
        notes: z.string().nullable().optional(),
        sortOrder: z.number().int().optional(),
      }),
    )
    .min(1),
});
const recordTransferShipmentSchema = z.object({
  transferId: z.string().uuid(),
  lineShipments: z
    .array(
      z.object({
        lineId: z.string().uuid(),
        quantityShipped: z.number().positive(),
      }),
    )
    .min(1),
});
const recordTransferReceiptSchema = z.object({
  transferId: z.string().uuid(),
  lineReceipts: z
    .array(
      z.object({
        lineId: z.string().uuid(),
        quantityReceived: z.number().positive(),
      }),
    )
    .min(1),
});

// Stock Opname
const createStockOpnameSchema = z.object({
  warehouseId: z.string().uuid(),
  opnameDate: z.string().regex(dateOnlyRegex),
  opnameNumber: z.string().optional(),
  notes: z.string().nullable().optional(),
  lines: z
    .array(
      z.object({
        itemId: z.string().uuid(),
        locationId: z.string().uuid().nullable().optional(),
        batchId: z.string().uuid().nullable().optional(),
        systemQuantity: z.number().nonnegative(),
        physicalQuantity: z.number().nonnegative().nullable().optional(),
        notes: z.string().nullable().optional(),
        sortOrder: z.number().int().optional(),
      }),
    )
    .min(1),
});
const recordOpnameCountSchema = z.object({
  lineId: z.string().uuid(),
  physicalQuantity: z.number().nonnegative(),
});

// Valuation Layers & Landed Cost
const createValuationLayerSchema = z.object({
  itemId: z.string().uuid(),
  warehouseId: z.string().uuid().nullable().optional(),
  receiptMovementId: z.string().uuid().nullable().optional(),
  receivedDate: z.string().regex(dateOnlyRegex),
  originalQuantity: z.number().positive(),
  remainingQuantity: z.number().positive().optional(),
  unitCost: z.number().nonnegative(),
  landedCostAdded: z.number().nonnegative().optional(),
  effectiveUnitCost: z.number().nonnegative().optional(),
  totalValue: z.number().nonnegative().optional(),
});
const consumeValuationLayerSchema = z.object({
  layerId: z.string().uuid(),
  remainingQuantity: z.number().nonnegative(),
});
const createLandedCostSchema = z.object({
  purchaseOrderId: z.string().uuid(),
  costType: z.string().min(1),
  currency: z.string().optional(),
  amount: z.number().positive(),
  allocationMethod: z.enum(["by_value", "by_quantity", "by_weight", "equal"]),
  voucherNumber: z.string().optional(),
  notes: z.string().nullable().optional(),
  allocations: z
    .array(
      z.object({
        itemId: z.string().uuid(),
        valuationLayerId: z.string().uuid().nullable().optional(),
        allocatedAmount: z.number().nonnegative(),
        costPerUnitAdded: z.number().nonnegative(),
      }),
    )
    .min(1),
});

// RFQ, Tender & Bids
const createRfqSchema = z.object({
  title: z.string().min(1),
  procurementType: z.enum(["rfq", "tender", "direct_sourcing"]),
  organizationUnitId: z.string().uuid().nullable().optional(),
  purchaseRequestId: z.string().uuid().nullable().optional(),
  submissionDeadline: z.string().datetime().transform((d) => new Date(d)),
  rfqNumber: z.string().optional(),
  notes: z.string().nullable().optional(),
  items: z
    .array(
      z.object({
        itemId: z.string().uuid(),
        targetQuantity: z.number().positive(),
        targetUnitPrice: z.number().nonnegative().nullable().optional(),
        specifications: z.string().nullable().optional(),
        sortOrder: z.number().int().optional(),
      }),
    )
    .min(1),
  invitedSuppliers: z
    .array(
      z.object({
        supplierId: z.string().uuid(),
        respondedAt: z.string().datetime().nullable().optional().transform((d) => (d ? new Date(d) : null)),
      }),
    )
    .default([]),
});
const submitSupplierBidSchema = z.object({
  rfqId: z.string().uuid(),
  supplierId: z.string().uuid(),
  currency: z.string().optional(),
  totalAmount: z.number().nonnegative().optional(),
  bidNumber: z.string().optional(),
  validUntil: z.string().nullable().optional(),
  leadTimeDays: z.number().int().nonnegative().optional(),
  notes: z.string().nullable().optional(),
  lines: z
    .array(
      z.object({
        rfqItemId: z.string().uuid(),
        offeredQuantity: z.number().positive(),
        offeredUnitPrice: z.number().nonnegative(),
        offeredTotalPrice: z.number().nonnegative(),
        remarks: z.string().nullable().optional(),
      }),
    )
    .min(1),
});
const scoreSupplierBidSchema = z.object({
  commercialScore: z.number().min(0).max(100).nullable().optional(),
  technicalScore: z.number().min(0).max(100).nullable().optional(),
  rank: z.number().int().positive().nullable().optional(),
  status: z.enum(["submitted", "evaluated", "shortlisted", "awarded", "rejected"]).optional(),
});
const awardSupplierBidSchema = z.object({
  bidId: z.string().uuid(),
  resultingPurchaseOrderId: z.string().uuid().nullable().optional(),
});

// Supplier Evaluation & Contracts
const createSupplierEvaluationSchema = z.object({
  supplierId: z.string().uuid(),
  evaluationPeriod: z.string().min(1),
  periodStartDate: z.string().regex(dateOnlyRegex),
  periodEndDate: z.string().regex(dateOnlyRegex),
  qualityScore: z.number().min(0).max(100).optional(),
  deliveryScore: z.number().min(0).max(100).optional(),
  pricingScore: z.number().min(0).max(100).optional(),
  serviceScore: z.number().min(0).max(100).optional(),
  evaluationNumber: z.string().optional(),
  notes: z.string().nullable().optional(),
});
const createSupplierContractSchema = z.object({
  supplierId: z.string().uuid(),
  title: z.string().min(1),
  contractType: z.enum(["blanket_po", "fixed_price", "service_rate", "consignment"]),
  startDate: z.string().regex(dateOnlyRegex),
  endDate: z.string().regex(dateOnlyRegex),
  currency: z.string().optional(),
  committedAmount: z.number().nonnegative().optional(),
  termsAndConditions: z.string().nullable().optional(),
  contractNumber: z.string().optional(),
  items: z.array(
    z.object({
      itemId: z.string().uuid(),
      agreedUnitPrice: z.number().nonnegative(),
      minOrderQuantity: z.number().nonnegative().optional(),
      maxOrderQuantity: z.number().nonnegative().nullable().optional(),
      leadTimeDays: z.number().int().nonnegative().optional(),
      notes: z.string().nullable().optional(),
    }),
  ),
});
const recordContractSpendSchema = z.object({
  additionalSpentAmount: z.number().positive(),
});

// Spend Analytics
const computeSpendSnapshotSchema = z.object({
  periodType: z.enum(["monthly", "quarterly", "yearly"]),
  periodStart: z.string().regex(dateOnlyRegex),
  periodEnd: z.string().regex(dateOnlyRegex),
  organizationUnitId: z.string().uuid().optional(),
});

// Wave A5.1 Stage 1: Account Assignment, Receiving, Inspection, Discrepancies, Returns, Reversals, Accounting Events
const updateAccountAssignmentConfigSchema = z.object({
  assignmentType: z.enum([
    "stock",
    "expense",
    "asset",
    "project",
    "work_order",
    "service",
  ]),
  requiredDimensions: z.array(z.string()).optional(),
  inventoryRelevant: z.boolean().optional(),
  isActive: z.boolean().optional(),
});

const createReceivingLineSchema = z.object({
  purchaseOrderLineId: z.string().uuid(),
  itemId: z.string().uuid(),
  warehouseId: z.string().uuid().nullable().optional(),
  locationId: z.string().uuid().nullable().optional(),
  batchId: z.string().uuid().nullable().optional(),
  stockCondition: z.enum(["unrestricted", "quality_hold", "rejected", "quarantined", "blocked", "in_transit", "in_repair"]).optional(),
  ownerType: z.enum(["own", "supplier", "customer"]).optional(),
  ownerPartyId: z.string().uuid().nullable().optional(),
  quantityReceived: z.number().positive(),
  unitCost: z.number().nonnegative().nullable().optional(),
  currency: z.string().optional(),
  accountAssignmentType: z.enum([
    "stock",
    "expense",
    "asset",
    "project",
    "work_order",
    "service",
  ]),
  accountAssignmentDimensions: z.record(z.unknown()).optional(),
  inspectionRequired: z.boolean().optional(),
  holdMovementId: z.string().uuid().nullable().optional(),
  notes: z.string().nullable().optional(),
  sortOrder: z.number().int().optional(),
});

const createReceivingRecordSchema = z.object({
  idempotencyKey: z.string().min(1),
  purchaseOrderId: z.string().uuid(),
  supplierId: z.string().uuid(),
  warehouseId: z.string().uuid(),
  locationId: z.string().uuid().nullable().optional(),
  receiptNumber: z.string().optional(),
  receivedAt: z.string().datetime().optional().transform((d) => (d ? new Date(d) : undefined)),
  receivedBy: z.string().uuid().nullable().optional(),
  notes: z.string().nullable().optional(),
  lines: z.array(createReceivingLineSchema).min(1),
});

const createInspectionSchema = z.object({
  receivingLineId: z.string().uuid(),
  idempotencyKey: z.string().min(1),
  inspectionNumber: z.string().optional(),
  inspectedAt: z.string().datetime().optional().transform((d) => (d ? new Date(d) : undefined)),
  inspectedBy: z.string().uuid().nullable().optional(),
  quantityAccepted: z.number().nonnegative().optional(),
  quantityRejected: z.number().nonnegative().optional(),
  quantityQuarantined: z.number().nonnegative().optional(),
  result: z.enum(["accepted", "rejected", "mixed", "quarantined"]),
  reason: z.string().nullable().optional(),
});

const createDiscrepancyRecordSchema = z.object({
  receivingLineId: z.string().uuid(),
  discrepancyType: z.enum(["shortage", "overage", "damage", "quality", "document"]),
  quantity: z.number().nonnegative().nullable().optional(),
  description: z.string().min(1),
});

const resolveDiscrepancyRecordSchema = z.object({
  status: z.enum(["resolved", "cancelled"]),
  resolvedAt: z.string().datetime().optional().transform((d) => (d ? new Date(d) : undefined)),
  resolvedBy: z.string().uuid().nullable().optional(),
  resolutionNotes: z.string().nullable().optional(),
});

const createReturnToVendorLineSchema = z.object({
  receivingLineId: z.string().uuid().nullable().optional(),
  itemId: z.string().uuid(),
  warehouseId: z.string().uuid(),
  locationId: z.string().uuid().nullable().optional(),
  batchId: z.string().uuid().nullable().optional(),
  stockCondition: z.enum(["unrestricted", "quality_hold", "rejected", "quarantined", "blocked", "in_transit", "in_repair"]),
  ownerType: z.enum(["own", "supplier", "customer"]),
  ownerPartyId: z.string().uuid().nullable().optional(),
  quantity: z.number().positive(),
  movementId: z.string().uuid().nullable().optional(),
  accountingReadyEventId: z.string().uuid().nullable().optional(),
  notes: z.string().nullable().optional(),
  sortOrder: z.number().int().optional(),
});

const createReturnToVendorSchema = z.object({
  idempotencyKey: z.string().min(1),
  returnNumber: z.string().optional(),
  supplierId: z.string().uuid(),
  purchaseOrderId: z.string().uuid().nullable().optional(),
  warehouseId: z.string().uuid(),
  returnedAt: z.string().datetime().optional().transform((d) => (d ? new Date(d) : undefined)),
  returnedBy: z.string().uuid().nullable().optional(),
  reason: z.string().min(1),
  notes: z.string().nullable().optional(),
  lines: z.array(createReturnToVendorLineSchema).min(1),
});

const createReceiptReversalSchema = z.object({
  idempotencyKey: z.string().min(1),
  reversalNumber: z.string().optional(),
  receivingRecordId: z.string().uuid(),
  reason: z.string().min(1),
  reversedAt: z.string().datetime().optional().transform((d) => (d ? new Date(d) : undefined)),
  reversedBy: z.string().uuid().nullable().optional(),
});

const createAccountingReadyEventSchema = z.object({
  eventType: z.enum([
    "inventory.goods_received",
    "inventory.goods_issued",
    "inventory.transferred",
    "inventory.adjusted",
    "inventory.returned_to_vendor",
    "inventory.receipt_reversed",
    "inventory.landed_cost_applied",
    "inventory.consignment_consumed",
    "service.accepted",
    "inventory.disposed",
  ]),
  sourceDocumentType: z.string().min(1),
  sourceDocumentId: z.string().uuid(),
  sourceDocumentLineId: z.string().uuid().nullable().optional(),
  sourceMovementId: z.string().uuid().nullable().optional(),
  sourceDocumentRevision: z.number().int().optional(),
  effectiveAt: z.string().datetime().optional().transform((d) => (d ? new Date(d) : undefined)),
  currency: z.string().optional(),
  amount: z.number().nonnegative().optional(),
  quantity: z.number().nullable().optional(),
  unitCost: z.number().nullable().optional(),
  accountAssignmentType: z.enum([
    "stock",
    "expense",
    "asset",
    "project",
    "work_order",
    "service",
  ]).nullable().optional(),
  accountAssignmentDimensions: z.record(z.unknown()).optional(),
  idempotencyKey: z.string().min(1),
  reversalOfEventId: z.string().uuid().nullable().optional(),
  payload: z.record(z.unknown()).optional(),
});

const updateAccountingReadyEventStateSchema = z.object({
  stateKind: z.enum(["outbox", "reconciliation"]),
  toState: z.string().min(1),
  reason: z.string().nullable().optional(),
  occurredAt: z.string().datetime().optional().transform((d) => (d ? new Date(d) : undefined)),
});

function query(q: unknown): Record<string, string | undefined> {
  return (q ?? {}) as Record<string, string | undefined>;
}

export function registerSupplyChainAdvancedRoutes(
  app: FastifyInstance,
  deps: { supplyChainAdvanced: SupplyChainAdvancedService },
): void {
  const svc = () => deps.supplyChainAdvanced;

  // =========================================================================
  // 1. Multi-Warehouse & Storage Locations (SCM-ADV-001)
  // =========================================================================

  app.post("/supply-chain/advanced/warehouses", { preHandler: app.authenticate }, async (req, reply) => {
    const body = createWarehouseSchema.parse(req.body);
    return reply.status(201).send(await svc().createWarehouse(req.actor!, body));
  });

  app.patch("/supply-chain/advanced/warehouses/:id", { preHandler: app.authenticate }, async (req, reply) => {
    const { id } = idParamSchema.parse(req.params);
    const body = updateWarehouseSchema.parse(req.body);
    return reply.send(await svc().updateWarehouse(req.actor!, id, body));
  });

  app.get("/supply-chain/advanced/warehouses/:id", { preHandler: app.authenticate }, async (req, reply) => {
    const { id } = idParamSchema.parse(req.params);
    return reply.send(await svc().getWarehouse(req.actor!, id));
  });

  app.get("/supply-chain/advanced/warehouses", { preHandler: app.authenticate }, async (req, reply) => {
    const q = query(req.query);
    return reply.send(
      await svc().listWarehouses(req.actor!, {
        siteId: q.siteId,
        organizationUnitIds: q.organizationUnitId ? [q.organizationUnitId] : undefined,
        activeOnly: q.activeOnly === "true",
      }),
    );
  });

  app.post("/supply-chain/advanced/warehouse-locations", { preHandler: app.authenticate }, async (req, reply) => {
    const body = createWarehouseLocationSchema.parse(req.body);
    return reply.status(201).send(await svc().createWarehouseLocation(req.actor!, body));
  });

  app.patch("/supply-chain/advanced/warehouse-locations/:id", { preHandler: app.authenticate }, async (req, reply) => {
    const { id } = idParamSchema.parse(req.params);
    const body = updateWarehouseLocationSchema.parse(req.body);
    return reply.send(await svc().updateWarehouseLocation(req.actor!, id, body));
  });

  app.get("/supply-chain/advanced/warehouse-locations/:id", { preHandler: app.authenticate }, async (req, reply) => {
    const { id } = idParamSchema.parse(req.params);
    return reply.send(await svc().getWarehouseLocation(req.actor!, id));
  });

  app.get("/supply-chain/advanced/warehouse-locations", { preHandler: app.authenticate }, async (req, reply) => {
    const q = query(req.query);
    return reply.send(
      await svc().listWarehouseLocations(req.actor!, {
        warehouseId: q.warehouseId,
        activeOnly: q.activeOnly === "true",
      }),
    );
  });

  // =========================================================================
  // 2. Batch/Lot & Serial Tracking (SCM-ADV-002, SCM-ADV-003)
  // =========================================================================

  app.post("/supply-chain/advanced/batches", { preHandler: app.authenticate }, async (req, reply) => {
    const body = createItemBatchSchema.parse(req.body);
    return reply.status(201).send(await svc().createBatch(req.actor!, body));
  });

  app.get("/supply-chain/advanced/batches/:id", { preHandler: app.authenticate }, async (req, reply) => {
    const { id } = idParamSchema.parse(req.params);
    return reply.send(await svc().getBatch(req.actor!, id));
  });

  app.get("/supply-chain/advanced/batches", { preHandler: app.authenticate }, async (req, reply) => {
    const q = query(req.query);
    return reply.send(
      await svc().listBatches(req.actor!, {
        itemId: q.itemId,
        includeExpired: q.includeExpired === "true",
      }),
    );
  });

  app.post("/supply-chain/advanced/serials", { preHandler: app.authenticate }, async (req, reply) => {
    const body = createItemSerialSchema.parse(req.body);
    return reply.status(201).send(await svc().createSerial(req.actor!, body));
  });

  app.patch("/supply-chain/advanced/serials/:id", { preHandler: app.authenticate }, async (req, reply) => {
    const { id } = idParamSchema.parse(req.params);
    const body = updateItemSerialSchema.parse(req.body);
    return reply.send(await svc().updateSerial(req.actor!, id, body));
  });

  app.get("/supply-chain/advanced/serials/:id", { preHandler: app.authenticate }, async (req, reply) => {
    const { id } = idParamSchema.parse(req.params);
    return reply.send(await svc().getSerial(req.actor!, id));
  });

  app.get("/supply-chain/advanced/serials", { preHandler: app.authenticate }, async (req, reply) => {
    const q = query(req.query);
    return reply.send(
      await svc().listSerials(req.actor!, {
        itemId: q.itemId,
        warehouseId: q.warehouseId,
        locationId: q.locationId,
        batchId: q.batchId,
        status: q.status as ScmSerialStatus | undefined,
      }),
    );
  });

  // =========================================================================
  // 3. Stock Balances & Immutable Ledger Movements
  // =========================================================================

  app.get("/supply-chain/advanced/balances", { preHandler: app.authenticate }, async (req, reply) => {
    const q = query(req.query);
    return reply.send(
      await svc().listStockBalances(req.actor!, {
        itemId: q.itemId,
        warehouseId: q.warehouseId,
        locationId: q.locationId,
        batchId: q.batchId,
      }),
    );
  });

  app.post("/supply-chain/advanced/movements", { preHandler: app.authenticate }, async (req, reply) => {
    const body = recordAdvancedMovementSchema.parse(req.body);
    return reply.status(201).send(await svc().recordStockMovement(req.actor!, body));
  });

  app.get("/supply-chain/advanced/movements", { preHandler: app.authenticate }, async (req, reply) => {
    const q = query(req.query);
    return reply.send(
      await svc().listStockMovements(req.actor!, {
        itemId: q.itemId,
        warehouseId: q.warehouseId,
        movementType: q.movementType as ScmAdvancedStockMovementType | undefined,
        limit: q.limit ? Number(q.limit) : undefined,
      }),
    );
  });

  // =========================================================================
  // 4. Reorder Policies & Stock Reservations (SCM-ADV-004)
  // =========================================================================

  app.put("/supply-chain/advanced/reorder-policies", { preHandler: app.authenticate }, async (req, reply) => {
    const body = upsertReorderPolicySchema.parse(req.body);
    return reply.send(await svc().upsertReorderPolicy(req.actor!, body));
  });

  app.get("/supply-chain/advanced/reorder-policies", { preHandler: app.authenticate }, async (req, reply) => {
    const q = query(req.query);
    return reply.send(
      await svc().listReorderPolicies(req.actor!, {
        itemId: q.itemId,
        warehouseId: q.warehouseId,
        activeOnly: q.activeOnly === "true",
      }),
    );
  });

  app.get("/supply-chain/advanced/reorder-alerts", { preHandler: app.authenticate }, async (req, reply) => {
    const q = query(req.query);
    return reply.send(await svc().computeReorderAlerts(req.actor!, q.warehouseId));
  });

  app.post("/supply-chain/advanced/reservations", { preHandler: app.authenticate }, async (req, reply) => {
    const body = createStockReservationSchema.parse(req.body);
    return reply.status(201).send(await svc().createStockReservation(req.actor!, body));
  });

  app.post("/supply-chain/advanced/reservations/:id/fulfill", { preHandler: app.authenticate }, async (req, reply) => {
    const { id } = idParamSchema.parse(req.params);
    return reply.send(await svc().fulfillStockReservation(req.actor!, id));
  });

  app.post("/supply-chain/advanced/reservations/:id/cancel", { preHandler: app.authenticate }, async (req, reply) => {
    const { id } = idParamSchema.parse(req.params);
    return reply.send(await svc().cancelStockReservation(req.actor!, id));
  });

  app.get("/supply-chain/advanced/reservations", { preHandler: app.authenticate }, async (req, reply) => {
    const q = query(req.query);
    return reply.send(
      await svc().listStockReservations(req.actor!, {
        itemId: q.itemId,
        warehouseId: q.warehouseId,
        status: q.status as ScmReservationStatus | undefined,
        reservedForType: q.reservedForType,
      }),
    );
  });

  // =========================================================================
  // 5. Stock Transfers & Opnames (SCM-ADV-004)
  // =========================================================================

  app.post("/supply-chain/advanced/transfers", { preHandler: app.authenticate }, async (req, reply) => {
    const body = createStockTransferSchema.parse(req.body);
    return reply.status(201).send(await svc().createStockTransfer(req.actor!, body));
  });

  app.get("/supply-chain/advanced/transfers/:id", { preHandler: app.authenticate }, async (req, reply) => {
    const { id } = idParamSchema.parse(req.params);
    return reply.send(await svc().getStockTransfer(req.actor!, id));
  });

  app.get("/supply-chain/advanced/transfers", { preHandler: app.authenticate }, async (req, reply) => {
    const q = query(req.query);
    return reply.send(
      await svc().listStockTransfers(req.actor!, {
        fromWarehouseId: q.fromWarehouseId,
        toWarehouseId: q.toWarehouseId,
        status: q.status as ScmTransferStatus | undefined,
      }),
    );
  });

  app.post("/supply-chain/advanced/transfers/:id/act", { preHandler: app.authenticate }, async (req, reply) => {
    const { id } = idParamSchema.parse(req.params);
    const body = actionSchema.parse(req.body);
    return reply.send(await svc().actOnStockTransfer(req.actor!, id, body.actionCode, body.comment ?? undefined));
  });

  app.post("/supply-chain/advanced/transfers/shipments", { preHandler: app.authenticate }, async (req, reply) => {
    const body = recordTransferShipmentSchema.parse(req.body);
    return reply.send(await svc().recordStockTransferShipment(req.actor!, body));
  });

  app.post("/supply-chain/advanced/transfers/receipts", { preHandler: app.authenticate }, async (req, reply) => {
    const body = recordTransferReceiptSchema.parse(req.body);
    return reply.send(await svc().recordStockTransferReceipt(req.actor!, body));
  });

  app.post("/supply-chain/advanced/opnames", { preHandler: app.authenticate }, async (req, reply) => {
    const body = createStockOpnameSchema.parse(req.body);
    return reply.status(201).send(await svc().createStockOpname(req.actor!, body));
  });

  app.get("/supply-chain/advanced/opnames/:id", { preHandler: app.authenticate }, async (req, reply) => {
    const { id } = idParamSchema.parse(req.params);
    return reply.send(await svc().getStockOpname(req.actor!, id));
  });

  app.get("/supply-chain/advanced/opnames", { preHandler: app.authenticate }, async (req, reply) => {
    const q = query(req.query);
    return reply.send(
      await svc().listStockOpnames(req.actor!, {
        warehouseId: q.warehouseId,
        status: q.status as ScmOpnameStatus | undefined,
      }),
    );
  });

  app.post("/supply-chain/advanced/opnames/counts", { preHandler: app.authenticate }, async (req, reply) => {
    const body = recordOpnameCountSchema.parse(req.body);
    return reply.send(await svc().recordStockOpnameCount(req.actor!, body));
  });

  app.post("/supply-chain/advanced/opnames/:id/act", { preHandler: app.authenticate }, async (req, reply) => {
    const { id } = idParamSchema.parse(req.params);
    const body = actionSchema.parse(req.body);
    return reply.send(await svc().actOnStockOpname(req.actor!, id, body.actionCode, body.comment ?? undefined));
  });

  // =========================================================================
  // 6. Valuation & Landed Cost (SCM-ADV-005)
  // =========================================================================

  app.post("/supply-chain/advanced/valuation-layers", { preHandler: app.authenticate }, async (req, reply) => {
    const body = createValuationLayerSchema.parse(req.body);
    return reply.status(201).send(await svc().createValuationLayer(req.actor!, body));
  });

  app.post("/supply-chain/advanced/valuation-layers/consume", { preHandler: app.authenticate }, async (req, reply) => {
    const body = consumeValuationLayerSchema.parse(req.body);
    return reply.send(await svc().consumeValuationLayer(req.actor!, body));
  });

  app.get("/supply-chain/advanced/valuation-layers", { preHandler: app.authenticate }, async (req, reply) => {
    const q = query(req.query);
    return reply.send(
      await svc().listValuationLayers(req.actor!, {
        itemId: q.itemId,
        warehouseId: q.warehouseId,
      }),
    );
  });

  app.post("/supply-chain/advanced/landed-costs", { preHandler: app.authenticate }, async (req, reply) => {
    const body = createLandedCostSchema.parse(req.body);
    return reply.status(201).send(await svc().createLandedCost(req.actor!, body));
  });

  app.post("/supply-chain/advanced/landed-costs/:id/apply", { preHandler: app.authenticate }, async (req, reply) => {
    const { id } = idParamSchema.parse(req.params);
    return reply.send(await svc().applyLandedCost(req.actor!, id));
  });

  app.get("/supply-chain/advanced/landed-costs/:id", { preHandler: app.authenticate }, async (req, reply) => {
    const { id } = idParamSchema.parse(req.params);
    return reply.send(await svc().getLandedCost(req.actor!, id));
  });

  app.get("/supply-chain/advanced/landed-costs", { preHandler: app.authenticate }, async (req, reply) => {
    const q = query(req.query);
    return reply.send(
      await svc().listLandedCosts(req.actor!, {
        purchaseOrderId: q.purchaseOrderId,
        status: q.status as ScmLandedCostStatus | undefined,
      }),
    );
  });

  // =========================================================================
  // 7. RFQ, Tender & Bid Comparison (SCM-ADV-006)
  // =========================================================================

  app.post("/supply-chain/advanced/rfqs", { preHandler: app.authenticate }, async (req, reply) => {
    const body = createRfqSchema.parse(req.body);
    return reply.status(201).send(await svc().createRfq(req.actor!, body));
  });

  app.get("/supply-chain/advanced/rfqs/:id", { preHandler: app.authenticate }, async (req, reply) => {
    const { id } = idParamSchema.parse(req.params);
    return reply.send(await svc().getRfq(req.actor!, id));
  });

  app.get("/supply-chain/advanced/rfqs", { preHandler: app.authenticate }, async (req, reply) => {
    const q = query(req.query);
    return reply.send(
      await svc().listRfqs(req.actor!, {
        procurementType: q.procurementType as ScmProcurementType | undefined,
        status: q.status as ScmRfqStatus | undefined,
        organizationUnitIds: q.organizationUnitId ? [q.organizationUnitId] : undefined,
      }),
    );
  });

  app.post("/supply-chain/advanced/rfqs/:id/act", { preHandler: app.authenticate }, async (req, reply) => {
    const { id } = idParamSchema.parse(req.params);
    const body = actionSchema.parse(req.body);
    return reply.send(await svc().actOnRfq(req.actor!, id, body.actionCode, body.comment ?? undefined));
  });

  app.post("/supply-chain/advanced/bids", { preHandler: app.authenticate }, async (req, reply) => {
    const body = submitSupplierBidSchema.parse(req.body);
    return reply.status(201).send(await svc().submitSupplierBid(req.actor!, body));
  });

  app.get("/supply-chain/advanced/bids/:id", { preHandler: app.authenticate }, async (req, reply) => {
    const { id } = idParamSchema.parse(req.params);
    return reply.send(await svc().getSupplierBid(req.actor!, id));
  });

  app.patch("/supply-chain/advanced/bids/:id/score", { preHandler: app.authenticate }, async (req, reply) => {
    const { id } = idParamSchema.parse(req.params);
    const body = scoreSupplierBidSchema.parse(req.body);
    return reply.send(await svc().scoreSupplierBid(req.actor!, id, body));
  });

  app.post("/supply-chain/advanced/bids/award", { preHandler: app.authenticate }, async (req, reply) => {
    const body = awardSupplierBidSchema.parse(req.body);
    return reply.send(await svc().awardSupplierBid(req.actor!, body.bidId, body.resultingPurchaseOrderId ?? undefined));
  });

  // =========================================================================
  // 8. Supplier Evaluation & Contracts (SCM-ADV-007)
  // =========================================================================

  app.post("/supply-chain/advanced/evaluations", { preHandler: app.authenticate }, async (req, reply) => {
    const body = createSupplierEvaluationSchema.parse(req.body);
    return reply.status(201).send(await svc().createSupplierEvaluation(req.actor!, body));
  });

  app.get("/supply-chain/advanced/evaluations/:id", { preHandler: app.authenticate }, async (req, reply) => {
    const { id } = idParamSchema.parse(req.params);
    return reply.send(await svc().getSupplierEvaluation(req.actor!, id));
  });

  app.get("/supply-chain/advanced/evaluations", { preHandler: app.authenticate }, async (req, reply) => {
    const q = query(req.query);
    return reply.send(
      await svc().listSupplierEvaluations(req.actor!, {
        supplierId: q.supplierId,
        status: q.status as ScmSupplierEvaluationStatus | undefined,
        ratingGrade: q.ratingGrade as ScmSupplierRatingGrade | undefined,
      }),
    );
  });

  app.post("/supply-chain/advanced/evaluations/:id/act", { preHandler: app.authenticate }, async (req, reply) => {
    const { id } = idParamSchema.parse(req.params);
    const body = actionSchema.parse(req.body);
    return reply.send(await svc().actOnSupplierEvaluation(req.actor!, id, body.actionCode, body.comment ?? undefined));
  });

  app.post("/supply-chain/advanced/contracts", { preHandler: app.authenticate }, async (req, reply) => {
    const body = createSupplierContractSchema.parse(req.body);
    return reply.status(201).send(await svc().createSupplierContract(req.actor!, body));
  });

  app.get("/supply-chain/advanced/contracts/:id", { preHandler: app.authenticate }, async (req, reply) => {
    const { id } = idParamSchema.parse(req.params);
    return reply.send(await svc().getSupplierContract(req.actor!, id));
  });

  app.get("/supply-chain/advanced/contracts", { preHandler: app.authenticate }, async (req, reply) => {
    const q = query(req.query);
    return reply.send(
      await svc().listSupplierContracts(req.actor!, {
        supplierId: q.supplierId,
        contractType: q.contractType as ScmSupplierContractType | undefined,
        status: q.status as ScmSupplierContractStatus | undefined,
      }),
    );
  });

  app.post("/supply-chain/advanced/contracts/:id/spend", { preHandler: app.authenticate }, async (req, reply) => {
    const { id } = idParamSchema.parse(req.params);
    const body = recordContractSpendSchema.parse(req.body);
    return reply.send(await svc().recordContractSpend(req.actor!, id, body.additionalSpentAmount));
  });

  app.post("/supply-chain/advanced/contracts/:id/act", { preHandler: app.authenticate }, async (req, reply) => {
    const { id } = idParamSchema.parse(req.params);
    const body = actionSchema.parse(req.body);
    return reply.send(await svc().actOnSupplierContract(req.actor!, id, body.actionCode, body.comment ?? undefined));
  });

  // =========================================================================
  // 9. Spend Analytics (SCM-ADV-008)
  // =========================================================================

  app.post("/supply-chain/advanced/spend-analytics/compute", { preHandler: app.authenticate }, async (req, reply) => {
    const body = computeSpendSnapshotSchema.parse(req.body);
    return reply.status(201).send(await svc().computeSpendSnapshot(req.actor!, body));
  });

  app.get("/supply-chain/advanced/spend-analytics", { preHandler: app.authenticate }, async (req, reply) => {
    const q = query(req.query);
    return reply.send(
      await svc().listSpendSnapshots(req.actor!, {
        periodType: q.periodType as ScmSpendAnalyticsPeriodType | undefined,
        organizationUnitIds: q.organizationUnitId ? [q.organizationUnitId] : undefined,
      }),
    );
  });

  // =========================================================================
  // 10. Wave A5.1 Stage 1: Account Assignment, Receiving, Inspection,
  //     Discrepancies, Returns, Reversals & Accounting-Ready Events
  // =========================================================================

  // Account Assignment Config
  app.get("/supply-chain/advanced/account-assignment-configs", { preHandler: app.authenticate }, async (req, reply) => {
    return reply.send(await svc().listAccountAssignmentConfigs(req.actor!));
  });

  app.get("/supply-chain/advanced/account-assignment-configs/:assignmentType", { preHandler: app.authenticate }, async (req, reply) => {
    const { assignmentType } = z.object({ assignmentType: z.string() }).parse(req.params);
    return reply.send(await svc().getAccountAssignmentConfig(req.actor!, assignmentType as ScmAccountAssignmentType));
  });

  app.put("/supply-chain/advanced/account-assignment-configs", { preHandler: app.authenticate }, async (req, reply) => {
    const body = updateAccountAssignmentConfigSchema.parse(req.body);
    return reply.send(await svc().updateAccountAssignmentConfig(req.actor!, body));
  });

  // Receiving Records & Lines
  app.post("/supply-chain/advanced/receiving-records", { preHandler: app.authenticate }, async (req, reply) => {
    const body = createReceivingRecordSchema.parse(req.body);
    return reply.status(201).send(
      await svc().createReceivingRecord(req.actor!, body as unknown as CreateScmReceivingRecordInput),
    );
  });

  app.get("/supply-chain/advanced/receiving-records/:id", { preHandler: app.authenticate }, async (req, reply) => {
    const { id } = idParamSchema.parse(req.params);
    return reply.send(await svc().getReceivingRecord(req.actor!, id));
  });

  app.get("/supply-chain/advanced/receiving-records", { preHandler: app.authenticate }, async (req, reply) => {
    const q = query(req.query);
    return reply.send(
      await svc().listReceivingRecords(req.actor!, {
        purchaseOrderId: q.purchaseOrderId,
        supplierId: q.supplierId,
        warehouseId: q.warehouseId,
        status: q.status as ScmReceivingStatus | undefined,
      }),
    );
  });

  // Quality Inspection
  app.post("/supply-chain/advanced/inspections", { preHandler: app.authenticate }, async (req, reply) => {
    const body = createInspectionSchema.parse(req.body);
    return reply.status(201).send(
      await svc().createInspection(req.actor!, body as unknown as CreateScmInspectionInput),
    );
  });

  app.get("/supply-chain/advanced/inspections/by-receiving-line/:receivingLineId", { preHandler: app.authenticate }, async (req, reply) => {
    const { receivingLineId } = z.object({ receivingLineId: z.string().uuid() }).parse(req.params);
    const result = await svc().getInspectionByReceivingLine(req.actor!, receivingLineId);
    if (!result) {
      return reply.status(404).send({ statusCode: 404, message: "Inspection not found for line" });
    }
    return reply.send(result);
  });

  // Discrepancies
  app.post("/supply-chain/advanced/discrepancies", { preHandler: app.authenticate }, async (req, reply) => {
    const body = createDiscrepancyRecordSchema.parse(req.body);
    return reply.status(201).send(await svc().createDiscrepancyRecord(req.actor!, body));
  });

  app.patch("/supply-chain/advanced/discrepancies/:id/resolve", { preHandler: app.authenticate }, async (req, reply) => {
    const { id } = idParamSchema.parse(req.params);
    const body = resolveDiscrepancyRecordSchema.parse(req.body);
    return reply.send(await svc().resolveDiscrepancyRecord(req.actor!, { discrepancyId: id, ...body }));
  });

  app.get("/supply-chain/advanced/discrepancies", { preHandler: app.authenticate }, async (req, reply) => {
    const q = query(req.query);
    return reply.send(
      await svc().listDiscrepancyRecords(req.actor!, {
        receivingLineId: q.receivingLineId,
        discrepancyType: q.discrepancyType as ScmDiscrepancyType | undefined,
        status: q.status as ScmDiscrepancyStatus | undefined,
      }),
    );
  });

  // Return To Vendor
  app.post("/supply-chain/advanced/returns-to-vendor", { preHandler: app.authenticate }, async (req, reply) => {
    const body = createReturnToVendorSchema.parse(req.body);
    return reply.status(201).send(
      await svc().createReturnToVendor(req.actor!, body as unknown as CreateScmReturnToVendorInput),
    );
  });

  app.get("/supply-chain/advanced/returns-to-vendor/:id", { preHandler: app.authenticate }, async (req, reply) => {
    const { id } = idParamSchema.parse(req.params);
    return reply.send(await svc().getReturnToVendor(req.actor!, id));
  });

  app.get("/supply-chain/advanced/returns-to-vendor", { preHandler: app.authenticate }, async (req, reply) => {
    const q = query(req.query);
    return reply.send(
      await svc().listReturnToVendors(req.actor!, {
        supplierId: q.supplierId,
        purchaseOrderId: q.purchaseOrderId,
        warehouseId: q.warehouseId,
        status: q.status as ScmReturnToVendorStatus | undefined,
      }),
    );
  });

  // Receipt Reversal
  app.post("/supply-chain/advanced/receipt-reversals", { preHandler: app.authenticate }, async (req, reply) => {
    const body = createReceiptReversalSchema.parse(req.body);
    return reply.status(201).send(
      await svc().createReceiptReversal(req.actor!, body as unknown as CreateScmReceiptReversalInput),
    );
  });

  app.get("/supply-chain/advanced/receipt-reversals/by-receiving-record/:receivingRecordId", { preHandler: app.authenticate }, async (req, reply) => {
    const { receivingRecordId } = z.object({ receivingRecordId: z.string().uuid() }).parse(req.params);
    const result = await svc().getReceiptReversalByReceivingRecord(req.actor!, receivingRecordId);
    if (!result) {
      return reply.status(404).send({ statusCode: 404, message: "Receipt reversal not found for receiving record" });
    }
    return reply.send(result);
  });

  // Accounting-Ready Events
  app.post("/supply-chain/advanced/accounting-ready-events", { preHandler: app.authenticate }, async (req, reply) => {
    const body = createAccountingReadyEventSchema.parse(req.body);
    return reply.status(201).send(
      await svc().createAccountingReadyEvent(req.actor!, body as unknown as CreateScmAccountingReadyEventInput),
    );
  });

  app.get("/supply-chain/advanced/accounting-ready-events/:id", { preHandler: app.authenticate }, async (req, reply) => {
    const { id } = idParamSchema.parse(req.params);
    return reply.send(await svc().getAccountingReadyEvent(req.actor!, id));
  });

  app.get("/supply-chain/advanced/accounting-ready-events", { preHandler: app.authenticate }, async (req, reply) => {
    const q = query(req.query);
    return reply.send(
      await svc().listAccountingReadyEvents(req.actor!, {
        eventType: q.eventType as ScmAccountingReadyEventType | undefined,
        sourceDocumentType: q.sourceDocumentType,
        sourceDocumentId: q.sourceDocumentId,
        outboxState: q.outboxState as ScmAccountingOutboxState | undefined,
        reconciliationState: q.reconciliationState as ScmAccountingReconciliationState | undefined,
      }),
    );
  });

  app.patch("/supply-chain/advanced/accounting-ready-events/:id/state", { preHandler: app.authenticate }, async (req, reply) => {
    const { id } = idParamSchema.parse(req.params);
    const body = updateAccountingReadyEventStateSchema.parse(req.body);
    return reply.send(
      await svc().updateAccountingReadyEventState(req.actor!, {
        accountingEventId: id,
        stateKind: body.stateKind,
        toState: body.toState as ScmAccountingOutboxState | ScmAccountingReconciliationState,
        reason: body.reason,
        occurredAt: body.occurredAt,
      }),
    );
  });
}
