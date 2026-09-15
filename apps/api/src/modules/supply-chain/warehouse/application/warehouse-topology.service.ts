/**
 * Warehouse Topology Service (WMS-001).
 *
 * Manages physical warehouse definitions, storage hierarchy, and bin/location topology.
 */
import type { ActorContext } from "../../../../domain/shared-kernel/audit-context.js";
import type {
  CreateScmWarehouseInput,
  CreateScmWarehouseLocationInput,
  ScmWarehouse,
  ScmWarehouseListFilter,
  ScmWarehouseLocation,
  ScmWarehouseLocationListFilter,
  UpdateScmWarehouseInput,
  UpdateScmWarehouseLocationInput,
} from "../../advanced/domain/supply-chain-advanced.entity.js";
import type { SupplyChainAdvancedService } from "../../advanced/application/supply-chain-advanced.service.js";

export class WarehouseTopologyService {
  constructor(private readonly delegate: SupplyChainAdvancedService) {}

  async createWarehouse(
    actor: ActorContext,
    input: Omit<CreateScmWarehouseInput, "createdBy">,
  ): Promise<ScmWarehouse> {
    return this.delegate.createWarehouse(actor, input);
  }

  async updateWarehouse(
    actor: ActorContext,
    warehouseId: string,
    input: UpdateScmWarehouseInput,
  ): Promise<ScmWarehouse> {
    return this.delegate.updateWarehouse(actor, warehouseId, input);
  }

  async getWarehouse(actor: ActorContext, warehouseId: string): Promise<ScmWarehouse> {
    return this.delegate.getWarehouse(actor, warehouseId);
  }

  async listWarehouses(
    actor: ActorContext,
    filter?: ScmWarehouseListFilter,
  ): Promise<ScmWarehouse[]> {
    return this.delegate.listWarehouses(actor, filter);
  }

  async createWarehouseLocation(
    actor: ActorContext,
    input: Omit<CreateScmWarehouseLocationInput, "createdBy">,
  ): Promise<ScmWarehouseLocation> {
    return this.delegate.createWarehouseLocation(actor, input);
  }

  async updateWarehouseLocation(
    actor: ActorContext,
    locationId: string,
    input: UpdateScmWarehouseLocationInput,
  ): Promise<ScmWarehouseLocation> {
    return this.delegate.updateWarehouseLocation(actor, locationId, input);
  }

  async getWarehouseLocation(
    actor: ActorContext,
    locationId: string,
  ): Promise<ScmWarehouseLocation> {
    return this.delegate.getWarehouseLocation(actor, locationId);
  }

  async listWarehouseLocations(
    actor: ActorContext,
    filter?: ScmWarehouseLocationListFilter,
  ): Promise<ScmWarehouseLocation[]> {
    return this.delegate.listWarehouseLocations(actor, filter);
  }
}
