import type { Pool } from "pg";
import type {
  ReportColumn,
  ReportModuleCode,
  ReportRow,
  ReportingInsightRepository,
  ReportingModuleActivation,
  StandardReportResult,
} from "../domain/reporting-insight.entity.js";

interface ScopeProjection {
  tenantWide: boolean;
  customerIds: string[];
  orgUnitIds: string[];
}

type ParamBag = unknown[];

const MODULE_NAMES: Record<ReportModuleCode, string> = {
  customer_commercial: "Customer & Commercial",
  customer_complaint: "Service Quality",
  survey_assessment: "Survey & Assessment",
  service_operations: "Service Operations",
  workforce: "Workforce",
  supply_chain: "Supply Chain",
  asset: "Asset",
  finance: "Finance",
  hse: "HSE",
  project_delivery: "Project Delivery",
};

/**
 * PostgreSQL read projections for Reporting & Operational Insight Core.
 *
 * This repository deliberately does not import business-module internals. It
 * reads stable tables directly and applies the same tenant + Data Scope anchors
 * those modules expose: Customer-context via customers.owner_organization_unit_id
 * and org-context via organization_unit_id. Queries are aggregate/list read-only
 * SELECTs, and export uses the exact result object returned here.
 */
export class PgReportingInsightRepository implements ReportingInsightRepository {
  constructor(private readonly pool: Pool) {}

  async listModuleActivations(tenantId: string): Promise<ReportingModuleActivation[]> {
    const r = await this.pool.query(
      `SELECT m.code AS module_code, m.name AS module_name, COALESCE(tma.is_active, false) AS is_active
         FROM modules m
         LEFT JOIN tenant_module_activations tma ON tma.module_id = m.id AND tma.tenant_id = $1
        WHERE m.code = ANY($2::text[])
        ORDER BY m.code`,
      [tenantId, Object.keys(MODULE_NAMES)],
    );
    return r.rows.map((row) => ({
      moduleCode: row.module_code as ReportModuleCode,
      moduleName: row.module_name,
      isActive: row.is_active,
    }));
  }

  async customerServiceOverview(tenantId: string, userId: string): Promise<StandardReportResult> {
    const scope = await this.scopeProjection(tenantId, userId);
    const params: ParamBag = [tenantId];
    const where = [`c.tenant_id = $1`, `c.deleted_at IS NULL`, this.customerScopeSql(scope, params, "c")].filter(Boolean);
    const r = await this.pool.query(
      `SELECT c.code, c.name, c.status,
              COUNT(DISTINCT p.id)::int AS project_count,
              COUNT(DISTINCT s.id)::int AS site_count,
              COUNT(DISTINCT csl.id)::int AS service_link_count
         FROM customers c
         LEFT JOIN projects p ON p.customer_id = c.id AND p.deleted_at IS NULL
         LEFT JOIN sites s ON s.customer_id = c.id AND s.deleted_at IS NULL
         LEFT JOIN customer_service_links csl ON csl.customer_id = c.id
        WHERE ${where.join(" AND ")}
        GROUP BY c.id
        ORDER BY c.name`,
      params,
    );
    const rows: ReportRow[] = r.rows.map((row) => ({
      label: `${row.code} · ${row.name}`,
      status: row.status,
      projects: row.project_count,
      sites: row.site_count,
      serviceLinks: row.service_link_count,
    }));
    return this.result("customer_operational_overview", "Customer/service operational overview", "customer_commercial", [
      text("label", "Customer"), text("status", "Status"), number("projects", "Projects"),
      number("sites", "Sites"), number("serviceLinks", "Service links"),
    ], { customers: rows.length, projects: sum(rows, "projects"), sites: sum(rows, "sites") }, rows);
  }

  async complaintSummary(tenantId: string, userId: string): Promise<StandardReportResult> {
    const scope = await this.scopeProjection(tenantId, userId);
    const params: ParamBag = [tenantId];
    const where = [`co.tenant_id = $1`, `co.deleted_at IS NULL`, this.customerScopeSql(scope, params, "c")].filter(Boolean);
    const r = await this.pool.query(
      `SELECT COALESCE(co.category, 'uncategorised') AS category,
              COUNT(*)::int AS total,
              COUNT(*) FILTER (WHERE co.closure_date IS NOT NULL)::int AS closed,
              COUNT(*) FILTER (WHERE co.closure_date IS NULL)::int AS open
         FROM complaints co
         JOIN customers c ON c.id = co.customer_id
        WHERE ${where.join(" AND ")}
        GROUP BY COALESCE(co.category, 'uncategorised')
        ORDER BY total DESC, category`,
      params,
    );
    const rows: ReportRow[] = r.rows.map((row) => ({ label: row.category, total: row.total, open: row.open, closed: row.closed }));
    return this.result("complaint_quality_summary", "Complaint/service quality summary", "customer_complaint", [
      text("label", "Category"), number("total", "Total"), number("open", "Open"), number("closed", "Closed"),
    ], { total: sum(rows, "total"), open: sum(rows, "open"), closed: sum(rows, "closed") }, rows);
  }

  async surveySummary(tenantId: string, userId: string): Promise<StandardReportResult> {
    const scope = await this.scopeProjection(tenantId, userId);
    const params: ParamBag = [tenantId];
    const where = [`sa.tenant_id = $1`];
    const surveyScope = this.surveyScopeSql(scope, params);
    if (surveyScope) where.push(surveyScope);
    const r = await this.pool.query(
      `SELECT sa.status, COUNT(*)::int AS total,
              ROUND(AVG(sa.total_score)::numeric, 2)::text AS average_score
         FROM survey_assignments sa
         LEFT JOIN customers direct_customer
           ON sa.context_entity_type = 'customer' AND direct_customer.id = sa.context_entity_id
         LEFT JOIN complaints complaint_context
           ON sa.context_entity_type = 'complaint' AND complaint_context.id = sa.context_entity_id
         LEFT JOIN customers complaint_customer ON complaint_customer.id = complaint_context.customer_id
         LEFT JOIN projects project_context
           ON sa.context_entity_type = 'project' AND project_context.id = sa.context_entity_id
         LEFT JOIN customers project_customer ON project_customer.id = project_context.customer_id
         LEFT JOIN sites site_context
           ON sa.context_entity_type = 'site' AND site_context.id = sa.context_entity_id
         LEFT JOIN customers site_customer ON site_customer.id = site_context.customer_id
        WHERE ${where.join(" AND ")}
        GROUP BY sa.status
        ORDER BY total DESC, sa.status`,
      params,
    );
    const rows: ReportRow[] = r.rows.map((row) => ({ label: row.status, total: row.total, averageScore: row.average_score ?? null }));
    return this.result("survey_result_summary", "Survey response/result summary", "survey_assessment", [
      text("label", "Status"), number("total", "Assignments"), number("averageScore", "Average score"),
    ], { assignments: sum(rows, "total"), submitted: rows.find((r0) => r0.label === "submitted")?.total ?? 0 }, rows);
  }

  async serviceOperationsSummary(tenantId: string, userId: string): Promise<StandardReportResult> {
    const scope = await this.scopeProjection(tenantId, userId);
    const params: ParamBag = [tenantId];
    const where = [`wo.tenant_id = $1`, `wo.deleted_at IS NULL`, this.customerScopeSql(scope, params, "c")].filter(Boolean);
    const r = await this.pool.query(
      `SELECT c.code, c.name,
              COUNT(*)::int AS total,
              COUNT(*) FILTER (WHERE wo.completed_at IS NOT NULL)::int AS completed,
              COUNT(*) FILTER (WHERE wo.completed_at IS NULL)::int AS open
         FROM work_orders wo
         JOIN customers c ON c.id = wo.customer_id
        WHERE ${where.join(" AND ")}
        GROUP BY c.id
        ORDER BY total DESC, c.name`,
      params,
    );
    const rows: ReportRow[] = r.rows.map((row) => ({ label: `${row.code} · ${row.name}`, total: row.total, open: row.open, completed: row.completed }));
    return this.result("work_order_summary", "Work order/service operations summary", "service_operations", [
      text("label", "Customer"), number("total", "Work orders"), number("open", "Open"), number("completed", "Completed"),
    ], { workOrders: sum(rows, "total"), open: sum(rows, "open"), completed: sum(rows, "completed") }, rows);
  }

  async workforceHeadcount(tenantId: string, userId: string): Promise<StandardReportResult> {
    const scope = await this.scopeProjection(tenantId, userId);
    const params: ParamBag = [tenantId];
    const where = [`e.tenant_id = $1`, `e.deleted_at IS NULL`, this.orgScopeSql(scope, params, "e.organization_unit_id", false)].filter(Boolean);
    const r = await this.pool.query(
      `SELECT COALESCE(ou.name, 'Unassigned') AS org_unit, e.employment_status, COUNT(*)::int AS total
         FROM employees e
         LEFT JOIN organization_units ou ON ou.id = e.organization_unit_id
        WHERE ${where.join(" AND ")}
        GROUP BY COALESCE(ou.name, 'Unassigned'), e.employment_status
        ORDER BY org_unit, e.employment_status`,
      params,
    );
    const rows: ReportRow[] = r.rows.map((row) => ({ label: row.org_unit, status: row.employment_status, headcount: row.total }));
    return this.result("workforce_headcount_summary", "Workforce headcount/placement summary", "workforce", [
      text("label", "Organization unit"), text("status", "Status"), number("headcount", "Headcount"),
    ], { headcount: sum(rows, "headcount"), active: rows.filter((r0) => r0.status === "active").reduce((n, r0) => n + toNumber(r0.headcount), 0) }, rows);
  }

  async supplyChainSummary(tenantId: string, userId: string): Promise<StandardReportResult> {
    const scope = await this.scopeProjection(tenantId, userId);
    const params: ParamBag = [tenantId];
    const stockScope = this.customerScopeSql(scope, params, "c");
    const where = [`sb.tenant_id = $1`, stockScope ? `(sb.site_id IS NULL OR ${stockScope})` : ""].filter(Boolean);
    const r = await this.pool.query(
      `SELECT i.code, i.name,
              COALESCE(SUM(sb.quantity), 0)::text AS quantity,
              COUNT(DISTINCT sb.site_id)::int AS site_count
         FROM stock_balances sb
         JOIN items i ON i.id = sb.item_id
         LEFT JOIN sites s ON s.id = sb.site_id
         LEFT JOIN customers c ON c.id = s.customer_id
        WHERE ${where.join(" AND ")}
        GROUP BY i.id
        ORDER BY i.name`,
      params,
    );
    const prCount = await this.orgScopedCount(tenantId, userId, "purchase_requests", "organization_unit_id", false, "deleted_at IS NULL");
    const poCount = await this.customerScopedPurchaseOrderCount(tenantId, scope);
    const rows: ReportRow[] = r.rows.map((row) => ({ label: `${row.code} · ${row.name}`, quantity: row.quantity, sites: row.site_count }));
    return this.result("supply_chain_stock_purchasing_summary", "Supply chain stock/purchasing summary", "supply_chain", [
      text("label", "Item"), number("quantity", "Stock quantity"), number("sites", "Sites"),
    ], { itemsWithStock: rows.length, purchaseRequests: prCount, purchaseOrders: poCount }, rows);
  }

  async assetStatusSummary(tenantId: string, userId: string): Promise<StandardReportResult> {
    const scope = await this.scopeProjection(tenantId, userId);
    const params: ParamBag = [tenantId];
    const where = [`tenant_id = $1`, this.orgScopeSql(scope, params, "organization_unit_id", true)].filter(Boolean);
    const r = await this.pool.query(
      `SELECT status, COUNT(*)::int AS total
         FROM assets
        WHERE ${where.join(" AND ")}
        GROUP BY status
        ORDER BY total DESC, status`,
      params,
    );
    const rows: ReportRow[] = r.rows.map((row) => ({ label: row.status, total: row.total }));
    return this.result("asset_register_status_summary", "Asset register/status summary", "asset", [
      text("label", "Status"), number("total", "Assets"),
    ], { assets: sum(rows, "total"), inUse: rows.find((r0) => r0.label === "in_use")?.total ?? 0 }, rows);
  }

  async financeCashflowSummary(tenantId: string, userId: string): Promise<StandardReportResult> {
    const scope = await this.scopeProjection(tenantId, userId);
    const params: ParamBag = [tenantId];
    const where = [`tenant_id = $1`, `applied_at IS NOT NULL`, this.orgScopeSql(scope, params, "organization_unit_id", true)].filter(Boolean);
    const r = await this.pool.query(
      `SELECT direction, category_code,
              COALESCE(SUM(amount), 0)::text AS amount
         FROM finance_transactions
        WHERE ${where.join(" AND ")}
        GROUP BY direction, category_code
        ORDER BY direction, category_code`,
      params,
    );
    const rows: ReportRow[] = r.rows.map((row) => ({ label: row.category_code, direction: row.direction, amount: row.amount }));
    const incomeCents = moneySumCents(rows.filter((r0) => r0.direction === "income"), "amount");
    const expenseCents = moneySumCents(rows.filter((r0) => r0.direction === "expense"), "amount");
    return this.result("finance_cashflow_summary", "Finance cashflow summary", "finance", [
      text("label", "Category"), text("direction", "Direction"), money("amount", "Applied amount"),
    ], { income: formatCents(incomeCents), expense: formatCents(expenseCents), net: formatCents(incomeCents - expenseCents) }, rows);
  }

  async hseSummary(tenantId: string, userId: string): Promise<StandardReportResult> {
    const scope = await this.scopeProjection(tenantId, userId);
    const params: ParamBag = [tenantId];
    const where = [`tenant_id = $1`, this.orgScopeSql(scope, params, "organization_unit_id", false)].filter(Boolean);
    const r = await this.pool.query(
      `SELECT record_type,
              COUNT(*)::int AS total,
              COUNT(*) FILTER (WHERE severity_code IS NOT NULL)::int AS classified
         FROM hse_records
        WHERE ${where.join(" AND ")}
        GROUP BY record_type
        ORDER BY record_type`,
      params,
    );
    const rows: ReportRow[] = r.rows.map((row) => ({ label: row.record_type, total: row.total, classified: row.classified }));
    return this.result("hse_incident_observation_summary", "HSE incident/observation summary", "hse", [
      text("label", "Type"), number("total", "Records"), number("classified", "Classified"),
    ], { records: sum(rows, "total"), incidents: rows.find((r0) => r0.label === "incident")?.total ?? 0, observations: rows.find((r0) => r0.label === "observation")?.total ?? 0 }, rows);
  }

  async projectDeliveryProgress(tenantId: string, userId: string): Promise<StandardReportResult> {
    const scope = await this.scopeProjection(tenantId, userId);
    const params: ParamBag = [tenantId];
    const where = [`p.tenant_id = $1`, `p.deleted_at IS NULL`, this.customerScopeSql(scope, params, "c")].filter(Boolean);
    const r = await this.pool.query(
      `SELECT p.code, p.name,
              COALESCE(activity_stats.activities, 0)::int AS activities,
              COALESCE(activity_stats.completed, 0)::int AS completed,
              COALESCE(activity_stats.progress_percent, 0)::int AS progress_percent,
              COALESCE(milestone_stats.milestones, 0)::int AS milestones,
              COALESCE(milestone_stats.achieved_milestones, 0)::int AS achieved_milestones
         FROM projects p
         JOIN customers c ON c.id = p.customer_id
         LEFT JOIN LATERAL (
           SELECT COUNT(*)::int AS activities,
                  COUNT(*) FILTER (WHERE status = 'completed')::int AS completed,
                  COALESCE(ROUND(AVG(progress_percent)), 0)::int AS progress_percent
             FROM project_delivery_activities
            WHERE project_id = p.id
         ) activity_stats ON true
         LEFT JOIN LATERAL (
           SELECT COUNT(*)::int AS milestones,
                  COUNT(*) FILTER (WHERE status = 'achieved')::int AS achieved_milestones
             FROM project_delivery_milestones
            WHERE project_id = p.id
         ) milestone_stats ON true
        WHERE ${where.join(" AND ")}
        ORDER BY p.name`,
      params,
    );
    const rows: ReportRow[] = r.rows.map((row) => ({
      label: `${row.code} · ${row.name}`,
      activities: row.activities,
      completed: row.completed,
      progressPercent: row.progress_percent,
      milestones: row.milestones,
      achievedMilestones: row.achieved_milestones,
    }));
    const avgProgress = rows.length === 0 ? 0 : Math.round(sum(rows, "progressPercent") / rows.length);
    return this.result("project_delivery_progress_summary", "Project delivery progress summary", "project_delivery", [
      text("label", "Project"), number("activities", "Activities"), number("completed", "Completed"),
      number("progressPercent", "Progress %"), number("milestones", "Milestones"), number("achievedMilestones", "Achieved milestones"),
    ], { projects: rows.length, averageProgressPercent: avgProgress, activities: sum(rows, "activities") }, rows);
  }

  private async scopeProjection(tenantId: string, userId: string): Promise<ScopeProjection> {
    const r = await this.pool.query(
      `WITH RECURSIVE assigned_orgs(id) AS (
          SELECT ura.scope_organization_unit_id
            FROM user_role_assignments ura
            JOIN roles ro ON ro.id = ura.role_id
           WHERE ura.user_id = $2 AND ro.tenant_id = $1 AND ura.scope_type = 'organization_unit'
             AND ura.scope_organization_unit_id IS NOT NULL
          UNION
          SELECT ou.id
            FROM organization_units ou
            JOIN assigned_orgs ao ON ou.parent_id = ao.id
           WHERE ou.tenant_id = $1
        )
        SELECT
          EXISTS (
            SELECT 1 FROM user_role_assignments ura JOIN roles ro ON ro.id = ura.role_id
             WHERE ura.user_id = $2 AND ro.tenant_id = $1 AND ura.scope_type = 'tenant'
          ) AS tenant_wide,
          COALESCE(ARRAY(
            SELECT DISTINCT ura.scope_customer_id
              FROM user_role_assignments ura JOIN roles ro ON ro.id = ura.role_id
             WHERE ura.user_id = $2 AND ro.tenant_id = $1 AND ura.scope_type = 'customer'
               AND ura.scope_customer_id IS NOT NULL
          ), '{}'::uuid[]) AS customer_ids,
          COALESCE(ARRAY(SELECT DISTINCT id FROM assigned_orgs WHERE id IS NOT NULL), '{}'::uuid[]) AS org_unit_ids`,
      [tenantId, userId],
    );
    const row = r.rows[0];
    return { tenantWide: row.tenant_wide, customerIds: row.customer_ids ?? [], orgUnitIds: row.org_unit_ids ?? [] };
  }

  private customerScopeSql(scope: ScopeProjection, params: ParamBag, customerAlias: string): string {
    if (scope.tenantWide) return "";
    params.push(scope.customerIds);
    const customerIdx = params.length;
    params.push(scope.orgUnitIds);
    const orgIdx = params.length;
    return `(${customerAlias}.id = ANY($${customerIdx}::uuid[]) OR ${customerAlias}.owner_organization_unit_id = ANY($${orgIdx}::uuid[]))`;
  }

  private orgScopeSql(scope: ScopeProjection, params: ParamBag, column: string, includeNullForScopedActors: boolean): string {
    if (scope.tenantWide) return "";
    params.push(scope.orgUnitIds);
    const idx = params.length;
    return includeNullForScopedActors ? `(${column} IS NULL OR ${column} = ANY($${idx}::uuid[]))` : `${column} = ANY($${idx}::uuid[])`;
  }

  private surveyScopeSql(scope: ScopeProjection, params: ParamBag): string {
    if (scope.tenantWide) return "";
    params.push(scope.customerIds);
    const customerIdx = params.length;
    params.push(scope.orgUnitIds);
    const orgIdx = params.length;
    return `(
      direct_customer.id = ANY($${customerIdx}::uuid[])
      OR direct_customer.owner_organization_unit_id = ANY($${orgIdx}::uuid[])
      OR complaint_customer.id = ANY($${customerIdx}::uuid[])
      OR complaint_customer.owner_organization_unit_id = ANY($${orgIdx}::uuid[])
      OR project_customer.id = ANY($${customerIdx}::uuid[])
      OR project_customer.owner_organization_unit_id = ANY($${orgIdx}::uuid[])
      OR site_customer.id = ANY($${customerIdx}::uuid[])
      OR site_customer.owner_organization_unit_id = ANY($${orgIdx}::uuid[])
    )`;
  }

  private async orgScopedCount(
    tenantId: string,
    userId: string,
    table: string,
    orgColumn: string,
    includeNull: boolean,
    extraCondition: string,
  ): Promise<number> {
    const scope = await this.scopeProjection(tenantId, userId);
    const params: ParamBag = [tenantId];
    const where = [`tenant_id = $1`, extraCondition, this.orgScopeSql(scope, params, orgColumn, includeNull)].filter(Boolean);
    const r = await this.pool.query(`SELECT COUNT(*)::int AS total FROM ${table} WHERE ${where.join(" AND ")}`, params);
    return r.rows[0].total;
  }

  private async customerScopedPurchaseOrderCount(tenantId: string, scope: ScopeProjection): Promise<number> {
    const params: ParamBag = [tenantId];
    const where = [`po.tenant_id = $1`, `po.deleted_at IS NULL`];
    const customerScope = this.customerScopeSql(scope, params, "c");
    if (customerScope) where.push(`(po.site_id IS NULL OR ${customerScope})`);
    const r = await this.pool.query(
      `SELECT COUNT(DISTINCT po.id)::int AS total
         FROM purchase_orders po
         LEFT JOIN sites s ON s.id = po.site_id
         LEFT JOIN customers c ON c.id = s.customer_id
        WHERE ${where.join(" AND ")}`,
      params,
    );
    return r.rows[0].total;
  }

  private result(
    code: string,
    title: string,
    moduleCode: ReportModuleCode,
    columns: ReportColumn[],
    summary: Record<string, string | number>,
    rows: ReportRow[],
  ): StandardReportResult {
    return {
      code,
      title,
      moduleCode,
      moduleName: MODULE_NAMES[moduleCode],
      generatedAt: new Date(),
      columns,
      summary,
      rows,
    };
  }
}

function text(key: string, label: string): ReportColumn { return { key, label, type: "text" }; }
function number(key: string, label: string): ReportColumn { return { key, label, type: "number" }; }
function money(key: string, label: string): ReportColumn { return { key, label, type: "money" }; }

function toNumber(value: string | number | null | undefined): number {
  if (typeof value === "number") return value;
  if (typeof value === "string") return Number(value) || 0;
  return 0;
}

function sum(rows: ReportRow[], key: string): number {
  return rows.reduce((total, row) => total + toNumber(row[key]), 0);
}

function moneySumCents(rows: ReportRow[], key: string): number {
  return rows.reduce((total, row) => total + toCents(row[key]), 0);
}

function toCents(value: string | number | null | undefined): number {
  const text = String(value ?? "0");
  const [whole, fraction = ""] = text.split(".");
  const cents = `${fraction}00`.slice(0, 2);
  return Number(whole) * 100 + Number(cents) * (whole.startsWith("-") ? -1 : 1);
}

function formatCents(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const absolute = Math.abs(cents);
  return `${sign}${Math.floor(absolute / 100)}.${String(absolute % 100).padStart(2, "0")}`;
}
