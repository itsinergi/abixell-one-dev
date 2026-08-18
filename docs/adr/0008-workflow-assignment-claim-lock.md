# ADR-0008: Opt-in, TTL-based Claim/Lock on Top of the Role+Scope Queue

- **Status:** APPROVED for Checkpoint 0E
- **Date:** 2026-08-18
- **Source:** Founder instruction for Checkpoint 0E ("evaluasi mekanisme
  claim/lock untuk role-queue tanpa merusak generic workflow design"),
  building on ADR-0007 (Checkpoint 0D)

## Context

ADR-0007 (0D) deliberately shipped a Role+Organization Unit "queue" model
for Workflow Assignment with **no** claim/lock mechanism: any user
holding the assigned Role in the assigned Data Scope can act on a
pending Assignment, first decision wins, a second actor gets a
`ConflictError` (not a silent double-decision). That ADR explicitly
flagged this as "a deliberate, documented simplification... revisit if a
real usage pattern demands one" — not an oversight.

For Checkpoint 0E the Founder asked to *evaluate* a claim/lock mechanism
for the role-queue, with one hard constraint: it must not break the
generic, entity-agnostic Workflow Engine design. Three options were
considered:

1. **Do nothing** (keep 0D's first-decision-wins model). Simplest, but
   offers no way for a reviewer to signal "I'm working on this" to
   teammates sharing the same queue — under real concurrent load, two
   reviewers could both open the same task and one's work is wasted the
   moment the other decides first.
2. **Hard, permanent lock**: the first actor to touch an Assignment
   exclusively owns it until they decide or an admin intervenes. Solves
   the wasted-work problem, but introduces a new failure mode: an actor
   who claims a task and then goes on leave, loses network connectivity,
   or simply forgets about it strands the task for everyone else, with
   no automatic recovery. This is a meaningfully worse Phase 0 default
   than no lock at all.
3. **Opt-in, TTL-based claim**: any eligible actor MAY claim a pending
   Assignment, reserving it for `CLAIM_TTL_SECONDS` (15 minutes). While
   the claim is fresh, other eligible actors are blocked from claiming
   *or acting*. The claim auto-expires — after the TTL, the Assignment
   reverts to exactly 0D's original first-decision-wins behavior, with
   no manual admin recovery step required. The claiming user (or anyone,
   in Phase 0 — see Consequences) can also release it early.

## Decision

Checkpoint 0E implements option 3. Two nullable columns were added to
the existing `workflow_instance_assignments` table —
`claimed_by_user_id`, `claimed_at` — via a purely additive migration
(`1755900000000_shared-services-foundation.cjs`). No existing column,
constraint, or Assignment-routing logic from 0D/ADR-0007 changed.

- `POST /workflow/assignments/:id/claim` — `WorkflowService.claimAssignment`
  first runs the exact same eligibility check `actOnAssignment` already
  used (`assertEligible`, extracted as a shared private method in this
  checkpoint so both call sites can never drift): a claim can never be
  taken by someone who couldn't act on the task anyway. Claiming itself
  is a single atomic `UPDATE ... WHERE status = 'pending' AND (claimed_by_user_id
  IS NULL OR claimed_by_user_id = $actor OR claimed_at < now() - TTL)
  RETURNING *` — two concurrent claim attempts can never both succeed;
  the loser gets a `ConflictError` (HTTP 409), not silent data loss.
- `POST /workflow/assignments/:id/release-claim` — releases early.
- `actOnAssignment` now additionally checks: if the Assignment is
  claimed by someone else AND the claim is still within its TTL, the
  actor is blocked with a `ConflictError`, even if they are otherwise
  eligible per ADR-0007. An expired or absent claim never blocks
  anyone — the atomic-UPDATE approach in `claimAssignment` and this
  TTL check in `actOnAssignment` are two independent, consistent reads
  of the same expiry rule, not a single shared lock primitive.

## Consequences

- **Non-breaking**: ADR-0007's Role+Scope queue routing, `assignedRoleCode`/
  `assignedOrganizationUnitId`/`assignedUserId` resolution, and the
  underlying "any eligible holder can act" model are completely
  unchanged. A claim is a courtesy reservation layered on top, not a
  redesign — an Assignment that nobody ever claims behaves identically
  to 0D.
- **No manual release enforcement in Phase 0**: `release-claim` only
  checks the caller currently holds the claim (`claimed_by_user_id =
  actor`), which is intentionally permissive — there is no "admin force
  release" endpoint yet, because the TTL already provides automatic
  recovery within 15 minutes. Adding a forced-release/admin-override
  endpoint later is additive, not a redesign.
- **Fixed 15-minute TTL, not yet Tenant Configuration**: `CLAIM_TTL_SECONDS`
  is a code constant (`workflow.service.ts`). A real deployment may want
  this configurable per Tenant or per Step (a fast-turnaround queue vs. a
  multi-day review queue have very different "still actively working on
  it" windows) — deferred exactly like 0C's numbering-pattern precedent:
  ship the mechanism now, make it Tenant Configuration when a real usage
  pattern demands it.
- **No "claimed by me" filter on `/workflow/my-assignments` yet** — the
  frontend surfaces `claimedByUserId` on each Assignment (a "claimed"
  badge) so a user can see contention, but does not yet let someone
  filter to "only what I've claimed". Cosmetic gap, not a data-model
  gap — the field is already there.
- Proven end-to-end in `tests/integration/shared-services.test.ts`:
  atomic claim, idempotent re-claim by the same user, a second eligible
  user blocked from both claiming and acting, release, release-without-
  a-claim correctly rejected, and a different eligible user succeeding
  immediately after release.
