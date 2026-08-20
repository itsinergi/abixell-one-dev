# Module PRD — Service Operations & Work Management (`SO-*`)

**PRD v1.0** · Business Core module 4 of 11 · Status: **DELIVERED** (Phase 2)

> **Core question:** What work is requested or scheduled, who executes it, and was it done?

This is the generic service-delivery spine. All four Vertical Service Packs (Catering, Housekeeping, Camp Services, Facility Services) compose over it — it must therefore contain **no industry assumptions**.

## Core requirements

| ID | Requirement | Status |
|---|---|---|
| **SO-CORE-001** | **Service definition.** Authorised users shall define reusable service types per tenant, with the attributes and default expectations of that service. | DELIVERED |
| **SO-CORE-002** | **Work request.** A work request shall be raised against a customer context (customer, contract, project, site) and a service type. | DELIVERED |
| **SO-CORE-003** | **Work order.** An accepted work request shall produce a work order representing the unit of executable work. | DELIVERED |
| **SO-CORE-004** | **Lifecycle.** The work order lifecycle shall be executed by the configured Workflow Engine, not by hardcoded status logic. | DELIVERED |
| **SO-CORE-005** | **Assignment.** Work orders shall be assigned to a responsible team, role+scope, or specific user, reusing platform assignment semantics. | DELIVERED |
| **SO-CORE-006** | **Basic scheduling.** A work order shall carry planned execution timing (date/time window) and be listable by schedule. | DELIVERED |
| **SO-CORE-007** | **Checklist.** A service type may define a checklist that must be completed during execution. | DELIVERED |
| **SO-CORE-008** | **Execution.** The assigned executor shall record execution progress and results against the work order and its checklist. | DELIVERED |
| **SO-CORE-009** | **Evidence.** Execution shall support attaching evidence documents/photos, inheriting the work order's authorisation. | DELIVERED |
| **SO-CORE-010** | **Completion.** Completion shall be recorded with outcome, timestamp, and executor, and shall be verifiable where the configured lifecycle requires it. | DELIVERED |
| **SO-CORE-011** | **Numbering.** Work requests and work orders shall receive configurable business numbers. | DELIVERED |
| **SO-CORE-012** | **Data scope.** Client users shall see only their own organisation's work; internal users see work within their assigned scope. | DELIVERED |
| **SO-CORE-013** | **Operational surface.** Supervisors shall work from a queue and manage assignment and scheduling. | DELIVERED |
| **SO-CORE-014** | **Field surface.** Executors shall view assigned work and record execution and evidence on mobile. | DELIVERED |
| **SO-CORE-015** | **Events & audit.** Work order lifecycle transitions shall publish domain events and record audit entries. | DELIVERED |

## Advanced requirements

| ID | Requirement | Status |
|---|---|---|
| **SO-ADV-001** | Recurring service generation from a schedule/contract cycle. | DEFERRED |
| **SO-ADV-002** | Advanced scheduling (capacity, constraints, rescheduling rules). | DEFERRED |
| **SO-ADV-003** | Route planning for distributed execution. | DEFERRED |
| **SO-ADV-004** | Productivity measurement and manpower optimisation. | DEFERRED |
| **SO-ADV-005** | Demand and workload forecasting. | DEFERRED |
| **SO-ADV-006** | Offline field execution with deferred synchronisation. | DEFERRED |

## Client Configuration

Service types · work types · checklists · lifecycle definition · SLA targets · assignment rules · scheduling rules · locations · numbering · notification templates.

## Client Extension boundary

Client device/IoT integration, site access systems, and client-specific operational calculations are Extensions.

## Dependencies

Platform Core: workflow, assignment, configuration, numbering, documents, notification, audit, events, RBAC + data scope.
Business: Customer & Commercial (mandatory context). Optional: Workforce (executor identity), Supply Chain (consumables), Asset (equipment), HSE (incidents arising during execution).

## Implementation reality

Delivered in Phase 2 (roadmap units OPS.1–OPS.5). Backend lives under
`apps/api/src/modules/service-operations/core/` — the first module built on the
frozen target repository architecture — with frontend surfaces under
`apps/web/src/modules/service-operations/`.

Lifecycle state is owned entirely by the Workflow Engine (`work_orders.
workflow_instance_id`); this module stores no status column and forwards action
codes verbatim. Checklists are snapshotted onto the Work Order at creation so
later template edits cannot rewrite executed history. Evidence reuses Document
Core with an entity authorization resolver for `work_order`. Numbering,
configuration, audit, events, notification, RBAC, and Customer Data Scope are
all reused, never re-implemented.

Evidence: `service-operations.test.ts` (13 tests) plus a real-browser
end-to-end acceptance covering define → request → work order → assign →
schedule → execute → evidence → complete → verify.

## Why this module mattered

It is the missing spine of the original General Services business: all four
verticals become configuration over it, it depended only on already-delivered
foundations, and it converts the platform from reactive quality management
(Complaint, Survey) into proactive service delivery.
