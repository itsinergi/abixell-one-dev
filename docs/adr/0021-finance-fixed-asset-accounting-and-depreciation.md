# ADR-0021: Finance Fixed-Asset Accounting and Depreciation

- **Status:** APPROVED - Founder final document review 2026-10-24 (all eight Wave A6 ADRs approved together); implementation authorized
- **Date:** 2026-09-02
- **Source:** Founder Pre-Wave A6 interview decision: straight-line depreciation first with extensible method contracts

## Context

`FIN-ADV-005` requires fixed-asset accounting and depreciation. The Asset module already owns operational identity, maintenance, meter readings, downtime, and work orders. Finance must add capitalization and book-value truth without duplicating the operational asset aggregate or creating an independent operational lifecycle.

The initial scope needs a safe depreciation baseline while preserving a controlled seam for future methods. Tax-book depreciation and jurisdiction-specific asset rules must not be inferred from the Indonesia tax proposal.

## Decision

### 1. Separate operational assets from accounting asset books

The Asset module remains authoritative for the operational asset. Finance owns one or more accounting asset-book records linked to that asset or to another approved capitalizable source. Each book records Legal Entity, accounting schema, ledger, asset class, capitalization date, in-service date, acquisition cost, residual value, useful life, depreciation method, accumulated depreciation, impairment, and disposal evidence.

The initial Wave A6 boundary activates one **primary accounting book** aligned with the primary ledger. Additional tax or parallel books require separate authorization.

### 2. Use straight-line as the active baseline

Straight-line depreciation is the initial active method. The method contract must be strategy-based and versioned so declining-balance or units-of-production methods can be added later without rewriting historical runs. Those additional methods are not activated by this decision.

All calculations use exact decimal arithmetic. Period depreciation is deterministic, never exceeds depreciable basis, and absorbs any rounding residual in the final eligible period.

### 3. Post immutable depreciation runs

Depreciation runs are scoped by Legal Entity, book, fiscal period, and idempotency key. They lock eligible asset-book rows, calculate exact amounts, and post through the Accounting Kernel atomically. Re-running the same period cannot duplicate depreciation.

A posted run is immutable. Correction uses linked reversal or adjustment under ADR-0016. Closed-period policy follows the next-open-period default unless a maker-checker reopen is approved.

### 4. Govern capitalization, transfer, impairment, and disposal

Capitalization, asset-class or dimension transfer, impairment, retirement, and disposal require explicit source evidence and Workflow Engine approval where configured. These actions produce accounting postings and immutable history; they do not mutate or bypass the operational Asset lifecycle.

Tax-book depreciation, revaluation models, component accounting, and jurisdiction-specific accelerated methods remain separately gated.

## Rejected alternatives

- Moving maintenance and operational lifecycle ownership into Finance.
- Using an editable accumulated-depreciation balance as the accounting source of truth.
- Activating every depreciation method and tax book in the initial Wave A6 scope.
- Hardcoding straight-line so no future method can be introduced safely.
- Calculating depreciation with binary floating-point arithmetic.
- Allowing repeated runs to post duplicate depreciation.

## Consequences

- Operational and accounting asset truth remain connected but independently governed.
- Straight-line provides a bounded initial implementation while preserving future method compatibility.
- Depreciation, impairment, and disposal reconcile to immutable ledger postings and fiscal periods.
- Additional books and complex statutory methods require separate policy and tests.

## Runtime authorization gate

This proposal does not authorize runtime implementation. Final Founder approval is required for the operational/accounting ownership boundary, one-primary-book scope, straight-line method, residual handling, depreciation-run idempotency, and gated advanced methods. Runtime authorization must include exact-decimal golden tests, final-period residual, concurrent run, duplicate run, closed-period, reversal, cross-tenant, cross-Legal Entity, Data Scope, RBAC, and Asset-parent authorization tests.

## Related documents

- [Finance Module PRD](../prd/abixell-one/modules/finance.md)
- [ADR-0015: Finance COA and Accounting Schema Governance](0015-finance-coa-and-accounting-schema-governance.md)
- [ADR-0016: Finance Posting, Reversal, and Fiscal Close](0016-finance-posting-reversal-and-fiscal-close.md)
- [ADR-0019: Indonesia Taxation Policy and Scope](0019-indonesia-taxation-policy-and-scope.md)
