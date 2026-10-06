# Abixell One — Product Roadmap

| | |
|---|---|
| **Document Status** | CANONICAL |
| **Authority** | Founder (Insting Tekno Sinergi) |
| **Roadmap Baseline** | v1.27 |
| **Progress Model** | v1.0 |
| **Last Updated** | 2026-10-06 |
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

**Phase 0 — COMPLETED. Phase 1 — COMPLETED (FD-POST-1-02). Phase 2 — COMPLETED. Phase 3 — COMPLETED. Phase 4 — COMPLETED. Phase 5 — COMPLETED. Phase 6 — COMPLETED. Phase 7 — COMPLETED. Phase 8 — COMPLETED. Phase 9 — COMPLETED. Phase 10 — COMPLETED. Phase H — COMPLETED. Phase H2 — COMPLETED. Phase 11A (unweighted architecture/governance) — COMPLETED. Phase 11B (unweighted boundary enforcement) — COMPLETED. Phase 11C (unweighted read-only admin console) — COMPLETED. Phase 11D (unweighted platform experience system & UX direction) — COMPLETED. Phase 11E (unweighted platform shell & admin console UX foundation) — COMPLETED. Phase 11F (unweighted governed admin access management and access-lifecycle hardening) — COMPLETED. Wave A1 — COMPLETED. Wave A2 — COMPLETED. Wave A3 (revised) — COMPLETED. Wave A4 — COMPLETED. Wave A5 — COMPLETED. Wave A5.1 (unweighted SCM decomposition: WMS & Procurement) — COMPLETED.**

---

## 5. Current product baseline

| Item | Value |
|---|---|
| Branch / commit | `master` @ `c3fe17e` (Wave A5.1 SCM Decomposition + Epic 2 Wave 2-3 Reference Data & Parameter Bridge merged) |
| Migrations | 91 (Wave A5.1: 36 including 3 new `1782…1784`; Epic 2 Wave 2-3: 55 additional) |
| Migration head | Latest Epic 2 Wave 2-3 reference-data / parameter-bridge migration |
| Database ownership | WMS owns 36 tables; Procurement owns 12; 7 shared-master-data tables are consumed through read ports. No fresh whole-database table count was performed for this documentation reconciliation. |
| Permissions | 197 migration-owned permissions, confirmed by `node scripts/validate-platform-boundaries.mjs` on 2026-10-06 (149 recorded at 7b66c65; rose to 197 through migrations added between 7b66c65 and c3fe17e plus Phase 0 Track A BN-01 discovery/remediation of 11 boundary-discipline findings; 0 duplicate codes) |
| API tests | Handoff baseline at `7b66c65`: 586/586 PASS across 39 files. Not rerun during this reconciliation or during Track A (vitest unit suite timed out in the Track A sandbox — see `TRACK_A_EXECUTION_LOG.md` BN-03 — evidence gap, not a failure). |
| Browser smoke | Handoff baseline at `7b66c65`: PASS (10 journeys E2E smoke against API :4000 / Web :5173, browser console 0 errors). Not rerun during this reconciliation. |
| Core / Full progress | 174 / 174 (100.0%) / 287 / 353 (81.3%) — Wave A5.1 and Epic 2 Wave 2-3 are unweighted technical/foundational work; Phase 0 Track A hardening is also unweighted |
| typecheck / lint / build | Track A (2026-10-06) confirms typecheck 0 errors and lint 0 errors (49 warnings, pre-existing, out of Track A scope) for both `apps/api` and `apps/web`, direct tool invocation. Build and `npm audit` not rerun — evidence gap, see `TRACK_A_EXECUTION_LOG.md` BN-03. |
| Security | `npm audit --omit=dev` — last recorded 0 vulnerabilities at `7b66c65`; not rerun (no registry network access in Track A sandbox) |
| Launcher | PARTIAL — `db:up` environment-blocked (Docker daemon unreachable; native Windows `postgres.exe` owns 5432). Downstream steps re-inspected, launcher left unmodified. Not a full PASS. |
| Platform boundary validation | 0 blocking findings (after Track A BN-01 fixed 11 discovered violations); 1 expected Manifest advisory (ADR-0014); 197 migration-owned permissions |

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

## 9. Roadmap units — Advanced Capabilities (weight 179, 113 completed)

| Module | Units (weight) | W | Done |
|---|---|---:|---:|
| Customer & Commercial | **Sales/opportunity/quotation (5) ✅** · **Self-service portal expansion (3) ✅** | 8 | **8** |
| Service Quality | **Multidimensional SLA + calendar (3) ✅** · **RCA taxonomy + advanced CAPA (3) ✅** · **Recurring-problem detection & service analytics (3) ✅** · **Automatic domain mutation from feedback (2) ✅** | 11 | **11** |
| Survey & Assessment | **Survey-to-Action trigger→assignment (3) ✅** · **Outcome→management attention (3) ✅** · **Conditional/matrix (3) ✅** · **Weighted/section/NPS (2) ✅** · **Anonymous/public token (3) ✅** · **Multi-language (2) ✅** · **Analytics & benchmarking (3) ✅** | 19 | **19** |
| Service Operations | **Vertical service packs (5) ✅** · Offline field PWA (5) · **Route/roster optimization (3) ✅** | 13 | **8** |
| Workforce (HR) | **Attendance/shift/roster (5) ✅** · **Leave & overtime (3) ✅** · **Payroll+BPJS+PPh21 (5) ✅** · **Recruitment (3) ✅** · **Performance/competency/training/career (5) ✅** · **Manpower planning (3) ✅** | 24 | **24** |
| Finance | GL/COA/journal (5) · AP/AR + aging (3) · Budgeting & cost center (3) · Bank reconciliation (2) · Fixed-asset accounting (3) · Tax/consolidation/statements (5) | 21 | 0 |
| Supply Chain | **Multi-warehouse/bin/batch/serial (5) ✅** · **Reservation/reorder/transfer/opname (3) ✅** · **Valuation + landed cost (3) ✅** · **RFQ/tender/bid (5) ✅** · **Supplier evaluation & contract purchasing (3) ✅** · **Spend analytics (3) ✅** | 22 | **22** |
| Asset | **Preventive & corrective maintenance + work orders (5) ✅** · **Meter/spare parts/downtime (3) ✅** · **MTBF/MTTR + predictive (3) ✅** | 11 | **11** |
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
| ~~Wave A3~~ | Service Operations & Asset Advanced (revised) | PACK-001…004, SO-ADV-002…005, AST-ADV-001…007 | 19 | BC-4, BC-7 | **COMPLETED** |
| ~~Wave A4~~ | Workforce Advanced | HR-ADV-001…009 | 24 | BC-5 | **COMPLETED** |
| ~~Wave A5~~ | Supply Chain Advanced | SCM-ADV-001…008 | 22 | BC-6 | **COMPLETED** |
| ~~Wave A5.1~~ | SCM decomposition into WMS and Procurement | No new weighted unit | — | Wave A5 | **COMPLETED** |
| **Wave A6+** | Remaining Advanced capability waves | per module | 66 | respective Core | PLANNED / OPTIONAL |

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
| v1.27 | 2026-10-06 | **Phase 0 Track A canonical reconciliation — unweighted.** Canonical runtime reference advances from `master @ 7b66c65` to committed baseline `c3fe17e` (Epic 2 Wave 2-3 merged), with current authorized Track A worktree evidence recorded separately in `TRACK_A_EXECUTION_LOG.md`. Repository migration inventory is 91; platform-boundary validation reports 0 blocking findings, 1 expected Module Manifest advisory (ADR-0014), and 197 migration-owned permissions after BN-01 remediated all 11 discovered boundary-discipline violations and BN-03 re-pinned the baseline. API 586/586 and browser smoke remain historical handoff evidence from `7b66c65`, not fresh Track A reruns; Track A unit-suite execution timed out in the sandbox and therefore remains an evidence gap, not a claimed failure. Typecheck and lint were freshly verified with 0 errors on 2026-10-06; build, PWA, audit, runtime migration, and browser smoke were not rerun. Core remains 174/174 (100.0%); Full remains 287/353 (81.3%); no roadmap unit, numerator, denominator, authorization, or release status changed. Track B remains HOLD; Release remains NO-GO. |
| v1.26 | 2026-09-15 | **Wave A5.1 SCM decomposition completed and merged — unweighted.** Runtime baseline `master @ 7b66c65`. Supply Chain Advanced was split into explicit Warehouse Management (36 owned tables, 12 services, canonical `/wms/*`) and Procurement Management (12 owned tables, 5 services, canonical `/procurement/*`) bounded contexts, with 7 shared-master-data tables accessed through read ports. Legacy `/supply-chain/advanced/*` routes remain compatible with RFC-8594 deprecation headers. Three repository migrations advance the stream head to `1784000000000_wave-a5-1-stage-3-module-catalog`. Latest handoff evidence reports 586/586 API tests across 39 files, 149 migration-owned permissions, 0 boundary blockers and 1 expected advisory, typecheck/build/PWA/E2E PASS, lint 0 errors and 45 warnings, and browser console 0 errors. No fresh whole-database table count or runtime rerun is claimed in this documentation reconciliation. Core remains 174/174 (100.0%); Full remains 287/353 (81.3%); no roadmap unit, numerator, denominator, or authorization changed. Waves A6–A8, Phase 11G and deferred `SO-ADV-006` remain unstarted pending separate Founder authorization. |
| v1.25 | 2026-09-01 | **Wave A5 (Supply Chain Advanced) delivered — weighted.** Six capability groups COMPLETED at full weight (+22 pts total): `SCM-ADV-001/002/003` multi-warehouse topology, bin/storage locations, batch/lot tracking, and serial tracking (5); `SCM-ADV-004` stock reservations, dynamic reorder policies and alerts, shipment/receipt inter-warehouse transfers, and stock opname reconciliation (3); `SCM-ADV-005` exact-decimal FIFO valuation layers and landed-cost allocation vouchers (3); `SCM-ADV-006` workflow-delegated RFQs/tenders, supplier quotation bids, comparative scoring, and award (5); `SCM-ADV-007` supplier performance scorecards and master purchasing contracts (3); `SCM-ADV-008` bounded spend-analytics snapshots (3). Advanced completed 91 → 113; Full numerator 265 → 287 (75.1% → 81.3%). Denominator unchanged at 174 / 353 and Core Readiness unchanged at 100.0% — pure earned progress, no scope added or reclassified. Live database evidence: 165 application base tables (166 including `pgmigrations`, plus one public VIEW), 33 migrations, 128 permissions (0 duplicate codes, 14 added by Wave A5), and migration head `1781000000000_wave-a5-supply-chain-advanced`. Test evidence: 495/495 full API regression runs across 35 files, with Wave A5 adding 20 tests in `wave-a5-integration.test.ts`; additional focused valuation unit coverage is 14/14 in `valuation-policy.test.ts`, executed separately from the full API regression. Quality gates PASS: platform boundaries (23/23 tests, 0 blocking findings, 128 migration-owned permissions), lint (0 errors), typecheck (0 errors), build (API and Web clean; existing Vite chunk-size advisory remains non-blocking), PWA validation, and `npm audit --omit=dev` (0 vulnerabilities). Security and correctness boundaries held: centralized hierarchical Organization Unit Data Scope is enforced through `RbacService` with fail-closed empty scope; every new relationship is tenant-local through composite `(tenant_id, id)` foreign keys; Advanced Stock Ledger movements are append-only and balances mutate atomically under pessimistic row locks; transfers, opnames, RFQs, supplier evaluations, and contracts delegate lifecycle ownership to Workflow Engine; valuation and landed-cost allocation use fixed-point exact-decimal arithmetic; spend analytics uses bounded tenant-safe parameterized queries with a 15-second local statement timeout. Launcher remains PARTIAL / ENVIRONMENT-BLOCKED at `db:up`; downstream migration and permission-sync steps were re-inspected for Wave A5 compatibility and require no launcher changes. Waves A6–A8, `SO-ADV-006` (deferred), Phase 11G, Platform Builder, Module Manifest runtime, and Client Extensions remain unstarted. |
| v1.24 | 2026-09-01 | **Wave A4 final precision and canonical closure completed (unweighted correction).** No product unit, numerator, or denominator change — Advanced remains 91/179 and Full remains 265/353 at 75.1 %. Three pre-closure correction items were resolved on the already-delivered Wave A4 baseline: (1) centralized hierarchical Organization Unit Data Scope enforcement (ADR-0009/ADR-0012) applied consistently across every Workforce Advanced list, detail, mutation, workflow, calculation, apply, and document-authorization access path; (2) `calculatePayrollRun()` now aggregates approved overtime using `actual_hours` with `estimated_hours` fallback, excludes pending/rejected/cancelled requests, avoids double-counting, and preserves approved/closed run immutability; (3) `payroll-policy.ts` eliminated authoritative JavaScript floating-point arithmetic — `toCents`/`mulRateCents`/`divCents` parse exact-decimal strings and fail closed with `ValidationError` (HTTP 400) instead of silently coercing invalid input via `Math.round(value * scale)`. A pre-existing, unrelated Wave A3 test defect (a hardcoded historical query window compared against a server-stamped `now()` timestamp) was also fixed, in a separate commit. Live database evidence refreshed by direct measurement: 141 application base tables (142 including `pgmigrations`, plus one public VIEW — 4 more than the 137/138 recorded at v1.23, a correction of that baseline's undercount via `information_schema` measurement, not new schema), 32 migrations, 114 permissions, and migration head `1780000000000_wave-a4-workforce-advanced`, all unchanged from v1.23. Test evidence: 475/475 full API runs across 34 files (466/33 at v1.23), adding 7 exact-decimal boundary tests in the new `payroll-policy.test.ts` and 2 additional assertions in `wave-a4-integration.test.ts` (24 → 26). Quality gates PASS: platform boundaries (23/23 tests, 0 blocking findings, 114 migration-owned permissions), lint (0 errors), typecheck (0 errors), build (API and Web clean), PWA validation, `npm audit --omit=dev` (0 vulnerabilities), and the required 10-step browser E2E PASS against API `:4000` / Web `:5173` backed by native PostgreSQL (Docker daemon unreachable on this machine; `db:up` itself remains PARTIAL / ENVIRONMENT-BLOCKED). Runtime commits `bef34e1` (data scope + overtime + arithmetic), `8c4f414` (exact-decimal boundary hardening), `361c85d` (Wave A3 date-window stabilization, test-only). Waves A5–A8, `SO-ADV-006` (deferred), Phase 11G, Platform Builder, Module Manifest runtime, and Client Extensions remain unstarted. |
| v1.23 | 2026-08-30 | **Wave A4 (Workforce Advanced) delivered — weighted.** Six capability groups COMPLETED at full weight (+24 pts total): `HR-ADV-001/002` attendance, shift, and roster (5), `HR-ADV-003/004` leave and overtime (3), `HR-ADV-005` exact-decimal payroll, BPJS Kesehatan/TK, and PPh 21 Pasal 17/TER PP 58/2023 (5), `HR-ADV-006` recruitment job postings and candidate tracking (3), `HR-ADV-007/008` performance reviews, competency dictionary, training catalog, and career paths (5), `HR-ADV-009` deterministic advisory manpower planning (3). Advanced completed 67 → 91; Full numerator 241 → 265 (68.3 % → 75.1 %). Denominator unchanged at 174 / 353 and Core Readiness unchanged at 100.0 % — pure earned progress, no scope added or reclassified. Live database evidence: 137 application base tables (138 including `pgmigrations`, plus one public VIEW), 32 migrations, 114 permissions (0 duplicate codes, 15 added by Wave A4), and migration head `1780000000000_wave-a4-workforce-advanced`. Test evidence: 466/466 full API runs across 33 files (Wave A4 adds 24 tests in `wave-a4-integration.test.ts`). Quality gates PASS: platform boundaries (23/23 tests, 0 blocking findings, 114 migration-owned permissions), lint (0 errors), typecheck (0 errors), build (API and Web clean), PWA validation, `npm audit --omit=dev` (0 vulnerabilities). Zero core regression: Workforce Core remains clean of Advanced imports and accesses Core placement state only through narrow repository port queries; workflow engine delegation delegates leave, overtime, payroll, posting, and appraisal lifecycle to generic workflow core; statutory payroll calculation uses exact scaled arithmetic and deterministic rounding; manpower planning computes gaps without auto-mutating employee masters. Waves A5–A8, SO-ADV-006 (deferred), Phase 11G, Platform Builder, Module Manifest runtime, and Client Extensions remain unstarted. |
| v1.22 | 2026-08-28 | **Wave A3 (Service Operations Advanced & Asset Advanced revised) delivered — weighted.** Five units COMPLETED at full weight (+19 pts total): `PACK-001…004` vertical service packs (5), `SO-ADV-002…005` route/roster/workload optimization (3), `AST-ADV-001/002` preventive & corrective maintenance + workflow-delegated work orders (5), `AST-ADV-003…005` monotonic meter readings, spare parts & downtime tracking (3), `AST-ADV-006/007` MTBF/MTTR reliability metrics & deterministic predictive snapshots (3). Explicit Founder decision: `SO-ADV-006` (Offline Field PWA, 5 pts) deferred awaiting dedicated architecture ADR. Advanced completed 48 → 67; Full numerator 222 → 241 (62.9 % → 68.3 %). Denominator unchanged at 174 / 353 and Core Readiness unchanged at 100.0 % — pure earned progress, no scope added or reclassified. Live database evidence: 122 application base tables (123 including `pgmigrations`, plus one public VIEW), 31 migrations, 99 permissions (0 duplicate codes, 8 added by Wave A3), and migration head `1779000000000_wave-a3-service-operations-asset-advanced`. Test evidence: 442/442 full API runs across 32 files (Wave A3 adds 29 tests in `wave-a3-integration.test.ts`). Quality gates PASS: platform boundaries (23/23 tests, 0 blocking findings, 99 migration-owned permissions), lint (0 errors), typecheck (0 errors), build (API and Web clean), PWA validation, `npm audit --omit=dev` (0 vulnerabilities). All new tables enforce multi-tenant composite foreign keys `(tenant_id, foreign_id)`; Asset Maintenance lifecycle is authoritative exclusively through Workflow Engine via `workflow_instance_id` (zero competing state machines); optimization and predictive metrics are advisory and deterministic with atomic transaction apply; meter readings enforce strong monotonicity serialized by asset row-level locking. Waves A4–A8, Phase 11G, Platform Builder, Module Manifest runtime, and Client Extensions remain unstarted. |
| v1.21 | 2026-08-27 | **Wave A2 (Survey Advanced completion & Reporting Advanced) delivered — weighted.** All seven units COMPLETED at full weight: `SUR-ADV-003` conditional branching & matrix questions (3), `SUR-ADV-004` weighted / section / NPS scoring (2), `SUR-ADV-005` anonymous & public-token distribution (3), `SUR-ADV-006` multi-language survey localization (2), `SUR-ADV-007` cross-survey analytics & benchmarking (3), `RPT-ADV-001` self-service BI & reporting warehouse (5), `RPT-ADV-002` predictive analytics across operational history (5). Advanced completed 25 → 48; Full numerator 199 → 222 (56.4 % → 62.9 %). Denominator unchanged at 174 / 353 and Core Readiness unchanged at 100.0 % — pure earned progress, no scope added or reclassified. Correction commit `435232d` closes four pre-closure defects found during acceptance review: a concurrency race allowing a single-use public distribution token to be claimed twice, permanent quota loss on a claimed-but-rejected public submission, missing tenant predicates on the analytics section-average and question-drop-off aggregate queries, and unenforced small-cell aggregate masking below 5 respondents. Public token claim is now a single guarded atomic `UPDATE ... RETURNING`, with a compensating release restoring quota if the submission fails validation after the claim; all analytics/benchmark queries are now scoped through the tenant-owned `survey_definitions` root; small-cell aggregates are masked to null/empty when the sample is non-zero and below 5. Live database evidence: 113 application base tables (114 including `pgmigrations`, plus one public VIEW), 30 migrations, 91 permissions (0 duplicate codes, 3 added by Wave A2: `survey.analytics.read`, `reporting.bi.manage`, `reporting.predictive.read`), and migration head `1778000000000_wave-a2-survey-reporting-advanced`. Test evidence: 413/413 full API runs across 31 files (Wave A2 adds 23 tests in `wave-a2-integration.test.ts`, including concurrent single-use claim, release-on-failure, and cross-tenant rogue-row isolation coverage). Quality gates PASS: platform boundaries (23/23 tests, 0 blocking findings), lint (0 errors), typecheck (0 errors), build (API and Web clean), PWA validation, `npm audit --omit=dev` (0 vulnerabilities). Survey versions remain immutable upon publication; public distribution uses SHA-256 token hashing; governed BI uses static metadata catalogs with recursive CTE Customer Data Scope injection and zero arbitrary SQL/eval; predictive analytics uses bounded statistical methods (OLS, moving averages, seasonal decomposition) with strict tenant isolation. Waves A3–A8, Phase 11G, Platform Builder, Module Manifest runtime, and Client Extensions remain unstarted. |
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
| Advanced (delivered) | `SUR-ADV-001`…`SUR-ADV-007`, `CUS-ADV-001`, `CUS-ADV-002`, `SQ-ADV-001`…`SQ-ADV-004`, `RPT-ADV-001`, `RPT-ADV-002`, `PACK-001`…`PACK-004`, `SO-ADV-002`…`SO-ADV-005`, `AST-ADV-001`…`AST-ADV-007`, `HR-ADV-001`…`HR-ADV-009`, `SCM-ADV-001`…`SCM-ADV-008` |
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
