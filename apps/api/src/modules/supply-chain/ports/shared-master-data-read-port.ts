/**
 * SharedMasterDataReadPort — Anti-Corruption Layer (ACL).
 *
 * Read-only port that decouples the Warehouse Management (WMS) and
 * Procurement Management bounded contexts from the Shared Master Data
 * context (Items, Suppliers, Purchase Requests, Purchase Orders, and
 * Account Assignment Configs).
 *
 * Contract discipline (ADR-0023 SCM-Finance boundary):
 *  - WMS reads an ISSUED Purchase Order via {@link getPurchaseOrder} to
 *    validate the receiving gate, then atomically increments
 *    `quantity_received` on the matched PO line inside a Unit of Work.
 *  - Procurement reads Item/Supplier masters to populate RFQ invitations,
 *    bid scoring, contracts, and Service Entry Sheets.
 *  - Neither context owns or mutates master-data lifecycle (create/update/
 *    delete); those writes stay in the Shared Master Data context. This
 *    port exposes only a *read* surface plus the single PO-line receive
 *    increment that the ADR-0023 hand-off requires.
 *
 * Implementations live in the Shared Master Data infrastructure layer
 * (e.g. `PgSharedMasterDataReadPort` backed by a `pg` Pool). The port is
 * injected into WMS/Procurement services through their constructors so
 * tests can substitute an in-memory fake.
 */
import type { PoolClient } from "pg";
import type {
  Item,
  Supplier,
  PurchaseRequest,
  PurchaseRequestLine,
  PurchaseOrder,
  PurchaseOrderLine,
  PurchaseOrderState,
} from "../core/domain/supply-chain.entity.js";

export interface PurchaseOrderWithLines {
  order: PurchaseOrder;
  lines: PurchaseOrderLine[];
  state: PurchaseOrderState;
}

export interface SharedMasterDataReadPort {
  // ---- Item Master ---------------------------------------------------------
  getItem(tenantId: string, itemId: string): Promise<Item | null>;
  getItemByCode(tenantId: string, code: string): Promise<Item | null>;
  listItems(
    tenantId: string,
    filter?: { isActive?: boolean; category?: string | null },
  ): Promise<Item[]>;

  // ---- Supplier Master ----------------------------------------------------
  getSupplier(tenantId: string, supplierId: string): Promise<Supplier | null>;
  getSupplierByCode(tenantId: string, code: string): Promise<Supplier | null>;
  listSuppliers(
    tenantId: string,
    filter?: { isActive?: boolean; category?: string | null },
  ): Promise<Supplier[]>;

  // ---- Purchase Requests --------------------------------------------------
  getPurchaseRequest(
    tenantId: string,
    purchaseRequestId: string,
  ): Promise<{ request: PurchaseRequest; lines: PurchaseRequestLine[] } | null>;

  // ---- Purchase Orders (the PO -> Receiving hand-off) ----------------------
  /** Fetch a PO with its lines and derived state. WMS uses this at the
   *  receiving gate to validate that the PO is ISSUED and to match
   *  incoming quantities against `quantityOrdered - quantityReceived`. */
  getPurchaseOrder(
    tenantId: string,
    purchaseOrderId: string,
  ): Promise<PurchaseOrderWithLines | null>;

  listPurchaseOrders(
    tenantId: string,
    filter?: {
      supplierId?: string;
      state?: PurchaseOrderState;
    },
  ): Promise<PurchaseOrderWithLines[]>;

  // ---- PO line receive increment (ADR-0023 hand-off) ----------------------
  /** Atomically increment `quantity_received` on a single PO line and
   *  return the updated line. Must be invoked *inside* the caller's
   *  Unit of Work transaction so the stock movement + FIFO layer + PO
   *  update commit together or roll back together. */
  incrementPurchaseOrderLineReceived(
    client: PoolClient,
    tenantId: string,
    purchaseOrderLineId: string,
    deltaReceived: number,
  ): Promise<PurchaseOrderLine>;

  // ---- Account Assignment Configs ----------------------------------------
  /** Resolve the enforced account-assignment rules for a given assignment
   *  type (stock / expense / asset / project / work_order / service).
   *  WMS and Procurement consult this before freezing dimensions on a
   *  movement or Service Entry Sheet line. */
  getAccountAssignmentConfig(
    tenantId: string,
    assignmentType: string,
  ): Promise<AccountAssignmentConfigView | null>;
}

/** Read-only projection of `scm_account_assignment_configs`. */
export interface AccountAssignmentConfigView {
  id: string;
  tenantId: string;
  assignmentType: string;
  /** Dimension keys that must be populated (e.g. ["cost_center","project"]). */
  requiredDimensions: string[];
  /** Dimensions that may be left null. */
  optionalDimensions: string[];
  isActive: boolean;
}
