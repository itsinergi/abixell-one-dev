/**
 * Project Delivery Core — domain types (Phase 8, PRJ-CORE-001…010).
 *
 * This module adds delivery execution records on top of the existing Customer
 * & Commercial `projects` master. It never redefines the project master and it
 * contains no WBS hierarchy, dependencies, Gantt, resource loading, baseline
 * variance, earned value, project costing, accounting, or PM-tool sync.
 */

export type ProjectDeliveryActivityStatus =
  | "planned"
  | "in_progress"
  | "completed"
  | "on_hold"
  | "cancelled";

export const PROJECT_DELIVERY_ACTIVITY_STATUSES: ProjectDeliveryActivityStatus[] = [
  "planned",
  "in_progress",
  "completed",
  "on_hold",
  "cancelled",
];

export type ProjectDeliveryMilestoneStatus = "pending" | "achieved" | "missed" | "cancelled";

export const PROJECT_DELIVERY_MILESTONE_STATUSES: ProjectDeliveryMilestoneStatus[] = [
  "pending",
  "achieved",
  "missed",
  "cancelled",
];

export interface ProjectReference {
  id: string;
  tenantId: string;
  customerId: string;
  code: string;
  name: string;
  status: string;
  ownerOrganizationUnitId: string | null;
}

export interface ProjectDeliveryActivity {
  id: string;
  tenantId: string;
  projectId: string;
  title: string;
  description: string | null;
  activityTypeCode: string | null;
  picUserId: string | null;
  picEmployeeId: string | null;
  plannedStartDate: string | null;
  plannedEndDate: string | null;
  actualStartDate: string | null;
  actualEndDate: string | null;
  status: ProjectDeliveryActivityStatus;
  progressPercent: number;
  createdByUserId: string | null;
  updatedByUserId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface ProjectDeliveryMilestone {
  id: string;
  tenantId: string;
  projectId: string;
  title: string;
  description: string | null;
  milestoneTypeCode: string | null;
  plannedDate: string | null;
  status: ProjectDeliveryMilestoneStatus;
  achievedAt: Date | null;
  achievedByUserId: string | null;
  achievementNote: string | null;
  createdByUserId: string | null;
  updatedByUserId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface ProjectDeliveryProgress {
  projectId: string;
  activityCount: number;
  completedActivityCount: number;
  progressPercent: number;
  milestoneCount: number;
  achievedMilestoneCount: number;
}

export interface ProjectDeliveryProjectSummary {
  project: ProjectReference;
  progress: ProjectDeliveryProgress;
}

export interface ProjectDeliveryDetailView {
  project: ProjectReference;
  progress: ProjectDeliveryProgress;
  activities: ProjectDeliveryActivity[];
  milestones: ProjectDeliveryMilestone[];
}

export interface CreateActivityInput {
  tenantId: string;
  projectId: string;
  title: string;
  description: string | null;
  activityTypeCode: string | null;
  picUserId: string | null;
  picEmployeeId: string | null;
  plannedStartDate: string | null;
  plannedEndDate: string | null;
  actualStartDate: string | null;
  actualEndDate: string | null;
  status: ProjectDeliveryActivityStatus;
  progressPercent: number;
  createdBy: string | null;
}

export interface UpdateActivityInput {
  title?: string;
  description?: string | null;
  activityTypeCode?: string | null;
  picUserId?: string | null;
  picEmployeeId?: string | null;
  plannedStartDate?: string | null;
  plannedEndDate?: string | null;
  actualStartDate?: string | null;
  actualEndDate?: string | null;
  status?: ProjectDeliveryActivityStatus;
  progressPercent?: number;
  updatedBy?: string | null;
}

export interface CreateMilestoneInput {
  tenantId: string;
  projectId: string;
  title: string;
  description: string | null;
  milestoneTypeCode: string | null;
  plannedDate: string | null;
  status: ProjectDeliveryMilestoneStatus;
  createdBy: string | null;
}

export interface UpdateMilestoneInput {
  title?: string;
  description?: string | null;
  milestoneTypeCode?: string | null;
  plannedDate?: string | null;
  status?: ProjectDeliveryMilestoneStatus;
  achievementNote?: string | null;
  achievedBy?: string | null;
  updatedBy?: string | null;
}

export interface ProjectDeliveryRepository {
  findProjectById(id: string): Promise<ProjectReference | null>;
  listProjectsByTenant(tenantId: string): Promise<ProjectReference[]>;

  createActivity(input: CreateActivityInput): Promise<ProjectDeliveryActivity>;
  findActivityById(id: string): Promise<ProjectDeliveryActivity | null>;
  listActivities(projectId: string): Promise<ProjectDeliveryActivity[]>;
  updateActivity(id: string, input: UpdateActivityInput): Promise<ProjectDeliveryActivity | null>;

  createMilestone(input: CreateMilestoneInput): Promise<ProjectDeliveryMilestone>;
  findMilestoneById(id: string): Promise<ProjectDeliveryMilestone | null>;
  listMilestones(projectId: string): Promise<ProjectDeliveryMilestone[]>;
  updateMilestone(id: string, input: UpdateMilestoneInput): Promise<ProjectDeliveryMilestone | null>;

  userExists(tenantId: string, id: string): Promise<boolean>;
  employeeExists(tenantId: string, id: string): Promise<boolean>;
}
