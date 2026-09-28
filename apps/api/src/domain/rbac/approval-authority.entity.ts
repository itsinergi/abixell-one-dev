/**
 * Epic 1 (§4.1 D) — Approval Authority & Separation of Duties.
 *
 * The iDempiere basis (`MWFActivity.getApprovalUser`) is followed exactly:
 * the check order, the self-approval block, the NULL-limit skip, currency
 * conversion, accumulation, supervisor escalation and the cycle guard.
 * Where this domain differs from iDempiere it is because a named decision
 * in §4.1 says so — and each such place carries its own comment.
 *
 * Money discipline: every amount travels as the decimal STRING PostgreSQL
 * returns (`numeric` columns), and comparisons happen on scaled BigInt
 * values (`scaleToBigInt`), never on parseFloat. iDempiere uses BigDecimal
 * for exactly the same reason: binary floats cannot hold 0.1.
 */
import type { ActorContext } from "../shared-kernel/audit-context.js";

export interface ApprovalAuthorityInput {
  /** The user who acted to start the document (Doc_User_ID convention —
   * the DOCUMENT user, not the DB row's created_by). */
  documentUserId: string;
  /** numeric(18,2) string, or null when the document carries no amount. */
  amount: string | null;
  currencyCode: string;
  organizationUnitId: string;
  /** The transaction table the document lives in, for the accumulation
   * window (iDempiere's getAmtAccum counts on the same table). */
  documentTable: string;
  documentId: string;
}

export type ApprovalDecision =
  | { kind: "self-approved" }
  | { kind: "approve"; approverUserId: string }
  | { kind: "escalate"; nextApproverUserId: string }
  | { kind: "no-approver" };

/** One supervisor hop in the escalation walk. */
export interface SupervisorChainNode {
  userId: string;
  supervisorUserId: string | null;
}

/** The role-level approval configuration the resolver reads. `roleAmt` is
 * the raw numeric string so no precision is lost between the read and the
 * comparison. NULL means "no limit set" — iDempiere SKIPS such roles
 * (MWFActivity.java:769-770), it does not treat them as unlimited. */
export interface RoleApprovalLimits {
  roleAmt: string | null;
  amtApprovalAccum: string | null;
  daysApprovalAccum: number | null;
  currencyCode: string | null;
  isCanApproveOwnDoc: boolean;
}

/** A conversion rate row: `rate` is numeric(18,6) as string, scale 1e6. */
export interface ConversionRateRow {
  rate: string;
}

/** Reads the escalation inputs the resolver needs. All methods take the
 * tenant explicitly so the resolver never trusts a document-supplied
 * tenant. */
export interface ApprovalAuthorityRepository {
  /** The ACTIVE assignment's role approval limits for `userId` in
   * `tenantId`. Returns null when the user has no active role — the
   * caller escalates from their supervisor onward. */
  getActiveRoleApprovalLimits(
    tenantId: string,
    userId: string,
    assignmentId: string | null,
  ): Promise<RoleApprovalLimits | null>;

  /** Users in the supervisor chain, starting from `userId`, one hop each.
   * The resolver stops at the first null supervisor. */
  getSupervisorChain(
    tenantId: string,
    userId: string,
    limit: number,
  ): Promise<SupervisorChainNode[]>;

  /** The Organization Unit's supervisor (AD_OrgInfo.Supervisor_ID). */
  getOrganizationUnitSupervisor(
    tenantId: string,
    organizationUnitId: string,
  ): Promise<string | null>;

  /** The best conversion rate from `fromCode` to `toCode` effective now.
   * Returns null when none exists — the resolver fails clean, it never
   * guesses a rate. */
  getConversionRate(
    tenantId: string,
    fromCode: string,
    toCode: string,
  ): Promise<ConversionRateRow | null>;

  /** Total amount already approved by `userId` on `documentTable` within
   * the last `days` days, as a numeric string. iDempiere's getAmtAccum —
   * rows on the same table decided by this user, in the window. */
  getAccumulatedApprovedAmount(
    tenantId: string,
    userId: string,
    documentTable: string,
    days: number,
  ): Promise<string>;
}

/** Thrown when a rate is needed but none exists. The caller fails clean —
 * the document is NOT silently self-approved or escalated on a guess. */
export class MissingConversionRateError extends Error {
  constructor(readonly fromCode: string, readonly toCode: string) {
    super(`No conversion rate from ${fromCode} to ${toCode} is in effect`);
    this.name = "MissingConversionRateError";
  }
}

/** numeric(18,2) amounts compare on BigInt scaled by 100. */
export const AMOUNT_DECIMALS = 2;
export const AMOUNT_SCALE = 100n;
/** numeric(18,6) rates scale by 1e6. */
export const RATE_DECIMALS = 6;
export const RATE_SCALE = 1_000_000n;

/** Parses a fixed-point decimal string into a BigInt scaled by
 * 10^`decimals`. More fraction digits than `decimals` are TRUNCATED (not
 * rounded) — a half-cent never becomes authority to approve. */
function scaleToBigInt(value: string, decimals: number): bigint {
  const trimmed = value.trim();
  if (trimmed === "") throw new RangeError("empty decimal string");
  const negative = trimmed.startsWith("-");
  const digits = negative ? trimmed.slice(1) : trimmed;
  const [whole, fraction = ""] = digits.split(".");
  const padded = fraction.padEnd(decimals, "0").slice(0, decimals);
  const scaled = BigInt(`${whole === "" ? "0" : whole}${padded}`);
  return negative ? -scaled : scaled;
}

/** Scaled comparison of two numeric(18,2) strings. Exported for the unit
 * tests the §4.1 money discipline demands. */
export function compareAmounts(a: string, b: string): number {
  const left = scaleToBigInt(a, AMOUNT_DECIMALS);
  const right = scaleToBigInt(b, AMOUNT_DECIMALS);
  return left < right ? -1 : left > right ? 1 : 0;
}

/** Converts `amount` (numeric(18,2) string) using `rate` (numeric(18,6)
 * string): converted = amount * rate, computed on scaled BigInt so no float
 * ever touches the money. Returns the result scaled by 100 (the same scale
 * `compareAmounts` uses), truncating sub-cent noise the way iDempiere's
 * `BigDecimal.setScale(2)` does. */
export function convertAmount(amount: string, rate: string): bigint {
  const amountScaled = scaleToBigInt(amount, AMOUNT_DECIMALS);
  const rateScaled = scaleToBigInt(rate, RATE_DECIMALS);
  return (amountScaled * rateScaled) / RATE_SCALE;
}
