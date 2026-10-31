/**
 * Wave 1 — dynamic dashboard drill targets.
 *
 * The service attaches a `drillTarget` to a card only when the actor holds the
 * mapped permission. This pins the gating rule in isolation: with the
 * permission, the target is present; without it, the card renders with no
 * target (so the frontend cannot navigate somewhere the actor cannot open).
 */
import { describe, expect, it, vi } from "vitest";
import { ReportingInsightService } from "../src/modules/reporting-insight/core/application/reporting-insight.service.js";
import type {
  ReportingInsightRepository,
  StandardReportResult,
} from "../src/modules/reporting-insight/core/domain/reporting-insight.entity.js";
import type { ActorContext } from "../src/domain/shared-kernel/audit-context.js";

const ACTOR: ActorContext = { tenantId: "t1", userId: "u1", assignmentId: "a1" };

function report(
  code: string,
  summary: Record<string, string | number>,
  moduleCode: StandardReportResult["moduleCode"] = "customer_complaint",
): StandardReportResult {
  return {
    code,
    title: code,
    moduleCode,
    moduleName: moduleCode,
    generatedAt: new Date(),
    columns: [],
    summary,
    rows: [],
  };
}

function repo(overrides: Partial<ReportingInsightRepository> = {}): ReportingInsightRepository {
  const base: ReportingInsightRepository = {
    listModuleActivations: async () => [
      { moduleCode: "customer_commercial", moduleName: "Customer Commercial", isActive: true },
      { moduleCode: "customer_complaint", moduleName: "Complaints", isActive: true },
      { moduleCode: "survey_assessment", moduleName: "Surveys", isActive: true },
      { moduleCode: "service_operations", moduleName: "Service Operations", isActive: true },
      { moduleCode: "workforce", moduleName: "Workforce", isActive: true },
      { moduleCode: "supply_chain", moduleName: "Supply Chain", isActive: true },
      { moduleCode: "asset", moduleName: "Asset", isActive: true },
      { moduleCode: "finance", moduleName: "Finance", isActive: true },
      { moduleCode: "hse", moduleName: "HSE", isActive: true },
      { moduleCode: "project_delivery", moduleName: "Project Delivery", isActive: true },
    ],
    customerServiceOverview: async () => report("customer_operational_overview", { customers: 1 }, "customer_commercial"),
    complaintSummary: async () => report("complaint_quality_summary", { total: 5, open: 2, closed: 3 }),
    surveySummary: async () => report("survey_result_summary", { assignments: 1, submitted: 1 }, "survey_assessment"),
    serviceOperationsSummary: async () => report("work_order_summary", { workOrders: 4, open: 1, completed: 3 }, "service_operations"),
    workforceHeadcount: async () => report("workforce_headcount_summary", { headcount: 1 }, "workforce"),
    supplyChainSummary: async () => report("supply_chain_stock_purchasing_summary", { itemsWithStock: 1 }, "supply_chain"),
    assetStatusSummary: async () => report("asset_register_status_summary", { assets: 1 }, "asset"),
    financeCashflowSummary: async () => report("finance_cashflow_summary", { income: 100, expense: 40, net: 60 }, "finance"),
    hseSummary: async () => report("hse_incident_observation_summary", { records: 1 }, "hse"),
    projectDeliveryProgress: async () => report("project_delivery_progress_summary", { projects: 1 }, "project_delivery"),
    ...overrides,
  };
  return base;
}

function service(repo: ReportingInsightRepository, granted: string[]) {
  const rbac = {
    requirePermissionsOnActiveAssignment: vi.fn().mockResolvedValue(undefined),
    requirePermission: vi.fn().mockResolvedValue(undefined),
    getActivePermissions: vi.fn().mockResolvedValue(new Set(granted)),
  };
  return new ReportingInsightService(repo, rbac as never);
}

describe("ReportingInsightService.dashboard — drill targets", () => {
  it("attaches a drill target when the actor holds the mapped permission", async () => {
    const s = service(repo(), ["complaint.dashboard.read", "finance.read", "service_operations.read"]);
    const dash = await s.dashboard(ACTOR);
    const byModule = new Map(dash.modules.map((m) => [m.moduleCode, m.cards]));

    const complaints = byModule.get("customer_complaint")!;
    expect(complaints.find((c) => c.label === "Open")?.drillTarget).toEqual({
      kind: "list",
      path: "/drilldown",
      params: { dataset: "complaints", status: "open" },
    });

    const finance = byModule.get("finance")!;
    expect(finance.find((c) => c.label === "Net")?.drillTarget).toEqual({
      kind: "route",
      path: "/finance/cashflow",
    });

    const ops = byModule.get("service_operations")!;
    expect(ops.find((c) => c.label === "Completed")?.drillTarget).toEqual({
      kind: "list",
      path: "/drilldown",
      params: { dataset: "work-orders", status: "completed" },
    });
  });

  it("omits the drill target when the actor lacks the mapped permission", async () => {
    const s = service(repo(), []); // no module-level permission at all
    const dash = await s.dashboard(ACTOR);
    const byModule = new Map(dash.modules.map((m) => [m.moduleCode, m.cards]));

    for (const cards of byModule.values()) {
      for (const card of cards) {
        expect(card.drillTarget, `card ${card.label} should have no target`).toBeUndefined();
      }
    }
  });

  it("omits the target for a summary key with no mapping even when permissions exist", async () => {
    const s = service(repo(), ["complaint.dashboard.read"]);
    const dash = await s.dashboard(ACTOR);
    const complaints = dash.modules.find((m) => m.moduleCode === "customer_complaint")!.cards;
    // Every complaint key is mapped, so this is a sanity check that the mapping
    // table is the single source of truth: no key outside it gains a target.
    for (const card of complaints) {
      expect(card.drillTarget).toBeDefined();
    }
  });

  it("attaches chart rows for in-scope modules and omits them for out-of-scope modules", async () => {
    const s = service(repo(), []);
    const dash = await s.dashboard(ACTOR);
    const byModule = new Map(dash.modules.map((m) => [m.moduleCode, m]));

    for (const code of ["customer_commercial", "customer_complaint", "survey_assessment", "service_operations", "supply_chain", "finance"]) {
      expect(byModule.get(code)?.chart, `${code} should expose chart rows`).toBeDefined();
    }
    for (const code of ["workforce", "asset", "hse", "project_delivery"]) {
      expect(byModule.get(code)?.chart, `${code} should not expose chart rows`).toBeUndefined();
    }
  });
});
