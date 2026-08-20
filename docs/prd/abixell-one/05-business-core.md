# 05 — Business Core Requirements (Index)

**PRD v1.0** · Canonical · Classification: **Business Core**

Eleven business domains. Each has its own PRD under [`modules/`](modules/). A module qualifies as Business Core only if it passes the **Core test**:

> With every Advanced capability removed, does this module still deliver genuine operational value?

| # | Module | PRD | Core question | Status |
|---|---|---|---|---|
| 1 | Customer & Commercial | [customer-commercial.md](modules/customer-commercial.md) | Who is the client, under what contract, at which project/site, for which service? | PARTIAL |
| 2 | Service Quality (Complaint) | [service-quality.md](modules/service-quality.md) | What went wrong, who handles it, was it fixed and confirmed? | DELIVERED |
| 3 | Survey & Assessment | [survey-assessment.md](modules/survey-assessment.md) | What did we ask, who answered, what was the result? | DELIVERED |
| 4 | Service Operations & Work Management | [service-operations.md](modules/service-operations.md) | What work is requested/scheduled, who executes it, was it done? | DELIVERED |
| 5 | Workforce (HR) | [workforce.md](modules/workforce.md) | Who is the employee and where do they belong organisationally? | DELIVERED |
| 6 | Supply Chain | [supply-chain.md](modules/supply-chain.md) | What item exists, how much, what moved, purchased from whom? | PLANNED |
| 7 | Asset | [asset.md](modules/asset.md) | What asset exists, where is it, who holds it, how did it move? | PLANNED |
| 8 | Finance | [finance.md](modules/finance.md) | What money came in/out, how much, when, for what? | PLANNED |
| 9 | HSE | [hse.md](modules/hse.md) | What incident/observation occurred, and was it followed up? | PLANNED |
| 10 | Project Delivery | [project-delivery.md](modules/project-delivery.md) | What activities/milestones exist and what is their progress? | PLANNED |
| 11 | Reporting & Operational Insight | [reporting-insight.md](modules/reporting-insight.md) | What is the cross-module operational picture? | PLANNED |

## Cross-module requirements

| ID | Requirement | Status |
|---|---|---|
| **BC-GEN-001** | Every business module shall reuse Platform Core workflow, configuration, notification, document, audit, event, and authorisation capability rather than implementing its own. | DELIVERED (for existing modules) |
| **BC-GEN-002** | Every business entity shall be tenant-owned and inaccessible across tenants. | DELIVERED |
| **BC-GEN-003** | Every business module shall expose its lifecycle through configured Workflow where a lifecycle exists, not hardcoded status columns. | DELIVERED |
| **BC-GEN-004** | Every business module shall record audit entries and publish domain events for meaningful completed actions. | DELIVERED |
| **BC-GEN-005** | No business module shall import another business module's internals; cross-domain behaviour uses application ports, events, or orchestration. | DELIVERED |
| **BC-GEN-006** | Every business module shall provide an operational user interface sufficient for its Core to be genuinely usable. | PARTIAL (Customer module has no UI) |

## Module boundary decisions

- **Vendor/Supplier** is part of Supply Chain — supplier master is inseparable from purchasing.
- **Contract** is part of Customer & Commercial — already implemented there.
- **Document management** is Platform Core, not a business module.
- **Catering / Housekeeping / Camp / Facilities** are **Vertical Service Packs** over Service Operations — see [09-vertical-service-packs.md](09-vertical-service-packs.md).
- **Customer portal / supervisor mobile / employee mobile / executive dashboard** are **experience surfaces** — see [13-experience-surfaces.md](13-experience-surfaces.md).
