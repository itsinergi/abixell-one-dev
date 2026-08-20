import type { ActorContext } from "../../../../domain/shared-kernel/audit-context.js";
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from "../../../../domain/shared-kernel/errors.js";
import type { AuditService } from "../../../../application/audit/audit.service.js";
import type { RbacService } from "../../../../application/rbac/rbac.service.js";
import type { EventBus } from "../../../../application/event/event-bus.js";
import type { ConfigurationService } from "../../../../application/configuration/configuration.service.js";
import type { WorkflowService } from "../../../../application/workflow/workflow.service.js";
import type {
  CashflowView,
  FinanceAccount,
  FinanceAccountType,
  FinanceRepository,
  FinanceTransaction,
  Money,
  TransactionDirection,
  TransactionListFilter,
} from "../domain/finance.entity.js";
import {
  FINANCE_ACCOUNT_TYPES,
  isValidMoney,
  TRANSACTION_DIRECTIONS,
} from "../domain/finance.entity.js";

/** Tenant Configuration codes this module expects. */
export const FINANCE_NUMBERING_CODE = "finance_transaction";
export const FINANCE_CATEGORY_REF_TYPE = "finance_transaction_category";
export const FINANCE_WORKFLOW_DEFINITION_CODE = "finance_transaction_approval";

/** Workflow action code → domain event name. The Step graph is Tenant
 * Configuration; this only names the events the chosen action codes publish. */
const ACTION_EVENT_MAP: Record<string, string> = {
  submit: "finance.transaction.submitted",
  approve: "finance.transaction.approved",
  reject: "finance.transaction.rejected",
  cancel: "finance.transaction.cancelled",
};

export interface TransactionDetailView {
  transaction: FinanceTransaction;
  account: FinanceAccount | null;
  status: { stepCode: string | null; stepName: string | null; instanceStatus: string } | null;
  availableActions: { actionCode: string; name: string; toStepCode: string }[];
  /** True once the money has actually moved — the point of no return for
   * every business-critical field (FIN-CORE-008). */
  isApplied: boolean;
}

/**
 * Finance Core (Phase 6, FIN-CORE-001…011).
 *
 * Answers: what money came in or went out, how much, when, through which
 * cash/bank account, for what category, and what evidence supports it.
 *
 * Architectural constraints honoured here:
 * - **Operational cash, not accounting.** No chart of accounts, journal,
 *   general ledger, trial balance, AP/AR, aging, budget, cost centre,
 *   reconciliation, tax, depreciation, consolidation, or statement. The word
 *   "posted" is deliberately avoided: nothing is posted anywhere.
 * - **Money never enters JavaScript arithmetic.** Amounts are strings from
 *   the database to the response; every sum and balance change is computed
 *   by PostgreSQL.
 * - **The ledger is authoritative.** The account balance is a derived cache
 *   that moves only as the atomic consequence of applying a transaction.
 * - **Workflow owns the lifecycle** (FIN-CORE-006); there is no status
 *   column and no second approval engine.
 * - **Approved transactions are immutable** (FIN-CORE-008); a correction is
 *   a compensating transaction, never an edit and never a delete.
 * - **No module-to-module coupling.** Customer is referenced by id through
 *   this module's own port; nothing is imported from Customer, Supply Chain,
 *   Asset, Workforce, or Service Operations.
 */
export class FinanceService {
  constructor(
    private readonly repo: FinanceRepository,
    private readonly workflow: WorkflowService,
    private readonly configuration: ConfigurationService,
    private readonly audit: AuditService,
    private readonly rbac: RbacService,
    private readonly eventBus: EventBus,
  ) {}

  // ===================================================================
  // Cash / bank accounts — FIN-CORE-004
  // ===================================================================

  async createAccount(
    actor: ActorContext,
    input: {
      code: string;
      name: string;
      accountType: string;
      currency: string;
      description?: string | null;
      legalEntityId?: string | null;
      organizationUnitId?: string | null;
    },
  ): Promise<FinanceAccount> {
    await this.rbac.requirePermission(actor.userId, "finance.configure");
    if (await this.repo.findAccountByCode(actor.tenantId, input.code)) {
      throw new ConflictError("Account code already exists: " + input.code);
    }
    const accountType = this.parseAccountType(input.accountType);
    const currency = this.parseCurrency(input.currency);
    const legalEntityId = await this.resolveLegalEntity(actor, input.legalEntityId ?? null);
    const organizationUnitId = await this.resolveOrganizationUnit(actor, input.organizationUnitId ?? null);

    const account = await this.repo.createAccount({
      tenantId: actor.tenantId,
      code: input.code,
      name: input.name,
      accountType,
      currency,
      description: input.description ?? null,
      legalEntityId,
      organizationUnitId,
      createdBy: actor.userId,
    });

    await this.audit.record({
      tenantId: actor.tenantId,
      actorUserId: actor.userId,
      action: "finance.account.created",
      entityType: "finance_account",
      entityId: account.id,
      metadata: { code: account.code, accountType, currency, organizationUnitId },
    });
    return account;
  }

  async listAccounts(actor: ActorContext, filter: { activeOnly?: boolean } = {}): Promise<FinanceAccount[]> {
    await this.rbac.requirePermission(actor.userId, "finance.read");
    const accounts = await this.repo.listAccounts(actor.tenantId, filter);
    return this.filterByOrganizationScope(actor, accounts);
  }

  async getAccount(actor: ActorContext, code: string): Promise<FinanceAccount> {
    await this.rbac.requirePermission(actor.userId, "finance.read");
    const account = await this.repo.findAccountByCode(actor.tenantId, code);
    if (!account) throw new NotFoundError("FinanceAccount", code);
    if (!(await this.isWithinOrganizationScope(actor, account.organizationUnitId))) {
      throw new ForbiddenError("Your assigned Data Scope does not cover this account");
    }
    return account;
  }

  /** Descriptive fields only. The balance is not writable through any API —
   * it moves solely as the consequence of applying a transaction. */
  async updateAccount(
    actor: ActorContext,
    code: string,
    input: { name?: string; description?: string | null; isActive?: boolean },
  ): Promise<FinanceAccount> {
    await this.rbac.requirePermission(actor.userId, "finance.configure");
    const account = await this.getAccount(actor, code);
    const updated = await this.repo.updateAccount(account.id, input, actor.userId);
    await this.audit.record({
      tenantId: actor.tenantId,
      actorUserId: actor.userId,
      action: "finance.account.updated",
      entityType: "finance_account",
      entityId: account.id,
      metadata: { code: account.code, fields: Object.keys(input) },
    });
    return updated!;
  }

  // ===================================================================
  // Transaction categories — FIN-CORE-003
  // ===================================================================

  /** The catalog IS Reference Data — Finance registers the type and reads it
   * through the trusted-caller projection rather than owning a second
   * configurable-list mechanism. Categories are NOT a chart of accounts. */
  async listCategories(actor: ActorContext): Promise<{ code: string; label: string }[]> {
    await this.rbac.requirePermission(actor.userId, "finance.read");
    const items = await this.configuration.listReferenceDataItemsForTrustedCaller(
      actor.tenantId,
      FINANCE_CATEGORY_REF_TYPE,
    );
    return items.filter((i) => i.isActive).map((i) => ({ code: i.code, label: i.label }));
  }

  // ===================================================================
  // Transactions — FIN-CORE-001/002/005/006/009
  // ===================================================================

  async recordTransaction(
    actor: ActorContext,
    input: {
      direction: string;
      amount: string | number;
      transactionDate: string;
      accountCode: string;
      categoryCode: string;
      description?: string | null;
      reference?: string | null;
      legalEntityId?: string | null;
      organizationUnitId?: string | null;
      projectId?: string | null;
      siteId?: string | null;
      customerId?: string | null;
    },
  ): Promise<TransactionDetailView> {
    await this.rbac.requirePermission(actor.userId, "finance.manage");

    const direction = this.parseDirection(input.direction);
    const amount = this.parseMoney(input.amount);
    const transactionDate = this.parseDate(input.transactionDate, "transactionDate");
    const account = await this.getAccount(actor, input.accountCode);
    if (!account.isActive) throw new ConflictError("Account is not active: " + account.code);
    await this.assertCategoryConfigured(actor, input.categoryCode);

    const created = await this.persistTransaction(actor, {
      direction,
      amount,
      transactionDate,
      account,
      categoryCode: input.categoryCode,
      description: input.description ?? null,
      reference: input.reference ?? null,
      legalEntityId: input.legalEntityId ?? null,
      organizationUnitId: input.organizationUnitId ?? null,
      projectId: input.projectId ?? null,
      siteId: input.siteId ?? null,
      customerId: input.customerId ?? null,
      reversesTransactionId: null,
    });

    await this.eventBus.publish({
      tenantId: actor.tenantId,
      eventType: direction === "income" ? "finance.income.recorded" : "finance.expense.recorded",
      entityType: "finance_transaction",
      entityId: created.id,
      payload: {
        transactionNumber: created.transactionNumber,
        amount: created.amount,
        currency: created.currency,
        targetUserId: actor.userId,
      },
      createdBy: actor.userId,
    });

    return this.getTransaction(actor, created.id);
  }

  async listTransactions(
    actor: ActorContext,
    filter: {
      direction?: string;
      accountCode?: string;
      categoryCode?: string;
      customerId?: string;
      projectId?: string;
      organizationUnitId?: string;
      dateFrom?: string;
      dateTo?: string;
      state?: string;
      search?: string;
    } = {},
  ): Promise<FinanceTransaction[]> {
    await this.rbac.requirePermission(actor.userId, "finance.read");
    const repoFilter: TransactionListFilter = {
      direction: filter.direction ? this.parseDirection(filter.direction) : undefined,
      categoryCode: filter.categoryCode,
      customerId: filter.customerId,
      projectId: filter.projectId,
      organizationUnitId: filter.organizationUnitId,
      dateFrom: filter.dateFrom ? this.parseDate(filter.dateFrom, "dateFrom") : undefined,
      dateTo: filter.dateTo ? this.parseDate(filter.dateTo, "dateTo") : undefined,
      appliedOnly: filter.state === "applied",
      pendingOnly: filter.state === "pending",
      search: filter.search,
    };
    if (filter.accountCode) repoFilter.accountId = (await this.getAccount(actor, filter.accountCode)).id;

    const transactions = await this.repo.listTransactions(actor.tenantId, repoFilter);
    return this.filterByOrganizationScope(actor, transactions);
  }

  async getTransaction(actor: ActorContext, id: string): Promise<TransactionDetailView> {
    await this.rbac.requirePermission(actor.userId, "finance.read");
    const transaction = await this.getAuthorizedTransaction(actor, id);
    const account = await this.repo.findAccountById(transaction.accountId);

    let status: TransactionDetailView["status"] = null;
    let availableActions: TransactionDetailView["availableActions"] = [];
    if (transaction.workflowInstanceId) {
      const s = await this.workflow.getEntityStatus(actor, transaction.workflowInstanceId);
      status = { stepCode: s.stepCode, stepName: s.stepName, instanceStatus: s.instanceStatus };
      const view = await this.workflow.getEntityWorkflowView(actor, transaction.workflowInstanceId);
      availableActions = view.availableActions ?? [];
    }
    return { transaction, account, status, availableActions, isApplied: transaction.appliedAt !== null };
  }

  /**
   * Generic lifecycle dispatch (FIN-CORE-006): this service never encodes the
   * Step graph — it forwards the action code and lets the Workflow Engine
   * validate it. When the instance reaches an approved terminal state the
   * money is moved, atomically, in the same call.
   */
  async actOnTransaction(
    actor: ActorContext,
    id: string,
    actionCode: string,
    comment: string | null,
  ): Promise<TransactionDetailView> {
    await this.rbac.requirePermission(actor.userId, "finance.approve");
    const transaction = await this.getAuthorizedTransaction(actor, id);
    if (!transaction.workflowInstanceId) throw new ConflictError("This transaction has no active Workflow Instance");
    if (transaction.appliedAt) throw new ConflictError("This transaction has already taken effect");

    const { assignments } = await this.workflow.getInstanceForEntityOwner(
      actor.tenantId,
      transaction.workflowInstanceId,
    );
    const pending = assignments.find((a) => a.status === "pending");
    if (!pending) throw new ConflictError("No pending action currently exists on this transaction");

    await this.workflow.actOnAssignment(actor, pending.id, actionCode, comment);

    const eventType = ACTION_EVENT_MAP[actionCode] ?? "finance.transaction.status_changed";
    await this.audit.record({
      tenantId: actor.tenantId,
      actorUserId: actor.userId,
      action: eventType,
      entityType: "finance_transaction",
      entityId: transaction.id,
      // The evidence itself is never copied into the audit metadata.
      metadata: { transactionNumber: transaction.transactionNumber, actionCode, comment },
    });

    const status = await this.workflow.getEntityStatus(actor, transaction.workflowInstanceId);
    if (status.instanceStatus === "approved") {
      await this.applyApprovedTransaction(actor, transaction);
    } else {
      await this.eventBus.publish({
        tenantId: actor.tenantId,
        eventType,
        entityType: "finance_transaction",
        entityId: transaction.id,
        payload: {
          transactionNumber: transaction.transactionNumber,
          actionCode,
          targetUserId: transaction.recordedByUserId,
        },
        createdBy: actor.userId,
      });
    }
    return this.getTransaction(actor, transaction.id);
  }

  /**
   * Correct an applied transaction with a compensating entry (FIN-CORE-008).
   *
   * The original is never edited and never deleted: a NEW transaction of the
   * opposite direction, same amount, account, and currency is recorded and
   * goes through the same approval lifecycle. The money only moves back when
   * that reversal is itself approved.
   */
  async reverseTransaction(
    actor: ActorContext,
    id: string,
    input: { reason?: string | null; transactionDate?: string | null },
  ): Promise<TransactionDetailView> {
    await this.rbac.requirePermission(actor.userId, "finance.manage");
    const original = await this.getAuthorizedTransaction(actor, id);
    if (!original.appliedAt) {
      throw new ConflictError("Only a transaction that has taken effect can be corrected by reversal");
    }
    if (original.reversedByTransactionId) {
      throw new ConflictError("This transaction has already been reversed");
    }
    const account = await this.repo.findAccountById(original.accountId);
    if (!account) throw new NotFoundError("FinanceAccount", original.accountId);

    const reversal = await this.persistTransaction(actor, {
      direction: original.direction === "income" ? "expense" : "income",
      amount: original.amount,
      transactionDate: input.transactionDate
        ? this.parseDate(input.transactionDate, "transactionDate")
        : this.today(),
      account,
      categoryCode: original.categoryCode,
      description: input.reason ?? "Correction of " + original.transactionNumber,
      reference: original.transactionNumber,
      legalEntityId: original.legalEntityId,
      organizationUnitId: original.organizationUnitId,
      projectId: original.projectId,
      siteId: original.siteId,
      customerId: original.customerId,
      reversesTransactionId: original.id,
    });

    const linked = await this.repo.markTransactionReversed(original.id, reversal.id, actor.userId);
    if (!linked) throw new ConflictError("This transaction has already been reversed");

    await this.audit.record({
      tenantId: actor.tenantId,
      actorUserId: actor.userId,
      action: "finance.transaction.reversed",
      entityType: "finance_transaction",
      entityId: original.id,
      metadata: {
        transactionNumber: original.transactionNumber,
        reversalNumber: reversal.transactionNumber,
        reason: input.reason ?? null,
      },
    });
    return this.getTransaction(actor, reversal.id);
  }

  // ===================================================================
  // Cashflow — FIN-CORE-007
  // ===================================================================

  /**
   * Operational cashflow: in, out, net over a period, with the opening and
   * closing position reconstructed from the ledger.
   *
   * NOT an accounting-standard Cash Flow Statement — there is no
   * operating/investing/financing classification and no general ledger
   * behind it. Only transactions that actually took effect are counted.
   */
  async cashflow(
    actor: ActorContext,
    filter: { from: string; to: string; accountCode?: string },
  ): Promise<CashflowView & { accounts: FinanceAccount[] }> {
    await this.rbac.requirePermission(actor.userId, "finance.read");
    const from = this.parseDate(filter.from, "from");
    const to = this.parseDate(filter.to, "to");
    if (from > to) throw new ValidationError("from must not be after to");

    let accountId: string | undefined;
    if (filter.accountCode) accountId = (await this.getAccount(actor, filter.accountCode)).id;

    // A scoped user must not see tenant-wide totals; the same hierarchical
    // rule that filters the list filters the aggregate (FIN-CORE-010).
    let organizationUnitIds: string[] | undefined;
    if (!(await this.rbac.hasTenantScope(actor.userId))) {
      organizationUnitIds = await this.coveredOrganizationUnitIds(actor);
    }

    const view = await this.repo.cashflow(actor.tenantId, { from, to, accountId, organizationUnitIds });
    const accounts = await this.listAccounts(actor, { activeOnly: true });
    return { ...view, accounts: accountId ? accounts.filter((a) => a.id === accountId) : accounts };
  }

  // ===================================================================
  // Document Core authorization hook (FIN-CORE-005, ADR-0012)
  // ===================================================================

  /**
   * Finance evidence inherits the transaction's own authorisation: same
   * tenant, the transaction's Data Scope, AND a dedicated capability —
   * receipts and invoices are more sensitive than the transaction row.
   */
  async canAccessForDocument(actor: ActorContext, transactionId: string): Promise<boolean> {
    const transaction = await this.repo.findTransactionById(transactionId);
    if (!transaction || transaction.tenantId !== actor.tenantId) return false;
    const permissions = await this.rbac.getEffectivePermissions(actor.userId);
    if (!permissions.has("finance.documents.read")) return false;
    return this.isWithinOrganizationScope(actor, transaction.organizationUnitId);
  }

  // ===================================================================
  // Internals
  // ===================================================================

  /** The single creation path: validate context, mint a number, persist, and
   * hand the lifecycle to the Workflow Engine. */
  private async persistTransaction(
    actor: ActorContext,
    input: {
      direction: TransactionDirection;
      amount: Money;
      transactionDate: string;
      account: FinanceAccount;
      categoryCode: string;
      description: string | null;
      reference: string | null;
      legalEntityId: string | null;
      organizationUnitId: string | null;
      projectId: string | null;
      siteId: string | null;
      customerId: string | null;
      reversesTransactionId: string | null;
    },
  ): Promise<FinanceTransaction> {
    const legalEntityId = await this.resolveLegalEntity(
      actor,
      input.legalEntityId ?? input.account.legalEntityId,
    );
    const organizationUnitId = await this.resolveOrganizationUnit(
      actor,
      input.organizationUnitId ?? input.account.organizationUnitId,
    );
    const projectId = await this.resolveProject(actor, input.projectId);
    const siteId = await this.resolveSite(actor, input.siteId);
    const customerId = await this.resolveCustomer(actor, input.customerId);

    const { number } = await this.configuration.generateNumberForTenant(
      actor.tenantId,
      FINANCE_NUMBERING_CODE,
      actor.userId,
    );

    const transaction = await this.repo.createTransaction({
      tenantId: actor.tenantId,
      transactionNumber: number,
      direction: input.direction,
      amount: input.amount,
      // The account decides the currency — Core has no FX conversion.
      currency: input.account.currency,
      transactionDate: input.transactionDate,
      accountId: input.account.id,
      categoryCode: input.categoryCode,
      description: input.description,
      reference: input.reference,
      legalEntityId,
      organizationUnitId,
      projectId,
      siteId,
      customerId,
      recordedByUserId: actor.userId,
      reversesTransactionId: input.reversesTransactionId,
      createdBy: actor.userId,
    });

    // Lifecycle belongs to the configured Workflow Definition (FIN-CORE-006).
    const { instance } = await this.workflow.startInstance(actor, {
      definitionCode: FINANCE_WORKFLOW_DEFINITION_CODE,
      entityId: transaction.id,
      contextData: {
        direction: input.direction,
        amount: input.amount,
        currency: input.account.currency,
        accountId: input.account.id,
        organizationUnitId,
      },
    });
    await this.repo.setTransactionWorkflowInstance(transaction.id, instance.id);

    await this.audit.record({
      tenantId: actor.tenantId,
      actorUserId: actor.userId,
      action: "finance.transaction.created",
      entityType: "finance_transaction",
      entityId: transaction.id,
      metadata: {
        transactionNumber: number,
        direction: input.direction,
        amount: input.amount,
        currency: input.account.currency,
        accountCode: input.account.code,
        categoryCode: input.categoryCode,
        reversesTransactionId: input.reversesTransactionId,
      },
    });
    return (await this.repo.findTransactionById(transaction.id))!;
  }

  /** Moves the money. Every failure mode leaves the ledger and the balance
   * exactly as they were. */
  private async applyApprovedTransaction(actor: ActorContext, transaction: FinanceTransaction): Promise<void> {
    const applied = await this.repo.applyTransaction(transaction.id, actor.userId);
    if (applied === null) {
      throw new ConflictError("This transaction has already taken effect");
    }
    if ("insufficient" in applied) {
      const account = await this.repo.findAccountById(transaction.accountId);
      throw new ConflictError(
        "Insufficient balance on account " +
          (account?.code ?? transaction.accountId) +
          ": available " +
          (account?.balance ?? "0") +
          ", requested " +
          transaction.amount,
      );
    }

    await this.audit.record({
      tenantId: actor.tenantId,
      actorUserId: actor.userId,
      action: "finance.transaction.applied",
      entityType: "finance_transaction",
      entityId: transaction.id,
      metadata: {
        transactionNumber: transaction.transactionNumber,
        direction: transaction.direction,
        amount: transaction.amount,
        accountBalance: applied.account.balance,
      },
    });
    await this.eventBus.publish({
      tenantId: actor.tenantId,
      eventType: "finance.transaction.approved",
      entityType: "finance_transaction",
      entityId: transaction.id,
      payload: {
        transactionNumber: transaction.transactionNumber,
        direction: transaction.direction,
        amount: transaction.amount,
        currency: transaction.currency,
        targetUserId: transaction.recordedByUserId,
      },
      createdBy: actor.userId,
    });
  }

  private parseAccountType(value: string): FinanceAccountType {
    if (!FINANCE_ACCOUNT_TYPES.includes(value as FinanceAccountType)) {
      throw new ValidationError("accountType must be one of: " + FINANCE_ACCOUNT_TYPES.join(", "));
    }
    return value as FinanceAccountType;
  }

  private parseDirection(value: string): TransactionDirection {
    if (!TRANSACTION_DIRECTIONS.includes(value as TransactionDirection)) {
      throw new ValidationError("direction must be one of: " + TRANSACTION_DIRECTIONS.join(", "));
    }
    return value as TransactionDirection;
  }

  private parseCurrency(value: string): string {
    const trimmed = (value ?? "").trim().toUpperCase();
    if (!/^[A-Z]{3}$/.test(trimmed)) {
      throw new ValidationError("currency must be a three-letter code (for example IDR, USD, SGD)");
    }
    return trimmed;
  }

  /**
   * Money crosses this boundary as text and stays text. A JSON number is
   * accepted for convenience but is re-serialised through its own string
   * form and validated against the two-decimal pattern, so a value that
   * cannot be represented exactly is rejected rather than silently rounded.
   */
  private parseMoney(value: string | number): Money {
    const raw = typeof value === "number" ? String(value) : (value ?? "").trim();
    if (!isValidMoney(raw)) {
      throw new ValidationError(
        "amount must be a positive number with at most two decimal places, sent as a string (for example \"1250.75\")",
      );
    }
    // Normalise to exactly two decimals without arithmetic: pad or trim text.
    const [whole, fraction = ""] = raw.split(".");
    return whole + "." + (fraction + "00").slice(0, 2);
  }

  private parseDate(value: string, field: string): string {
    const trimmed = (value ?? "").trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
      throw new ValidationError(field + " must be a calendar date in YYYY-MM-DD form");
    }
    if (Number.isNaN(new Date(trimmed + "T00:00:00Z").getTime())) {
      throw new ValidationError(field + " is not a valid date");
    }
    return trimmed;
  }

  private today(): string {
    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, "0");
    const d = String(now.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }

  private async assertCategoryConfigured(actor: ActorContext, code: string): Promise<void> {
    const items = await this.configuration.listReferenceDataItemsForTrustedCaller(
      actor.tenantId,
      FINANCE_CATEGORY_REF_TYPE,
    );
    const match = items.find((i) => i.code === code);
    if (!match) throw new NotFoundError("FinanceTransactionCategory", code);
    if (!match.isActive) throw new ConflictError("Transaction category is not active: " + code);
  }

  private async resolveLegalEntity(actor: ActorContext, legalEntityId: string | null): Promise<string | null> {
    if (!legalEntityId) return null;
    if (!(await this.repo.legalEntityExists(actor.tenantId, legalEntityId))) {
      throw new NotFoundError("LegalEntity", legalEntityId);
    }
    return legalEntityId;
  }

  private async resolveOrganizationUnit(actor: ActorContext, unitId: string | null): Promise<string | null> {
    if (!unitId) return null;
    if (!(await this.repo.organizationUnitExists(actor.tenantId, unitId))) {
      throw new NotFoundError("OrganizationUnit", unitId);
    }
    // Booking into a unit the actor cannot see would put the money beyond
    // their own visibility and outside their authority.
    await this.rbac.requireOrganizationUnitScope(actor.userId, unitId);
    return unitId;
  }

  private async resolveProject(actor: ActorContext, projectId: string | null): Promise<string | null> {
    if (!projectId) return null;
    if (!(await this.repo.projectExists(actor.tenantId, projectId))) throw new NotFoundError("Project", projectId);
    return projectId;
  }

  private async resolveSite(actor: ActorContext, siteId: string | null): Promise<string | null> {
    if (!siteId) return null;
    if (!(await this.repo.siteExists(actor.tenantId, siteId))) throw new NotFoundError("Site", siteId);
    return siteId;
  }

  /** Optional revenue context. Cross-tenant customers are simply not found,
   * and Finance never reads any customer detail beyond existence. */
  private async resolveCustomer(actor: ActorContext, customerId: string | null): Promise<string | null> {
    if (!customerId) return null;
    if (!(await this.repo.customerExists(actor.tenantId, customerId))) {
      throw new NotFoundError("Customer", customerId);
    }
    return customerId;
  }

  private async getAuthorizedTransaction(actor: ActorContext, id: string): Promise<FinanceTransaction> {
    const transaction = await this.repo.findTransactionById(id);
    if (!transaction || transaction.tenantId !== actor.tenantId) throw new NotFoundError("FinanceTransaction", id);
    if (!(await this.isWithinOrganizationScope(actor, transaction.organizationUnitId))) {
      throw new ForbiddenError("Your assigned Data Scope does not cover this transaction");
    }
    return transaction;
  }

  /** A record with no Organization Unit is tenant-level; one placed in a unit
   * is visible only within that unit's hierarchical scope (FIN-CORE-010). */
  private async isWithinOrganizationScope(actor: ActorContext, unitId: string | null): Promise<boolean> {
    if (!unitId) return true;
    return this.rbac.isOrganizationUnitScopeCovered(actor.userId, unitId);
  }

  private async filterByOrganizationScope<T extends { organizationUnitId: string | null }>(
    actor: ActorContext,
    rows: T[],
  ): Promise<T[]> {
    if (await this.rbac.hasTenantScope(actor.userId)) return rows;
    const decisions = new Map<string, boolean>();
    const allowed: T[] = [];
    for (const row of rows) {
      if (!row.organizationUnitId) {
        allowed.push(row);
        continue;
      }
      let ok = decisions.get(row.organizationUnitId);
      if (ok === undefined) {
        ok = await this.rbac.isOrganizationUnitScopeCovered(actor.userId, row.organizationUnitId);
        decisions.set(row.organizationUnitId, ok);
      }
      if (ok) allowed.push(row);
    }
    return allowed;
  }

  /** The organisation units this actor's Data Scope covers, derived from the
   * units Finance actually uses — so the aggregate obeys the same rule as
   * the list without a Finance-specific scope engine. */
  private async coveredOrganizationUnitIds(actor: ActorContext): Promise<string[]> {
    const transactions = await this.repo.listTransactions(actor.tenantId, {});
    const units = [
      ...new Set(transactions.map((t) => t.organizationUnitId).filter((id): id is string => !!id)),
    ];
    const covered: string[] = [];
    for (const unitId of units) {
      if (await this.rbac.isOrganizationUnitScopeCovered(actor.userId, unitId)) covered.push(unitId);
    }
    return covered;
  }
}
