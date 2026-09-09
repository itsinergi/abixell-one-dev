# ADR-0022: Finance Consolidation and Financial Statements

- **Status:** PROPOSED - Founder decisions incorporated; final document review required
- **Date:** 2026-09-02
- **Source:** Founder Pre-Wave A6 interview decisions: basic governed consolidation and governed standard financial statements

## Context

`FIN-ADV-007` and `FIN-ADV-008` require consolidation across Legal Entities and financial statements. The roadmap does not authorize a full enterprise-consolidation suite, arbitrary report builder, complex ownership accounting, or cross-tenant data plane. The initial boundary must still produce reliable standard statements and a controlled same-tenant consolidation result.

## Decision

### 1. Limit consolidation to a governed basic baseline

The initial consolidation scope supports Legal Entities within the same tenant and authorized consolidation group. Each entity contributes only posted facts from its active primary ledger and approved fiscal periods.

The baseline includes:

- versioned Legal Entity and account mapping to group reporting structures;
- one configured group reporting currency;
- effective-dated exchange-rate sets and deterministic translation policy;
- approved elimination journals for configured intercompany balances and transactions; and
- consolidated trial balance and standard statements with entity and elimination drill-down.

Elimination journals are immutable accounting facts in a governed consolidation context and follow Workflow Engine approval, posting, reversal, and close controls. Consolidation never reads across tenants.

Complex ownership percentages, minority interest, equity accounting, multi-level group hierarchies, and statutory consolidation automation are excluded and require separate authorization.

### 2. Deliver governed standard statements

The initial statement set is:

- Trial Balance;
- Balance Sheet / Statement of Financial Position;
- Profit and Loss / Statement of Profit or Loss;
- Cash Flow Statement;
- General Ledger detail; and
- AP and AR aging.

Statements derive only from immutable posted ledger and open-item facts. Financial Statement Version (FSV) mappings are effective-dated, versioned, approval-gated, and immutable after use for a closed reporting period. Historical reports pin the mapping, ledger, rate, and consolidation versions used.

Cash-flow classification follows governed account and posting-rule mappings. Historical AP/AR aging follows ADR-0017 `asOfDate` semantics rather than current balances.

### 3. Preserve exactness, explainability, and access control

All statement and translation calculations use PostgreSQL `numeric` and exact decimal strings above the database. Translation residuals and elimination differences use explicit configured accounts and deterministic policy.

Every reported total supports drill-down to authorized contributing facts. Tenant isolation, Legal Entity access, RBAC, Data Scope, and document authorization fail closed at query level. Consolidated access does not imply unrestricted source-entity access.

### 4. Prohibit arbitrary financial query execution

Statement definitions use a finite governed metamodel over approved accounts, dimensions, periods, mappings, and aggregations. Wave A6 does not include arbitrary SQL, scripting, expression DSLs, or a generic financial report builder.

## Rejected alternatives

- Cross-tenant consolidation.
- Reporting aggregation with no governed eliminations or version evidence.
- Full enterprise ownership and equity-accounting scope in Wave A6.
- Computing statements from mutable operational balances instead of posted facts.
- Re-running historical reports against today's FSV mappings or exchange rates.
- Adding an arbitrary SQL or custom-expression report designer.

## Consequences

- Wave A6 can produce standard entity and basic group reporting without claiming enterprise consolidation depth.
- Statements remain reproducible for historical periods and explainable down to authorized source facts.
- One-primary-ledger scope remains consistent with ADR-0015; active group or parallel ledgers are not silently introduced.
- Complex consolidation and custom report design remain future separately classified work.
- This decision creates no roadmap weight or denominator change.

## Runtime authorization gate

This proposal does not authorize runtime implementation. Final Founder approval is required for same-tenant group scope, translation, elimination journals, standard statement set, FSV governance, historical version pinning, and excluded enterprise features. Runtime authorization must include exact-decimal translation, deterministic residual, elimination, historical rerun, cross-tenant denial, cross-Legal Entity Data Scope, drill-down authorization, closed-period, performance-bound, and statement-reconciliation tests.

## Related documents

- [Finance Module PRD](../prd/abixell-one/modules/finance.md)
- [ADR-0015: Finance COA and Accounting Schema Governance](0015-finance-coa-and-accounting-schema-governance.md)
- [ADR-0016: Finance Posting, Reversal, and Fiscal Close](0016-finance-posting-reversal-and-fiscal-close.md)
- [ADR-0017: Finance AP/AR Open-Item Settlement](0017-finance-ap-ar-open-item-settlement.md)
- [ADR-0019: Indonesia Taxation Policy and Scope](0019-indonesia-taxation-policy-and-scope.md)
- [ADR-0020: Finance Budget Control and Accounting Dimensions](0020-finance-budget-control-and-accounting-dimensions.md)
- [ADR-0021: Finance Fixed-Asset Accounting and Depreciation](0021-finance-fixed-asset-accounting-and-depreciation.md)
