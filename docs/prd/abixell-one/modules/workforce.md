# Module PRD — Workforce / HR (`HR-*`)

**PRD v1.0** · Business Core module 5 of 11 · Status: **DELIVERED** (Phase 3)

> **Core question:** Who is the employee and where do they belong organisationally?

Core deliberately stops at **identity and placement**. Everything time-, money-, or evaluation-related is Advanced.

## Core requirements

| ID | Requirement | Status |
|---|---|---|
| **HR-CORE-001** | The system shall maintain an employee master per tenant with a unique employee identifier. | DELIVERED |
| **HR-CORE-002** | The system shall record employment status (e.g. active, inactive, ended) and employment type. | DELIVERED |
| **HR-CORE-003** | The system shall place each employee in the organisation structure (legal entity, organisation unit, and where relevant project/site). | DELIVERED |
| **HR-CORE-004** | The system shall record position/role title for each employee. | DELIVERED |
| **HR-CORE-005** | The system shall record employee contact information. | DELIVERED |
| **HR-CORE-006** | The system shall attach employee documents, inheriting the employee record's authorisation. | DELIVERED |
| **HR-CORE-007** | The system shall retain basic employment history (placement and status changes over time). | DELIVERED |
| **HR-CORE-008** | Employee records shall be linkable to platform user accounts where the employee uses the system. | DELIVERED |
| **HR-CORE-009** | Access to employee data shall respect data scope; a scoped supervisor shall not browse the whole tenant's workforce. | DELIVERED |
| **HR-CORE-010** | Authorised users shall maintain workforce records through the application UI. | DELIVERED |

## Advanced requirements

| ID | Requirement | Status |
|---|---|---|
| **HR-ADV-001** | Attendance capture and processing. | DELIVERED (Wave A4) |
| **HR-ADV-002** | Shift and roster management. | DELIVERED (Wave A4) |
| **HR-ADV-003** | Leave management. | DELIVERED (Wave A4) |
| **HR-ADV-004** | Overtime management. | DELIVERED (Wave A4) |
| **HR-ADV-005** | Payroll, including statutory social-security contributions and income-tax withholding. | DELIVERED (Wave A4) |
| **HR-ADV-006** | Recruitment. | DELIVERED (Wave A4) |
| **HR-ADV-007** | Performance management. | DELIVERED (Wave A4) |
| **HR-ADV-008** | Competency, training, and career development. | DELIVERED (Wave A4) |
| **HR-ADV-009** | Manpower planning. | DELIVERED (Wave A4) |

## Client Configuration

Employment types · positions · organisation structure · document types · employee numbering · terminology.

## Client Extension boundary

Biometric/attendance devices, payroll bank files, and government reporting interfaces are Extensions.

## Dependencies

Platform Core: tenancy/organisation, RBAC + data scope, documents, configuration, audit.
Consumed by: Service Operations (executor identity), Asset (custodian), HSE (person involved), Project Delivery (PIC).

## Implementation reality

Delivered in Phase 3 (roadmap units HR.1–HR.5) and Wave A4 (Advanced units HR-ADV-001…009). Backend at
`apps/api/src/modules/workforce/core/` and `apps/api/src/modules/workforce/advanced/`, frontend at
`apps/web/src/modules/workforce/` and `apps/web/src/pages/workforce-advanced/`.

Workforce Core maintains three tables: `positions`, `employees` (current placement + optional
`user_id`), and `employee_assignments` (one row per placement/status period).
A placement change closes the open period and opens a new one, so historical
facts are never rewritten; a partial unique index allows at most one open
assignment per employee.

Workforce Advanced delivers 15 tables under migration `1780000000000_wave-a4-workforce-advanced.cjs`:
- Attendance & Shifts: `workforce_shifts`, `workforce_rosters`, `workforce_attendance_records`
- Leave & Overtime: `workforce_leave_types`, `workforce_leave_balances`, `workforce_leave_requests`, `workforce_overtime_requests`
- Payroll & Statutori: `workforce_statutory_policies`, `workforce_employee_salary_profiles`, `workforce_payroll_runs`, `workforce_payslips`
- Recruitment: `workforce_job_postings`, `workforce_job_applications`
- Performance & Talent: `workforce_competencies`, `workforce_employee_competencies`, `workforce_training_courses`, `workforce_training_enrollments`, `workforce_performance_reviews`, `workforce_career_paths`
- Manpower Planning: `workforce_manpower_plans`

Zero core regression: Core Workforce remains clean of Advanced dependencies. Lifecycle management delegates directly to generic Workflow Engine (`workflowInstanceId`). Payroll calculation uses integer-cent arithmetic with deterministic rounding (`half_up`, `down`, `up`). Manpower planning computes deterministic gaps without mutating employee records. All 24 integration tests pass deterministically in `apps/api/tests/integration/wave-a4-integration.test.ts`.
period per employee.

Employee is deliberately **not** a system user: the account link is optional
and one-to-one per tenant, and linking never creates, modifies, or
deactivates the account itself. Organisation is not duplicated — placement
references the platform's Legal Entity and Organization Unit hierarchy, with
hierarchical Data Scope reused rather than re-derived. Employee documents
reuse Document Core behind a dedicated `workforce.documents.read` capability
because they are more sensitive than ordinary business records.

Evidence: `workforce.test.ts` (16 tests) plus a real-browser acceptance
covering create → document → transfer → end employment with history intact.

## Note on scope discipline

Payroll is the largest single Advanced item in the product. It must never be treated as a prerequisite for Workforce Core: a client must be able to use employee master and placement without any payroll capability. Phase 3 honoured this — no attendance, shift/roster, leave, overtime, payroll, recruitment, performance, competency, or manpower-planning capability exists in Core, and no country-specific compliance fields were introduced.
