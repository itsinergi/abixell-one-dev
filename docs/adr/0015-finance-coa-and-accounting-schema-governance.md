# ADR-0015: Finance Chart of Accounts and Accounting Schema Governance

- **Status:** PROPOSED - Founder decisions incorporated; final document review required
- **Date:** 2026-09-02
- **Source:** Founder Pre-Wave A6 interview decision: three-layer COA and one active primary ledger with multi-ledger readiness; informed by local NATS, SAP KBU, iDempiere, and finance research material

## Context

Wave A6 proposes full accounting depth, beginning with chart of accounts (COA), general ledger, and journals. Finance Core currently records operational cash reality and deliberately has no accounting posting model. The Advanced design therefore needs an explicit boundary between reusable accounting mechanics, an Indonesia-oriented default, and industry- or client-specific configuration.

The SAP KBU material demonstrates useful controls such as reconciliation accounts, open-item management, tax categories, automatic-only posting, currency restrictions, cash-flow relevance, and financial-statement mapping. Its account list and historical configuration are client-specific evidence, not a canonical Abixell One template. NATS and other references similarly provide functional evidence but cannot be copied as authoritative schema or policy.

## Decision

### 1. Use three governed COA layers

Finance Advanced will distinguish:

1. **Accounting Kernel** - generic account, accounting-schema, ledger, dimension, posting-control, and reporting contracts.
2. **Indonesia General Business COA Baseline** - the default versioned template for Indonesian legal entities.
3. **Industry Pack or client overlay** - optional additions and mappings, including a future **Mining Industry COA Pack** informed by KBU patterns without copying its client account master.

The Indonesia baseline uses these generic top-level groups:

| Group | Classification |
|---:|---|
| 1 | Assets |
| 2 | Liabilities |
| 3 | Equity |
| 4 | Revenue |
| 5 | Cost of Goods Sold / Cost of Revenue |
| 6 | Operating Expenses |
| 7 | Other Income / Expenses |
| 8 | Tax / Comprehensive Income |
| 9 | Statistical / Memorandum |

Account codes are configurable up to 10 digits. Legal Entity, Site, Project, Cost Center, and Account remain separate accounting dimensions and must not be encoded into the account number.

### 2. Govern account behavior explicitly

Each posting account must define, where applicable:

- account type and normal balance;
- header, control, or posting behavior;
- reconciliation type and open-item management;
- currency policy;
- tax category;
- manual-posting or automatic-only control;
- financial-statement-version mapping;
- cash-flow classification;
- legal-entity applicability; and
- effective date, version, approval, and immutable-after-use state.

Customer and vendor reconciliation accounts are control accounts and are not manually postable. Changes that would alter historical interpretation create a new effective-dated version rather than modifying an account version already used by a posting.

### 3. Separate Accounting Schema and Ledger

An **Accounting Schema** defines accounting policy, calendar, base currency, precision, dimensions, and posting rules. A **Ledger** stores posting facts under one schema and legal-entity context.

The initial Wave A6 boundary is **one active primary ledger per Legal Entity**. Contracts, identifiers, posting references, and reporting queries must remain multi-ledger ready, but secondary, parallel, tax, or group ledgers are not activated by the initial implementation authorization. Adding an active secondary ledger requires separate Founder approval and compatibility evidence.

The accounting ledger becomes authoritative for accounting balances. Finance Core cash balances remain operational projections and must reconcile through owned application services rather than becoming independently editable accounting truth.

### 4. Preserve exact-decimal invariants

All monetary values use PostgreSQL `numeric` and exact decimal strings above the database. No accounting amount, exchange rate, allocation, tax, or reporting total may pass through JavaScript binary floating-point arithmetic. Rounding and deterministic residual absorption are explicit policy.

## Rejected alternatives

- Copying the SAP KBU account list, client codes, historical tax setup, or schema directly.
- Maintaining one universal flat COA with no accounting schema or legal-entity applicability.
- Encoding company, site, project, or cost center into the account number.
- Allowing posted account definitions to be edited in place.
- Treating Finance Core cash accounts as a complete general ledger.
- Using JavaScript `number` for accounting arithmetic.

## Consequences

- Abixell One can provide a practical Indonesia-first baseline without coupling the kernel to one client or industry.
- Mining-specific accounts become an optional governed pack, not part of the mandatory general-business COA.
- Reporting, tax, reconciliation, AP/AR, assets, budgeting, and project accounting can share stable dimensions and posting controls.
- Initial delivery avoids premature multi-ledger complexity while preserving a governed compatibility seam.
- Template contents, migration design, permissions, APIs, and UI remain unauthorized until a separate Wave A6 implementation approval.

## Runtime authorization gate

This proposal does not authorize runtime implementation. The Founder interview selected the COA layering and one-primary-ledger boundary, but final approval of this document is still required. The implementation plan must then define migration ownership, tenant and Legal Entity isolation, RBAC, Data Scope, audit, tests, rollback, multi-ledger compatibility checks, and template-governance evidence.

## Related documents

- [Finance Module PRD](../prd/abixell-one/modules/finance.md)
- [Roadmap to 100%](../ROADMAP-TO-100.md)
- [ADR-0016: Finance Posting, Reversal, and Fiscal Close](0016-finance-posting-reversal-and-fiscal-close.md)
- [ADR-0017: Finance AP/AR Open-Item Settlement](0017-finance-ap-ar-open-item-settlement.md)
- [ADR-0019: Indonesia Taxation Policy and Scope](0019-indonesia-taxation-policy-and-scope.md)
- [ADR-0020: Finance Budget Control and Accounting Dimensions](0020-finance-budget-control-and-accounting-dimensions.md)
- [ADR-0021: Finance Fixed-Asset Accounting and Depreciation](0021-finance-fixed-asset-accounting-and-depreciation.md)
- [ADR-0022: Finance Consolidation and Financial Statements](0022-finance-consolidation-and-financial-statements.md)
