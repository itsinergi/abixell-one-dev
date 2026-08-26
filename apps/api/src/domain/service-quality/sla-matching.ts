/**
 * Wave A1 / SQ-ADV-001 — deterministic SLA rule selection.
 *
 * Kept as a pure function so the resolution order is one readable, directly
 * testable rule rather than an ORDER BY buried in SQL. A Tenant must be able
 * to predict which cell of its matrix will apply, and a reviewer must be able
 * to see why after the fact.
 *
 * Precedence, in order:
 *   1. Specificity — the rule constraining the MOST dimensions wins. A rule
 *      naming a customer AND a severity beats one naming only a severity.
 *   2. Explicit `priority` (higher first) — the Tenant's own override for a
 *      genuine tie in specificity.
 *   3. `code` ascending — a stable, arbitrary-but-documented final tiebreak,
 *      so the same inputs always select the same rule.
 */

import type { SlaMatchContext, SlaRule } from "./service-quality.entity.js";

/** The four matrix dimensions, in the order shown to a reviewer. */
const DIMENSIONS = ["customerId", "contractId", "severityCode", "categoryCode"] as const;

type Dimension = (typeof DIMENSIONS)[number];

function ruleValue(rule: SlaRule, dimension: Dimension): string | null {
  switch (dimension) {
    case "customerId":
      return rule.customerId;
    case "contractId":
      return rule.contractId;
    case "severityCode":
      return rule.severityCode;
    case "categoryCode":
      return rule.categoryCode;
  }
}

function contextValue(context: SlaMatchContext, dimension: Dimension): string | null {
  switch (dimension) {
    case "customerId":
      return context.customerId;
    case "contractId":
      return context.contractId;
    case "severityCode":
      return context.severityCode;
    case "categoryCode":
      return context.categoryCode;
  }
}

/** A rule matches when every constrained dimension equals the context; a
 * NULL column means "any" and always matches. */
export function ruleMatches(rule: SlaRule, context: SlaMatchContext): boolean {
  if (!rule.isActive) return false;
  return DIMENSIONS.every((dimension) => {
    const constrained = ruleValue(rule, dimension);
    return constrained === null || constrained === contextValue(context, dimension);
  });
}

export function specificity(rule: SlaRule): number {
  return DIMENSIONS.filter((dimension) => ruleValue(rule, dimension) !== null).length;
}

/** The dimensions the winning rule actually constrained — stored on the
 * target as the human-readable explanation of the match. */
export function matchedDimensions(rule: SlaRule): Record<string, string | null> {
  const matched: Record<string, string | null> = {};
  for (const dimension of DIMENSIONS) {
    const value = ruleValue(rule, dimension);
    if (value !== null) matched[dimension] = value;
  }
  return matched;
}

/**
 * Selects the winning rule, or null when nothing matches — in which case the
 * caller records NO target rather than inventing a default commitment.
 */
export function selectSlaRule(rules: SlaRule[], context: SlaMatchContext): SlaRule | null {
  const candidates = rules.filter((rule) => ruleMatches(rule, context));
  if (candidates.length === 0) return null;

  // Never reorder a repository-owned collection as a side effect of a read.
  candidates.sort((a, b) => {
    const bySpecificity = specificity(b) - specificity(a);
    if (bySpecificity !== 0) return bySpecificity;
    const byPriority = b.priority - a.priority;
    if (byPriority !== 0) return byPriority;
    return a.code.localeCompare(b.code);
  });

  return candidates[0] ?? null;
}
