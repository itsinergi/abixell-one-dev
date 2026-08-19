/**
 * Checkpoint 1D.2 — Survey admin detail: versions, question authoring (draft
 * only), publish/retire, and assignment. Form-driven (no builder canvas).
 * Published versions are read-only in the UI (backend also enforces).
 */
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useAuth } from "../../auth/AuthContext";
import {
  api,
  ApiError,
  type SurveyDetail,
  type SurveyQuestion,
  type SurveyQuestionOption,
  type SurveyVersionDetail,
} from "../../lib/api";
import {
  Alert,
  Badge,
  Button,
  Card,
  Field,
  Input,
  PageHeader,
  Select,
  Spinner,
  StatusPill,
} from "../../shell/components/ui";

const TYPES = [
  { value: "rating", label: "Rating" },
  { value: "single_choice", label: "Single choice" },
  { value: "long_text", label: "Long text" },
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
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [questionType, setQuestionType] = useState("rating");

  const loadSurvey = useCallback(async () => {
    if (!code) return;
    setLoading(true);
    setError(null);
    try {
      const s = await api.survey(token, code);
      setSurvey(s);
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
      setDetail(await api.surveyVersionDetail(token, selectedVersionId));
    } catch (err) {
      setNotice({ tone: "error", text: err instanceof ApiError ? err.message : "Failed to load version" });
    }
  }, [token, selectedVersionId]);

  useEffect(() => {
    loadDetail();
  }, [loadDetail]);

  // Users for the assignment picker (admin has user.read).
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

  async function addQuestion(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!selectedVersionId) return;
    const form = new FormData(e.currentTarget);
    const type = String(form.get("questionType"));
    const config: Record<string, unknown> = {};
    if (type === "rating") {
      config.min = Number(form.get("min"));
      config.max = Number(form.get("max"));
    }
    const el = e.currentTarget;
    await run(async () => {
      await api.addSurveyQuestion(token, selectedVersionId, {
        code: String(form.get("code")).trim(),
        text: String(form.get("text")).trim(),
        questionType: type,
        isRequired: form.get("isRequired") === "on",
        config,
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
      });
      el.reset();
      await loadDetail();
    }, "Option added.");
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
    if (!window.confirm("Retire this published version? It can no longer receive new assignments.")) return;
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
  if (error)
    return (
      <div className="space-y-3">
        <Alert tone="error">{error}</Alert>
        <Button variant="secondary" onClick={() => navigate("/surveys")}>
          Back to surveys
        </Button>
      </div>
    );
  if (!survey) return null;

  return (
    <div>
      <PageHeader
        title={survey.definition.name}
        subtitle={survey.definition.description ?? survey.definition.code}
        actions={
          <Button variant="secondary" onClick={() => navigate("/surveys")}>
            Back to surveys
          </Button>
        }
      />

      {notice && (
        <div className="mb-4">
          <Alert tone={notice.tone}>{notice.text}</Alert>
        </div>
      )}

      <div className="mb-4 flex flex-wrap items-end gap-3">
        <div className="w-64">
          <Field label="Version">
            <Select value={selectedVersionId} onChange={(e) => setSelectedVersionId(e.target.value)}>
              {survey.versions.map((v) => (
                <option key={v.id} value={v.id}>
                  v{v.versionNumber} — {v.status}
                  {v.isCurrent ? " (current)" : ""}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        {selectedVersion && <StatusPill tone={versionTone(selectedVersion.status)}>{selectedVersion.status}</StatusPill>}
        <Button variant="secondary" disabled={busy} onClick={createDraft}>
          New draft version
        </Button>
        {isDraft && (
          <Button disabled={busy} onClick={publish}>
            Publish version
          </Button>
        )}
        {isPublished && (
          <Button variant="secondary" disabled={busy} onClick={retire}>
            Retire
          </Button>
        )}
      </div>

      {!isDraft && (
        <p className="mb-4 text-xs text-slate-400">
          {isPublished
            ? "Published versions are read-only. Create a new draft version to make changes."
            : "This version is not a draft and cannot be edited."}
        </p>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {/* Questions */}
        <div className="space-y-4 lg:col-span-2">
          <Card>
            <h2 className="mb-3 text-sm font-semibold text-slate-700">Questions</h2>
            {!detail || detail.questions.length === 0 ? (
              <p className="text-sm text-slate-500">No questions yet.</p>
            ) : (
              <ol className="space-y-3">
                {detail.questions.map((q, i) => (
                  <li key={q.id} className="rounded border border-slate-200 p-3">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-medium text-slate-800">
                        {i + 1}. {q.text}
                      </span>
                      <div className="flex shrink-0 items-center gap-1">
                        <Badge>{q.questionType}</Badge>
                        {q.isRequired && <StatusPill tone="warning">required</StatusPill>}
                      </div>
                    </div>
                    <div className="font-mono text-xs text-slate-400">{q.code}</div>
                    {q.questionType === "rating" && (
                      <div className="mt-1 text-xs text-slate-500">
                        Scale {String(q.config.min ?? "?")}–{String(q.config.max ?? "?")}
                      </div>
                    )}
                    {(q.questionType === "single_choice" || q.questionType === "multiple_choice") && (
                      <ChoiceOptions
                        question={q}
                        editable={!!isDraft}
                        busy={busy}
                        onAdd={(ev) => addOption(q.id, ev)}
                      />
                    )}
                  </li>
                ))}
              </ol>
            )}

            {isDraft && (
              <form onSubmit={addQuestion} className="mt-4 space-y-2 border-t border-slate-100 pt-3">
                <div className="text-xs font-medium text-slate-500">Add question</div>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  <Input name="code" placeholder="code (e.g. overall)" required />
                  <Select name="questionType" value={questionType} onChange={(e) => setQuestionType(e.target.value)}>
                    {TYPES.map((t) => (
                      <option key={t.value} value={t.value}>
                        {t.label}
                      </option>
                    ))}
                  </Select>
                </div>
                <Input name="text" placeholder="Question text" required />
                {questionType === "rating" && (
                  <div className="grid grid-cols-2 gap-2">
                    <Input name="min" type="number" placeholder="min (e.g. 1)" required />
                    <Input name="max" type="number" placeholder="max (e.g. 5)" required />
                  </div>
                )}
                <label className="flex items-center gap-2 text-sm text-slate-600">
                  <input type="checkbox" name="isRequired" /> Required
                </label>
                <Button type="submit" disabled={busy}>
                  Add question
                </Button>
              </form>
            )}
          </Card>
        </div>

        {/* Assignment */}
        <div className="space-y-4">
          <Card>
            <h2 className="mb-2 text-sm font-semibold text-slate-700">Versions</h2>
            <ul className="space-y-1 text-sm">
              {survey.versions.map((v) => (
                <li key={v.id} className="flex items-center justify-between">
                  <span className="text-slate-600">
                    v{v.versionNumber} {v.isCurrent ? "· current" : ""}
                  </span>
                  <StatusPill tone={versionTone(v.status)}>{v.status}</StatusPill>
                </li>
              ))}
            </ul>
          </Card>

          <Card>
            <h2 className="mb-2 text-sm font-semibold text-slate-700">Assign survey</h2>
            {!survey.versions.some((v) => v.status === "published") ? (
              <p className="text-sm text-slate-500">Publish a version before assigning.</p>
            ) : (
              <form onSubmit={assign} className="space-y-2">
                <Field label="Respondent" required>
                  <Select name="respondentUserId" required defaultValue="">
                    <option value="" disabled>
                      Select a user…
                    </option>
                    {users.map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.fullName} ({u.email})
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Due date" hint="Optional">
                  <Input name="dueAt" type="date" />
                </Field>
                <Button type="submit" disabled={busy}>
                  Assign (current published version)
                </Button>
              </form>
            )}
          </Card>
        </div>
      </div>
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
      {question.options.length === 0 ? (
        <p className="text-xs text-slate-400">No options.</p>
      ) : (
        <ul className="text-xs text-slate-600">
          {question.options.map((o) => (
            <li key={o.id}>
              • {o.label} <span className="text-slate-400">({o.code}{o.score !== null ? `, score ${o.score}` : ""})</span>
            </li>
          ))}
        </ul>
      )}
      {editable && (
        <form onSubmit={onAdd} className="mt-2 flex flex-wrap items-center gap-1">
          <input name="code" placeholder="code" required className="w-20 rounded border border-slate-300 px-2 py-1 text-xs" />
          <input name="label" placeholder="Label" required className="w-28 rounded border border-slate-300 px-2 py-1 text-xs" />
          <input name="score" type="number" placeholder="score" className="w-16 rounded border border-slate-300 px-2 py-1 text-xs" />
          <Button type="submit" variant="ghost" disabled={busy}>
            Add option
          </Button>
        </form>
      )}
    </div>
  );
}
