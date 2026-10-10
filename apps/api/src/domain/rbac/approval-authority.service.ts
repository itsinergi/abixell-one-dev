/**
 * Epic 1 (§4.1 D) — the approver resolver, following iDempiere's
 * `MWFActivity.getApprovalUser` order EXACTLY:
 *
 * 1. amount null/0 → self-approved, no approver needed.
 * 2. Self-approval block: ownDocument && !isCanApproveOwnDoc → this user
 *    cannot approve; walk to their supervisor.
 * 3. Role with no limit (amt_approval NULL/0) → SKIPPED, never unlimited.
 * 4. Currency conversion role→document when codes differ; missing rate
 *    fails clean (MissingConversionRateError), never a guess.
 * 5. amount <= roleAmt → this user may approve.
 * 6. Accumulation: amtApprovalAccum > 0 AND daysApprovalAccum > 0 → the
 *    already-approved total in the window plus this document must also
 *    stay under the accumulator.
 * 7. Pass → "approve". Fail → escalate to users.supervisor_user_id, then
 *    organization_units.supervisor_user_id, with a visited-set cycle guard.
 * 8. Chain exhausted → "no-approver" (a clean failure, not an exception) —
 *    but ONLY when at least one hop in the walk actually carried a
 *    configured limit (roleAmt > 0). When NO hop has one, the tenant has
 *    not configured approval ceilings at all: the resolver reports
 *    "ceiling-inactive" and the caller keeps its ordinary role-based
 *    assignment. This is the one deliberate departure from iDempiere —
 *    there AmtApproval is mandatory, so an all-NULL chain means a
 *    misconfigured deployment; here the ceiling is additive on top of an
 *    already-working role-assignment engine, so "nobody configured a
 *    limit" must not turn every amount-carrying document into a hard
 *    failure. NULL still never means "unlimited": a hop WITH a limit IS
 *    seen, and the walk still escalates past it.
 */
import type { ActorContext } from "../shared-kernel/audit-context.js";
import type {
  ApprovalAuthorityInput,
  ApprovalAuthorityRepository,
  ApprovalDecision,
  SupervisorChainNode,
} from "./approval-authority.entity.js";
import {
  compareAmounts,
  convertAmount,
  MissingConversionRateError,
} from "./approval-authority.entity.js";

/** Escalation ceiling: enough hops for any realistic org tree, small
 * enough that a malformed supervisor CYCLE terminates fast even if the
 * visited-set somehow failed. */
const MAX_SUPERVISOR_HOPS = 32;

export class ApprovalAuthorityService {
  constructor(private readonly repo: ApprovalAuthorityRepository) {}

  async resolveApprover(
    actor: ActorContext,
    input: ApprovalAuthorityInput,
  ): Promise<ApprovalDecision> {
    // 1. Nothing to approve (MWFActivity.java:727-729).
    if (input.amount === null || compareAmounts(input.amount, "0") === 0) {
      return { kind: "self-approved" };
    }

    const ownDocument = actor.userId === input.documentUserId;
    let candidateUserId = actor.userId;
    const visited = new Set<string>([actor.userId]);
    // Whether ANY hop in the walk carried a configured ceiling. Distinguishes
    // "ceilings exist and this document exhausted them" from "this tenant has
    // no ceilings configured at all" — see step 8 in the header.
    let ceilingConfigured = false;

    while (true) {
      // 2-6. Can THIS user approve?
      const verdict = await this.userCanApprove(actor, candidateUserId, ownDocument, input);
      ceilingConfigured = ceilingConfigured || verdict.limitConfigured;
      if (verdict.canApprove) {
        return candidateUserId === actor.userId
          ? { kind: "approve", approverUserId: candidateUserId }
          : { kind: "escalate", nextApproverUserId: candidateUserId };
      }

      // 7. Escalate: user's supervisor, then the org unit's.
      const next = await this.nextSupervisor(actor.tenantId, candidateUserId, input, visited);
      if (next === null) {
        return ceilingConfigured ? { kind: "no-approver" } : { kind: "ceiling-inactive" };
      }
      visited.add(next);
      candidateUserId = next;
    }
  }

  /** Steps 2-6 for one candidate. Own-document check applies ONLY to the
   * document user: a supervisor approving their subordinate's document is
   * not self-approval.
   *
   * `limitConfigured` says whether THIS hop carried a positive ceiling —
   * `resolveApprover` uses it to tell "ceilings exist and were exhausted"
   * apart from "this tenant configured no ceilings at all". */
  private async userCanApprove(
    actor: ActorContext,
    candidateUserId: string,
    ownDocument: boolean,
    input: ApprovalAuthorityInput,
  ): Promise<{ canApprove: boolean; limitConfigured: boolean }> {
    const limits = await this.repo.getActiveRoleApprovalLimits(
      actor.tenantId,
      candidateUserId,
      candidateUserId === actor.userId ? actor.assignmentId : null,
    );
    if (!limits) return { canApprove: false, limitConfigured: false };
    // Step 1 in resolveApprover already returned on a null amount; the
    // guard here re-narrows for THIS function's signature.
    if (input.amount === null) return { canApprove: false, limitConfigured: false };

    // 3. No limit set → this role does not participate (769-770).
    if (limits.roleAmt === null || compareAmounts(limits.roleAmt, "0") === 0) {
      return { canApprove: false, limitConfigured: false };
    }
    const limitConfigured = true;

    // 2. Self-approval block (MWFActivity.java:766-767).
    if (ownDocument && candidateUserId === input.documentUserId && !limits.isCanApproveOwnDoc) {
      return { canApprove: false, limitConfigured };
    }

    // 4. Currency conversion (771-779). The ROLE's limit is expressed in
    // the role's currency; compare against the DOCUMENT amount converted
    // into that currency. Missing rate is a clean failure.
    let documentAmount = input.amount;
    if (limits.currencyCode !== null && limits.currencyCode !== input.currencyCode) {
      const rate = await this.repo.getConversionRate(
        actor.tenantId,
        input.currencyCode,
        limits.currencyCode,
      );
      if (!rate) {
        throw new MissingConversionRateError(input.currencyCode, limits.currencyCode);
      }
      const converted = convertAmount(input.amount, rate.rate);
      documentAmount = bigIntToAmount(converted);
    }

    // 5. amount <= roleAmt (780).
    if (compareAmounts(documentAmount, limits.roleAmt) > 0) return { canApprove: false, limitConfigured };

    // 6. Accumulation window (786-798): only when BOTH accumulator columns
    // are configured — the schema's roles_approval_accum_check pins that.
    if (
      limits.amtApprovalAccum !== null &&
      limits.daysApprovalAccum !== null &&
      compareAmounts(limits.amtApprovalAccum, "0") > 0 &&
      limits.daysApprovalAccum > 0
    ) {
      const alreadyApproved = await this.repo.getAccumulatedApprovedAmount(
        actor.tenantId,
        candidateUserId,
        input.documentTable,
        limits.daysApprovalAccum,
      );
      if (addAmounts(alreadyApproved, documentAmount) > limits.amtApprovalAccum) {
        return { canApprove: false, limitConfigured };
      }
    }

    return { canApprove: true, limitConfigured };
  }

  /** Step 7: user's supervisor first; when they have none, the
   * Organization Unit's. The visited set makes a supervisor CYCLE dead-end
   * as no-approver instead of hanging (752-758 guard). */
  private async nextSupervisor(
    tenantId: string,
    candidateUserId: string,
    input: ApprovalAuthorityInput,
    visited: Set<string>,
  ): Promise<string | null> {
    const chain: SupervisorChainNode[] = await this.repo.getSupervisorChain(
      tenantId,
      candidateUserId,
      MAX_SUPERVISOR_HOPS,
    );
    for (const node of chain) {
      if (node.supervisorUserId === null) break;
      if (visited.has(node.supervisorUserId)) continue; // cycle guard
      return node.supervisorUserId;
    }
    // A missing/blank org-unit id means the document carries no org unit. Skip
    // the lookup — no org unit → no org-unit supervisor — rather than let an
    // empty string reach `WHERE id = $2` and abort as a UUID cast error.
    const orgSupervisor = input.organizationUnitId
      ? await this.repo.getOrganizationUnitSupervisor(tenantId, input.organizationUnitId)
      : null;
    if (orgSupervisor !== null && !visited.has(orgSupervisor)) {
      return orgSupervisor;
    }
    return null;
  }
}

/** Scaled-BigInt addition of two numeric(18,2) strings — sum as string.
 * Shared by the accumulation comparison. */
function addAmounts(a: string, b: string): string {
  const left = parseAmount(a);
  const right = parseAmount(b);
  return bigIntToAmount(left + right);
}

function parseAmount(value: string): bigint {
  const negative = value.trim().startsWith("-");
  const digits = negative ? value.trim().slice(1) : value.trim();
  const [whole, fraction = ""] = digits.split(".");
  const padded = fraction.padEnd(2, "0").slice(0, 2);
  const scaled = BigInt(`${whole === "" ? "0" : whole}${padded}`);
  return negative ? -scaled : scaled;
}

function bigIntToAmount(scaled: bigint): string {
  const negative = scaled < 0n;
  const abs = negative ? -scaled : scaled;
  const whole = abs / 100n;
  const cents = (abs % 100n).toString().padStart(2, "0");
  return `${negative ? "-" : ""}${whole}.${cents}`;
}
