import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../../src/app.js";
import { pool } from "../../src/infrastructure/persistence/db.js";
import {
  authHeader,
  bootstrapTenant,
  createReadOnlyRole,
  login,
  provisionFirstAdmin,
} from "./helpers.js";

const TENANT_CODE = `wave-a2-main-${Date.now()}`;
const OTHER_TENANT_CODE = `wave-a2-other-${Date.now()}`;
const ADMIN_EMAIL = "admin@wave-a2.local";
const ADMIN_PASSWORD = "Admin12345!";
const RESPONDENT_EMAIL = "respondent@wave-a2.local";
const RESPONDENT_PASSWORD = "Respondent12345!";

describe.sequential("Wave A2 — Survey & Reporting Advanced Integration Suite", () => {
  const app = buildApp();

  let tenantId: string;
  let otherTenantId: string;
  let adminUserId: string;
  let adminToken: string;
  let otherAdminToken: string;
  let respondentUserId: string;
  let respondentToken: string;

  let surveyCode: string;
  let surveyDefinitionId: string;
  let surveyVersionId: string;
  let draftVersionId: string;
  let draftVersionNumber: number;
  let matrixQuestionId: string;
  let matrixRatingQuestionId: string;
  let ratingQuestionId: string;
  let textQuestionId: string;
  let matrixRow1Id: string;
  let matrixRow2Id: string;
  let optionPassId: string;
  let optionFailId: string;
  let section1Id: string;
  let section2Id: string;
  let publicDistributionToken: string;
  let singleUseDistributionToken: string;
  let savedBiReportId: string;

  const post = (url: string, token: string, payload?: Record<string, unknown>) =>
    app.inject({
      method: "POST",
      url,
      headers: authHeader(token),
      ...(payload === undefined ? {} : { payload }),
    });

  const get = (url: string, token: string) =>
    app.inject({
      method: "GET",
      url,
      headers: authHeader(token),
    });

  const patch = (url: string, token: string, payload: Record<string, unknown>) =>
    app.inject({
      method: "PATCH",
      url,
      headers: authHeader(token),
      payload,
    });

  const del = (url: string, token: string) =>
    app.inject({
      method: "DELETE",
      url,
      headers: authHeader(token),
    });

  beforeAll(async () => {
    // 1. Bootstrap Primary Tenant
    const primaryTenant = await bootstrapTenant(app, TENANT_CODE, "Wave A2 Primary Tenant");
    tenantId = primaryTenant.id;
    const adminUser = await provisionFirstAdmin({
      tenantId,
      email: ADMIN_EMAIL,
      password: ADMIN_PASSWORD,
    });
    adminUserId = adminUser.userId;
    const adminLogin = await login(app, TENANT_CODE, ADMIN_EMAIL, ADMIN_PASSWORD);
    adminToken = adminLogin.body.accessToken;

    // Activate modules for primary tenant so BI datasets become accessible
    await pool.query(
      `INSERT INTO tenant_module_activations (tenant_id, module_id, is_active)
       SELECT $1, id, true FROM modules WHERE code IN ('customer_complaint', 'service_quality', 'survey_assessment', 'reporting_insight')
       ON CONFLICT (tenant_id, module_id) DO UPDATE SET is_active = true`,
      [tenantId],
    );

    // 2. Bootstrap Other Tenant for cross-tenant isolation tests
    const otherTenant = await bootstrapTenant(app, OTHER_TENANT_CODE, "Wave A2 Other Tenant");
    otherTenantId = otherTenant.id;
    await provisionFirstAdmin({
      tenantId: otherTenantId,
      email: "otheradmin@wave-a2.local",
      password: ADMIN_PASSWORD,
    });
    const otherAdminLogin = await login(app, OTHER_TENANT_CODE, "otheradmin@wave-a2.local", ADMIN_PASSWORD);
    otherAdminToken = otherAdminLogin.body.accessToken;

    // 3. Create normal internal respondent user
    await createReadOnlyRole(tenantId, "SURVEY_INTERNAL_RESPONDENT", [
      "survey.respond",
      "survey.results.read",
    ]);

    const createRespondentRes = await post("/users", adminToken, {
      email: RESPONDENT_EMAIL,
      fullName: "Internal Survey Respondent",
      password: RESPONDENT_PASSWORD,
      roleCode: "SURVEY_INTERNAL_RESPONDENT",
      scopeType: "tenant",
    });
    expect(createRespondentRes.statusCode).toBe(201);
    respondentUserId = createRespondentRes.json().user.id;

    const respondentLogin = await login(app, TENANT_CODE, RESPONDENT_EMAIL, RESPONDENT_PASSWORD);
    respondentToken = respondentLogin.body.accessToken;
  });

  afterAll(async () => {
    await app.close();
  });

  // ===========================================================================
  // Module 1: SUR-ADV-003 — Matrix Questions & Forward Branching Rules
  // ===========================================================================
  describe("SUR-ADV-003: Matrix/Grid Questions and Conditional Branching", () => {
    it("creates a draft survey definition with weighted sections and advanced scoring", async () => {
      surveyCode = `csat-adv-${Date.now()}`;
      const createDefRes = await post("/surveys", adminToken, {
        code: surveyCode,
        name: "Advanced CSAT & NPS Survey",
        description: "Survey testing matrix grid, forward branching, nps scoring, and translations.",
        defaultLocale: "id-ID",
      });
      expect(createDefRes.statusCode).toBe(201);
      const def = createDefRes.json();
      surveyDefinitionId = def.definition.id;
      draftVersionId = def.version.id;
      draftVersionNumber = def.version.versionNumber;
      expect(draftVersionId).toBeDefined();

      // Configure section 1 with weighted scoring
      const createSec1 = await post(`/survey-versions/${draftVersionId}/sections`, adminToken, {
        code: "SEC_SERVICE_EXP",
        title: "Kualitas Layanan",
        description: "Evaluasi interaksi layanan dan kejelasan informasi.",
        sortOrder: 1,
        scoringModel: "weighted_average",
        weight: 60,
      });
      expect(createSec1.statusCode).toBe(201);
      section1Id = createSec1.json().id;

      // Configure section 2 for NPS scoring
      const createSec2 = await post(`/survey-versions/${draftVersionId}/sections`, adminToken, {
        code: "SEC_NPS_FEEDBACK",
        title: "Net Promoter & Rekomendasi",
        description: "Tingkat kemungkinan merekomendasikan produk kami.",
        sortOrder: 2,
        scoringModel: "nps",
        weight: 40,
      });
      expect(createSec2.statusCode).toBe(201);
      section2Id = createSec2.json().id;
    });

    it("adds matrix single choice question and statement rows", async () => {
      const createMatrixQ = await post(`/survey-versions/${draftVersionId}/questions`, adminToken, {
        sectionId: section1Id,
        code: "Q_MATRIX_EVAL",
        text: "Bagaimana penilaian Anda terhadap aspek berikut?",
        questionType: "matrix_single_choice",
        isRequired: true,
        sortOrder: 1,
        weight: 1.0,
        config: {},
      });
      expect(createMatrixQ.statusCode).toBe(201);
      matrixQuestionId = createMatrixQ.json().id;

      // Add question options
      const opt1 = await post(`/survey-questions/${matrixQuestionId}/options`, adminToken, {
        code: "POOR",
        label: "Kurang",
        score: 1,
        sortOrder: 1,
      });
      expect(opt1.statusCode).toBe(201);
      optionFailId = opt1.json().id;

      const opt2 = await post(`/survey-questions/${matrixQuestionId}/options`, adminToken, {
        code: "SATISFIED",
        label: "Puas",
        score: 4,
        sortOrder: 2,
      });
      expect(opt2.statusCode).toBe(201);

      const opt3 = await post(`/survey-questions/${matrixQuestionId}/options`, adminToken, {
        code: "EXCELLENT",
        label: "Sangat Puas",
        score: 5,
        sortOrder: 3,
      });
      expect(opt3.statusCode).toBe(201);
      optionPassId = opt3.json().id;

      // Add matrix rows
      const addRow1 = await post(`/survey-questions/${matrixQuestionId}/matrix-rows`, adminToken, {
        code: "ROW_SPEED",
        label: "Kecepatan Respons Penanganan",
        sortOrder: 1,
      });
      expect(addRow1.statusCode).toBe(201);
      matrixRow1Id = addRow1.json().id;

      const addRow2 = await post(`/survey-questions/${matrixQuestionId}/matrix-rows`, adminToken, {
        code: "ROW_COURTESY",
        label: "Keramahan Petugas Layanan",
        sortOrder: 2,
      });
      expect(addRow2.statusCode).toBe(201);
      matrixRow2Id = addRow2.json().id;

      const rowsList = await get(`/survey-questions/${matrixQuestionId}/matrix-rows`, adminToken);
      expect(rowsList.statusCode).toBe(200);
      expect(rowsList.json()).toHaveLength(2);
    });

    it("adds a rating question (NPS 0-10) in section 2 and a followup text question", async () => {
      const createNpsQ = await post(`/survey-versions/${draftVersionId}/questions`, adminToken, {
        sectionId: section2Id,
        code: "Q_NPS_SCORE",
        text: "Seberapa besar kemungkinan Anda merekomendasikan kami? (0-10)",
        questionType: "rating",
        isRequired: true,
        sortOrder: 1,
        weight: 1.0,
        config: { min: 0, max: 10 },
      });
      expect(createNpsQ.statusCode).toBe(201);
      ratingQuestionId = createNpsQ.json().id;

      const createTextQ = await post(`/survey-versions/${draftVersionId}/questions`, adminToken, {
        sectionId: section2Id,
        code: "Q_FEEDBACK_TEXT",
        text: "Mohon berikan masukan tambahan untuk perbaikan kami.",
        questionType: "short_text",
        isRequired: false,
        sortOrder: 2,
        weight: 0,
        config: {},
      });
      expect(createTextQ.statusCode).toBe(201);
      textQuestionId = createTextQ.json().id;
    });

    it("creates branching rules: jump or end based on rating condition", async () => {
      // If NPS >= 9, skip text feedback and end survey
      const createRuleRes = await post(`/survey-versions/${draftVersionId}/branching-rules`, adminToken, {
        sourceQuestionId: ratingQuestionId,
        conditionOperator: "greater_than",
        conditionValue: 8,
        targetAction: "end_survey",
        priority: 10,
      });
      expect(createRuleRes.statusCode).toBe(201);
      expect(createRuleRes.json().conditionOperator).toBe("greater_than");

      const rulesList = await get(`/survey-versions/${draftVersionId}/branching-rules`, adminToken);
      expect(rulesList.statusCode).toBe(200);
      expect(rulesList.json()).toHaveLength(1);
    });

    it("rejects backward or cyclic branching rules that violate linear forward integrity", async () => {
      // Attempt to jump from question 2 back to question 1
      const invalidRuleRes = await post(`/survey-versions/${draftVersionId}/branching-rules`, adminToken, {
        sourceQuestionId: textQuestionId,
        conditionOperator: "is_answered",
        conditionValue: null,
        targetAction: "jump_to_question",
        targetQuestionId: matrixQuestionId, // Earlier question
        priority: 5,
      });
      expect(invalidRuleRes.statusCode).toBe(400);
    });
  });

  // ===========================================================================
  // Module 2: SUR-ADV-006 — Multi-Language Survey Localization
  // ===========================================================================
  describe("SUR-ADV-006: Multi-Language Survey Translations", () => {
    it("upserts translation records for questions and sections in en-US", async () => {
      // Translate Section 1 Title
      const transSec1 = await app.inject({
        method: "PUT",
        url: `/survey-versions/${draftVersionId}/translations`,
        headers: authHeader(adminToken),
        payload: {
          locale: "en-US",
          entityType: "section",
          entityId: section1Id,
          fieldName: "title",
          translatedText: "Service Quality Experience",
        },
      });
      expect(transSec1.statusCode).toBe(200);

      // Translate Matrix Question Text
      const transQ = await app.inject({
        method: "PUT",
        url: `/survey-versions/${draftVersionId}/translations`,
        headers: authHeader(adminToken),
        payload: {
          locale: "en-US",
          entityType: "question",
          entityId: matrixQuestionId,
          fieldName: "text",
          translatedText: "How would you rate the following aspects of our service?",
        },
      });
      expect(transQ.statusCode).toBe(200);

      // Translate Matrix Row Label
      const transRow = await app.inject({
        method: "PUT",
        url: `/survey-versions/${draftVersionId}/translations`,
        headers: authHeader(adminToken),
        payload: {
          locale: "en-US",
          entityType: "matrix_row",
          entityId: matrixRow1Id,
          fieldName: "label",
          translatedText: "Response Handling Speed",
        },
      });
      expect(transRow.statusCode).toBe(200);

      // Fetch translations for draft version
      const transList = await get(`/survey-versions/${draftVersionId}/translations?locale=en-US`, adminToken);
      expect(transList.statusCode).toBe(200);
      expect(transList.json().length).toBeGreaterThanOrEqual(3);
    });

    it("publishes the survey version and locks definition and translations immutably", async () => {
      const publishRes = await post(`/surveys/${surveyCode}/versions/${draftVersionNumber}/publish`, adminToken);
      expect(publishRes.statusCode).toBe(200);
      surveyVersionId = draftVersionId;

      // Attempting to modify questions or branching on published version is rejected with ConflictError (409)
      const modifyQ = await post(`/survey-questions/${matrixQuestionId}/matrix-rows`, adminToken, {
        code: "ROW_NEW",
        label: "New Row",
        sortOrder: 3,
      });
      expect(modifyQ.statusCode).toBe(409);

      const modifyRule = await post(`/survey-versions/${surveyVersionId}/branching-rules`, adminToken, {
        sourceQuestionId: matrixQuestionId,
        conditionOperator: "is_answered",
        conditionValue: null,
        targetAction: "end_survey",
      });
      expect(modifyRule.statusCode).toBe(409);
    });
  });

  // ===========================================================================
  // Module 3: SUR-ADV-005 — Anonymous and Public-Token Distribution
  // ===========================================================================
  describe("SUR-ADV-005: Anonymous Public Survey Distribution", () => {
    it("creates multi-use and single-use public distribution tokens", async () => {
      const multiUseRes = await post(`/survey-versions/${surveyVersionId}/distribution-tokens`, adminToken, {
        channel: "link",
        recipientLabel: "General Web Portal Link",
        maxUses: 100,
      });
      expect(multiUseRes.statusCode).toBe(201);
      const multiTokenData = multiUseRes.json();
      expect(multiTokenData.rawToken).toBeDefined();
      publicDistributionToken = multiTokenData.rawToken;

      const singleUseRes = await post(`/survey-versions/${surveyVersionId}/distribution-tokens`, adminToken, {
        channel: "email",
        recipientLabel: "customer-direct@example.com",
        maxUses: 1,
      });
      expect(singleUseRes.statusCode).toBe(201);
      singleUseDistributionToken = singleUseRes.json().rawToken;
    });

    it("verifies and renders public questionnaire view without authentication", async () => {
      const unauthViewRes = await app.inject({
        method: "GET",
        url: `/public/surveys/${publicDistributionToken}?locale=en-US`,
      });
      expect(unauthViewRes.statusCode).toBe(200);
      const view = unauthViewRes.json();
      expect(view.definitionCode).toBe(surveyCode);
      expect(view.versionNumber).toBe(draftVersionNumber);
      expect(view.sections).toHaveLength(2);
      expect(view.questions.length).toBeGreaterThanOrEqual(3);

      // Verify translated text was delivered in en-US
      const translatedSec = view.sections.find((s: { id: string }) => s.id === section1Id);
      expect(translatedSec.title).toBe("Service Quality Experience");
    });

    it("submits anonymous public response with zero identity leakage and enforces usage quota", async () => {
      // Submit valid anonymous response via singleUseDistributionToken
      const submitRes = await app.inject({
        method: "POST",
        url: `/public/surveys/${singleUseDistributionToken}/submit`,
        payload: {
          answers: [
            { questionId: ratingQuestionId, valueNumeric: 10 }, // NPS Promoter (10) -> triggers branching end_survey
          ],
          matrixAnswers: [
            {
              questionId: matrixQuestionId,
              matrixRowId: matrixRow1Id,
              selectedOptionId: optionPassId,
              valueNumeric: 5,
              valueText: "EXCELLENT",
            },
            {
              questionId: matrixQuestionId,
              matrixRowId: matrixRow2Id,
              selectedOptionId: optionPassId,
              valueNumeric: 4,
              valueText: "SATISFIED",
            },
          ],
        },
      });

      expect(submitRes.statusCode).toBe(201);
      const submitResult = submitRes.json();
      expect(submitResult.assignmentId).toBeDefined();

      // Verify zero identity leakage in database
      const dbCheck = await pool.query(
        "SELECT respondent_type, respondent_user_id, respondent_customer_contact_id FROM survey_assignments WHERE id = $1",
        [submitResult.assignmentId],
      );
      expect(dbCheck.rows[0].respondent_type).toBe("public_link");
      expect(dbCheck.rows[0].respondent_user_id).toBeNull();
      expect(dbCheck.rows[0].respondent_customer_contact_id).toBeNull();

      // Attempting to reuse the single-use token must be rejected with 409 (ConflictError)
      const reuseRes = await app.inject({
        method: "POST",
        url: `/public/surveys/${singleUseDistributionToken}/submit`,
        payload: {
          answers: [{ questionId: ratingQuestionId, valueNumeric: 8 }],
        },
      });
      expect(reuseRes.statusCode).toBe(409);
    });
  });

  // ===========================================================================
  // Module 4: SUR-ADV-004 & SUR-ADV-007 — NPS Scoring & Cross-Survey Analytics
  // ===========================================================================
  describe("SUR-ADV-004 & SUR-ADV-007: NPS Scoring, Benchmarking & Privacy Analytics", () => {
    it("submits an authenticated respondent survey with Detractor NPS rating", async () => {
      // Create direct internal assignment
      const assignRes = await post("/survey-assignments", adminToken, {
        surveyVersionId,
        respondentUserId,
      });
      expect(assignRes.statusCode).toBe(201);
      const assignmentId = assignRes.json().id;

      // Submit answers as respondent
      const submitRes = await post(`/survey-assignments/${assignmentId}/answers`, respondentToken, {
        answers: [
          { questionId: ratingQuestionId, valueNumeric: 4 }, // Detractor (0-6)
          { questionId: textQuestionId, valueText: "Proses verifikasi butuh dipercepat." },
        ],
        matrixAnswers: [
          { questionId: matrixQuestionId, matrixRowId: matrixRow1Id, selectedOptionId: optionFailId, valueNumeric: 2, valueText: "POOR" },
          { questionId: matrixQuestionId, matrixRowId: matrixRow2Id, selectedOptionId: optionFailId, valueNumeric: 3, valueText: "POOR" },
        ],
      });
      expect(submitRes.statusCode).toBe(200);

      const finalizeRes = await post(`/survey-assignments/${assignmentId}/submit`, respondentToken);
      expect(finalizeRes.statusCode).toBe(200);

      // Verify section scores calculated in survey_section_scores
      const sectionScoresCheck = await pool.query(
        "SELECT * FROM survey_section_scores WHERE survey_assignment_id = $1",
        [assignmentId],
      );
      expect(sectionScoresCheck.rows.length).toBeGreaterThanOrEqual(1);
    });

    it("retrieves cross-survey analytics overview with NPS breakdown", async () => {
      const analyticsRes = await get(`/surveys/${surveyCode}/analytics`, adminToken);
      expect(analyticsRes.statusCode).toBe(200);
      const overview = analyticsRes.json();
      expect(overview.completionRatePercent).toBeGreaterThan(0);
      expect(overview.totalAssignments).toBeGreaterThanOrEqual(2);

      // Check NPS aggregation (1 promoter (10), 1 detractor (4) -> NPS score = 0)
      if (overview.nps) {
        expect(overview.nps.promoterCount).toBeGreaterThanOrEqual(1);
        expect(overview.nps.detractorCount).toBeGreaterThanOrEqual(1);
      }
    });

    it("performs contextual benchmarking across operational segments", async () => {
      const benchmarkRes = await get(`/surveys/${surveyCode}/benchmark`, adminToken);
      expect(benchmarkRes.statusCode).toBe(200);
      const benchmarks = benchmarkRes.json();
      expect(benchmarks.surveyDefinitionId).toBe(surveyDefinitionId);
      expect(benchmarks.items).toBeInstanceOf(Array);
    });
  });

  // ===========================================================================
  // Module 5: RPT-ADV-001 — Governed BI Warehouse Projections
  // ===========================================================================
  describe("RPT-ADV-001: Governed Self-Service BI Engine", () => {
    it("lists active catalog datasets and inspects field metadata", async () => {
      const listRes = await get("/reporting/bi/datasets", adminToken);
      expect(listRes.statusCode).toBe(200);
      const datasets = listRes.json();
      expect(datasets.length).toBeGreaterThanOrEqual(3);

      const complaintsDs = datasets.find((d: { code: string }) => d.code === "complaint_lifecycle");
      expect(complaintsDs).toBeDefined();

      const detailRes = await get(`/reporting/bi/datasets/${complaintsDs.code}`, adminToken);
      expect(detailRes.statusCode).toBe(200);
      const detail = detailRes.json();
      expect(detail.fields.length).toBeGreaterThanOrEqual(5);

      const dimensions = detail.fields.filter((f: { isDimension: boolean }) => f.isDimension);
      const measures = detail.fields.filter((f: { isMeasure: boolean }) => f.isMeasure);
      expect(dimensions.length).toBeGreaterThan(0);
      expect(measures.length).toBeGreaterThan(0);
    });

    it("executes multi-dimensional projection query with enforced Data Scope and limit", async () => {
      const queryRes = await post("/reporting/bi/query", adminToken, {
        datasetCode: "complaint_lifecycle",
        dimensions: ["priority"],
        measures: ["total_complaints"],
        filters: [],
      });
      expect(queryRes.statusCode).toBe(200);
      const result = queryRes.json();
      expect(result.datasetCode).toBe("complaint_lifecycle");
      expect(result.columns).toHaveLength(2);
      expect(result.rows).toBeInstanceOf(Array);
      expect(result.rowCount).toBeLessThanOrEqual(1000);
      expect(result.truncated).toBe(false);
    });

    it("rejects unauthorized fields or operators to prevent SQL injection or arbitrary query execution", async () => {
      const attackRes = await post("/reporting/bi/query", adminToken, {
        datasetCode: "complaint_lifecycle",
        dimensions: ["priority; DROP TABLE users; --"],
        measures: ["total_complaints"],
        filters: [],
      });
      expect(attackRes.statusCode).toBe(400);

      const invalidFilterRes = await post("/reporting/bi/query", adminToken, {
        datasetCode: "complaint_lifecycle",
        dimensions: ["priority"],
        measures: ["total_complaints"],
        filters: [
          { field: "non_existent_column", operator: "eq", value: "test" },
        ],
      });
      expect(invalidFilterRes.statusCode).toBe(400);
    });

    it("creates, retrieves, exports, and deletes saved BI report configurations", async () => {
      const saveRes = await post("/reporting/bi/saved-reports", adminToken, {
        code: "rpt_priority_breakdown",
        title: "Complaints by Priority Aggregation",
        description: "Weekly complaint distribution across priorities.",
        config: {
          datasetCode: "complaint_lifecycle",
          dimensions: ["priority"],
          measures: ["total_complaints"],
          filters: [],
        },
      });
      expect(saveRes.statusCode).toBe(201);
      savedBiReportId = saveRes.json().id;

      const listSavedRes = await get("/reporting/bi/saved-reports?datasetCode=complaint_lifecycle", adminToken);
      expect(listSavedRes.statusCode).toBe(200);
      expect(listSavedRes.json().some((r: { id: string }) => r.id === savedBiReportId)).toBe(true);

      // Export BI query as CSV
      const exportRes = await app.inject({
        method: "POST",
        url: "/reporting/bi/export",
        headers: authHeader(adminToken),
        payload: {
          datasetCode: "complaint_lifecycle",
          dimensions: ["priority"],
          measures: ["total_complaints"],
          filters: [],
        },
      });
      expect(exportRes.statusCode).toBe(200);
      expect(exportRes.headers["content-type"]).toContain("text/csv");
      expect(exportRes.body).toContain("Priority");

      // Delete saved report
      const deleteRes = await del(`/reporting/bi/saved-reports/${savedBiReportId}`, adminToken);
      expect(deleteRes.statusCode).toBe(204);
    });
  });

  // ===========================================================================
  // Module 6: RPT-ADV-002 — Deterministic Operational Predictive Analytics
  // ===========================================================================
  describe("RPT-ADV-002: Deterministic Time-Series Predictive Forecasting", () => {
    it("generates bounded operational time-series forecast and handles insufficient data safely", async () => {
      const generateRes = await post("/reporting/predictive/forecast", adminToken, {
        modelCode: "complaint_volume_forecast",
        lookbackDays: 60,
        forecastDays: 30,
      });
      expect(generateRes.statusCode).toBe(201);
      const body = generateRes.json();
      expect(body.forecast).toBeDefined();
      expect(body.snapshot).toBeDefined();
      expect(body.forecast.modelCode).toBe("complaint_volume_forecast");

      // Verify status is deterministic (either completed with metrics or insufficient_data handled)
      expect(["completed", "insufficient_data"]).toContain(body.forecast.status);

      if (body.forecast.status === "completed") {
        expect(body.forecast.metrics).toBeDefined();
        expect(body.forecast.metrics.historicalAverage).toBeGreaterThanOrEqual(0);
        expect(body.forecast.projectedDataPoints.length).toBe(30);
        expect(body.forecast.confidenceIntervals.length).toBe(30);
      } else {
        expect(body.forecast.insufficientDataReason).toBeDefined();
      }
    });

    it("retrieves latest forecast snapshot and snapshot audit history", async () => {
      const latestRes = await get("/reporting/predictive/snapshots/latest/complaint_volume_forecast", adminToken);
      expect(latestRes.statusCode).toBe(200);
      const latest = latestRes.json();
      if (latest) {
        expect(latest.modelCode).toBe("complaint_volume_forecast");
        expect(latest.tenantId).toBe(tenantId);
      }

      const historyRes = await get("/reporting/predictive/snapshots?modelCode=complaint_volume_forecast", adminToken);
      expect(historyRes.statusCode).toBe(200);
      expect(historyRes.json()).toBeInstanceOf(Array);
    });

    it("verifies multi-tenant isolation: other tenant cannot see primary tenant snapshots", async () => {
      const otherTenantSnapshots = await get("/reporting/predictive/snapshots?modelCode=complaint_volume_forecast", otherAdminToken);
      expect(otherTenantSnapshots.statusCode).toBe(200);
      expect(otherTenantSnapshots.json()).toHaveLength(0);

      const otherTenantBiReports = await get("/reporting/bi/saved-reports", otherAdminToken);
      expect(otherTenantBiReports.statusCode).toBe(200);
      expect(otherTenantBiReports.json()).toHaveLength(0);
    });
  });
});
