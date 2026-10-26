/**
 * Project Delivery Advanced — domain types (Wave A7, PRJ-ADV-001…008).
 *
 * Advanced scheduling and project-cost depth, layered on top of the frozen
 * Core activity/milestone surface. Core is never modified and never depends on
 * anything declared here: a project with no WBS, no dependencies, no baseline
 * and no cost entries behaves exactly as it did before this module existed.
 *
 * Governing decisions (ADR-0026):
 * - Project Delivery owns project-cost truth; Finance owns ledger truth. This
 *   module never inserts a journal row. `PRJ-ADV-008` emits an accounting-ready
 *   event through a port and the Accounting Kernel posts it.
 * - Earned value and cost control are advisory computations over recorded
 *   facts. They never mutate budget, commitment, baseline or ledger state.
 * - All monetary arithmetic is exact-decimal scaled-integer. No binary
 *   floating point decides an authoritative amount.
 */

// ---------------------------------------------------------------------------
// Exact-decimal money and quantity (scaled integers)
// ---------------------------------------------------------------------------

/** 16 integer digits, up to 2 decimals. Same shape as the asset-book parser. */
const MONEY_2DP = /^-?\d{1,16}(\.\d{1,2})?$/;
/** Up to 4 decimals, for resource quantities and rates. */
const UNITS_4DP = /^-?\d{1,16}(\.\d{1,4})?$/;

/**
 * Parse a 2-decimal money string to cents. Returns null on anything
 * unparseable rather than silently coercing to 0 — a cost that reads as zero
 * because the input was malformed is worse than a refusal.
 */
export function toCents(value: string | null | undefined): bigint | null {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  if (!MONEY_2DP.test(text)) return null;
  const negative = text.startsWith("-");
  const [whole, frac = ""] = (negative ? text.slice(1) : text).split(".");
  const cents = BigInt(whole) * 100n + BigInt((frac + "00").slice(0, 2));
  return negative ? -cents : cents;
}

export function fromCents(cents: bigint): string {
  const negative = cents < 0n;
  const abs = negative ? -cents : cents;
  return `${negative ? "-" : ""}${abs / 100n}.${(abs % 100n).toString().padStart(2, "0")}`;
}

/** Parse a 4-decimal quantity to scaled integers (1 unit = 10000). */
export function toUnits(value: string | null | undefined): bigint | null {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  if (!UNITS_4DP.test(text)) return null;
  const negative = text.startsWith("-");
  const [whole, frac = ""] = (negative ? text.slice(1) : text).split(".");
  const units = BigInt(whole) * 10000n + BigInt((frac + "0000").slice(0, 4));
  return negative ? -units : units;
}

export function fromUnits(units: bigint): string {
  const negative = units < 0n;
  const abs = negative ? -units : units;
  return `${negative ? "-" : ""}${abs / 10000n}.${(abs % 10000n).toString().padStart(4, "0")}`;
}

/**
 * Multiply cents by a ratio expressed as a scaled integer fraction, rounding
 * half-away-from-zero at the cent. Used by earned value and levelling, where a
 * percentage is applied to a money amount.
 */
export function applyRatio(amountCents: bigint, numerator: bigint, denominator: bigint): bigint {
  if (denominator === 0n) return 0n;
  const product = amountCents * numerator;
  const quotient = product / denominator;
  const remainder = product % denominator;
  // Round half away from zero so a symmetric schedule yields symmetric values.
  const twiceAbsRemainder = (remainder < 0n ? -remainder : remainder) * 2n;
  const absDenominator = denominator < 0n ? -denominator : denominator;
  if (twiceAbsRemainder >= absDenominator) {
    return quotient + (product < 0n ? -1n : 1n);
  }
  return quotient;
}

// ---------------------------------------------------------------------------
// WBS (PRJ-ADV-001)
// ---------------------------------------------------------------------------

export interface ProjectWbsNode {
  id: string;
  tenantId: string;
  projectId: string;
  parentId: string | null;
  code: string;
  name: string;
  description: string | null;
  /** Derived from the parent chain at write time, never trusted from input. */
  depth: number;
  sortOrder: number;
  createdByUserId: string | null;
  updatedByUserId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/** A WBS node with the rollup of the activities hanging off it. */
export interface ProjectWbsNodeView extends ProjectWbsNode {
  activityCount: number;
  /** Exact-decimal, 2dp. Sum of the node's own and descendants' activity cost. */
  rolledUpCost: string;
  children: ProjectWbsNodeView[];
}

export interface CreateWbsNodeInput {
  tenantId: string;
  projectId: string;
  parentId: string | null;
  code: string;
  name: string;
  description: string | null;
  /** Derived by the service from the parent chain, never trusted from input. */
  depth: number;
  sortOrder: number;
  createdBy: string | null;
}

export interface UpdateWbsNodeInput {
  code?: string;
  name?: string;
  description?: string | null;
  sortOrder?: number;
  updatedBy?: string | null;
}

// ---------------------------------------------------------------------------
// Dependencies and critical path (PRJ-ADV-002, PRJ-ADV-003)
// ---------------------------------------------------------------------------

/** Finish-to-start, start-to-start, finish-to-finish, start-to-finish. */
export type DependencyType = "FS" | "SS" | "FF" | "SF";

export const DEPENDENCY_TYPES: DependencyType[] = ["FS", "SS", "FF", "SF"];

export interface ProjectActivityDependency {
  id: string;
  tenantId: string;
  projectId: string;
  predecessorActivityId: string;
  successorActivityId: string;
  dependencyType: DependencyType;
  /** Working days. May be negative (a lead). */
  lagDays: number;
  createdByUserId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateDependencyInput {
  tenantId: string;
  projectId: string;
  predecessorActivityId: string;
  successorActivityId: string;
  dependencyType: DependencyType;
  lagDays: number;
  createdBy: string | null;
}

/** One activity's scheduling result. Dates are `YYYY-MM-DD`. */
export interface ScheduleActivityResult {
  activityId: string;
  /** Duration in days derived from planned dates; 0 for a milestone-like row. */
  durationDays: number;
  earliestStart: string;
  earliestFinish: string;
  latestStart: string;
  latestFinish: string;
  /** Finite only when the activity is on a critical path. */
  totalFloatDays: number;
  isCritical: boolean;
}

export interface ProjectSchedule {
  projectId: string;
  computedAt: string;
  activities: ScheduleActivityResult[];
  /** Project finish = the latest earliest-finish across scheduled activities. */
  projectFinish: string | null;
  criticalPath: string[];
  /** Activities with no dependency edges in either direction. */
  unscheduledActivityIds: string[];
  /** True when the graph had a cycle and the result must not be trusted. */
  hasCycle: boolean;
}

/**
 * A Gantt row. This is presentation data derived from the schedule plus the
 * activity's own record; nothing here is stored (PRJ-ADV-003).
 */
export interface GanttRow {
  activityId: string;
  title: string;
  wbsNodeId: string | null;
  start: string;
  finish: string;
  isCritical: boolean;
  totalFloatDays: number;
  progressPercent: number;
  milestoneCount: number;
}

// ---------------------------------------------------------------------------
// Resource loading (PRJ-ADV-004)
// ---------------------------------------------------------------------------

export type ResourceType = "labor" | "equipment" | "material" | "other";

export const RESOURCE_TYPES: ResourceType[] = ["labor", "equipment", "material", "other"];

export interface ProjectResource {
  id: string;
  tenantId: string;
  code: string;
  name: string;
  resourceType: ResourceType;
  unit: string;
  /** Exact-decimal 4dp. Available quantity per day, or null when unbounded. */
  capacityPerDay: string | null;
  /** Exact-decimal 2dp. Cost per unit. */
  costRate: string | null;
  isActive: boolean;
  createdByUserId: string | null;
  updatedByUserId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface ProjectResourceAssignment {
  id: string;
  tenantId: string;
  projectId: string;
  activityId: string;
  resourceId: string;
  /** Exact-decimal 4dp, total quantity for the activity. */
  plannedUnits: string;
  startDate: string;
  endDate: string;
  createdByUserId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateResourceInput {
  tenantId: string;
  code: string;
  name: string;
  resourceType: ResourceType;
  unit: string;
  capacityPerDay: string | null;
  costRate: string | null;
  createdBy: string | null;
}

export interface CreateResourceAssignmentInput {
  tenantId: string;
  projectId: string;
  activityId: string;
  resourceId: string;
  plannedUnits: string;
  startDate: string;
  endDate: string;
  createdBy: string | null;
}

/** A day on which one resource is over-committed. */
export interface ResourceOverallocation {
  resourceId: string;
  resourceCode: string;
  date: string;
  /** Exact-decimal 4dp: sum of daily demand across overlapping assignments. */
  demandedUnits: string;
  /** Exact-decimal 4dp, or null when the resource is unbounded. */
  capacityUnits: string | null;
  /** Exact-decimal 4dp the demand exceeds capacity by. */
  overByUnits: string;
  assignmentIds: string[];
}

export interface ResourceLoadingResult {
  projectId: string;
  from: string;
  to: string;
  overallocations: ResourceOverallocation[];
  /** True when every over-allocated resource has a capacity to compare against. */
  isLevellable: boolean;
}

// ---------------------------------------------------------------------------
// Baseline and variance (PRJ-ADV-005)
// ---------------------------------------------------------------------------

export type BaselineStatus = "draft" | "approved" | "superseded";

export const BASELINE_STATUSES: BaselineStatus[] = ["draft", "approved", "superseded"];

export interface ProjectBaseline {
  id: string;
  tenantId: string;
  projectId: string;
  version: number;
  name: string;
  status: BaselineStatus;
  notes: string | null;
  approvedAt: Date | null;
  approvedByUserId: string | null;
  createdByUserId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface ProjectBaselineLine {
  id: string;
  tenantId: string;
  baselineId: string;
  activityId: string;
  plannedStart: string | null;
  plannedFinish: string | null;
  /** Exact-decimal 2dp. */
  plannedCost: string;
  /** Exact-decimal 4dp. */
  plannedUnits: string;
}

export interface BaselineVarianceLine {
  activityId: string;
  title: string;
  baselineStart: string | null;
  baselineFinish: string | null;
  currentStart: string | null;
  currentFinish: string | null;
  /** Positive = later than baseline. Null when either side is missing. */
  startVarianceDays: number | null;
  finishVarianceDays: number | null;
  baselineCost: string;
  /** Exact-decimal 2dp actual cost recorded against the activity. */
  actualCost: string;
  costVariance: string;
  progressPercent: number;
  isSlipped: boolean;
}

export interface BaselineVarianceResult {
  projectId: string;
  baselineId: string;
  baselineVersion: number;
  asOfDate: string;
  lines: BaselineVarianceLine[];
  totalBaselineCost: string;
  totalActualCost: string;
  totalCostVariance: string;
  slippedActivityCount: number;
}

// ---------------------------------------------------------------------------
// Earned value and cost control (PRJ-ADV-006, PRJ-ADV-007)
// ---------------------------------------------------------------------------

export interface ProjectCostEntry {
  id: string;
  tenantId: string;
  projectId: string;
  activityId: string | null;
  /** `actual` is incurred, `commitment` is ordered-not-yet-incurred. */
  entryType: "actual" | "commitment" | "adjustment" | "reversal";
  /** Exact-decimal 2dp. Always non-negative; the type carries the sign. */
  amount: string;
  currency: string;
  entryDate: string;
  sourceDocumentType: string | null;
  sourceDocumentId: string | null;
  /** Set on a reversal row; the row it compensates is never mutated. */
  reversesId: string | null;
  idempotencyKey: string;
  note: string | null;
  createdByUserId: string | null;
  createdAt: Date;
}

export interface CreateCostEntryInput {
  tenantId: string;
  projectId: string;
  activityId: string | null;
  entryType: "actual" | "commitment" | "adjustment";
  amount: string;
  currency: string;
  entryDate: string;
  sourceDocumentType: string | null;
  sourceDocumentId: string | null;
  idempotencyKey: string;
  note: string | null;
  createdBy: string | null;
}

/** The authoritative cost position, all projections over the entry ledger. */
export interface ProjectCostPosition {
  projectId: string;
  asOfDate: string;
  currency: string;
  /** Exact-decimal 2dp. */
  actualCost: string;
  commitmentCost: string;
  adjustmentCost: string;
  /** actual + commitment + adjustment. */
  totalCommittedCost: string;
  /** Per-activity breakdown, keyed by activity id; `null` key is unassigned. */
  byActivity: { activityId: string | null; actualCost: string; commitmentCost: string }[];
}

/**
 * One earned-value snapshot (PRJ-ADV-006). Stored rather than recomputed so a
 * later change to the cost ledger or baseline cannot silently rewrite a
 * reported period.
 */
export interface ProjectEarnedValueSnapshot {
  id: string;
  tenantId: string;
  projectId: string;
  asOfDate: string;
  currency: string;
  /** Exact-decimal 2dp for every money field. */
  plannedValue: string;
  earnedValue: string;
  actualCost: string;
  scheduleVariance: string;
  costVariance: string;
  /** Indexes at 4dp. Null when the denominator is zero. */
  schedulePerformanceIndex: string | null;
  costPerformanceIndex: string | null;
  budgetAtCompletion: string;
  estimateAtCompletion: string | null;
  estimateToComplete: string | null;
  varianceAtCompletion: string | null;
  notes: string | null;
  computedByUserId: string | null;
  createdAt: Date;
}

export interface EarnedValueResult {
  projectId: string;
  asOfDate: string;
  currency: string;
  plannedValue: string;
  earnedValue: string;
  actualCost: string;
  scheduleVariance: string;
  costVariance: string;
  schedulePerformanceIndex: string | null;
  costPerformanceIndex: string | null;
  budgetAtCompletion: string;
  estimateAtCompletion: string | null;
  estimateToComplete: string | null;
  varianceAtCompletion: string | null;
  percentComplete: string;
  /** Activities that contributed, with their own PV/EV/AC. */
  lines: {
    activityId: string;
    title: string;
    plannedValue: string;
    earnedValue: string;
    actualCost: string;
    progressPercent: number;
  }[];
}

/**
 * The accounting-ready event this module is allowed to emit (ADR-0026 §2).
 *
 * Project Delivery never writes the GL. It hands the kernel a fact and the
 * kernel decides the accounts and posts. Emitting is idempotent by key.
 */
export interface ProjectAccountingEventInput {
  eventType: "project.cost_incurred";
  sourceDocumentType: string;
  sourceDocumentId: string;
  effectiveAt: Date;
  currency: string;
  /** A decimal string is bound verbatim by pg, so the amount the kernel posts
   * is exactly the amount on the entry — never a JS double (ADR-0026 §5). */
  amount: number | string;
  idempotencyKey: string;
  payload: Record<string, unknown>;
  createdBy?: string | null;
}

/**
 * Local port. Structurally satisfied by the shared `PgAccountingEventWritePort`
 * that Supply Chain, Workforce, and Service Operations already use, so no
 * module-to-module import is needed and the kernel stays the only GL writer.
 */
export interface ProjectAccountingEventPort {
  createEvent(tenantId: string, input: ProjectAccountingEventInput): Promise<unknown>;
  getEventByIdempotencyKey(tenantId: string, idempotencyKey: string): Promise<unknown | null>;
}

/** What `postProjectCost` recorded locally: the fact and its outbound link. */
export interface ProjectCostPosting {
  id: string;
  tenantId: string;
  projectId: string;
  costEntryId: string;
  idempotencyKey: string;
  status: "emitted" | "skipped_duplicate";
  createdAt: Date;
}

// ---------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------

export interface ListDependenciesFilter {
  projectId: string;
}

// ---------------------------------------------------------------------------
// Repository port
// ---------------------------------------------------------------------------

export interface ProjectDeliveryAdvancedRepository {
  // --- WBS (PRJ-ADV-001) --------------------------------------------------
  createWbsNode(input: CreateWbsNodeInput): Promise<ProjectWbsNode>;
  findWbsNodeById(id: string): Promise<ProjectWbsNode | null>;
  listWbsNodes(projectId: string): Promise<ProjectWbsNode[]>;
  updateWbsNode(id: string, input: UpdateWbsNodeInput): Promise<ProjectWbsNode | null>;
  /** Descendant ids of a node, used to refuse a reparent that would cycle. */
  listWbsDescendantIds(tenantId: string, nodeId: string): Promise<string[]>;
  /**
   * Place a Core activity under a WBS node, or remove it from any node with
   * null. Writes only the Advanced-owned column `wbs_node_id`; the Core
   * activity record itself is untouched (ADR-0026 §4).
   */
  assignActivityToWbsNode(input: {
    tenantId: string;
    activityId: string;
    wbsNodeId: string | null;
    updatedBy: string | null;
  }): Promise<CoreActivityRef | null>;

  // --- Dependencies (PRJ-ADV-002) ----------------------------------------
  createDependency(input: CreateDependencyInput): Promise<ProjectActivityDependency>;
  findDependencyById(id: string): Promise<ProjectActivityDependency | null>;
  listDependencies(projectId: string): Promise<ProjectActivityDependency[]>;
  deleteDependency(id: string): Promise<boolean>;

  // --- Resources (PRJ-ADV-004) -------------------------------------------
  createResource(input: CreateResourceInput): Promise<ProjectResource>;
  findResourceById(id: string): Promise<ProjectResource | null>;
  listResources(tenantId: string, activeOnly: boolean): Promise<ProjectResource[]>;
  createResourceAssignment(input: CreateResourceAssignmentInput): Promise<ProjectResourceAssignment>;
  listResourceAssignments(projectId: string): Promise<ProjectResourceAssignment[]>;

  // --- Baseline (PRJ-ADV-005) --------------------------------------------
  createBaseline(input: {
    tenantId: string;
    projectId: string;
    version: number;
    name: string;
    notes: string | null;
    createdBy: string | null;
  }): Promise<ProjectBaseline>;
  findBaselineById(id: string): Promise<ProjectBaseline | null>;
  listBaselines(projectId: string): Promise<ProjectBaseline[]>;
  findActiveBaseline(projectId: string): Promise<ProjectBaseline | null>;
  /** Returns null when the baseline is not in the tenant; supersedes any prior approved row. */
  approveBaseline(input: {
    tenantId: string;
    baselineId: string;
    approvedBy: string | null;
  }): Promise<ProjectBaseline | null>;
  listBaselineLines(baselineId: string): Promise<ProjectBaselineLine[]>;
  /** Snapshot the project's current plan into a baseline's lines. Returns rows written. */
  insertBaselineLinesFromPlan(input: {
    tenantId: string;
    baselineId: string;
    projectId: string;
    plannedCostByActivity: Map<string, string>;
  }): Promise<number>;

  // --- Cost (PRJ-ADV-006/007) --------------------------------------------
  createCostEntry(input: CreateCostEntryInput): Promise<ProjectCostEntry>;
  findCostEntryById(id: string): Promise<ProjectCostEntry | null>;
  listCostEntries(projectId: string, asOfDate: string | null): Promise<ProjectCostEntry[]>;
  findCostEntryByIdempotencyKey(tenantId: string, key: string): Promise<ProjectCostEntry | null>;
  /** Returns null when the entry is not in the tenant. Never mutates the original. */
  reverseCostEntry(input: {
    tenantId: string;
    entryId: string;
    note: string | null;
    createdBy: string | null;
  }): Promise<ProjectCostEntry | null>;

  // --- Earned value snapshots --------------------------------------------
  createEarnedValueSnapshot(input: {
    tenantId: string;
    projectId: string;
    asOfDate: string;
    currency: string;
    plannedValue: string;
    earnedValue: string;
    actualCost: string;
    scheduleVariance: string;
    costVariance: string;
    schedulePerformanceIndex: string | null;
    costPerformanceIndex: string | null;
    budgetAtCompletion: string;
    estimateAtCompletion: string | null;
    estimateToComplete: string | null;
    varianceAtCompletion: string | null;
    notes: string | null;
    computedBy: string | null;
  }): Promise<ProjectEarnedValueSnapshot>;
  listEarnedValueSnapshots(projectId: string): Promise<ProjectEarnedValueSnapshot[]>;

  // --- Posting ledger -----------------------------------------------------
  recordCostPosting(input: {
    tenantId: string;
    projectId: string;
    costEntryId: string;
    idempotencyKey: string;
    status: "emitted" | "skipped_duplicate";
  }): Promise<ProjectCostPosting>;
  listCostPostings(projectId: string): Promise<ProjectCostPosting[]>;

  // --- Cross-domain reads (clean reference ports) -------------------------
  /** Core activities, read through the delivered Core shape — no new source. */
  listCoreActivities(projectId: string): Promise<CoreActivityRef[]>;
  findCoreActivityById(id: string): Promise<CoreActivityRef | null>;
  projectExists(tenantId: string, projectId: string): Promise<boolean>;
}

/** The subset of the frozen Core activity record Advanced scheduling needs. */
export interface CoreActivityRef {
  id: string;
  tenantId: string;
  projectId: string;
  title: string;
  status: string;
  progressPercent: number;
  plannedStartDate: string | null;
  plannedEndDate: string | null;
  /** Advanced-owned column on the Core table; null when never assigned. */
  wbsNodeId: string | null;
}