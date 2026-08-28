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
| Platform (cross-cutting) | API economy / partner integration surface · AI readiness (sentiment, summarisation, assistive automation) · marketplace & ecosystem |

## Rules for Advanced

| ID | Requirement |
|---|---|
| **ADV-GEN-001** | An Advanced capability shall be independently activatable and removable without breaking its module's Core. |
| **ADV-GEN-002** | An Advanced capability shall not become an implicit prerequisite of another module's Core. |
| **ADV-GEN-003** | Advanced automation that mutates another domain's state shall go through that domain's application service and respect its eligibility rules — never direct data mutation. |
| **ADV-GEN-004** | Advanced progress shall be reported separately from Core readiness so a mature Core is never obscured by an optional backlog. |
