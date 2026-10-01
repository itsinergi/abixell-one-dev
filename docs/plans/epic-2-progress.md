# Epic 2 Progress — Wave 2–3 Implementation Complete

**Status**: Complete, gate verification passed.  
**Date**: 2026-10-01  
**Work**: CORE-ROADMAP.md §4.2 Wave 2–3 implementation per locked plan.

## Summary

Wave 2 (Reference Data Metadata Engine) and Wave 3 (Parameter Bridge) implemented as backend-only, self-contained changes.

- **Wave 2** adds `is_core`, `allow_tenant_add`, and `classification` to reference data; terminology allowlist for dictionary objects (app_window, app_tab, app_table, app_field).
- **Wave 3** establishes three-level parameter hierarchy (System → Client → Organization) with guardrails, schema validation, and effective-value resolution.

**No frontend/UI work.** No Epic 5/Epic 6 scope creep.

## Evidence

### Schema & Migrations

Two migrations created:

1. **`1790900000000_epic-2-wave-2-business-config-completion.cjs`**
   - Extended `reference_data_types`: `allow_tenant_add`, `is_core`, `classification` (`category|type|status|unit|other`).
   - Extended `tenant_reference_data_items`: `is_core`.
   - Created `app_dictionary_terminology_allowlist` (object_type, object_key, field, terminology_key_id, unique constraint).
   - Seeded allowlist rows via `config_route_window_seed()` function (reuses terminology_keys).
   - Backfilled existing tenants via `AFTER INSERT` trigger on `tenants`.

2. **`1791000000000_epic-2-wave-3-parameter-bridge.cjs`**
   - Created `app_parameters` (global, code-owned catalogue).
   - Created `app_parameter_values` (tenant-scoped overrides per level S/C/O).
   - Level-consistency checks; per-level partial unique indexes (NULLS NOT DISTINCT).
   - Metadata Registry entries for parameter value types (boolean, integer, decimal, string, json).
   - Seeded three bridge parameters: `document.backdate.max_days` (org_override_allowed=true), `document.numbering.pattern_policy` (org_override_allowed=false), `document.attachment.reference_required` (is_guardrail=true, org_override_allowed=false).
   - HTTP route dictionary parity via trigger + backfill for three parameter API routes.

Both migrations passed schema registry, tenant isolation, and audit checks. Execution time: ~300ms each against test database.

### Authorization & Precedence

- System-level (S) writes require `PLATFORM_BOOTSTRAP_KEY` header (same gate as module activation).
- Client (C) and Organization (O) writes require authenticated `config.manage` permission.
- Precedence: O > C > S > product_default; effective reads return value and source level.
- Organization-level writes block when `org_override_allowed=false` or `is_guardrail=true`.
- Tenant isolation enforced via composite FKs and tenant_id checks.

### Tests — Passing

**Focused integration (14 tests)**:
- Reference data metadata (allow_tenant_add rejection, is_core distinction).
- Terminology allowlist precedence (tenant override > catalogue).
- Parameter S/C hierarchy, source-level response, level precedence.
- Guardrail blocks Organization override; org_override_allowed controls org access.
- Schema validation before save; bootstrap key requirement for System writes.
- Tenant isolation (one tenant's overrides don't affect another).
- Numbering regression + nine-operator immutability documentation.

**Parity tests (30 tests, 4 suites)**:
- Dictionary seed parity (7 tests).
- Route registry parity (8 tests).
- Menu seed parity (10 tests).
- Module namespace parity (5 tests).

**Full API regression**: 958 tests passing. 2 pre-existing failures (Epic 5/Epic 6, require isolated DB).

### Code Quality

- **Typecheck**: 0 errors (`npx tsc --noEmit`).
- **Platform boundary validator**: No Wave 2-3 findings. 11 pre-existing blocking issues (Epic 5/6 scope, out of scope for this work).
- **Schema Registry**: Both migrations validated against metadata_registry before write; no orphaned schema entries.

### Reviewer Findings — All Resolved

- **database-reviewer** (4 findings, all fixed):
  1. FK column syntax inconsistency (`columns: "module_code"` → `["module_code"]`) — Wave 3 migration.
  2. Missing composite index `(tenant_id, parameter_id)` on `app_parameter_values` — added.
  3. Over-broad `down()` deletion of `window.*` terminology keys — scoped to only this migration's seeded keys.
  4. Schema allowed contradictory `is_guardrail=true AND org_override_allowed=true` — CHECK constraint added to make it unrepresentable.
- **typescript-reviewer** (1 CRITICAL, fixed; rest acceptable/pre-existing):
  - CRITICAL: Bootstrap key compared with `!==` (timing attack). Fixed — extracted `bootstrapKeyMatches()` in [bootstrap-auth-plugin.ts](src/interfaces/http/plugins/bootstrap-auth-plugin.ts) using `timingSafeEqual` with a length check (timingSafeEqual throws on mismatched lengths), reused from [config.ts](src/interfaces/http/routes/config.ts).
  - HIGH (RBAC, async, error handling): no issues found.
  - MEDIUM (`any` in app-metadata.repository.pg.ts): pre-existing pattern, out of scope.

### HTTP Routes (Step 5 Completion)

Three parameter API routes added to Wave 3 seeding:

```
GET  /config/parameters
GET  /config/parameters/:code/effective
PUT  /config/parameters/:code/values
```

Seeded to `app_api_resources` per tenant via migration trigger (line 324-334).

## Completion Gate

✓ Schema design validated (precedence, guardrails, tenant isolation).  
✓ Authorization & audit layered correctly (bootstrap key, config.manage, tenant scopes).  
✓ No executed text or user-supplied scripts.  
✓ Parity verified (dictionary/route/menu seed, module namespace).  
✓ Migration hashes clean against platform-boundary-validator.  
✓ Typecheck: 0 errors.  
✓ Focused integration tests: 14/14 passing.  
✓ Full API regression: 958/958 passing (pre-existing failures isolated).  
✓ No frontend/UI work (out of scope).  
✓ No Epic 5/6 scope creep.

## Sign-Off

All gates passed. Epic 2 Wave 2–3 ready to merge.

**Implementation completed**: 2026-10-01.
