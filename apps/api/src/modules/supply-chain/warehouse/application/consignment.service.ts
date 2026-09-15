/**
 * Consignment Service (WMS-009).
 *
 * Manages supplier-owned consignment inventory consumption and financial settlements.
 * Emits accounting-ready consignment settlement events upon completion.
 */
import type { ActorContext } from "../../../../domain/shared-kernel/audit-context.js";
import type {
  CreateScmConsignmentSettlementInput,
  ScmConsignmentSettlement,
  ScmConsignmentSettlementFilter,
  ScmConsignmentSettlementLine,
} from "../../advanced/domain/supply-chain-advanced.entity.js";
import type { SupplyChainAdvancedService } from "../../advanced/application/supply-chain-advanced.service.js";

export class ConsignmentService {
  constructor(private readonly delegate: SupplyChainAdvancedService) {}

  async createConsignmentSettlement(
    actor: ActorContext,
    input: Omit<CreateScmConsignmentSettlementInput, "settlementNumber" | "createdBy"> & { settlementNumber?: string },
  ): Promise<{ settlement: ScmConsignmentSettlement; lines: ScmConsignmentSettlementLine[] }> {
    return this.delegate.createConsignmentSettlement(actor, input);
  }

  async getConsignmentSettlement(
    actor: ActorContext,
    settlementId: string,
  ): Promise<{ settlement: ScmConsignmentSettlement; lines: ScmConsignmentSettlementLine[] }> {
    return this.delegate.getConsignmentSettlement(actor, settlementId);
  }

  async listConsignmentSettlements(
    actor: ActorContext,
    filter?: ScmConsignmentSettlementFilter,
  ): Promise<ScmConsignmentSettlement[]> {
    return this.delegate.listConsignmentSettlements(actor, filter);
  }
}
