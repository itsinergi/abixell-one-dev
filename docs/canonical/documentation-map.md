# Documentation Map & Governance

| | |
|---|---|
| **Document Status** | CANONICAL |
| **Authority** | Founder (Insting Tekno Sinergi) |
| **Governance Version** | v1.0 |
| **Last Updated** | 2026-08-20 |

This document removes all ambiguity about which document is authoritative.

---

## Reading order (for humans and agents)

```text
1. docs/canonical/          ← start here, always
2. docs/prd/abixell-one/    ← what the product must do
3. docs/decision-log.md + docs/adr/   ← why decisions were made
4. docs/implementation-notes.md + docs/technical-debt-register.md
5. docs/history/            ← only when historical context is genuinely required
```

**Rule:** never derive current architecture, scope, roadmap, or progress from `docs/history/`. It is preserved evidence, not instruction.

## Authority table

| Question | Authoritative document |
|---|---|
| What must the product do? | [`docs/prd/abixell-one/`](../prd/abixell-one/00-README.md) |
| How is the product structured? | [`docs/canonical/product-blueprint.md`](product-blueprint.md) |
| When is it delivered, in what order? | [`docs/canonical/product-roadmap.md`](product-roadmap.md) |
| How much is delivered? | [`docs/canonical/product-progress.md`](product-progress.md) |
| Why was something decided? | [`docs/decision-log.md`](../decision-log.md), [`docs/adr/`](../adr/) |
| How was it built? | [`docs/implementation-notes.md`](../implementation-notes.md) |
| What is outstanding/risky? | [`docs/technical-debt-register.md`](../technical-debt-register.md) |
| What did the predecessor product require? | [`docs/history/igsep/`](../history/igsep/README.md) |
| What were the founding decisions? | [`docs/history/pre-phase-0/`](../history/pre-phase-0/README.md) |
| What was Phase 0 specified to be? | [`docs/history/phase-0/`](../history/phase-0/README.md) |

## Document register

| Path | Status | Authority |
|---|---|---|
| `docs/canonical/product-blueprint.md` | CANONICAL | Product architecture |
| `docs/canonical/product-roadmap.md` | CANONICAL | Delivery plan + weights |
| `docs/canonical/product-progress.md` | CANONICAL | Measured progress |
| `docs/canonical/documentation-map.md` | CANONICAL | This document |
| `docs/prd/abixell-one/**` | CANONICAL | Requirements |
| `docs/decision-log.md` | CANONICAL | Decisions |
| `docs/adr/**` | CANONICAL | Architecture decisions |
| `docs/technical-debt-register.md` | SUPPORTING | Debt & gates |
| `docs/implementation-notes.md` | SUPPORTING | Build record |
| `docs/performance-baseline.md` | SUPPORTING | Performance evidence |
| `docs/evidence/**` | SUPPORTING | Verification artefacts |
| `docs/history/igsep/**` | HISTORICAL | Legacy requirement source (IGSEP) |
| `docs/history/pre-phase-0/**` | HISTORICAL | Founding decisions |
| `docs/history/phase-0/**` | HISTORICAL | Phase 0 spec + final review |

## Why some documents were not relocated

The 2026-08-20 restructure moved only what was safe. `docs/decision-log.md` (10 references), `docs/adr/` (4 references), and `docs/implementation-notes.md` (1 reference) are cited **by path from source-code comments**. Moving them would have created stale references across the codebase for no functional benefit, so they remain at `docs/` root. Relocating them into `docs/decisions/` and `docs/technical/` is recorded as optional future cleanup, to be done together with the comment updates.

## Baseline versions

| Artifact | Version |
|---|---|
| Product Blueprint | v1.1 |
| PRD | v1.0 |
| Roadmap Baseline | v1.1 |
| Progress Model | v1.0 |
| Documentation Governance | v1.0 |

## Change control

| Change | Required path |
|---|---|
| New product requirement | PRD entry → classification → Founder approval → roadmap unit + weight → progress denominator update |
| New architectural decision | ADR (technical) or decision log (product) |
| Roadmap scope change | Roadmap version bump + explicit denominator delta note in progress |
| New client extension | Extension register in PRD 08 — **never** the base denominator |
| Historical document | Never edited to change meaning; annotate instead |

## Anti-patterns to avoid

1. **Do not** treat a numbered filename as a phase count (`22-…` is not "22 phases").
2. **Do not** infer scope from `docs/history/`.
3. **Do not** create a second roadmap, progress figure, or requirement source.
4. **Do not** rename legacy IGSEP documents to say "Abixell One" — it destroys traceability.
5. **Do not** invent a phase that no document defines (this produced the non-existent "Phase 1F").
