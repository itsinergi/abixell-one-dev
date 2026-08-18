# Abixell One — Enterprise Core Foundation

Internal project codename: **Abixell One** (by Insting Tekno Sinergi).
Internal positioning: *Whitelabel Integrated Enterprise Management System*.

> **Client-facing rule:** the word "whitelabel" (and "multi-tenant product",
> "shared product core", "reusable platform", "template platform") must
> **never** appear in any user-facing string, UI copy, email template, PDF,
> report, or client-facing document. All such strings must be sourced from
> per-Tenant Branding/Terminology Configuration, never hardcoded. See
> `docs/adr/0003-client-facing-branding-rule.md`.

This repository contains **Phase 0 — Enterprise Core Foundation** only.
No business modules (Complaint, Survey, Catering, Warehouse, Finance, etc.)
are implemented here yet — see `docs/decision-log.md` and the Founder-approved
blueprint documents (kept outside this repo, in the project's blueprint
folder) for full context.

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

Do **not** move or mix the approved blueprint documents into this source
tree. Blueprint docs remain the single source of truth for business/
architecture decisions; this repo is the implementation.

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

## Status

Checkpoint 0B — Identity & Organization Vertical Slice: COMPLETE. See
`docs/decision-log.md` and `docs/implementation-notes.md` for progress
against the Phase 0 checkpoints (0A–0F). Waiting on Founder review before
Checkpoint 0C.
