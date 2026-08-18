# ADR-0006: Configuration Scope Precedence Model & Partial Unique Index Pattern

- **Status:** APPROVED for Checkpoint 0C
- **Date:** 2026-08-18
- **Source:** `05-Configuration-Metadata-Engine.md`

## Context

`05-Configuration-Metadata-Engine.md` requires that Tenant Configuration
(demonstrated on Feature Flags in Checkpoint 0C) resolve with a
precedence order: an Organization Unit-level override beats a Tenant-level
override, which beats the Product Core catalog default. A single row per
`(tenant_id, feature_flag_id)` cannot represent this, because the same
flag needs both a tenant-wide value AND zero-or-more Organization Unit
overrides simultaneously.

A second, related problem: Checkpoint 0B already hit a bug class where a
plain `UNIQUE(tenant_id, feature_flag_id, scope_organization_unit_id)`
constraint fails to prevent duplicate tenant-scope rows, because in
standard SQL `NULL` is never equal to `NULL` — two rows with
`scope_organization_unit_id = NULL` do not violate a unique constraint
that includes that column.

## Decision

1. `tenant_feature_flags` stores one row per scope assignment
   (`scope_type` = `'tenant'` or `'organization_unit'`, with
   `scope_organization_unit_id` set only for the latter), not one row per
   flag.
2. Two **partial unique indexes** enforce "at most one row per scope",
   instead of one plain unique constraint:
   - `tenant_feature_flags_tenant_scope_unique` — unique on
     `(tenant_id, feature_flag_id) WHERE scope_type = 'tenant'`
   - `tenant_feature_flags_org_unit_scope_unique` — unique on
     `(tenant_id, feature_flag_id, scope_organization_unit_id) WHERE
     scope_type = 'organization_unit'`
3. Resolution (`ConfigurationService.resolveEffectiveFeatureFlags`) reads
   all rows for the tenant + all flags, then for each flag picks, in
   order: an `organization_unit` row matching the requested unit → a
   `tenant` row → the catalog default from `feature_flags.default_enabled`
   — and reports which one won as `source` in the response, so the
   precedence is independently verifiable by the caller, not just trusted.
4. `PgConfigurationRepository.upsertFeatureFlagAssignment` builds its
   `ON CONFLICT` target dynamically based on `scope.type`, targeting the
   matching partial index by name.

## Consequences

- This pattern (partial unique index per exclusive scope value) is now the
  house pattern for "at most one row per scope, where scope may or may not
  include an Organization Unit" — should be reused, not reinvented, for
  Terminology overrides and any future scoped-configuration table if
  Organization Unit-level Terminology overrides are ever requested (0C
  ships Terminology as tenant-only scope; see Known Limitations in the
  Checkpoint 0C implementation notes).
- Resolution is O(number of flags) per request, no caching layer yet —
  acceptable at Phase 0 scale, flagged as a future optimization point only
  if benchmarking shows it matters (same trade-off philosophy as ADR-0005
  for permissions).
- Nothing about this pattern is Product-Core-specific — Tenant Configuration
  Store rows are 100% tenant-created; the catalog default and the JSON
  Schema that validates any given key remain the only Product-Core-owned
  pieces, per `05-Configuration-Metadata-Engine.md`'s layering.
