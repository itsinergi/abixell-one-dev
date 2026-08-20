# Module PRD — Finance (`FIN-*`)

**PRD v1.0** · Business Core module 8 of 11 · Status: **PLANNED**

> **Core question:** What money came in and out, how much, when, and for what?

Core is **operational cash reality**, not accounting. Everything requiring accounting policy, ledgers, or statutory reporting is Advanced.

## Core requirements

| ID | Requirement | Status |
|---|---|---|
| **FIN-CORE-001** | The system shall record income transactions with amount, date, category, and business context. | PLANNED |
| **FIN-CORE-002** | The system shall record expense transactions with amount, date, category, and business context. | PLANNED |
| **FIN-CORE-003** | The system shall maintain a configurable transaction category catalog per tenant. | PLANNED |
| **FIN-CORE-004** | The system shall maintain basic cash and bank accounts and their balances. | PLANNED |
| **FIN-CORE-005** | Every transaction shall support attached evidence (receipt, invoice, proof of transfer), inheriting the transaction's authorisation. | PLANNED |
| **FIN-CORE-006** | Transactions shall follow a configured approval lifecycle through the Workflow Engine. | PLANNED |
| **FIN-CORE-007** | The system shall present a basic cashflow view (in, out, net) over a period. | PLANNED |
| **FIN-CORE-008** | Transactions shall be immutable once approved; corrections shall be compensating entries, never edits. | PLANNED |
| **FIN-CORE-009** | Transactions shall receive configurable business numbers. | PLANNED |
| **FIN-CORE-010** | Financial data shall respect tenant isolation and strict data scope. | PLANNED |
| **FIN-CORE-011** | Authorised users shall operate finance surfaces through the application UI. | PLANNED |

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

## Note on scope discipline

This module must not drift into becoming an accounting package by default. A client that already has an accounting system should be able to use Finance Core for operational cash visibility and integrate the rest through an Extension.
