import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Container } from "../../../../composition-root.js";

/**
 * Finance HTTP surface (Phase 6). Follows the existing API conventions:
 * `app.authenticate` preHandler, zod validation, `request.actor!`, central
 * error mapping.
 *
 * Deliberately narrow: cash/bank accounts, the category catalog, income and
 * expense transactions, their approval lifecycle, corrections by reversal,
 * and an operational cashflow view. There is no journal, ledger, AP/AR,
 * aging, budget, tax, or reconciliation endpoint — and no delete endpoint,
 * because a money movement with business history is never destroyed.
 */

/** Money crosses the boundary as TEXT. A JSON number is accepted for
 * convenience, but the service re-validates it against a two-decimal
 * pattern, so nothing is silently rounded on the way in. */
const moneySchema = z.union([z.string().min(1), z.number()]);
const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "expected YYYY-MM-DD");

const accountSchema = z.object({
  code: z.string().min(1),
  name: z.string().min(1),
  accountType: z.enum(["cash", "bank", "petty_cash"]),
  currency: z.string().min(3).max(3),
  description: z.string().nullable().optional(),
  legalEntityId: z.string().uuid().nullable().optional(),
  organizationUnitId: z.string().uuid().nullable().optional(),
});

const accountUpdateSchema = z.object({
  name: z.string().min(1).optional(),
  description: z.string().nullable().optional(),
  isActive: z.boolean().optional(),
});

const transactionSchema = z.object({
  direction: z.enum(["income", "expense"]),
  amount: moneySchema,
  transactionDate: dateSchema,
  accountCode: z.string().min(1),
  categoryCode: z.string().min(1),
  description: z.string().nullable().optional(),
  reference: z.string().nullable().optional(),
  legalEntityId: z.string().uuid().nullable().optional(),
  organizationUnitId: z.string().uuid().nullable().optional(),
  projectId: z.string().uuid().nullable().optional(),
  siteId: z.string().uuid().nullable().optional(),
  customerId: z.string().uuid().nullable().optional(),
});

const commentSchema = z.object({ comment: z.string().nullable().optional() });

const reversalSchema = z.object({
  reason: z.string().nullable().optional(),
  transactionDate: dateSchema.nullable().optional(),
});

export function registerFinanceRoutes(app: FastifyInstance, container: Container) {
  const svc = () => container.finance;

  // --- Cash / bank accounts (FIN-CORE-004) ------------------------------

  app.post("/finance/accounts", { preHandler: app.authenticate }, async (request, reply) => {
    return reply.status(201).send(await svc().createAccount(request.actor!, accountSchema.parse(request.body)));
  });

  app.get("/finance/accounts", { preHandler: app.authenticate }, async (request, reply) => {
    const query = request.query as { activeOnly?: string };
    return reply.send(await svc().listAccounts(request.actor!, { activeOnly: query.activeOnly === "true" }));
  });

  app.get("/finance/accounts/:code", { preHandler: app.authenticate }, async (request, reply) => {
    const { code } = request.params as { code: string };
    return reply.send(await svc().getAccount(request.actor!, code));
  });

  app.patch("/finance/accounts/:code", { preHandler: app.authenticate }, async (request, reply) => {
    const { code } = request.params as { code: string };
    return reply.send(await svc().updateAccount(request.actor!, code, accountUpdateSchema.parse(request.body)));
  });

  // --- Category catalog (FIN-CORE-003) ----------------------------------

  app.get("/finance/categories", { preHandler: app.authenticate }, async (request, reply) => {
    return reply.send(await svc().listCategories(request.actor!));
  });

  // --- Transactions (FIN-CORE-001/002/006/008/009) ----------------------

  app.post("/finance/transactions", { preHandler: app.authenticate }, async (request, reply) => {
    return reply
      .status(201)
      .send(await svc().recordTransaction(request.actor!, transactionSchema.parse(request.body)));
  });

  app.get("/finance/transactions", { preHandler: app.authenticate }, async (request, reply) => {
    const query = request.query as Record<string, string | undefined>;
    return reply.send(
      await svc().listTransactions(request.actor!, {
        direction: query.direction,
        accountCode: query.accountCode,
        categoryCode: query.categoryCode,
        customerId: query.customerId,
        projectId: query.projectId,
        organizationUnitId: query.organizationUnitId,
        dateFrom: query.dateFrom,
        dateTo: query.dateTo,
        state: query.state,
        search: query.search,
      }),
    );
  });

  app.get("/finance/transactions/:id", { preHandler: app.authenticate }, async (request, reply) => {
    const { id } = request.params as { id: string };
    return reply.send(await svc().getTransaction(request.actor!, id));
  });

  app.post(
    "/finance/transactions/:id/actions/:actionCode",
    { preHandler: app.authenticate },
    async (request, reply) => {
      const { id, actionCode } = request.params as { id: string; actionCode: string };
      const { comment } = commentSchema.parse(request.body ?? {});
      return reply.send(await svc().actOnTransaction(request.actor!, id, actionCode, comment ?? null));
    },
  );

  app.post("/finance/transactions/:id/reversal", { preHandler: app.authenticate }, async (request, reply) => {
    const { id } = request.params as { id: string };
    return reply
      .status(201)
      .send(await svc().reverseTransaction(request.actor!, id, reversalSchema.parse(request.body ?? {})));
  });

  // --- Operational cashflow (FIN-CORE-007) ------------------------------

  app.get("/finance/cashflow", { preHandler: app.authenticate }, async (request, reply) => {
    const query = request.query as { from?: string; to?: string; accountCode?: string };
    const parsed = z
      .object({ from: dateSchema, to: dateSchema, accountCode: z.string().min(1).optional() })
      .parse(query);
    return reply.send(await svc().cashflow(request.actor!, parsed));
  });
}
