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
| An unbounded low-code/no-code application programming environment | Configuration and future Builder metadata remain finite, typed, versioned, validated, approved, audited, and rollback-governed—not a general programming surface |
| Arbitrary SQL/query editors, direct production schema/table mutation, scripts, runtime code injection, or generic expression DSLs | Prohibited regardless of UI; finite policies and published contracts preserve tenant, authorization, audit, and migration controls |
| An unrestricted visual workflow/automation designer | A future governed view may author only approved finite workflow metadata through risk-class validation, simulation, approval, publication, and rollback |
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

## Governed Builder direction

A future metadata-driven Platform Builder is approved as an architectural direction only. It may operate on a finite typed metamodel and must use immutable versions, validation, isolated simulation/impact analysis, maker-checker approval, atomic publication, append-only audit, observation, and safe rollback or supersession. It never authorizes arbitrary programming, weakens backend authorization, or mutates Platform Kernel internals directly. See the [Platform Builder risk model](../../architecture/platform-builder-risk-model.md).

## Deployment scope

Dedicated deployment per client, multi-tenant-ready architecture. The target effective-availability contract requires an installed and compatible package, deployment catalog entry, tenant activation, permission, Data Scope/audience, and applicable feature flags. Generalized enforcement across every frontend and API contribution is future work; Phase 11A does not claim it is implemented.
