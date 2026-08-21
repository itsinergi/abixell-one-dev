# Module PRD — Reporting & Operational Insight (`RPT-*`)

**PRD v1.0** · Business Core module 11 of 11 · Status: **COMPLETED (Core)**

> **Core question:** What is the cross-module operational picture?

Module-specific dashboards (e.g. the Complaint management dashboard) belong to their own modules. This module provides the **cross-module** layer and the shared reporting foundation.

## Core requirements

| ID | Requirement | Status |
|---|---|---|
| **RPT-CORE-001** | The system shall provide a reporting foundation that queries across activated modules while enforcing tenant isolation and the requesting user's data scope. | COMPLETED |
| **RPT-CORE-002** | Reports shall never expose records the requesting user could not access through the originating module. | COMPLETED |
| **RPT-CORE-003** | The system shall provide standard operational reports per activated module. | COMPLETED |
| **RPT-CORE-004** | Reports shall be exportable in a common office format for offline distribution. | COMPLETED |
| **RPT-CORE-005** | The system shall provide an executive dashboard summarising cross-module operational status. | COMPLETED |
| **RPT-CORE-006** | Dashboard content shall reflect only modules the tenant has activated. | COMPLETED |
| **RPT-CORE-007** | Report and dashboard access shall be governed by explicit permissions. | COMPLETED |
| **RPT-CORE-008** | Reporting queries shall not degrade operational transaction performance at production data volume. | COMPLETED |

### Core delivery evidence (2026-08-21)

- Backend module added under `apps/api/src/modules/reporting-insight/core/...` with domain port, application service, PostgreSQL read projections, and Fastify routes.
- Migration `1770000000000_reporting_insight_core.cjs` registers module catalog rows and explicit permissions `reporting.read` and `reporting.export`; no reporting warehouse, scheduler distribution table, BI-builder schema, predictive store, or cross-module mutation table was introduced.
- Standard reports are available for activated modules only: Customer & Commercial, Complaint, Survey, Service Operations, Workforce, Supply Chain, Asset, Finance, HSE, and Project Delivery.
- Executive dashboard cards are generated from the same scope-safe standard report summaries.
- CSV export requires `reporting.export` and is generated from the same scoped report result used by the detail endpoint.
- Integration coverage verifies permission gating, tenant/module activation filtering, Data Scope isolation in detail rows and aggregates, dashboard totals excluding out-of-scope and cross-tenant records, and export/result consistency across Finance, HSE, and Project Delivery scenarios.
- Validation passed: `reporting-insight.test.ts` 5/5, full API regression 276/276 across 23 files, API/web typecheck, API/web lint, and API/web production builds.

## Advanced requirements
 
| ID | Requirement | Status |
|---|---|---|
| **RPT-ADV-001** | Self-service business intelligence and a reporting data warehouse. | DEFERRED |
| **RPT-ADV-002** | Predictive analytics across operational history. | DEFERRED |

## Client Configuration

Report selection and availability · dashboard composition · KPI definitions and thresholds · export formats · scheduled distribution (where supported).

## Client Extension boundary

Feeding a client's own BI platform is an Extension, delivered through the integration boundary.

## Dependencies

Platform Core: RBAC + data scope (critical — reporting is the highest-risk place for scope leakage), configuration, observability.
Business: at least three Business Core modules should exist before this module delivers real value, which is why it is sequenced late.

## Note on scope discipline

This module must not become a BI platform. Core answers *what is happening operationally right now*. Deep analytical exploration is Advanced, and a client with an existing BI stack should integrate rather than duplicate.
