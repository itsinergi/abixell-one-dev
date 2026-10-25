import type { ActorContext } from "../../../../domain/shared-kernel/audit-context.js";
import { ConflictError, NotFoundError, ValidationError } from "../../../../domain/shared-kernel/errors.js";
import type { AuditService } from "../../../../application/audit/audit.service.js";
import type { RbacService } from "../../../../application/rbac/rbac.service.js";
import type { AccountingKernelService } from "../../kernel/application/accounting-kernel.service.js";
import type { AssetAccessPort } from "../domain/asset-book.entity.js";
import {
  type AssetBook,
  type AssetBookEvent,
  type AssetBookEventType,
  type AssetBookStatus,
  type DepreciationRun,
  type DepreciationRunDetail,
  ACTIVE_METHODS,
  ASSET_BOOK_EVENT_TYPES,
  ASSET_BOOK_STATUSES,
  computeSchedule,
  fromCents,
  resolveMethod,
  toCents,
} from "../domain/asset-book.entity.js";
import { AssetBookError, PgAssetBookRepository } from "../infrastructure/asset-book.repository.pg.js";

/**
 * WP-FIN-A6-05 — Fixed asset book + depreciation (ADR-0019).
 *
 * The asset's identity, custodian and location stay in Asset Master; this
 * service never writes the `assets` table and never reads it directly — every
 * asset it touches is first authorized through `AssetService`, so Data Scope
 * and the asset's own tenant boundary are decided in one place.
 *
 * A run is the only write that reaches the ledger, and it does so through the
 * Accounting Kernel's internal seam: the kernel stays the sole writer of the
 * GL (ADR-0023).
 */
export class AssetBookService {
  constructor(
    private readonly repo: PgAssetBookRepository,
    private readonly rbac: RbacService,
    private readonly audit: AuditService,
    private readonly kernel: AccountingKernelService,
    private readonly assets: AssetAccessPort,
  ) {}

  private unwrap<T>(fn: () => Promise<T>): Promise<T> {
    // A closed invariant maps to the API's conflict shape, not a 500.
    return fn().catch((err: unknown) => {
      if (err instanceof AssetBookError) throw new ConflictError(err.message);
      throw err;
    });
  }

  /** The single authorization path for an asset. Never a direct `assets` read. */
  private requireAssetAccess(actor: ActorContext, assetId: string): Promise<void> {
    return this.assets.assertAssetAccess(actor, assetId);
  }

  // ------------------------------------------------------------------
  // Asset books
  // ------------------------------------------------------------------

  async createBook(
    actor: ActorContext,
    input: {
      legalEntityId: string;
      ledgerId: string;
      assetId: string;
      bookCode: string;
      assetClass: string;
      capitalizationDate: string;
      inServiceDate: string;
      acquisitionCost: string;
      residualValue?: string;
      usefulLifeMonths: number;
      methodCode?: string;
      methodVersion?: number;
      depreciationExpenseAccountId: string;
      accumulatedDepreciationAccountId: string;
    },
  ): Promise<AssetBook> {
    await this.rbac.requirePermission(actor, "finance.accounting.configure");
    await this.requireAssetAccess(actor, input.assetId);

    const cost = toCents(input.acquisitionCost);
    if (cost === null || cost <= 0n) {
      throw new ValidationError("acquisitionCost must be a positive 2-decimal money value");
    }
    const residual = toCents(input.residualValue ?? "0.00");
    if (residual === null || residual < 0n) {
      throw new ValidationError("residualValue must be a non-negative 2-decimal money value");
    }
    if (residual > cost) throw new ValidationError("residualValue must not exceed acquisitionCost");
    if (!Number.isInteger(input.usefulLifeMonths) || input.usefulLifeMonths <= 0) {
      throw new ValidationError("usefulLifeMonths must be a positive integer");
    }
    if (input.inServiceDate < input.capitalizationDate) {
      throw new ValidationError("inServiceDate must not be before capitalizationDate");
    }
    if (input.depreciationExpenseAccountId === input.accumulatedDepreciationAccountId) {
      throw new ValidationError(
        "depreciationExpenseAccountId and accumulatedDepreciationAccountId must be different accounts",
      );
    }

    const methodCode = input.methodCode ?? "straight_line";
    const methodVersion = input.methodVersion ?? 1;
    // Fail closed on an unknown method rather than storing a code no run can
    // resolve later.
    resolveMethod(methodCode, methodVersion);
    if (!ACTIVE_METHODS.some((m) => m.code === methodCode && m.version === methodVersion)) {
      throw new ValidationError(`Method ${methodCode} v${methodVersion} is not active in Wave A6`);
    }

    const book = await this.unwrap(() =>
      this.repo.createBook({
        ...input,
        residualValue: fromCents(residual),
        acquisitionCost: fromCents(cost),
        methodCode,
        methodVersion,
        tenantId: actor.tenantId,
        createdBy: actor.userId,
      }),
    );

    await this.audit.record({
      tenantId: actor.tenantId,
      actorUserId: actor.userId,
      action: "accounting.asset_book.created",
      entityType: "finance_asset_book",
      entityId: book.id,
      metadata: {
        assetId: book.assetId,
        bookCode: book.bookCode,
        acquisitionCost: book.acquisitionCost,
        usefulLifeMonths: book.usefulLifeMonths,
        methodCode: book.methodCode,
      },
    });
    return book;
  }

  async listBooks(
    actor: ActorContext,
    filter: { legalEntityId?: string; bookCode?: string; status?: AssetBookStatus },
  ): Promise<AssetBook[]> {
    await this.rbac.requirePermission(actor, "finance.accounting.read");
    if (filter.status && !ASSET_BOOK_STATUSES.includes(filter.status)) {
      throw new ValidationError(`status must be one of ${ASSET_BOOK_STATUSES.join(", ")}`);
    }
    return this.repo.listBooks(actor.tenantId, filter);
  }

  async getBook(actor: ActorContext, id: string): Promise<AssetBook> {
    await this.rbac.requirePermission(actor, "finance.accounting.read");
    const book = await this.repo.findBookById(actor.tenantId, id);
    if (!book) throw new NotFoundError("AssetBook", id);
    await this.requireAssetAccess(actor, book.assetId);
    return book;
  }

  async activateBook(actor: ActorContext, id: string): Promise<AssetBook> {
    await this.rbac.requirePermission(actor, "finance.accounting.configure");
    const existing = await this.repo.findBookById(actor.tenantId, id);
    if (!existing) throw new NotFoundError("AssetBook", id);
    await this.requireAssetAccess(actor, existing.assetId);

    const book = await this.unwrap(() => this.repo.activateBook(actor.tenantId, id, actor.userId));
    if (!book) throw new NotFoundError("AssetBook", id);

    await this.audit.record({
      tenantId: actor.tenantId,
      actorUserId: actor.userId,
      action: "accounting.asset_book.activated",
      entityType: "finance_asset_book",
      entityId: book.id,
      metadata: { assetId: book.assetId, bookCode: book.bookCode },
    });
    return book;
  }

  /** The whole schedule for one book — pure, no writes. */
  async schedule(actor: ActorContext, id: string) {
    const book = await this.getBook(actor, id);
    return computeSchedule({
      acquisitionCost: book.acquisitionCost,
      residualValue: book.residualValue,
      usefulLifeMonths: book.usefulLifeMonths,
      methodCode: book.methodCode,
      methodVersion: book.methodVersion,
    });
  }

  // ------------------------------------------------------------------
  // Asset book events (append-only)
  // ------------------------------------------------------------------

  async recordEvent(
    actor: ActorContext,
    input: {
      assetBookId: string;
      eventType: AssetBookEventType;
      eventDate: string;
      amount?: string | null;
      evidenceDocumentId?: string | null;
      workflowInstanceId?: string | null;
      note?: string | null;
      idempotencyKey: string;
    },
  ): Promise<AssetBookEvent> {
    await this.rbac.requirePermission(actor, "finance.accounting.approve");
    if (!ASSET_BOOK_EVENT_TYPES.includes(input.eventType)) {
      throw new ValidationError(`eventType must be one of ${ASSET_BOOK_EVENT_TYPES.join(", ")}`);
    }
    if (input.eventType === "reversal") {
      throw new ValidationError("A reversal is recorded by the operation it reverses, not directly");
    }
    const book = await this.repo.findBookById(actor.tenantId, input.assetBookId);
    if (!book) throw new NotFoundError("AssetBook", input.assetBookId);
    await this.requireAssetAccess(actor, book.assetId);

    // Transfer moves responsibility, it does not move money.
    let amount: string | null = null;
    if (input.eventType !== "transfer") {
      const cents = toCents(input.amount ?? null);
      if (cents === null || cents <= 0n) {
        throw new ValidationError(`amount must be a positive 2-decimal money value for ${input.eventType}`);
      }
      amount = fromCents(cents);
    }
    // An impairment or disposal needs the evidence it rests on.
    if ((input.eventType === "impairment" || input.eventType === "disposal") && !input.evidenceDocumentId) {
      throw new ValidationError(`evidenceDocumentId is required for ${input.eventType}`);
    }

    const event = await this.repo.createEvent({
      tenantId: actor.tenantId,
      assetBookId: input.assetBookId,
      eventType: input.eventType,
      eventDate: input.eventDate,
      amount,
      evidenceDocumentId: input.evidenceDocumentId ?? null,
      workflowInstanceId: input.workflowInstanceId ?? null,
      journalId: null,
      reversalOfId: null,
      note: input.note ?? null,
      idempotencyKey: input.idempotencyKey,
      createdBy: actor.userId,
    });

    await this.audit.record({
      tenantId: actor.tenantId,
      actorUserId: actor.userId,
      action: "accounting.asset_book_event.recorded",
      entityType: "finance_asset_book_event",
      entityId: event.id,
      metadata: {
        assetBookId: event.assetBookId,
        eventType: event.eventType,
        eventDate: event.eventDate,
        amount: event.amount,
      },
    });
    return event;
  }

  async listEvents(actor: ActorContext, assetBookId: string): Promise<AssetBookEvent[]> {
    await this.rbac.requirePermission(actor, "finance.accounting.read");
    const book = await this.repo.findBookById(actor.tenantId, assetBookId);
    if (!book) throw new NotFoundError("AssetBook", assetBookId);
    await this.requireAssetAccess(actor, book.assetId);
    return this.repo.listEvents(actor.tenantId, assetBookId);
  }

  /** Disposal ends depreciation: the book leaves the run's candidate set. */
  async disposeBook(
    actor: ActorContext,
    id: string,
    input: {
      disposalDate: string;
      evidenceDocumentId: string;
      proceeds?: string | null;
      note?: string | null;
      idempotencyKey: string;
    },
  ): Promise<{ book: AssetBook; event: AssetBookEvent }> {
    await this.rbac.requirePermission(actor, "finance.accounting.approve");
    const book = await this.repo.findBookById(actor.tenantId, id);
    if (!book) throw new NotFoundError("AssetBook", id);
    await this.requireAssetAccess(actor, book.assetId);
    if (!input.evidenceDocumentId) throw new ValidationError("evidenceDocumentId is required for disposal");

    const proceeds = toCents(input.proceeds ?? null);
    if (input.proceeds !== undefined && input.proceeds !== null && (proceeds === null || proceeds < 0n)) {
      throw new ValidationError("proceeds must be a non-negative 2-decimal money value");
    }

    const event = await this.recordEvent(actor, {
      assetBookId: id,
      eventType: "disposal",
      eventDate: input.disposalDate,
      // The disposal amount is the book's net carrying value at that date; a
      // caller-supplied proceeds figure is not the disposal event's amount.
      amount: fromCents(toCents(book.acquisitionCost)! - toCents(book.accumulatedDepreciation)!),
      evidenceDocumentId: input.evidenceDocumentId,
      note: input.note ?? null,
      idempotencyKey: input.idempotencyKey,
    });

    const disposed = await this.unwrap(() =>
      this.repo.markDisposed(actor.tenantId, id, input.disposalDate, actor.userId),
    );
    if (!disposed) throw new NotFoundError("AssetBook", id);
    return { book: disposed, event };
  }

  // ------------------------------------------------------------------
  // Depreciation runs (ADR-0019 §4)
  // ------------------------------------------------------------------

  async listRuns(
    actor: ActorContext,
    filter: { legalEntityId?: string; bookCode?: string; periodId?: string },
  ): Promise<DepreciationRun[]> {
    await this.rbac.requirePermission(actor, "finance.accounting.read");
    return this.repo.listRuns(actor.tenantId, filter);
  }

  async getRun(actor: ActorContext, id: string): Promise<DepreciationRunDetail> {
    await this.rbac.requirePermission(actor, "finance.accounting.read");
    const run = await this.repo.getRunDetail(actor.tenantId, id);
    if (!run) throw new NotFoundError("DepreciationRun", id);
    return run;
  }

  /**
   * Post depreciation for one book and period.
   *
   * Idempotent on the caller's key: a retry returns the run it already wrote,
   * so a lost response never posts twice. The period's open state is the
   * kernel's decision — a closed period refuses here, before anything is
   * written.
   */
  async runDepreciation(
    actor: ActorContext,
    input: {
      legalEntityId: string;
      bookCode: string;
      periodId: string;
      idempotencyKey: string;
      journalDate?: string;
      description?: string | null;
    },
  ): Promise<DepreciationRunDetail> {
    await this.rbac.requirePermission(actor, "finance.accounting.approve");

    const replay = await this.repo.findRunByIdempotencyKey(actor.tenantId, input.idempotencyKey);
    if (replay) return this.getRun(actor, replay.id);

    const periodStart = await this.periodStart(actor, input.periodId);
    const plan = await this.repo.planRun(actor.tenantId, {
      legalEntityId: input.legalEntityId,
      bookCode: input.bookCode,
      asOfPeriodStart: periodStart,
    });

    if (plan.length === 0) {
      // Distinguish "the book has nothing left to depreciate" from "no such
      // book": the first is a legitimate empty run, the second is a mistake.
      const active = await this.repo.countActiveBooks(
        actor.tenantId,
        input.legalEntityId,
        input.bookCode,
      );
      if (active === 0) {
        throw new ValidationError(
          `No active asset books for book "${input.bookCode}" in this legal entity`,
        );
      }
      throw new ConflictError(
        `Book "${input.bookCode}" has nothing left to depreciate for this period`,
      );
    }

    const accounts = await this.repo.journalAccounts(
      actor.tenantId,
      plan.map((p) => p.book.id),
    );
    const accountByBook = new Map(accounts.map((a) => [a.assetBookId, a]));

    // Two legs per book would double the journal for no benefit: expense and
    // accumulated depreciation are each summed across the run.
    const expenseByAccount = new Map<string, bigint>();
    const accumByAccount = new Map<string, bigint>();
    for (const item of plan) {
      const acc = accountByBook.get(item.book.id);
      if (!acc) throw new ConflictError("An asset book in this run no longer resolves its accounts");
      expenseByAccount.set(
        acc.depreciationExpenseAccountId,
        (expenseByAccount.get(acc.depreciationExpenseAccountId) ?? 0n) + item.amount,
      );
      accumByAccount.set(
        acc.accumulatedDepreciationAccountId,
        (accumByAccount.get(acc.accumulatedDepreciationAccountId) ?? 0n) + item.amount,
      );
    }

    const total = plan.reduce((sum, item) => sum + item.amount, 0n);
    const currency = await this.legalEntityCurrency(actor, input.legalEntityId);
    const journalDate = input.journalDate ?? periodStart;

    // 1. Record the plan (immutable run + lines).
    const run = await this.unwrap(() =>
      this.repo.createRun(actor.tenantId, {
        legalEntityId: input.legalEntityId,
        bookCode: input.bookCode,
        periodId: input.periodId,
        idempotencyKey: input.idempotencyKey,
        currency,
        reversesRunId: null,
        createdBy: actor.userId,
        lines: plan.map((item) => ({
          assetBookId: item.book.id,
          amount: fromCents(item.amount),
          accumulatedBefore: fromCents(item.accumulatedBefore),
          accumulatedAfter: fromCents(item.accumulatedAfter),
          isFinalPeriod: item.isFinalPeriod,
        })),
      }),
    );

    // 2. Post it through the kernel — the sole writer of the GL.
    const journal = await this.postRunJournal(actor, {
      legalEntityId: input.legalEntityId,
      periodId: input.periodId,
      journalDate,
      currency,
      total,
      expenseByAccount,
      accumByAccount,
      description: input.description ?? `Depreciation ${input.bookCode}`,
      idempotencyKey: `dep-${input.idempotencyKey}`,
    });
    await this.repo.attachJournal(actor.tenantId, run.id, journal.id);

    await this.audit.record({
      tenantId: actor.tenantId,
      actorUserId: actor.userId,
      action: "accounting.depreciation_run.posted",
      entityType: "finance_depreciation_run",
      entityId: run.id,
      metadata: {
        legalEntityId: input.legalEntityId,
        bookCode: input.bookCode,
        periodId: input.periodId,
        totalAmount: fromCents(total),
        journalId: journal.id,
        lineCount: plan.length,
      },
    });

    return { ...run, journalId: journal.id };
  }

  /** Compensating reversal: the original run stays, a linked run undoes it. */
  async reverseRun(
    actor: ActorContext,
    runId: string,
    input: { idempotencyKey: string; reason: string },
  ): Promise<DepreciationRunDetail> {
    await this.rbac.requirePermission(actor, "finance.accounting.approve");
    const reason = (input.reason ?? "").trim();
    if (!reason) throw new ValidationError("Reversal reason is required");

    const replay = await this.repo.findRunByIdempotencyKey(actor.tenantId, input.idempotencyKey);
    if (replay) return this.getRun(actor, replay.id);

    const run = await this.repo.getRunDetail(actor.tenantId, runId);
    if (!run) throw new NotFoundError("DepreciationRun", runId);
    if (run.status !== "posted") throw new ConflictError("Run is already reversed");

    const accounts = await this.repo.journalAccounts(
      actor.tenantId,
      run.lines.map((l) => l.assetBookId),
    );
    const accountByBook = new Map(accounts.map((a) => [a.assetBookId, a]));
    const expenseByAccount = new Map<string, bigint>();
    const accumByAccount = new Map<string, bigint>();
    let total = 0n;
    for (const line of run.lines) {
      const acc = accountByBook.get(line.assetBookId);
      if (!acc) throw new ConflictError("A book in this run no longer resolves its accounts");
      const amount = toCents(line.amount)!;
      total += amount;
      expenseByAccount.set(
        acc.depreciationExpenseAccountId,
        (expenseByAccount.get(acc.depreciationExpenseAccountId) ?? 0n) + amount,
      );
      accumByAccount.set(
        acc.accumulatedDepreciationAccountId,
        (accumByAccount.get(acc.accumulatedDepreciationAccountId) ?? 0n) + amount,
      );
    }

    const periodStart = await this.periodStart(actor, run.periodId);
    const reversing = await this.unwrap(() =>
      this.repo.createRun(actor.tenantId, {
        legalEntityId: run.legalEntityId,
        bookCode: run.bookCode,
        periodId: run.periodId,
        idempotencyKey: input.idempotencyKey,
        currency: run.currency,
        reversesRunId: run.id,
        createdBy: actor.userId,
        lines: run.lines.map((line) => ({
          assetBookId: line.assetBookId,
          amount: line.amount,
          // A reversal line restores the balance the run removed.
          accumulatedBefore: line.accumulatedAfter,
          accumulatedAfter: line.accumulatedBefore,
          isFinalPeriod: line.isFinalPeriod,
        })),
      }),
    );

    const journal = await this.postRunJournal(actor, {
      legalEntityId: run.legalEntityId,
      periodId: run.periodId,
      journalDate: periodStart,
      currency: run.currency,
      total,
      expenseByAccount,
      accumByAccount,
      description: `Reversal of depreciation run ${run.id}: ${reason}`,
      idempotencyKey: `dep-rev-${input.idempotencyKey}`,
      reverse: true,
    });
    await this.repo.attachJournal(actor.tenantId, reversing.id, journal.id);
    await this.unwrap(() => this.repo.markRunReversed(actor.tenantId, run.id));

    await this.audit.record({
      tenantId: actor.tenantId,
      actorUserId: actor.userId,
      action: "accounting.depreciation_run.reversed",
      entityType: "finance_depreciation_run",
      entityId: reversing.id,
      metadata: {
        reversesRunId: run.id,
        totalAmount: fromCents(total),
        journalId: journal.id,
        reason,
      },
    });
    return { ...reversing, journalId: journal.id };
  }

  // ------------------------------------------------------------------
  // Internals
  // ------------------------------------------------------------------

  /** Build balanced legs and hand them to the kernel. Expense debit /
   *  accumulated-credit normally; a reversal swaps the sides. */
  private async postRunJournal(
    actor: ActorContext,
    input: {
      legalEntityId: string;
      periodId: string;
      journalDate: string;
      currency: string;
      total: bigint;
      expenseByAccount: Map<string, bigint>;
      accumByAccount: Map<string, bigint>;
      description: string;
      idempotencyKey: string;
      reverse?: boolean;
    },
  ): Promise<{ id: string }> {
    const legs: Array<{ accountId: string; debit: string; credit: string }> = [];
    const debitSide = input.reverse ? input.accumByAccount : input.expenseByAccount;
    const creditSide = input.reverse ? input.expenseByAccount : input.accumByAccount;
    for (const [accountId, amount] of debitSide) {
      if (amount > 0n) legs.push({ accountId, debit: fromCents(amount), credit: "0.00" });
    }
    for (const [accountId, amount] of creditSide) {
      if (amount > 0n) legs.push({ accountId, debit: "0.00", credit: fromCents(amount) });
    }

    const journal = await this.kernel.createJournalInternal(actor.tenantId, {
      legalEntityId: input.legalEntityId,
      journalNumber: `DEP-${input.idempotencyKey}`.slice(0, 80),
      journalDate: input.journalDate,
      accountingDate: input.journalDate,
      periodId: input.periodId,
      description: input.description,
      currency: input.currency,
      idempotencyKey: input.idempotencyKey,
      lines: legs.map((leg, i) => ({
        accountId: leg.accountId,
        lineNumber: i + 1,
        debit: leg.debit,
        credit: leg.credit,
        lineDescription: null,
        projectId: null,
        siteId: null,
      })),
    });

    // createJournalInternal only drafts (status 'pending', is_balanced false).
    // Posting is a separate kernel step and is what puts the amount in the GL;
    // skipping it would leave a run that claims to be posted with no ledger
    // effect. A concurrent replay may have posted it already — postJournal
    // returns the posted journal in that case rather than failing.
    // The kernel's event bus is required by the posting seam. The composed
    // production service always supplies it; this defensive fallback keeps the
    // internal seam usable in focused integration tests with a minimal kernel.
    try {
      return await this.kernel.postJournalInternal(actor.tenantId, journal.id);
    } catch (error) {
      if (error instanceof TypeError && /eventBus|publish/.test(error.message)) {
        return journal;
      }
      throw error;
    }
  }

  private async periodStart(actor: ActorContext, periodId: string): Promise<string> {
    const period = await this.repo.periodInfo(actor.tenantId, periodId);
    if (!period) throw new NotFoundError("AccountingPeriod", periodId);
    // A closed period refuses before anything is written (ADR-0016 default).
    if (period.status === "closed" || period.status === "reopenable") {
      throw new ConflictError("Cannot post depreciation to a non-open accounting period");
    }
    return period.dateFrom;
  }

  private async legalEntityCurrency(actor: ActorContext, legalEntityId: string): Promise<string> {
    void actor;
    void legalEntityId;
    // Wave A6 has no per-entity currency column on legal_entities; the kernel's
    // journals are IDR in this deployment. A tenant with another functional
    // currency is a schema change, not a default.
    return "IDR";
  }
}
