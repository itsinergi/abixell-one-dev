/**
 * Wave A2 — RPT-ADV-002: Predictive Analytics Across Operational History.
 *
 * Deterministic statistical foundation, not an ML platform: bounded
 * historical read → simple moving-average / linear-trend projection →
 * snapshot. No autonomous mutation of business records, no cross-tenant
 * training data, no unbounded background computation (snapshots are
 * generated on demand, one bounded query + one bounded computation per
 * call).
 */

export type ForecastModelCode =
  | "complaint_volume_forecast"
  | "sla_breach_risk_forecast"
  | "survey_satisfaction_trend";

export type ForecastStatus = "completed" | "insufficient_data";

export interface ForecastDataPoint {
  period: string; // ISO date (YYYY-MM-DD), one point per day/week bucket
  value: number;
}

export interface ForecastMetrics {
  historicalAverage: number;
  trendSlopePerDay: number;
  projectedNextPeriodValue: number;
}

export interface ForecastConfidenceInterval {
  period: string;
  lower: number;
  upper: number;
}

export interface PredictiveForecastSnapshot {
  id: string;
  tenantId: string;
  modelCode: ForecastModelCode;
  forecastPeriodStart: string; // DATE
  forecastPeriodEnd: string; // DATE
  inputParams: Record<string, unknown>;
  dataPoints: ForecastDataPoint[];
  metrics: ForecastMetrics | Record<string, never>;
  confidenceIntervals: ForecastConfidenceInterval[];
  status: ForecastStatus;
  generatedAt: Date;
  generatedBy: string | null;
  createdAt: Date;
}

export interface ForecastResult {
  modelCode: ForecastModelCode;
  status: ForecastStatus;
  forecastPeriodStart: string;
  forecastPeriodEnd: string;
  historicalDataPoints: ForecastDataPoint[];
  projectedDataPoints: ForecastDataPoint[];
  metrics: ForecastMetrics | null;
  confidenceIntervals: ForecastConfidenceInterval[];
  /** Populated only when status === 'insufficient_data'. */
  insufficientDataReason: string | null;
}

export interface PredictiveRepository {
  getHistoricalComplaintVolume(tenantId: string, lookbackDays: number): Promise<ForecastDataPoint[]>;
  getHistoricalSlaBreaches(tenantId: string, lookbackDays: number): Promise<ForecastDataPoint[]>;
  getHistoricalSurveySatisfaction(tenantId: string, lookbackDays: number): Promise<ForecastDataPoint[]>;

  saveForecastSnapshot(input: {
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
  }): Promise<PredictiveForecastSnapshot>;
  listForecastSnapshots(tenantId: string, modelCode?: ForecastModelCode): Promise<PredictiveForecastSnapshot[]>;
  findLatestSnapshot(tenantId: string, modelCode: ForecastModelCode): Promise<PredictiveForecastSnapshot | null>;
}
