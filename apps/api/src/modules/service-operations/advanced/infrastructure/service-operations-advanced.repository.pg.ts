import type { Pool, PoolClient, QueryResultRow } from "pg";
import type {
  CandidateWorkOrder,
  CandidateWorker,
  CreateOptimizationRunInput,
  OptimizationAssignmentProposal,
  OptimizationParameters,
  OptimizationRun,
  OptimizationRunStatus,
  ServiceOperationsAdvancedRepository,
  ServicePackActivation,
  ServicePackCode,
} from "../domain/service-operations-advanced.entity.js";

/**
 * Service Operations Advanced persistence.
 *
 * Scope discipline:
 * - Vertical Service Packs: storage for activation flags only. Service
 *   definitions and checklists are created directly in Service Operations
 *   Core's generic tables.
 * - Route/Roster Optimization: snapshot storage for advisory runs. Proposals
 *   remain proposals until confirmed via `markOptimizationRunApplied`.
 */
export class PgServiceOperationsAdvancedRepository implements ServiceOperationsAdvancedRepository {
  constructor(private readonly pool: Pool) {}

  private async inTransaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const result = await fn(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  // --- Service Pack Activations (PACK-001…004) ---------------------------

  async getPackActivation(tenantId: string, packCode: ServicePackCode): Promise<ServicePackActivation | null> {
    const r = await this.pool.query(
      `SELECT * FROM service_pack_activations WHERE tenant_id = $1 AND pack_code = $2`,
      [tenantId, packCode],
    );
    return r.rows[0] ? toPackActivation(r.rows[0]) : null;
  }

  async listPackActivations(tenantId: string): Promise<ServicePackActivation[]> {
    const r = await this.pool.query(
      `SELECT * FROM service_pack_activations WHERE tenant_id = $1 ORDER BY pack_code`,
      [tenantId],
    );
    return r.rows.map(toPackActivation);
  }

  async upsertPackActivation(
    tenantId: string,
    packCode: ServicePackCode,
    isActive: boolean,
    activatedBy: string | null,
  ): Promise<ServicePackActivation> {
    const r = await this.pool.query(
      `INSERT INTO service_pack_activations
         (tenant_id, pack_code, is_active, activated_at, activated_by, updated_at)
       VALUES ($1, $2, $3, now(), $4, now())
       ON CONFLICT (tenant_id, pack_code)
       DO UPDATE SET is_active = EXCLUDED.is_active,
                     activated_at = CASE WHEN EXCLUDED.is_active THEN now() ELSE service_pack_activations.activated_at END,
                     activated_by = EXCLUDED.activated_by,
                     updated_at = now()
       RETURNING *`,
      [tenantId, packCode, isActive, activatedBy],
    );
    return toPackActivation(r.rows[0]);
  }

  // --- Route, Roster & Workload Optimization (SO-ADV-002…005) ------------

  async createOptimizationRun(input: CreateOptimizationRunInput): Promise<OptimizationRun> {
    const r = await this.pool.query(
      `INSERT INTO service_optimization_runs
         (tenant_id, run_number, target_date, organization_unit_id, parameters, proposals, created_by)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7)
       RETURNING *`,
      [
        input.tenantId,
        input.runNumber,
        input.targetDate,
        input.organizationUnitId ?? null,
        JSON.stringify(input.parameters ?? {}),
        JSON.stringify(input.proposals ?? []),
        input.createdBy,
      ],
    );
    return toOptimizationRun(r.rows[0]);
  }

  async findOptimizationRunById(tenantId: string, id: string): Promise<OptimizationRun | null> {
    const r = await this.pool.query(
      `SELECT * FROM service_optimization_runs WHERE id = $1 AND tenant_id = $2`,
      [id, tenantId],
    );
    return r.rows[0] ? toOptimizationRun(r.rows[0]) : null;
  }

  async listOptimizationRuns(tenantId: string, limit?: number): Promise<OptimizationRun[]> {
    const r = await this.pool.query(
      `SELECT * FROM service_optimization_runs
        WHERE tenant_id = $1
        ORDER BY created_at DESC
        LIMIT $2`,
      [tenantId, limit ?? 50],
    );
    return r.rows.map(toOptimizationRun);
  }

  /** Guarded on `status = 'proposed'` — an already applied or dismissed run cannot be re-applied. */
  async markOptimizationRunApplied(
    tenantId: string,
    id: string,
    appliedBy: string,
  ): Promise<OptimizationRun | null> {
    const r = await this.pool.query(
      `UPDATE service_optimization_runs
          SET status = 'applied', applied_at = now(), applied_by = $3
        WHERE id = $1 AND tenant_id = $2 AND status = 'proposed'
        RETURNING *`,
      [id, tenantId, appliedBy],
    );
    return r.rows[0] ? toOptimizationRun(r.rows[0]) : null;
  }

  /**
   * Transactional atomic apply: locks the optimization run row FOR UPDATE,
   * enforces `status = 'proposed'`, transitions the status to `applied`, and
   * applies every unassigned proposal with guarded UPDATE in the same
   * database transaction. Returns the updated run and the list of work order
   * IDs that were successfully assigned.
   */
  async applyOptimizationRunAssignments(
    tenantId: string,
    id: string,
    appliedBy: string,
  ): Promise<{ run: OptimizationRun; assignedWorkOrderIds: string[] } | null> {
    return this.inTransaction(async (client) => {
      const locked = await client.query(
        `SELECT * FROM service_optimization_runs
          WHERE id = $1 AND tenant_id = $2
          FOR UPDATE`,
        [id, tenantId],
      );
      if (locked.rows.length === 0) return null;
      if (locked.rows[0].status !== "proposed") return null;

      const runUpdate = await client.query(
        `UPDATE service_optimization_runs
            SET status = 'applied', applied_at = now(), applied_by = $3
          WHERE id = $1 AND tenant_id = $2 AND status = 'proposed'
          RETURNING *`,
        [id, tenantId, appliedBy],
      );
      if (runUpdate.rows.length === 0) return null;
      const run = toOptimizationRun(runUpdate.rows[0]);

      const assignedWorkOrderIds: string[] = [];
      for (const proposal of run.proposals) {
        const assignResult = await client.query(
          `UPDATE work_orders
              SET assigned_to_user_id = $3, assigned_at = now(), assigned_by_user_id = $4,
                  updated_by = $4, updated_at = now()
            WHERE id = $1 AND tenant_id = $2 AND assigned_to_user_id IS NULL AND deleted_at IS NULL`,
          [proposal.workOrderId, tenantId, proposal.recommendedUserId, appliedBy],
        );
        if ((assignResult.rowCount ?? 0) > 0) {
          assignedWorkOrderIds.push(proposal.workOrderId);
        }
      }

      return { run, assignedWorkOrderIds };
    });
  }

  /** Guarded on `status = 'proposed'`. */
  async markOptimizationRunDismissed(tenantId: string, id: string): Promise<OptimizationRun | null> {
    const r = await this.pool.query(
      `UPDATE service_optimization_runs
          SET status = 'dismissed'
        WHERE id = $1 AND tenant_id = $2 AND status = 'proposed'
        RETURNING *`,
      [id, tenantId],
    );
    return r.rows[0] ? toOptimizationRun(r.rows[0]) : null;
  }

  // --- Narrow cross-domain reads for optimization engine ----------------

  /**
   * Discovers eligible field workers: active users within the tenant who are
   * linked to active employees. Optionally filters by organization unit.
   * Also computes current active (uncompleted) work orders count.
   */
  async listEligibleWorkers(tenantId: string, organizationUnitId?: string | null): Promise<CandidateWorker[]> {
    const conditions = [
      `u.tenant_id = $1`,
      `u.status = 'active'`,
      `u.deleted_at IS NULL`,
      `e.id IS NOT NULL`,
      `e.employment_status = 'active'`,
      `e.user_id IS NOT NULL`,
    ];
    const params: unknown[] = [tenantId];

    if (organizationUnitId) {
      params.push(organizationUnitId);
      conditions.push(`(e.organization_unit_id = $${params.length} OR e.organization_unit_id IS NULL)`);
    }

    const r = await this.pool.query(
      `SELECT u.id AS user_id,
              COALESCE(e.full_name, u.full_name, u.email) AS full_name,
              e.organization_unit_id,
              (
                SELECT COUNT(*)::int FROM work_orders wo
                 WHERE wo.tenant_id = u.tenant_id
                   AND wo.assigned_to_user_id = u.id
                   AND wo.completed_at IS NULL
                   AND wo.deleted_at IS NULL
              ) AS current_active_work_orders_count
         FROM users u
         LEFT JOIN employees e ON e.user_id = u.id AND e.tenant_id = u.tenant_id AND e.deleted_at IS NULL
        WHERE ${conditions.join(" AND ")}
        ORDER BY full_name`,
      params,
    );

    return r.rows.map((row) => ({
      userId: row.user_id,
      fullName: row.full_name,
      organizationUnitId: row.organization_unit_id,
      currentActiveWorkOrdersCount: Number(row.current_active_work_orders_count ?? 0),
    }));
  }

  /**
   * Reads unassigned, uncompleted work orders for the target date.
   * Cross-joins with customer to read customer's owner Organization Unit.
   */
  async listUnassignedWorkOrders(
    tenantId: string,
    targetDate: string,
    organizationUnitId?: string | null,
  ): Promise<CandidateWorkOrder[]> {
    const conditions = [
      `wo.tenant_id = $1`,
      `wo.assigned_to_user_id IS NULL`,
      `wo.completed_at IS NULL`,
      `wo.deleted_at IS NULL`,
      `($2::date IS NULL OR wo.due_at IS NULL OR (wo.due_at AT TIME ZONE 'UTC')::date <= $2::date)`,
    ];
    const params: unknown[] = [tenantId, targetDate];

    if (organizationUnitId) {
      params.push(organizationUnitId);
      conditions.push(`c.owner_organization_unit_id = $${params.length}`);
    }

    const r = await this.pool.query(
      `SELECT wo.id, wo.work_order_number, wo.title, wo.priority, wo.customer_id,
              wo.site_id, wo.due_at, wo.planned_start_at, wo.planned_end_at
         FROM work_orders wo
         LEFT JOIN customers c ON c.id = wo.customer_id AND c.tenant_id = wo.tenant_id
        WHERE ${conditions.join(" AND ")}
        ORDER BY COALESCE(wo.due_at, wo.planned_start_at, wo.created_at) ASC`,
      params,
    );

    return r.rows.map((row) => ({
      id: row.id,
      workOrderNumber: row.work_order_number,
      title: row.title,
      priority: row.priority,
      customerId: row.customer_id,
      siteId: row.site_id,
      dueAt: row.due_at,
      plannedStartAt: row.planned_start_at,
      plannedEndAt: row.planned_end_at,
    }));
  }

  /** Guarded: assigns a work order only if it remains unassigned and undeleted. */
  async assignWorkOrder(
    tenantId: string,
    workOrderId: string,
    userId: string,
    assignedByUserId: string,
  ): Promise<boolean> {
    const r = await this.pool.query(
      `UPDATE work_orders
          SET assigned_to_user_id = $3, assigned_at = now(), assigned_by_user_id = $4,
              updated_by = $4, updated_at = now()
        WHERE id = $1 AND tenant_id = $2 AND assigned_to_user_id IS NULL AND deleted_at IS NULL`,
      [workOrderId, tenantId, userId, assignedByUserId],
    );
    return (r.rowCount ?? 0) > 0;
  }
}

// ---------------------------------------------------------------------------
// Row mappers
// ---------------------------------------------------------------------------

function toDateString(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) {
    const y = value.getFullYear();
    const m = String(value.getMonth() + 1).padStart(2, "0");
    const d = String(value.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }
  return String(value).slice(0, 10);
}

function toPackActivation(row: QueryResultRow): ServicePackActivation {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    packCode: row.pack_code as ServicePackCode,
    isActive: row.is_active,
    activatedAt: row.activated_at,
    activatedBy: row.activated_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toOptimizationRun(row: QueryResultRow): OptimizationRun {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    runNumber: row.run_number,
    targetDate: toDateString(row.target_date)!,
    organizationUnitId: row.organization_unit_id,
    parameters: (row.parameters ?? {}) as OptimizationParameters,
    proposals: (row.proposals ?? []) as OptimizationAssignmentProposal[],
    status: row.status as OptimizationRunStatus,
    appliedAt: row.applied_at,
    appliedBy: row.applied_by,
    createdAt: row.created_at,
    createdBy: row.created_by,
  };
}
