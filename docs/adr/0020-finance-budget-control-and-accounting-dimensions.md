# ADR-0020: Finance Budget Control and Accounting Dimensions

- **Status:** APPROVED - Founder final document review 2026-10-24 (all eight Wave A6 ADRs approved together); implementation authorized
- **Date:** 2026-09-02
- **Source:** Founder Pre-Wave A6 interview decision: configurable advisory, escalation, or hard-stop budget control

## Context

`FIN-ADV-003` requires budgeting and cost centers. A budget model that only stores annual numbers cannot govern operational commitments, while a universal hard stop would be unsafe for emergency or policy-exception scenarios. Budget control must also align with the accounting dimensions selected in ADR-0015 instead of creating a second cost-center or project hierarchy.

## Decision

### 1. Reuse governed accounting dimensions

Budget lines use the same Legal Entity, Account, Cost Center, Project, Site, and other approved dimensions as accounting postings. Cost Center remains a separate dimension and is never encoded into a COA number. Dimension combinations are tenant- and Legal Entity-scoped, effective-dated, and validated before budget approval or consumption.

### 2. Use versioned budget baselines

A budget has fiscal year, period distribution, currency, scenario, dimension scope, owner, and immutable version. Draft revisions use the Workflow Engine for maker-checker approval. Only one approved baseline version may be active for the same governed budget scope and effective period; revisions supersede rather than edit the active version.

All monetary values use exact decimal strings above PostgreSQL `numeric`. Period distribution and allocation absorb residuals deterministically.

### 3. Configure control behavior per policy

Each budget-control policy selects one of these effects:

- **advisory** - record and display the variance without blocking;
- **approval escalation** - require an additional Workflow Engine approval path; or
- **hard stop** - reject the controlled action when available budget is insufficient.

Policy may vary by Legal Entity, account range, cost center, project, document type, amount threshold, and effective date. There is no universal hard-stop default and no caller-controlled bypass.

### 4. Distinguish actual, committed, and available budget

Actual consumption derives from immutable posted accounting facts. Committed consumption may derive from approved purchase, project, or other authorized source documents through owned application services. Available budget is a deterministic projection of approved baseline, actuals, commitments, releases, and approved adjustments.

Consumption and release operations are idempotent and concurrency-safe. Source cancellation or reversal creates a compensating release; it does not delete history.

## Rejected alternatives

- Maintaining a Finance-only cost-center tree separate from the accounting dimensions.
- Encoding cost center or project into account codes.
- Allowing approved budget baselines to be edited in place.
- Advisory-only behavior for every client and document type.
- Universal hard-stop behavior with no escalation or governed exception path.
- Checking budget availability only in application memory.

## Consequences

- Clients can adopt gradual budget governance without changing the accounting model.
- Budget reports can reconcile approved baseline, commitments, actuals, and releases.
- Procurement and Project integrations must enter through owned services and cannot mutate budget balances directly.
- Forecasting, rolling-budget automation, and arbitrary planning formulas remain outside this proposed baseline.

## Runtime authorization gate

This proposal does not authorize runtime implementation. Final Founder approval is required for dimension reuse, versioning, the three policy effects, commitment sources, and available-budget semantics. Runtime authorization must include exact-decimal, concurrent consumption, release/reversal, stale-version, cross-tenant, cross-Legal Entity, Data Scope, RBAC, Workflow escalation, and hard-stop negative tests.

## Related documents

- [Finance Module PRD](../prd/abixell-one/modules/finance.md)
- [ADR-0015: Finance COA and Accounting Schema Governance](0015-finance-coa-and-accounting-schema-governance.md)
- [ADR-0016: Finance Posting, Reversal, and Fiscal Close](0016-finance-posting-reversal-and-fiscal-close.md)
- [ADR-0022: Finance Consolidation and Financial Statements](0022-finance-consolidation-and-financial-statements.md)
