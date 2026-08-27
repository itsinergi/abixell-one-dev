import type { Pool } from "pg";
import type {
  ForecastConfidenceInterval,
  ForecastDataPoint,
  ForecastMetrics,
  ForecastModelCode,
  ForecastStatus,
  PredictiveForecastSnapshot,
  PredictiveRepository,
} from "../domain/predictive.entity.js";

function toSnapshot(r: Record<string, unknown>): PredictiveForecastSnapshot {
  return {
    id: r.id as string,
    tenantId: r.tenant_id as string,
    modelCode: r.model_code as ForecastModelCode,
    forecastPeriodStart:
      r.forecast_period_start instanceof Date
        ? r.forecast_period_start.toISOString().slice(0, 10)
        : String(r.forecast_period_start),
    forecastPeriodEnd:
      r.forecast_period_end instanceof Date
        ? r.forecast_period_end.toISOString().slice(0, 10)
        : String(r.forecast_period_end),
    inputParams: (r.input_params as Record<string, unknown>) ?? {},
    dataPoints: (r.data_points as ForecastDataPoint[]) ?? [],
    metrics: (r.metrics as ForecastMetrics) ?? {},
    confidenceIntervals: (r.confidence_intervals as ForecastConfidenceInterval[]) ?? [],
    status: r.status as ForecastStatus,
    generatedAt: r.generated_at as Date,
    generatedBy: (r.generated_by as string) ?? null,
    createdAt: r.created_at as Date,
  };
}

/**
 * PostgreSQL implementation of the predictive analytics repository.
 *
 * All historical data reads are strictly tenant-isolated, read-only, and
 * bounded by a lookback window (default 30-90 days, capped to avoid runaway
 * table scans). Generates zero autonomous domain-record mutations.
 */
export class PgPredictiveRepository implements PredictiveRepository {
  constructor(private readonly pool: Pool) {}

  async getHistoricalComplaintVolume(tenantId: string, lookbackDays: number): Promise<ForecastDataPoint[]> {
    const safeDays = Math.min(Math.max(1, lookbackDays), 365);
    const r = await this.pool.query(
      `SELECT to_char(date_trunc('day', created_at), 'YYYY-MM-DD') AS period,
              COUNT(*)::int AS val
         FROM complaints
        WHERE tenant_id = $1
          AND deleted_at IS NULL
          AND created_at >= (now() - ($2 || ' days')::interval)
        GROUP BY date_trunc('day', created_at)
        ORDER BY date_trunc('day', created_at) ASC`,
      [tenantId, safeDays],
    );
    return r.rows.map((row) => ({
      period: row.period as string,
      value: Number(row.val),
    }));
  }

  async getHistoricalSlaBreaches(tenantId: string, lookbackDays: number): Promise<ForecastDataPoint[]> {
    const safeDays = Math.min(Math.max(1, lookbackDays), 365);
    const r = await this.pool.query(
      `SELECT to_char(date_trunc('day', created_at), 'YYYY-MM-DD') AS period,
              COUNT(*) FILTER (WHERE response_breached = true OR resolution_breached = true)::int AS val
         FROM complaint_sla_targets
        WHERE tenant_id = $1
          AND created_at >= (now() - ($2 || ' days')::interval)
        GROUP BY date_trunc('day', created_at)
        ORDER BY date_trunc('day', created_at) ASC`,
      [tenantId, safeDays],
    );
    return r.rows.map((row) => ({
      period: row.period as string,
      value: Number(row.val),
    }));
  }

  async getHistoricalSurveySatisfaction(tenantId: string, lookbackDays: number): Promise<ForecastDataPoint[]> {
    const safeDays = Math.min(Math.max(1, lookbackDays), 365);
    const r = await this.pool.query(
      `SELECT to_char(date_trunc('day', submitted_at), 'YYYY-MM-DD') AS period,
              ROUND(AVG(COALESCE(nps_score, total_score))::numeric, 2) AS val
         FROM survey_assignments
        WHERE tenant_id = $1
          AND status = 'submitted'
          AND submitted_at IS NOT NULL
          AND (total_score IS NOT NULL OR nps_score IS NOT NULL)
          AND submitted_at >= (now() - ($2 || ' days')::interval)
        GROUP BY date_trunc('day', submitted_at)
        ORDER BY date_trunc('day', submitted_at) ASC`,
      [tenantId, safeDays],
    );
    return r.rows.map((row) => ({
      period: row.period as string,
      value: Number(row.val ?? 0),
    }));
  }

  async saveForecastSnapshot(input: {
    tenantId: string;
    modelCode: ForecastModelCode;
    forecastPeriodStart: string;
    forecastPeriodEnd: string;
    inputParams: Record<string, unknown>;
    dataPoints: ForecastDataPoint[];
    metrics: ForecastMetrics | Record<string, never>;
    confidenceIntervals: ForecastConfidenceInterval[];
    status: ForecastStatus;
    generatedBy: string | null;
  }): Promise<PredictiveForecastSnapshot> {
    const r = await this.pool.query(
      `INSERT INTO predictive_forecast_snapshots
         (tenant_id, model_code, forecast_period_start, forecast_period_end,
          input_params, data_points, metrics, confidence_intervals,
          status, generated_at, generated_by)
       VALUES ($1, $2, $3::date, $4::date, $5, $6, $7, $8, $9, now(), $10)
       RETURNING *`,
      [
        input.tenantId,
        input.modelCode,
        input.forecastPeriodStart,
        input.forecastPeriodEnd,
        JSON.stringify(input.inputParams ?? {}),
        JSON.stringify(input.dataPoints ?? []),
        JSON.stringify(input.metrics ?? {}),
        JSON.stringify(input.confidenceIntervals ?? []),
        input.status,
        input.generatedBy,
      ],
    );
    return toSnapshot(r.rows[0]);
  }

  async listForecastSnapshots(
    tenantId: string,
    modelCode?: ForecastModelCode,
  ): Promise<PredictiveForecastSnapshot[]> {
    if (modelCode) {
      const r = await this.pool.query(
        `SELECT * FROM predictive_forecast_snapshots
          WHERE tenant_id = $1 AND model_code = $2
          ORDER BY generated_at DESC`,
        [tenantId, modelCode],
      );
      return r.rows.map(toSnapshot);
    }
    const r = await this.pool.query(
      `SELECT * FROM predictive_forecast_snapshots
        WHERE tenant_id = $1
        ORDER BY generated_at DESC`,
      [tenantId],
    );
    return r.rows.map(toSnapshot);
  }

  async findLatestSnapshot(
    tenantId: string,
    modelCode: ForecastModelCode,
  ): Promise<PredictiveForecastSnapshot | null> {
    const r = await this.pool.query(
      `SELECT * FROM predictive_forecast_snapshots
        WHERE tenant_id = $1 AND model_code = $2
        ORDER BY generated_at DESC
        LIMIT 1`,
      [tenantId, modelCode],
    );
    return r.rows[0] ? toSnapshot(r.rows[0]) : null;
  }
}
