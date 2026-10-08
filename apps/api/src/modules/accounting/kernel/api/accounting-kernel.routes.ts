import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Container } from "../../../../composition-root.js";
import type { AccountingPeriodStatus, JournalStatus } from "../domain/accounting-kernel.entity.js";

/**
 * Accounting Kernel HTTP surface (Phase 1B).
 *
 * Routes follow existing conventions: `app.authenticate` preHandler, zod
 * validation, `request.actor!`, central error mapping. Money is always
 * a string in and out; dates follow YYYY-MM-DD. Every mutation is
 * authorized and audited.
 */

const moneySchema = z.union([z.string().min(1), z.number()]);
const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "expected YYYY-MM-DD");
const uuidSchema = z.string().uuid();

const periodSchema = z.object({
  legalEntityId: uuidSchema,
  fiscalYearCode: z.string().min(1),
  periodCode: z.string().min(1),
  periodName: z.string().min(1),
  periodType: z.enum(["monthly", "quarterly", "annual"]),
  dateFrom: dateSchema,
  dateTo: dateSchema,
});

const accountSchema = z.object({
  legalEntityId: uuidSchema,
  coaId: uuidSchema,
  accountCode: z.string().min(1),
  accountName: z.string().min(1),
  accountClass: z.enum(["ASSET", "LIABILITY", "EQUITY", "INCOME", "EXPENSE"]),
  normalBalance: z.enum(["debit", "credit"]),
  accountType: z.string().nullable(),
  parentAccountId: uuidSchema.nullable().optional(),
});

const journalLineSchema = z.object({
  accountId: uuidSchema,
  lineNumber: z.number().min(1),
  debit: moneySchema,
  credit: moneySchema,
  lineDescription: z.string().nullable(),
  projectId: uuidSchema.nullable(),
  siteId: uuidSchema.nullable(),
});

const journalSchema = z.object({
  legalEntityId: uuidSchema,
  journalNumber: z.string().min(1),
  journalDate: dateSchema,
  accountingDate: dateSchema,
  periodId: uuidSchema,
  description: z.string().nullable(),
  currency: z.string().min(3).max(3),
  lines: z.array(journalLineSchema).min(1),
});

const lockPeriodSchema = z.object({
  reason: z.string().min(1),
});

const periodStatusQuerySchema = z
  .enum(["draft", "open", "closed", "reopenable", "tombstone"])
  .optional();

const journalStatusQuerySchema = z.enum(["pending", "posted", "failed", "reversed"]).optional();

const reverseJournalSchema = z.object({
  type: z.enum(["reverse_correct", "reverse_accrual"]),
  reason: z.string().min(1),
});

export function registerAccountingKernelRoutes(app: FastifyInstance, container: Container) {
  const svc = () => container.accountingKernel;

  // --- Periods (CRUD) --------------------------------------------------------

  app.post("/accounting/periods", { preHandler: app.authenticate }, async (request, reply) => {
    const input = periodSchema.parse(request.body);
    const period = await svc().createPeriod(request.actor!, input);
    return reply.status(201).send(period);
  });

  app.get("/accounting/periods", { preHandler: app.authenticate }, async (request, reply) => {
    const query = request.query as { legalEntityId?: string; status?: string };
    const status: AccountingPeriodStatus | undefined = periodStatusQuerySchema.parse(query.status);
    const periods = await svc().listPeriods(request.actor!, {
      legalEntityId: query.legalEntityId,
      status,
    });
    return reply.send(periods);
  });

  app.post("/accounting/periods/:id/lock", { preHandler: app.authenticate }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const { reason } = lockPeriodSchema.parse(request.body);
    await svc().lockPeriod(request.actor!, id, reason);
    return reply.status(204).send();
  });

  // --- Accounts (CRUD) -------------------------------------------------------

  app.post("/accounting/accounts", { preHandler: app.authenticate }, async (request, reply) => {
    const input = accountSchema.parse(request.body);
    const account = await svc().createAccount(request.actor!, input);
    return reply.status(201).send(account);
  });

  app.get("/accounting/accounts", { preHandler: app.authenticate }, async (request, reply) => {
    const query = request.query as { legalEntityId?: string; activeOnly?: string };
    const accounts = await svc().listAccounts(request.actor!, {
      legalEntityId: query.legalEntityId,
      activeOnly: query.activeOnly === "true",
    });
    return reply.send(accounts);
  });

  app.get("/accounting/accounts/hierarchy", { preHandler: app.authenticate }, async (request, reply) => {
    const query = request.query as { legalEntityId?: string };
    if (!query.legalEntityId) {
      return reply.status(400).send({ message: "legalEntityId query parameter is required" });
    }
    const hierarchy = await svc().listAccountHierarchy(request.actor!, query.legalEntityId);
    return reply.send(hierarchy);
  });

  // --- Journals (CRUD + posting) -----------------------------------------------

  app.post("/accounting/journals", { preHandler: app.authenticate }, async (request, reply) => {
    const input = journalSchema.parse(request.body);
    const journal = await svc().createJournal(request.actor!, input);
    return reply.status(201).send(journal);
  });

  app.get("/accounting/journals", { preHandler: app.authenticate }, async (request, reply) => {
    const query = request.query as { periodId?: string; status?: string };
    const status: JournalStatus | undefined = journalStatusQuerySchema.parse(query.status);
    const journals = await svc().listJournals(request.actor!, {
      periodId: query.periodId,
      status,
    });
    return reply.send(journals);
  });

  app.get("/accounting/journals/:id", { preHandler: app.authenticate }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const journal = await svc().getJournal(request.actor!, id);
    return reply.send(journal);
  });

  app.post("/accounting/journals/:id/validate", { preHandler: app.authenticate }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const validation = await svc().validateJournal(request.actor!, id);
    return reply.send(validation);
  });

  app.post("/accounting/journals/:id/post", { preHandler: app.authenticate }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const posted = await svc().postJournal(request.actor!, id);
    return reply.send(posted);
  });

  app.post("/accounting/journals/:id/reverse", { preHandler: app.authenticate }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const input = reverseJournalSchema.parse(request.body);
    const result = await svc().reverseJournal(request.actor!, id, input);
    return reply.status(201).send(result.reversal);
  });

  // --- GL Entries (read-only) ------------------------------------------------

  app.get("/accounting/gl-entries", { preHandler: app.authenticate }, async (request, reply) => {
    const query = request.query as { accountId?: string; periodId?: string };
    const entries = await svc().listGlEntries(request.actor!, {
      accountId: query.accountId,
      periodId: query.periodId,
    });
    return reply.send(entries);
  });

  app.get(
    "/accounting/gl-balance/:accountId/:periodId",
    { preHandler: app.authenticate },
    async (request, reply) => {
      const { accountId, periodId } = request.params as { accountId: string; periodId: string };
      const balance = await svc().getGlBalance(request.actor!, accountId, periodId);
      if (!balance) {
        return reply.status(404).send({ message: "No GL entries found for this account-period combination" });
      }
      return reply.send(balance);
    },
  );
}
