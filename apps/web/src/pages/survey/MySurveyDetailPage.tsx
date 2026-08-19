/**
 * Checkpoint 1D.2 — Respondent survey form (survey.respond). Renders questions
 * from the definition, saves drafts, and submits. A submitted survey is
 * read-only and shows the total score from the assignment. Answers are never
 * cached offline (business data) — failed saves surface real errors.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useAuth } from "../../auth/AuthContext";
import { api, ApiError, type SurveyAnswerInput, type SurveyRespondentView } from "../../lib/api";
import {
  Alert,
  Badge,
  Button,
  Card,
  Field,
  PageHeader,
  Spinner,
  StatusPill,
  Textarea,
} from "../../shell/components/ui";

type LocalAnswer = { valueNumeric?: number | null; valueText?: string | null; optionIds?: string[] };

export function MySurveyDetailPage() {
  const { session } = useAuth();
  const token = session!.accessToken;
  const { assignmentId } = useParams<{ assignmentId: string }>();
  const navigate = useNavigate();

  const [view, setView] = useState<SurveyRespondentView | null>(null);
  const [answers, setAnswers] = useState<Record<string, LocalAnswer>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!assignmentId) return;
    setLoading(true);
    setError(null);
    try {
      const v = await api.surveyAssignment(token, assignmentId);
      setView(v);
      const initial: Record<string, LocalAnswer> = {};
      for (const a of v.answers) {
        initial[a.questionId] = {
          valueNumeric: a.valueNumeric,
          valueText: a.valueText,
          optionIds: a.selectedOptionIds,
        };
      }
      setAnswers(initial);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to load survey");
    } finally {
      setLoading(false);
    }
  }, [token, assignmentId]);

  useEffect(() => {
    load();
  }, [load]);

  const submitted = view?.assignment.status === "submitted";

  const payload = useMemo<SurveyAnswerInput[]>(() => {
    if (!view) return [];
    const out: SurveyAnswerInput[] = [];
    for (const q of view.questions) {
      const a = answers[q.id];
      if (!a) continue;
      if (q.questionType === "rating" && a.valueNumeric != null) {
        out.push({ questionId: q.id, valueNumeric: a.valueNumeric });
      } else if (q.questionType === "single_choice" && a.optionIds && a.optionIds.length === 1) {
        out.push({ questionId: q.id, optionIds: a.optionIds });
      } else if (q.questionType === "long_text" && a.valueText && a.valueText.trim()) {
        out.push({ questionId: q.id, valueText: a.valueText });
      }
    }
    return out;
  }, [view, answers]);

  async function saveDraft() {
    if (!assignmentId) return;
    setBusy(true);
    setNotice(null);
    try {
      await api.saveSurveyAnswers(token, assignmentId, payload);
      setNotice({ tone: "success", text: "Draft saved." });
      await load();
    } catch (err) {
      setNotice({ tone: "error", text: err instanceof ApiError ? err.message : "Save failed" });
    } finally {
      setBusy(false);
    }
  }

  async function submit() {
    if (!assignmentId || !view) return;
    // Client-side required check (backend is authoritative).
    const missing = view.questions.filter((q) => q.isRequired && !payload.some((p) => p.questionId === q.id));
    if (missing.length > 0) {
      setNotice({ tone: "error", text: `Please answer required question(s): ${missing.map((m) => m.text).join(", ")}` });
      return;
    }
    setBusy(true);
    setNotice(null);
    try {
      await api.saveSurveyAnswers(token, assignmentId, payload);
      await api.submitSurvey(token, assignmentId);
      setNotice({ tone: "success", text: "Survey submitted. Thank you!" });
      await load();
    } catch (err) {
      setNotice({ tone: "error", text: err instanceof ApiError ? err.message : "Submit failed" });
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <Spinner label="Loading survey…" />;
  if (error)
    return (
      <div className="space-y-3">
        <Alert tone="error">{error}</Alert>
        <Button variant="secondary" onClick={() => navigate("/my-surveys")}>
          Back to my surveys
        </Button>
      </div>
    );
  if (!view) return null;

  return (
    <div>
      <PageHeader
        title="Survey"
        subtitle={submitted ? "Submitted — thank you for your response." : "Please answer the questions below."}
        actions={
          <Button variant="secondary" onClick={() => navigate("/my-surveys")}>
            Back to my surveys
          </Button>
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <StatusPill tone={submitted ? "success" : "warning"}>{view.assignment.status}</StatusPill>
        {submitted && view.assignment.totalScore != null && (
          <Badge>Total score: {view.assignment.totalScore}</Badge>
        )}
      </div>

      {notice && (
        <div className="mb-4">
          <Alert tone={notice.tone}>{notice.text}</Alert>
        </div>
      )}

      <div className="max-w-2xl space-y-4">
        {view.questions.map((q, i) => {
          const a = answers[q.id] ?? {};
          return (
            <Card key={q.id}>
              <div className="mb-2 text-sm font-medium text-slate-800">
                {i + 1}. {q.text}
                {q.isRequired && <span className="ml-1 text-red-500">*</span>}
              </div>

              {q.questionType === "rating" && (
                <RatingInput
                  min={Number(q.config.min ?? 1)}
                  max={Number(q.config.max ?? 5)}
                  value={a.valueNumeric ?? null}
                  disabled={submitted}
                  onChange={(v) => setAnswers((prev) => ({ ...prev, [q.id]: { valueNumeric: v } }))}
                />
              )}

              {q.questionType === "single_choice" && (
                <div className="space-y-1">
                  {q.options.map((o) => (
                    <label key={o.id} className="flex items-center gap-2 text-sm text-slate-700">
                      <input
                        type="radio"
                        name={`q-${q.id}`}
                        disabled={submitted}
                        checked={(a.optionIds ?? [])[0] === o.id}
                        onChange={() => setAnswers((prev) => ({ ...prev, [q.id]: { optionIds: [o.id] } }))}
                      />
                      {o.label}
                    </label>
                  ))}
                </div>
              )}

              {q.questionType === "long_text" && (
                <Field label="">
                  <Textarea
                    rows={3}
                    disabled={submitted}
                    value={a.valueText ?? ""}
                    onChange={(e) => setAnswers((prev) => ({ ...prev, [q.id]: { valueText: e.target.value } }))}
                  />
                </Field>
              )}
            </Card>
          );
        })}

        {!submitted && (
          <div className="flex items-center gap-2">
            <Button variant="secondary" disabled={busy} onClick={saveDraft}>
              Save draft
            </Button>
            <Button disabled={busy} onClick={submit}>
              {busy ? "Working…" : "Submit"}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

function RatingInput({
  min,
  max,
  value,
  disabled,
  onChange,
}: {
  min: number;
  max: number;
  value: number | null;
  disabled: boolean;
  onChange: (v: number) => void;
}) {
  const scale = [];
  for (let n = min; n <= max; n++) scale.push(n);
  return (
    <div className="flex flex-wrap gap-1.5">
      {scale.map((n) => (
        <button
          key={n}
          type="button"
          disabled={disabled}
          aria-pressed={value === n}
          onClick={() => onChange(n)}
          className={`h-9 w-9 rounded border text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400 ${
            value === n
              ? "border-slate-900 bg-slate-900 text-white"
              : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
          } disabled:opacity-50`}
        >
          {n}
        </button>
      ))}
    </div>
  );
}
