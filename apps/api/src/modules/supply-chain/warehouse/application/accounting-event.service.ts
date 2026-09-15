/**
 * Accounting-Ready Event Service (WMS-012).
 *
 * Manages the SCM-Finance outbox (ADR-0023): 10 immutable accounting-ready
 * event types with idempotent emission and state-transition audit trail.
 * Zero direct General Ledger journal mutations.
 */
import type { ActorContext } from "../../../../domain/shared-kernel/audit-context.js";
import type {
  CreateScmAccountingReadyEventInput,
  ScmAccountingReadyEvent,
  ScmAccountingReadyEventFilter,
  ScmAccountingReadyEventStateTransition,
  UpdateScmAccountingReadyEventStateInput,
} from "../../advanced/domain/supply-chain-advanced.entity.js";
import type { SupplyChainAdvancedService } from "../../advanced/application/supply-chain-advanced.service.js";

export class AccountingEventService {
  constructor(private readonly delegate: SupplyChainAdvancedService) {}

  async createAccountingReadyEvent(
    actor: ActorContext,
    input: Omit<CreateScmAccountingReadyEventInput, "createdBy">,
  ): Promise<ScmAccountingReadyEvent> {
    return this.delegate.createAccountingReadyEvent(actor, input);
  }

  async getAccountingReadyEvent(
    actor: ActorContext,
    eventId: string,
  ): Promise<ScmAccountingReadyEvent> {
    return this.delegate.getAccountingReadyEvent(actor, eventId);
  }

  async listAccountingReadyEvents(
    actor: ActorContext,
    filter?: ScmAccountingReadyEventFilter,
  ): Promise<ScmAccountingReadyEvent[]> {
    return this.delegate.listAccountingReadyEvents(actor, filter);
  }

  async updateAccountingReadyEventState(
    actor: ActorContext,
    input: Omit<UpdateScmAccountingReadyEventStateInput, "occurredBy">,
  ): Promise<{ event: ScmAccountingReadyEvent; transition: ScmAccountingReadyEventStateTransition }> {
    return this.delegate.updateAccountingReadyEventState(actor, input);
  }
}
