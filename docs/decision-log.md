# Decision Log

Living log of engineering decisions made during implementation. Founder
Decisions (business/architecture-binding) live in the blueprint documents;
this log is for implementation-level decisions taken under the "small
decisions use a safe default and document" rule, plus anything that
deviates from a blueprint recommendation.

## 2026-08-18 — Checkpoint 0A

| # | Decision | Reason | Reference |
|---|---|---|---|
| 1 | Monorepo: npm workspaces (`apps/api`, `apps/web`, `packages/contracts`) | Simplest tool that satisfies "full-stack TypeScript consistency"; avoids adding Turborepo/Nx before there's a reason to (anti-overengineering) | `09-Technical-Stack-Infrastructure-Recommendation.md` |
| 2 | HTTP framework: Fastify | Native JSON Schema validation aligns with the Configuration Engine's schema-contract approach (doc 05); strong TS support; OpenAPI-ready | ADR-0001 |
| 3 | DB access: `pg` + `node-pg-migrate` instead of Prisma | Prisma's `generate`/`migrate` require downloading a native engine binary from `binaries.prisma.sh`, which is blocked by this implementation workspace's network allowlist (`403 Forbidden`). Switched to pure-JS `pg` + `node-pg-migrate` — no binary fetch, full raw-SQL control, straightforward path to future RLS policies | ADR-0002 |
| 4 | Frontend: React + Vite + TypeScript + Tailwind | Per doc 09 recommendation; Tailwind chosen over a component-kit to keep the Design System (doc 08) unopinionated at this stage | ADR (none yet — revisit at Checkpoint 0C when Design System tokens are defined) |
| 5 | Local Postgres for smoke-testing: native `postgresql` service (Docker daemon not available in this sandboxed workspace) | `docker` CLI is present but no daemon is running in this cloud implementation environment; used the pre-installed PostgreSQL 16 service directly to prove connectivity end-to-end. `infra/postgres/docker-compose.yml` is still the source of truth for real dev/CI environments where Docker is available | — |

## Open items carried to later checkpoints

- Design System token decisions (colors, spacing scale) — Checkpoint 0C+, once Configuration Engine exists to source Branding Configuration from.
- RLS activation strategy — deferred per ADR-0002, revisit if/when a non-dedicated (shared-hosting) tenant mode is ever pursued (would require Founder Decision, per stop conditions).
- CI/CD pipeline (GitHub Actions or equivalent) — not set up yet; Checkpoint 0A proved local build/lint/test/migrate work, CI wiring is a 0B/0C task once a remote git host is chosen.
