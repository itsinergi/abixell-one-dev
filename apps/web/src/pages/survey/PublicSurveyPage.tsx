/**
 * Wave A2 / SUR-ADV-005 & SUR-ADV-006:
 * Public & Anonymous Survey Questionnaire view.
 * Unauthenticated, token-governed, zero identity leakage, multi-language aware,
 * with matrix/grid rendering and forward branching skip evaluation.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import {
  api,
  ApiError,
  type PublicSurveySubmissionResult,
  type PublicSurveyView,
  type SurveyAnswerInput,
  type SurveyMatrixAnswerInput,
  type SurveyQuestion,
} from "../../lib/api";
import { Alert, Badge, Button, Card, Input, Spinner, Textarea } from "../../shell/components/ui";
import {
  determineSkippedSurveyQuestionIds,
  sortSurveyQuestions,
  type ResponseAnswerState,
} from "./survey-response";

type LocalAnswer = ResponseAnswerState;

type LocalMatrixAnswer = {
  selectedOptionId?: string | null;
  valueNumeric?: number | null;
  valueText?: string | null;
};

export function PublicSurveyPage() {
  const { token: publicToken } = useParams<{ token: string }>();
  const [surveyView, setSurveyView] = useState<PublicSurveyView | null>(null);
  const [selectedLocale, setSelectedLocale] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submissionResult, setSubmissionResult] = useState<PublicSurveySubmissionResult | null>(null);

  // Question answers: questionId -> LocalAnswer
  const [answers, setAnswers] = useState<Record<string, LocalAnswer>>({});
  // Matrix answers: questionId:matrixRowId -> LocalMatrixAnswer
  const [matrixAnswers, setMatrixAnswers] = useState<Record<string, LocalMatrixAnswer>>({});

  const loadSurvey = useCallback(async (loc?: string) => {
    if (!publicToken) return;
    setLoading(true);
    setError(null);
    try {
      const view = await api.publicSurvey(publicToken, loc || undefined);
      setSurveyView(view);
      if (!selectedLocale) {
        setSelectedLocale(view.version.defaultLocale || "id-ID");
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Survei tidak dapat diakses atau token sudah tidak valid.");
    } finally {
      setLoading(false);
    }
  }, [publicToken, selectedLocale]);

  useEffect(() => {
    loadSurvey(selectedLocale);
  }, [publicToken, selectedLocale, loadSurvey]);

  const sortedQuestions = useMemo(() => {
    if (!surveyView) return [];
    return sortSurveyQuestions(surveyView.sections, surveyView.questions);
  }, [surveyView]);

  const answerStateForBranching = useMemo(() => {
    const combined: Record<string, ResponseAnswerState> = { ...answers };
    if (!surveyView) return combined;

    for (const question of surveyView.questions) {
      if (
        question.questionType === "matrix_single_choice" ||
        question.questionType === "matrix_rating"
      ) {
        const answeredCount = (question.matrixRows ?? []).filter((row) => {
          const ma = matrixAnswers[`${question.id}:${row.id}`];
          return (
            Boolean(ma?.selectedOptionId) ||
            (ma?.valueNumeric !== null && ma?.valueNumeric !== undefined) ||
            Boolean(ma?.valueText && ma.valueText.trim().length > 0)
          );
        }).length;

        combined[question.id] = {
          ...combined[question.id],
          matrixRowsAnsweredCount: answeredCount,
        };
      }
    }

    return combined;
  }, [answers, matrixAnswers, surveyView]);

  const skippedQuestionIds = useMemo(() => {
    if (!surveyView || !surveyView.branchingRules || surveyView.branchingRules.length === 0) {
      return new Set<string>();
    }
    return determineSkippedSurveyQuestionIds(
      sortedQuestions,
      surveyView.branchingRules,
      answerStateForBranching,
    );
  }, [surveyView, sortedQuestions, answerStateForBranching]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!publicToken || !surveyView) return;

    // Collect standard answers
    const preparedAnswers: SurveyAnswerInput[] = [];
    for (const q of sortedQuestions) {
      if (skippedQuestionIds.has(q.id)) continue;
      const a = answers[q.id];
      if (!a) continue;

      if ((q.questionType === "rating" || q.questionType === "numeric") && a.valueNumeric !== null && a.valueNumeric !== undefined) {
        preparedAnswers.push({ questionId: q.id, valueNumeric: a.valueNumeric });
      } else if (q.questionType === "single_choice" && a.optionIds && a.optionIds.length > 0) {
        preparedAnswers.push({ questionId: q.id, optionIds: [a.optionIds[0]] });
      } else if (q.questionType === "multiple_choice" && a.optionIds && a.optionIds.length > 0) {
        preparedAnswers.push({ questionId: q.id, optionIds: a.optionIds });
      } else if ((q.questionType === "long_text" || q.questionType === "short_text" || q.questionType === "date" || q.questionType === "yes_no") && a.valueText) {
        preparedAnswers.push({ questionId: q.id, valueText: a.valueText });
      }
    }

    // Collect matrix answers
    const preparedMatrixAnswers: SurveyMatrixAnswerInput[] = [];
    for (const q of sortedQuestions) {
      if (skippedQuestionIds.has(q.id)) continue;
      if (q.questionType === "matrix_single_choice" || q.questionType === "matrix_rating") {
        for (const row of q.matrixRows ?? []) {
          const mKey = `${q.id}:${row.id}`;
          const ma = matrixAnswers[mKey];
          if (!ma) continue;
          if (q.questionType === "matrix_single_choice" && ma.selectedOptionId) {
            preparedMatrixAnswers.push({
              questionId: q.id,
              matrixRowId: row.id,
              selectedOptionId: ma.selectedOptionId,
            });
          } else if (q.questionType === "matrix_rating" && ma.valueNumeric !== null && ma.valueNumeric !== undefined) {
            preparedMatrixAnswers.push({
              questionId: q.id,
              matrixRowId: row.id,
              valueNumeric: ma.valueNumeric,
            });
          }
        }
      }
    }

    // Validate required questions that are not skipped
    const missing = sortedQuestions.filter((q) => {
      if (!q.isRequired || skippedQuestionIds.has(q.id)) return false;
      if (q.questionType === "matrix_single_choice" || q.questionType === "matrix_rating") {
        const rows = q.matrixRows ?? [];
        if (rows.length === 0) return false;
        return rows.some((row) => {
          const ma = matrixAnswers[`${q.id}:${row.id}`];
          if (q.questionType === "matrix_single_choice") return !ma?.selectedOptionId;
          return ma?.valueNumeric === null || ma?.valueNumeric === undefined;
        });
      }
      const ans = preparedAnswers.find((p) => p.questionId === q.id);
      return !ans;
    });

    if (missing.length > 0) {
      setError(`Mohon isi pertanyaan wajib: ${missing.map((m) => m.text).join(", ")}`);
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      const result = await api.submitPublicSurvey(publicToken, {
        answers: preparedAnswers,
        matrixAnswers: preparedMatrixAnswers,
      });
      setSubmissionResult(result);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Gagal mengirimkan survei.");
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 p-4">
        <Spinner label="Memuat kuesioner survei..." />
      </div>
    );
  }

  if (error && !surveyView) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 p-4">
        <Card className="max-w-md w-full text-center py-8">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-red-100 text-red-600">
            <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
          </div>
          <h2 className="text-lg font-semibold text-slate-900">Survei Tidak Tersedia</h2>
          <p className="mt-2 text-sm text-slate-600">{error}</p>
        </Card>
      </div>
    );
  }

  if (submissionResult) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 p-4">
        <Card className="max-w-lg w-full text-center py-8">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-green-100 text-green-600">
            <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <h2 className="text-xl font-bold text-slate-900">Terima Kasih!</h2>
          <p className="mt-2 text-sm text-slate-600">
            Jawaban survei Anda telah berhasil dicatat secara aman dan terlindungi.
          </p>
          {submissionResult.totalScore !== null && submissionResult.totalScore !== undefined && (
            <div className="mt-4">
              <Badge className="text-sm px-3 py-1 bg-green-50 text-green-800">
                Skor Evaluasi: {submissionResult.totalScore}
              </Badge>
            </div>
          )}
          <p className="mt-6 text-xs text-slate-400">
            Abixell One — Customer Experience & Quality Governance Platform
          </p>
        </Card>
      </div>
    );
  }

  if (!surveyView) return null;

  return (
    <div className="min-h-screen bg-slate-50 py-8 px-4 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-3xl space-y-6">
        {/* Header card with branding & locale selector */}
        <div className="flex items-center justify-between border-b border-slate-200 pb-4">
          <div>
            <div className="text-xs font-semibold uppercase tracking-wider text-slate-400">
              Survei Kepuasan & Penilaian
            </div>
            <h1 className="text-2xl font-bold text-slate-900">{surveyView.definition.name}</h1>
            {surveyView.definition.description && (
              <p className="mt-1 text-sm text-slate-600">{surveyView.definition.description}</p>
            )}
          </div>
          <div className="flex items-center gap-2">
            <label className="text-xs font-medium text-slate-500">Bahasa:</label>
            <select
              value={selectedLocale}
              onChange={(e) => setSelectedLocale(e.target.value)}
              className="rounded border border-slate-300 bg-white px-2 py-1 text-xs text-slate-700"
            >
              <option value="id-ID">Bahasa Indonesia (id-ID)</option>
              <option value="en-US">English (en-US)</option>
            </select>
          </div>
        </div>

        {error && <Alert tone="error">{error}</Alert>}

        <form onSubmit={handleSubmit} className="space-y-6">
          {surveyView.sections.map((section) => {
            const sectionQuestions = sortedQuestions.filter((q) => q.sectionId === section.id);
            const visibleQuestions = sectionQuestions.filter((q) => !skippedQuestionIds.has(q.id));
            if (visibleQuestions.length === 0) return null;

            return (
              <div key={section.id} className="space-y-4">
                <div className="border-l-4 border-slate-900 pl-3">
                  <h2 className="text-base font-semibold text-slate-900">{section.title}</h2>
                  {section.description && <p className="text-xs text-slate-500">{section.description}</p>}
                </div>

                {visibleQuestions.map((q, idx) => (
                  <PublicQuestionCard
                    key={q.id}
                    index={idx + 1}
                    question={q}
                    answer={answers[q.id] ?? {}}
                    matrixAnswers={matrixAnswers}
                    onAnswerChange={(upd) =>
                      setAnswers((prev) => ({ ...prev, [q.id]: { ...prev[q.id], ...upd } }))
                    }
                    onMatrixAnswerChange={(rowId, upd) =>
                      setMatrixAnswers((prev) => ({
                        ...prev,
                        [`${q.id}:${rowId}`]: { ...prev[`${q.id}:${rowId}`], ...upd },
                      }))
                    }
                  />
                ))}
              </div>
            );
          })}

          {/* Fallback questions without section */}
          {(() => {
            const unsectioned = sortedQuestions.filter((q) => !q.sectionId && !skippedQuestionIds.has(q.id));
            if (unsectioned.length === 0) return null;
            return (
              <div className="space-y-4">
                {unsectioned.map((q, idx) => (
                  <PublicQuestionCard
                    key={q.id}
                    index={idx + 1}
                    question={q}
                    answer={answers[q.id] ?? {}}
                    matrixAnswers={matrixAnswers}
                    onAnswerChange={(upd) =>
                      setAnswers((prev) => ({ ...prev, [q.id]: { ...prev[q.id], ...upd } }))
                    }
                    onMatrixAnswerChange={(rowId, upd) =>
                      setMatrixAnswers((prev) => ({
                        ...prev,
                        [`${q.id}:${rowId}`]: { ...prev[`${q.id}:${rowId}`], ...upd },
                      }))
                    }
                  />
                ))}
              </div>
            );
          })()}

          <div className="flex items-center justify-between border-t border-slate-200 pt-4">
            <span className="text-xs text-slate-400">
              Pengiriman ini bersifat rahasia dan terlindungi.
            </span>
            <Button type="submit" disabled={submitting} className="min-w-[140px]">
              {submitting ? "Mengirim..." : "Kirim Survei"}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}

function PublicQuestionCard({
  index,
  question,
  answer,
  matrixAnswers,
  onAnswerChange,
  onMatrixAnswerChange,
}: {
  index: number;
  question: SurveyQuestion & { options?: { id: string; code: string; label: string }[]; matrixRows?: { id: string; code: string; label: string }[] };
  answer: LocalAnswer;
  matrixAnswers: Record<string, LocalMatrixAnswer>;
  onAnswerChange: (upd: Partial<LocalAnswer>) => void;
  onMatrixAnswerChange: (rowId: string, upd: Partial<LocalMatrixAnswer>) => void;
}) {
  return (
    <Card className="border border-slate-200 bg-white p-4 shadow-xs">
      <div className="mb-3 flex items-start justify-between gap-2">
        <div className="text-sm font-medium text-slate-800">
          <span className="font-semibold text-slate-900 mr-1.5">{index}.</span>
          {question.text}
          {question.isRequired && <span className="ml-1 text-red-500 font-bold">*</span>}
        </div>
      </div>

      {/* RATING */}
      {question.questionType === "rating" && (
        <div className="flex flex-wrap gap-1.5 pt-1">
          {Array.from(
            { length: (Number(question.config?.max ?? 5) - Number(question.config?.min ?? 1) + 1) },
            (_, i) => Number(question.config?.min ?? 1) + i,
          ).map((n) => (
            <button
              key={n}
              type="button"
              onClick={() => onAnswerChange({ valueNumeric: n })}
              className={`h-9 w-9 rounded border text-sm font-medium transition-colors ${
                answer.valueNumeric === n
                  ? "border-slate-900 bg-slate-900 text-white"
                  : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
              }`}
            >
              {n}
            </button>
          ))}
        </div>
      )}

      {/* SINGLE CHOICE */}
      {question.questionType === "single_choice" && (
        <div className="space-y-2 pt-1">
          {question.options?.map((opt) => (
            <label key={opt.id} className="flex items-center gap-2 text-sm text-slate-700 cursor-pointer">
              <input
                type="radio"
                name={`pub-q-${question.id}`}
                checked={answer.optionIds?.[0] === opt.id}
                onChange={() => onAnswerChange({ optionIds: [opt.id] })}
                className="h-4 w-4 text-slate-900 border-slate-300 focus:ring-slate-400"
              />
              <span>{opt.label}</span>
            </label>
          ))}
        </div>
      )}

      {/* MULTIPLE CHOICE */}
      {question.questionType === "multiple_choice" && (
        <div className="space-y-2 pt-1">
          {question.options?.map((opt) => {
            const isChecked = (answer.optionIds ?? []).includes(opt.id);
            return (
              <label key={opt.id} className="flex items-center gap-2 text-sm text-slate-700 cursor-pointer">
                <input
                  type="checkbox"
                  checked={isChecked}
                  onChange={(e) => {
                    const current = answer.optionIds ?? [];
                    const next = e.target.checked
                      ? [...current, opt.id]
                      : current.filter((id) => id !== opt.id);
                    onAnswerChange({ optionIds: next });
                  }}
                  className="h-4 w-4 rounded text-slate-900 border-slate-300 focus:ring-slate-400"
                />
                <span>{opt.label}</span>
              </label>
            );
          })}
        </div>
      )}

      {/* YES / NO */}
      {question.questionType === "yes_no" && (
        <div className="flex gap-3 pt-1">
          {["yes", "no"].map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => onAnswerChange({ valueText: v })}
              className={`px-4 py-2 rounded border text-sm font-medium transition-colors ${
                answer.valueText === v
                  ? "border-slate-900 bg-slate-900 text-white"
                  : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
              }`}
            >
              {v === "yes" ? "Ya" : "Tidak"}
            </button>
          ))}
        </div>
      )}

      {/* SHORT TEXT */}
      {question.questionType === "short_text" && (
        <div className="pt-1">
          <Input
            value={answer.valueText ?? ""}
            onChange={(e) => onAnswerChange({ valueText: e.target.value })}
            placeholder="Jawaban Anda..."
          />
        </div>
      )}

      {/* LONG TEXT */}
      {question.questionType === "long_text" && (
        <div className="pt-1">
          <Textarea
            rows={3}
            value={answer.valueText ?? ""}
            onChange={(e) => onAnswerChange({ valueText: e.target.value })}
            placeholder="Tuliskan keterangan lengkap..."
          />
        </div>
      )}

      {/* NUMERIC */}
      {question.questionType === "numeric" && (
        <div className="pt-1 max-w-xs">
          <Input
            type="number"
            value={answer.valueNumeric ?? ""}
            onChange={(e) =>
              onAnswerChange({ valueNumeric: e.target.value === "" ? null : Number(e.target.value) })
            }
            placeholder="Angka..."
          />
        </div>
      )}

      {/* DATE */}
      {question.questionType === "date" && (
        <div className="pt-1 max-w-xs">
          <Input
            type="date"
            value={answer.valueText ?? ""}
            onChange={(e) => onAnswerChange({ valueText: e.target.value })}
          />
        </div>
      )}

      {/* MATRIX SINGLE CHOICE */}
      {question.questionType === "matrix_single_choice" && (
        <div className="overflow-x-auto pt-2">
          <table className="min-w-full divide-y divide-slate-200 text-sm">
            <thead className="bg-slate-50">
              <tr>
                <th className="px-3 py-2 text-left text-xs font-semibold text-slate-600">Pernyataan / Baris</th>
                {question.options?.map((opt) => (
                  <th key={opt.id} className="px-3 py-2 text-center text-xs font-semibold text-slate-600">
                    {opt.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 bg-white">
              {question.matrixRows?.map((row) => {
                const ma = matrixAnswers[`${question.id}:${row.id}`];
                return (
                  <tr key={row.id}>
                    <td className="px-3 py-2 text-sm text-slate-800">{row.label}</td>
                    {question.options?.map((opt) => (
                      <td key={opt.id} className="px-3 py-2 text-center align-middle">
                        <input
                          type="radio"
                          name={`mat-sc-${question.id}-${row.id}`}
                          checked={ma?.selectedOptionId === opt.id}
                          onChange={() => onMatrixAnswerChange(row.id, { selectedOptionId: opt.id })}
                          className="h-4 w-4 text-slate-900 border-slate-300 focus:ring-slate-400"
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

      {/* MATRIX RATING */}
      {question.questionType === "matrix_rating" && (
        <div className="overflow-x-auto pt-2">
          <table className="min-w-full divide-y divide-slate-200 text-sm">
            <thead className="bg-slate-50">
              <tr>
                <th className="px-3 py-2 text-left text-xs font-semibold text-slate-600">Pernyataan / Baris</th>
                <th className="px-3 py-2 text-center text-xs font-semibold text-slate-600">Rating (1 – 5)</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 bg-white">
              {question.matrixRows?.map((row) => {
                const ma = matrixAnswers[`${question.id}:${row.id}`];
                return (
                  <tr key={row.id}>
                    <td className="px-3 py-2 text-sm text-slate-800">{row.label}</td>
                    <td className="px-3 py-2 text-center align-middle">
                      <div className="inline-flex gap-1">
                        {[1, 2, 3, 4, 5].map((num) => (
                          <button
                            key={num}
                            type="button"
                            onClick={() => onMatrixAnswerChange(row.id, { valueNumeric: num })}
                            className={`h-7 w-7 rounded border text-xs font-medium transition-colors ${
                              ma?.valueNumeric === num
                                ? "border-slate-900 bg-slate-900 text-white"
                                : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
                            }`}
                          >
                            {num}
                          </button>
                        ))}
                      </div>
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
