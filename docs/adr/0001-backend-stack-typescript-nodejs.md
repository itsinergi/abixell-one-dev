# ADR-0001: Backend Runtime — TypeScript / Node.js

- **Status:** APPROVED / BINDING
- **Date:** 2026-08-18
- **Owner:** Founder (Insting Tekno Sinergi)
- **Source:** `01-FOUNDER-DECISION-PRE-PHASE-0.md` (Non-Blocking Decision 5),
  `12-FOUNDER-DECISION-PHASE-0-IMPLEMENTATION.md` (Non-Blocking Decision 4),
  `09-Technical-Stack-Infrastructure-Recommendation.md`

## Context

Abixell One's Phase 0 workload is dominated by enterprise business logic,
API, authentication, RBAC, organization structure, configuration, metadata,
workflow, approval, SLA, notification, document management, and audit trail
— not high-performance / CPU-bound computing. Development velocity,
maintainability, full-stack TypeScript consistency, and ecosystem maturity
are the priorities for Phase 0 and the initial Complaint/Survey pilot.

## Decision

TypeScript / Node.js is the **binding default backend stack** for Phase 0
and initial Product Core development. This decision is **not** re-opened
per new service — no repeated Node.js vs Go trade-off analysis is performed
for ordinary Phase 0 / pilot work.

## Consequences

- `apps/api` is a Node.js (>=20) + TypeScript service.
- Full-stack TypeScript: shared contracts live in `packages/contracts` and
  are consumed by both `apps/api` and `apps/web`.
- HTTP framework selected as an implementation-level default (safe default,
  documented, not Founder-blocking): **Fastify** — chosen for native JSON
  Schema request/response validation (aligns with the Configuration Engine's
  schema-contract approach in `05-Configuration-Metadata-Engine.md`), strong
  TypeScript support, and OpenAPI generation via `@fastify/swagger`.

## Exception Policy (per Execution Protocol / Founder Decision)

Another backend runtime (e.g. Go) may only be introduced for a specific
service if there is objective, evidenced need: proven throughput bottleneck,
CPU-intensive processing, extreme concurrency, or a background worker with a
hard technical SLA that Node.js is benchmarked to fail. Any such proposal
requires profiling + benchmark + trade-off analysis + a new ADR + Founder
Approval before implementation. Absent that evidence, no new backend runtime
may be introduced (avoid premature polyglot architecture).
