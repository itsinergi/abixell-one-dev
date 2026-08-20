# IGSEP — Legacy Product Requirement Source

```text
Status:
LEGACY PRODUCT REQUIREMENT SOURCE

Predecessor:
IGSEP — Integrated General Services Enterprise Platform

Successor:
Abixell One — By Insting Tekno Sinergi

Not authoritative for:
- current architecture
- roadmap
- implementation
- progress calculation

Valid use:
- business-requirement archaeology
- product evolution
- requirement traceability
```

---

## What this is

IGSEP is the **predecessor of Abixell One**, not an unrelated product. These 26 documents were the original master blueprint for a vertical enterprise platform built for **one** General Services company, covering Industrial Catering, Housekeeping, Managed Workforce, Camp Management, and Facilities Management.

Abixell One is the **whitelabel, multi-tenant-ready evolution** of that concept: the same business knowledge, re-expressed as generic reusable engines configured per client instead of one company's vertical application. The pivot is recorded in [`../pre-phase-0/01-FOUNDER-DECISION-PRE-PHASE-0.md`](../pre-phase-0/01-FOUNDER-DECISION-PRE-PHASE-0.md) (Decisions 3 & 4).

## Why it is preserved unmodified

These documents are **legacy evidence**. They are deliberately **not** rewritten to say "Abixell One", because doing so would destroy their historical meaning and break traceability. Where a requirement here still matters, it has been migrated into the canonical Abixell One PRD and recorded in the [traceability matrix](../../prd/abixell-one/14-traceability-matrix.md).

## Important characteristics (read before trusting content)

1. **These are instruction-shaped documents.** Every file 01–25 contains directives addressed to an authoring agent ("Claude harus menyusun…", "Claude bertindak sebagai…"). They describe *what should be produced*, often more than they record *what was decided*.
2. **`22-Enterprise-Product-Strategy-Roadmap.md` is a template, not a roadmap.** Its axis is Year 1–Year 5 and its content is authoring instructions. It is **superseded** by [`docs/canonical/product-roadmap.md`](../../canonical/product-roadmap.md).
3. **`00-README.md` claims to be "Single Source of Truth".** That claim applied to IGSEP and is **no longer true** for Abixell One. Canonical authority now lives in `docs/canonical/` and `docs/prd/abixell-one/`.
4. **"Phase 1–25" here are documentation-authoring phases**, not implementation phases. Abixell One's implementation phases are Phase 0, Phase 1A–1E, then Phase 2+. Conflating the two numbering systems previously caused a non-existent "Phase 1F" to be assumed.

## Architectural translation rule

IGSEP module names must **not** be reproduced as Abixell One modules one-for-one. Example:

```text
IGSEP:      Catering · Housekeeping · Camp Management · Facilities Management
                              ↓  translate, do not copy
Abixell One: Service Operations & Work Management (Business Core)
             + Vertical Service Packs (configuration + optional Advanced)
```

Preserve the business knowledge. Change the architecture.

## Content review

Reviewed 2026-08-20 for sensitive material before version control: **no credentials, secrets, tokens, connection strings, or personal data found**. Matches for words like "token" and "secrets" are architectural topics (e.g. "Secrets Management", "Refresh Token"), not values.

`Business-Discovery-Workshop-Kit.docx` is **not** committed — binaries are kept outside the active repository pending an explicit Founder decision. It remains at `docs/00-prd/`.

## Document index

| File | Nature |
|---|---|
| `00-README.md` | IGSEP master overview (stale SSOT claim) |
| `01-Project-Initialization.md` … `05-Business-Process-Documentation.md` | Vision, business architecture, industry research, process documentation |
| `06-Functional-Specification.md` | Functional scope — richest requirement source |
| `07`–`08` | Technical & database architecture |
| `09-Module-Architecture.md` | Module catalog — primary input to the Abixell One module map |
| `10`–`12` | Security/governance, integration, workflow architecture |
| `13`–`16` | UX, UI design system, mobile, reporting/analytics |
| `17`–`20` | DevOps, QA, deployment/go-live, operational excellence |
| `21` | Intelligence & AI readiness |
| `22` | Product strategy & roadmap (**template**) |
| `23`–`25` | Knowledge preservation, continuous improvement, execution protocol |

## Where to go instead

| Question | Canonical answer |
|---|---|
| What must the product do? | [`docs/prd/abixell-one/`](../../prd/abixell-one/00-README.md) |
| How is it structured? | [`docs/canonical/product-blueprint.md`](../../canonical/product-blueprint.md) |
| When is it delivered? | [`docs/canonical/product-roadmap.md`](../../canonical/product-roadmap.md) |
| How much is done? | [`docs/canonical/product-progress.md`](../../canonical/product-progress.md) |
