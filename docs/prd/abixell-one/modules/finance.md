# Module PRD — Finance (`FIN-*`)

**PRD v1.0** · Business Core module 8 of 11 · Status: **DELIVERED** (Phase 6)

> **Core question:** What money came in and out, how much, when, and for what?

Core is **operational cash reality**, not accounting. Everything requiring accounting policy, ledgers, or statutory reporting is Advanced.

## Core requirements

| ID | Requirement | Status |
|---|---|---|
| **FIN-CORE-001** | The system shall record income transactions with amount, date, category, and business context. | DELIVERED |
| **FIN-CORE-002** | The system shall record expense transactions with amount, date, category, and business context. | DELIVERED |
| **FIN-CORE-003** | The system shall maintain a configurable transaction category catalog per tenant. | DELIVERED |
| **FIN-CORE-004** | The system shall maintain basic cash and bank accounts and their balances. | DELIVERED |
| **FIN-CORE-005** | Every transaction shall support attached evidence (receipt, invoice, proof of transfer), inheriting the transaction's authorisation. | DELIVERED |
| **FIN-CORE-006** | Transactions shall follow a configured approval lifecycle through the Workflow Engine. | DELIVERED |
| **FIN-CORE-007** | The system shall present a basic cashflow view (in, out, net) over a period. | DELIVERED |
| **FIN-CORE-008** | Transactions shall be immutable once approved; corrections shall be compensating entries, never edits. | DELIVERED |
| **FIN-CORE-009** | Transactions shall receive configurable business numbers. | DELIVERED |
| **FIN-CORE-010** | Financial data shall respect tenant isolation and strict data scope. | DELIVERED |
| **FIN-CORE-011** | Authorised users shall operate finance surfaces through the application UI. | DELIVERED |

## Advanced requirements

| ID | Requirement | Status |
|---|---|---|
| **FIN-ADV-001** | Accounting: chart of accounts, general ledger, journals. | DEFERRED |
| **FIN-ADV-002** | Accounts payable and receivable, with aging. | DEFERRED |
| **FIN-ADV-003** | Budgeting and cost centers. | DEFERRED |
| **FIN-ADV-004** | Bank reconciliation. | DEFERRED |
| **FIN-ADV-005** | Fixed-asset accounting and depreciation. | DEFERRED |
| **FIN-ADV-006** | Taxation. | DEFERRED |
| **FIN-ADV-007** | Consolidation across legal entities. | DEFERRED |
| **FIN-ADV-008** | Financial statements. | DEFERRED |

## Client Configuration

Transaction categories · cash/bank accounts · cost centers · approval matrix and thresholds · currency · numbering patterns.

## Client Extension boundary

Posting bridges to a client's accounting system and bank host-to-host interfaces are Extensions.

## Dependencies

Platform Core: workflow (approval), configuration, numbering, documents, audit, events, RBAC + data scope.
Business: Customer & Commercial (revenue context), Supply Chain (purchase context — Advanced), Project Delivery (project cost context — Advanced).

## Implementation reality

Delivered in Phase 6 (roadmap units FIN.1–FIN.6). Backend at
`apps/api/src/modules/finance/core/`, frontend at
`apps/web/src/modules/finance/`.

Two tables: `finance_accounts` and `finance_transactions`. There is no
`finance_categories` table — FIN-CORE-003 asks for a configurable per-tenant
catalog, which the Configuration Engine's Reference Data already provides
with a full CRUD surface; a third table would duplicate a platform
capability.

**One authoritative money transaction.** Direction is a column, not a
separate aggregate: no income table, expense table, or cash-movement table
that could eventually disagree with each other.

**Money precision is the module's defining property.** `numeric(18,2)` in
the database, and a **string** everywhere above it. node-postgres returns
`numeric` as a string and this module keeps it one all the way to the HTTP
response and into the browser — no amount is ever converted to a JavaScript
number, not even to render it, and every sum and balance change is computed
by PostgreSQL inside the mutating statement. Proven by test:
`100.10 + 200.20 − 50.05` stores and reports exactly `250.25`,
`0.10 + 0.20` is exactly `0.30`, and `9999999999999.99 + 0.01` is exactly
`10000000000000.00`.

**The ledger is authoritative; the balance is a derived cache.** A balance is
not writable through any API. It moves only when a transaction is applied:
under a row lock, in one transaction, with the sufficiency check inside the
statement that moves it. Proven by test: ten concurrent approvals of
`100.00` produce exactly `1000.00` and ten applied rows; three concurrent
expenses of `60.00` against `100.00` produce exactly one success and a
balance of `40.00`.

**Approval belongs to the Workflow Engine** (FIN-CORE-006) through
`workflow_instance_id`. There is no status column — pending / approved /
rejected / cancelled is read from the Workflow instance, and "the money
actually moved" is `applied_at`. There is deliberately **no state named
"posted"**: nothing is posted anywhere, because there is no ledger to post
to.

**Corrections are compensating entries, never edits** (FIN-CORE-008). A
transaction has no PATCH, PUT, or DELETE surface at all. Correcting an
applied one creates a NEW opposite-direction transaction of the same amount,
account, and currency, linked both ways, which goes through the same
approval before the money moves back. A transaction can be reversed at most
once, enforced by a partial unique index rather than by convention.

**No opening-balance field.** The PRD does not ask for one, and a directly
writable starting balance would be exactly the editable balance this design
forbids. An opening position is recorded as an ordinary approved income
transaction under a tenant-configured category.

Evidence: `finance.test.ts` (21 tests) plus a real-browser acceptance
covering accounts → income → approval → exact arithmetic → evidence →
rejection → cashflow → correction → correction approval → refused overspend.

## Deliberate Core decisions worth recording

- **Supplier/purchase context is NOT in Core.** This module's own
  Dependencies section marks Supply Chain purchase context *Advanced*, so a
  transaction may reference a Customer (Core revenue context) but there is no
  supplier, purchase-order, or invoice link — and therefore no AP.
- **Negative balances are prohibited** for every account type. The PRD gives
  no overdraft policy, and silently allowing a negative cash position would
  misrepresent operational reality — the same reasoning the Founder approved
  for negative stock in Phase 4. An overdraft facility would be a
  configurable Advanced capability, not a Core default.
- **Currency is per account** and copied onto the transaction. There is no
  FX conversion, rate table, revaluation, or gain/loss.

## Note on scope discipline

This module must not drift into becoming an accounting package by default. A client that already has an accounting system should be able to use Finance Core for operational cash visibility and integrate the rest through an Extension.
