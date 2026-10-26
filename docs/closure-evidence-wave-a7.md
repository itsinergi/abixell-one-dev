# Wave A7 Closure Evidence: Project Delivery Advanced + HSE Advanced

**Status:** Both A7 capability groups built and merged. 27 points earned.  
**Date:** 2026-10-26  
**Scope:** Project Delivery Advanced (PRJ-ADV-001…008, 13 pts) and HSE Advanced (HSE-ADV-001…007, 14 pts), under ADR-0026 and ADR-0027.

## Delivered

Wave A7 shipped as one build commit and one repair commit, squash-merged as PR #68.

| Artifact | Commit | PR |
|---|---|---|
| A7 build: both modules, schema, routes, services, integration suites | `47dda03` | #68 |
| A7 dictionary seed repair (the `47dda03` squash includes it) | `47dda03` | #68 |

PR #68's squash-merge absorbs both branch commits — `75ee56c` (build) and `0c0c84d` (dictionary seed fix). Neither branch SHA is reachable from `master`; **`47dda03` is the only citable merged artifact.**

Migrations (three, all A7-owned):

| Migration | Content |
|---|---|
| `1796000000000_wave-a7-project-delivery-advanced-schema` | 9 tables, 4 permissions, outbox event-type widening |
| `1796100000000_wave-a7-hse-advanced-schema` | 14 tables, 6 permissions |
| `1796200000010_wave-a7-dictionary-seed` | process + api-resource catalogue extension |

Migration head after A7: `1796200000010_wave-a7-dictionary-seed`. Repository migration inventory: 149.

### Project Delivery Advanced — 13 points

Nine owned tables: `project_wbs_nodes`, `project_activity_dependencies`, `project_resources`, `project_resource_assignments`, `project_baselines`, `project_baseline_lines`, `project_earned_value_snapshots`, `project_cost_entries`, `project_cost_postings`.

| Requirement | Weight | What shipped |
|---|---:|---|
| PRJ-ADV-001 WBS hierarchical decomposition | 5 (shared) | WBS tree with depth bound and rolled-up cost |
| PRJ-ADV-002 Activity dependencies and critical path | 5 (shared) | Dependency graph refusing cycles; forward/backward pass schedule with critical path |
| PRJ-ADV-003 Gantt visualisation | — (earned with the 5) | Gantt read model over the same schedule facts |
| PRJ-ADV-004 Resource loading and levelling | 3 (shared) | Resources, assignments, per-day demand against capacity |
| PRJ-ADV-005 Baseline management and variance | 3 (shared) | Baseline snapshots the plan at creation; variance reads against it |
| PRJ-ADV-006 Earned value management | 5 (shared) | Earned-value snapshots computed from recorded facts |
| PRJ-ADV-007 Project cost control | 5 (shared) | Append-only cost ledger: idempotent, reversible, cost position |
| PRJ-ADV-008 Project accounting (with Finance) | — (earned with the 5) | Cost entry hands off to the Accounting Kernel exactly once |

PRJ-ADV-003 and PRJ-ADV-008 carry no independent weight in the roadmap ledger — they are earned with the units they belong to. The 13 points are the three roadmap units 5 + 3 + 5.

### HSE Advanced — 14 points

Fourteen owned tables: `hse_investigation_frameworks`, `hse_investigations`, `hse_risk_matrices`, `hse_risk_matrix_cells`, `hse_risk_assessments`, `hse_permits`, `hse_audit_programmes`, `hse_audit_occurrences`, `hse_audit_findings`, `hse_monitoring_points`, `hse_monitoring_readings`, `hse_capas`, `hse_capa_actions`, `hse_indicator_snapshots`.

| Requirement | Weight | What shipped |
|---|---:|---|
| HSE-ADV-001 Structured investigation methodology | 5 (shared) | Versioned methodology copied onto the investigation; one investigation per record; no conclusion without root cause |
| HSE-ADV-002 Risk assessment (JSA, HIRA) with risk matrices | — (earned with the 5) | Tenant-configurable matrix that must resolve every combination; rating stored on the assessment |
| HSE-ADV-003 Permit to Work | 3 (shared) | Permit content local, lifecycle exclusively the Workflow Engine's |
| HSE-ADV-004 Planned inspection and audit programmes | 3 (shared) | Programmes, occurrences, findings; a finding raises no CAPA |
| HSE-ADV-005 Environmental monitoring | 3 (shared) | Monitoring points with thresholds; breach decided at write time |
| HSE-ADV-006 Formal CAPA management | — (earned with the 3) | Separate aggregate anchored to what it answers; closes only on verified evidence |
| HSE-ADV-007 Safety indicators and dashboards | — (earned with the 3) | Computed snapshots, frozen; no denominator means no rate |

The 14 points are the four roadmap units 5 + 3 + 3 + 3.

## Cross-cutting invariants held

**ADR-0026 (Project Delivery):**

- §1 Project owns project-cost truth; Finance owns ledger truth. `project_cost_entries` and `project_cost_postings` are Project Delivery's own tables.
- §2 Accounting Kernel is the sole GL writer. A posted cost entry produces an outbox event (`project.cost_incurred`) on `scm_accounting_ready_events`; no A7 code path writes a journal.
- §3 Earned value and cost control are advisory over recorded facts — they read the ledger and the plan, never mutate either.
- §4 Advanced never affects Core. The five A7 window rules are additive; no existing rule changed.
- §5 Money is an exact decimal string in and out. `ProjectAccountingEventInput.amount` was widened from `number` to `number | string` during this wave precisely because the narrow type forced a JS double step; `tsc` caught it.
- §6 Data Scope is fail-closed: `listScopedOrganizationUnitIds` returns `string[] | null`, where `null` means tenant-wide and an empty array means nothing.

**ADR-0027 (HSE):**

- §1 Core follow-up and Advanced CAPA are separate aggregates. `hse_capas.core_follow_up_id` is read-only; no A7 code path mutates a Core follow-up.
- §2 Investigation methodology is versioned and copied onto the investigation, never writable again.
- §3 Risk matrix is tenant-configurable; the rating is stored on the assessment at assessment time.
- §4 Permit content, validity, and isolation are owned locally; the **lifecycle is exclusively the Workflow Engine's** via `workflow_instance_id`. `hse_permits` carries **no status column** — the surface deliberately has no permit-status route.
- §5 Inspection and audit programmes are scheduled templates; a finding mutates nothing.
- §6 Environmental monitoring is measurement plus threshold; breach is decided at write time against the thresholds as they stood then.
- §7 Indicators are computed snapshots, never operator-editable.
- §8 Documents reuse Document Core.

## Evidence

| Check | Result |
|---|---|
| CI 8-Gate Pipeline, run `40315268423` at `0c0c84d` | **PASS**, all 8 gates, 2m59s |
| GATE-1 Install Dependencies | PASS |
| GATE-2 Database Migration | PASS |
| GATE-3 Platform Boundary Validation | PASS — 0 blocking, 1 advisory (Module Manifest), 235 migration-owned permissions |
| GATE-4 Lint | PASS |
| GATE-5 Typecheck | PASS |
| GATE-6 Unit Test | PASS — **106 files, 1568 tests, 0 failures, 0 skipped** |
| GATE-7 Production Build | PASS |
| GATE-8 Security Audit | PASS |
| A7 integration suite, `project-delivery-advanced.test.ts` | PASS |
| A7 integration suite, `hse-advanced.test.ts` | PASS |
| A7 combined integration total | **71 / 71** |
| `dictionary-seed-parity.test.ts` | PASS, 7/7 |
| API typecheck (`tsc --noEmit -p apps/api/tsconfig.json`) | PASS, 0 errors |
| Web typecheck (`tsc --noEmit -p apps/web/tsconfig.json`) | PASS, 0 errors |
| Migration head | `1796200000010_wave-a7-dictionary-seed` |
| Repository migration inventory | 149 |
| Migration-owned permissions | 235 (was 225 before A7; +10) |

### Full regression note

Local full-suite runs report 5 failures and 2 failed suites that CI does not see:

- `role-definition.test.ts` and `window-enforcement.test.ts` refuse to run against `abixell_one_dev` by design — they require the isolated database `abixell_one_epic3_wave4`. Not A7 regressions.
- Four tests (`accounting-kernel-routes`, `configuration`, `epic-5-g2-hierarchy-history`, `service-operations`, `wave-a5-integration`) time out at 5 s under parallel load on this machine. Both sampled suites pass when run alone (24/24). CI, running on a dedicated runner, sees 1568/1568.

This is the same parallel-load artifact recorded in the A6 baseline. It is not claimed as clean locally; it is claimed clean in CI, where the authoritative run is.

## Three defects the tests found

These were real product defects in A7 code, not test bugs. All three are fixed in `47dda03`.

1. **Unbound permit creation returned 404.** `startPermitWorkflow` caught only `ConflictError`, but `workflow.startInstance` answers `NotFoundError` when the definition does not exist at all, and `ConflictError` only when it exists without a published version. In a fresh tenant — where no seed publishes `hse_permit_lifecycle` — permit creation failed outright, so ADR-0027 §4's "the permit survives unbound and `start-lifecycle` binds it later" promise never held. Fix: catch both.

2. **Indicator rates were 10,000× too small.** `ratePerHours` scaled the quotient once while the denominator (`toScaled4(exposureHours)`) already carried 10⁴. An incident frequency rate of 1.0000 came back as 0.0001. Every HSE-ADV-007 indicator was wrong by four orders of magnitude. Fix: multiply by 10⁸, not 10⁴.

3. **The accounting hand-off forced a float.** `ProjectAccountingEventInput.amount` was declared `number`, contradicting its own comment ("bound verbatim so the amount the kernel posts is exactly the amount on the entry") and ADR-0026 §5. TypeScript refused the string at the call site. Fix: widen to `number | string`, matching the canonical `CreateScmAccountingReadyEventInput`.

## The dictionary seed repair

The first CI run on PR #68 (`40312981087`) failed GATE-6 on `dictionary-seed-parity.test.ts` with two assertions:

- 10 permissions with no seeded process row.
- 61 served routes with no seeded api-resource row.

The two A7 schema migrations catalogued the permissions and registered the routes but extended neither dictionary seed function. That is the exact drift the parity test exists to catch: a fresh tenant would receive a dictionary describing an application that no longer exists, and per CORE-ROADMAP §4.2 principle 6 a route absent from the dictionary cannot be role-locked.

The repair is `1796200000010_wave-a7-dictionary-seed`, following the rename-chain UNION pattern of `1795700000010`: snapshot both canonical functions under a `_wave_a7` suffix, redefine canonical as that snapshot UNION the new rows, backfill existing tenants. Both the process catalogue and the api-resource catalogue move together, as the A6 post-mortem requires.

## Deliberate boundary

Wave A7 delivers the API, persistence, authorization, ledger, and verification surface. What it deliberately does not deliver:

- **No Project Delivery Advanced UI.** No WBS editor, Gantt canvas, resource board, baseline comparison, or earned-value dashboard. `PRJ-ADV-003` (Gantt) is earned as a read model over schedule facts; there is no rendered chart.
- **No HSE Advanced UI.** No investigation workspace, risk-matrix editor, permit board, audit programme scheduler, monitoring chart, CAPA tracker, or indicator dashboard.
- **No seeded permit workflow.** `hse_permit_lifecycle` is not published by any migration, so a fresh tenant's permits start unbound. This is deliberate — the lifecycle definition is tenant configuration — and `start-lifecycle` is the retry path.
- **No Core follow-up write path.** CAPA references a Core follow-up read-only; it never creates or mutates one.

These are the boundary, not gaps: the A7 units were scoped as capability depth, and A7's closure claim is over that depth.

## Canonical reconciliation

| Document | Before | After |
|---|---|---|
| `docs/canonical/product-progress.md` | v1.28, Full 308/353 (87.3%), Advanced 134/179 (74.9%) | v1.29, Full **335/353 (94.9%)**, Advanced **161/179 (89.9%)** |
| `docs/canonical/product-roadmap.md` | v1.28, A7 unstarted | v1.29, A7 COMPLETED and earned |
| `docs/POINT-LEDGER.md` | Wave A7 "Not authorized — unscoped" | Wave A7 27 pts earned, v1.29 |
| `docs/ROADMAP-TO-100.md` | 308/353, A7 a target | 335/353, A7 completed |
| `docs/plans/WAVE-A6-CLOSURE-A7-A8-PLAN.md` | A7 a target, not a claim | A7 claimed; A8 still unauthorized |

Arithmetic:

```text
Advanced before A7   134 / 179 = 74.9%
+ PRJ 13            147
+ HSE 14            161 / 179 = 89.9%
Full                174 + 161 = 335 / 353 = 94.9%
```

Denominator unchanged at 174 / 353. Core Readiness unchanged at 174 / 174 = 100.0%. Pure earned progress: no scope added, reclassified, or moved.

Remaining after A7: 18 points — Wave A8 (13, unauthorized) plus `SO-ADV-006` (5, deferred).

## Closure status

Wave A7 is **built and earned**. Both capability groups merged as `47dda03` (#68) on 2026-10-26. CI run `40315268423` is green across all eight gates with 1568 tests passing and zero skipped. The headline moves from 308/353 (87.3%) to **335/353 (94.9%)**.

Wave A8 is **not** authorized. `SO-ADV-006` remains **deferred**. Track B remains **HOLD**. Release remains **NO-GO**.

**Kesimpulan Indonesia:** Wave A7 sudah selesai dibangun, digabung ke `master` sebagai `47dda03` (PR #68), dan seluruh delapan gate CI hijau dengan 1568 tes lulus tanpa satu pun dilewati. Dua kelompok kapabilitas masuk: Project Delivery Advanced (PRJ-ADV-001…008, 13 poin, sembilan tabel) dan HSE Advanced (HSE-ADV-001…007, 14 poin, empat belas tabel), lewat tiga migrasi `1796000000000`, `1796100000000`, dan `1796200000010`. Kepala migrasi sekarang `1796200000010_wave-a7-dictionary-seed`, inventaris migrasi 149, izin milik migrasi 235 (naik 10).

Yang perlu dicatat jujur: tes menemukan tiga cacat nyata di kode A7, bukan kesalahan tes. Pertama, pembuatan permit gagal 404 di tenant baru karena `startPermitWorkflow` hanya menangkap `ConflictError` padahal definisi yang belum ada melempar `NotFoundError` — janji ADR-0027 §4 bahwa permit tetap hidup tanpa ikatan workflow tidak pernah berlaku. Kedua, rumus `ratePerHours` salah skala 10.000 kali, sehingga setiap indikator HSE-ADV-007 dilaporkan jauh terlalu kecil. Ketiga, port project accounting mendeklarasikan `amount: number`, memaksa langkah float yang dilarang ADR-0026 §5. Ketiganya sudah diperbaiki.

CI pertama pada PR #68 juga merah di GATE-6: dua migrasi skema A7 mendaftarkan 10 izin dan 61 rute tetapi tidak memperluas fungsi seed kamus, sehingga tenant baru akan menerima kamus yang menggambarkan aplikasi yang sudah tidak ada. Perbaikannya migrasi `1796200000010` dengan pola rename-chain UNION yang sama seperti gelombang sebelumnya.

Angka headline naik dari 308/353 (87.3%) menjadi 335/353 (94.9%); Advanced dari 134/179 (74.9%) menjadi 161/179 (89.9%). Denominator tidak berubah dan Core Readiness tetap 100%. Sisa 18 poin: Wave A8 (13 poin, belum diotorisasi) dan `SO-ADV-006` (5 poin, ditunda). Batas yang disengaja: tidak ada antarmuka web untuk Project Delivery Advanced maupun HSE Advanced — Wave A7 adalah kedalaman kapabilitas di lapisan API, bukan lapisan layar.

## For future agent

Wave A7 is merged and earned; the merged commit `47dda03` is the authority, not this document. Both branch commits (`75ee56c` build, `0c0c84d` dictionary fix) were absorbed by the squash and are **not** reachable from `master` — do not cite them as merged artifacts.

Six traps that cost time here:

- **`hse_permits` has no status column, by design.** ADR-0027 §4 gives the lifecycle to the Workflow Engine alone. Do not add one; read status through `getInstanceForEntityOwner` instead. The route surface intentionally has no permit-status route.
- **A permit can legitimately have no workflow instance.** No migration publishes `hse_permit_lifecycle`. If you add a seed that publishes it, you change the first-run behaviour of every new tenant; if you do not, `start-lifecycle` is the retry path and permit creation must survive a missing definition. Catching only `ConflictError` is the bug that was fixed here — a missing definition is `NotFoundError`.
- **`ratePerHours` scales twice on purpose.** `toScaled4` already multiplies by 10⁴, so the quotient needs 10⁸ to come back as a 4-decimal value. Scaling once reports every rate 10,000× too small, and the tests assert exact strings (`"1.0000"`, not `"1"`).
- **Numeric columns round to their declared precision.** `score NUMERIC(10,2)` returns `"9.00"`, not `"9.0000"`; `exposure_hours NUMERIC(20,2)` returns `"200000.00"`; rates stay 4-decimal because `incident_frequency_rate` is `NUMERIC(14,4)`. Assert the column's precision, not a round number.
- **Adding a permission means extending `config_dictionary_process_seed`; adding a route means extending `config_dictionary_api_resource_seed`.** `tests/dictionary-seed-parity.test.ts` re-derives both lists from their real sources (the `permissions` table and Fastify's route table) and compares against what the seed wrote for a freshly bootstrapped tenant. It does not read the migration file, so it cannot be satisfied by a self-consistent migration. Both catalogues must move in the same migration.
- **The workflow-definition build sequence for the permit lifecycle test is five calls.** `POST /workflow/definitions` → `POST .../versions/1/steps` (one `isInitial: true` approval step plus two end steps) → `POST .../versions/1/transitions` with `actionCode` → `POST .../versions/1/assignment-rules` with `assignmentType: "role"` → `POST .../versions/1/publish`. `availableActions` is computed only when the instance is `in_progress`, the step is pending, and the actor is eligible for the assignment — a user holding `hse.advanced.manage` but not the assigned role gets `[]`, which is correct and is asserted.

Local full-suite runs on this machine show five 5-second timeouts and two suites that refuse `abixell_one_dev`. Both are pre-existing and environmental: the two suites require `abixell_one_epic3_wave4`, and the four timeouts pass in isolation. CI on a dedicated runner sees 1568/1568. Do not treat a local full-suite red as an A7 regression without checking CI first.
