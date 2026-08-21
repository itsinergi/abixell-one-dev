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
| **OPS-020** | **Backup, restore, and disaster recovery** shall be documented and tested. | PLANNED |
| **OPS-021** | **Deployment & environment provisioning** shall be repeatable and automated. | PLANNED |
| **OPS-022** | **Integration reconciliation** shall recover interrupted automation without duplicate effects. | PLANNED |
| **OPS-023** | **Operational monitoring** shall surface health, error rates, and failed automations. | PARTIAL |

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
