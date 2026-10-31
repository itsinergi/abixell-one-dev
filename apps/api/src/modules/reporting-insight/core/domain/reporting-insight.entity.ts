/**
 * Phase 9 — Reporting & Operational Insight Core.
 *
 * Reporting is deliberately read-only and scope-safe. It exposes operational
 * summaries over activated modules without becoming self-service BI, a data
 * warehouse, predictive analytics, or a mutation surface.
 */
export type ReportModuleCode =
  | "customer_commercial"
  | "customer_complaint"
  | "survey_assessment"
  | "service_operations"
  | "workforce"
  | "supply_chain"
  | "asset"
  | "finance"
  | "hse"
  | "project_delivery";

export type ReportColumnType = "text" | "number" | "money" | "percent";

export interface ReportingModuleActivation {
  moduleCode: ReportModuleCode;
  moduleName: string;
  isActive: boolean;
}

export interface ReportDefinition {
  code: string;
  title: string;
  description: string;
  moduleCode: ReportModuleCode;
  requiredPermission: string;
}

export interface ReportColumn {
  key: string;
  label: string;
  type: ReportColumnType;
}

export interface ReportRow {
  label: string;
  [key: string]: string | number | null;
}

export interface StandardReportResult {
  code: string;
  title: string;
  moduleCode: ReportModuleCode;
  moduleName: string;
  generatedAt: Date;
  columns: ReportColumn[];
  summary: Record<string, string | number>;
  rows: ReportRow[];
}

/**
 * Where a dashboard card navigates when clicked.
 *
 * `route` → an existing page that already lists the underlying records (e.g.
 * `/customer-commercial`, `/finance/cashflow`). `list` → the generic drill-down
 * page (`/drilldown?dataset=…&…`) backed by a filtered-list endpoint that
 * resolves individual records.
 */
export type DrillTarget =
  | { kind: "route"; path: string }
  | { kind: "list"; path: string; params: Record<string, string> };

export interface DashboardCard {
  label: string;
  value: string | number;
  tone?: "neutral" | "info" | "success" | "warning" | "danger";
  /** Present only when the actor holds the permission to open the target. */
  drillTarget?: DrillTarget;
}

export interface DashboardModule {
  moduleCode: ReportModuleCode;
  moduleName: string;
  cards: DashboardCard[];
  /** Chart-ready rows for the module, present for in-scope modules. */
  chart?: {
    columns: ReportColumn[];
    rows: ReportRow[];
  };
}

export interface ExecutiveDashboard {
  generatedAt: Date;
  modules: DashboardModule[];
}

export interface ReportingInsightRepository {
  listModuleActivations(tenantId: string): Promise<ReportingModuleActivation[]>;

  customerServiceOverview(
    tenantId: string,
    userId: string,
    requiredPermissionCodes: readonly string[],
  ): Promise<StandardReportResult>;
  complaintSummary(
    tenantId: string,
    userId: string,
    requiredPermissionCodes: readonly string[],
  ): Promise<StandardReportResult>;
  surveySummary(
    tenantId: string,
    userId: string,
    requiredPermissionCodes: readonly string[],
  ): Promise<StandardReportResult>;
  serviceOperationsSummary(
    tenantId: string,
    userId: string,
    requiredPermissionCodes: readonly string[],
  ): Promise<StandardReportResult>;
  workforceHeadcount(
    tenantId: string,
    userId: string,
    requiredPermissionCodes: readonly string[],
  ): Promise<StandardReportResult>;
  supplyChainSummary(
    tenantId: string,
    userId: string,
    requiredPermissionCodes: readonly string[],
  ): Promise<StandardReportResult>;
  assetStatusSummary(
    tenantId: string,
    userId: string,
    requiredPermissionCodes: readonly string[],
  ): Promise<StandardReportResult>;
  financeCashflowSummary(
    tenantId: string,
    userId: string,
    requiredPermissionCodes: readonly string[],
  ): Promise<StandardReportResult>;
  hseSummary(
    tenantId: string,
    userId: string,
    requiredPermissionCodes: readonly string[],
  ): Promise<StandardReportResult>;
  projectDeliveryProgress(
    tenantId: string,
    userId: string,
    requiredPermissionCodes: readonly string[],
  ): Promise<StandardReportResult>;
}
