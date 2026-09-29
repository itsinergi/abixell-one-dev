# Epic 5 G3 — server-side authorization enforcement: execution evidence

**Card:** `t_e1a1984c` — "Enforce server-side authorization on every inventoried resource"
**Branch:** `wt/t_e1a1984c`, based on the approved G3 core `688b57a` (branch `wt/t_2b80c5e2`)
**Evidence database:** `abixell_one_g3_enforce` (created empty, migrated from zero)
**Date:** 2026-09-29

Upstream inputs this batch worked from:

- `t_c1ac4c45` — `RESOURCE_INVENTORY_LEGAL_ENTITY_SCOPE.md` (283 endpoints, 108 reported
  unguarded, 18 services reported with zero `RbacService` calls).
- `t_2b80c5e2` — G3 core at `688b57a`: M10/M11/M12, `ActorContext`/`DataScope`
  `legal_entity` scope, session context, `RbacService` coverage chain, authorization-effective
  projection, admin read narrowing. Its hand-off note says the Legal Entity branch of the
  projection is fail-closed while "the organization_unit branch keeps its shipped predicate and
  is handed to t_e1a1984c".

---

## 1. What the inventory reported, and what the code actually contains

The inventory was produced by scanning **route files** and the thin **application services behind
them**. That layer is a false negative for one whole tier: the warehouse (WMS) and procurement
services are *delegating wrappers*. `WarehouseTopologyService`, `ItemTrackingService`, …,
`RfqBiddingService`, … each hold one `SupplyChainAdvancedService` and forward every call to it,
and that delegate is where `RbacService` is wired.

Grep-level result on the delegate (`apps/api/src/modules/supply-chain/advanced/application/supply-chain-advanced.service.ts`,
120 async methods; "operations" excludes the assertion/resolver helpers and the two
`canAccess*ForDocument` resolvers):

```
public (route-reachable-ish) operations: 106
operations without a permission guard: 0
operations without any Data Scope resolution: 3   (createBatch, getBatch, listBatches)
operations with BOTH: 103
```

So the "108 endpoints completely bypass authorization" finding is **wrong at the enforcement
layer**: every one of those 108 route entries reaches a method that already calls
`requirePermission(actor, "supply_chain.*")`, and 103 of 106 also resolve Data Scope. The gap the
inventory was pointing at is real but different, and it is what this batch fixed:

1. **No `legal_entity` dimension was wired anywhere.** Before this batch
   `grep -rn "requireLegalEntityScopedPermissionForActor\|isActiveLegalEntityScopeCovered" apps/api/src`
   matched the `RbacService` definition and nothing else: the G3 core shipped the primitives and
   no resource consumed them. Legal Entity placement (`financial_account.legal_entity_id`,
   `employee.legal_entity_id`, the Legal Entity aggregate itself) was checked for *existence and
   tenant only*.
2. **Scope narrowing listed a user's authority from the union of ALL their assignments**, not the
   active one (Epic 1 §4.1 C), and only understood the `organization_unit` family — an
   Legal-Entity-scoped supervisor matched nothing and saw empty lists.
3. **The Organization Unit family was still not fail-closed** for inactive/deleted scope entities.
4. **Tenant-level families were permission-only**: landed cost, supplier evaluations, supplier
   contracts, contract spend, account-assignment configuration and accounting-ready events have no
   placement column, so no scope check existed at all — any caller with the family's capability
   could read/change it at any scope. The module's own document resolvers
   (`canAccessLandedCostForDocument`, `canAccessSupplierContractForDocument`) already required
   tenant-wide scope, so the rule existed and simply was not applied to the HTTP methods.

## 2. Changes

### 2.1 M13 — the projection no longer authorizes through a non-active Organization Unit
`apps/api/migrations/1789430000000_epic-5-g3-organization-unit-scope-active.cjs`

One predicate in the `organization_units` join of
`authorization_effective_user_role_assignments`: `AND ou.status = 'active'`. An assignment scoped
to an inactive, tombstoned or deleted unit leaves the projection, exactly as M12 already does for a
Legal Entity scope (`le.deleted_at IS NULL AND le.is_active`). The rollback body is byte-identical
to M12's (verified by diffing the two constants), and the up body differs from it by that single
line.

Consequences, stated rather than discovered:
- `resolveActor` joins the view, so a session whose active assignment is scoped to a unit that just
  went inactive resolves to `assignmentId: null` on its next request: authenticated, and 403 on
  every permissioned route. No stale authority survives a lifecycle change.
- Live assignments on an inactive unit stay visible and managed in the admin console: the admin
  reads deliberately read `user_role_assignments`, not the projection.
- Unit lifecycle transitions are unaffected: they carry `organization_unit.update/activate` and the
  scope check they run is the lifecycle-safe one (see §2.2), so `inactive → active` and
  `inactive → tombstone` remain reachable. This was checked deliberately — putting an
  "active target" requirement into the shared scope primitive would have made both transitions
  unsatisfiable, the trap G1 documented for the Legal Entity deactivation rule.

### 2.2 `RbacService` — fail-closed guards and the predicates a resource wiring needs
`apps/api/src/application/rbac/rbac.service.ts` (+ constructor now takes a
`LegalEntityRepository`; `composition-root.ts` and the G3 core suite updated)

| method | rule |
|---|---|
| `isActiveOrganizationUnitScopeCovered` | target unit must exist in the Tenant and not be RETIRED (tombstone/deleted); the SCOPE entity (Legal Entity, or the Organization Unit the active assignment names) must be `status = 'active'`; then the ADR-0009 ancestor walk. `inactive` targets stay coverable so the unit's own transitions keep working. |
| `isLegalEntityScopeCovered` | lifecycle-safe coverage (target may be inactive/draft) — the form the Legal Entity's own aggregate uses, so an inactive Legal Entity stays manageable and reactivatable. |
| `isActiveLegalEntityScopeCovered` | coverage + the target must be OPEN FOR NEW WORK (`active` or `draft`; `inactive`/`tombstone`/`deleted` refused) — the form every resource uses when it ASSIGNS a Legal Entity. |
| `requireLegalEntityScopeForActor` / `requireActiveLegalEntityScopeForActor` | the enforcement forms of the two above. |
| `listScopedOrganizationUnitIds` | the active assignment's covered unit ids: `null` = tenant-wide, `[]` = nothing, Legal Entity scope → every active unit in that Legal Entity, Organization Unit scope → the unit and its active descendants. Inactive/deleted units are excluded. |
| `listScopedLegalEntityIds` | the Legal Entity ids a list read may show: `null` = whole Tenant, Legal Entity scope → its own, Organization Unit scope → the Legal Entity the covered units sit inside (a read of the parent, not authority over it). |

`draft` is deliberately allowed as a Legal Entity *target*: `LegalEntityRepository.create` defaults
`status = 'draft'`, and charts of accounts, employees and addresses are configured before the
entity goes live. A `legal_entity`-scoped *assignment* on a draft Legal Entity still confers
nothing — the projection requires `le.is_active`. (First full regression run without this
distinction failed 22 tests in `finance.test.ts` and `wave-a4-integration.test.ts`; that is how the
rule was found.)

### 2.3 Resource wiring — the Legal Entity dimension
- `application/legal-entity/legal-entity.service.ts`: `assertOwned` → `assertScoped` (same-Tenant
  ownership **plus** Data Scope coverage) on `update`, `setActive`, `updateStatus` and every address
  operation; `listForTenant` narrowed by `listScopedLegalEntityIds`. Before this, any internal
  caller holding `legal_entity.update` could edit a sibling Legal Entity of the same Tenant.
- `modules/finance/core/application/finance.service.ts`: `resolveLegalEntity` now requires the
  target to be covered by the active scope AND open for new work. This is the wiring the inventory
  recommended for `financialAccount.legalEntityId`.
- `modules/workforce/core/application/workforce.service.ts`: same change in `resolveLegalEntity`
  (employee creation / placement change), the inventory's "Workforce: employee.legalEntityId
  placement" recommendation.
- `application/organization-unit/organization-unit.service.ts`: `listForTenant` now narrows by
  `listScopedOrganizationUnitIds` instead of reading `getAssignments(userId)` and matching only the
  `organization_unit` family. That removes an Epic 1 §4.1 C violation (union of all Roles, not the
  active one) and makes an Legal-Entity-scoped reader's list non-empty.

### 2.4 Supply-chain (WMS + procurement) — the 24 scope-less operations
`supply-chain-advanced.service.ts`, plus one repository read and one list filter:

| family | treatment |
|---|---|
| landed cost (create/apply/get/list) | tenant-wide Data Scope required — no placement column; matches `canAccessLandedCostForDocument`. |
| supplier evaluation (create/get/list/act) | tenant-wide. |
| supplier contract (create/record spend/get/list/act) | tenant-wide. |
| account-assignment configuration (list/get) | tenant-wide (update already required it). |
| accounting-ready events (create/get/list/update state) | tenant-wide: their `source_document_type` spans eight sources, so no single placement anchor exists to resolve; the sources themselves (transfer, opname, receiving, return, reversal, disposal, consignment, valuation layer) are each warehouse-scope-asserted. |
| `createInspection`, `getInspectionByReceivingLine`, `createDiscrepancyRecord`, `resolveDiscrepancyRecord`, `listDiscrepancyRecords` | warehouse scope resolved through the record's parent (`findInventoryLinePlacementWarehouseId`); an unresolvable ref is a `NotFoundError`, never a silent pass. `listDiscrepancyRecords` narrows through the new `ScmDiscrepancyRecordFilter.warehouseIds`. |
| `recordStockOpnameCount` | warehouse scope resolved through the opname line's opname. |
| `createBatch` / `getBatch` / `listBatches` | **explicit, justified exception**: `scm_item_batches` carries `item_id` and nothing else — no Organization Unit, no warehouse, no Legal Entity — so there is no anchor to check and no parent to resolve. Permission-gated with `supply_chain.inventory.manage`/`.read`. Serials, which DO carry `warehouse_id`, are scope-asserted on every operation. The residual consequence (a unit-scoped reader can read the Tenant's batch master list — item reference data, not stock or value) is stated in the code comment at the family. |
| `resolveScopedOrganizationUnitIds` | now delegates to `RbacService.listScopedOrganizationUnitIds`: active assignment only, Legal Entity family included, inactive units excluded. |

## 3. Verification

Guard before every group: `SELECT current_database()` — `abixell_one_g3_enforce`; the suites also
refuse any name matching `/prod|prd|production/i`. All commands run from the worktree with
`DATABASE_URL` pointed at that database.

| check | command | result |
|---|---|---|
| migrate from zero | `npm run migrate -w apps/api` | **79 migrations applied** (78 before + M13), exit 0 |
| M13 installed | `pg_get_viewdef('authorization_effective_user_role_assignments')` | contains `ou.status = 'active'`, `ou.deleted_at IS NULL`, `le.is_active` |
| G3 core suite | `npx vitest run tests/integration/epic-5-g3-legal-entity-scope.test.ts` | **13 passed / 13** (stamp expectation extended to include M13) |
| new enforcement suite | `npx vitest run tests/integration/epic-5-g3-authorization-enforcement.test.ts` | **13 passed / 13** |
| finance suite (regressed by the first attempt) | `npx vitest run tests/integration/finance.test.ts` | **21 passed / 21** |
| full API regression | `npm test -w apps/api` | **928 passed, 27 skipped, 0 failed** (68 files; 2 files fail by design — `role-definition` and `window-enforcement` refuse any database not named `abixell_one_epic3_wave4`). Baseline on the parent commit was 915 passed; +13 is the new suite. |
| api typecheck | `npm run typecheck -w apps/api` | exit 0 |
| web typecheck | `npm run typecheck -w apps/web` | exit 0 |
| api lint | `npm run lint -w apps/api` | identical to the parent baseline: 7 errors, all pre-existing `no-explicit-any` in `app-metadata.repository.pg.ts`, 50 warnings. No new finding in a touched file. |
| route-file audit | scripted scan of all 30 `interfaces/http/routes/*` + all 12 module route files | 0 files with an unguarded handler, except `reporting-advanced.ts`, whose 5 flagged calls are **verified false positives**: `createSavedReport`, `deleteSavedReport`, `executeQuery`, `getDatasetDetails`, `getSavedReport` all route through the private `authorizeDataset` helper, which calls `requirePermissionsOnActiveAssignment` (`bi.service.ts:257-266`). |

New suite coverage (`apps/api/tests/integration/epic-5-g3-authorization-enforcement.test.ts`):

1. the projection drops and restores an Organization-Unit-scoped assignment with the unit's
   lifecycle, and the installed view definition carries the new predicate;
2. a live session loses its authority the moment the scope unit is deactivated (403 on a
   permissioned route) and gets it back on reactivation, and the resolved `ActorContext` shows
   `assignmentId: null` / `scopeType: null`;
3. a retired (soft-deleted) unit is refused as a target, for a unit-scoped actor;
4. an authority whose SCOPE unit is inactive is void even from a hand-built (stale) `ActorContext`;
5. an inactive Legal Entity is refused as a target even for a tenant-wide Role, while
   `isLegalEntityScopeCovered` / `requireLegalEntityScopeForActor` keep it manageable;
6. list narrowing: tenant-wide `null`, Legal Entity family inside its own entity and never a
   sibling, Organization Unit scope limited to the branch, assignment-less and customer-scoped
   actors answered `[]`;
7. wiring on a real resource: Finance accepts an account inside the scope Legal Entity (201),
   refuses a sibling Legal Entity of the same Tenant (403), and refuses an INACTIVE Legal Entity even
   for the tenant-wide administrator (403).

## 4. Residual gaps (not silently closed)

1. **Batch masters** (`createBatch`, `getBatch`, `listBatches`) remain permission-only — anchor-less
   by construction, stated in code at the family and above.
2. **Accounting-ready events** accept a caller-supplied `source_document_id`; the tenant-wide scope
   requirement is the shipped rule, but a per-source anchor map (transfer/opname/receiving/…) would
   be stricter. Follow-up card `t_3e2f45ca` raised for this batch of anchor work.
3. **`legal_entity.create`** stays permission-only (no scope requirement): creating a Legal Entity
   is a tenant-level act in the contract's model, and the capability is only held by tenant-level
   Roles today. Recorded here so the next wave can decide rather than assume.
4. **Customer scope and Department scope** were out of scope for this card by instruction.
5. The `ABIXELL_ONE_DEV` database still records a **different body** for `1789400000000`
   (`t_6f5f2c31`, from the parent's hand-off): M13 is unaffected by that collision, but no evidence
   in this document was taken from the dev database — everything above was measured on
   `abixell_one_g3_enforce`, built from zero.
