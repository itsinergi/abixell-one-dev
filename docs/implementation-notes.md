# Implementation Notes — Checkpoint 0A: Project Bootstrap

**Status: COMPLETE**
**Date: 2026-08-18**

## What was built

- Git repository initialized at the monorepo root with npm workspaces:
  `apps/api`, `apps/web`, `packages/contracts`.
- `apps/api`: Fastify + TypeScript backend. Hexagonal-style folders
  (`domain/`, `application/`, `infrastructure/`, `interfaces/http/`) created
  but intentionally empty of business logic — Checkpoint 0A is
  connectivity-only, no domain models yet (see ADR-0002 and
  `03-Core-Data-Foundation.md` — domain entities start Checkpoint 0B).
- `apps/web`: React + Vite + TypeScript + Tailwind. `ApplicationShell`
  component matches the shell regions from
  `08-Application-Shell-Design-System-Foundation.md` (Navigation +
  placeholder content area implemented; Dashboard/Workspace/Module/
  Transaction/Approval/Reporting/Administration regions are labeled as
  future-checkpoint placeholders in the nav, not yet functional).
- `infra/postgres/docker-compose.yml`: local PostgreSQL 16 for
  environments with a Docker daemon.
- Migration pipeline: `node-pg-migrate`, one migration applied
  (`pgcrypto` extension) proving the pipeline works against a real
  database, not just in theory.
- End-to-end vertical slice proven: `apps/web` (Vite dev server) →
  `/api/*` proxy → `apps/api` (Fastify) → PostgreSQL, via `/health` and
  `/health/db` endpoints. This mirrors the Database → Domain → Application
  Service → API → Frontend chain required before extending the foundation
  (per the Execution Protocol's vertical-slice instruction), minus
  Authentication/Authorization/Audit, which are Checkpoint 0B's job.
- Quality gates run and passing: `typecheck`, `lint`, `test` (1 passing
  test) for both `apps/api` and `apps/web`; production `build` succeeds
  for both.
- Three ADRs recorded: backend stack (binding), database (binding, with a
  documented implementation pivot from Prisma to pg/node-pg-migrate), and
  the technical enforcement mechanism for the "no whitelabel client-facing
  strings" rule.

## Known limitations / gaps at end of Checkpoint 0A

- No CI/CD pipeline wired yet (no remote git host configured in this
  session). Local quality gates (lint/typecheck/test/build) all pass and
  are ready to be wrapped in a CI workflow once a host (GitHub/GitLab) is
  chosen.
- No Docker daemon available in this implementation workspace to validate
  `infra/postgres/docker-compose.yml` directly; connectivity was instead
  proven against the sandbox's native PostgreSQL service. The compose file
  itself is standard and should be validated in a normal dev machine/CI
  environment before being treated as fully proven.
- No authentication, RBAC, tenant/org data, or audit trail yet — by design,
  these are Checkpoint 0B.
- Design System visual tokens (colors beyond Tailwind defaults, typography
  scale) not yet defined — deferred until real Branding Configuration
  exists (Checkpoint 0C), to avoid designing against an assumed client.

## Readiness for Checkpoint 0B

Foundation is stable enough to start the Identity & Organization Vertical
Slice: Tenant → Legal Entity → Organization Unit → User → Authentication →
RBAC → thin frontend → Audit, end-to-end from login through a real UI
action, per `01-Tenant-Legal-Entity-Organization-Model.md`,
`02-Identity-Security-RBAC-Foundation.md`, and `03-Core-Data-Foundation.md`.

No blockers identified. Proceeding to Checkpoint 0B requires no new Founder
Decision — it follows directly from the already-approved blueprint.
