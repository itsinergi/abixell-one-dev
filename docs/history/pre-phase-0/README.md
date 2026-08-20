# Pre-Phase 0 — Founding Decisions (Historical, Authoritative Origin)

```text
Status: HISTORICAL — ORIGIN OF BINDING PRODUCT RULES
```

These two documents predate Phase 0 and are the **origin** of rules still enforced today.
They previously lived **outside** version control (in the project's parent directory) and
were copied into the repository during the 2026-08-20 baseline reconstruction so the
product's founding decisions are versioned. The originals were left untouched.

| File | Why it matters |
|---|---|
| `00-PRE-PHASE-0-SUMMARY.md` | Discovery summary leading to the four blocking decisions |
| `01-FOUNDER-DECISION-PRE-PHASE-0.md` | The four approved decisions: dedicated deployment + multi-tenant-ready architecture; generic organization hierarchy; Complaint & Survey as generic pilot modules; **"Abixell One" internal identity + whitelabel never client-facing**; and the **Product Core / Client Configuration / Client Extension** boundary |

Two rules from these documents remain binding and are enforced in code and review:

1. *Build Once. Configure Per Client. Deploy Exclusively.* — client-facing positioning is
   *Designed Around Your Business*.
2. Internal terms (Whitelabel, Product Core, Reusable Platform, Shared Core) must never
   appear in client-facing surfaces — see `docs/adr/0003-client-facing-branding-rule.md`.

The layered model approved here (Core / Configuration / Extension) was extended by the
2026-08-20 audit into five layers — see [`docs/canonical/product-blueprint.md`](../../canonical/product-blueprint.md).
