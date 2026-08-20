# Module PRD — Asset (`AST-*`)

**PRD v1.0** · Business Core module 7 of 11 · Status: **DELIVERED** (Phase 5)

> **Core question:** What asset exists, where is it, who holds it, and how did it move?

Core is a **register**, not a maintenance system. Maintenance is Advanced.

## Core requirements

| ID | Requirement | Status |
|---|---|---|
| **AST-CORE-001** | The system shall maintain an asset master per tenant with a unique asset identifier/tag. | DELIVERED |
| **AST-CORE-002** | The system shall record asset category, description, and acquisition reference. | DELIVERED |
| **AST-CORE-003** | The system shall record the asset's current location within the organisation hierarchy (organisation unit / project / site). | DELIVERED |
| **AST-CORE-004** | The system shall record the current custodian (organisation unit and/or employee). | DELIVERED |
| **AST-CORE-005** | The system shall record asset status (e.g. in use, idle, under repair, disposed). | DELIVERED |
| **AST-CORE-006** | The system shall retain full movement history (location, custodian, and status changes over time). | DELIVERED |
| **AST-CORE-007** | Asset movements shall follow a configured approval lifecycle where the client requires one. | DELIVERED |
| **AST-CORE-008** | The system shall attach asset documents (proof of ownership, warranty, photos), inheriting the asset's authorisation. | DELIVERED |
| **AST-CORE-009** | Asset records shall respect tenant isolation and data scope. | DELIVERED |
| **AST-CORE-010** | Authorised users shall maintain the asset register through the application UI. | DELIVERED |

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

## Implementation reality

Delivered in Phase 5 (roadmap units AST.1–AST.4). Backend at
`apps/api/src/modules/asset/core/`, frontend at `apps/web/src/modules/asset/`.

Two tables: `assets` and `asset_movements`. Identity is two-part —
`asset_number` from Numbering Core (always present) plus an OPTIONAL
`asset_tag`, the physical identifier, unique per tenant through a partial
index because NULL never equals NULL.

**Responsibility and location are modelled separately.** The organisation
unit carries responsibility and is the Data Scope anchor; project, site, and
a lightweight free-text location detail carry physical placement. A site is
never treated as an organisational owner.

**Transactional integrity is the module's defining property:** location,
custodian, and status change *only* through the movement ledger. Every
applied movement locks the asset row, snapshots the real previous placement,
writes the new one, and takes the resulting `version` as its `sequence` — in
one transaction. A partial unique index on `(asset_id, sequence)` makes a
lost update impossible at the database level. Proven by test: six parallel
transfers yield sequences 1…6, an unbroken from/to chain, and current state
equal to the last applied movement.

**Approval is optional** (AST-CORE-007, "where the client requires one"):
with a published `asset_movement_approval` Workflow Definition a movement is
recorded unapplied and applies on approval; without one it applies
immediately. There is no status column on the movement — pending / approved
/ rejected is read from the Workflow instance, and "took effect" is
`applied_at`.

Retirement and disposal are terminal statuses recorded through the same
ledger. There is **no delete endpoint**: a retired asset keeps its record,
documents, and full history, and simply stops moving.

**Custodian without coupling.** `custodian_employee_id` references the
Workforce `employees` table, but Asset imports nothing from Workforce: a
narrow `CustodianReference` port (`{ id, employeeNumber, fullName }`) is
implemented inside Asset's own repository, so no employment, contact, or
other personal data ever reaches an Asset payload.

Evidence: `asset.test.ts` (18 tests) plus a real-browser acceptance covering
register → document → move → update → status change → retirement →
history-preserved → hidden-by-default-but-retrievable.

## Deliberate narrowing of AST-CORE-005

The requirement's parenthetical lists *"in use, idle, under repair,
disposed"*. Core ships four finite, behaviour-driving values:
`in_use · idle · retired · disposed`. **"Under repair" is deliberately not a
Core status** — an equipment condition driven by a repair job belongs to
Asset Advanced (Maintenance), and admitting it would put a maintenance state
into a register that has no maintenance engine behind it. This is a
narrowing, recorded as `FD-P5-01` in the decision log; it does not change the
requirement's disposition, which is met (status is recorded and historised).

## Note on scope discipline

Depreciation and asset valuation are **Finance Advanced**, not Asset Core: the register answers *what and where*, accounting answers *what it is worth*.
