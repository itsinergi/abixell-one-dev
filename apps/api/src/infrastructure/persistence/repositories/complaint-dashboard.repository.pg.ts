import type { Pool } from "pg";
import type {
  ActionCenterItem,
  BreakdownRow,
  ComplaintDashboardData,
  ComplaintDashboardQuery,
  ComplaintDashboardRepository,
  DashboardBreakdowns,
} from "../../../domain/complaint/complaint-dashboard.entity.js";

/**
 * Checkpoint 1C.5 — PostgreSQL aggregate implementation of the Management
 * Dashboard read-model. All figures are computed live with SQL aggregates
 * (GROUP BY / FILTER) over the existing authoritative tables — no summary
 * table, no materialized view (FD-1C-01). Every query is constrained to the
 * caller's tenant AND the pre-resolved in-scope `customerIds`, so Data Scope
 * is enforced in the query, never in the UI.
 */
export class PgComplaintDashboardRepository implements ComplaintDashboardRepository {
  constructor(private readonly pool: Pool) {}

  async getDashboard(query: ComplaintDashboardQuery): Promise<ComplaintDashboardData> {
    const { tenantId, customerIds, filters, criticalSeverityCode, actionCenterLimit, breakdownLimit } =
      query;

    // Period + scope + entity filters ($1..$9). The summary query adds
    // $10 = critical severity code; breakdowns/escalation use only $1..$9.
    const periodParams = [
      tenantId,
      customerIds,
      filters.from,
      filters.to,
      filters.customerId ?? null,
      filters.siteId ?? null,
      filters.serviceId ?? null,
      filters.category ?? null,
      filters.severity ?? null,
    ];
    const periodParamsWithCritical = [...periodParams, criticalSeverityCode];
    const wherePeriod = `
      c.tenant_id = $1
      AND c.deleted_at IS NULL
      AND c.customer_id = ANY($2::uuid[])
      AND c.created_at >= $3 AND c.created_at < $4
      AND ($5::uuid IS NULL OR c.customer_id = $5)
      AND ($6::uuid IS NULL OR c.site_id = $6)
      AND ($7::uuid IS NULL OR c.service_id = $7)
      AND ($8::text IS NULL OR c.category = $8)
      AND ($9::text IS NULL OR c.severity = $9)`;

    // Scope + entity filters WITHOUT the period ($1..$7). `submittedToday`
    // uses exactly these; the Action Center adds $8 = critical below.
    const scopeParams = [
      tenantId,
      customerIds,
      filters.customerId ?? null,
      filters.siteId ?? null,
      filters.serviceId ?? null,
      filters.category ?? null,
      filters.severity ?? null,
    ];
    const scopeParamsWithCritical = [...scopeParams, criticalSeverityCode];
    const whereScope = `
      c.tenant_id = $1
      AND c.deleted_at IS NULL
      AND c.customer_id = ANY($2::uuid[])
      AND ($3::uuid IS NULL OR c.customer_id = $3)
      AND ($4::uuid IS NULL OR c.site_id = $4)
      AND ($5::uuid IS NULL OR c.service_id = $5)
      AND ($6::text IS NULL OR c.category = $6)
      AND ($7::text IS NULL OR c.severity = $7)`;

    const overdueExists = `EXISTS (
      SELECT 1 FROM workflow_instance_assignments a
       WHERE a.workflow_instance_id = wi.id AND a.status = 'pending'
         AND a.due_at IS NOT NULL AND a.due_at < now())`;

    const summarySql = `
      SELECT
        count(*)::int AS total,
        count(*) FILTER (WHERE wi.status = 'in_progress')::int AS open,
        count(*) FILTER (WHERE wi.status IS NOT NULL AND wi.status <> 'in_progress')::int AS closed,
        count(*) FILTER (WHERE c.severity = $10)::int AS critical,
        count(*) FILTER (WHERE wi.status = 'in_progress' AND ${overdueExists})::int AS sla_overdue,
        avg(EXTRACT(EPOCH FROM (wi.completed_at - c.submitted_at)))
          FILTER (WHERE wi.completed_at IS NOT NULL AND c.submitted_at IS NOT NULL) AS avg_resolution_seconds
      FROM complaints c
      LEFT JOIN workflow_instances wi ON wi.id = c.workflow_instance_id
      WHERE ${wherePeriod}`;

    // "Submitted today" is absolute (not bound to the selected period).
    const submittedTodaySql = `
      SELECT count(*)::int AS submitted_today
      FROM complaints c
      WHERE ${whereScope} AND c.submitted_at IS NOT NULL AND c.submitted_at::date = now()::date`;

    const breakdown = (dimensionKey: string, label: string, join: string) => `
      SELECT ${dimensionKey} AS key, ${label} AS label, count(*)::int AS count
      FROM complaints c
      LEFT JOIN workflow_instances wi ON wi.id = c.workflow_instance_id
      ${join}
      WHERE ${wherePeriod}
      GROUP BY key, label
      ORDER BY count DESC, label ASC
      LIMIT ${breakdownLimit}`;

    const byCustomerSql = breakdown("c.customer_id::text", "cu.name", "JOIN customers cu ON cu.id = c.customer_id");
    const bySiteSql = breakdown(
      "COALESCE(c.site_id::text, 'none')",
      "COALESCE(s.name, 'Unassigned')",
      "LEFT JOIN sites s ON s.id = c.site_id",
    );
    const byServiceSql = breakdown(
      "COALESCE(c.service_id::text, 'none')",
      "COALESCE(sv.name, 'Unassigned')",
      "LEFT JOIN services sv ON sv.id = c.service_id",
    );
    const byCategorySql = breakdown("c.category", "c.category", "");
    const bySeveritySql = breakdown("c.severity", "c.severity", "");
    const byStatusSql = breakdown(
      "COALESCE(st.code, wi.status)",
      "COALESCE(st.name, wi.status)",
      "LEFT JOIN workflow_steps st ON st.id = wi.current_step_id",
    );

    const escalationSql = `
      SELECT
        count(a.id) FILTER (WHERE a.status = 'escalated')::int AS escalated_events,
        count(DISTINCT c.id) FILTER (WHERE a.status = 'escalated' AND wi.status = 'in_progress')::int AS open_escalated
      FROM complaints c
      JOIN workflow_instances wi ON wi.id = c.workflow_instance_id
      LEFT JOIN workflow_instance_assignments a ON a.workflow_instance_id = wi.id
      WHERE ${wherePeriod}`;

    // Action Center: current attention (open + overdue or critical). Not
    // period-bound — a long-standing overdue complaint must not fall off
    // because it was created before the selected window.
    const actionCenterSql = `
      SELECT c.id, c.complaint_number, cu.name AS customer_name, c.severity,
             st.code AS step_code, st.name AS step_name,
             (SELECT min(a.due_at) FROM workflow_instance_assignments a
               WHERE a.workflow_instance_id = wi.id AND a.status = 'pending') AS due_at,
             ${overdueExists} AS overdue,
             (c.severity = $8) AS critical
      FROM complaints c
      JOIN workflow_instances wi ON wi.id = c.workflow_instance_id
      JOIN customers cu ON cu.id = c.customer_id
      LEFT JOIN workflow_steps st ON st.id = wi.current_step_id
      WHERE ${whereScope}
        AND wi.status = 'in_progress'
        AND (c.severity = $8 OR ${overdueExists})
      ORDER BY ${overdueExists} DESC, (c.severity = $8) DESC, due_at ASC NULLS LAST
      LIMIT ${actionCenterLimit}`;

    const [
      summaryR,
      submittedTodayR,
      byCustomerR,
      bySiteR,
      byServiceR,
      byCategoryR,
      bySeverityR,
      byStatusR,
      escalationR,
      actionCenterR,
    ] = await Promise.all([
      this.pool.query(summarySql, periodParamsWithCritical),
      this.pool.query(submittedTodaySql, scopeParams),
      this.pool.query(byCustomerSql, periodParams),
      this.pool.query(bySiteSql, periodParams),
      this.pool.query(byServiceSql, periodParams),
      this.pool.query(byCategorySql, periodParams),
      this.pool.query(bySeveritySql, periodParams),
      this.pool.query(byStatusSql, periodParams),
      this.pool.query(escalationSql, periodParams),
      this.pool.query(actionCenterSql, scopeParamsWithCritical),
    ]);

    const s = summaryR.rows[0];
    const total = s.total as number;
    const closed = s.closed as number;
    const avgSeconds = s.avg_resolution_seconds === null ? null : Number(s.avg_resolution_seconds);

    const toRows = (rows: Array<{ key: string; label: string; count: number }>): BreakdownRow[] =>
      rows.map((r) => ({ key: r.key, label: r.label ?? r.key, count: r.count }));

    const breakdowns: DashboardBreakdowns = {
      byCustomer: toRows(byCustomerR.rows),
      bySite: toRows(bySiteR.rows),
      byService: toRows(byServiceR.rows),
      byCategory: toRows(byCategoryR.rows),
      bySeverity: toRows(bySeverityR.rows),
      byStatus: toRows(byStatusR.rows),
    };

    const actionCenter: ActionCenterItem[] = actionCenterR.rows.map((r) => ({
      complaintId: r.id,
      complaintNumber: r.complaint_number,
      customerName: r.customer_name ?? null,
      severity: r.severity,
      stepCode: r.step_code ?? null,
      stepName: r.step_name ?? null,
      dueAt: r.due_at ?? null,
      overdue: r.overdue,
      critical: r.critical,
    }));

    return {
      summary: {
        total,
        open: s.open,
        closed,
        submittedToday: submittedTodayR.rows[0].submitted_today,
        critical: s.critical,
        slaOverdue: s.sla_overdue,
        resolutionRatePercent: total > 0 ? Math.round((closed / total) * 100) : null,
        avgResolutionHours: avgSeconds === null ? null : Math.round((avgSeconds / 3600) * 10) / 10,
      },
      breakdowns,
      escalation: {
        escalatedEvents: escalationR.rows[0].escalated_events,
        openEscalatedComplaints: escalationR.rows[0].open_escalated,
      },
      actionCenter,
    };
  }
}
