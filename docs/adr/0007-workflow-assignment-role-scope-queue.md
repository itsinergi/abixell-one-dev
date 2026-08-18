# ADR-0007: Workflow Assignment Routes to a Role+Scope Queue, Not a Pre-Picked User

- **Status:** APPROVED for Checkpoint 0D
- **Date:** 2026-08-18
- **Source:** `04-Workflow-Approval-Engine-Foundation.md`

## Context

Doc 04 describes Assignment as "penentuan siapa/role apa yang menerima
tugas di suatu step, berdasar Data Scope" — routing can target either a
specific person or, more commonly in the illustrative examples ("Assign
ke: Site Supervisor"), a role within an organizational scope. When a
Workflow Instance reaches a Step, the engine has to decide who is allowed
to act on it.

Two designs were possible:
1. **Pre-pick one user** at assignment time (e.g. round-robin, least-busy,
   or "the first user found holding that role in that scope") and route
   the task to them specifically.
2. **Route to a Role+Organization Unit "queue"**: the task is assigned to
   `(role_code, organization_unit_id | null-for-tenant-wide)`, and ANY
   user who currently holds that role within that scope is authorized to
   act on it — same shape as a real approval inbox shared by a team.

## Decision

Checkpoint 0D implements design 2 for `assignment_type = 'role'`
Assignments. `workflow_instance_assignments` stores
`assigned_role_code` + `assigned_organization_unit_id` (nullable =
tenant-wide), not a specific `assigned_user_id`. Authorization to act
(`WorkflowService.actOnAssignment` / `RbacService.hasRoleCoveringScope`)
checks whether the acting user currently holds an assignment with that
Role and a Data Scope that covers the target — the exact same Role +
Data Scope model Checkpoint 0B already built for the rest of the
platform (ADR-0005's exact-match semantics apply here too: a
tenant-wide Role holder can act on a scoped task, but not vice versa).

A second `assignment_type = 'specific_user'` exists alongside this for
the cases doc 04 also describes (delegation, "assign back to the
submitter" for a Return/Revise step) where a named individual, not a
role, is the correct target — demonstrated by the demo workflow's REVISE
step, which is assigned to whoever started the Instance.

## Consequences

- No round-robin, load-balancing, or "claim this task" locking exists in
  Phase 0 — every eligible role holder can act on a pending role-scoped
  Assignment at any time; the first decision wins (the Assignment's
  `status` flips away from `pending`, so a second actor gets a
  `ConflictError`, not a silent double-decision). This is a deliberate,
  documented simplification, not an oversight — introducing a
  claim/lock mechanism before a real usage pattern demands one would be
  premature per anti-overengineering guidance.
- `GET /workflow/my-assignments` ("My Tasks") has to compute this
  role+scope match per pending Assignment rather than a simple `WHERE
  assigned_user_id = $1` — acceptable at Phase 0 scale (same trade-off
  philosophy as Configuration Scope resolution in ADR-0006 and 0C's
  decision log), revisit with caching/materialization only if a real
  tenant's inbox size makes it measurably slow.
- Nothing about the schema needs to change if load-balancing or explicit
  claiming is added later — it's new logic layered on top of the same
  `workflow_instance_assignments` shape, not a redesign.
