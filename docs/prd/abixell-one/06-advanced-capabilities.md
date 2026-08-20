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
| **SUR-ADV-001** | **Feedback trigger → survey assignment.** On a configured business lifecycle event, the system shall assign the configured survey to a validated respondent exactly once per source entity lifetime. | orchestration | DELIVERED |
| **SUR-ADV-002** | **Outcome evaluation → management attention.** On survey submission, the system shall evaluate a configured question-code numeric threshold and, on match, raise an auditable management-attention signal to capability holders. | orchestration | DELIVERED |

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
