/**
 * Service Operations & Work Management Core — domain types (Phase 2).
 *
 * First module built under the frozen target repository architecture
 * (`modules/<module>/core/{domain,application,infrastructure,api}`, blueprint
 * §11A). It depends on Platform Core through application ports only; it never
 * reaches into another business module's internals.
 *
 * Generic by construction: no industry vocabulary (catering, housekeeping,
 * camp, facility) appears anywhere in this module. Verticals arrive later as
 * Configuration + Vertical Service Packs over these same entities.
 */

// ---------------------------------------------------------------------------
// Service Definition (template) — SO-CORE-001 / SO-CORE-007
// ---------------------------------------------------------------------------

export interface ServiceDefinition {
  id: string;
  tenantId: string;
  code: string;
  name: string;
  description: string | null;
  category: string | null;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface ServiceDefinitionChecklistItem {
  id: string;
  serviceDefinitionId: string;
  code: string;
  label: string;
  isRequired: boolean;
  sortOrder: number;
}

// ---------------------------------------------------------------------------
// Work Request (demand / intake) — SO-CORE-002
// ---------------------------------------------------------------------------

/** Derived from `convertedWorkOrderId` / `cancelledAt` — deliberately NOT a
 * stored status column, so intake bookkeeping can never become a competing
 * lifecycle alongside the Workflow Engine. */
export type WorkRequestState = "open" | "converted" | "cancelled";

export interface WorkRequest {
  id: string;
  tenantId: string;
  requestNumber: string;
  customerId: string;
  contractId: string | null;
  projectId: string | null;
  siteId: string | null;
  serviceDefinitionId: string;
  description: string;
  priority: string | null;
  requestedByUserId: string;
  requestedAt: Date;
  convertedWorkOrderId: string | null;
  convertedAt: Date | null;
  cancelledAt: Date | null;
  cancellationReason: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export function workRequestState(request: WorkRequest): WorkRequestState {
  if (request.cancelledAt) return "cancelled";
  if (request.convertedWorkOrderId) return "converted";
  return "open";
}

// ---------------------------------------------------------------------------
// Work Order (executable unit) — SO-CORE-003 … SO-CORE-010
// ---------------------------------------------------------------------------

export interface WorkOrder {
  id: string;
  tenantId: string;
  workOrderNumber: string;
  workRequestId: string | null;
  customerId: string;
  contractId: string | null;
  projectId: string | null;
  siteId: string | null;
  serviceDefinitionId: string;
  title: string;
  description: string | null;
  priority: string | null;
  plannedStartAt: Date | null;
  plannedEndAt: Date | null;
  dueAt: Date | null;
  assignedToUserId: string | null;
  assignedAt: Date | null;
  assignedByUserId: string | null;
  startedAt: Date | null;
  startedByUserId: string | null;
  completionNotes: string | null;
  completedAt: Date | null;
  completedByUserId: string | null;
  verificationNotes: string | null;
  verifiedAt: Date | null;
  verifiedByUserId: string | null;
  /** The ONE link to the generic Workflow Engine — lifecycle STATE lives
   * there, never as a status column here (SO-CORE-004). */
  workflowInstanceId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/** Snapshot of the Service Definition's checklist taken when the Work Order
 * is created, so editing the template later cannot rewrite the history of
 * already-executed work. */
export interface WorkOrderChecklistItem {
  id: string;
  workOrderId: string;
  sourceChecklistItemId: string | null;
  code: string;
  label: string;
  isRequired: boolean;
  sortOrder: number;
  isCompleted: boolean;
  note: string | null;
  completedAt: Date | null;
  completedByUserId: string | null;
}

// ---------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------

export interface CreateServiceDefinitionInput {
  tenantId: string;
  code: string;
  name: string;
  description?: string | null;
  category?: string | null;
  createdBy: string | null;
}

export interface CreateWorkRequestInput {
  tenantId: string;
  requestNumber: string;
  customerId: string;
  contractId?: string | null;
  projectId?: string | null;
  siteId?: string | null;
  serviceDefinitionId: string;
  description: string;
  priority?: string | null;
  requestedByUserId: string;
  createdBy: string | null;
}

export interface CreateWorkOrderInput {
  tenantId: string;
  workOrderNumber: string;
  workRequestId?: string | null;
  customerId: string;
  contractId?: string | null;
  projectId?: string | null;
  siteId?: string | null;
  serviceDefinitionId: string;
  title: string;
  description?: string | null;
  priority?: string | null;
  plannedStartAt?: Date | null;
  plannedEndAt?: Date | null;
  dueAt?: Date | null;
  createdBy: string | null;
}

export interface ScheduleWorkOrderInput {
  plannedStartAt: Date | null;
  plannedEndAt: Date | null;
  dueAt: Date | null;
}

// ---------------------------------------------------------------------------
// Repository port
// ---------------------------------------------------------------------------

export interface ServiceOperationsRepository {
  /** Tenant of a user — used to reject cross-tenant assignment without
   * pulling in the Identity module's internals. */
  findUserTenantId(userId: string): Promise<string | null>;

  // Service Definition
  createServiceDefinition(input: CreateServiceDefinitionInput): Promise<ServiceDefinition>;
  findServiceDefinitionById(id: string): Promise<ServiceDefinition | null>;
  findServiceDefinitionByCode(tenantId: string, code: string): Promise<ServiceDefinition | null>;
  listServiceDefinitions(tenantId: string): Promise<ServiceDefinition[]>;
  setServiceDefinitionActive(id: string, isActive: boolean, updatedBy: string | null): Promise<ServiceDefinition | null>;

  addChecklistTemplateItem(input: {
    serviceDefinitionId: string;
    code: string;
    label: string;
    isRequired: boolean;
    sortOrder: number;
  }): Promise<ServiceDefinitionChecklistItem>;
  listChecklistTemplateItems(serviceDefinitionId: string): Promise<ServiceDefinitionChecklistItem[]>;

  // Work Request
  createWorkRequest(input: CreateWorkRequestInput): Promise<WorkRequest>;
  findWorkRequestById(id: string): Promise<WorkRequest | null>;
  listWorkRequests(tenantId: string, filter: { customerIds?: string[] }): Promise<WorkRequest[]>;
  markWorkRequestConverted(id: string, workOrderId: string, updatedBy: string | null): Promise<WorkRequest | null>;
  cancelWorkRequest(id: string, reason: string | null, updatedBy: string | null): Promise<WorkRequest | null>;

  // Work Order
  createWorkOrder(input: CreateWorkOrderInput): Promise<WorkOrder>;
  findWorkOrderById(id: string): Promise<WorkOrder | null>;
  listWorkOrders(
    tenantId: string,
    filter: { customerIds?: string[]; assignedToUserId?: string; siteId?: string },
  ): Promise<WorkOrder[]>;
  setWorkOrderWorkflowInstance(id: string, workflowInstanceId: string): Promise<void>;
  assignWorkOrder(id: string, assigneeUserId: string, assignedByUserId: string): Promise<WorkOrder | null>;
  scheduleWorkOrder(id: string, input: ScheduleWorkOrderInput, updatedBy: string | null): Promise<WorkOrder | null>;
  /** Guarded start: only sets execution facts when not already started —
   * returns null when a concurrent/duplicate start already won. */
  markWorkOrderStarted(id: string, userId: string): Promise<WorkOrder | null>;
  /** Guarded completion: only records completion when not already completed. */
  markWorkOrderCompleted(id: string, notes: string | null, userId: string): Promise<WorkOrder | null>;
  /** Guarded verification: only records verification when not already verified. */
  markWorkOrderVerified(id: string, notes: string | null, userId: string): Promise<WorkOrder | null>;

  // Work Order checklist
  createWorkOrderChecklistItems(
    workOrderId: string,
    items: {
      sourceChecklistItemId: string | null;
      code: string;
      label: string;
      isRequired: boolean;
      sortOrder: number;
    }[],
  ): Promise<WorkOrderChecklistItem[]>;
  listWorkOrderChecklistItems(workOrderId: string): Promise<WorkOrderChecklistItem[]>;
  findWorkOrderChecklistItem(id: string): Promise<WorkOrderChecklistItem | null>;
  setChecklistItemCompletion(
    id: string,
    input: { isCompleted: boolean; note: string | null; userId: string },
  ): Promise<WorkOrderChecklistItem | null>;
}
