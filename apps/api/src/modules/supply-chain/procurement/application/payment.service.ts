/**
 * Payment Service (WP-PRO-03).
 *
 * Manages AP payment batches for vendor invoices: batch creation, approval
 * workflow, GL posting via accounting-ready events, and audit trail.
 */
import type { ActorContext } from "../../../../domain/shared-kernel/audit-context.js";
import type {
  CreateScmPaymentBatchInput,
  ScmPaymentBatch,
  ScmPaymentBatchFilter,
  ScmPaymentLine,
} from "../../advanced/domain/supply-chain-advanced.entity.js";
import type { SupplyChainAdvancedService } from "../../advanced/application/supply-chain-advanced.service.js";

export class PaymentService {
  constructor(private readonly delegate: SupplyChainAdvancedService) {}

  async createPaymentBatch(
    actor: ActorContext,
    input: Omit<CreateScmPaymentBatchInput, "batchNumber" | "createdBy"> & {
      batchNumber?: string;
    },
  ): Promise<{ paymentBatch: ScmPaymentBatch; lines: ScmPaymentLine[] }> {
    return this.delegate.createPaymentBatch(actor, input);
  }

  async getPaymentBatch(
    actor: ActorContext,
    batchId: string,
  ): Promise<{ paymentBatch: ScmPaymentBatch; lines: ScmPaymentLine[] }> {
    return this.delegate.getPaymentBatch(actor, batchId);
  }

  async listPaymentBatches(
    actor: ActorContext,
    filter: ScmPaymentBatchFilter = {},
  ): Promise<ScmPaymentBatch[]> {
    return this.delegate.listPaymentBatches(actor, filter);
  }

  async submitPaymentBatch(
    actor: ActorContext,
    batchId: string,
    comment?: string,
  ): Promise<{ paymentBatch: ScmPaymentBatch; lines: ScmPaymentLine[] }> {
    return this.delegate.submitPaymentBatch(actor, batchId, comment);
  }

  /**
   * Approves a payment batch. Enforces nominal-limit gate (DEC-004-FU),
   * emits per-line `vendor.invoice.payment_approved` accounting-ready events
   * to the outbox for GL posting, and records the approval in the audit trail.
   */
  async approvePaymentBatch(
    actor: ActorContext,
    batchId: string,
    comment?: string,
  ): Promise<{ paymentBatch: ScmPaymentBatch; lines: ScmPaymentLine[] }> {
    return this.delegate.approvePaymentBatch(actor, batchId, comment);
  }

  async cancelPaymentBatch(
    actor: ActorContext,
    batchId: string,
    reason?: string,
  ): Promise<{ paymentBatch: ScmPaymentBatch; lines: ScmPaymentLine[] }> {
    return this.delegate.cancelPaymentBatch(actor, batchId, reason);
  }
}
