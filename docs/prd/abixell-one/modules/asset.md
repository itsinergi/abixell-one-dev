# Module PRD — Asset (`AST-*`)

**PRD v1.0** · Business Core module 7 of 11 · Status: **PLANNED**

> **Core question:** What asset exists, where is it, who holds it, and how did it move?

Core is a **register**, not a maintenance system. Maintenance is Advanced.

## Core requirements

| ID | Requirement | Status |
|---|---|---|
| **AST-CORE-001** | The system shall maintain an asset master per tenant with a unique asset identifier/tag. | PLANNED |
| **AST-CORE-002** | The system shall record asset category, description, and acquisition reference. | PLANNED |
| **AST-CORE-003** | The system shall record the asset's current location within the organisation hierarchy (organisation unit / project / site). | PLANNED |
| **AST-CORE-004** | The system shall record the current custodian (organisation unit and/or employee). | PLANNED |
| **AST-CORE-005** | The system shall record asset status (e.g. in use, idle, under repair, disposed). | PLANNED |
| **AST-CORE-006** | The system shall retain full movement history (location, custodian, and status changes over time). | PLANNED |
| **AST-CORE-007** | Asset movements shall follow a configured approval lifecycle where the client requires one. | PLANNED |
| **AST-CORE-008** | The system shall attach asset documents (proof of ownership, warranty, photos), inheriting the asset's authorisation. | PLANNED |
| **AST-CORE-009** | Asset records shall respect tenant isolation and data scope. | PLANNED |
| **AST-CORE-010** | Authorised users shall maintain the asset register through the application UI. | PLANNED |

## Advanced requirements

| ID | Requirement | Status |
|---|---|---|
| **AST-ADV-001** | Preventive maintenance scheduling. | DEFERRED |
| **AST-ADV-002** | Corrective maintenance and maintenance work orders. | DEFERRED |
| **AST-ADV-003** | Meter reading and usage-based triggers. | DEFERRED |
| **AST-ADV-004** | Spare parts management (with Supply Chain). | DEFERRED |
| **AST-ADV-005** | Downtime tracking. | DEFERRED |
| **AST-ADV-006** | Reliability metrics (MTBF, MTTR). | DEFERRED |
| **AST-ADV-007** | Predictive maintenance. | DEFERRED |
| **AST-ADV-008** | Fixed-asset accounting and depreciation (with Finance). | DEFERRED |

## Client Configuration

Asset categories · locations · status values · custodian rules · movement approval lifecycle · numbering/tagging pattern.

## Client Extension boundary

Client CMMS, telematics, and IoT sensor integrations are Extensions.

## Dependencies

Platform Core: workflow, configuration, numbering, documents, audit, events, RBAC + data scope.
Business: Workforce (custodian), Customer & Commercial (site context). Optional: Supply Chain (spares), Service Operations (equipment used in execution).

## Note on scope discipline

Depreciation and asset valuation are **Finance Advanced**, not Asset Core: the register answers *what and where*, accounting answers *what it is worth*.
