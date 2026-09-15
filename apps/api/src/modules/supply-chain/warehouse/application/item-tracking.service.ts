/**
 * Item Tracking Service (WMS-002).
 *
 * Manages item lot/batch and serial number lifecycle, expiry dates, and serialization.
 */
import type { ActorContext } from "../../../../domain/shared-kernel/audit-context.js";
import type {
  CreateScmItemBatchInput,
  CreateScmItemSerialInput,
  ScmItemBatch,
  ScmItemBatchListFilter,
  ScmItemSerial,
  ScmItemSerialListFilter,
  UpdateScmItemSerialInput,
} from "../../advanced/domain/supply-chain-advanced.entity.js";
import type { SupplyChainAdvancedService } from "../../advanced/application/supply-chain-advanced.service.js";

export class ItemTrackingService {
  constructor(private readonly delegate: SupplyChainAdvancedService) {}

  async createBatch(
    actor: ActorContext,
    input: Omit<CreateScmItemBatchInput, "createdBy" | "batchNumber"> & { batchNumber?: string },
  ): Promise<ScmItemBatch> {
    return this.delegate.createBatch(actor, input);
  }

  async getBatch(actor: ActorContext, batchId: string): Promise<ScmItemBatch> {
    return this.delegate.getBatch(actor, batchId);
  }

  async listBatches(
    actor: ActorContext,
    filter?: ScmItemBatchListFilter,
  ): Promise<ScmItemBatch[]> {
    return this.delegate.listBatches(actor, filter);
  }

  async createSerial(
    actor: ActorContext,
    input: Omit<CreateScmItemSerialInput, "createdBy">,
  ): Promise<ScmItemSerial> {
    return this.delegate.createSerial(actor, input);
  }

  async updateSerial(
    actor: ActorContext,
    serialId: string,
    input: UpdateScmItemSerialInput,
  ): Promise<ScmItemSerial> {
    return this.delegate.updateSerial(actor, serialId, input);
  }

  async getSerial(actor: ActorContext, serialId: string): Promise<ScmItemSerial> {
    return this.delegate.getSerial(actor, serialId);
  }

  async listSerials(
    actor: ActorContext,
    filter?: ScmItemSerialListFilter,
  ): Promise<ScmItemSerial[]> {
    return this.delegate.listSerials(actor, filter);
  }
}
