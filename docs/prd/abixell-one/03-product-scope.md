# 03 — Product Scope

**PRD v1.0** · Canonical

## In scope

| Layer | Scope |
|---|---|
| **Platform Core** | Tenancy, identity, RBAC & data scope, configuration/metadata, workflow & approval, audit, domain events, notification, documents, scheduler, integration boundary, observability, application shell & design system |
| **Business Core** | 11 modules — Customer & Commercial, Service Quality, Survey & Assessment, Service Operations & Work Management, Workforce, Supply Chain, Asset, Finance, HSE, Project Delivery, Reporting & Operational Insight |
| **Advanced** | Optional depth per module, activated per client |
| **Client Configuration** | Terminology, reference data, workflow, SLA, numbering, templates, thresholds, activation, org structure |
| **Vertical Service Packs** | Catering, Housekeeping, Camp Services, Facility Services — composed over Service Operations |

## Out of scope (non-goals)

| Non-goal | Reason |
|---|---|
| A single mandatory ERP every client must adopt whole | Violates P-4; module activation exists precisely to avoid this |
| Per-client source forks | Violates P-1; extensions exist for genuine uniqueness |
| A low-code / no-code application builder | Configuration is finite and structured, not a programming surface |
| A generic rules engine or expression DSL | Explicitly rejected during Phase 1E; policies use finite structured fields |
| A visual workflow/automation designer | Workflow is configured as data, not drawn |
| An independent BI/data-warehouse platform | Reporting Core serves operational insight; deep BI is Advanced |
| Industry-specific engines duplicated per vertical | Verticals are packs + configuration over generic engines |
| Client-facing exposure of internal product vocabulary | Violates P-8 / ADR-0003 |

## Scope boundaries that have already been decided

| Decision | Effect |
|---|---|
| Complaint & Survey built as **generic engines** | Reusable across industries; not General-Services-specific |
| Survey-to-Action is **Advanced**, delivered | Automation depth, not survey minimum usability |
| Automatic Complaint reopen from survey outcome | **Deferred** — Founder-gated advanced capability |
| Catering/Housekeeping/Camp/Facilities | **Packs**, not Business Core modules |
| Vendor/Supplier | Merged into Supply Chain |
| Contract | Inside Customer & Commercial |
| Document management | Platform Core capability |
| CI/CD, CORS, rate limiting, DR | **Platform Hardening** track, not business capability |

## Deployment scope

Dedicated deployment per client, multi-tenant-ready architecture. A deployment activates a subset of modules; unactivated modules must not appear in navigation or API surface area available to that client's users.
