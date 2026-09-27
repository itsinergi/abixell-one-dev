import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../../src/app.js";
import { pool } from "../../src/infrastructure/persistence/db.js";
import { activateAllModules, authHeader, bootstrapTenant, createReadOnlyRole, login, provisionFirstAdmin } from "./helpers.js";

/**
 * Checkpoint 1D.1 — Generic Survey & Assessment Engine core vertical slice.
 * Definition -> Version -> Questions -> Publish -> Assign -> Respond -> Submit
 * -> Result -> Audit/Event, against the real database, plus permission,
 * ownership, tenant isolation, immutability, and scoring checks.
 */

const TENANT = `test-1d1-${Date.now()}`;
const OTHER = `test-1d1-other-${Date.now()}`;

describe("Checkpoint 1D.1 — Survey Engine Core", () => {
  const app = buildApp();
  let tenantId: string;
  let otherTenantId: string;
  let adminToken: string;
  let otherAdminToken: string;
  let otherAdminUserId: string;
  let respAId: string;
  let respAToken: string;
  let respBToken: string;
  let noPermToken: string;

  const post = (url: string, token: string, payload: unknown = {}) =>
    app.inject({ method: "POST", url, headers: authHeader(token), payload });
  const get = (url: string, token: string) => app.inject({ method: "GET", url, headers: authHeader(token) });

  beforeAll(async () => {
    const t = await bootstrapTenant(app, TENANT, "Tenant 1D1");
    tenantId = t.id;
    await activateAllModules(tenantId);
    await provisionFirstAdmin({ tenantId, email: "admin@t1d1.local", password: "Admin12345!" });
    adminToken = (await login(app, TENANT, "admin@t1d1.local", "Admin12345!")).body.accessToken;

    await createReadOnlyRole(tenantId, "RESP_1D1", ["survey.respond"]);
    await createReadOnlyRole(tenantId, "NOPERM_1D1", ["customer.read"]);
    const mk = (email: string, role: string) =>
      app.inject({
        method: "POST",
        url: "/admin/users",
        headers: authHeader(adminToken),
        payload: {
          email,
          fullName: email,
          password: "Respondent12345!",
          pairs: [{ roleCode: role, scopeType: "tenant" }],
        },
      });
    respAId = (await mk("respa@t1d1.local", "RESP_1D1")).json().user.id;
    await mk("respb@t1d1.local", "RESP_1D1");
    await mk("noperm@t1d1.local", "NOPERM_1D1");
    respAToken = (await login(app, TENANT, "respa@t1d1.local", "Respondent12345!")).body.accessToken;
    respBToken = (await login(app, TENANT, "respb@t1d1.local", "Respondent12345!")).body.accessToken;
    noPermToken = (await login(app, TENANT, "noperm@t1d1.local", "Respondent12345!")).body.accessToken;

    const ot = await bootstrapTenant(app, OTHER, "Other 1D1");

    await activateAllModules(ot.id);
    otherTenantId = ot.id;
    otherAdminUserId = (await provisionFirstAdmin({ tenantId: otherTenantId, email: "admin@o1d1.local", password: "Admin12345!" })).userId;
    otherAdminToken = (await login(app, OTHER, "admin@o1d1.local", "Admin12345!")).body.accessToken;
  });

  afterAll(async () => {
    await pool.query(`DELETE FROM tenants WHERE id = ANY($1)`, [[tenantId, otherTenantId]]);
    await app.close();
  });

  // Shared IDs across the ordered flow.
  let v1Id: string;
  let qRatingId: string;
  let qChoiceId: string;
  let optAId: string;
  let assignmentId: string;

  it("Definition: create builds v1 draft; add questions/options (survey.manage)", async () => {
    const create = await post("/surveys", adminToken, { code: "csat", name: "Customer Satisfaction" });
    expect(create.statusCode).toBe(201);
    v1Id = create.json().version.id;
    expect(create.json().version.versionNumber).toBe(1);
    expect(create.json().version.status).toBe("draft");

    const rating = await post(`/survey-versions/${v1Id}/questions`, adminToken, {
      code: "overall",
      text: "Overall rating",
      questionType: "rating",
      isRequired: true,
      config: { min: 1, max: 5 },
    });
    expect(rating.statusCode).toBe(201);
    qRatingId = rating.json().id;

    const choice = await post(`/survey-versions/${v1Id}/questions`, adminToken, {
      code: "recommend",
      text: "Would you recommend us?",
      questionType: "single_choice",
      isRequired: true,
    });
    qChoiceId = choice.json().id;
    optAId = (await post(`/survey-questions/${qChoiceId}/options`, adminToken, { code: "yes", label: "Yes", score: 10 })).json().id;
    await post(`/survey-questions/${qChoiceId}/options`, adminToken, { code: "no", label: "No", score: 0 });

    await post(`/survey-versions/${v1Id}/questions`, adminToken, {
      code: "comments",
      text: "Any comments?",
      questionType: "long_text",
    });

    const create2 = await post("/surveys", adminToken, { code: "csat", name: "Duplicate" });
    expect(create2.statusCode).toBe(409); // duplicate code
  });

  it("Manage authorization: a user without survey.manage cannot create a definition", async () => {
    expect((await post("/surveys", respAToken, { code: "x", name: "x" })).statusCode).toBe(403);
  });

  it("Question type: unsupported type is rejected", async () => {
    const res = await post(`/survey-versions/${v1Id}/questions`, adminToken, {
      code: "bad",
      text: "matrix?",
      questionType: "matrix",
    });
    expect(res.statusCode).toBe(400);
  });

  it("Publish: invalid definition rejected; valid published; published becomes immutable", async () => {
    // A separate empty definition cannot publish.
    const empty = await post("/surveys", adminToken, { code: "empty", name: "Empty" });
    const emptyPublish = await post(`/surveys/empty/versions/1/publish`, adminToken);
    expect(emptyPublish.statusCode).toBe(400);
    void empty;

    const publish = await post(`/surveys/csat/versions/1/publish`, adminToken);
    expect(publish.statusCode).toBe(200);
    expect(publish.json().status).toBe("published");
    expect(publish.json().isCurrent).toBe(true);

    // Published version is immutable — cannot add a question.
    const addToPublished = await post(`/survey-versions/${v1Id}/questions`, adminToken, {
      code: "late",
      text: "late",
      questionType: "long_text",
    });
    expect(addToPublished.statusCode).toBe(409);
  });

  it("Assignment: assign published version to a respondent; reject cross-tenant respondent", async () => {
    const assign = await post("/survey-assignments", adminToken, {
      surveyDefinitionCode: "csat",
      respondentUserId: respAId,
    });
    expect(assign.statusCode).toBe(201);
    assignmentId = assign.json().id;
    expect(assign.json().status).toBe("pending");

    // Respondent from another tenant → forbidden.
    const crossTenant = await post("/survey-assignments", adminToken, {
      surveyDefinitionCode: "csat",
      respondentUserId: otherAdminUserId,
    });
    expect(crossTenant.statusCode).toBe(403);

    // Cannot assign a DRAFT version (reference it directly by id → 409).
    const draftDef = await post("/surveys", adminToken, { code: "draftonly", name: "Draft Only" });
    const draftVersionId = draftDef.json().version.id;
    const draftAssign = await post("/survey-assignments", adminToken, {
      surveyVersionId: draftVersionId,
      respondentUserId: respAId,
    });
    expect(draftAssign.statusCode).toBe(409);

    // A definition with no published version has no current version → 404.
    const noCurrent = await post("/survey-assignments", adminToken, {
      surveyDefinitionCode: "draftonly",
      respondentUserId: respAId,
    });
    expect(noCurrent.statusCode).toBe(404);
  });

  it("Admin version detail + respondent my-list enrichment (1D.2 reads)", async () => {
    // GET /survey-versions/:id returns the full version detail (any status).
    const vd = await get(`/survey-versions/${v1Id}`, adminToken);
    expect(vd.statusCode).toBe(200);
    expect(vd.json().questions.length).toBe(3);
    // Respondent's my-list is enriched with survey name + version number.
    const my = await get("/survey-assignments/my", respAToken);
    expect(my.statusCode).toBe(200);
    const item = my.json().find((r: { assignment: { id: string } }) => r.assignment.id === assignmentId);
    expect(item).toBeTruthy();
    expect(item.surveyName).toBe("Customer Satisfaction");
    expect(item.versionNumber).toBe(1);
  });

  it("Respond: owner sees questions; wrong respondent denied", async () => {
    const view = await get(`/survey-assignments/${assignmentId}`, respAToken);
    expect(view.statusCode).toBe(200);
    expect(view.json().questions.length).toBe(3);

    const wrong = await get(`/survey-assignments/${assignmentId}`, respBToken);
    expect(wrong.statusCode).toBe(403);
  });

  it("Answers: save valid answers; reject invalid option and out-of-range rating", async () => {
    // Out-of-range rating rejected.
    const badRating = await post(`/survey-assignments/${assignmentId}/answers`, respAToken, {
      answers: [{ questionId: qRatingId, valueNumeric: 9 }],
    });
    expect(badRating.statusCode).toBe(400);

    // Option from a different question rejected for the choice question.
    const badOption = await post(`/survey-assignments/${assignmentId}/answers`, respAToken, {
      answers: [{ questionId: qChoiceId, optionIds: [qRatingId] }],
    });
    expect(badOption.statusCode).toBe(400);

    const ok = await post(`/survey-assignments/${assignmentId}/answers`, respAToken, {
      answers: [
        { questionId: qRatingId, valueNumeric: 4 },
        { questionId: qChoiceId, optionIds: [optAId] },
      ],
    });
    expect(ok.statusCode).toBe(200);
  });

  it("Submit: required validation, scoring, immutability", async () => {
    // First-answer moved it to in_progress; both required answered above.
    const submit = await post(`/survey-assignments/${assignmentId}/submit`, respAToken);
    expect(submit.statusCode).toBe(200);
    expect(submit.json().status).toBe("submitted");
    // rating 4 + option 'yes' score 10 = 14
    expect(Number(submit.json().totalScore)).toBe(14);

    // Submitted is immutable.
    const editAfter = await post(`/survey-assignments/${assignmentId}/answers`, respAToken, {
      answers: [{ questionId: qRatingId, valueNumeric: 1 }],
    });
    expect(editAfter.statusCode).toBe(409);

    // Double submit rejected (guarded finalize — atomic).
    const doubleSubmit = await post(`/survey-assignments/${assignmentId}/submit`, respAToken);
    expect(doubleSubmit.statusCode).toBe(409);
  });

  it("Submit required-validation: an assignment missing a required answer cannot submit", async () => {
    const assign = await post("/survey-assignments", adminToken, {
      surveyDefinitionCode: "csat",
      respondentUserId: respAId,
    });
    const id = assign.json().id;
    // Answer only the rating; the required single_choice is missing.
    await post(`/survey-assignments/${id}/answers`, respAToken, {
      answers: [{ questionId: qRatingId, valueNumeric: 3 }],
    });
    const submit = await post(`/survey-assignments/${id}/submit`, respAToken);
    expect(submit.statusCode).toBe(400);
  });

  it("Result: authorized read returns score + answers; unauthorized denied; cross-tenant denied", async () => {
    const result = await get(`/survey-assignments/${assignmentId}/result`, adminToken);
    expect(result.statusCode).toBe(200);
    expect(Number(result.json().assignment.totalScore)).toBe(14);
    expect(result.json().answers.length).toBeGreaterThanOrEqual(2);

    // respondent has survey.respond but not survey.results.read.
    expect((await get(`/survey-assignments/${assignmentId}/result`, respAToken)).statusCode).toBe(403);
    // no survey perms at all.
    expect((await get(`/survey-assignments/${assignmentId}/result`, noPermToken)).statusCode).toBe(403);
    // cross-tenant.
    expect((await get(`/survey-assignments/${assignmentId}/result`, otherAdminToken)).statusCode).toBe(404);
  });

  it("Tenant isolation: another tenant cannot see this tenant's definitions", async () => {
    const list = await get("/surveys", otherAdminToken);
    expect(list.statusCode).toBe(200);
    expect(list.json().map((d: { code: string }) => d.code)).not.toContain("csat");
    // Cross-tenant definition detail 404.
    expect((await get("/surveys/csat", otherAdminToken)).statusCode).toBe(404);
  });

  it("Audit & events: publish/assign/submit recorded", async () => {
    const audits = (
      await pool.query(
        `SELECT action FROM audit_log WHERE tenant_id=$1 AND action LIKE 'survey.%' ORDER BY id`,
        [tenantId],
      )
    ).rows.map((r) => r.action);
    expect(audits).toEqual(
      expect.arrayContaining(["survey.definition.created", "survey.published", "survey.assignment.created", "survey.submitted"]),
    );

    const events = (
      await pool.query(
        `SELECT event_type FROM domain_events WHERE tenant_id=$1 AND event_type LIKE 'survey.%'`,
        [tenantId],
      )
    ).rows.map((r) => r.event_type);
    expect(events).toEqual(expect.arrayContaining(["survey.published", "survey.assigned", "survey.submitted"]));
  });

  it("Immutability: cannot add an option to a published question (1D.3 §14)", async () => {
    const res = await post(`/survey-questions/${qChoiceId}/options`, adminToken, { code: "maybe", label: "Maybe" });
    expect(res.statusCode).toBe(409); // qChoiceId belongs to the published v1
  });

  it("Historical response safety: editing a later draft version does not change a submitted result (1D.3 §15)", async () => {
    // Snapshot the already-submitted assignment's result (v1, score 14).
    const before = (await get(`/survey-assignments/${assignmentId}/result`, adminToken)).json();
    expect(Number(before.assignment.totalScore)).toBe(14);
    expect(before.version.version.versionNumber).toBe(1);

    // Create + edit a NEW draft version (v2).
    const v2 = await post(`/surveys/csat/versions`, adminToken);
    expect(v2.statusCode).toBe(201);
    const v2add = await post(`/survey-versions/${v2.json().id}/questions`, adminToken, {
      code: "extra",
      text: "Extra v2 question",
      questionType: "long_text",
    });
    expect(v2add.statusCode).toBe(201);

    // The submitted assignment's result is unchanged (still v1, score 14, same answers).
    const after = (await get(`/survey-assignments/${assignmentId}/result`, adminToken)).json();
    expect(Number(after.assignment.totalScore)).toBe(14);
    expect(after.version.version.versionNumber).toBe(1);
    expect(after.answers.length).toBe(before.answers.length);
  });

  it("Retire safety: retire keeps history readable and blocks new assignments (1D.3 §16)", async () => {
    const retire = await post(`/surveys/csat/versions/1/retire`, adminToken);
    expect(retire.statusCode).toBe(200);
    expect(retire.json().status).toBe("retired");

    // Historical submitted result still readable + unchanged.
    const result = (await get(`/survey-assignments/${assignmentId}/result`, adminToken)).json();
    expect(Number(result.assignment.totalScore)).toBe(14);
    expect(result.version.questions.length).toBeGreaterThanOrEqual(2);

    // A retired version cannot receive a NEW assignment.
    const assign = await post("/survey-assignments", adminToken, { surveyVersionId: v1Id, respondentUserId: respAId });
    expect(assign.statusCode).toBe(409);
  });
});
