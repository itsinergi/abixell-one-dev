/**
 * Inventory Disposal Service (WMS-010).
 *
 * Manages inventory write-off, scrap, and donation disposal lifecycles
 * governed by the workflow engine. Emits accounting-ready write-off events.
 */
import type { ActorContext } from "../../../../domain/shared-kernel/audit-context.js";
import type { EntityWorkflowStatus } from "../../../../application/workflow/workflow.service.js";
import type {
  CreateScmInventoryDisposalInput,
  ScmInventoryDisposal,
  ScmInventoryDisposalFilter,
  ScmInventoryDisposalLine,
} from "../../advanced/domain/supply-chain-advanced.entity.js";
import type { SupplyChainAdvancedService } from "../../advanced/application/supply-chain-advanced.service.js";

export class DisposalService {
  constructor(private readonly delegate: SupplyChainAdvancedService) {}

  async createInventoryDisposal(
    actor: ActorContext,
    input: Omit<CreateScmInventoryDisposalInput, "disposalNumber" | "createdBy"> & { disposalNumber?: string },
  ): Promise<{ disposal: ScmInventoryDisposal; lines: ScmInventoryDisposalLine[] }> {
    return this.delegate.createInventoryDisposal(actor, input);
  }

  async getInventoryDisposal(
    actor: ActorContext,
    disposalId: string,
  ): Promise<{ disposal: ScmInventoryDisposal; lines: ScmInventoryDisposalLine[] }> {
    return this.delegate.getInventoryDisposal(actor, disposalId);
  }

  async listInventoryDisposals(
    actor: ActorContext,
    filter?: ScmInventoryDisposalFilter,
  ): Promise<Array<{ disposal: ScmInventoryDisposal; status: EntityWorkflowStatus | null }>> {
    return this.delegate.listInventoryDisposals(actor, filter);
  }

  async submitInventoryDisposal(
    actor: ActorContext,
    disposalId: string,
    comment?: string,
  ): Promise<{ disposal: ScmInventoryDisposal; lines: ScmInventoryDisposalLine[] }> {
    return this.delegate.submitInventoryDisposal(actor, disposalId, comment);
  }

  async approveInventoryDisposal(
    actor: ActorContext,
    disposalId: string,
    comment?: string,
  ): Promise<{ disposal: ScmInventoryDisposal; lines: ScmInventoryDisposalLine[] }> {
    return this.delegate.approveInventoryDisposal(actor, disposalId, comment);
  }
}
