/**
 * Checkpoint 1D.2 + Wave A2 (SUR-ADV-003…007):
 * Survey admin detail: versions, question & matrix row authoring (draft only),
 * forward-only branching rules, distribution tokens (anonymous/public),
 * multi-language translations, cross-survey analytics & benchmarking dashboard.
 */
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useAuth } from "../../auth/AuthContext";
import {
  api,
  ApiError,
  type BranchConditionOperator,
  type BranchTargetAction,
  type CreatedSurveyDistributionToken,
  type SurveyAnalyticsOverview,
  type SurveyBenchmarkResult,
  type SurveyBranchingRule,
  type SurveyDetail,
  type SurveyDistributionToken,
  type SurveyMatrixRow,
  type SurveyQuestion,
  type SurveyQuestionOption,
  type SurveyScoringModel,
  type SurveyTranslation,
  type SurveyVersionDetail,
  type TokenDistributionChannel,
  type TranslationEntityType,
} from "../../lib/api";
import {
  Alert,
  Badge,
  Button,
  Card,
  DataTable,
  EmptyState,
  Field,
  Input,
  PageHeader,
  Select,
  Spinner,
  StatusPill,
  Textarea,
  type Column,
} from "../../shell/components/ui";

const TYPES = [
  { value: "rating", label: "Rating (Scale)" },
  { value: "single_choice", label: "Single choice" },
  { value: "multiple_choice", label: "Multiple choice" },
  { value: "yes_no", label: "Yes / No" },
  { value: "short_text", label: "Short text" },
  { value: "long_text", label: "Long text" },
  { value: "numeric", label: "Numeric" },
  { value: "date", label: "Date" },
  { value: "matrix_single_choice", label: "Matrix: Single choice grid" },
  { value: "matrix_rating", label: "Matrix: Rating grid (1-5)" },
];

const SCORING_MODELS: { value: SurveyScoringModel; label: string }[] = [
  { value: "sum", label: "Sum (Total Points)" },
  { value: "weighted_average", label: "Weighted Average" },
  { value: "percentage", label: "Percentage Score (0-100%)" },
  { value: "nps", label: "Net Promoter Score (NPS)" },
];

const CONDITION_OPERATORS: { value: BranchConditionOperator; label: string }[] = [
  { value: "equals", label: "Equals (=)" },
  { value: "not_equals", label: "Not Equals (!=)" },
  { value: "greater_than", label: "Greater Than (>)" },
  { value: "less_than", label: "Less Than (<)" },
  { value: "in", label: "In Values (comma-separated)" },
  { value: "not_in", label: "Not In Values" },
  { value: "is_answered", label: "Is Answered" },
  { value: "is_unanswered", label: "Is Unanswered" },
];

const TARGET_ACTIONS: { value: BranchTargetAction; label: string }[] = [
  { value: "jump_to_question", label: "Jump to Question (Forward Only)" },
  { value: "jump_to_section", label: "Jump to Section (Forward Only)" },
  { value: "end_survey", label: "End Survey Immediately" },
];

function versionTone(status: string): "neutral" | "success" | "warning" {
  if (status === "published") return "success";
  if (status === "retired") return "neutral";
  return "warning"; // draft
}

export function SurveyDetailPage() {
  const { session } = useAuth();
  const token = session!.accessToken;
  const { code } = useParams<{ code: string }>();
  const navigate = useNavigate();

  const [survey, setSurvey] = useState<SurveyDetail | null>(null);
  const [selectedVersionId, setSelectedVersionId] = useState<string>("");
  const [detail, setDetail] = useState<SurveyVersionDetail | null>(null);
  const [users, setUsers] = useState<{ id: string; email: string; fullName: string }[]>([]);
  const [permissions, setPermissions] = useState<string[]>([]);

  // Wave A2 tabs
  const [activeTab, setActiveTab] = useState<"questions" | "sections" | "branching" | "tokens" | "translations" | "analytics" | "benchmark">("questions");

  // Advanced data state
  const [branchingRules, setBranchingRules] = useState<SurveyBranchingRule[]>([]);
  const [distributionTokens, setDistributionTokens] = useState<SurveyDistributionToken[]>([]);
  const [translations, setTranslations] = useState<SurveyTranslation[]>([]);
  const [analyticsOverview, setAnalyticsOverview] = useState<SurveyAnalyticsOverview | null>(null);
  const [benchmarkResult, setBenchmarkResult] = useState<SurveyBenchmarkResult | null>(null);
  const [newlyCreatedToken, setNewlyCreatedToken] = useState<CreatedSurveyDistributionToken | null>(null);

  const [loading, setLoading] = useState(true);
  const [tabLoading, setTabLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ tone: "success" | "error" | "info"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  // Question form state
  const [questionType, setQuestionType] = useState("rating");

  // Branching form state
  const [selectedSourceQuestionId, setSelectedSourceQuestionId] = useState<string>("");
  const [selectedTargetAction, setSelectedTargetAction] = useState<BranchTargetAction>("jump_to_question");

  const canManage = permissions.includes("survey.manage");
  const canReadAnalytics = permissions.includes("survey.analytics.read");

  const loadSurvey = useCallback(async () => {
    if (!code) return;
    setLoading(true);
    setError(null);
    try {
      const [s, meRes] = await Promise.all([
        api.survey(token, code),
        api.me(token).catch(() => ({ permissions: [] as string[] })),
      ]);
      setSurvey(s);
      setPermissions(meRes.permissions ?? []);
      setSelectedVersionId((cur) => {
        if (cur && s.versions.some((v) => v.id === cur)) return cur;
        const draft = [...s.versions].reverse().find((v) => v.status === "draft");
        const current = s.versions.find((v) => v.isCurrent);
        return (draft ?? current ?? s.versions[0])?.id ?? "";
      });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to load survey");
    } finally {
      setLoading(false);
    }
  }, [token, code]);

  useEffect(() => {
    loadSurvey();
  }, [loadSurvey]);

  const loadDetail = useCallback(async () => {
    if (!selectedVersionId) return;
    try {
      const d = await api.surveyVersionDetail(token, selectedVersionId);
      setDetail(d);
    } catch (err) {
      setNotice({ tone: "error", text: err instanceof ApiError ? err.message : "Failed to load version details" });
    }
  }, [token, selectedVersionId]);

  useEffect(() => {
    loadDetail();
  }, [loadDetail]);

  // Load contextual tab data
  const loadTabData = useCallback(async () => {
    if (!code || !selectedVersionId) return;
    setTabLoading(true);
    try {
      if (activeTab === "branching") {
        const rules = await api.surveyBranchingRules(token, selectedVersionId);
        setBranchingRules(rules);
      } else if (activeTab === "tokens") {
        const tokens = await api.surveyDistributionTokens(token, selectedVersionId);
        setDistributionTokens(tokens);
      } else if (activeTab === "translations") {
        const trans = await api.surveyTranslations(token, selectedVersionId);
        setTranslations(trans);
      } else if (activeTab === "analytics" && canReadAnalytics) {
        const ov = await api.surveyAnalytics(token, code);
        setAnalyticsOverview(ov);
      } else if (activeTab === "benchmark" && canReadAnalytics) {
        const bm = await api.surveyBenchmark(token, code);
        setBenchmarkResult(bm);
      }
    } catch (err) {
      setNotice({ tone: "error", text: err instanceof ApiError ? err.message : "Failed to load tab data" });
    } finally {
      setTabLoading(false);
    }
  }, [token, code, selectedVersionId, activeTab, canReadAnalytics]);

  useEffect(() => {
    loadTabData();
  }, [loadTabData]);

  // Users for internal assignment picker
  useEffect(() => {
    api.users(token).then(setUsers).catch(() => setUsers([]));
  }, [token]);

  const selectedVersion = survey?.versions.find((v) => v.id === selectedVersionId) ?? null;
  const isDraft = selectedVersion?.status === "draft";
  const isPublished = selectedVersion?.status === "published";

  async function run(fn: () => Promise<void>, ok: string) {
    setBusy(true);
    setNotice(null);
    try {
      await fn();
      setNotice({ tone: "success", text: ok });
    } catch (err) {
      setNotice({ tone: "error", text: err instanceof ApiError ? err.message : "Action failed" });
    } finally {
      setBusy(false);
    }
  }

  async function addSection(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!selectedVersionId) return;
    const form = new FormData(e.currentTarget);
    const el = e.currentTarget;
    await run(async () => {
      await api.addSurveySection(token, selectedVersionId, {
        code: String(form.get("code")).trim(),
        title: String(form.get("title")).trim(),
        description: form.get("description") ? String(form.get("description")).trim() : null,
        sortOrder: form.get("sortOrder") ? Number(form.get("sortOrder")) : 0,
        scoringModel: (form.get("scoringModel") as SurveyScoringModel) || null,
        weight: form.get("weight") ? Number(form.get("weight")) : 1,
      });
      el.reset();
      await loadDetail();
    }, "Section added.");
  }

  async function addQuestion(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!selectedVersionId) return;
    const form = new FormData(e.currentTarget);
    const type = String(form.get("questionType"));
    const config: Record<string, unknown> = {};
    if (type === "rating" || type === "matrix_rating") {
      config.min = Number(form.get("min") || 1);
      config.max = Number(form.get("max") || 5);
    }
    const el = e.currentTarget;
    await run(async () => {
      await api.addSurveyQuestion(token, selectedVersionId, {
        sectionId: form.get("sectionId") ? String(form.get("sectionId")) : null,
        code: String(form.get("code")).trim(),
        text: String(form.get("text")).trim(),
        questionType: type,
        isRequired: form.get("isRequired") === "on",
        config,
        sortOrder: form.get("sortOrder") ? Number(form.get("sortOrder")) : 0,
        weight: form.get("weight") ? Number(form.get("weight")) : 1,
      });
      el.reset();
      setQuestionType("rating");
      await loadDetail();
    }, "Question added.");
  }

  async function addOption(questionId: string, e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const el = e.currentTarget;
    await run(async () => {
      await api.addSurveyOption(token, questionId, {
        code: String(form.get("code")).trim(),
        label: String(form.get("label")).trim(),
        score: form.get("score") ? Number(form.get("score")) : null,
        sortOrder: form.get("sortOrder") ? Number(form.get("sortOrder")) : 0,
      });
      el.reset();
      await loadDetail();
    }, "Option added.");
  }

  async function addMatrixRow(questionId: string, e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const el = e.currentTarget;
    await run(async () => {
      await api.addSurveyMatrixRow(token, questionId, {
        code: String(form.get("code")).trim(),
        label: String(form.get("label")).trim(),
        sortOrder: form.get("sortOrder") ? Number(form.get("sortOrder")) : 0,
      });
      el.reset();
      await loadDetail();
    }, "Matrix statement row added.");
  }

  async function addBranchingRule(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!selectedVersionId) return;
    const form = new FormData(e.currentTarget);
    const rawVal = form.get("conditionValue");
    let conditionValue: unknown = rawVal ? String(rawVal).trim() : null;
    const op = form.get("conditionOperator") as BranchConditionOperator;

    if (op === "equals" || op === "greater_than" || op === "less_than") {
      const num = Number(conditionValue);
      if (!Number.isNaN(num) && String(rawVal).trim() !== "") {
        conditionValue = num;
      }
    } else if (op === "in" || op === "not_in") {
      conditionValue = String(rawVal)
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
    }

    const targetAction = form.get("targetAction") as BranchTargetAction;
    const el = e.currentTarget;

    await run(async () => {
      await api.addSurveyBranchingRule(token, selectedVersionId, {
        sourceQuestionId: String(form.get("sourceQuestionId")),
        conditionOperator: op,
        conditionValue,
        targetAction,
        targetQuestionId: targetAction === "jump_to_question" ? String(form.get("targetQuestionId")) : null,
        targetSectionId: targetAction === "jump_to_section" ? String(form.get("targetSectionId")) : null,
        priority: form.get("priority") ? Number(form.get("priority")) : 0,
      });
      el.reset();
      const rules = await api.surveyBranchingRules(token, selectedVersionId);
      setBranchingRules(rules);
    }, "Branching rule registered.");
  }

  async function deleteBranchingRule(ruleId: string) {
    if (!selectedVersionId) return;
    await run(async () => {
      await api.deleteSurveyBranchingRule(token, selectedVersionId, ruleId);
      const rules = await api.surveyBranchingRules(token, selectedVersionId);
      setBranchingRules(rules);
    }, "Branching rule deleted.");
  }

  async function createToken(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!selectedVersionId) return;
    const form = new FormData(e.currentTarget);
    const el = e.currentTarget;

    await run(async () => {
      const res = await api.createSurveyDistributionToken(token, selectedVersionId, {
        channel: (form.get("channel") as TokenDistributionChannel) || "link",
        recipientLabel: form.get("recipientLabel") ? String(form.get("recipientLabel")).trim() : null,
        maxUses: form.get("maxUses") ? Number(form.get("maxUses")) : null,
        expiresAt: form.get("expiresAt") ? new Date(String(form.get("expiresAt"))).toISOString() : null,
      });
      setNewlyCreatedToken(res);
      el.reset();
      const tokens = await api.surveyDistributionTokens(token, selectedVersionId);
      setDistributionTokens(tokens);
    }, "Distribution token minted.");
  }

  async function revokeToken(tokenId: string) {
    if (!window.confirm("Revoke this token? It will immediately stop accepting new public responses.")) return;
    await run(async () => {
      await api.revokeSurveyDistributionToken(token, tokenId);
      const tokens = await api.surveyDistributionTokens(token, selectedVersionId);
      setDistributionTokens(tokens);
    }, "Token revoked.");
  }

  async function addTranslation(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!selectedVersionId) return;
    const form = new FormData(e.currentTarget);
    const el = e.currentTarget;

    await run(async () => {
      await api.upsertSurveyTranslation(token, selectedVersionId, {
        locale: String(form.get("locale")).trim(),
        entityType: form.get("entityType") as TranslationEntityType,
        entityId: String(form.get("entityId")).trim(),
        fieldName: String(form.get("fieldName")).trim(),
        translatedText: String(form.get("translatedText")).trim(),
      });
      el.reset();
      const trans = await api.surveyTranslations(token, selectedVersionId);
      setTranslations(trans);
    }, "Translation snapshot saved.");
  }

  async function deleteTranslation(translationId: string) {
    if (!selectedVersionId) return;
    await run(async () => {
      await api.deleteSurveyTranslation(token, selectedVersionId, translationId);
      const trans = await api.surveyTranslations(token, selectedVersionId);
      setTranslations(trans);
    }, "Translation removed.");
  }

  async function publish() {
    if (!code || !selectedVersion) return;
    await run(async () => {
      await api.publishSurveyVersion(token, code, selectedVersion.versionNumber);
      await loadSurvey();
      await loadDetail();
    }, "Version published.");
  }

  async function retire() {
    if (!code || !selectedVersion) return;
    if (!window.confirm("Retire this published version? It can no longer receive new assignments or token submissions.")) return;
    await run(async () => {
      await api.retireSurveyVersion(token, code, selectedVersion.versionNumber);
      await loadSurvey();
      await loadDetail();
    }, "Version retired.");
  }

  async function createDraft() {
    if (!code) return;
    await run(async () => {
      const v = await api.createSurveyVersion(token, code);
      await loadSurvey();
      setSelectedVersionId(v.id);
    }, "Draft version created.");
  }

  async function assign(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!code) return;
    const form = new FormData(e.currentTarget);
    const el = e.currentTarget;
    await run(async () => {
      await api.createSurveyAssignment(token, {
        surveyDefinitionCode: code,
        respondentUserId: String(form.get("respondentUserId")),
        dueAt: form.get("dueAt") ? new Date(String(form.get("dueAt")) + "T23:59:59").toISOString() : null,
      });
      el.reset();
    }, "Survey assigned.");
  }

  if (loading) return <Spinner label="Loading survey…" />;
  if (error) {
    return (
      <div className="space-y-3">
        <Alert tone="error">{error}</Alert>
        <Button variant="secondary" onClick={() => navigate("/surveys")}>
          Back to surveys
        </Button>
      </div>
    );
  }
  if (!survey) return null;

  const ruleColumns: Column<SurveyBranchingRule>[] = [
    {
      header: "Source Question",
      cell: (r) => {
        const q = detail?.questions.find((x) => x.id === r.sourceQuestionId);
        return <span>{q ? `${q.code} (${q.text.slice(0, 30)}…)` : r.sourceQuestionId}</span>;
      },
    },
    {
      header: "Condition",
      cell: (r) => (
        <Badge>
          {r.conditionOperator} {r.conditionValue !== null && r.conditionValue !== undefined ? JSON.stringify(r.conditionValue) : ""}
        </Badge>
      ),
    },
    {
      header: "Target Action",
      cell: (r) => {
        if (r.targetAction === "end_survey") return <StatusPill tone="danger">End Survey</StatusPill>;
        if (r.targetAction === "jump_to_question") {
          const q = detail?.questions.find((x) => x.id === r.targetQuestionId);
          return <span>Jump to Q: <strong>{q?.code ?? r.targetQuestionId}</strong></span>;
        }
        if (r.targetAction === "jump_to_section") {
          const s = detail?.sections.find((x) => x.id === r.targetSectionId);
          return <span>Jump to Sec: <strong>{s?.title ?? r.targetSectionId}</strong></span>;
        }
        return <span>{r.targetAction}</span>;
      },
    },
    {
      header: "Priority",
      cell: (r) => <span className="font-mono">{r.priority}</span>,
    },
    {
      header: "Action",
      cell: (r) =>
        isDraft && canManage ? (
          <Button variant="ghost" className="text-xs text-red-600 hover:text-red-700" onClick={() => deleteBranchingRule(r.id)}>
            Delete
          </Button>
        ) : null,
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title={survey.definition.name}
        subtitle={`${survey.definition.description ?? survey.definition.code} · Scoring Model: ${selectedVersion?.scoringModel?.toUpperCase() ?? "SUM"} · Default Locale: ${selectedVersion?.defaultLocale ?? "id-ID"}`}
        actions={
          <div className="flex gap-2">
            <Button variant="secondary" onClick={() => navigate("/surveys")}>
              Back to surveys
            </Button>
          </div>
        }
      />

      {notice && (
        <Alert tone={notice.tone === "info" ? "info" : notice.tone}>{notice.text}</Alert>
      )}

      {/* Version selector bar */}
      <Card className="flex flex-wrap items-end justify-between gap-3 bg-slate-50">
        <div className="flex flex-wrap items-end gap-3">
          <div className="w-64">
            <Field label="Selected Version">
              <Select value={selectedVersionId} onChange={(e) => setSelectedVersionId(e.target.value)}>
                {survey.versions.map((v) => (
                  <option key={v.id} value={v.id}>
                    v{v.versionNumber} — {v.status.toUpperCase()}
                    {v.isCurrent ? " (current published)" : ""}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          {selectedVersion && (
            <div className="pb-1.5">
              <StatusPill tone={versionTone(selectedVersion.status)}>{selectedVersion.status.toUpperCase()}</StatusPill>
            </div>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {canManage && (
            <Button variant="secondary" disabled={busy} onClick={createDraft}>
              New draft version
            </Button>
          )}
          {isDraft && canManage && (
            <Button disabled={busy} onClick={publish}>
              Publish version
            </Button>
          )}
          {isPublished && canManage && (
            <Button variant="secondary" disabled={busy} onClick={retire}>
              Retire version
            </Button>
          )}
        </div>
      </Card>

      {/* Tab Navigation */}
      <div className="border-b border-slate-200">
        <nav className="-mb-px flex space-x-6">
          {[
            { id: "questions", label: `Questions (${detail?.questions.length ?? 0})` },
            { id: "sections", label: `Sections (${detail?.sections.length ?? 0})` },
            { id: "branching", label: `Branching Rules (${branchingRules.length})` },
            { id: "tokens", label: "Distribution Tokens" },
            { id: "translations", label: "Translations" },
            { id: "analytics", label: "Analytics Overview" },
            { id: "benchmark", label: "Benchmarking" },
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as typeof activeTab)}
              className={`border-b-2 py-2 px-1 text-sm font-medium transition-colors ${
                activeTab === tab.id
                  ? "border-slate-900 text-slate-900 font-semibold"
                  : "border-transparent text-slate-500 hover:border-slate-300 hover:text-slate-700"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </nav>
      </div>

      {tabLoading && <Spinner label="Loading tab data…" />}

      {/* TAB 1: QUESTIONS & MATRIX ROWS */}
      {activeTab === "questions" && (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          <div className="space-y-4 lg:col-span-2">
            <Card>
              <h2 className="mb-3 text-sm font-semibold text-slate-800">Questions & Matrix Items</h2>
              {!detail || detail.questions.length === 0 ? (
                <EmptyState title="No questions authored yet" description="Create questions using the form below." />
              ) : (
                <ol className="space-y-4">
                  {detail.questions.map((q, i) => (
                    <li key={q.id} className="rounded border border-slate-200 p-3 bg-white shadow-sm">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-sm font-medium text-slate-900">
                          {i + 1}. {q.text}
                        </span>
                        <div className="flex shrink-0 items-center gap-1">
                          <Badge>{q.questionType}</Badge>
                          {q.weight !== 1 && <Badge>weight {q.weight}</Badge>}
                          {q.isRequired && <StatusPill tone="warning">required</StatusPill>}
                        </div>
                      </div>
                      <div className="mt-0.5 text-xs text-slate-400 font-mono">
                        Code: {q.code} {q.sectionId ? `· Section ID: ${q.sectionId}` : ""}
                      </div>

                      {/* Rating details */}
                      {q.questionType === "rating" && (
                        <div className="mt-1 text-xs text-slate-500">
                          Scale: {String(q.config.min ?? 1)} – {String(q.config.max ?? 5)}
                        </div>
                      )}

                      {/* Choice Options */}
                      {(q.questionType === "single_choice" || q.questionType === "multiple_choice" || q.questionType === "matrix_single_choice") && (
                        <ChoiceOptions
                          question={q}
                          editable={!!isDraft && canManage}
                          busy={busy}
                          onAdd={(ev) => addOption(q.id, ev)}
                        />
                      )}

                      {/* Matrix Rows */}
                      {(q.questionType === "matrix_single_choice" || q.questionType === "matrix_rating") && (
                        <MatrixRows
                          question={q}
                          editable={!!isDraft && canManage}
                          busy={busy}
                          onAdd={(ev) => addMatrixRow(q.id, ev)}
                        />
                      )}
                    </li>
                  ))}
                </ol>
              )}

              {isDraft && canManage && (
                <form onSubmit={addQuestion} className="mt-6 space-y-3 border-t border-slate-200 pt-4">
                  <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500">Add Question</h3>
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                    <Input name="code" placeholder="Code (e.g. overall_sat)" required />
                    <Select name="questionType" value={questionType} onChange={(e) => setQuestionType(e.target.value)}>
                      {TYPES.map((t) => (
                        <option key={t.value} value={t.value}>
                          {t.label}
                        </option>
                      ))}
                    </Select>
                    <Select name="sectionId" defaultValue="">
                      <option value="">(No Section / Root)</option>
                      {detail?.sections.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.title} ({s.code})
                        </option>
                      ))}
                    </Select>
                  </div>

                  <Input name="text" placeholder="Question statement text" required />

                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                    <Input name="weight" type="number" step="0.1" defaultValue="1" placeholder="Weight multiplier (default 1)" />
                    <Input name="sortOrder" type="number" defaultValue={detail?.questions.length ?? 0} placeholder="Sort Order" />
                    <label className="flex items-center gap-2 text-sm text-slate-700 pt-2">
                      <input type="checkbox" name="isRequired" defaultChecked /> Required field
                    </label>
                  </div>

                  {(questionType === "rating" || questionType === "matrix_rating") && (
                    <div className="grid grid-cols-2 gap-2 max-w-xs">
                      <Input name="min" type="number" defaultValue="1" placeholder="Min (1)" />
                      <Input name="max" type="number" defaultValue="5" placeholder="Max (5)" />
                    </div>
                  )}

                  <Button type="submit" disabled={busy}>
                    Add Question
                  </Button>
                </form>
              )}
            </Card>
          </div>

          {/* Internal Assignment Sidebar */}
          <div className="space-y-4">
            <Card>
              <h2 className="mb-2 text-sm font-semibold text-slate-800">Assign Authenticated Survey</h2>
              <p className="mb-3 text-xs text-slate-500">
                Direct assignment to an internal user. To distribute anonymously or via public link, use the Distribution Tokens tab.
              </p>
              {!survey.versions.some((v) => v.status === "published") ? (
                <p className="text-xs text-amber-600">Publish a survey version first before assigning.</p>
              ) : (
                <form onSubmit={assign} className="space-y-3">
                  <Field label="Respondent User" required>
                    <Select name="respondentUserId" required defaultValue="">
                      <option value="" disabled>Select internal user…</option>
                      {users.map((u) => (
                        <option key={u.id} value={u.id}>
                          {u.fullName} ({u.email})
                        </option>
                      ))}
                    </Select>
                  </Field>
                  <Field label="Due Date" hint="Optional">
                    <Input name="dueAt" type="date" />
                  </Field>
                  <Button type="submit" disabled={busy} className="w-full">
                    Assign Survey
                  </Button>
                </form>
              )}
            </Card>
          </div>
        </div>
      )}

      {/* TAB 2: SECTIONS */}
      {activeTab === "sections" && (
        <Card className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-slate-800">Survey Sections & Dimension Weights</h2>
          </div>
          {!detail?.sections || detail.sections.length === 0 ? (
            <EmptyState title="No sections defined" description="Sections group questions and enable section-level scoring models." />
          ) : (
            <div className="space-y-2">
              {detail.sections.map((s) => (
                <div key={s.id} className="flex items-center justify-between p-3 rounded border border-slate-200 bg-white">
                  <div>
                    <span className="font-semibold text-slate-900 text-sm">{s.title}</span>
                    <span className="ml-2 font-mono text-xs text-slate-400">({s.code})</span>
                    {s.description && <p className="text-xs text-slate-500 mt-0.5">{s.description}</p>}
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge>Scoring: {s.scoringModel ?? "inherit"}</Badge>
                    <Badge>Weight: {s.weight}</Badge>
                  </div>
                </div>
              ))}
            </div>
          )}

          {isDraft && canManage && (
            <form onSubmit={addSection} className="space-y-3 border-t border-slate-200 pt-4">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500">Add Section</h3>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                <Input name="code" placeholder="Code (e.g. responsiveness)" required />
                <Input name="title" placeholder="Title (e.g. Kualitas Ketanggapan)" required />
              </div>
              <Input name="description" placeholder="Optional description" />
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                <Select name="scoringModel" defaultValue="">
                  <option value="">(Inherit Version Scoring)</option>
                  {SCORING_MODELS.map((m) => (
                    <option key={m.value} value={m.value}>
                      {m.label}
                    </option>
                  ))}
                </Select>
                <Input name="weight" type="number" step="0.1" defaultValue="1" placeholder="Weight multiplier" />
                <Input name="sortOrder" type="number" defaultValue={detail?.sections.length ?? 0} placeholder="Sort Order" />
              </div>
              <Button type="submit" disabled={busy}>
                Add Section
              </Button>
            </form>
          )}
        </Card>
      )}

      {/* TAB 3: BRANCHING RULES */}
      {activeTab === "branching" && (
        <Card className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-sm font-semibold text-slate-800">Forward-Only Branching Rules</h2>
              <p className="text-xs text-slate-500">
                Configure deterministic question skipping based on conditional logic. Backwards branching and cycles are rejected.
              </p>
            </div>
          </div>

          <DataTable
            columns={ruleColumns}
            rows={branchingRules}
            keyOf={(r) => r.id}
            empty={<EmptyState title="No branching rules defined" description="Surveys follow the default sequential question order." />}
          />

          {isDraft && canManage && (
            <form onSubmit={addBranchingRule} className="space-y-3 border-t border-slate-200 pt-4">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500">Add Branching Rule</h3>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                <Field label="Source Question" required>
                  <Select
                    name="sourceQuestionId"
                    value={selectedSourceQuestionId}
                    onChange={(e) => setSelectedSourceQuestionId(e.target.value)}
                    required
                  >
                    <option value="" disabled>Select source question…</option>
                    {detail?.questions.map((q) => (
                      <option key={q.id} value={q.id}>
                        {q.code} — {q.text.slice(0, 30)}…
                      </option>
                    ))}
                  </Select>
                </Field>

                <Field label="Condition Operator" required>
                  <Select name="conditionOperator" required defaultValue="equals">
                    {CONDITION_OPERATORS.map((op) => (
                      <option key={op.value} value={op.value}>
                        {op.label}
                      </option>
                    ))}
                  </Select>
                </Field>

                <Field label="Condition Value" hint="Value to match against">
                  <Input name="conditionValue" placeholder="e.g. 5, option_code, yes" />
                </Field>
              </div>

              <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                <Field label="Target Action" required>
                  <Select
                    name="targetAction"
                    value={selectedTargetAction}
                    onChange={(e) => setSelectedTargetAction(e.target.value as BranchTargetAction)}
                    required
                  >
                    {TARGET_ACTIONS.map((ta) => (
                      <option key={ta.value} value={ta.value}>
                        {ta.label}
                      </option>
                    ))}
                  </Select>
                </Field>

                {selectedTargetAction === "jump_to_question" && (
                  <Field label="Target Question" required>
                    <Select name="targetQuestionId" required defaultValue="">
                      <option value="" disabled>Select forward target question…</option>
                      {detail?.questions.map((q) => (
                        <option key={q.id} value={q.id}>
                          {q.code} — {q.text.slice(0, 30)}…
                        </option>
                      ))}
                    </Select>
                  </Field>
                )}

                {selectedTargetAction === "jump_to_section" && (
                  <Field label="Target Section" required>
                    <Select name="targetSectionId" required defaultValue="">
                      <option value="" disabled>Select forward target section…</option>
                      {detail?.sections.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.title} ({s.code})
                        </option>
                      ))}
                    </Select>
                  </Field>
                )}

                <Field label="Priority" hint="Higher priority evaluated first">
                  <Input name="priority" type="number" defaultValue="10" />
                </Field>
              </div>

              <Button type="submit" disabled={busy}>
                Add Branching Rule
              </Button>
            </form>
          )}
        </Card>
      )}

      {/* TAB 4: DISTRIBUTION TOKENS */}
      {activeTab === "tokens" && (
        <Card className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-sm font-semibold text-slate-800">Public & Anonymous Distribution Tokens</h2>
              <p className="text-xs text-slate-500">
                Shareable links for external / anonymous respondents with SHA-256 token validation and zero identity leakage.
              </p>
            </div>
          </div>

          {newlyCreatedToken && (
            <Alert tone="success">
              <div className="space-y-1">
                <p className="font-semibold">Token Berhasil Dibuat!</p>
                <p className="text-xs font-mono break-all bg-white p-2 rounded border border-green-300">
                  Public URL: {window.location.origin}/public/surveys/{newlyCreatedToken.token}
                </p>
                <p className="text-xs text-slate-600">Simpan URL ini sekarang. Token rahasia hanya ditampilkan sekali.</p>
              </div>
            </Alert>
          )}

          <div className="space-y-2">
            {distributionTokens.length === 0 ? (
              <EmptyState title="No distribution tokens generated" description="Create a token to distribute the survey to external respondents." />
            ) : (
              distributionTokens.map((t) => (
                <div key={t.id} className="flex flex-wrap items-center justify-between p-3 rounded border border-slate-200 bg-white">
                  <div>
                    <span className="font-medium text-slate-900 text-sm">
                      {t.recipientLabel ?? "Public Anonymous Link"}
                    </span>
                    <span className="ml-2">
                      <Badge>{t.channel.toUpperCase()}</Badge>
                    </span>
                    <div className="text-xs text-slate-400 mt-0.5">
                      Uses: {t.usedCount} / {t.maxUses ?? "Unlimited"} · Expires: {t.expiresAt ? new Date(t.expiresAt).toLocaleDateString() : "Never"}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {t.revokedAt ? (
                      <StatusPill tone="danger">Revoked</StatusPill>
                    ) : (
                      <>
                        <StatusPill tone="success">Active</StatusPill>
                        {canManage && (
                          <Button variant="ghost" className="text-xs text-red-600" onClick={() => revokeToken(t.id)}>
                            Revoke
                          </Button>
                        )}
                      </>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>

          {canManage && (
            <form onSubmit={createToken} className="space-y-3 border-t border-slate-200 pt-4">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500">Mint Distribution Token</h3>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                <Field label="Channel">
                  <Select name="channel" defaultValue="link">
                    <option value="link">Public Web Link</option>
                    <option value="email">Email Campaign</option>
                    <option value="sms">SMS Dispatch</option>
                    <option value="qr">QR Code Scan</option>
                  </Select>
                </Field>
                <Field label="Recipient / Campaign Label">
                  <Input name="recipientLabel" placeholder="e.g. Pelanggan Q3 Wilayah Barat" />
                </Field>
                <Field label="Max Uses (Quota)">
                  <Input name="maxUses" type="number" placeholder="Leave empty for unlimited" />
                </Field>
              </div>
              <Field label="Expiry Date">
                <Input name="expiresAt" type="date" />
              </Field>
              <Button type="submit" disabled={busy}>
                Generate Public Token
              </Button>
            </form>
          )}
        </Card>
      )}

      {/* TAB 5: TRANSLATIONS */}
      {activeTab === "translations" && (
        <Card className="space-y-4">
          <div>
            <h2 className="text-sm font-semibold text-slate-800">Multi-Language Survey Translations</h2>
            <p className="text-xs text-slate-500">
              Manage localized content snapshots for internationalized survey distribution.
            </p>
          </div>

          <div className="space-y-2">
            {translations.length === 0 ? (
              <EmptyState title="No custom translations recorded" description="The survey uses its default base language." />
            ) : (
              translations.map((tr) => (
                <div key={tr.id} className="flex items-center justify-between p-3 rounded border border-slate-200 bg-white">
                  <div>
                    <span className="font-semibold text-slate-900 text-sm">[{tr.locale}] {tr.fieldName}:</span>{" "}
                    <span className="text-sm text-slate-700">"{tr.translatedText}"</span>
                    <div className="text-xs text-slate-400 font-mono mt-0.5">
                      Entity: {tr.entityType} ({tr.entityId})
                    </div>
                  </div>
                  {isDraft && canManage && (
                    <Button variant="ghost" className="text-xs text-red-600" onClick={() => deleteTranslation(tr.id)}>
                      Remove
                    </Button>
                  )}
                </div>
              ))
            )}
          </div>

          {isDraft && canManage && (
            <form onSubmit={addTranslation} className="space-y-3 border-t border-slate-200 pt-4">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500">Upsert Translation</h3>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                <Field label="Locale" required>
                  <Select name="locale" defaultValue="en-US">
                    <option value="en-US">English (en-US)</option>
                    <option value="id-ID">Bahasa Indonesia (id-ID)</option>
                  </Select>
                </Field>
                <Field label="Entity Type" required>
                  <Select name="entityType" defaultValue="question">
                    <option value="definition">Survey Definition</option>
                    <option value="section">Section</option>
                    <option value="question">Question</option>
                    <option value="option">Choice Option</option>
                    <option value="matrix_row">Matrix Statement Row</option>
                  </Select>
                </Field>
                <Field label="Field Name" required>
                  <Select name="fieldName" defaultValue="text">
                    <option value="name">Name / Title</option>
                    <option value="description">Description</option>
                    <option value="text">Question Text</option>
                    <option value="label">Option / Row Label</option>
                  </Select>
                </Field>
              </div>
              <Field label="Target Entity ID (UUID)" required>
                <Input name="entityId" placeholder="Paste Question/Section/Option UUID" required />
              </Field>
              <Field label="Translated Text" required>
                <Textarea name="translatedText" rows={2} placeholder="Translated string..." required />
              </Field>
              <Button type="submit" disabled={busy}>
                Save Translation
              </Button>
            </form>
          )}
        </Card>
      )}

      {/* TAB 6: ANALYTICS */}
      {activeTab === "analytics" && (
        <div className="space-y-4">
          {!analyticsOverview ? (
            <EmptyState title="No analytics data available" description="Respondents must submit surveys before metrics appear." />
          ) : (
            <>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <Card>
                  <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Completion Rate</p>
                  <p className="mt-1 text-2xl font-bold text-slate-900">{analyticsOverview.completionRate}%</p>
                </Card>
                <Card>
                  <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Total Assignments</p>
                  <p className="mt-1 text-2xl font-bold text-slate-900">{analyticsOverview.assignmentCount}</p>
                </Card>
                <Card>
                  <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Submitted Responses</p>
                  <p className="mt-1 text-2xl font-bold text-slate-900">{analyticsOverview.submittedCount}</p>
                </Card>
                <Card>
                  <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Average Score</p>
                  <p className="mt-1 text-2xl font-bold text-slate-900">
                    {analyticsOverview.averageTotalScore ?? "N/A"}
                  </p>
                </Card>
              </div>

              {analyticsOverview.nps && (
                <Card>
                  <h3 className="text-sm font-semibold text-slate-800 mb-3">NPS (Net Promoter Score) Breakdown</h3>
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-4 items-center">
                    <div className="text-center p-4 bg-slate-50 rounded">
                      <p className="text-xs text-slate-500 uppercase">NPS Score</p>
                      <p className="text-3xl font-extrabold text-slate-900">{analyticsOverview.nps.score}</p>
                    </div>
                    <div className="text-center p-4 bg-green-50 rounded">
                      <p className="text-xs text-green-700 uppercase">Promoters (9-10)</p>
                      <p className="text-xl font-bold text-green-800">{analyticsOverview.nps.promoters}</p>
                    </div>
                    <div className="text-center p-4 bg-amber-50 rounded">
                      <p className="text-xs text-amber-700 uppercase">Passives (7-8)</p>
                      <p className="text-xl font-bold text-amber-800">{analyticsOverview.nps.passives}</p>
                    </div>
                    <div className="text-center p-4 bg-red-50 rounded">
                      <p className="text-xs text-red-700 uppercase">Detractors (0-6)</p>
                      <p className="text-xl font-bold text-red-800">{analyticsOverview.nps.detractors}</p>
                    </div>
                  </div>
                </Card>
              )}

              <Card>
                <h3 className="text-sm font-semibold text-slate-800 mb-3">Section Performance Breakdown</h3>
                <div className="space-y-2">
                  {analyticsOverview.sectionScores.map((sec, idx) => (
                    <div key={idx} className="flex items-center justify-between p-2 rounded bg-slate-50 text-sm">
                      <span className="font-medium text-slate-800">{sec.sectionTitle ?? sec.sectionCode ?? "Overall"}</span>
                      <div className="flex gap-3 text-xs">
                        <span>Avg Score: <strong>{sec.averageScore ?? "—"}</strong></span>
                        <span>Percentage: <strong>{sec.averagePercentage ? `${sec.averagePercentage}%` : "—"}</strong></span>
                        <span>Respondents: <strong>{sec.respondentCount}</strong></span>
                      </div>
                    </div>
                  ))}
                </div>
              </Card>
            </>
          )}
        </div>
      )}

      {/* TAB 7: BENCHMARKING */}
      {activeTab === "benchmark" && (
        <Card className="space-y-4">
          <h2 className="text-sm font-semibold text-slate-800">Cross-Survey Operational Benchmarking</h2>
          {!benchmarkResult || benchmarkResult.benchmarks.length === 0 ? (
            <EmptyState title="No benchmark clusters detected" description="Sufficient multi-segment responses are required for clustering." />
          ) : (
            <div className="space-y-3">
              {benchmarkResult.benchmarks.map((bm, idx) => (
                <div key={idx} className="p-3 rounded border border-slate-200 bg-white flex items-center justify-between">
                  <div>
                    <span className="font-semibold text-slate-900 text-sm">{bm.label}</span>
                    <span className="ml-2"><Badge>{bm.dimension}</Badge></span>
                  </div>
                  <div className="flex gap-4 text-xs">
                    <span>Responses: <strong>{bm.responseCount}</strong></span>
                    <span>Completion: <strong>{bm.completionRate}%</strong></span>
                    <span>Avg Score: <strong>{bm.averageScore ?? "—"}</strong></span>
                    {bm.averageNps !== null && <span>NPS: <strong>{bm.averageNps}</strong></span>}
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>
      )}
    </div>
  );
}

function ChoiceOptions({
  question,
  editable,
  busy,
  onAdd,
}: {
  question: SurveyQuestion & { options: SurveyQuestionOption[] };
  editable: boolean;
  busy: boolean;
  onAdd: (e: FormEvent<HTMLFormElement>) => void;
}) {
  return (
    <div className="mt-2 border-t border-slate-100 pt-2">
      <div className="text-xs font-medium text-slate-500 mb-1">Answer Choices:</div>
      {question.options.length === 0 ? (
        <p className="text-xs text-slate-400">No choice options added yet.</p>
      ) : (
        <ul className="space-y-1 text-xs text-slate-700">
          {question.options.map((o) => (
            <li key={o.id} className="flex items-center gap-2">
              <span className="font-semibold">• {o.label}</span>
              <span className="text-slate-400 font-mono">[{o.code}]</span>
              {o.score !== null && <Badge className="text-[10px]">Score: {o.score}</Badge>}
            </li>
          ))}
        </ul>
      )}
      {editable && (
        <form onSubmit={onAdd} className="mt-2 flex flex-wrap items-center gap-1">
          <input name="code" placeholder="Code (e.g. opt_1)" required className="w-24 rounded border border-slate-300 px-2 py-1 text-xs" />
          <input name="label" placeholder="Choice Label Text" required className="w-36 rounded border border-slate-300 px-2 py-1 text-xs" />
          <input name="score" type="number" placeholder="Score" className="w-16 rounded border border-slate-300 px-2 py-1 text-xs" />
          <Button type="submit" variant="ghost" disabled={busy} className="text-xs">
            + Add Option
          </Button>
        </form>
      )}
    </div>
  );
}

function MatrixRows({
  question,
  editable,
  busy,
  onAdd,
}: {
  question: SurveyQuestion & { matrixRows: SurveyMatrixRow[] };
  editable: boolean;
  busy: boolean;
  onAdd: (e: FormEvent<HTMLFormElement>) => void;
}) {
  return (
    <div className="mt-2 border-t border-slate-100 pt-2">
      <div className="text-xs font-medium text-slate-500 mb-1">Matrix Statement Rows:</div>
      {!question.matrixRows || question.matrixRows.length === 0 ? (
        <p className="text-xs text-slate-400">No matrix rows added yet.</p>
      ) : (
        <ul className="space-y-1 text-xs text-slate-700">
          {question.matrixRows.map((r) => (
            <li key={r.id} className="flex items-center gap-2">
              <span className="font-semibold">— {r.label}</span>
              <span className="text-slate-400 font-mono">[{r.code}]</span>
            </li>
          ))}
        </ul>
      )}
      {editable && (
        <form onSubmit={onAdd} className="mt-2 flex flex-wrap items-center gap-1">
          <input name="code" placeholder="Row Code (e.g. speed)" required className="w-28 rounded border border-slate-300 px-2 py-1 text-xs" />
          <input name="label" placeholder="Statement Row Label" required className="w-48 rounded border border-slate-300 px-2 py-1 text-xs" />
          <Button type="submit" variant="ghost" disabled={busy} className="text-xs">
            + Add Matrix Row
          </Button>
        </form>
      )}
    </div>
  );
}
