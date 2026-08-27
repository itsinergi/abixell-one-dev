# Abixell One — Product Progress

| | |
|---|---|
| **Document Status** | CANONICAL |
| **Authority** | Founder (Insting Tekno Sinergi) |
| **Roadmap Baseline** | v1.21 |
| **Progress Model** | v1.0 |
| **Last Updated** | 2026-08-27 |
| **Measured at** | `master` after Wave A2 delivery, corrected at `435232d` · 413/413 full API tests across 31 files · browser smoke PASS · 113 application base tables (114 incl. `pgmigrations`; plus 1 public VIEW) · 30 migrations · 91 permissions · head `1778000000000_wave-a2-survey-reporting-advanced` |
| **Related** | [PRD](../prd/abixell-one/00-README.md) · [product-roadmap.md](product-roadmap.md) · [product-blueprint.md](product-blueprint.md) · [documentation-map.md](documentation-map.md) |

---

## 1. Headline

| Metric | Value | Δ since v1.20 |
|---|---:|---:|
| **Core Product Readiness** | **100.0 %** | — 0.0 pts |
| **Full Approved Roadmap Progress** | **62.9 %** | ▲ +6.5 pts |

Two metrics are reported deliberately. A single number would misrepresent the product: the deployable Core is far more mature than the full Advanced roadmap, and optional Advanced depth should not make a usable product look unfinished.

- **Core Product Readiness** = Platform Core + Business Core + required Platform Hardening.
- **Full Approved Roadmap Progress** = Core Product Readiness + all approved Advanced capabilities.
- **Client Extensions are excluded from both** — custom client work must never shrink product completion.
- **Unweighted architecture/governance phases earn no points.** Phases 11A, 11B, 11C, 11D, 11E, and 11F are recorded for governance traceability without moving either metric.

The implementation measurement is pinned at `master` post Wave A2 delivery, corrected at `435232d`: 413/413 full API runs across 31 files, 113 application base tables (114 including `pgmigrations`, plus one public VIEW), 30 migrations, 91 permissions, and migration head `1778000000000_wave-a2-survey-reporting-advanced`. Relative to the v1.20 runtime baseline, Wave A2 adds 23 API tests, 1 test file, 10 base tables, 1 migration, and 3 permissions.

Wave A2 delivers 23 weighted Advanced points across 7 units: Survey & Assessment Advanced (conditional branching & matrix questions 3, multi-dimensional/NPS scoring 2, anonymous/public-token distribution 3, multi-language survey localization 2, cross-survey analytics & benchmarking 3) and Reporting Advanced (governed self-service BI 5, deterministic operational forecasting 5). Survey versions remain immutable upon publication. Public tokens use SHA-256 hashing with zero identity leakage for anonymous respondents. Governed BI enforces static metadata catalogs with recursive CTE Customer Data Scope injection and zero arbitrary SQL/eval. Operational forecasting provides deterministic statistical forecasting (OLS regression, 7-day moving averages, seasonal decomposition, 95% confidence intervals) under strict tenant isolation.

The correction commit `5eba91a` closes four defects found while validating `95b346a` — a permission bypass on automation-proposal approval, quotation money computed in binary floating point, Price Books resolved against a UTC rather than local date, and an automation-rules panel that was fetched but never rendered — plus the trailing-whitespace blocker. A regression test now pins exact-decimal quotation arithmetic and was verified against a deliberately reverted implementation.

The post-closure stabilization commit `e7ab06a` closes both previously recorded intermittent signatures without changing Scheduler production semantics. `scheduled_jobs.job_code` and execution leases remain global by contract. Integration files now register unique fixture job rows (using the real production handler keys) instead of sharing and resetting production job rows. The outbox lifecycle boundary now stays entirely in PostgreSQL (`now()` and `SELECT deactivated_at`) rather than round-tripping a microsecond-precision `timestamptz` through millisecond-precision JavaScript `Date`. No arbitrary sleep, retry, skip, weakened assertion, status-code change, or business-behavior change was introduced.

Browser smoke passes separately from the API count: the existing 10-scenario Phase 11F suite, plus an 8-scenario Wave A1 smoke (both new surfaces, tab navigation, Founder gating, three viewports, and expired-session protection) with zero console, page, or network diagnostics. The required `npm run e2e -w apps/web` also passed its 10-step suite after the documented API `:4000` and Web `:5173` prerequisites were started; its initial invocation failed transparently with `ERR_CONNECTION_REFUSED` while those servers were absent.

Commit `3df1718` (Phase 11A documentation) and the Phase 11B repository-governance changes remain non-runtime and imply no schema or API test evidence of their own. Phase 11B's 23/23 focused dependency-free boundary tests continue to pass with 0 blocking findings and the expected documentary Manifest advisory, alongside typecheck, lint, production build, and PWA validation.

### Known limitation recorded at this baseline

The scheduler/outbox flakiness recorded at the prior closure baseline is resolved and is no longer a known issue. Final evidence on the stabilized tree is five consecutive full API runs at 390/390, one additional `--no-file-parallelism` run at 390/390, and focused Scheduler/outbox coverage at 27/27, all with zero skipped tests. Fixture cleanup was verified directly: no `test-0e-*`, `test-0f-*`, or `test-h2-*` Scheduler rows remained.

1. **Launcher (`RUN-ABIXELL-ONE.bat`) is environment-blocked, not verified PASS.** Its `npm run db:up` step cannot be exercised on this machine: the Docker daemon is not reachable (`dockerDesktopLinuxEngine` pipe absent) *and* native Windows `postgres.exe` (PID 6176, Windows Service) owns port 5432, including `127.0.0.1:5432`, the exact binding `infra/postgres/docker-compose.yml` requests. Per Founder constraint the native service was not stopped or modified, and the launcher was not changed to mask the conflict. Steps downstream of `db:up` remain independently verified against the live database, as do typecheck, lint, build, PWA, boundaries, production dependency audit, API/Web surfaces, and E2E. The launcher is therefore **PARTIAL / ENVIRONMENT-BLOCKED**; a full end-to-end launcher PASS is not claimed.

---

## 2. Layer progress

| Layer | Completed / Total | % |
|---|---:|---:|
| Platform Core | 41 / 41 | **100 %** |
| Platform Hardening | 16 / 16 | **100.0 %** |
| Business Core | 117 / 117 | **100 %** |
| Advanced Capabilities | 48 / 179 | **26.8 %** |

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
| Asset Core | 8 / 19 | 42.1 % |
| Project Delivery Core | 8 / 21 | 38.1 % |
| HSE Core | 9 / 23 | 39.1 % |
| Service Operations & Work Mgmt | 13 / 26 | 50.0 % |
| Finance Core | 12 / 33 | 36.4 % |
| Workforce (HR) Core | 10 / 34 | 29.4 % |
| Supply Chain Core | 14 / 36 | 38.9 % |
| Reporting & Operational Insight | 20 / 20 | **100 %** |
| Platform (cross-cutting Advanced) | 0 / 13 | 0 % |

---

## 4. Progress Calculation Basis

Weight model: **S=1 · M=2 · L=3 · XL=5** per Roadmap Unit.
Earned rule: `COMPLETED = full weight`; `IN PROGRESS = 0` (conservative, no estimation); `PLANNED/DEFERRED = 0`.

```text
Platform Core          total  41   completed  41
Platform Hardening     total  16   completed  16   (+7 — Phase H2 Production Hardening)
Business Core          total 117   completed 117
Advanced Capabilities  total 179   completed  48   (+19 — Wave A1; +23 — Wave A2)

Core Product Readiness
  denominator = 41 + 117 + 16 = 174   (unchanged)
  completed   = 41 + 117 + 16 = 174
  in-progress earned          =   0
  (174 + 0) / 174 × 100 = 100.0 %

Full Approved Roadmap
  denominator = 174 + 179 = 353       (unchanged)
  completed   = 174 +  48 = 222
  (222 + 0) / 353 × 100 = 62.9 %

Wave A2 earned weight (all seven units COMPLETED, full weight each):
  Survey & Assessment Advanced     conditional branching & matrix questions  3
                                   weighted / section / NPS scoring          2
                                   anonymous & public-token distribution     3
                                   multi-language survey content             2
                                   cross-survey analytics & benchmarking     3
  Reporting Advanced               self-service BI / reporting warehouse     5
                                   predictive analytics across history       5
                                                                          = 23
  Advanced completed 25 + 23 = 48 · Full completed 199 + 23 = 222
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

## 6. Pending roadmap units

All Advanced units except the delivered Survey-to-Action units (2), Wave A1 units (6), and Wave A2 units (7). The remaining Advanced backlog is 131 points: Wave A3–A7 business-domain work totals 118 and Wave A8 platform cross-cutting work totals 13. These waves remain optional and out of Core scope. Platform Hardening has no pending roadmap units.

## 7. Active phase

**None.** Phase 10, Phase H (Pilot Hardening), Phase H2 (Production Hardening), unweighted Phases 11A/11B/11C/11D/11E/11F, weighted Advanced Wave A1, and weighted Advanced Wave A2 are closed; all Core Product Readiness units and all Wave A1/A2 units are complete.

## 8. Progress change log

| Baseline | Date | Core Readiness | Full Roadmap | Note |
|---|---|---:|---:|---|
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
