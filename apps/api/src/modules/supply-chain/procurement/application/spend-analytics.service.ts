/**
 * Spend Analytics Service (PROC-005).
 *
 * Provides multidimensional spend analysis snapshots across suppliers,
 * item categories, and organizational units, computing period-based metrics
 * (monthly, quarterly, yearly).
 */
import type { ActorContext } from "../../../../domain/shared-kernel/audit-context.js";
import type {
  ScmSpendAnalyticsPeriodType,
  ScmSpendAnalyticsSnapshot,
  ScmSpendAnalyticsSnapshotFilter,
} from "../../advanced/domain/supply-chain-advanced.entity.js";
import type { SupplyChainAdvancedService } from "../../advanced/application/supply-chain-advanced.service.js";

export class SpendAnalyticsService {
  constructor(private readonly delegate: SupplyChainAdvancedService) {}

  async computeSpendSnapshot(
    actor: ActorContext,
    input: {
      periodType: ScmSpendAnalyticsPeriodType;
      periodStart: string;
      periodEnd: string;
      organizationUnitId?: string;
    },
  ): Promise<ScmSpendAnalyticsSnapshot> {
    return this.delegate.computeSpendSnapshot(actor, input);
  }

  async getSpendSnapshot(
    actor: ActorContext,
    snapshotId: string,
  ): Promise<ScmSpendAnalyticsSnapshot> {
    return this.delegate.getSpendSnapshot(actor, snapshotId);
  }

  async listSpendSnapshots(
    actor: ActorContext,
    filter: ScmSpendAnalyticsSnapshotFilter = {},
  ): Promise<ScmSpendAnalyticsSnapshot[]> {
    return this.delegate.listSpendSnapshots(actor, filter);
  }
}
