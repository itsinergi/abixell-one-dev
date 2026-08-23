# Abixell One — Product Roadmap

| | |
|---|---|
| **Document Status** | CANONICAL |
| **Authority** | Founder (Insting Tekno Sinergi) |
| **Roadmap Baseline** | v1.13 |
| **Progress Model** | v1.0 |
| **Last Updated** | 2026-08-23 |
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

**Phase 0 — COMPLETED. Phase 1 — COMPLETED (FD-POST-1-02). Phase 2 — COMPLETED. Phase 3 — COMPLETED. Phase 4 — COMPLETED. Phase 5 — COMPLETED. Phase 6 — COMPLETED. Phase 7 — COMPLETED. Phase 8 — COMPLETED. Phase 9 — COMPLETED. Phase 10 — COMPLETED. Phase H — COMPLETED. Phase H2 — COMPLETED. Phase 11A (unweighted architecture/governance) — COMPLETED.**

---

## 5. Current product baseline

| Item | Value |
|---|---|
| Branch / commit | `master @ ebd56c2` (Phase H2 Production platform hardening metadata baseline) |
| Migrations | 24 |
| Migration head | `1772000000000_phase-h2-outbox-safety-correction.cjs` |
| Tables | 85 |
| Permissions | 75 |
| Tests | 294 PASS (24 files) |
| Core / Full progress | 174 / 174 (100.0%) / 180 / 353 (51.0%) |
| typecheck / lint / build | PASS |

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

## 9. Roadmap units — Advanced Capabilities (weight 179, 6 completed)

| Module | Units (weight) | W | Done |
|---|---|---:|---:|
| Customer & Commercial | Sales/opportunity/quotation (5) · Self-service portal expansion (3) | 8 | 0 |
| Service Quality | Multidimensional SLA + calendar (3) · RCA taxonomy + advanced CAPA (3) · Recurring-problem detection & service analytics (3) · Automatic domain mutation from feedback (2) | 11 | 0 |
| Survey & Assessment | **Survey-to-Action trigger→assignment (3) ✅** · **Outcome→management attention (3) ✅** · Conditional/matrix (3) · Weighted/section/NPS (2) · Anonymous/public token (3) · Multi-language (2) · Analytics & benchmarking (3) | 19 | **6** |
| Service Operations | Vertical service packs (5) · Offline field PWA (5) · Route/roster optimization (3) | 13 | 0 |
| Workforce (HR) | Attendance/shift/roster (5) · Leave & overtime (3) · Payroll+BPJS+PPh21 (5) · Recruitment (3) · Performance/competency/training/career (5) · Manpower planning (3) | 24 | 0 |
| Finance | GL/COA/journal (5) · AP/AR + aging (3) · Budgeting & cost center (3) · Bank reconciliation (2) · Fixed-asset accounting (3) · Tax/consolidation/statements (5) | 21 | 0 |
| Supply Chain | Multi-warehouse/bin/batch/serial (5) · Reservation/reorder/transfer/opname (3) · Valuation + landed cost (3) · RFQ/tender/bid (5) · Supplier evaluation & contract purchasing (3) · Spend analytics (3) | 22 | 0 |
| Asset | Preventive & corrective maintenance + work orders (5) · Meter/spare parts/downtime (3) · MTBF/MTTR + predictive (3) | 11 | 0 |
| Project Delivery | WBS/dependencies/Gantt (5) · Resource loading + baseline (3) · Earned value + cost control + project accounting (5) | 13 | 0 |
| HSE | Investigation + risk assessment JSA/HIRA (5) · Permit to work (3) · Inspection & audit (3) · Environmental monitoring + CAPA + indicators (3) | 14 | 0 |
| Platform (cross-cutting) | API economy / partner surface (3) · AI readiness (5) · Marketplace & ecosystem (5) | 13 | 0 |
| Reporting | Self-service BI / warehouse (5) · Predictive analytics (5) | 10 | 0 |

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
| **Wave A+** | Advanced capability waves | per module | 179 | respective Core | PLANNED / OPTIONAL |

### Unweighted architecture / governance phases

These phases establish contracts or governance without delivering a weighted product capability. They do not use S/M/L/XL points and change neither numerator nor denominator.

| Phase | Name | Product units | Weight | Status | Scope result |
|---|---|---|---:|---|---|
| ~~Phase 11A~~ | Platform Kernel & Builder Architecture Foundation | None | — | **COMPLETED** | Platform Kernel, package/extension boundaries and Manifest v1, Dual Admin trust planes, governed Builder risk/lifecycle, and cross-platform installer direction documented; no runtime enforcement or business capability |

Phase 11A starts no Advanced wave and registers no Client Extension. Builder UI/API/runtime, manifest/package runtime, universal module-activation enforcement, one-click installer code, or desktop wrapper requires separate Founder authorization, PRD requirements, and weighted roadmap units before implementation.

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
| Advanced (delivered) | `SUR-ADV-001`, `SUR-ADV-002` |
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
