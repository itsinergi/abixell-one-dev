import type { Pool, QueryResultRow } from "pg";
import type {
  CreateServiceDefinitionInput,
  CreateWorkOrderInput,
  CreateWorkRequestInput,
  ScheduleWorkOrderInput,
  ServiceDefinition,
  ServiceDefinitionChecklistItem,
  ServiceOperationsRepository,
  WorkOrder,
  WorkOrderChecklistItem,
  WorkRequest,
} from "../domain/service-operations.entity.js";

export class PgServiceOperationsRepository implements ServiceOperationsRepository {
  constructor(private readonly pool: Pool) {}

  async findUserTenantId(userId: string): Promise<string | null> {
    const r = await this.pool.query(
      `SELECT tenant_id FROM users WHERE id = $1 AND deleted_at IS NULL`,
      [userId],
    );
    return r.rows[0]?.tenant_id ?? null;
  }

  // --- Service Definition ---------------------------------------------

  async createServiceDefinition(input: CreateServiceDefinitionInput): Promise<ServiceDefinition> {
    const result = await this.pool.query(
      `INSERT INTO service_definitions (tenant_id, code, name, description, category, created_by, updated_by)
       VALUES ($1,$2,$3,$4,$5,$6,$6) RETURNING *`,
      [input.tenantId, input.code, input.name, input.description ?? null, input.category ?? null, input.createdBy],
    );
    return toServiceDefinition(result.rows[0]);
  }

  async findServiceDefinitionById(id: string): Promise<ServiceDefinition | null> {
    const r = await this.pool.query(`SELECT * FROM service_definitions WHERE id = $1`, [id]);
    return r.rows[0] ? toServiceDefinition(r.rows[0]) : null;
  }

  async findServiceDefinitionByCode(tenantId: string, code: string): Promise<ServiceDefinition | null> {
    const r = await this.pool.query(
      `SELECT * FROM service_definitions WHERE tenant_id = $1 AND code = $2`,
      [tenantId, code],
    );
    return r.rows[0] ? toServiceDefinition(r.rows[0]) : null;
  }

  async listServiceDefinitions(tenantId: string): Promise<ServiceDefinition[]> {
    const r = await this.pool.query(
      `SELECT * FROM service_definitions WHERE tenant_id = $1 ORDER BY code`,
      [tenantId],
    );
    return r.rows.map(toServiceDefinition);
  }

  async setServiceDefinitionActive(
    id: string,
    isActive: boolean,
    updatedBy: string | null,
  ): Promise<ServiceDefinition | null> {
    const r = await this.pool.query(
      `UPDATE service_definitions SET is_active = $2, updated_by = $3, updated_at = now()
        WHERE id = $1 RETURNING *`,
      [id, isActive, updatedBy],
    );
    return r.rows[0] ? toServiceDefinition(r.rows[0]) : null;
  }

  async addChecklistTemplateItem(input: {
    serviceDefinitionId: string;
    code: string;
    label: string;
    isRequired: boolean;
    sortOrder: number;
  }): Promise<ServiceDefinitionChecklistItem> {
    const r = await this.pool.query(
      `INSERT INTO service_definition_checklist_items (service_definition_id, code, label, is_required, sort_order)
       VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [input.serviceDefinitionId, input.code, input.label, input.isRequired, input.sortOrder],
    );
    return toTemplateItem(r.rows[0]);
  }

  async listChecklistTemplateItems(serviceDefinitionId: string): Promise<ServiceDefinitionChecklistItem[]> {
    const r = await this.pool.query(
      `SELECT * FROM service_definition_checklist_items
        WHERE service_definition_id = $1 ORDER BY sort_order, code`,
      [serviceDefinitionId],
    );
    return r.rows.map(toTemplateItem);
  }

  // --- Work Request ----------------------------------------------------

  async createWorkRequest(input: CreateWorkRequestInput): Promise<WorkRequest> {
    const r = await this.pool.query(
      `INSERT INTO work_requests
         (tenant_id, request_number, customer_id, contract_id, project_id, site_id,
          service_definition_id, description, priority, requested_by_user_id, created_by, updated_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$11) RETURNING *`,
      [
        input.tenantId,
        input.requestNumber,
        input.customerId,
        input.contractId ?? null,
        input.projectId ?? null,
        input.siteId ?? null,
        input.serviceDefinitionId,
        input.description,
        input.priority ?? null,
        input.requestedByUserId,
        input.createdBy,
      ],
    );
    return toWorkRequest(r.rows[0]);
  }

  async findWorkRequestById(id: string): Promise<WorkRequest | null> {
    const r = await this.pool.query(
      `SELECT * FROM work_requests WHERE id = $1 AND deleted_at IS NULL`,
      [id],
    );
    return r.rows[0] ? toWorkRequest(r.rows[0]) : null;
  }

  async listWorkRequests(tenantId: string, filter: { customerIds?: string[] }): Promise<WorkRequest[]> {
    const conditions = [`tenant_id = $1`, `deleted_at IS NULL`];
    const params: unknown[] = [tenantId];
    if (filter.customerIds) {
      params.push(filter.customerIds);
      conditions.push(`customer_id = ANY($${params.length})`);
    }
    const r = await this.pool.query(
      `SELECT * FROM work_requests WHERE ${conditions.join(" AND ")} ORDER BY requested_at DESC`,
      params,
    );
    return r.rows.map(toWorkRequest);
  }

  async markWorkRequestConverted(
    id: string,
    workOrderId: string,
    updatedBy: string | null,
  ): Promise<WorkRequest | null> {
    // Guarded: an already-converted or cancelled request cannot convert again.
    const r = await this.pool.query(
      `UPDATE work_requests
          SET converted_work_order_id = $2, converted_at = now(), updated_by = $3, updated_at = now()
        WHERE id = $1 AND converted_work_order_id IS NULL AND cancelled_at IS NULL
        RETURNING *`,
      [id, workOrderId, updatedBy],
    );
    return r.rows[0] ? toWorkRequest(r.rows[0]) : null;
  }

  async cancelWorkRequest(id: string, reason: string | null, updatedBy: string | null): Promise<WorkRequest | null> {
    const r = await this.pool.query(
      `UPDATE work_requests
          SET cancelled_at = now(), cancellation_reason = $2, updated_by = $3, updated_at = now()
        WHERE id = $1 AND converted_work_order_id IS NULL AND cancelled_at IS NULL
        RETURNING *`,
      [id, reason, updatedBy],
    );
    return r.rows[0] ? toWorkRequest(r.rows[0]) : null;
  }

  // --- Work Order ------------------------------------------------------

  async createWorkOrder(input: CreateWorkOrderInput): Promise<WorkOrder> {
    const r = await this.pool.query(
      `INSERT INTO work_orders
         (tenant_id, work_order_number, work_request_id, customer_id, contract_id, project_id, site_id,
          service_definition_id, title, description, priority, planned_start_at, planned_end_at, due_at,
          created_by, updated_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$15) RETURNING *`,
      [
        input.tenantId,
        input.workOrderNumber,
        input.workRequestId ?? null,
        input.customerId,
        input.contractId ?? null,
        input.projectId ?? null,
        input.siteId ?? null,
        input.serviceDefinitionId,
        input.title,
        input.description ?? null,
        input.priority ?? null,
        input.plannedStartAt ?? null,
        input.plannedEndAt ?? null,
        input.dueAt ?? null,
        input.createdBy,
      ],
    );
    return toWorkOrder(r.rows[0]);
  }

  async findWorkOrderById(id: string): Promise<WorkOrder | null> {
    const r = await this.pool.query(`SELECT * FROM work_orders WHERE id = $1 AND deleted_at IS NULL`, [id]);
    return r.rows[0] ? toWorkOrder(r.rows[0]) : null;
  }

  async listWorkOrders(
    tenantId: string,
    filter: { customerIds?: string[]; assignedToUserId?: string; siteId?: string },
  ): Promise<WorkOrder[]> {
    const conditions = [`tenant_id = $1`, `deleted_at IS NULL`];
    const params: unknown[] = [tenantId];
    if (filter.customerIds) {
      params.push(filter.customerIds);
      conditions.push(`customer_id = ANY($${params.length})`);
    }
    if (filter.assignedToUserId) {
      params.push(filter.assignedToUserId);
      conditions.push(`assigned_to_user_id = $${params.length}`);
    }
    if (filter.siteId) {
      params.push(filter.siteId);
      conditions.push(`site_id = $${params.length}`);
    }
    const r = await this.pool.query(
      `SELECT * FROM work_orders WHERE ${conditions.join(" AND ")}
        ORDER BY COALESCE(due_at, planned_start_at, created_at) ASC`,
      params,
    );
    return r.rows.map(toWorkOrder);
  }

  async setWorkOrderWorkflowInstance(id: string, workflowInstanceId: string): Promise<void> {
    await this.pool.query(
      `UPDATE work_orders SET workflow_instance_id = $2, updated_at = now() WHERE id = $1`,
      [id, workflowInstanceId],
    );
  }

  async assignWorkOrder(id: string, assigneeUserId: string, assignedByUserId: string): Promise<WorkOrder | null> {
    const r = await this.pool.query(
      `UPDATE work_orders
          SET assigned_to_user_id = $2, assigned_by_user_id = $3, assigned_at = now(),
              updated_by = $3, updated_at = now()
        WHERE id = $1 AND deleted_at IS NULL RETURNING *`,
      [id, assigneeUserId, assignedByUserId],
    );
    return r.rows[0] ? toWorkOrder(r.rows[0]) : null;
  }

  async scheduleWorkOrder(
    id: string,
    input: ScheduleWorkOrderInput,
    updatedBy: string | null,
  ): Promise<WorkOrder | null> {
    const r = await this.pool.query(
      `UPDATE work_orders
          SET planned_start_at = $2, planned_end_at = $3, due_at = $4, updated_by = $5, updated_at = now()
        WHERE id = $1 AND deleted_at IS NULL RETURNING *`,
      [id, input.plannedStartAt, input.plannedEndAt, input.dueAt, updatedBy],
    );
    return r.rows[0] ? toWorkOrder(r.rows[0]) : null;
  }

  async markWorkOrderStarted(id: string, userId: string): Promise<WorkOrder | null> {
    const r = await this.pool.query(
      `UPDATE work_orders
          SET started_at = now(), started_by_user_id = $2, updated_by = $2, updated_at = now()
        WHERE id = $1 AND started_at IS NULL AND deleted_at IS NULL RETURNING *`,
      [id, userId],
    );
    return r.rows[0] ? toWorkOrder(r.rows[0]) : null;
  }

  async markWorkOrderCompleted(id: string, notes: string | null, userId: string): Promise<WorkOrder | null> {
    const r = await this.pool.query(
      `UPDATE work_orders
          SET completion_notes = $2, completed_at = now(), completed_by_user_id = $3,
              updated_by = $3, updated_at = now()
        WHERE id = $1 AND completed_at IS NULL AND deleted_at IS NULL RETURNING *`,
      [id, notes, userId],
    );
    return r.rows[0] ? toWorkOrder(r.rows[0]) : null;
  }

  async markWorkOrderVerified(id: string, notes: string | null, userId: string): Promise<WorkOrder | null> {
    const r = await this.pool.query(
      `UPDATE work_orders
          SET verification_notes = $2, verified_at = now(), verified_by_user_id = $3,
              updated_by = $3, updated_at = now()
        WHERE id = $1 AND verified_at IS NULL AND deleted_at IS NULL RETURNING *`,
      [id, notes, userId],
    );
    return r.rows[0] ? toWorkOrder(r.rows[0]) : null;
  }

  // --- Work Order checklist -------------------------------------------

  async createWorkOrderChecklistItems(
    workOrderId: string,
    items: {
      sourceChecklistItemId: string | null;
      code: string;
      label: string;
      isRequired: boolean;
      sortOrder: number;
    }[],
  ): Promise<WorkOrderChecklistItem[]> {
    const created: WorkOrderChecklistItem[] = [];
    for (const item of items) {
      const r = await this.pool.query(
        `INSERT INTO work_order_checklist_items
           (work_order_id, source_checklist_item_id, code, label, is_required, sort_order)
         VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
        [workOrderId, item.sourceChecklistItemId, item.code, item.label, item.isRequired, item.sortOrder],
      );
      created.push(toChecklistItem(r.rows[0]));
    }
    return created;
  }

  async listWorkOrderChecklistItems(workOrderId: string): Promise<WorkOrderChecklistItem[]> {
    const r = await this.pool.query(
      `SELECT * FROM work_order_checklist_items WHERE work_order_id = $1 ORDER BY sort_order, code`,
      [workOrderId],
    );
    return r.rows.map(toChecklistItem);
  }

  async findWorkOrderChecklistItem(id: string): Promise<WorkOrderChecklistItem | null> {
    const r = await this.pool.query(`SELECT * FROM work_order_checklist_items WHERE id = $1`, [id]);
    return r.rows[0] ? toChecklistItem(r.rows[0]) : null;
  }

  async setChecklistItemCompletion(
    id: string,
    input: { isCompleted: boolean; note: string | null; userId: string },
  ): Promise<WorkOrderChecklistItem | null> {
    const r = await this.pool.query(
      `UPDATE work_order_checklist_items
          SET is_completed = $2,
              note = $3,
              completed_at = CASE WHEN $2 THEN now() ELSE NULL END,
              completed_by_user_id = CASE WHEN $2 THEN $4::uuid ELSE NULL END
        WHERE id = $1 RETURNING *`,
      [id, input.isCompleted, input.note, input.userId],
    );
    return r.rows[0] ? toChecklistItem(r.rows[0]) : null;
  }
}

// --- Row mappers (snake_case → camelCase) -----------------------------

function toServiceDefinition(r: QueryResultRow): ServiceDefinition {
  return {
    id: r.id,
    tenantId: r.tenant_id,
    code: r.code,
    name: r.name,
    description: r.description,
    category: r.category,
    isActive: r.is_active,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

function toTemplateItem(r: QueryResultRow): ServiceDefinitionChecklistItem {
  return {
    id: r.id,
    serviceDefinitionId: r.service_definition_id,
    code: r.code,
    label: r.label,
    isRequired: r.is_required,
    sortOrder: r.sort_order,
  };
}

function toWorkRequest(r: QueryResultRow): WorkRequest {
  return {
    id: r.id,
    tenantId: r.tenant_id,
    requestNumber: r.request_number,
    customerId: r.customer_id,
    contractId: r.contract_id,
    projectId: r.project_id,
    siteId: r.site_id,
    serviceDefinitionId: r.service_definition_id,
    description: r.description,
    priority: r.priority,
    requestedByUserId: r.requested_by_user_id,
    requestedAt: r.requested_at,
    convertedWorkOrderId: r.converted_work_order_id,
    convertedAt: r.converted_at,
    cancelledAt: r.cancelled_at,
    cancellationReason: r.cancellation_reason,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

function toWorkOrder(r: QueryResultRow): WorkOrder {
  return {
    id: r.id,
    tenantId: r.tenant_id,
    workOrderNumber: r.work_order_number,
    workRequestId: r.work_request_id,
    customerId: r.customer_id,
    contractId: r.contract_id,
    projectId: r.project_id,
    siteId: r.site_id,
    serviceDefinitionId: r.service_definition_id,
    title: r.title,
    description: r.description,
    priority: r.priority,
    plannedStartAt: r.planned_start_at,
    plannedEndAt: r.planned_end_at,
    dueAt: r.due_at,
    assignedToUserId: r.assigned_to_user_id,
    assignedAt: r.assigned_at,
    assignedByUserId: r.assigned_by_user_id,
    startedAt: r.started_at,
    startedByUserId: r.started_by_user_id,
    completionNotes: r.completion_notes,
    completedAt: r.completed_at,
    completedByUserId: r.completed_by_user_id,
    verificationNotes: r.verification_notes,
    verifiedAt: r.verified_at,
    verifiedByUserId: r.verified_by_user_id,
    workflowInstanceId: r.workflow_instance_id,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

function toChecklistItem(r: QueryResultRow): WorkOrderChecklistItem {
  return {
    id: r.id,
    workOrderId: r.work_order_id,
    sourceChecklistItemId: r.source_checklist_item_id,
    code: r.code,
    label: r.label,
    isRequired: r.is_required,
    sortOrder: r.sort_order,
    isCompleted: r.is_completed,
    note: r.note,
    completedAt: r.completed_at,
    completedByUserId: r.completed_by_user_id,
  };
}
