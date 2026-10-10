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
  NormalBalance,
  PostingRule,
  PostingRuleLeg,
  PostingRuleFilter,
  ResolvePostingRuleResult,
  AccountingKernelRepository,
  AccountingPeriodStatus,
  AccountClass,
  ReversalType,
} from "../domain/accounting-kernel.entity.js";
import { ACCOUNT_CLASSES, COA_MAX_DEPTH, isValidMoney } from "../domain/accounting-kernel.entity.js";
import type { RuleRegistryRepository } from "../../../../domain/rules/rule-registry.entity.js";

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
    /** WP-APR-02 — optional central rule registry; consulted before the
     * posting-rules table (rule_key `finance.posting_rule:<event>`). */
    private readonly ruleRegistry?: RuleRegistryRepository,
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
    if (period.status === "reopenable") {
      throw new ConflictError("A pending reopen request must be approved or rejected before the period can be locked");
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

  // --- Period reopen (maker-checker, WP-FIN-03, Epic 14 §4.14) --------------
  //
  // Reopening a closed period is its own maker-checker flow: the requester and
  // the approver must be two different people, the reason and the impact
  // evidence are mandatory, and the trail is append-only. No permission bypasses
  // the "two different people" rule — a Super Admin with every permission still
  // cannot approve their own request.

  /** Maker step: request a reopen of a closed period. */
  async requestPeriodReopen(
    actor: ActorContext,
    periodId: string,
    input: { reason: string; impactEvidence: string },
  ): Promise<AccountingPeriod> {
    // The requester holds the same authority as the one who closes the period.
    await this.rbac.requirePermission(actor, "finance.accounting.period.lock");

    const period = await this.repo.findPeriodById(periodId);
    if (!period || period.tenantId !== actor.tenantId) {
      throw new NotFoundError("AccountingPeriod", periodId);
    }

    if (period.status !== "closed") {
      throw new ConflictError("Only a closed period can be reopened");
    }

    const reason = (input.reason ?? "").trim();
    if (!reason) {
      throw new ValidationError("Reopen reason is required and cannot be empty");
    }
    const impactEvidence = (input.impactEvidence ?? "").trim();
    if (!impactEvidence) {
      throw new ValidationError("Reopen impact evidence is required and cannot be empty");
    }

    const updated = await this.repo.requestPeriodReopen({
      periodId,
      requestedBy: actor.userId,
      reason,
      impactEvidence,
    });
    if (!updated) {
      // Lost the race: another request moved the period out of `closed`.
      throw new ConflictError("Only a closed period can be reopened");
    }

    await this.audit.record({
      tenantId: actor.tenantId,
      actorUserId: actor.userId,
      action: "accounting.period.reopen_requested",
      entityType: "accounting_period",
      entityId: periodId,
      metadata: {
        periodCode: period.periodCode,
        reason,
        impactEvidence,
        requestedBy: actor.userId,
      },
    });

    return updated;
  }

  /** Checker step: approve a pending reopen. Approver must differ from requester. */
  async approvePeriodReopen(
    actor: ActorContext,
    periodId: string,
    input: { note?: string } = {},
  ): Promise<AccountingPeriod> {
    await this.rbac.requirePermission(actor, "finance.accounting.approve");

    const period = await this.repo.findPeriodById(periodId);
    if (!period || period.tenantId !== actor.tenantId) {
      throw new NotFoundError("AccountingPeriod", periodId);
    }

    if (period.status !== "reopenable") {
      throw new ConflictError("No pending reopen request for this period");
    }

    // Maker-checker SoD: the approver must be a different person from the
    // requester. This check is unconditional — no permission short-circuits it.
    if (period.reopenRequestedBy === actor.userId) {
      throw new ConflictError(
        "The approver must be a different person from the requester (maker-checker)",
      );
    }

    const updated = await this.repo.approvePeriodReopen({
      periodId,
      approvedBy: actor.userId,
    });
    if (!updated) {
      throw new ConflictError("No pending reopen request for this period");
    }

    await this.audit.record({
      tenantId: actor.tenantId,
      actorUserId: actor.userId,
      action: "accounting.period.reopen_approved",
      entityType: "accounting_period",
      entityId: periodId,
      metadata: {
        periodCode: period.periodCode,
        requestedBy: period.reopenRequestedBy,
        approvedBy: actor.userId,
        note: input.note ?? null,
      },
    });

    return updated;
  }

  /** Checker step (negative): reject a pending reopen, returning the period to closed. */
  async rejectPeriodReopen(
    actor: ActorContext,
    periodId: string,
    input: { reason: string },
  ): Promise<AccountingPeriod> {
    await this.rbac.requirePermission(actor, "finance.accounting.approve");

    const period = await this.repo.findPeriodById(periodId);
    if (!period || period.tenantId !== actor.tenantId) {
      throw new NotFoundError("AccountingPeriod", periodId);
    }

    if (period.status !== "reopenable") {
      throw new ConflictError("No pending reopen request for this period");
    }

    const reason = (input.reason ?? "").trim();
    if (!reason) {
      throw new ValidationError("Rejection reason is required and cannot be empty");
    }

    const updated = await this.repo.rejectPeriodReopen({
      periodId,
      rejectedBy: actor.userId,
      reason,
    });
    if (!updated) {
      throw new ConflictError("No pending reopen request for this period");
    }

    await this.audit.record({
      tenantId: actor.tenantId,
      actorUserId: actor.userId,
      action: "accounting.period.reopen_rejected",
      entityType: "accounting_period",
      entityId: periodId,
      metadata: {
        periodCode: period.periodCode,
        requestedBy: period.reopenRequestedBy,
        rejectedBy: actor.userId,
        reason,
      },
    });

    return updated;
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
      parentAccountId?: string | null;
    },
  ): Promise<AccountingAccount> {
    await this.rbac.requirePermission(actor, "finance.accounting.configure");

    const legalEntityId = await this.resolveLegalEntity(actor, input.legalEntityId);
    const accountClass = this.parseAccountClass(input.accountClass);
    const normalBalance = this.parseNormalBalance(input.normalBalance);

    // Tiered COA (DEC-001): validate the parent belongs to the same legal
    // entity and that the resulting chain stays within the tier depth limit.
    let parentAccountId: string | null = null;
    if (input.parentAccountId) {
      const parent = await this.repo.findAccountById(input.parentAccountId);
      if (!parent || parent.tenantId !== actor.tenantId || parent.legalEntityId !== legalEntityId) {
        throw new ValidationError("Parent account must belong to the same tenant and legal entity");
      }
      if (!parent.isActive) {
        throw new ConflictError("Parent account is deactivated");
      }
      const parentDepth = await this.getAccountDepth(actor.tenantId, legalEntityId, parent.id);
      // parentDepth is 0-based; a child under it would sit at parentDepth+1.
      // COA_MAX_DEPTH counts LEVELS, so the child's 1-based level is
      // (parentDepth + 2) and must not exceed COA_MAX_DEPTH.
      if (parentDepth + 2 > COA_MAX_DEPTH) {
        throw new ValidationError(`Account hierarchy exceeds maximum depth of ${COA_MAX_DEPTH} levels`);
      }
      parentAccountId = parent.id;
    }

    const account = await this.repo.createAccount({
      tenantId: actor.tenantId,
      legalEntityId,
      coaId: input.coaId,
      accountCode: input.accountCode,
      accountName: input.accountName,
      accountClass,
      normalBalance,
      accountType: input.accountType,
      parentAccountId,
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
        parentAccountId,
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

  /**
   * Tiered COA tree (DEC-001) for a legal entity. Read-gated like other
   * finance reads. Cross-entity hierarchy is impossible by construction:
   * the recursive CTE only descends through accounts of the same entity.
   */
  async listAccountHierarchy(
    actor: ActorContext,
    legalEntityId: string,
  ): Promise<Array<{ account: AccountingAccount; depth: number }>> {
    await this.rbac.requirePermission(actor, "finance.accounting.read");
    const resolved = await this.resolveLegalEntity(actor, legalEntityId);
    return this.repo.listAccountHierarchy(actor.tenantId, resolved);
  }

  /** Depth (0-based) of an account via the repository hierarchy walk. */
  private async getAccountDepth(tenantId: string, legalEntityId: string, accountId: string): Promise<number> {
    const hierarchy = await this.repo.listAccountHierarchy(tenantId, legalEntityId);
    const hit = hierarchy.find((n) => n.account.id === accountId);
    if (!hit) {
      // Unreachable for a same-entity active parent; fail closed anyway.
      throw new ConflictError("Parent account is not part of this entity's account hierarchy");
    }
    return hit.depth;
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

    if (period.status === "closed" || period.status === "reopenable") {
      throw new ConflictError("Cannot create journal in a non-open accounting period");
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

  async validateJournal(
    actor: ActorContext,
    journalId: string,
  ): Promise<{ balanced: boolean; debitTotal: Money; creditTotal: Money }> {
    await this.rbac.requirePermission(actor, "finance.accounting.read");

    const journal = await this.repo.findJournalById(journalId);
    if (!journal || journal.tenantId !== actor.tenantId) {
      throw new NotFoundError("JournalHeader", journalId);
    }

    return this.computeJournalBalance(journalId);
  }

  /** Internal, unauthorized balance computation — callers must authorize first. */
  private async computeJournalBalance(
    journalId: string,
  ): Promise<{ balanced: boolean; debitTotal: Money; creditTotal: Money }> {
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
    if (period.status === "closed" || period.status === "reopenable") {
      throw new ConflictError("Cannot post journal to a non-open accounting period");
    }

    // Post in repository (atomic transaction)
    const result = await this.repo.postJournal(journalId, actor.userId);

    if (result === null) {
      throw new NotFoundError("JournalHeader", journalId);
    }

    if ("unbalanced" in result) {
      const { balanced, debitTotal, creditTotal } = await this.computeJournalBalance(journalId);
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

  /**
   * Internal journal posting without authorization — callers must authorize first.
   * Extracted from postJournal for use by the event consumer (a system principal
   * that holds no assignment row, so rbac.requirePermission cannot be satisfied).
   * No RBAC gate; createdBy set to null (system/internal posting).
   *
   * TRUST BOUNDARY: public for in-process internal callers only. Never wire this
   * to an HTTP route — every external caller goes through postJournal(actor, ...).
   */
  async postJournalInternal(tenantId: string, journalId: string): Promise<JournalHeader> {
    const journal = await this.repo.findJournalById(journalId);
    if (!journal || journal.tenantId !== tenantId) {
      throw new NotFoundError("JournalHeader", journalId);
    }

    // Check period not closed
    const period = await this.repo.findPeriodById(journal.periodId);
    if (!period) throw new NotFoundError("AccountingPeriod", journal.periodId);
    if (period.status === "closed" || period.status === "reopenable") {
      throw new ConflictError("Cannot post journal to a non-open accounting period");
    }

    // Post in repository (atomic transaction)
    const result = await this.repo.postJournal(journalId, null);

    if (result === null) {
      throw new NotFoundError("JournalHeader", journalId);
    }

    if ("unbalanced" in result) {
      const { balanced, debitTotal, creditTotal } = await this.computeJournalBalance(journalId);
      throw new ValidationError("Journal is unbalanced", {
        debitTotal,
        creditTotal,
        difference: balanced ? "0.00" : this.subtractMoney(debitTotal, creditTotal),
      });
    }

    // Emit event
    await this.eventBus.publish({
      tenantId,
      eventType: "accounting.journal.posted",
      entityType: "journal_header",
      entityId: journal.id,
      payload: {
        journalNumber: journal.journalNumber,
        periodCode: period.periodCode,
        accountingDate: journal.accountingDate,
      },
      createdBy: null,
    });

    return result.journal;
  }

  async reverseJournal(
    actor: ActorContext,
    journalId: string,
    input: { type: ReversalType; reason: string },
  ): Promise<{ original: JournalHeader; reversal: JournalHeader }> {
    await this.rbac.requirePermission(actor, "finance.accounting.approve");

    // Validate reason is not blank
    const reason = (input.reason ?? "").trim();
    if (!reason) {
      throw new ValidationError("Reversal reason is required and cannot be empty");
    }

    // Load original journal
    const original = await this.repo.findJournalById(journalId);
    if (!original || original.tenantId !== actor.tenantId) {
      throw new NotFoundError("JournalHeader", journalId);
    }

    // Guard: only posted journals can be reversed (also catches already-reversed)
    if (original.status !== "posted") {
      throw new ConflictError("Journal must be posted before it can be reversed");
    }

    // Determine effective date and target period based on reversal type
    let effectiveDate: string;
    let targetPeriodId: string;

    if (input.type === "reverse_correct") {
      // Reverse Correct: use original date & period.
      // Original period must be open; if not, caller must use reverse_accrual.
      effectiveDate = original.accountingDate;
      const period = await this.repo.findPeriodById(original.periodId);
      if (!period) throw new NotFoundError("AccountingPeriod", original.periodId);
      if (period.status !== "open") {
        throw new ConflictError(
          "Original period must be open to use reverse_correct; use reverse_accrual to defer the reversal to the next open period"
        );
      }
      targetPeriodId = original.periodId;
    } else {
      // Reverse Accrual: use running date and find the next open period.
      const today = new Date();
      const y = today.getUTCFullYear();
      const m = String(today.getUTCMonth() + 1).padStart(2, "0");
      const d = String(today.getUTCDate()).padStart(2, "0");
      const todayStr = `${y}-${m}-${d}`;

      const nextPeriod = await this.repo.findNextOpenPeriod(
        actor.tenantId,
        original.legalEntityId,
        todayStr
      );
      if (!nextPeriod) {
        throw new ConflictError(
          "No open accounting period found on or after today; cannot create reversal"
        );
      }
      // If the selected period has not started yet, date the posting at the
      // period's start — never before it.
      effectiveDate = nextPeriod.dateFrom > todayStr ? nextPeriod.dateFrom : todayStr;
      targetPeriodId = nextPeriod.id;
    }

    // Call repo to perform the atomic reversal
    const result = await this.repo.reverseJournal({
      tenantId: actor.tenantId,
      legalEntityId: original.legalEntityId,
      reversalOfId: journalId,
      journalDate: effectiveDate,
      accountingDate: effectiveDate,
      periodId: targetPeriodId,
      journalNumber: `${original.journalNumber}-REV-${Date.now()}`,
      idempotencyKey: `rev-${journalId}-${Date.now()}`,
      reversalReason: reason,
      reversalType: input.type,
      reversedBy: actor.userId,
    });

    if (result === null) {
      throw new ConflictError("Journal reversal could not be completed; the journal may have already been reversed");
    }

    // Emit event
    await this.eventBus.publish({
      tenantId: actor.tenantId,
      eventType: "accounting.journal.reversed",
      entityType: "journal_header",
      entityId: result.reversal.id,
      payload: {
        originalJournalNumber: original.journalNumber,
        reversalJournalNumber: result.reversal.journalNumber,
        reversalType: input.type,
        reason,
      },
      createdBy: actor.userId,
    });

    return result;
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

    // Read materialized balance row
    const balance = await this.repo.findGlBalance(actor.tenantId, accountId, periodId);
    if (!balance) {
      // Fail-closed: entries with no materialized row is an integrity problem —
      // but re-check once first, because a concurrent post commits its GL
      // entries before the balance refresh lands (TOCTOU false positive).
      const entries = await this.repo.listGlEntries(actor.tenantId, { accountId, periodId });
      if (entries.length > 0) {
        const refreshed = await this.repo.findGlBalance(actor.tenantId, accountId, periodId);
        if (!refreshed) {
          throw new ConflictError(
            "Materialized GL balance is missing for existing GL entries; data integrity issue",
          );
        }
        return refreshed;
      }
      // No entries = no activity = null balance
      return null;
    }

    return balance;
  }

  async reconcileJournalVsGl(actor: ActorContext, periodId: string): Promise<{
    periodId: string;
    matched: boolean;
    orphanGlEntryIds: string[];
    mismatchedGlEntryIds: string[];
    unpostedJournalIds: string[];
    totals: { glDebit: string; glCredit: string; journalDebit: string; journalCredit: string };
  }> {
    await this.rbac.requirePermission(actor, "finance.accounting.read");

    const period = await this.repo.findPeriodById(periodId);
    if (!period || period.tenantId !== actor.tenantId) {
      throw new NotFoundError("AccountingPeriod", periodId);
    }

    const reconciliation = await this.repo.reconcileJournalVsGl(actor.tenantId, periodId);

    await this.audit.record({
      tenantId: actor.tenantId,
      actorUserId: actor.userId,
      action: "accounting.gl.reconciled",
      entityType: "accounting_period",
      entityId: periodId,
      metadata: {
        periodCode: period.periodCode,
        matched: reconciliation.matched,
        orphanCount: reconciliation.orphanGlEntryIds.length,
        mismatchCount: reconciliation.mismatchedGlEntryIds.length,
        unpostedCount: reconciliation.unpostedJournalIds.length,
      },
    });

    return reconciliation;
  }

  // --- Posting rules (WP-FIN-05, Epic 14 §4.14 decision #9) -------------------
  //
  // Account mapping is tenant-admin DATA, not code. Rules are configured via
  // these methods and resolved at posting time. The expression evaluator is
  // whitelist-only (token AMOUNT, numeric literals, + - * /) and evaluated by
  // PostgreSQL numeric — money never touches JavaScript binary floats.

  async createPostingRule(
    actor: ActorContext,
    input: {
      ruleCode: string;
      ruleName: string;
      ruleVersion: string;
      triggerEventType: string;
      accountingFormula: Array<{ accountCode: string; side: NormalBalance; amountExpression: string }>;
      requiresApproval: boolean;
      materialityThreshold: string | null;
      effectiveDate: string;
    },
  ): Promise<PostingRule> {
    await this.rbac.requirePermission(actor, "finance.accounting.configure");

    const ruleCode = (input.ruleCode ?? "").trim();
    const ruleName = (input.ruleName ?? "").trim();
    const ruleVersion = (input.ruleVersion ?? "").trim();
    const triggerEventType = (input.triggerEventType ?? "").trim();
    if (!ruleCode || !ruleName || !ruleVersion || !triggerEventType) {
      throw new ValidationError("ruleCode, ruleName, ruleVersion, and triggerEventType are required");
    }

    const effectiveDate = this.parseDate(input.effectiveDate, "effectiveDate");

    if (!Array.isArray(input.accountingFormula) || input.accountingFormula.length < 2) {
      throw new ValidationError("accountingFormula must contain at least two legs");
    }

    const legs: PostingRuleLeg[] = [];
    let hasDebit = false;
    let hasCredit = false;
    for (const raw of input.accountingFormula) {
      const accountCode = (raw.accountCode ?? "").trim();
      const side = this.parseNormalBalance(raw.side);
      const amountExpression = (raw.amountExpression ?? "").trim();
      if (!accountCode) {
        throw new ValidationError("Each formula leg requires an accountCode");
      }
      this.validateAmountExpression(amountExpression);
      legs.push({ accountCode, side, amountExpression });
      if (side === "debit") hasDebit = true;
      else hasCredit = true;
    }
    if (!hasDebit || !hasCredit) {
      throw new ValidationError("accountingFormula must have at least one debit and one credit leg");
    }

    // Balance check: evaluate all expressions with a sample amount to catch
    // obvious imbalances before the rule is saved. The authoritative balance
    // check runs at resolution time with the actual amount.
    const sampleAmount: Money = "100.00";
    let debitSum: Money = "0.00";
    let creditSum: Money = "0.00";
    for (const leg of legs) {
      let evaluated: Money;
      try {
        evaluated = await this.repo.evaluateAmountExpression(leg.amountExpression, sampleAmount);
      } catch {
        throw new ValidationError(`amountExpression "${leg.amountExpression}" could not be evaluated`);
      }
      if (leg.side === "debit") debitSum = this.addMoney(debitSum, evaluated);
      else creditSum = this.addMoney(creditSum, evaluated);
    }
    if (debitSum !== creditSum) {
      throw new ValidationError("accountingFormula is imbalanced", {
        debitTotal: debitSum,
        creditTotal: creditSum,
        sampleAmount,
      });
    }

    const materialityThreshold = input.materialityThreshold
      ? this.parseMoney(input.materialityThreshold)
      : null;

    let rule: PostingRule;
    try {
      rule = await this.repo.createPostingRule({
        tenantId: actor.tenantId,
        ruleCode,
        ruleName,
        ruleVersion,
        triggerEventType,
        accountingFormula: legs,
        requiresApproval: input.requiresApproval,
        materialityThreshold,
        effectiveDate,
        createdBy: actor.userId,
      });
    } catch (error) {
      if ((error as { code?: string }).code === "23505") {
        throw new ConflictError(`Posting rule ${ruleCode} version ${ruleVersion} already exists`);
      }
      throw error;
    }

    await this.audit.record({
      tenantId: actor.tenantId,
      actorUserId: actor.userId,
      action: "accounting.posting_rule.created",
      entityType: "accounting_posting_rule",
      entityId: rule.id,
      metadata: {
        ruleCode,
        ruleVersion,
        triggerEventType,
        legCount: legs.length,
      },
    });

    return rule;
  }

  async listPostingRules(
    actor: ActorContext,
    filter: PostingRuleFilter = {},
  ): Promise<PostingRule[]> {
    await this.rbac.requirePermission(actor, "finance.accounting.read");
    return this.repo.listPostingRules(actor.tenantId, filter);
  }

  async deprecatePostingRule(
    actor: ActorContext,
    ruleId: string,
  ): Promise<PostingRule> {
    await this.rbac.requirePermission(actor, "finance.accounting.configure");

    const rule = await this.repo.findPostingRuleById(ruleId);
    if (!rule || rule.tenantId !== actor.tenantId) {
      throw new NotFoundError("PostingRule", ruleId);
    }
    if (rule.deprecatedDate !== null || !rule.isActive) {
      throw new ConflictError("Posting rule is already deprecated");
    }

    const today = new Date().toISOString().slice(0, 10);
    const deprecated = await this.repo.deprecatePostingRule(
      actor.tenantId,
      ruleId,
      today,
      actor.userId,
    );
    if (!deprecated) {
      throw new NotFoundError("PostingRule", ruleId);
    }

    await this.audit.record({
      tenantId: actor.tenantId,
      actorUserId: actor.userId,
      action: "accounting.posting_rule.deprecated",
      entityType: "accounting_posting_rule",
      entityId: ruleId,
      metadata: {
        ruleCode: rule.ruleCode,
        ruleVersion: rule.ruleVersion,
        deprecatedDate: today,
      },
    });

    return deprecated;
  }

  async resolvePostingRule(
    actor: ActorContext,
    triggerEventType: string,
    accountingDate: string,
    amount: string,
  ): Promise<ResolvePostingRuleResult> {
    await this.rbac.requirePermission(actor, "finance.accounting.read");
    const date = this.parseDate(accountingDate, "accountingDate");
    const amountMoney = this.parseMoney(amount);
    return this.resolvePostingRuleInternal(actor.tenantId, triggerEventType, date, amountMoney);
  }

  async generateJournalFromRule(
    actor: ActorContext,
    input: {
      legalEntityId: string;
      triggerEventType: string;
      journalNumber: string;
      journalDate: string;
      accountingDate: string;
      periodId: string;
      amount: string;
      idempotencyKey: string;
      description: string | null;
      currency: string;
    },
  ): Promise<JournalHeader> {
    await this.rbac.requirePermission(actor, "finance.accounting.manage");

    const legalEntityId = await this.resolveLegalEntity(actor, input.legalEntityId);
    const journalDate = this.parseDate(input.journalDate, "journalDate");
    const accountingDate = this.parseDate(input.accountingDate, "accountingDate");

    const idempotencyKey = (input.idempotencyKey ?? "").trim();
    if (!idempotencyKey) {
      throw new ValidationError("idempotencyKey is required");
    }

    const period = await this.repo.findPeriodById(input.periodId);
    if (!period || period.tenantId !== actor.tenantId) {
      throw new NotFoundError("AccountingPeriod", input.periodId);
    }
    if (period.status === "closed" || period.status === "reopenable") {
      throw new ConflictError("Cannot create journal in a non-open accounting period");
    }

    // Resolve the posting rule + evaluate legs (fail closed if no active rule).
    const { rule, resolvedLegs } = await this.resolvePostingRuleInternal(
      actor.tenantId,
      input.triggerEventType,
      accountingDate,
      this.parseMoney(input.amount),
    );

    // Resolve account codes to account IDs within the legal entity.
    const lines: Array<{
      accountId: string;
      lineNumber: number;
      debit: Money;
      credit: Money;
      lineDescription: string | null;
      projectId: string | null;
      siteId: string | null;
    }> = [];
    let lineNumber = 1;
    for (const leg of resolvedLegs) {
      const account = await this.repo.findAccountByCode(actor.tenantId, legalEntityId, leg.accountCode);
      if (!account) {
        throw new ValidationError(`Account code ${leg.accountCode} not found in this legal entity`);
      }
      if (!account.isActive) {
        throw new ConflictError(`Account ${leg.accountCode} is deactivated`);
      }
      lines.push({
        accountId: account.id,
        lineNumber,
        debit: leg.side === "debit" ? leg.amount : "0.00",
        credit: leg.side === "credit" ? leg.amount : "0.00",
        lineDescription: null,
        projectId: null,
        siteId: null,
      });
      lineNumber++;
    }

    // Call repo.createJournal directly to preserve posting_rule_version_id and
    // the caller-supplied idempotency key (service.createJournal hardcodes both).
    // No auto-post: the journal stays pending; posting uses postJournal with
    // finance.accounting.approve, unchanged.
    let journal: JournalHeader;
    try {
      journal = await this.repo.createJournal({
        tenantId: actor.tenantId,
        legalEntityId,
        journalNumber: input.journalNumber,
        journalDate,
        accountingDate,
        periodId: input.periodId,
        description: input.description,
        currency: input.currency,
        postingRuleVersionId: rule.id,
        idempotencyKey,
        lines,
        createdBy: actor.userId,
      });
    } catch (error) {
      if ((error as { code?: string }).code === "23505") {
        throw new ConflictError("A journal with this idempotency key already exists");
      }
      throw error;
    }

    // Post-condition: enforce the no-auto-post guarantee directly at the
    // return site. Any future change that accidentally posts inside this
    // method fails loudly instead of silently breaking the contract.
    if (journal.status !== "pending") {
      throw new Error(
        `generateJournalFromRule must produce a pending draft; got status "${journal.status}"`,
      );
    }

    await this.audit.record({
      tenantId: actor.tenantId,
      actorUserId: actor.userId,
      action: "accounting.journal.created",
      entityType: "journal_header",
      entityId: journal.id,
      metadata: {
        journalNumber: journal.journalNumber,
        lineCount: lines.length,
        postingRuleId: rule.id,
        triggerEventType: input.triggerEventType,
      },
    });

    return journal;
  }

  /**
   * Internal journal generation without authorization — callers must authorize first.
   * Extracted from generateJournalFromRule for use by the event consumer (a system
   * principal that holds no assignment row, so rbac.requirePermission cannot be
   * satisfied). No RBAC gate; createdBy set to null (system/internal posting).
   *
   * TRUST BOUNDARY: public for in-process internal callers only. Never wire this
   * to an HTTP route — every external caller goes through generateJournalFromRule.
   */
  async generateJournalInternal(
    tenantId: string,
    input: {
      legalEntityId: string;
      triggerEventType: string;
      journalNumber: string;
      journalDate: string;
      accountingDate: string;
      periodId: string;
      amount: string;
      idempotencyKey: string;
      description: string | null;
      currency: string;
    },
  ): Promise<JournalHeader> {
    if (!(await this.repo.legalEntityExists(tenantId, input.legalEntityId))) {
      throw new NotFoundError("LegalEntity", input.legalEntityId);
    }
    const legalEntityId = input.legalEntityId;
    const journalDate = this.parseDate(input.journalDate, "journalDate");
    const accountingDate = this.parseDate(input.accountingDate, "accountingDate");

    const idempotencyKey = (input.idempotencyKey ?? "").trim();
    if (!idempotencyKey) {
      throw new ValidationError("idempotencyKey is required");
    }

    const period = await this.repo.findPeriodById(input.periodId);
    if (!period || period.tenantId !== tenantId) {
      throw new NotFoundError("AccountingPeriod", input.periodId);
    }
    if (period.status === "closed" || period.status === "reopenable") {
      throw new ConflictError("Cannot create journal in a non-open accounting period");
    }

    // Resolve the posting rule + evaluate legs (fail closed if no active rule).
    const { rule, resolvedLegs } = await this.resolvePostingRuleInternal(
      tenantId,
      input.triggerEventType,
      accountingDate,
      this.parseMoney(input.amount),
    );

    // Resolve account codes to account IDs within the legal entity.
    const lines: Array<{
      accountId: string;
      lineNumber: number;
      debit: Money;
      credit: Money;
      lineDescription: string | null;
      projectId: string | null;
      siteId: string | null;
    }> = [];
    let lineNumber = 1;
    for (const leg of resolvedLegs) {
      const account = await this.repo.findAccountByCode(tenantId, legalEntityId, leg.accountCode);
      if (!account) {
        throw new ValidationError(`Account code ${leg.accountCode} not found in this legal entity`);
      }
      if (!account.isActive) {
        throw new ConflictError(`Account ${leg.accountCode} is deactivated`);
      }
      lines.push({
        accountId: account.id,
        lineNumber,
        debit: leg.side === "debit" ? leg.amount : "0.00",
        credit: leg.side === "credit" ? leg.amount : "0.00",
        lineDescription: null,
        projectId: null,
        siteId: null,
      });
      lineNumber++;
    }

    // Call repo.createJournal directly to preserve posting_rule_version_id and
    // the caller-supplied idempotency key.
    let journal: JournalHeader;
    try {
      journal = await this.repo.createJournal({
        tenantId,
        legalEntityId,
        journalNumber: input.journalNumber,
        journalDate,
        accountingDate,
        periodId: input.periodId,
        description: input.description,
        currency: input.currency,
        postingRuleVersionId: rule.id,
        idempotencyKey,
        lines,
        createdBy: null,
      });
    } catch (error) {
      if ((error as { code?: string }).code === "23505") {
        throw new ConflictError(
          "A journal with this idempotency key already exists",
          "idempotency_key_conflict",
        );
      }
      throw error;
    }

    // Post-condition: enforce the no-auto-post guarantee.
    if (journal.status !== "pending") {
      throw new Error(
        `generateJournalInternal must produce a pending draft; got status "${journal.status}"`,
      );
    }

    await this.audit.record({
      tenantId,
      actorUserId: null,
      action: "accounting.journal.created",
      entityType: "journal_header",
      entityId: journal.id,
      metadata: {
        journalNumber: journal.journalNumber,
        lineCount: lines.length,
        postingRuleId: rule.id,
        triggerEventType: input.triggerEventType,
      },
    });

    return journal;
  }

  /**
   * WP-APR-02 — resolve through the central Rule Registry first
   * (rule_key `finance.posting_rule:<triggerEventType>`, payload carries the
   * accounting formula legs). Falls back to the posting-rules table so
   * existing tenants and rules keep working unchanged.
   */
  private async resolveRuleThroughRegistry(
    tenantId: string,
    triggerEventType: string,
    accountingDate: string,
  ): Promise<PostingRule | null> {
    if (!this.ruleRegistry) {
      return this.repo.findActivePostingRule(tenantId, triggerEventType, accountingDate);
    }
    const entry = await this.ruleRegistry.findActive(
      tenantId,
      `finance.posting_rule:${triggerEventType}`,
    );
    if (!entry) {
      return this.repo.findActivePostingRule(tenantId, triggerEventType, accountingDate);
    }
    const legs = entry.payload.legs as PostingRuleLeg[] | undefined;
    if (!Array.isArray(legs) || legs.length === 0) {
      throw new ValidationError(
        `Registry rule ${entry.ruleKey} v${entry.version} payload must carry a non-empty legs array`,
      );
    }
    return {
      id: entry.id,
      tenantId: entry.tenantId,
      ruleCode: entry.ruleKey,
      ruleName: entry.ruleKey,
      ruleVersion: `v${entry.version}`,
      triggerEventType,
      accountingFormula: legs,
      requiresApproval: entry.payload.requiresApproval === true,
      materialityThreshold: (entry.payload.materialityThreshold as Money | null) ?? null,
      isActive: true,
      effectiveDate: entry.validFrom.toISOString().slice(0, 10),
      deprecatedDate: null,
      createdAt: entry.createdAt,
      updatedAt: entry.updatedAt,
    };
  }

  /**
   * Internal rule resolution without authorization — callers must authorize
   * first. Finds the active rule for a trigger event type as of a date,
   * evaluates each leg's expression via PostgreSQL numeric arithmetic, and
   * verifies the resulting journal is balanced.
   */
  private async resolvePostingRuleInternal(
    tenantId: string,
    triggerEventType: string,
    accountingDate: string,
    amountMoney: Money,
  ): Promise<ResolvePostingRuleResult> {
    const rule = await this.resolveRuleThroughRegistry(
      tenantId,
      triggerEventType,
      accountingDate,
    );
    if (!rule) {
      throw new NotFoundError("PostingRule", `active rule for ${triggerEventType} on ${accountingDate}`);
    }

    const resolvedLegs: ResolvePostingRuleResult["resolvedLegs"] = [];
    let debitTotal: Money = "0.00";
    let creditTotal: Money = "0.00";
    for (const leg of rule.accountingFormula) {
      this.validateAmountExpression(leg.amountExpression);
      const evaluated = await this.repo.evaluateAmountExpression(leg.amountExpression, amountMoney);
      resolvedLegs.push({ accountCode: leg.accountCode, side: leg.side, amount: evaluated });
      if (leg.side === "debit") debitTotal = this.addMoney(debitTotal, evaluated);
      else creditTotal = this.addMoney(creditTotal, evaluated);
    }

    if (debitTotal !== creditTotal) {
      throw new ValidationError("Resolved posting rule produces an imbalanced journal", {
        debitTotal,
        creditTotal,
        difference: this.subtractMoney(debitTotal, creditTotal),
      });
    }

    return { rule, resolvedLegs };
  }

  /**
   * Whitelist-only expression validator. Allows the token AMOUNT, numeric
   * literals, operators + - * /, parentheses, and whitespace. Rejects
   * everything else — including eval, process, backtick, and SQL comment
   * syntax (--) — so no JavaScript eval or SQL injection vector exists.
   * The actual arithmetic is performed by PostgreSQL numeric in the repo.
   */
  private validateAmountExpression(expr: string): void {
    const trimmed = (expr ?? "").trim();
    if (!trimmed) {
      throw new ValidationError("amountExpression must not be empty");
    }
    if (trimmed.includes("--") || trimmed.includes("`")) {
      throw new ValidationError("amountExpression must not contain '--' or backtick");
    }
    if (!/^[\da-zA-Z.+\-*/()\s]+$/.test(trimmed)) {
      throw new ValidationError("amountExpression contains forbidden characters");
    }
    const identifiers = trimmed.match(/[a-zA-Z]+/g) ?? [];
    for (const id of identifiers) {
      if (id !== "AMOUNT") {
        throw new ValidationError(`amountExpression contains forbidden identifier: ${id}`);
      }
    }
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
