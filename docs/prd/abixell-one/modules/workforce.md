# Module PRD — Workforce / HR (`HR-*`)

**PRD v1.0** · Business Core module 5 of 11 · Status: **PLANNED**

> **Core question:** Who is the employee and where do they belong organisationally?

Core deliberately stops at **identity and placement**. Everything time-, money-, or evaluation-related is Advanced.

## Core requirements

| ID | Requirement | Status |
|---|---|---|
| **HR-CORE-001** | The system shall maintain an employee master per tenant with a unique employee identifier. | PLANNED |
| **HR-CORE-002** | The system shall record employment status (e.g. active, inactive, ended) and employment type. | PLANNED |
| **HR-CORE-003** | The system shall place each employee in the organisation structure (legal entity, organisation unit, and where relevant project/site). | PLANNED |
| **HR-CORE-004** | The system shall record position/role title for each employee. | PLANNED |
| **HR-CORE-005** | The system shall record employee contact information. | PLANNED |
| **HR-CORE-006** | The system shall attach employee documents, inheriting the employee record's authorisation. | PLANNED |
| **HR-CORE-007** | The system shall retain basic employment history (placement and status changes over time). | PLANNED |
| **HR-CORE-008** | Employee records shall be linkable to platform user accounts where the employee uses the system. | PLANNED |
| **HR-CORE-009** | Access to employee data shall respect data scope; a scoped supervisor shall not browse the whole tenant's workforce. | PLANNED |
| **HR-CORE-010** | Authorised users shall maintain workforce records through the application UI. | PLANNED |

## Advanced requirements

| ID | Requirement | Status |
|---|---|---|
| **HR-ADV-001** | Attendance capture and processing. | DEFERRED |
| **HR-ADV-002** | Shift and roster management. | DEFERRED |
| **HR-ADV-003** | Leave management. | DEFERRED |
| **HR-ADV-004** | Overtime management. | DEFERRED |
| **HR-ADV-005** | Payroll, including statutory social-security contributions and income-tax withholding. | DEFERRED |
| **HR-ADV-006** | Recruitment. | DEFERRED |
| **HR-ADV-007** | Performance management. | DEFERRED |
| **HR-ADV-008** | Competency, training, and career development. | DEFERRED |
| **HR-ADV-009** | Manpower planning. | DEFERRED |

## Client Configuration

Employment types · positions · organisation structure · document types · employee numbering · terminology.

## Client Extension boundary

Biometric/attendance devices, payroll bank files, and government reporting interfaces are Extensions.

## Dependencies

Platform Core: tenancy/organisation, RBAC + data scope, documents, configuration, audit.
Consumed by: Service Operations (executor identity), Asset (custodian), HSE (person involved), Project Delivery (PIC).

## Note on scope discipline

Payroll is the largest single Advanced item in the product. It must never be treated as a prerequisite for Workforce Core: a client must be able to use employee master and placement without any payroll capability.
