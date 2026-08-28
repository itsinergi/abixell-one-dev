# Abixell One - Roadmap to 100%

| Item | Value |
|---|---|
| Document type | Planning derivative from canonical roadmap |
| Source baseline | `docs/canonical/product-roadmap.md` v1.22 and `docs/canonical/product-progress.md` v1.22 |
| Measured at | `master` after Wave A3 (revised) delivery |
| Current point | Full Approved Roadmap Progress: 68.3% (241 / 353 pts) |
| Current Core Product Readiness | 100.0% (174 / 174 pts) |
| Current Platform Hardening | 100.0% (16 / 16 pts) |
| Goal | Full Approved Roadmap Progress: 100% (353 / 353 pts) |
| Scope rule | No denominator change unless Founder approves new roadmap scope |
| Current authorization state | Phase H2, Phase 11F, Wave A1, Wave A2, and **Wave A3 (revised) are COMPLETED**; no wave is currently active. Waves A4–A8 and Phase 11G remain PLANNED / OPTIONAL and require a separate explicit Founder directive. `SO-ADV-006` remains DEFERRED and requires a dedicated Founder architecture ADR. This document starts no implementation |

This document explains the remaining path from the current approved baseline to 100%. It does not replace the canonical roadmap. It is a sequencing guide for Founder decision-making and future implementation prompts. All future phases require a separate explicit Founder directive before implementation begins.

## 1. Current Baseline

```text
Platform Core          total  41   completed  41
Platform Hardening     total  16   completed  16
Business Core          total 117   completed 117
Advanced Capabilities  total 179   completed  67

Core Product Readiness
  denominator = 41 + 117 + 16 = 174
  completed   = 41 + 117 + 16 = 174
  174 / 174 = 100.0%

Full Approved Roadmap
  denominator = 174 + 179 = 353
  completed   = 174 +  67 = 241   (Advanced 6 + Wave A1 19 + Wave A2 23 + Wave A3 revised 19)
  241 / 353 = 68.3%
```

Remaining to 100%:

| Layer | Remaining | Meaning |
|---|---:|---|
| Platform Hardening | 0 pts | Phase H2 production gate completed |
| Advanced Capabilities | 112 pts | All Advanced backlog not yet delivered (deferred `SO-ADV-006` 5 pts + Waves A4–A7 94 pts + Wave A8 13 pts) |
| Total remaining | 112 pts | 353 - 241 |

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
| 0 | ~~Prior baseline~~ | Completed work through Phase H2 Production Gate and unweighted Phase 11F closure | 0 | 180 / 353 | 51.0% | 100.0% |
| 1 | ~~Wave A1~~ | Customer & Commercial Advanced + Service Quality Advanced | 19 | 199 / 353 | 56.4% | 100.0% |
| 2 | ~~Wave A2~~ | Survey Advanced completion + Reporting Advanced | 23 | 222 / 353 | 62.9% | 100.0% |
| 3 | ~~Wave A3 revised~~ **(COMPLETED — current baseline)** | Service Operations Advanced + Asset Advanced, excluding deferred SO-ADV-006 | 19 | **241 / 353** | **68.3%** | **100.0%** |
| 4 | Wave A4 | Workforce Advanced | 24 | 265 / 353 | 75.1% | 100.0% |
| 5 | Wave A5 | Supply Chain Advanced | 22 | 287 / 353 | 81.3% | 100.0% |
| 6 | Wave A6 | Finance Advanced | 21 | 308 / 353 | 87.3% | 100.0% |
| 7 | Wave A7 | Project Delivery Advanced + HSE Advanced | 27 | 335 / 353 | 94.9% | 100.0% |
| 8 | Wave A8 | Platform cross-cutting Advanced | 13 | 348 / 353 | 98.6% | 100.0% |

Every row after the current baseline is a planned scenario, not earned progress. Phase H2, Wave A1, Wave A2, and Wave A3 (revised) are earned and complete; the current baseline is now row 3. Waves A4–A8 remain planned / optional and none is authorized. Delivering all planned Waves A4–A8 yields 348 / 353 = 98.6%. Reaching the full 353 / 353 (100.0%) requires completing the separately deferred `SO-ADV-006` (5 pts) following Founder approval and a dedicated ADR. No wave is started by this document.

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

Wave A1 deepens commercial operation and complaint/service-quality intelligence. It is
**COMPLETED** at baseline v1.20 (`master @ e7ab06a` after post-closure stabilization); all 19 points below are earned, and
the canonical documents carry the validation evidence.

| Area | Unit | Capability | Pts |
|---|---|---|---:|
| Customer & Commercial | CUS-ADV-001 | Sales pipeline, opportunity, quotation, pricing | 5 |
| Customer & Commercial | CUS-ADV-002 | Expanded customer self-service portal | 3 |
| Service Quality | SQ-ADV-001 | Multidimensional SLA with customer, contract, severity, category, and business calendar | 3 |
| Service Quality | SQ-ADV-002 | Structured RCA taxonomy and advanced CAPA | 3 |
| Service Quality | SQ-ADV-003 | Recurring-problem detection and service quality analytics | 3 |
| Service Quality | SQ-ADV-004 | Automatic domain mutation from feedback, Founder-gated | 2 |
| Total | Wave A1 |  | 19 |

Result (earned):

| Metric | Before Wave A1 | After Wave A1 |
|---|---:|---:|
| Full Approved Roadmap Progress | 180 / 353 (51.0%) | **199 / 353 (56.4%)** |

Recommended boundaries:

- Sales/opportunity/quotation must not rewrite Customer Core master data rules.
- Advanced SLA must remain configurable and not hardcoded per client.
- Auto-mutation from feedback should require explicit Founder approval because it changes another domain's state.

All three boundaries held. Auto-mutation is stronger than required: `requires_approval` is
pinned true by a tautological database CHECK, so an autonomous rule cannot be represented
at all, and approving a proposal is routed through the same permission-checked service
methods a human operator would use.

### Deferred findings from the Wave A1 closure audit

Surfaced during the closure audit, deliberately **not** fixed in Wave A1 because none
blocks a delivered unit and fixing them would expand scope. Recorded here so they are not
lost; each needs a separate Founder directive.

| # | Finding | Why deferred |
|---:|---|---|
| 1 | CAPA has no transition-history table and no transition-legality check, unlike the Complaint Engine which has both. | Audit/traceability depth, not a correctness failure of the delivered CAPA unit. |
| 2 | Quotation and CAPA workflow integration uses `catch {}` swallow-and-continue, so a Workflow Engine failure leaves the commercial record without its workflow instance and no signal. | Changing it alters failure semantics of an already-shipped surface. |
| 3 | Free-text notes and raw exception text are persisted into audit metadata (`service-quality.service.ts` ≈ `:854`, `:1147`, `:1112`), which can carry operator-entered or internal detail into an audit trail read under a different permission. | Needs a privacy/redaction decision, not a local patch. |
| 4 | In-tenant 403-vs-404 divergence is an existence oracle: a caller without scope can distinguish "exists but not yours" from "does not exist". | Repository-wide convention; changing it in one module only would be inconsistent. |
| 5 | No unique index on `(opportunity_id, revision)`, so concurrent quotation creation can produce duplicate revision numbers. | Requires a migration and a concurrency decision; not reachable through the delivered UI flow. |
| 6 | Advanced Service Quality reads do not additionally require Core `complaint.read`. | Intentional in the delivered design (trusted-caller composition), but worth an explicit Founder ruling. |

## 5. Wave A2 - Survey and Reporting Advanced

Wave A2 finishes Survey Advanced depth and expands Reporting beyond standard operational reports. It is
**COMPLETED** at baseline v1.21; all 23 points below are earned, and the canonical documents carry the validation evidence.

| Area | Unit | Capability | Pts | Status |
|---|---|---|---:|---|
| Survey & Assessment | SUR-ADV-003 | Conditional branching and matrix/grid questions | 3 | COMPLETED |
| Survey & Assessment | SUR-ADV-004 | Weighted, section-level, percentage, and NPS scoring | 2 | COMPLETED |
| Survey & Assessment | SUR-ADV-005 | Anonymous and public-token distribution | 3 | COMPLETED |
| Survey & Assessment | SUR-ADV-006 | Multi-language survey content | 2 | COMPLETED |
| Survey & Assessment | SUR-ADV-007 | Cross-survey analytics and benchmarking | 3 | COMPLETED |
| Reporting | RPT-ADV-001 | Self-service BI and reporting warehouse | 5 | COMPLETED |
| Reporting | RPT-ADV-002 | Predictive analytics across operational history | 5 | COMPLETED |
| Total | Wave A2 |  | 23 | COMPLETED |

Result (earned):

| Metric | Before Wave A2 | After Wave A2 |
|---|---:|---:|
| Full Approved Roadmap Progress | 199 / 353 (56.4%) | **222 / 353 (62.9%)** |

Recommended boundaries:

- Survey question history must remain immutable after publication.
- Anonymous/public responses need explicit privacy and abuse controls (token hashing, small-cell suppression).
- Reporting Advanced must not weaken Data Scope or tenant isolation (governed BI registry, parameterized projection, bounded compute).

All boundaries held. Governed BI uses static whitelist metadata models with recursive CTE scope injection and zero arbitrary SQL/eval. Predictive analytics uses bounded statistical methods (OLS, moving averages, seasonal decomposition) with strict tenant isolation. Public survey distribution uses SHA-256 token hashing and zero identity leakage for anonymous responses.

## 6. Wave A3 - Service Operations and Asset Advanced (Revised)

Wave A3 adds operational depth around vertical service pack configuration, route/roster/workload optimization, maintenance scheduling, and asset reliability. It is **COMPLETED** (revised scope) at baseline v1.22; all 19 points below are earned, and canonical documents carry validation evidence.

| Area | Unit | Capability | Pts | Status |
|---|---|---|---:|---|
| Service Operations | PACK-001…004 | Vertical service packs (Catering, Housekeeping, Camp, Facility) | 5 | COMPLETED |
| Service Operations | SO-ADV-002…005 | Route, roster, capacity, and workload optimization | 3 | COMPLETED |
| Asset | AST-ADV-001/002 | Preventive maintenance schedules & maintenance work orders | 5 | COMPLETED |
| Asset | AST-ADV-003…005 | Meter reading, spare parts, and downtime tracking | 3 | COMPLETED |
| Asset | AST-ADV-006/007 | MTBF/MTTR reliability metrics & predictive maintenance | 3 | COMPLETED |
| Total | Wave A3 (revised) |  | 19 | COMPLETED |

Result (earned):

| Metric | Before Wave A3 | After Wave A3 (revised) |
|---|---:|---:|
| Full Approved Roadmap Progress | 222 / 353 (62.9%) | **241 / 353 (68.3%)** |

**Founder Deferred Scope Note:**
Unit `SO-ADV-006` (Offline field execution with deferred synchronization, 5 pts) was explicitly **DEFERRED** by Founder decision and excluded from Wave A3 implementation. Offline capability earned 0 points, is not part of the Wave A3 completed scope, and remains deferred awaiting a dedicated Founder architecture ADR regarding offline mutation queues and local cache boundaries under platform security rules.

Recommended boundaries:

- Vertical service packs remain configuration plus template metadata over the generic Service Operations engine, not separate duplicate engines.
- Route, roster, capacity, and workload optimization heuristics are deterministic and advisory-only, with human-confirmed atomic database transaction apply.
- Asset maintenance work orders delegate lifecycle state exclusively to the Workflow Engine (`workflow_instance_id`) with zero competing local status machines.
- Meter readings enforce strong monotonicity serialized by asset row-level locking.

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

| Metric | After Wave A3 (revised) | After Wave A4 |
|---|---:|---:|
| Full Approved Roadmap Progress | 241 / 353 (68.3%) | 265 / 353 (75.1%) |

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
| Full Approved Roadmap Progress | 265 / 353 (75.1%) | 287 / 353 (81.3%) |

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
| Full Approved Roadmap Progress | 287 / 353 (81.3%) | 308 / 353 (87.3%) |

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
| Full Approved Roadmap Progress | 308 / 353 (87.3%) | 335 / 353 (94.9%) |

Recommended boundaries:

- Project scheduling math must remain Advanced and not affect the simple activity/milestone Core.
- Project accounting must align with Finance Advanced ownership.
- HSE CAPA must not be confused with the Core follow-up action model.
- Permit and risk workflows should reuse Workflow Engine and Document Core.

## 11. Wave A8 - Platform Cross-Cutting Advanced

Wave A8 completes the final 13 Advanced points of the planned wave sequences.

| Area | Unit | Capability | Pts |
|---|---|---|---:|
| Platform Advanced | PLT-ADV group | API economy / partner integration surface | 3 |
| Platform Advanced | PLT-ADV group | AI readiness for sentiment, summarization, and assistive automation | 5 |
| Platform Advanced | PLT-ADV group | Marketplace and ecosystem | 5 |
| Total | Wave A8 |  | 13 |

Expected result:

| Metric | After Wave A7 | After Wave A8 |
|---|---:|---:|
| Full Approved Roadmap Progress | 335 / 353 (94.9%) | 348 / 353 (98.6%) |

Recommended boundaries:

- Partner APIs must be versioned, documented, permissioned, and tenant-safe.
- AI readiness must not expose tenant data across client boundaries.
- Marketplace capability must not introduce client extension coupling into product core.

## 12. Summary to 100%

| Category | Remaining pts | Completion condition |
|---|---:|---|
| Phase H2 Production Gate | 0 | Completed; Platform Hardening is 16 / 16 |
| Delivered Advanced waves (A1, A2, A3 revised) | 0 | Completed; Customer & Commercial + Service Quality (19), Survey + Reporting (23), and Service Operations + Asset (19) delivered |
| Planned Advanced business-domain waves (A4–A7) | 94 | Workforce (24), Supply Chain (22), Finance (21), and Project Delivery + HSE (27) Advanced complete |
| Planned Platform cross-cutting Advanced (A8) | 13 | Partner API (3), AI readiness (5), and marketplace ecosystem (5) complete |
| Deferred `SO-ADV-006` (Offline Field PWA) | 5 | Awaiting dedicated Founder architecture ADR, approval, implementation, and verification |
| Total remaining Advanced | 112 | 94 (A4–A7) + 13 (A8) + 5 (SO-ADV-006); Full Approved Roadmap reaches 353 / 353 |

After planned Waves A4–A8 (excluding deferred `SO-ADV-006`):

```text
Platform Core          41 / 41   100.0%
Platform Hardening     16 / 16   100.0%
Business Core         117 / 117  100.0%
Advanced Capabilities 174 / 179   97.2%

Core Product Readiness        174 / 174  100.0%
Full Approved Roadmap         348 / 353   98.6%
```

After deferred `SO-ADV-006` is also approved, designed, implemented, and verified:

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
