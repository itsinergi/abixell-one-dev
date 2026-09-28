import type { ActorContext } from "../../domain/shared-kernel/audit-context.js";
import type {
  ComplaintDashboardData,
  ComplaintDashboardRepository,
} from "../../domain/complaint/complaint-dashboard.entity.js";
import type { CustomerService } from "../customer/customer.service.js";
import type { RbacService } from "../rbac/rbac.service.js";

/** Documented KPI semantics (section 6/9):
 *  - "Critical" = the severity code below (matches the seeded/reference
 *    `complaint_severity` catalog; the catalog has no critical flag, so this
 *    is a fixed, documented mapping, not an assumption about arbitrary codes).
 *  - "Open" = the Workflow Instance is still `in_progress` (authoritative
 *    state, never a hardcoded status list). "Closed" = any terminal state.
 *  - Period bounds `complaint.created_at`; "Submitted today" is absolute
 *    (`submitted_at::date = today`) in the database/server timezone
 *    convention (tenant timezone is not modeled — see technical debt). */
export const CRITICAL_SEVERITY_CODE = "critical";
const DEFAULT_PERIOD_DAYS = 30;
const ACTION_CENTER_LIMIT = 25;
const BREAKDOWN_LIMIT = 20;

export interface DashboardRequest {
  from?: string | null;
  to?: string | null;
  customerId?: string | null;
  siteId?: string | null;
  serviceId?: string | null;
  category?: string | null;
  severity?: string | null;
}

export interface DashboardResult extends ComplaintDashboardData {
  period: { from: string; to: string };
  scope: { customerCount: number };
}

/**
 * Checkpoint 1C.5 — Management Dashboard read service. Permission-gated
 * (`complaint.dashboard.read`) and Data-Scope-aware: it resolves the actor's
 * in-scope customers first, then aggregates only within them. Pure read; no
 * mutation, no new persistence (FD-1C-01).
 */
export class ComplaintDashboardService {
  constructor(
    private readonly repo: ComplaintDashboardRepository,
    private readonly customers: CustomerService,
    private readonly rbac: RbacService,
  ) {}

  async getDashboard(actor: ActorContext, request: DashboardRequest): Promise<DashboardResult> {
    await this.rbac.requirePermission(actor, "complaint.dashboard.read");

    const now = new Date();
    const to = request.to ? new Date(request.to) : now;
    const from = request.from
      ? new Date(request.from)
      : new Date(to.getTime() - DEFAULT_PERIOD_DAYS * 24 * 60 * 60 * 1000);

    const customerIds = await this.customers.listScopedCustomerIds(actor);

    if (customerIds.length === 0) {
      return this.emptyResult(from, to);
    }

    const data = await this.repo.getDashboard({
      tenantId: actor.tenantId,
      customerIds,
      filters: {
        from,
        to,
        customerId: request.customerId ?? null,
        siteId: request.siteId ?? null,
        serviceId: request.serviceId ?? null,
        category: request.category ?? null,
        severity: request.severity ?? null,
      },
      criticalSeverityCode: CRITICAL_SEVERITY_CODE,
      actionCenterLimit: ACTION_CENTER_LIMIT,
      breakdownLimit: BREAKDOWN_LIMIT,
    });

    return {
      ...data,
      period: { from: from.toISOString(), to: to.toISOString() },
      scope: { customerCount: customerIds.length },
    };
  }

  private emptyResult(from: Date, to: Date): DashboardResult {
    return {
      summary: {
        total: 0,
        open: 0,
        closed: 0,
        submittedToday: 0,
        critical: 0,
        slaOverdue: 0,
        resolutionRatePercent: null,
        avgResolutionHours: null,
      },
      breakdowns: {
        byCustomer: [],
        bySite: [],
        byService: [],
        byCategory: [],
        bySeverity: [],
        byStatus: [],
      },
      escalation: { escalatedEvents: 0, openEscalatedComplaints: 0 },
      actionCenter: [],
      period: { from: from.toISOString(), to: to.toISOString() },
      scope: { customerCount: 0 },
    };
  }
}
