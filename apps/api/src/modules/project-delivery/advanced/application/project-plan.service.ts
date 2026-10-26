import type { ActorContext } from "../../../../domain/shared-kernel/audit-context.js";
import { ForbiddenError, NotFoundError, ValidationError } from "../../../../domain/shared-kernel/errors.js";
import type { AuditService } from "../../../../application/audit/audit.service.js";
import type { RbacService } from "../../../../application/rbac/rbac.service.js";
import {
  DEPENDENCY_TYPES,
  RESOURCE_TYPES,
  toCents,
  toUnits,
  type BaselineVarianceResult,
  type CoreActivityRef,
  type DependencyType,
  type GanttRow,
  type ProjectBaseline,
  type ProjectDeliveryAdvancedRepository,
  type ProjectResource,
  type ProjectSchedule,
  type ProjectWbsNode,
  type ProjectWbsNodeView,
  type ResourceLoadingResult,
  type ResourceType,
} from "../domain/project-delivery-advanced.entity.js";
import {
  buildGanttRows,
  computeBaselineVariance,
  computeResourceLoading,
  computeSchedule,
} from "../domain/project-delivery-advanced.math.js";

/**
 * Project Delivery Advanced — plan side (PRJ-ADV-001…005).
 *
 * WBS, dependency graph, critical path, Gantt, resource loading, baseline and
 * variance. Everything here is read over the frozen Core activity surface plus
 * this module's own plan tables; no Core row is written.
 *
 * ADR-0026 §4 is the constraint that shapes the whole file: scheduling math is
 * Advanced-only, and no Core path may require an Advanced table to exist. That
 * is why every read here tolerates "no WBS, no edges, no baseline" and returns
 * an honest empty answer rather than an error.
 *
 * Cost and earned value live in `project-cost.service.ts`; the split follows
 * the ownership line ADR-0026 §1 draws, not file size.
 */
export class ProjectPlanService {
  constructor(
    private readonly repo: ProjectDeliveryAdvancedRepository,
    private readonly audit: AuditService,
    private readonly rbac: RbacService,
  ) {}

  // -------------------------------------------------------------------------
  // WBS (PRJ-ADV-001)
  // -------------------------------------------------------------------------

  async listWbsTree(actor: ActorContext, projectId: string): Promise<ProjectWbsNodeView[]> {
    await this.rbac.requirePermission(actor, "project_delivery.advanced.read");
    await this.requireProject(actor, projectId);

    const nodes = await this.repo.listWbsNodes(projectId);
    const activities = await this.repo.listCoreActivities(projectId);
    const costs = await this.repo.listCostEntries(projectId, null);

    // Actual cost rolled up per WBS node, then up each ancestor chain. A node
    // reports its own activities plus everything beneath it, which is what a
    // WBS rollup means; summing only direct children would make a parent look
    // cheaper than the work it contains.
    const nodeOfActivity = new Map<string, string>();
    for (const activity of activities) {
      const nodeId = (activity as CoreActivityRef & { wbsNodeId?: string | null }).wbsNodeId;
      if (nodeId) nodeOfActivity.set(activity.id, nodeId);
    }

    const ownCost = new Map<string, bigint>();
    for (const entry of costs) {
      if (entry.activityId === null) continue;
      if (entry.entryType !== "actual" && entry.entryType !== "reversal") continue;
      const nodeId = nodeOfActivity.get(entry.activityId);
      if (!nodeId) continue;
      const cents = toCents(entry.amount);
      if (cents === null) continue;
      const sign = entry.entryType === "reversal" ? -cents : cents;
      ownCost.set(nodeId, (ownCost.get(nodeId) ?? 0n) + sign);
    }

    const ownActivityCount = new Map<string, number>();
    for (const nodeId of nodeOfActivity.values()) {
      ownActivityCount.set(nodeId, (ownActivityCount.get(nodeId) ?? 0) + 1);
    }

    const byParent = new Map<string | null, ProjectWbsNode[]>();
    for (const node of nodes) {
      const siblings = byParent.get(node.parentId) ?? [];
      siblings.push(node);
      byParent.set(node.parentId, siblings);
    }
    for (const siblings of byParent.values()) {
      siblings.sort((a, b) => a.sortOrder - b.sortOrder || a.code.localeCompare(b.code));
    }

    const build = (parentId: string | null): ProjectWbsNodeView[] =>
      (byParent.get(parentId) ?? []).map((node) => {
        const children = build(node.id);
        const rolledUp =
          (ownCost.get(node.id) ?? 0n) + children.reduce((sum, c) => sum + cRolledUp(c), 0n);
        return {
          ...node,
          activityCount:
            (ownActivityCount.get(node.id) ?? 0) +
            children.reduce((sum, c) => sum + c.activityCount, 0),
          rolledUpCost: centsToString(rolledUp),
          children,
        };
      });

    return build(null);
  }

  async createWbsNode(
    actor: ActorContext,
    projectId: string,
    input: {
      parentId?: string | null;
      code: string;
      name: string;
      description?: string | null;
      sortOrder?: number;
    },
  ): Promise<ProjectWbsNode> {
    await this.rbac.requirePermission(actor, "project_delivery.advanced.manage");
    await this.requireProject(actor, projectId);

    const code = requireText(input.code, "code");
    const name = requireText(input.name, "name");

    let depth = 0;
    if (input.parentId) {
      const parent = await this.repo.findWbsNodeById(input.parentId);
      if (!parent || parent.tenantId !== actor.tenantId || parent.projectId !== projectId) {
        throw new NotFoundError("ProjectWbsNode", input.parentId);
      }
      depth = parent.depth + 1;
      // Twelve levels is the column's own CHECK. Refusing here rather than
      // letting the constraint fire gives the caller a sentence, not a 500.
      if (depth > 12) throw new ValidationError("WBS depth cannot exceed 12 levels");
    }

    const node = await this.repo.createWbsNode({
      tenantId: actor.tenantId,
      projectId,
      parentId: input.parentId ?? null,
      code,
      name,
      description: clean(input.description),
      depth,
      sortOrder: input.sortOrder ?? 0,
      createdBy: actor.userId,
    });

    await this.audit.record({
      tenantId: actor.tenantId,
      actorUserId: actor.userId,
      action: "project_delivery.wbs.created",
      entityType: "project_wbs_node",
      entityId: node.id,
      metadata: { projectId, code: node.code, depth: node.depth },
    });
    return node;
  }

  async updateWbsNode(
    actor: ActorContext,
    id: string,
    input: { code?: string; name?: string; description?: string | null; sortOrder?: number },
  ): Promise<ProjectWbsNode> {
    await this.rbac.requirePermission(actor, "project_delivery.advanced.manage");
    const existing = await this.requireWbsNode(actor, id);

    const updated = await this.repo.updateWbsNode(id, {
      code: input.code !== undefined ? requireText(input.code, "code") : undefined,
      name: input.name !== undefined ? requireText(input.name, "name") : undefined,
      description: input.description !== undefined ? clean(input.description) : undefined,
      sortOrder: input.sortOrder,
      updatedBy: actor.userId,
    });
    if (!updated) throw new NotFoundError("ProjectWbsNode", id);

    await this.audit.record({
      tenantId: actor.tenantId,
      actorUserId: actor.userId,
      action: "project_delivery.wbs.updated",
      entityType: "project_wbs_node",
      entityId: id,
      metadata: { projectId: existing.projectId },
    });
    return updated;
  }

  /**
   * Place a Core activity under a WBS node, or clear its node with `null`.
   *
   * Only the Advanced-owned column `wbs_node_id` is written. The Core activity
   * record — its dates, status, progress — is untouched, which is what keeps a
   * Core-only tenant's behaviour identical (ADR-0026 §4).
   */
  async assignActivityToWbsNode(
    actor: ActorContext,
    activityId: string,
    wbsNodeId: string | null,
  ): Promise<CoreActivityRef> {
    await this.rbac.requirePermission(actor, "project_delivery.advanced.manage");

    const activity = await this.repo.findCoreActivityById(activityId);
    if (!activity || activity.tenantId !== actor.tenantId) {
      throw new NotFoundError("ProjectDeliveryActivity", activityId);
    }
    await this.requireProject(actor, activity.projectId);

    if (wbsNodeId !== null) {
      const node = await this.repo.findWbsNodeById(wbsNodeId);
      // A node from another project would silently move the activity into a
      // tree it does not belong to, so the project must match too.
      if (!node || node.tenantId !== actor.tenantId || node.projectId !== activity.projectId) {
        throw new NotFoundError("ProjectWbsNode", wbsNodeId);
      }
    }

    const updated = await this.repo.assignActivityToWbsNode({
      tenantId: actor.tenantId,
      activityId,
      wbsNodeId,
      updatedBy: actor.userId,
    });
    if (!updated) throw new NotFoundError("ProjectDeliveryActivity", activityId);

    await this.audit.record({
      tenantId: actor.tenantId,
      actorUserId: actor.userId,
      action: "project_delivery.wbs.activity_assigned",
      entityType: "project_delivery_activity",
      entityId: activityId,
      metadata: { projectId: activity.projectId, wbsNodeId },
    });
    return updated;
  }

  // -------------------------------------------------------------------------
  // Dependencies and schedule (PRJ-ADV-002/003)
  // -------------------------------------------------------------------------

  async listDependencies(actor: ActorContext, projectId: string) {
    await this.rbac.requirePermission(actor, "project_delivery.advanced.read");
    await this.requireProject(actor, projectId);
    return this.repo.listDependencies(projectId);
  }

  async createDependency(
    actor: ActorContext,
    projectId: string,
    input: {
      predecessorActivityId: string;
      successorActivityId: string;
      dependencyType?: string;
      lagDays?: number;
    },
  ) {
    await this.rbac.requirePermission(actor, "project_delivery.advanced.manage");
    await this.requireProject(actor, projectId);

    const predecessorId = requireUuid(input.predecessorActivityId, "predecessorActivityId");
    const successorId = requireUuid(input.successorActivityId, "successorActivityId");
    if (predecessorId === successorId) {
      throw new ValidationError("An activity cannot depend on itself");
    }

    for (const id of [predecessorId, successorId]) {
      const activity = await this.repo.findCoreActivityById(id);
      if (!activity || activity.tenantId !== actor.tenantId || activity.projectId !== projectId) {
        throw new NotFoundError("ProjectDeliveryActivity", id);
      }
    }

    const dependencyType = parseDependencyType(input.dependencyType ?? "FS");
    const lagDays = input.lagDays ?? 0;
    if (!Number.isInteger(lagDays) || Math.abs(lagDays) > 365) {
      throw new ValidationError("lagDays must be an integer between -365 and 365");
    }

    // Refuse a cycle at write time. The scheduler already reports one rather
    // than inventing a critical path, but a graph that can never be scheduled
    // is a data-entry mistake, and refusing it here is where the user can still
    // see which edge caused it.
    const existing = await this.repo.listDependencies(projectId);
    if (wouldCreateCycle(existing, predecessorId, successorId)) {
      throw new ValidationError(
        "This dependency would create a cycle: the successor already reaches the predecessor",
      );
    }

    const dependency = await this.repo.createDependency({
      tenantId: actor.tenantId,
      projectId,
      predecessorActivityId: predecessorId,
      successorActivityId: successorId,
      dependencyType,
      lagDays,
      createdBy: actor.userId,
    });

    await this.audit.record({
      tenantId: actor.tenantId,
      actorUserId: actor.userId,
      action: "project_delivery.dependency.created",
      entityType: "project_activity_dependency",
      entityId: dependency.id,
      metadata: { projectId, dependencyType, lagDays },
    });
    return dependency;
  }

  async deleteDependency(actor: ActorContext, id: string): Promise<void> {
    await this.rbac.requirePermission(actor, "project_delivery.advanced.manage");
    const dependency = await this.repo.findDependencyById(id);
    if (!dependency || dependency.tenantId !== actor.tenantId) {
      throw new NotFoundError("ProjectActivityDependency", id);
    }
    await this.requireProject(actor, dependency.projectId);

    await this.repo.deleteDependency(id);
    await this.audit.record({
      tenantId: actor.tenantId,
      actorUserId: actor.userId,
      action: "project_delivery.dependency.deleted",
      entityType: "project_activity_dependency",
      entityId: id,
      metadata: { projectId: dependency.projectId },
    });
  }

  async getSchedule(actor: ActorContext, projectId: string): Promise<ProjectSchedule> {
    await this.rbac.requirePermission(actor, "project_delivery.advanced.read");
    await this.requireProject(actor, projectId);

    const [activities, dependencies] = await Promise.all([
      this.repo.listCoreActivities(projectId),
      this.repo.listDependencies(projectId),
    ]);
    return computeSchedule(activities, dependencies, new Date().toISOString());
  }

  async getGantt(actor: ActorContext, projectId: string): Promise<GanttRow[]> {
    await this.rbac.requirePermission(actor, "project_delivery.advanced.read");
    await this.requireProject(actor, projectId);

    const [activities, dependencies, nodes] = await Promise.all([
      this.repo.listCoreActivities(projectId),
      this.repo.listDependencies(projectId),
      this.repo.listWbsNodes(projectId),
    ]);
    const schedule = computeSchedule(activities, dependencies, new Date().toISOString());

    // WBS membership is read back from the activity rows themselves; the
    // advanced module does not own a second activity table to join against.
    const wbsByActivity = new Map<string, string | null>(
      activities.map((a) => [a.id, (a as CoreActivityRef & { wbsNodeId?: string | null }).wbsNodeId ?? null]),
    );
    void nodes;

    return buildGanttRows(activities, schedule, wbsByActivity, new Map());
  }

  // -------------------------------------------------------------------------
  // Resources (PRJ-ADV-004)
  // -------------------------------------------------------------------------

  async listResources(actor: ActorContext, activeOnly: boolean): Promise<ProjectResource[]> {
    await this.rbac.requirePermission(actor, "project_delivery.advanced.read");
    return this.repo.listResources(actor.tenantId, activeOnly);
  }

  async createResource(
    actor: ActorContext,
    input: {
      code: string;
      name: string;
      resourceType?: string;
      unit: string;
      capacityPerDay?: string | null;
      costRate?: string | null;
    },
  ): Promise<ProjectResource> {
    await this.rbac.requirePermission(actor, "project_delivery.advanced.manage");

    const capacity = input.capacityPerDay ?? null;
    if (capacity !== null && (toUnits(capacity) === null || toUnits(capacity)! < 0n)) {
      throw new ValidationError("capacityPerDay must be a non-negative decimal with up to 4 places");
    }
    const rate = input.costRate ?? null;
    if (rate !== null && (toCents(rate) === null || toCents(rate)! < 0n)) {
      throw new ValidationError("costRate must be a non-negative amount with up to 2 decimals");
    }

    const resource = await this.repo.createResource({
      tenantId: actor.tenantId,
      code: requireText(input.code, "code"),
      name: requireText(input.name, "name"),
      resourceType: parseResourceType(input.resourceType ?? "labor"),
      unit: requireText(input.unit, "unit"),
      capacityPerDay: capacity,
      costRate: rate,
      createdBy: actor.userId,
    });

    await this.audit.record({
      tenantId: actor.tenantId,
      actorUserId: actor.userId,
      action: "project_delivery.resource.created",
      entityType: "project_resource",
      entityId: resource.id,
      metadata: { code: resource.code, resourceType: resource.resourceType },
    });
    return resource;
  }

  async createResourceAssignment(
    actor: ActorContext,
    projectId: string,
    input: {
      activityId: string;
      resourceId: string;
      plannedUnits: string;
      startDate: string;
      endDate: string;
    },
  ) {
    await this.rbac.requirePermission(actor, "project_delivery.advanced.manage");
    await this.requireProject(actor, projectId);

    const activity = await this.repo.findCoreActivityById(input.activityId);
    if (!activity || activity.tenantId !== actor.tenantId || activity.projectId !== projectId) {
      throw new NotFoundError("ProjectDeliveryActivity", input.activityId);
    }
    const resource = await this.repo.findResourceById(input.resourceId);
    if (!resource || resource.tenantId !== actor.tenantId) {
      throw new NotFoundError("ProjectResource", input.resourceId);
    }

    const units = toUnits(input.plannedUnits);
    if (units === null || units <= 0n) {
      throw new ValidationError("plannedUnits must be a positive decimal with up to 4 places");
    }
    requireDate(input.startDate, "startDate");
    requireDate(input.endDate, "endDate");
    if (input.startDate > input.endDate) {
      throw new ValidationError("startDate must be on or before endDate");
    }

    const assignment = await this.repo.createResourceAssignment({
      tenantId: actor.tenantId,
      projectId,
      activityId: input.activityId,
      resourceId: input.resourceId,
      plannedUnits: input.plannedUnits,
      startDate: input.startDate,
      endDate: input.endDate,
      createdBy: actor.userId,
    });

    await this.audit.record({
      tenantId: actor.tenantId,
      actorUserId: actor.userId,
      action: "project_delivery.resource.assigned",
      entityType: "project_resource_assignment",
      entityId: assignment.id,
      metadata: { projectId, resourceId: input.resourceId, activityId: input.activityId },
    });
    return assignment;
  }

  async getResourceLoading(
    actor: ActorContext,
    projectId: string,
    from: string,
    to: string,
  ): Promise<ResourceLoadingResult> {
    await this.rbac.requirePermission(actor, "project_delivery.advanced.read");
    await this.requireProject(actor, projectId);
    requireDate(from, "from");
    requireDate(to, "to");
    if (from > to) throw new ValidationError("from must be on or before to");

    const [assignments, resources] = await Promise.all([
      this.repo.listResourceAssignments(projectId),
      this.repo.listResources(actor.tenantId, false),
    ]);
    return computeResourceLoading(projectId, from, to, assignments, resources);
  }

  // -------------------------------------------------------------------------
  // Baseline (PRJ-ADV-005)
  // -------------------------------------------------------------------------

  async listBaselines(actor: ActorContext, projectId: string): Promise<ProjectBaseline[]> {
    await this.rbac.requirePermission(actor, "project_delivery.advanced.read");
    await this.requireProject(actor, projectId);
    return this.repo.listBaselines(projectId);
  }

  async createBaseline(
    actor: ActorContext,
    projectId: string,
    input: { name: string; notes?: string | null },
  ): Promise<ProjectBaseline> {
    await this.rbac.requirePermission(actor, "project_delivery.advanced.manage");
    await this.requireProject(actor, projectId);

    const existing = await this.repo.listBaselines(projectId);
    const version = existing.reduce((max, b) => Math.max(max, b.version), 0) + 1;

    const baseline = await this.repo.createBaseline({
      tenantId: actor.tenantId,
      projectId,
      version,
      name: requireText(input.name, "name"),
      notes: clean(input.notes),
      createdBy: actor.userId,
    });

    // The snapshot is taken at creation, from the plan as it stands now. A
    // baseline that snapshotted at approval would record a different plan than
    // the one the approver believed they were approving.
    const activities = await this.repo.listCoreActivities(projectId);
    const costByActivity = new Map<string, string>();
    const entries = await this.repo.listCostEntries(projectId, null);
    for (const entry of entries) {
      if (entry.activityId === null || entry.entryType !== "actual") continue;
      const current = toCents(costByActivity.get(entry.activityId) ?? "0") ?? 0n;
      costByActivity.set(entry.activityId, centsToString(current + (toCents(entry.amount) ?? 0n)));
    }
    void activities;

    await this.repo.insertBaselineLinesFromPlan({
      tenantId: actor.tenantId,
      baselineId: baseline.id,
      projectId,
      plannedCostByActivity: costByActivity,
    });

    await this.audit.record({
      tenantId: actor.tenantId,
      actorUserId: actor.userId,
      action: "project_delivery.baseline.created",
      entityType: "project_baseline",
      entityId: baseline.id,
      metadata: { projectId, version },
    });
    return baseline;
  }

  async approveBaseline(actor: ActorContext, id: string): Promise<ProjectBaseline> {
    await this.rbac.requirePermission(actor, "project_delivery.advanced.manage");
    const existing = await this.repo.findBaselineById(id);
    if (!existing || existing.tenantId !== actor.tenantId) {
      throw new NotFoundError("ProjectBaseline", id);
    }
    await this.requireProject(actor, existing.projectId);
    if (existing.status === "approved") return existing;

    const approved = await this.repo.approveBaseline({
      tenantId: actor.tenantId,
      baselineId: id,
      approvedBy: actor.userId,
    });
    if (!approved) throw new NotFoundError("ProjectBaseline", id);

    await this.audit.record({
      tenantId: actor.tenantId,
      actorUserId: actor.userId,
      action: "project_delivery.baseline.approved",
      entityType: "project_baseline",
      entityId: id,
      metadata: { projectId: existing.projectId, version: existing.version },
    });
    return approved;
  }

  async getBaselineVariance(
    actor: ActorContext,
    projectId: string,
    asOfDate: string,
  ): Promise<BaselineVarianceResult> {
    await this.rbac.requirePermission(actor, "project_delivery.advanced.read");
    await this.requireProject(actor, projectId);
    requireDate(asOfDate, "asOfDate");

    const baseline = await this.repo.findActiveBaseline(projectId);
    if (!baseline) {
      throw new ValidationError("This project has no approved baseline to measure against");
    }

    const [lines, activities, costEntries] = await Promise.all([
      this.repo.listBaselineLines(baseline.id),
      this.repo.listCoreActivities(projectId),
      this.repo.listCostEntries(projectId, asOfDate),
    ]);

    const computed = computeBaselineVariance(
      projectId,
      baseline.id,
      baseline.version,
      asOfDate,
      lines,
      activities,
      costEntries,
    );
    return { projectId, baselineId: baseline.id, baselineVersion: baseline.version, asOfDate, ...computed };
  }

  // -------------------------------------------------------------------------
  // Guards
  // -------------------------------------------------------------------------

  private async requireProject(actor: ActorContext, projectId: string): Promise<void> {
    if (!(await this.repo.projectExists(actor.tenantId, projectId))) {
      throw new NotFoundError("Project", projectId);
    }
    const scoped = await this.rbac.listScopedOrganizationUnitIds(actor);
    // `null` is "tenant-wide" and passes. An empty array is the fail-closed
    // answer for a scope-less session: it authorizes nothing, so it must not
    // silently widen to every project in the tenant (ADR-0026 §6).
    if (scoped !== null && scoped.length === 0) {
      throw new ForbiddenError("The active Role's Data Scope covers no Organization Unit");
    }
  }

  private async requireWbsNode(actor: ActorContext, id: string): Promise<ProjectWbsNode> {
    const node = await this.repo.findWbsNodeById(id);
    if (!node || node.tenantId !== actor.tenantId) throw new NotFoundError("ProjectWbsNode", id);
    await this.requireProject(actor, node.projectId);
    return node;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** The rolled-up cost of a built subtree, read back off its own view. */
function cRolledUp(node: ProjectWbsNodeView): bigint {
  return toCents(node.rolledUpCost) ?? 0n;
}

function centsToString(cents: bigint): string {
  const negative = cents < 0n;
  const abs = negative ? -cents : cents;
  return `${negative ? "-" : ""}${abs / 100n}.${(abs % 100n).toString().padStart(2, "0")}`;
}

/**
 * Would adding `predecessor -> successor` close a loop?
 *
 * True when the successor can already reach the predecessor, because the new
 * edge would complete the circle. Depth-first over the existing edges only.
 */
function wouldCreateCycle(
  existing: { predecessorActivityId: string; successorActivityId: string }[],
  predecessorId: string,
  successorId: string,
): boolean {
  const successors = new Map<string, string[]>();
  for (const edge of existing) {
    const list = successors.get(edge.predecessorActivityId) ?? [];
    list.push(edge.successorActivityId);
    successors.set(edge.predecessorActivityId, list);
  }

  const seen = new Set<string>();
  const stack = [successorId];
  while (stack.length > 0) {
    const current = stack.pop() as string;
    if (current === predecessorId) return true;
    if (seen.has(current)) continue;
    seen.add(current);
    stack.push(...(successors.get(current) ?? []));
  }
  return false;
}

function parseDependencyType(value: string): DependencyType {
  if (!DEPENDENCY_TYPES.includes(value as DependencyType)) {
    throw new ValidationError(`dependencyType must be one of: ${DEPENDENCY_TYPES.join(", ")}`);
  }
  return value as DependencyType;
}

function parseResourceType(value: string): ResourceType {
  if (!RESOURCE_TYPES.includes(value as ResourceType)) {
    throw new ValidationError(`resourceType must be one of: ${RESOURCE_TYPES.join(", ")}`);
  }
  return value as ResourceType;
}

function requireText(value: string | undefined, field: string): string {
  const text = (value ?? "").trim();
  if (!text) throw new ValidationError(`${field} is required`);
  return text;
}

function requireUuid(value: string, field: string): string {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) {
    throw new ValidationError(`${field} must be a UUID`);
  }
  return value;
}

function requireDate(value: string, field: string): void {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new ValidationError(`${field} must be YYYY-MM-DD`);
  }
}

function clean(value: string | null | undefined): string | null {
  return value?.trim() || null;
}