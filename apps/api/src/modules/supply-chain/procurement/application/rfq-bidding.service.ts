/**
 * RFQ & Bidding Service (PROC-001).
 *
 * Manages strategic sourcing requests for quotations (RFQs/tenders),
 * invited suppliers, sealed bid submissions, evaluation scoring,
 * and commercial bid awarding to Purchase Orders.
 */
import type { ActorContext } from "../../../../domain/shared-kernel/audit-context.js";
import type { EntityWorkflowAction, EntityWorkflowStatus } from "../../../../application/workflow/workflow.service.js";
import type {
  CreateScmRfqInput,
  CreateScmSupplierBidInput,
  ScmRfq,
  ScmRfqFilter,
  ScmRfqInvitedSupplier,
  ScmRfqItem,
  ScmSupplierBid,
  ScmSupplierBidFilter,
  ScmSupplierBidLine,
  UpdateScmSupplierBidScoreInput,
} from "../../advanced/domain/supply-chain-advanced.entity.js";
import type { SupplyChainAdvancedService } from "../../advanced/application/supply-chain-advanced.service.js";

export interface RfqDetailView {
  rfq: ScmRfq;
  items: ScmRfqItem[];
  invitedSuppliers: ScmRfqInvitedSupplier[];
  bids: ScmSupplierBid[];
  status: EntityWorkflowStatus | null;
  availableActions: EntityWorkflowAction[];
}

export interface SupplierBidDetailView {
  bid: ScmSupplierBid;
  lines: ScmSupplierBidLine[];
}

export class RfqBiddingService {
  constructor(private readonly delegate: SupplyChainAdvancedService) {}

  async createRfq(
    actor: ActorContext,
    input: Omit<CreateScmRfqInput, "createdBy" | "rfqNumber"> & { rfqNumber?: string },
  ): Promise<RfqDetailView> {
    return this.delegate.createRfq(actor, input);
  }

  async getRfq(actor: ActorContext, rfqId: string): Promise<RfqDetailView> {
    return this.delegate.getRfq(actor, rfqId);
  }

  async listRfqs(
    actor: ActorContext,
    filter: ScmRfqFilter = {},
  ): Promise<Array<{ rfq: ScmRfq; status: EntityWorkflowStatus | null }>> {
    return this.delegate.listRfqs(actor, filter);
  }

  async actOnRfq(
    actor: ActorContext,
    rfqId: string,
    action: string,
    comment?: string,
  ): Promise<RfqDetailView> {
    return this.delegate.actOnRfq(actor, rfqId, action, comment);
  }

  async submitSupplierBid(
    actor: ActorContext,
    input: Omit<CreateScmSupplierBidInput, "createdBy" | "bidNumber"> & { bidNumber?: string },
  ): Promise<SupplierBidDetailView> {
    return this.delegate.submitSupplierBid(actor, input);
  }

  async scoreSupplierBid(
    actor: ActorContext,
    bidId: string,
    input: Omit<UpdateScmSupplierBidScoreInput, "bidId" | "updatedBy">,
  ): Promise<ScmSupplierBid> {
    return this.delegate.scoreSupplierBid(actor, bidId, input);
  }

  async awardSupplierBid(
    actor: ActorContext,
    bidId: string,
    resultingPurchaseOrderId?: string,
  ): Promise<ScmSupplierBid> {
    return this.delegate.awardSupplierBid(actor, bidId, resultingPurchaseOrderId);
  }

  async getSupplierBid(actor: ActorContext, bidId: string): Promise<SupplierBidDetailView> {
    return this.delegate.getSupplierBid(actor, bidId);
  }

  async listSupplierBids(
    actor: ActorContext,
    filter: ScmSupplierBidFilter = {},
  ): Promise<ScmSupplierBid[]> {
    return this.delegate.listSupplierBids(actor, filter);
  }
}
