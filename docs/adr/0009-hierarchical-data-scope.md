# ADR-0009: Hierarchical Data Scope (Supersedes ADR-0005)

- **Status:** APPROVED for Checkpoint 0F
- **Date:** 2026-08-18
- **Source:** Founder instruction for Checkpoint 0F ("hierarchical Data
  Scope"), resolving the open item ADR-0005 (Checkpoint 0B) deliberately
  left unaddressed

## Context

ADR-0005 (0B) shipped Data Scope as exact-match only: an assignment on
Organization Unit X authorizes actions on X, and nowhere else — an
assignment on a parent unit ("Region") did NOT automatically cover its
children ("Site A", "Site B" under that Region). This was documented as
an intentional, non-silent simplification, flagged in every checkpoint's
Risk Note since 0B: "wajib dibaca sebelum membangun modul yang bergantung
pada scope hierarkis (Complaint/Survey pilot)".

Phase 0 is ending and Complaint/Survey (Phase 1) will need exactly this:
a Regional Manager role scoped to a Region must be able to see and act on
every Site beneath it without a separate assignment row per Site — the
generic organization hierarchy (`Tenant -> Legal Entity -> Organization
Unit -> ... -> Site`) that has existed since 0B is meaningless for
authorization purposes without this.

## Decision

A Data Scope assignment on Organization Unit X now covers X **and every
descendant of X**, computed by walking `organization_units.parent_id`.
Implemented as an ancestor lookup rather than a descendant lookup — for
a given target unit T, compute `listAncestorIds(T)` (T itself plus every
ancestor up to the root) and check whether any of the actor's Data Scope
assignments land on one of those ids. This direction was chosen over
enumerating descendants because the check always starts from a single
concrete target (the resource being accessed), and an ancestor chain is
bounded by tree depth (small, cheap `WITH RECURSIVE` upward), whereas a
descendant enumeration from an arbitrary root could be large.

Three call sites all now go through this same rule, so it can never
drift between them:

1. `RbacService.requireOrganizationUnitScope` — the single-target
   permission gate used by most mutating routes (e.g. creating a child
   Organization Unit).
2. `RbacService.hasRoleCoveringScope` — the Role+Scope "queue" match used
   by the Workflow Engine (ADR-0007) to decide whether an actor may act
   on / claim a role-routed Assignment, and by the Notification Engine
   to resolve who is in a role+scope queue
   (`RbacRepository.listUserIdsWithRoleInScope`).
3. `OrganizationUnitService.listForTenant` — the listing endpoint, so a
   Regional Manager's Organization Unit list now includes every Site
   under their Region, not just the Region itself. Implemented as an
   in-memory ancestor walk against the tenant's already-fetched unit
   list (no extra SQL round-trip needed there).

No existing schema changed — `organization_units.parent_id` has existed
since 0B; this is purely a change in how the existing column is
interpreted for authorization, the same posture as ADR-0008's claim/lock
(additive, non-breaking).

## Consequences

- **Widens access, never narrows it.** Every existing exact-match
  authorization decision still holds (X still covers X); the change only
  adds coverage for X's descendants. This is why re-running the full 0A-0E
  regression suite (40 tests, unrelated to this ADR) required zero test
  changes — the change is additive by construction, not just by
  intention.
- **A "sibling" scope still isolates correctly.** Two Organization Units
  that are not in an ancestor/descendant relationship (e.g. two Sites
  under different Regions) remain mutually isolated — hierarchy only
  flows down a single branch of the tree, never across branches.
- **Deep trees mean deeper ancestor walks**, but Organization Unit
  hierarchies are operational structures (Tenant → Legal Entity → Region
  → Site, typically 3-5 levels), not unbounded data — the recursive CTE
  cost is negligible at that depth.
- **This was the last item ADR-0005 explicitly left open.** ADR-0005
  itself is now marked Superseded rather than deleted, per the project's
  practice of keeping a decision's full history rather than rewriting it.
