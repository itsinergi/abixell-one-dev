# ADR-0005: Data Scope in Checkpoint 0B is Exact-Match Only (Not Descendant-Aware)

- **Status:** APPROVED for Checkpoint 0B, EXPECTED TO CHANGE in a later checkpoint
- **Date:** 2026-08-18
- **Source:** `01-Tenant-Legal-Entity-Organization-Model.md`,
  `02-Identity-Security-RBAC-Foundation.md`

## Context

`02-Identity-Security-RBAC-Foundation.md` describes Data Scope as being
determined by "posisi pengguna dalam hierarchy Tenant → Legal Entity →
Organization Unit → Project → Site/Location" — the illustrative example
given is a Regional Manager who can see every Site under their
Organization Unit, i.e. scope is meant to be descendant-aware over the
recursive Organization Unit tree.

## Decision

Checkpoint 0B implements only two Data Scope shapes:

1. `tenant` — the whole Tenant (unrestricted within it).
2. `organization_unit` — **exactly** one Organization Unit, matched by ID.
   A user scoped to a parent unit does **not** automatically see its
   children.

This is a deliberate scope reduction to keep the first vertical slice
provable in a reasonable timeframe, not an oversight. It still proves real
backend enforcement (Supervisor scoped to Site A cannot see or act on
anything outside Site A) — it just doesn't yet prove the recursive/
hierarchical part of the model.

## Consequences

- A future checkpoint must extend `RbacService.requireOrganizationUnitScope`
  and `OrganizationUnitService.listForTenant`'s scope filter to walk the
  `parent_id` chain (or a materialized path / `ltree` column) so a
  tenant-wide or Organization-Unit-wide assignment covers descendants, per
  the original blueprint intent. This is tracked as an open gap in
  `docs/decision-log.md`, not silently forgotten.
- No data model change is required to add this later — `parent_id` already
  exists on `organization_units` and can support a recursive CTE
  (`WITH RECURSIVE`) or, if performance requires it, a materialized path
  column added via a new migration.
- Nothing built on top of the exact-match assumption needs to be
  redesigned when this changes — it's a query change inside
  `RbacService`/`OrganizationUnitService`, not an API or schema break.
