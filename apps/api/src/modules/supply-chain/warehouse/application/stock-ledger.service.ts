/**
 * Stock Ledger Service (WMS-003).
 *
 * Manages the append-only multi-dimensional stock movement ledger (19 movement types),
 * real-time balance aggregations, and inventory aging reports.
 */
import type { ActorContext } from "../../../../domain/shared-kernel/audit-context.js";
import type {
  RecordScmAdvancedStockMovementInput,
  ScmAdvancedStockBalance,
  ScmAdvancedStockBalanceFilter,
  ScmAdvancedStockMovement,
  ScmAdvancedStockMovementFilter,
  ScmInventoryAgingBucket,
  ScmInventoryAgingFilter,
} from "../../advanced/domain/supply-chain-advanced.entity.js";
import type { SupplyChainAdvancedService } from "../../advanced/application/supply-chain-advanced.service.js";

export class StockLedgerService {
  constructor(private readonly delegate: SupplyChainAdvancedService) {}

  async recordStockMovement(
    actor: ActorContext,
    input: Omit<RecordScmAdvancedStockMovementInput, "createdBy">,
  ): Promise<{ movement: ScmAdvancedStockMovement; balance: ScmAdvancedStockBalance }> {
    return this.delegate.recordStockMovement(actor, input);
  }

  async listStockMovements(
    actor: ActorContext,
    filter?: ScmAdvancedStockMovementFilter,
  ): Promise<ScmAdvancedStockMovement[]> {
    return this.delegate.listStockMovements(actor, filter);
  }

  async getStockBalance(
    actor: ActorContext,
    itemId: string,
    warehouseId: string,
    locationId?: string,
    batchId?: string,
  ): Promise<ScmAdvancedStockBalance | null> {
    return this.delegate.getStockBalance(actor, itemId, warehouseId, locationId, batchId);
  }

  async listStockBalances(
    actor: ActorContext,
    filter?: ScmAdvancedStockBalanceFilter,
  ): Promise<ScmAdvancedStockBalance[]> {
    return this.delegate.listStockBalances(actor, filter);
  }

  async getInventoryAgingReport(
    actor: ActorContext,
    filter?: ScmInventoryAgingFilter,
  ): Promise<ScmInventoryAgingBucket[]> {
    return this.delegate.getInventoryAgingReport(actor, filter);
  }
}
