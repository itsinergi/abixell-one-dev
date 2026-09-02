# ADR-0023: SCM–Finance Ownership Boundary and Accounting-Ready Events

- **Status:** ACCEPTED — Founder Wave A5.1 directive (Controlled Full scope)
- **Date:** 2026-09-02
- **Source:** Founder Wave A5.1 directive binding decisions 5, 6, 9, 10, and 15; consistent with the pre-Wave A6 Finance architecture drafts ADR-0015 through ADR-0022; informed by generic enterprise SCM evidence reviewed read-only

## Context

Wave A5 delivered Supply Chain Advanced (`SCM-ADV-001…008`): warehouse topology,
bin locations, batch and serial tracking, an append-only Advanced Stock Ledger,
reservations, transfers, opname, exact-decimal FIFO valuation, landed cost,
RFQ and tender, supplier contracts, and spend analytics.

Wave A5.1 completes the enterprise Supply Chain surface — receiving inspection,
return and reversal, service procurement, procurement policy governance, material
planning, source determination, warehouse execution, logistics, consignment,
aging, and governed disposal. Every one of those capabilities has an accounting
consequence.

Finance Core deliberately records operational cash reality and has no accounting
posting model. Wave A6 proposes the Accounting Kernel: chart of accounts, ledger,
journals, GR/IR, AP invoice, taxation, settlement, fiscal close, and financial
statements. Those proposals remain `PROPOSED` and unauthorized for runtime.

Wave A5.1 therefore sits directly on the seam. Without an explicit contract, two
failure modes are likely: Supply Chain grows a shadow general ledger, or Supply
Chain emits nothing and Wave A6 later has no reliable operational facts to post
from. This ADR fixes the boundary before either happens.

## Decision

### 1. Assign ownership with no overlap

**Supply Chain owns physical and commercial operational truth:**

- stock quantity, availability, and reservation;
- warehouse, storage location, batch, and serial topology;
- immutable stock movements and derived balances;
- stock condition and quarantine state;
- stock ownership attribution, including supplier-owned consignment quantity;
- operational inventory valuation, FIFO layers, and landed-cost allocation;
- receiving, inspection, acceptance, and rejection;
- return to vendor, receipt reversal, and replacement delivery;
- procurement documents, service procurement, and service acceptance;
- procurement policy evaluation and source determination;
- warehouse execution tasks and logistics execution;
- aging exposure and governed disposal execution; and
- **accounting-ready business events** describing all of the above.

**Finance owns accounting truth:**

- chart-of-account resolution and account determination;
- journal generation, posting, and posting-rule versions;
- general ledger and accounting balances;
- GR/IR clearing;
- AP invoice, credit memo, and three-way-match adjudication;
- taxation;
- open-item settlement;
- fiscal period control and close; and
- financial statements and consolidation.

Neither side may implement the other's responsibility. Supply Chain must not
create journals, resolve accounts, compute tax, clear GR/IR, or hold accounting
period state. Finance must not mutate stock quantity, balances, movements,
reservations, or operational valuation layers.

This is consistent with ADR-0016, which already states that operational source
documents remain owned by their modules while the Accounting Kernel owns
accounting truth. This ADR adds the reciprocal obligation: Supply Chain must
publish enough operational fact for that kernel to post from.

### 2. Communicate across the boundary only through accounting-ready events

Supply Chain publishes immutable, append-only **accounting-ready events**. An
event is a factual statement that something operationally real happened. It is
not a journal, carries no account code, and asserts no debit or credit.

The minimum event catalogue is:

| Event type | Operational trigger |
|---|---|
| `inventory.goods_received` | Inspected quantity accepted into own stock |
| `inventory.goods_issued` | Own stock consumed or issued |
| `inventory.transferred` | Own stock moved between warehouses or legal contexts |
| `inventory.adjusted` | Opname or governed adjustment changed own stock |
| `inventory.returned_to_vendor` | Accepted stock returned to the supplier |
| `inventory.receipt_reversed` | A posted receipt was compensated |
| `inventory.landed_cost_applied` | Landed cost allocated onto valuation layers |
| `inventory.consignment_consumed` | Supplier-owned stock consumed; ownership transferred |
| `service.accepted` | Service entry accepted by the business |
| `inventory.disposed` | Governed disposal executed |

Every event record carries:

- immutable event identity and tenant identity;
- source document type, source document identity, and source revision;
- effective date under tenant business-calendar semantics;
- currency and exact-decimal amounts as `numeric` / decimal strings;
- account-assignment dimensions carried from the source document;
- a unique idempotency key;
- a reversal reference where the event compensates an earlier event;
- outbox and reconciliation state; and
- append-only audit timestamps.

Events are persisted into a Supply Chain-owned accounting-ready event store
inside the same database transaction as the operational mutation that caused
them. An event is never recorded for an operation that did not commit, and a
committed operation never fails to record its event.

This requires a deliberate placement decision. The platform's existing
`integration_outbox_deliveries` table is owned by the Integration boundary and
exists to fan domain events out to configured outbound endpoints; it is not a
general accounting journal feed. The platform `EventBus` persists a
`domain_events` row and then dispatches to subscribers in-process and
synchronously, with subscriber exceptions deliberately swallowed so that a
failing subscriber cannot fail the publisher. Neither mechanism, on its own,
guarantees that an accounting-ready fact is written atomically with the stock
mutation it describes.

Supply Chain therefore owns its own append-only accounting-ready event table.
Because the platform has no service-layer unit of work — the transaction
boundary lives inside a single repository method — the event row is written by
the same repository method, and inside the same `BEGIN`/`COMMIT`, as the
movement and balance rows it accompanies. Emitting a domain event on the
`EventBus` afterwards is permitted for observability, but the durable
accounting-ready record is the table, not the bus.

Events are immutable. A wrong event is corrected by a compensating event that
references it, never by editing or deleting.

The idempotency key makes replay safe: re-delivering an event must not create a
second accounting effect downstream.

### 3. Do not implement Finance posting in Wave A5.1

Wave A5.1 delivers the contract and the events. It does not deliver journal
entries, account determination, GR/IR clearing, AP invoice matching, tax
computation, settlement, or fiscal period control.

Where an operational surface needs to show accounting state, it must display
that Finance posting is not owned by Supply Chain and is unavailable, rather
than inventing a local accounting status.

Three-way-match readiness is in scope only as a **normalized immutable
projection** of operational quantities and values — ordered, accepted, returned,
reversed, accepted-service, and invoice-eligible remaining. Adjudicating a match
and posting its result is Finance work and is out of scope.

### 4. Freeze account-assignment dimensions at approval

Every procurement line carries a required account-assignment classification:
`stock`, `expense`, `asset`, `project`, `work_order`, or `service`.

Each classification declares which additional dimensions are mandatory —
organization or site, warehouse, cost center, project reference, asset
reference, or work-order reference. Validation is driven by that declaration
rather than by hardcoded per-type branches.

Only the `stock` classification creates inventory. Non-stock classifications are
consumed at acceptance and produce an accounting-ready event without an
inventory balance effect.

Authoritative assignment is frozen when the governed purchase order is approved.
Dimensions then propagate immutably down the chain — order line, receipt line,
stock movement, accounting-ready event — so a later master-data change cannot
retroactively alter the meaning of a historical event. Changing a frozen
assignment requires a governed revision or change workflow.

### 5. Gate availability on inspection, and separate ownership from custody

Received quantity is not available quantity. Stock carries an explicit condition,
and only unrestricted condition contributes to availability. Quarantined, blocked,
and rejected quantities are held in custody but cannot be reserved or issued.
Release from inspection is a quantity-neutral movement pair, never an update in
place.

Stock also carries explicit ownership. Supplier-owned consignment stock is held
in the same physical topology as own stock but is attributed to its consignor and
is excluded from company inventory valuation. Receipt of consignment stock
creates no liability and no company-owned valuation layer.

Ownership transfers at **consumption**, not at receipt. Consumption atomically
transfers ownership and consumes, emits `inventory.consignment_consumed`, and
creates settlement eligibility for Finance. Unconsumed consignment stock is
returned as a quantity-only movement with no accounting consequence.

### 6. Keep advisory planning strictly advisory

Material planning and source or substitution recommendations produce immutable,
versioned recommendation snapshots. They never create a purchase order, never
execute a transfer, and never mutate inventory. Conversion into an executable
document is always a governed human action.

Recommendations are invalidated when the demand, stock, incoming supply, policy,
or source data they were computed from changes. A stale recommendation must be
rejected at conversion time rather than silently executed.

Automatic material substitution is prohibited. A substitution may only be
recommended and must pass governed approval before use.

### 7. Preserve the existing platform invariants

Every capability in Wave A5.1 remains bound by the invariants already enforced
across the platform: tenant isolation with composite tenant-safe foreign keys;
centralized hierarchical Organization Unit Data Scope that fails closed;
server-side permission enforcement with migration-owned permissions; Workflow
Engine as the single lifecycle authority for governed documents with no competing
local state machine; append-only ledgers corrected only by compensating
movements; exact-decimal arithmetic with no authoritative JavaScript
floating-point; transactional and row-locked concurrency control; bounded list
and analytics queries; privacy-safe projections; and audit evidence on
significant mutations.

## Rejected alternatives

- Letting Supply Chain post journals or resolve accounts directly.
- Letting Finance mutate stock balances, movements, or valuation layers.
- Storing accounting state as columns on operational documents and treating them
  as the ledger.
- Emitting accounting events outside the operational transaction, which permits
  committed stock changes with no accounting consequence.
- Reusing `integration_outbox_deliveries` as the accounting feed, which would
  overload an Integration-owned delivery queue with accounting semantics.
- Relying on `EventBus` subscribers alone, whose dispatch is in-process and
  whose failures are deliberately swallowed, to create accounting facts.
- Making received quantity immediately available and handling rejection later as
  an adjustment.
- Modelling consignment as a separate warehouse or location, which
  misrepresents physical custody and breaks bin-level truth.
- Creating a payable at consignment receipt rather than at consumption.
- Re-deriving account-assignment dimensions at posting time instead of freezing
  them at approval.
- Allowing planning output to create or mutate executable documents
  automatically.
- Allowing automatic material substitution without governed approval.
- Adopting SAP movement-type numbers, item-category letters, transaction codes,
  or client-specific account and organization coding as canonical design.

## Consequences

- Supply Chain can complete its enterprise surface without waiting for the
  Accounting Kernel, and without accreting a shadow ledger.
- Wave A6 receives a stable, immutable, idempotent, reconcilable operational
  fact stream and does not need to re-derive history from mutable documents.
- Availability, ownership, and valuation become independently correct concepts
  rather than one conflated quantity.
- Three-way-match adjudication, GR/IR, and tax remain cleanly unimplemented
  rather than half-implemented in the wrong module.
- Operational surfaces must explicitly represent that Finance posting state is
  not owned here, which is honest rather than convenient.
- Adding a new accounting-ready event type later is an additive contract change,
  not a schema rewrite.

## Scope boundary

This ADR authorizes the Wave A5.1 operational contract and event emission only.

It does not authorize, and Wave A5.1 does not deliver: Finance journal posting,
chart of accounts, general ledger, GR/IR clearing, AP invoice or credit memo,
taxation, settlement, fiscal period control, financial statements, or
consolidation. Those remain governed by ADR-0015 through ADR-0022 and require
separate Wave A6 authorization.

It also does not authorize offline execution runtime, mining or other industry
packs, Platform Builder, Module Manifest runtime, dynamic packages or plugins,
arbitrary SQL editing, scripting runtimes, or Client Extensions.

Wave A5.1 is an unweighted enterprise-completion phase. It adds no capability
weight, no roadmap numerator, and no roadmap denominator.

## Related documents

- [Supply Chain Module PRD](../prd/abixell-one/modules/supply-chain.md)
- [Finance Module PRD](../prd/abixell-one/modules/finance.md)
- [ADR-0012: Document Follows Parent Entity Authorization](0012-document-follows-parent-entity-authorization.md)
- [ADR-0015: Finance COA and Accounting Schema Governance](0015-finance-coa-and-accounting-schema-governance.md)
- [ADR-0016: Finance Posting, Reversal, and Fiscal Close](0016-finance-posting-reversal-and-fiscal-close.md)
- [ADR-0017: Finance AP/AR Open-Item Settlement](0017-finance-ap-ar-open-item-settlement.md)
- [ADR-0020: Finance Budget Control and Accounting Dimensions](0020-finance-budget-control-and-accounting-dimensions.md)
