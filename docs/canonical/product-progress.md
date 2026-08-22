# Abixell One — Product Progress

| | |
|---|---|
| **Document Status** | CANONICAL |
| **Authority** | Founder (Insting Tekno Sinergi) |
| **Roadmap Baseline** | v1.12 |
| **Progress Model** | v1.0 |
| **Last Updated** | 2026-08-22 |
| **Measured at** | `master @ 0e24edb` · 287/287 tests · 84 tables · 23 migrations |
| **Related** | [PRD](../prd/abixell-one/00-README.md) · [product-roadmap.md](product-roadmap.md) · [product-blueprint.md](product-blueprint.md) · [documentation-map.md](documentation-map.md) |

---

## 1. Headline

| Metric | Value | Δ since v1.11 |
|---|---:|---:|
| **Core Product Readiness** | **100.0 %** | ▲ 4.0 pts |
| **Full Approved Roadmap Progress** | **51.0 %** | ▲ 2.0 pts |

Two metrics are reported deliberately. A single number would misrepresent the product: the deployable Core is far more mature than the full Advanced roadmap, and optional Advanced depth should not make a usable product look unfinished.

- **Core Product Readiness** = Platform Core + Business Core + required Platform Hardening.
- **Full Approved Roadmap Progress** = Core Product Readiness + all approved Advanced capabilities.
- **Client Extensions are excluded from both** — custom client work must never shrink product completion.

---

## 2. Layer progress

| Layer | Completed / Total | % |
|---|---:|---:|
| Platform Core | 41 / 41 | **100 %** |
| Platform Hardening | 16 / 16 | **100.0 %** |
| Business Core | 117 / 117 | **100 %** |
| Advanced Capabilities | 6 / 179 | **3.4 %** |

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
| Customer & Commercial | 9 / 17 | 52.9 % |
| Service Quality (Complaint) | 15 / 26 | 57.7 % |
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
Advanced Capabilities  total 179   completed   6

Core Product Readiness
  denominator = 41 + 117 + 16 = 174   (unchanged)
  completed   = 41 + 117 + 16 = 174
  in-progress earned          =   0
  (174 + 0) / 174 × 100 = 100.0 %

Full Approved Roadmap
  denominator = 174 + 179 = 353       (unchanged)
  completed   = 174 +   6 = 180
  (180 + 0) / 353 × 100 = 51.0 %
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
| PH-3, PH-4, PH-8 | Phase H2 (Production Hardening); backup/restore/verification scripts and DR runbook; multi-stage API operations/runtime and Web images; environment-validated Compose deploy/migrate/health/smoke flow; migration `1771000000000`; durable Tenant-scoped Integration outbox with reconciliation, stale-claim recovery, bounded retry, terminal visibility, and concurrent `SKIP LOCKED` claims; `phase-h2-integration-outbox.test.ts` (7); isolated restore drill (1 document checksum), migration up/down/up, fresh and repeated deployment validated; commit `0e24edb` |
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

**None.** Phase 10, Phase H (Pilot Hardening), and Phase H2 (Production Hardening) are closed; all Core Product Readiness units are complete. Advanced capability waves remain planned / optional until explicitly authorized.

## 8. Progress change log

| Baseline | Date | Core Readiness | Full Roadmap | Note |
|---|---|---:|---:|---|
| v1.12 | 2026-08-22 | 100.0 % | 51.0 % | **Phase H2 (Production Hardening) delivered.** Numerator +7 (PH-3, PH-4, PH-8); denominator unchanged at 174 / 353. Pure earned progress. 287/287 tests passing; 84 tables and 23 migrations. Core Product Readiness achieved. |
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
