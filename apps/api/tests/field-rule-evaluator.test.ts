import { describe, expect, it } from "vitest";
import type { AppFieldRuleVersion, RuleCombination } from "../src/domain/configuration/app-metadata.entity.js";
import {
  evaluateOperator,
  evaluateRuleCombination,
  fieldsInDefinition,
  getField,
  resolveFieldState,
  resolveFieldStates,
} from "../src/application/configuration/field-rule-evaluator.js";

type Rule = AppFieldRuleVersion["rulesDefinition"]["rules"][number];

function combination(
  entries: Array<[field: string, operator: Rule["conditions"]["rules"][number]["operator"], value: unknown]>,
  combinator: "AND" | "OR" = "AND",
): RuleCombination {
  return { combinator, rules: entries.map(([field, operator, value]) => ({ field, operator, value })) };
}

function definition(rules: Rule[]): AppFieldRuleVersion["rulesDefinition"] {
  return { rules };
}

const BASE = { mandatory: false, readonly: false, visible: false };

describe("field-rule evaluator — operators", () => {
  it("eq / neq compare strict equality", () => {
    expect(evaluateOperator("eq", "urgent", "urgent")).toBe(true);
    expect(evaluateOperator("eq", "urgent", "normal")).toBe(false);
    expect(evaluateOperator("neq", "urgent", "normal")).toBe(true);
    // strict: no coercion across types
    expect(evaluateOperator("eq", "1", 1)).toBe(false);
  });

  it("gt/gte/lt/lte only match numbers on both sides", () => {
    expect(evaluateOperator("gt", 5, 4)).toBe(true);
    expect(evaluateOperator("gt", 4, 4)).toBe(false);
    expect(evaluateOperator("gte", 4, 4)).toBe(true);
    expect(evaluateOperator("lt", "9", 10)).toBe(false); // string actual fails closed
    expect(evaluateOperator("lte", 10, 10)).toBe(true);
    expect(evaluateOperator("gt", undefined, 1)).toBe(false);
  });

  it("in / notIn demand an array value", () => {
    expect(evaluateOperator("in", "b", ["a", "b"])).toBe(true);
    expect(evaluateOperator("in", "c", ["a", "b"])).toBe(false);
    expect(evaluateOperator("notIn", "c", ["a", "b"])).toBe(true);
    expect(evaluateOperator("notIn", "a", ["a", "b"])).toBe(false);
    // wrong-shape value fails closed rather than crashing
    expect(evaluateOperator("in", "a", "ab")).toBe(false);
    expect(evaluateOperator("notIn", "a", null)).toBe(false);
  });

  it("isNull uses boolean value and treats only null/undefined as absent", () => {
    expect(evaluateOperator("isNull", null, true)).toBe(true);
    expect(evaluateOperator("isNull", undefined, true)).toBe(true);
    expect(evaluateOperator("isNull", "", true)).toBe(false); // empty string is present
    expect(evaluateOperator("isNull", 0, true)).toBe(false);
    expect(evaluateOperator("isNull", null, false)).toBe(false);
    expect(evaluateOperator("isNull", "x", false)).toBe(true);
    expect(evaluateOperator("isNull", "x", "yes")).toBe(false); // non-boolean fails closed
  });

  it("unknown operator fails closed", () => {
    expect(evaluateOperator("regexp" as never, "x", "x")).toBe(false);
  });
});

describe("field-rule evaluator — combinations", () => {
  const data = { status: "draft", amount: 150, approver: null };

  it("empty or missing combination matches unconditionally", () => {
    expect(evaluateRuleCombination(combination([]), data)).toBe(true);
    expect(evaluateRuleCombination(null, data)).toBe(true);
    expect(evaluateRuleCombination(undefined, data)).toBe(true);
  });

  it("AND requires every condition", () => {
    expect(evaluateRuleCombination(combination([["status", "eq", "draft"], ["amount", "gt", 100]]), data)).toBe(true);
    expect(evaluateRuleCombination(combination([["status", "eq", "draft"], ["amount", "gt", 200]]), data)).toBe(false);
  });

  it("OR needs any condition", () => {
    expect(evaluateRuleCombination(combination([["status", "eq", "final"], ["amount", "gt", 100]], "OR"), data)).toBe(
      true,
    );
    expect(evaluateRuleCombination(combination([["status", "eq", "final"], ["amount", "gt", 900]], "OR"), data)).toBe(
      false,
    );
  });

  it("looks up nested fields by dot path", () => {
    expect(getField({ a: { b: { c: 7 } } }, "a.b.c")).toBe(7);
    expect(getField({ a: 1 }, "a.b.c")).toBeUndefined();
    expect(getField({}, "status")).toBeUndefined();
    expect(evaluateRuleCombination(combination([["meta.urgent", "eq", true]]), { meta: { urgent: true } })).toBe(true);
  });
});

describe("field-rule evaluator — state resolution", () => {
  const def = definition([
    // visible: status = 'final' OR amount > 100
    { field: "internalNote", ruleType: "visible", conditions: combination([["status", "eq", "final"], ["amount", "gt", 100]], "OR") },
    // readonly: status = 'final'
    { field: "internalNote", ruleType: "readonly", conditions: combination([["status", "eq", "final"]]) },
    // mandatory: amount > 100 AND status != 'final'
    { field: "reason", ruleType: "mandatory", conditions: combination([["amount", "gt", 100], ["status", "neq", "final"]]) },
  ]);

  it("fires only matching rules", () => {
    const state = resolveFieldState("internalNote", def, { status: "final", amount: 5 }, BASE);
    expect(state).toEqual({ mandatory: false, readonly: true, visible: true });
  });

  it("keeps base state when nothing matches", () => {
    const state = resolveFieldState("internalNote", def, { status: "draft", amount: 5 }, { ...BASE, visible: true });
    // visible rule does not match, base visible:true survives (rules only turn flags on)
    expect(state).toEqual({ mandatory: false, readonly: false, visible: true });
  });

  it("does not turn flags off", () => {
    const state = resolveFieldState("reason", def, { status: "draft", amount: 150 }, { ...BASE, readonly: true });
    expect(state.mandatory).toBe(true);
    expect(state.readonly).toBe(true);
  });

  it("handles null definition and unknown fields", () => {
    expect(resolveFieldState("x", null, {}, BASE)).toEqual(BASE);
    expect(resolveFieldState("unknown", def, { status: "final" }, BASE)).toEqual(BASE);
  });

  it("resolveFieldStates covers exactly the named fields", () => {
    const resolved = resolveFieldStates(def, { status: "draft", amount: 150 }, () => BASE);
    expect([...resolved.keys()].sort()).toEqual(["internalNote", "reason"]);
    expect(resolved.get("reason")).toEqual({ mandatory: true, readonly: false, visible: false });
    expect(resolved.get("internalNote")).toEqual({ mandatory: false, readonly: false, visible: true });
  });

  it("fieldsInDefinition is first-seen order, deduplicated", () => {
    expect(fieldsInDefinition(def)).toEqual(["internalNote", "reason"]);
    expect(fieldsInDefinition(null)).toEqual([]);
  });
});
