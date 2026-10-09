/**
 * Accounting Kernel — domain types (Phase 1A, WP-FIN-01.1).
 *
 * Built under the frozen target repository architecture
 * (`modules/<module>/core/{domain,application,infrastructure,api}`) and the
 * Addendum module layout used here: `modules/accounting/kernel/{domain,
 * application,infrastructure,api}`.
 *
 * Scope discipline (ADR-0023 ACCEPTED): the Kernel is the **single writer of
 * the General Ledger**. It maintains chart of accounts, fiscal periods,
 * double-entry journals, GL entries, and the idempotency contract that makes
 * posting a business event at-most-once. It does NOT contain cost-centre
 * accounting, budgets, AP/AR, fixed assets, tax, bank reconciliation,
 * multi-ledger, FX revaluation, or financial-statement presentation — those
 * are Advanced Finance capabilities (Wave A6+).
 *
 * Two invariants are structural, not conventional:
 *
 * 1. **MONEY IS A STRING, EVERYWHERE.** `numeric(18,2)` is returned by
 *    node-postgres as a string, and this module keeps it a string from the
 *    database to the HTTP response. No money value is ever converted to a
 *    JavaScript `number`, and no money arithmetic happens in JavaScript:
 *    every total, balance and equality check is computed by PostgreSQL or by
 *    exact string comparison in this module. Binary floating point can never
 *    corrupt a stored total.
 *
 * 2. **DEBIT = CREDIT, PROVEN WITHOUT FLOATING POINT.** A journal is balanced
 *    when the sum of debit lines equals the sum of credit lines exactly. The
 *    check below adds the two-decimal integer parts (scaled to cents) rather
 *    than parsing to a float, so `100.10` and `100.1` are the same amount and
 *    no rounding artefact can make an unbalanced journal look balanced.
 */

/**
 * A money amount carried as a decimal string. Two decimal places, always
 * non-negative here (`normal_balance` / `debit` / `credit` carry the sign,
 * not the value).
 */
export type Money = string;

/** Two decimal places, non-negative, up to 18 significant digits. */
export const MONEY_PATTERN = /^\d{1,16}(\.\d{1,2})?$/;

/** Shape check on the TEXT. Zero is allowed here; callers decide if it may be. */
export function isValidMoney(value: string): boolean {
  return MONEY_PATTERN.test(value);
}

/**
 * Exact integer cents from a two-decimal money string. Returns `null` when
 * the string is not a well-formed money value, so callers can reject rather
 * than silently coerce. Uses string arithmetic — never `parseFloat` — so a
 * value beyond `Number.MAX_SAFE_INTEGER` in cents is still compared exactly
 * up to 16 integer digits.
 */
export function toCents(value: Money): bigint | null {
  if (!MONEY_PATTERN.test(value)) return null;
  const [whole, frac = ""] = value.split(".");
  const cents = (frac + "00").slice(0, 2);
  return BigInt(whole) * 100n + BigInt(cents);
}

/**
 * The double-entry invariant, decided with exact integer cents.
 *
 * A journal is balanced when total debit equals total credit. An empty set of
 * lines is NOT balanced (a journal must move money somewhere), and any line
 * that is not a well-formed money value makes the whole check fail closed.
 */
export function isBalanced(lines: readonly { debit: Money; credit: Money }[]): boolean {
  if (lines.length === 0) return false;
  let debitCents = 0n;
  let creditCents = 0n;
  for (const line of lines) {
    const d = toCents(line.debit);
    const c = toCents(line.credit);
    if (d === null || c === null) return false;
    debitCents += d;
    creditCents += c;
  }
  return debitCents === creditCents;
}

// ---------------------------------------------------------------------------
// Enumerations
// ---------------------------------------------------------------------------

/** Five fundamental account classes (element classification). */
export type AccountClass = "ASSET" | "LIABILITY" | "EQUITY" | "INCOME" | "EXPENSE";

export const ACCOUNT_CLASSES: AccountClass[] = ["ASSET", "LIABILITY", "EQUITY", "INCOME", "EXPENSE"];

/** Which side increases the account. */
export type NormalBalance = "debit" | "credit";

export const NORMAL_BALANCES: NormalBalance[] = ["debit", "credit"];

export type AccountingPeriodType = "monthly" | "quarterly" | "annual";

/**
 * Fiscal period lifecycle. `open` accepts postings; `closed` refuses them;
 * `reopenable` is a closed period eligible for a controlled reopen; `draft`
 * has never been opened; `tombstone` is retired but retained for history.
 */
export type AccountingPeriodStatus = "draft" | "open" | "closed" | "reopenable" | "tombstone";

export const ACCOUNTING_PERIOD_STATUSES: AccountingPeriodStatus[] = [
  "draft",
  "open",
  "closed",
  "reopenable",
  "tombstone",
];

/** Journal lifecycle. `posted` journals have GL entries; nothing is edited. */
export type JournalStatus = "pending" | "posted" | "failed" | "reversed";

/**
 * Reversal mode (Epic 14 §4.14, WP-FIN-02).
 *
 * - `reverse_correct`: the correction lands on the original transaction date
 *   in the original period. If that period is closed, the caller must use
 *   `reverse_accrual` instead (dec #13: fail closed, no silent redirect).
 * - `reverse_accrual`: the correction lands on the running date in the next
 *   open period, deferring the correction into an open/future period.
 */
export type ReversalType = "reverse_correct" | "reverse_accrual";

export const REVERSAL_TYPES: ReversalType[] = ["reverse_correct", "reverse_accrual"];

/**
 * Maximum number of levels in the tiered Chart of Accounts (DEC-001). A
 * top-level account sits at depth 0, so `COA_MAX_DEPTH = 8` permits depths
 * 0..7 (eight levels). The COA hierarchy trigger walks ancestors up to 32
 * levels to detect cycles; 8 keeps reporting trees readable and well inside
 * that guard.
 */
export const COA_MAX_DEPTH = 8;

/** Result of a posting attempt, recorded on the idempotency key. */
export type PostingAttemptStatus = "success" | "failure" | "pending";

// ---------------------------------------------------------------------------
// Entities
// ---------------------------------------------------------------------------

export interface AccountingPeriod {
  id: string;
  tenantId: string;
  legalEntityId: string;
  fiscalYearCode: string;
  periodCode: string;
  periodName: string;
  periodType: AccountingPeriodType;
  /** Plain `YYYY-MM-DD`. Never produced via `toISOString()`. */
  dateFrom: string;
  dateTo: string;
  status: AccountingPeriodStatus;
  lockedDate: Date | null;
  lockedBy: string | null;
  // --- Reopen maker-checker trail (WP-FIN-03, Epic 14 §4.14) -------------
  /** When reopen was requested; `null` unless a reopen has been requested. */
  reopenRequestedDate: Date | null;
  /** The operator who requested the reopen (the maker). */
  reopenRequestedBy: string | null;
  /** Free-text reason for the reopen (required, non-empty at request time). */
  reopenReason: string | null;
  /** Evidence of the impact that justifies reopening (required at request time). */
  reopenImpactEvidence: string | null;
  /** The operator who approved the reopen (the checker); set on approve. */
  reopenApprovedBy: string | null;
  /** When the reopen was approved; set on approve. */
  reopenApprovedDate: Date | null;
  /** The operator who rejected the reopen; set on reject. */
  reopenRejectedBy: string | null;
  /** When the reopen was rejected; set on reject. */
  reopenRejectedDate: Date | null;
  /** Reason the reopen was rejected; set on reject. */
  reopenRejectReason: string | null;
  /** Link to a Workflow Engine instance (nullable, reserved for a future
   * Epic 9 integration; the local maker-checker flow does not write it). */
  workflowInstanceId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface ChartOfAccounts {
  id: string;
  tenantId: string;
  legalEntityId: string;
  coaVersionCode: string;
  coaVersionDate: string;
  isActive: boolean;
  approvedBy: string | null;
  approvedDate: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface AccountingAccount {
  id: string;
  tenantId: string;
  legalEntityId: string;
  coaId: string;
  accountCode: string;
  accountName: string;
  accountClass: AccountClass;
  normalBalance: NormalBalance;
  accountType: string | null;
  /**
   * Parent account for tiered COA (DEC-001). Nullable: top-level accounts
   * have no parent. Enforced same-entity + no-cycle by DB triggers
   * (migration 1792000000004_phase-1c-coa-hierarchy).
   */
  parentAccountId: string | null;
  isActive: boolean;
  deactivatedAt: Date | null;
  deactivatedBy: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface JournalHeader {
  id: string;
  tenantId: string;
  legalEntityId: string;
  journalNumber: string;
  journalDate: string;
  accountingDate: string;
  periodId: string;
  description: string | null;
  postedDate: Date | null;
  postedBy: string | null;
  currency: string;
  postingRuleVersionId: string | null;
  /** Deterministic: `sha256(source_event_id + posting_rule_version_hash)`. */
  idempotencyKey: string;
  status: JournalStatus;
  isBalanced: boolean;
  reversalOfId: string | null;
  /**
   * Reversal metadata, carried on the REVERSAL journal itself (WP-FIN-02).
   * The original journal only flips `status` to `reversed`; its reason and
   * operator live on the linked correction so the audit trail is one-way.
   */
  reversalReason: string | null;
  reversalType: ReversalType | null;
  reversedBy: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface JournalLine {
  id: string;
  tenantId: string;
  journalHeaderId: string;
  accountId: string;
  lineNumber: number;
  /** Exactly one of `debit` / `credit` is non-zero (DB CHECK enforces). */
  debit: Money;
  credit: Money;
  lineDescription: string | null;
  costCenterId: string | null;
  projectId: string | null;
  siteId: string | null;
  reversalOfLineId: string | null;
  createdAt: Date;
}

export interface GeneralLedgerEntry {
  id: string;
  tenantId: string;
  accountId: string;
  periodId: string;
  journalLineId: string;
  postingDate: Date;
  debit: Money;
  credit: Money;
  balanceBefore: Money | null;
  balanceAfter: Money | null;
  documentType: string | null;
  documentId: string | null;
  createdAt: Date;
}

export interface GlBalance {
  id: string;
  tenantId: string;
  accountId: string;
  periodId: string;
  openingBalance: Money;
  debitTotal: Money;
  creditTotal: Money;
  closingBalance: Money;
  lastRefreshed: Date;
}

export interface JournalGlReconciliation {
  periodId: string;
  matched: boolean;
  orphanGlEntryIds: string[];
  mismatchedGlEntryIds: string[];
  unpostedJournalIds: string[];
  totals: {
    glDebit: Money;
    glCredit: Money;
    journalDebit: Money;
    journalCredit: Money;
  };
}

export interface PostingIdempotencyKey {
  id: string;
  tenantId: string;
  sourceEventId: string;
  postingRuleVersionHash: string;
  idempotencyKey: string;
  journalHeaderId: string | null;
  postingAttemptCount: number;
  lastAttemptDate: Date;
  lastAttemptStatus: PostingAttemptStatus | null;
  failureReason: string | null;
  createdAt: Date;
}

/** One debit or credit leg inside a rule's accounting formula (JSON). */
export interface PostingRuleLeg {
  accountCode: string;
  side: NormalBalance;
  /** Amount expression, evaluated by the poster (Phase 2). Never JS float. */
  amountExpression: string;
}

export interface PostingRule {
  id: string;
  tenantId: string;
  ruleCode: string;
  ruleName: string;
  ruleVersion: string;
  triggerEventType: string;
  accountingFormula: PostingRuleLeg[];
  requiresApproval: boolean;
  materialityThreshold: Money | null;
  isActive: boolean;
  effectiveDate: string;
  deprecatedDate: string | null;
  createdAt: Date;
  updatedAt: Date;
}

// Input types for posting rule operations
export interface CreatePostingRuleInput {
  tenantId: string;
  ruleCode: string;
  ruleName: string;
  ruleVersion: string;
  triggerEventType: string;
  accountingFormula: PostingRuleLeg[];
  requiresApproval: boolean;
  materialityThreshold: Money | null;
  effectiveDate: string;
  createdBy: string | null;
}

export interface PostingRuleFilter {
  triggerEventType?: string;
  isActive?: boolean;
}

export interface ResolvePostingRuleInput {
  tenantId: string;
  triggerEventType: string;
  accountingDate: string;
  amount: Money;
}

export interface ResolvePostingRuleResult {
  rule: PostingRule;
  resolvedLegs: Array<{
    accountCode: string;
    side: NormalBalance;
    amount: Money;
  }>;
}

export interface GenerateJournalFromRuleInput {
  tenantId: string;
  legalEntityId: string;
  triggerEventType: string;
  journalNumber: string;
  journalDate: string;
  accountingDate: string;
  periodId: string;
  amount: Money;
  idempotencyKey: string;
  description: string | null;
  currency: string;
}

// ---------------------------------------------------------------------------
// Repository port
// ---------------------------------------------------------------------------

export interface CreatePeriodInput {
  tenantId: string;
  legalEntityId: string;
  fiscalYearCode: string;
  periodCode: string;
  periodName: string;
  periodType: AccountingPeriodType;
  dateFrom: string;
  dateTo: string;
  createdBy: string | null;
}

/**
 * Reopen request write input (WP-FIN-03). A closed period moves to
 * `reopenable` with a non-empty reason and impact evidence. The requester
 * is the maker; a different operator must approve.
 */
export interface RequestPeriodReopenInput {
  periodId: string;
  requestedBy: string | null;
  reason: string;
  impactEvidence: string;
}

/** Approve a pending reopen: stamps the approver and moves to `open`. */
export interface ApprovePeriodReopenInput {
  periodId: string;
  approvedBy: string | null;
}

/** Reject a pending reopen: records the rejecter and reason, back to `closed`. */
export interface RejectPeriodReopenInput {
  periodId: string;
  rejectedBy: string | null;
  reason: string;
}

export interface CreateAccountInput {
  tenantId: string;
  legalEntityId: string;
  coaId: string;
  accountCode: string;
  accountName: string;
  accountClass: AccountClass;
  normalBalance: NormalBalance;
  accountType: string | null;
  /** Optional parent for tiered COA. Must belong to same (tenant, legal entity). */
  parentAccountId: string | null;
  createdBy: string | null;
}

export interface CreateJournalInput {
  tenantId: string;
  legalEntityId: string;
  journalNumber: string;
  journalDate: string;
  accountingDate: string;
  periodId: string;
  description: string | null;
  currency: string;
  postingRuleVersionId: string | null;
  idempotencyKey: string;
  lines: ReadonlyArray<{
    accountId: string;
    lineNumber: number;
    debit: Money;
    credit: Money;
    lineDescription: string | null;
    projectId: string | null;
    siteId: string | null;
  }>;
  createdBy: string | null;
}

/**
 * Reversal write input (WP-FIN-02). The reversal journal is a NEW header
 * that points at the original via `reversalOfId`; its lines mirror the
 * original with debit and credit swapped. Nothing on the original is edited
 * except its `status` (→ `reversed`).
 */
export interface ReverseJournalInput {
  tenantId: string;
  legalEntityId: string;
  reversalOfId: string;
  /** Effective dates for the reversal (original date or running date) and its period. */
  journalDate: string;
  accountingDate: string;
  periodId: string;
  journalNumber: string;
  idempotencyKey: string;
  reversalReason: string;
  reversalType: ReversalType;
  reversedBy: string | null;
}

/**
 * Persistence port for the Accounting Kernel.
 *
 * The critical methods (`postJournal`, `recordIdempotencyKey`) do their
 * arithmetic and their guarding inside PostgreSQL statements, under row
 * locks, within a single database transaction — the same discipline the
 * Finance Core `applyTransaction` follows. Nothing here trusts JavaScript
 * arithmetic for a money total.
 */
export interface AccountingKernelRepository {
  // --- Periods --------------------------------------------------------
  createPeriod(input: CreatePeriodInput): Promise<AccountingPeriod>;
  findPeriodById(id: string): Promise<AccountingPeriod | null>;
  listPeriods(tenantId: string, filter: { legalEntityId?: string; status?: AccountingPeriodStatus }): Promise<AccountingPeriod[]>;
  setPeriodStatus(id: string, status: AccountingPeriodStatus, updatedBy: string | null): Promise<AccountingPeriod | null>;

  /**
   * Maker step of the reopen flow (WP-FIN-03): moves a `closed` period to
   * `reopenable`, recording the requester, reason and impact evidence.
   * Returns `null` when the period is not `closed` (the `status = 'closed'`
   * guard lives in the UPDATE's WHERE clause, not in a prior read).
   */
  requestPeriodReopen(input: RequestPeriodReopenInput): Promise<AccountingPeriod | null>;

  /**
   * Checker step: moves a `reopenable` period back to `open`, stamping the
   * approver. Returns `null` when the period is not `reopenable`.
   */
  approvePeriodReopen(input: ApprovePeriodReopenInput): Promise<AccountingPeriod | null>;

  /**
   * Rejection step: moves a `reopenable` period back to `closed`, recording
   * the rejecter and reason. Returns `null` when the period is not
   * `reopenable`.
   */
  rejectPeriodReopen(input: RejectPeriodReopenInput): Promise<AccountingPeriod | null>;

  // --- Accounts -------------------------------------------------------
  createAccount(input: CreateAccountInput): Promise<AccountingAccount>;
  findAccountById(id: string): Promise<AccountingAccount | null>;
  findAccountByCode(tenantId: string, legalEntityId: string, accountCode: string): Promise<AccountingAccount | null>;
  listAccounts(tenantId: string, filter: { legalEntityId?: string; activeOnly?: boolean }): Promise<AccountingAccount[]>;

  /**
   * Tiered COA tree (DEC-001): every account of a legal entity with its
   * depth in the parent chain (top-level = 0), ordered for rendering.
   * `depth` comes from a recursive CTE, so a hierarchy wider or deeper than
   * the application expects cannot be flattened incorrectly.
   */
  listAccountHierarchy(
    tenantId: string,
    legalEntityId: string,
  ): Promise<Array<{ account: AccountingAccount; depth: number }>>;

  // --- Journals -------------------------------------------------------
  createJournal(input: CreateJournalInput): Promise<JournalHeader>;
  findJournalById(id: string): Promise<JournalHeader | null>;
  listJournalLines(journalHeaderId: string): Promise<JournalLine[]>;
  listJournals(tenantId: string, filter: { periodId?: string; status?: JournalStatus }): Promise<JournalHeader[]>;

  /**
   * Posts a draft journal: validates balance, writes GL entries, flips the
   * header to `posted`, all inside ONE transaction. Returns `null` when the
   * journal does not exist or is not in `pending`, and `{ unbalanced: true }`
   * when the debit/credit invariant fails — in both cases NOTHING is written.
   */
  postJournal(
    journalId: string,
    postedBy: string | null,
  ): Promise<{ journal: JournalHeader } | { unbalanced: true } | null>;

  /** GL entries for an account within a period, ordered by posting date. */
  listGlEntries(tenantId: string, filter: { accountId?: string; periodId?: string }): Promise<GeneralLedgerEntry[]>;

  /** The materialized balance row refreshed at post/reverse time. `null` when none has been computed yet. */
  findGlBalance(tenantId: string, accountId: string, periodId: string): Promise<GlBalance | null>;

  /**
   * Compares posted journals against their GL entries for a period (WP-FIN-04):
   * orphan GL entries (no journal line), amount/period mismatches, unposted
   * journals in the period, and the aggregate debit/credit totals on each
   * side. A single read-only query set — writes nothing.
   */
  reconcileJournalVsGl(tenantId: string, periodId: string): Promise<JournalGlReconciliation>;

  /**
   * The earliest `open` period of a legal entity whose date range reaches
   * `onOrAfterDate` or later (WP-FIN-02, reverse_accrual routing). `null`
   * when no open period exists at or after that date.
   */
  findNextOpenPeriod(
    tenantId: string,
    legalEntityId: string,
    onOrAfterDate: string,
  ): Promise<AccountingPeriod | null>;

  /**
   * Reverses a posted journal as a linked correction (ADR-0016 §2/§3): the
   * original is never edited or deleted. Writes a NEW journal with swapped
   * debit/credit lines pointing back via `reversalOfId`, posts its GL
   * entries, refreshes balances, and flips the original's `status` to
   * `reversed` — all inside one transaction. Returns `null` when the
   * original does not exist, is not `posted`, or has already been reversed
   * (one-time-reversal invariant).
   */
  reverseJournal(
    input: ReverseJournalInput,
  ): Promise<{ original: JournalHeader; reversal: JournalHeader } | null>;

  // --- Idempotency ----------------------------------------------------
  findIdempotencyKey(tenantId: string, idempotencyKey: string): Promise<PostingIdempotencyKey | null>;
  recordIdempotencyKey(input: {
    tenantId: string;
    sourceEventId: string;
    postingRuleVersionHash: string;
    idempotencyKey: string;
    lastAttemptStatus: PostingAttemptStatus;
    failureReason: string | null;
  }): Promise<PostingIdempotencyKey>;

  // --- Posting rules (WP-FIN-05) ---------------------------------------
  /**
   * Inserts a new rule version. The DB unique constraint on
   * `(tenant_id, rule_code, rule_version)` is the sole duplicate guard —
   * callers do not pre-check existence.
   */
  createPostingRule(input: CreatePostingRuleInput): Promise<PostingRule>;
  findPostingRuleById(id: string): Promise<PostingRule | null>;
  listPostingRules(tenantId: string, filter: PostingRuleFilter): Promise<PostingRule[]>;

  /**
   * The active rule for a trigger event type as of a given date: highest
   * `effective_date <= onDate`, `deprecated_date IS NULL OR > onDate`,
   * `is_active = true`, ties broken by latest `rule_version`. `null` when no
   * rule matches — callers must fail closed, never fall back to a hardcoded
   * mapping (§4.14 decision #9).
   */
  findActivePostingRule(tenantId: string, triggerEventType: string, onDate: string): Promise<PostingRule | null>;

  /** Soft end-of-life: sets `deprecated_date`, never deletes the row. */
  deprecatePostingRule(
    tenantId: string,
    id: string,
    deprecatedDate: string,
    updatedBy: string | null,
  ): Promise<PostingRule | null>;

  /**
   * Evaluates a whitelisted amount expression against an amount value using
   * PostgreSQL `numeric` arithmetic. The expression is pre-validated by the
   * caller to contain only the token `AMOUNT`, numeric literals, and the
   * operators `+ - * / ( )`. `AMOUNT` is substituted as a bound `$1` parameter
   * — the amount value is never string-interpolated. Result is rounded to
   * `numeric(18,2)` by the cast.
   */
  evaluateAmountExpression(expression: string, amount: Money): Promise<Money>;

  // --- Cross-domain reads kept behind this port -----------------------
  legalEntityExists(tenantId: string, legalEntityId: string): Promise<boolean>;
}