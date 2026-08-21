# Abixell One — Product Blueprint

| | |
|---|---|
| **Document Status** | CANONICAL |
| **Authority** | Founder (Insting Tekno Sinergi) |
| **Baseline Version** | Blueprint v1.1 |
| **Last Updated** | 2026-08-20 |
| **Supersedes** | `docs/history/igsep/09-Module-Architecture.md` (module catalog, IGSEP-era) as the implementation-authoritative module map |
| **Related** | [PRD](../prd/abixell-one/00-README.md) · [product-roadmap.md](product-roadmap.md) · [product-progress.md](product-progress.md) · [documentation-map.md](documentation-map.md) · [decision-log.md](../decision-log.md) · [technical-debt-register.md](../technical-debt-register.md) |

---

## 1. What Abixell One is

Abixell One is a **whitelabel, multi-tenant-ready Integrated Enterprise Management System**, deployed **dedicated per client**.

Internal architecture principle (approved pre-Phase 0):

> **Build Once. Configure Per Client. Deploy Exclusively.**

Client-facing positioning: *Designed Around Your Business.* The words *Whitelabel, Shared Core, Reusable Platform, Product Core* are **internal only** and must never appear in client-facing UI, reports, e-mail, domains, or documentation (ADR-0003).

### Product lineage (important)

The [`docs/history/igsep/`](../history/igsep/README.md) corpus (documents 01–25) describes **IGSEP — Integrated General Services Enterprise Platform**: a vertical platform for one General Services company (Industrial Catering, Housekeeping, Managed Workforce, Camp Management, Facilities Management).

Abixell One is the **productized, whitelabel evolution** of that concept — its direct successor: the same business domains, but built as generic reusable engines configured per client rather than a single-company vertical application. That pivot is recorded in [`01-FOUNDER-DECISION-PRE-PHASE-0.md`](../history/pre-phase-0/01-FOUNDER-DECISION-PRE-PHASE-0.md) (Decisions 3 & 4).

Consequence: IGSEP is preserved as **Legacy Product Requirement Source** — valuable domain input, migrated requirement-by-requirement in the [traceability matrix](../prd/abixell-one/14-traceability-matrix.md) — but it is **not** the implementation source of truth. This blueprint is.

---

## 2. Product principles

1. **Core is minimum genuine usability.** A Business Core module must deliver real operational value with every Advanced capability removed.
2. **Advanced is depth.** Deeper process, automation, compliance, calculation complexity, optimization, specialized workflow, analytical depth.
3. **No mandatory mega-ERP.** A client activates only the modules they need.
4. **Configuration before code.** A client difference is Configuration unless proven otherwise.
5. **Extension is the exception.** Client-specific code only when Configuration genuinely cannot express the need.
6. **Generic engines.** Business engines must be reusable across industries and clients.

---

## 3. Architecture layers

```text
┌─────────────────────────────────────────────────────────┐
│ CLIENT EXTENSION      client-specific, not reusable      │
├─────────────────────────────────────────────────────────┤
│ CLIENT CONFIGURATION  data/config, no code change        │
├─────────────────────────────────────────────────────────┤
│ ADVANCED CAPABILITY   optional depth per module          │
├─────────────────────────────────────────────────────────┤
│ BUSINESS CORE         minimum usable business domains    │
├─────────────────────────────────────────────────────────┤
│ PLATFORM CORE         technical foundation, client-agnostic │
└─────────────────────────────────────────────────────────┘
```

Deployment composition per client:

```text
Platform Core
+ selected Business Core Modules
+ selected Advanced Capabilities
+ Client Configuration
+ optional Client Extensions
```

---

## 4. Platform Core

Client-agnostic technical foundation. **Not** commercial business modules. **Status: fully implemented.**

| ID | Capability | Evidence |
|---|---|---|
| PC-1 | Tenant → Legal Entity → Organization Unit → Project → Site hierarchy | `tenants`, `legal_entities`, `organization_units` |
| PC-2 | Identity, authentication, session & refresh tokens | `users`, `refresh_tokens`, `/auth/*` |
| PC-3 | RBAC, permission catalog (42), Data Scope incl. hierarchical + customer scope | `roles`, `permissions`, `user_role_assignments`, ADR-0009/0011 |
| PC-4 | Configuration & Metadata Engine — module activation, feature flags, terminology, reference data, numbering | `modules`, `feature_flags`, `terminology_keys`, `reference_data_types`, `numbering_sequences` |
| PC-5 | Workflow & Approval Engine — definitions, versions, steps, transitions, assignment rules, escalation, SLA, instances, history | `workflow_*` (11 tables), ADR-0007/0008/0013 |
| PC-6 | Audit foundation (append-only) | `audit_log` |
| PC-7 | Domain Events / in-process EventBus | `domain_events` |
| PC-8 | Notification Engine (templates, channels, recipient conventions) | `notification_templates`, `notifications` |
| PC-9 | Document Service + Entity Authorization Resolver | `documents`, ADR-0012 |
| PC-10 | Scheduler (jobs + runs) | `scheduled_jobs`, `scheduled_job_runs` |
| PC-11 | Integration Boundary (inbound HMAC webhooks, outbound dispatch, idempotency log) | `integration_endpoints`, `integration_event_log` |
| PC-12 | Observability (request correlation, structured logs, health) | `/health`, `/observability` |
| PC-13 | Application Shell, Design System, responsive, PWA foundation | `apps/web` shell, `ui.tsx`, `sw.js`, manifest |

**Platform Hardening** (production/pilot concerns, tracked separately — *not* business capability): CI/CD, CORS allowlist, rate-limit tuning, backup/DR, deployment automation, performance fixes, dependency advisories, PWA icons, integration reconciliation worker.

---

## 5. Business Core modules

Eleven domains. Boundaries follow business responsibility, owned data, lifecycle, permissions, and workflows — deliberately **not** one module per menu item.

| # | Module | Core question it answers | State |
|---|---|---|---|
| BC-1 | **Customer & Commercial** | Who is the client, under what contract, at which project/site, for which service? | Core delivered (UI gap) |
| BC-2 | **Service Quality (Complaint)** | What went wrong, who handles it, was it fixed and confirmed? | Core delivered |
| BC-3 | **Survey & Assessment** | What did we ask, who answered, what was the result? | Core delivered |
| BC-4 | **Service Operations & Work Management** | What work is requested/scheduled, who executes it, was it done? | Core delivered |
| BC-5 | **Workforce (HR) Core** | Who is the employee and where do they belong organizationally? | Core delivered |
| BC-6 | **Supply Chain Core** | What item exists, how much, what moved, what was purchased from whom? | Core delivered |
| BC-7 | **Asset Core** | What asset exists, where is it, who holds it, how did it move? | Core delivered |
| BC-8 | **Finance Core** | What money came in/out, how much, when, for what? | Core delivered |
| BC-9 | **HSE Core** | What incident/observation occurred, and was it followed up? | Core delivered |
| BC-10 | **Project Delivery Core** | What activities/milestones exist and what is their progress? | Planned |
| BC-11 | **Reporting & Operational Insight** | What is the cross-module operational picture? | Planned |

### Merge decisions (overlap removal)
- **Vendor/Supplier** → merged into **Supply Chain Core** (supplier master is inseparable from purchasing).
- **Contract** → capability group inside **Customer & Commercial** (already implemented there).
- **Document/Records** → **Platform Core** (PC-9); records retention/e-archiving is Advanced.
- **Operations vertical apps** (Catering, Housekeeping, Camp, Facilities from the IGSEP catalog) → **not** separate modules. They are **vertical service packs**: configuration + Advanced capability over **Service Operations & Work Management**.
- **Customer Portal / Supervisor Mobile / Employee Mobile / Executive Dashboard** (IGSEP catalog) → **not** modules. They are **experience surfaces** delivered per module plus PC-13.

---

## 6. Business module capability maps

Format per module: Core / Advanced / Client Configuration / Client Extension.

### BC-1 Customer & Commercial
```text
CORE            Customer master · Contacts · Contract · Project · Site/Location ·
                Service catalog · Customer↔Service links · Customer Data Scope
ADVANCED        Sales pipeline / opportunity / quotation & pricing ·
                Customer self-service portal expansion
CONFIGURATION   Customer categories · service catalog content · org hierarchy ·
                terminology · numbering patterns
EXTENSION       Client CRM/ERP master-data synchronisation
```

### BC-2 Service Quality (Complaint)
```text
CORE            Complaint intake · category/severity/priority · SLA-driven workflow ·
                assignment · investigation · corrective action · verification ·
                customer confirmation · evidence · timeline · management dashboard ·
                complaint administration
ADVANCED        Multidimensional SLA (severity×category×customer) + business calendar ·
                structured RCA taxonomy + advanced CAPA · recurring-problem detection
                & service analytics · automatic domain mutation from feedback
                (auto-reopen / predictive escalation)
CONFIGURATION   Categories · severities · priorities · workflow definition ·
                SLA hours · assignment rules · escalation rules · numbering ·
                notification templates
EXTENSION       Client-specific complaint intake channel (e.g. proprietary portal/WA gateway)
```

### BC-3 Survey & Assessment
```text
CORE            Definition · versioning (immutable published) · sections/questions/options ·
                assignment · draft & submission · basic scoring · result read
ADVANCED        Survey-to-Action trigger→assignment [DELIVERED] ·
                outcome→management attention [DELIVERED] ·
                conditional branching & matrix · weighted/section/NPS scoring ·
                anonymous/public-token distribution · multi-language ·
                survey analytics & benchmarking
CONFIGURATION   Survey definitions · questions · option scores · thresholds ·
                integration policy · notification templates
EXTENSION       Client-specific distribution channel or external respondent identity
```

### BC-4 Service Operations & Work Management
```text
CORE            Service request / work order · lifecycle & scheduling ·
                assignment to teams · field execution & evidence · completion
ADVANCED        Vertical service packs (catering / housekeeping / camp / facilities) ·
                offline field PWA execution · route & roster optimization
CONFIGURATION   Work types · checklists · SLA · scheduling rules · locations
EXTENSION       Client device/IoT or site-access-system integration
```

### BC-5 Workforce (HR) Core
```text
CORE            Employee master · employee ID · employment status · organization/position
                placement · contact · basic documents · basic employment history
ADVANCED        Attendance/shift/roster · leave & overtime · payroll + BPJS + PPh21 ·
                recruitment · performance/competency/training/career · manpower planning
CONFIGURATION   Employment types · positions · org structure · document types
EXTENSION       Client biometric/attendance device or government reporting interface
```

### BC-6 Supply Chain Core
```text
CORE            Item master · supplier master · stock balance · goods in/out ·
                basic purchase request · basic purchase order & receipt
ADVANCED        Multi-warehouse/bin/batch/serial · reservation/reorder/transfer/stock opname ·
                inventory valuation + landed cost · RFQ/tender/bid comparison ·
                supplier evaluation & contract purchasing · spend analytics
CONFIGURATION   Item categories · UoM · warehouses · approval matrix · numbering
EXTENSION       Client procurement/e-catalog or supplier EDI integration
```

### BC-7 Asset Core
```text
CORE            Asset master · tag/ID · location · custodian · status · movement history · documents
ADVANCED        Preventive & corrective maintenance + work orders · meter reading ·
                spare parts · downtime · MTBF/MTTR · predictive maintenance
CONFIGURATION   Asset categories · locations · custodian rules · depreciation policy data
EXTENSION       Client CMMS/telematics integration
```

### BC-8 Finance Core
```text
CORE            Income & expense transactions · transaction category · basic cash/bank ·
                evidence attachment · approval (Workflow reuse) · basic cashflow view
ADVANCED        GL/COA/journal · AP/AR + aging · budgeting & cost center ·
                bank reconciliation · fixed-asset accounting · tax, consolidation,
                financial statements
CONFIGURATION   Categories · cost centers · approval thresholds · currencies
EXTENSION       Client accounting-system posting bridge · bank host-to-host
```

### BC-9 HSE Core
```text
CORE            Incident · observation · category · location · evidence · follow-up · status
ADVANCED        Investigation methodology · risk assessment (JSA/HIRA) · permit to work ·
                inspection & audit · environmental monitoring · CAPA ·
                leading/lagging indicators
CONFIGURATION   Incident types · severity · locations · follow-up workflow
EXTENSION       Client regulator reporting interface
```

### BC-10 Project Delivery Core
```text
CORE            Activity/task · milestone · PIC · dates · status · progress · attachments
ADVANCED        WBS & dependencies · Gantt · resource loading · baseline management ·
                earned value · cost control · project accounting
CONFIGURATION   Project types · milestone templates · progress method
EXTENSION       Client project-management-tool synchronisation
```

### BC-11 Reporting & Operational Insight
```text
CORE            Cross-module reporting foundation (scope-safe queries) ·
                standard operational reports + export · executive dashboard
ADVANCED        Self-service BI / warehouse · predictive analytics
CONFIGURATION   Report selection · dashboard composition · KPI thresholds
EXTENSION       Client BI tool feed
```

### Platform-level Advanced (cross-cutting)
```text
API economy / partner integration surface · AI readiness (sentiment, summarisation,
assistive automation) · marketplace & ecosystem
```

---

## 7. Client Configuration boundary

Configuration is **data**, changeable per client without touching Product Core. Supported today (PC-4, PC-5, PC-8, PC-9 + module config):

terminology · reference data (categories/severities/priorities) · workflow definitions, steps, transitions, assignment & escalation rules · SLA hours · numbering patterns · notification templates · module activation · feature flags · organization hierarchy · survey definitions/questions/thresholds · survey integration policy.

**Not product progress:** setting up one client's configuration data is delivery work, not product development (see progress rules).

---

## 8. Client Extension boundary

A need is an Extension only when **all** hold:
1. it is not broadly reusable across clients;
2. it cannot be expressed cleanly through Configuration;
3. it requires client-specific integration, process, or component.

Extensions are tracked **outside** the base product roadmap denominator, so custom client work never makes product completion appear to shrink.

---

## 9. Module activation model

A client deployment activates a subset. `modules` + `tenant_module_activations` + `feature_flags` + `tenant_feature_flags` (PC-4) already provide this; navigation is capability-gated in the frontend. No client ever sees modules they did not activate.

---

## 10. Cross-cutting foundations

Security (authn, RBAC, Data Scope, tenant isolation, audit), integration (boundary + events), documents (parent-entity authorization), notification, workflow, configuration — all Platform Core, reused by every business module. New modules must **reuse** these, never re-implement them.

---

## 11. Deployment model

Dedicated deployment per client; architecture multi-tenant-ready. PostgreSQL; modular monolith with hexagonal boundaries (domain / application / infrastructure / interfaces) and a composition root for wiring.

---

## 11A. Repository architecture (target — binding for new code)

### Module structure

Every functional module follows:

```text
modules/<module>/
├── core/          minimum reusable domain capability (genuine operational value)
│   ├── domain/  application/  infrastructure/  api/
├── advanced/      deeper capability owned primarily by this domain
└── packs/         packaged vertical use cases composed over this module
```

`advanced/` and `packs/` are created **only when they exist** — never empty folders for symmetry. A module with only Core is simply `modules/<module>/core/`.

### Cross-domain orchestration

> **Binding rule:** domain-specific Advanced lives **inside** its module. Cross-domain Advanced lives in **`orchestration/`**.

A capability belongs in `orchestration/` when it coordinates two or more bounded contexts and placing it inside one module would create false ownership or coupling.

Reference implementation — Survey-to-Action spans Survey, Service Quality, Notification, Events, and Integration:

```text
orchestration/survey-to-action/     ← correct
modules/survey/advanced/            ← would imply Survey owns Complaint semantics
```

### Target source layout

```text
apps/api/src/
├── app/            application bootstrap, HTTP wiring, composition root
├── core/           Platform Core capabilities (identity, tenancy, organization,
│                   rbac, configuration, reference-data, metadata, workflow,
│                   audit, events, notification, document, scheduler,
│                   integration, observability, feature-management)
├── modules/        the 11 Business Core modules
├── orchestration/  cross-domain capability (e.g. survey-to-action)
└── shared/         technical building blocks with no product semantics

apps/web/src/
├── app/  core/  modules/  shared/
```

### Dependency direction (binding)

```text
shared  ←  core  ←  modules  ←  orchestration
packs → their module's core + configuration
```

Prohibited: `core → <business module>` · `<module A> core → <module B> internals` · any circular module import. Cross-module behaviour uses **application ports, domain events, orchestration, or the trusted integration boundary** — never direct internal imports.

### `core/` vs `shared/`

| | Contains | Example |
|---|---|---|
| `shared/` | technical building blocks with little or no product semantics | date formatting, validation helpers, error types, test helpers, generic DB utilities |
| `core/` | platform capability with explicit reusable responsibility | workflow engine, RBAC, configuration engine |

`shared/` must never accumulate business logic. `ComplaintService`, `FinanceRule`, or `SurveyBusinessLogic` in `shared/` is a defect.

### Migration stream

Database migrations stay in a **single deterministic stream** at `apps/api/migrations/`, never distributed into module folders — global ordering must remain unambiguous. Ownership is expressed through descriptive filenames (e.g. `*_service_operations_schema`, `*_service_operations_permissions`).

### Adoption status

| Scope | Status |
|---|---|
| Target architecture | **Frozen** (this section is binding) |
| Existing Phase 0/1 implementation | **Migration deferred** — current layout is layer-first (`domain/`, `application/`, `infrastructure/`, `interfaces/`) |
| All new code from Phase 2 onward | **Must follow the target structure** |

Rationale for deferral: the existing 109 API source files carry 275 relative imports (130 cross-layer) across 73 files, plus 34 test imports and 51 composition-root imports. A module-first move would rewrite roughly 309 import paths with **zero behavioural benefit**, against a fully green regression suite. Stability outweighs folder aesthetics; a staged migration can follow later, module by module, once new modules have established the target shape.

---

## 12. Architecture risks

1. **Advanced delivered before Core breadth.** Phase 1E delivered automation depth (Survey-to-Action) while eight Business Core domains have no Core at all.
2. **No CI/CD.** Every gate is manual; risk rises with more than one contributor.
3. **Single-process EventBus.** In-process, fire-once, swallows subscriber errors; durable reconciliation deferred.
4. **Source-of-truth drift.** The IGSEP corpus is untracked and self-declares "Single Source of Truth" while describing a different product shape.
5. **Customer module has no operational UI.** API + tests exist; no screens.

---

## 13. Founder decisions required

| # | Decision | Why it matters |
|---|---|---|
| FD-A | Confirm the 11 Business Core modules and their boundaries | Fixes the roadmap denominator |
| FD-B | Confirm Survey-to-Action is **Advanced** (delivered), not Business Core | Changes Core readiness figures |
| FD-C | Confirm next phase = **Service Operations & Work Management Core** | See roadmap recommendation |
| FD-D | Disposition of the untracked `docs/00-prd/` corpus | Source-of-truth governance |
| FD-E | Whether vertical service packs stay Advanced over BC-4 rather than separate modules | Prevents module explosion |
