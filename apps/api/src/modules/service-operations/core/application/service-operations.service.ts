import type { ActorContext } from "../../../../domain/shared-kernel/audit-context.js";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "../../../../domain/shared-kernel/errors.js";
import type { AuditService } from "../../../../application/audit/audit.service.js";
import type { RbacService } from "../../../../application/rbac/rbac.service.js";
import type { EventBus } from "../../../../application/event/event-bus.js";
import type {
  EntityWorkflowAction,
  EntityWorkflowStatus,
  WorkflowService,
} from "../../../../application/workflow/workflow.service.js";
import type { ConfigurationService } from "../../../../application/configuration/configuration.service.js";
import type { CustomerService } from "../../../../application/customer/customer.service.js";
import type {
  ServiceDefinition,
  ServiceDefinitionChecklistItem,
  ServiceOperationsRepository,
  WorkOrder,
  WorkOrderChecklistItem,
  WorkRequest,
} from "../domain/service-operations.entity.js";
import { workRequestState } from "../domain/service-operations.entity.js";

/** Tenant Configuration codes this module expects to exist. All three are
 * Client Configuration, never Product Core content. */
export const WORK_REQUEST_NUMBERING_CODE = "work_request";
export const WORK_ORDER_NUMBERING_CODE = "work_order";
export const WORK_ORDER_WORKFLOW_DEFINITION_CODE = "service_operations_work_order";

/** Workflow action code → domain event name (SO-CORE-015). The Step graph
 * itself is Tenant Configuration; this map only names the events a Tenant's
 * chosen action codes publish, exactly like the Complaint Engine does. */
const ACTION_EVENT_MAP: Record<string, string> = {
  submit: "work_order.submitted",
  assign: "work_order.assigned",
  start: "work_order.started",
  complete: "work_order.completed",
  verify: "work_order.verified",
  reject: "work_order.rejected",
  cancel: "work_order.cancelled",
};

export interface WorkOrderDetailView {
  workOrder: WorkOrder;
  serviceDefinition: ServiceDefinition | null;
  checklist: WorkOrderChecklistItem[];
  status: EntityWorkflowStatus | null;
  availableActions: EntityWorkflowAction[];
}

/**
 * Service Operations & Work Management Core (Phase 2, SO-CORE-001…015).
 *
 * The generic service-delivery spine: what work is requested, who executes
 * it, when, with what evidence, and whether it was completed and verified.
 *
 * Architectural constraints honoured here:
 * - **Workflow owns lifecycle STATE** (SO-CORE-004). This service never
 *   stores a work-order status column and never encodes a Step graph; it
 *   forwards action codes to `WorkflowService` and records business FACTS
 *   (started/completed/verified by whom, when) alongside.
 * - **Platform Core is reused, never re-implemented** — numbering,
 *   configuration, workflow, audit, events, documents, RBAC, Data Scope.
 * - **Customer & Commercial owns the customer** — this module references it
 *   through `CustomerService`, and never keeps its own customer master.
 * - **No vertical assumptions.** Nothing here knows what a catering,
 *   housekeeping, camp, or facility job is; those arrive as Configuration
 *   and Vertical Service Packs over these same entities.
 */
export class ServiceOperationsService {
  constructor(
    private readonly repo: ServiceOperationsRepository,
    private readonly customers: CustomerService,
    private readonly workflow: WorkflowService,
    private readonly configuration: ConfigurationService,
    private readonly audit: AuditService,
    private readonly rbac: RbacService,
    private readonly eventBus: EventBus,
  ) {}

  // ===================================================================
  // Service Definition — SO-CORE-001 / SO-CORE-007
  // ===================================================================

  async createServiceDefinition(
    actor: ActorContext,
    input: { code: string; name: string; description?: string | null; category?: string | null },
  ): Promise<ServiceDefinition> {
    await this.rbac.requirePermission(actor.userId, "service_operations.configure");
    const existing = await this.repo.findServiceDefinitionByCode(actor.tenantId, input.code);
    if (existing) throw new ConflictError(`Service Definition '${input.code}' already exists`);

    const definition = await this.repo.createServiceDefinition({
      tenantId: actor.tenantId,
      code: input.code,
      name: input.name,
      description: input.description ?? null,
      category: input.category ?? null,
      createdBy: actor.userId,
    });
    await this.audit.record({
      tenantId: actor.tenantId,
      actorUserId: actor.userId,
      action: "service_operations.service_definition.created",
      entityType: "service_definition",
      entityId: definition.id,
      metadata: { code: definition.code, name: definition.name },
    });
    return definition;
  }

  async addChecklistTemplateItem(
    actor: ActorContext,
    definitionCode: string,
    input: { code: string; label: string; isRequired?: boolean; sortOrder?: number },
  ): Promise<ServiceDefinitionChecklistItem> {
    await this.rbac.requirePermission(actor.userId, "service_operations.configure");
    const definition = await this.getServiceDefinitionOrThrow(actor.tenantId, definitionCode);
    return this.repo.addChecklistTemplateItem({
      serviceDefinitionId: definition.id,
      code: input.code,
      label: input.label,
      isRequired: input.isRequired ?? false,
      sortOrder: input.sortOrder ?? 0,
    });
  }

  async setServiceDefinitionActive(
    actor: ActorContext,
    definitionCode: string,
    isActive: boolean,
  ): Promise<ServiceDefinition> {
    await this.rbac.requirePermission(actor.userId, "service_operations.configure");
    const definition = await this.getServiceDefinitionOrThrow(actor.tenantId, definitionCode);
    const updated = await this.repo.setServiceDefinitionActive(definition.id, isActive, actor.userId);
    return updated!;
  }

  async listServiceDefinitions(actor: ActorContext): Promise<ServiceDefinition[]> {
    await this.rbac.requirePermission(actor.userId, "service_operations.read");
    return this.repo.listServiceDefinitions(actor.tenantId);
  }

  async getServiceDefinition(
    actor: ActorContext,
    definitionCode: string,
  ): Promise<{ definition: ServiceDefinition; checklist: ServiceDefinitionChecklistItem[] }> {
    await this.rbac.requirePermission(actor.userId, "service_operations.read");
    const definition = await this.getServiceDefinitionOrThrow(actor.tenantId, definitionCode);
    return { definition, checklist: await this.repo.listChecklistTemplateItems(definition.id) };
  }

  // ===================================================================
  // Work Request (intake) — SO-CORE-002 / SO-CORE-011 / SO-CORE-012
  // ===================================================================

  async createWorkRequest(
    actor: ActorContext,
    input: {
      customerId: string;
      contractId?: string | null;
      projectId?: string | null;
      siteId?: string | null;
      serviceDefinitionCode: string;
      description: string;
      priority?: string | null;
    },
  ): Promise<WorkRequest> {
    await this.rbac.requirePermission(actor.userId, "service_operations.manage");
    // Customer Data Scope — identical posture to the Complaint Engine: works
    // whether the actor is a Customer User or an internal coordinator.
    const customer = await this.customers.getAuthorized(actor, input.customerId);
    const definition = await this.getActiveServiceDefinitionOrThrow(actor.tenantId, input.serviceDefinitionCode);

    const { number } = await this.configuration.generateNumberForTenant(
      actor.tenantId,
      WORK_REQUEST_NUMBERING_CODE,
      actor.userId,
    );

    const request = await this.repo.createWorkRequest({
      tenantId: actor.tenantId,
      requestNumber: number,
      customerId: customer.id,
      contractId: input.contractId ?? null,
      projectId: input.projectId ?? null,
      siteId: input.siteId ?? null,
      serviceDefinitionId: definition.id,
      description: input.description,
      priority: input.priority ?? null,
      requestedByUserId: actor.userId,
      createdBy: actor.userId,
    });

    await this.audit.record({
      tenantId: actor.tenantId,
      actorUserId: actor.userId,
      action: "work_request.created",
      entityType: "work_request",
      entityId: request.id,
      metadata: { requestNumber: number, customerId: customer.id, serviceDefinitionCode: definition.code },
    });
    await this.eventBus.publish({
      tenantId: actor.tenantId,
      eventType: "work_request.created",
      entityType: "work_request",
      entityId: request.id,
      payload: { requestNumber: number, customerId: customer.id, targetUserId: actor.userId },
      createdBy: actor.userId,
    });
    return request;
  }

  async listWorkRequests(actor: ActorContext): Promise<{ request: WorkRequest; state: string }[]> {
    await this.rbac.requirePermission(actor.userId, "service_operations.read");
    const customerIds = await this.customers.listScopedCustomerIds(actor);
    const requests = await this.repo.listWorkRequests(actor.tenantId, { customerIds });
    return requests.map((request) => ({ request, state: workRequestState(request) }));
  }

  async getWorkRequest(actor: ActorContext, id: string): Promise<{ request: WorkRequest; state: string }> {
    await this.rbac.requirePermission(actor.userId, "service_operations.read");
    const request = await this.getAuthorizedWorkRequest(actor, id);
    return { request, state: workRequestState(request) };
  }

  async cancelWorkRequest(actor: ActorContext, id: string, reason: string | null): Promise<WorkRequest> {
    await this.rbac.requirePermission(actor.userId, "service_operations.manage");
    const request = await this.getAuthorizedWorkRequest(actor, id);
    const cancelled = await this.repo.cancelWorkRequest(request.id, reason, actor.userId);
    if (!cancelled) {
      throw new ConflictError("Only an open Work Request can be cancelled");
    }
    await this.audit.record({
      tenantId: actor.tenantId,
      actorUserId: actor.userId,
      action: "work_request.cancelled",
      entityType: "work_request",
      entityId: request.id,
      metadata: { reason },
    });
    return cancelled;
  }

  // ===================================================================
  // Work Order — SO-CORE-003 … SO-CORE-006
  // ===================================================================

  /** Convert an open Work Request into an executable Work Order
   * (SO-CORE-003). Guarded so one request can never produce two orders. */
  async convertRequestToWorkOrder(
    actor: ActorContext,
    requestId: string,
    input: { title?: string; plannedStartAt?: string | null; plannedEndAt?: string | null; dueAt?: string | null },
  ): Promise<WorkOrder> {
    await this.rbac.requirePermission(actor.userId, "service_operations.manage");
    const request = await this.getAuthorizedWorkRequest(actor, requestId);
    if (workRequestState(request) !== "open") {
      throw new ConflictError(`Only an open Work Request can be converted (is '${workRequestState(request)}')`);
    }
    const definition = await this.repo.findServiceDefinitionById(request.serviceDefinitionId);
    if (!definition) throw new NotFoundError("ServiceDefinition", request.serviceDefinitionId);

    const workOrder = await this.createWorkOrderInternal(actor, {
      workRequestId: request.id,
      customerId: request.customerId,
      contractId: request.contractId,
      projectId: request.projectId,
      siteId: request.siteId,
      definition,
      title: input.title ?? `${definition.name}`,
      description: request.description,
      priority: request.priority,
      plannedStartAt: input.plannedStartAt ?? null,
      plannedEndAt: input.plannedEndAt ?? null,
      dueAt: input.dueAt ?? null,
    });

    const converted = await this.repo.markWorkRequestConverted(request.id, workOrder.id, actor.userId);
    if (!converted) {
      // Lost a race with a concurrent conversion — surface it rather than
      // leaving two orders silently attached to one request.
      throw new ConflictError("This Work Request has already been converted or cancelled");
    }
    return workOrder;
  }

  /** Create a Work Order directly, without an intake request. */
  async createWorkOrder(
    actor: ActorContext,
    input: {
      customerId: string;
      contractId?: string | null;
      projectId?: string | null;
      siteId?: string | null;
      serviceDefinitionCode: string;
      title: string;
      description?: string | null;
      priority?: string | null;
      plannedStartAt?: string | null;
      plannedEndAt?: string | null;
      dueAt?: string | null;
    },
  ): Promise<WorkOrder> {
    await this.rbac.requirePermission(actor.userId, "service_operations.manage");
    const customer = await this.customers.getAuthorized(actor, input.customerId);
    const definition = await this.getActiveServiceDefinitionOrThrow(actor.tenantId, input.serviceDefinitionCode);
    return this.createWorkOrderInternal(actor, {
      workRequestId: null,
      customerId: customer.id,
      contractId: input.contractId ?? null,
      projectId: input.projectId ?? null,
      siteId: input.siteId ?? null,
      definition,
      title: input.title,
      description: input.description ?? null,
      priority: input.priority ?? null,
      plannedStartAt: input.plannedStartAt ?? null,
      plannedEndAt: input.plannedEndAt ?? null,
      dueAt: input.dueAt ?? null,
    });
  }

  /** Assignment (SO-CORE-005) — the responsible executor. Workflow
   * role+scope routing remains available for queue-based assignment; this
   * records the named individual responsible for the work. */
  async assignWorkOrder(actor: ActorContext, id: string, assigneeUserId: string): Promise<WorkOrder> {
    await this.rbac.requirePermission(actor.userId, "service_operations.manage");
    const workOrder = await this.getAuthorizedWorkOrder(actor, id);
    const assigneeTenant = await this.repo.findUserTenantId(assigneeUserId);
    if (!assigneeTenant) throw new NotFoundError("User", assigneeUserId);
    if (assigneeTenant !== actor.tenantId) {
      throw new ForbiddenError("Cannot assign work to a user in another tenant");
    }

    const updated = await this.repo.assignWorkOrder(workOrder.id, assigneeUserId, actor.userId);
    await this.audit.record({
      tenantId: actor.tenantId,
      actorUserId: actor.userId,
      action: "work_order.assigned",
      entityType: "work_order",
      entityId: workOrder.id,
      metadata: { assigneeUserId },
    });
    await this.eventBus.publish({
      tenantId: actor.tenantId,
      eventType: "work_order.assigned",
      entityType: "work_order",
      entityId: workOrder.id,
      payload: {
        workOrderNumber: workOrder.workOrderNumber,
        targetUserId: assigneeUserId,
        assignedByUserId: actor.userId,
      },
      createdBy: actor.userId,
    });
    return updated!;
  }

  /** Basic scheduling only (SO-CORE-006): planned window + due date. No
   * capacity model, no route sequencing, no recurrence — those are Advanced. */
  async scheduleWorkOrder(
    actor: ActorContext,
    id: string,
    input: { plannedStartAt?: string | null; plannedEndAt?: string | null; dueAt?: string | null },
  ): Promise<WorkOrder> {
    await this.rbac.requirePermission(actor.userId, "service_operations.manage");
    const workOrder = await this.getAuthorizedWorkOrder(actor, id);
    const plannedStartAt = parseDate(input.plannedStartAt, "plannedStartAt");
    const plannedEndAt = parseDate(input.plannedEndAt, "plannedEndAt");
    const dueAt = parseDate(input.dueAt, "dueAt");
    if (plannedStartAt && plannedEndAt && plannedEndAt < plannedStartAt) {
      throw new ValidationError("plannedEndAt cannot be earlier than plannedStartAt");
    }

    const updated = await this.repo.scheduleWorkOrder(
      workOrder.id,
      { plannedStartAt, plannedEndAt, dueAt },
      actor.userId,
    );
    await this.audit.record({
      tenantId: actor.tenantId,
      actorUserId: actor.userId,
      action: "work_order.scheduled",
      entityType: "work_order",
      entityId: workOrder.id,
      metadata: { plannedStartAt, plannedEndAt, dueAt },
    });
    return updated!;
  }

  // ===================================================================
  // Execution — SO-CORE-008 / SO-CORE-010 / SO-CORE-004
  // ===================================================================

  /**
   * Generic lifecycle dispatch (SO-CORE-004). This service does NOT know the
   * Step graph: it finds whatever pending Workflow Assignment exists on the
   * Work Order's Instance and forwards `actionCode` verbatim. An invalid
   * transition is rejected by the Workflow Engine itself.
   */
  async act(actor: ActorContext, id: string, actionCode: string, comment: string | null) {
    // A lifecycle transition can legitimately be taken by a coordinator
    // (assign/cancel), an executor (start/complete), or a verifier (verify),
    // so the module gate is "holds any operational capability" and the
    // PRECISE gate remains the Workflow Engine's own assignment eligibility
    // (role+scope / specific_user), exactly as in the Complaint Engine.
    await this.rbac.requirePermission(actor.userId, "service_operations.read");
    await this.requireAnyOperationalCapability(actor);
    const workOrder = await this.getAuthorizedWorkOrder(actor, id);
    if (!workOrder.workflowInstanceId) {
      throw new ConflictError("This Work Order has no active Workflow Instance");
    }
    const { assignments } = await this.workflow.getInstanceForEntityOwner(
      actor.tenantId,
      workOrder.workflowInstanceId,
    );
    const pending = assignments.find((a) => a.status === "pending");
    if (!pending) throw new ConflictError("No pending action currently exists on this Work Order");

    const result = await this.workflow.actOnAssignment(actor, pending.id, actionCode, comment);

    const eventType = ACTION_EVENT_MAP[actionCode] ?? "work_order.status_changed";
    await this.audit.record({
      tenantId: actor.tenantId,
      actorUserId: actor.userId,
      action: eventType,
      entityType: "work_order",
      entityId: workOrder.id,
      metadata: { actionCode, comment },
    });
    await this.eventBus.publish({
      tenantId: actor.tenantId,
      eventType,
      entityType: "work_order",
      entityId: workOrder.id,
      payload: {
        workOrderNumber: workOrder.workOrderNumber,
        actionCode,
        targetUserId: workOrder.assignedToUserId,
        comment,
      },
      createdBy: actor.userId,
    });
    return { workOrder: (await this.repo.findWorkOrderById(workOrder.id))!, workflowResult: result };
  }

  /** Record that execution has begun (SO-CORE-008). Idempotent: a repeated
   * start is a no-op rather than an error, and never overwrites the original
   * executor/timestamp. */
  async startWork(actor: ActorContext, id: string): Promise<WorkOrder> {
    await this.rbac.requirePermission(actor.userId, "service_operations.execute");
    const workOrder = await this.getAuthorizedWorkOrder(actor, id);
    this.assertExecutor(actor, workOrder);
    if (workOrder.completedAt) throw new ConflictError("This Work Order is already completed");

    const started = await this.repo.markWorkOrderStarted(workOrder.id, actor.userId);
    if (!started) return workOrder; // already started — idempotent

    await this.audit.record({
      tenantId: actor.tenantId,
      actorUserId: actor.userId,
      action: "work_order.started",
      entityType: "work_order",
      entityId: workOrder.id,
      metadata: {},
    });
    await this.eventBus.publish({
      tenantId: actor.tenantId,
      eventType: "work_order.started",
      entityType: "work_order",
      entityId: workOrder.id,
      payload: { workOrderNumber: workOrder.workOrderNumber, targetUserId: workOrder.assignedToUserId },
      createdBy: actor.userId,
    });
    return started;
  }

  /** Record a checklist item result (SO-CORE-007/008). */
  async setChecklistItem(
    actor: ActorContext,
    workOrderId: string,
    itemId: string,
    input: { isCompleted: boolean; note?: string | null },
  ): Promise<WorkOrderChecklistItem> {
    await this.rbac.requirePermission(actor.userId, "service_operations.execute");
    const workOrder = await this.getAuthorizedWorkOrder(actor, workOrderId);
    this.assertExecutor(actor, workOrder);
    if (workOrder.completedAt) throw new ConflictError("This Work Order is already completed");

    const item = await this.repo.findWorkOrderChecklistItem(itemId);
    if (!item || item.workOrderId !== workOrder.id) {
      throw new NotFoundError("WorkOrderChecklistItem", itemId);
    }
    const updated = await this.repo.setChecklistItemCompletion(item.id, {
      isCompleted: input.isCompleted,
      note: input.note ?? null,
      userId: actor.userId,
    });
    return updated!;
  }

  /**
   * Record completion (SO-CORE-010). Required checklist items must be done
   * first. Idempotent by guarded UPDATE: a duplicate completion cannot
   * overwrite the original facts or re-publish the event.
   */
  async completeWork(actor: ActorContext, id: string, notes: string | null): Promise<WorkOrder> {
    await this.rbac.requirePermission(actor.userId, "service_operations.execute");
    const workOrder = await this.getAuthorizedWorkOrder(actor, id);
    this.assertExecutor(actor, workOrder);

    const checklist = await this.repo.listWorkOrderChecklistItems(workOrder.id);
    const outstanding = checklist.filter((c) => c.isRequired && !c.isCompleted);
    if (outstanding.length > 0) {
      throw new ValidationError(
        `Required checklist item(s) not completed: ${outstanding.map((c) => c.code).join(", ")}`,
      );
    }

    const completed = await this.repo.markWorkOrderCompleted(workOrder.id, notes, actor.userId);
    if (!completed) throw new ConflictError("This Work Order is already completed");

    await this.audit.record({
      tenantId: actor.tenantId,
      actorUserId: actor.userId,
      action: "work_order.completed",
      entityType: "work_order",
      entityId: workOrder.id,
      metadata: { notes },
    });
    await this.eventBus.publish({
      tenantId: actor.tenantId,
      eventType: "work_order.completed",
      entityType: "work_order",
      entityId: workOrder.id,
      payload: { workOrderNumber: workOrder.workOrderNumber, targetUserId: workOrder.assignedToUserId },
      createdBy: actor.userId,
    });
    return completed;
  }

  /** Supervisor verification (SO-CORE-010). Requires a distinct capability
   * from execution, so segregation of duties is possible. */
  async verifyWork(actor: ActorContext, id: string, notes: string | null): Promise<WorkOrder> {
    await this.rbac.requirePermission(actor.userId, "service_operations.verify");
    const workOrder = await this.getAuthorizedWorkOrder(actor, id);
    if (!workOrder.completedAt) throw new ConflictError("Only completed work can be verified");

    const verified = await this.repo.markWorkOrderVerified(workOrder.id, notes, actor.userId);
    if (!verified) throw new ConflictError("This Work Order is already verified");

    await this.audit.record({
      tenantId: actor.tenantId,
      actorUserId: actor.userId,
      action: "work_order.verified",
      entityType: "work_order",
      entityId: workOrder.id,
      metadata: { notes },
    });
    await this.eventBus.publish({
      tenantId: actor.tenantId,
      eventType: "work_order.verified",
      entityType: "work_order",
      entityId: workOrder.id,
      payload: { workOrderNumber: workOrder.workOrderNumber, targetUserId: workOrder.completedByUserId },
      createdBy: actor.userId,
    });
    return verified;
  }

  // ===================================================================
  // Reads — SO-CORE-012 / SO-CORE-013 / SO-CORE-014
  // ===================================================================

  /** Coordinator/supervisor queue. Scoped to the customers the actor's Data
   * Scope covers. */
  async listWorkOrders(
    actor: ActorContext,
    filter: { siteId?: string } = {},
  ): Promise<{ workOrder: WorkOrder; status: EntityWorkflowStatus | null }[]> {
    await this.rbac.requirePermission(actor.userId, "service_operations.read");
    const customerIds = await this.customers.listScopedCustomerIds(actor);
    const orders = await this.repo.listWorkOrders(actor.tenantId, { customerIds, siteId: filter.siteId });
    return this.withStatus(actor, orders);
  }

  /** Field surface (SO-CORE-014): the work assigned to this actor. Reachable
   * without Customer Data Scope — an executor is authorised by assignment. */
  async listMyWork(actor: ActorContext): Promise<{ workOrder: WorkOrder; status: EntityWorkflowStatus | null }[]> {
    await this.rbac.requirePermission(actor.userId, "service_operations.execute");
    const orders = await this.repo.listWorkOrders(actor.tenantId, { assignedToUserId: actor.userId });
    return this.withStatus(actor, orders);
  }

  async getWorkOrderDetail(actor: ActorContext, id: string): Promise<WorkOrderDetailView> {
    await this.rbac.requirePermission(actor.userId, "service_operations.read");
    const workOrder = await this.getAuthorizedWorkOrder(actor, id);
    const [serviceDefinition, checklist] = await Promise.all([
      this.repo.findServiceDefinitionById(workOrder.serviceDefinitionId),
      this.repo.listWorkOrderChecklistItems(workOrder.id),
    ]);

    let status: EntityWorkflowStatus | null = null;
    let availableActions: EntityWorkflowAction[] = [];
    if (workOrder.workflowInstanceId) {
      status = await this.workflow.getEntityStatus(actor, workOrder.workflowInstanceId);
      const view = await this.workflow.getEntityWorkflowView(actor, workOrder.workflowInstanceId);
      availableActions = view.availableActions ?? [];
    }
    return { workOrder, serviceDefinition, checklist, status, availableActions };
  }

  /** Document Core authorization hook (SO-CORE-009) — evidence attached to a
   * Work Order inherits the Work Order's own authorization (ADR-0012). */
  async canAccessForDocument(actor: ActorContext, workOrderId: string): Promise<boolean> {
    const workOrder = await this.repo.findWorkOrderById(workOrderId);
    if (!workOrder || workOrder.tenantId !== actor.tenantId) return false;
    return this.isAuthorizedForWorkOrder(actor, workOrder);
  }

  // ===================================================================
  // Internals
  // ===================================================================

  private async createWorkOrderInternal(
    actor: ActorContext,
    input: {
      workRequestId: string | null;
      customerId: string;
      contractId: string | null;
      projectId: string | null;
      siteId: string | null;
      definition: ServiceDefinition;
      title: string;
      description: string | null;
      priority: string | null;
      plannedStartAt: string | null;
      plannedEndAt: string | null;
      dueAt: string | null;
    },
  ): Promise<WorkOrder> {
    const customer = await this.customers.getAuthorized(actor, input.customerId);
    const { number } = await this.configuration.generateNumberForTenant(
      actor.tenantId,
      WORK_ORDER_NUMBERING_CODE,
      actor.userId,
    );

    const workOrder = await this.repo.createWorkOrder({
      tenantId: actor.tenantId,
      workOrderNumber: number,
      workRequestId: input.workRequestId,
      customerId: customer.id,
      contractId: input.contractId,
      projectId: input.projectId,
      siteId: input.siteId,
      serviceDefinitionId: input.definition.id,
      title: input.title,
      description: input.description,
      priority: input.priority,
      plannedStartAt: parseDate(input.plannedStartAt, "plannedStartAt"),
      plannedEndAt: parseDate(input.plannedEndAt, "plannedEndAt"),
      dueAt: parseDate(input.dueAt, "dueAt"),
      createdBy: actor.userId,
    });

    // Snapshot the checklist template so later edits to the Service
    // Definition cannot rewrite the history of executed work.
    const template = await this.repo.listChecklistTemplateItems(input.definition.id);
    if (template.length > 0) {
      await this.repo.createWorkOrderChecklistItems(
        workOrder.id,
        template.map((t) => ({
          sourceChecklistItemId: t.id,
          code: t.code,
          label: t.label,
          isRequired: t.isRequired,
          sortOrder: t.sortOrder,
        })),
      );
    }

    // Lifecycle is owned by the Workflow Engine, started at the Tenant's
    // configured initial Step. `organizationUnitId` lets `submitter_unit`
    // assignment rules route to the Customer's own owning team without this
    // service knowing anything about routing.
    const { instance } = await this.workflow.startInstance(actor, {
      definitionCode: WORK_ORDER_WORKFLOW_DEFINITION_CODE,
      entityId: workOrder.id,
      contextData: {
        customerId: customer.id,
        organizationUnitId: customer.ownerOrganizationUnitId,
        serviceDefinitionCode: input.definition.code,
        priority: input.priority,
        siteId: input.siteId,
      },
    });
    await this.repo.setWorkOrderWorkflowInstance(workOrder.id, instance.id);

    await this.audit.record({
      tenantId: actor.tenantId,
      actorUserId: actor.userId,
      action: "work_order.created",
      entityType: "work_order",
      entityId: workOrder.id,
      metadata: {
        workOrderNumber: number,
        customerId: customer.id,
        serviceDefinitionCode: input.definition.code,
        workRequestId: input.workRequestId,
      },
    });
    await this.eventBus.publish({
      tenantId: actor.tenantId,
      eventType: "work_order.created",
      entityType: "work_order",
      entityId: workOrder.id,
      payload: {
        workOrderNumber: number,
        customerId: customer.id,
        targetUserId: actor.userId,
        serviceDefinitionCode: input.definition.code,
      },
      createdBy: actor.userId,
    });

    return (await this.repo.findWorkOrderById(workOrder.id))!;
  }

  private async withStatus(actor: ActorContext, orders: WorkOrder[]) {
    const rows: { workOrder: WorkOrder; status: EntityWorkflowStatus | null }[] = [];
    for (const workOrder of orders) {
      let status: EntityWorkflowStatus | null = null;
      if (workOrder.workflowInstanceId) {
        status = await this.workflow.getEntityStatus(actor, workOrder.workflowInstanceId);
      }
      rows.push({ workOrder, status });
    }
    return rows;
  }

  private async requireAnyOperationalCapability(actor: ActorContext): Promise<void> {
    const permissions = await this.rbac.getEffectivePermissions(actor.userId);
    const allowed = ["service_operations.manage", "service_operations.execute", "service_operations.verify"];
    if (!allowed.some((code) => permissions.has(code))) {
      throw new ForbiddenError("You do not hold an operational capability for Service Operations");
    }
  }

  private async getServiceDefinitionOrThrow(tenantId: string, code: string): Promise<ServiceDefinition> {
    const definition = await this.repo.findServiceDefinitionByCode(tenantId, code);
    if (!definition) throw new NotFoundError("ServiceDefinition", code);
    return definition;
  }

  private async getActiveServiceDefinitionOrThrow(tenantId: string, code: string): Promise<ServiceDefinition> {
    const definition = await this.getServiceDefinitionOrThrow(tenantId, code);
    if (!definition.isActive) throw new ConflictError(`Service Definition '${code}' is not active`);
    return definition;
  }

  private async getAuthorizedWorkRequest(actor: ActorContext, id: string): Promise<WorkRequest> {
    const request = await this.repo.findWorkRequestById(id);
    if (!request || request.tenantId !== actor.tenantId) throw new NotFoundError("WorkRequest", id);
    const allowed = await this.customers.canAccessForDocument(actor, request.customerId);
    if (!allowed) throw new ForbiddenError("Your Data Scope does not cover this Work Request");
    return request;
  }

  /**
   * Work Order visibility (SO-CORE-012): Customer Data Scope OR the actor is
   * the assigned executor OR the actor is associated with the Work Order's
   * Workflow Instance. The assignee path matters because a field executor is
   * authorised by assignment, not by owning the Customer's scope.
   */
  private async getAuthorizedWorkOrder(actor: ActorContext, id: string): Promise<WorkOrder> {
    const workOrder = await this.repo.findWorkOrderById(id);
    if (!workOrder || workOrder.tenantId !== actor.tenantId) throw new NotFoundError("WorkOrder", id);
    if (!(await this.isAuthorizedForWorkOrder(actor, workOrder))) {
      throw new ForbiddenError("Your Data Scope does not cover this Work Order");
    }
    return workOrder;
  }

  private async isAuthorizedForWorkOrder(actor: ActorContext, workOrder: WorkOrder): Promise<boolean> {
    if (workOrder.assignedToUserId === actor.userId) return true;
    if (await this.customers.canAccessForDocument(actor, workOrder.customerId)) return true;
    if (
      workOrder.workflowInstanceId &&
      (await this.workflow.isActorAssociatedWithInstance(actor, workOrder.workflowInstanceId))
    ) {
      return true;
    }
    return false;
  }

  /** Only the assigned executor may record execution facts. A Work Order
   * with no assignee yet may be executed by any holder of the execute
   * capability whose scope already covers it. */
  private assertExecutor(actor: ActorContext, workOrder: WorkOrder): void {
    if (workOrder.assignedToUserId && workOrder.assignedToUserId !== actor.userId) {
      throw new ForbiddenError("This Work Order is assigned to another executor");
    }
  }
}

function parseDate(value: string | null | undefined, field: string): Date | null {
  if (value === null || value === undefined || value === "") return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new ValidationError(`${field} is not a valid date`);
  return date;
}
