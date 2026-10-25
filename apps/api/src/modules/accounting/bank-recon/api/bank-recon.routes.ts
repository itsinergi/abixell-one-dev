import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Container } from "../../../../composition-root.js";

/**
 * WP-FIN-A6-04 — Bank reconciliation HTTP surface (ADR-0018).
 *
 * Same conventions as the budget and open-item routes: `app.authenticate`
 * preHandler, zod validation, `request.actor!`, central error mapping. Money is
 * a 2-decimal string (ledger precision); dates are YYYY-MM-DD.
 */

const moneySchema = z.string().regex(/^\d{1,16}(\.\d{1,2})?$/, "expected a money string with at most 2 decimals");
const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "expected YYYY-MM-DD");
const uuidSchema = z.string().uuid();

const createAccountSchema = z.object({
  legalEntityId: uuidSchema,
  bankName: z.string().min(1).max(120),
  houseBankCode: z.string().min(1).max(40),
  bankAccountId: z.string().min(1).max(80),
  accountNumberMasked: z.string().min(1).max(40),
  name: z.string().min(1).max(120),
  currency: z.string().length(3),
  ledgerAccountId: uuidSchema,
  reconciliationPolicy: z.enum(["manual", "suggested"]).default("manual"),
  effectiveFrom: dateSchema,
  effectiveTo: dateSchema.nullable().optional(),
});

const importSchema = z.object({
  bankAccountId: uuidSchema,
  formatProfile: z.string().min(1).max(40),
  sourceFileName: z.string().min(1).max(255),
  /** Raw file text. CSV-first in Wave A6 (ADR-0018 §2). */
  content: z.string().min(1).max(5_000_000),
});

const openReconSchema = z.object({
  bankAccountId: uuidSchema,
  periodId: uuidSchema,
});

const matchSchema = z.object({
  reconciliationId: uuidSchema,
  statementLineId: uuidSchema,
  glEntryId: uuidSchema,
  amount: moneySchema,
  matchKind: z.enum(["manual", "confirmed"]),
  matchReason: z.string().nullable().optional(),
  idempotencyKey: z.string().min(1).max(120),
  note: z.string().nullable().optional(),
});

const reverseMatchSchema = z.object({
  idempotencyKey: z.string().min(1).max(120),
  note: z.string().nullable().optional(),
});

const closeSchema = z.object({
  statementBalance: moneySchema.nullable().optional(),
});

export function registerBankReconRoutes(app: FastifyInstance, container: Container) {
  const svc = () => container.bankRecon;

  app.post("/accounting/bank-accounts", { preHandler: app.authenticate }, async (request, reply) => {
    const input = createAccountSchema.parse(request.body);
    return reply.status(201).send(
      await svc().createBankAccount(request.actor!, {
        ...input,
        effectiveTo: input.effectiveTo ?? null,
      }),
    );
  });

  app.get("/accounting/bank-accounts", { preHandler: app.authenticate }, async (request, reply) => {
    const query = z
      .object({
        legalEntityId: uuidSchema.optional(),
        isActive: z.coerce.boolean().optional(),
      })
      .parse(request.query);
    return reply.send(await svc().listBankAccounts(request.actor!, query));
  });

  app.get("/accounting/bank-accounts/:id", { preHandler: app.authenticate }, async (request, reply) => {
    const { id } = z.object({ id: uuidSchema }).parse(request.params);
    return reply.send(await svc().getBankAccount(request.actor!, id));
  });

  app.post("/accounting/bank-statements/import", { preHandler: app.authenticate }, async (request, reply) => {
    return reply
      .status(201)
      .send(await svc().importStatement(request.actor!, importSchema.parse(request.body)));
  });

  app.get("/accounting/bank-statement-lines", { preHandler: app.authenticate }, async (request, reply) => {
    const query = z
      .object({
        bankAccountId: uuidSchema.optional(),
        importId: uuidSchema.optional(),
        includeDuplicates: z.coerce.boolean().optional(),
      })
      .parse(request.query);
    return reply.send(await svc().listStatementLines(request.actor!, query));
  });

  app.get(
    "/accounting/bank-statement-lines/:id/candidates",
    { preHandler: app.authenticate },
    async (request, reply) => {
      const { id } = z.object({ id: uuidSchema }).parse(request.params);
      const query = z.object({ dateToleranceDays: z.coerce.number().int().min(0).max(31).optional() }).parse(
        request.query,
      );
      return reply.send(await svc().suggestMatches(request.actor!, id, query));
    },
  );

  app.post("/accounting/bank-reconciliations", { preHandler: app.authenticate }, async (request, reply) => {
    return reply
      .status(201)
      .send(await svc().openReconciliation(request.actor!, openReconSchema.parse(request.body)));
  });

  app.get("/accounting/bank-reconciliations", { preHandler: app.authenticate }, async (request, reply) => {
    const query = z.object({ bankAccountId: uuidSchema.optional() }).parse(request.query);
    return reply.send(await svc().listReconciliations(request.actor!, query));
  });

  app.get("/accounting/bank-reconciliations/:id", { preHandler: app.authenticate }, async (request, reply) => {
    const { id } = z.object({ id: uuidSchema }).parse(request.params);
    return reply.send(await svc().getReconciliation(request.actor!, id));
  });

  app.get("/accounting/bank-reconciliations/:id/matches", { preHandler: app.authenticate }, async (request, reply) => {
    const { id } = z.object({ id: uuidSchema }).parse(request.params);
    return reply.send(await svc().listMatches(request.actor!, id));
  });

  app.post("/accounting/bank-reconciliations/:id/close", { preHandler: app.authenticate }, async (request, reply) => {
    const { id } = z.object({ id: uuidSchema }).parse(request.params);
    const input = closeSchema.parse(request.body ?? {});
    return reply.send(
      await svc().closeReconciliation(request.actor!, id, {
        statementBalance: input.statementBalance ?? null,
      }),
    );
  });

  app.post("/accounting/bank-matches", { preHandler: app.authenticate }, async (request, reply) => {
    const input = matchSchema.parse(request.body);
    return reply.status(201).send(
      await svc().createMatch(request.actor!, {
        ...input,
        matchReason: input.matchReason ?? null,
        note: input.note ?? null,
      }),
    );
  });

  app.post("/accounting/bank-matches/:id/reverse", { preHandler: app.authenticate }, async (request, reply) => {
    const { id } = z.object({ id: uuidSchema }).parse(request.params);
    const input = reverseMatchSchema.parse(request.body);
    return reply.status(201).send(
      await svc().reverseMatch(request.actor!, id, {
        idempotencyKey: input.idempotencyKey,
        note: input.note ?? null,
      }),
    );
  });

  app.get("/accounting/bank-period-movement", { preHandler: app.authenticate }, async (request, reply) => {
    const query = z.object({ bankAccountId: uuidSchema, periodId: uuidSchema }).parse(request.query);
    return reply.send(await svc().periodMovement(request.actor!, query));
  });
}