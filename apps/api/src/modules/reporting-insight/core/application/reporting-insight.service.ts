import type { RbacService } from "../../../../application/rbac/rbac.service.js";
import { ForbiddenError, NotFoundError } from "../../../../domain/shared-kernel/errors.js";
import type { ActorContext } from "../../../../domain/shared-kernel/audit-context.js";
import type {
  DashboardCard,
  DashboardModule,
  ExecutiveDashboard,
  ReportDefinition,
  ReportingInsightRepository,
  StandardReportResult,
} from "../domain/reporting-insight.entity.js";

export const REPORT_DEFINITIONS: ReportDefinition[] = [
  {
    code: "customer_operational_overview",
    title: "Customer/service operational overview",
    description: "Customers, projects, sites, and service links within the actor's Customer Data Scope.",
    moduleCode: "customer_commercial",
    requiredPermission: "reporting.read",
  },
  {
    code: "complaint_quality_summary",
    title: "Complaint/service quality summary",
    description: "Complaint categories and open/closed counts within the actor's Customer Data Scope.",
    moduleCode: "customer_complaint",
    requiredPermission: "reporting.read",
  },
  {
    code: "survey_result_summary",
    title: "Survey response/result summary",
    description: "Survey assignment status and score summary, scoped through contextual customer records where present.",
    moduleCode: "survey_assessment",
    requiredPermission: "reporting.read",
  },
  {
    code: "work_order_summary",
    title: "Work order/service operations summary",
    description: "Work order totals by customer within the actor's Customer Data Scope.",
    moduleCode: "service_operations",
    requiredPermission: "reporting.read",
  },
  {
    code: "workforce_headcount_summary",
    title: "Workforce headcount/placement summary",
    description: "Headcount by organization unit and employment status within Organization Unit Data Scope.",
    moduleCode: "workforce",
    requiredPermission: "reporting.read",
  },
  {
    code: "supply_chain_stock_purchasing_summary",
    title: "Supply chain stock/purchasing summary",
    description: "Stock and purchasing aggregates filtered through site/customer and organization scope anchors.",
    moduleCode: "supply_chain",
    requiredPermission: "reporting.read",
  },
  {
    code: "asset_register_status_summary",
    title: "Asset register/status summary",
    description: "Asset status counts within Organization Unit Data Scope.",
    moduleCode: "asset",
    requiredPermission: "reporting.read",
  },
  {
    code: "finance_cashflow_summary",
    title: "Finance cashflow summary",
    description: "Applied income/expense totals within Finance organization scope.",
    moduleCode: "finance",
    requiredPermission: "reporting.read",
  },
  {
    code: "hse_incident_observation_summary",
    title: "HSE incident/observation summary",
    description: "Incident and observation counts within HSE organization scope.",
    moduleCode: "hse",
    requiredPermission: "reporting.read",
  },
  {
    code: "project_delivery_progress_summary",
    title: "Project delivery progress summary",
    description: "Project activities, milestones, and progress scoped through project customer ownership.",
    moduleCode: "project_delivery",
    requiredPermission: "reporting.read",
  },
];

/**
 * Reporting & Operational Insight application service.
 *
 * Authorization is deliberately centralized here: callers need explicit
 * reporting permissions, tenant module activation is checked server-side, and
 * repository methods only receive the actor's tenant/user identity so every
 * aggregate is generated from scope-safe read projections.
 */
export class ReportingInsightService {
  constructor(
    private readonly repo: ReportingInsightRepository,
    private readonly rbac: RbacService,
  ) {}

  async listReports(actor: ActorContext): Promise<ReportDefinition[]> {
    await this.rbac.requirePermission(actor.userId, "reporting.read");
    const active = await this.activeModuleSet(actor.tenantId);
    return REPORT_DEFINITIONS.filter((report) => active.has(report.moduleCode));
  }

  async getReport(actor: ActorContext, code: string): Promise<StandardReportResult> {
    const requiredPermissionCodes = ["reporting.read"];
    await this.rbac.requirePermissionsOnSameAssignment(
      actor.userId,
      requiredPermissionCodes,
    );
    const definition = await this.requireActiveReport(actor.tenantId, code);
    return this.runReport(definition, actor, requiredPermissionCodes);
  }

  async dashboard(actor: ActorContext): Promise<ExecutiveDashboard> {
    const requiredPermissionCodes = ["reporting.read"];
    await this.rbac.requirePermissionsOnSameAssignment(
      actor.userId,
      requiredPermissionCodes,
    );
    const definitions = await this.listReports(actor);
    const reports = await Promise.all(
      definitions.map((definition) =>
        this.runReport(definition, actor, requiredPermissionCodes),
      ),
    );
    return {
      generatedAt: new Date(),
      modules: reports.map((report) => ({
        moduleCode: report.moduleCode,
        moduleName: report.moduleName,
        cards: cardsFromSummary(report.summary),
      } satisfies DashboardModule)),
    };
  }

  async exportCsv(actor: ActorContext, code: string): Promise<{ filename: string; content: string }> {
    const requiredPermissionCodes = ["reporting.read", "reporting.export"];
    await this.rbac.requirePermissionsOnSameAssignment(
      actor.userId,
      requiredPermissionCodes,
    );
    const definition = await this.requireActiveReport(actor.tenantId, code);
    const report = await this.runReport(
      definition,
      actor,
      requiredPermissionCodes,
    );
    return {
      filename: `${report.code}.csv`,
      content: toCsv(report),
    };
  }

  private async requireActiveReport(tenantId: string, code: string): Promise<ReportDefinition> {
    const definition = REPORT_DEFINITIONS.find((report) => report.code === code);
    if (!definition) throw new NotFoundError("Report", code);
    const active = await this.activeModuleSet(tenantId);
    if (!active.has(definition.moduleCode)) {
      throw new ForbiddenError("The originating module for this report is not active for this tenant");
    }
    return definition;
  }

  private async activeModuleSet(tenantId: string): Promise<Set<string>> {
    const activations = await this.repo.listModuleActivations(tenantId);
    return new Set(activations.filter((activation) => activation.isActive).map((activation) => activation.moduleCode));
  }

  private runReport(
    definition: ReportDefinition,
    actor: ActorContext,
    requiredPermissionCodes: readonly string[],
  ): Promise<StandardReportResult> {
    switch (definition.code) {
      case "customer_operational_overview":
        return this.repo.customerServiceOverview(
          actor.tenantId,
          actor.userId,
          requiredPermissionCodes,
        );
      case "complaint_quality_summary":
        return this.repo.complaintSummary(
          actor.tenantId,
          actor.userId,
          requiredPermissionCodes,
        );
      case "survey_result_summary":
        return this.repo.surveySummary(
          actor.tenantId,
          actor.userId,
          requiredPermissionCodes,
        );
      case "work_order_summary":
        return this.repo.serviceOperationsSummary(
          actor.tenantId,
          actor.userId,
          requiredPermissionCodes,
        );
      case "workforce_headcount_summary":
        return this.repo.workforceHeadcount(
          actor.tenantId,
          actor.userId,
          requiredPermissionCodes,
        );
      case "supply_chain_stock_purchasing_summary":
        return this.repo.supplyChainSummary(
          actor.tenantId,
          actor.userId,
          requiredPermissionCodes,
        );
      case "asset_register_status_summary":
        return this.repo.assetStatusSummary(
          actor.tenantId,
          actor.userId,
          requiredPermissionCodes,
        );
      case "finance_cashflow_summary":
        return this.repo.financeCashflowSummary(
          actor.tenantId,
          actor.userId,
          requiredPermissionCodes,
        );
      case "hse_incident_observation_summary":
        return this.repo.hseSummary(
          actor.tenantId,
          actor.userId,
          requiredPermissionCodes,
        );
      case "project_delivery_progress_summary":
        return this.repo.projectDeliveryProgress(
          actor.tenantId,
          actor.userId,
          requiredPermissionCodes,
        );
      default:
        throw new NotFoundError("Report", definition.code);
    }
  }
}

function cardsFromSummary(summary: Record<string, string | number>): DashboardCard[] {
  return Object.entries(summary).map(([key, value]) => ({
    label: humanize(key),
    value,
    tone: typeof value === "number" && value > 0 ? "info" : "neutral",
  }));
}

function toCsv(report: StandardReportResult): string {
  const header = report.columns.map((column) => escapeCsv(column.label)).join(",");
  const rows = report.rows.map((row) =>
    report.columns.map((column) => escapeCsv(row[column.key] ?? "")).join(","),
  );
  return [header, ...rows].join("\n");
}

function escapeCsv(value: string | number | null): string {
  const text = String(value ?? "");
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function humanize(key: string): string {
  return key.replace(/([A-Z])/g, " $1").replace(/^./, (char) => char.toUpperCase());
}
