# Dual Admin Console Architecture

| | |
|---|---|
| **Document Status** | APPROVED TARGET ARCHITECTURE |
| **Authority** | Founder-authorized Phase 11A; subordinate to the canonical PRD and Product Blueprint |
| **Date** | 2026-08-23 |
| **Scope** | Business Admin and future Platform Architect / Builder trust boundaries |
| **Related** | [Platform Kernel](platform-kernel.md) · [Builder Risk Model](platform-builder-risk-model.md) · [Module Contracts](module-extension-contracts.md) · [ADR-0014](../adr/0014-platform-kernel-static-packages-and-governed-builder.md) |

## 1. Purpose

Abixell One requires two administration responsibilities with different risk and authority. They must not be collapsed into a single omnipotent role.

1. **Business Admin Console** — deployment-local, tenant-scoped administration of users and finite business configuration.
2. **Platform Architect / Builder Console** — a future, higher-risk surface for versioned artifacts, simulation, approval, publication, promotion, and rollback.

This document defines target trust boundaries. Phase 11A does not implement a new console, API, identity plane, package runtime, or remote control plane.

## 2. Shared security principles

- Dedicated deployment per client remains the deployment model.
- Every action has an explicit actor, target deployment, tenant context where applicable, purpose, authorization result, and append-only audit record.
- Permission and Data Scope are backend-enforced. UI visibility is never an authorization boundary.
- Holding multiple duties does not silently merge privileges. The operator explicitly enters one context at a time.
- No role receives ambient access to other deployments or tenants.
- No administration plane bypasses tenant ownership, domain eligibility, document authorization, workflow governance, migration discipline, or Integration controls.
- Sensitive business free text and secrets are not copied into artifact or lifecycle audit metadata.

## 3. Business Admin Console

### 3.1 Trust boundary

The Business Admin Console lives inside each dedicated Abixell One deployment. It uses that deployment's tenant authentication, RBAC, Data Scope, session controls, and audit.

Existing Administration and Configuration screens are the foundation for this direction. They are not represented as a complete Business Admin Console.

### 3.2 Intended responsibilities

Subject to explicit permissions and Data Scope, it may administer:

- users, deployment-local tenant roles, and role assignments;
- organization hierarchy and authorized scope assignments;
- role-to-permission composition from the published permission catalog;
- terminology and presentation-safe branding configuration;
- reference data and numbering;
- notification templates;
- finite workflow definitions and approval matrices within approved schemas;
- feature flags and tenant module activation where policy permits;
- tenant configuration validation and version history;
- audit exploration and deployment-local operational health views.

### 3.3 Prohibited authority

It cannot:

- install, replace, sign, or publish package artifacts;
- mutate Platform Kernel contracts or Product Core internals;
- create or execute migrations or edit database schemas;
- run SQL, scripts, or arbitrary expressions;
- bypass permissions, Data Scope, workflow rules, or document authorization;
- gain access to another tenant or dedicated deployment;
- publish arbitrary Builder code;
- use the one-time platform bootstrap authority as a general administration credential.

## 4. Platform Architect / Builder Console

### 4.1 Trust boundary

The Platform Architect / Builder Console is a future higher-risk operator surface for design-time and release-time artifacts. Its operator identity, session, authorization context, and audit trail are distinct from tenant business administration.

It is **not** a universal business-data superuser. Architect status alone grants no right to browse or mutate tenant business records.

### 4.2 Intended responsibilities

Future, separately authorized capabilities may include:

- typed metadata and package-manifest authoring;
- form, list, view, navigation, finite validation, and workflow design within approved schemas;
- semantic report/view definitions over approved read models;
- Integration mapping declarations over controlled adapters;
- compatibility and dependency analysis;
- metadata/package import and export;
- isolated simulation and blast-radius analysis;
- maker-checker review and approval;
- immutable artifact publication and environment promotion;
- observation, deprecation, rollback, or supersession.

All changes follow the [Builder risk model](platform-builder-risk-model.md). Structural and release-bound work does not become safe merely because it is represented as metadata.

### 4.3 Deployment operation grant

A future production-affecting operation requires all of:

1. an explicit target deployment and environment;
2. an approved immutable artifact identified by digest;
3. compatibility and security evidence;
4. deployment-local authorization by an eligible operator/approver;
5. a narrowly scoped, expiring operation grant bound to artifact, action, target, and time window;
6. deployment-local audit and result evidence;
7. recovery or rollback instructions appropriate to the risk class.

The operation grant is not reusable bootstrap authority and does not create unrestricted database credentials.

### 4.4 Central artifact catalog boundary

A future central catalog may store:

- manifest and metadata schemas;
- immutable signed artifacts and digests;
- compatibility declarations;
- validation and simulation evidence;
- approvals, promotion records, and release status.

It may not store:

- tenant business records or business-document contents;
- tenant secrets or long-lived deployment credentials;
- unrestricted database credentials;
- an ambient session capable of querying client deployments;
- arbitrary executable scripts or SQL.

It has no direct database access to client deployments. Deployment interaction, if later authorized, uses a narrow authenticated installation/promotion contract and deployment-local controls.

## 5. Context separation

A person may hold both business and architect responsibilities, but the system treats those responsibilities separately:

- explicit context selection;
- separate authorization evaluation;
- separate session/audience where implemented;
- clear visual indication of target deployment/environment/tenant;
- no inherited architect privilege while acting as Business Admin;
- no inherited tenant-data privilege while acting as Platform Architect;
- maker-checker rules still apply, including prohibiting self-approval where required.

Emergency access, if ever introduced, requires separate requirements, time-bounded approval, reason capture, prominent monitoring, and immutable audit. It is not implied by this architecture.

## 6. Authority matrix

| Operation | Business Admin | Platform Architect / Builder | Deployment approver / operator | Kernel/runtime |
|---|---|---|---|---|
| Design tenant terminology/reference data | Yes, with tenant permission | May define the allowed schema, not tenant values by default | No | Validates schema, tenant, permission, and audit |
| Design package or structural metadata | No | Yes, in draft | No | No production effect |
| Validate and simulate artifact | May preview authorized tenant configuration | Yes | May review evidence | Executes bounded validators/simulation only |
| Approve B1 tenant configuration | Authorized maker/checker roles | Not required unless policy says so | No | Enforces policy and audit |
| Approve B2/B3 artifact | May supply tenant/business approval | Required architect/security/data reviewers by policy | Required for target production deployment | Verifies approvals and immutable identity |
| Publish immutable artifact to catalog | No | Authorized publisher, never arbitrary code | No | Records digest and provenance |
| Install package in a deployment | No | Cannot do so through ambient authority | Yes, using scoped operation grant | Enforces compatibility, migration, health, and audit |
| Activate installed package for tenant | Yes, only with explicit activation permission and satisfied dependencies | No ambient tenant authority | May be required by deployment policy | Re-evaluates effective availability |
| Roll back metadata/package | May request/approve tenant-safe rollback | Designs/selects approved artifact | Executes production rollback | Enforces history, compatibility, and recovery limits |
| View tenant business data | Only as granted by tenant permission and Data Scope | No, by architect status alone | No, by deployment-operator status alone | Enforces tenant authorization |

## 7. Audit and approval evidence

Every artifact lifecycle or administration mutation records, without leaking sensitive free text:

- actor and active trust context;
- target deployment/environment and tenant where applicable;
- reason/reference identifier;
- base and proposed immutable versions;
- artifact digest;
- risk class;
- validation and simulation result identifiers;
- approvals and segregation-of-duties result;
- operation grant identity and expiry where applicable;
- publication/activation/rollback outcome.

## 8. Current state and non-goals

Current administration is part of the shared Web application and is incomplete across configuration areas. Phase 11A defines its safe evolution only.

No Builder Console, Builder API, new architect identity, cross-deployment catalog, operation grant system, package installer, deployment agent, or remote control plane is delivered by this phase. No unsafe cross-deployment superuser is implied or authorized.
