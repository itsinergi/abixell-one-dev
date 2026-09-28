/**
 * Epic 1 (§4.1 D) — the approval-authority resolver as a pure decision unit.
 *
 * epic-1-security-context.test.ts proves the session/RBAC half through HTTP;
 * this file pins `resolveApprover` alone against a scripted repository, so
 * the §4.1 test cases 5–11 (self-approval, NULL-limit skip, currency
 * conversion, accumulation, supervisor escalation, cycle guard) are exercised
 * with exact inputs — including amounts a SQL fixture could not arrange
 * deterministically. The SQL side of the repository (the accumulation SUM,
 * the tenant pinning) is covered by the integration suite.
 */
import { describe, expect, it } from "vitest";
import { ApprovalAuthorityService } from "../src/domain/rbac/approval-authority.service.js";
import {
  compareAmounts,
  convertAmount,
  MissingConversionRateError,
  type ApprovalAuthorityInput,
  type ApprovalAuthorityRepository,
  type ConversionRateRow,
  type RoleApprovalLimits,
  type SupervisorChainNode,
} from "../src/domain/rbac/approval-authority.entity.js";
import type { ActorContext } from "../src/domain/shared-kernel/audit-context.js";

/** Scripted repository: fixed limits per user, one conversion rate table, a
 * supervisor map, and a recorded accumulation total. */
class ScriptedRepo implements ApprovalAuthorityRepository {
  limits = new Map<string, RoleApprovalLimits>();
  rates = new Map<string, ConversionRateRow>();
  supervisors = new Map<string, string | null>();
  accumulated: Record<string, string> = {};
  orgSupervisor: string | null = null;
  accumulationCalls: { userId: string; documentTable: string; days: number }[] = [];

  async getActiveRoleApprovalLimits(
    _tenantId: string,
    userId: string,
    _assignmentId: string | null,
  ): Promise<RoleApprovalLimits | null> {
    return this.limits.get(userId) ?? null;
  }

  async getSupervisorChain(
    _tenantId: string,
    userId: string,
    limit: number,
  ): Promise<SupervisorChainNode[]> {
    const chain: SupervisorChainNode[] = [];
    let current = userId;
    const seen = new Set<string>();
    while (current && !seen.has(current) && chain.length < limit) {
      seen.add(current);
      const supervisor = this.supervisors.get(current) ?? null;
      chain.push({ userId: current, supervisorUserId: supervisor });
      if (supervisor === null) break;
      current = supervisor;
    }
    return chain;
  }

  async getOrganizationUnitSupervisor(): Promise<string | null> {
    return this.orgSupervisor;
  }

  async getConversionRate(
    _tenantId: string,
    fromCode: string,
    toCode: string,
  ): Promise<ConversionRateRow | null> {
    return this.rates.get(`${fromCode}>${toCode}`) ?? null;
  }

  async getAccumulatedApprovedAmount(
    _tenantId: string,
    userId: string,
    documentTable: string,
    days: number,
  ): Promise<string> {
    this.accumulationCalls.push({ userId, documentTable, days });
    return this.accumulated[userId] ?? "0";
  }
}

const ACTOR: ActorContext = {
  userId: "00000000-0000-0000-0000-0000000000a1",
  tenantId: "00000000-0000-0000-0000-0000000000t1",
  sessionId: "00000000-0000-0000-0000-0000000000s1",
  assignmentId: "00000000-0000-0000-0000-0000000000n1",
  roleId: null,
  roleCode: null,
  scopeType: "tenant",
  scopeOrganizationUnitId: null,
  scopeCustomerId: null,
};

const SUBORDINATE = "00000000-0000-0000-0000-0000000000b2";
const SUPERVISOR = "00000000-0000-0000-0000-0000000000c3";
const ORG_SUPERVISOR = "00000000-0000-0000-0000-0000000000d4";
const NO_LIMIT_USER = "00000000-0000-0000-0000-0000000000e5";
const CAPPED_USER = "00000000-0000-0000-0000-0000000000f6";
const CURRENCY_USER = "00000000-0000-0000-0000-0000000000a7";

function input(overrides: Partial<ApprovalAuthorityInput> = {}): ApprovalAuthorityInput {
  return {
    documentUserId: ACTOR.userId,
    amount: "100.00",
    currencyCode: "IDR",
    organizationUnitId: "00000000-0000-0000-0000-0000000000u1",
    documentTable: "quotations",
    documentId: "00000000-0000-0000-0000-0000000000d0",
    ...overrides,
  };
}

function limits(overrides: Partial<RoleApprovalLimits> = {}): RoleApprovalLimits {
  return {
    roleAmt: "1000.00",
    amtApprovalAccum: null,
    daysApprovalAccum: null,
    currencyCode: null,
    isCanApproveOwnDoc: false,
    ...overrides,
  };
}

describe("ApprovalAuthorityService.resolveApprover (§4.1 cases 5–11)", () => {
  it("amount null or zero is self-approved, no approver needed", async () => {
    const repo = new ScriptedRepo();
    const service = new ApprovalAuthorityService(repo);
    expect((await service.resolveApprover(ACTOR, input({ amount: null }))).kind).toBe("self-approved");
    expect((await service.resolveApprover(ACTOR, input({ amount: "0.00" }))).kind).toBe(
      "self-approved",
    );
  });

  it("IsCanApproveOwnDoc=false blocks the document user, escalates to their supervisor", async () => {
    const repo = new ScriptedRepo();
    repo.limits.set(ACTOR.userId, limits({ isCanApproveOwnDoc: false }));
    repo.limits.set(SUPERVISOR, limits({ isCanApproveOwnDoc: false }));
    repo.supervisors.set(ACTOR.userId, SUPERVISOR);
    repo.supervisors.set(SUPERVISOR, null);

    const decision = await new ApprovalAuthorityService(repo).resolveApprover(ACTOR, input());
    expect(decision).toEqual({ kind: "escalate", nextApproverUserId: SUPERVISOR });
  });

  it("a supervisor approving a subordinate's document is NOT self-approval", async () => {
    const repo = new ScriptedRepo();
    // The ACTOR is the approver; the document belongs to SUBORDINATE. Even
    // with IsCanApproveOwnDoc=false on the actor's role, the document is not
    // theirs, so the block must not fire.
    repo.limits.set(ACTOR.userId, limits({ isCanApproveOwnDoc: false }));
    const decision = await new ApprovalAuthorityService(repo).resolveApprover(
      ACTOR,
      input({ documentUserId: SUBORDINATE }),
    );
    expect(decision).toEqual({ kind: "approve", approverUserId: ACTOR.userId });
  });

  it("IsCanApproveOwnDoc=true lets the document user approve their own document", async () => {
    const repo = new ScriptedRepo();
    repo.limits.set(ACTOR.userId, limits({ isCanApproveOwnDoc: true }));
    const decision = await new ApprovalAuthorityService(repo).resolveApprover(ACTOR, input());
    expect(decision).toEqual({ kind: "approve", approverUserId: ACTOR.userId });
  });

  it("an amount above AmtApproval escalates to the supervisor, not an error", async () => {
    const repo = new ScriptedRepo();
    repo.limits.set(ACTOR.userId, limits({ roleAmt: "99.99" }));
    repo.limits.set(SUPERVISOR, limits({ roleAmt: "500.00" }));
    repo.supervisors.set(ACTOR.userId, SUPERVISOR);
    repo.supervisors.set(SUPERVISOR, null);

    const decision = await new ApprovalAuthorityService(repo).resolveApprover(
      ACTOR,
      input({ amount: "100.00" }),
    );
    expect(decision).toEqual({ kind: "escalate", nextApproverUserId: SUPERVISOR });
  });

  it("a role with a NULL (or zero) limit is skipped, never treated as unlimited", async () => {
    const repo = new ScriptedRepo();
    repo.limits.set(ACTOR.userId, limits({ roleAmt: null }));
    repo.limits.set(SUPERVISOR, limits({ roleAmt: "0.00" }));
    repo.supervisors.set(ACTOR.userId, SUPERVISOR);
    repo.supervisors.set(SUPERVISOR, null);

    const decision = await new ApprovalAuthorityService(repo).resolveApprover(ACTOR, input());
    expect(decision).toEqual({ kind: "no-approver" });
  });

  it("no supervisor and no org-unit supervisor fails clean with no-approver", async () => {
    const repo = new ScriptedRepo();
    repo.limits.set(ACTOR.userId, limits({ roleAmt: "1.00" }));
    repo.supervisors.set(ACTOR.userId, null);
    repo.orgSupervisor = null;
    const decision = await new ApprovalAuthorityService(repo).resolveApprover(ACTOR, input());
    expect(decision).toEqual({ kind: "no-approver" });
  });

  it("falls back to the Organization Unit supervisor when the user has none", async () => {
    const repo = new ScriptedRepo();
    repo.limits.set(ACTOR.userId, limits({ roleAmt: "1.00" }));
    repo.limits.set(ORG_SUPERVISOR, limits());
    repo.supervisors.set(ACTOR.userId, null);
    repo.orgSupervisor = ORG_SUPERVISOR;
    const decision = await new ApprovalAuthorityService(repo).resolveApprover(ACTOR, input());
    expect(decision).toEqual({ kind: "escalate", nextApproverUserId: ORG_SUPERVISOR });
  });

  it("converts the document amount into the role currency before comparing", async () => {
    const repo = new ScriptedRepo();
    // Role limit 10 USD; document 150 000 IDR at 15 500 → ~9.68 USD — under.
    // The document belongs to SUBORDINATE so the self-approval block (the
    // default isCanApproveOwnDoc=false) does not decide this case.
    repo.limits.set(ACTOR.userId, limits({ roleAmt: "10.00", currencyCode: "USD" }));
    repo.rates.set("IDR>USD", { rate: "0.000065" });
    const under = await new ApprovalAuthorityService(repo).resolveApprover(
      ACTOR,
      input({ documentUserId: SUBORDINATE, amount: "150000.00", currencyCode: "IDR" }),
    );
    expect(under).toEqual({ kind: "approve", approverUserId: ACTOR.userId });

    // 160 000 IDR → ~10.40 USD — over the 10 USD limit, no supervisor →
    // clean no-approver.
    repo.supervisors.set(ACTOR.userId, null);
    const over = await new ApprovalAuthorityService(repo).resolveApprover(
      ACTOR,
      input({ documentUserId: SUBORDINATE, amount: "160000.00", currencyCode: "IDR" }),
    );
    expect(over).toEqual({ kind: "no-approver" });
  });

  it("throws MissingConversionRateError when no rate is in effect — never guesses", async () => {
    const repo = new ScriptedRepo();
    repo.limits.set(CURRENCY_USER, limits({ roleAmt: "10.00", currencyCode: "USD" }));
    await expect(
      new ApprovalAuthorityService(repo).resolveApprover(
        { ...ACTOR, userId: CURRENCY_USER },
        input({ currencyCode: "EUR" }),
      ),
    ).rejects.toBeInstanceOf(MissingConversionRateError);
  });

  it("accumulation: already-approved plus this document over the window escalates", async () => {
    const repo = new ScriptedRepo();
    repo.limits.set(CAPPED_USER, limits({
      roleAmt: "1000.00",
      amtApprovalAccum: "500.00",
      daysApprovalAccum: 7,
    }));
    repo.accumulated[CAPPED_USER] = "450.00";
    repo.supervisors.set(CAPPED_USER, null);
    repo.orgSupervisor = null;

    const decision = await new ApprovalAuthorityService(repo).resolveApprover(
      { ...ACTOR, userId: CAPPED_USER },
      input({ documentUserId: SUBORDINATE, amount: "100.00" }),
    );
    expect(decision).toEqual({ kind: "no-approver" });
    expect(repo.accumulationCalls).toEqual([
      { userId: CAPPED_USER, documentTable: "quotations", days: 7 },
    ]);
  });

  it("accumulation only applies when both accumulator columns are configured", async () => {
    const repo = new ScriptedRepo();
    // amtApprovalAccum set but days NULL — the window must not fire, so the
    // single-limit check decides alone.
    repo.limits.set(CAPPED_USER, limits({
      roleAmt: "1000.00",
      amtApprovalAccum: "500.00",
      daysApprovalAccum: null,
    }));
    repo.accumulated[CAPPED_USER] = "9999.00";
    const decision = await new ApprovalAuthorityService(repo).resolveApprover(
      { ...ACTOR, userId: CAPPED_USER },
      input({ documentUserId: SUBORDINATE, amount: "100.00" }),
    );
    expect(decision).toEqual({ kind: "approve", approverUserId: CAPPED_USER });
    expect(repo.accumulationCalls).toEqual([]);
  });

  it("a supervisor cycle dead-ends as no-approver instead of hanging", async () => {
    const repo = new ScriptedRepo();
    repo.limits.set(ACTOR.userId, limits({ roleAmt: "1.00" }));
    // ACTOR -> SUBORDINATE -> ACTOR (a cycle), every hop under the limit.
    repo.supervisors.set(ACTOR.userId, SUBORDINATE);
    repo.supervisors.set(SUBORDINATE, ACTOR.userId);
    repo.limits.set(SUBORDINATE, limits({ roleAmt: "1.00" }));
    repo.orgSupervisor = null;

    const decision = await new ApprovalAuthorityService(repo).resolveApprover(ACTOR, input());
    expect(decision).toEqual({ kind: "no-approver" });
  });
});

describe("money discipline (§4.1: scaled integers, never floats)", () => {
  it("compareAmounts orders plain, fractional and negative amounts exactly", () => {
    expect(compareAmounts("100.00", "100.00")).toBe(0);
    expect(compareAmounts("100.01", "100.00")).toBe(1);
    expect(compareAmounts("100.00", "100.01")).toBe(-1);
    expect(compareAmounts("-0.01", "0.00")).toBe(-1);
    // 18-digit whole parts compare as integers, not as float precision.
    expect(compareAmounts("999999999999999999.99", "1000000000000000000.00")).toBe(-1);
  });

  it("convertAmount truncates sub-cent noise, never rounds up", () => {
    // 100.00 * 0.000065 = 0.0065 — truncates to 0.00 (0 cents), not 0.01.
    expect(convertAmount("100.00", "0.000065")).toBe(0n);
    // 150000.00 * 0.000065 = 9.75 exactly.
    expect(convertAmount("150000.00", "0.000065")).toBe(975n);
    // 160000.00 * 0.000065 = 10.40 exactly.
    expect(convertAmount("160000.00", "0.000065")).toBe(1040n);
  });
});
