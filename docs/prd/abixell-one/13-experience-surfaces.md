# 13 — Experience Surfaces (`UX-*`)

**PRD v1.0** · Canonical · Classification: **Platform Core + per-module UI**

## Principle

Portals and dashboards are **experience surfaces**, not modules. IGSEP listed *Customer Portal, Supervisor Mobile, Employee Mobile, Executive Dashboard* as separate modules; in Abixell One they are audiences served by the shared shell plus each module's own screens.

Responsive Web/PWA is the primary Abixell One experience on PC, laptop, Android, and iOS. Browser PWA installation is distinct from server/runtime installation. Any future Windows/Linux/macOS desktop wrapper remains an optional thin client to the same dedicated deployment; it does not create another business database, cache API data, queue offline writes, or bypass TLS and backend authorization.

```text
One application shell + design system
   └── capability-gated navigation per audience
         ├── Client-side users     (customer surface)
         ├── Operational users     (supervisor/field surface)
         ├── Verification/QA users
         ├── Management users      (dashboard surface)
         └── Administrators        (configuration surface)
```

## Requirements

| ID | Requirement | Status |
|---|---|---|
| **UX-001** | **Single application shell** with consistent navigation, layout, and state handling across every module. | DELIVERED |
| **UX-002** | **Capability-gated navigation.** A user shall only see areas their permissions and their tenant's activated modules allow. Backend authorisation remains the enforcement point. | DELIVERED |
| **UX-003** | **Reusable design system.** Shared UI primitives shall be used by all modules rather than per-module component styles. | DELIVERED |
| **UX-004** | **Responsive by default.** Every operational surface shall be usable on phone, tablet, and desktop widths without horizontal overflow. | DELIVERED |
| **UX-005** | **Installable client experience.** The application shall be installable and shall load its shell offline. | PARTIAL (icon assets outstanding) |
| **UX-006** | **No offline business data.** Offline capability shall cover the application shell only; business data and API responses shall never be cached client-side. | DELIVERED |
| **UX-007** | **No offline business mutation.** The application shall not queue business writes while offline. | DELIVERED |
| **UX-008** | **Client-side surface.** Client users shall submit and track their own requests and see only their own organisation's data. | DELIVERED (Complaint, Survey) |
| **UX-009** | **Operational surface.** Operational users shall see a work queue, act on assigned work, and record execution evidence. | DELIVERED (Complaint, Service Operations) |
| **UX-010** | **Verification surface.** Verification users shall review completed work and record a verification outcome. | DELIVERED (Complaint) |
| **UX-011** | **Management surface.** Management users shall see aggregate operational status and items needing attention. | DELIVERED (Complaint) · PLANNED (cross-module) |
| **UX-012** | **Administration surface.** Administrators shall maintain their tenant's configuration through the application. | PARTIAL (Complaint config only) |
| **UX-013** | **Field execution surface.** Field users shall execute assigned work and capture evidence on mobile. | DELIVERED |
| **UX-014** | **Every Business Core module shall ship the operational UI needed for its Core to be genuinely usable.** | PARTIAL (Customer module has no UI) |
| **UX-015** | **Client-facing vocabulary.** No internal product terminology shall appear in any user-facing string; labels come from tenant terminology configuration. | DELIVERED |

## Administration trust surfaces

- The **Business Admin Console** is the governed evolution of the current deployment-local Administration and Configuration surface. It uses tenant authentication, RBAC, Data Scope, and audit.
- The future **Platform Architect / Builder Console** is a separate higher-risk artifact-design and publication context. It creates no ambient cross-client business-data superuser and is not delivered by Phase 11A.
- A person with both duties must enter an explicit trust context; permissions are not silently combined.

See the [Dual Admin Console architecture](../../architecture/dual-admin-console.md) and [Platform Builder risk model](../../architecture/platform-builder-risk-model.md). No existing UX requirement is marked newly delivered by this architectural clarification.

## Known gaps

| Gap | Requirement | Disposition |
|---|---|---|
| Customer & Commercial has API + tests but no screens | UX-014 | Roadmap unit `CUS.4` (planned) |
| Configuration administration exists only for Complaint | UX-012 | Advanced/roadmap; other areas are API/seed configured |
| PWA icon assets incomplete | UX-005 | Platform Hardening (`OPS-015`) |
