/**
 * Checkpoint 1C.5 — Management Dashboard read-model (FD-1C-01).
 *
 * A pure READ projection: every figure is aggregated live from the existing
 * authoritative tables (complaints + workflow_instances +
 * workflow_instance_assignments + workflow_steps + customers/sites/services).
 * No denormalized store, no materialized view, no summary table — this is
 * only a set of query shapes the application layer asks for.
 */

export interface DashboardFilters {
  /** Inclusive lower bound / exclusive upper bound on complaint.created_at. */
  from: Date;
  to: Date;
  customerId?: string | null;
  siteId?: string | null;
  serviceId?: string | null;
  category?: string | null;
  severity?: string | null;
}

export interface DashboardSummary {
  total: number;
  open: number;
  closed: number;
  submittedToday: number;
  critical: number;
  slaOverdue: number;
  /** closed / total within the period, as a whole-number percent; null when total = 0. */
  resolutionRatePercent: number | null;
  /** Average completed_at - submitted_at for closed complaints, in hours; null when none. */
  avgResolutionHours: number | null;
}

export interface BreakdownRow {
  key: string;
  label: string;
  count: number;
}

export interface DashboardBreakdowns {
  byCustomer: BreakdownRow[];
  bySite: BreakdownRow[];
  byService: BreakdownRow[];
  byCategory: BreakdownRow[];
  bySeverity: BreakdownRow[];
  byStatus: BreakdownRow[];
}

/** Event-based escalation visibility (section 10 — no invented persistent
 * `isEscalated` business state). */
export interface EscalationSummary {
  escalatedEvents: number;
  openEscalatedComplaints: number;
}

export interface ActionCenterItem {
  complaintId: string;
  complaintNumber: string;
  customerName: string | null;
  severity: string;
  stepCode: string | null;
  stepName: string | null;
  dueAt: Date | null;
  overdue: boolean;
  critical: boolean;
}

export interface ComplaintDashboardData {
  summary: DashboardSummary;
  breakdowns: DashboardBreakdowns;
  escalation: EscalationSummary;
  actionCenter: ActionCenterItem[];
}

export interface ComplaintDashboardQuery {
  tenantId: string;
  /** The customer ids the actor's Data Scope allows — aggregation is
   * constrained to these, so scope is enforced in the query, never in the UI. */
  customerIds: string[];
  filters: DashboardFilters;
  /** Severity code treated as "critical" for KPI purposes (documented
   * semantic — the severity catalog has no critical flag). */
  criticalSeverityCode: string;
  actionCenterLimit: number;
  breakdownLimit: number;
}

export interface ComplaintDashboardRepository {
  getDashboard(query: ComplaintDashboardQuery): Promise<ComplaintDashboardData>;
}
