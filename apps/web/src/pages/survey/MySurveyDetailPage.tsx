/**
 * Checkpoint 1D.2 + Wave A2 (SUR-ADV-003…004): authenticated respondent
 * survey form with all activated question types, matrix/grid answers,
 * deterministic forward branching, draft save, and backend-authoritative submit.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useAuth } from "../../auth/AuthContext";
import {
  api,
  ApiError,
  type SurveyAnswerInput,
  type SurveyMatrixAnswerInput,
  type SurveyQuestion,
  type SurveyRespondentView,
} from "../../lib/api";
import {
  Alert,
  Badge,
  Button,
  Card,
  Field,
  Input,
  PageHeader,
  Spinner,
  StatusPill,
  Textarea,
} from "../../shell/components/ui";
import {
  determineSkippedSurveyQuestionIds,
  sortSurveyQuestions,
  type ResponseAnswerState,
} from "./survey-response";
import { useT } from "../../i18n/LocaleProvider";

type LocalAnswer = ResponseAnswerState;

type LocalMatrixAnswer = {
  selectedOptionId?: string | null;
  valueNumeric?: number | null;
  valueText?: string | null;
};

export function MySurveyDetailPage() {
  const t = useT();
  const { session } = useAuth();
  const token = session!.accessToken;
  const { assignmentId } = useParams<{ assignmentId: string }>();
  const navigate = useNavigate();

  const [view, setView] = useState<SurveyRespondentView | null>(null);
  const [answers, setAnswers] = useState<Record<string, LocalAnswer>>({});
  const [matrixAnswers, setMatrixAnswers] = useState<Record<string, LocalMatrixAnswer>>({});
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
      for (const answer of v.answers) {
        initial[answer.questionId] = {
          valueNumeric: answer.valueNumeric,
          valueText: answer.valueText,
          optionIds: answer.selectedOptionIds,
        };
      }
      setAnswers(initial);

      const initialMatrix: Record<string, LocalMatrixAnswer> = {};
      for (const matrixAnswer of v.matrixAnswers ?? []) {
        initialMatrix[`${matrixAnswer.questionId}:${matrixAnswer.matrixRowId}`] = {
          selectedOptionId: matrixAnswer.selectedOptionId,
          valueNumeric: matrixAnswer.valueNumeric,
          valueText: matrixAnswer.valueText,
        };
      }
      setMatrixAnswers(initialMatrix);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("surveyRespond.loadFailed"));
    } finally {
      setLoading(false);
    }
  }, [token, assignmentId, t]);

  useEffect(() => {
    load();
  }, [load]);

  const submitted = view?.assignment.status === "submitted";

  const sortedQuestions = useMemo(() => {
    if (!view) return [];
    return sortSurveyQuestions(view.sections, view.questions);
  }, [view]);

  const branchingAnswerState = useMemo(() => {
    const combined: Record<string, LocalAnswer> = { ...answers };
    if (!view) return combined;

    for (const question of view.questions) {
      if (
        question.questionType === "matrix_single_choice" ||
        question.questionType === "matrix_rating"
      ) {
        const answeredCount = (question.matrixRows ?? []).filter((row) => {
          const answer = matrixAnswers[`${question.id}:${row.id}`];
          return (
            Boolean(answer?.selectedOptionId) ||
            (answer?.valueNumeric !== null && answer?.valueNumeric !== undefined) ||
            Boolean(answer?.valueText && answer.valueText.trim().length > 0)
          );
        }).length;
        combined[question.id] = {
          ...combined[question.id],
          matrixRowsAnsweredCount: answeredCount,
        };
      }
    }

    return combined;
  }, [answers, matrixAnswers, view]);

  const skippedQuestionIds = useMemo(() => {
    if (!view || (view.branchingRules ?? []).length === 0) return new Set<string>();
    return determineSkippedSurveyQuestionIds(sortedQuestions, view.branchingRules, branchingAnswerState);
  }, [view, sortedQuestions, branchingAnswerState]);

  const payload = useMemo<SurveyAnswerInput[]>(() => {
    if (!view) return [];
    const output: SurveyAnswerInput[] = [];

    for (const question of sortedQuestions) {
      if (skippedQuestionIds.has(question.id)) continue;
      const answer = answers[question.id];
      if (!answer) continue;

      if (
        (question.questionType === "rating" || question.questionType === "numeric") &&
        answer.valueNumeric !== null &&
        answer.valueNumeric !== undefined
      ) {
        output.push({ questionId: question.id, valueNumeric: answer.valueNumeric });
      } else if (
        question.questionType === "single_choice" &&
        answer.optionIds &&
        answer.optionIds.length === 1
      ) {
        output.push({ questionId: question.id, optionIds: answer.optionIds });
      } else if (
        question.questionType === "multiple_choice" &&
        answer.optionIds &&
        answer.optionIds.length > 0
      ) {
        output.push({ questionId: question.id, optionIds: answer.optionIds });
      } else if (
        ["long_text", "short_text", "date", "yes_no"].includes(question.questionType) &&
        answer.valueText &&
        answer.valueText.trim()
      ) {
        output.push({ questionId: question.id, valueText: answer.valueText });
      }
    }

    return output;
  }, [view, sortedQuestions, skippedQuestionIds, answers]);

  const matrixPayload = useMemo<SurveyMatrixAnswerInput[]>(() => {
    if (!view) return [];
    const output: SurveyMatrixAnswerInput[] = [];

    for (const question of sortedQuestions) {
      if (skippedQuestionIds.has(question.id)) continue;
      if (
        question.questionType !== "matrix_single_choice" &&
        question.questionType !== "matrix_rating"
      ) {
        continue;
      }

      for (const row of question.matrixRows ?? []) {
        const answer = matrixAnswers[`${question.id}:${row.id}`];
        if (!answer) continue;

        if (question.questionType === "matrix_single_choice" && answer.selectedOptionId) {
          output.push({
            questionId: question.id,
            matrixRowId: row.id,
            selectedOptionId: answer.selectedOptionId,
          });
        } else if (
          question.questionType === "matrix_rating" &&
          answer.valueNumeric !== null &&
          answer.valueNumeric !== undefined
        ) {
          output.push({
            questionId: question.id,
            matrixRowId: row.id,
            valueNumeric: answer.valueNumeric,
          });
        }
      }
    }

    return output;
  }, [view, sortedQuestions, skippedQuestionIds, matrixAnswers]);

  async function saveDraft() {
    if (!assignmentId) return;
    setBusy(true);
    setNotice(null);
    try {
      await api.saveSurveyAnswers(token, assignmentId, payload, matrixPayload);
      setNotice({ tone: "success", text: t("surveyRespond.draftSaved") });
      await load();
    } catch (err) {
      setNotice({ tone: "error", text: err instanceof ApiError ? err.message : t("surveyRespond.saveFailed") });
    } finally {
      setBusy(false);
    }
  }

  async function submit() {
    if (!assignmentId || !view) return;

    // Client-side branching-aware required check; backend remains authoritative.
    const missing = sortedQuestions.filter((question) => {
      if (!question.isRequired || skippedQuestionIds.has(question.id)) return false;

      if (
        question.questionType === "matrix_single_choice" ||
        question.questionType === "matrix_rating"
      ) {
        const rows = question.matrixRows ?? [];
        if (rows.length === 0) return false;
        return rows.some((row) => {
          const answer = matrixAnswers[`${question.id}:${row.id}`];
          if (question.questionType === "matrix_single_choice") return !answer?.selectedOptionId;
          return answer?.valueNumeric === null || answer?.valueNumeric === undefined;
        });
      }

      return !payload.some((answer) => answer.questionId === question.id);
    });

    if (missing.length > 0) {
      setNotice({
        tone: "error",
        text: t("surveyRespond.requiredMissing", {
          questions: missing.map((question) => question.text).join(", "),
        }),
      });
      return;
    }

    setBusy(true);
    setNotice(null);
    try {
      await api.saveSurveyAnswers(token, assignmentId, payload, matrixPayload);
      await api.submitSurvey(token, assignmentId);
      setNotice({ tone: "success", text: t("surveyRespond.submitted") });
      await load();
    } catch (err) {
      setNotice({ tone: "error", text: err instanceof ApiError ? err.message : t("surveyRespond.submitFailed") });
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <Spinner label={t("surveyRespond.loading")} />;
  if (error) {
    return (
      <div className="space-y-3">
        <Alert tone="error">{error}</Alert>
        <Button variant="secondary" onClick={() => navigate("/my-surveys")}>
          {t("surveyRespond.backToList")}
        </Button>
      </div>
    );
  }
  if (!view) return null;

  return (
    <div>
      <PageHeader
        title={t("surveyRespond.title")}
        subtitle={submitted ? t("surveyRespond.subtitleSubmitted") : t("surveyRespond.subtitleOpen")}
        actions={
          <Button variant="secondary" onClick={() => navigate("/my-surveys")}>
            {t("surveyRespond.backToList")}
          </Button>
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <StatusPill tone={submitted ? "success" : "warning"}>{view.assignment.status}</StatusPill>
        {submitted && view.assignment.totalScore != null && (
          <Badge>{t("surveyRespond.totalScore", { score: view.assignment.totalScore })}</Badge>
        )}
        {!submitted && skippedQuestionIds.size > 0 && (
          <Badge>{t("surveyRespond.skippedCount", { count: skippedQuestionIds.size })}</Badge>
        )}
      </div>

      {notice && (
        <div className="mb-4">
          <Alert tone={notice.tone}>{notice.text}</Alert>
        </div>
      )}

      <div className="max-w-3xl space-y-6">
        {view.sections.map((section) => {
          const visibleQuestions = sortedQuestions.filter(
            (question) => question.sectionId === section.id && !skippedQuestionIds.has(question.id),
          );
          if (visibleQuestions.length === 0) return null;

          return (
            <section key={section.id} className="space-y-3">
              <div className="border-l-4 border-accent pl-3">
                <h2 className="text-base font-semibold text-ink">{section.title}</h2>
                {section.description && <p className="text-xs text-ink-faint">{section.description}</p>}
              </div>

              {visibleQuestions.map((question, index) => (
                <RespondentQuestion
                  key={question.id}
                  index={index + 1}
                  question={question}
                  answer={answers[question.id] ?? {}}
                  matrixAnswers={matrixAnswers}
                  disabled={submitted}
                  onAnswerChange={(update) =>
                    setAnswers((previous) => ({
                      ...previous,
                      [question.id]: { ...previous[question.id], ...update },
                    }))
                  }
                  onMatrixAnswerChange={(rowId, update) =>
                    setMatrixAnswers((previous) => ({
                      ...previous,
                      [`${question.id}:${rowId}`]: {
                        ...previous[`${question.id}:${rowId}`],
                        ...update,
                      },
                    }))
                  }
                />
              ))}
            </section>
          );
        })}

        {sortedQuestions
          .filter((question) => !question.sectionId && !skippedQuestionIds.has(question.id))
          .map((question, index) => (
            <RespondentQuestion
              key={question.id}
              index={index + 1}
              question={question}
              answer={answers[question.id] ?? {}}
              matrixAnswers={matrixAnswers}
              disabled={submitted}
              onAnswerChange={(update) =>
                setAnswers((previous) => ({
                  ...previous,
                  [question.id]: { ...previous[question.id], ...update },
                }))
              }
              onMatrixAnswerChange={(rowId, update) =>
                setMatrixAnswers((previous) => ({
                  ...previous,
                  [`${question.id}:${rowId}`]: {
                    ...previous[`${question.id}:${rowId}`],
                    ...update,
                  },
                }))
              }
            />
          ))}

        {!submitted && (
          <div className="flex items-center gap-2 border-t border-line pt-4">
            <Button variant="secondary" disabled={busy} onClick={saveDraft}>
              {t("surveyRespond.saveDraft")}
            </Button>
            <Button disabled={busy} onClick={submit}>
              {busy ? t("surveyRespond.working") : t("surveyRespond.submit")}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

function RespondentQuestion({
  index,
  question,
  answer,
  matrixAnswers,
  disabled,
  onAnswerChange,
  onMatrixAnswerChange,
}: {
  index: number;
  question: SurveyQuestion & {
    options?: Array<{ id: string; label: string }>;
    matrixRows?: Array<{ id: string; label: string }>;
  };
  answer: LocalAnswer;
  matrixAnswers: Record<string, LocalMatrixAnswer>;
  disabled: boolean;
  onAnswerChange: (update: Partial<LocalAnswer>) => void;
  onMatrixAnswerChange: (rowId: string, update: Partial<LocalMatrixAnswer>) => void;
}) {
  const t = useT();
  return (
    <Card>
      <div className="mb-2 text-sm font-medium text-ink">
        {index}. {question.text}
        {question.isRequired && <span className="ml-1 text-status-danger">*</span>}
      </div>

      {question.questionType === "rating" && (
        <RatingInput
          min={Number(question.config.min ?? 1)}
          max={Number(question.config.max ?? 5)}
          value={answer.valueNumeric ?? null}
          disabled={disabled}
          onChange={(value) => onAnswerChange({ valueNumeric: value })}
        />
      )}

      {question.questionType === "single_choice" && (
        <div className="space-y-1">
          {(question.options ?? []).map((option) => (
            <label key={option.id} className="flex items-center gap-2 text-sm text-ink-dim">
              <input
                type="radio"
                name={`q-${question.id}`}
                disabled={disabled}
                checked={(answer.optionIds ?? [])[0] === option.id}
                onChange={() => onAnswerChange({ optionIds: [option.id] })}
              />
              {option.label}
            </label>
          ))}
        </div>
      )}

      {question.questionType === "multiple_choice" && (
        <div className="space-y-1">
          {(question.options ?? []).map((option) => {
            const selected = (answer.optionIds ?? []).includes(option.id);
            return (
              <label key={option.id} className="flex items-center gap-2 text-sm text-ink-dim">
                <input
                  type="checkbox"
                  disabled={disabled}
                  checked={selected}
                  onChange={(event) => {
                    const current = answer.optionIds ?? [];
                    onAnswerChange({
                      optionIds: event.target.checked
                        ? [...current, option.id]
                        : current.filter((id) => id !== option.id),
                    });
                  }}
                />
                {option.label}
              </label>
            );
          })}
        </div>
      )}

      {question.questionType === "yes_no" && (
        <div className="flex gap-2">
          {[
            { value: "yes", label: t("surveyRespond.yes") },
            { value: "no", label: t("surveyRespond.no") },
          ].map((choice) => (
            <button
              key={choice.value}
              type="button"
              disabled={disabled}
              aria-pressed={answer.valueText === choice.value}
              onClick={() => onAnswerChange({ valueText: choice.value })}
              className={`rounded border px-4 py-2 text-sm font-medium transition-colors ${
                answer.valueText === choice.value
                  ? "border-accent bg-accent text-accent-on"
                  : "border-line bg-panel text-ink-dim hover:bg-panel-2"
              } disabled:opacity-50`}
            >
              {choice.label}
            </button>
          ))}
        </div>
      )}

      {question.questionType === "short_text" && (
        <Field label="">
          <Input
            disabled={disabled}
            value={answer.valueText ?? ""}
            onChange={(event) => onAnswerChange({ valueText: event.target.value })}
          />
        </Field>
      )}

      {question.questionType === "long_text" && (
        <Field label="">
          <Textarea
            rows={3}
            disabled={disabled}
            value={answer.valueText ?? ""}
            onChange={(event) => onAnswerChange({ valueText: event.target.value })}
          />
        </Field>
      )}

      {question.questionType === "numeric" && (
        <Field label="">
          <Input
            type="number"
            disabled={disabled}
            value={answer.valueNumeric ?? ""}
            onChange={(event) =>
              onAnswerChange({
                valueNumeric: event.target.value === "" ? null : Number(event.target.value),
              })
            }
          />
        </Field>
      )}

      {question.questionType === "date" && (
        <Field label="">
          <Input
            type="date"
            disabled={disabled}
            value={answer.valueText ?? ""}
            onChange={(event) => onAnswerChange({ valueText: event.target.value })}
          />
        </Field>
      )}

      {question.questionType === "matrix_single_choice" && (
        <div className="overflow-x-auto pt-1">
          <table className="min-w-full divide-y divide-slate-200 text-sm">
            <thead className="bg-panel-2">
              <tr>
                <th className="px-3 py-2 text-left text-xs font-semibold text-ink-dim">
                  {t("surveyRespond.statementColumn")}
                </th>
                {(question.options ?? []).map((option) => (
                  <th key={option.id} className="px-3 py-2 text-center text-xs font-semibold text-ink-dim">
                    {option.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 bg-panel">
              {(question.matrixRows ?? []).map((row) => {
                const matrixAnswer = matrixAnswers[`${question.id}:${row.id}`];
                return (
                  <tr key={row.id}>
                    <td className="px-3 py-2 text-ink">{row.label}</td>
                    {(question.options ?? []).map((option) => (
                      <td key={option.id} className="px-3 py-2 text-center">
                        <input
                          type="radio"
                          name={`matrix-${question.id}-${row.id}`}
                          disabled={disabled}
                          checked={matrixAnswer?.selectedOptionId === option.id}
                          onChange={() => onMatrixAnswerChange(row.id, { selectedOptionId: option.id })}
                        />
                      </td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {question.questionType === "matrix_rating" && (
        <div className="overflow-x-auto pt-1">
          <table className="min-w-full divide-y divide-slate-200 text-sm">
            <thead className="bg-panel-2">
              <tr>
                <th className="px-3 py-2 text-left text-xs font-semibold text-ink-dim">
                  {t("surveyRespond.statementColumn")}
                </th>
                <th className="px-3 py-2 text-center text-xs font-semibold text-ink-dim">
                  {t("surveyRespond.ratingRange", {
                    min: String(question.config.min ?? 1),
                    max: String(question.config.max ?? 5),
                  })}
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 bg-panel">
              {(question.matrixRows ?? []).map((row) => {
                const matrixAnswer = matrixAnswers[`${question.id}:${row.id}`];
                return (
                  <tr key={row.id}>
                    <td className="px-3 py-2 text-ink">{row.label}</td>
                    <td className="px-3 py-2 text-center">
                      <RatingInput
                        min={Number(question.config.min ?? 1)}
                        max={Number(question.config.max ?? 5)}
                        value={matrixAnswer?.valueNumeric ?? null}
                        disabled={disabled}
                        compact
                        onChange={(value) => onMatrixAnswerChange(row.id, { valueNumeric: value })}
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

function RatingInput({
  min,
  max,
  value,
  disabled,
  compact = false,
  onChange,
}: {
  min: number;
  max: number;
  value: number | null;
  disabled: boolean;
  compact?: boolean;
  onChange: (value: number) => void;
}) {
  const scale = [];
  for (let number = min; number <= max; number += 1) scale.push(number);
  return (
    <div className={`flex flex-wrap gap-1.5 ${compact ? "justify-center" : ""}`}>
      {scale.map((number) => (
        <button
          key={number}
          type="button"
          disabled={disabled}
          aria-pressed={value === number}
          onClick={() => onChange(number)}
          className={`${compact ? "h-7 w-7 text-xs" : "h-9 w-9 text-sm"} rounded border font-medium transition-colors focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-accent ${
            value === number
              ? "border-accent bg-accent text-accent-on"
              : "border-line bg-panel text-ink-dim hover:bg-panel-2"
          } disabled:opacity-50`}
        >
          {number}
        </button>
      ))}
    </div>
  );
}
