# Module, Package, and Extension Contracts

| | |
|---|---|
| **Document Status** | APPROVED ARCHITECTURE FOUNDATION |
| **Authority** | Founder-authorized Phase 11A; subordinate to the canonical PRD and Product Blueprint |
| **Date** | 2026-08-23 |
| **Scope** | Repository boundaries, Module Manifest v1, compatibility, and package lifecycle |
| **Related** | [Product Blueprint](../canonical/product-blueprint.md) · [Client Extension PRD](../prd/abixell-one/08-client-extension.md) · [Platform Kernel](platform-kernel.md) · [Builder Risk Model](platform-builder-risk-model.md) · [ADR-0014](../adr/0014-platform-kernel-static-packages-and-governed-builder.md) |

## 1. Purpose

This contract keeps module, industry, orchestration, and client-specific customization outside Platform Kernel internals. It defines what a package may own, depend on, publish, contribute, install, activate, upgrade, deactivate, and remove.

The contract began as documentary architecture in Phase 11A. Phase 11B now enforces the highest-confidence repository boundaries described in §8. It still does not add a manifest loader, dynamic plugin system, package manager, source move, or independent migration mechanism.

## 2. Product classifications

The five approved product layers remain unchanged. Package classifications describe delivery ownership inside those layers; they do not create new layers.

| Manifest classification | Product meaning |
|---|---|
| `business-core` | Existing **Business Core**—also called a standard module; minimum usable business-domain capability |
| `advanced` | Optional deeper capability owned by one business module |
| `industry-pack` | Packaged industry use case composed from an owner's published Core contracts plus configuration and, where declared, Advanced capability |
| `orchestration` | Cross-domain coordination over published ports/events without false ownership by one module |
| `client-extension` | Client-specific, removable package outside the default product release and both progress denominators |

Platform Kernel is part of Platform Core and is not an activatable manifest classification.

## 3. Repository ownership and dependency rules

### 3.1 Binding direction

```text
shared  ←  core  ←  modules  ←  orchestration
packs → their module's core + Platform configuration
```

- `shared` contains non-semantic technical utilities only.
- `core` contains Platform Core/Kernel capabilities and published platform contracts.
- `modules/<module>/core/` owns minimum reusable business-domain capability.
- Domain-specific Advanced capability belongs under `modules/<module>/advanced/`.
- Cross-domain Advanced coordination belongs under `orchestration/<capability>/`.
- Industry packs belong under their owner module's `packs/` boundary and do not duplicate generic engines.
- Empty `advanced/` or `packs/` directories are not created for symmetry.

The target module-first layout is binding for new code, while the approved Phase 0/1 layer-first migration remains deferred. This contract does not justify a big-bang source move.

### 3.2 Import and collaboration boundaries

Prohibited:

- Platform Core importing a business package;
- one business package importing another package's internal classes, repositories, domain models, API files, or storage details;
- circular package dependencies;
- direct cross-package writes to another package's tables;
- package behavior that bypasses Kernel authorization, audit, workflow, document, Integration, or migration controls.

Permitted seams:

- narrow published application ports;
- versioned domain events;
- explicit cross-domain orchestration;
- trusted Integration boundary;
- explicit composition-root wiring;
- scope-safe, reviewed reporting read models.

A reporting projection may read across domains only when it is read-only, declares its source contracts, enforces tenant and Data Scope predicates, avoids exposing internal storage as a public API, and has an approved performance plan.

### 3.3 Configuration, packs, and extensions

- Client Configuration is finite, structured, tenant-scoped data—not source code or a programming surface.
- Industry packs compose reusable contracts and configuration; they do not become new product layers or fork module engines.
- Client Extensions normally reside in a separate private package/repository and are assembled only into the intended dedicated deployment.
- Co-location of a Client Extension requires explicit governance approval and a top-level isolated extension boundary. It never sits inside Platform Core or a product module's internals.
- Client Extensions remain removable, outside the default release, outside both product-progress denominators, and absent from other clients' deployments.
- Broadly reusable extension behavior is promoted only through explicit product governance, requirement IDs, and roadmap treatment.

### 3.4 Data and migrations

All schema evolution stays in:

```text
apps/api/migrations/
```

A package may declare:

- owned table namespaces;
- approved cross-domain read projections;
- migration IDs owned by its release;
- retention, archival, deactivation, and removal expectations.

A package may not ship or execute a separate migration stream, rewrite historical migrations, run arbitrary SQL from a manifest, or assume production down migrations. Central review preserves global ordering, tenant safety, backup/recovery compatibility, and release identity.

### 3.5 Known transition item

`apps/api/src/modules/service-operations/core/application/service-operations.service.ts` currently imports the legacy `CustomerService` directly. This predates Phase 11A and conflicts with the target rule against cross-module internal imports.

It is a known transitional exception, not an approved pattern, baseline permission for new coupling, or Phase 11A remediation item. A separately authorized change should replace it with a narrow Customer-context application port wired through the composition root.

## 4. Module Manifest v1

### 4.1 Semantics

**Module Manifest v1** is a declarative package inventory and evidence contract.

- `manifestVersion: 1` governs manifest syntax; it is not the package or Kernel version.
- Unknown fields must fail validation once machine validation exists. Tooling must not silently ignore semantics it does not understand.
- Identifiers are stable and collision-checked.
- Contribution values are symbolic registry keys—not import paths, function bodies, commands, SQL, scripts, or a DSL.
- The manifest does not grant authorization and does not trigger arbitrary runtime loading.
- Phase 11A keeps the manifest in this normative Markdown specification; it does not create an executable schema or change `packages/contracts`.

### 4.2 Normative field groups

| Field | Required contract |
|---|---|
| `manifestVersion` | Required integer; exactly `1` for this specification |
| `packageId` | Globally unique stable identifier; immutable after first publication |
| `moduleCode` | Stable deployment module-catalog code where applicable; orchestration/extension packages still declare their owning/related module semantics |
| `name` | Internal administrative package name; client-facing terminology remains tenant configuration |
| `version` | Semantic package version; immutable artifact identity includes version plus digest |
| `classification` | One of `business-core`, `advanced`, `industry-pack`, `orchestration`, `client-extension` |
| `owner` | Product/domain owner and support/escalation responsibility |
| `compatibility.kernel` | Supported Platform Kernel contract version range |
| `compatibility.applicationRelease` | Optional immutable application-release range where Kernel compatibility alone is insufficient |
| `dependencies` | Required and optional package IDs with version ranges; graph must be acyclic |
| `conflicts` | Incompatible packages, versions, or semantic capabilities |
| `exports` | Published ports, event schemas, read models, and semantic capabilities owned by the package |
| `imports` | Required published contract IDs and version ranges; internal file paths are prohibited |
| `contributions` | Symbolic backend API, Web route/navigation, event subscriber, Scheduler handler, document resolver, Integration adapter, configuration/workflow schema, and health registrations |
| `permissions` | Permission codes introduced/required, purpose, sensitive action, and segregation-of-duties notes |
| `configuration` | Typed configuration area and versioned schema IDs, defaults, and required/optional status |
| `events` | Versioned events published/consumed, ownership, idempotency key, and payload sensitivity |
| `dataOwnership` | Owned namespaces/tables, approved read projections, retention, and centrally ordered migration IDs |
| `activation` | Activation scope/prerequisites, dependency behavior, and deactivation support |
| `installation` | Install order, preflight, health assertions, upgrade/deactivation/removal behavior |
| `securityProfile` | Tenant rule, Data Scope strategy, auditable actions, document resolvers, and any declared trusted-call use |
| `validation` | Required static checks, tests, migration/restore evidence, and health evidence |
| `provenance` | Source revision, build identity, artifact digest, signature/attestation reference, and approval record |

### 4.3 Non-executable YAML example

```yaml
manifestVersion: 1
packageId: abixell.business.service-operations
moduleCode: service_operations
name: Service Operations Core
version: 1.0.0
classification: business-core
owner:
  team: service-operations
  supportContact: product-governance
compatibility:
  kernel: ">=1.0.0 <2.0.0"
  applicationRelease: ">=0.1.0 <0.2.0"
dependencies: []
conflicts: []
exports:
  applicationPorts:
    - service-operations.work-order-context.v1
  events:
    - service-operations.work-order-created.v1
  readModels:
    - service-operations.work-order-summary.v1
  capabilities:
    - service-operations.core
imports:
  applicationPorts:
    - platform.workflow.v1
    - platform.configuration.v1
    - customer.customer-context.v1
  events: []
contributions:
  backendApis:
    - service-operations.api.v1
  frontendRoutes:
    - service-operations.routes.v1
  navigation:
    - service-operations.navigation.v1
  eventSubscribers: []
  schedulerHandlers: []
  documentResolvers:
    - service-operations.work-order-document-resolver.v1
  integrationAdapters: []
  configurationSchemas:
    - service-operations.configuration.v1
  workflowSchemas:
    - service-operations.work-order-workflow.v1
  healthChecks:
    - service-operations.health.v1
permissions:
  introduced:
    - code: service_operations.read
      purpose: Read authorized service operations records
      sensitiveAction: false
      segregationOfDuties: null
  required:
    - workflow.instance.act
configuration:
  - area: service-operations
    schema: service-operations.configuration.v1
    required: true
events:
  publishes:
    - contract: service-operations.work-order-created.v1
      idempotencyKey: eventId
      sensitivity: business-reference-only
  consumes: []
dataOwnership:
  tableNamespaces:
    - service_operations_*
  readProjections:
    - customer.customer-context.v1
  retention: preserve-business-history
  migrations:
    - 1763000000000_service_operations_core.cjs
activation:
  scope: tenant
  prerequisites:
    - platform-core
  deactivateSupported: true
  dependencyPolicy: block-when-dependents-active
installation:
  orderAfter:
    - platform-core
  preflight:
    - kernel-compatible
    - contributions-collision-free
  healthAssertions:
    - service-operations.health.v1
  removalPolicy: retain-history-and-migration-records
securityProfile:
  tenantRule: authenticated-actor-tenant
  dataScopeStrategy: hierarchical-and-customer
  auditableActions:
    - service-operations.work-order.mutate
  documentResolvers:
    - service-operations.work-order-document-resolver.v1
  trustedCalls: []
validation:
  staticChecks:
    - contract-compatibility
    - contribution-collisions
  testEvidence:
    - service-operations.integration
  migrationEvidence:
    - central-stream-reviewed
  restoreEvidence:
    - release-backup-compatible
provenance:
  sourceRevision: immutable-source-revision
  buildIdentity: immutable-build-id
  artifactDigest: sha256:approved-artifact-digest
  attestation: approved-attestation-reference
  approvalRecord: approved-release-record
```

The example identifies a future `customer.customer-context.v1` port rather than legitimizing the current direct `CustomerService` import. It is illustrative contract data, not a claim that a manifest or those symbolic registries exist in runtime today.

## 5. Compatibility rules

1. Business Core packages depend on published Kernel contracts, not Kernel internals.
2. Advanced packages require their owning Business Core package and compatible contract versions.
3. Industry packs require their declared base module and typed configuration schemas.
4. Orchestration may consume published ports/events from multiple modules but cannot expose one module's internals to another.
5. Client Extensions consume only published ports, versioned events, controlled Integration contracts, and approved UI/API contribution contracts.
6. Required dependencies must be installed and compatible before installation; dependencies and activation prerequisites must be active/valid before tenant activation.
7. Optional dependencies must declare degraded behavior when absent.
8. Dependency cycles are invalid.
9. Package-ID, module-code, route namespace, permission, event ownership, contribution-symbol, configuration-schema, and table-ownership collisions are invalid.
10. Version compatibility is checked at publication, release assembly, installation, upgrade, and promotion.

## 6. Package states

| State | Meaning |
|---|---|
| **Authored** | Mutable draft; no release identity or production effect |
| **Published** | Immutable approved artifact with version, digest, provenance, and evidence |
| **Installed** | Published artifact is present and healthy in one dedicated deployment |
| **Activated** | An eligible tenant may use an installed package after dependency/policy checks |
| **Configured** | Required tenant-scoped finite configuration validates for the activated version |
| **Deprecated** | Supported transition period with replacement and migration guidance |
| **Deactivated** | Tenant availability/background effects are stopped while retained history remains valid |
| **Removed** | Package runtime is absent after dependency, retention, archive, and recovery rules pass; historical migrations/audit remain |

Installed, activated, configured, and authorized are separate. Activation never substitutes for user permission or Data Scope.

## 7. Package lifecycle

```text
author → classify → review → validate → package → sign / attest
       → publish → install → health-check → tenant-activate
       → upgrade / deprecate → deactivate → remove
```

Every transition records or verifies:

- actor, trust context, reason/reference, and required approval;
- exact source revision, semantic version, artifact digest, and provenance;
- Kernel/application compatibility, dependencies, and conflicts;
- permission, event, route, contribution, and data-ownership collisions;
- tenant, RBAC, Data Scope, document, workflow, audit, and Integration invariants;
- central migration review and backup/restore impact where relevant;
- test and health evidence;
- failure boundary, retry/idempotency behavior, and recovery plan;
- append-only transition audit without sensitive business free text.

### 7.1 Upgrade

Upgrade requires an immutable replacement artifact, compatibility analysis, dependent-package inventory, central migration review, backup/recovery evidence, and health validation. In-place mutation of a published artifact is prohibited.

### 7.2 Deactivation

Deactivation verifies dependent packages, running workflows/jobs, Integration subscriptions, retained records, routes/navigation, and reactivation compatibility. It does not delete business history.

### 7.3 Removal

Removal addresses:

- dependent package and tenant activation state;
- retention/export/archive obligations;
- ongoing workflows, Scheduler jobs, and Integration effects;
- retained namespaced business data and documents;
- audit and immutable artifact evidence;
- future reinstallation/recovery path.

Removal never deletes historical migrations or rewrites completed business history. Destructive data disposal is a separately approved retention/security operation, not the default package removal behavior.

## 8. Current enforcement status

Phase 11B adds a dependency-free repository guard at `scripts/validate-platform-boundaries.mjs`. Run it with:

```text
npm run validate:platform-boundaries
```

The command is part of the root `npm run validate` gate used by CI. It prints every check in a fixed order, distinguishes blocking failures from advisories, reports repository-relative path, line, and reason where applicable, and exits nonzero only when a blocking finding exists.

### 8.1 Blocking checks

| Check | Enforced boundary |
|---|---|
| API imports | Rejects cross-module implementation imports, unapproved non-composition imports into module internals, spread from module-first code into classified legacy business internals, and widened/stale exact exceptions |
| Web imports | Rejects one module importing another module's implementation and permits outside-module composition only in `apps/web/src/App.tsx` |
| Migration discipline | Protects the LF-normalized SHA-256 snapshot of all 24 Phase 11A migrations, rejects unsupported new table declarations, and requires statically provable tenant ownership for every new table |
| Permission discipline | Keeps the catalog migration-owned, enforces strict new declaration/idempotency/down rules, rejects migration-owned role grants, and verifies bounded literal consumers against the catalog |
| Authorization hygiene | Rejects clear actor/user/session authorization based on literal role names; ambiguous role-like comparisons are advisory rather than guessed failures |
| Runtime escape hatches | Rejects high-confidence runtime `eval`/`Function`/VM, nonliteral loading, runtime-loader/editor/script markers, and table/schema DDL in protected product source |

Protected runtime roots are `apps/*/src` and `packages/*/src`, with tests and generated/build/coverage content excluded. Architecture scans never use `docs/`, `scripts/`, `infra/`, migrations, API tests, or Web e2e as evidence of prohibited runtime implementation.

The one legacy Service Operations → `CustomerService` dependency and the eight current route → composition-root `Container` type imports are centralized, exact, type-only, symbol-checked, and usage-counted. They are transition evidence, not wildcard suppressions. A missing, duplicated, widened, aliased, value-level, or retargeted edge fails validation. The Reporting Insight money formatter is now module-neutral under `apps/web/src/shared/format.ts`; no Web exception exists.

Historical migrations are append-only through an immutable Phase 11A filename/digest snapshot. New tables must have either:

1. non-null `tenant_id` → `tenants(id)` ownership with cascading delete;
2. an exact reviewed root/global/system classification added to the validator; or
3. an adjacent `platform-boundary: tenant-owner-via <column> -> <parent>` annotation whose non-null cascading UUID foreign key is verified and whose parent chain resolves acyclically to direct tenant ownership.

The exact historical inherited-owner classifications remain baseline evidence, not precedent for an unreviewed exemption. The canonical count remains 84 application-created tables plus framework-owned `pgmigrations` = 85.

### 8.2 Advisory and future checks

Module Manifest v1 readiness is deliberately advisory. The validator always states that manifests are not required, parsed, loaded, or evidence of runtime plugin/package support. The advisory does not affect exit status.

The guard does not claim to prove semantic tenant predicates in queries, RBAC or Data Scope behavior, document parent authorization, workflow safety, event compatibility, package contribution collisions, or reporting-read-model correctness. It does not implement manifests, package installation, Builder ingestion, a safety compiler, runtime loading, or an independent schema mechanism. Those require separately authorized typed contracts and semantic validators.

### 8.3 Low-noise policy

Only statically provable, bounded patterns are blocking. Dynamic permission expressions remain valid; ambiguous role-like usage stays advisory; normal SQL queries are not scanned; comments and harmless descriptive strings do not trigger runtime findings. When a legitimate construct is not understood, narrow or extend the parser with focused tests rather than introducing a broad path or wildcard suppression.
