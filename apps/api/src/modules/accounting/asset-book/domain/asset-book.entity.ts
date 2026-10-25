/**
 * WP-FIN-A6-05 — Fixed asset book + depreciation (ADR-0019).
 *
 * Two things live here and neither may be confused with the other:
 *
 *   - the *schedule* — what a method says should be depreciated per period,
 *     computed from the book's own terms;
 *   - the *run* — what was actually posted for one period, and therefore what
 *     the ledger holds.
 *
 * The schedule is a pure function; the run is a write. Keeping them apart is
 * what lets a posted run stay immutable while the schedule is recomputed for a
 * later period without rewriting history.
 *
 * Money is exact 2-decimal integer cents (`numeric(18,2)`), matching
 * `general_ledger_entries`. A 4-decimal schedule could never post to a
 * 2-decimal ledger without a rounding decision this module would then hide.
 */

export type AssetBookStatus = "draft" | "active" | "disposed";
export type AssetBookEventType = "capitalization" | "transfer" | "impairment" | "disposal" | "reversal";
export type DepreciationRunStatus = "posted" | "reversed";

export const ASSET_BOOK_STATUSES: AssetBookStatus[] = ["draft", "active", "disposed"];
export const ASSET_BOOK_EVENT_TYPES: AssetBookEventType[] = [
  "capitalization",
  "transfer",
  "impairment",
  "disposal",
  "reversal",
];

/** Wave A6 implements straight-line only. Reducing balance, units of
 *  production, component accounting and revaluation are excluded (ADR-0019 §2),
 *  and a second method enters through the same `DepreciationMethod` seam. */
export const ACTIVE_METHODS: ReadonlyArray<{ code: string; version: number }> = [
  { code: "straight_line", version: 1 },
];

export interface AssetBook {
  id: string;
  tenantId: string;
  legalEntityId: string;
  ledgerId: string;
  assetId: string;
  bookCode: string;
  assetClass: string;
  capitalizationDate: string;
  inServiceDate: string;
  acquisitionCost: string;
  residualValue: string;
  usefulLifeMonths: number;
  methodCode: string;
  methodVersion: number;
  depreciationExpenseAccountId: string;
  accumulatedDepreciationAccountId: string;
  status: AssetBookStatus;
  /** Projection of posted run lines — never the basis for a posting. */
  accumulatedDepreciation: string;
  disposedAt: string | null;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AssetBookEvent {
  id: string;
  tenantId: string;
  assetBookId: string;
  eventType: AssetBookEventType;
  eventDate: string;
  amount: string | null;
  evidenceDocumentId: string | null;
  workflowInstanceId: string | null;
  journalId: string | null;
  reversalOfId: string | null;
  note: string | null;
  idempotencyKey: string;
  createdBy: string | null;
  createdAt: string;
}

export interface DepreciationRun {
  id: string;
  tenantId: string;
  legalEntityId: string;
  /** A run covers every active asset in this book for one period. */
  bookCode: string;
  periodId: string;
  status: DepreciationRunStatus;
  totalAmount: string;
  currency: string;
  journalId: string | null;
  reversesRunId: string | null;
  idempotencyKey: string;
  createdBy: string | null;
  createdAt: string;
}

export interface DepreciationRunLine {
  id: string;
  tenantId: string;
  runId: string;
  assetBookId: string;
  amount: string;
  accumulatedBefore: string;
  accumulatedAfter: string;
  isFinalPeriod: boolean;
  createdAt: string;
}

export interface DepreciationRunDetail extends DepreciationRun {
  lines: DepreciationRunLine[];
}

// ---------------------------------------------------------------------------
// Exact 2-decimal money (integer cents). Parse fails closed, never a silent 0.
// ---------------------------------------------------------------------------

const MONEY_2DP = /^\d{1,16}(\.\d{1,2})?$/;

export function toCents(value: string | number | null | undefined): bigint | null {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  if (!MONEY_2DP.test(text)) return null;
  const [whole, frac = ""] = text.split(".");
  return BigInt(whole) * 100n + BigInt((frac + "00").slice(0, 2));
}

export function fromCents(cents: bigint): string {
  const negative = cents < 0n;
  const abs = negative ? -cents : cents;
  return `${negative ? "-" : ""}${abs / 100n}.${(abs % 100n).toString().padStart(2, "0")}`;
}

// ---------------------------------------------------------------------------
// Depreciation method seam (ADR-0019 §3)
// ---------------------------------------------------------------------------

export interface MethodInput {
  /** Depreciable basis in cents: acquisition cost less residual value. */
  basis: bigint;
  usefulLifeMonths: number;
}

export interface DepreciationMethod {
  readonly code: string;
  readonly version: number;
  /**
   * Amount per period in cents, length exactly `usefulLifeMonths`.
   * Contract: `sum(result) === basis`, non-negative, and every period after the
   * schedule ends is zero — the caller relies on all three.
   */
  periodAmounts(input: MethodInput): bigint[];
}

/**
 * Straight line, version 1.
 *
 * The monthly amount is truncated to the cent and the residual — up to one cent
 * per period — is absorbed in the final period, so the schedule sums to the
 * basis exactly. Rounding the *last* period instead of distributing the
 * remainder keeps every earlier period equal, which is what a depreciation
 * schedule is expected to look like.
 */
export const straightLineV1: DepreciationMethod = {
  code: "straight_line",
  version: 1,
  periodAmounts({ basis, usefulLifeMonths }: MethodInput): bigint[] {
    if (usefulLifeMonths <= 0) throw new RangeError("usefulLifeMonths must be positive");
    if (basis < 0n) throw new RangeError("basis must not be negative");
    const monthly = basis / BigInt(usefulLifeMonths);
    const amounts = Array.from({ length: usefulLifeMonths }, () => monthly);
    amounts[usefulLifeMonths - 1] = basis - monthly * BigInt(usefulLifeMonths - 1);
    return amounts;
  },
};

const METHODS: DepreciationMethod[] = [straightLineV1];

/** Resolve a method by code + version. An unknown pair fails closed: a run must
 *  never fall back to "whatever method is current". */
export function resolveMethod(code: string, version: number): DepreciationMethod {
  const method = METHODS.find((m) => m.code === code && m.version === version);
  if (!method) throw new RangeError(`Unsupported depreciation method ${code} v${version}`);
  return method;
}

// ---------------------------------------------------------------------------
// Schedule computation
// ---------------------------------------------------------------------------

export interface SchedulePeriod {
  /** 1-based month index into the schedule. */
  periodIndex: number;
  amount: string;
  accumulatedBefore: string;
  accumulatedAfter: string;
  isFinalPeriod: boolean;
}

/**
 * Whole schedule for a book, as the method sees it. Kept pure so the golden
 * cases can be asserted without a database.
 */
export function computeSchedule(input: {
  acquisitionCost: string;
  residualValue: string;
  usefulLifeMonths: number;
  methodCode: string;
  methodVersion: number;
}): SchedulePeriod[] {
  const cost = toCents(input.acquisitionCost);
  const residual = toCents(input.residualValue);
  if (cost === null) throw new RangeError("acquisitionCost must be a 2-decimal money value");
  if (residual === null) throw new RangeError("residualValue must be a 2-decimal money value");
  if (residual > cost) throw new RangeError("residualValue must not exceed acquisitionCost");

  const method = resolveMethod(input.methodCode, input.methodVersion);
  const amounts = method.periodAmounts({
    basis: cost - residual,
    usefulLifeMonths: input.usefulLifeMonths,
  });

  let accumulated = 0n;
  return amounts.map((amount, i) => {
    const before = accumulated;
    accumulated += amount;
    return {
      periodIndex: i + 1,
      amount: fromCents(amount),
      accumulatedBefore: fromCents(before),
      accumulatedAfter: fromCents(accumulated),
      isFinalPeriod: i === amounts.length - 1,
    };
  });
}

/**
 * Amount for one period of an *already started* schedule, given what has been
 * posted so far. Returns null when the schedule is exhausted.
 *
 * `alreadyDepreciated` is the sum of posted run lines, so a run that follows a
 * reversal lands on the right period rather than restarting the schedule.
 */
export function periodAmount(
  schedule: SchedulePeriod[],
  alreadyDepreciated: bigint,
): { amount: bigint; accumulatedBefore: bigint; accumulatedAfter: bigint; isFinalPeriod: boolean } | null {
  const target = schedule.find((p) => toCents(p.accumulatedAfter)! > alreadyDepreciated);
  if (!target) return null;
  const after = toCents(target.accumulatedAfter)!;
  return {
    amount: after - alreadyDepreciated,
    accumulatedBefore: alreadyDepreciated,
    accumulatedAfter: after,
    isFinalPeriod: target.isFinalPeriod,
  };
}

/** Depreciation may not begin before the asset is in service (ADR-0019 §3). */
export function firstDepreciableMonth(inServiceDate: string): string {
  return inServiceDate.slice(0, 7);
}
