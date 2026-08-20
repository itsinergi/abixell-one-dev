# 09 — Vertical Service Packs (`PACK-*`)

**PRD v1.0** · Canonical · Classification: **Pack**

## What a Pack is

> A **Vertical Service Pack** is a packaged business use case that composes existing product capability for a specific service vertical.

A Pack combines:

```text
Business Core (one or more modules)
+ Client Configuration
+ optional Advanced Capability
+ optional Client Extension
```

A Pack is **not** an architectural core layer, and **not** a Business Core module.

## Binding rules

| ID | Requirement |
|---|---|
| **PACK-R1** | A Pack shall **not** introduce a duplicate work-order, workflow, scheduling, document, notification, or inventory engine. It reuses Platform Core and Business Core. |
| **PACK-R2** | A Pack has exactly one **primary owner module**, but may depend on several modules. Folder ownership does not imply exclusive dependency. |
| **PACK-R3** | A Pack shall be expressible predominantly through configuration over generic engines; capability that must be coded belongs in the owning module's Core or Advanced, not in the Pack. |
| **PACK-R4** | A Pack shall be activatable and removable per client without affecting other clients or the modules it composes. |
| **PACK-R5** | Pack content shall never leak industry assumptions into Business Core. |

## Why Packs exist

IGSEP defined Catering, Housekeeping, Camp Management, and Facilities Management as separate modules. Reproducing that would create four near-identical work-management engines. The business knowledge is preserved; the architecture is corrected:

```text
IGSEP:        Catering · Housekeeping · Camp Mgmt · Facilities Mgmt   (4 engines)
                                    ↓
Abixell One:  Service Operations & Work Management  (1 generic engine)
              + 4 Vertical Service Packs (configuration + optional Advanced)
```

## Pack register

All four packs are **PLANNED**, gated on Service Operations Core (Phase 2).

### PACK-001 — Catering
```text
Primary owner module : Service Operations & Work Management
Required modules     : Service Operations, Customer & Commercial
Optional modules     : Supply Chain (ingredients/consumables), Workforce (crew),
                       Asset (kitchen equipment), HSE (food safety incidents)
Required configuration: service types, menu-cycle/work types, checklists, SLA, locations
Optional advanced     : recurring service scheduling, productivity, forecasting
Optional extension    : client-specific meal-count or billing interface
```

### PACK-002 — Housekeeping
```text
Primary owner module : Service Operations & Work Management
Required modules     : Service Operations, Customer & Commercial
Optional modules     : Workforce (crew rostering), Supply Chain (consumables),
                       Asset (equipment)
Required configuration: area/room types, cleaning checklists, frequency, SLA
Optional advanced     : recurring service, route planning, manpower optimisation
```

### PACK-003 — Camp Services
```text
Primary owner module : Service Operations & Work Management
Required modules     : Service Operations, Customer & Commercial
Optional modules     : Asset (facilities/rooms), Workforce, Supply Chain, HSE
Required configuration: accommodation/service types, occupancy handling, checklists
Optional advanced     : recurring service, forecasting
```

### PACK-004 — Facility Services
```text
Primary owner module : Service Operations & Work Management
Required modules     : Service Operations, Customer & Commercial
Optional modules     : Asset (maintenance objects), Workforce, Supply Chain, HSE
Required configuration: facility/service types, inspection checklists, SLA
Optional advanced     : preventive/corrective maintenance (Asset Advanced),
                        advanced scheduling
```

## Pack progress accounting

Packs are counted as roadmap units only when they require product work beyond configuration. Pure configuration delivery for one client is **not** product progress (CFG-R4).
