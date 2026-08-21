# Module PRD — HSE (Health, Safety & Environment) (`HSE-*`)

**PRD v1.0** · Business Core module 9 of 11 · Status: **DELIVERED**

> **Core question:** What incident or observation occurred, and was it followed up?

Core is **capture and follow-up**. Investigation methodology, risk assessment, permits, and compliance programmes are Advanced.

## Core requirements

| ID | Requirement | Status |
|---|---|---|
| **HSE-CORE-001** | Any authorised user shall report an incident with date/time, description, category, and severity. | DELIVERED |
| **HSE-CORE-002** | Any authorised user shall report a safety observation (near-miss, unsafe condition, unsafe act). | DELIVERED |
| **HSE-CORE-003** | Incidents and observations shall record the location within the organisation hierarchy (organisation unit / project / site). | DELIVERED |
| **HSE-CORE-004** | Persons involved shall be recordable, linked to workforce records where applicable. | DELIVERED |
| **HSE-CORE-005** | Evidence (photos, documents) shall be attachable, inheriting the record's authorisation. | DELIVERED |
| **HSE-CORE-006** | Each record shall follow a configured follow-up lifecycle through the Workflow Engine, ending in a closed state. | DELIVERED |
| **HSE-CORE-007** | Follow-up actions shall have an owner and a target date, and their completion shall be recorded. | DELIVERED |
| **HSE-CORE-008** | Records shall receive configurable business numbers. | DELIVERED |
| **HSE-CORE-009** | HSE records shall respect tenant isolation and data scope, with appropriate confidentiality for sensitive incidents. | DELIVERED |
| **HSE-CORE-010** | Authorised users shall report and manage HSE records through the application UI, including on mobile in the field. | DELIVERED |

## Advanced requirements

| ID | Requirement | Status |
|---|---|---|
| **HSE-ADV-001** | Structured investigation methodology (e.g. root-cause analysis frameworks). | DEFERRED |
| **HSE-ADV-002** | Risk assessment (JSA, HIRA) with risk matrices. | DEFERRED |
| **HSE-ADV-003** | Permit to Work. | DEFERRED |
| **HSE-ADV-004** | Planned inspection and audit programmes. | DEFERRED |
| **HSE-ADV-005** | Environmental monitoring. | DEFERRED |
| **HSE-ADV-006** | Formal CAPA management. | DEFERRED |
| **HSE-ADV-007** | Leading and lagging safety indicators and dashboards. | DEFERRED |

## Client Configuration

Incident types and categories · severity scales · observation types · locations · follow-up lifecycle · notification templates · numbering patterns.

## Client Extension boundary

Regulator/government reporting interfaces are Extensions — statutory formats differ per client and jurisdiction.

## Dependencies

Platform Core: workflow, configuration, numbering, documents, notification, audit, events, RBAC + data scope.
Business: Workforce (persons involved), Customer & Commercial (site context), Service Operations (incidents arising during execution), Asset (assets involved).

## Note on scope discipline

HSE Core must be genuinely usable by a client with no formal safety-management system: report, route, follow up, close. Compliance depth is opt-in.
