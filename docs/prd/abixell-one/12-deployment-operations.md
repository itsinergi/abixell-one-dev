# 12 — Deployment & Operations Requirements (`OPS-*`)

**PRD v1.0** · Canonical · Classification: **Platform Core / Platform Hardening**

Requirements here are **platform**, never business capability. They gate pilot and production readiness and are tracked on the Platform Hardening roadmap track.

## Deployment model

| ID | Requirement | Status |
|---|---|---|
| **OPS-001** | **Dedicated deployment per client**, on a multi-tenant-ready architecture. | DELIVERED |
| **OPS-002** | A deployment shall be composable: Platform Core + selected Business Core modules + selected Advanced + configuration + optional extensions. | DELIVERED |
| **OPS-003** | Environment configuration shall be externalised; no client-specific values in source. | DELIVERED |
| **OPS-004** | Database schema shall evolve through an ordered, rollback-safe migration stream. | DELIVERED |
| **OPS-005** | Migrations shall be idempotent on re-run and shall never rewrite approved historical migrations. | DELIVERED |

### Core-first installation and package lifecycle

Deployment composition has ordered states:

1. install and health-check the complete mandatory Platform Core/Kernel base;
2. install compatible immutable package artifacts through explicit static composition and the single migration stream;
3. activate eligible installed packages per tenant;
4. validate tenant configuration and actor authorization separately.

A future Windows/Linux/macOS “one-click” installer is a guided, resumable wrapper over the existing production-safe lifecycle—not a replacement for immutable releases, environment validation, backup/quiescing, ordered migrations, permission synchronization, health, smoke, bootstrap, and recovery gates. No cross-platform runtime installer or desktop wrapper is delivered by Phase 11A. See the [installation direction](../../architecture/one-click-platform-installation.md) and [package lifecycle contract](../../architecture/module-extension-contracts.md).

## Pilot readiness gate

| ID | Requirement | Status |
|---|---|---|
| **OPS-010** | **Continuous integration.** Lint, typecheck, build, and the full test suite shall run automatically on every change. | DELIVERED |
| **OPS-011** | **Origin allowlist.** Cross-origin access shall be restricted to the client's known frontend origins. | DELIVERED |
| **OPS-012** | **Rate limits tuned** against real pilot traffic rather than provisional defaults. | DELIVERED |
| **OPS-013** | **No pathological queries** on operational list endpoints at pilot data volume. | DELIVERED |
| **OPS-014** | **Dependency advisories** affecting runtime shall be assessed and remediated. | DELIVERED |
| **OPS-015** | **Installable client experience** (complete PWA asset set) across supported browsers. | DELIVERED |

## Production readiness gate

| ID | Requirement | Status |
|---|---|---|
| **OPS-020** | **Backup, restore, and disaster recovery** shall be documented and tested. | DELIVERED |
| **OPS-021** | **Deployment & environment provisioning** shall be repeatable and automated. | DELIVERED |
| **OPS-022** | **Integration reconciliation** shall recover interrupted automation without duplicate effects. | DELIVERED |
| **OPS-023** | **Operational monitoring** shall surface health, error rates, and failed automations. | DELIVERED |

## Production Gate evidence

- **OPS-020 / PH-3:** PostgreSQL custom-format backup plus document-volume archive, SHA-256 manifest, migration-head recording, fresh-target restore refusal, archive/checksum verification, representative restored-document checksum, default RPO/RTO assumptions, and documented rollback/incident handling. Compose operations run on the internal database network without publishing PostgreSQL.
- **OPS-021 / PH-4:** separate immutable API runtime/operations images, unprivileged Web runtime, generic dedicated-deployment Compose topology, protected environment validation, ordered pull/migrate/permission-sync/start/health/smoke automation, non-secret release evidence, and forward-only rollback policy.
- **OPS-022 / PH-8:** Tenant-scoped durable Integration outbox reconciliation with database uniqueness, `SKIP LOCKED` claims, persisted retry/terminal states, stale-claim recovery, transactional completion/logging, and concurrent-worker tests proving no duplicate logged effect.
- **OPS-023:** `/health`, `/health/db`, `/healthz`, Scheduler run history, aggregate worker result summaries, Integration log failures, and terminal outbox state provide the approved Production Gate surface. Provider-level infrastructure metrics and alert routing remain deployment-operations responsibilities rather than new product capability.

## Operability requirements

| ID | Requirement | Status |
|---|---|---|
| **OPS-030** | Every request shall be correlatable end-to-end through a request identifier. | DELIVERED |
| **OPS-031** | Failed notifications, integrations, and automations shall be inspectable with reason and timestamp. | DELIVERED |
| **OPS-032** | Scheduled platform jobs shall record run history and failures. | DELIVERED |
| **OPS-033** | The platform shall expose a health endpoint suitable for infrastructure probes. | DELIVERED |

## Rule

| ID | Rule |
|---|---|
| **OPS-R1** | Platform Hardening shall never be counted as business capability, and shall never be mixed into a business module's progress. |
| **OPS-R2** | Pilot cannot be declared while any Pilot-gate requirement is outstanding, regardless of feature completeness. |
