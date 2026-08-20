# Module PRD — Reporting & Operational Insight (`RPT-*`)

**PRD v1.0** · Business Core module 11 of 11 · Status: **PLANNED**

> **Core question:** What is the cross-module operational picture?

Module-specific dashboards (e.g. the Complaint management dashboard) belong to their own modules. This module provides the **cross-module** layer and the shared reporting foundation.

## Core requirements

| ID | Requirement | Status |
|---|---|---|
| **RPT-CORE-001** | The system shall provide a reporting foundation that queries across activated modules while enforcing tenant isolation and the requesting user's data scope. | PLANNED |
| **RPT-CORE-002** | Reports shall never expose records the requesting user could not access through the originating module. | PLANNED |
| **RPT-CORE-003** | The system shall provide standard operational reports per activated module. | PLANNED |
| **RPT-CORE-004** | Reports shall be exportable in a common office format for offline distribution. | PLANNED |
| **RPT-CORE-005** | The system shall provide an executive dashboard summarising cross-module operational status. | PLANNED |
| **RPT-CORE-006** | Dashboard content shall reflect only modules the tenant has activated. | PLANNED |
| **RPT-CORE-007** | Report and dashboard access shall be governed by explicit permissions. | PLANNED |
| **RPT-CORE-008** | Reporting queries shall not degrade operational transaction performance at production data volume. | PLANNED |

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
