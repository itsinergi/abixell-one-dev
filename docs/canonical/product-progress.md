# Abixell One — Product Progress

| | |
|---|---|
| **Document Status** | CANONICAL |
| **Authority** | Founder (Insting Tekno Sinergi) |
| **Roadmap Baseline** | v1.20 |
| **Progress Model** | v1.0 |
| **Last Updated** | 2026-08-26 |
| **Measured at** | `master @ 5eba91a`, Wave A1 closure · 390/390 API tests across 30 files · browser smoke PASS · 103 tables (104 incl. `pgmigrations`) · 29 migrations · 88 permissions · head `1777000000000_wave-a1-service-quality-advanced` |
| **Related** | [PRD](../prd/abixell-one/00-README.md) · [product-roadmap.md](product-roadmap.md) · [product-blueprint.md](product-blueprint.md) · [documentation-map.md](documentation-map.md) |

---

## 1. Headline

| Metric | Value | Δ since v1.19 |
|---|---:|---:|
| **Core Product Readiness** | **100.0 %** | — 0.0 pts |
| **Full Approved Roadmap Progress** | **56.4 %** | ▲ +5.4 pts |

Two metrics are reported deliberately. A single number would misrepresent the product: the deployable Core is far more mature than the full Advanced roadmap, and optional Advanced depth should not make a usable product look unfinished.

- **Core Product Readiness** = Platform Core + Business Core + required Platform Hardening.
- **Full Approved Roadmap Progress** = Core Product Readiness + all approved Advanced capabilities.
- **Client Extensions are excluded from both** — custom client work must never shrink product completion.
- **Unweighted architecture/governance phases earn no points.** Phases 11A, 11B, 11C, 11D, 11E, and 11F are recorded for governance traceability without moving either metric.

The implementation measurement is pinned at `master @ 5eba91a` (Wave A1 delivery `95b346a` plus its correction commit): 390/390 API tests across 30 files, 103 tables (104 including `pgmigrations`), 29 migrations, 88 permissions, and migration head `1777000000000_wave-a1-service-quality-advanced`. Relative to the v1.19 runtime baseline this adds 36 API tests, 3 files, 18 tables, 2 migrations, and 11 permissions. Every figure here was read from the live database and from a complete test run on the measured tree, not carried forward from a delivery report.

Wave A1 is the first **weighted Advanced** delivery since Phase 1E, so unlike Phases 11A–11F it moves the Full Approved Roadmap metric. It completes all six units of Customer & Commercial Advanced (8 pts) and Service Quality Advanced (11 pts): sales pipeline with versioned quotations and effective-dated Price Books, the scoped self-service portal, multidimensional SLA with business calendars, RCA taxonomy with advanced CAPA, recurring-problem detection, and Founder-gated automation proposals. The automation surface only ever *proposes*; `requires_approval` is pinned true by a database CHECK, so an autonomous rule is not representable, and approving a proposal is routed through the same permission-checked service methods a human would use.

The correction commit `5eba91a` closes four defects found while validating `95b346a` — a permission bypass on automation-proposal approval, quotation money computed in binary floating point, Price Books resolved against a UTC rather than local date, and an automation-rules panel that was fetched but never rendered — plus the trailing-whitespace blocker. A regression test now pins exact-decimal quotation arithmetic and was verified against a deliberately reverted implementation.

Browser smoke passes separately from the API count: the existing 10-scenario Phase 11F suite, plus an 8-scenario Wave A1 smoke (both new surfaces, tab navigation, Founder gating, three viewports, and expired-session protection) with zero console, page, or network diagnostics.

Commit `3df1718` (Phase 11A documentation) and the Phase 11B repository-governance changes remain non-runtime and imply no schema or API test evidence of their own. Phase 11B's 23/23 focused dependency-free boundary tests continue to pass with 0 blocking findings and the expected documentary Manifest advisory, alongside typecheck, lint, production build, and PWA validation.

### Known issues recorded at this baseline

Two findings are recorded rather than hidden. Neither is caused by Wave A1 and neither is fixed here; both are candidates for a future stabilization phase.

1. **Pre-existing scheduler/outbox test flakiness (not a Wave A1 regression).** Across 20+ full runs, roughly one in eight fails 1–3 tests in `phase-h2-integration-outbox.test.ts` and `shared-services.test.ts` — either `expected 409 to be 200` on a manual scheduler trigger, or `expected undefined to be 'succeeded'` on an outbox delivery. The scheduler's job lock is global (`scheduled_jobs` has no tenant column and `findJobByCode` is not tenant-scoped), while four test files trigger the shared `workflow-escalation-sweep` and `integration-outbox-reconciliation` job codes. It reproduces with `--no-file-parallelism` and, decisively, **with all three Wave A1 test files excluded** — 354-test pre-Wave-A1 baseline, same signature. Wave A1 touches neither `scheduler.service.ts` nor those test files; its only scheduler change is a new job code triggered by one file. The 390/390 figure above is from a clean run, and the flaky runs are recorded here so that number is not read as unconditional.
2. **Launcher (`RUN-ABIXELL-ONE.bat`) is environment-blocked, not verified PASS.** Its `npm run db:up` step cannot be exercised on this machine: the Docker daemon is not reachable (`dockerDesktopLinuxEngine` pipe absent) *and* native Windows `postgres.exe` (PID 6176) already owns `127.0.0.1:5432`, the exact binding `infra/postgres/docker-compose.yml` requests. Per Founder constraint the native service was not stopped and the launcher was not modified to mask the conflict. Steps downstream of `db:up` were verified independently against the live database (`migrate` → "No migrations to run!", `sync-permissions` → 0 new grants, both idempotent), as were `npm install`, typecheck, lint, build, and the running API/Web surfaces via browser smoke. The launcher is therefore **partially verified**; a full end-to-end launcher PASS is not claimed.

---

## 2. Layer progress

| Layer | Completed / Total | % |
|---|---:|---:|
| Platform Core | 41 / 41 | **100 %** |
| Platform Hardening | 16 / 16 | **100.0 %** |
| Business Core | 117 / 117 | **100 %** |
| Advanced Capabilities | 25 / 179 | **14.0 %** |

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
| Survey & Assessment | 15 / 28 | 53.6 % |
| Asset Core | 8 / 19 | 42.1 % |
| Project Delivery Core | 8 / 21 | 38.1 % |
| HSE Core | 9 / 23 | 39.1 % |
| Service Operations & Work Mgmt | 13 / 26 | 50.0 % |
| Finance Core | 12 / 33 | 36.4 % |
| Workforce (HR) Core | 10 / 34 | 29.4 % |
| Supply Chain Core | 14 / 36 | 38.9 % |
| Reporting & Operational Insight | 10 / 20 | 50.0 % |
| Platform (cross-cutting Advanced) | 0 / 13 | 0 % |

---

## 4. Progress Calculation Basis

Weight model: **S=1 · M=2 · L=3 · XL=5** per Roadmap Unit.
Earned rule: `COMPLETED = full weight`; `IN PROGRESS = 0` (conservative, no estimation); `PLANNED/DEFERRED = 0`.

```text
Platform Core          total  41   completed  41
Platform Hardening     total  16   completed  16   (+7 — Phase H2 Production Hardening)
Business Core          total 117   completed 117
Advanced Capabilities  total 179   completed  25   (+19 — Wave A1)

Core Product Readiness
  denominator = 41 + 117 + 16 = 174   (unchanged)
  completed   = 41 + 117 + 16 = 174
  in-progress earned          =   0
  (174 + 0) / 174 × 100 = 100.0 %

Full Approved Roadmap
  denominator = 174 + 179 = 353       (unchanged)
  completed   = 174 +  25 = 199
  (199 + 0) / 353 × 100 = 56.4 %

Wave A1 earned weight (all six units COMPLETED, full weight each):
  Customer & Commercial Advanced   sales/opportunity/quotation      5
                                   self-service portal expansion    3
  Service Quality Advanced         multidimensional SLA + calendar  3
                                   RCA taxonomy + advanced CAPA     3
                                   recurring-problem detection      3
                                   automatic mutation from feedback 2
                                                                 = 19
  Advanced completed 6 + 19 = 25 · Full completed 180 + 19 = 199
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

## 6. Pending roadmap units

All Advanced units except the two delivered Survey-to-Action units. Customer & Commercial Advanced (sales/opportunity/quotation and expanded self-service portal), Reporting Advanced (self-service BI / warehouse, predictive analytics), Project Delivery Advanced (WBS/dependencies/Gantt, resource loading/baseline, earned value/cost/accounting), and HSE Advanced (HSE-ADV-1…14) remain optional and out of Core scope. Platform Hardening has no pending roadmap units.

## 7. Active phase

**None.** Phase 10, Phase H (Pilot Hardening), Phase H2 (Production Hardening), and unweighted Phases 11A/11B/11C/11D/11E/11F are closed; all Core Product Readiness units are complete. Phase 11A established architecture/governance documentation, Phase 11B added repository boundary enforcement, Phase 11C delivered a read-only Business Admin Console, Phase 11D established the Platform Experience System & UX direction, Phase 11E implemented its first conservative Web shell/Admin UX slice, and Phase 11F delivered a bounded governed access-management slice; none delivered a weighted product unit.

Phase 11C delivered the READ foundation of the Business Admin Console: a consolidated view of users, roles, the permission catalogue, module activation, workflow definitions, and recent activity, each gated by the permission that already governs it. Phase 11D documented the UX specification and multi-device presentation rules. Phase 11E implemented static grouped navigation, responsive accessible shell behavior, deterministic presentation states, and durable read-only Admin sections without changing backend authority. Phase 11F enables only permission-governed assignment and removal of existing tenant roles with explicit tenant, organization-unit, or customer Data Scope, plus privacy-minimized access review and one-role permission summaries. Its closure hardens authentication and authorization for inactive/deleted/tenant-moved actors, monotonically invalidates stale scoped assignments, couples reporting scope to effective permission grants, and supports correction-only removal of retained unavailable assignments. Governed user provisioning and all user profile/status mutation UI/API remain absent; role definitions, role-permission composition, permission-catalog mutation, bulk permission matrices, and every broader console-editing surface remain unstarted. The Platform Architect / Builder Console, Builder UI/API/runtime, executable Module Manifest runtime, dynamic packages, schema/query editors, scripting/DSL, Advanced capability waves, Client Extensions, and new business functionality also remain unstarted.

## 8. Progress change log

| Baseline | Date | Core Readiness | Full Roadmap | Note |
|---|---|---:|---:|---|
| v1.20 | 2026-08-26 | 100.0 % | 56.4 % | **Wave A1 (Advanced Commercial & Service Quality) delivered — weighted.** Numerator +19 across all six units: Customer & Commercial Advanced (sales/opportunity/quotation 5, self-service portal 3) and Service Quality Advanced (multidimensional SLA + calendar 3, RCA taxonomy + advanced CAPA 3, recurring-problem detection 3, automatic mutation from feedback 2). Advanced 6 → 25; Full 180 → 199. Denominator unchanged at 174 / 353 — pure earned progress, no scope added or reclassified. Core Readiness unchanged at 100.0 %. Runtime baseline `master @ 5eba91a` = delivery `95b346a` plus its correction commit, which closes an automation-proposal permission bypass, quotation money computed in binary floating point, UTC-dated Price Book resolution, and an unrendered automation-rules panel, and adds a verified exact-decimal money regression test. Evidence read from the live database and one complete test run on the measured tree: 390/390 API tests across 30 files, 103 tables (104 incl. `pgmigrations`), 29 migrations, 88 permissions (0 duplicate codes, 11 added by Wave A1), head `1777000000000_wave-a1-service-quality-advanced`; typecheck, lint, build, PWA validation, 23/23 platform-boundary tests, and `npm audit --omit=dev` (0 vulnerabilities) all clean. Real-browser smoke passes separately (10-scenario Phase 11F + 8-scenario Wave A1, zero diagnostics). Automation only ever proposes: `requires_approval` is pinned true by a database CHECK and approval is routed through permission-checked service methods. Waves A2–A8, Phase 11G, Platform Builder, Module Manifest runtime, and Client Extensions remain unstarted. |
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
