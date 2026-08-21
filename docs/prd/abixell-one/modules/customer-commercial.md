# Module PRD — Customer & Commercial (`CUS-*`)

**PRD v1.0** · Business Core module 1 of 11 · Status: **COMPLETED (CUS.4 maintenance)**

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
| **CUS-CORE-009** | The system shall support updating and deactivating commercial master records. | COMPLETED |

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

- Historical Phase 1A delivered the backend domain, tenant isolation, RBAC, Customer Data Scope, and integration coverage (`customer-foundation.test.ts`) for customer master, contacts, contracts, projects, sites/locations, service catalog, and customer-service links.
- Phase 10 adds a dedicated Customer & Commercial frontend screen at `/customer-commercial`, gated by existing customer permissions and internal scope in the shared navigation capability model.
- The screen lists scoped customers and, for the selected customer, loads contacts, contracts, projects, sites/locations, and service links from the backend APIs; the service catalog is loaded from the tenant-level service catalog endpoint.
- Authorized users can create customers, contacts, contracts, projects, sites/locations, service catalog entries, and customer-service links through the application UI.
- CUS-CORE-009 is delivered with backend PATCH maintenance endpoints for customers, customer contacts, contracts, projects, sites/locations, service catalog entries, and customer-service links. Deactivate/reactivate uses `status` transitions for customer-context records and customer-service links, and `isActive` transitions for service catalog entries; customer contacts support update because no contact status/isActive field is modeled.
- Maintenance actions preserve tenant isolation, RBAC, Customer Data Scope, audit logging, and no hard-delete behavior. Focused integration coverage proves scoped manage success, inactive/active transitions without hard delete, read-only denial, out-of-scope denial, and cross-tenant denial.
- Validation evidence for the correction pass: `npm run typecheck` passed; `npm run test -w apps/api` passed (23 files, 278 tests).

## Implementation reality

Delivered in historical Phase 1A as backend/API foundation; completed in Phase 10 with dedicated Customer & Commercial management UI plus backend maintenance routes for CUS-CORE-009. Advanced sales/opportunity/quotation and expanded self-service portal capabilities remain deferred.
