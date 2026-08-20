# Module PRD — Customer & Commercial (`CUS-*`)

**PRD v1.0** · Business Core module 1 of 11 · Status: **PARTIAL**

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
| **CUS-CORE-008** | Authorised internal users shall create and maintain customers, contacts, contracts, projects, sites, and services through the application UI. | **PLANNED** |
| **CUS-CORE-009** | The system shall support updating and deactivating commercial master records. | PLANNED |

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

## Implementation reality

Delivered in historical Phase 1A. Backend, authorisation, and tests exist (`customer-foundation.test.ts`, 16 tests); **no dedicated management screens exist** — the module is API-only today, which is why `CUS-CORE-008` is PLANNED and the module status is PARTIAL rather than DELIVERED.
