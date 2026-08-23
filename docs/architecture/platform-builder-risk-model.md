# Platform Builder Risk Model

| | |
|---|---|
| **Document Status** | APPROVED TARGET ARCHITECTURE |
| **Authority** | Founder-authorized Phase 11A; subordinate to the canonical PRD and Product Blueprint |
| **Date** | 2026-08-23 |
| **Scope** | Safety classification and lifecycle for future metadata-driven production editing |
| **Related** | [Platform Kernel](platform-kernel.md) · [Module Contracts](module-extension-contracts.md) · [Dual Admin](dual-admin-console.md) · [ADR-0014](../adr/0014-platform-kernel-static-packages-and-governed-builder.md) |

## 1. Purpose

The future Abixell One Platform Builder is a governed editor for a **finite, typed metamodel**. It is not a general low-code programming environment.

This risk model prevents convenience from bypassing tenant isolation, RBAC, Data Scope, document authorization, workflow governance, append-only audit, Integration boundaries, or migration and recovery discipline.

Phase 11A defines the model only. It does not implement Builder storage, UI, APIs, compilers, simulation, publication, or rollback.

## 2. Risk classes

Every proposed change receives the highest applicable class. Splitting one logical change into smaller artifacts does not lower its class.

| Class | Meaning and examples | Minimum treatment |
|---|---|---|
| **B0 — Preview only** | Draft layout, metadata diff, documentation preview, non-persisted simulation view | No production effect; typed validation; draft attribution and audit |
| **B1 — Reversible presentation/configuration** | Terminology, labels, presentation-safe reference data, notification content | Typed/semantic validation; authorized publisher; immutable version; audit; tested rollback |
| **B2 — Business behavior** | Workflow transitions, SLA and assignment policy, finite validation policy, module activation, form behavior affecting business processing | Dependency and security-impact validation; isolated simulation; blast-radius report; separate approval; atomic publish; observation and rollback |
| **B3 — Structural/release-bound** | Persistence-affecting entity/field metadata, permission catalog changes, Integration adapters, package installation, migration-backed change | Staging; engineering plus security/data review; signed immutable release; central migration pipeline; backup/recovery plan; deployment approval and window |
| **B4 — Prohibited** | Arbitrary SQL/query editor, scripts or expression DSL, runtime code injection, direct production schema or table editing, authorization bypass, cross-tenant mutation | Reject. It cannot be approved, published, or downgraded through the Builder |

A visual representation does not change the class. For example, drawing a workflow is B2 if it changes executable business behavior; a form that introduces persistence is B3 even if authored by drag-and-drop.

## 3. Mandatory lifecycle

```text
draft
  → validate
  → simulate / impact analysis
  → review
  → approve
  → publish
  → audit / observe
  → rollback, deprecate, or supersede
```

No draft has production effect. Published versions are immutable; a correction creates a new version.

### 3.1 Draft

- Assign stable artifact identity, base version, author, target scope, and optimistic-concurrency token.
- Classify the change B0–B4 before it enters approval.
- Reject B4 content at ingestion, including hidden commands, SQL, scripts, and executable expressions.

### 3.2 Validate

Validation is layered and deterministic:

1. syntax and typed-schema validation;
2. referential integrity and finite-enum/operator checks;
3. package dependency, compatibility, ownership, and collision checks;
4. tenant-isolation analysis;
5. permission and segregation-of-duties analysis;
6. Data Scope and audience analysis;
7. document parent-authorization analysis;
8. workflow lifecycle, reachability, assignment, and approval analysis;
9. Integration idempotency, sensitivity, and retry-boundary analysis;
10. audit coverage and redaction analysis;
11. migration, backup, restore, and deployment impact for B3.

A validator never treats menu hiding or client-side conditions as security evidence.

### 3.3 Simulate and report impact

Simulation runs in an isolated, side-effect-free environment or approved non-production snapshot. It cannot call real external endpoints, mutate production data, send notifications, or obtain unrestricted production credentials.

The result includes:

- human-readable before/after diff;
- affected packages, contracts, routes, permissions, roles, scopes, workflows, entity types, reports, integrations, and tenants;
- compatibility and dependency outcomes;
- expected data/migration impact;
- security findings and unresolved warnings;
- rollback classification and limits;
- representative scenarios and results.

Warnings that affect authorization, data loss, tenant isolation, schema compatibility, or irreversible behavior block approval; they cannot be accepted as cosmetic risk.

### 3.4 Review and approve

Approval policy is derived from risk class and target environment:

- B0 requires draft attribution and validator success.
- B1 requires an authorized publisher distinct from the author where policy requires.
- B2 requires maker-checker separation plus the relevant business/process owner.
- B3 requires maker-checker separation, Platform Architect/engineering review, security and data review, and target deployment approval.
- No person may approve their own high-risk artifact solely by holding multiple roles.

Approvals bind to the exact artifact digest and simulation/validation evidence. Any change invalidates prior approvals.

### 3.5 Publish

- Publish a new immutable version atomically; never mutate a published version in place.
- Verify artifact digest, provenance, approvals, compatibility, and target scope at publication time.
- Publication to an artifact catalog is distinct from installation in a deployment, tenant activation, and tenant configuration.
- Production publication never executes arbitrary code supplied in metadata.

### 3.6 Audit and observe

Append-only lifecycle audit records:

- actor and explicit trust context;
- reason/reference ID without sensitive free text;
- base and published versions;
- artifact digest and risk class;
- validation and simulation evidence identifiers/results;
- approvers and segregation-of-duties result;
- target deployment/environment/tenant where applicable;
- publication, installation, activation, and observation outcome.

Post-publish observation uses declared health and behavior signals. Failed health gates stop promotion and invoke the approved recovery path.

### 3.7 Roll back, deprecate, or supersede

- Metadata rollback publishes or reactivates an earlier compatible immutable version; it never rewrites completed business history.
- Workflow-version rollback applies to new workflow instances unless a separately reviewed migration governs existing instances.
- Permission rollback re-evaluates roles and effective grants to prevent accidental over-grant or operational lockout.
- Module-activation rollback re-evaluates dependencies, retained data, routes, background jobs, and integration effects.
- B3 structural changes do not run automatic down migrations. Use approved forward repair or restore a matching backup and immutable release.
- If safe reversal is impossible, deprecate and supersede with an explicit remediation plan rather than claiming rollback support.

## 4. Future finite metamodel

The allowed direction is a versioned finite schema covering only approved concepts:

- typed entities and fields;
- finite relationship types and cardinalities;
- typed forms, lists, and views;
- approved validation operators with typed operands;
- finite workflow actions and transition conditions;
- assignment and approval policy from approved primitives;
- terminology and navigation contributions;
- semantic report fields, filters, groupings, and aggregates;
- approved Integration mapping fields over controlled adapters;
- package dependencies, compatibility, and activation prerequisites.

The metamodel may reference published application ports and symbolic registry keys. It may not contain import paths, function bodies, operating-system commands, executable source, SQL, or a general expression language.

## 5. Reporting and query safety

Future Builder-defined reports operate over approved semantic fields or reviewed read models. Every source declares:

- owning module and contract version;
- tenant predicate supplied by the server, not the author;
- Data Scope/audience predicate;
- allowed fields, filters, grouping, and aggregate operations;
- sensitivity and export controls;
- performance limits and pagination.

The Builder does not expose raw table selection, free-form joins, free-form SQL, or a generic query console.

## 6. Safety compilers

Before implementation, separately authorized requirements must define deterministic compilers/validators for:

- tenant ownership;
- permissions and segregation of duties;
- Data Scope and audience;
- document/entity authorization;
- workflow reachability and assignment;
- package compatibility and contribution collisions;
- audit and metadata-sensitivity policy;
- migration/deployment/recovery impact.

These compilers fail closed. They are not implemented or represented as existing by Phase 11A.

## 7. Prohibited work

The following remain prohibited regardless of operator seniority or approval count:

- arbitrary SQL or database query execution;
- arbitrary scripts, code, formulas, or expression DSLs;
- direct production schema or domain-table editing;
- runtime code injection or unreviewed plugin loading;
- bypass of tenant, permission, Data Scope, document, workflow, or audit controls;
- cross-deployment business-data access through architect authority;
- secrets embedded in artifacts, manifests, audit, or source;
- automatic production down migrations.
