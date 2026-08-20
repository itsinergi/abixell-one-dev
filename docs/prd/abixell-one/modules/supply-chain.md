# Module PRD — Supply Chain (`SCM-*`)

**PRD v1.0** · Business Core module 6 of 11 · Status: **PLANNED**

> **Core question:** What item exists, how much of it, what moved in and out, and what was purchased from whom?

Vendor/Supplier management is **part of this module** — supplier master is inseparable from purchasing.

## Core requirements

| ID | Requirement | Status |
|---|---|---|
| **SCM-CORE-001** | The system shall maintain an item master per tenant with code, name, category, and unit of measure. | PLANNED |
| **SCM-CORE-002** | The system shall maintain a supplier master per tenant. | PLANNED |
| **SCM-CORE-003** | The system shall maintain a stock balance per item and stock location. | PLANNED |
| **SCM-CORE-004** | The system shall record goods received, increasing stock balance, with reference and evidence. | PLANNED |
| **SCM-CORE-005** | The system shall record goods issued/consumed, decreasing stock balance, with the consuming context where applicable. | PLANNED |
| **SCM-CORE-006** | Stock movements shall be immutable records; corrections shall be new compensating movements, never edits. | PLANNED |
| **SCM-CORE-007** | The system shall support a purchase request with items, quantities, and justification. | PLANNED |
| **SCM-CORE-008** | Purchase requests shall follow a configured approval lifecycle through the Workflow Engine. | PLANNED |
| **SCM-CORE-009** | An approved purchase request shall produce a purchase order to a supplier. | PLANNED |
| **SCM-CORE-010** | Receipt against a purchase order shall create the corresponding goods-received movement. | PLANNED |
| **SCM-CORE-011** | Purchase requests and orders shall receive configurable business numbers. | PLANNED |
| **SCM-CORE-012** | Supply chain records shall respect tenant isolation and data scope. | PLANNED |
| **SCM-CORE-013** | Authorised users shall operate item, supplier, stock, request, and order surfaces through the application UI. | PLANNED |

## Advanced requirements

| ID | Requirement | Status |
|---|---|---|
| **SCM-ADV-001** | Multi-warehouse management. | DEFERRED |
| **SCM-ADV-002** | Bin/location-level stock control. | DEFERRED |
| **SCM-ADV-003** | Batch/lot and serial number tracking. | DEFERRED |
| **SCM-ADV-004** | Reservation, reorder points, transfers, and stock opname (physical count). | DEFERRED |
| **SCM-ADV-005** | Inventory valuation and landed cost. | DEFERRED |
| **SCM-ADV-006** | Advanced procurement: RFQ, tender, bid comparison. | DEFERRED |
| **SCM-ADV-007** | Supplier evaluation and contract purchasing. | DEFERRED |
| **SCM-ADV-008** | Spend analytics. | DEFERRED |

## Client Configuration

Item categories · units of measure · stock locations · supplier categories · approval matrix and thresholds (via workflow) · numbering patterns.

## Client Extension boundary

Client e-procurement/e-catalog platforms and supplier EDI are Extensions.

## Dependencies

Platform Core: workflow (approvals), configuration, numbering, documents, audit, events, RBAC + data scope.
Consumed by: Service Operations (consumables), Asset (spare parts), Finance (expense recognition — Advanced).

## Note on scope discipline

Inventory valuation is deliberately **Advanced**: Core answers *how much exists and what moved*, not *what it is worth*. Valuation requires accounting policy and belongs with Finance Advanced.
