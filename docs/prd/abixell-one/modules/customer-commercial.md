# Module PRD — Customer & Commercial (`CUS-*`)

**PRD v1.0** · Business Core module 1 of 11 · Status: **COMPLETED (CUS.4 UI)**

> **Core question:** Who is the client, under what contract, at which project/site, for which service?

## Core requirements

| ID | Requirement | Status |
|---|---|---|
| **CUS-CORE-001** | The system shall maintain a customer master per tenant, with code, name, status, and owning organisation unit. | DELIVERED |
| **CUS-CORE-002** | The system shall maintain customer contacts belonging to a customer. | DELIVERED |
| **CUS-CORE-003** | The system shall record contracts belonging to a customer. | DELIVERED |
| **CUS-CORE-004** | The system shall record projects belonging to a customer. | DELIVERED |
| **CUS-CORE-005** | The system shall record sites/locations belonging to a customer's projects. | DELIVERED |
| **CUS-CORE-006** | The system shall maintain a service catalog and link the services delivered to each customer. | DELIVERED |
| **CUS-CORE-007** | The system shall constrain customer-related access by Customer Data Scope, so a client user sees only their own organisation's records. | DELIVERED |
| **CUS-CORE-008** | Authorised internal users shall create and maintain customers, contacts, contracts, projects, sites, and services through the application UI. | COMPLETED |
| **CUS-CORE-009** | The system shall support updating and deactivating commercial master records. | PLANNED (backend route surface absent) |

## Advanced requirements

| ID | Requirement | Status |
|---|---|---|
| **CUS-ADV-001** | Sales pipeline: opportunity, quotation, and pricing management. | DEFERRED |
| **CUS-ADV-002** | Expanded customer self-service portal beyond request submission and tracking. | DEFERRED |

## Client Configuration

Customer categories and statuses · service catalog content · organisation hierarchy (legal entity, organisation unit, project, site) · terminology · numbering patterns.

## Client Extension boundary

Client CRM/ERP master-data synchronisation is an Extension (`EXT`), integrated through the integration boundary — never by embedding client-specific sync logic in this module.

## Dependencies

Platform Core: tenancy, RBAC + Customer Data Scope, configuration, audit, documents.
Consumed by: Service Quality, Survey & Assessment, Service Operations, Finance, Project Delivery.

## Core delivery evidence (2026-08-21)

- Historical Phase 1A delivered the backend domain, tenant isolation, RBAC, Customer Data Scope, and integration coverage (`customer-foundation.test.ts`, 16 tests) for customer master, contacts, contracts, projects, sites/locations, service catalog, and customer-service links.
- Phase 10 adds a dedicated Customer & Commercial frontend screen at `/customer-commercial`, gated by existing customer permissions and internal scope in the shared navigation capability model.
- The screen lists scoped customers and, for the selected customer, loads contacts, contracts, projects, sites/locations, and service links from the existing backend APIs; the service catalog is loaded from the existing tenant-level service catalog endpoint.
- Authorized users can create customers, contacts, contracts, projects, sites/locations, service catalog entries, and customer-service links through the application UI using the existing POST endpoints. Backend RBAC and Customer Data Scope remain authoritative.
- Update and deactivate/reactivate controls are intentionally not exposed in Phase 10 because the currently approved Customer & Commercial backend route surface exposes create/list endpoints only. The UI still displays existing `status` / `isActive` fields and does not fabricate unsupported mutation actions.
- Validation evidence for Phase 10: workspace typecheck and lint passed during implementation; full required validation is recorded in the canonical baseline after completion.

## Implementation reality

Delivered in historical Phase 1A as backend/API-only; completed in Phase 10 with dedicated Customer & Commercial management UI over the existing backend APIs. Advanced sales/opportunity/quotation and expanded self-service portal capabilities remain deferred.
