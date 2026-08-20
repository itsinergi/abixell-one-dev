/**
 * Finance Core — domain types (Phase 6).
 *
 * Built under the frozen target repository architecture
 * (`modules/<module>/core/{domain,application,infrastructure,api}`).
 *
 * Scope discipline: Core is *operational cash reality*. It answers **what
 * money came in or went out, how much, when, through which cash/bank
 * account, for what category, and what evidence supports it**. It contains
 * no chart of accounts, double-entry, journal, general ledger, trial
 * balance, AP/AR, aging, budgeting, cost centre, bank reconciliation, tax,
 * fixed-asset accounting, depreciation, consolidation, P&L, balance sheet,
 * statutory cash-flow statement, financial close, fiscal period lock, or
 * multi-ledger concept — all of those are Advanced Finance capabilities.
 */

/**
 * MONEY IS A STRING, EVERYWHERE, DELIBERATELY.
 *
 * node-postgres returns `numeric` as a string, and this module keeps it one
 * from the database to the HTTP response. No money value is ever converted
 * to a JavaScript `number`, and no money arithmetic happens in JavaScript:
 * every sum and every balance change is computed by PostgreSQL inside the
 * mutating statement. That is what makes `100.10 + 200.20 - 50.05` come
 * back as exactly `250.25` instead of a binary-floating-point approximation
 * of it.
 *
 * Contrast with Supply Chain, where quantities are numbers: quantities
 * tolerate a rounding artefact, money does not.
 */
export type Money = string;

/** Two decimal places, optional sign handled by `direction`. */
export const MONEY_PATTERN = /^\d{1,16}(\.\d{1,2})?$/;

/**
 * Shape and positivity, both decided on the TEXT.
 *
 * "Greater than zero" is `contains a non-zero digit` rather than
 * `parseFloat(value) > 0` on purpose: a float conversion here would be the
 * one place in the module where a money value touches binary floating point,
 * and it would lose digits on the largest amounts the pattern allows.
 */
export function isValidMoney(value: string): boolean {
  return MONEY_PATTERN.test(value) && /[1-9]/.test(value);
}

/** Operational money containers. NOT chart-of-accounts / GL accounts. */
export type FinanceAccountType = "cash" | "bank" | "petty_cash";

export const FINANCE_ACCOUNT_TYPES: FinanceAccountType[] = ["cash", "bank", "petty_cash"];

export type TransactionDirection = "income" | "expense";

export const TRANSACTION_DIRECTIONS: TransactionDirection[] = ["income", "expense"];

export interface FinanceAccount {
  id: string;
  tenantId: string;
  code: string;
  name: string;
  accountType: FinanceAccountType;
  currency: string;
  description: string | null;
  legalEntityId: string | null;
  /** Data Scope anchor for the account and everything booked against it. */
  organizationUnitId: string | null;
  /** Derived from the applied ledger; never directly editable. */
  balance: Money;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface FinanceTransaction {
  id: string;
  tenantId: string;
  transactionNumber: string;
  direction: TransactionDirection;
  /** Always positive; `direction` carries the sign. */
  amount: Money;
  currency: string;
  /** Plain `YYYY-MM-DD`. Never produced via `toISOString()`. */
  transactionDate: string;
  accountId: string;
  categoryCode: string;
  description: string | null;
  /** Free-text external reference. NOT an invoice or purchase-order link. */
  reference: string | null;
  legalEntityId: string | null;
  organizationUnitId: string | null;
  projectId: string | null;
  siteId: string | null;
  /** Optional revenue context. There is no receivable behind it. */
  customerId: string | null;
  /** The ONE link to the generic Workflow Engine (FIN-CORE-006). */
  workflowInstanceId: string | null;
  recordedByUserId: string;
  /** Set exactly once, when the money actually moves. */
  appliedAt: Date | null;
  appliedByUserId: string | null;
  reversesTransactionId: string | null;
  reversedByTransactionId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CashflowTotals {
  income: Money;
  expense: Money;
  net: Money;
}

export interface CashflowCategoryLine {
  categoryCode: string;
  direction: TransactionDirection;
  amount: Money;
}

/**
 * Operational cashflow (FIN-CORE-007) — in, out, net over a period, with an
 * opening and closing position reconstructed from the ledger.
 *
 * This is NOT an accounting-standard Cash Flow Statement: there is no
 * operating / investing / financing classification, and nothing here is
 * derived from a general ledger, because there is no general ledger.
 */
export interface CashflowView {
  from: string;
  to: string;
  opening: Money;
  totals: CashflowTotals;
  closing: Money;
  byCategory: CashflowCategoryLine[];
}

// ---------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------

export interface CreateAccountInput {
  tenantId: string;
  code: string;
  name: string;
  accountType: FinanceAccountType;
  currency: string;
  description: string | null;
  legalEntityId: string | null;
  organizationUnitId: string | null;
  createdBy: string | null;
}

export interface UpdateAccountInput {
  name?: string;
  description?: string | null;
  isActive?: boolean;
}

export interface CreateTransactionInput {
  tenantId: string;
  transactionNumber: string;
  direction: TransactionDirection;
  amount: Money;
  currency: string;
  transactionDate: string;
  accountId: string;
  categoryCode: string;
  description: string | null;
  reference: string | null;
  legalEntityId: string | null;
  organizationUnitId: string | null;
  projectId: string | null;
  siteId: string | null;
  customerId: string | null;
  recordedByUserId: string;
  reversesTransactionId: string | null;
  createdBy: string | null;
}

export interface TransactionListFilter {
  direction?: TransactionDirection;
  accountId?: string;
  categoryCode?: string;
  customerId?: string;
  projectId?: string;
  organizationUnitId?: string;
  dateFrom?: string;
  dateTo?: string;
  appliedOnly?: boolean;
  pendingOnly?: boolean;
  search?: string;
}

// ---------------------------------------------------------------------------
// Repository port
// ---------------------------------------------------------------------------

export interface FinanceRepository {
  // --- Cash / bank account master (FIN-CORE-004) ----------------------
  createAccount(input: CreateAccountInput): Promise<FinanceAccount>;
  findAccountById(id: string): Promise<FinanceAccount | null>;
  findAccountByCode(tenantId: string, code: string): Promise<FinanceAccount | null>;
  listAccounts(tenantId: string, filter: { activeOnly?: boolean }): Promise<FinanceAccount[]>;
  /** Descriptive fields only. The balance is NEVER writable here — it moves
   * only as the arithmetic consequence of applying a transaction. */
  updateAccount(id: string, input: UpdateAccountInput, updatedBy: string | null): Promise<FinanceAccount | null>;

  // --- Transactions (FIN-CORE-001/002/008/009) ------------------------
  createTransaction(input: CreateTransactionInput): Promise<FinanceTransaction>;
  findTransactionById(id: string): Promise<FinanceTransaction | null>;
  listTransactions(tenantId: string, filter: TransactionListFilter): Promise<FinanceTransaction[]>;
  setTransactionWorkflowInstance(id: string, workflowInstanceId: string): Promise<void>;

  /**
   * Applies an approved transaction: sets `applied_at` AND moves the account
   * balance, inside ONE database transaction, with the account row locked.
   *
   * The balance arithmetic happens in SQL — never in JavaScript — and the
   * guarded statement refuses to take an account below zero, so concurrent
   * expenses cannot jointly overdraw it.
   *
   * Returns `null` when the transaction was already applied. Returns
   * `{ insufficient: true }` when the balance effect was refused; in both
   * cases NOTHING is written.
   */
  applyTransaction(
    transactionId: string,
    appliedBy: string | null,
  ): Promise<{ transaction: FinanceTransaction; account: FinanceAccount } | { insufficient: true } | null>;

  /** Guarded: a transaction can be reversed at most once. */
  markTransactionReversed(
    id: string,
    reversalTransactionId: string,
    updatedBy: string | null,
  ): Promise<FinanceTransaction | null>;

  // --- Cashflow (FIN-CORE-007) ----------------------------------------
  /** Every figure is summed by PostgreSQL and returned as a string. */
  cashflow(
    tenantId: string,
    filter: { from: string; to: string; accountId?: string; organizationUnitIds?: string[] },
  ): Promise<CashflowView>;

  /** Sum of applied movements on an account — the ledger truth the cached
   * balance must always equal. Used by the closure invariant check. */
  ledgerBalanceForAccount(accountId: string): Promise<Money>;

  // --- Cross-domain reads kept behind this port -----------------------
  legalEntityExists(tenantId: string, legalEntityId: string): Promise<boolean>;
  organizationUnitExists(tenantId: string, organizationUnitId: string): Promise<boolean>;
  projectExists(tenantId: string, projectId: string): Promise<boolean>;
  siteExists(tenantId: string, siteId: string): Promise<boolean>;
  /** Optional revenue context only — Finance never reads customer detail. */
  customerExists(tenantId: string, customerId: string): Promise<boolean>;
}
