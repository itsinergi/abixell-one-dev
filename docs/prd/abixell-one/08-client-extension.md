# 08 — Client Extension Boundary (`EXT-*`)

**PRD v1.0** · Canonical · Classification: **Client Extension**

## Definition

> A **Client Extension** is capability that is not broadly reusable and cannot be represented cleanly through Product Core, Advanced capability, or Client Configuration.

## Qualifying test (all three must hold)

1. It is **not broadly reusable** across clients or industries.
2. It **cannot** be expressed cleanly through Configuration.
3. It requires **client-specific** integration, process, or component.

If any condition fails, it is not an Extension — reclassify it.

## Rules

| ID | Requirement |
|---|---|
| **EXT-R1** | An Extension shall never modify Product Core source. It integrates through published application ports, domain events, or the integration boundary. |
| **EXT-R2** | An Extension shall respect all platform invariants: tenant isolation, permissions, data scope, audit, and domain eligibility. |
| **EXT-R3** | An Extension shall be removable without breaking Product Core or any other client's deployment. |
| **EXT-R4** | Extensions shall be **excluded from the base product roadmap denominator** and tracked per client, so custom work never makes product completion appear to shrink. |
| **EXT-R5** | An Extension that proves broadly valuable shall be **promoted** — through Founder approval — into Advanced or Business Core, with a new requirement ID and roadmap weight. Promotion is deliberate, never automatic. |
| **EXT-R6** | Fork of the product source per client is prohibited except where an architectural need genuinely cannot be met by configuration or extension. |

## Typical Extension categories

| Category | Example |
|---|---|
| Proprietary system integration | Client ERP / accounting posting bridge; client CRM master-data sync |
| Regulatory exchange | Government or regulator reporting interface specific to one client |
| Device interface | Biometric attendance device, site access system, telematics, IoT sensor |
| Client-only calculation | An operational calculation unique to one client's commercial agreement |
| Client-only approval logic | Approval behaviour that cannot be expressed by the workflow engine's configuration |

## Current extensions

**None.** No client extension exists in the product today. This section is the register; entries are added per client as they arise.

| Client | Extension | Trigger | Reviewed |
|---|---|---|---|
| — | — | — | — |
