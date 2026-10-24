# ADR-0018: Finance Bank Reconciliation Readiness Gate

- **Status:** APPROVED - Founder final document review 2026-10-24 (all eight Wave A6 ADRs approved together); implementation authorized
- **Date:** 2026-09-02
- **Source:** Founder Pre-Wave A6 interview decision: CSV-first reconciliation, adapter readiness, and disabled payment initiation; informed by SAP KBU MT940/manual reconciliation patterns

## Context

Wave A6 includes bank reconciliation, while the Founder has explicitly excluded direct bank API integration and payment initiation from the current scope. The architecture must provide useful statement reconciliation now and stable integration seams later without granting external systems ambient access to the ledger or allowing future adapters to bypass Finance authorization.

Finance must also distinguish accounting book balance from bank-provided statement balance. Neither may silently overwrite the other.

## Decision

### 1. Model bank identity explicitly

The hierarchy is:

```text
Bank Master -> House Bank -> Account ID -> Bank Account
```

A bank account belongs to one tenant and Legal Entity, maps to an authorized ledger account, and carries currency, masked account identity, effective dates, and reconciliation policy. Book balance derives from the Accounting Kernel. Statement balance derives from imported statement facts.

### 2. Deliver import-based reconciliation first

The initial authorized implementation may support governed CSV import with explicit format profiles. MT940, CAMT, and other formats may be added through adapters after separate compatibility and security review.

Imported statements and transactions preserve source-file identity, external transaction ID where available, import hash, value date, booking date, amount, currency, reference, counterparty, and raw-source provenance. Import is idempotent and duplicate facts fail closed or enter a review queue.

### 3. Support governed matching and close

Reconciliation provides deterministic candidate matching using amount, date tolerance, reference, and counterparty. It supports manual match, split match, many-to-one match, unmatched and exception queues, and an explicit reconciliation close.

Automatic suggestions are advisory until confirmed under the configured authorization policy. Closing a reconciliation period freezes its match set; correction uses governed reopen or compensating activity with audit evidence.

### 4. Define disabled future integration ports

The Finance boundary reserves these ports:

- `BankStatementProvider`
- `BankTransactionImporter`
- `BankBalanceProvider`
- `BankPaymentInitiator`

`BankPaymentInitiator` is disabled and not implemented in Wave A6. Any direct bank API, payment initiation, credential handling, signing, host-to-host channel, or real-time balance service is a Client Extension or separately authorized phase. An adapter must enter through these ports and may not write ledger tables directly.

## Rejected alternatives

- Requiring a live bank API before bank reconciliation can be delivered.
- Treating the Finance Core account balance as the bank statement balance.
- Allowing imported files or adapters to post directly into ledger tables.
- Auto-matching without explainable criteria or review controls.
- Implementing payment initiation as an incidental part of reconciliation.
- Storing unrestricted bank credentials in tenant business tables.

## Consequences

- Clients can reconcile actual statements without waiting for bank-specific integrations.
- Future bank adapters have explicit, testable seams and cannot redefine ledger authority.
- Actual bank balances remain unavailable unless supplied by an authorized import or future provider; the UI must label data source and freshness.
- Direct transaction initiation remains outside Wave A6 and outside the current roadmap points.

## Runtime authorization gate

This proposal does not authorize runtime implementation or external connectivity. The Founder interview selected CSV-first reconciliation, adapter readiness, and disabled payment initiation, but final approval of this document is still required. Runtime authorization must define file security, idempotency, duplicate handling, tenant and Legal Entity isolation, RBAC, Data Scope, audit, exact-decimal, reconciliation concurrency, and extension threat-model tests.

## Related documents

- [Finance Module PRD](../prd/abixell-one/modules/finance.md)
- [ADR-0016: Finance Posting, Reversal, and Fiscal Close](0016-finance-posting-reversal-and-fiscal-close.md)
- [ADR-0017: Finance AP/AR Open-Item Settlement](0017-finance-ap-ar-open-item-settlement.md)
- [ADR-0019: Indonesia Taxation Policy and Scope](0019-indonesia-taxation-policy-and-scope.md)
