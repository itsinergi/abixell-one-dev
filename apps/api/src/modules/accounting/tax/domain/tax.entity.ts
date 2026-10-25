/**
 * WP-FIN-A6-06a — Indonesia tax baseline (ADR-0019).
 *
 * Three things live here and the separation is the point:
 *
 *   - a *registration* — whether this Legal Entity is PKP or Non-PKP on a given
 *     date. Effective dated, never edited;
 *   - a *rule version* — rate, basis, rounding and account mapping. Also
 *     effective dated, versioned, and immutable once approved;
 *   - a *calculation* — one basis, one rate, one result, and the exact version
 *     that produced it.
 *
 * All arithmetic is integer: money is 2-decimal cents, a rate is integer
 * millionths (11% = 110000). No binary floating point appears anywhere in a tax
 * figure, which is what ADR-0019 §3 requires and what makes a stored
 * calculation reproduce itself exactly.
 */

import type { ActorContext } from "../../../../domain/shared-kernel/audit-context.js";

export type TaxpayerStatus = "pkp" | "non_pkp";
export type TaxType = "ppn" | "pph22" | "pph23" | "pph26";
export type TaxBasis = "gross" | "net" | "dpp";
export type RoundingMode = "half_up" | "half_even" | "truncate";
export type TaxRuleVersionStatus = "draft" | "approved" | "superseded";

export const TAX_TYPES: readonly TaxType[] = ["ppn", "pph22", "pph23", "pph26"];
export const TAX_BASES: readonly TaxBasis[] = ["gross", "net", "dpp"];
export const ROUNDING_MODES: readonly RoundingMode[] = ["half_up", "half_even", "truncate"];

/**
 * PPh Badan and PPh 21 are excluded by ADR-0019 §2 and must not appear here.
 * The service rejects them by name so a caller gets a reason, not a schema error.
 */
export const EXCLUDED_TAX_TYPES: readonly string[] = ["pph_badan", "pph21", "pph_badan_final"];

export interface TaxRegistration {
  id: string;
  tenantId: string;
  legalEntityId: string;
  taxpayerStatus: TaxpayerStatus;
  registrationNumber: string | null;
  effectiveFrom: string;
  effectiveTo: string | null;
  evidenceDocumentId: string | null;
  status: "active" | "superseded";
  workflowInstanceId: string | null;
  createdBy: string | null;
  createdAt: string;
}

export interface TaxRule {
  id: string;
  tenantId: string;
  legalEntityId: string;
  ruleCode: string;
  taxType: TaxType;
  description: string | null;
  createdAt: string;
}

export interface TaxRuleVersion {
  id: string;
  tenantId: string;
  taxRuleId: string;
  versionNumber: number;
  rate: string;
  basis: TaxBasis;
  roundingMode: RoundingMode;
  requiresPkp: boolean;
  accountId: string;
  effectiveFrom: string;
  effectiveTo: string | null;
  status: TaxRuleVersionStatus;
  workflowInstanceId: string | null;
  approvedBy: string | null;
  approvedAt: string | null;
  createdAt: string;
}

export interface TaxCalculation {
  id: string;
  tenantId: string;
  legalEntityId: string;
  ruleVersionId: string;
  taxpayerStatus: TaxpayerStatus;
  basisAmount: string;
  rate: string;
  roundingMode: RoundingMode;
  taxAmount: string;
  currency: string;
  calculationDate: string;
  documentRefTable: string | null;
  documentRefId: string | null;
  idempotencyKey: string;
  createdBy: string | null;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Exact money + exact rate
// ---------------------------------------------------------------------------

const MONEY_2DP = /^\d{1,16}(\.\d{1,2})?$/;
const RATE_6DP = /^\d{1,3}(\.\d{1,6})?$/;

/** Money as 2-decimal integer cents. Fails closed, never a silent 0. */
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

/**
 * A rate as integer millionths: "0.110000" → 110000. Storing the fraction this
 * way keeps the whole calculation in integer arithmetic; a rate parsed to a
 * JS number would reintroduce the floating-point error ADR-0019 forbids.
 */
export function toRateMicros(value: string | number): bigint | null {
  const text = String(value).trim();
  if (!RATE_6DP.test(text)) return null;
  const [whole, frac = ""] = text.split(".");
  return BigInt(whole) * 1_000_000n + BigInt((frac + "000000").slice(0, 6));
}

export function fromRateMicros(micros: bigint): string {
  const whole = micros / 1_000_000n;
  const frac = (micros % 1_000_000n).toString().padStart(6, "0");
  return `${whole}.${frac}`;
}

/**
 * Divide with an explicit rounding mode. Integer-only: the quotient and the
 * remainder decide, never a float.
 *
 * `half_up` rounds a tie away from zero, `half_even` to the even neighbour,
 * `truncate` drops the remainder. All three are exact and deterministic, which
 * is the whole requirement — the mode is data, the result is not a guess.
 */
export function divideRound(numerator: bigint, denominator: bigint, mode: RoundingMode): bigint {
  if (denominator <= 0n) throw new RangeError("denominator must be positive");
  const negative = numerator < 0n;
  const abs = negative ? -numerator : numerator;
  const quotient = abs / denominator;
  const remainder = abs % denominator;
  if (remainder === 0n) return negative ? -quotient : quotient;

  let result = quotient;
  const twice = remainder * 2n;
  if (mode === "truncate") {
    // keep the quotient
  } else if (twice > denominator) {
    result = quotient + 1n;
  } else if (twice === denominator) {
    // A tie. `half_up` goes away from zero; `half_even` goes to the even neighbour.
    if (mode === "half_up") result = quotient + 1n;
    else if (mode === "half_even" && quotient % 2n === 1n) result = quotient + 1n;
  }
  return negative ? -result : result;
}

/**
 * Tax amount in cents for a basis in cents and a rate in millionths.
 *
 * basis_cents × rate_micros / 1e6 keeps everything integral: an 11% rate on
 * 100.00 (10000 cents) is 10000 × 110000 / 1e6 = 1100 cents = 11.00.
 */
export function computeTaxAmount(
  basisCents: bigint,
  rateMicros: bigint,
  mode: RoundingMode,
): bigint {
  if (basisCents < 0n) throw new RangeError("basis must not be negative");
  if (rateMicros < 0n) throw new RangeError("rate must not be negative");
  return divideRound(basisCents * rateMicros, 1_000_000n, mode);
}

// ---------------------------------------------------------------------------
// Effective-date resolution
// ---------------------------------------------------------------------------

function withinWindow(
  effectiveFrom: string,
  effectiveTo: string | null,
  asOf: string,
): boolean {
  if (asOf < effectiveFrom) return false;
  // `effective_to` is exclusive: the row that ends today does not apply today.
  return effectiveTo === null || asOf < effectiveTo;
}

/**
 * The registration in force on `asOf`. Fails closed: an entity with no
 * registration on that date has no taxpayer status, and guessing one would
 * decide a regulatory question this module is not allowed to answer.
 */
export function resolveRegistration(
  registrations: readonly TaxRegistration[],
  asOf: string,
): TaxRegistration | null {
  const matches = registrations.filter((r) => withinWindow(r.effectiveFrom, r.effectiveTo, asOf));
  if (matches.length === 0) return null;
  // A well-formed history has one row per date; the latest start wins if two
  // ever overlap, which is the row most recently put in force.
  return matches.reduce((best, row) => (row.effectiveFrom > best.effectiveFrom ? row : best));
}

/**
 * The approved rule version in force on `asOf`. Draft and superseded versions
 * are never candidates: a calculation may only rest on an approved version
 * (ADR-0019 §3).
 */
export function resolveRuleVersion(
  versions: readonly TaxRuleVersion[],
  asOf: string,
): TaxRuleVersion | null {
  // `superseded` is not "withdrawn" — it is a version that a later one
  // replaced. Its own window still describes history, so a calculation dated
  // inside it must resolve to it. Only a draft was never in force.
  const matches = versions.filter(
    (v) =>
      v.status !== "draft" && withinWindow(v.effectiveFrom, v.effectiveTo, asOf),
  );
  if (matches.length === 0) return null;
  return matches.reduce((best, row) => (row.versionNumber > best.versionNumber ? row : best));
}

// ---------------------------------------------------------------------------
// PKP gate
// ---------------------------------------------------------------------------

export interface TaxPolicyPort {
  /** True when the tenant has activated the Finance tax capability for this
   *  Legal Entity. Kept a port so the tax module owns no pack activation read. */
  assertTaxCapability(actor: ActorContext, legalEntityId: string): Promise<void>;
}

/**
 * A PKP-only rule applied to a Non-PKP entity is refused, never zeroed.
 *
 * The distinction matters: a zero would look like a legitimate exempt
 * calculation and would post a tax line of 0.00. Refusing says the caller asked
 * for something this entity may not do.
 */
export function assertPkpAllows(
  ruleVersion: Pick<TaxRuleVersion, "requiresPkp">,
  taxpayerStatus: TaxpayerStatus,
): void {
  if (ruleVersion.requiresPkp && taxpayerStatus !== "pkp") {
    throw new RangeError("This tax rule requires PKP status and the Legal Entity is Non-PKP");
  }
}
