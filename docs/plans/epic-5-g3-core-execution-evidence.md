# Epic 5 G3 — Legal Entity scope core: execution evidence

Task: `t_2b80c5e2` — *Implement legal_entity scope schema, session context, authz
view, RbacService* (Wave 3 core, §4.5 steps 14–15).

Contract: `docs/plans/CORE-ROADMAP.md` §4.5 "F. Legal Entity Data Scope" and the
G0 contract `docs/plans/epic-5-g0-contract.md` migrations **M10** (1789400000000),
**M11** (1789410000000), **M12** (1789420000000).
Sibling cards own the rest of the wave: `t_c1ac4c45` (resource inventory),
`t_e1a1984c` (per-resource enforcement + inactive/deleted guards),
`t_2c9be72b` (cross-tenant/cross-assignment suite), `t_eca4ca7a` (security
review), `t_0f944c3c` (assignment UI). This document covers only the core.

## 1. What landed

| File | Change |
|---|---|
| `apps/api/migrations/1789400000000_epic-5-g3-legal-entity-scope.cjs` | M10: `scope_legal_entity_id`, one four-family consistency CHECK, partial scope index, `legal_entity` branch in the write-time scope-invalidation guard |
| `apps/api/migrations/1789410000000_epic-5-g3-session-legal-entity-scope.cjs` | M11: `sessions.scope_legal_entity_id` + backfill from the session's active assignment |
| `apps/api/migrations/1789420000000_epic-5-g3-authorization-effective-view.cjs` | M12: `authorization_effective_user_role_assignments` rebuilt with the Legal Entity join, branch and column |
| `apps/api/src/domain/shared-kernel/audit-context.ts` | `ActorContext.scopeLegalEntityId`, `DataScope` gains `{ type: "legal_entity" }` |
| `apps/api/src/domain/rbac/rbac.entity.ts` | `ScopeType`, `GovernedRoleAssignmentInput` LE variant, projections, `AssignmentOptions.legalEntities`, `listOrganizationUnitIdsForLegalEntity` |
| `apps/api/src/domain/rbac/visibility-scope.ts` | pair summary + preview hash cover the LE family |
| `apps/api/src/application/identity/session.service.ts` | active-scope resolution and the session mirror column (create/switch) |
| `apps/api/src/application/rbac/rbac.service.ts` | coverage chain (tenant → LE → OU), LE-scoped permission entry points, LE branches in customer-context coverage |
| `apps/api/src/infrastructure/persistence/repositories/governed-transaction.ts` | R10: the write gate accepts an OU **or** an LE target, resolving the OU→LE link in-query |
| `apps/api/src/infrastructure/persistence/repositories/rbac.repository.pg.ts` | governed grant/preview/confirm/create-user paths, anchor and visibility logic, projections, LE-aware admin list narrowing, queue/capability reads |
| `apps/api/src/domain/configuration/menu-filter.ts` | `legal_entity` counts as an INTERNAL scope (it was missing, which would have shown an LE-scoped internal user the external shell) |
| `apps/api/src/interfaces/http/routes/{admin-console,auth}.ts` | governed body vocabulary + `/me` scope name + switch-role payload |
| `apps/web/src/{lib/api.ts,lib/capabilities.ts,pages/admin/console/AdminAssignmentControls.tsx}` | the browser mirror of the same two unions (no UI control for the new scope — that is `t_0f944c3c`) |
| `apps/api/tests/integration/epic-5-g3-legal-entity-scope.test.ts` | 13 new integration tests (schema, projection, session, A5–A8, R10, HTTP) |
| `apps/api/tests/integration/admin-access-management.test.ts` | 8 expectation objects gained the two new projection fields (shape assertions, not behaviour) |

## 2. Deliberate deviations from the contract text

1. **One combined scope CHECK, not a fourth disjoint one.** M10 drops
   `user_role_assignments_scope_type_check` and
   `user_role_assignments_scope_org_unit_required_check` and installs
   `user_role_assignments_scope_consistency_check` stating all four families.
   A pre-flight `DO` block refuses to install over any existing row that does
   not already satisfy the widened rule (verified: 0 offending rows, fresh DB).
2. **`ON DELETE CASCADE`, not `SET NULL`.** The contract is internally
   inconsistent: `SET NULL` would leave `scope_type='legal_entity'` with a NULL
   target, which the CHECK added by the same migration rejects — so a Legal
   Entity delete would fail with a raw 23514. `CASCADE` is what
   `scope_customer_id` already uses (1757000000000:196) and what keeps
   `DELETE FROM tenants` working.
3. **Ownership validated by the existing write-time guard, not a composite FK.**
   A composite FK would need a `tenant_id` column on `user_role_assignments`,
   which the table deliberately lacks (tenancy is inherited through `users`).
   M10 extends `enforce_role_assignment_scope_invalidation()` with the
   `legal_entity` branch instead, so a cross-Tenant or deleted target lands
   `scope_invalidated_at` (monotonic, grants nothing) exactly as it already does
   for `organization_unit` and `customer`. That is G0 R4/Q1's "trigger-based
   validation" option.
4. **The replaced guard body is 1788200000000's, not 1775000000000's.** The
   later body carries Wave 3's revocation monotonicity rules. Replacing the
   function with the earlier body removed them; the revocation suite's
   "an UPDATE cannot clear or rewrite its provenance" case caught it, and the
   shipped body is the 1788200000000 one plus the LE branch.
5. **The projection requires the Legal Entity to be `is_active`.** A deactivated
   Legal Entity authorizes nothing. `is_active` is the column G1 pins to
   `status` with a CHECK and a sync trigger. The `organization_unit` branch was
   deliberately left exactly as shipped (`deleted_at IS NULL`, no lifecycle
   filter) — tightening it changes live authorization for a different family
   and belongs to `t_e1a1984c`, which owns the inactive/deleted guards for both
   families. This asymmetry is stated in the migration header.

## 3. Evidence

Guard: every group below ran after `SELECT current_database()`; the suite also
asserts it itself and refuses any database whose name matches
`/prod|prd|production/i`. Production was never touched.

### 3.1 Migration, from zero, on an isolated dev database

```
$ docker exec abixell-dev psql -U abixell -d abixell_one_g3_core2 -c "SELECT current_database();"
 current_database
------------------
 abixell_one_g3_core2
(1 row)

$ npm run migrate        # apps/api
Migrations complete!
```

- 78 migrations applied to an empty database (`SELECT count(*) FROM pgmigrations`).
- G3 stamps present: `1789400000000_epic-5-g3-legal-entity-scope`,
  `1789410000000_epic-5-g3-session-legal-entity-scope`,
  `1789420000000_epic-5-g3-authorization-effective-view`.
- `user_role_assignments` constraints after migrate:
  `pkey`, `role_id_fkey`, `scope_consistency_check`, `scope_customer_id_fkey`,
  `scope_legal_entity_id_fkey`, `scope_organization_unit_id_fkey`,
  `user_id_fkey` (the two pre-G3 scope CHECKs are gone by design).
- `sessions.scope_legal_entity_id` and the view column
  `authorization_effective_user_role_assignments.scope_legal_entity_id` exist.
- Log: `%LOCALAPPDATA%/Temp/g3core/g3-core2-migrate.log`.

### 3.2 Core suite

`npm test -- tests/integration/epic-5-g3-legal-entity-scope.test.ts` →
**13 passed / 13**. Cases: migration shape; consistency CHECK refuses a
double-target row; the view returns the granted LE row, drops it while the LE is
inactive and restores it on reactivation; a cross-Tenant LE reference is
invalidated at write time and never reaches the view; the session resolves
`scopeType='legal_entity'` + `scopeLegalEntityId` and the mirrored column moves on
switch-role; A5 (covers every unit inside the LE), A6 (never a sibling LE),
A7 (permission from one assignment + scope from another is refused while the
union holds the code), R10 (write gate: LE target and in-LE OU allowed, sibling
unit and tenant-wide refused inside a rolled-back transaction); the governed HTTP
grant writes `scopeLegalEntityId` and the out-of-scope target is 404; a
LE-scoped actor is refused a tenant-wide grant (403) and is **not** classified as
an external caller by `/me`; the admin list shows the in-scope target and hides
the sibling's; the picker offers every active LE to a tenant-wide actor and
nothing foreign.
Log: `%LOCALAPPDATA%/Temp/g3core/g3-core2-focused.log`.

### 3.3 Full API regression on the same isolated database

```
Test Files  2 failed | 65 passed (67)
     Tests  915 passed | 27 skipped (942)
```

- **0 test failures.** The two failing *files* are the pre-existing guards that
  require a database literally named `abixell_one_epic3_wave4`
  (`role-definition.test.ts`, `window-enforcement.test.ts`):
  `Error: Role-definition integration tests require abixell_one_epic3_wave4, got abixell_one_g3_core2`.
  They are environmental, not a regression from this work, and were not
  exercised here — `t_2c9be72b` owns the regression bundle and should run them on
  a database of that name.
- The 8 `admin-access-management` shape assertions and the revocation-monotonicity
  case that failed mid-implementation are green in this run.
- Log: `%LOCALAPPDATA%/Temp/g3core/g3-full-regression4.log`.

### 3.4 Static checks

- `npm run typecheck -w apps/api` → clean.
- `npm run typecheck -w apps/web` → clean.
- `npm run lint -w apps/web` → clean.
- `npm run lint -w apps/api` → **7 errors, all pre-existing**
  (`no-explicit-any` in `app-metadata.repository.pg.ts`), plus 49 warnings.
  No file touched by this task contributes an error.
- `git status --porcelain` in the worktree: 18 entries, all of them the files
  listed in §1 (4 new, 14 modified); no log or scratch file in the repository.

## 4. Findings handed to the wave

1. **`abixell_one_dev` carries a DIFFERENT `1789400000000` body.** The
  operator-applied G3 migration there is the earlier, unapproved attempt
  (`tenant_id` column on `user_role_assignments` + composite
  `user_role_assignments_scope_legal_entity_fk` + its own view). `node-pg-migrate`
  records a stamp, not a body, so my M10 will never run on that database: it is
  a stamp collision that must be resolved by the operator (recreate the dev
  database, or accept the hybrid). Every claim in this document is measured on a
  database built from zero, not on `abixell_one_dev`.
2. **The G3 root branch carries stale G2 content.** Branch
  `abixell-one/t_69f0ef8a-...` contains `819266c`, whose tree equals `eaeab0f` —
   the pre-rework G2, 648 lines short of the approved revision. The approved G2
  is `9c66c95` on `abixell-one/t_93b496f9-...`. This task is based on `9c66c95`
  (fast-forward), so integration must reconcile the root branch with the
  approved G2 revision before merging, or it will silently drop the G2 rework.
3. **Inactive/deleted guards.** The Legal Entity family fails closed (view
  requires an active, same-Tenant, non-deleted Legal Entity; the grant path
  refuses an inactive target). The Organization Unit family keeps its shipped
  predicate; `t_e1a1984c` owns the OU tightening and any further guard work.
4. **Scope typing is legacy-shaped in one place.** `sessions.organization_unit_id`
  and the new `sessions.scope_legal_entity_id` are mirrors maintained on
  login/switch; authorization reads the view on every request, so revocation and
  deactivation still take effect without a re-login.
