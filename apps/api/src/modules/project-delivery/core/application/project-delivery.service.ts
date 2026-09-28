import type { ActorContext } from "../../../../domain/shared-kernel/audit-context.js";
import { ForbiddenError, NotFoundError, ValidationError } from "../../../../domain/shared-kernel/errors.js";
import type { AuditService } from "../../../../application/audit/audit.service.js";
import type { RbacService } from "../../../../application/rbac/rbac.service.js";
import type { EventBus } from "../../../../application/event/event-bus.js";
import type {
  ProjectDeliveryActivity,
  ProjectDeliveryActivityStatus,
  ProjectDeliveryDetailView,
  ProjectDeliveryMilestone,
  ProjectDeliveryMilestoneStatus,
  ProjectDeliveryProgress,
  ProjectDeliveryProjectSummary,
  ProjectDeliveryRepository,
  ProjectReference,
} from "../domain/project-delivery.entity.js";
import {
  PROJECT_DELIVERY_ACTIVITY_STATUSES,
  PROJECT_DELIVERY_MILESTONE_STATUSES,
} from "../domain/project-delivery.entity.js";

/**
 * Project Delivery Core (Phase 8, PRJ-CORE-001…010).
 *
 * Adds execution activities and milestones to the existing Customer &
 * Commercial Project master. No WBS hierarchy, dependency graph, Gantt,
 * resource loading, baseline variance, earned value, project costing, finance
 * integration, advanced scheduling, or external PM sync is present here.
 */
export class ProjectDeliveryService {
  constructor(
    private readonly repo: ProjectDeliveryRepository,
    private readonly audit: AuditService,
    private readonly rbac: RbacService,
    private readonly eventBus: EventBus,
  ) {}

  async listProjects(actor: ActorContext): Promise<ProjectDeliveryProjectSummary[]> {
    await this.rbac.requirePermission(actor, "project_delivery.read");
    const projects = await this.repo.listProjectsByTenant(actor.tenantId);
    const visible: ProjectDeliveryProjectSummary[] = [];
    for (const project of projects) {
      if (await this.canAccessProject(actor, project)) {
        visible.push({ project, progress: await this.calculateProgress(project.id) });
      }
    }
    return visible;
  }

  async getProjectDelivery(actor: ActorContext, projectId: string): Promise<ProjectDeliveryDetailView> {
    await this.rbac.requirePermission(actor, "project_delivery.read");
    const project = await this.requireProjectAccess(actor, projectId);
    const [activities, milestones] = await Promise.all([
      this.repo.listActivities(projectId),
      this.repo.listMilestones(projectId),
    ]);
    return { project, activities, milestones, progress: calculateProgress(projectId, activities, milestones) };
  }

  async createActivity(
    actor: ActorContext,
    projectId: string,
    input: {
      title: string;
      description?: string | null;
      activityTypeCode?: string | null;
      picUserId?: string | null;
      picEmployeeId?: string | null;
      plannedStartDate?: string | null;
      plannedEndDate?: string | null;
      actualStartDate?: string | null;
      actualEndDate?: string | null;
      status?: string;
      progressPercent?: number;
    },
  ): Promise<ProjectDeliveryActivity> {
    await this.rbac.requirePermission(actor, "project_delivery.manage");
    await this.requireProjectAccess(actor, projectId);
    requirePic(input.picUserId, input.picEmployeeId);
    await this.validatePic(actor, input.picUserId, input.picEmployeeId);
    validateDatePair(input.plannedStartDate, input.plannedEndDate, "planned");
    validateDatePair(input.actualStartDate, input.actualEndDate, "actual");

    const status = parseActivityStatus(input.status ?? "planned");
    const progressPercent = normalizeProgress(status, input.progressPercent ?? 0);

    const activity = await this.repo.createActivity({
      tenantId: actor.tenantId,
      projectId,
      title: requireTitle(input.title),
      description: clean(input.description),
      activityTypeCode: clean(input.activityTypeCode),
      picUserId: input.picUserId ?? null,
      picEmployeeId: input.picEmployeeId ?? null,
      plannedStartDate: input.plannedStartDate ?? null,
      plannedEndDate: input.plannedEndDate ?? null,
      actualStartDate: input.actualStartDate ?? null,
      actualEndDate: input.actualEndDate ?? null,
      status,
      progressPercent,
      createdBy: actor.userId,
    });

    await this.eventBus.publish({
      tenantId: actor.tenantId,
      eventType: "project_delivery.activity.created",
      entityType: "project_delivery_activity",
      entityId: activity.id,
      payload: { projectId, status: activity.status, progressPercent: activity.progressPercent },
      createdBy: actor.userId,
    });
    await this.audit.record({
      tenantId: actor.tenantId,
      actorUserId: actor.userId,
      action: "project_delivery.activity.created",
      entityType: "project_delivery_activity",
      entityId: activity.id,
      metadata: { projectId, status: activity.status, progressPercent: activity.progressPercent },
    });

    return activity;
  }

  async updateActivity(
    actor: ActorContext,
    id: string,
    input: {
      title?: string;
      description?: string | null;
      activityTypeCode?: string | null;
      picUserId?: string | null;
      picEmployeeId?: string | null;
      plannedStartDate?: string | null;
      plannedEndDate?: string | null;
      actualStartDate?: string | null;
      actualEndDate?: string | null;
      status?: string;
      progressPercent?: number;
    },
  ): Promise<ProjectDeliveryActivity> {
    await this.rbac.requirePermission(actor, "project_delivery.manage");
    const existing = await this.repo.findActivityById(id);
    if (!existing) throw new NotFoundError("ProjectDeliveryActivity", id);
    if (existing.tenantId !== actor.tenantId) throw new ForbiddenError("Access denied");
    await this.requireProjectAccess(actor, existing.projectId);
    const nextPicUserId = input.picUserId !== undefined ? input.picUserId : existing.picUserId;
    const nextPicEmployeeId = input.picEmployeeId !== undefined ? input.picEmployeeId : existing.picEmployeeId;
    requirePic(nextPicUserId, nextPicEmployeeId);
    await this.validatePic(actor, input.picUserId, input.picEmployeeId);

    const nextPlannedStartDate = input.plannedStartDate !== undefined ? input.plannedStartDate : existing.plannedStartDate;
    const nextPlannedEndDate = input.plannedEndDate !== undefined ? input.plannedEndDate : existing.plannedEndDate;
    const nextActualStartDate = input.actualStartDate !== undefined ? input.actualStartDate : existing.actualStartDate;
    const nextActualEndDate = input.actualEndDate !== undefined ? input.actualEndDate : existing.actualEndDate;
    validateDatePair(nextPlannedStartDate, nextPlannedEndDate, "planned");
    validateDatePair(nextActualStartDate, nextActualEndDate, "actual");

    const status = input.status !== undefined ? parseActivityStatus(input.status) : undefined;
    const progressPercent =
      input.progressPercent !== undefined || status !== undefined
        ? normalizeProgress(status ?? existing.status, input.progressPercent ?? existing.progressPercent)
        : undefined;

    const updated = await this.repo.updateActivity(id, {
      title: input.title !== undefined ? requireTitle(input.title) : undefined,
      description: input.description !== undefined ? clean(input.description) : undefined,
      activityTypeCode: input.activityTypeCode !== undefined ? clean(input.activityTypeCode) : undefined,
      picUserId: input.picUserId,
      picEmployeeId: input.picEmployeeId,
      plannedStartDate: input.plannedStartDate,
      plannedEndDate: input.plannedEndDate,
      actualStartDate: input.actualStartDate,
      actualEndDate: input.actualEndDate,
      status,
      progressPercent,
      updatedBy: actor.userId,
    });
    if (!updated) throw new NotFoundError("ProjectDeliveryActivity", id);

    await this.audit.record({
      tenantId: actor.tenantId,
      actorUserId: actor.userId,
      action: "project_delivery.activity.updated",
      entityType: "project_delivery_activity",
      entityId: id,
      metadata: { projectId: updated.projectId, status: updated.status, progressPercent: updated.progressPercent },
    });

    return updated;
  }

  async createMilestone(
    actor: ActorContext,
    projectId: string,
    input: {
      title: string;
      description?: string | null;
      milestoneTypeCode?: string | null;
      plannedDate?: string | null;
      status?: string;
    },
  ): Promise<ProjectDeliveryMilestone> {
    await this.rbac.requirePermission(actor, "project_delivery.manage");
    await this.requireProjectAccess(actor, projectId);
    const status = parseMilestoneStatus(input.status ?? "pending");
    if (status === "achieved") throw new ValidationError("Create milestone as pending, then record achievement");

    const milestone = await this.repo.createMilestone({
      tenantId: actor.tenantId,
      projectId,
      title: requireTitle(input.title),
      description: clean(input.description),
      milestoneTypeCode: clean(input.milestoneTypeCode),
      plannedDate: input.plannedDate ?? null,
      status,
      createdBy: actor.userId,
    });

    await this.audit.record({
      tenantId: actor.tenantId,
      actorUserId: actor.userId,
      action: "project_delivery.milestone.created",
      entityType: "project_delivery_milestone",
      entityId: milestone.id,
      metadata: { projectId, status: milestone.status },
    });
    return milestone;
  }

  async updateMilestone(
    actor: ActorContext,
    id: string,
    input: {
      title?: string;
      description?: string | null;
      milestoneTypeCode?: string | null;
      plannedDate?: string | null;
      status?: string;
      achievementNote?: string | null;
    },
  ): Promise<ProjectDeliveryMilestone> {
    await this.rbac.requirePermission(actor, "project_delivery.manage");
    const existing = await this.repo.findMilestoneById(id);
    if (!existing) throw new NotFoundError("ProjectDeliveryMilestone", id);
    if (existing.tenantId !== actor.tenantId) throw new ForbiddenError("Access denied");
    await this.requireProjectAccess(actor, existing.projectId);

    const status = input.status !== undefined ? parseMilestoneStatus(input.status) : undefined;
    const updated = await this.repo.updateMilestone(id, {
      title: input.title !== undefined ? requireTitle(input.title) : undefined,
      description: input.description !== undefined ? clean(input.description) : undefined,
      milestoneTypeCode: input.milestoneTypeCode !== undefined ? clean(input.milestoneTypeCode) : undefined,
      plannedDate: input.plannedDate,
      status,
      achievementNote: input.achievementNote !== undefined ? clean(input.achievementNote) : undefined,
      achievedBy: status === "achieved" && !existing.achievedAt ? actor.userId : null,
      updatedBy: actor.userId,
    });
    if (!updated) throw new NotFoundError("ProjectDeliveryMilestone", id);

    if (status === "achieved" && !existing.achievedAt) {
      await this.eventBus.publish({
        tenantId: actor.tenantId,
        eventType: "project_delivery.milestone.achieved",
        entityType: "project_delivery_milestone",
        entityId: id,
        payload: { projectId: updated.projectId },
        createdBy: actor.userId,
      });
    }
    await this.audit.record({
      tenantId: actor.tenantId,
      actorUserId: actor.userId,
      action: "project_delivery.milestone.updated",
      entityType: "project_delivery_milestone",
      entityId: id,
      metadata: { projectId: updated.projectId, status: updated.status },
    });
    return updated;
  }

  async canAccessForDocument(actor: ActorContext, entityType: string, entityId: string): Promise<boolean> {
    const permissions = await this.rbac.getActivePermissions(actor);
    if (!permissions.has("project_delivery.documents.read") && !permissions.has("project_delivery.manage")) {
      return false;
    }

    if (entityType === "project_delivery_activity") {
      const activity = await this.repo.findActivityById(entityId);
      if (!activity || activity.tenantId !== actor.tenantId) return false;
      return this.canAccessProjectId(actor, activity.projectId);
    }
    if (entityType === "project_delivery_milestone") {
      const milestone = await this.repo.findMilestoneById(entityId);
      if (!milestone || milestone.tenantId !== actor.tenantId) return false;
      return this.canAccessProjectId(actor, milestone.projectId);
    }
    return false;
  }

  private async requireProjectAccess(actor: ActorContext, projectId: string): Promise<ProjectReference> {
    const project = await this.repo.findProjectById(projectId);
    if (!project || project.tenantId !== actor.tenantId) throw new NotFoundError("Project", projectId);
    if (!(await this.canAccessProject(actor, project))) throw new ForbiddenError("Access denied");
    return project;
  }

  private async canAccessProjectId(actor: ActorContext, projectId: string): Promise<boolean> {
    const project = await this.repo.findProjectById(projectId);
    return Boolean(project && project.tenantId === actor.tenantId && (await this.canAccessProject(actor, project)));
  }

  private async canAccessProject(actor: ActorContext, project: ProjectReference): Promise<boolean> {
    return this.rbac.isActiveCustomerContextScopeCovered(actor, {
      customerId: project.customerId,
      ownerOrganizationUnitId: project.ownerOrganizationUnitId,
    });
  }

  private async validatePic(
    actor: ActorContext,
    picUserId: string | null | undefined,
    picEmployeeId: string | null | undefined,
  ): Promise<void> {
    if (picUserId && !(await this.repo.userExists(actor.tenantId, picUserId))) {
      throw new NotFoundError("User", picUserId);
    }
    if (picEmployeeId && !(await this.repo.employeeExists(actor.tenantId, picEmployeeId))) {
      throw new NotFoundError("Employee", picEmployeeId);
    }
  }

  private async calculateProgress(projectId: string): Promise<ProjectDeliveryProgress> {
    const [activities, milestones] = await Promise.all([
      this.repo.listActivities(projectId),
      this.repo.listMilestones(projectId),
    ]);
    return calculateProgress(projectId, activities, milestones);
  }
}

function calculateProgress(
  projectId: string,
  activities: ProjectDeliveryActivity[],
  milestones: ProjectDeliveryMilestone[],
): ProjectDeliveryProgress {
  const activityCount = activities.length;
  const total = activities.reduce((sum, a) => sum + a.progressPercent, 0);
  return {
    projectId,
    activityCount,
    completedActivityCount: activities.filter((a) => a.status === "completed").length,
    progressPercent: activityCount === 0 ? 0 : Math.round(total / activityCount),
    milestoneCount: milestones.length,
    achievedMilestoneCount: milestones.filter((m) => m.status === "achieved").length,
  };
}

function parseActivityStatus(value: string): ProjectDeliveryActivityStatus {
  if (!PROJECT_DELIVERY_ACTIVITY_STATUSES.includes(value as ProjectDeliveryActivityStatus)) {
    throw new ValidationError(`status must be one of: ${PROJECT_DELIVERY_ACTIVITY_STATUSES.join(", ")}`);
  }
  return value as ProjectDeliveryActivityStatus;
}

function parseMilestoneStatus(value: string): ProjectDeliveryMilestoneStatus {
  if (!PROJECT_DELIVERY_MILESTONE_STATUSES.includes(value as ProjectDeliveryMilestoneStatus)) {
    throw new ValidationError(`status must be one of: ${PROJECT_DELIVERY_MILESTONE_STATUSES.join(", ")}`);
  }
  return value as ProjectDeliveryMilestoneStatus;
}

function normalizeProgress(status: ProjectDeliveryActivityStatus, value: number): number {
  if (!Number.isInteger(value) || value < 0 || value > 100) {
    throw new ValidationError("progressPercent must be an integer between 0 and 100");
  }
  if (status === "completed" && value !== 100) return 100;
  if (status === "cancelled" && value !== 0) return 0;
  return value;
}

function validateDatePair(start: string | null | undefined, end: string | null | undefined, label: string): void {
  if (start && end && start > end) {
    throw new ValidationError(`${label} start date must be on or before ${label} end date`);
  }
}

function requireTitle(value: string): string {
  const title = value.trim();
  if (!title) throw new ValidationError("title is required");
  return title;
}

function requirePic(picUserId: string | null | undefined, picEmployeeId: string | null | undefined): void {
  if (!picUserId && !picEmployeeId) {
    throw new ValidationError("Activity PIC is required");
  }
}

function clean(value: string | null | undefined): string | null {
  return value?.trim() || null;
}
