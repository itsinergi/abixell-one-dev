import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../../src/app.js";
import { pool } from "../../src/infrastructure/persistence/db.js";
import { PgReportingInsightRepository } from "../../src/modules/reporting-insight/core/infrastructure/reporting-insight.repository.pg.js";
import { activateAllModules, authHeader, bootstrapTenant, createReadOnlyRole, login, provisionFirstAdmin } from "./helpers.js";

const stamp = Date.now();
const TENANT = `test-p9-${stamp}`;
const OTHER = `test-p9o-${stamp}`;

async function post(url: string, token: string, payload: unknown) {
  return app.inject({ method: "POST", url, headers: authHeader(token), payload });
}

async function put(url: string, token: string, payload: unknown) {
  return app.inject({ method: "PUT", url, headers: authHeader(token), payload });
}

async function get(url: string, token: string) {
  return app.inject({ method: "GET", url, headers: authHeader(token) });
}

const app = buildApp();
const reportingRepository = new PgReportingInsightRepository(pool);

describe("Phase 9 — Reporting & Operational Insight Core", () => {
  let tenantId: string;
  let otherTenantId: string;
  let adminToken: string;
  let reportingToken: string;
  let exportToken: string;
  let noReportingToken: string;
  let scopedToken: string;
  let splitExportToken: string;
  let otherAdminToken: string;
  let legalEntityId: string;
  let unitNorthId: string;
  let unitSouthId: string;
  let northCustomerId: string;
  let southCustomerId: string;
  let northProjectId: string;
  let southProjectId: string;

  beforeAll(async () => {
    const t = await bootstrapTenant(app, TENANT, "Tenant P9");
    await activateAllModules(t.id);
    tenantId = t.id;
    await provisionFirstAdmin({ tenantId, email: "admin@p9.local", password: "Admin12345!" });
    adminToken = (await login(app, TENANT, "admin@p9.local", "Admin12345!")).body.accessToken;

    const legal = await post("/legal-entities", adminToken, { code: "LE-P9", name: "Legal Entity P9" });
    legalEntityId = legal.json().id;
    unitNorthId = (
      await post("/organization-units", adminToken, { legalEntityId, code: "N-P9", name: "North P9" })
    ).json().id;
    unitSouthId = (
      await post("/organization-units", adminToken, { legalEntityId, code: "S-P9", name: "South P9" })
    ).json().id;

    northCustomerId = (
      await post("/customers", adminToken, {
        code: "CUST-N-P9",
        name: "North Customer P9",
        ownerOrganizationUnitId: unitNorthId,
      })
    ).json().id;
    southCustomerId = (
      await post("/customers", adminToken, {
        code: "CUST-S-P9",
        name: "South Customer P9",
        ownerOrganizationUnitId: unitSouthId,
      })
    ).json().id;
    northProjectId = (
      await post("/projects", adminToken, { customerId: northCustomerId, code: "PRJ-N-P9", name: "North Project P9" })
    ).json().id;
    southProjectId = (
      await post("/projects", adminToken, { customerId: southCustomerId, code: "PRJ-S-P9", name: "South Project P9" })
    ).json().id;

    await createReadOnlyRole(tenantId, "RPT_VIEW_P9", ["reporting.read"]);
    await createReadOnlyRole(tenantId, "RPT_EXPORT_P9", ["reporting.read", "reporting.export"]);
    await createReadOnlyRole(tenantId, "RPT_EXPORT_ONLY_P9", ["reporting.export"]);
    await createReadOnlyRole(tenantId, "NO_RPT_P9", ["finance.read"]);

    await post("/admin/users", adminToken, { email: "reporting@p9.local", fullName: "Reporting Reader P9", password: "Passw0rd12345!", pairs: [{ roleCode: "RPT_VIEW_P9", scopeType: "tenant" as const }] });
    await post("/admin/users", adminToken, { email: "export@p9.local", fullName: "Reporting Export P9", password: "Passw0rd12345!", pairs: [{ roleCode: "RPT_EXPORT_P9", scopeType: "tenant" as const }] });
    await post("/admin/users", adminToken, { email: "norpt@p9.local", fullName: "No Reporting P9", password: "Passw0rd12345!", pairs: [{ roleCode: "NO_RPT_P9", scopeType: "tenant" as const }] });
    await post("/admin/users", adminToken, { email: "north@p9.local", fullName: "North Scoped P9", password: "Passw0rd12345!", pairs: [{ roleCode: "RPT_EXPORT_P9", scopeType: "organization_unit" as const, scopeOrganizationUnitId: unitNorthId }] });
    await post("/admin/users", adminToken, { email: "split-export@p9.local", fullName: "Split Reporting Export P9", password: "Passw0rd12345!", pairs: [{ roleCode: "RPT_VIEW_P9", scopeType: "organization_unit" as const, scopeOrganizationUnitId: unitNorthId }] });
    const splitUser = await pool.query(
      `SELECT id FROM users WHERE tenant_id = $1 AND email = 'split-export@p9.local'`,
      [tenantId],
    );
    const splitRoles = await pool.query(
      `SELECT id, code
         FROM roles
        WHERE tenant_id = $1
          AND code = ANY($2::text[])`,
      [tenantId, ["NO_RPT_P9", "RPT_EXPORT_ONLY_P9"]],
    );
    const splitRoleIds = new Map(
      splitRoles.rows.map((row) => [row.code as string, row.id as string]),
    );
    await pool.query(
      `INSERT INTO user_role_assignments (user_id, role_id, scope_type)
       VALUES ($1, $2, 'tenant'), ($1, $3, 'tenant')`,
      [
        splitUser.rows[0].id,
        splitRoleIds.get("NO_RPT_P9"),
        splitRoleIds.get("RPT_EXPORT_ONLY_P9"),
      ],
    );

    const tok = async (email: string) => (await login(app, TENANT, email, "Passw0rd12345!")).body.accessToken;
    reportingToken = await tok("reporting@p9.local");
    exportToken = await tok("export@p9.local");
    noReportingToken = await tok("norpt@p9.local");
    scopedToken = await tok("north@p9.local");
    splitExportToken = await tok("split-export@p9.local");

    // Epic 1 (§4.1 B): the session's active Role is what authorizes, and the
    // default pick is the first Role by name — here NO_RPT_P9 ("No Reporting
    // P9"). The split-export test needs the session pinned to the other
    // assignment, exactly the way a user would via the role picker.
    const splitAssignment = await pool.query(
      `SELECT aura.id
         FROM authorization_effective_user_role_assignments aura
         JOIN roles r ON r.id = aura.role_id
        WHERE aura.user_id = $1
          AND r.code = 'RPT_VIEW_P9'`,
      [splitUser.rows[0].id],
    );
    const switched = await post("/auth/switch-role", splitExportToken, {
      assignmentId: splitAssignment.rows[0].id,
    });
    expect(switched.statusCode).toBe(200);

    const modules = [
      "customer_commercial",
      "customer_complaint",
      "survey_assessment",
      "service_operations",
      "workforce",
      "supply_chain",
      "asset",
      "finance",
      "hse",
      "project_delivery",
    ];
    for (const code of modules) {
      const activation = await put(`/config/modules/${code}`, adminToken, { isActive: true });
      expect(activation.statusCode).toBe(200);
    }

    await seedOperationalData();

    const ot = await bootstrapTenant(app, OTHER, "Tenant P9 Other");

    await activateAllModules(ot.id);
    otherTenantId = ot.id;
    await provisionFirstAdmin({ tenantId: otherTenantId, email: "admin@p9other.local", password: "Admin12345!" });
    otherAdminToken = (await login(app, OTHER, "admin@p9other.local", "Admin12345!")).body.accessToken;
    const otherFinanceActivation = await put("/config/modules/finance", otherAdminToken, { isActive: true });
    expect(otherFinanceActivation.statusCode).toBe(200);
    const otherUserId = (await pool.query(`SELECT id FROM users WHERE tenant_id = $1 LIMIT 1`, [otherTenantId])).rows[0].id;
    const otherAccountId = (
      await pool.query(
        `INSERT INTO finance_accounts (tenant_id, code, name, account_type, currency)
         VALUES ($1, 'CASH-RPT-O9', 'Other Reporting Cash P9', 'cash', 'IDR') RETURNING id`,
        [otherTenantId],
      )
    ).rows[0].id;
    await pool.query(
      `INSERT INTO finance_transactions (
         tenant_id, transaction_number, direction, amount, currency, transaction_date,
         account_id, category_code, organization_unit_id, recorded_by_user_id, applied_at
       )
       VALUES ($1, 'OTHER-RPT-1', 'income', 9999.00, 'IDR', '2026-08-01', $2, 'sales', NULL, $3, now())`,
      [otherTenantId, otherAccountId, otherUserId],
    );
  });

  afterAll(async () => {
    await app.close();
    await pool.end();
  });

  async function seedOperationalData() {
    const users = await pool.query(`SELECT id FROM users WHERE tenant_id = $1 ORDER BY created_at LIMIT 1`, [tenantId]);
    const userId = users.rows[0].id;

    await pool.query(
      `INSERT INTO complaints (tenant_id, complaint_number, customer_id, category, description, priority, severity, submitted_by_user_id, submitted_at)
       VALUES ($1, 'CMP-N-P9', $2, 'quality', 'North complaint', 'normal', 'medium', $3, now()),
              ($1, 'CMP-S-P9', $4, 'safety', 'South complaint', 'normal', 'high', $3, now())`,
      [tenantId, northCustomerId, userId, southCustomerId],
    );

    await pool.query(
      `INSERT INTO survey_definitions (tenant_id, code, name, created_by) VALUES ($1, 'P9-SURVEY', 'P9 Survey', $2) RETURNING id`,
      [tenantId, userId],
    );
    const version = await pool.query(
      `INSERT INTO survey_versions (survey_definition_id, version_number, status, is_current)
       SELECT id, 1, 'published', true FROM survey_definitions WHERE tenant_id = $1 AND code = 'P9-SURVEY' RETURNING id`,
      [tenantId],
    );
    await pool.query(
      `INSERT INTO survey_assignments (tenant_id, survey_version_id, respondent_type, context_entity_type, context_entity_id, status, total_score)
       VALUES ($1, $2, 'internal_user', 'customer', $3, 'submitted', 80),
              ($1, $2, 'internal_user', 'customer', $4, 'pending', NULL)`,
      [tenantId, version.rows[0].id, northCustomerId, southCustomerId],
    );

    await pool.query(
      `INSERT INTO service_definitions (tenant_id, code, name, created_by) VALUES ($1, 'SVC-P9', 'Service P9', $2) RETURNING id`,
      [tenantId, userId],
    );
    const serviceId = (await pool.query(`SELECT id FROM service_definitions WHERE tenant_id = $1 AND code = 'SVC-P9'`, [tenantId])).rows[0].id;
    await pool.query(
      `INSERT INTO work_orders (tenant_id, work_order_number, customer_id, service_definition_id, title)
       VALUES ($1, 'WO-N-P9', $2, $3, 'North work'),
              ($1, 'WO-S-P9', $4, $3, 'South work')`,
      [tenantId, northCustomerId, serviceId, southCustomerId],
    );

    await pool.query(
      `INSERT INTO employees (tenant_id, employee_number, full_name, organization_unit_id)
       VALUES ($1, 'EMP-N-P9', 'North Employee P9', $2),
              ($1, 'EMP-S-P9', 'South Employee P9', $3)`,
      [tenantId, unitNorthId, unitSouthId],
    );

    await pool.query(
      `INSERT INTO items (tenant_id, code, name, unit_of_measure, created_by)
       VALUES ($1, 'ITEM-N-P9', 'North Item P9', 'pcs', $2),
              ($1, 'ITEM-S-P9', 'South Item P9', 'pcs', $2)`,
      [tenantId, userId],
    );
    const northItem = (await pool.query(`SELECT id FROM items WHERE tenant_id = $1 AND code = 'ITEM-N-P9'`, [tenantId])).rows[0].id;
    const southItem = (await pool.query(`SELECT id FROM items WHERE tenant_id = $1 AND code = 'ITEM-S-P9'`, [tenantId])).rows[0].id;
    const northSite = (await post("/sites", adminToken, { customerId: northCustomerId, projectId: northProjectId, code: "SITE-N-P9", name: "North Site P9" })).json().id;
    const southSite = (await post("/sites", adminToken, { customerId: southCustomerId, projectId: southProjectId, code: "SITE-S-P9", name: "South Site P9" })).json().id;
    await pool.query(
      `INSERT INTO stock_balances (tenant_id, item_id, site_id, quantity)
       VALUES ($1, $2, $3, 7), ($1, $4, $5, 11)`,
      [tenantId, northItem, northSite, southItem, southSite],
    );

    await pool.query(
      `INSERT INTO assets (tenant_id, asset_number, name, status, organization_unit_id)
       VALUES ($1, 'AST-N-P9', 'North Asset P9', 'in_use', $2),
              ($1, 'AST-S-P9', 'South Asset P9', 'idle', $3)`,
      [tenantId, unitNorthId, unitSouthId],
    );

    const accountId = (
      await pool.query(
        `INSERT INTO finance_accounts (tenant_id, code, name, account_type, currency, organization_unit_id)
         VALUES ($1, 'CASH-RPT-P9', 'Reporting Cash P9', 'cash', 'IDR', $2) RETURNING id`,
        [tenantId, unitNorthId],
      )
    ).rows[0].id;
    await pool.query(
      `INSERT INTO finance_transactions (
         tenant_id, transaction_number, direction, amount, currency, transaction_date,
         account_id, category_code, organization_unit_id, recorded_by_user_id, applied_at
       )
       VALUES ($1, 'FIN-N-P9', 'income', 100.25, 'IDR', '2026-08-01', $2, 'sales', $3, $5, now()),
              ($1, 'FIN-S-P9', 'income', 200.75, 'IDR', '2026-08-01', $2, 'sales', $4, $5, now())`,
      [tenantId, accountId, unitNorthId, unitSouthId, userId],
    );

    await pool.query(
      `INSERT INTO hse_records (tenant_id, record_number, record_type, occurred_at, title, organization_unit_id, reported_by_user_id)
       VALUES ($1, 'HSE-N-P9', 'incident', now(), 'North incident', $2, $4),
              ($1, 'HSE-S-P9', 'observation', now(), 'South observation', $3, $4),
              ($1, 'HSE-T-P9', 'incident', now(), 'Tenant safety record', NULL, $4)`,
      [tenantId, unitNorthId, unitSouthId, userId],
    );

    await pool.query(
      `INSERT INTO project_delivery_activities (tenant_id, project_id, title, pic_user_id, status, progress_percent)
       VALUES ($1, $2, 'North Activity', $4, 'completed', 100),
              ($1, $3, 'South Activity', $4, 'in_progress', 40)`,
      [tenantId, northProjectId, southProjectId, userId],
    );
  }

  it("gates reports and export with explicit reporting permissions", async () => {
    expect((await get("/reporting/reports", reportingToken)).statusCode).toBe(200);
    expect((await get("/reporting/dashboard", noReportingToken)).statusCode).toBe(403);

    const noExport = await get("/reporting/reports/finance_cashflow_summary/export", reportingToken);
    expect(noExport.statusCode).toBe(403);

    const exported = await get("/reporting/reports/finance_cashflow_summary/export", exportToken);
    expect(exported.statusCode).toBe(200);
    expect(exported.headers["content-type"]).toContain("text/csv");
  });

  it("filters reports by tenant module activation", async () => {
    const disabled = await put("/config/modules/hse", adminToken, { isActive: false });
    expect(disabled.statusCode).toBe(200);
    const reports = await get("/reporting/reports", reportingToken);
    expect(reports.statusCode).toBe(200);
    expect(reports.json().map((report: { code: string }) => report.code)).not.toContain("hse_incident_observation_summary");
    expect((await get("/reporting/reports/hse_incident_observation_summary", reportingToken)).statusCode).toBe(403);
    const enabled = await put("/config/modules/hse", adminToken, { isActive: true });
    expect(enabled.statusCode).toBe(200);
  });

  it("binds reporting scope and multi-permission export authority to the same assignment", async () => {
    const detail = await get(
      "/reporting/reports/finance_cashflow_summary",
      splitExportToken,
    );
    expect(detail.statusCode).toBe(200);
    expect(detail.json().summary).toMatchObject({
      income: "100.25",
      expense: "0.00",
      net: "100.25",
    });
    expect(detail.json().rows).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ amount: "200.75" })]),
    );

    const exported = await get(
      "/reporting/reports/finance_cashflow_summary/export",
      splitExportToken,
    );
    expect(exported.statusCode).toBe(403);
  });

  it("enforces Data Scope on report detail rows and aggregate summaries", async () => {
    const scopedFinance = await get("/reporting/reports/finance_cashflow_summary", scopedToken);
    expect(scopedFinance.statusCode).toBe(200);
    expect(scopedFinance.json().summary).toMatchObject({ income: "100.25", expense: "0.00", net: "100.25" });

    const tenantFinance = await get("/reporting/reports/finance_cashflow_summary", reportingToken);
    expect(tenantFinance.json().summary).toMatchObject({ income: "301.00", expense: "0.00", net: "301.00" });

    const scopedHse = await get("/reporting/reports/hse_incident_observation_summary", scopedToken);
    expect(scopedHse.statusCode).toBe(200);
    expect(scopedHse.json().summary.records).toBe(1);
    expect(scopedHse.json().rows.map((row: { label: string }) => row.label)).toEqual(["incident"]);

    const scopedProjects = await get("/reporting/reports/project_delivery_progress_summary", scopedToken);
    expect(scopedProjects.json().summary.projects).toBe(1);
    expect(scopedProjects.json().rows[0].label).toContain("North Project P9");
  });

  it("does not let out-of-scope or cross-tenant records affect dashboard totals", async () => {
    const scopedDashboard = await get("/reporting/dashboard", scopedToken);
    expect(scopedDashboard.statusCode).toBe(200);
    const finance = scopedDashboard.json().modules.find((m: { moduleCode: string }) => m.moduleCode === "finance");
    expect(finance.cards).toEqual(expect.arrayContaining([{ label: "Income", value: "100.25", tone: "neutral" }]));

    const tenantFinance = await get("/reporting/reports/finance_cashflow_summary", reportingToken);
    expect(tenantFinance.json().summary.income).toBe("301.00");
    expect(tenantFinance.json().summary.income).not.toBe("10300.00");
  });

  it("exports the same scoped result as the report endpoint", async () => {
    const detail = await get("/reporting/reports/finance_cashflow_summary", scopedToken);
    const exported = await get("/reporting/reports/finance_cashflow_summary/export", scopedToken);
    expect(exported.statusCode).toBe(200);
    expect(exported.payload).toContain("sales,income,100.25");
    expect(exported.payload).not.toContain("200.75");
    expect(exported.payload).not.toContain("9999.00");
    expect(detail.json().summary.income).toBe("100.25");
  });

  it("never widens reporting scope through an invalidated assignment, including after restore", async () => {
    const scopedUser = await pool.query(
      `SELECT id FROM users WHERE tenant_id = $1 AND email = 'north@p9.local'`,
      [tenantId],
    );
    const role = await pool.query(
      `SELECT id FROM roles WHERE tenant_id = $1 AND code = 'RPT_EXPORT_P9'`,
      [tenantId],
    );
    const broadAssignment = await pool.query(
      `INSERT INTO user_role_assignments
         (user_id, role_id, scope_type, scope_organization_unit_id)
       VALUES ($1, $2, 'organization_unit', $3)
       RETURNING id`,
      [scopedUser.rows[0].id, role.rows[0].id, unitSouthId],
    );
    const assignmentId = broadAssignment.rows[0].id as string;

    const widened = await reportingRepository.financeCashflowSummary(
      tenantId,
      scopedUser.rows[0].id,
      ["reporting.read"],
    );
    expect(widened.summary.income).toBe("301.00");

    await pool.query(
      `UPDATE organization_units SET deleted_at = now() WHERE id = $1`,
      [unitSouthId],
    );
    const invalidated = await pool.query(
      `SELECT scope_invalidated_at
         FROM user_role_assignments
        WHERE id = $1`,
      [assignmentId],
    );
    expect(invalidated.rows[0].scope_invalidated_at).toBeInstanceOf(Date);
    const invalidatedAt = invalidated.rows[0].scope_invalidated_at as Date;

    const narrowed = await reportingRepository.financeCashflowSummary(
      tenantId,
      scopedUser.rows[0].id,
      ["reporting.read"],
    );
    expect(narrowed.summary.income).toBe("100.25");
    expect(narrowed.rows).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ amount: "200.75" })]),
    );

    await pool.query(
      `UPDATE organization_units SET deleted_at = NULL WHERE id = $1`,
      [unitSouthId],
    );
    const restored = await reportingRepository.financeCashflowSummary(
      tenantId,
      scopedUser.rows[0].id,
      ["reporting.read"],
    );
    expect(restored.summary.income).toBe("100.25");
    const persisted = await pool.query(
      `SELECT scope_invalidated_at
         FROM user_role_assignments
        WHERE id = $1`,
      [assignmentId],
    );
    expect(
      (persisted.rows[0].scope_invalidated_at as Date).getTime(),
    ).toBe(invalidatedAt.getTime());

    await pool.query(`DELETE FROM user_role_assignments WHERE id = $1`, [
      assignmentId,
    ]);
  });
});
