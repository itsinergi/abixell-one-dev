/**
 * Service Operations Advanced — domain types and port interfaces.
 *
 * Scope discipline:
 * - Vertical Service Packs (PACK-001…004): Structured configuration presets
 *   over generic Service Operations Core. No industry-specific database tables.
 * - Route, Roster, Capacity & Workload Optimization (SO-ADV-002…005):
 *   Deterministic, explainable heuristics. Advisory proposals only — human-confirmed apply.
 * - SO-ADV-006 (Offline Field PWA) is DEFERRED per Founder decision.
 */

export type ServicePackCode = "catering" | "housekeeping" | "camp" | "facility";

export const SERVICE_PACK_CODES: readonly ServicePackCode[] = [
  "catering",
  "housekeeping",
  "camp",
  "facility",
] as const;

export interface ServicePackActivation {
  id: string;
  tenantId: string;
  packCode: ServicePackCode;
  isActive: boolean;
  activatedAt: Date;
  activatedBy: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface ServicePackDefinitionPreset {
  code: string;
  name: string;
  description: string;
  category: string;
  checklistItems: Array<{
    code: string;
    label: string;
    isRequired: boolean;
    sortOrder: number;
  }>;
}

export interface ServicePackPreset {
  packCode: ServicePackCode;
  name: string;
  description: string;
  serviceDefinitions: ServicePackDefinitionPreset[];
}

export type OptimizationRunStatus = "proposed" | "applied" | "dismissed";

export interface OptimizationParameters {
  maxWorkOrdersPerWorker?: number;
  maxMinutesPerWorker?: number;
  prioritizeSla?: boolean;
  groupDistanceNear?: boolean;
}

export interface OptimizationAssignmentProposal {
  workOrderId: string;
  workOrderNumber: string;
  title: string;
  priority: string | null;
  customerId: string;
  siteId: string | null;
  organizationUnitId: string | null;
  recommendedUserId: string;
  recommendedUserName: string;
  estimatedMinutes: number;
  rationale: string;
}

export interface OptimizationRun {
  id: string;
  tenantId: string;
  runNumber: string;
  targetDate: string; // YYYY-MM-DD
  organizationUnitId: string | null;
  parameters: OptimizationParameters;
  proposals: OptimizationAssignmentProposal[];
  status: OptimizationRunStatus;
  appliedAt: Date | null;
  appliedBy: string | null;
  createdAt: Date;
  createdBy: string | null;
}

export interface CreateOptimizationRunInput {
  tenantId: string;
  runNumber: string;
  targetDate: string;
  organizationUnitId?: string | null;
  parameters: OptimizationParameters;
  proposals: OptimizationAssignmentProposal[];
  createdBy: string | null;
}

export interface CandidateWorker {
  userId: string;
  fullName: string;
  organizationUnitId: string | null;
  currentActiveWorkOrdersCount: number;
}

export interface CandidateWorkOrder {
  id: string;
  workOrderNumber: string;
  title: string;
  priority: string | null;
  customerId: string;
  siteId: string | null;
  dueAt: Date | null;
  plannedStartAt: Date | null;
  plannedEndAt: Date | null;
}

export interface ServiceOperationsAdvancedRepository {
  // Service Pack Activations
  getPackActivation(tenantId: string, packCode: ServicePackCode): Promise<ServicePackActivation | null>;
  listPackActivations(tenantId: string): Promise<ServicePackActivation[]>;
  upsertPackActivation(
    tenantId: string,
    packCode: ServicePackCode,
    isActive: boolean,
    activatedBy: string | null,
  ): Promise<ServicePackActivation>;

  // Optimization Runs
  createOptimizationRun(input: CreateOptimizationRunInput): Promise<OptimizationRun>;
  findOptimizationRunById(tenantId: string, id: string): Promise<OptimizationRun | null>;
  listOptimizationRuns(tenantId: string, limit?: number): Promise<OptimizationRun[]>;
  markOptimizationRunApplied(
    tenantId: string,
    id: string,
    appliedBy: string,
  ): Promise<OptimizationRun | null>;
  applyOptimizationRunAssignments(
    tenantId: string,
    id: string,
    appliedBy: string,
  ): Promise<{ run: OptimizationRun; assignedWorkOrderIds: string[] } | null>;
  markOptimizationRunDismissed(tenantId: string, id: string): Promise<OptimizationRun | null>;

  // Narrow cross-domain reads for optimization engine
  listEligibleWorkers(tenantId: string, organizationUnitId?: string | null): Promise<CandidateWorker[]>;
  listUnassignedWorkOrders(
    tenantId: string,
    targetDate: string,
    organizationUnitId?: string | null,
  ): Promise<CandidateWorkOrder[]>;
  assignWorkOrder(
    tenantId: string,
    workOrderId: string,
    userId: string,
    assignedByUserId: string,
  ): Promise<boolean>;
}
