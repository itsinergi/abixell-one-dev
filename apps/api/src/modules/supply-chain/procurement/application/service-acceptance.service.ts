/**
 * Service Acceptance Service (PROC-004).
 *
 * Manages Service Entry Sheets (SES) for non-goods (services) procurement,
 * inspection of vendor-delivered services, frozen accounting dimension
 * capture, and emission of the `service.accepted` accounting-ready event
 * to the outbox (ADR-0023 SCM-Finance boundary).
 */
import type { ActorContext } from "../../../../domain/shared-kernel/audit-context.js";
import type { EntityWorkflowStatus } from "../../../../application/workflow/workflow.service.js";
import type {
  CreateScmServiceAcceptanceInput,
  ScmServiceAcceptance,
  ScmServiceAcceptanceFilter,
  ScmServiceAcceptanceLine,
} from "../../advanced/domain/supply-chain-advanced.entity.js";
import type { SupplyChainAdvancedService } from "../../advanced/application/supply-chain-advanced.service.js";

export interface ServiceAcceptanceDetailView {
  serviceAcceptance: ScmServiceAcceptance;
  lines: ScmServiceAcceptanceLine[];
  status: EntityWorkflowStatus | null;
}

export class ServiceAcceptanceService {
  constructor(private readonly delegate: SupplyChainAdvancedService) {}

  async createServiceAcceptance(
    actor: ActorContext,
    input: Omit<CreateScmServiceAcceptanceInput, "acceptanceNumber" | "createdBy"> & {
      acceptanceNumber?: string;
    },
  ): Promise<{ serviceAcceptance: ScmServiceAcceptance; lines: ScmServiceAcceptanceLine[] }> {
    return this.delegate.createServiceAcceptance(actor, input);
  }

  async getServiceAcceptance(
    actor: ActorContext,
    serviceAcceptanceId: string,
  ): Promise<{ serviceAcceptance: ScmServiceAcceptance; lines: ScmServiceAcceptanceLine[] }> {
    return this.delegate.getServiceAcceptance(actor, serviceAcceptanceId);
  }

  async listServiceAcceptances(
    actor: ActorContext,
    filter: ScmServiceAcceptanceFilter = {},
  ): Promise<Array<{ serviceAcceptance: ScmServiceAcceptance; status: EntityWorkflowStatus | null }>> {
    return this.delegate.listServiceAcceptances(actor, filter);
  }

  async submitServiceAcceptance(
    actor: ActorContext,
    serviceAcceptanceId: string,
    comment?: string,
  ): Promise<{ serviceAcceptance: ScmServiceAcceptance; lines: ScmServiceAcceptanceLine[] }> {
    return this.delegate.submitServiceAcceptance(actor, serviceAcceptanceId, comment);
  }

  /**
   * Approves a Service Entry Sheet. Freezes accounting dimensions on lines
   * and records the `service.accepted` accounting-ready event to the outbox.
   */
  async approveServiceAcceptance(
    actor: ActorContext,
    serviceAcceptanceId: string,
    comment?: string,
  ): Promise<{ serviceAcceptance: ScmServiceAcceptance; lines: ScmServiceAcceptanceLine[] }> {
    return this.delegate.approveServiceAcceptance(actor, serviceAcceptanceId, comment);
  }
}
