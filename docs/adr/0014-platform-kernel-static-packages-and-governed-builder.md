# ADR-0014: Platform Kernel, Static Package Composition, and Governed Metadata Builder

- **Status:** APPROVED for Phase 11A
- **Date:** 2026-08-23
- **Source:** Founder authorization for Phase 11A — Abixell One Platform Kernel & Builder Architecture Foundation

## Context

Abixell One already has strong Platform Core seams: a manual composition root, explicit API and Web route registration, application ports, domain events, Entity Authorization Resolvers, Scheduler handlers, a controlled Integration boundary, one ordered migration stream, and dedicated deployment automation. Those seams are implemented, but the product did not yet have one formal contract for the stable Platform Kernel, package identity and compatibility, package lifecycle, or safe future metadata editing.

The approved five-layer product model is:

```text
Platform Core
Business Core
Advanced Capability
Client Configuration
Client Extension
```

Phase 11A also authorizes direction for a future metadata-driven Platform Builder and cross-platform installation experience. The existing PRD rejects generic low-code programming, arbitrary expressions, scripts, and DSLs. A safe foundation therefore has to distinguish governed typed metadata from arbitrary programming and must not imply that a Builder, package runtime, installer, or cross-deployment administration plane already exists.

## Decision

### 1. Platform Kernel is part of Platform Core

The **Platform Kernel** is the stable, contract-bearing operating boundary within Platform Core. It is not a sixth product layer, a separately sold capability, a tenant-activatable module, a new microservice, or a cross-deployment control plane.

Kernel internals may evolve, but published contracts and platform invariants are versioned. Packages declare the Platform Kernel contract versions they support. The complete mandatory Platform Core base is installed and healthy before optional package installation and tenant activation.

### 2. Package manifests are declarative; composition remains static

A Module Manifest describes an immutable package, its compatibility, dependencies, contracts, contributions, security profile, data ownership, lifecycle evidence, and provenance.

A manifest does **not** authorize arbitrary runtime discovery or code loading. Backend services, routes, event subscribers, Scheduler handlers, document resolvers, Integration adapters, and frontend routes/navigation remain registered through explicit, reviewable composition code. Future tooling may compare that composition with package declarations, but Phase 11A adds no loader or validator.

All database migrations remain in the single deterministic stream at `apps/api/migrations/`. Packages may declare migration ownership, but may not operate independent migration streams.

### 3. The Builder is governed typed metadata

The future Platform Builder may author only a finite, versioned metamodel through this lifecycle:

```text
draft → validate → simulate / impact analysis → review → approve
      → publish → audit / observe → rollback or supersede
```

Every production-affecting artifact requires controls proportionate to its risk, including immutable versions, typed and semantic validation, tenant/RBAC/Data Scope/document/workflow impact checks, human-readable diffs, maker-checker approval, append-only audit, atomic publication, observability, and safe recovery.

Arbitrary SQL or query editors, scripts, expression DSLs, runtime code injection, direct production schema editing, direct writes to domain tables, authorization bypass, and cross-tenant mutation are prohibited and cannot be approved through the Builder.

### 4. Business Admin and Platform Architect are separate trust planes

The Business Admin Console remains inside each dedicated deployment and uses deployment-local tenant authentication, RBAC, Data Scope, and audit.

The future Platform Architect / Builder Console is a separate, higher-risk operator context for artifacts and governed publication. It does not create an ambient cross-client business-data superuser. Any future deployment operation requires an explicit target deployment, an approved immutable artifact, deployment-local authorization and audit, and a scoped, expiring operation grant.

A future central artifact catalog may store schemas, manifests, signed artifacts, simulations, and approvals. It may not store tenant business records, tenant secrets, unrestricted database credentials, or have direct database access to client deployments.

### 5. Installation is Core-first and preserves production gates

Future one-click installation is guided, resumable orchestration around the existing safe deployment lifecycle. It must preserve immutable releases, environment validation, backup/quiescing, the single migration stream, full-access-role permission synchronization, health checks, smoke validation, bootstrap controls, and recovery discipline.

Responsive Web/PWA remains the primary PC, laptop, Android, and iOS experience. Any future desktop wrapper remains a thin client to the dedicated deployment and must not embed a business database, cache API data, queue offline writes, or bypass TLS and backend authorization.

## Rejected alternatives

- Adding Platform Kernel as an unrelated sixth product layer.
- Arbitrary runtime plugins or package code loading based solely on a manifest.
- A direct production schema editor.
- Arbitrary SQL, query, scripting, or expression-DSL surfaces.
- Per-client forks of Platform Core or business-module internals.
- A universal cross-deployment administrator with ambient tenant-data access.
- Treating navigation hiding as authorization.
- Package-owned independent migration streams.
- Automatic down-migration rollback in production.

## Consequences

- Existing explicit composition remains intentionally manual and auditable.
- Module Manifest v1 initially provides a governance and package-evidence contract, not runtime behavior.
- Platform Kernel internals remain protected while published contracts gain a versioning policy.
- Existing gaps, including non-generalized module-activation enforcement and a known transitional cross-module dependency, remain visible rather than being represented as solved.
- Phase 11A changes no runtime behavior, database schema, permission catalog, package loader, Builder UI/API, installer, or control plane.
- Any future Builder runtime, package installation runtime, activation enforcement, cross-platform installer, desktop wrapper, or architecture validator requires separate authorization, requirements, roadmap treatment, security review, and tests.

## Related documents

- [Platform Kernel](../architecture/platform-kernel.md)
- [Module, Package, and Extension Contracts](../architecture/module-extension-contracts.md)
- [Dual Admin Console](../architecture/dual-admin-console.md)
- [Platform Builder Risk Model](../architecture/platform-builder-risk-model.md)
- [One-Click Platform Installation Direction](../architecture/one-click-platform-installation.md)
- [Product Blueprint](../canonical/product-blueprint.md)
- [Product Scope](../prd/abixell-one/03-product-scope.md)
