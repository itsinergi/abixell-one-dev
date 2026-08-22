import type { Pool, QueryResultRow } from "pg";
import type {
  ScheduledJob,
  ScheduledJobRun,
  ScheduledJobRunStatus,
  ScheduledJobRunTrigger,
  SchedulerRepository,
} from "../../../domain/scheduler/scheduler.entity.js";

export class PgSchedulerRepository implements SchedulerRepository {
  constructor(private readonly pool: Pool) {}

  async listJobs(): Promise<ScheduledJob[]> {
    const result = await this.pool.query(`SELECT * FROM scheduled_jobs ORDER BY job_code`);
    return result.rows.map(mapJob);
  }

  async findJobByCode(jobCode: string): Promise<ScheduledJob | null> {
    const result = await this.pool.query(`SELECT * FROM scheduled_jobs WHERE job_code = $1`, [jobCode]);
    return result.rows[0] ? mapJob(result.rows[0]) : null;
  }

  async claimExecution(
    jobId: string,
    staleBefore: Date,
  ): Promise<string | null> {
    const result = await this.pool.query(
      `UPDATE scheduled_jobs
          SET locked_at = now(),
              lock_token = gen_random_uuid(),
              updated_at = now()
        WHERE id = $1
          AND (locked_at IS NULL OR locked_at < $2)
       RETURNING lock_token`,
      [jobId, staleBefore],
    );
    return result.rows[0]?.lock_token ?? null;
  }

  async renewExecution(
    jobId: string,
    lockToken: string,
  ): Promise<boolean> {
    const result = await this.pool.query(
      `UPDATE scheduled_jobs
          SET locked_at = now(), updated_at = now()
        WHERE id = $1 AND lock_token = $2`,
      [jobId, lockToken],
    );
    return (result.rowCount ?? 0) === 1;
  }

  async releaseExecution(
    jobId: string,
    lockToken: string,
  ): Promise<void> {
    await this.pool.query(
      `UPDATE scheduled_jobs
          SET locked_at = NULL, lock_token = NULL, updated_at = now()
        WHERE id = $1 AND lock_token = $2`,
      [jobId, lockToken],
    );
  }

  async startRun(
    scheduledJobId: string,
    trigger: ScheduledJobRunTrigger,
    triggeredBy: string | null,
    tenantId: string | null,
  ): Promise<ScheduledJobRun> {
    const result = await this.pool.query(
      `INSERT INTO scheduled_job_runs
         (scheduled_job_id, trigger, triggered_by, tenant_id, status)
       VALUES ($1, $2, $3, $4, 'running')
       RETURNING *`,
      [scheduledJobId, trigger, triggeredBy, tenantId],
    );
    return mapRun(result.rows[0]);
  }

  async finishRun(
    runId: string,
    input: { status: "success" | "failed"; resultSummary: Record<string, unknown> | null; errorMessage: string | null },
  ): Promise<ScheduledJobRun> {
    const result = await this.pool.query(
      `UPDATE scheduled_job_runs
          SET finished_at = now(), status = $2, result_summary = $3, error_message = $4
        WHERE id = $1
        RETURNING *`,
      [runId, input.status, input.resultSummary ? JSON.stringify(input.resultSummary) : null, input.errorMessage],
    );
    return mapRun(result.rows[0]);
  }

  async updateJobLastRun(
    jobId: string,
    input: { lastRunAt: Date; lastStatus: ScheduledJobRunStatus; lastDurationMs: number; lastError: string | null },
  ): Promise<void> {
    await this.pool.query(
      `UPDATE scheduled_jobs
          SET last_run_at = $2, last_status = $3, last_duration_ms = $4, last_error = $5, updated_at = now()
        WHERE id = $1`,
      [jobId, input.lastRunAt, input.lastStatus, input.lastDurationMs, input.lastError],
    );
  }

  async listRuns(
    scheduledJobId: string,
    limit: number,
    tenantId?: string,
  ): Promise<ScheduledJobRun[]> {
    const result = await this.pool.query(
      `SELECT *
         FROM scheduled_job_runs
        WHERE scheduled_job_id = $1
          AND ($3::uuid IS NULL OR tenant_id = $3)
        ORDER BY started_at DESC
        LIMIT $2`,
      [scheduledJobId, limit, tenantId ?? null],
    );
    return result.rows.map(mapRun);
  }
}

function mapJob(row: QueryResultRow): ScheduledJob {
  return {
    id: row.id,
    jobCode: row.job_code,
    name: row.name,
    description: row.description,
    intervalSeconds: row.interval_seconds,
    handlerKey: row.handler_key,
    isEnabled: row.is_enabled,
    lastRunAt: row.last_run_at,
    lastStatus: row.last_status,
    lastDurationMs: row.last_duration_ms,
    lastError: row.last_error,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapRun(row: QueryResultRow): ScheduledJobRun {
  return {
    id: row.id,
    scheduledJobId: row.scheduled_job_id,
    trigger: row.trigger,
    triggeredBy: row.triggered_by,
    tenantId: row.tenant_id,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    status: row.status,
    resultSummary: row.result_summary,
    errorMessage: row.error_message,
  };
}
