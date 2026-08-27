# Abixell One — Product Roadmap

| | |
|---|---|
| **Document Status** | CANONICAL |
| **Authority** | Founder (Insting Tekno Sinergi) |
| **Roadmap Baseline** | v1.21 |
| **Progress Model** | v1.0 |
| **Last Updated** | 2026-08-27 |
| **Supersedes** | `docs/history/igsep/22-Enterprise-Product-Strategy-Roadmap.md` as roadmap source of truth (that document is retained as a **template/strategy input**, not an implementation roadmap) |
| **Related** | [PRD](../prd/abixell-one/00-README.md) · [product-blueprint.md](product-blueprint.md) · [product-progress.md](product-progress.md) · [documentation-map.md](documentation-map.md) · [decision-log.md](../decision-log.md) |

---

## 1. Purpose

One implementable roadmap that maps **Product Layer → Module → Capability → Phase → Roadmap Unit → Status**, with weights that make progress reproducible.

It deliberately does **not** inherit the "22 phases" implied by the PRD filename `22-…`: those are *documentation-authoring* phases of the IGSEP PRD, not implementation phases.

---

## 2. Status vocabulary

`COMPLETED` · `IN PROGRESS` · `PLANNED` · `DEFERRED` · `BLOCKED` · `OPTIONAL`

No vague states ("mostly done") are permitted.

## 3. Weight model

Roadmap Unit size → points: **S = 1 · M = 2 · L = 3 · XL = 5**.

Sizing considers domain complexity, data-model and workflow complexity, security/compliance surface, integration surface, and operational criticality. Deliberately coarse — reproducible beats precise.

**Earned progress:** `COMPLETED = 100%` of unit weight; `IN PROGRESS = 0%` until the unit is accepted (conservative); `PLANNED/DEFERRED = 0%`. Partial credit is earned by completing *sub-units*, never by estimation.

---

## 4. Historical delivery (do not rewrite)

Git history and checkpoint names are preserved exactly as delivered.

| Historical phase | Delivered capability | Maps to |
|---|---|---|
| **Phase 0** (0A–0F) | Enterprise Core Foundation | Platform Core PC-1…PC-13 |
| **Phase 1A** | Customer Experience Foundation | BC-1 Customer & Commercial |
| **Phase 1B** | Generic Customer Complaint Engine | BC-2 Service Quality |
| **Phase 1C** (1C.1–1C.8) | Complaint experience layer, management dashboard, administration, responsive/PWA | BC-2 Service Quality |
| **Phase 1D** (1D.1–1D.3) | Generic Survey & Assessment Engine + admin/respondent UX | BC-3 Survey & Assessment |
| **Phase 1E** (1E.1–1E.3) | Survey-to-Action integration + management attention | **Advanced** over BC-2/BC-3 |
| **Phase 2** | Service Operations & Work Management Core | BC-4 Service Operations |
| **Phase 3** | Workforce / HR Core | BC-5 Workforce |
| **Phase 4** | Supply Chain Core | BC-6 Supply Chain |
| **Phase 5** | Asset Core | BC-7 Asset |
| **Phase 6** | Finance Core | BC-8 Finance |
| **Phase 1F** | — | **NOT APPLICABLE** (FD-POST-1-01: never authoritatively defined; Phase 1 closed after 1E) |

**Phase 0 — COMPLETED. Phase 1 — COMPLETED (FD-POST-1-02). Phase 2 — COMPLETED. Phase 3 — COMPLETED. Phase 4 — COMPLETED. Phase 5 — COMPLETED. Phase 6 — COMPLETED. Phase 7 — COMPLETED. Phase 8 — COMPLETED. Phase 9 — COMPLETED. Phase 10 — COMPLETED. Phase H — COMPLETED. Phase H2 — COMPLETED. Phase 11A (unweighted architecture/governance) — COMPLETED. Phase 11B (unweighted boundary enforcement) — COMPLETED. Phase 11C (unweighted read-only admin console) — COMPLETED. Phase 11D (unweighted platform experience system & UX direction) — COMPLETED. Phase 11E (unweighted platform shell & admin console UX foundation) — COMPLETED. Phase 11F (unweighted governed admin access management and access-lifecycle hardening) — COMPLETED. Wave A1 — COMPLETED. Wave A2 — COMPLETED.**

---

## 5. Current product baseline

| Item | Value |
|---|---|
| Branch / commit | `master` post Wave A2 delivery |
| Migrations | 30 (Wave A2 adds 1) |
| Migration head | `1778000000000_wave-a2-survey-reporting-advanced` |
| Tables | 113 application base tables excluding `pgmigrations` (114 including it), plus 1 public VIEW; Wave A2 adds 10 base tables |
| Permissions | 91 (Wave A2 adds 3: `survey.analytics.read`, `reporting.bi.manage`, `reporting.predictive.read`; 0 duplicate codes) |
| API tests | 410 PASS (31 files) |
| Browser smoke | PASS |
| Core / Full progress | 174 / 174 (100.0%) / 222 / 353 (62.9%) |
| typecheck / lint / build | PASS (0 errors); Vite retains its non-blocking >500 kB chunk-size advisory |
| Security | `npm audit --omit=dev` — 0 vulnerabilities |
| Launcher | PARTIAL — `db:up` environment-blocked (Docker daemon unreachable; native `postgres.exe` owns 5432). Downstream steps verified independently. Not a full PASS. |
| Phase 11B repository governance | 23/23 focused boundary tests; 0 blocking findings; 1 expected Manifest advisory; 91 migration-owned permissions |

---

## 6. Roadmap units — Platform Core (COMPLETED, weight 41)

| ID | Unit | W | Status |
|---|---|---:|---|
| PC-1 | Tenant / Legal Entity / Org Unit / Project / Site hierarchy | 3 | COMPLETED |
| PC-2 | Identity, authentication, session | 3 | COMPLETED |
| PC-3 | RBAC, permissions, Data Scope (hierarchical + customer) | 5 | COMPLETED |
| PC-4 | Configuration & Metadata Engine | 5 | COMPLETED |
| PC-5 | Workflow & Approval Engine | 5 | COMPLETED |
| PC-6 | Audit foundation | 2 | COMPLETED |
| PC-7 | Domain Events / EventBus | 2 | COMPLETED |
| PC-8 | Notification Engine | 3 | COMPLETED |
| PC-9 | Document Service + entity authorization | 3 | COMPLETED |
| PC-10 | Scheduler | 2 | COMPLETED |
| PC-11 | Integration Boundary | 3 | COMPLETED |
| PC-12 | Observability | 2 | COMPLETED |
| PC-13 | App Shell, Design System, responsive, PWA | 3 | COMPLETED |

## 7. Roadmap units — Platform Hardening (COMPLETED, weight 16)

Pilot/production readiness. **Not** business capability.

| ID | Unit | W | Status | Gate |
|---|---|---:|---|---|
| PH-1 | CI/CD pipeline (lint/typecheck/test/build) | 3 | COMPLETED | Pilot |
| PH-2 | CORS allowlist + rate-limit tuning + header review | 2 | COMPLETED | Pilot |
| PH-3 | Backup / restore / DR runbook | 2 | COMPLETED | Production |
| PH-4 | Deployment & environment provisioning automation | 3 | COMPLETED | Production |
| PH-5 | Performance fixes (operational queue N+1) | 2 | COMPLETED | Pilot |
| PH-6 | Dependency advisory remediation | 1 | COMPLETED | Pilot |
| PH-7 | PWA installability assets (PNG 192/512) | 1 | COMPLETED | Pilot |
| PH-8 | Integration reconciliation / outbox worker | 2 | COMPLETED | Production |

## 8. Roadmap units — Business Core (weight 117, 117 completed)

### BC-1 Customer & Commercial — 9/9 · COMPLETED
| ID | Unit | W | Status |
|---|---|---:|---|
| CUS.1 | Customer + contacts master | 2 | COMPLETED |
| CUS.2 | Contract / Project / Site / Service catalog + links | 3 | COMPLETED |
| CUS.3 | Customer Data Scope authorization (ADR-0011) | 2 | COMPLETED |
| CUS.4 | Customer & commercial admin UI + maintenance | 2 | COMPLETED |

### BC-2 Service Quality (Complaint) — 15/15 · COMPLETED
| ID | Unit | W | Status |
|---|---|---:|---|
| CMP.1 | Complaint engine + generic workflow extensions | 3 | COMPLETED |
| CMP.2 | Customer complaint experience | 2 | COMPLETED |
| CMP.3 | Operational queue & detail | 2 | COMPLETED |
| CMP.4 | QA / verification experience | 2 | COMPLETED |
| CMP.5 | Management dashboard | 2 | COMPLETED |
| CMP.6 | Complaint administration / configuration | 2 | COMPLETED |
| CMP.7 | Responsive / PWA + regression | 2 | COMPLETED |

### BC-3 Survey & Assessment — 9/9 · COMPLETED
| ID | Unit | W | Status |
|---|---|---:|---|
| SRV.1 | Survey engine core (definition→version→question→assignment→response→scoring) | 5 | COMPLETED |
| SRV.2 | Survey admin + respondent experience | 3 | COMPLETED |
| SRV.3 | Survey engine stabilization | 1 | COMPLETED |

### BC-4 Service Operations & Work Management — 13/13 · COMPLETED
| ID | Unit | W | Status |
|---|---|---:|---|
| OPS.1 | Service request / work order master + lifecycle | 3 | COMPLETED |
| OPS.2 | Scheduling & team assignment | 3 | COMPLETED |
| OPS.3 | Field execution & evidence capture | 3 | COMPLETED |
| OPS.4 | Supervisor / field operational UX | 3 | COMPLETED |
| OPS.5 | Stabilization | 1 | COMPLETED |

### BC-5 Workforce (HR) Core — 10/10 · COMPLETED
| ID | Unit | W | Status |
|---|---|---:|---|
| HR.1 | Employee master + employment status | 3 | COMPLETED |
| HR.2 | Organizational placement & position | 2 | COMPLETED |
| HR.3 | Employee documents & basic history | 2 | COMPLETED |
| HR.4 | Workforce admin UX | 2 | COMPLETED |
| HR.5 | Stabilization | 1 | COMPLETED |

### BC-6 Supply Chain Core — 14/14 · COMPLETED
| ID | Unit | W | Status |
|---|---|---:|---|
| SCM.1 | Item master + supplier master | 3 | COMPLETED |
| SCM.2 | Stock balance + goods in/out | 3 | COMPLETED |
| SCM.3 | Purchase request | 2 | COMPLETED |
| SCM.4 | Purchase order + receipt | 3 | COMPLETED |
| SCM.5 | Operational UX | 2 | COMPLETED |
| SCM.6 | Stabilization | 1 | COMPLETED |

### BC-7 Asset Core — 8/8 · COMPLETED
| ID | Unit | W | Status |
|---|---|---:|---|
| AST.1 | Asset master + tag / location / custodian | 3 | COMPLETED |
| AST.2 | Movement & status history | 2 | COMPLETED |
| AST.3 | Asset UX + documents | 2 | COMPLETED |
| AST.4 | Stabilization | 1 | COMPLETED |

### BC-8 Finance Core — 12/12 · COMPLETED
| ID | Unit | W | Status |
|---|---|---:|---|
| FIN.1 | Income / expense transaction + category | 3 | COMPLETED |
| FIN.2 | Cash / bank basic + evidence | 2 | COMPLETED |
| FIN.3 | Approval integration (Workflow reuse) | 2 | COMPLETED |
| FIN.4 | Basic cashflow view | 2 | COMPLETED |
| FIN.5 | Finance UX | 2 | COMPLETED |
| FIN.6 | Stabilization | 1 | COMPLETED |

### BC-9 HSE Core — 9/9
| ID | Unit | W | Status |
|---|---|---:|---|
| HSE.1 | Incident + observation capture | 3 | COMPLETED |
| HSE.2 | Category / location / evidence + follow-up lifecycle | 3 | COMPLETED |
| HSE.3 | HSE UX | 2 | COMPLETED |
| HSE.4 | Stabilization | 1 | COMPLETED |

### BC-10 Project Delivery Core — 8/8 · COMPLETED
| ID | Unit | W | Status |
|---|---|---:|---|
| PRJ.1 | Activity / task + milestone | 3 | COMPLETED |
| PRJ.2 | PIC, dates, status, progress | 2 | COMPLETED |
| PRJ.3 | Project delivery UX | 2 | COMPLETED |
| PRJ.4 | Stabilization | 1 | COMPLETED |

### BC-11 Reporting & Operational Insight — 10/10 · COMPLETED
| ID | Unit | W | Status |
|---|---|---:|---|
| RPT.1 | Cross-module reporting foundation (scope-safe) | 3 | COMPLETED |
| RPT.2 | Standard operational reports + export | 3 | COMPLETED |
| RPT.3 | Executive dashboard (cross-module) | 3 | COMPLETED |
| RPT.4 | Stabilization | 1 | COMPLETED |

## 9. Roadmap units — Advanced Capabilities (weight 179, 48 completed)

| Module | Units (weight) | W | Done |
|---|---|---:|---:|
| Customer & Commercial | **Sales/opportunity/quotation (5) ✅** · **Self-service portal expansion (3) ✅** | 8 | **8** |
| Service Quality | **Multidimensional SLA + calendar (3) ✅** · **RCA taxonomy + advanced CAPA (3) ✅** · **Recurring-problem detection & service analytics (3) ✅** · **Automatic domain mutation from feedback (2) ✅** | 11 | **11** |
| Survey & Assessment | **Survey-to-Action trigger→assignment (3) ✅** · **Outcome→management attention (3) ✅** · **Conditional/matrix (3) ✅** · **Weighted/section/NPS (2) ✅** · **Anonymous/public token (3) ✅** · **Multi-language (2) ✅** · **Analytics & benchmarking (3) ✅** | 19 | **19** |
| Service Operations | Vertical service packs (5) · Offline field PWA (5) · Route/roster optimization (3) | 13 | 0 |
| Workforce (HR) | Attendance/shift/roster (5) · Leave & overtime (3) · Payroll+BPJS+PPh21 (5) · Recruitment (3) · Performance/competency/training/career (5) · Manpower planning (3) | 24 | 0 |
| Finance | GL/COA/journal (5) · AP/AR + aging (3) · Budgeting & cost center (3) · Bank reconciliation (2) · Fixed-asset accounting (3) · Tax/consolidation/statements (5) | 21 | 0 |
| Supply Chain | Multi-warehouse/bin/batch/serial (5) · Reservation/reorder/transfer/opname (3) · Valuation + landed cost (3) · RFQ/tender/bid (5) · Supplier evaluation & contract purchasing (3) · Spend analytics (3) | 22 | 0 |
| Asset | Preventive & corrective maintenance + work orders (5) · Meter/spare parts/downtime (3) · MTBF/MTTR + predictive (3) | 11 | 0 |
| Project Delivery | WBS/dependencies/Gantt (5) · Resource loading + baseline (3) · Earned value + cost control + project accounting (5) | 13 | 0 |
| HSE | Investigation + risk assessment JSA/HIRA (5) · Permit to work (3) · Inspection & audit (3) · Environmental monitoring + CAPA + indicators (3) | 14 | 0 |
| Platform (cross-cutting) | API economy / partner surface (3) · AI readiness (5) · Marketplace & ecosystem (5) | 13 | 0 |
| Reporting | **Self-service BI / warehouse (5) ✅** · **Predictive analytics (5) ✅** | 10 | **10** |

## 10. Future phases (dependency-ordered)

Strategy: **Business Core breadth → stabilization → Advanced depth** (not "all Advanced of module A before module B has a Core").

| Phase | Name | Units | W | Depends on | Status |
|---|---|---|---:|---|---|
| ~~Phase 2~~ | Service Operations & Work Management Core | OPS.1–OPS.5 | 13 | — | **COMPLETED** |
| ~~Phase 3~~ | Workforce (HR) Core | HR.1–HR.5 | 10 | — | **COMPLETED** |
| ~~Phase 4~~ | Supply Chain Core | SCM.1–SCM.6 | 14 | — | **COMPLETED** |
| ~~Phase 5~~ | Asset Core | AST.1–AST.4 | 8 | Platform Core | **COMPLETED** |
| ~~Phase 6~~ | Finance Core | FIN.1–FIN.6 | 12 | Platform Core, BC-1 | **COMPLETED** |
| ~~Phase 7~~ | HSE Core | HSE.1–HSE.4 | 9 | Platform Core, BC-4 | **COMPLETED** |
| ~~Phase 8~~ | Project Delivery Core | PRJ.1–PRJ.4 | 8 | BC-1 | **COMPLETED** |
| ~~Phase 9~~ | Reporting & Operational Insight | RPT.1–RPT.4 | 10 | ≥3 Business Cores | **COMPLETED** |
| ~~Phase 10~~ | Customer & Commercial completion | CUS.4 | 2 | BC-1 | **COMPLETED** |
| ~~Phase H~~ | Platform Hardening (Pilot gate) | PH-1, PH-2, PH-5, PH-6, PH-7 | 9 | — | **COMPLETED** |
| ~~Phase H2~~ | Platform Hardening (Production gate) | PH-3, PH-4, PH-8 | 7 | Phase H | **COMPLETED** |
| ~~Wave A1~~ | Advanced Commercial & Service Quality | CUS-ADV-001, CUS-ADV-002, SQ-ADV-001…004 | 19 | BC-1, BC-2 | **COMPLETED** |
| ~~Wave A2~~ | Survey Advanced completion & Reporting Advanced | SUR-ADV-003…007, RPT-ADV-001…002 | 23 | BC-3, BC-11 | **COMPLETED** |
| **Wave A3+** | Remaining Advanced capability waves | per module | 131 | respective Core | PLANNED / OPTIONAL |

### Unweighted architecture / governance phases

These phases establish contracts or governance without delivering a weighted product capability. They do not use S/M/L/XL points and change neither numerator nor denominator.

| Phase | Name | Product units | Weight | Status | Scope result |
|---|---|---|---:|---|---|
| ~~Phase 11A~~ | Platform Kernel & Builder Architecture Foundation | None | — | **COMPLETED** | Platform Kernel, package/extension boundaries and Manifest v1, Dual Admin trust planes, governed Builder risk/lifecycle, and cross-platform installer direction documented; no runtime enforcement or business capability |
| ~~Phase 11B~~ | Platform Boundary Enforcement | None | — | **COMPLETED** | Dependency-free repository guard enforces selected API/Web imports, append-only migration and tenant ownership, permission ownership/consumption, hardcoded-role authorization, and obvious runtime escape-hatch boundaries; Manifest readiness remains advisory |
| ~~Phase 11C~~ | Business Admin Console Foundation | None | — | **COMPLETED** | Tenant-local, strictly read-only consolidation of existing administration areas (users, roles, permission catalogue, module activation, workflow definitions, recent activity) behind a new `admin.console.read` entry permission plus the per-area permission that already governs each dataset; no mutation surface, no Builder/metadata authoring, no schema or query editing, no new business capability |
| ~~Phase 11D~~ | Platform Experience System & Admin Console UX Direction | None | — | **COMPLETED** | Platform experience system, responsive multi-device layouts (desktop/tablet/mobile), modular capability-aware navigation, Business Admin Console UX direction, and governed Platform Architect/Builder UX principles (B0–B4 risk tiers); no runtime Builder, no manifest loading, no dynamic packages, no business capability |
| ~~Phase 11E~~ | Platform Shell & Admin Console UX Implementation Foundation | None | — | **COMPLETED** | First conservative Web implementation of the Phase 11D experience system: static three-group capability navigation, accessible responsive shell, shared UI-state refinements, and durable read-only Admin Console sections; backend permissions and Data Scope remain authoritative, with no API, migration, permission, runtime Builder/manifest/package, or business-capability change |
| ~~Phase 11F~~ | Business Admin Console Governed Access Management & Access-Lifecycle Hardening | None | — | **COMPLETED** | Tenant-local, privacy-minimized access review and separately permissioned assignment/removal of existing roles at tenant, organization-unit, or customer scope; exact-assignment uniqueness, transactional audit, self-manager and final-active-manager safeguards; inactive/deleted actor denial and refresh revocation; live JWT actor/tenant revalidation; monotonic invalidation and correction of unavailable assignments; permission-coupled Reporting scope; no governed user provisioning, broader user lifecycle/profile/status administration, role-definition or permission-composition editing, bulk matrix, Builder/manifest/package runtime, Advanced wave, Client Extension, or weighted business capability |

Phases 11A, 11B, 11C, 11D, 11E, and 11F start no Advanced wave and register no Client Extension. Builder UI/API/runtime, manifest/package runtime, universal module-activation enforcement, one-click installer code, desktop wrapper, dynamic package installation, direct schema/query editing, scripting/DSL, or new business functionality requires separate Founder authorization and applicable PRD/roadmap treatment. Phase 11C's read-only console, Phase 11D's UX specifications, Phase 11E's visual/layout implementation foundation, and Phase 11F's bounded tenant-local access-management slice are explicitly **not** the Platform Architect / Builder Console. Phase 11F adds permission-governed assignment and removal of existing roles with explicit Data Scope, then closes the associated access lifecycle through inactive/deleted actor denial, refresh-token revocation, live actor/tenant JWT revalidation, monotonic invalidation and correction of unavailable assignments, and permission-coupled Reporting scope. Governed user provisioning, broader user lifecycle/profile/status administration, role definitions, role-permission composition, permission-catalog mutation, module/workflow editing, and every broader administration surface remain unavailable.

**Phase H may run in parallel** with any Business Core phase — it is infrastructure, not business capability.

## 11. Gates

- **Pilot Gate:** Platform Core ✅ + ≥1 Business Core module ✅ + Phase H complete + client configuration loaded.
  *Current status:* Platform Core, all 11 Business Core modules, and Phase H pilot hardening are satisfied; deployment still requires the applicable client configuration to be loaded.
- **Production Gate:** Pilot Gate + Phase H2 + security review + DR tested.
  *Current status:* Phase H2 is complete and its isolated backup/restore drill passed; deployment still requires the applicable release security review and client configuration.

## 12. Deferred / optional

Advanced waves are OPTIONAL per client and are excluded from *Core Product Readiness* but included in *Full Approved Roadmap Progress*. **Client Extensions are excluded from both** denominators and tracked per client.

## 13. Version history

| Version | Date | Change |
|---|---|---|
| v1.21 | 2026-08-27 | **Wave A2 (Survey Advanced completion & Reporting Advanced) delivered — weighted.** All seven units COMPLETED at full weight: `SUR-ADV-003` conditional branching & matrix questions (3), `SUR-ADV-004` weighted / section / NPS scoring (2), `SUR-ADV-005` anonymous & public-token distribution (3), `SUR-ADV-006` multi-language survey localization (2), `SUR-ADV-007` cross-survey analytics & benchmarking (3), `RPT-ADV-001` self-service BI & reporting warehouse (5), `RPT-ADV-002` predictive analytics across operational history (5). Advanced completed 25 → 48; Full numerator 199 → 222 (56.4 % → 62.9 %). Denominator unchanged at 174 / 353 and Core Readiness unchanged at 100.0 % — pure earned progress, no scope added or reclassified. Live database evidence: 113 application base tables (114 including `pgmigrations`, plus one public VIEW), 30 migrations, 91 permissions (0 duplicate codes, 3 added by Wave A2: `survey.analytics.read`, `reporting.bi.manage`, `reporting.predictive.read`), and migration head `1778000000000_wave-a2-survey-reporting-advanced`. Test evidence: 410/410 full API runs across 31 files (Wave A2 adds 20 tests in `wave-a2-integration.test.ts`). Quality gates PASS: platform boundaries (23/23 tests, 0 blocking findings), lint (0 errors), typecheck (0 errors), build (API and Web clean), PWA validation. Survey versions remain immutable upon publication; public distribution uses SHA-256 token hashing; governed BI uses static metadata catalogs with recursive CTE Customer Data Scope injection and zero arbitrary SQL/eval; predictive analytics uses bounded statistical methods (OLS, moving averages, seasonal decomposition) with strict tenant isolation. Waves A3–A8, Phase 11G, Platform Builder, Module Manifest runtime, and Client Extensions remain unstarted. |
| v1.20 | 2026-08-26 | **Wave A1 (Advanced Commercial & Service Quality) delivered — the first weighted Advanced wave since Phase 1E — and post-closure validation stabilized.** All six units COMPLETED at full weight: `CUS-ADV-001` sales/opportunity/quotation (5), `CUS-ADV-002` self-service portal expansion (3), `SQ-ADV-001` multidimensional SLA + business calendar (3), `SQ-ADV-002` RCA taxonomy + advanced CAPA (3), `SQ-ADV-003` recurring-problem detection & service analytics (3), `SQ-ADV-004` automatic domain mutation from feedback (2). Advanced completed 6 → 25; Full numerator 180 → 199 (51.0 % → 56.4 %). Denominator unchanged at 174 / 353 and Core Readiness unchanged at 100.0 % — pure earned progress, no scope added or reclassified. Runtime baseline `master @ e7ab06a` = delivery `95b346a`, closure correction `5eba91a`, metadata baseline `d9ed34b`, and post-closure stabilization. The stabilization preserves the intentional globally unique Scheduler registry/lease contract while giving integration files independent registered fixture rows with production handler keys; it also keeps endpoint inactive-window boundaries entirely in PostgreSQL, avoiding `timestamptz` microsecond truncation through JavaScript `Date`. Adds no migration, table, permission, API route, test, or roadmap point. Final evidence is five consecutive 390/390 full API runs across 30 files, a separate 390/390 `--no-file-parallelism` run, focused Scheduler/outbox 27/27, focused Wave A1 36/36, full quality gates, and browser E2E PASS. Live database remains 103 application base tables (104 including `pgmigrations`; one additional public VIEW), 29 migrations, 88 permissions, and head `1777000000000_wave-a1-service-quality-advanced`. Automation proposes only — `requires_approval` is pinned true by a database CHECK and approval routes through permission-checked service methods. Launcher `db:up` remains environment-blocked rather than falsely reported PASS: Docker daemon unavailable and native Windows `postgres.exe` owns port 5432. Waves A2–A8, Phase 11G, Platform Builder, Module Manifest runtime, and Client Extensions remain unstarted. |
| v1.19 | 2026-08-25 | Phase 11F final access-lifecycle hardening and closure completed as an unweighted governance/administration phase with no roadmap units or points. Runtime baseline `master @ 63e43d1`, directly descended from the v1.18 metadata commit, closes inactive/deleted-user authentication, sibling refresh-token revocation, live actor/tenant JWT revalidation, monotonic stale-scope assignment invalidation and correction, and effective permission-coupled Reporting scope. Adds 1 migration (26 → 27) and 18 API tests (336 → 354 across 27 files), with no table or permission; complete governed-access and lifecycle real-browser smoke pass separately. Builder/Module Manifest runtime, Advanced waves, Client Extensions, broader user lifecycle/profile/status administration, and governed user provisioning remain unstarted. Numerator and denominator remain 174 / 174 and 180 / 353. |
| v1.18 | 2026-08-24 | Phase 11F Business Admin Console Governed Access Management completed as an unweighted governance/administration phase with no roadmap units or points. Runtime baseline `master @ fc01876` adds tenant-local privacy-minimized access review, on-demand one-role permission summaries, and separately authorized assignment/removal of existing roles with explicit Data Scope, exact-assignment uniqueness, atomic privacy-safe audit, and manager-lockout safeguards. Adds 1 migration (25 → 26), 1 permission (76 → 77), 23 API tests (313 → 336 across 26 files), and no table; real-browser governed add/remove and responsive dialog smoke passes separately. No Builder/manifest/package runtime, broad administration editing, Advanced wave, Client Extension, or weighted business capability. Numerator and denominator remain 174 / 174 and 180 / 353. |
| v1.17 | 2026-08-24 | Phase 11E Platform Shell & Admin Console UX Implementation Foundation completed with no roadmap units or points. Runtime baseline `master @ 26fc99f` implements static three-group capability navigation, responsive accessible shell/drawer behavior, reusable UI states, URL-durable read-only Admin Console sections, and strengthened real-browser smoke. No API, migration, permission, Builder/manifest/package runtime, Advanced wave, Client Extension, or business-capability change. API evidence remains 313/313 tests across 25 files; browser smoke is recorded separately. Numerator and denominator remain 174 / 174 and 180 / 353. |
| v1.16 | 2026-08-23 | Phase 11D Platform Experience System & Admin Console UX Direction completed with no roadmap units or points: defines unified visual direction, modular capability-aware navigation, multi-device responsive adaptations, Business Admin Console UX, and governed Platform Architect/Builder UX principles (B0–B4 risk matrix). Strictly documentation-driven; no runtime code modified, no Builder/manifest runtime, no Advanced wave, no Client Extension started. Numerator and denominator remain 174 / 174 and 180 / 353; implementation baseline remains `master @ 3145627`. |
| v1.15 | 2026-08-23 | Phase 11C Business Admin Console Foundation completed with no roadmap units or points: a tenant-local, strictly read-only consolidation of existing administration areas behind a new `admin.console.read` entry permission, with every section additionally gated by the permission already governing that data. Adds 1 permission (75 → 76), 1 migration (24 → 25), and 19 API tests (294 → 313 across 25 files); no new table. No mutation surface, Builder/metadata runtime, Advanced wave, Client Extension, or new business functionality started. Numerator and denominator remain 174 / 174 and 180 / 353. |
| v1.14 | 2026-08-23 | Phase 11B platform boundary enforcement completed with no roadmap units or points: dependency-free validator, 23 focused tests, CI/root validation integration, and module-neutral money formatter boundary cleanup. Module Manifest readiness remains advisory; no Builder/runtime manifest, Advanced wave, Client Extension, or new business functionality started. Numerator and denominator remain 174 / 174 and 180 / 353; API runtime evidence remains `master @ ebd56c2`. |
| v1.13 | 2026-08-23 | Phase 11A architecture/governance foundation completed with no roadmap units or points: Platform Kernel, package/extension contracts and Manifest v1, Dual Admin trust separation, governed Builder risk model, and installer direction documented. No runtime implementation, Advanced wave, or Client Extension started. Numerator and denominator remain 174 / 174 and 180 / 353. |
| v1.12 | 2026-08-22 | Phase H2 (Production Hardening) delivered: PH-3, PH-4, PH-8 COMPLETED (7 pts earned). Platform Hardening and Core Product Readiness reach 100%; backup/restore drill, repeatable deployment, migration roundtrip, and durable Integration outbox validated. Denominator unchanged at 174 / 353 — pure earned progress, no scope added. |
| v1.11 | 2026-08-21 | Phase H (Pilot Hardening) delivered: PH-1, PH-2, PH-5, PH-6, PH-7 COMPLETED (9 pts earned). Pilot readiness gate satisfied. Denominator unchanged at 174 / 353 — pure earned progress, no scope added. |
| v1.10 | 2026-08-21 | Phase 10 delivered and corrected: CUS.4 COMPLETED with CUS-CORE-009 maintenance route/UI/test evidence (2 pts earned). Denominator unchanged at 174 / 353 — pure earned progress, no scope added. |
| v1.9 | 2026-08-21 | Phase 9 delivered: RPT.1–RPT.4 COMPLETED (10 pts earned). Denominator unchanged at 174 / 353 — pure earned progress, no scope added. |
| v1.8 | 2026-08-21 | Phase 8 delivered: PRJ.1–PRJ.4 COMPLETED (8 pts earned). Denominator unchanged at 174 / 353 — pure earned progress, no scope added. |
| v1.7 | 2026-08-21 | Phase 7 delivered: HSE.1–HSE.4 COMPLETED (9 pts earned). Denominator unchanged at 174 / 353 — pure earned progress, no scope added. |
| v1.6 | 2026-08-20 | Phase 6 delivered: FIN.1–FIN.6 COMPLETED (12 pts earned). Denominator unchanged at 174 / 353 — pure earned progress, no scope added. |
| v1.5 | 2026-08-20 | Phase 5 delivered: AST.1–AST.4 COMPLETED (8 pts earned). Denominator unchanged at 174 / 353 — pure earned progress, no scope added. |
| v1.0 | 2026-08-20 | First canonical roadmap. Replaces template-shaped `22-…`. Establishes layers, 11 Business Core modules, weighted units, dual progress metric. Records Phase 1F as NOT APPLICABLE. |
| v1.4 | 2026-08-20 | Phase 4 delivered: SCM.1–SCM.6 COMPLETED (14 pts earned). Denominator unchanged at 174 / 353 — pure earned progress, no scope added. |
| v1.3 | 2026-08-20 | Phase 3 delivered: HR.1–HR.5 COMPLETED (10 pts earned). Denominator unchanged at 174 / 353 — pure earned progress, no scope added. |
| v1.2 | 2026-08-20 | Phase 2 delivered: OPS.1–OPS.5 COMPLETED (13 pts earned). Denominator unchanged at 174 / 353 — no scope was added, so the movement is pure earned progress. |
| v1.1 | 2026-08-20 | Founder-aligned baseline after PRD reconstruction. Roadmap units reconciled against canonical PRD requirement IDs; IGSEP legacy requirements migrated via the [traceability matrix](../prd/abixell-one/14-traceability-matrix.md) with **no denominator change** (all legacy items were ADOPT/ADAPT/MERGE/RECLASSIFY into units that already existed, or SUPERSEDE/pack items that do not add weight). Repository architecture rules frozen in the blueprint. |

## 14. Roadmap unit ↔ PRD requirement mapping

Every roadmap unit traces to canonical PRD requirement IDs:

| Roadmap unit(s) | PRD requirements |
|---|---|
| PC-1…PC-13 | `PLT-CORE-001`…`PLT-CORE-018`, `SEC-*`, `INT-001`…`INT-010`, `UX-001`…`UX-004` |
| PH-1…PH-8 | `OPS-010`…`OPS-023`, `SEC-010`, `SEC-011`, `INT-011`, `UX-005` |
| CUS.1–CUS.4 | `CUS-CORE-001`…`CUS-CORE-009` |
| CMP.1–CMP.7 | `SQ-CORE-001`…`SQ-CORE-016` |
| SRV.1–SRV.3 | `SUR-CORE-001`…`SUR-CORE-016` |
| Advanced (delivered) | `SUR-ADV-001`, `SUR-ADV-002`, `CUS-ADV-001`, `CUS-ADV-002`, `SQ-ADV-001`…`SQ-ADV-004` |
| OPS.1–OPS.5 | `SO-CORE-001`…`SO-CORE-015` |
| HR.1–HR.5 | `HR-CORE-001`…`HR-CORE-010` |
| SCM.1–SCM.6 | `SCM-CORE-001`…`SCM-CORE-013` |
| AST.1–AST.4 | `AST-CORE-001`…`AST-CORE-010` |
| FIN.1–FIN.6 | `FIN-CORE-001`…`FIN-CORE-011` |
| HSE.1–HSE.4 | `HSE-CORE-001`…`HSE-CORE-010` |
| PRJ.1–PRJ.4 | `PRJ-CORE-001`…`PRJ-CORE-010` |
| RPT.1–RPT.4 | `RPT-CORE-001`…`RPT-CORE-008` |
| Advanced waves | all `*-ADV-*` requirements |
| Pack wave | `PACK-001`…`PACK-004` |
