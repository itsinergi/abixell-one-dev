/**
 * Transfer & Opname Service (WMS-005).
 *
 * Manages inter-warehouse transfers (draft -> workflow approval -> ship -> receive)
 * and physical stock opnames/cycle counts.
 */
import type { ActorContext } from "../../../../domain/shared-kernel/audit-context.js";
import type { EntityWorkflowStatus } from "../../../../application/workflow/workflow.service.js";
import type {
  CreateScmStockOpnameInput,
  CreateScmStockTransferInput,
  RecordScmStockOpnameCountInput,
  RecordScmStockTransferReceiptInput,
  RecordScmStockTransferShipmentInput,
  ScmStockOpname,
  ScmStockOpnameFilter,
  ScmStockOpnameLine,
  ScmStockTransfer,
  ScmStockTransferFilter,
} from "../../advanced/domain/supply-chain-advanced.entity.js";
import type {
  StockOpnameDetailView,
  StockTransferDetailView,
  SupplyChainAdvancedService,
} from "../../advanced/application/supply-chain-advanced.service.js";

export class TransferOpnameService {
  constructor(private readonly delegate: SupplyChainAdvancedService) {}

  async createStockTransfer(
    actor: ActorContext,
    input: Omit<CreateScmStockTransferInput, "createdBy" | "transferNumber"> & { transferNumber?: string },
  ): Promise<StockTransferDetailView> {
    return this.delegate.createStockTransfer(actor, input);
  }

  async getStockTransfer(
    actor: ActorContext,
    transferId: string,
  ): Promise<StockTransferDetailView> {
    return this.delegate.getStockTransfer(actor, transferId);
  }

  async listStockTransfers(
    actor: ActorContext,
    filter?: ScmStockTransferFilter,
  ): Promise<Array<{ transfer: ScmStockTransfer; status: EntityWorkflowStatus | null }>> {
    return this.delegate.listStockTransfers(actor, filter);
  }

  async actOnStockTransfer(
    actor: ActorContext,
    transferId: string,
    action: string,
    comment?: string,
  ): Promise<StockTransferDetailView> {
    return this.delegate.actOnStockTransfer(actor, transferId, action, comment);
  }

  async recordStockTransferShipment(
    actor: ActorContext,
    input: RecordScmStockTransferShipmentInput,
  ): Promise<StockTransferDetailView> {
    return this.delegate.recordStockTransferShipment(actor, input);
  }

  async recordStockTransferReceipt(
    actor: ActorContext,
    input: RecordScmStockTransferReceiptInput,
  ): Promise<StockTransferDetailView> {
    return this.delegate.recordStockTransferReceipt(actor, input);
  }

  async createStockOpname(
    actor: ActorContext,
    input: Omit<CreateScmStockOpnameInput, "createdBy" | "opnameNumber"> & { opnameNumber?: string },
  ): Promise<StockOpnameDetailView> {
    return this.delegate.createStockOpname(actor, input);
  }

  async recordStockOpnameCount(
    actor: ActorContext,
    input: RecordScmStockOpnameCountInput,
  ): Promise<ScmStockOpnameLine> {
    return this.delegate.recordStockOpnameCount(actor, input);
  }

  async getStockOpname(
    actor: ActorContext,
    opnameId: string,
  ): Promise<StockOpnameDetailView> {
    return this.delegate.getStockOpname(actor, opnameId);
  }

  async listStockOpnames(
    actor: ActorContext,
    filter?: ScmStockOpnameFilter,
  ): Promise<Array<{ opname: ScmStockOpname; status: EntityWorkflowStatus | null }>> {
    return this.delegate.listStockOpnames(actor, filter);
  }

  async actOnStockOpname(
    actor: ActorContext,
    opnameId: string,
    action: string,
    comment?: string,
  ): Promise<StockOpnameDetailView> {
    return this.delegate.actOnStockOpname(actor, opnameId, action, comment);
  }
}
