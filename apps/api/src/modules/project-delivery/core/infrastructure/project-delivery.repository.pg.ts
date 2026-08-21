import type { Pool, QueryResultRow } from "pg";
import type {
  CreateActivityInput,
  CreateMilestoneInput,
  ProjectDeliveryActivity,
  ProjectDeliveryActivityStatus,
  ProjectDeliveryMilestone,
  ProjectDeliveryMilestoneStatus,
  ProjectDeliveryRepository,
  ProjectReference,
  UpdateActivityInput,
  UpdateMilestoneInput,
} from "../domain/project-delivery.entity.js";

/**
 * Project Delivery Core persistence (Phase 8, PRJ-CORE-001…010).
 *
 * Deliberately contains no DELETE statements. Activity and milestone rows are
 * historical execution/audit records and remain available for deterministic
 * project progress calculation.
 */
export class PgProjectDeliveryRepository implements ProjectDeliveryRepository {
  constructor(private readonly pool: Pool) {}

  async findProjectById(id: string): Promise<ProjectReference | null> {
    const r = await this.pool.query(
      `SELECT p.id, p.tenant_id, p.customer_id, p.code, p.name, p.status,
              c.owner_organization_unit_id
         FROM projects p
         JOIN customers c ON c.id = p.customer_id
        WHERE p.id = $1 AND p.deleted_at IS NULL`,
      [id],
    );
    return r.rows[0] ? toProject(r.rows[0]) : null;
  }

  async listProjectsByTenant(tenantId: string): Promise<ProjectReference[]> {
    const r = await this.pool.query(
      `SELECT p.id, p.tenant_id, p.customer_id, p.code, p.name, p.status,
              c.owner_organization_unit_id
         FROM projects p
         JOIN customers c ON c.id = p.customer_id
        WHERE p.tenant_id = $1 AND p.deleted_at IS NULL
        ORDER BY p.created_at ASC`,
      [tenantId],
    );
    return r.rows.map(toProject);
  }

  async createActivity(input: CreateActivityInput): Promise<ProjectDeliveryActivity> {
    const r = await this.pool.query(
      `INSERT INTO project_delivery_activities
         (tenant_id, project_id, title, description, activity_type_code,
          pic_user_id, pic_employee_id, planned_start_date, planned_end_date,
          actual_start_date, actual_end_date, status, progress_percent,
          created_by_user_id, updated_by_user_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8::date,$9::date,$10::date,$11::date,$12,$13,$14,$14)
       RETURNING *`,
      [
        input.tenantId,
        input.projectId,
        input.title,
        input.description,
        input.activityTypeCode,
        input.picUserId,
        input.picEmployeeId,
        input.plannedStartDate,
        input.plannedEndDate,
        input.actualStartDate,
        input.actualEndDate,
        input.status,
        input.progressPercent,
        input.createdBy,
      ],
    );
    return toActivity(r.rows[0]);
  }

  async findActivityById(id: string): Promise<ProjectDeliveryActivity | null> {
    const r = await this.pool.query(`SELECT * FROM project_delivery_activities WHERE id = $1`, [id]);
    return r.rows[0] ? toActivity(r.rows[0]) : null;
  }

  async listActivities(projectId: string): Promise<ProjectDeliveryActivity[]> {
    const r = await this.pool.query(
      `SELECT * FROM project_delivery_activities
        WHERE project_id = $1
        ORDER BY planned_start_date ASC NULLS LAST, created_at ASC`,
      [projectId],
    );
    return r.rows.map(toActivity);
  }

  async updateActivity(id: string, input: UpdateActivityInput): Promise<ProjectDeliveryActivity | null> {
    const r = await this.pool.query(
      `UPDATE project_delivery_activities
          SET title              = COALESCE($2, title),
              description        = CASE WHEN $3::boolean THEN $4 ELSE description END,
              activity_type_code = CASE WHEN $5::boolean THEN $6 ELSE activity_type_code END,
              pic_user_id        = CASE WHEN $7::boolean THEN $8::uuid ELSE pic_user_id END,
              pic_employee_id    = CASE WHEN $9::boolean THEN $10::uuid ELSE pic_employee_id END,
              planned_start_date = CASE WHEN $11::boolean THEN $12::date ELSE planned_start_date END,
              planned_end_date   = CASE WHEN $13::boolean THEN $14::date ELSE planned_end_date END,
              actual_start_date  = CASE WHEN $15::boolean THEN $16::date ELSE actual_start_date END,
              actual_end_date    = CASE WHEN $17::boolean THEN $18::date ELSE actual_end_date END,
              status             = COALESCE($19, status),
              progress_percent   = COALESCE($20, progress_percent),
              updated_by_user_id = $21,
              updated_at         = now()
        WHERE id = $1
        RETURNING *`,
      [
        id,
        input.title ?? null,
        input.description !== undefined,
        input.description ?? null,
        input.activityTypeCode !== undefined,
        input.activityTypeCode ?? null,
        input.picUserId !== undefined,
        input.picUserId ?? null,
        input.picEmployeeId !== undefined,
        input.picEmployeeId ?? null,
        input.plannedStartDate !== undefined,
        input.plannedStartDate ?? null,
        input.plannedEndDate !== undefined,
        input.plannedEndDate ?? null,
        input.actualStartDate !== undefined,
        input.actualStartDate ?? null,
        input.actualEndDate !== undefined,
        input.actualEndDate ?? null,
        input.status ?? null,
        input.progressPercent ?? null,
        input.updatedBy ?? null,
      ],
    );
    return r.rows[0] ? toActivity(r.rows[0]) : null;
  }

  async createMilestone(input: CreateMilestoneInput): Promise<ProjectDeliveryMilestone> {
    const r = await this.pool.query(
      `INSERT INTO project_delivery_milestones
         (tenant_id, project_id, title, description, milestone_type_code,
          planned_date, status, created_by_user_id, updated_by_user_id)
       VALUES ($1,$2,$3,$4,$5,$6::date,$7,$8,$8)
       RETURNING *`,
      [
        input.tenantId,
        input.projectId,
        input.title,
        input.description,
        input.milestoneTypeCode,
        input.plannedDate,
        input.status,
        input.createdBy,
      ],
    );
    return toMilestone(r.rows[0]);
  }

  async findMilestoneById(id: string): Promise<ProjectDeliveryMilestone | null> {
    const r = await this.pool.query(`SELECT * FROM project_delivery_milestones WHERE id = $1`, [id]);
    return r.rows[0] ? toMilestone(r.rows[0]) : null;
  }

  async listMilestones(projectId: string): Promise<ProjectDeliveryMilestone[]> {
    const r = await this.pool.query(
      `SELECT * FROM project_delivery_milestones
        WHERE project_id = $1
        ORDER BY planned_date ASC NULLS LAST, created_at ASC`,
      [projectId],
    );
    return r.rows.map(toMilestone);
  }

  async updateMilestone(id: string, input: UpdateMilestoneInput): Promise<ProjectDeliveryMilestone | null> {
    const r = await this.pool.query(
      `UPDATE project_delivery_milestones
          SET title               = COALESCE($2, title),
              description         = CASE WHEN $3::boolean THEN $4 ELSE description END,
              milestone_type_code = CASE WHEN $5::boolean THEN $6 ELSE milestone_type_code END,
              planned_date        = CASE WHEN $7::boolean THEN $8::date ELSE planned_date END,
              status              = COALESCE($9, status),
              achieved_at         = CASE WHEN $10::boolean THEN now() ELSE achieved_at END,
              achieved_by_user_id = CASE WHEN $10::boolean THEN $11::uuid ELSE achieved_by_user_id END,
              achievement_note    = CASE WHEN $12::boolean THEN $13 ELSE achievement_note END,
              updated_by_user_id  = $14,
              updated_at          = now()
        WHERE id = $1
        RETURNING *`,
      [
        id,
        input.title ?? null,
        input.description !== undefined,
        input.description ?? null,
        input.milestoneTypeCode !== undefined,
        input.milestoneTypeCode ?? null,
        input.plannedDate !== undefined,
        input.plannedDate ?? null,
        input.status ?? null,
        input.status === "achieved" && Boolean(input.achievedBy),
        input.achievedBy ?? null,
        input.achievementNote !== undefined,
        input.achievementNote ?? null,
        input.updatedBy ?? null,
      ],
    );
    return r.rows[0] ? toMilestone(r.rows[0]) : null;
  }

  async userExists(tenantId: string, id: string): Promise<boolean> {
    const r = await this.pool.query(`SELECT 1 FROM users WHERE id = $1 AND tenant_id = $2`, [id, tenantId]);
    return (r.rowCount ?? 0) > 0;
  }

  async employeeExists(tenantId: string, id: string): Promise<boolean> {
    const r = await this.pool.query(`SELECT 1 FROM employees WHERE id = $1 AND tenant_id = $2`, [id, tenantId]);
    return (r.rowCount ?? 0) > 0;
  }
}

function toDateString(value: unknown): string {
  if (value instanceof Date) {
    const y = value.getFullYear();
    const m = String(value.getMonth() + 1).padStart(2, "0");
    const d = String(value.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }
  if (value == null) return "";
  return String(value).slice(0, 10);
}

function toProject(row: QueryResultRow): ProjectReference {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    customerId: row.customer_id,
    code: row.code,
    name: row.name,
    status: row.status,
    ownerOrganizationUnitId: row.owner_organization_unit_id ?? null,
  };
}

function toActivity(row: QueryResultRow): ProjectDeliveryActivity {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    projectId: row.project_id,
    title: row.title,
    description: row.description ?? null,
    activityTypeCode: row.activity_type_code ?? null,
    picUserId: row.pic_user_id ?? null,
    picEmployeeId: row.pic_employee_id ?? null,
    plannedStartDate: row.planned_start_date ? toDateString(row.planned_start_date) : null,
    plannedEndDate: row.planned_end_date ? toDateString(row.planned_end_date) : null,
    actualStartDate: row.actual_start_date ? toDateString(row.actual_start_date) : null,
    actualEndDate: row.actual_end_date ? toDateString(row.actual_end_date) : null,
    status: row.status as ProjectDeliveryActivityStatus,
    progressPercent: Number(row.progress_percent),
    createdByUserId: row.created_by_user_id ?? null,
    updatedByUserId: row.updated_by_user_id ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toMilestone(row: QueryResultRow): ProjectDeliveryMilestone {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    projectId: row.project_id,
    title: row.title,
    description: row.description ?? null,
    milestoneTypeCode: row.milestone_type_code ?? null,
    plannedDate: row.planned_date ? toDateString(row.planned_date) : null,
    status: row.status as ProjectDeliveryMilestoneStatus,
    achievedAt: row.achieved_at ?? null,
    achievedByUserId: row.achieved_by_user_id ?? null,
    achievementNote: row.achievement_note ?? null,
    createdByUserId: row.created_by_user_id ?? null,
    updatedByUserId: row.updated_by_user_id ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
