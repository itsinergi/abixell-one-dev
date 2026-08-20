# Abixell One — Product Requirements (Canonical PRD)

| | |
|---|---|
| **Document Status** | CANONICAL |
| **Authority** | Founder (Insting Tekno Sinergi) |
| **PRD Baseline** | v1.0 |
| **Last Updated** | 2026-08-20 |
| **Supersedes** | IGSEP corpus (`docs/history/igsep/`) as the requirement source of truth |
| **Related** | [Blueprint](../../canonical/product-blueprint.md) · [Roadmap](../../canonical/product-roadmap.md) · [Progress](../../canonical/product-progress.md) |

---

## What this PRD is

This PRD answers exactly one question:

> **What must Abixell One be able to do?**

It is *not* implementation notes, source documentation, a delivery timeline, or a test report. Those concerns live elsewhere:

```text
PRD            "What must the product do?"           docs/prd/abixell-one/
   ↓
BLUEPRINT      "How is it conceptually structured?"  docs/canonical/product-blueprint.md
   ↓
ROADMAP        "When and in what order?"             docs/canonical/product-roadmap.md
   ↓
IMPLEMENTATION "What exists in code?"                apps/ + docs/implementation-notes.md
   ↓
PROGRESS       "How much is delivered?"              docs/canonical/product-progress.md
```

## How it was produced

Reconstructed — not renamed — from four inputs:

1. **IGSEP legacy requirements** (`docs/history/igsep/`) — the predecessor product's business knowledge, migrated requirement by requirement.
2. **Founder decisions** (`docs/history/pre-phase-0/`, `docs/decision-log.md`).
3. **Canonical blueprint** — the five-layer product architecture.
4. **Implementation reality** — what the code and tests actually deliver.

Every migrated legacy requirement carries a disposition (ADOPT / ADAPT / MERGE / RECLASSIFY / DEFER / SUPERSEDE / DROP) recorded in [14-traceability-matrix.md](14-traceability-matrix.md).

## Document set

| Document | Content |
|---|---|
| [01-product-vision.md](01-product-vision.md) | What Abixell One is and who it serves |
| [02-product-principles.md](02-product-principles.md) | Binding product rules |
| [03-product-scope.md](03-product-scope.md) | In scope, out of scope, non-goals |
| [04-platform-core.md](04-platform-core.md) | `PLT-*` platform requirements |
| [05-business-core.md](05-business-core.md) | Business Core index → module PRDs |
| [06-advanced-capabilities.md](06-advanced-capabilities.md) | Advanced capability requirements |
| [07-client-configuration.md](07-client-configuration.md) | What must be configurable |
| [08-client-extension.md](08-client-extension.md) | Extension boundary rules |
| [09-vertical-service-packs.md](09-vertical-service-packs.md) | Pack model + the four packs |
| [10-security-governance.md](10-security-governance.md) | `SEC-*` requirements |
| [11-integration.md](11-integration.md) | `INT-*` requirements |
| [12-deployment-operations.md](12-deployment-operations.md) | `OPS-*` requirements |
| [13-experience-surfaces.md](13-experience-surfaces.md) | `UX-*` requirements |
| [14-traceability-matrix.md](14-traceability-matrix.md) | Legacy → canonical traceability |
| [modules/](modules/) | Per-module PRDs for the 11 Business Core modules |

## Requirement ID convention

```text
<PREFIX>-<LAYER>-<NNN>
```

| Prefix | Domain | Prefix | Domain |
|---|---|---|---|
| `PLT` | Platform Core | `SCM` | Supply Chain |
| `SEC` | Security & Governance | `AST` | Asset |
| `INT` | Integration | `FIN` | Finance |
| `OPS` | Deployment & Operations | `HSE` | HSE |
| `UX` | Experience Surfaces | `PRJ` | Project Delivery |
| `CUS` | Customer & Commercial | `RPT` | Reporting & Insight |
| `SQ` | Service Quality (Complaint) | `PACK` | Vertical Service Packs |
| `SUR` | Survey & Assessment | `CFG` | Client Configuration |
| `SO` | Service Operations | `EXT` | Client Extension |
| `HR` | Workforce | | |

`LAYER` ∈ `CORE` · `ADV` · `CFG` · `EXT` · `PACK`.
Example: `SO-CORE-001`, `SUR-ADV-002`, `HR-ADV-004`.

IDs are **stable**. A requirement is never renumbered; if dropped, its ID is retired, never reused.

## Requirement status vocabulary

`DELIVERED` · `PARTIAL` · `PLANNED` · `DEFERRED`

Status reflects product reality, not a specific commit. Evidence lives in the traceability matrix and progress document.

## Requirement change control

A new requirement must not silently enter the roadmap:

```text
New Requirement → Classification (layer) → Founder/Product approval
→ Roadmap Unit → Weight → Progress denominator update
```

Requirements dispositioned `SUPERSEDE`, `DROP`, or `EXT` do **not** enter the base product denominator.
