import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Container } from "../../../composition-root.js";

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "expected an ISO date (YYYY-MM-DD)");

const priceBookSchema = z.object({
  code: z.string().min(1).max(64),
  name: z.string().min(1),
  description: z.string().nullable().optional(),
  currencyCode: z.string().min(3).max(8),
  customerId: z.string().uuid().nullable().optional(),
  effectiveFrom: isoDate,
  effectiveTo: isoDate.nullable().optional(),
});

const priceBookEntrySchema = z.object({
  serviceId: z.string().uuid(),
  unitCode: z.string().min(1),
  unitPrice: z.number().nonnegative(),
  minQuantity: z.number().positive().optional(),
});

const opportunitySchema = z.object({
  customerId: z.string().uuid(),
  contractId: z.string().uuid().nullable().optional(),
  projectId: z.string().uuid().nullable().optional(),
  siteId: z.string().uuid().nullable().optional(),
  customerContactId: z.string().uuid().nullable().optional(),
  title: z.string().min(1),
  description: z.string().nullable().optional(),
  stageCode: z.string().min(1),
  sourceCode: z.string().min(1).nullable().optional(),
  currencyCode: z.string().min(3).max(8),
  estimatedValue: z.number().nonnegative().nullable().optional(),
  probabilityPercent: z.number().int().min(0).max(100).nullable().optional(),
  expectedCloseDate: isoDate.nullable().optional(),
  ownerUserId: z.string().uuid().nullable().optional(),
});

const stageSchema = z.object({
  stageCode: z.string().min(1),
  outcome: z.enum(["open", "won", "lost", "cancelled"]).optional(),
  outcomeReason: z.string().min(1).nullable().optional(),
  note: z.string().nullable().optional(),
});

const quotationSchema = z.object({
  opportunityId: z.string().uuid(),
  title: z.string().min(1),
  notes: z.string().nullable().optional(),
  validUntil: isoDate.nullable().optional(),
  taxAmount: z.number().nonnegative().nullable().optional(),
  supersedesQuotationId: z.string().uuid().nullable().optional(),
  lines: z
    .array(
      z.object({
        serviceId: z.string().uuid(),
        description: z.string().nullable().optional(),
        unitCode: z.string().min(1).nullable().optional(),
        quantity: z.number().positive(),
        unitPrice: z.number().nonnegative().nullable().optional(),
        discountAmount: z.number().nonnegative().nullable().optional(),
      }),
    )
    .min(1),
});

/** The internal approval outcome. `accepted`/`declined` are deliberately
 * absent here — those are the Customer's decision, on their own route. */
const approvalSchema = z.object({ decision: z.enum(["issued", "withdrawn"]) });

const customerDecisionSchema = z.object({
  decision: z.enum(["accepted", "declined"]),
  note: z.string().nullable().optional(),
});

export function registerSalesRoutes(app: FastifyInstance, container: Container) {
  // --- reference data & pricing configuration ----------------------------

  app.get("/sales/reference-data", { preHandler: app.authenticate }, async (request, reply) => {
    const result = await container.sales.getReferenceOptions(request.actor!);
    return reply.send(result);
  });

  app.post("/sales/price-books", { preHandler: app.authenticate }, async (request, reply) => {
    const body = priceBookSchema.parse(request.body);
    const book = await container.sales.createPriceBook(request.actor!, body);
    return reply.status(201).send(book);
  });

  app.get("/sales/price-books", { preHandler: app.authenticate }, async (request, reply) => {
    const books = await container.sales.listPriceBooks(request.actor!);
    return reply.send(books);
  });

  app.post(
    "/sales/price-books/:id/entries",
    { preHandler: app.authenticate },
    async (request, reply) => {
      const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
      const body = priceBookEntrySchema.parse(request.body);
      const entry = await container.sales.addPriceBookEntry(request.actor!, id, body);
      return reply.status(201).send(entry);
    },
  );

  app.get(
    "/sales/price-books/:id/entries",
    { preHandler: app.authenticate },
    async (request, reply) => {
      const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
      const entries = await container.sales.listPriceBookEntries(request.actor!, id);
      return reply.send(entries);
    },
  );

  // --- opportunities -----------------------------------------------------

  app.post("/sales/opportunities", { preHandler: app.authenticate }, async (request, reply) => {
    const body = opportunitySchema.parse(request.body);
    const opportunity = await container.sales.createOpportunity(request.actor!, body);
    return reply.status(201).send(opportunity);
  });

  app.get("/sales/opportunities", { preHandler: app.authenticate }, async (request, reply) => {
    const query = z
      .object({
        outcome: z.enum(["open", "won", "lost", "cancelled"]).optional(),
        stageCode: z.string().min(1).optional(),
        customerId: z.string().uuid().optional(),
      })
      .parse(request.query);
    const list = await container.sales.listOpportunities(request.actor!, query);
    return reply.send(list);
  });

  // Static path — declared before `/:id` so it is not swallowed by it.
  app.get(
    "/sales/opportunities/pipeline",
    { preHandler: app.authenticate },
    async (request, reply) => {
      const summary = await container.sales.getPipelineSummary(request.actor!);
      return reply.send(summary);
    },
  );

  app.get("/sales/opportunities/:id", { preHandler: app.authenticate }, async (request, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const result = await container.sales.getOpportunity(request.actor!, id);
    return reply.send(result);
  });

  app.post(
    "/sales/opportunities/:id/stage",
    { preHandler: app.authenticate },
    async (request, reply) => {
      const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
      const body = stageSchema.parse(request.body);
      const updated = await container.sales.changeOpportunityStage(request.actor!, id, body);
      return reply.send(updated);
    },
  );

  // --- quotations --------------------------------------------------------

  app.post("/sales/quotations", { preHandler: app.authenticate }, async (request, reply) => {
    const body = quotationSchema.parse(request.body);
    const result = await container.sales.createQuotation(request.actor!, {
      ...body,
      lines: body.lines.map((line) => ({
        ...line,
        unitPrice: line.unitPrice ?? undefined,
      })),
    });
    return reply.status(201).send(result);
  });

  app.get("/sales/quotations", { preHandler: app.authenticate }, async (request, reply) => {
    const list = await container.sales.listQuotations(request.actor!);
    return reply.send(list);
  });

  app.get("/sales/quotations/:id", { preHandler: app.authenticate }, async (request, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const result = await container.sales.getQuotation(request.actor!, id);
    return reply.send(result);
  });

  app.post(
    "/sales/quotations/:id/submit",
    { preHandler: app.authenticate },
    async (request, reply) => {
      const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
      const quotation = await container.sales.submitQuotationForApproval(request.actor!, id);
      return reply.send(quotation);
    },
  );

  app.post(
    "/sales/quotations/:id/approval",
    { preHandler: app.authenticate },
    async (request, reply) => {
      const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
      const body = approvalSchema.parse(request.body);
      const quotation = await container.sales.recordApprovalDecision(
        request.actor!,
        id,
        body.decision,
      );
      return reply.send(quotation);
    },
  );

  app.post(
    "/sales/quotations/:id/customer-decision",
    { preHandler: app.authenticate },
    async (request, reply) => {
      const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
      const body = customerDecisionSchema.parse(request.body);
      const quotation = await container.sales.recordCustomerDecision(
        request.actor!,
        id,
        body.decision,
        body.note ?? null,
      );
      return reply.send(quotation);
    },
  );
}
