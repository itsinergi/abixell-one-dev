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

## 10. Round-1 rework (review `changes_requested`, comment #23)

Sections 1–9 above are the round-0 record and are left as written. This section is
the rework: what the review's two blocking findings and one observation changed,
and what was re-measured afterwards.

### 10.1 Finding 1 — the backdated range's upper bound

`sealRangeAndOpen()` bounded a backdated range with the **open** range's start.
That is the next boundary only when the open range happens to follow the
effective date: as soon as a sealed range starts after it (any unit that has had a
forward publish, or a second backdate), the insert overlapped that sealed range and
`organization_unit_hierarchy_no_overlap` refused it as a raw `23P01` → **HTTP 500**.

The bound is now the **next range boundary after the effective date**
(`min(effective_from)` over the unit's ranges that start later), whichever range
that is. With it, corrections are recorded as a gapless partition — probe F below:
four ranges, every boundary shared, exactly one open.

The branch's other half — *"a date preceding where the unit's history begins should
be a named `ConflictError`, not a raw `23P01`"* — is now explicit in two places:

- **before the unit existed**: `effectiveFrom < organization_units.created_at` is
  refused by name (the structure was not in force before there was a unit to hold
  it — the invariant the projection-sync header states for the first range). That
  is the date the round-1 note describes as "the only shape that works"; it is now
  the shape that is refused.
- **any residual exclusion violation** (a race between two publishes): translated
  into the same named `ConflictError` instead of escaping as `23P01`. The
  constraint stays the last line of defence, and it no longer surfaces as a 500.

### 10.2 Finding 2 — a request outliving its unit's tombstone

`publishChangeRequest` now calls `assertMutableUnit(unit)` against the row it has
just locked, inside the transaction, before any history is written — the same
refusal `createChangeRequest` applies at proposal time, at the only moment it
cannot be bypassed. The `inactive` precondition for a tombstone was moved from the
direct endpoint into `applyTombstone`, so the published-request path is held to it
too (a unit that went back to `active` while the request waited is not deleted by
it). Probe C below is the round-1 repro: now 409, parent unchanged, **no open
range** on the tombstoned unit.

Same class, found while fixing it and closed here: a **tombstone dated before the
version in force** (a business date earlier than the start of the range in force —
the shape a legacy-shaped unit or a future-dated publish produces) used to close
nothing, leaving a tombstoned unit "in force" for every reader. It is now refused
by name: the unit cannot leave the structure before the version that put it there,
and no range can express it. Probe E below: refused, the version in force still
open and the unit still `inactive`; the ordinary delete then records and closes it.

### 10.3 Observation — publishing a `draft`

Chosen and now stated once, in the domain:
`PUBLISHABLE_CHANGE_REQUEST_STATUSES = ["draft", "pending_review"]`, imported by
the repository guard and asserted by the suite. §4.5 principle 12 fixes *who*
publishes, not *which states* are publishable; this wave ships no separate submit
route, so the create-time `submitForReview` flag **is** the submit step and
restricting publish to `pending_review` would leave `draft` a state that can only
be cancelled. The publish audit now records `fromStatus`, so a publish that skipped
the proposer's signal is visible on the record instead of inferable from a queue.
`CreateChangeRequestInput.submitForReview` and the guard comment were rewritten to
say the same thing; the 1789397000000 header is an applied migration and is left
untouched.

### 10.4 Re-measured evidence

```
$ docker exec abixell-dev psql -U abixell -d abixell_one_epic5g2rw -tc "SELECT current_database();"
 abixell_one_epic5g2rw
$ ... -tc "SELECT count(*) FROM pgmigrations;"
 75                     (created empty, migrated from zero, "Migrations complete!")

$ npx vitest run tests/integration/epic-5-g2-hierarchy-history.test.ts
 Test Files  1 passed (1)
      Tests  18 passed (18)          (was 12; +6 for the corrections above)

$ npm run test -w apps/api        (full suite, same database)
 Test Files  2 failed | 64 passed (66)     ← the documented by-design pair
      Tests  902 passed | 27 skipped (929) (was 896/27/923: delta = +6)

$ npm run typecheck -w apps/api   → exit 0
$ npm run lint -w apps/api        → 56 problems (7 errors, 49 warnings) = baseline
                                    exact; no finding names a file this wave touched
```

Round-1 probes re-run on the reworked tree
(`zz-round1-probes.test.ts`, kept outside the repo in
`%LOCALAPPDATA%\Temp\epic5g2rw\`, copied in for the run and deleted after —
`git status` clean of it; log `probes.log`):

| Probe | Round 1 | Reworked tree |
|---|---|---|
| A — 5-day backdate after a forward publish | **500**, `23P01` | **409** named ("precedes the Organization Unit's own creation"), ranges untouched |
| B — second backdate on one unit | **500**, `23P01` | **409** named (same reason), one open range, nothing written |
| C — publish a pending request after the unit's tombstone | **200**, unit re-parented + new open range | **409** named ("structure changes are no longer accepted"), parent unchanged, no open range |
| D — publish a `draft` | 200, silently | 200, `fromStatus: "draft"` on the publish audit |
| E — tombstone dated before the version in force | not covered | **409** named; the ordinary tombstone then closes the range (no open range) |
| F — two backdates with a forward publish between them | **500** | **200 / 200**, partition gapless: `[-85d,-60d) [-60d,-30d) [-30d,+10h) [+10h,∞)` |

A correction dated **before the range in force but after the unit was created** —
the honest shape, which only a unit whose recorded history starts later than the
unit itself can have (every unit that predates the parity snapshot, per §5) — is
recorded: closed range ending where the recorded history begins, projection NOT
rewritten, `appliedToCurrentProjection: false`, both dates on the audit. Probes A
and B use freshly created units, so their dates fall before the unit existed and
are refused by name; the recordable versions of both shapes are covered by
`makeHistoryStartAfterCreation` in the suite and by probe F.

Two honest limits, stated rather than smoothed over:

- A backdate that lands **inside** a version already in force stays refused (named,
  "overlaps this change"). This model records closed periods; it never rewrites
  one, which is what §4.5's "laporan periode yang sudah ditutup tidak boleh berubah
  diam-diam" asks for.
- A **tombstone dated before the version in force** is refused rather than
  recorded (§10.2). Recording it would require rewriting the version that the date
  precedes, and recording nothing would leave the unit in force. If the Founder
  wants such a closure recorded, it needs a rule for the version it invalidates —
  the same effective-date-aware work Wave 3 owns for scope walks.

### 10.5 Authorship and concurrency (disclosed)

The rework landed in this worktree while **another session of the same profile was
writing to the same three files** (session `20260929_102947_ae9e66`, pid 4356,
which had run the round-1 review; this run is session `20260929_103650_aa441d`,
run 20. Both are listed in `active_sessions.json`; the file mtimes moved between
15-second polls while this run was reading). This run's contribution on top of the
tree it found: the named `PUBLISHABLE_CHANGE_REQUEST_STATUSES` rule + the audit's
`fromStatus`, the `23P01` translation, the tombstone invariant fix (§10.2, probe
E), the acceptance assertions for all three, this section, and the verification
above. Flagged on the card as a hotspot
(`organization-unit-hierarchy.repository.pg.ts`). If the other session produces a
further revision, the hashes below are what was verified here.

### 10.6 Artifact hashes at verification time

```
92a385491ba9ab068f31f0c61a18abb29df2748b3f2e108ed126a716b46c9259  migrations/1789396000000_epic-5-g2-hierarchy-history.cjs
34e09e44fae550e78f3623850a1ff10fba9f7da38ac352716049c27e9d229016  src/infrastructure/persistence/repositories/organization-unit-hierarchy.repository.pg.ts
f33766b8d4436e4233b928297d15cbd12eb68f8a44238581715f59ebd8e3320c  tests/integration/epic-5-g2-hierarchy-history.test.ts
664635dfa9e43fda0167a7511835976c7d594d54c02bc03febfbb245dc4de182  src/domain/organization-unit/organization-unit-hierarchy.entity.ts
```

The migration hash is unchanged from round 1 (the reviewer's `92a3854…`), so no
applied migration was touched by this rework. The other three are the reworked
artifacts; re-check them before reviewing, and again before round 2's
reproduction.
