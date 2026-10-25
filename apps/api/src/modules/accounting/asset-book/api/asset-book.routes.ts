import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Container } from "../../../../composition-root.js";

/**
 * WP-FIN-A6-05 — Fixed asset book + depreciation HTTP surface (ADR-0019).
 *
 * Same conventions as budget, open-item and bank-recon: `app.authenticate`
 * preHandler, zod validation, `request.actor!`, central error mapping. Money is
 * a 2-decimal string (ledger precision); dates are YYYY-MM-DD.
 */

const moneySchema = z.string().regex(/^\d{1,16}(\.\d{1,2})?$/, "expected a money string with at most 2 decimals");
const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "expected YYYY-MM-DD");
const uuidSchema = z.string().uuid();

const createBookSchema = z.object({
  legalEntityId: uuidSchema,
  ledgerId: uuidSchema,
  assetId: uuidSchema,
  bookCode: z.string().min(1).max(40),
  assetClass: z.string().min(1).max(60),
  capitalizationDate: dateSchema,
  inServiceDate: dateSchema,
  acquisitionCost: moneySchema,
  residualValue: moneySchema.optional(),
  usefulLifeMonths: z.number().int().positive(),
  methodCode: z.enum(["straight_line"]).optional(),
  methodVersion: z.number().int().positive().optional(),
  depreciationExpenseAccountId: uuidSchema,
  accumulatedDepreciationAccountId: uuidSchema,
});

const eventSchema = z.object({
  assetBookId: uuidSchema,
  eventType: z.enum(["capitalization", "transfer", "impairment", "disposal"]),
  eventDate: dateSchema,
  amount: moneySchema.nullable().optional(),
  evidenceDocumentId: uuidSchema.nullable().optional(),
  workflowInstanceId: uuidSchema.nullable().optional(),
  note: z.string().nullable().optional(),
  idempotencyKey: z.string().min(1).max(120),
});

const disposeSchema = z.object({
  disposalDate: dateSchema,
  evidenceDocumentId: uuidSchema,
  proceeds: moneySchema.nullable().optional(),
  note: z.string().nullable().optional(),
  idempotencyKey: z.string().min(1).max(120),
});

const runSchema = z.object({
  legalEntityId: uuidSchema,
  bookCode: z.string().min(1).max(40),
  periodId: uuidSchema,
  idempotencyKey: z.string().min(1).max(120),
  journalDate: dateSchema.optional(),
  description: z.string().max(255).nullable().optional(),
});

const reverseRunSchema = z.object({
  idempotencyKey: z.string().min(1).max(120),
  reason: z.string().min(1).max(500),
});

export function registerAssetBookRoutes(app: FastifyInstance, container: Container) {
  const svc = () => container.assetBook;

  app.post("/accounting/asset-books", { preHandler: app.authenticate }, async (request, reply) => {
    return reply
      .status(201)
      .send(await svc().createBook(request.actor!, createBookSchema.parse(request.body)));
  });

  app.get("/accounting/asset-books", { preHandler: app.authenticate }, async (request, reply) => {
    const query = z
      .object({
        legalEntityId: uuidSchema.optional(),
        bookCode: z.string().max(40).optional(),
        status: z.enum(["draft", "active", "disposed"]).optional(),
      })
      .parse(request.query);
    return reply.send(await svc().listBooks(request.actor!, query));
  });

  app.get("/accounting/asset-books/:id", { preHandler: app.authenticate }, async (request, reply) => {
    const { id } = z.object({ id: uuidSchema }).parse(request.params);
    return reply.send(await svc().getBook(request.actor!, id));
  });

  app.post("/accounting/asset-books/:id/activate", { preHandler: app.authenticate }, async (request, reply) => {
    const { id } = z.object({ id: uuidSchema }).parse(request.params);
    return reply.send(await svc().activateBook(request.actor!, id));
  });

  app.post("/accounting/asset-books/:id/dispose", { preHandler: app.authenticate }, async (request, reply) => {
    const { id } = z.object({ id: uuidSchema }).parse(request.params);
    const input = disposeSchema.parse(request.body);
    return reply.status(201).send(
      await svc().disposeBook(request.actor!, id, {
        ...input,
        proceeds: input.proceeds ?? null,
        note: input.note ?? null,
      }),
    );
  });

  app.post("/accounting/asset-book-events", { preHandler: app.authenticate }, async (request, reply) => {
    const input = eventSchema.parse(request.body);
    return reply.status(201).send(
      await svc().recordEvent(request.actor!, {
        ...input,
        amount: input.amount ?? null,
        evidenceDocumentId: input.evidenceDocumentId ?? null,
        workflowInstanceId: input.workflowInstanceId ?? null,
        note: input.note ?? null,
      }),
    );
  });

  app.get("/accounting/asset-book-events", { preHandler: app.authenticate }, async (request, reply) => {
    const query = z.object({ assetBookId: uuidSchema }).parse(request.query);
    return reply.send(await svc().listEvents(request.actor!, query.assetBookId));
  });

  app.post("/accounting/depreciation-runs", { preHandler: app.authenticate }, async (request, reply) => {
    return reply
      .status(201)
      .send(await svc().runDepreciation(request.actor!, runSchema.parse(request.body)));
  });

  app.get("/accounting/depreciation-runs", { preHandler: app.authenticate }, async (request, reply) => {
    const query = z
      .object({
        legalEntityId: uuidSchema.optional(),
        bookCode: z.string().max(40).optional(),
        periodId: uuidSchema.optional(),
      })
      .parse(request.query);
    return reply.send(await svc().listRuns(request.actor!, query));
  });

  app.get("/accounting/depreciation-runs/:id", { preHandler: app.authenticate }, async (request, reply) => {
    const { id } = z.object({ id: uuidSchema }).parse(request.params);
    return reply.send(await svc().getRun(request.actor!, id));
  });

  app.post("/accounting/depreciation-runs/:id/reverse", { preHandler: app.authenticate }, async (request, reply) => {
    const { id } = z.object({ id: uuidSchema }).parse(request.params);
    return reply
      .status(201)
      .send(await svc().reverseRun(request.actor!, id, reverseRunSchema.parse(request.body)));
  });
}
