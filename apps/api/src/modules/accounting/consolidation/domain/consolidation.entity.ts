/**
 * WP-FIN-A6-06b — Consolidation (ADR-0022 §1–§3).
 *
 * Four things, and the separation is the contract:
 *
 *   - a *group* — a reporting perimeter with ONE reporting currency, same-tenant
 *     by construction. Membership is effective dated, so a report dated before a
 *     change still sees the perimeter it had;
 *   - an *FSV version* — a closed metamodel mapping accounts to named lines. A
 *     line sums its accounts and optionally flips sign. There is no expression,
 *     formula or script: that is the whole point of calling it closed;
 *   - an *FX rate set* — effective-dated, one rate per pair per type. Closing for
 *     the balance sheet, average for the P&L, historical for equity;
 *   - a *translation run* — one per group per period, storing every translated
 *     amount WITH the rate that produced it, so a historical report never
 *     re-derives a rate that has since changed.
 *
 * All arithmetic is integer: money is 2-decimal cents, a rate is integer
 * hundred-millionths (1.00000000 = 100000000). No binary floating point reaches
 * a reporting figure, same rule as the tax baseline (ADR-0019 §3).
 */

import type { ActorContext } from "../../../../domain/shared-kernel/audit-context.js";

export type ConsolidationGroupStatus = "draft" | "active" | "archived";
export type StatementType = "trial_balance" | "balance_sheet" | "profit_loss" | "cash_flow";
export type LineSign = "as_is" | "flip";
export type FsvVersionStatus = "draft" | "approved" | "superseded";
export type RateType = "closing" | "average" | "historical";
export type TranslationRunStatus = "computed" | "posted" | "reversed";
export type EliminationStatus = "draft" | "approved" | "posted" | "reversed";

export const STATEMENT_TYPES: readonly StatementType[] = [
  "trial_balance",
  "balance_sheet",
  "profit_loss",
  "cash_flow",
];
export const RATE_TYPES: readonly RateType[] = ["closing", "average", "historical"];

/** Three-letter ISO code, uppercase. Kept a string so a new currency needs no
 *  code change — only a rate. */
const CURRENCY_3 = /^[A-Z]{3}$/;

export function isCurrency(value: string): boolean {
  return CURRENCY_3.test(value);
}

// ---------------------------------------------------------------------------
// Shapes
// ---------------------------------------------------------------------------

export interface ConsolidationGroup {
  id: string;
  tenantId: string;
  groupCode: string;
  name: string;
  reportingCurrency: string;
  translationDifferenceAccountId: string | null;
  status: ConsolidationGroupStatus;
  workflowInstanceId: string | null;
  approvedBy: string | null;
  approvedAt: string | null;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ConsolidationGroupEntity {
  id: string;
  tenantId: string;
  groupId: string;
  legalEntityId: string;
  effectiveFrom: string;
  effectiveTo: string | null;
  createdAt: string;
}

export interface FsvVersion {
  id: string;
  tenantId: string;
  fsvCode: string;
  versionNumber: number;
  description: string | null;
  status: FsvVersionStatus;
  effectiveFrom: string;
  effectiveTo: string | null;
  workflowInstanceId: string | null;
  approvedBy: string | null;
  approvedAt: string | null;
  createdAt: string;
}

export interface FsvLine {
  id: string;
  tenantId: string;
  fsvVersionId: string;
  lineCode: string;
  lineName: string;
  statementType: StatementType;
  accountId: string | null;
  sign: LineSign;
  sequenceOrder: number;
  parentLineCode: string | null;
}

export interface FxRateSet {
  id: string;
  tenantId: string;
  setCode: string;
  name: string;
  effectiveFrom: string;
  effectiveTo: string | null;
  status: "active" | "archived";
  createdAt: string;
}

export interface FxRate {
  id: string;
  tenantId: string;
  rateSetId: string;
  fromCurrency: string;
  toCurrency: string;
  rateType: RateType;
  rate: string;
}

export interface TranslationRun {
  id: string;
  tenantId: string;
  groupId: string;
  periodId: string;
  rateSetId: string;
  fsvVersionId: string;
  reportingCurrency: string;
  translatedTotal: string;
  residualAmount: string;
  status: TranslationRunStatus;
  journalId: string | null;
  idempotencyKey: string;
  createdBy: string | null;
  createdAt: string;
}

export interface TranslationRunLine {
  id: string;
  tenantId: string;
  runId: string;
  legalEntityId: string;
  accountId: string;
  sourceCurrency: string;
  sourceAmount: string;
  rate: string;
  rateType: RateType;
  translatedAmount: string;
}

export interface Elimination {
  id: string;
  tenantId: string;
  groupId: string;
  periodId: string;
  description: string;
  amount: string;
  currency: string;
  journalId: string | null;
  status: EliminationStatus;
  workflowInstanceId: string | null;
  approvedBy: string | null;
  approvedAt: string | null;
  idempotencyKey: string;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Exact money + exact rate
// ---------------------------------------------------------------------------

const MONEY_2DP = /^-?\d{1,16}(\.\d{1,2})?$/;
const RATE_8DP = /^\d{1,10}(\.\d{1,8})?$/;

/** Money as 2-decimal integer cents. Fails closed, never a silent 0. */
export function toCents(value: string | number | null | undefined): bigint | null {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  if (!MONEY_2DP.test(text)) return null;
  const negative = text.startsWith("-");
  const [whole, frac = ""] = (negative ? text.slice(1) : text).split(".");
  const cents = BigInt(whole) * 100n + BigInt((frac + "00").slice(0, 2));
  return negative ? -cents : cents;
}

export function fromCents(cents: bigint): string {
  const negative = cents < 0n;
  const abs = negative ? -cents : cents;
  return `${negative ? "-" : ""}${abs / 100n}.${(abs % 100n).toString().padStart(2, "0")}`;
}

/**
 * A rate as integer hundred-millionths: "16345.50000000" → 1634550000000.
 *
 * An FX rate is not a tax fraction — it is not bounded by 1 — so this keeps 8
 * decimals rather than the tax baseline's 6, and stays integral for the same
 * reason: a rate parsed to a JS number reintroduces binary error into every
 * translated figure.
 */
export function toRateUnits(value: string | number): bigint | null {
  const text = String(value).trim();
  if (!RATE_8DP.test(text)) return null;
  const [whole, frac = ""] = text.split(".");
  return BigInt(whole) * 100_000_000n + BigInt((frac + "00000000").slice(0, 8));
}

export function fromRateUnits(units: bigint): string {
  const whole = units / 100_000_000n;
  const frac = (units % 100_000_000n).toString().padStart(8, "0");
  return `${whole}.${frac}`;
}

/**
 * Translate a source amount into the reporting currency, half-up on the cent.
 *
 * amount_cents × rate_units / 1e8 keeps everything integral: 1_000_000 cents
 * (10,000.00) at 16345.50000000 is 1_000_000 × 1_634_550_000_000 / 1e8 =
 * 16_345_500_000 cents = 163_455_000.00.
 *
 * A negative source amount (a credit balance) translates to a negative result —
 * the sign is the caller's data, not something this function invents.
 */
export function translateAmount(amountCents: bigint, rateUnits: bigint): bigint {
  if (rateUnits <= 0n) throw new RangeError("rate must be positive");
  const negative = amountCents < 0n;
  const abs = negative ? -amountCents : amountCents;
  const product = abs * rateUnits;
  const denominator = 100_000_000n;
  let result = product / denominator;
  const remainder = product % denominator;
  // Half-up: a remainder of half the denominator or more rounds the cent away
  // from zero, which is the convention a reporting figure is read against.
  if (remainder * 2n >= denominator) result += 1n;
  return negative ? -result : result;
}

// ---------------------------------------------------------------------------
// Effective-date resolution
// ---------------------------------------------------------------------------

function withinWindow(effectiveFrom: string, effectiveTo: string | null, asOf: string): boolean {
  if (asOf < effectiveFrom) return false;
  // `effective_to` is exclusive: the row that ends today does not apply today.
  return effectiveTo === null || asOf < effectiveTo;
}

/**
 * The FSV version in force on `asOf`.
 *
 * `superseded` is not "withdrawn" — a later version replaced it, and its own
 * window still describes history. Only a draft was never in force. Same rule as
 * the tax baseline, for the same reason: a back-dated report must resolve.
 */
export function resolveFsvVersion(
  versions: readonly FsvVersion[],
  asOf: string,
): FsvVersion | null {
  const matches = versions.filter(
    (v) => v.status !== "draft" && withinWindow(v.effectiveFrom, v.effectiveTo, asOf),
  );
  if (matches.length === 0) return null;
  return matches.reduce((best, row) => (row.versionNumber > best.versionNumber ? row : best));
}

/** The rate set in force on `asOf`. Archived sets never apply. */
export function resolveRateSet(sets: readonly FxRateSet[], asOf: string): FxRateSet | null {
  const matches = sets.filter(
    (s) => s.status === "active" && withinWindow(s.effectiveFrom, s.effectiveTo, asOf),
  );
  if (matches.length === 0) return null;
  return matches.reduce((best, row) => (row.effectiveFrom > best.effectiveFrom ? row : best));
}

/**
 * Group members on `asOf`. A membership row covers [from, to), so an entity that
 * left on the 1st is not consolidated for that day.
 */
export function resolveMembers(
  memberships: readonly ConsolidationGroupEntity[],
  asOf: string,
): ConsolidationGroupEntity[] {
  return memberships.filter((m) => withinWindow(m.effectiveFrom, m.effectiveTo, asOf));
}

/**
 * The rate to use for one pair and one type. Exact match on the pair; the
 * inverse pair is NOT auto-derived — a derived rate is a decision about spread
 * that this module is not allowed to make silently.
 */
export function resolveRate(
  rates: readonly FxRate[],
  from: string,
  to: string,
  type: RateType,
): FxRate | null {
  if (from === to) return null; // same currency: no rate, factor 1
  return (
    rates.find(
      (r) => r.fromCurrency === from && r.toCurrency === to && r.rateType === type,
    ) ?? null
  );
}

/** The rate type a statement line uses, from its statement. Equity and the
 *  balance sheet translate at closing; only the P&L uses the average. */
export function rateTypeForStatement(statementType: StatementType): RateType {
  return statementType === "profit_loss" ? "average" : "closing";
}

// ---------------------------------------------------------------------------
// FSV validation — the closed metamodel
// ---------------------------------------------------------------------------

/**
 * An FSV line set must be a usable mapping, not merely well-typed rows. These
 * are the invariants a report generator relies on, so they are checked when the
 * version is created rather than discovered when a statement renders.
 */
export function validateFsvLines(lines: readonly Pick<FsvLine, "lineCode" | "accountId" | "parentLineCode" | "statementType">[]): void {
  const codes = new Set<string>();
  for (const line of lines) {
    if (codes.has(line.lineCode)) {
      throw new RangeError(`Duplicate FSV line code "${line.lineCode}"`);
    }
    codes.add(line.lineCode);
  }
  for (const line of lines) {
    if (line.parentLineCode !== null && !codes.has(line.parentLineCode)) {
      throw new RangeError(
        `FSV line "${line.lineCode}" names a parent "${line.parentLineCode}" that does not exist`,
      );
    }
    if (line.parentLineCode === line.lineCode) {
      throw new RangeError(`FSV line "${line.lineCode}" cannot be its own parent`);
    }
  }
  // A cycle would make a rollup never terminate. One hop is enough to catch the
  // shape a human actually types; a longer ring is caught by the same walk.
  const parentOf = new Map(lines.map((l) => [l.lineCode, l.parentLineCode]));
  for (const line of lines) {
    const seen = new Set<string>([line.lineCode]);
    let cursor = parentOf.get(line.lineCode) ?? null;
    while (cursor !== null) {
      if (seen.has(cursor)) {
        throw new RangeError(`FSV line "${line.lineCode}" is part of a parent cycle`);
      }
      seen.add(cursor);
      cursor = parentOf.get(cursor) ?? null;
    }
  }
}

/** True when a line aggregates accounts rather than being a pure total. */
export function isAccountLine(line: Pick<FsvLine, "accountId">): boolean {
  return line.accountId !== null;
}

// ---------------------------------------------------------------------------
// Ports
// ---------------------------------------------------------------------------

/** Pack-activation gate, kept a port so this module owns no activation read. */
export interface ConsolidationPolicyPort {
  assertConsolidationCapability(actor: ActorContext, legalEntityId: string): Promise<void>;
}
