# ADR-0011: Customer Data Scope (new Data Scope dimension)

- **Status:** APPROVED for Checkpoint 1A
- **Date:** 2026-08-18
- **Source:** Phase 1 Founder instruction section 7 ("Customer Foundation"
  / "Customer-Service Context"), and the 1A E2E target's "Customer User
  Login -> Data Scope Applied" step

## Context

Phase 0's Data Scope (ADR-0009) has exactly two axes: `tenant` (whole
Tenant) and `organization_unit` (one Organization Unit and every
descendant, hierarchical). Both describe the INTERNAL organization
hierarchy — who inside the company can act on what.

Checkpoint 1A introduces a genuinely different actor: a Customer User —
someone outside the Tenant's own organization, logging in to see only
their own company's data (their own Complaints, Surveys, evidence). They
are not "inside" any Organization Unit at all; modeling their restriction
as an Organization Unit scope would be a category error, and a Customer
has no descendants for a hierarchical walk to make sense of.

Three options were considered:

1. **Bolt a `customer_id` column onto `users` directly**, checked ad hoc
   wherever Customer-scoped data is read. Rejected: this creates a SECOND,
   parallel authorization mechanism sitting outside `RbacService`/`Data
   Scope`, which is exactly the kind of drift ADR-0009's single-choke-point
   design was written to prevent. A future Internal PIC or Supervisor role
   that should ALSO be restricted to one Customer (not just one
   Organization Unit) would need its own bespoke check too.
2. **A generic "resource ACL" table** (arbitrary user-to-entity grants).
   Rejected as over-engineering for what 1A actually needs: a Customer
   User's access is always "this exact one Customer", never an arbitrary
   ad hoc set — a generic ACL model solves a more general problem than
   exists here, at real implementation cost.
3. **A third Data Scope type: `customer`, exact-match, on the existing
   `user_role_assignments` table.**

## Decision

Option 3. `user_role_assignments` gains `scope_customer_id uuid
REFERENCES customers`; `scope_type` now allows `'customer'` alongside the
existing `'tenant'`/`'organization_unit'`, with the same
one-column-required-per-type CHECK constraint pattern 0B established.

`RbacService.requireCustomerContextScope(userId, { customerId,
ownerOrganizationUnitId })` is the single choke point every
Customer-context module (Customer, Contract, Project, Site, Service
Assignment, and the Document Entity Authorization Resolver, ADR-0012)
calls through — covered if the actor holds a tenant-wide assignment, OR a
`customer` assignment whose `scopeCustomerId` matches exactly, OR an
`organization_unit` assignment covering the Customer's
`ownerOrganizationUnitId` (reusing ADR-0009's hierarchical ancestor walk
unchanged — a Regional Manager scoped to a Region automatically covers
every Customer owned by any Organization Unit under that Region, with
zero new code in `OrganizationUnitRepository`).

No hierarchy exists for the `customer` axis itself — a Customer has no
descendants, so this is exact-match, structurally identical to what 0B's
`organization_unit` scope originally was before ADR-0009 widened it.

`Customer.ownerOrganizationUnitId` is the field that lets the two axes
converge on one Customer: the INTERNAL team that owns a Customer
relationship is expressed the same way Phase 0 already expresses internal
ownership (an Organization Unit), while the EXTERNAL Customer User's own
restriction is the new axis. Neither axis needs to know about the other;
`requireCustomerContextScope` is where they meet.

## Consequences

- **Additive only.** No existing `user_role_assignments` row (`tenant`/
  `organization_unit`) is touched; the new column is nullable and the new
  CHECK constraint's `tenant`/`organization_unit` branches are byte-for-
  byte the same predicate 0B/0F already enforced. Verified: the full
  Phase 0 regression suite (45 tests) passes unmodified against this
  migration.
- **`UserService.createWithRole`** (0B) is the ONLY other place that had
  to change, and only additively — a third `else if` branch alongside the
  existing tenant/organization_unit branches, same "cannot grant a scope
  you do not yourself hold" principle (an actor creating a Customer User
  must itself pass `requireCustomerContextScope` against that Customer).
- **A Customer User needs no `document.*` permission** to use the
  Document Service against their own Customer — see ADR-0012, which this
  ADR's scope-resolution method backs directly.
- **Future Internal PIC / Supervisor-by-Customer roles** (mentioned in
  the Phase 1 instruction's Customer Foundation list) can reuse this same
  `customer` scope type immediately — no further schema change — the same
  reuse story ADR-0009's ancestor walk gave every subsequent Organization-
  Unit-scoped feature in 0D/0E/1A.
- **Listing endpoints** (`GET /customers`) remain Tenant-permission-gated
  only in 1A, not narrowed by Data Scope (documented explicitly in
  `CustomerService.listForTenant`) — the single-entity path
  (`getAuthorized`) is where Data Scope is actually enforced, and is the
  path every Customer-context read in 1A exercises. Narrowing the listing
  itself is a natural 1C follow-up once a curated Customer Portal role
  needs a filtered list rather than single-record access.
