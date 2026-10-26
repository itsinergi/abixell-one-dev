# Point Ledger — Full Approved Roadmap (353 pts)

| Item | Value |
|---|---|
| Document type | Derivative view — no canonical authority |
| Derived from | `docs/canonical/product-roadmap.md` v1.28 §6–§9, `docs/canonical/product-progress.md` §2–§4 |
| Headline | Full Approved Roadmap Progress **308 / 353 = 87.3%** · Core Product Readiness **174 / 174 = 100.0%** |
| Purpose | Show which named unit owns which point, and whether that point is earned |

This file answers one question: *where do the 353 points live?* It transcribes
`product-roadmap.md` unit by unit and adds the earned column. It moves no point, changes no
denominator, and authorizes nothing. Where it disagrees with the canonical files, the
canonical files win.

## 1. Denominators

```text
Platform Core          41   completed  41
Platform Hardening     16   completed  16
Business Core         117   completed 117
Advanced Capabilities 179   completed 134

Core Product Readiness   = (41 + 117 + 16) / 174 = 174 / 174 = 100.0%
Full Approved Roadmap    = (174 + 134) / (174 + 179) = 308 / 353 = 87.3%
```

Consistency check (from `product-progress.md:138-143`):
Platform Core `3+3+5+5+5+2+2+3+3+2+3+2+3 = 41` ✓ ·
Platform Hardening `3+2+2+3+2+1+1+2 = 16` ✓ ·
Business Core `9+15+9+13+10+14+8+12+9+8+10 = 117` ✓ ·
Advanced `8+11+19+13+24+21+22+11+13+14+13+10 = 179` ✓ ·
Core denominator `41+117+16 = 174` ✓ · Full denominator `174+179 = 353` ✓.

| Layer | Total | Earned | % |
|---|---:|---:|---:|
| Platform Core | 41 | 41 | 100.0% |
| Platform Hardening | 16 | 16 | 100.0% |
| Business Core | 117 | 117 | 100.0% |
| Advanced Capabilities | 179 | 134 | 74.9% |
| **Full Approved Roadmap** | **353** | **308** | **87.3%** |

## 2. Platform Core — 41 pts, 41 earned

| ID | Unit | W | Earned |
|---|---|---:|---:|
| PC-1 | Tenant / Legal Entity / Org Unit / Project / Site hierarchy | 3 | 3 |
| PC-2 | Identity, authentication, session | 3 | 3 |
| PC-3 | RBAC, permissions, Data Scope (hierarchical + customer) | 5 | 5 |
| PC-4 | Configuration & Metadata Engine | 5 | 5 |
| PC-5 | Workflow & Approval Engine | 5 | 5 |
| PC-6 | Audit foundation | 2 | 2 |
| PC-7 | Domain Events / EventBus | 2 | 2 |
| PC-8 | Notification Engine | 3 | 3 |
| PC-9 | Document Service + entity authorization | 3 | 3 |
| PC-10 | Scheduler | 2 | 2 |
| PC-11 | Integration Boundary | 3 | 3 |
| PC-12 | Observability | 2 | 2 |
| PC-13 | App Shell, Design System, responsive, PWA | 3 | 3 |
| **Total** | | **41** | **41** |

## 3. Platform Hardening — 16 pts, 16 earned

| ID | Unit | W | Gate | Earned |
|---|---|---:|---|---:|
| PH-1 | CI/CD pipeline (lint/typecheck/test/build) | 3 | Pilot | 3 |
| PH-2 | CORS allowlist + rate-limit tuning + header review | 2 | Pilot | 2 |
| PH-3 | Backup / restore / DR runbook | 2 | Production | 2 |
| PH-4 | Deployment & environment provisioning automation | 3 | Production | 3 |
| PH-5 | Performance fixes (operational queue N+1) | 2 | Pilot | 2 |
| PH-6 | Dependency advisory remediation | 1 | Pilot | 1 |
| PH-7 | PWA installability assets (PNG 192/512) | 1 | Pilot | 1 |
| PH-8 | Integration reconciliation / outbox worker | 2 | Production | 2 |
| **Total** | | **16** | | **16** |

## 4. Business Core — 117 pts, 117 earned

| Module | Units | W | Earned |
|---|---|---:|---:|
| BC-1 Customer & Commercial | CUS.1–CUS.4 | 9 | 9 |
| BC-2 Service Quality (Complaint) | CMP.1–CMP.7 | 15 | 15 |
| BC-3 Survey & Assessment | SRV.1–SRV.3 | 9 | 9 |
| BC-4 Service Operations & Work Mgmt | OPS.1–OPS.5 | 13 | 13 |
| BC-5 Workforce (HR) Core | HR.1–HR.5 | 10 | 10 |
| BC-6 Supply Chain Core | SCM.1–SCM.6 | 14 | 14 |
| BC-7 Asset Core | AST.1–AST.4 | 8 | 8 |
| BC-8 Finance Core | FIN.1–FIN.6 | 12 | 12 |
| BC-9 HSE Core | HSE.1–HSE.4 | 9 | 9 |
| BC-10 Project Delivery Core | PRJ.1–PRJ.4 | 8 | 8 |
| BC-11 Reporting & Operational Insight | RPT.1–RPT.4 | 10 | 10 |
| **Total** | | **117** | **117** |

Per-unit weights: see `product-roadmap.md` §8. All eleven modules are COMPLETED.

## 5. Advanced Capabilities — 179 pts, 134 earned

| Module | Units (weight) | W | Earned |
|---|---|---:|---:|
| Customer & Commercial | Sales/opportunity/quotation (5) ✅ · Self-service portal (3) ✅ | 8 | 8 |
| Service Quality | Multidimensional SLA + calendar (3) ✅ · RCA taxonomy + advanced CAPA (3) ✅ · Recurring-problem detection & analytics (3) ✅ · Automatic domain mutation from feedback (2) ✅ | 11 | 11 |
| Survey & Assessment | Survey-to-Action trigger→assignment (3) ✅ · Outcome→management attention (3) ✅ · Conditional/matrix (3) ✅ · Weighted/section/NPS (2) ✅ · Anonymous/public token (3) ✅ · Multi-language (2) ✅ · Analytics & benchmarking (3) ✅ | 19 | 19 |
| Service Operations | Vertical service packs (5) ✅ · Route/roster optimization (3) ✅ · **Offline field PWA (5) — DEFERRED** | 13 | 8 |
| Workforce (HR) | Attendance/shift/roster (5) ✅ · Leave & overtime (3) ✅ · Payroll+BPJS+PPh21 (5) ✅ · Recruitment (3) ✅ · Performance/competency/training/career (5) ✅ · Manpower planning (3) ✅ | 24 | 24 |
| Finance | GL/COA/journal (5) ✅ · AP/AR + aging (3) ✅ · Budgeting & cost center (3) ✅ · Bank reconciliation (2) ✅ · Fixed-asset accounting (3) ✅ · Tax/consolidation/statements (5) ✅ | 21 | 21 |
| Supply Chain | Multi-warehouse/bin/batch/serial (5) ✅ · Reservation/reorder/transfer/opname (3) ✅ · Valuation + landed cost (3) ✅ · RFQ/tender/bid (5) ✅ · Supplier evaluation & contract purchasing (3) ✅ · Spend analytics (3) ✅ | 22 | 22 |
| Asset | Preventive & corrective maintenance + work orders (5) ✅ · Meter/spare parts/downtime (3) ✅ · MTBF/MTTR + predictive (3) ✅ | 11 | 11 |
| Project Delivery | WBS/dependencies/Gantt (5) · Resource loading + baseline (3) · Earned value + cost control + project accounting (5) | 13 | 0 |
| HSE | Investigation + JSA/HIRA (5) · Permit to work (3) · Inspection & audit (3) · Environmental monitoring + CAPA + indicators (3) | 14 | 0 |
| Platform (cross-cutting) | API economy / partner surface (3) · AI readiness (5) · Marketplace & ecosystem (5) | 13 | 0 |
| Reporting | Self-service BI / warehouse (5) ✅ · Predictive analytics (5) ✅ | 10 | 10 |
| **Total** | | **179** | **134** |

`SO-ADV-006` (Offline Field PWA, 5 pts) is **DEFERRED** by Founder decision and requires a
dedicated architecture ADR before any implementation. It is the only deferred unit.

## 6. Where the 308 earned points come from

Thirteen delivered capability groups, evidence per `product-progress.md` §5:

| Group | Pts | Earned at | Evidence anchor |
|---|---:|---|---|
| Platform Core PC-1…PC-13 | 41 | Phase 0 | migrations `1755500000000`–`1756000000000`; `phase0-stabilization.test.ts` |
| Platform Hardening PH-1…PH-8 | 16 | Phase H + Phase H2 | `phase-h2-integration-outbox.test.ts` (14); DR runbook; deploy flow |
| Business Core BC-1…BC-11 | 117 | Phases 1A–1E, 5–10 | per-module integration suites (see `product-progress.md` §5) |
| Wave A1 | 19 | v1.20 | migration `1776000000000`, `1777000000000`; `wave-a1-integration.test.ts` (36) |
| Wave A2 | 23 | v1.21 | migration `1778000000000`; `wave-a2-integration.test.ts` (23) |
| Wave A3 (revised) | 19 | v1.22 | migration `1779000000000`; `wave-a3-integration.test.ts` (29) |
| Wave A4 | 24 | v1.23–v1.24 | migration `1780000000000`; `wave-a4-integration.test.ts` (26) |
| Wave A5 | 22 | v1.25 | migration `1781000000000`; `wave-a5-integration.test.ts` (20) |
| Wave A6 | 21 | v1.26 | migrations `1795100000000`–`1795900000000`; 144 focused integration tests + 32 catalog/registry tests |
| **Sum** | **308** | | |

## 7. Where the 45 remaining points live

| Wave | Pts | State | Owner |
|---|---:|---|---|
| Wave A7 — Project Delivery + HSE Advanced | 27 | Not authorized | unscoped |
| Wave A8 — Platform cross-cutting Advanced | 13 | Not authorized | unscoped |
| `SO-ADV-006` — Offline Field PWA | 5 | Deferred | awaits dedicated ADR |
| **Total** | **45** | | |

### 7.1 Wave A6 — built vs earned

`built` = code merged to `master`. `earned` = closure evidence accepted under the
`COMPLETED = full weight` rule. Merged code without closure evidence earns **0**.

| Unit | Pts | Built | Earned | Built by |
|---|---:|---:|---:|---|
| GL / COA / journal | 5 | 5 | 5 | `882bbdd` (#40 COA Builder); page `08e2ea5` (#66) |
| AP/AR + aging | 3 | 3 | 3 | `010ba93` (#57); page `08e2ea5` (#66) |
| Budgeting & cost center | 3 | 3 | 3 | `009c8a4` (#58); page `08e2ea5` (#66) |
| Bank reconciliation | 2 | 2 | 2 | `0ed302c` (#59); page `08e2ea5` (#66) |
| Fixed-asset accounting & depreciation | 3 | 3 | 3 | `f394209` (#61); page `08e2ea5` (#66) |
| Tax / consolidation / financial statements | 5 | 5 | 5 | `7f87018` (#62 tax, ADR-0019); `8bb062a` (#63 consolidation + FSV, ADR-0022); page `08e2ea5` (#66) |
| **Total** | **21** | **21** | **21** | |

Every Wave A6 unit is built and every unit now carries closure evidence: the API
surface from the seven build units, the two read-only pages from A6.1 (`08e2ea5`,
terminology fix `9549709`), and the six write pages from A6.2 (migration
`1795900000000`). Evidence lives in
[closure-evidence-wave-a6.md](closure-evidence-wave-a6.md), with the A6.2 catalog and
test results in its "Menu catalog entries (Wave A6.2)" and "Evidence (Wave A6.2)"
sections.

`FIN-ADV-007` consolidation and `FIN-ADV-008` financial statements remain read-only on
`/finance/statements`. That is the delivered boundary of those units, not an open gap:
ADR-0022 puts consolidation posting behind the kernel and the approval runtime, and no
page writes either.

Closing A6 moved the headline to **308 / 353 = 87.3%**.

## 8. Reading rules

- `COMPLETED = full weight`; `IN PROGRESS = 0`; `PLANNED/DEFERRED = 0`
  (`product-progress.md:107-108`). No estimation, no partial credit.
- **ADR approval earns nothing.** Founder approved all eight Wave A6 ADRs (0015–0022) on
  2026-10-24; that authorizes work, it does not earn points.
- **Built ≠ earned.** A merged, tested, typechecked module still earns 0 until closure
  evidence is accepted. Wave A7's units will be the next example: built code earns 0 until
  its closure evidence is accepted.
- **Individual client configuration is not product progress** (`product-progress.md:149`).
- **No denominator change** without Founder approval of new roadmap scope.
- Units whose weight cannot be read directly from `product-roadmap.md` would be marked
  `ASUMSI`; at this baseline every weight was readable, so no assumption is used.
