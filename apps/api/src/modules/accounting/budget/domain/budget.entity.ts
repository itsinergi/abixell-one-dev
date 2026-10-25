/**
 * WP-FIN-A6-03 — Budget control + accounting dimensions (ADR-0020).
 *
 * Money is exact decimal at 4 decimals, carried as strings and computed in
 * BigInt units at scale 4 — never JS float (same posture as open-item).
 * Versions are immutable once approved; only the projection (available) is
 * derived, never stored.
 */

/** Scale-4 unit factor. 1 unit = 0.0001. */
export const AMOUNT_FACTOR = 10000n;

export type BudgetScenario = "original" | "revision" | "forecast";
export type BudgetVersionStatus = "draft" | "active" | "superseded" | "rejected";
export type BudgetControlEffect = "advisory" | "escalation" | "hard_stop";
export type BudgetConsumptionKind = "actual" | "commitment" | "adjustment" | "release";

export const BUDGET_SCENARIOS: BudgetScenario[] = ["original", "revision", "forecast"];
export const BUDGET_CONTROL_EFFECTS: BudgetControlEffect[] = ["advisory", "escalation", "hard_stop"];
export const BUDGET_CONSUMPTION_KINDS: BudgetConsumptionKind[] = [
  "actual",
  "commitment",
  "adjustment",
  "release",
];

/** Tenant/LE dimension scope. All dimensions are optional: a budget may govern
 * the whole Legal Entity or one cost center/project/site slice. The dimensions
 * are the accounting dimensions (ADR-0020 §1) — never a Finance-only tree and
 * never encoded into a COA number. */
export interface BudgetDimensionScope {
  costCenterId: string | null;
  projectId: string | null;
  siteId: string | null;
  accountFrom: string | null;
  accountTo: string | null;
}

export interface FinanceBudget {
  id: string;
  tenantId: string;
  legalEntityId: string;
  fiscalYearCode: string;
  scenario: BudgetScenario;
  currency: string;
  name: string;
  ownerUserId: string | null;
  costCenterId: string | null;
  projectId: string | null;
  siteId: string | null;
  accountFrom: string | null;
  accountTo: string | null;
  activeVersionId: string | null;
  createdBy: string | null;
  createdAt: string;
}

export interface BudgetVersion {
  id: string;
  tenantId: string;
  budgetId: string;
  versionNumber: number;
  status: BudgetVersionStatus;
  supersedesVersionId: string | null;
  workflowInstanceId: string | null;
  note: string | null;
  createdBy: string | null;
  createdAt: string;
  approvedBy: string | null;
  approvedAt: string | null;
}

export interface BudgetLine {
  id: string;
  budgetVersionId: string;
  periodCode: string;
  amount: string;
}

export interface BudgetPolicy {
  id: string;
  tenantId: string;
  legalEntityId: string;
  effect: BudgetControlEffect;
  documentType: string | null;
  costCenterId: string | null;
  projectId: string | null;
  accountFrom: string | null;
  accountTo: string | null;
  /** Amount at or above which this policy applies; null = any amount. */
  amountThreshold: string | null;
  effectiveFrom: string;
  effectiveTo: string | null;
  createdBy: string | null;
  createdAt: string;
}

export interface BudgetConsumption {
  id: string;
  tenantId: string;
  budgetVersionId: string;
  periodCode: string;
  kind: BudgetConsumptionKind;
  amount: string;
  sourceRefTable: string | null;
  sourceRefId: string | null;
  idempotencyKey: string;
  reversesId: string | null;
  note: string | null;
  createdBy: string | null;
  createdAt: string;
}

/** Period-level projection: baseline, actuals, commitments, releases and the
 * derived available amount (ADR-0020 §4). `variance` is the overspend beyond
 * the baseline (0.0000 when within budget) for advisory reporting. */
export interface BudgetPeriodUtilization {
  periodCode: string;
  baseline: string;
  actual: string;
  committed: string;
  released: string;
  adjustments: string;
  available: string;
  variance: string;
}

export interface BudgetUtilization {
  budgetId: string;
  versionId: string | null;
  currency: string;
  periods: BudgetPeriodUtilization[];
  total: Omit<BudgetPeriodUtilization, "periodCode">;
}

export type BudgetDecision = "ok" | "variance" | "escalate" | "blocked";

export interface BudgetAvailabilityResult {
  decision: BudgetDecision;
  policyId: string | null;
  effect: BudgetControlEffect | null;
  periodCode: string;
  requestedAmount: string;
  availableBefore: string;
  availableAfter: string;
  variance: string;
}

// ---------------------------------------------------------------------------
// Exact-decimal helpers (scale 4). Parse fails closed: never a silent 0.
// ---------------------------------------------------------------------------

export function toUnits(value: string | number | null | undefined): bigint | null {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  const match = /^(-?)(\d+)(?:\.(\d{1,4}))?$/.exec(text);
  if (!match) return null;
  const sign = match[1] === "-" ? -1n : 1n;
  const whole = match[2];
  const frac = (match[3] ?? "").padEnd(4, "0");
  return sign * (BigInt(whole) * AMOUNT_FACTOR + BigInt(frac));
}

export function fromUnits(units: bigint): string {
  const sign = units < 0n ? "-" : "";
  const abs = units < 0n ? -units : units;
  const whole = abs / AMOUNT_FACTOR;
  const frac = (abs % AMOUNT_FACTOR).toString().padStart(4, "0");
  return `${sign}${whole}.${frac}`;
}

export function addAmounts(a: string, b: string): string | null {
  const ua = toUnits(a);
  const ub = toUnits(b);
  if (ua === null || ub === null) return null;
  return fromUnits(ua + ub);
}

export function subtractAmounts(a: string, b: string): string | null {
  const ua = toUnits(a);
  const ub = toUnits(b);
  if (ua === null || ub === null) return null;
  return fromUnits(ua - ub);
}

/**
 * Deterministic period distribution of `total` across `weights`: exact
 * scale-4 integer shares, residual absorbed by the LAST period entry
 * (ADR-0020 §2). Weights are non-negative and must sum to a positive value.
 */
export function distributeTotal(
  total: string,
  weights: { periodCode: string; weight: string }[],
): { periodCode: string; amount: string }[] | null {
  const totalUnits = toUnits(total);
  if (totalUnits === null || totalUnits < 0n || weights.length === 0) return null;

  const unitWeights = weights.map((w) => toUnits(w.weight));
  if (unitWeights.some((w) => w === null || w < 0n)) return null;
  const weightSum = (unitWeights as bigint[]).reduce((acc, w) => acc + w, 0n);
  if (weightSum <= 0n) return null;

  const shares: bigint[] = [];
  let allocated = 0n;
  for (let i = 0; i < unitWeights.length; i += 1) {
    const isLast = i === unitWeights.length - 1;
    if (isLast) {
      shares.push(totalUnits - allocated);
    } else {
      // floor division keeps the sum of shares <= total, so the residual
      // absorbed by the last period is always non-negative.
      const share = (totalUnits * (unitWeights[i] as bigint)) / weightSum;
      shares.push(share);
      allocated += share;
    }
  }
  return weights.map((w, i) => ({ periodCode: w.periodCode, amount: fromUnits(shares[i] as bigint) }));
}

/**
 * Policy specificity: a policy with more matched constraints outranks a
 * looser one; ties break on earlier effective_from, then creation order.
 */
export function policyRank(policy: BudgetPolicy): number {
  let rank = 0;
  if (policy.documentType !== null) rank += 1;
  if (policy.costCenterId !== null) rank += 1;
  if (policy.projectId !== null) rank += 1;
  if (policy.accountFrom !== null || policy.accountTo !== null) rank += 1;
  if (policy.amountThreshold !== null) rank += 1;
  return rank;
}
