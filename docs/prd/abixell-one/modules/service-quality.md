# Module PRD — Service Quality / Complaint (`SQ-*`)

**PRD v1.0** · Business Core module 2 of 11 · Status: **DELIVERED**

> **Core question:** What went wrong, who handles it, was it fixed and confirmed?

## Core requirements

| ID | Requirement | Status |
|---|---|---|
| **SQ-CORE-001** | The system shall let an authorised client user submit a complaint against their own customer context, with category, description, priority, and severity. | DELIVERED |
| **SQ-CORE-002** | Each complaint shall receive a configurable business number. | DELIVERED |
| **SQ-CORE-003** | The complaint lifecycle shall be executed by the configured Workflow Engine — never by hardcoded status logic in this module. | DELIVERED |
| **SQ-CORE-004** | Work shall be assigned to the responsible role and scope at each lifecycle step, with SLA targets per step. | DELIVERED |
| **SQ-CORE-005** | Handlers shall record investigation findings, root cause, corrective action, and preventive action. | DELIVERED |
| **SQ-CORE-006** | A verification step shall allow QA to accept or reject the corrective action before closure. | DELIVERED |
| **SQ-CORE-007** | The client shall confirm resolution before the complaint is closed. | DELIVERED |
| **SQ-CORE-008** | Evidence documents shall be attachable to a complaint, inheriting the complaint's authorisation. | DELIVERED |
| **SQ-CORE-009** | Each complaint shall expose a lifecycle timeline appropriate to the viewer's role. | DELIVERED |
| **SQ-CORE-010** | A closed complaint shall be reopenable by an authorised user, through the workflow engine's reopen mechanism. | DELIVERED |
| **SQ-CORE-011** | Client users shall see and track only their own organisation's complaints. | DELIVERED |
| **SQ-CORE-012** | Operational users shall work from a queue of complaints assigned to them or their role+scope. | DELIVERED |
| **SQ-CORE-013** | Management shall see aggregate complaint status, SLA condition, and items needing attention. | DELIVERED |
| **SQ-CORE-014** | Administrators shall configure complaint categories, severities, priorities, lifecycle, SLA, and notification templates. | DELIVERED |
| **SQ-CORE-015** | Complaint events shall raise notifications to the relevant recipients. | DELIVERED |
| **SQ-CORE-016** | All complaint surfaces shall be responsive and usable on mobile. | DELIVERED |

## Advanced requirements

| ID | Requirement | Status |
|---|---|---|
| **SQ-ADV-001** | Multidimensional SLA (severity × category × customer × contract) with business calendar and holiday handling. | DEFERRED |
| **SQ-ADV-002** | Structured root-cause taxonomy and advanced CAPA management. | DEFERRED |
| **SQ-ADV-003** | Recurring-problem detection and service quality analytics. | DEFERRED |
| **SQ-ADV-004** | Automatic domain mutation from feedback (auto-reopen, predictive escalation). | DEFERRED — Founder-gated |

## Client Configuration

Categories · subcategories · severities · priorities · lifecycle definition (steps, transitions, conditions) · assignment rules · escalation rules · SLA hours · numbering pattern · notification templates.

## Client Extension boundary

Client-specific intake channels (proprietary portal, messaging gateway) are Extensions integrated through the integration boundary.

## Dependencies

Platform Core: workflow, configuration, numbering, notification, documents, audit, events, RBAC + data scope.
Business: Customer & Commercial (customer/contract/project/site context).

## Implementation reality

Delivered across historical Phases 1B and 1C. Evidence: `complaint-engine.test.ts` (16), `customer-complaint-experience.test.ts` (8), `operational-complaint-experience.test.ts` (10), `verification-complaint-experience.test.ts` (7), `management-dashboard.test.ts` (7), `complaint-configuration.test.ts` (7). The lifecycle is genuinely configuration-driven: this module forwards action codes to the workflow engine and does not know the step graph.
