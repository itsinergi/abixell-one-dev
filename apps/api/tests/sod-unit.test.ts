/**
 * WP-APR-03 — SoD domain unit tests.
 *
 * `canonicalPair` and `violatesPair` are the pure decision core the SoD
 * survey and the rule CRUD rely on. The DB trigger (migration
 * 1793000000010) is the hard enforcement; these functions pin the ordering
 * invariant and the pair-matching logic so the trigger's canonicalization
 * and the service's survey agree on what a "match" is.
 */
import { describe, expect, it } from "vitest";
import {
  canonicalPair,
  violatesPair,
  type SodForbiddenRule,
} from "../src/domain/rbac/sod.entity.js";

function rule(a: string, b: string): Pick<SodForbiddenRule, "roleCodeA" | "roleCodeB"> {
  return { roleCodeA: a, roleCodeB: b };
}

describe("WP-APR-03 — canonicalPair", () => {
  it("orders two codes alphabetically (a < b)", () => {
    expect(canonicalPair("AP_CLERK", "AP_MANAGER")).toEqual(["AP_CLERK", "AP_MANAGER"]);
  });

  it("swaps when the first argument sorts after the second", () => {
    expect(canonicalPair("AP_MANAGER", "AP_CLERK")).toEqual(["AP_CLERK", "AP_MANAGER"]);
  });

  it("returns equal codes unchanged", () => {
    expect(canonicalPair("AP_CLERK", "AP_CLERK")).toEqual(["AP_CLERK", "AP_CLERK"]);
  });
});

describe("WP-APR-03 — violatesPair", () => {
  const rules = [rule("AP_CLERK", "AP_MANAGER"), rule("PURCHASER", "AP_APPROVER")];

  it("matches a pair in the stored order", () => {
    expect(violatesPair(rules, "AP_CLERK", "AP_MANAGER")).toBe(true);
  });

  it("matches the same pair in reverse order (canonical covers both)", () => {
    expect(violatesPair(rules, "AP_MANAGER", "AP_CLERK")).toBe(true);
  });

  it("matches the second rule in reverse order", () => {
    expect(violatesPair(rules, "AP_APPROVER", "PURCHASER")).toBe(true);
  });

  it("does not match an unrelated pair", () => {
    expect(violatesPair(rules, "AP_CLERK", "PURCHASER")).toBe(false);
  });

  it("does not match against an empty rule set", () => {
    expect(violatesPair([], "AP_CLERK", "AP_MANAGER")).toBe(false);
  });

  it("treats a pair not in the rules as non-violating", () => {
    expect(violatesPair(rules, "AUDITOR", "AP_CLERK")).toBe(false);
  });
});
