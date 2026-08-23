# One-Click Platform Installation Direction

| | |
|---|---|
| **Document Status** | APPROVED TARGET ARCHITECTURE |
| **Authority** | Founder-authorized Phase 11A; subordinate to the canonical PRD and Product Blueprint |
| **Date** | 2026-08-23 |
| **Scope** | Future guided installation for Windows, Linux, and macOS |
| **Related** | [Deployment PRD](../prd/abixell-one/12-deployment-operations.md) · [Platform Kernel](platform-kernel.md) · [Module Contracts](module-extension-contracts.md) · [ADR-0014](../adr/0014-platform-kernel-static-packages-and-governed-builder.md) |

## 1. Purpose

“One click” means a guided, resumable installer that orchestrates existing production-safe gates with clear progress and recovery. It does not mean bypassing environment validation, immutable releases, backup, migration, permission synchronization, health checks, security review, or restore discipline.

No repository-owned Windows/Linux/macOS one-click runtime installer exists today. Phase 11A defines direction only and does not add installer code or claim installer delivery.

## 2. Keep installation experiences distinct

| Experience | Meaning | Current state |
|---|---|---|
| Responsive browser application | Primary PC, laptop, Android, and iOS client | Exists |
| Browser-installed PWA | Installs the Web application shell through a supported browser | Exists; not infrastructure installation |
| Local demo/developer launcher | Starts a local evaluation/development environment | Separate from production installation |
| Production Compose automation | Validated dedicated deployment, migration, health, smoke, backup, and recovery operations | Exists |
| Cross-platform one-click installer | Future OS-specific wrapper around the common production installation contract | Not implemented |
| Native desktop wrapper | Optional future thin client to the dedicated deployment | Not implemented and not required |

These terms are not interchangeable. PWA installability does not install PostgreSQL or the Abixell One server runtime.

## 3. Installation principles

- Preserve dedicated deployment per client and multi-tenant-ready internals.
- Install the complete mandatory Platform Core/Kernel base first.
- Use immutable release identities and verified artifact digests/signatures; do not build source or use mutable tags on a production host.
- Store production credentials only in protected environment/secret facilities, never in source, manifests, logs, command arguments where avoidable, or installation evidence.
- Use one globally ordered migration stream.
- Treat package installation, tenant activation, and tenant configuration as separate post-Core states.
- Keep every step idempotent or explicitly resumable with a safe failure boundary.
- Do not delete data during uninstall by default.
- Never use automatic down migrations as the production rollback mechanism.

## 4. Common installer lifecycle

### 4.1 Preflight

Validate before changing the host:

- supported Windows, Linux, or macOS version and CPU architecture;
- supported container/runtime prerequisites and service-management capabilities;
- CPU, memory, storage, filesystem, backup capacity, ports, DNS, and TLS prerequisites;
- outbound registry access and required ingress topology;
- protected locations for secrets, deployment state, documents, and backups;
- selected environment, region/data-residency constraints, and deployment identifier;
- release manifest, signature/attestation, and immutable image digests;
- existing deployment detection and operator-selected install-versus-upgrade path.

A failed preflight makes no production data or schema change.

### 4.2 Acquire immutable Core Platform release

Acquire and verify:

- Platform Kernel and mandatory Platform Core release identity;
- immutable API operations image;
- immutable API runtime image;
- immutable Web image;
- approved PostgreSQL image reference;
- release compatibility and migration head metadata.

The installer records digests, not credentials. It refuses mutable/unapproved production release references.

### 4.3 Provision deployment-local resources

Provision or validate:

- deployment-specific environment configuration;
- database and document storage;
- internal networks and approved ingress;
- protected deployment-state and backup directories;
- least-privilege runtime identities and file permissions.

No client-specific value is written into Product Core source.

### 4.4 Validate rendered environment

Validate:

- complete environment values and secret presence without printing secrets;
- allowed origins, hostnames, proxy/TLS assumptions, and network topology;
- immutable image references and matching release identity;
- empty versus existing database/document state;
- backup and restore prerequisites;
- compatibility between installer, Core release, database, and existing state.

### 4.5 Install or upgrade Core Platform

The common contract preserves the order implemented by `infra/deployment/deploy.mjs`:

1. validate the deployment environment;
2. acquire/pull immutable operational and runtime artifacts;
3. start and health-check PostgreSQL;
4. if application tables exist, quiesce API/Web and take the required pre-migration backup;
5. run the single ordered migration stream;
6. synchronize full-access-role permissions additively while leaving curated roles unchanged;
7. start API and Web/PWA services;
8. wait for health checks;
9. run release smoke validation;
10. record non-secret successful release state.

The installer adds presentation and resumability around this lifecycle; it does not reorder or weaken it.

### 4.6 Bootstrap first tenant and administrator

For a new deployment:

- create the first tenant through the one-time protected bootstrap mechanism;
- provision the first administrator through an approved secure path;
- rotate or disable bootstrap authority after successful initialization;
- choose an empty production baseline or an explicitly approved reference-data baseline;
- prohibit demo seed in staging and production;
- record bootstrap completion without storing the bootstrap secret.

The bootstrap key is not a general superuser credential and never grants cross-deployment business-data access.

### 4.7 Verify and record

Verify and retain non-secret evidence for:

- release identity and migration head;
- API/Web health and authentication;
- representative authorized read behavior;
- document storage and parent authorization;
- Scheduler ownership/run visibility;
- backup creation and applicable restore evidence;
- deployment smoke result and timestamp.

Sensitive records, passwords, tokens, document contents, and free-text business data are excluded from installation evidence.

### 4.8 Install packages only after Core is healthy

For each selected Business Core, Advanced, industry-pack, orchestration, or Client Extension artifact:

1. verify immutable identity, provenance, and approval;
2. validate Module Manifest version and Kernel/application compatibility;
3. resolve required/optional dependencies and conflicts;
4. verify contribution, permission, event, route, and data-ownership collisions;
5. review any centrally owned migrations through the Core migration pipeline;
6. install the package through explicit static composition/release assembly; this may require deploying a new immutable application image that includes the reviewed package rather than loading code into the running process;
7. rerun declared package and platform health checks;
8. record deployment installation state;
9. separately activate eligible packages per tenant;
10. apply and validate tenant configuration only after activation prerequisites pass.

A manifest does not cause arbitrary code loading on the production host. “After Core is healthy” is a lifecycle precondition, not a dynamic-plugin promise: a package-bearing immutable release still reuses the same Core-first startup, migration, health, and recovery gates.

### 4.9 Upgrade and recovery

- Retain validate → acquire → quiesce → backup → migrate → permission sync → start → health → smoke order.
- Never update a production release in place without immutable prior/replacement identities.
- Roll back an image only where image/schema compatibility is proven.
- Otherwise restore a matching backup/release set or apply an approved forward repair.
- Structural rollback never automatically invokes down migrations.
- A failed package install cannot silently mark a package activated.
- Recovery preserves append-only audit and business history.

### 4.10 Uninstall

An uninstall workflow:

- stops runtime services safely;
- preserves database, documents, backups, audit, and deployment state by default;
- requires a separate explicit destructive-data procedure, outside one-click defaults;
- removes host service adapters only after recording the retained data locations and recovery path.

## 5. OS-specific adapters

Windows, Linux, and macOS adapters may differ in prerequisite installation, protected-secret storage, service startup, filesystem permissions, firewall prompts, and user experience. They all call the same common lifecycle and produce equivalent release/health evidence.

An OS adapter may not:

- embed production secrets in generated source or logs;
- use a different migration stream;
- silently weaken TLS, origin, tenant, or authorization controls;
- seed demo data in production;
- bypass backup or health gates;
- invent a separate business database.

## 6. Web/PWA and optional desktop direction

Responsive Web/PWA remains primary across desktop and mobile operating systems. The service worker continues to cache only application-shell/static assets; business data and API responses remain online and backend-authorized.

A future desktop wrapper, if separately approved, is thin:

- it connects over TLS to the dedicated deployment;
- it uses the same identity, RBAC, Data Scope, API, audit, and document controls;
- it does not embed or synchronize a separate business database;
- it does not cache API data or queue offline business writes;
- it does not expose installer or Platform Architect authority to ordinary users.

## 7. Phase 11A non-goals

This phase does not implement a native installer, host agent, desktop wrapper, package loader, deployment catalog, remote control plane, new bootstrap mechanism, or client-specific deployment customization. It does not alter Phase H2 deployment, backup, restore, or outbox behavior.
