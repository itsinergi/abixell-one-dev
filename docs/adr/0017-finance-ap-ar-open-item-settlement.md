# ADR-0017: Finance AP/AR Open-Item Settlement

- **Status:** PROPOSED - Founder decisions incorporated; final document review required
- **Date:** 2026-09-02
- **Source:** Founder Pre-Wave A6 interview decision: controlled open-item settlement baseline; informed by SAP KBU and iDempiere controls and the audited limitations of the NATS finance reference

## Context

Wave A6 includes accounts payable, accounts receivable, and aging. A reliable implementation cannot derive settlement solely from an invoice's current status or mutable remaining-balance field. It needs an append-only allocation history that supports partial settlement, many-to-many payment allocation, withholding deductions, credit instruments, and historically correct aging.

The design must also prevent concurrent over-allocation and ensure that customer or vendor control accounts cannot be bypassed by manual journals.

## Decision

### 1. Use an open-item and allocation model

An approved invoice, credit note, debit note, down payment, payment, withholding deduction, or other authorized instrument creates or affects one or more open items. Settlement is represented by immutable allocation events between compatible open items.

The model supports:

- full and partial payment;
- one payment allocated to many invoices;
- many payments allocated to one invoice;
- customer and supplier down payments;
- credit notes and debit notes;
- unapplied receipts or payments; and
- configured withholding deductions.

Remaining amount is a derived exact-decimal projection from original value and allocation history. Customer and vendor reconciliation accounts are automatic control accounts and cannot be posted manually.

### 2. Preserve historical aging

AP and AR aging at an `asOfDate` is derived from immutable document, due-date, allocation, reversal, and adjustment history effective on or before that date. It must not use only today's invoice status or current remaining balance.

Aging buckets are configurable presentation policy. The underlying open-item history remains independent of a particular bucket layout.

### 3. Enforce settlement atomically

Allocation uses database transactions and row-level locks over affected open items. The write must re-check legal entity, currency compatibility, available amount, document eligibility, and non-negative remaining balance inside the transaction. Concurrent attempts that would over-allocate fail closed.

Reversal creates compensating allocation history and restores the derived open amount; it does not delete the original allocation.

### 4. Enforce authorization boundaries

All reads and mutations are tenant- and Legal Entity-scoped, protected by RBAC and centralized Data Scope, and fail closed. Source-document authorization follows the parent Customer, Supplier, Purchase, Sales, or Finance entity using registered authorization resolvers rather than trusting client-supplied identifiers.

## Rejected alternatives

- Treating invoice status as the sole settlement record.
- Mutating or deleting prior allocations when payments are changed.
- Computing historical aging from current balances.
- Allowing manual postings directly to customer or vendor reconciliation accounts.
- Performing remaining-balance checks before, but not inside, the database transaction.
- Copying NATS settlement behavior without correcting authorization, concurrency, exact-decimal, and tenant-isolation gaps.

## Consequences

- AP/AR balances, statements, and aging become reproducible for historical dates.
- Partial and many-to-many settlement can be reconciled to immutable accounting postings.
- Payment initiation remains outside this ADR; payment records may originate manually, through imports, or through a separately authorized extension.
- Detailed invoice, allocation, collection, and supplier-payment workflows remain unauthorized until Wave A6 implementation approval.

## Runtime authorization gate

This proposal does not authorize runtime implementation. The Founder interview selected the controlled open-item baseline, but final approval of this document is still required. Runtime authorization must include concurrent over-allocation, historical `asOfDate`, cross-tenant, cross-Legal Entity, cross-scope, exact-decimal, reversal, withholding, down-payment, unapplied-payment, and idempotency tests.

## Related documents

- [Finance Module PRD](../prd/abixell-one/modules/finance.md)
- [ADR-0015: Finance COA and Accounting Schema Governance](0015-finance-coa-and-accounting-schema-governance.md)
- [ADR-0016: Finance Posting, Reversal, and Fiscal Close](0016-finance-posting-reversal-and-fiscal-close.md)
- [ADR-0018: Finance Bank Reconciliation Readiness Gate](0018-finance-bank-reconciliation-readiness-gate.md)
- [ADR-0019: Indonesia Taxation Policy and Scope](0019-indonesia-taxation-policy-and-scope.md)
- [ADR-0022: Finance Consolidation and Financial Statements](0022-finance-consolidation-and-financial-statements.md)
