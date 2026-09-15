/**
 * Supplier Contract Service (PROC-003).
 *
 * Manages master/blanket purchase contracts, fixed price and service rate
 * agreements, and tracks committed spend against contracted value ceilings.
 */
import type { ActorContext } from "../../../../domain/shared-kernel/audit-context.js";
import type { EntityWorkflowAction, EntityWorkflowStatus } from "../../../../application/workflow/workflow.service.js";
import type {
  CreateScmSupplierContractInput,
  ScmSupplierContract,
  ScmSupplierContractFilter,
  ScmSupplierContractItem,
} from "../../advanced/domain/supply-chain-advanced.entity.js";
import type { SupplyChainAdvancedService } from "../../advanced/application/supply-chain-advanced.service.js";

export interface SupplierContractDetailView {
  contract: ScmSupplierContract;
  items: ScmSupplierContractItem[];
  status: EntityWorkflowStatus | null;
  availableActions: EntityWorkflowAction[];
}

export class SupplierContractService {
  constructor(private readonly delegate: SupplyChainAdvancedService) {}

  async createSupplierContract(
    actor: ActorContext,
    input: Omit<CreateScmSupplierContractInput, "createdBy" | "contractNumber"> & {
      contractNumber?: string;
    },
  ): Promise<SupplierContractDetailView> {
    return this.delegate.createSupplierContract(actor, input);
  }

  async recordContractSpend(
    actor: ActorContext,
    contractId: string,
    additionalSpentAmount: number,
  ): Promise<SupplierContractDetailView> {
    return this.delegate.recordContractSpend(actor, contractId, additionalSpentAmount);
  }

  async getSupplierContract(
    actor: ActorContext,
    contractId: string,
  ): Promise<SupplierContractDetailView> {
    return this.delegate.getSupplierContract(actor, contractId);
  }

  async listSupplierContracts(
    actor: ActorContext,
    filter: ScmSupplierContractFilter = {},
  ): Promise<Array<{ contract: ScmSupplierContract; status: EntityWorkflowStatus | null }>> {
    return this.delegate.listSupplierContracts(actor, filter);
  }

  async actOnSupplierContract(
    actor: ActorContext,
    contractId: string,
    action: string,
    comment?: string,
  ): Promise<SupplierContractDetailView> {
    return this.delegate.actOnSupplierContract(actor, contractId, action, comment);
  }
}
