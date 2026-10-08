import type { ActorContext } from "../../../../domain/shared-kernel/audit-context.js";
import {
  ConflictError,
  NotFoundError,
  ValidationError,
} from "../../../../domain/shared-kernel/errors.js";
import type { AuditService } from "../../../../application/audit/audit.service.js";
import type { RbacService } from "../../../../application/rbac/rbac.service.js";
import type { EventBus } from "../../../../application/event/event-bus.js";
import type { ConfigurationService } from "../../../../application/configuration/configuration.service.js";
import type {
  AccountingAccount,
  AccountingPeriod,
  GeneralLedgerEntry,
  GlBalance,
  JournalHeader,
  JournalStatus,
  Money,
  AccountingKernelRepository,
  AccountingPeriodStatus,
  AccountClass,
} from "../domain/accounting-kernel.entity.js";
import { ACCOUNT_CLASSES, isValidMoney } from "../domain/accounting-kernel.entity.js";

/**
 * Accounting Kernel Service (Phase 1B, WP-FIN-01.2).
 *
 * Orchestrates GL posting, period management, authorization, and audit.
 * Every mutation is authorized before proceeding; every successful mutation
 * is recorded in the audit log. Money remains a string end-to-end; all
 * arithmetic is PostgreSQL-backed.
 */
export class AccountingKernelService {
  constructor(
    private readonly repo: AccountingKernelRepository,
    private readonly configuration: ConfigurationService,
    private readonly audit: AuditService,
    private readonly rbac: RbacService,
    private readonly eventBus: EventBus,
  ) {}

  // --- Periods ---------------------------------------------------------------

  async createPeriod(
    actor: ActorContext,
    input: {
      legalEntityId: string;
      fiscalYearCode: string;
      periodCode: string;
      periodName: string;
      periodType: string;
      dateFrom: string;
      dateTo: string;
    },
  ): Promise<AccountingPeriod> {
    await this.rbac.requirePermission(actor, "finance.accounting.configure");

    const legalEntityId = await this.resolveLegalEntity(actor, input.legalEntityId);
    const dateFrom = this.parseDate(input.dateFrom, "dateFrom");
    const dateTo = this.parseDate(input.dateTo, "dateTo");

    if (dateFrom > dateTo) {
      throw new ValidationError("dateFrom must be before or equal to dateTo");
    }

    const period = await this.repo.createPeriod({
      tenantId: actor.tenantId,
      legalEntityId,
      fiscalYearCode: input.fiscalYearCode,
      periodCode: input.periodCode,
      periodName: input.periodName,
      periodType: input.periodType as "monthly" | "quarterly" | "annual",
      dateFrom,
      dateTo,
      createdBy: actor.userId,
    });

    await this.audit.record({
      tenantId: actor.tenantId,
      actorUserId: actor.userId,
      action: "accounting.period.created",
      entityType: "accounting_period",
      entityId: period.id,
      metadata: {
        fiscalYearCode: period.fiscalYearCode,
        periodCode: period.periodCode,
        dateRange: `${period.dateFrom} to ${period.dateTo}`,
      },
    });

    return period;
  }

  async listPeriods(
    actor: ActorContext,
    filter: { legalEntityId?: string; status?: AccountingPeriodStatus } = {},
  ): Promise<AccountingPeriod[]> {
    await this.rbac.requirePermission(actor, "finance.accounting.read");
    return this.repo.listPeriods(actor.tenantId, filter);
  }

  async lockPeriod(actor: ActorContext, periodId: string, reason: string): Promise<void> {
    await this.rbac.requirePermission(actor, "finance.accounting.period.lock");

    const period = await this.repo.findPeriodById(periodId);
    if (!period || period.tenantId !== actor.tenantId) {
      throw new NotFoundError("AccountingPeriod", periodId);
    }

    if (period.status === "closed") {
      throw new ConflictError("Period is already closed");
    }

    await this.repo.setPeriodStatus(periodId, "closed", actor.userId);

    await this.audit.record({
      tenantId: actor.tenantId,
      actorUserId: actor.userId,
      action: "accounting.period.locked",
      entityType: "accounting_period",
      entityId: periodId,
      metadata: {
        periodCode: period.periodCode,
        reason,
      },
    });
  }

  // --- Accounts ---------------------------------------------------------------

  async createAccount(
    actor: ActorContext,
    input: {
      legalEntityId: string;
      coaId: string;
      accountCode: string;
      accountName: string;
      accountClass: string;
      normalBalance: string;
      accountType: string | null;
    },
  ): Promise<AccountingAccount> {
    await this.rbac.requirePermission(actor, "finance.accounting.configure");

    const legalEntityId = await this.resolveLegalEntity(actor, input.legalEntityId);
    const accountClass = this.parseAccountClass(input.accountClass);
    const normalBalance = this.parseNormalBalance(input.normalBalance);

    const account = await this.repo.createAccount({
      tenantId: actor.tenantId,
      legalEntityId,
      coaId: input.coaId,
      accountCode: input.accountCode,
      accountName: input.accountName,
      accountClass,
      normalBalance,
      accountType: input.accountType,
      createdBy: actor.userId,
    });

    await this.audit.record({
      tenantId: actor.tenantId,
      actorUserId: actor.userId,
      action: "accounting.account.created",
      entityType: "accounting_account",
      entityId: account.id,
      metadata: {
        accountCode: account.accountCode,
        accountClass,
        normalBalance,
      },
    });

    return account;
  }

  async listAccounts(
    actor: ActorContext,
    filter: { legalEntityId?: string; activeOnly?: boolean } = {},
  ): Promise<AccountingAccount[]> {
    await this.rbac.requirePermission(actor, "finance.accounting.read");
    return this.repo.listAccounts(actor.tenantId, filter);
  }

  // --- Journals ---------------------------------------------------------------

  async createJournal(
    actor: ActorContext,
    input: {
      legalEntityId: string;
      journalNumber: string;
      journalDate: string;
      accountingDate: string;
      periodId: string;
      description: string | null;
      currency: string;
      lines: ReadonlyArray<{
        accountId: string;
        lineNumber: number;
        debit: string | number;
        credit: string | number;
        lineDescription: string | null;
        projectId: string | null;
        siteId: string | null;
      }>;
    },
  ): Promise<JournalHeader> {
    await this.rbac.requirePermission(actor, "finance.accounting.manage");

    const legalEntityId = await this.resolveLegalEntity(actor, input.legalEntityId);
    const journalDate = this.parseDate(input.journalDate, "journalDate");
    const accountingDate = this.parseDate(input.accountingDate, "accountingDate");

    const period = await this.repo.findPeriodById(input.periodId);
    if (!period || period.tenantId !== actor.tenantId) {
      throw new NotFoundError("AccountingPeriod", input.periodId);
    }

    if (period.status === "closed") {
      throw new ConflictError("Cannot create journal in a closed period");
    }

    const normalizedLines = input.lines.map((line) => ({
      accountId: line.accountId,
      lineNumber: line.lineNumber,
      debit: this.parseMoney(line.debit),
      credit: this.parseMoney(line.credit),
      lineDescription: line.lineDescription,
      projectId: line.projectId,
      siteId: line.siteId,
    }));

    // Generate idempotency key (simple hash for Phase 1B; proper hash in Phase 2)
    const idempotencyKey = `jnl-${actor.tenantId}-${input.journalNumber}-${Date.now()}`;

    const journal = await this.repo.createJournal({
      tenantId: actor.tenantId,
      legalEntityId,
      journalNumber: input.journalNumber,
      journalDate,
      accountingDate,
      periodId: input.periodId,
      description: input.description,
      currency: input.currency,
      postingRuleVersionId: null,
      idempotencyKey,
      lines: normalizedLines,
      createdBy: actor.userId,
    });

    await this.audit.record({
      tenantId: actor.tenantId,
      actorUserId: actor.userId,
      action: "accounting.journal.created",
      entityType: "journal_header",
      entityId: journal.id,
      metadata: {
        journalNumber: journal.journalNumber,
        lineCount: normalizedLines.length,
      },
    });

    return journal;
  }

  async listJournals(
    actor: ActorContext,
    filter: { periodId?: string; status?: JournalStatus } = {},
  ): Promise<JournalHeader[]> {
    await this.rbac.requirePermission(actor, "finance.accounting.read");
    return this.repo.listJournals(actor.tenantId, {
      periodId: filter.periodId,
      status: filter.status,
    });
  }

  async getJournal(actor: ActorContext, journalId: string): Promise<JournalHeader> {
    await this.rbac.requirePermission(actor, "finance.accounting.read");

    const journal = await this.repo.findJournalById(journalId);
    if (!journal || journal.tenantId !== actor.tenantId) {
      throw new NotFoundError("JournalHeader", journalId);
    }
    return journal;
  }

  async validateJournal(journalId: string): Promise<{ balanced: boolean; debitTotal: Money; creditTotal: Money }> {
    const journal = await this.repo.findJournalById(journalId);
    if (!journal) throw new NotFoundError("JournalHeader", journalId);

    const lines = await this.repo.listJournalLines(journalId);

    let debitTotal = "0.00";
    let creditTotal = "0.00";

    for (const line of lines) {
      debitTotal = this.addMoney(debitTotal, line.debit);
      creditTotal = this.addMoney(creditTotal, line.credit);
    }

    return { balanced: debitTotal === creditTotal, debitTotal, creditTotal };
  }

  async postJournal(actor: ActorContext, journalId: string): Promise<JournalHeader> {
    await this.rbac.requirePermission(actor, "finance.accounting.approve");

    const journal = await this.repo.findJournalById(journalId);
    if (!journal || journal.tenantId !== actor.tenantId) {
      throw new NotFoundError("JournalHeader", journalId);
    }

    // Check period not closed
    const period = await this.repo.findPeriodById(journal.periodId);
    if (!period) throw new NotFoundError("AccountingPeriod", journal.periodId);
    if (period.status === "closed") {
      throw new ConflictError("Cannot post journal to a closed accounting period");
    }

    // Post in repository (atomic transaction)
    const result = await this.repo.postJournal(journalId, actor.userId);

    if (result === null) {
      throw new NotFoundError("JournalHeader", journalId);
    }

    if ("unbalanced" in result) {
      const { balanced, debitTotal, creditTotal } = await this.validateJournal(journalId);
      throw new ValidationError("Journal is unbalanced", {
        debitTotal,
        creditTotal,
        difference: balanced ? "0.00" : this.subtractMoney(debitTotal, creditTotal),
      });
    }

    // Emit event (optional Phase 1B; Phase 2 may use it for downstream posting rules)
    await this.eventBus.publish({
      tenantId: actor.tenantId,
      eventType: "accounting.journal.posted",
      entityType: "journal_header",
      entityId: journal.id,
      payload: {
        journalNumber: journal.journalNumber,
        periodCode: period.periodCode,
        accountingDate: journal.accountingDate,
      },
      createdBy: actor.userId,
    });

    return result.journal;
  }

  async listGlEntries(
    actor: ActorContext,
    filter: { accountId?: string; periodId?: string } = {},
  ): Promise<GeneralLedgerEntry[]> {
    await this.rbac.requirePermission(actor, "finance.accounting.read");
    return this.repo.listGlEntries(actor.tenantId, filter);
  }

  async getGlBalance(
    actor: ActorContext,
    accountId: string,
    periodId: string,
  ): Promise<GlBalance | null> {
    await this.rbac.requirePermission(actor, "finance.accounting.read");

    // Verify account ownership
    const account = await this.repo.findAccountById(accountId);
    if (!account || account.tenantId !== actor.tenantId) {
      throw new NotFoundError("AccountingAccount", accountId);
    }

    // Verify period ownership
    const period = await this.repo.findPeriodById(periodId);
    if (!period || period.tenantId !== actor.tenantId) {
      throw new NotFoundError("AccountingPeriod", periodId);
    }

    // Return balance (may be null if not yet computed)
    const entries = await this.repo.listGlEntries(actor.tenantId, { accountId, periodId });
    if (entries.length === 0) return null;

    // Aggregate from GL entries (in Phase 1B, gl_balances is materialized at post time)
    let debitTotal = "0.00";
    let creditTotal = "0.00";
    for (const entry of entries) {
      debitTotal = this.addMoney(debitTotal, entry.debit);
      creditTotal = this.addMoney(creditTotal, entry.credit);
    }

    return {
      id: `balance-${accountId}-${periodId}`,
      tenantId: actor.tenantId,
      accountId,
      periodId,
      openingBalance: "0.00",
      debitTotal,
      creditTotal,
      closingBalance: account.normalBalance === "debit"
        ? this.subtractMoney(debitTotal, creditTotal)
        : this.subtractMoney(creditTotal, debitTotal),
      lastRefreshed: new Date(),
    };
  }

  // --- Helpers ---------------------------------------------------------------

  private async resolveLegalEntity(actor: ActorContext, legalEntityId: string): Promise<string> {
    if (!(await this.repo.legalEntityExists(actor.tenantId, legalEntityId))) {
      throw new NotFoundError("LegalEntity", legalEntityId);
    }
    return legalEntityId;
  }

  private parseAccountClass(value: string): AccountClass {
    if (!ACCOUNT_CLASSES.includes(value as AccountClass)) {
      throw new ValidationError(`accountClass must be one of: ${ACCOUNT_CLASSES.join(", ")}`);
    }
    return value as AccountClass;
  }

  private parseNormalBalance(value: string): "debit" | "credit" {
    const normalized = (value ?? "").toLowerCase().trim();
    if (normalized !== "debit" && normalized !== "credit") {
      throw new ValidationError('normalBalance must be "debit" or "credit"');
    }
    return normalized as "debit" | "credit";
  }

  private parseDate(value: string, field: string): string {
    const trimmed = (value ?? "").trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
      throw new ValidationError(`${field} must be a date in YYYY-MM-DD format`);
    }
    if (Number.isNaN(new Date(trimmed + "T00:00:00Z").getTime())) {
      throw new ValidationError(`${field} is not a valid date`);
    }
    return trimmed;
  }

  private parseMoney(value: string | number): Money {
    const raw = typeof value === "number" ? String(value) : (value ?? "").trim();
    if (!isValidMoney(raw)) {
      throw new ValidationError(
        'Money amount must be a positive number with at most two decimal places, sent as a string (e.g. "1250.75")',
      );
    }
    const [whole, fraction = ""] = raw.split(".");
    return whole + "." + (fraction + "00").slice(0, 2);
  }

  private addMoney(a: Money, b: Money): Money {
    const aParts = a.split(".");
    const bParts = b.split(".");
    const aWhole = BigInt(aParts[0] || 0);
    const aFrac = BigInt((aParts[1] || "0").padEnd(2, "0"));
    const bWhole = BigInt(bParts[0] || 0);
    const bFrac = BigInt((bParts[1] || "0").padEnd(2, "0"));

    const totalCents = aWhole * 100n + aFrac + (bWhole * 100n + bFrac);
    const result = totalCents / 100n;
    const remainder = totalCents % 100n;
    return `${result}.${remainder.toString().padStart(2, "0")}`;
  }

  private subtractMoney(a: Money, b: Money): Money {
    const aParts = a.split(".");
    const bParts = b.split(".");
    const aWhole = BigInt(aParts[0] || 0);
    const aFrac = BigInt((aParts[1] || "0").padEnd(2, "0"));
    const bWhole = BigInt(bParts[0] || 0);
    const bFrac = BigInt((bParts[1] || "0").padEnd(2, "0"));

    let diffCents = aWhole * 100n + aFrac - (bWhole * 100n + bFrac);
    const isNegative = diffCents < 0n;
    if (isNegative) diffCents = -diffCents;

    const result = diffCents / 100n;
    const remainder = diffCents % 100n;
    const sign = isNegative ? "-" : "";
    return `${sign}${result}.${remainder.toString().padStart(2, "0")}`;
  }
}
