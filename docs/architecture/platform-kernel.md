# Abixell One Platform Kernel

| | |
|---|---|
| **Document Status** | APPROVED ARCHITECTURE FOUNDATION |
| **Authority** | Founder-authorized Phase 11A; subordinate to the canonical PRD and Product Blueprint |
| **Date** | 2026-08-23 |
| **Scope** | Platform Kernel boundary, invariants, published contracts, and current implementation seams |
| **Related** | [Product Blueprint](../canonical/product-blueprint.md) · [Platform Core PRD](../prd/abixell-one/04-platform-core.md) · [ADR-0014](../adr/0014-platform-kernel-static-packages-and-governed-builder.md) · [Module contracts](module-extension-contracts.md) |

## 1. Purpose

The **Platform Kernel** is the stable, contract-bearing operating boundary **within the existing Platform Core**. It defines the guarantees every Abixell One module, orchestration capability, industry pack, Client Configuration, and Client Extension must preserve.

The Kernel is not:

- a sixth product layer;
- a separately sold or tenant-activatable module;
- a new microservice;
- a runtime plugin host;
- a cross-client or cross-deployment administration plane;
- a claim that every target contract below already has generalized runtime enforcement.

The approved five product layers remain unchanged:

```text
Platform Core               ← includes the Platform Kernel
Business Core
Advanced Capability
Client Configuration
Client Extension
```

A complete mandatory Platform Core base runs first. Compatible business, Advanced, industry, and extension packages are installed afterward through explicit contracts; tenant activation and tenant configuration are separate later lifecycle states.

## 2. Kernel responsibilities

The Kernel owns or governs these client-agnostic platform capabilities:

1. **Deployment and tenant context** — dedicated deployment identity, server-established Tenant context, Legal Entity and Organization hierarchy.
2. **Identity and session security** — authentication, refresh/session lifecycle, and explicit operator context.
3. **Authorization** — permission catalog, RBAC, hierarchical and customer Data Scope, and segregation of duties.
4. **Configuration and metadata** — finite typed configuration areas, metadata registry, terminology, reference data, feature flags, and module activation records.
5. **Numbering** — tenant-scoped document numbering contracts.
6. **Workflow and approval** — versioned definitions, transitions, assignments, escalation, SLA, approval, and history.
7. **Audit** — append-only records of authorization-relevant and business mutations.
8. **Domain events** — publisher/subscriber decoupling through EventBus contracts and durable domain-event records.
9. **Notification** — tenant-scoped templates, recipient resolution, channel dispatch, and operational failure visibility.
10. **Documents** — evidence storage and parent-entity authorization through Entity Authorization Resolvers.
11. **Scheduler** — registered job handlers, lease-fenced execution, and tenant-aware run history.
12. **Integration boundary** — controlled inbound/outbound adapters, idempotency, durable outbox/reconciliation, retries, and terminal visibility.
13. **Observability** — request correlation, structured logs, health, run history, and operational status.
14. **Module catalog and effective-availability contract** — package/catalog identity, compatibility, activation, permission, scope, and feature-policy dimensions.
15. **Application shell** — explicit API registration, frontend route/navigation capabilities, reusable design system, responsive Web, and PWA shell.
16. **Lifecycle operations** — one ordered migration stream, deployment, permission synchronization, backup, restore, disaster recovery, and future installer contracts.

## 3. Non-negotiable invariants

No module, package, extension, Builder artifact, installer, or trusted integration may weaken these rules.

### 3.1 Tenant isolation

- Tenant identity comes from authenticated server-side actor or explicitly authorized deployment/bootstrap context, never from an untrusted body field alone.
- Every tenant-owned read, write, event, job, document operation, integration effect, and audit entry remains tenant-scoped.
- No access path—including trusted internal calls—may cross tenant ownership.
- Dedicated deployment per client is preserved. Multi-tenant-ready internals do not authorize cross-deployment access.

### 3.2 Authorization and Data Scope

- Backend routes and services are authoritative for permissions and Data Scope.
- Frontend capability hiding is UX only; it cannot grant or deny access.
- Permission answers **what** an actor may do. Data Scope and domain eligibility answer **which records** the actor may read or act upon. Both are required where applicable.
- Trusted callers may bypass only a human permission check that the owning service has already replaced with domain-appropriate authorization. They may not bypass tenant ownership, Data Scope where applicable, domain invariants, audit, or idempotency.
- Documents inherit authorization from their parent business entity through a registered resolver; document metadata does not become an independent access path.

### 3.3 Mutation, events, and audit

- Authorization-relevant and business mutations remain append-only audited.
- Domain events and Integration metadata carry only the context needed by consumers. Sensitive free-text business content must not be copied into audit or event metadata.
- External systems and Builder artifacts never write directly to domain tables.
- Integration effects are isolated, tenant-safe, idempotent, retry-safe, observable, and reconciled durably where interruption is possible.
- Completed business history is not rewritten by metadata rollback or package removal.

### 3.4 Data and migration discipline

- PostgreSQL schema changes use the single globally ordered stream in `apps/api/migrations/`.
- Historical migrations are never rewritten or removed. Packages may declare ownership of migration IDs but do not execute independent streams.
- Production rollback never assumes an automatic down migration. It uses proven image/schema compatibility, matching backup restore, or approved forward repair.
- Business data and API responses are not cached in client-side offline storage, and business writes are not queued offline.

### 3.5 Composition safety

- Platform Core never imports business-module internals.
- A business module never imports another module's internals as a new approved pattern.
- Cross-module behavior uses published application ports, versioned domain events, explicit orchestration, the trusted Integration boundary, or composition-root wiring.
- A manifest is declaration and evidence, not authority to load or execute arbitrary code.

## 4. Published Kernel contracts

Only an intentionally published contract is stable. A class, table, internal repository, or file path does not become public merely because it is importable.

| Contract category | Purpose | Required properties |
|---|---|---|
| Application ports | Narrow synchronous collaboration across boundaries | Typed request/result; tenant semantics; owner; error contract; authorization responsibility |
| Domain events | Asynchronous business facts | Owner; versioned schema; tenant context; idempotency identity; sensitivity classification |
| Configuration schemas | Finite tenant configuration | Typed schema/version; defaults; validation; permission; audit and rollback policy |
| Entity Authorization Resolvers | Parent-derived document access | Entity owner; tenant-safe lookup; Data Scope/domain eligibility behavior |
| Scheduler handlers | Registered recurring work | Stable handler key; ownership; tenant enumeration; lease/idempotency/retry behavior |
| Integration adapters | Controlled external effects | Endpoint/mapping identity; authentication; idempotency; retry and redaction behavior |
| API namespaces | Explicit HTTP contribution | Route prefix; authentication; permissions; Data Scope; rate-limit and error policy |
| UI capabilities | Routes and navigation contributions | Symbolic capability; module code; permissions; audience/scope; backend remains authoritative |
| Health/observability | Package operational evidence | Stable check or metric key; sensitivity; failure interpretation; owner |

### 4.1 Contract evolution

- Contract versions use semantic intent: compatible additive changes are preferred; breaking changes require a new Platform Kernel contract major version.
- Packages declare a supported Kernel version range and, where necessary, immutable application-release constraints.
- Deprecation requires a published replacement, an announced support window, migration guidance, and affected-package inventory.
- Contract consumers must not depend on undocumented fields, storage layout, internal class methods, or implementation file paths.
- Compatibility checks occur before package publication and installation, and again before upgrade/promotion into a deployment.

## 5. Effective module availability

The target availability rule is an intersection, not a single boolean:

```text
effective availability
  = installed and compatible package
  ∩ deployment module catalog
  ∩ tenant module activation
  ∩ user permission
  ∩ Data Scope / audience eligibility
  ∩ applicable feature flags
```

Definitions:

- **Published** — an immutable package artifact has passed approval and has a stable digest/version.
- **Installed** — that artifact is included and validated in one dedicated deployment.
- **Activated** — one tenant in that deployment is permitted to use the installed package.
- **Configured** — tenant-specific finite values needed by the activated package are valid.
- **Authorized** — the current actor has the required permission and record-level scope for an operation.

The Platform Kernel and mandatory Platform Core base are installed for the deployment and cannot be tenant-deactivated.

## 6. Current implementation seams

Phase 11A formalizes the architecture around existing explicit seams; it does not replace them.

| Seam | Current location | Contract direction |
|---|---|---|
| Service and adapter wiring | `apps/api/src/composition-root.ts` | Remain explicit; future manifest inventory can be checked against registered symbols |
| HTTP route composition | `apps/api/src/app.ts` | Remain static and inside the scoped Fastify registration that preserves security-hook order |
| Domain EventBus | `apps/api/src/application/event/event-bus.ts` | Versioned event contracts and sensitivity declarations |
| Scheduler handlers | `apps/api/src/application/scheduler/job-handlers.ts` | Stable handler keys with ownership, tenant, lease, and retry declarations |
| Document resolver registry | `apps/api/src/application/document/entity-authorization-resolver.ts` plus composition root | Every document entity type declares and registers a parent authorization resolver |
| Web routes | `apps/web/src/App.tsx` | Explicit route contributions; no arbitrary runtime component loading |
| Navigation capability model | `apps/web/src/lib/capabilities.ts` | Permission/scope/module/audience declaration; still UX-only |
| Ordered migrations | `apps/api/migrations/` | One global stream with declared package ownership |
| Production deployment | `infra/deployment/deploy.mjs` | Kernel lifecycle for validate, backup, migrate, permission sync, start, health, and smoke |

## 7. Honest current-state qualifications

- Composition and route registration are manual and static. No manifest-aware package loader exists.
- The module catalog and tenant activation records exist, but generalized effective-availability enforcement is not yet wired across every backend route and frontend route/navigation contribution. Reporting has an explicit activation check; Phase 11A does not generalize it.
- Frontend capability visibility currently considers permission and Data Scope; backend authorization remains authoritative.
- The older Phase 0/1 source layout remains under the approved deferred migration. New target paths do not justify a big-bang source move.
- `packages/contracts` is not currently a Platform Kernel or module-to-module contract package. Phase 11A does not repurpose it.
- A known Service Operations dependency on legacy `CustomerService` predates this contract. It is a transition item, not precedent and not remediated here.

## 8. Phase 11A non-goals

Phase 11A delivers no runtime behavior, source restructuring, API, UI, schema, migration, permission, package loader, activation middleware, architecture validator, Builder, installer, desktop wrapper, or cross-deployment control plane. Those require separately authorized implementation phases.
