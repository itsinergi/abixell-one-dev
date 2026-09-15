/**
 * Reorder & Reservation Service (WMS-004).
 *
 * Manages Min-Max/ROP/ROQ reorder policies, proactive reorder alerts,
 * and hard/soft stock reservations for sales orders and work orders.
 */
import type { ActorContext } from "../../../../domain/shared-kernel/audit-context.js";
import type {
  CreateScmStockReservationInput,
  ScmReorderPolicy,
  ScmReorderPolicyFilter,
  ScmStockReservation,
  ScmStockReservationFilter,
  UpsertScmReorderPolicyInput,
} from "../../advanced/domain/supply-chain-advanced.entity.js";
import type { SupplyChainAdvancedService } from "../../advanced/application/supply-chain-advanced.service.js";

export class ReorderReservationService {
  constructor(private readonly delegate: SupplyChainAdvancedService) {}

  async upsertReorderPolicy(
    actor: ActorContext,
    input: Omit<UpsertScmReorderPolicyInput, "updatedBy">,
  ): Promise<ScmReorderPolicy> {
    return this.delegate.upsertReorderPolicy(actor, input);
  }

  async listReorderPolicies(
    actor: ActorContext,
    filter?: ScmReorderPolicyFilter,
  ): Promise<ScmReorderPolicy[]> {
    return this.delegate.listReorderPolicies(actor, filter);
  }

  async computeReorderAlerts(
    actor: ActorContext,
    warehouseId?: string,
  ): Promise<Array<{ policy: ScmReorderPolicy; currentStock: number; suggestedOrderQuantity: number }>> {
    return this.delegate.computeReorderAlerts(actor, warehouseId);
  }

  async createStockReservation(
    actor: ActorContext,
    input: Omit<CreateScmStockReservationInput, "createdBy">,
  ): Promise<ScmStockReservation> {
    return this.delegate.createStockReservation(actor, input);
  }

  async fulfillStockReservation(
    actor: ActorContext,
    reservationId: string,
  ): Promise<ScmStockReservation> {
    return this.delegate.fulfillStockReservation(actor, reservationId);
  }

  async cancelStockReservation(
    actor: ActorContext,
    reservationId: string,
  ): Promise<ScmStockReservation> {
    return this.delegate.cancelStockReservation(actor, reservationId);
  }

  async listStockReservations(
    actor: ActorContext,
    filter?: ScmStockReservationFilter,
  ): Promise<ScmStockReservation[]> {
    return this.delegate.listStockReservations(actor, filter);
  }
}
