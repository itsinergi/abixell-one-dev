# Abixell One — Integrated Enterprise Management System

Internal project codename: **Abixell One** (by Insting Tekno Sinergi).
Internal positioning: *Whitelabel Integrated Enterprise Management System*.

> **Client-facing rule:** the word "whitelabel" (and "multi-tenant product",
> "shared product core", "reusable platform", "template platform") must
> **never** appear in any user-facing string, UI copy, email template, PDF,
> report, or client-facing document. All such strings must be sourced from
> per-Tenant Branding/Terminology Configuration, never hardcoded. See
> `docs/adr/0003-client-facing-branding-rule.md`.

## Canonical documentation

Start here — these four documents are the source of truth:

| Document | Purpose |
|---|---|
| [docs/product-blueprint.md](docs/product-blueprint.md) | What the product is: architecture layers, Platform Core, Business Core modules, Advanced / Configuration / Extension boundaries |
| [docs/product-roadmap.md](docs/product-roadmap.md) | Historical delivery, future phases, roadmap units and weights |
| [docs/product-progress.md](docs/product-progress.md) | Measured progress and its calculation basis |
| [docs/decision-log.md](docs/decision-log.md) | Founder decisions and architectural choices |

Supporting: [docs/technical-debt-register.md](docs/technical-debt-register.md),
[docs/implementation-notes.md](docs/implementation-notes.md), [docs/adr/](docs/adr/).

## Current state

**Phase 0 — Enterprise Core Foundation: COMPLETED.**
**Phase 1 — Customer Complaint Management + Survey & Assessment: COMPLETED.**

Implemented business capability: Customer & Commercial foundation, Service
Quality (Complaint) end-to-end, Survey & Assessment engine, and Survey-to-Action
integration. Remaining domains (Service Operations, HR, Supply Chain, Asset,
Finance, HSE, Project, Reporting) are planned — see the roadmap.

Historical blueprint material for the earlier IGSEP product concept lives in
`docs/00-prd/` and is **supporting/historical input**, not the implementation
source of truth.

## Repository layout

```
apps/api/        Node.js + TypeScript backend (Fastify, modular monolith)
apps/web/        React + Vite + TypeScript frontend (application shell)
packages/        Shared TypeScript contracts/types between api and web
docs/adr/        Architecture Decision Records
docs/            Decision log, implementation notes, gap/risk tracking
tests/           Cross-cutting / integration tests
infra/           Docker Compose, database infrastructure
scripts/         Dev/setup scripts
config/          Environment templates
```

`docs/00-prd/` holds the historical IGSEP-era blueprint corpus and the
Abixell One Phase 0 foundation specifications. The canonical product
documents listed above supersede it for implementation decisions.

## Getting started

```bash
npm install
npm run db:up          # starts local PostgreSQL via Docker Compose
cp apps/api/.env.example apps/api/.env
npm run migrate -w apps/api
npm run seed -w apps/api   # optional: demo Tenant + Admin/Supervisor users
npm run dev:api         # http://localhost:4000
npm run dev:web         # http://localhost:5173
```

Demo login (after `npm run seed`): `admin@demo.local` / `Admin12345!`
(tenant-wide) or `supervisor@demo.local` / `Supervisor12345!` (Site A scope
only, read-only), Tenant code `demo-gs`.

Demo also seeds `customeruser@democlient.local` / `CustomerUser12345!`
(customer scope), `handler@demo.local` / `Handler12345!`, and
`complaintmanager@demo.local` / `ComplaintManager12345!`.

## Status

| | |
|---|---|
| Baseline | `master` @ `b7b6d64` |
| Phases complete | Phase 0 (0A–0F), Phase 1 (1A–1E) |
| Tests | 150 passing (15 files) |
| Migrations / tables | 14 / 58 |
| Core Product Readiness | 41.4 % |
| Full Approved Roadmap | 22.1 % |

Progress figures and their calculation basis: [docs/product-progress.md](docs/product-progress.md).
Next phase awaits Founder approval — see [docs/product-roadmap.md](docs/product-roadmap.md).
