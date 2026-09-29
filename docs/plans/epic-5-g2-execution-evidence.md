# Epic 5 G2 — Effective hierarchy history, proposals, tombstone: execution evidence

**Task:** t_93b496f9 (builder)
**Date:** 2026-09-29
**Scope:** `docs/plans/CORE-ROADMAP.md` §4.5 Gelombang 2, steps 10–13
**Contract:** `docs/plans/epic-5-g0-contract.md` (M6/M9 re-stamped), plus the two
Epic 5 accepted-risk carry-forwards recorded in the G1 migration headers.

No production database was written. Every migration and every test ran on a
database created for this wave, and `abixell_one_dev` was touched read-only (one
`SELECT` census). The isolated databases are still present in the `abixell-dev`
container for inspection: `abixell_one_epic5g2`, `abixell_one_epic5g2_fresh2`,
`abixell_one_epic5g2_legacy`, `abixell_one_epic5g2_fresh`.

## 1. Isolated database proof

```
$ docker exec abixell-dev psql -U abixell -d abixell_one_epic5g2_fresh2 -c "SELECT current_database();"
 abixell_one_epic5g2_fresh2

$ DATABASE_URL=...epic5g2_fresh2 npm run migrate -w apps/api
Migrations complete!
 migrations | epic5
         75 |    14      (8 Gelombang 1 + 6 Gelombang 2)

$ DATABASE_URL=...epic5g2_fresh2 npx vitest run tests/integration/epic-5-g2-hierarchy-history.test.ts
 Test Files  1 passed (1)
      Tests  12 passed (12)
```

The same suite also passes on `abixell_one_epic5g2` (the wave's working database)
and on `abixell_one_epic5g2_legacy` (§5).

## 2. Migrations added by this wave (additive only)

| Stamp | File | What it adds |
|---|---|---|
| 1789396000000 | `epic-5-g2-hierarchy-history.cjs` | `organization_unit_hierarchy_history` + EXCLUDE overlap constraint + parity snapshot + `organization_unit_parent_at()` + `organization_unit_current_hierarchy` view |
| 1789397000000 | `epic-5-g2-change-requests-tombstone.cjs` | `organization_unit_change_requests`, tombstone columns on `organization_units`, `entity_reference_registry` (generated from `pg_constraint`) + `entity_reference_census()` |
| 1789398000000 | `epic-5-g2-guard-landing.cjs` | carry-forward (1): address FK → deferrable `NO ACTION` + `tenant_id` cascade; carry-forward (2): root-Central DELETE guard keyed on the owner, `pg_trigger_depth()` removed |
| 1789399000000 | `epic-5-g2-dictionary-seed.cjs` | 8 API resources, 3 permissions, 3 Processes |
| 1789399500000 | `epic-5-g2-hierarchy-projection-sync.cjs` | history opened on unit INSERT and on any direct `parent_id` change |
| 1789399600000 | `epic-5-g2-root-central-backfill.cjs` | one `Central` root per legacy Legal Entity that has none (additive; no re-parenting) |

Stamps 1789396000000 and 1789397000000 are the G0 contract's re-stamped M6/M9
slots. 1789398000000–1789399600000 are wave content with no contract slot, taken
from the gap above Gelombang 1's last applied stamp (1789390000000) and below
Wave 3's reserved M10 (1789400000000). Nothing above a reserved stamp was used,
and no already-applied stamp was reused — `node-pg-migrate` refuses a lower
stamp, which is why M9 had to be re-stamped in the first place.

## 3. Acceptance suite

`apps/api/tests/integration/epic-5-g2-hierarchy-history.test.ts` — 12 tests,
all passing on three databases (working, fresh-from-zero, legacy clone):

- parity snapshot: every unit has exactly one open range and the projection view
  agrees with `parent_id`;
- forward-dated publish: history answers the old parent before the effective
  date, the new one after it, `parent_id` follows;
- publish audit: `effectiveFrom`, `publishedAt`, `backdated`, reason, before/after;
- backdate audit: both dates kept, `backdated = true`, projection NOT rewritten;
- backdate beyond the policy window: refused (409);
- cycle: moving a unit under its own descendant is refused (409);
- overlap: an effective date inside a range already in force is refused (409);
- cross-Legal-Entity parent: refused (403);
- cross-Tenant target: 404, not 403 (existence is not confirmed);
- §4.5 principle 12: a proposer without `organization_unit.change_request.review`
  gets 403 on publish while the reviewer can publish the same request;
- tombstone: needs an inactive unit, records status/time/reason/replacement, and
  the reference census reports the row that still points at it
  (`sessions.organization_unit_id`), so `eligibleForPhysicalDelete=false`;
- tombstone historical readability: the referencing row and the tombstoned unit
  still join, with status, reason and replacement intact;
- root Central: cannot be deactivated and cannot be tombstoned.

## 4. Regression parity

| Run | Files | Tests |
|---|---|---|
| G2 full suite (working DB) | 66 files, 2 failed / 64 passed | 896 passed, 27 skipped (923) |
| Pre-G2 full suite, same DB | 65 files, 2 failed / 63 passed | 884 passed, 27 skipped (911) |

The two failing files are the documented by-design pair
(`role-definition`, `window-enforcement`), which require the database to be named
`abixell_one_epic3_wave4`. Delta is exactly +12 passing tests = the new suite.

- `npm run typecheck -w apps/api`: clean, and clean on the G1 tree too (the first
  run's five findings were a broken `node_modules` copy in this worktree, not
  source — repairing the copy removed them; `schema-registry-validator.ts` is
  untouched by this wave).
- `npm run lint -w apps/api`: **56 problems (7 errors, 49 warnings)** on both the
  G1 tree and this one — identical counts, and the 7 errors are the pre-existing
  `no-explicit-any` findings in `app-metadata.repository.pg.ts`. No new finding
  names a file this wave touched.

## 5. Legacy-data proof (dump of `abixell_one_dev` into a clone)

`abixell_one_dev` → `abixell_one_epic5g2_legacy` (full dump; the `pgmigrations`
re-stamp from the G0/G1 playbook applied inside the clone only). Migrations then
ran 61 → 75 with no error, including all six of this wave's.

Before → after:

| Measure | Before | After |
|---|---|---|
| live Legal Entities | 309 | 309 |
| live units named `Central` | 0 | **309** |
| history rows / open ranges | – | **789 / 789** (one open range per live unit) |
| `entity_reference_registry` columns | – | 30 |
| `organization_unit.central_backfilled` audit rows | – | 309 |
| Legal Entities with >1 parentless unit | 45 | 309 (each legacy root + the new Central) |

Notes, stated rather than smoothed over:

- The clone's `pg_dump` restore reported foreign-key errors on some *module*
  tables (`employee_assignments`, `hse_persons_involved`, …) — a COPY-ordering
  artefact of the restore, not of the migrations. The organisation tables this
  wave migrates (tenants, legal_entities, organization_units, addresses,
  assignments) restored complete, which is why the counts above are meaningful.
- The backfill makes "has a Central" true for all 309 and leaves "and only one
  parentless unit" open for all of them. Re-parenting the legacy roots under the
  new Central would rewrite the organisation structure of a live tenant, which is
  a Founder decision, not a migration's. Measured, documented in the migration
  header, and reported here as an open item.

## 6. Guard probes (rolled-back, on the isolated database)

Two probe scripts (`probe-g2-guards.sql`, `probe-g2-shipped.sql`), each
experiment in its own `BEGIN … ROLLBACK` with results carried out by
`RAISE NOTICE`:

| Probe | Ship state | Result |
|---|---|---|
| E1 tenant teardown, G1 definitions | baseline | teardown OK |
| E2a tenant teardown, guard candidate V1 | baseline | teardown OK |
| E2b direct root-Central DELETE, V1 | baseline | **refused** |
| E3a direct Legal Entity delete, deferrable NO ACTION | baseline | allowed at statement time, **refused at COMMIT (E4)** |
| E3b tenant teardown, deferrable NO ACTION | baseline | teardown OK |
| E4 `SET CONSTRAINTS ALL IMMEDIATE` after a direct LE delete | baseline | **refused** |
| E5 registry census on a brand-new unit | baseline | `[]` |
| S1 tenant teardown with LE + root Central + address | **shipped** | teardown OK |
| S2a direct LE delete while it owns an address | **shipped** | **refused** |
| S2b tenant teardown while an address exists | **shipped** | teardown OK |
| S3 direct root-Central DELETE, owner present | **shipped** | **refused** |
| S4 direct DELETE of a non-root unit | **shipped** | allowed, unchanged |
| S5a overlapping effective range | **shipped** | **refused** (`organization_unit_hierarchy_no_overlap`) |
| S5b back-to-back ranges | **shipped** | allowed |
| S6a/S6b/S6c registry census | **shipped** | child → `parent_id` hit; leaf → `[]`; LE → `organization_units.legal_entity_id` |

## 7. Carry-forward resolution

1. **Address FK RESTRICT (G0 M3).** Landed as `ON DELETE NO ACTION DEFERRABLE
   INITIALLY DEFERRED` plus a direct `ON DELETE CASCADE` from `tenants` on
   `legal_entity_addresses.tenant_id`. A direct Legal Entity delete is now
   refused (S2a/E4); Tenant teardown still works (E3b/S2b). A literal RESTRICT
   cannot be deferred and makes a Tenant that owns one address undeletable — the
   shape G1 measured and the Founder accepted as temporary. Deviation from the
   letter of M3, same claim, documented in `1789398000000`.
2. **Root-Central DELETE guard.** `pg_trigger_depth() <= 1` is gone. The guard now
   refuses a delete while the owning Legal Entity is present — a cascade whose
   owner has already gone is allowed (S1/S3/S4). This is the "full protection"
   Founder sign-off [3.2] asked Wave 2 to deliver together with the tombstone flow.

Still open from G1 (outside steps 10–13, not claimed here): Founder decision [3A],
the Legal Entity `active → inactive` reachability gap.

## 8. Deviations and open decisions handed to the Founder

- **History table FK is CASCADE, not the contract's RESTRICT.** A history row is
  the unit's own structural record, and the reference census counts *external*
  references only; RESTRICT on `organization_unit_id` would abort every Tenant
  teardown. Documented in the migration header; the physical-delete eligibility
  claim is carried by the census, not by the FK.
- **Change-request status set** = `draft, pending_review, published, rejected,
  cancelled` (G0 §13 Q7 answered in `1789397000000`): `draft` is the proposer's
  scratch space, `pending_review` is the claim "publish this", `cancelled` is the
  proposer withdrawing before review.
- **`parent_id` is the latest PUBLISHED projection.** A future-dated publish
  writes it immediately, so scope walks that use `parent_id` see the new parent
  before the effective date. Making the scope walk effective-date aware is Wave 3
  work (contract §10 R5); this wave provides the history, the projection view and
  the SQL function the walk needs.
- **Backdate bound** = platform default 90 days
  (`ORGANIZATION_UNIT_BACKDATE_LIMIT_DAYS`), a named constant at the Epic 8 policy
  slot (§4.5 G item 1).
- **No physical delete.** The tombstone flow keeps the row and reports the census
  (`eligibleForPhysicalDelete`), which is the measurement §4.5 principle 6 asks
  for; Epic 5 performs no physical delete.
- **Legacy re-parenting** (§5) is a Founder decision.

## 9. Files

New: 6 migrations, `src/domain/organization-unit/organization-unit-hierarchy.entity.ts`,
`src/infrastructure/persistence/repositories/organization-unit-hierarchy.repository.pg.ts`,
`src/application/organization-unit/organization-unit-hierarchy.service.ts`,
`src/interfaces/http/routes/organization-unit-hierarchy.ts`,
`tests/integration/epic-5-g2-hierarchy-history.test.ts`.

Modified: `src/app.ts`, `src/composition-root.ts`,
`src/domain/configuration/window-enforcement.ts`,
`src/domain/configuration/module-attribution.ts`.
