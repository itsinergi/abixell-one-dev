/**
 * Returns, Reversals & Replacements Service (WMS-008).
 *
 * Manages post-receiving exceptions: Return to Vendor (RTV), compensating
 * receipt reversals (idempotent, single reversal invariant), and replacement
 * deliveries. Emits accounting-ready events for goods returned and reversed.
 */
import type { ActorContext } from "../../../../domain/shared-kernel/audit-context.js";
import type {
  CreateScmReceiptReversalInput,
  CreateScmReplacementDeliveryInput,
  CreateScmReturnToVendorInput,
  ScmReceiptReversal,
  ScmReceiptReversalLine,
  ScmReplacementDelivery,
  ScmReplacementDeliveryFilter,
  ScmReplacementDeliveryLine,
  ScmReturnToVendor,
  ScmReturnToVendorFilter,
  ScmReturnToVendorLine,
} from "../../advanced/domain/supply-chain-advanced.entity.js";
import type { SupplyChainAdvancedService } from "../../advanced/application/supply-chain-advanced.service.js";

export class ReturnsReversalsService {
  constructor(private readonly delegate: SupplyChainAdvancedService) {}

  async createReturnToVendor(
    actor: ActorContext,
    input: Omit<CreateScmReturnToVendorInput, "returnNumber" | "createdBy"> & { returnNumber?: string },
  ): Promise<{ returnToVendor: ScmReturnToVendor; lines: ScmReturnToVendorLine[] }> {
    return this.delegate.createReturnToVendor(actor, input);
  }

  async getReturnToVendor(
    actor: ActorContext,
    returnToVendorId: string,
  ): Promise<{ returnToVendor: ScmReturnToVendor; lines: ScmReturnToVendorLine[] }> {
    return this.delegate.getReturnToVendor(actor, returnToVendorId);
  }

  async listReturnToVendors(
    actor: ActorContext,
    filter?: ScmReturnToVendorFilter,
  ): Promise<ScmReturnToVendor[]> {
    return this.delegate.listReturnToVendors(actor, filter);
  }

  async createReceiptReversal(
    actor: ActorContext,
    input: Omit<CreateScmReceiptReversalInput, "reversalNumber" | "createdBy"> & { reversalNumber?: string },
  ): Promise<{ reversal: ScmReceiptReversal; lines: ScmReceiptReversalLine[] }> {
    return this.delegate.createReceiptReversal(actor, input);
  }

  async getReceiptReversalByReceivingRecord(
    actor: ActorContext,
    receivingRecordId: string,
  ): Promise<{ reversal: ScmReceiptReversal; lines: ScmReceiptReversalLine[] } | null> {
    return this.delegate.getReceiptReversalByReceivingRecord(actor, receivingRecordId);
  }

  async createReplacementDelivery(
    actor: ActorContext,
    input: Omit<CreateScmReplacementDeliveryInput, "replacementNumber" | "createdBy"> & { replacementNumber?: string },
  ): Promise<{ replacement: ScmReplacementDelivery; lines: ScmReplacementDeliveryLine[] }> {
    return this.delegate.createReplacementDelivery(actor, input);
  }

  async getReplacementDelivery(
    actor: ActorContext,
    replacementDeliveryId: string,
  ): Promise<{ replacement: ScmReplacementDelivery; lines: ScmReplacementDeliveryLine[] }> {
    return this.delegate.getReplacementDelivery(actor, replacementDeliveryId);
  }

  async listReplacementDeliveries(
    actor: ActorContext,
    filter?: ScmReplacementDeliveryFilter,
  ): Promise<ScmReplacementDelivery[]> {
    return this.delegate.listReplacementDeliveries(actor, filter);
  }
}
