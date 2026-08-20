# 02 — Product Principles (Binding)

**PRD v1.0** · Canonical

| # | Principle | Consequence |
|---|---|---|
| P-1 | **Build Once. Configure Per Client. Deploy Exclusively.** | Source core is reusable; client differences live in configuration; each client gets a dedicated environment. |
| P-2 | **Core is minimum genuine usability.** | A Business Core module must deliver real operational value with every Advanced capability removed. |
| P-3 | **Advanced is depth.** | Deeper process, automation, compliance, calculation complexity, optimisation, specialised workflow, analytical depth. |
| P-4 | **No mandatory mega-ERP.** | A client activates only the modules they need; unactivated modules are invisible. |
| P-5 | **Configuration before code.** | A client difference is Configuration unless proven otherwise. |
| P-6 | **Extension is the exception.** | Client-specific code only when Configuration genuinely cannot express the need. |
| P-7 | **Generic engines only.** | No client name, industry assumption, or single-client business rule in Product Core. |
| P-8 | **Internal vocabulary stays internal.** | *Whitelabel, Product Core, Shared Core, Reusable Platform* must never appear in client-facing surfaces (ADR-0003). |
| P-9 | **Reuse platform capability.** | New modules reuse Workflow, Configuration, Notification, Document, Audit, Events, RBAC — never re-implement them. |
| P-10 | **Cross-domain logic lives in orchestration.** | Modules do not absorb another module's business logic; cross-domain behaviour uses application ports, domain events, and the orchestration layer. |
| P-11 | **Tenant isolation is absolute.** | Trusted internal calls may bypass a human permission check; they may never bypass tenant integrity, ownership, or domain invariants. |
| P-12 | **Evidence over assertion.** | Delivery status and progress must be backed by code, tests, and approved commits. |

## Applying P-5 / P-6 — the three-question test

For every client request, in order:

1. Is this a **universal capability**? → Product Core (Business Core or Advanced).
2. Is this a **configurable requirement**? → Client Configuration.
3. Is this genuinely **client-specific**? → Client Extension.

A request must never enter Product Core by default.

## Applying P-10 — ownership test

A capability belongs **inside a module** when its data, lifecycle, and permissions are owned by that single domain.

It belongs in **orchestration** when it coordinates two or more bounded contexts and would otherwise force one module to know another module's business semantics.

Reference implementation: Survey-to-Action coordinates Survey, Service Quality, Notification, Events, and Integration — so it lives in orchestration, not inside Survey.
