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

const chartSchema = z.object({
  legalEntityId: uuidSchema,
  coaVersionCode: z.string().min(1),
  coaVersionDate: dateSchema,
  templateType: z.enum(["SAK_UMUM", "SAK_EMKM"]).nullable(),
});

const instantiateTemplateSchema = z.object({
  legalEntityId: uuidSchema,
  coaVersionCode: z.string().min(1),
  coaVersionDate: dateSchema,
  templateType: z.enum(["SAK_UMUM", "SAK_EMKM"]),
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

const requestReopenSchema = z.object({
  reason: z.string().min(1),
  impactEvidence: z.string().min(1),
});

const approveReopenSchema = z.object({
  note: z.string().optional(),
});

const rejectReopenSchema = z.object({
  reason: z.string().min(1),
});

/** Runbook attestations for month-end / year-end close (ADR-0016 §4). */
const closePeriodSchema = z.object({
  bankReconConfirmed: z.boolean(),
  apArConfirmed: z.boolean(),
  depreciationConfirmed: z.boolean(),
  accrualsConfirmed: z.boolean(),
});

const createLedgerSchema = z.object({
  legalEntityId: uuidSchema,
  ledgerCode: z.string().min(1),
  ledgerName: z.string().min(1),
  currency: z.string().min(3).max(3),
});

const periodStatusQuerySchema = z
  .enum(["draft", "open", "closed", "reopenable", "tombstone"])
  .optional();

const journalStatusQuerySchema = z.enum(["pending", "posted", "failed", "reversed"]).optional();

const reverseJournalSchema = z.object({
  type: z.enum(["reverse_correct", "reverse_accrual"]),
  reason: z.string().min(1),
});

const postingRuleLegSchema = z.object({
  accountCode: z.string().min(1),
  side: z.enum(["debit", "credit"]),
  amountExpression: z.string().min(1),
});

const createPostingRuleSchema = z.object({
  ruleCode: z.string().min(1),
  ruleName: z.string().min(1),
  ruleVersion: z.string().min(1),
  triggerEventType: z.string().min(1),
  accountingFormula: z.array(postingRuleLegSchema).min(2),
  requiresApproval: z.boolean(),
  materialityThreshold: moneySchema.nullable().optional(),
  effectiveDate: dateSchema,
});

const postingRuleFilterSchema = z.object({
  triggerEventType: z.string().optional(),
  isActive: z.boolean().optional(),
});

const resolvePostingRuleSchema = z.object({
  triggerEventType: z.string().min(1),
  accountingDate: dateSchema,
  amount: moneySchema,
});

const generateJournalFromRuleSchema = z.object({
  legalEntityId: uuidSchema,
  triggerEventType: z.string().min(1),
  journalNumber: z.string().min(1),
  journalDate: dateSchema,
  accountingDate: dateSchema,
  periodId: uuidSchema,
  amount: moneySchema,
  idempotencyKey: z.string().min(1),
  description: z.string().nullable().optional(),
  currency: z.string().min(3).max(3),
});

export function registerAccountingKernelRoutes(app: FastifyInstance, container: Container) {
  const svc = () => container.accountingKernel;
  const consumer = () => container.accountingEventConsumer;

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

  // --- Period reopen (maker-checker, WP-FIN-03) ---------------------------

  app.post("/accounting/periods/:id/reopen", { preHandler: app.authenticate }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const input = requestReopenSchema.parse(request.body);
    await svc().requestPeriodReopen(request.actor!, id, input);
    return reply.status(204).send();
  });

  app.post("/accounting/periods/:id/reopen/approve", { preHandler: app.authenticate }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const input = approveReopenSchema.parse(request.body ?? {});
    await svc().approvePeriodReopen(request.actor!, id, input);
    return reply.status(204).send();
  });

  app.post("/accounting/periods/:id/reopen/reject", { preHandler: app.authenticate }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const input = rejectReopenSchema.parse(request.body);
    await svc().rejectPeriodReopen(request.actor!, id, input);
    return reply.status(204).send();
  });

  // --- Fiscal close (WP-FIN-A6-01, ADR-0016 §4) -----------------------------

  app.post(
    "/accounting/periods/:id/close-month-end",
    { preHandler: app.authenticate },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const input = closePeriodSchema.parse(request.body);
      const closing = await svc().closeMonthEnd(request.actor!, id, input);
      return reply.status(201).send(closing);
    },
  );

  app.post(
    "/accounting/periods/:id/close-year-end",
    { preHandler: app.authenticate },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const input = closePeriodSchema.parse(request.body);
      const closing = await svc().closeYearEnd(request.actor!, id, input);
      return reply.status(201).send(closing);
    },
  );

  app.get("/accounting/fiscal-closings", { preHandler: app.authenticate }, async (request, reply) => {
    const query = request.query as { legalEntityId?: string; periodId?: string };
    const closings = await svc().listFiscalClosings(request.actor!, {
      legalEntityId: query.legalEntityId,
      periodId: query.periodId,
    });
    return reply.send(closings);
  });

  // --- Ledger governance (WP-FIN-A6-01, ADR-0015 §3) -------------------------

  app.get("/accounting/ledgers", { preHandler: app.authenticate }, async (request, reply) => {
    const query = z.object({ legalEntityId: uuidSchema }).parse(request.query);
    const ledgers = await svc().listLedgers(request.actor!, query.legalEntityId);
    return reply.send(ledgers);
  });

  app.post("/accounting/ledgers", { preHandler: app.authenticate }, async (request, reply) => {
    const input = createLedgerSchema.parse(request.body);
    const ledger = await svc().createLedger(request.actor!, input);
    return reply.status(201).send(ledger);
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

  // --- Chart of Accounts (Wave A6 builder) ---
  app.get("/accounting/charts", { preHandler: app.authenticate }, async (request, reply) => {
    const query = z.object({ legalEntityId: uuidSchema.optional() }).parse(request.query);
    const charts = await svc().listCharts(request.actor!, {
      legalEntityId: query.legalEntityId,
    });
    return reply.send(charts);
  });

  app.post("/accounting/charts", { preHandler: app.authenticate }, async (request, reply) => {
    const body = chartSchema.parse(request.body);
    const chart = await svc().createChart(request.actor!, body);
    return reply.code(201).send(chart);
  });

  app.post("/accounting/charts/instantiate", { preHandler: app.authenticate }, async (request, reply) => {
    const body = instantiateTemplateSchema.parse(request.body);
    const result = await svc().instantiateTemplateForEntity(request.actor!, body);
    return reply.code(201).send(result);
  });

  app.post("/accounting/charts/:id/approve", { preHandler: app.authenticate }, async (request, reply) => {
    const params = z.object({ id: uuidSchema }).parse(request.params);
    const chart = await svc().approveChart(request.actor!, params.id);
    return reply.send(chart);
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

  // --- GL reconciliation (WP-FIN-04) ------------------------------------------

  app.get(
    "/accounting/periods/:id/reconciliation",
    { preHandler: app.authenticate },
    async (request, reply) => {
      const id = uuidSchema.parse((request.params as { id: string }).id);
      const reconciliation = await svc().reconcileJournalVsGl(request.actor!, id);
      return reply.send(reconciliation);
    },
  );

  // --- Posting rules (WP-FIN-05) ----------------------------------------------

  app.post("/accounting/posting-rules", { preHandler: app.authenticate }, async (request, reply) => {
    const input = createPostingRuleSchema.parse(request.body);
    const rule = await svc().createPostingRule(request.actor!, {
      ...input,
      materialityThreshold:
        input.materialityThreshold === undefined || input.materialityThreshold === null
          ? null
          : String(input.materialityThreshold),
    });
    return reply.status(201).send(rule);
  });

  app.get("/accounting/posting-rules", { preHandler: app.authenticate }, async (request, reply) => {
    const query = request.query as { triggerEventType?: string; isActive?: string };
    const filter = postingRuleFilterSchema.parse({
      triggerEventType: query.triggerEventType,
      isActive: query.isActive === undefined ? undefined : query.isActive === "true",
    });
    const rules = await svc().listPostingRules(request.actor!, filter);
    return reply.send(rules);
  });

  app.post(
    "/accounting/posting-rules/:id/deprecate",
    { preHandler: app.authenticate },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const rule = await svc().deprecatePostingRule(request.actor!, id);
      return reply.send(rule);
    },
  );

  app.post("/accounting/posting-rules/resolve", { preHandler: app.authenticate }, async (request, reply) => {
    const input = resolvePostingRuleSchema.parse(request.body);
    const result = await svc().resolvePostingRule(
      request.actor!,
      input.triggerEventType,
      input.accountingDate,
      String(input.amount),
    );
    return reply.send(result);
  });

  app.post("/accounting/posting-rules/generate", { preHandler: app.authenticate }, async (request, reply) => {
    const input = generateJournalFromRuleSchema.parse(request.body);
    const journal = await svc().generateJournalFromRule(request.actor!, {
      ...input,
      amount: String(input.amount),
      description: input.description ?? null,
    });
    return reply.status(201).send(journal);
  });

  // --- Event requeue (Phase 2 WP-INT-03) --------------------------------------
  // Manual requeue of a terminally-failed SCM accounting event: resets the
  // outbox state to 'pending' and zeroes the attempt counter so the
  // scheduler sweep re-claims and retries it. Permission:
  // finance.accounting.configure.
  app.post(
    "/accounting/events/:id/requeue",
    { preHandler: app.authenticate },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      await container.rbac.requirePermission(request.actor!, "finance.accounting.configure");
      await consumer().requeueEvent(request.actor!.tenantId, id);
      return reply.status(204).send();
    },
  );
}
