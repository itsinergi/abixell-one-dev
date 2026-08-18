import type { ConditionExpression } from "../../domain/workflow/workflow.entity.js";

/**
 * Pure function — evaluates a Condition (Transition or Assignment Rule)
 * against a Workflow Instance's `contextData`. Kept deliberately minimal
 * (six comparison operators, dot-path field lookup) per anti-
 * overengineering guidance: this is what's needed to prove
 * Condition-driven dynamic routing works end-to-end, not a general
 * expression language.
 *
 * `null` (no condition) always matches — this is how a transition/rule
 * expresses "the default / fallback".
 */
export function evaluateCondition(
  expression: ConditionExpression | null,
  contextData: Record<string, unknown>,
): boolean {
  if (!expression) return true;

  const actual = getField(contextData, expression.field);

  switch (expression.operator) {
    case "eq":
      return actual === expression.value;
    case "neq":
      return actual !== expression.value;
    case "gt":
      return typeof actual === "number" && typeof expression.value === "number" && actual > expression.value;
    case "gte":
      return typeof actual === "number" && typeof expression.value === "number" && actual >= expression.value;
    case "lt":
      return typeof actual === "number" && typeof expression.value === "number" && actual < expression.value;
    case "lte":
      return typeof actual === "number" && typeof expression.value === "number" && actual <= expression.value;
    case "in":
      return Array.isArray(expression.value) && expression.value.includes(actual);
    default:
      return false;
  }
}

function getField(data: Record<string, unknown>, path: string): unknown {
  return path.split(".").reduce<unknown>((acc, key) => {
    if (acc && typeof acc === "object" && key in (acc as object)) {
      return (acc as Record<string, unknown>)[key];
    }
    return undefined;
  }, data);
}
