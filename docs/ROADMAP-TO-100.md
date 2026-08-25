# Abixell One - Roadmap to 100%

| Item | Value |
|---|---|
| Document type | Planning derivative from canonical roadmap |
| Source baseline | `docs/canonical/product-roadmap.md` v1.19 and `docs/canonical/product-progress.md` v1.19 |
| Measured at | `master @ 63e43d1` |
| Current point | Full Approved Roadmap Progress: 51.0% (180 / 353 pts) |
| Current Core Product Readiness | 100.0% (174 / 174 pts) |
| Current Platform Hardening | 100.0% (16 / 16 pts) |
| Goal | Full Approved Roadmap Progress: 100% (353 / 353 pts) |
| Scope rule | No denominator change unless Founder approves new roadmap scope |
| Current authorization state | Phase H2 and Phase 11F are COMPLETED; Wave A1 is the active authorized wave; Waves A2–A8 remain PLANNED / OPTIONAL and this document starts no implementation |

This document explains the remaining path from the current approved baseline to 100%. It does not replace the canonical roadmap. It is a sequencing guide for Founder decision-making and future implementation prompts. All future phases require a separate explicit Founder directive before implementation begins.

## 1. Current Baseline

```text
Platform Core          total  41   completed  41
Platform Hardening     total  16   completed  16
Business Core          total 117   completed 117
Advanced Capabilities  total 179   completed   6

Core Product Readiness
  denominator = 41 + 117 + 16 = 174
  completed   = 41 + 117 + 16 = 174
  174 / 174 = 100.0%

Full Approved Roadmap
  denominator = 174 + 179 = 353
  completed   = 174 +   6 = 180
  180 / 353 = 51.0%
```

Remaining to 100%:

| Layer | Remaining | Meaning |
|---|---:|---|
| Platform Hardening | 0 pts | Phase H2 production gate completed |
| Advanced Capabilities | 173 pts | All Advanced backlog not yet delivered |
| Total remaining | 173 pts | 353 - 180 |

Phases 11A–11F are unweighted architecture/governance phases. They are recorded for
traceability and move neither metric; the numbers above already reflect their closure.

## 2. Recommended Phase Sequence

The recommended route is:

1. Preserve the completed Phase H2 Production Gate and Core Product Readiness baseline.
2. Deliver Advanced waves in business-value clusters, not one giant wave.
3. Keep every Advanced unit independently activatable and removable.
4. Keep client extensions outside these denominators.

| Seq | Phase | Scope | Pts | Cumulative pts | Full progress | Core readiness |
|---:|---|---|---:|---:|---:|---:|
| 0 | Current baseline | Completed work through Phase H2 Production Gate and unweighted Phase 11F closure | 0 | 180 / 353 | 51.0% | 100.0% |
| 1 | Wave A1 | Customer & Commercial Advanced + Service Quality Advanced | 19 | 199 / 353 | 56.4% | 100.0% |
| 2 | Wave A2 | Survey Advanced completion + Reporting Advanced | 23 | 222 / 353 | 62.9% | 100.0% |
| 3 | Wave A3 | Service Operations Advanced + Asset Advanced | 24 | 246 / 353 | 69.7% | 100.0% |
| 4 | Wave A4 | Workforce Advanced | 24 | 270 / 353 | 76.5% | 100.0% |
| 5 | Wave A5 | Supply Chain Advanced | 22 | 292 / 353 | 82.7% | 100.0% |
| 6 | Wave A6 | Finance Advanced | 21 | 313 / 353 | 88.7% | 100.0% |
| 7 | Wave A7 | Project Delivery Advanced + HSE Advanced | 27 | 340 / 353 | 96.3% | 100.0% |
| 8 | Wave A8 | Platform cross-cutting Advanced | 13 | 353 / 353 | 100.0% | 100.0% |

Every row after the current baseline is a planned scenario, not earned progress. Phase H2 is earned and complete; Wave A1 is the currently authorized wave and Waves A2–A8 remain planned / optional. No wave is started by this document.

## 3. Phase H2 - Production Gate

Phase H2 is **COMPLETED** and raised Platform Hardening from 9 / 16 to 16 / 16.

| Unit | Capability | Pts | Status | Delivered evidence |
|---|---|---:|---|---|
| PH-3 | Backup / restore / disaster recovery runbook | 2 | COMPLETED | Checksum-protected database/document backup, guarded isolated restore, representative restored-document byte verification, runbook, and successful restore drill |
| PH-4 | Deployment and environment provisioning automation | 3 | COMPLETED | Separate immutable operations/runtime/Web images, validated environment contract, ordered Compose migration/permission-sync/start/smoke flow, repeat-deploy and rollback guidance |
| PH-8 | Integration reconciliation / outbox worker | 2 | COMPLETED | Durable Tenant-scoped per-event/per-endpoint outbox, reconciliation, stale-claim recovery, retry/terminal visibility, Scheduler observability, and concurrent claim coverage |
| Total | Platform Hardening production gate | 7 | COMPLETED | 16 / 16 |

Earned result:

| Metric | Before | After |
|---|---:|---:|
| Platform Hardening Layer | 9 / 16 (56.3%) | 16 / 16 (100.0%) |
| Core Product Readiness | 167 / 174 (96.0%) | 174 / 174 (100.0%) |
| Full Approved Roadmap Progress | 173 / 353 (49.0%) | 180 / 353 (51.0%) |

Validated acceptance:

- Backup and restore procedure is documented, executable, and tested.
- Deployment provisioning is repeatable and environment driven.
- Integration work can be retried/reconciled without duplicate durable side effects.
- Production Gate remains separate from client-specific hosting choices.

## 4. Wave A1 - Customer and Service Quality Advanced

Wave A1 deepens commercial operation and complaint/service-quality intelligence. It is the
currently authorized wave; the points below are planned, not earned, until validation
evidence is complete and the canonical documents are updated.

| Area | Unit | Capability | Pts |
|---|---|---|---:|
| Customer & Commercial | CUS-ADV-001 | Sales pipeline, opportunity, quotation, pricing | 5 |
| Customer & Commercial | CUS-ADV-002 | Expanded customer self-service portal | 3 |
| Service Quality | SQ-ADV-001 | Multidimensional SLA with customer, contract, severity, category, and business calendar | 3 |
| Service Quality | SQ-ADV-002 | Structured RCA taxonomy and advanced CAPA | 3 |
| Service Quality | SQ-ADV-003 | Recurring-problem detection and service quality analytics | 3 |
| Service Quality | SQ-ADV-004 | Automatic domain mutation from feedback, Founder-gated | 2 |
| Total | Wave A1 |  | 19 |

Expected result:

| Metric | After Phase H2 | After Wave A1 |
|---|---:|---:|
| Full Approved Roadmap Progress | 180 / 353 (51.0%) | 199 / 353 (56.4%) |

Recommended boundaries:

- Sales/opportunity/quotation must not rewrite Customer Core master data rules.
- Advanced SLA must remain configurable and not hardcoded per client.
- Auto-mutation from feedback should require explicit Founder approval because it changes another domain's state.

## 5. Wave A2 - Survey and Reporting Advanced

Wave A2 finishes Survey Advanced depth and expands Reporting beyond standard operational reports.

| Area | Unit | Capability | Pts |
|---|---|---|---:|
| Survey & Assessment | SUR-ADV-003 | Conditional branching and matrix/grid questions | 3 |
| Survey & Assessment | SUR-ADV-004 | Weighted, section-level, percentage, and NPS scoring | 2 |
| Survey & Assessment | SUR-ADV-005 | Anonymous and public-token distribution | 3 |
| Survey & Assessment | SUR-ADV-006 | Multi-language survey content | 2 |
| Survey & Assessment | SUR-ADV-007 | Cross-survey analytics and benchmarking | 3 |
| Reporting | RPT-ADV-001 | Self-service BI and reporting warehouse | 5 |
| Reporting | RPT-ADV-002 | Predictive analytics across operational history | 5 |
| Total | Wave A2 |  | 23 |

Expected result:

| Metric | After Wave A1 | After Wave A2 |
|---|---:|---:|
| Full Approved Roadmap Progress | 199 / 353 (56.4%) | 222 / 353 (62.9%) |

Recommended boundaries:

- Survey question history must remain immutable after publication.
- Anonymous/public responses need explicit privacy and abuse controls.
- Reporting Advanced must not weaken Data Scope or tenant isolation.

## 6. Wave A3 - Service Operations and Asset Advanced

Wave A3 adds operational depth around recurring field work, offline execution, maintenance, and asset reliability.

| Area | Unit | Capability | Pts |
|---|---|---|---:|
| Service Operations | SO-ADV group | Vertical service packs over the generic Service Operations engine | 5 |
| Service Operations | SO-ADV group | Offline field PWA with deferred synchronization | 5 |
| Service Operations | SO-ADV group | Route, roster, capacity, and workload optimization | 3 |
| Asset | AST-ADV group | Preventive and corrective maintenance with work orders | 5 |
| Asset | AST-ADV group | Meter reading, spare parts, and downtime tracking | 3 |
| Asset | AST-ADV group | MTBF/MTTR and predictive maintenance | 3 |
| Total | Wave A3 |  | 24 |

Expected result:

| Metric | After Wave A2 | After Wave A3 |
|---|---:|---:|
| Full Approved Roadmap Progress | 222 / 353 (62.9%) | 246 / 353 (69.7%) |

Recommended boundaries:

- Vertical packs remain configuration plus Advanced capability, not separate modules.
- Offline mode must be conflict-safe and must not cache sensitive data beyond approved limits.
- Asset maintenance must reuse Service Operations where work-order semantics overlap.

## 7. Wave A4 - Workforce Advanced

Wave A4 expands Workforce beyond employee master and placement into time, payroll-adjacent, and people-development processes.

| Area | Unit | Capability | Pts |
|---|---|---|---:|
| Workforce | HR-ADV group | Attendance, shift, and roster | 5 |
| Workforce | HR-ADV group | Leave and overtime | 3 |
| Workforce | HR-ADV group | Payroll, BPJS, and PPh21 | 5 |
| Workforce | HR-ADV group | Recruitment | 3 |
| Workforce | HR-ADV group | Performance, competency, training, and career | 5 |
| Workforce | HR-ADV group | Manpower planning | 3 |
| Total | Wave A4 |  | 24 |

Expected result:

| Metric | After Wave A3 | After Wave A4 |
|---|---:|---:|
| Full Approved Roadmap Progress | 246 / 353 (69.7%) | 270 / 353 (76.5%) |

Recommended boundaries:

- Payroll is Advanced and must not become a prerequisite for Workforce Core.
- Country-specific statutory logic must be isolated and configurable.
- Attendance/roster integrations should not bypass audit or Data Scope.

## 8. Wave A5 - Supply Chain Advanced

Wave A5 adds inventory depth, procurement depth, valuation, and spend intelligence.

| Area | Unit | Capability | Pts |
|---|---|---|---:|
| Supply Chain | SCM-ADV group | Multi-warehouse, bin/location, batch/lot, and serial tracking | 5 |
| Supply Chain | SCM-ADV group | Reservation, reorder, transfer, and stock opname | 3 |
| Supply Chain | SCM-ADV group | Inventory valuation and landed cost | 3 |
| Supply Chain | SCM-ADV group | RFQ, tender, and bid comparison | 5 |
| Supply Chain | SCM-ADV group | Supplier evaluation and contract purchasing | 3 |
| Supply Chain | SCM-ADV group | Spend analytics | 3 |
| Total | Wave A5 |  | 22 |

Expected result:

| Metric | After Wave A4 | After Wave A5 |
|---|---:|---:|
| Full Approved Roadmap Progress | 270 / 353 (76.5%) | 292 / 353 (82.7%) |

Recommended boundaries:

- Inventory valuation is Advanced and should align with Finance Advanced policy.
- Procurement approval must reuse Workflow Engine instead of hardcoded status logic.
- Stock control must preserve historical movement records and avoid hard deletes.

## 9. Wave A6 - Finance Advanced

Wave A6 turns operational cash tracking into full accounting depth.

| Area | Unit | Capability | Pts |
|---|---|---|---:|
| Finance | FIN-ADV group | GL, chart of accounts, and journal | 5 |
| Finance | FIN-ADV group | AP/AR and aging | 3 |
| Finance | FIN-ADV group | Budgeting and cost center | 3 |
| Finance | FIN-ADV group | Bank reconciliation | 2 |
| Finance | FIN-ADV group | Fixed-asset accounting and depreciation | 3 |
| Finance | FIN-ADV group | Tax, consolidation, and financial statements | 5 |
| Total | Wave A6 |  | 21 |

Expected result:

| Metric | After Wave A5 | After Wave A6 |
|---|---:|---:|
| Full Approved Roadmap Progress | 292 / 353 (82.7%) | 313 / 353 (88.7%) |

Recommended boundaries:

- Accounting policy must be explicit; do not infer statutory treatment silently.
- Project cost and asset depreciation integrations must go through owned application services.
- Auditability is mandatory for financial postings and reversals.

## 10. Wave A7 - Project Delivery and HSE Advanced

Wave A7 adds deeper project controls and HSE compliance depth.

| Area | Unit | Capability | Pts |
|---|---|---|---:|
| Project Delivery | PRJ-ADV group | WBS, dependencies, and Gantt | 5 |
| Project Delivery | PRJ-ADV group | Resource loading and baseline | 3 |
| Project Delivery | PRJ-ADV group | Earned value, cost control, and project accounting | 5 |
| HSE | HSE-ADV group | Investigation methodology and JSA/HIRA risk assessment | 5 |
| HSE | HSE-ADV group | Permit to Work | 3 |
| HSE | HSE-ADV group | Inspection and audit programmes | 3 |
| HSE | HSE-ADV group | Environmental monitoring, CAPA, and indicators | 3 |
| Total | Wave A7 |  | 27 |

Expected result:

| Metric | After Wave A6 | After Wave A7 |
|---|---:|---:|
| Full Approved Roadmap Progress | 313 / 353 (88.7%) | 340 / 353 (96.3%) |

Recommended boundaries:

- Project scheduling math must remain Advanced and not affect the simple activity/milestone Core.
- Project accounting must align with Finance Advanced ownership.
- HSE CAPA must not be confused with the Core follow-up action model.
- Permit and risk workflows should reuse Workflow Engine and Document Core.

## 11. Wave A8 - Platform Cross-Cutting Advanced

Wave A8 completes the final 13 Advanced points.

| Area | Unit | Capability | Pts |
|---|---|---|---:|
| Platform Advanced | PLT-ADV group | API economy / partner integration surface | 3 |
| Platform Advanced | PLT-ADV group | AI readiness for sentiment, summarization, and assistive automation | 5 |
| Platform Advanced | PLT-ADV group | Marketplace and ecosystem | 5 |
| Total | Wave A8 |  | 13 |

Expected result:

| Metric | After Wave A7 | After Wave A8 |
|---|---:|---:|
| Full Approved Roadmap Progress | 340 / 353 (96.3%) | 353 / 353 (100.0%) |

Recommended boundaries:

- Partner APIs must be versioned, documented, permissioned, and tenant-safe.
- AI readiness must not expose tenant data across client boundaries.
- Marketplace capability must not introduce client extension coupling into product core.

## 12. Summary to 100%

| Category | Remaining pts | Completion condition |
|---|---:|---|
| Phase H2 Production Gate | 0 | Completed; Platform Hardening is 16 / 16 |
| Advanced business-domain waves | 160 | Customer, Service Quality, Survey, Reporting, Service Operations, Asset, Workforce, Supply Chain, Finance, Project Delivery, and HSE Advanced complete |
| Platform cross-cutting Advanced | 13 | Partner API, AI readiness, and marketplace ecosystem complete |
| Total | 173 | Full Approved Roadmap reaches 353 / 353 |

After all phases:

```text
Platform Core          41 / 41   100.0%
Platform Hardening     16 / 16   100.0%
Business Core         117 / 117  100.0%
Advanced Capabilities 179 / 179  100.0%

Core Product Readiness        174 / 174  100.0%
Full Approved Roadmap         353 / 353  100.0%
```

## 13. Governance Rules for Every Future Phase

- Each phase should begin only after explicit Founder directive.
- Each phase should have implementation commit and metadata/baseline commit when canonical docs change.
- Do not mix Phase H2, Advanced waves, and client extensions in a single implementation scope unless explicitly approved.
- Do not add denominator points unless new scope is formally approved.
- Do not count in-progress work as earned progress.
- Do not let Advanced features become hidden prerequisites for Business Core usability.
- Keep Data Scope, tenant isolation, RBAC, audit, Workflow Engine ownership, and Document Core authorization intact.
- Validate with targeted tests, full API regression, typecheck, lint, build, and whitespace checks before closure.
