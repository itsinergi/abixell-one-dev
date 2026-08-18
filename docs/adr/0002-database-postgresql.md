# ADR-0002: Primary Database — PostgreSQL

- **Status:** APPROVED / BINDING
- **Date:** 2026-08-18
- **Owner:** Founder (Insting Tekno Sinergi)
- **Source:** `01-FOUNDER-DECISION-PRE-PHASE-0.md`,
  `12-FOUNDER-DECISION-PHASE-0-IMPLEMENTATION.md`,
  `09-Technical-Stack-Infrastructure-Recommendation.md`

## Context

The platform needs tenant readiness, organization scope enforcement,
transaction consistency, auditability, extensibility (Client Extension via
JSON/JSONB), reporting, and future scale — while deployment is Dedicated
per Client (ADR/Founder Decision 1) with an architecture that stays
multi-tenant-ready.

## Decision

PostgreSQL is the **binding primary database** for Abixell One.

- Migration-as-code: schema changes only via versioned migration files in
  git, never manual/UI sync (lesson carried over from iDempiere research,
  `21-lessons-for-icos.md`).
- Row-Level Security (RLS) is **evaluated per data scope that genuinely
  needs additional isolation** (e.g. a future shared-hosting / non-dedicated
  tenant mode) — RLS is a defense-in-depth addition, **not a replacement**
  for application-level authorization (RBAC + Data Scope, see
  `02-Identity-Security-RBAC-Foundation.md`). Phase 0 does not activate RLS
  by default because deployment is dedicated-per-client (single Tenant per
  deployment); the schema still carries `tenant_id` as a discriminator on
  every scoped table so RLS can be switched on later without a redesign.
- `custom_fields JSONB` columns (validated against a schema registry) are
  the mechanism for Client Extension, per `02-Identity-Security-RBAC-Foundation.md`.

## Implementation-level default (documented, not Founder-blocking)

Migration/ORM tool: originally attempted with **Prisma**, but Prisma's
`prisma generate`/`migrate` require downloading a native query-engine
binary from `binaries.prisma.sh` at install/build time. This download is
blocked by the outbound network allowlist of the cloud implementation
workspace used for Checkpoint 0A (`403 Forbidden`), so Prisma cannot be
verified to run in this environment.

**Revised default:** `pg` (node-postgres) for the query/connection layer +
`node-pg-migrate` for versioned, plain-SQL migrations. Both are pure
JavaScript/TypeScript with no native binary fetch step, so they work in any
network-restricted environment and give direct control over raw SQL — which
also makes future RLS policies (`CREATE POLICY ...`) straightforward to
express as ordinary migrations, without fighting an ORM's abstraction.
This does not change the core decision (PostgreSQL); it only changes the
tool used to talk to it. If a future environment has unrestricted network
access and the team prefers Prisma's DX, this can be revisited via a new
ADR — it is not a Founder-blocking choice either way.

## Consequences

- Local dev: PostgreSQL via Docker Compose (`infra/postgres/docker-compose.yml`).
- Every tenant-scoped table includes `tenant_id`, `created_by`, `created_at`,
  `updated_by`, `updated_at`, `deleted_by`, `deleted_at` (soft delete) per
  the Audit-First Design in `02-Identity-Security-RBAC-Foundation.md`.
