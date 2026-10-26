import type { Pool, QueryResultRow } from "pg";
import type {
  BaselineStatus,
  CoreActivityRef,
  CreateCostEntryInput,
  CreateDependencyInput,
  CreateResourceAssignmentInput,
  CreateResourceInput,
  CreateWbsNodeInput,
  DependencyType,
  ProjectActivityDependency,
  ProjectBaseline,
  ProjectBaselineLine,
  ProjectCostEntry,
  ProjectCostPosting,
  ProjectDeliveryAdvancedRepository,
  ProjectEarnedValueSnapshot,
  ProjectResource,
  ProjectResourceAssignment,
  ProjectWbsNode,
  ResourceType,
  UpdateWbsNodeInput,
} from "../domain/project-delivery-advanced.entity.js";

/**
 * Project Delivery Advanced persistence (Wave A7).
 *
 * Two rules shape this file:
 *
 * 1. No DELETE of a cost entry, ever. A correction is a `reversal` row naming
 *    the row it compensates. The only DELETE is a dependency edge, which is
 *    plan structure rather than a recorded fact.
 * 2. Money and quantity leave the database as NUMERIC strings, never as JS
 *    numbers. `pg` would hand back a `number` for a NUMERIC column if asked,
 *    which is exactly the binary float ADR-0026 §5 forbids for an authoritative
 *    amount. Every such column is cast to `::text` in the SELECT list.
 */
export class PgProjectDeliveryAdvancedRepository implements ProjectDeliveryAdvancedRepository {
  constructor(private readonly pool: Pool) {}

  // --- WBS -----------------------------------------------------------------

  async createWbsNode(input: CreateWbsNodeInput): Promise<ProjectWbsNode> {
    const r = await this.pool.query(
      `INSERT INTO project_wbs_nodes
         (tenant_id, project_id, parent_id, code, name, description, depth, sort_order,
          created_by_user_id, updated_by_user_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$9)
       RETURNING *`,
      [
        input.tenantId,
        input.projectId,
        input.parentId,
        input.code,
        input.name,
        input.description,
        input.depth,
        input.sortOrder,
        input.createdBy,
      ],
    );
    return toWbsNode(r.rows[0]);
  }

  async findWbsNodeById(id: string): Promise<ProjectWbsNode | null> {
    const r = await this.pool.query(`SELECT * FROM project_wbs_nodes WHERE id = $1`, [id]);
    return r.rows[0] ? toWbsNode(r.rows[0]) : null;
  }

  async listWbsNodes(projectId: string): Promise<ProjectWbsNode[]> {
    const r = await this.pool.query(
      `SELECT * FROM project_wbs_nodes WHERE project_id = $1 ORDER BY sort_order ASC, code ASC`,
      [projectId],
    );
    return r.rows.map(toWbsNode);
  }

  async updateWbsNode(id: string, input: UpdateWbsNodeInput): Promise<ProjectWbsNode | null> {
    const r = await this.pool.query(
      `UPDATE project_wbs_nodes
          SET code               = COALESCE($2, code),
              name               = COALESCE($3, name),
              description        = CASE WHEN $4::boolean THEN $5 ELSE description END,
              sort_order         = COALESCE($6, sort_order),
              updated_by_user_id = $7,
              updated_at         = now()
        WHERE id = $1
        RETURNING *`,
      [
        id,
        input.code ?? null,
        input.name ?? null,
        input.description !== undefined,
        input.description ?? null,
        input.sortOrder ?? null,
        input.updatedBy ?? null,
      ],
    );
    return r.rows[0] ? toWbsNode(r.rows[0]) : null;
  }

  async listWbsDescendantIds(tenantId: string, nodeId: string): Promise<string[]> {
    const r = await this.pool.query(
      `WITH RECURSIVE descendants AS (
         SELECT id FROM project_wbs_nodes WHERE id = $2 AND tenant_id = $1
         UNION ALL
         SELECT n.id
           FROM project_wbs_nodes n
           JOIN descendants d ON n.parent_id = d.id
          WHERE n.tenant_id = $1
       )
       SELECT id FROM descendants WHERE id <> $2`,
      [tenantId, nodeId],
    );
    return r.rows.map((row: QueryResultRow) => row.id as string);
  }

  async assignActivityToWbsNode(input: {
    tenantId: string;
    activityId: string;
    wbsNodeId: string | null;
    updatedBy: string | null;
  }): Promise<CoreActivityRef | null> {
    const r = await this.pool.query(
      `UPDATE project_delivery_activities
          SET wbs_node_id = $3,
              updated_by_user_id = $4,
              updated_at = now()
        WHERE id = $1 AND tenant_id = $2
        RETURNING id, tenant_id, project_id, title, status, progress_percent,
                  planned_start_date, planned_end_date, wbs_node_id`,
      [input.activityId, input.tenantId, input.wbsNodeId, input.updatedBy],
    );
    return r.rows[0] ? toCoreActivity(r.rows[0]) : null;
  }

  // --- Dependencies --------------------------------------------------------

  async createDependency(input: CreateDependencyInput): Promise<ProjectActivityDependency> {
    const r = await this.pool.query(
      `INSERT INTO project_activity_dependencies
         (tenant_id, project_id, predecessor_activity_id, successor_activity_id,
          dependency_type, lag_days, created_by_user_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       RETURNING *`,
      [
        input.tenantId,
        input.projectId,
        input.predecessorActivityId,
        input.successorActivityId,
        input.dependencyType,
        input.lagDays,
        input.createdBy,
      ],
    );
    return toDependency(r.rows[0]);
  }

  async findDependencyById(id: string): Promise<ProjectActivityDependency | null> {
    const r = await this.pool.query(`SELECT * FROM project_activity_dependencies WHERE id = $1`, [id]);
    return r.rows[0] ? toDependency(r.rows[0]) : null;
  }

  async listDependencies(projectId: string): Promise<ProjectActivityDependency[]> {
    const r = await this.pool.query(
      `SELECT * FROM project_activity_dependencies WHERE project_id = $1 ORDER BY created_at ASC`,
      [projectId],
    );
    return r.rows.map(toDependency);
  }

  async deleteDependency(id: string): Promise<boolean> {
    const r = await this.pool.query(`DELETE FROM project_activity_dependencies WHERE id = $1`, [id]);
    return (r.rowCount ?? 0) > 0;
  }

  // --- Resources -----------------------------------------------------------

  async createResource(input: CreateResourceInput): Promise<ProjectResource> {
    const r = await this.pool.query(
      `INSERT INTO project_resources
         (tenant_id, code, name, resource_type, unit, capacity_per_day, cost_rate,
          created_by_user_id, updated_by_user_id)
       VALUES ($1,$2,$3,$4,$5,$6::numeric,$7::numeric,$8,$8)
       RETURNING *`,
      [
        input.tenantId,
        input.code,
        input.name,
        input.resourceType,
        input.unit,
        input.capacityPerDay,
        input.costRate,
        input.createdBy,
      ],
    );
    return toResource(r.rows[0]);
  }

  async findResourceById(id: string): Promise<ProjectResource | null> {
    const r = await this.pool.query(`SELECT * FROM project_resources WHERE id = $1`, [id]);
    return r.rows[0] ? toResource(r.rows[0]) : null;
  }

  async listResources(tenantId: string, activeOnly: boolean): Promise<ProjectResource[]> {
    const r = await this.pool.query(
      `SELECT * FROM project_resources
        WHERE tenant_id = $1 AND ($2::boolean = false OR is_active = true)
        ORDER BY code ASC`,
      [tenantId, activeOnly],
    );
    return r.rows.map(toResource);
  }

  async createResourceAssignment(
    input: CreateResourceAssignmentInput,
  ): Promise<ProjectResourceAssignment> {
    const r = await this.pool.query(
      `INSERT INTO project_resource_assignments
         (tenant_id, project_id, activity_id, resource_id, planned_units, start_date, end_date,
          created_by_user_id)
       VALUES ($1,$2,$3,$4,$5::numeric,$6::date,$7::date,$8)
       RETURNING *`,
      [
        input.tenantId,
        input.projectId,
        input.activityId,
        input.resourceId,
        input.plannedUnits,
        input.startDate,
        input.endDate,
        input.createdBy,
      ],
    );
    return toAssignment(r.rows[0]);
  }

  async listResourceAssignments(projectId: string): Promise<ProjectResourceAssignment[]> {
    const r = await this.pool.query(
      `SELECT * FROM project_resource_assignments WHERE project_id = $1 ORDER BY start_date ASC`,
      [projectId],
    );
    return r.rows.map(toAssignment);
  }

  // --- Baselines -----------------------------------------------------------

  async createBaseline(input: {
    tenantId: string;
    projectId: string;
    version: number;
    name: string;
    notes: string | null;
    createdBy: string | null;
  }): Promise<ProjectBaseline> {
    const r = await this.pool.query(
      `INSERT INTO project_baselines
         (tenant_id, project_id, version, name, notes, created_by_user_id)
       VALUES ($1,$2,$3,$4,$5,$6)
       RETURNING *`,
      [input.tenantId, input.projectId, input.version, input.name, input.notes, input.createdBy],
    );
    return toBaseline(r.rows[0]);
  }

  async findBaselineById(id: string): Promise<ProjectBaseline | null> {
    const r = await this.pool.query(`SELECT * FROM project_baselines WHERE id = $1`, [id]);
    return r.rows[0] ? toBaseline(r.rows[0]) : null;
  }

  async listBaselines(projectId: string): Promise<ProjectBaseline[]> {
    const r = await this.pool.query(
      `SELECT * FROM project_baselines WHERE project_id = $1 ORDER BY version DESC`,
      [projectId],
    );
    return r.rows.map(toBaseline);
  }

  async findActiveBaseline(projectId: string): Promise<ProjectBaseline | null> {
    const r = await this.pool.query(
      `SELECT * FROM project_baselines WHERE project_id = $1 AND status = 'approved' LIMIT 1`,
      [projectId],
    );
    return r.rows[0] ? toBaseline(r.rows[0]) : null;
  }

  /**
   * Approve a baseline, superseding whichever one was approved before.
   *
   * Both statements run in one transaction because the partial unique index
   * `uq_project_baselines_one_approved` refuses two approved rows: superseding
   * after the insert would fail, and superseding before it without a
   * transaction would leave a project with no approved baseline if the second
   * statement failed.
   */
  async approveBaseline(input: {
    tenantId: string;
    baselineId: string;
    approvedBy: string | null;
  }): Promise<ProjectBaseline> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const target = await client.query(
        `SELECT * FROM project_baselines WHERE id = $1 AND tenant_id = $2 FOR UPDATE`,
        [input.baselineId, input.tenantId],
      );
      if (!target.rows[0]) {
        await client.query("ROLLBACK");
        return null as unknown as ProjectBaseline;
      }
      const projectId = target.rows[0].project_id as string;

      await client.query(
        `UPDATE project_baselines
            SET status = 'superseded', updated_at = now()
          WHERE project_id = $1 AND status = 'approved' AND id <> $2`,
        [projectId, input.baselineId],
      );
      const r = await client.query(
        `UPDATE project_baselines
            SET status = 'approved',
                approved_at = now(),
                approved_by_user_id = $3,
                updated_at = now()
          WHERE id = $1 AND tenant_id = $2
          RETURNING *`,
        [input.baselineId, input.tenantId, input.approvedBy],
      );
      await client.query("COMMIT");
      return toBaseline(r.rows[0]);
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async listBaselineLines(baselineId: string): Promise<ProjectBaselineLine[]> {
    const r = await this.pool.query(
      `SELECT id, tenant_id, baseline_id, activity_id,
              planned_start, planned_finish,
              planned_cost::text AS planned_cost,
              planned_units::text AS planned_units
         FROM project_baseline_lines
        WHERE baseline_id = $1
        ORDER BY planned_start ASC NULLS LAST`,
      [baselineId],
    );
    return r.rows.map(toBaselineLine);
  }

  /** Snapshot the current plan into a new baseline's lines, in one statement. */
  async insertBaselineLinesFromPlan(input: {
    tenantId: string;
    baselineId: string;
    projectId: string;
    plannedCostByActivity: Map<string, string>;
  }): Promise<number> {
    const activities = await this.listCoreActivities(input.projectId);
    if (activities.length === 0) return 0;

    const ids = activities.map((a) => a.id);
    const costs = ids.map((id) => input.plannedCostByActivity.get(id) ?? "0");
    const r = await this.pool.query(
      `INSERT INTO project_baseline_lines
         (tenant_id, baseline_id, activity_id, planned_start, planned_finish, planned_cost, planned_units)
       SELECT $1, $2, a.id, a.planned_start_date, a.planned_end_date,
              c.cost::numeric, 0
         FROM project_delivery_activities a
         JOIN unnest($3::uuid[], $4::text[]) AS c(id, cost) ON c.id = a.id
        WHERE a.project_id = $5
       ON CONFLICT (baseline_id, activity_id) DO NOTHING`,
      [input.tenantId, input.baselineId, ids, costs, input.projectId],
    );
    return r.rowCount ?? 0;
  }

  // --- Cost ----------------------------------------------------------------

  async createCostEntry(input: CreateCostEntryInput): Promise<ProjectCostEntry> {
    const r = await this.pool.query(
      `INSERT INTO project_cost_entries
         (tenant_id, project_id, activity_id, entry_type, amount, currency, entry_date,
          source_document_type, source_document_id, idempotency_key, note, created_by_user_id)
       VALUES ($1,$2,$3,$4,$5::numeric,$6,$7::date,$8,$9,$10,$11,$12)
       RETURNING *, amount::text AS amount`,
      [
        input.tenantId,
        input.projectId,
        input.activityId,
        input.entryType,
        input.amount,
        input.currency,
        input.entryDate,
        input.sourceDocumentType,
        input.sourceDocumentId,
        input.idempotencyKey,
        input.note,
        input.createdBy,
      ],
    );
    return toCostEntry(r.rows[0]);
  }

  async findCostEntryById(id: string): Promise<ProjectCostEntry | null> {
    const r = await this.pool.query(
      `SELECT *, amount::text AS amount FROM project_cost_entries WHERE id = $1`,
      [id],
    );
    return r.rows[0] ? toCostEntry(r.rows[0]) : null;
  }

  async listCostEntries(projectId: string, asOfDate: string | null): Promise<ProjectCostEntry[]> {
    const r = await this.pool.query(
      `SELECT *, amount::text AS amount
         FROM project_cost_entries
        WHERE project_id = $1 AND ($2::date IS NULL OR entry_date <= $2::date)
        ORDER BY entry_date ASC, created_at ASC`,
      [projectId, asOfDate],
    );
    return r.rows.map(toCostEntry);
  }

  async findCostEntryByIdempotencyKey(
    tenantId: string,
    key: string,
  ): Promise<ProjectCostEntry | null> {
    const r = await this.pool.query(
      `SELECT *, amount::text AS amount
         FROM project_cost_entries WHERE tenant_id = $1 AND idempotency_key = $2`,
      [tenantId, key],
    );
    return r.rows[0] ? toCostEntry(r.rows[0]) : null;
  }

  /**
   * Record the compensating row for an entry.
   *
   * The original is read `FOR UPDATE` so two reversals of the same entry cannot
   * both pass the "already reversed" check the service performs before calling
   * this — the second one blocks, then sees the first one's row.
   */
  async reverseCostEntry(input: {
    tenantId: string;
    entryId: string;
    note: string | null;
    createdBy: string | null;
  }): Promise<ProjectCostEntry> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const original = await client.query(
        `SELECT *, amount::text AS amount FROM project_cost_entries
          WHERE id = $1 AND tenant_id = $2 FOR UPDATE`,
        [input.entryId, input.tenantId],
      );
      const row = original.rows[0];
      if (!row) {
        await client.query("ROLLBACK");
        return null as unknown as ProjectCostEntry;
      }
      const r = await client.query(
        `INSERT INTO project_cost_entries
           (tenant_id, project_id, activity_id, entry_type, amount, currency, entry_date,
            source_document_type, source_document_id, reverses_id, idempotency_key, note,
            created_by_user_id)
         VALUES ($1,$2,$3,'reversal',$4::numeric,$5,CURRENT_DATE,$6,$7,$8,$9,$10,$11)
         RETURNING *, amount::text AS amount`,
        [
          row.tenant_id,
          row.project_id,
          row.activity_id,
          row.amount,
          row.currency,
          row.source_document_type,
          row.source_document_id,
          input.entryId,
          `${row.idempotency_key}:reversal`,
          input.note,
          input.createdBy,
        ],
      );
      await client.query("COMMIT");
      return toCostEntry(r.rows[0]);
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  // --- Earned value snapshots ----------------------------------------------

  async createEarnedValueSnapshot(input: {
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
  }): Promise<ProjectEarnedValueSnapshot> {
    const r = await this.pool.query(
      `INSERT INTO project_earned_value_snapshots
         (tenant_id, project_id, as_of_date, currency, planned_value, earned_value, actual_cost,
          schedule_variance, cost_variance, schedule_performance_index, cost_performance_index,
          budget_at_completion, estimate_at_completion, estimate_to_complete, variance_at_completion,
          notes, computed_by_user_id)
       VALUES ($1,$2,$3::date,$4,$5::numeric,$6::numeric,$7::numeric,$8::numeric,$9::numeric,
               $10::numeric,$11::numeric,$12::numeric,$13::numeric,$14::numeric,$15::numeric,$16,$17)
       ON CONFLICT (tenant_id, project_id, as_of_date) DO UPDATE
         SET currency = EXCLUDED.currency,
             planned_value = EXCLUDED.planned_value,
             earned_value = EXCLUDED.earned_value,
             actual_cost = EXCLUDED.actual_cost,
             schedule_variance = EXCLUDED.schedule_variance,
             cost_variance = EXCLUDED.cost_variance,
             schedule_performance_index = EXCLUDED.schedule_performance_index,
             cost_performance_index = EXCLUDED.cost_performance_index,
             budget_at_completion = EXCLUDED.budget_at_completion,
             estimate_at_completion = EXCLUDED.estimate_at_completion,
             estimate_to_complete = EXCLUDED.estimate_to_complete,
             variance_at_completion = EXCLUDED.variance_at_completion,
             notes = EXCLUDED.notes,
             computed_by_user_id = EXCLUDED.computed_by_user_id
       RETURNING *`,
      [
        input.tenantId,
        input.projectId,
        input.asOfDate,
        input.currency,
        input.plannedValue,
        input.earnedValue,
        input.actualCost,
        input.scheduleVariance,
        input.costVariance,
        input.schedulePerformanceIndex,
        input.costPerformanceIndex,
        input.budgetAtCompletion,
        input.estimateAtCompletion,
        input.estimateToComplete,
        input.varianceAtCompletion,
        input.notes,
        input.computedBy,
      ],
    );
    return toEvSnapshot(r.rows[0]);
  }

  async listEarnedValueSnapshots(projectId: string): Promise<ProjectEarnedValueSnapshot[]> {
    const r = await this.pool.query(
      `SELECT * FROM project_earned_value_snapshots
        WHERE project_id = $1 ORDER BY as_of_date DESC`,
      [projectId],
    );
    return r.rows.map(toEvSnapshot);
  }

  // --- Postings ------------------------------------------------------------

  async recordCostPosting(input: {
    tenantId: string;
    projectId: string;
    costEntryId: string;
    idempotencyKey: string;
    status: "emitted" | "skipped_duplicate";
  }): Promise<ProjectCostPosting> {
    const r = await this.pool.query(
      `INSERT INTO project_cost_postings
         (tenant_id, project_id, cost_entry_id, idempotency_key, status)
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (tenant_id, idempotency_key) DO UPDATE
         SET status = EXCLUDED.status
       RETURNING *`,
      [input.tenantId, input.projectId, input.costEntryId, input.idempotencyKey, input.status],
    );
    return toCostPosting(r.rows[0]);
  }

  async listCostPostings(projectId: string): Promise<ProjectCostPosting[]> {
    const r = await this.pool.query(
      `SELECT * FROM project_cost_postings WHERE project_id = $1 ORDER BY created_at ASC`,
      [projectId],
    );
    return r.rows.map(toCostPosting);
  }

  // --- Cross-domain reads --------------------------------------------------

  async listCoreActivities(projectId: string): Promise<CoreActivityRef[]> {
    const r = await this.pool.query(
      `SELECT id, tenant_id, project_id, title, status, progress_percent,
              planned_start_date, planned_end_date, wbs_node_id
         FROM project_delivery_activities
        WHERE project_id = $1
        ORDER BY planned_start_date ASC NULLS LAST, created_at ASC`,
      [projectId],
    );
    return r.rows.map(toCoreActivity);
  }

  async findCoreActivityById(id: string): Promise<CoreActivityRef | null> {
    const r = await this.pool.query(
      `SELECT id, tenant_id, project_id, title, status, progress_percent,
              planned_start_date, planned_end_date, wbs_node_id
         FROM project_delivery_activities WHERE id = $1`,
      [id],
    );
    return r.rows[0] ? toCoreActivity(r.rows[0]) : null;
  }

  async projectExists(tenantId: string, projectId: string): Promise<boolean> {
    const r = await this.pool.query(
      `SELECT 1 FROM projects WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL`,
      [projectId, tenantId],
    );
    return (r.rowCount ?? 0) > 0;
  }
}

// ---------------------------------------------------------------------------
// Row mappers
// ---------------------------------------------------------------------------

function toDate(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) {
    const y = value.getFullYear();
    const m = String(value.getMonth() + 1).padStart(2, "0");
    const d = String(value.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }
  return String(value).slice(0, 10);
}

function toWbsNode(row: QueryResultRow): ProjectWbsNode {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    projectId: row.project_id,
    parentId: row.parent_id ?? null,
    code: row.code,
    name: row.name,
    description: row.description ?? null,
    depth: Number(row.depth),
    sortOrder: Number(row.sort_order),
    createdByUserId: row.created_by_user_id ?? null,
    updatedByUserId: row.updated_by_user_id ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toDependency(row: QueryResultRow): ProjectActivityDependency {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    projectId: row.project_id,
    predecessorActivityId: row.predecessor_activity_id,
    successorActivityId: row.successor_activity_id,
    dependencyType: row.dependency_type as DependencyType,
    lagDays: Number(row.lag_days),
    createdByUserId: row.created_by_user_id ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toResource(row: QueryResultRow): ProjectResource {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    code: row.code,
    name: row.name,
    resourceType: row.resource_type as ResourceType,
    unit: row.unit,
    // NUMERIC comes back as a string from `pg` only when the column type is
    // unparsed; cast to text in the SELECT keeps that guarantee explicit.
    capacityPerDay: row.capacity_per_day === null ? null : String(row.capacity_per_day),
    costRate: row.cost_rate === null ? null : String(row.cost_rate),
    isActive: row.is_active,
    createdByUserId: row.created_by_user_id ?? null,
    updatedByUserId: row.updated_by_user_id ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toAssignment(row: QueryResultRow): ProjectResourceAssignment {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    projectId: row.project_id,
    activityId: row.activity_id,
    resourceId: row.resource_id,
    plannedUnits: String(row.planned_units),
    startDate: toDate(row.start_date) as string,
    endDate: toDate(row.end_date) as string,
    createdByUserId: row.created_by_user_id ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toBaseline(row: QueryResultRow): ProjectBaseline {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    projectId: row.project_id,
    version: Number(row.version),
    name: row.name,
    status: row.status as BaselineStatus,
    notes: row.notes ?? null,
    approvedAt: row.approved_at ?? null,
    approvedByUserId: row.approved_by_user_id ?? null,
    createdByUserId: row.created_by_user_id ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toBaselineLine(row: QueryResultRow): ProjectBaselineLine {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    baselineId: row.baseline_id,
    activityId: row.activity_id,
    plannedStart: toDate(row.planned_start),
    plannedFinish: toDate(row.planned_finish),
    plannedCost: String(row.planned_cost),
    plannedUnits: String(row.planned_units),
  };
}

function toCostEntry(row: QueryResultRow): ProjectCostEntry {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    projectId: row.project_id,
    activityId: row.activity_id ?? null,
    entryType: row.entry_type,
    amount: String(row.amount),
    currency: row.currency,
    entryDate: toDate(row.entry_date) as string,
    sourceDocumentType: row.source_document_type ?? null,
    sourceDocumentId: row.source_document_id ?? null,
    reversesId: row.reverses_id ?? null,
    idempotencyKey: row.idempotency_key,
    note: row.note ?? null,
    createdByUserId: row.created_by_user_id ?? null,
    createdAt: row.created_at,
  };
}

function toEvSnapshot(row: QueryResultRow): ProjectEarnedValueSnapshot {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    projectId: row.project_id,
    asOfDate: toDate(row.as_of_date) as string,
    currency: row.currency,
    plannedValue: String(row.planned_value),
    earnedValue: String(row.earned_value),
    actualCost: String(row.actual_cost),
    scheduleVariance: String(row.schedule_variance),
    costVariance: String(row.cost_variance),
    schedulePerformanceIndex:
      row.schedule_performance_index === null ? null : String(row.schedule_performance_index),
    costPerformanceIndex:
      row.cost_performance_index === null ? null : String(row.cost_performance_index),
    budgetAtCompletion: String(row.budget_at_completion),
    estimateAtCompletion:
      row.estimate_at_completion === null ? null : String(row.estimate_at_completion),
    estimateToComplete:
      row.estimate_to_complete === null ? null : String(row.estimate_to_complete),
    varianceAtCompletion:
      row.variance_at_completion === null ? null : String(row.variance_at_completion),
    notes: row.notes ?? null,
    computedByUserId: row.computed_by_user_id ?? null,
    createdAt: row.created_at,
  };
}

function toCostPosting(row: QueryResultRow): ProjectCostPosting {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    projectId: row.project_id,
    costEntryId: row.cost_entry_id,
    idempotencyKey: row.idempotency_key,
    status: row.status,
    createdAt: row.created_at,
  };
}

function toCoreActivity(row: QueryResultRow): CoreActivityRef {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    projectId: row.project_id,
    title: row.title,
    status: row.status,
    progressPercent: Number(row.progress_percent),
    plannedStartDate: toDate(row.planned_start_date),
    plannedEndDate: toDate(row.planned_end_date),
    wbsNodeId: row.wbs_node_id ?? null,
  };
}