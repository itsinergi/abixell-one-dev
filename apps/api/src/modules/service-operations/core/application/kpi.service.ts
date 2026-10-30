/**
 * KPI Service — SO-CORE-017 (Reporting & Dashboard).
 *
 * L2 Dashboard: 4 core KPIs (all calculated by PostgreSQL NUMERIC, service wraps labels).
 * 1. Production Achievement = actual qty / planned qty * 100% (catering)
 * 2. Meal Fulfillment = served qty / received qty * 100% (serving)
 * 3. Food Waste % = wasted qty / received qty * 100% (serving)
 * 4. Food Cost per Meal = total cost / served qty (WO + serving)
 */

import type { ActorContext } from "../../../../domain/shared-kernel/audit-context.js";
import { ValidationError } from "../../../../domain/shared-kernel/errors.js";
import type { RbacService } from "../../../../application/rbac/rbac.service.js";
import type { ServiceOperationsRepository } from "../domain/service-operations.entity.js";

export interface KPIValue {
  metric: string;
  value: string; // NUMERIC, calculated by DB
  unit: string;
  dataPoints: number;
}

export interface DashboardL2 {
  period: string;
  productionAchievement: KPIValue;
  mealFulfillment: KPIValue;
  foodWaste: KPIValue;
  foodCostPerMeal: KPIValue;
}

export class KPIService {
  constructor(
    private readonly repo: ServiceOperationsRepository,
    private readonly rbac: RbacService,
  ) {}

  /**
   * L2: Management Dashboard — 4 core KPIs (calculated in PostgreSQL).
   * Requires service_operations.read + internal user.
   */
  async getMgmtDashboard(
    actor: ActorContext,
    tenantId: string,
    period: string, // YYYY-MM or YYYY-MM-DD
  ): Promise<DashboardL2> {
    await this.rbac.requirePermission(actor, "service_operations.read");
    this.validateDatePeriod(period);

    const [periodStart, periodEnd] = this.parsePeriod(period);

    // Fetch aggregates in parallel (all KPIs calculated by DB).
    const [production, serving, cost] = await Promise.all([
      this.repo.getProductionAchievement(tenantId, periodStart, periodEnd),
      this.repo.getServingTotals(tenantId, periodStart, periodEnd),
      this.repo.getFoodCostTotals(tenantId, periodStart, periodEnd),
    ]);

    return {
      period,
      productionAchievement: {
        metric: "Production Achievement",
        value: production.achievementPct,
        unit: "%",
        dataPoints: production.batchCount,
      },
      mealFulfillment: {
        metric: "Meal Fulfillment Rate",
        value: serving.fulfillmentPct,
        unit: "%",
        dataPoints: serving.logCount,
      },
      foodWaste: {
        metric: "Food Waste Percentage",
        value: serving.wastePct,
        unit: "%",
        dataPoints: serving.logCount,
      },
      foodCostPerMeal: {
        metric: "Food Cost per Meal",
        value: cost.costPerMeal,
        unit: "IDR",
        dataPoints: cost.workOrderCount,
      },
    };
  }

  private validateDatePeriod(period: string): void {
    if (!/^\d{4}-\d{2}(-\d{2})?$/.test(period)) {
      throw new ValidationError("Period must be YYYY-MM or YYYY-MM-DD format");
    }
  }

  private parsePeriod(period: string): [string, string] {
    // YYYY-MM or YYYY-MM-DD → [start, end) timestamps
    if (period.length === 7) {
      const [year, month] = period.split("-");
      const nextMonth = (parseInt(month) + 1).toString().padStart(2, "0");
      const nextYear = parseInt(month) === 12 ? String(parseInt(year) + 1) : year;
      return [
        `${period}-01T00:00:00Z`,
        `${nextYear}-${nextMonth}-01T00:00:00Z`,
      ];
    }
    // YYYY-MM-DD
    const nextDay = new Date(`${period}T00:00:00Z`);
    nextDay.setUTCDate(nextDay.getUTCDate() + 1);
    return [
      `${period}T00:00:00Z`,
      nextDay.toISOString().substring(0, 10) + "T00:00:00Z",
    ];
  }
}
