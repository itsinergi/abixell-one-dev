import type { AuditService } from "../../../../application/audit/audit.service.js";
import type { RbacService } from "../../../../application/rbac/rbac.service.js";
import type { ActorContext } from "../../../../domain/shared-kernel/audit-context.js";
import { ValidationError } from "../../../../domain/shared-kernel/errors.js";
import type {
  ForecastConfidenceInterval,
  ForecastDataPoint,
  ForecastMetrics,
  ForecastModelCode,
  ForecastResult,
  PredictiveForecastSnapshot,
  PredictiveRepository,
} from "../domain/predictive.entity.js";

const DEFAULT_LOOKBACK_DAYS = 90;
const DEFAULT_FORECAST_DAYS = 7;
const MIN_LOOKBACK_DAYS = 30;
const MAX_LOOKBACK_DAYS = 365;
const MIN_FORECAST_DAYS = 1;
const MAX_FORECAST_DAYS = 30;
const MIN_CALENDAR_DAY_POINTS = 30;
const MOVING_AVERAGE_WINDOW = 7;
const LINEAR_INTERVAL_Z_SCORE = 1.96;

export interface GenerateForecastInput {
  modelCode: ForecastModelCode;
  lookbackDays?: number;
  forecastDays?: number;
}

export interface GenerateForecastResponse {
  forecast: ForecastResult;
  snapshot: PredictiveForecastSnapshot;
}

export class PredictiveService {
  constructor(
    private readonly repo: PredictiveRepository,
    private readonly audit: AuditService,
    private readonly rbac: RbacService,
  ) {}

  async generateForecast(
    actor: ActorContext,
    input: GenerateForecastInput,
  ): Promise<GenerateForecastResponse> {
    await this.rbac.requireTenantScopedPermission(
      actor.tenantId,
      actor.userId,
      "reporting.predictive.read",
    );

    const normalized = this.normalizeForecastInput(input);
    const rawHistory = await this.loadHistory(
      actor.tenantId,
      normalized.modelCode,
      normalized.lookbackDays,
    );
    const forecast = this.buildForecastResult(
      normalized.modelCode,
      rawHistory,
      normalized.lookbackDays,
      normalized.forecastDays,
    );
    const snapshot = await this.repo.saveForecastSnapshot({
      tenantId: actor.tenantId,
      modelCode: normalized.modelCode,
      forecastPeriodStart: forecast.forecastPeriodStart,
      forecastPeriodEnd: forecast.forecastPeriodEnd,
      inputParams: {
        lookbackDays: normalized.lookbackDays,
        forecastDays: normalized.forecastDays,
        minCalendarDayPoints: MIN_CALENDAR_DAY_POINTS,
        algorithm: "trailing_7_day_moving_average_plus_ols_linear_trend_v1",
        insufficientDataReason: forecast.insufficientDataReason,
      },
      dataPoints: forecast.projectedDataPoints,
      metrics: forecast.metrics ?? {},
      confidenceIntervals: forecast.confidenceIntervals,
      status: forecast.status,
      generatedBy: actor.userId,
    });

    await this.audit.record({
      tenantId: actor.tenantId,
      actorUserId: actor.userId,
      action: "reporting.predictive.forecast_generated",
      entityType: "predictive_forecast_snapshot",
      entityId: snapshot.id,
      metadata: {
        modelCode: snapshot.modelCode,
        status: snapshot.status,
        lookbackDays: normalized.lookbackDays,
        forecastDays: normalized.forecastDays,
        historicalPointCount: forecast.historicalDataPoints.length,
        projectedPointCount: forecast.projectedDataPoints.length,
      },
    });

    return { forecast, snapshot };
  }

  async listForecastSnapshots(
    actor: ActorContext,
    modelCode?: ForecastModelCode,
  ): Promise<PredictiveForecastSnapshot[]> {
    await this.rbac.requireTenantScopedPermission(
      actor.tenantId,
      actor.userId,
      "reporting.predictive.read",
    );
    return this.repo.listForecastSnapshots(actor.tenantId, modelCode);
  }

  async getLatestSnapshot(
    actor: ActorContext,
    modelCode: ForecastModelCode,
  ): Promise<PredictiveForecastSnapshot | null> {
    await this.rbac.requireTenantScopedPermission(
      actor.tenantId,
      actor.userId,
      "reporting.predictive.read",
    );
    return this.repo.findLatestSnapshot(actor.tenantId, modelCode);
  }

  private normalizeForecastInput(input: GenerateForecastInput): {
    modelCode: ForecastModelCode;
    lookbackDays: number;
    forecastDays: number;
  } {
    const lookbackDays = this.normalizeBoundedInteger(
      input.lookbackDays,
      DEFAULT_LOOKBACK_DAYS,
      MIN_LOOKBACK_DAYS,
      MAX_LOOKBACK_DAYS,
      "lookbackDays",
    );
    const forecastDays = this.normalizeBoundedInteger(
      input.forecastDays,
      DEFAULT_FORECAST_DAYS,
      MIN_FORECAST_DAYS,
      MAX_FORECAST_DAYS,
      "forecastDays",
    );

    return {
      modelCode: input.modelCode,
      lookbackDays,
      forecastDays,
    };
  }

  private normalizeBoundedInteger(
    value: number | undefined,
    defaultValue: number,
    min: number,
    max: number,
    fieldName: string,
  ): number {
    if (value === undefined) return defaultValue;
    if (!Number.isInteger(value) || !Number.isFinite(value)) {
      throw new ValidationError(`${fieldName} must be a finite integer`);
    }
    if (value < min || value > max) {
      throw new ValidationError(`${fieldName} must be between ${min} and ${max}`);
    }
    return value;
  }

  private async loadHistory(
    tenantId: string,
    modelCode: ForecastModelCode,
    lookbackDays: number,
  ): Promise<ForecastDataPoint[]> {
    switch (modelCode) {
      case "complaint_volume_forecast":
        return this.repo.getHistoricalComplaintVolume(tenantId, lookbackDays);
      case "sla_breach_risk_forecast":
        return this.repo.getHistoricalSlaBreaches(tenantId, lookbackDays);
      case "survey_satisfaction_trend":
        return this.repo.getHistoricalSurveySatisfaction(tenantId, lookbackDays);
      default:
        throw new ValidationError(`Unsupported forecast model '${modelCode satisfies never}'`);
    }
  }

  private buildForecastResult(
    modelCode: ForecastModelCode,
    rawHistory: ForecastDataPoint[],
    lookbackDays: number,
    forecastDays: number,
  ): ForecastResult {
    const denseHistory = this.densifyDailyHistory(rawHistory, lookbackDays, modelCode);
    if (denseHistory.length < MIN_CALENDAR_DAY_POINTS) {
      return this.insufficientResult(
        modelCode,
        forecastDays,
        "At least 30 calendar-day historical points are required",
        denseHistory,
      );
    }

    const projectedDataPoints = this.projectDataPoints(denseHistory, modelCode, forecastDays);
    const projectedNextPeriodValue = projectedDataPoints[0]?.value ?? 0;
    const metrics = this.calculateMetrics(denseHistory, projectedNextPeriodValue);
    const confidenceIntervals = this.buildConfidenceIntervals(
      denseHistory,
      projectedDataPoints,
      modelCode,
    );

    return {
      modelCode,
      status: "completed",
      forecastPeriodStart: projectedDataPoints[0]?.period ?? this.addDays(this.lastPeriod(denseHistory), 1),
      forecastPeriodEnd:
        projectedDataPoints[projectedDataPoints.length - 1]?.period ??
        this.addDays(this.lastPeriod(denseHistory), forecastDays),
      historicalDataPoints: denseHistory,
      projectedDataPoints,
      metrics,
      confidenceIntervals,
      insufficientDataReason: null,
    };
  }

  private densifyDailyHistory(
    rawHistory: ForecastDataPoint[],
    lookbackDays: number,
    modelCode: ForecastModelCode,
  ): ForecastDataPoint[] {
    if (rawHistory.length === 0) return [];

    const aggregated = new Map<string, number>();
    for (const point of rawHistory) {
      aggregated.set(point.period, (aggregated.get(point.period) ?? 0) + point.value);
    }

    const sortedPeriods = [...aggregated.keys()].sort();
    const lastPeriod = sortedPeriods[sortedPeriods.length - 1];
    const firstPeriod = this.addDays(lastPeriod, -(lookbackDays - 1));
    const dense: ForecastDataPoint[] = [];

    const existingValues = [...aggregated.values()];
    const historicalMean =
      existingValues.length > 0
        ? existingValues.reduce((sum, value) => sum + value, 0) / existingValues.length
        : 0;
    let lastSeenValue: number | null = null;

    for (let offset = 0; offset < lookbackDays; offset++) {
      const period = this.addDays(firstPeriod, offset);
      const existing = aggregated.get(period);
      if (existing !== undefined) {
        lastSeenValue = existing;
        dense.push({ period, value: existing });
        continue;
      }

      if (modelCode === "survey_satisfaction_trend") {
        const imputed = lastSeenValue ?? historicalMean;
        dense.push({ period, value: roundNumber(imputed, 2) });
      } else {
        dense.push({ period, value: 0 });
      }
    }

    return dense;
  }

  private projectDataPoints(
    history: ForecastDataPoint[],
    modelCode: ForecastModelCode,
    forecastDays: number,
  ): ForecastDataPoint[] {
    const { slope } = this.linearRegression(history.map((point) => point.value));
    const trailingValues = history
      .slice(-Math.min(MOVING_AVERAGE_WINDOW, history.length))
      .map((point) => point.value);
    const trailingAverage = average(trailingValues);
    const bounds = this.boundsForModel(modelCode);
    const lastPeriod = this.lastPeriod(history);

    return Array.from({ length: forecastDays }, (_, index) => {
      const horizon = index + 1;
      const projected = clampValue(trailingAverage + slope * horizon, bounds.min, bounds.max);
      return {
        period: this.addDays(lastPeriod, horizon),
        value: roundNumber(projected, 2),
      };
    });
  }

  private calculateMetrics(
    history: ForecastDataPoint[],
    projectedNextPeriodValue: number,
  ): ForecastMetrics {
    const values = history.map((point) => point.value);
    const { slope } = this.linearRegression(values);
    return {
      historicalAverage: roundNumber(average(values), 2),
      trendSlopePerDay: roundNumber(slope, 4),
      projectedNextPeriodValue: roundNumber(projectedNextPeriodValue, 2),
    };
  }

  private buildConfidenceIntervals(
    history: ForecastDataPoint[],
    projectedDataPoints: ForecastDataPoint[],
    modelCode: ForecastModelCode,
  ): ForecastConfidenceInterval[] {
    const values = history.map((point) => point.value);
    const regression = this.linearRegression(values);
    const bounds = this.boundsForModel(modelCode);
    const n = values.length;
    const denominator = Math.max(1, n - 2);
    const residualVariance = regression.residuals.reduce((sum, residual) => sum + residual ** 2, 0) / denominator;
    const residualStdDev = Math.sqrt(residualVariance);
    const sxx = regression.sxx || 1;

    return projectedDataPoints.map((point, index) => {
      const xFuture = n + index;
      const spread = Math.sqrt(1 + 1 / n + ((xFuture - regression.meanX) ** 2) / sxx);
      const margin = LINEAR_INTERVAL_Z_SCORE * residualStdDev * spread;
      return {
        period: point.period,
        lower: roundNumber(clampValue(point.value - margin, bounds.min, bounds.max), 2),
        upper: roundNumber(clampValue(point.value + margin, bounds.min, bounds.max), 2),
      };
    });
  }

  private linearRegression(values: number[]): {
    slope: number;
    intercept: number;
    residuals: number[];
    meanX: number;
    sxx: number;
  } {
    const xs = values.map((_, index) => index);
    const meanX = average(xs);
    const meanY = average(values);
    const sxx = xs.reduce((sum, x) => sum + (x - meanX) ** 2, 0);
    const sxy = xs.reduce((sum, x, index) => sum + (x - meanX) * (values[index] - meanY), 0);
    const slope = sxx === 0 ? 0 : sxy / sxx;
    const intercept = meanY - slope * meanX;
    const residuals = xs.map((x, index) => values[index] - (intercept + slope * x));
    return { slope, intercept, residuals, meanX, sxx };
  }

  private boundsForModel(modelCode: ForecastModelCode): { min: number; max?: number } {
    switch (modelCode) {
      case "complaint_volume_forecast":
      case "sla_breach_risk_forecast":
        return { min: 0 };
      case "survey_satisfaction_trend":
        return { min: -100, max: 100 };
    }
  }

  private insufficientResult(
    modelCode: ForecastModelCode,
    forecastDays: number,
    reason: string,
    historicalDataPoints: ForecastDataPoint[],
  ): ForecastResult {
    const lastPeriod = historicalDataPoints.length > 0 ? this.lastPeriod(historicalDataPoints) : this.todayIsoDate();
    return {
      modelCode,
      status: "insufficient_data",
      forecastPeriodStart: this.addDays(lastPeriod, 1),
      forecastPeriodEnd: this.addDays(lastPeriod, forecastDays),
      historicalDataPoints,
      projectedDataPoints: [],
      metrics: null,
      confidenceIntervals: [],
      insufficientDataReason: reason,
    };
  }

  private lastPeriod(points: ForecastDataPoint[]): string {
    return points[points.length - 1]?.period ?? this.todayIsoDate();
  }

  private addDays(period: string, days: number): string {
    const date = this.parseIsoDate(period);
    date.setUTCDate(date.getUTCDate() + days);
    return toIsoDate(date);
  }

  private parseIsoDate(period: string): Date {
    const date = new Date(`${period}T00:00:00.000Z`);
    if (Number.isNaN(date.getTime())) {
      throw new ValidationError(`Invalid forecast period '${period}'`);
    }
    return date;
  }

  private todayIsoDate(): string {
    return toIsoDate(new Date());
  }
}

function average(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function clampValue(value: number, min: number, max?: number): number {
  const lowerClamped = Math.max(min, value);
  return max === undefined ? lowerClamped : Math.min(max, lowerClamped);
}

function roundNumber(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

function toIsoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}
