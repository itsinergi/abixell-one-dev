# ADR-0026: Project Delivery Advanced and Finance Accounting Boundary

- **Status:** ACCEPTED — Founder directive 2026-10-26 authorizes Wave A7 runtime implementation on this boundary
- **Date:** 2026-10-26
- **Source:** Pre-Wave A7 planning decision; follows the ownership pattern established by ADR-0023 (SCM–Finance)

## Context

`PRJ-ADV-006` (earned value management), `PRJ-ADV-007` (project cost control), and
`PRJ-ADV-008` (project accounting) all produce money. Finance Advanced already owns the
Accounting Kernel, the chart of accounts, posting rules, fiscal periods, and consolidation
(ADR-0015, ADR-0016, ADR-0022). Project Delivery owns projects, activities, progress, and
milestones (`PRJ.1–PRJ.4`, migration `1769000000000`).

Without an explicit boundary, Wave A7 would either duplicate the ledger inside Project
Delivery or reach directly into Finance tables. ADR-0023 already answered the same question
for Supply Chain: the consumer domain emits accounting-ready events and the Accounting
Kernel remains the only GL writer. This ADR extends that pattern to project cost.

## Decision

### 1. Project Delivery owns project cost truth; Finance owns ledger truth

Project Delivery owns project budgets, commitments, actual cost accumulation, and progress
measurement. Finance Advanced owns the general ledger. A project cost figure and a GL
balance are different facts that must reconcile; neither is derived from the other's
internal tables.

### 2. The Accounting Kernel stays the single GL writer

Project accounting never inserts journal entries. It emits accounting-ready events through
a port, and the Accounting Kernel validates and posts them. Project Delivery has no direct
read or write access to `journal_entries`, `journal_lines`, `accounting_periods`, or any
chart-of-accounts table.

### 3. Earned value and cost control are advisory computations

`PRJ-ADV-006` and `PRJ-ADV-007` compute planned value, earned value, actual cost, schedule
variance, cost variance, and forecasts. They are deterministic and read-only over recorded
facts. They never mutate budget, commitment, or ledger state. A forecast is not a posting.

### 4. Scheduling math stays out of Core

WBS hierarchy, activity dependencies, critical path, Gantt, resource loading, and baseline
variance are Advanced-only. The Core activity/milestone surface (`PRJ.1–PRJ.4`) is not
altered, and no Core path may require an Advanced table to exist.

### 5. All monetary arithmetic is exact-decimal

Project cost, budget, and earned-value amounts use scaled-integer exact-decimal arithmetic.
No authoritative binary floating point. Rounding is deterministic and residual absorption is
explicit at the statement or period boundary, matching the Finance Advanced convention.

### 6. Data Scope is enforced at SQL level

Every project-cost and earned-value query applies hierarchical Organization Unit Data Scope
through `RbacService` with fail-closed empty-scope semantics, in the query itself rather than
in a post-filter.

## Rejected alternatives

- Letting Project Delivery write journal entries directly.
- Duplicating a project ledger inside Project Delivery and reconciling later.
- Deriving project cost by reading Finance ledger tables.
- Making Core project delivery depend on Advanced scheduling tables.
- Treating an earned-value forecast as an accounting posting.
- Computing cost with binary floating-point arithmetic.

## Consequences

- Project cost and GL balances reconcile through events, not shared tables.
- Wave A7 can be delivered without touching Finance Advanced schema.
- A failed event emission leaves the project record without a posting and must signal, not
  swallow.
- Additional project-accounting dimensions require a Finance policy change, not a Project
  Delivery change.

## Runtime authorization gate

**Cleared 2026-10-26.** The Founder directive to start Wave A7 authorized the cost-ownership
split, the Accounting-Kernel-only posting rule, the advisory-only status of earned value, the
Advanced-only scheduling boundary, and the exact-decimal arithmetic requirement. Runtime
implementation must still carry exact-decimal golden tests, cross-tenant and cross-Legal-Entity
isolation, Data Scope enforcement, RBAC, workflow delegation, and reconciliation tests against
posted journals. Approval alone earns no point: `PRJ-ADV-006/007/008` stay at 0 until the wave's
closure evidence is accepted.

## Related documents

- [Project Delivery Module PRD](../prd/abixell-one/modules/project-delivery.md)
- [Finance Module PRD](../prd/abixell-one/modules/finance.md)
- [ADR-0023: SCM–Finance Ownership Boundary and Accounting-Ready Events](0023-scm-finance-ownership-and-accounting-ready-events.md)
- [ADR-0015: Finance Chart of Accounts and Accounting Schema Governance](0015-finance-coa-and-accounting-schema-governance.md)
- [ADR-0016: Finance Posting, Reversal, and Fiscal Close](0016-finance-posting-reversal-and-fiscal-close.md)
