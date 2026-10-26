# Abixell One — Product Progress

| | |
|---|---|
| **Document Status** | CANONICAL |
| **Authority** | Founder (Insting Tekno Sinergi) |
| **Roadmap Baseline** | v1.28 |
| **Progress Model** | v1.0 |
| **Last Updated** | 2026-10-26 |
| **Measured at** | Wave A6 closure on 2026-10-26: `WP-FIN-A6-01…06` all built and all six units now carry closure evidence, so Wave A6 earns its full 21 of 21. Build evidence: WP-FIN-A6-05 API-first verified with 36/36 focused integration tests (migrations `1795500000000`–`1795500000020`); WP-FIN-A6-06a tax baseline merged as `7f87018` (#62, ADR-0019); WP-FIN-A6-06b consolidation/FSV/translation/eliminations verified with 32/32 focused integration tests (migrations `1795700000000`–`1795700000010`, ADR-0022), full API regression 1465 passed / 27 skipped (a further 5 tests time out at the 5s limit under parallel load and pass when their files run in isolation), API typecheck PASS, platform-boundary validator PASS. UI evidence: A6.1 read-only pages `08e2ea5` (#66, the squash-merge that absorbed the terminology fix); A6.2 write pages via migration `1795900000000`, with route-registry parity 8/8, menu seed parity 10/10, menu terminology 9/9, and menu filter 5/5, both typechecks PASS. Evidence: [closure-evidence-wave-a6.md](../closure-evidence-wave-a6.md). |
| **Related** | [PRD](../prd/abixell-one/00-README.md) · [product-roadmap.md](product-roadmap.md) · [product-blueprint.md](product-blueprint.md) · [documentation-map.md](documentation-map.md) |

---

## 1. Headline

| Metric | Value | Δ since v1.27 |
|---|---:|---:|
| **Core Product Readiness** | **100.0 %** | — 0.0 pts |
| **Full Approved Roadmap Progress** | **87.3 %** | + 21.0 pts |

Two metrics are reported deliberately. A single number would misrepresent the product: the deployable Core is far more mature than the full Advanced roadmap, and optional Advanced depth should not make a usable product look unfinished.

- **Core Product Readiness** = Platform Core + Business Core + required Platform Hardening.
- **Full Approved Roadmap Progress** = Core Product Readiness + all approved Advanced capabilities.
- **Client Extensions are excluded from both** — custom client work must never shrink product completion.
- **Unweighted architecture/governance phases earn no points.** Phases 11A, 11B, 11C, 11D, 11E, and 11F are recorded for governance traceability without moving either metric.

The canonical implementation baseline is the committed tip `c3fe17e` (Epic 2 Wave 2-3 merged), which follows Wave A5.1 SCM decomposition at `7b66c65`. The latest development handoff reports 586/586 API tests across 39 files, 149 migration-owned permissions, 0 blocking boundary findings and 1 expected Manifest advisory; typecheck, production build, PWA validation, all 10 E2E smoke journeys and browser console checks passed; lint reported 0 errors and 45 warnings. These are recorded delivery results from [the latest handoff](../handoff.md#3-verification-results) measured at `7b66c65`, not tests rerun during this documentation reconciliation.

Phase 0 Track A hardening (unweighted) ran on 2026-10-06 against the committed baseline and is recorded in [TRACK_A_EXECUTION_LOG.md](../../abixell-one-e2e-plan/14_execution_plan/TRACK_A_EXECUTION_LOG.md). It fixed all 11 discovered platform-boundary violations, seeded `packages/contracts`, and reconciled these canonical documents. Fresh Track A evidence: platform-boundary validation `0` blocking / `1` expected advisory / `197` migration-owned permissions; `apps/api` and `apps/web` typecheck and lint both `0` errors. Track A did **not** rerun the API unit suite (sandbox timeout — an evidence gap, not a failure), the production build, PWA validation, `npm audit`, the browser smoke suite, or the launcher `db:up`. Track A adds no roadmap weight: it is stabilization of already-counted capability.

Wave A5.1 separates Warehouse Management (36 tables, 12 domain services, `/wms/*`) and Procurement Management (12 tables, 5 domain services, `/procurement/*`), with shared master-data ports, accounting-event ports, legacy route compatibility and frontend response normalization. These domain ownership counts are not a fresh count of the complete live database. The previous 165-table measurement belongs to Wave A5, not this baseline. Repository migration inventory is recorded in the roadmap; applied database state was not remeasured.

**Reconciliation rule:** the handoff is the latest historical development record for full delivery validation, but its v1.19 / 51.0% headline is stale relative to completed Waves A1–A6 in canonical v1.28. This update advances documentation to v1.28 without rolling back earned progress: Core remains 174/174 (100.0%), Advanced 134/179 (74.9%), and Full 308/353 (87.3%). A5.1, Epic 2 Wave 2-3 foundation, and Phase 0 Track A hardening earn no additional roadmap weight. Wave A6's 21 points are earned, not authorized-only: every one of its seven build units is merged and every capability group carries accepted closure evidence. This evidence does not authorize Wave A7, Wave A8, Track B, release, or other pending work.

Wave A5 delivers 22 weighted Advanced points across 6 completed capability groups:
1. **Multi-warehouse, Storage Topology, Batch & Serial Tracking** (`SCM-ADV-001/002/003`, 5 pts): Hierarchical warehouses and location bins, batch/lot tracking with manufacturing/expiry dates and quarantine status, individual item serial tracking with warranty periods and movement audit.
2. **Stock Reservations, Reorder Policies, Inter-Warehouse Transfers & Opname Reconciliation** (`SCM-ADV-004`, 3 pts): Demand reservation holds with release lifecycles, dynamic reorder thresholds with alert generation, multi-stage transfer shipments and receipts, and physical stock opname discrepancy counting with automatic compensating ledger adjustments.
3. **Inventory Valuation & Landed Cost Vouchers** (`SCM-ADV-005`, 3 pts): FIFO valuation layer tracking with depletion history, landed cost vouchers allocating freight/customs/insurance across PO lines via exact-decimal fixed-point algorithms (`by_value`, `by_quantity`, `by_weight`, `equal`), and effective unit cost recalculation.
4. **RFQs, Tenders, Supplier Quotations, Comparative Scoring & Award** (`SCM-ADV-006`, 5 pts): Request for Quotation lifecycle with workflow delegation, supplier quotation submissions with line-item pricing and validity dates, multi-criteria comparative scoring, and quotation award with purchase order conversion.
5. **Supplier Evaluation Scorecards & Master Purchasing Contracts** (`SCM-ADV-007`, 3 pts): Periodic supplier evaluation scorecards across quality/delivery/commercial criteria with workflow review, and master blanket purchasing contracts with spend limits and validity periods.
6. **Spend Analytics Snapshots** (`SCM-ADV-008`, 3 pts): Bounded, tenant-safe parameterized analytical projections with category/supplier breakdowns and time-bucket aggregations protected by a 15-second local statement timeout.

The correction commit `5eba91a` closes four defects found while validating `95b346a` — a permission bypass on automation-proposal approval, quotation money computed in binary floating point, Price Books resolved against a UTC rather than local date, and an automation-rules panel that was fetched but never rendered — plus the trailing-whitespace blocker. A regression test now pins exact-decimal quotation arithmetic and was verified against a deliberately reverted implementation.

The post-closure stabilization commit `e7ab06a` closes both previously recorded intermittent signatures without changing Scheduler production semantics. `scheduled_jobs.job_code` and execution leases remain global by contract. Integration files now register unique fixture job rows (using the real production handler keys) instead of sharing and resetting production job rows. The outbox lifecycle boundary now stays entirely in PostgreSQL (`now()` and `SELECT deactivated_at`) rather than round-tripping a microsecond-precision `timestamptz` through millisecond-precision JavaScript `Date`. No arbitrary sleep, retry, skip, weakened assertion, status-code change, or business-behavior change was introduced.

Browser smoke passes separately from the API count: the existing 10-scenario Phase 11F suite, plus an 8-scenario Wave A1 smoke (both new surfaces, tab navigation, Founder gating, three viewports, and expired-session protection) with zero console, page, or network diagnostics. The required `npm run e2e -w apps/web` also passed its 10-step suite after the documented API `:4000` and Web `:5173` prerequisites were started; its initial invocation failed transparently with `ERR_CONNECTION_REFUSED` while those servers were absent.

Commit `3df1718` (Phase 11A documentation) and the Phase 11B repository-governance changes remain non-runtime and imply no schema or API test evidence of their own. Phase 11B's 23/23 focused dependency-free boundary tests continue to pass with 0 blocking findings and the expected documentary Manifest advisory, alongside typecheck, lint, production build, and PWA validation.

### Known limitation recorded at this baseline

The scheduler/outbox flakiness recorded at the prior closure baseline is resolved and is no longer a known issue. Final evidence on the stabilized tree is five consecutive full API runs at 390/390, one additional `--no-file-parallelism` run at 390/390, and focused Scheduler/outbox coverage at 27/27, all with zero skipped tests. Fixture cleanup was verified directly: no `test-0e-*`, `test-0f-*`, or `test-h2-*` Scheduler rows remained.

1. **Launcher (`RUN-ABIXELL-ONE.bat`) is environment-blocked, not verified PASS.** Its `npm run db:up` step cannot be exercised on this machine: the Docker daemon is not reachable (`dockerDesktopLinuxEngine` pipe absent) *and* native Windows `postgres.exe` (PID 8468, Windows Service) owns port 5432, including `127.0.0.1:5432`, the exact binding `infra/postgres/docker-compose.yml` requests. Per Founder constraint the native service was not stopped or modified, and the launcher was not changed to mask the conflict. Re-inspected line-by-line at this baseline (Wave A4 final precision & canonical closure): repo path resolution, Docker/Node presence checks, `.env` bootstrap, and the `db:up -> migrate -> seed -> sync-permissions -> dev:api/dev:web` step order remain correct, with no destructive operation (`docker compose down -v` is never invoked) — no defect found, and the launcher file was not edited. Steps downstream of `db:up` remain independently verified against the live native database, as do typecheck, lint, build, PWA, boundaries, production dependency audit, API/Web surfaces, and the full 10-step E2E browser suite (API `:4000` / Web `:5173`, started and stopped directly without touching Docker or the native PostgreSQL service). The launcher is therefore **PARTIAL / ENVIRONMENT-BLOCKED**; a full end-to-end launcher PASS is not claimed.

---

## 2. Layer progress

| Layer | Completed / Total | % |
|---|---:|---:|
| Platform Core | 41 / 41 | **100 %** |
| Platform Hardening | 16 / 16 | **100.0 %** |
| Business Core | 117 / 117 | **100 %** |
| Advanced Capabilities | 134 / 179 | **74.9 %** |

Unit-level mapping of these totals (which named unit owns which point, built vs earned):
see [POINT-LEDGER.md](../POINT-LEDGER.md). That file is derivative — the numbers above and
in §4 remain canonical.

## 3. Per-module progress

### Business Core only
| Module | Completed / Total | % |
|---|---:|---:|
| Customer & Commercial | 9 / 9 | **100 %** |
| Service Quality (Complaint) | 15 / 15 | **100 %** |
| Survey & Assessment | 9 / 9 | **100 %** |
| Service Operations & Work Mgmt | 13 / 13 | **100 %** |
| Workforce (HR) Core | 10 / 10 | **100 %** |
| Supply Chain Core | 14 / 14 | **100 %** |
| Asset Core | 8 / 8 | **100 %** |
| Finance Core | 12 / 12 | **100 %** |
| HSE Core | 9 / 9 | **100 %** |
| Project Delivery Core | 8 / 8 | **100 %** |
| Reporting & Operational Insight | 10 / 10 | **100 %** |

### Module including its Advanced capabilities
| Module | Completed / Total | % |
|---|---:|---:|
| Customer & Commercial | 17 / 17 | **100 %** |
| Service Quality (Complaint) | 26 / 26 | **100 %** |
| Survey & Assessment | 28 / 28 | **100 %** |
| Asset Core | 19 / 19 | **100 %** |
| Workforce (HR) Core | 34 / 34 | **100 %** |
| Reporting & Operational Insight | 20 / 20 | **100 %** |
| Service Operations & Work Mgmt | 21 / 26 | 80.8 % |
| Supply Chain Core | 36 / 36 | **100 %** |
| Project Delivery Core | 8 / 21 | 38.1 % |
| Finance Core | 12 / 33 | 36.4 % |
| HSE Core | 9 / 23 | 39.1 % |
| Platform (cross-cutting Advanced) | 0 / 13 | 0 % |

---

## 4. Progress Calculation Basis

Weight model: **S=1 · M=2 · L=3 · XL=5** per Roadmap Unit.
Earned rule: `COMPLETED = full weight`; `IN PROGRESS = 0` (conservative, no estimation); `PLANNED/DEFERRED = 0`.

```text
Platform Core          total  41   completed  41
Platform Hardening     total  16   completed  16   (+7 — Phase H2 Production Hardening)
Business Core          total 117   completed 117
Advanced Capabilities  total 179   completed 134   (+19 — Wave A1; +23 — Wave A2; +19 — Wave A3 revised; +24 — Wave A4; +22 — Wave A5; +21 — Wave A6)

Core Product Readiness
  denominator = 41 + 117 + 16 = 174   (unchanged)
  completed   = 41 + 117 + 16 = 174
  in-progress earned          =   0
  (174 + 0) / 174 × 100 = 100.0 %

Full Approved Roadmap
  denominator = 174 + 179 = 353       (unchanged)
  completed   = 174 + 134 = 308
  (308 + 0) / 353 × 100 = 87.3 %

Wave A6 earned weight (six capability groups COMPLETED, full weight each):
  GL, chart of accounts, and journal               FIN-ADV-001          (COA, Journals, Posting)            5
  AP/AR and aging                                  FIN-ADV-002          (Open Items, Allocation, Aging)     3
  Budgeting and cost center                        FIN-ADV-003          (Versions, Consumption, Control)    3
  Bank reconciliation                              FIN-ADV-004          (Import, Matching, Close)           2
  Fixed-asset accounting and depreciation          FIN-ADV-005          (Books, Runs, Disposal)             3
  Tax, consolidation, and financial statements     FIN-ADV-006/007/008  (Tax, FSV, Consolidation)           5
                                                                                                    = 21
  Advanced completed 113 + 21 = 134 · Full completed 287 + 21 = 308

Wave A5 earned weight (six capability groups COMPLETED, full weight each):
  Multi-Warehouse, Bin, Batch & Serial Tracking     SCM-ADV-001/002/003 (Topology, Batches, Serials)      5
  Reservations, Reorder, Transfers & Opname         SCM-ADV-004         (Holds, Alerts, Transfers, Opname) 3
  Valuation & Landed Cost Vouchers                  SCM-ADV-005         (FIFO Layers, Landed Costs)       3
  RFQs, Tenders, Quotations, Scoring & Award        SCM-ADV-006         (Tenders, Bids, Scoring, PO Conv) 5
  Supplier Scorecards & Master Contracts            SCM-ADV-007         (Evaluations, Blanket Contracts)  3
  Spend Analytics Snapshots                         SCM-ADV-008         (Spend & Category Projections)    3
                                                                                                    = 22
  Advanced completed 91 + 22 = 113 · Full completed 265 + 22 = 287
```

**Consistency check (§79):** sum of module weights equals the layer denominators —
Business Core `9+15+9+13+10+14+8+12+9+8+10 = 117` ✓ ·
Platform Hardening `3+2+2+3+2+1+1+2 = 16` (completed `16`) ✓ ·
Advanced `8+11+19+13+24+21+22+11+13+14+13+10 = 179` ✓ ·
Core denominator `41+117+16 = 174` ✓ · Full denominator `174+179 = 353` ✓.
Arithmetic was recomputed programmatically and by hand; both agree.

### Assumptions
1. Survey-to-Action (Phase 1E) is counted as **Advanced — delivered**, not Business Core (pending FD-B).
2. `CUS.4` (Customer admin UI) is COMPLETED: Phase 10 added dedicated screens plus backend maintenance routes over Customer & Commercial master records.
3. Platform Hardening is inside Core Readiness because a client cannot go live without it.
4. Individual client configuration data is **not** product progress.
5. Advanced units are approved-but-optional; their presence lowers the *Full* metric without implying regression.

---

## 5. Completed roadmap units (evidence-backed)

| Unit(s) | Evidence |
|---|---|
| PC-1…PC-13 | Phase 0 checkpoints 0A–0F; migrations `1755500000000`–`1756000000000`; `phase0-stabilization.test.ts`, `workflow.test.ts`, `configuration.test.ts`, `shared-services.test.ts`, `vertical-slice.test.ts`; `docs/phase0-final-review.md` |
| PH-1, PH-2, PH-5, PH-6, PH-7 | Phase H (Pilot Hardening); `.github/workflows/ci.yml`, `apps/api/src/infrastructure/security/http-hardening.ts`, `operational-complaint-experience.test.ts` batch queries, `phase0-stabilization.test.ts` (CORS/headers/rate-limit), `react-router-dom` v7.18.2 upgrade, PNG 192/512 icons, `scripts/validate-pwa.mjs`; commit `05c3a11` |
| PH-3, PH-4, PH-8 | Phase H2 (Production Hardening); backup/restore/verification scripts and DR runbook; multi-stage API operations/runtime and Web images; environment-validated Compose deploy/migrate/health/smoke flow; migrations `1771000000000`, `1772000000000`; durable Tenant-scoped Integration outbox with reconciliation, stale-claim recovery, bounded retry, terminal visibility, and concurrent `SKIP LOCKED` claims; `phase-h2-integration-outbox.test.ts` (14); isolated restore drill (1 document checksum), migration up/down/up, fresh and repeated deployment validated; commits `0e24edb`, `37f7343` |
| CUS.1–CUS.4 | Phase 1A + Phase 10; migration `1757000000000`; `customer-foundation.test.ts` (18); frontend page (customer/commercial admin UI + maintenance controls); commit `89fbff4` |
| CMP.1–CMP.7 | Phases 1B/1C; migrations `1758000000000`, `1759000000000`; `complaint-engine.test.ts` (16), `customer-complaint-experience.test.ts` (8), `operational-complaint-experience.test.ts` (10), `verification-complaint-experience.test.ts` (7), `management-dashboard.test.ts` (7), `complaint-configuration.test.ts` (7) |
| FIN.1–FIN.6 | Phase 6; migration `1767000000000`; `finance.test.ts` (21); commits `f901de5`, `317f1c2` |
| HSE.1–HSE.4 | Phase 7; migration `1768000000000`; `hse.test.ts` (28); frontend pages (register, report, detail); commits `463b94d`, `7964a35`, `105810f`, `a7bcd2a`, `e146f95`, `094c918`, `b032355`, `bae485a` |
| PRJ.1–PRJ.4 | Phase 8; migration `1769000000000`; `project-delivery.test.ts` (9); frontend pages (list, detail/progress/documents); commit `fc6e4a2` |
| RPT.1–RPT.4 | Phase 9; migration `1770000000000`; `reporting-insight.test.ts` (5); frontend page (reports/dashboard/export); commit `81df359` |
| AST.1–AST.4 | Phase 5; migration `1766000000000`; `asset.test.ts` (18); commits `b238b07`, `6ad67e7` |
| SRV.1–SRV.3 | Phase 1D; migrations `1760000000000`, `1760000100000`; `survey-engine.test.ts` (16); commit `5c6e14a` |
| ADV-SRV Survey-to-Action ×2 | Phase 1E; migrations `1761000000000`, `1762000000000`; `survey-integration.test.ts` (18); commits `8d64666`, `9fb8bbf`, `b7b6d64` |
| CUS-ADV-001, CUS-ADV-002, SQ-ADV-001…004 | Wave A1; migrations `1776000000000`, `1777000000000`; `wave-a1-integration.test.ts` (36); commits `95b346a`, `5eba91a`, `d9ed34b`, `e7ab06a` |
| SUR-ADV-003…007, RPT-ADV-001…002 | Wave A2; migration `1778000000000`; `wave-a2-integration.test.ts` (23); full test suite (413) |
| PACK-001…004, SO-ADV-002…005, AST-ADV-001…007 | Wave A3 (revised); migration `1779000000000`; `wave-a3-integration.test.ts` (29); full test suite (442) across 32 files |
| HR-ADV-001…009 | Wave A4; migration `1780000000000`; `payroll-policy.test.ts` (7) & `wave-a4-integration.test.ts` (26); full test suite (475) across 34 files |
| SCM-ADV-001…008 | Wave A5; migration `1781000000000`; `wave-a5-integration.test.ts` (20) within the 495/495 full API regression across 35 files, plus separate focused valuation unit tests `valuation-policy.test.ts` (14/14) executed outside that full API regression |
| SCM bounded-context decomposition | Wave A5.1 (unweighted); commits `5642284` through `7b66c65`; migrations `1782000000000`, `1783000000000`, `1784000000000`; explicit WMS and Procurement modules, canonical routes, compatibility shim, ports and frontend normalization; latest handoff reports 586/586 API tests across 39 files and 149 migration-owned permissions |
| FIN-ADV fiscal close, open items, budget control, bank reconciliation | WP-FIN-A6-01 fiscal close and ledger governance `e54d76c` (#42), migrations `1795100000000`, `1795100000010`; WP-FIN-A6-02 open item settlement and aging `010ba93` (#57), migrations `1795200000000`, `1795200000010`; WP-FIN-A6-03 budget control `009c8a4` (#58), migrations `1795300000000`, `1795300000010`; WP-FIN-A6-04 bank reconciliation `0ed302c` (#59), migrations `1795400000000`, `1795400000010`; focused integration 8/8, 13/13, 12/12, 22/22; write UI delivered by Wave A6.2 pages `/finance/journals`, `/finance/open-items`, `/finance/budgets`, `/finance/bank-recon` (migration `1795900000000`) |
| FIN-ADV fixed-asset accounting and depreciation | WP-FIN-A6-05 API-first implementation; migrations `1795500000000`, `1795500000010`, `1795500000020`; asset-book module, exact-cents straight-line depreciation, immutable/idempotent runs, linked reversals, Accounting Kernel GL posting; focused integration 36/36, typecheck PASS, boundary validator PASS; write UI delivered by Wave A6.2 page `/finance/fixed-assets` (migration `1795900000000`) |
| FIN-ADV tax, consolidation, and financial statements | WP-FIN-A6-06a tax baseline merged `7f87018` (#62, ADR-0019); migrations `1795600000000`, `1795600000010`. WP-FIN-A6-06b consolidation merged `8bb062a` (#63, ADR-0022); migrations `1795700000000`, `1795700000010`; consolidation groups, effective-dated FSV metamodel, FX rate sets, exact integer-hundred-millionths translation with no 1:1 fallback, elimination journals written only through the Accounting Kernel; focused integration 32/32, full API regression 1465 passed / 27 skipped (a further 5 tests time out at the 5s limit under parallel load and pass when their files run in isolation), typecheck PASS, boundary validator PASS; tax write UI delivered by Wave A6.2 page `/finance/tax` (migration `1795900000000`); consolidation and statement surfaces stay read-only on `/finance/statements` by ADR-0022 |

## 6. Pending roadmap units

All Advanced units except the delivered Survey-to-Action units (2), Wave A1 units (6), Wave A2 units (7), Wave A3 units (5), Wave A4 units (6), Wave A5 units (6), and the six completed Wave A6 Finance capability groups. The remaining Advanced backlog is 45 points: Wave A3 deferred `SO-ADV-006` (5 pts), Wave A7 Project Delivery + HSE work (27), and Wave A8 platform cross-cutting work (13). These waves remain optional and out of Core scope. Platform Hardening has no pending roadmap units.

## 7. Active phase

**Phase 0 Track A — Boundary Hardening & Contracts Seed (unweighted).** Founder-authorized 2026-10-06 to stabilize platform boundaries discovered during Phase 0 discovery, seed shared API/Web contracts, and reconcile canonical documentation. Scope: BN-01 (11 boundary-discipline findings), BN-02 (7 lint errors), BN-03 (validator parser fix), BN-04 (env vars), BN-05 (mode cleanup), BN-06 (contracts seed), BN-07 (canonical docs). Track B (next-phase E2E work) = HOLD. Release = NO-GO. Evidence recorded in [TRACK_A_EXECUTION_LOG.md](../../abixell-one-e2e-plan/14_execution_plan/TRACK_A_EXECUTION_LOG.md).

Completed phases: Phase 10, Phase H (Pilot Hardening), Phase H2 (Production Hardening), unweighted Phases 11A/11B/11C/11D/11E/11F, weighted Advanced Waves A1–A6, unweighted Wave A5.1, and all Core Product Readiness units.

Pending: Waves A6–A8, Phase 11G, deferred `SO-ADV-006`, and Track B (Phase 0 expanded scope). These remain awaiting separate Founder authorization.

## 8. Progress change log

### v1.28 — 2026-10-26: Wave A6 (Finance Advanced) delivered — weighted

Twenty-one Advanced points earned across six capability groups, each COMPLETED at full weight: GL/COA/journal (`FIN-ADV-001`, 5), AP/AR and aging (`FIN-ADV-002`, 3), budgeting and cost center (`FIN-ADV-003`, 3), bank reconciliation (`FIN-ADV-004`, 2), fixed-asset accounting and depreciation (`FIN-ADV-005`, 3), tax/consolidation/financial statements (`FIN-ADV-006/007/008`, 5). Advanced completed 113 → 134; Full numerator 287 → 308 (81.3 % → 87.3 %). Denominator unchanged at 174 / 353 and Core Readiness unchanged at 100.0 % — pure earned progress, no scope added or reclassified.

Build evidence: seven work packages merged as `e54d76c` (#42), `010ba93` (#57), `009c8a4` (#58), `0ed302c` (#59), `f394209` (#61), `7f87018` (#62), `8bb062a` (#63), with fifteen migrations `1795100000000`–`1795700000010`; focused integration 144/144 across the seven suites; 88 `/accounting/*` route registrations on 81 unique paths, all mapped to an existing Window; API typecheck PASS; platform boundary validator PASS.

UI evidence: Wave A6.1 read-only pages `/finance/accounting` and `/finance/statements` (`08e2ea5` #66, which absorbed the terminology fix), migration `1795800000000`; Wave A6.2 write pages `/finance/journals`, `/finance/open-items`, `/finance/budgets`, `/finance/bank-recon`, `/finance/fixed-assets`, `/finance/tax`, migration `1795900000000`. Route-registry parity 8/8, menu seed parity 10/10, menu terminology 9/9, menu filter 5/5; both typechecks PASS; menu catalogue 65 rows with the terminology allowlist matching 65 = 65, and zero tenant menus with a NULL `window_id` or no tree row.

Boundaries held: the Accounting Kernel remains the sole GL writer and no A6 module writes journals directly; money is a string in and out with amounts settling at two-decimal integer cents; every mutation is authorized through the existing `finance.accounting.*` permission family and audited; no permission was introduced and no `role_permissions` row was written. `FIN-ADV-007` consolidation and `FIN-ADV-008` financial statements remain read-only on `/finance/statements` by ADR-0022, which puts consolidation posting behind the kernel and the approval runtime — that is the delivered boundary, not an open gap.

This evidence does not authorize Wave A7, Wave A8, Track B, or release. Track B remains HOLD; Release remains NO-GO. Evidence: [closure-evidence-wave-a6.md](../closure-evidence-wave-a6.md).

### v1.27 — 2026-10-06: Phase 0 Track A boundary hardening (unweighted)

Unweighted Phase 0 stabilization under Founder-authorized governance exception `EXC-TAEXEC-001` (recorded in `abixell-one-e2e-plan/15_master_development_plan/MASTER_DEVELOPMENT_DECISION_LOG.md`). Canonical reference moves to committed baseline `c3fe17e` (91 repository migrations). BN-01 fixed all 11 discovered platform-boundary-discipline violations across API/Web; BN-03 fixed a boundary-validator parser defect that undercounted permission codes containing a semicolon; the corrected validator reports 0 blocking findings, 1 expected Manifest advisory, and 197 migration-owned permissions (up from 149 at `7b66c65`, through migrations committed en route to `c3fe17e` plus the BN-01/BN-03 corrections). BN-02 fixed 7 lint errors. BN-06 seeded `packages/contracts` with foundational Error-envelope, Auth, Navigation, Role-assignment, master-data record, and RBAC DTOs (not yet imported by either app). BN-05 diagnosed 721 dirty-tree entries as Windows-mount mode/EOL noise (10 files carry real Track A changes); no destructive git operation was run. BN-07 is this reconciliation. Fresh verification: `apps/api` and `apps/web` typecheck 0 errors; lint 0 errors (49 pre-existing warnings, out of scope). Not rerun: API unit/integration suite (sandbox timeout, evidence gap — see `TRACK_A_EXECUTION_LOG.md`), production build, PWA validation, `npm audit`, browser E2E smoke, launcher `db:up`. Core remains 174/174 (100.0%); Full remains 287/353 (81.3%); no roadmap unit, numerator, or denominator changed — this is unweighted hardening, not new capability. Track B remains HOLD; Release remains NO-GO.

### v1.26 — 2026-09-15: Wave A5.1 reconciliation

Unweighted closure of accounting-readiness receiving/reversals and SCM decomposition into WMS and Procurement. Delivery source: [handoff](../handoff.md), sections 2–4; implementation commit `7b66c65`. Reported validation: 586/586 API tests, 39 files, 149 migration-owned permissions, 0 boundary blockers and 1 advisory, typecheck/build/PWA/E2E PASS, lint 0 errors and 45 warnings, browser console 0 errors. Core 100.0% and Full 81.3% remain unchanged; prior history below is preserved. No fresh live database count or runtime rerun is claimed. The handoff's v1.19/51.0% metadata is superseded by this reconciliation, not adopted as a progress regression.


| Baseline | Date | Core Readiness | Full Roadmap | Note |
|---|---|---:|---:|---|
| v1.28 | 2026-10-26 | 100.0 % | 87.3 % | **Wave A6 (Finance Advanced) delivered — weighted.** Numerator +21 across six capability groups: GL/COA/journal (`FIN-ADV-001`, 5), AP/AR + aging (`FIN-ADV-002`, 3), Budgeting & cost center (`FIN-ADV-003`, 3), Bank reconciliation (`FIN-ADV-004`, 2), Fixed-asset accounting & depreciation (`FIN-ADV-005`, 3), Tax/consolidation/statements (`FIN-ADV-006/007/008`, 5). Advanced 113 → 134; Full 287 → 308. Denominator unchanged at 174 / 353 and Core Readiness unchanged at 100.0 % — pure earned progress, no scope added or reclassified. Seven build units merged (`e54d76c` #42, `010ba93` #57, `009c8a4` #58, `0ed302c` #59, `f394209` #61, `7f87018` #62, `8bb062a` #63) across migrations `1795100000000`–`1795700000010`; focused integration 144/144. UI delivered in two waves: A6.1 read-only pages (`08e2ea5` #66, `9549709` absorbed into it, migration `1795800000000`) and A6.2 write pages (migration `1795900000000`). Catalog evidence: route window catalogue 79 rows, menu catalogue 65 rows, terminology allowlist 65 = 65, route-registry parity 8/8, menu seed parity 10/10, menu terminology 9/9, menu filter 5/5, both typechecks PASS, zero tenant menus with NULL `window_id`, zero with no tree row. Boundaries held: Accounting Kernel sole GL writer; money string in and out at two-decimal integer cents; existing `finance.accounting.*` permissions only, no new permission and no `role_permissions` row. `FIN-ADV-007` and `FIN-ADV-008` remain read-only by ADR-0022. Waves A7–A8, `SO-ADV-006` (deferred), Track B, and Release remain unstarted; Release NO-GO. |
| v1.25 | 2026-09-01 | 100.0 % | 81.3 % | **Wave A5 (Supply Chain Advanced) delivered — weighted.** Numerator +22 across six capability groups: Multi-Warehouse, Bin, Batch & Serial Tracking (`SCM-ADV-001/002/003`, 5), Reservations, Reorder, Transfers & Opname (`SCM-ADV-004`, 3), Valuation & Landed Cost (`SCM-ADV-005`, 3), RFQ/Tender/Bid Scoring & Award (`SCM-ADV-006`, 5), Supplier Scorecards & Master Contracts (`SCM-ADV-007`, 3), Spend Analytics (`SCM-ADV-008`, 3). Advanced 91 → 113; Full 265 → 287. Denominator unchanged at 174 / 353 and Core Readiness unchanged at 100.0 % — pure earned progress, no scope added or reclassified. Live database evidence: 165 application base tables (166 including `pgmigrations`, plus one public VIEW), 33 migrations, 128 permissions (0 duplicate codes, 14 added by Wave A5), and migration head `1781000000000_wave-a5-supply-chain-advanced`. Test evidence: 495/495 full API regression runs across 35 files, with Wave A5 adding 20 tests in `wave-a5-integration.test.ts`; additional focused valuation unit coverage is 14/14 in `valuation-policy.test.ts`, executed separately from the full API regression. Quality gates PASS: platform boundaries (23/23 tests, 0 blocking findings, 128 migration-owned permissions), lint (0 errors), typecheck (0 errors), build (API and Web clean), PWA validation, `npm audit --omit=dev` (0 vulnerabilities). Centralized hierarchical Organization Unit Data Scope is enforced through `RbacService` with fail-closed empty-scope semantics across every Supply Chain Advanced access path; every new relationship carries composite `(tenant_id, id)` foreign keys preventing cross-tenant referencing; the Advanced Stock Ledger is append-only with atomic balance mutation under pessimistic row locks and corrections applied only via compensating ledger rows; stock transfers, opnames, RFQs, supplier evaluations, and purchasing contracts delegate lifecycle ownership exclusively to the Workflow Engine (`workflow_instance_id` as source of truth, zero competing local state machines); inventory valuation and landed-cost allocation use exact scaled-integer fixed-point arithmetic with zero authoritative floating-point drift; spend analytics queries are bounded, tenant-safe, and parameterized under a 15-second local statement timeout. Launcher remains PARTIAL / ENVIRONMENT-BLOCKED at `db:up` (Docker daemon unreachable; native Windows `postgres.exe` owns port 5432); downstream migrate/seed/sync-permissions/dev steps were re-inspected for Wave A5 compatibility and required no launcher change. Waves A6–A8, `SO-ADV-006` (deferred), Phase 11G, Platform Builder, Module Manifest runtime, and Client Extensions remain unstarted. |
| v1.24 | 2026-09-01 | 100.0 % | 75.1 % | **Wave A4 final precision and canonical closure completed (unweighted correction).** No product unit, numerator, or denominator change — Advanced remains 91/179 and Full remains 265/353 at 75.1 %. This is a pre-closure correction pass over the already-delivered Wave A4 baseline, not new roadmap scope. Three items were addressed: (1) centralized hierarchical Organization Unit Data Scope enforcement across every Workforce Advanced list, detail, mutation, workflow, calculation, apply, and document-authorization access path (ADR-0009/ADR-0012), replacing per-endpoint ad hoc checks; (2) approved-overtime aggregation in `calculatePayrollRun()` now sources `actual_hours` with `estimated_hours` fallback, excludes pending/rejected/cancelled requests, avoids double-counting, and preserves approved/closed payroll run immutability; (3) elimination of authoritative floating-point drift in `payroll-policy.ts` — `toCents`/`mulRateCents`/`divCents` now parse exact-decimal strings instead of `Math.round(value * scale)` and fail closed with `ValidationError` (HTTP 400) on non-finite, NaN, exponential, or excessive-scale input instead of silently coercing to `0n`. A pre-existing, unrelated Wave A3 test defect was also fixed in a separate commit: `wave-a3-integration.test.ts`'s reliability-analytics window was hardcoded to a historical August 2026 date range being compared against a server-stamped `completed_at = now()`, which failed once the wall clock passed the window; the fix anchors `periodEnd` to the actual test-run date. Live database evidence refreshed with fresh measurement: 141 application base tables (142 including `pgmigrations`, plus one public VIEW — 4 more than the 137/138 recorded at v1.23, a pre-existing undercount in that baseline now corrected by direct `information_schema` measurement, not new schema), 32 migrations (unchanged), 114 permissions (unchanged), and migration head `1780000000000_wave-a4-workforce-advanced` (unchanged). Test evidence: 475/475 full API runs across 34 files — +9 tests and +1 file versus the v1.23-recorded 466 across 33, comprising the new `payroll-policy.test.ts` (7 tests: fixed-point overtime division, component/total cents integrity, exact two-decimal round-trip, excessive-scale rejection, non-finite/exponential rejection, deterministic statutory rate multiplication, and fail-closed rate/divisor validation) plus 2 additional Wave A4 integration tests raising `wave-a4-integration.test.ts` from 24 to 26. Quality gates PASS: platform boundaries (23/23 tests, 0 blocking findings, 114 migration-owned permissions), lint (0 errors), typecheck (0 errors), build (API and Web clean), PWA validation, `npm audit --omit=dev` (0 vulnerabilities), and the required 10-step browser E2E PASS against API `:4000` / Web `:5173` backed by native PostgreSQL (Docker daemon unreachable on this machine; native Windows `postgres.exe` on port 5432 used instead, per the standing environment-substitution rule — `db:up` itself remains PARTIAL / ENVIRONMENT-BLOCKED, not falsely reported PASS). Runtime commits `bef34e1` (data scope + overtime + arithmetic), `8c4f414` (exact-decimal boundary hardening), `361c85d` (Wave A3 date-window stabilization, test-only, separately authorized). Waves A5–A8, `SO-ADV-006` (deferred), Phase 11G, Platform Builder, Module Manifest runtime, and Client Extensions remain unstarted. |
| v1.23 | 2026-08-30 | 100.0 % | 75.1 % | **Wave A4 (Workforce Advanced) delivered — weighted.** Numerator +24 across six capability groups: Attendance, Shift & Roster (`HR-ADV-001/002`, 5), Leave & Overtime (`HR-ADV-003/004`, 3), Payroll, BPJS & PPh21 (`HR-ADV-005`, 5), Recruitment Pipeline (`HR-ADV-006`, 3), Performance, Competency, Training & Career (`HR-ADV-007/008`, 5), Manpower Planning (`HR-ADV-009`, 3). Advanced 67 → 91; Full 241 → 265. Denominator unchanged at 174 / 353 and Core Readiness unchanged at 100.0 % — pure earned progress, no scope added or reclassified. Live database evidence: 137 application base tables (138 including `pgmigrations`, plus one public VIEW), 32 migrations, 114 permissions (0 duplicate codes, 15 added by Wave A4), and migration head `1780000000000_wave-a4-workforce-advanced`. Test evidence: 466/466 full API runs across 33 files (Wave A4 adds 24 tests in `wave-a4-integration.test.ts`). Quality gates PASS: platform boundaries (23/23 tests, 0 blocking findings, 114 migration-owned permissions), lint (0 errors), typecheck (0 errors), build (API and Web clean), PWA validation, `npm audit --omit=dev` (0 vulnerabilities). Zero core regression: Workforce Core remains clean of Advanced imports; statutory calculations use exact-decimal scaled arithmetic; manpower planning computes gaps deterministically without mutating employee master records. Waves A5–A8, SO-ADV-006 (deferred), Phase 11G, Platform Builder, Module Manifest runtime, and Client Extensions remain unstarted. |
| v1.22 | 2026-08-28 | 100.0 % | 68.3 % | **Wave A3 (Service Operations Advanced & Asset Advanced revised) delivered — weighted.** Numerator +19 across five units under explicit Founder revision (skipping `SO-ADV-006` Offline Field PWA, 5 pts): Vertical Service Packs (`PACK-001…004`, 5), Route/Roster/Optimization (`SO-ADV-002…005`, 3), Asset Maintenance Work Orders & Preventive Schedules (`AST-ADV-001/002`, 5), Meter Readings, Spare Parts & Downtime (`AST-ADV-003…005`, 3), MTBF/MTTR & Predictive Maintenance (`AST-ADV-006/007`, 3). Advanced 48 → 67; Full 222 → 241. Denominator unchanged at 174 / 353 and Core Readiness unchanged at 100.0 % — pure earned progress, no scope added or reclassified. Live database evidence: 122 application base tables (123 including `pgmigrations`, plus one public VIEW), 31 migrations, 99 permissions (0 duplicate codes, 8 added by Wave A3), and migration head `1779000000000_wave-a3-service-operations-asset-advanced`. Test evidence: 442/442 full API runs across 32 files (Wave A3 adds 29 tests in `wave-a3-integration.test.ts`). Quality gates PASS: platform boundaries (23/23 tests, 0 blocking findings, 99 migration-owned permissions), lint (0 errors), typecheck (0 errors), build (API and Web clean), PWA validation, `npm audit --omit=dev` (0 vulnerabilities). Asset Maintenance lifecycle is authoritative exclusively through Workflow Engine via `workflow_instance_id` (zero competing state machines); optimization and predictive metrics are advisory and deterministic with atomic transaction apply; meter readings enforce strong monotonicity serialized by asset row-level locking. Waves A4–A8, Phase 11G, Platform Builder, Module Manifest runtime, and Client Extensions remain unstarted. |
| v1.21 | 2026-08-27 | 100.0 % | 62.9 % | **Wave A2 (Survey Advanced completion & Reporting Advanced) delivered — weighted.** Numerator +23 across all seven units: Survey & Assessment Advanced (conditional branching & matrix questions 3, multi-dimensional/NPS scoring 2, anonymous & public-token distribution 3, multi-language survey localization 2, cross-survey analytics & benchmarking 3) and Reporting Advanced (governed self-service BI 5, deterministic operational forecasting 5). Advanced 25 → 48; Full 199 → 222. Denominator unchanged at 174 / 353 and Core Readiness unchanged at 100.0 % — pure earned progress, no scope added or reclassified. Live database evidence: 113 application base tables (114 including `pgmigrations`, plus one public VIEW), 30 migrations, 91 permissions (0 duplicate codes, 3 added by Wave A2: `survey.analytics.read`, `reporting.bi.manage`, `reporting.predictive.read`), and migration head `1778000000000_wave-a2-survey-reporting-advanced`. Test evidence: 413/413 full API runs across 31 files (Wave A2 adds 23 tests in `wave-a2-integration.test.ts`), stabilized with atomic single-use public quota claims, compensating release on validation failures, and strict definition-scoped tenant analytics isolation in correction commit `435232d`. Quality gates PASS: platform boundaries (23/23 tests, 0 blocking findings), lint (0 errors), typecheck (0 errors), build (API and Web clean), PWA validation. Survey versions remain immutable upon publication; public distribution uses SHA-256 token hashing; governed BI uses static metadata catalogs with recursive CTE Customer Data Scope injection and zero arbitrary SQL/eval; predictive analytics uses bounded statistical methods (OLS, moving averages, seasonal decomposition) with strict tenant isolation. Waves A3–A8, Phase 11G, Platform Builder, Module Manifest runtime, and Client Extensions remain unstarted. |
| v1.20 | 2026-08-26 | 100.0 % | 56.4 % | **Wave A1 (Advanced Commercial & Service Quality) delivered — weighted.** Numerator +19 across all six units: Customer & Commercial Advanced (sales/opportunity/quotation 5, self-service portal 3) and Service Quality Advanced (multidimensional SLA + calendar 3, RCA taxonomy + advanced CAPA 3, recurring-problem detection 3, automatic mutation from feedback 2). Advanced 6 → 25; Full 180 → 199. Denominator unchanged at 174 / 353 — pure earned progress, no scope added or reclassified. Core Readiness unchanged at 100.0 %. Runtime baseline `master @ e7ab06a` = delivery `95b346a`, closure correction `5eba91a`, metadata baseline `d9ed34b`, and post-closure stabilization. The stabilization preserves the global Scheduler registry/lease contract while isolating integration fixtures on unique registered rows with production handler keys, and keeps endpoint inactive-window boundaries entirely in PostgreSQL to avoid `timestamptz` precision loss through JavaScript `Date`. It adds no migration, table, permission, API route, test, or roadmap point. Final evidence is five consecutive 390/390 full API runs across 30 files, a separate 390/390 `--no-file-parallelism` run, focused Scheduler/outbox 27/27, focused Wave A1 36/36, typecheck, lint, build, PWA validation, 23/23 platform-boundary tests, 0 blocking boundary findings, `npm audit --omit=dev` (0 vulnerabilities), and the required 10-step browser E2E PASS. Live database evidence remains 103 application base tables (104 including `pgmigrations`, plus one public VIEW), 29 migrations, 88 permissions (0 duplicate codes, 11 added by Wave A1), and head `1777000000000_wave-a1-service-quality-advanced`. Launcher `db:up` remains **PARTIAL / ENVIRONMENT-BLOCKED**, not falsely reported PASS, because Docker is unavailable and native Windows `postgres.exe` owns port 5432. Automation only ever proposes: `requires_approval` is pinned true by a database CHECK and approval is routed through permission-checked service methods. Waves A2–A8, Phase 11G, Platform Builder, Module Manifest runtime, and Client Extensions remain unstarted. |
| v1.19 | 2026-08-25 | 100.0 % | 51.0 % | **Phase 11F final access-lifecycle hardening and closure completed (unweighted).** No product unit, numerator, or denominator change. Runtime baseline `master @ 63e43d1`, directly descended from the v1.18 metadata commit, closes inactive/deleted-user authentication, refresh-token revocation, live actor/tenant JWT revalidation, monotonic stale-scope assignment invalidation and correction, and effective permission-coupled Reporting scope. Adds one migration and 18 API tests with no table or permission; evidence is 354/354 tests across 27 files, 85 tables, 27 migrations, and 77 permissions, with complete governed-access and lifecycle real-browser smoke passing separately. Governed user provisioning is absent; Builder/Module Manifest runtime, Advanced waves, and Client Extensions remain unstarted. |
| v1.18 | 2026-08-24 | 100.0 % | 51.0 % | **Phase 11F Business Admin Console Governed Access Management completed (unweighted).** No product unit, numerator, or denominator change. Runtime baseline `master @ fc01876` adds tenant-local privacy-minimized access review, on-demand one-role permission summaries, and separately authorized assignment/removal of existing roles with explicit Data Scope, exact-assignment uniqueness, atomic privacy-safe audit, and manager-lockout safeguards. Adds one migration and one permission with no table; evidence is 336/336 API tests across 26 files, 85 tables, 26 migrations, and 77 permissions, with real-browser governed add/remove and responsive dialog smoke passing separately. No Builder/manifest/package runtime, broad administration editing, Advanced wave, Client Extension, or weighted business capability. |
| v1.17 | 2026-08-24 | 100.0 % | 51.0 % | **Phase 11E Platform Shell & Admin Console UX Implementation Foundation completed (unweighted).** No product unit, numerator, or denominator change. Runtime baseline `master @ 26fc99f` adds static three-group capability navigation, an accessible responsive shell, reusable UI-state refinements, and URL-durable read-only Admin Console sections. No API, migration, permission, Builder/manifest/package runtime, Advanced wave, Client Extension, or business-capability change. Evidence remains 313/313 API tests across 25 files, 85 tables, 25 migrations, and 76 permissions; practical browser smoke passes and is reported separately. |
| v1.16 | 2026-08-23 | 100.0 % | 51.0 % | **Phase 11D Platform Experience System & Admin Console UX Direction completed (unweighted).** No product unit, numerator, or denominator change. Defines unified visual direction, modular capability-aware navigation, multi-device responsive adaptations, Business Admin Console UX, and governed Platform Architect/Builder UX principles (B0–B4 risk matrix). Implementation baseline remains `master @ 3145627` with 313/313 tests across 25 files, 85 tables, 25 migrations, 76 permissions. |
| v1.15 | 2026-08-23 | 100.0 % | 51.0 % | **Phase 11C Business Admin Console Foundation completed (unweighted).** No product unit, numerator, or denominator change — the console re-presents data the actor could already read and grants no new capability. Strictly read-only and tenant-local: a new `admin.console.read` permission gates entry, and every section is additionally gated by the permission already governing that data, so the entry permission alone reveals nothing. Runtime evidence refreshed to 313/313 tests across 25 files, 85 tables (no new table), 25 migrations, 76 permissions. |
| v1.14 | 2026-08-23 | 100.0 % | 51.0 % | **Phase 11B platform boundary enforcement completed (unweighted).** No product unit, numerator, or denominator change. Dependency-free guard and 23 focused tests enforce selected module imports, migration/tenant ownership, permission, hardcoded-role, and obvious runtime escape-hatch boundaries; Module Manifest readiness remains advisory. Runtime evidence remains `master @ ebd56c2`. |
| v1.13 | 2026-08-23 | 100.0 % | 51.0 % | **Phase 11A architecture/governance foundation completed (unweighted).** No product unit, numerator, or denominator change. Platform Kernel, module/package/extension contracts, Module Manifest v1, Dual Admin trust separation, governed Builder risk model, and installer direction documented. No runtime enforcement, Advanced wave, or Client Extension started. |
| v1.12 | 2026-08-22 | 100.0 % | 51.0 % | **Phase H2 (Production Hardening) delivered.** Numerator +7 (PH-3, PH-4, PH-8); denominator unchanged at 174 / 353. Pure earned progress. 294/294 tests passing; 85 tables and 24 migrations. Core Product Readiness achieved. |
| v1.11 | 2026-08-21 | 96.0 % | 49.0 % | **Phase H (Pilot Hardening) delivered.** Numerator +9 (PH-1, PH-2, PH-5, PH-6, PH-7); denominator unchanged at 174 / 353. Pure earned progress. 280/280 tests passing. Pilot readiness gate achieved. |
| v1.0 | 2026-08-20 | 41.4 % | 22.1 % | First measured baseline. No prior figure existed — nothing to compare against. |
| v1.1 | 2026-08-20 | 41.4 % | 22.1 % | **No change.** PRD reconstruction migrated 70 IGSEP legacy requirement areas; every one mapped to an existing roadmap unit (ADOPT/ADAPT/MERGE/RECLASSIFY) or to a SUPERSEDE/pack disposition that adds no weight. Denominator unchanged at 174 / 353; numerator unchanged at 72 / 78. |
| v1.2 | 2026-08-20 | 48.9 % | 25.8 % | **Phase 2 delivered.** Numerator +13 (OPS.1–OPS.5); denominator unchanged at 174 / 353. Pure earned progress — no scope was added or reclassified. |
| v1.3 | 2026-08-20 | 54.6 % | 28.6 % | **Phase 3 delivered.** Numerator +10 (HR.1–HR.5); denominator unchanged at 174 / 353. Pure earned progress. |
| v1.4 | 2026-08-20 | 62.6 % | 32.6 % | **Phase 4 delivered.** Numerator +14 (SCM.1–SCM.6); denominator unchanged at 174 / 353. Pure earned progress. |
| v1.5 | 2026-08-20 | 67.2 % | 34.8 % | **Phase 5 delivered.** Numerator +8 (AST.1–AST.4); denominator unchanged at 174 / 353. Pure earned progress. |
| v1.6 | 2026-08-20 | 74.1 % | 38.2 % | **Phase 6 delivered.** Numerator +12 (FIN.1–FIN.6); denominator unchanged at 174 / 353. Pure earned progress. |
| v1.10 | 2026-08-21 | 90.8 % | 46.5 % | **Phase 10 delivered.** Numerator +2 (CUS.4); denominator unchanged at 174 / 353. Pure earned progress. 278/278 tests passing after CUS-CORE-009 correction. |
| v1.9 | 2026-08-21 | 89.7 % | 45.9 % | **Phase 9 delivered.** Numerator +10 (RPT.1–RPT.4); denominator unchanged at 174 / 353. Pure earned progress. 276/276 tests passing. |
| v1.8 | 2026-08-21 | 83.9 % | 43.1 % | **Phase 8 delivered.** Numerator +8 (PRJ.1–PRJ.4); denominator unchanged at 174 / 353. Pure earned progress. 271/271 tests passing. |
| v1.7 | 2026-08-21 | 79.3 % | 40.8 % | **Phase 7 delivered.** Numerator +9 (HSE.1–HSE.4); denominator unchanged at 174 / 353. Pure earned progress. 262/262 tests passing. |

### Why the denominator did not move

A PRD reconstruction of this size would normally inflate scope. It did not, because:

1. **`SUPERSEDE` items add nothing.** Four IGSEP vertical modules became configuration packs over one Service Operations engine already counted (`OPS.1–OPS.5`); four IGSEP "portal/mobile/dashboard" modules became experience surfaces already counted inside module UI units.
2. **`RECLASSIFY` items moved layer, not weight.** Attendance, payroll, RFQ, maintenance, ledgers, etc. were already in the Advanced backlog (179 pts).
3. **`ADOPT`/`ADAPT`/`MERGE` items were already modelled** as Business Core units in Roadmap v1.0.
4. **No `DROP` items** — and dropped items would not have changed the denominator anyway.

This is the intended behaviour of the change-control rule: legacy requirements enter the denominator only when they represent genuinely new approved scope.

> Future note: a *decrease* caused by adding approved scope to the denominator is **not** regression. Always state the reason alongside the number.
