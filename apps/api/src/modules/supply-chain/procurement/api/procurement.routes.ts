import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type {
  RfqBiddingService,
  ServiceAcceptanceService,
  SpendAnalyticsService,
  SupplierContractService,
  SupplierGovernanceService,
} from "../application/index.js";
import type {
  CreateScmServiceAcceptanceInput,
  ScmProcurementType,
  ScmRfqStatus,
  ScmServiceAcceptanceStatus,
  ScmSpendAnalyticsPeriodType,
  ScmSupplierContractStatus,
  ScmSupplierContractType,
  ScmSupplierEvaluationStatus,
  ScmSupplierRatingGrade,
} from "../../advanced/domain/supply-chain-advanced.entity.js";

export interface ProcurementRouteDeps {
  procurement: {
    rfq: RfqBiddingService;
    supplierGovernance: SupplierGovernanceService;
    supplierContract: SupplierContractService;
    serviceAcceptance: ServiceAcceptanceService;
    spendAnalytics: SpendAnalyticsService;
  };
}

const dateOnlyRegex = /^\d{4}-\d{2}-\d{2}$/;

const idParamSchema = z.object({ id: z.string().uuid() });
const actionSchema = z.object({
  actionCode: z.string().min(1),
  comment: z.string().nullable().optional(),
});
const commentBodySchema = z.object({
  comment: z.string().optional(),
});

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

const computeSpendSnapshotSchema = z.object({
  periodType: z.enum(["monthly", "quarterly", "yearly"]),
  periodStart: z.string().regex(dateOnlyRegex),
  periodEnd: z.string().regex(dateOnlyRegex),
  organizationUnitId: z.string().uuid().optional(),
});

const createServiceAcceptanceLineSchema = z.object({
  purchaseOrderLineId: z.string().uuid(),
  description: z.string().min(1),
  quantity: z.number().positive(),
  unitPrice: z.number().nonnegative(),
  currency: z.string().optional(),
  amount: z.number().nonnegative(),
  accountAssignmentType: z.enum([
    "stock",
    "expense",
    "asset",
    "project",
    "work_order",
    "service",
  ]).optional(),
  accountAssignmentDimensions: z.record(z.unknown()).optional(),
  notes: z.string().nullable().optional(),
  sortOrder: z.number().int().optional(),
});

const createServiceAcceptanceSchema = z.object({
  idempotencyKey: z.string().min(1),
  acceptanceNumber: z.string().optional(),
  purchaseOrderId: z.string().uuid(),
  supplierId: z.string().uuid(),
  organizationUnitId: z.string().uuid().nullable().optional(),
  servicePeriodStart: z.string().regex(dateOnlyRegex).nullable().optional(),
  servicePeriodEnd: z.string().regex(dateOnlyRegex).nullable().optional(),
  notes: z.string().nullable().optional(),
  lines: z.array(createServiceAcceptanceLineSchema).min(1),
});

function query(q: unknown): Record<string, string | undefined> {
  return (q ?? {}) as Record<string, string | undefined>;
}

const route = (prefix: string, path: string): string => `${prefix}${path}`;

/**
 * Registers Procurement Management routes. The default `/procurement/*`
 * namespace is the canonical API; the legacy shim reuses the same handlers
 * with `/supply-chain/advanced` as the prefix during the deprecation window.
 */
export function registerProcurementRoutes(
  app: FastifyInstance,
  deps: ProcurementRouteDeps,
  prefix = "/procurement",
): void {
  // 1. RFQ & Tendering
  app.post(route(prefix, "/rfqs"), { preHandler: app.authenticate }, async (req, reply) => {
    const body = createRfqSchema.parse(req.body);
    return reply.status(201).send(await deps.procurement.rfq.createRfq(req.actor!, body));
  });

  app.get(route(prefix, "/rfqs/:id"), { preHandler: app.authenticate }, async (req, reply) => {
    const { id } = idParamSchema.parse(req.params);
    return reply.send(await deps.procurement.rfq.getRfq(req.actor!, id));
  });

  app.get(route(prefix, "/rfqs"), { preHandler: app.authenticate }, async (req, reply) => {
    const q = query(req.query);
    return reply.send(
      await deps.procurement.rfq.listRfqs(req.actor!, {
        procurementType: q.procurementType as ScmProcurementType | undefined,
        status: q.status as ScmRfqStatus | undefined,
        organizationUnitIds: q.organizationUnitId ? [q.organizationUnitId] : undefined,
      }),
    );
  });

  app.post(route(prefix, "/rfqs/:id/act"), { preHandler: app.authenticate }, async (req, reply) => {
    const { id } = idParamSchema.parse(req.params);
    const body = actionSchema.parse(req.body);
    return reply.send(await deps.procurement.rfq.actOnRfq(req.actor!, id, body.actionCode, body.comment ?? undefined));
  });

  app.post(route(prefix, "/bids"), { preHandler: app.authenticate }, async (req, reply) => {
    const body = submitSupplierBidSchema.parse(req.body);
    return reply.status(201).send(await deps.procurement.rfq.submitSupplierBid(req.actor!, body));
  });

  app.get(route(prefix, "/bids/:id"), { preHandler: app.authenticate }, async (req, reply) => {
    const { id } = idParamSchema.parse(req.params);
    return reply.send(await deps.procurement.rfq.getSupplierBid(req.actor!, id));
  });

  app.get(route(prefix, "/bids"), { preHandler: app.authenticate }, async (req, reply) => {
    const q = query(req.query);
    return reply.send(
      await deps.procurement.rfq.listSupplierBids(req.actor!, {
        rfqId: q.rfqId,
        supplierId: q.supplierId,
      }),
    );
  });

  app.patch(route(prefix, "/bids/:id/score"), { preHandler: app.authenticate }, async (req, reply) => {
    const { id } = idParamSchema.parse(req.params);
    const body = scoreSupplierBidSchema.parse(req.body);
    return reply.send(await deps.procurement.rfq.scoreSupplierBid(req.actor!, id, body));
  });

  app.post(route(prefix, "/bids/award"), { preHandler: app.authenticate }, async (req, reply) => {
    const body = awardSupplierBidSchema.parse(req.body);
    return reply.send(await deps.procurement.rfq.awardSupplierBid(req.actor!, body.bidId, body.resultingPurchaseOrderId ?? undefined));
  });

  // 2. Supplier Evaluation & Contracts
  app.post(route(prefix, "/evaluations"), { preHandler: app.authenticate }, async (req, reply) => {
    const body = createSupplierEvaluationSchema.parse(req.body);
    return reply.status(201).send(await deps.procurement.supplierGovernance.createSupplierEvaluation(req.actor!, body));
  });

  app.get(route(prefix, "/evaluations/:id"), { preHandler: app.authenticate }, async (req, reply) => {
    const { id } = idParamSchema.parse(req.params);
    return reply.send(await deps.procurement.supplierGovernance.getSupplierEvaluation(req.actor!, id));
  });

  app.get(route(prefix, "/evaluations"), { preHandler: app.authenticate }, async (req, reply) => {
    const q = query(req.query);
    return reply.send(
      await deps.procurement.supplierGovernance.listSupplierEvaluations(req.actor!, {
        supplierId: q.supplierId,
        status: q.status as ScmSupplierEvaluationStatus | undefined,
        ratingGrade: q.ratingGrade as ScmSupplierRatingGrade | undefined,
      }),
    );
  });

  app.post(route(prefix, "/evaluations/:id/act"), { preHandler: app.authenticate }, async (req, reply) => {
    const { id } = idParamSchema.parse(req.params);
    const body = actionSchema.parse(req.body);
    return reply.send(await deps.procurement.supplierGovernance.actOnSupplierEvaluation(req.actor!, id, body.actionCode, body.comment ?? undefined));
  });

  app.post(route(prefix, "/contracts"), { preHandler: app.authenticate }, async (req, reply) => {
    const body = createSupplierContractSchema.parse(req.body);
    return reply.status(201).send(await deps.procurement.supplierContract.createSupplierContract(req.actor!, body));
  });

  app.get(route(prefix, "/contracts/:id"), { preHandler: app.authenticate }, async (req, reply) => {
    const { id } = idParamSchema.parse(req.params);
    return reply.send(await deps.procurement.supplierContract.getSupplierContract(req.actor!, id));
  });

  app.get(route(prefix, "/contracts"), { preHandler: app.authenticate }, async (req, reply) => {
    const q = query(req.query);
    return reply.send(
      await deps.procurement.supplierContract.listSupplierContracts(req.actor!, {
        supplierId: q.supplierId,
        contractType: q.contractType as ScmSupplierContractType | undefined,
        status: q.status as ScmSupplierContractStatus | undefined,
      }),
    );
  });

  app.post(route(prefix, "/contracts/:id/spend"), { preHandler: app.authenticate }, async (req, reply) => {
    const { id } = idParamSchema.parse(req.params);
    const body = recordContractSpendSchema.parse(req.body);
    return reply.send(await deps.procurement.supplierContract.recordContractSpend(req.actor!, id, body.additionalSpentAmount));
  });

  app.post(route(prefix, "/contracts/:id/act"), { preHandler: app.authenticate }, async (req, reply) => {
    const { id } = idParamSchema.parse(req.params);
    const body = actionSchema.parse(req.body);
    return reply.send(await deps.procurement.supplierContract.actOnSupplierContract(req.actor!, id, body.actionCode, body.comment ?? undefined));
  });

  // 3. Spend Analytics
  app.post(route(prefix, "/spend-analytics/compute"), { preHandler: app.authenticate }, async (req, reply) => {
    const body = computeSpendSnapshotSchema.parse(req.body);
    return reply.status(201).send(await deps.procurement.spendAnalytics.computeSpendSnapshot(req.actor!, body));
  });

  app.get(route(prefix, "/spend-analytics/:id"), { preHandler: app.authenticate }, async (req, reply) => {
    const { id } = idParamSchema.parse(req.params);
    return reply.send(await deps.procurement.spendAnalytics.getSpendSnapshot(req.actor!, id));
  });

  app.get(route(prefix, "/spend-analytics"), { preHandler: app.authenticate }, async (req, reply) => {
    const q = query(req.query);
    return reply.send(
      await deps.procurement.spendAnalytics.listSpendSnapshots(req.actor!, {
        periodType: q.periodType as ScmSpendAnalyticsPeriodType | undefined,
        organizationUnitIds: q.organizationUnitId ? [q.organizationUnitId] : undefined,
      }),
    );
  });

  // 4. Service Acceptances (Service Entry Sheets)
  app.post(route(prefix, "/service-acceptances"), { preHandler: app.authenticate }, async (req, reply) => {
    const body = createServiceAcceptanceSchema.parse(req.body);
    return reply.status(201).send(
      await deps.procurement.serviceAcceptance.createServiceAcceptance(
        req.actor!,
        body as unknown as CreateScmServiceAcceptanceInput,
      ),
    );
  });

  app.get(route(prefix, "/service-acceptances/:id"), { preHandler: app.authenticate }, async (req, reply) => {
    const { id } = idParamSchema.parse(req.params);
    return reply.send(await deps.procurement.serviceAcceptance.getServiceAcceptance(req.actor!, id));
  });

  app.get(route(prefix, "/service-acceptances"), { preHandler: app.authenticate }, async (req, reply) => {
    const q = query(req.query);
    return reply.send(
      await deps.procurement.serviceAcceptance.listServiceAcceptances(req.actor!, {
        purchaseOrderId: q.purchaseOrderId,
        supplierId: q.supplierId,
        organizationUnitIds: q.organizationUnitId ? [q.organizationUnitId] : undefined,
        status: q.status as ScmServiceAcceptanceStatus | undefined,
      }),
    );
  });

  app.post(route(prefix, "/service-acceptances/:id/submit"), { preHandler: app.authenticate }, async (req, reply) => {
    const { id } = idParamSchema.parse(req.params);
    const body = commentBodySchema.parse(req.body ?? {});
    return reply.send(await deps.procurement.serviceAcceptance.submitServiceAcceptance(req.actor!, id, body.comment));
  });

  app.post(route(prefix, "/service-acceptances/:id/approve"), { preHandler: app.authenticate }, async (req, reply) => {
    const { id } = idParamSchema.parse(req.params);
    const body = commentBodySchema.parse(req.body ?? {});
    return reply.send(await deps.procurement.serviceAcceptance.approveServiceAcceptance(req.actor!, id, body.comment));
  });
}
