# ADR-0013: Generic Customer Complaint Engine — Workflow Reuse, Reopen, SLA Scoping, Trusted-Caller Numbering

- **Status:** APPROVED for Checkpoint 1B
- **Date:** 2026-08-18
- **Source:** Explicit Phase 1 Founder instruction for Checkpoint 1B:
  "Workflow tidak boleh hardcoded di Complaint Service; gunakan generic
  Workflow Engine Phase 0. Category, Priority, Severity, SLA, Assignment
  Rule, Numbering, dan Notification Template harus configurable."

## Context

Checkpoint 1B needed a full Complaint lifecycle (Draft -> Submitted ->
Acknowledged -> Assigned -> In Investigation -> Corrective Action ->
Verification -> Customer Confirmation -> Closed, plus Reject/Cancel/
Reopen/Escalate) without duplicating any state-machine logic the generic
Workflow & Approval Engine (Checkpoint 0D/0E) already provides. Three
concrete gaps stood in the way of pure reuse:

1. **Reopen.** `WorkflowService.actOnAssignment` requires a PENDING
   Assignment; a terminal (Closed/Rejected/Cancelled) Instance has none.
   "Reopen" cannot be an ordinary Transition targeting a terminal Step,
   because nothing would ever be assigned to act on it.
2. **Complaint visibility vs. Workflow eligibility.** Customer Data Scope
   (ADR-0011) answers "can this actor see this Customer's business
   records", but an internal investigator's Role+Organization-Unit
   Assignment routing (ADR-0009) is a genuinely separate axis — a
   centralized investigation team serving every Customer would never be
   reachable through Customer Data Scope alone.
3. **Numbering for a Customer User.** `ConfigurationService.generateNumber`
   required `config.manage`, a Tenant Administration permission wildly
   inappropriate to grant a Customer User just so they can submit a
   Complaint.

## Decision

**(a) Two small, entity-agnostic extensions to `WorkflowService`, not a
parallel Complaint state machine.**

- `reopenInstance(actor, instanceId, { toStepCode, comment })` — resets a
  completed Instance to a chosen non-terminal Step, creates a fresh
  Assignment via the Step's normal Assignment Rules, publishes
  `workflow.reopened`, records History/Audit. Takes no permission check of
  its own — it is a trusted-caller method: the calling module (Complaint
  Service) has already run its own domain-appropriate authorization
  (`complaint.manage` + Customer Data Scope + "must actually be closed")
  before calling it. Nothing about it references Complaint; any future
  entityType gets Reopen for free.
- `isActorAssociatedWithInstance(actor, instanceId): Promise<boolean>` —
  true if the actor started the Instance or is/was assigned to it (role+
  scope eligible, or a matching `specific_user` Assignment, regardless of
  status). Generic — no entityType branching.

**(b) `ComplaintService.getAuthorized` combines three checks with OR, not
just Customer Data Scope**: Customer Data Scope (via
`CustomerService.canAccessForDocument`) OR submitter match OR
`isActorAssociatedWithInstance`. This is deliberately a BROADER
"visibility" gate than "can act right now" — `WorkflowService.
actOnAssignment`'s own `assertEligible` remains the precise, unchanged
gate for whether a specific action is currently allowed. Visibility and
eligibility are different questions and are answered by different code,
on purpose.

**(c) `getInstanceForEntityOwner(tenantId, id)`** — a read-only,
trusted-caller variant of `WorkflowService.getInstance` with no
`workflow.instance.read` permission check. `ComplaintService.get`/`act`/
`reopen` use this instead of the permission-gated method specifically so
that NEITHER `CUSTOMER_USER` NOR the internal `COMPLAINT_HANDLER`/
`COMPLAINT_MANAGER` roles need to hold `workflow.instance.read` — a
Tenant-wide "read every Workflow Instance in the tenant" permission —
just to work their own Complaints. See Consequences for the residual risk
this leaves.

**(d) `ConfigurationService.generateNumberForTenant(tenantId, code,
actorUserId)`** — the same trusted-caller pattern as (c), extracted from
`generateNumber` (which still requires `config.manage` for direct
Tenant-Admin callers). `ComplaintService.create` calls the trusted-caller
variant so a Customer User never needs `config.manage` just to get a
Complaint Number.

**(e) SLA stays exactly `WorkflowStep.slaHours`** (the existing 0D/0E
per-Step mechanism), not a new multi-dimensional Customer x Contract x
Service x Category x Priority x Severity SLA matrix. This is a
deliberate, proportional simplification for Checkpoint 1B — every Step in
the demo `complaint_lifecycle` Workflow Definition can carry its own
`slaHours` today (e.g. Submitted=4h, Assigned=8h, In Investigation=48h),
and because the Workflow Definition itself is 100% Tenant Configuration,
a Tenant that genuinely needs SLA to vary by Customer/Contract/Category
could already express that as multiple Workflow Definitions selected by a
future routing rule — but building that selection mechanism now would be
speculative generality ahead of a real, approved Business Discovery
requirement. Logged as a Technical Debt item, not silently decided.

**(f) `complaint` Entity Authorization Resolver** — same ADR-0012 pattern
as `customer`: `resolvers.set("complaint", { canAccess: (actor, id) =>
complaint.canAccessForDocument(actor, id) })`, itself just
`getAuthorized` wrapped in a boolean try/catch. Evidence/attachment
uploads against `entityType='complaint'` require NO separate
`document.*`/`complaint.*` permission — the resolver's Data-Scope-plus-
association check is the sole gate, identical in spirit to Customer's
attachments.

## Consequences

- **Zero new state-machine code in `ComplaintService`.** Every Step/
  Transition/Assignment Rule/Escalation Rule/SLA hour for the demo
  `complaint_lifecycle` Workflow Definition is ordinary Tenant
  Configuration data, created through the exact same `/workflow/
  definitions/...` admin API the 0D demo workflow uses. `ComplaintService`
  only ever references the Definition CODE and forwards `actionCode`
  verbatim to `WorkflowService.actOnAssignment` — an invalid transition is
  rejected by the Workflow Engine's own Transition lookup
  (`ValidationError`, HTTP 400), never by anything Complaint-specific.
- **Residual risk, explicitly accepted, not silently left**: any internal
  role that DOES hold `workflow.instance.read` (any Phase-0-era role, or a
  future misconfiguration) can still browse every raw `/workflow/
  instances/...` Workflow Instance in the tenant, including Complaint
  ones, via the generic Workflow routes — this is a pre-existing
  characteristic of the generic engine, not newly introduced by 1B. The
  mitigation this checkpoint provides is narrower: neither `CUSTOMER_USER`
  nor `COMPLAINT_HANDLER`/`COMPLAINT_MANAGER` are GRANTED that permission
  in the demo seed, and `ComplaintService` itself never requires it.
  Logged in the Technical Debt Register.
- **`reopenInstance`/`isActorAssociatedWithInstance`/
  `getInstanceForEntityOwner` are reusable by any future entityType**
  (Survey, 1C+) with zero additional Workflow Engine changes — proven by
  construction, since none of the three references `complaint` or
  `entityType` at all.
- **SLA-per-Step is a scoped decision**, not a limitation discovered by
  accident — documented here so a future checkpoint doesn't need to
  rediscover why a matrix wasn't built now.
