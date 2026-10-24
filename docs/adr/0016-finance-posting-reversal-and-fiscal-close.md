# ADR-0016: Finance Posting, Reversal, and Fiscal Close

- **Status:** APPROVED - Founder final document review 2026-10-24 (all eight Wave A6 ADRs approved together); implementation authorized
- **Date:** 2026-09-02
- **Source:** Founder Pre-Wave A6 interview decision: closed-period corrections post to the next open period by default; informed by iDempiere posting patterns, SAP KBU close controls, and existing Abixell One Finance Core invariants

## Context

Finance Core has Workflow-owned approval and immutable compensating cash transactions, but it deliberately does not post to an accounting ledger. Wave A6 requires a controlled transition from approved source documents to balanced accounting facts without introducing editable journals, duplicate lifecycle authorities, or silent posting failures.

Accounting also requires governed fiscal periods and repeatable month-end and year-end operations. These controls must be designed before journals, ledger balances, and financial statements can be treated as authoritative.

## Decision

### 1. Separate source documents from accounting facts

Operational source documents remain owned by their modules. Accounting posting creates immutable journal headers and lines that reference the source document, posting rule version, legal entity, accounting schema, ledger, fiscal period, currency context, and idempotency key.

Posting is atomic and idempotent. A source event and posting-rule version may not create duplicate accounting facts. A posting attempt has an explicit observable outcome such as `pending`, `posted`, or `failed`, but source-document approval remains owned by the Workflow Engine; the posting monitor is not a competing business lifecycle state machine.

### 2. Enforce balanced immutable journals

Database constraints and transaction boundaries must guarantee:

- total debit equals total credit in exact decimal arithmetic;
- a journal line cannot carry both a debit and a credit amount;
- account, schema, ledger, legal entity, period, currency, and dimension references are valid;
- posted journal headers and lines are immutable; and
- manual journals use governed approval before posting.

Posting failures remain visible with sanitized diagnostics, retry eligibility, and an auditable retry history. Retry reuses the same idempotency identity.

### 3. Correct through linked reversal or adjustment

Posted facts are never edited or deleted. Correction creates a linked reversal or adjustment journal with explicit reason, effective posting date, original posting reference, operator, approval evidence, and audit trail.

If the original fiscal period is closed, the default correction date is in the **next open period**. Reopening the original period requires a dedicated maker-checker workflow, explicit reason, impact evidence, and append-only audit. No administrator receives an ungoverned closed-period override.

### 4. Govern fiscal periods and close

Each accounting schema has fiscal years and periods with explicit open and closed controls. Posting into a closed period fails closed unless an authorized reopen workflow is completed and audited.

Month-end close uses a governed checklist that includes at least:

- unposted or failed source documents;
- bank reconciliation status;
- AP and AR reconciliation;
- depreciation completion;
- foreign-exchange revaluation where authorized;
- accrual and recurring entries; and
- trial-balance validation.

Year-end close includes controlled balance carry-forward and retained-earnings treatment. Close operations are idempotent and do not erase historical postings.

## Rejected alternatives

- Storing accounting fields directly on every source document as the ledger.
- Updating or deleting posted journal lines to correct mistakes.
- Application-only balance checks without database enforcement.
- Swallowing posting failures or treating retry as a new unrelated posting.
- Requiring every correction to reopen its original fiscal period.
- Allowing unrestricted administrator posting to closed periods.
- Creating a local journal approval state machine that competes with the Workflow Engine.

## Consequences

- Operational modules remain responsible for business truth while the Accounting Kernel owns accounting truth.
- Posting failures become recoverable and observable without duplicate ledger effects.
- Financial statements can rely on immutable, balanced, period-governed facts.
- Fiscal-close UI, scheduled checks, posting-rule catalogs, and migration design remain future implementation work.

## Runtime authorization gate

This proposal does not authorize runtime implementation. The Founder interview selected next-open-period correction as the default, but final approval of this document is still required. Implementation authorization must include concurrency, idempotency, failure-injection, reversal, maker-checker reopen, closed-period, exact-decimal, tenant, Legal Entity, Data Scope, and audit tests.

## Related documents

- [Finance Module PRD](../prd/abixell-one/modules/finance.md)
- [ADR-0015: Finance COA and Accounting Schema Governance](0015-finance-coa-and-accounting-schema-governance.md)
- [ADR-0017: Finance AP/AR Open-Item Settlement](0017-finance-ap-ar-open-item-settlement.md)
- [ADR-0018: Finance Bank Reconciliation Readiness Gate](0018-finance-bank-reconciliation-readiness-gate.md)
- [ADR-0021: Finance Fixed-Asset Accounting and Depreciation](0021-finance-fixed-asset-accounting-and-depreciation.md)
- [ADR-0022: Finance Consolidation and Financial Statements](0022-finance-consolidation-and-financial-statements.md)
