/**
 * Valuation & Landed Cost Service (WMS-006).
 *
 * Manages FIFO valuation layers and landed cost voucher allocation
 * (by_value / by_quantity / by_weight / equal) via exact scaled-integer
 * arithmetic (no IEEE-754 drift). Emits accounting-ready cost events.
 */
import type { ActorContext } from "../../../../domain/shared-kernel/audit-context.js";
import type {
  ConsumeScmValuationLayerInput,
  CreateScmLandedCostInput,
  CreateScmValuationLayerInput,
  ScmLandedCost,
  ScmLandedCostFilter,
  ScmValuationLayer,
  ScmValuationLayerFilter,
} from "../../advanced/domain/supply-chain-advanced.entity.js";
import type {
  LandedCostDetailView,
  SupplyChainAdvancedService,
} from "../../advanced/application/supply-chain-advanced.service.js";

export class ValuationService {
  constructor(private readonly delegate: SupplyChainAdvancedService) {}

  async createValuationLayer(
    actor: ActorContext,
    input: CreateScmValuationLayerInput,
  ): Promise<ScmValuationLayer> {
    return this.delegate.createValuationLayer(actor, input);
  }

  async consumeValuationLayer(
    actor: ActorContext,
    input: ConsumeScmValuationLayerInput,
  ): Promise<ScmValuationLayer> {
    return this.delegate.consumeValuationLayer(actor, input);
  }

  async listValuationLayers(
    actor: ActorContext,
    filter?: ScmValuationLayerFilter,
  ): Promise<ScmValuationLayer[]> {
    return this.delegate.listValuationLayers(actor, filter);
  }

  async createLandedCost(
    actor: ActorContext,
    input: Omit<CreateScmLandedCostInput, "createdBy" | "voucherNumber"> & {
      voucherNumber?: string;
      itemsToAllocate?: Array<{ itemId: string; quantity: number; baseAmount: number; weight?: number }>;
    },
  ): Promise<LandedCostDetailView> {
    return this.delegate.createLandedCost(actor, input);
  }

  async applyLandedCost(
    actor: ActorContext,
    landedCostId: string,
  ): Promise<LandedCostDetailView> {
    return this.delegate.applyLandedCost(actor, landedCostId);
  }

  async getLandedCost(
    actor: ActorContext,
    landedCostId: string,
  ): Promise<LandedCostDetailView> {
    return this.delegate.getLandedCost(actor, landedCostId);
  }

  async listLandedCosts(
    actor: ActorContext,
    filter?: ScmLandedCostFilter,
  ): Promise<ScmLandedCost[]> {
    return this.delegate.listLandedCosts(actor, filter);
  }
}
