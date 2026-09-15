/**
 * Warehouse Task Service (WMS-011).
 *
 * Manages warehouse execution tasks (putaway, pick, pack, relocate, count)
 * lifecycle: open -> assigned -> in_progress -> completed.
 */
import type { ActorContext } from "../../../../domain/shared-kernel/audit-context.js";
import type {
  CreateScmWarehouseTaskInput,
  ScmWarehouseTask,
  ScmWarehouseTaskFilter,
  ScmWarehouseTaskItem,
} from "../../advanced/domain/supply-chain-advanced.entity.js";
import type { SupplyChainAdvancedService } from "../../advanced/application/supply-chain-advanced.service.js";

export class WarehouseTaskService {
  constructor(private readonly delegate: SupplyChainAdvancedService) {}

  async createWarehouseTask(
    actor: ActorContext,
    input: Omit<CreateScmWarehouseTaskInput, "taskNumber" | "createdBy"> & { taskNumber?: string },
  ): Promise<{ task: ScmWarehouseTask; items: ScmWarehouseTaskItem[] }> {
    return this.delegate.createWarehouseTask(actor, input);
  }

  async getWarehouseTask(
    actor: ActorContext,
    taskId: string,
  ): Promise<{ task: ScmWarehouseTask; items: ScmWarehouseTaskItem[] }> {
    return this.delegate.getWarehouseTask(actor, taskId);
  }

  async listWarehouseTasks(
    actor: ActorContext,
    filter?: ScmWarehouseTaskFilter,
  ): Promise<ScmWarehouseTask[]> {
    return this.delegate.listWarehouseTasks(actor, filter);
  }

  async assignWarehouseTask(
    actor: ActorContext,
    taskId: string,
    assignedTo: string,
  ): Promise<{ task: ScmWarehouseTask; items: ScmWarehouseTaskItem[] }> {
    return this.delegate.assignWarehouseTask(actor, taskId, assignedTo);
  }

  async completeWarehouseTask(
    actor: ActorContext,
    taskId: string,
  ): Promise<{ task: ScmWarehouseTask; items: ScmWarehouseTaskItem[] }> {
    return this.delegate.completeWarehouseTask(actor, taskId);
  }
}
