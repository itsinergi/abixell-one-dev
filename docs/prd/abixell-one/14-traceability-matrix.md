# 14 — Requirement Traceability Matrix

**PRD v1.0** · Canonical

Maps every meaningful IGSEP legacy requirement area to its Abixell One disposition. Source: [`docs/history/igsep/`](../../history/igsep/README.md), primarily `06-Functional-Specification.md` (Functional Domains), `05-Business-Process-Documentation.md`, and `09-Module-Architecture.md`.

## Disposition vocabulary

| Disposition | Meaning | Enters product denominator? |
|---|---|---|
| **ADOPT** | Carried forward essentially as-is | Yes |
| **ADAPT** | Carried forward, generalised for whitelabel reuse | Yes |
| **MERGE** | Folded into a broader capability | Yes (within the host) |
| **RECLASSIFY** | Kept, but moved to a different layer (usually Core → Advanced, or module → pack/config) | Yes, at the new layer |
| **DEFER** | Valid, but not in current approved scope | Yes, as DEFERRED Advanced |
| **SUPERSEDE** | Replaced by a better architectural expression | No (replacement counts) |
| **DROP** | Not carried forward | No |

## Matrix

### Commercial

| Legacy area | Abixell One requirement | Disposition | New classification | Impl. status | Roadmap unit |
|---|---|---|---|---|---|
| Customer | `CUS-CORE-001/002` | ADOPT | Business Core | DELIVERED | CUS.1 |
| Contract | `CUS-CORE-003` | ADOPT | Business Core | DELIVERED | CUS.2 |
| CRM / Sales / Quotation / Proposal | `CUS-ADV-001` | RECLASSIFY | Advanced | DEFERRED | Wave A |
| Tender (sales side) | `SCM-ADV-006` | MERGE | Advanced (Supply Chain) | DEFERRED | Wave A |
| Operational Assessment | `SUR-CORE-001…016` | ADAPT | Business Core (generic Survey) | DELIVERED | SRV.1–SRV.3 |

### Operations

| Legacy area | Abixell One requirement | Disposition | New classification | Impl. status | Roadmap unit |
|---|---|---|---|---|---|
| Project | `CUS-CORE-004` + `PRJ-CORE-*` | ADAPT (split: commercial record vs delivery execution) | Business Core | PARTIAL | CUS.2 / PRJ.1 |
| Site | `CUS-CORE-005` | ADOPT | Business Core | DELIVERED | CUS.2 |
| Operational Task / Daily Report | `SO-CORE-003/008` | ADAPT | Business Core | DELIVERED | OPS.1/OPS.3 |
| Inspection / Checklist | `SO-CORE-007/008` | ADAPT | Business Core | DELIVERED | OPS.3 |
| Issue / Complaint | `SQ-CORE-001…016` | ADAPT (generic engine) | Business Core | DELIVERED | CMP.1–CMP.7 |
| Corrective Action | `SQ-CORE-005` | ADOPT | Business Core | DELIVERED | CMP.1 |
| Mobilization / Demobilization | `SO-CORE-002/003` | MERGE (work request/order lifecycle) | Business Core | DELIVERED | OPS.1 |

### Vertical services (Catering · Housekeeping · Camp · Facilities)

| Legacy area | Abixell One requirement | Disposition | New classification | Impl. status | Roadmap unit |
|---|---|---|---|---|---|
| Catering: Kitchen, Production, Distribution, Consumption, Waste, Quality, Nutrition, Menu, Meal Planning | `PACK-001` over `SO-CORE-*` | **SUPERSEDE** (as separate module) → pack + configuration | Pack | PLANNED | Pack wave |
| Housekeeping: Area, Cleaning, Schedule, Task, Photo, Completion | `PACK-002` over `SO-CORE-*` | **SUPERSEDE** → pack + configuration | Pack | PLANNED | Pack wave |
| Camp: Camp, Building, Room, Occupancy, Accommodation, Laundry, Utilities | `PACK-003` over `SO-CORE-*` | **SUPERSEDE** → pack + configuration | Pack | PLANNED | Pack wave |
| Facilities: Facility, Service Request, Work Order, History | `PACK-004` over `SO-CORE-*` | **SUPERSEDE** → pack + configuration | Pack | PLANNED (engine DELIVERED) | Pack wave |
| Facilities/Camp: Maintenance, Repair | `AST-ADV-001/002` | RECLASSIFY | Advanced (Asset) | DEFERRED | Wave A |
| Catering: Food Cost | `FIN-ADV-*` / `SCM-ADV-005` | RECLASSIFY | Advanced | DEFERRED | Wave A |

> These four are the audit's most significant architectural correction: four IGSEP modules become **one** generic Service Operations engine plus four configuration packs. Business knowledge preserved; duplicate engines eliminated.

### Workforce

| Legacy area | Abixell One requirement | Disposition | New classification | Impl. status | Roadmap unit |
|---|---|---|---|---|---|
| Employee identity, Deployment, Rotation, Termination | `HR-CORE-001…010` | ADAPT | Business Core | PLANNED | HR.1–HR.4 |
| Attendance | `HR-ADV-001` | RECLASSIFY | Advanced | DEFERRED | Wave A |
| Shift | `HR-ADV-002` | RECLASSIFY | Advanced | DEFERRED | Wave A |
| Leave | `HR-ADV-003` | RECLASSIFY | Advanced | DEFERRED | Wave A |
| Recruitment | `HR-ADV-006` | RECLASSIFY | Advanced | DEFERRED | Wave A |
| Training / Competency / Evaluation | `HR-ADV-007/008` | RECLASSIFY | Advanced | DEFERRED | Wave A |
| Medical | `HR-CORE-006` (as document) + HSE | MERGE | Business Core / Advanced | PLANNED | HR.3 |
| Payroll (implied by attendance/shift) | `HR-ADV-005` | DEFER | Advanced | DEFERRED | Wave A |

### Procurement / Warehouse / Inventory

| Legacy area | Abixell One requirement | Disposition | New classification | Impl. status | Roadmap unit |
|---|---|---|---|---|---|
| Purchase Request | `SCM-CORE-007/008` | ADOPT | Business Core | PLANNED | SCM.3 |
| Purchase Order / Receiving | `SCM-CORE-009/010` | ADOPT | Business Core | PLANNED | SCM.4 |
| Vendor (master) | `SCM-CORE-002` | **MERGE** into Supply Chain | Business Core | PLANNED | SCM.1 |
| RFQ / Vendor Quotation | `SCM-ADV-006` | RECLASSIFY | Advanced | DEFERRED | Wave A |
| Vendor Evaluation | `SCM-ADV-007` | RECLASSIFY | Advanced | DEFERRED | Wave A |
| Item / Storage | `SCM-CORE-001/003` | ADOPT | Business Core | PLANNED | SCM.1/SCM.2 |
| Receiving / Issue (stock) | `SCM-CORE-004/005` | ADOPT | Business Core | PLANNED | SCM.2 |
| Transfer / Stock Opname / Adjustment | `SCM-ADV-004` | RECLASSIFY | Advanced | DEFERRED | Wave A |
| Inventory History | `SCM-CORE-006` | ADAPT (immutable movements) | Business Core | PLANNED | SCM.2 |
| Warehouse (as separate module) | `SCM-ADV-001` | **MERGE + RECLASSIFY** | Advanced | DEFERRED | Wave A |

### Assets

| Legacy area | Abixell One requirement | Disposition | New classification | Impl. status | Roadmap unit |
|---|---|---|---|---|---|
| Asset Register / Assignment / Transfer / Retirement / History | `AST-CORE-001…010` | ADOPT | Business Core | PLANNED | AST.1–AST.3 |
| Asset Inspection / Maintenance / Repair | `AST-ADV-001/002` | RECLASSIFY | Advanced | DEFERRED | Wave A |

### Finance

| Legacy area | Abixell One requirement | Disposition | New classification | Impl. status | Roadmap unit |
|---|---|---|---|---|---|
| Billing / Invoice | `FIN-CORE-001` + `FIN-ADV-002` | ADAPT (income capture Core; AR Advanced) | Business Core / Advanced | PLANNED | FIN.1 |
| Cost Center / Budget | `FIN-ADV-003` | RECLASSIFY | Advanced | DEFERRED | Wave A |
| Project Cost | `PRJ-ADV-007/008` | RECLASSIFY | Advanced | DEFERRED | Wave A |
| AR / AP | `FIN-ADV-002` | RECLASSIFY | Advanced | DEFERRED | Wave A |
| GL Interface / Accounting Interface | `FIN-ADV-001` + `EXT` | RECLASSIFY + EXTENSION | Advanced / Extension | DEFERRED | Wave A |
| Tax Interface | `FIN-ADV-006` + `EXT` | RECLASSIFY + EXTENSION | Advanced / Extension | DEFERRED | Wave A |

> "Finance **Integration**" in IGSEP assumed an external accounting system. Abixell One keeps that posture: Finance **Core** is operational cash reality; ledgers are Advanced; posting bridges are Extensions.

### Experience surfaces

| Legacy area | Abixell One requirement | Disposition | New classification | Impl. status | Roadmap unit |
|---|---|---|---|---|---|
| Customer Portal (as module) | `UX-008` + module screens | **SUPERSEDE** → experience surface | Platform + module UI | DELIVERED (Complaint/Survey) | CMP.2 |
| Supervisor Mobile (as module) | `UX-009` + `UX-004` | **SUPERSEDE** → responsive surface | Platform + module UI | DELIVERED (Complaint) | CMP.3 |
| Employee Mobile (as module) | `UX-013` | **SUPERSEDE** → responsive surface | Platform + module UI | DELIVERED | OPS.4 |
| Executive Dashboard (as module) | `RPT-CORE-005` | **SUPERSEDE** → reporting capability | Business Core | PLANNED | RPT.3 |
| Offline Mode (supervisor) | `SO-ADV-006` | RECLASSIFY | Advanced | DEFERRED | Wave A |
| GPS capture | `SO-CORE-009` (evidence context) | ADAPT | Business Core | PARTIAL (evidence delivered; geo capture deferred) | OPS.3 |
| Portal: Attendance / Meal views | Pack + `HR-ADV-001` | RECLASSIFY | Pack / Advanced | DEFERRED | Pack wave |

### Administration & platform

| Legacy area | Abixell One requirement | Disposition | New classification | Impl. status | Roadmap unit |
|---|---|---|---|---|---|
| Users / Roles / Permissions | `PLT-CORE-002/003` | ADOPT | Platform Core | DELIVERED | PC-2/PC-3 |
| Approval / Approval Matrix | `PLT-CORE-008` + `CFG-014` | ADAPT (generic workflow) | Platform Core | DELIVERED | PC-5 |
| Master Data / Settings / Configuration | `PLT-CORE-005/006/007`, `CFG-*` | ADOPT | Platform Core | DELIVERED | PC-4 |
| Audit Trail | `PLT-CORE-010`, `SEC-007` | ADOPT | Platform Core | DELIVERED | PC-6 |
| Notification Matrix | `PLT-CORE-012` | ADOPT | Platform Core | DELIVERED | PC-8 |
| Integration (doc 11) | `INT-001…010` | ADAPT | Platform Core | DELIVERED | PC-11 |
| Security & Governance (doc 10) | `SEC-001…018` | ADOPT | Platform Core | DELIVERED / PARTIAL | PC-3, PH-2 |
| DevOps (doc 17) | `OPS-010…023` | RECLASSIFY | Platform Hardening | PLANNED | PH-1…PH-8 |
| Reporting & Analytics (doc 16) | `RPT-CORE-*` / `RPT-ADV-*` | ADAPT + RECLASSIFY | Business Core / Advanced | PLANNED | RPT.1–RPT.4 |
| Mobile Architecture (doc 15) | `UX-004/005/006/007` | ADAPT (responsive + PWA, no native app) | Platform Core | DELIVERED | PC-13 |
| UI Design System (doc 14) | `UX-003` | ADOPT | Platform Core | DELIVERED | PC-13 |
| AI Readiness (doc 21) | Platform Advanced | DEFER | Advanced | DEFERRED | Wave A |
| Marketplace / Partner ecosystem (doc 22) | Platform Advanced | DEFER | Advanced | DEFERRED | Wave A |
| Knowledge Preservation / Continuous Improvement (docs 23, 24) | Documentation governance | **SUPERSEDE** → `docs/canonical/documentation-map.md` | Governance | DELIVERED | — |
| Execution Protocol (doc 25) | Checkpoint/approval process | **SUPERSEDE** → decision log + roadmap governance | Governance | DELIVERED | — |
| 5-year strategy roadmap (doc 22) | `docs/canonical/product-roadmap.md` | **SUPERSEDE** (template → real roadmap) | Governance | DELIVERED | — |

## Disposition summary

| Disposition | Count |
|---|---:|
| ADOPT | 18 |
| ADAPT | 14 |
| MERGE | 5 |
| RECLASSIFY | 21 |
| DEFER | 2 |
| SUPERSEDE | 10 |
| DROP | 0 |
| **Total legacy areas reviewed** | **70** |

**No legacy requirement was dropped.** Every IGSEP functional domain has an explicit disposition.

## Denominator impact

Only `ADOPT`, `ADAPT`, `MERGE`, and `RECLASSIFY` items enter the approved product roadmap denominator, at their **new** classification. `SUPERSEDE` items are represented by their replacement (already counted). No item was added to the denominator merely because IGSEP mentioned it — this is why the audit baseline denominator did not inflate during PRD reconstruction.

## Coverage check

| Check | Result |
|---|---|
| IGSEP functional domains with no disposition | 0 |
| Abixell One Business Core modules with no legacy lineage | 1 — *Reporting & Operational Insight* is partly new (IGSEP had reporting embedded per module) |
| Delivered capability with no requirement ID | 0 |
| Requirement IDs with no roadmap unit | 0 (deferred Advanced maps to "Wave A") |
