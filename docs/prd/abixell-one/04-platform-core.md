# 04 — Platform Core Requirements (`PLT-*`)

**PRD v1.0** · Canonical · Classification: **Platform Core**

Platform Core is client-agnostic technical capability reused by every business module. It is never sold or activated as a business module.

The **Platform Kernel** is the stable, contract-bearing operating boundary within this existing Platform Core. It is an architectural elaboration—not a sixth layer and not a newly delivered capability. It formalizes invariants and published seams while preserving static, reviewable composition. See the [Platform Kernel contract](../../architecture/platform-kernel.md) and [ADR-0014](../../adr/0014-platform-kernel-static-packages-and-governed-builder.md).

| ID | Requirement | Status |
|---|---|---|
| **PLT-CORE-001** | **Tenancy & organisation hierarchy.** The system shall model Tenant → Legal Entity → Organization Unit → Project → Site/Location generically, supporting single-site through multi-company structures. | DELIVERED |
| **PLT-CORE-002** | **Identity & authentication.** The system shall authenticate users per tenant with access + refresh sessions and configurable session lifetime. | DELIVERED |
| **PLT-CORE-003** | **RBAC.** The system shall authorise every action through a permission catalog assigned via roles, never by hardcoded role names. | DELIVERED |
| **PLT-CORE-004** | **Data Scope.** The system shall constrain *which* records a user may act on, independently of *what* actions they may perform, supporting tenant-wide, hierarchical organisation-unit, and customer scopes. | DELIVERED |
| **PLT-CORE-005** | **Configuration engine.** The system shall allow per-tenant configuration of terminology, reference data, feature flags, and module activation without code change. | DELIVERED |
| **PLT-CORE-006** | **Numbering.** The system shall generate configurable business document numbers per tenant and document type. | DELIVERED |
| **PLT-CORE-007** | **Metadata registry.** The system shall register structured metadata/schemas for configurable areas. | DELIVERED |
| **PLT-CORE-008** | **Workflow & approval engine.** The system shall execute versioned, tenant-configured lifecycles with steps, transitions, conditions, assignment rules, escalation, SLA, and full history — reusable by any business entity. | DELIVERED |
| **PLT-CORE-009** | **Work assignment.** The system shall assign work by role+scope queue or specific user, with claim semantics preventing double work. | DELIVERED |
| **PLT-CORE-010** | **Audit.** The system shall record an append-only audit entry for every business mutation subject to authorisation. | DELIVERED |
| **PLT-CORE-011** | **Domain events.** The system shall publish durable domain events that other modules may consume without the publisher knowing its subscribers. | DELIVERED |
| **PLT-CORE-012** | **Notification.** The system shall deliver templated notifications per tenant across channels, resolving recipients by user, explicit recipient list, or role+scope. | DELIVERED |
| **PLT-CORE-013** | **Documents & evidence.** The system shall attach documents to any business entity, inheriting the parent entity's authorisation rather than defining its own. | DELIVERED |
| **PLT-CORE-014** | **Scheduler.** The system shall run recurring platform jobs (e.g. escalation sweeps) with run history. | DELIVERED |
| **PLT-CORE-015** | **Integration boundary.** The system shall expose a controlled inbound/outbound integration boundary; third-party traffic shall never write directly to domain tables. | DELIVERED |
| **PLT-CORE-016** | **Observability.** The system shall correlate every request and record structured logs and health status. | DELIVERED |
| **PLT-CORE-017** | **Application shell & design system.** The system shall provide a consistent, capability-gated, responsive application shell and reusable UI component set. | DELIVERED |
| **PLT-CORE-018** | **Module activation.** A deployment shall present only the modules activated for that tenant. | DELIVERED |

### Module-activation qualification

The module catalog and tenant activation state are delivered configuration capabilities. The target availability contract additionally intersects package installation/compatibility, deployment catalog, tenant activation, permission, Data Scope/audience, and feature flags. Generalized enforcement of that full intersection at every backend and frontend contribution point is not delivered by Phase 11A; current backend authorization remains authoritative and Reporting performs an explicit activation check. This qualification prevents the architecture foundation from overstating current behavior or changing the existing requirement status.

## Platform Hardening (`PLT-OPS-*` — see [12-deployment-operations.md](12-deployment-operations.md))

Production/pilot readiness requirements are tracked separately so infrastructure debt is never mistaken for business capability.

## Non-functional platform requirements

| ID | Requirement | Status |
|---|---|---|
| **PLT-NFR-001** | Every tenant-owned record shall be inaccessible across tenants under all access paths, including trusted internal calls. | DELIVERED |
| **PLT-NFR-002** | Business data shall never be cached in client-side offline storage. | DELIVERED |
| **PLT-NFR-003** | Listing endpoints shall remain performant at production data scale (pagination where required). | PARTIAL |
| **PLT-NFR-004** | The platform shall support recovery from side-effect failure without corrupting primary business state. | PARTIAL |
