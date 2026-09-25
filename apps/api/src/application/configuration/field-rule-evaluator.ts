/**
 * Field-rule evaluator — Epic 2 Wave 1.
 *
 * Pure functions, no I/O and no clock: given a published rules definition and
 * the data currently in a form, decide which rules fire. Kept deliberately
 * structured (nine typed operators, no DSL) per the locked decision in
 * CORE-ROADMAP.md §4.2 — a rules version stores data, and the interpretation
 * of that data lives here in code so an existing version can never change
 * meaning because someone edited a stored expression.
 *
 * A rule that does not match simply does not fire. The field keeps the base
 * state it declares on `app_fields` (isMandatory / isReadonly / isVisible);
 * rules only turn flags on, they never turn them off. That means a field is
 * visible unless a `visible` rule for it fires, so a half-written definition
 * degrades to "show everything" rather than to a blank form.
 */
import type {
  AppFieldRuleVersion,
  FieldRuleCondition,
  RuleCombination,
  RuleOperator,
} from "../../domain/configuration/app-metadata.entity.js";

/** The three flags a field rule can set. */
export interface FieldState {
  mandatory: boolean;
  readonly: boolean;
  visible: boolean;
}

/** Rule types in the order they are applied; each maps to one field of FieldState. */
const RULE_TYPE_TO_FLAG = {
  mandatory: "mandatory",
  readonly: "readonly",
  visible: "visible",
} as const satisfies Record<string, keyof FieldState>;

/** True when a value counts as absent. Only `null`/`undefined` do — an empty
 *  string is a present value the user cleared, not a missing field. */
function isAbsent(value: unknown): boolean {
  return value === null || value === undefined;
}

/**
 * Evaluate one operator. Returns `false` rather than throwing for a value of
 * the wrong shape: a stored rule whose value does not suit its operator must
 * not crash a form render, and failing closed is the safe direction for the
 * access-shaped flags this feeds.
 */
export function evaluateOperator(operator: RuleOperator, actual: unknown, expected: unknown): boolean {
  switch (operator) {
    case "eq":
      return actual === expected;
    case "neq":
      return actual !== expected;
    case "gt":
      return typeof actual === "number" && typeof expected === "number" && actual > expected;
    case "gte":
      return typeof actual === "number" && typeof expected === "number" && actual >= expected;
    case "lt":
      return typeof actual === "number" && typeof expected === "number" && actual < expected;
    case "lte":
      return typeof actual === "number" && typeof expected === "number" && actual <= expected;
    case "in":
      return Array.isArray(expected) && expected.includes(actual);
    case "notIn":
      return Array.isArray(expected) && !expected.includes(actual);
    case "isNull":
      // `true` demands absence, `false` demands presence.
      return typeof expected === "boolean" && isAbsent(actual) === expected;
    default:
      return false;
  }
}

/** Dot-path lookup, matching the convention used by `FieldRuleCondition.field`. */
export function getField(data: Record<string, unknown>, path: string): unknown {
  return path.split(".").reduce<unknown>((acc, key) => {
    if (acc && typeof acc === "object" && key in (acc as object)) {
      return (acc as Record<string, unknown>)[key];
    }
    return undefined;
  }, data);
}

/**
 * A combination with no rules matches unconditionally — that is how a rule
 * says "always". `null`/`undefined` (no conditions stored) means the same.
 */
export function evaluateRuleCombination(
  combination: RuleCombination | null | undefined,
  data: Record<string, unknown>,
): boolean {
  if (!combination) return true;
  const { rules, combinator } = combination;
  if (rules.length === 0) return true;

  const matches = (condition: FieldRuleCondition): boolean =>
    evaluateOperator(condition.operator, getField(data, condition.field), condition.value);

  return combinator === "OR" ? rules.some(matches) : rules.every(matches);
}

/** Every field named anywhere in the definition, in first-seen order. */
export function fieldsInDefinition(
  definition: AppFieldRuleVersion["rulesDefinition"] | null | undefined,
): string[] {
  if (!definition) return [];
  const seen = new Set<string>();
  for (const rule of definition.rules) {
    if (!seen.has(rule.field)) seen.add(rule.field);
  }
  return [...seen];
}

/** Apply every rule that targets one field on top of its base state. */
export function resolveFieldState(
  field: string,
  definition: AppFieldRuleVersion["rulesDefinition"] | null | undefined,
  data: Record<string, unknown>,
  base: FieldState,
): FieldState {
  const state: FieldState = { ...base };
  if (!definition) return state;

  for (const rule of definition.rules) {
    if (rule.field !== field) continue;
    if (!evaluateRuleCombination(rule.conditions, data)) continue;
    state[RULE_TYPE_TO_FLAG[rule.ruleType]] = true;
  }

  return state;
}

/** Resolve every field the definition mentions. Fields absent from the
 *  definition are not returned — their state is whatever the caller's base
 *  says, and inventing entries for them would hide that. */
export function resolveFieldStates(
  definition: AppFieldRuleVersion["rulesDefinition"] | null | undefined,
  data: Record<string, unknown>,
  baseOf: (field: string) => FieldState,
): Map<string, FieldState> {
  const resolved = new Map<string, FieldState>();
  for (const field of fieldsInDefinition(definition)) {
    resolved.set(field, resolveFieldState(field, definition, data, baseOf(field)));
  }
  return resolved;
}
