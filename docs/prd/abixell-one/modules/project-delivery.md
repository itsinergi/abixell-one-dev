# Module PRD — Project Delivery (`PRJ-*`)

**PRD v1.0** · Business Core module 10 of 11 · Status: **PLANNED**

> **Core question:** What activities and milestones exist, and what is their progress?

The **project entity itself** already exists in Customer & Commercial as a commercial/organisational context. This module adds **delivery execution** on top of it — it does not redefine the project record.

## Core requirements

| ID | Requirement | Status |
|---|---|---|
| **PRJ-CORE-001** | The system shall define activities/tasks belonging to an existing project. | PLANNED |
| **PRJ-CORE-002** | The system shall define milestones belonging to a project. | PLANNED |
| **PRJ-CORE-003** | Each activity shall have a person in charge (PIC). | PLANNED |
| **PRJ-CORE-004** | Each activity shall have planned start and end dates, and actual dates when executed. | PLANNED |
| **PRJ-CORE-005** | Each activity shall have a status reflecting its execution state. | PLANNED |
| **PRJ-CORE-006** | The system shall record progress against activities and derive project-level progress from it. | PLANNED |
| **PRJ-CORE-007** | Activities and milestones shall support attachments, inheriting the project's authorisation. | PLANNED |
| **PRJ-CORE-008** | Milestone achievement shall be recordable and auditable. | PLANNED |
| **PRJ-CORE-009** | Project delivery records shall respect tenant isolation and data scope. | PLANNED |
| **PRJ-CORE-010** | Authorised users shall manage project delivery through the application UI, including a project progress view. | PLANNED |

## Advanced requirements

| ID | Requirement | Status |
|---|---|---|
| **PRJ-ADV-001** | Work breakdown structure (WBS) with hierarchical decomposition. | DEFERRED |
| **PRJ-ADV-002** | Activity dependencies and critical path. | DEFERRED |
| **PRJ-ADV-003** | Gantt visualisation. | DEFERRED |
| **PRJ-ADV-004** | Resource loading and levelling. | DEFERRED |
| **PRJ-ADV-005** | Baseline management and variance against baseline. | DEFERRED |
| **PRJ-ADV-006** | Earned value management. | DEFERRED |
| **PRJ-ADV-007** | Project cost control. | DEFERRED |
| **PRJ-ADV-008** | Project accounting (with Finance). | DEFERRED |

## Client Configuration

Project types · activity types · milestone templates · progress measurement method · status values · lifecycle where approval is required.

## Client Extension boundary

Synchronisation with a client's existing project-management tool is an Extension.

## Dependencies

Platform Core: configuration, documents, audit, events, RBAC + data scope, workflow (where approvals apply).
Business: Customer & Commercial (the project record itself), Workforce (PIC), Service Operations (work executed under a project).

## Note on scope discipline

Core must remain usable as a straightforward activity/milestone tracker. Scheduling mathematics (dependencies, critical path, earned value) is Advanced and must never become a prerequisite for recording delivery progress.
