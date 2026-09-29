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
`RAISE NOTICE`. The shipped-schema script was re-measured after round 2's review
(`probe-g2-shipped-v2.sql`, §11.1) — the row below that changed is marked.

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
| S5b back-to-back ranges (**corrected, §11.1**) | **shipped** | allowed **only with the creation trigger neutralised**: on the schema as shipped the unit already owns an open range from its creation, so a hand-written second range is a real overlap → **refused** `23P01` |
| S6a/S6b/S6c registry census | **shipped** | child → `parent_id` hit; leaf → `[]`; LE → `organization_units.legal_entity_id` |

**What §6 covers, per migration** (the rev-1 table did not say this, and rev-1's
`S5b` row was measured before `1789399500000` landed):

- S1–S4 — `1789398000000`'s two carry-forward guards, on top of the G1 definitions;
- S5a–S5c — `1789396000000`'s `organization_unit_hierarchy_no_overlap` constraint
  and `organization_unit_parent_at()`;
- S6a–S6c and S7 — `1789397000000`'s `entity_reference_registry` and
  `entity_reference_census()`;
- **not covered here**: `1789399500000` (projection sync) and `1789399600000`
  (root-Central backfill). Those two are measured in §1 (fresh migration from
  zero) and §5 (the legacy clone).

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
version in force** (a business date earlier than the start of the range in force)
used to close nothing, leaving a tombstoned unit "in force" for every reader. It
is now refused by name: the unit cannot leave the structure before the version
that put it there, and no range can express it. Probe E below: refused, the
version in force still open and the unit still `inactive`; the ordinary delete
then records and closes it.

**Reachability, corrected in round 3 (§11.2).** The shape that reaches this rule
is the **legacy** one — a unit whose recorded history starts long after its
`created_at`, which is every unit the parity snapshot predates (§5), and the
fixture the acceptance test builds
(`epic-5-g2-hierarchy-history.test.ts`, "refuses a tombstone dated before the
version in force"). A **future-dated publish does not reach it**: after one, the
current instant sits inside the *sealed* `[creation, +10h)` range, so the coverage
check refuses first with its own message ("A range … is already in force at …; it
overlaps this change"). Round 2 measured exactly that (P5a), and the round-1
handoff's sentence claiming the future-dated shape was enough to reach the rule
was wrong. Both refusals are named 409s; only the rule that fires differs.

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
| E — tombstone dated before the version in force (legacy shape, §11.2) | not covered | **409** named; the ordinary tombstone then closes the range (no open range) |
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

## 11. Round-3 rework (round-2 review `changes_requested`, comment #31)

Round 2 verified the implementation and asked for two **evidence-artifact**
corrections, explicitly without touching behaviour. That is all this round did:
**no implementation file, migration or test changed** — the three artifact hashes
below are byte-identical to the revision round 2 reviewed, so the behaviour it
verified is the behaviour shipped.

### 11.1 §6 re-measured — the `S5b` row

Round 2's finding was right and is now fixed in §6. Rev 1's experiment inserted a
second range `[2026-06-01, ∞)` for a unit the probe had just created **through the
application schema**, so `1789399500000`'s
`trg_organization_units_sync_hierarchy_history` had already opened a range for
that unit at creation (`[creation, ∞)`). The insert therefore genuinely overlapped
it — a real overlap, not an adjacency test — and the rev-1 header names only
`1789396000000`, `1789397000000` and `1789398000000` as the definitions it
covers, i.e. the row was measured before the projection trigger landed and never
re-run. §6 now states which migration each probe group covers.

Re-measured with the experiment actually asking the adjacency question
(`probe-g2-shipped-v2.sql`, same `BEGIN … ROLLBACK` discipline, on
`abixell_one_epic5g2rw3`):

| Probe | Result on the shipped schema |
|---|---|
| S5a overlapping range | **refused** `23P01` (`organization_unit_hierarchy_no_overlap`) |
| S5b-shipped, as rev 1 wrote it (trigger active) | **refused** `23P01` — the unit already owns 1 open range from its creation, so this is an overlap, not adjacency |
| S5b-isolated (creation trigger disabled for the rolled-back transaction) | history rows opened at creation = **0**; back-to-back range **allowed** |
| S5b-isolated control (a real overlap, same transaction, same schema) | **refused** `23P01` — so "allowed" above is adjacency, not a disabled constraint |
| S5c `organization_unit_parent_at()` mid-range | returns the parent that holds that range |
| S1 / S2a / S2b / S3 / S4 | unchanged: teardown OK / **refused** / teardown OK / **refused** (Root Central) / non-root delete allowed |
| S6a/S6b/S6c, S7 | unchanged: `parent_id: 1` / `[]` / `legal_entity_id: 2`; registry = 2 entity types, `organization_unit` 28 columns + `legal_entity` 5 |

Adjacency on the **app path** is the other half of the same claim and it is
gapless: §10.4 probe F's partition `[-85d,-60d) [-60d,-30d) [-30d,+10h) [+10h,∞)`
shares every boundary with exactly one range open.

### 11.2 §10 corrected — which rule refuses a tombstone dated before the version in force

§10.2 no longer says the rule is reachable "the shape a legacy-shaped unit or a
future-dated publish produces", and the round-1 handoff's sentence that it is
"reachable without a legacy fixture: publish a future-dated move, then tombstone
the unit now" is corrected in place and on the card. Measured, both shapes, this
run's own database (probe file `zz-round3-probes.test.ts`, two tests, both pass):

| Probe | Shape | Result |
|---|---|---|
| P5a | fresh unit, forward-dated publish (+10h) → ranges `[creation,+10h)` sealed + `[+10h,∞)` open; deactivate; tombstone dated **now** | **409** — **the coverage check**, not the branch: `A range (…) is already in force at …; it overlaps this change`, one open range, unchanged |
| P5b | legacy shape (unit created 365 days ago, recorded history opens 10 days ago); deactivate; tombstone dated **60 days ago** | **409** — the branch: `The range in force began at …, later than the effective date …; an Organization Unit cannot leave the structure before the version that put it there`; the ordinary tombstone then **200** and **no range in force** |

So: the rule is reachable, and P5b (the shape the suite's own fixture builds) is
what reaches it; after a future-dated publish the current instant sits inside the
*sealed* range and the coverage refusal wins first. Both are named 409s — nothing
about the behaviour changed, only the sentence about which rule fires and when.

### 11.3 Verification (this run's own isolated database)

```
$ docker exec abixell-dev psql -U abixell -d abixell_one_epic5g2rw3 -tc "SELECT current_database();"
 abixell_one_epic5g2rw3            (created empty, migrated from zero:
                                    pgmigrations 75 rows, 6 of them G2,
                                    highest stamp 1789399600000,
                                    "Migrations complete!")

$ npx vitest run tests/integration/epic-5-g2-hierarchy-history.test.ts
 Test Files  1 passed (1)      Tests  18 passed (18)

$ npm run test -w apps/api      (full suite, same database)
 Test Files  2 failed | 64 passed (66)   ← role-definition + window-enforcement,
      Tests  902 passed | 27 skipped (929)  the documented by-design pair (they
                                            require DB abixell_one_epic3_wave4)

$ npm run typecheck -w apps/api → exit 0
$ npm run lint -w apps/api      → 56 problems (7 errors, 49 warnings) = baseline;
                                  no file this wave touched is named
```

Migrations: `git diff --name-status f30ce1c HEAD -- apps/api/migrations` = six
**A** lines; `git diff --name-status eaeab0f HEAD -- apps/api/migrations` empty.

Hygiene: `git status --porcelain` = this document only; `--ignored` adds
`node_modules/` and `apps/api/storage/`; no `*.log`, `*.sql`, `*.dump`, `*.bak`
or `test-*`/`validation-*` file anywhere in the worktree (the probe scripts and
their logs live outside the repo, below).

Artifact hashes at this verification (§10.6 values, re-checked unchanged):

```
92a385491ba9ab068f31f0c61a18abb29df2748b3f2e108ed126a716b46c9259  apps/api/migrations/1789396000000_epic-5-g2-hierarchy-history.cjs
34e09e44fae550e78f3623850a1ff10fba9f7da38ac352716049c27e9d229016  apps/api/src/infrastructure/persistence/repositories/organization-unit-hierarchy.repository.pg.ts
f33766b8d4436e4233b928297d15cbd12eb68f8a44238581715f59ebd8e3320c  apps/api/tests/integration/epic-5-g2-hierarchy-history.test.ts
664635dfa9e43fda0167a7511835976c7d594d54c02bc03febfbb245dc4de182  apps/api/src/domain/organization-unit/organization-unit-hierarchy.entity.ts
```

### 11.4 Evidence kept outside the repo

`%LOCALAPPDATA%\Temp\epic5g2rw3\`: `probe-g2-shipped-v2.sql` (+
`probe-shipped-v2.log`), `zz-round3-probes.test.ts` (copied in to run, deleted —
`git status` clean of it), `probes.log`, `acceptance.log`, `fullsuite.log`,
`typecheck.log`, `lint.log`, `migrate.log`, `wave.env`.

