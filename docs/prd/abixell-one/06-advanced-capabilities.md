# 06 — Advanced Capabilities

**PRD v1.0** · Canonical · Classification: **Advanced**

Advanced capability is **optional depth**, activated per client. It is never required for a Business Core module to be usable (P-2/P-3).

## Ownership rule

| Situation | Home |
|---|---|
| Depth owned by one domain (data, lifecycle, permissions) | Inside that module — `modules/<module>/advanced/` |
| Coordination across two or more bounded contexts | **Orchestration layer** — `orchestration/<capability>/` |

Reference: Survey-to-Action spans Survey + Service Quality + Notification + Events + Integration, so it lives in orchestration, not inside Survey.

## Delivered Advanced capabilities

| ID | Capability | Home | Status |
|---|---|---|---|
| **SUR-ADV-001** | **Feedback trigger → survey assignment.** On a configured business lifecycle event, the system shall assign the configured survey to a validated respondent exactly once per source entity lifetime. | orchestration | DELIVERED (Phase 1E) |
| **SUR-ADV-002** | **Outcome evaluation → management attention.** On survey submission, the system shall evaluate a configured question-code numeric threshold and, on match, raise an auditable management-attention signal to capability holders. | orchestration | DELIVERED (Phase 1E) |
| **CUS-ADV-001** | **Opportunity, Quotation & Price Book.** Sales pipeline, multi-tiered price book resolution, exact decimal arithmetic quotation engine. | customer-commercial | DELIVERED (Wave A1) |
| **CUS-ADV-002** | **Customer Self-Service Portal.** Tokenized portal access, work requests, tickets, documents, and notifications. | customer-commercial | DELIVERED (Wave A1) |
| **SQ-ADV-001** | **Multidimensional SLA Engine.** Dynamic calendar, business hours, severity × category matrix targets, breach tracking. | service-quality | DELIVERED (Wave A1) |
| **SQ-ADV-002** | **RCA Taxonomy & Advanced CAPA.** 5-Why root cause analysis, Ishikawa categories, preventive action verification. | service-quality | DELIVERED (Wave A1) |
| **SQ-ADV-003** | **Recurrence Analytics & Detection.** Windowed pattern matching, recurring problem cluster identification. | service-quality | DELIVERED (Wave A1) |
| **SQ-ADV-004** | **Feedback-Driven Domain Mutation.** Evaluated proposal pipeline for automatic reopen / escalation under human approval. | service-quality | DELIVERED (Wave A1) |
| **SUR-ADV-003** | **Conditional Branching & Matrix Questions.** Dynamic survey navigation rules and multidimensional rating matrices. | survey | DELIVERED (Wave A2) |
| **SUR-ADV-004** | **Scoring Engine & NPS/CSAT Models.** Weighted section scoring, promoter/passive/detractor classification. | survey | DELIVERED (Wave A2) |
| **SUR-ADV-005** | **Public Token Distribution & Anonymous Surveys.** SHA-256 token hashing, atomic claim quota, anonymous respondent isolation. | survey | DELIVERED (Wave A2) |
| **SUR-ADV-006** | **Survey Localization.** Multi-language question and choice dictionary fallbacks. | survey | DELIVERED (Wave A2) |
| **SUR-ADV-007** | **Cross-Survey Benchmarking & Analytics.** Longitudinal trend aggregation, category cross-tabulation, small-cell masking. | survey | DELIVERED (Wave A2) |
| **RPT-ADV-001** | **Self-Service BI & Semantic Warehouse.** Governed dataset queries, customer data scope recursive CTE, zero raw SQL. | reporting | DELIVERED (Wave A2) |
| **RPT-ADV-002** | **Operational Predictive Analytics.** OLS linear regression, 7-day moving averages, seasonal decomposition, CI 95%. | reporting | DELIVERED (Wave A2) |
| **PACK-001…004** | **Vertical Service Packs.** Catering, Housekeeping, Camp Services, and Facility Services pack activations and templates. | service-operations | DELIVERED (Wave A3) |
| **SO-ADV-002…005** | **Route, Roster, Capacity, Workload Optimization.** Deterministic advisory optimization runs, score breakdown, atomic apply. | service-operations | DELIVERED (Wave A3) |
| **AST-ADV-001/002** | **Asset Maintenance Work Orders & Preventive Schedules.** Calendar/meter preventive triggers, workflow-governed work orders. | asset | DELIVERED (Wave A3) |
| **AST-ADV-003…005** | **Meter Readings, Spare Parts & Downtime Tracking.** Serialized monotonic meters, planned/actual parts, downtime records. | asset | DELIVERED (Wave A3) |
| **AST-ADV-006/007** | **MTBF/MTTR Reliability Metrics & Predictive Maintenance.** Reliability formula metrics and advisory failure prediction snapshots. | asset | DELIVERED (Wave A3) |
| **HR-ADV-001/002** | **Attendance, Shift & Roster Management.** Standard/overnight shifts, monthly rosters, and clock-in/out attendance logs. | workforce | DELIVERED (Wave A4) |
| **HR-ADV-003/004** | **Leave & Overtime Management.** Annual entitlement balances, pending-to-used transitions, and workflow-delegated approvals. | workforce | DELIVERED (Wave A4) |
| **HR-ADV-005** | **Statutory Payroll & Payslip Engine.** Exact-decimal BPJS Kesehatan/TK and PPh 21 Pasal 17/TER PP 58/2023 calculations with immutable payslips. | workforce | DELIVERED (Wave A4) |
| **HR-ADV-006** | **Recruitment & Applicant Tracking.** Requisition job postings, multi-stage candidate pipeline, and hire conversion. | workforce | DELIVERED (Wave A4) |
| **HR-ADV-007/008** | **Performance Appraisals, Competency & Career Paths.** Competency matrix, training catalog, workflow-finalized reviews, and career progression rules. | workforce | DELIVERED (Wave A4) |
| **HR-ADV-009** | **Deterministic Advisory Manpower Planning.** Demand simulation, headcount/cost variance calculations, and advisory plan application. | workforce | DELIVERED (Wave A4) |

Both were delivered in historical Phase 1E. They remain **Advanced**, not Survey Core (Founder-confirmed).

## Approved Advanced backlog

Grouped by owning domain. Each becomes a roadmap unit when approved for a wave.

| Domain | Advanced capabilities |
|---|---|
| Customer & Commercial | Sales pipeline / opportunity / quotation & pricing · customer self-service portal expansion |
| Service Quality | Multidimensional SLA (severity×category×customer) + business calendar · structured RCA taxonomy + advanced CAPA · recurring-problem detection & service analytics · **automatic domain mutation from feedback** (auto-reopen, predictive escalation) |
| Survey & Assessment | Conditional branching & matrix questions · weighted/section/NPS scoring · anonymous & public-token distribution · multi-language surveys · survey analytics & benchmarking |
| Service Operations | Recurring service scheduling · advanced scheduling · route planning · productivity & manpower optimisation · forecasting · offline field execution |
| Workforce | Attendance · shift & roster · leave · overtime · payroll (incl. statutory contributions and income tax) · recruitment · performance · competency · training · career · manpower planning |
| Supply Chain | Multi-warehouse · bin location · batch/serial · reservation/reorder/transfer/stock opname · inventory valuation & landed cost · advanced procurement (RFQ, tender, bid comparison) · supplier evaluation · contract purchasing · spend analytics |
| Asset | Preventive & corrective maintenance + work orders · meter reading · spare parts · downtime · MTBF/MTTR · predictive maintenance |
| Finance | Accounting (GL, COA, journal) · AP/AR + aging · budgeting & cost center · bank reconciliation · fixed-asset accounting · tax · consolidation · financial statements |
| HSE | Investigation methodology · risk assessment (JSA/HIRA) · permit to work · inspection & audit · environmental monitoring · CAPA · leading/lagging indicators |
| Project Delivery | WBS & dependencies · Gantt · resource loading · baseline management · earned value · cost control · project accounting |
| Reporting | Self-service BI / warehouse · predictive analytics |
| Platform (cross-cutting) | `PLT-ADV-001` partner API surface · `PLT-ADV-002` AI readiness (sentiment, summarisation, assistive automation) · `PLT-ADV-003` marketplace & ecosystem |

## Platform Advanced requirements (`PLT-ADV-*`)

Decomposed from the Platform (cross-cutting) backlog row above. These three IDs
carry the 13 points already allocated to Wave A8 in `product-roadmap.md` §9 and
`POINT-LEDGER.md` §5 — the decomposition adds requirement text, **not**
denominator. All three stay `DEFERRED`: none is authorized for runtime work,
and each has a `PROPOSED` ADR that must be approved before implementation.

| ID | Requirement | Backing ADR | Status |
|---|---|---|---|
| **PLT-ADV-001** | **Partner API surface.** The platform shall expose a documented, versioned API (`/api/partner/v1/…`) for partner and client system integration, authenticated by machine credentials separate from user sessions, with the tenant derived from the credential rather than the request, a registered subset of stable endpoints, and no configuration or schema mutation reachable through it. Implements `INT-012`. | [ADR-0028](../../adr/0028-partner-api-surface-and-versioning.md) | DEFERRED |
| **PLT-ADV-002** | **AI readiness.** The platform shall provide assistive-only AI capabilities — sentiment, summarisation, and assistive automation — that never authoritatively write business state, never use one tenant's data for another tenant, never train or fine-tune on tenant data, minimise and redact data before egress, are auditable and reversible in effect, are opt-in and fail closed, and remain provider-independent. | [ADR-0029](../../adr/0029-ai-readiness-data-boundary.md) | DEFERRED |
| **PLT-ADV-003** | **Marketplace & ecosystem.** The platform shall distribute ecosystem items as declarative manifests composed statically under ADR-0014, authored only through the governed Builder, installed with explicit bounded capability grants, pinned to an exact version with a content digest, recording publisher provenance rather than assuming trust, and never reaching another tenant. No executable server code, migration, or SQL may be distributed. | [ADR-0030](../../adr/0030-marketplace-and-ecosystem-packaging.md) | DEFERRED |

Activation independence follows `ADV-GEN-001…004` like any other Advanced
capability. The weight split (3 / 5 / 5) is the Wave A8 plan's, recorded in
[WAVE-A6-CLOSURE-A7-A8-PLAN.md](../../plans/WAVE-A6-CLOSURE-A7-A8-PLAN.md) §6;
approving an ADR earns no points.

## Rules for Advanced

| ID | Requirement |
|---|---|
| **ADV-GEN-001** | An Advanced capability shall be independently activatable and removable without breaking its module's Core. |
| **ADV-GEN-002** | An Advanced capability shall not become an implicit prerequisite of another module's Core. |
| **ADV-GEN-003** | Advanced automation that mutates another domain's state shall go through that domain's application service and respect its eligibility rules — never direct data mutation. |
| **ADV-GEN-004** | Advanced progress shall be reported separately from Core readiness so a mature Core is never obscured by an optional backlog. |
