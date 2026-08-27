import type {
  AssignmentScoringResult,
  NpsCategory,
  NpsClassification,
  SurveyMatrixAnswer,
  SurveyMatrixRow,
} from "../../domain/survey/survey-advanced.entity.js";
import type {
  SurveyAnswer,
  SurveyQuestion,
  SurveyQuestionOption,
  SurveySection,
  SurveyVersion,
} from "../../domain/survey/survey.entity.js";

export interface QuestionScoreDetail {
  questionId: string;
  questionCode: string;
  rawScore: number | null;
  maxScore: number | null;
  weight: number;
}

export interface SectionScoreDetail {
  sectionId: string;
  rawScore: number | null;
  maxScore: number | null;
  percentageScore: number | null;
  weightedScore: number | null;
}

/**
 * Calculates NPS classification for a score (0 to 10 scale).
 * - Promoter: 9 - 10
 * - Passive: 7 - 8
 * - Detractor: 0 - 6
 */
export function classifyNpsScore(score: number): NpsClassification {
  const rounded = Math.round(score);
  let category: NpsCategory;
  if (rounded >= 9) {
    category = "promoter";
  } else if (rounded >= 7) {
    category = "passive";
  } else {
    category = "detractor";
  }
  return { category, score: rounded };
}

/**
 * Advanced multi-dimensional survey scoring calculator.
 * Supports:
 * - sum: Total raw score of all answered questions.
 * - weighted_average: Sum(Score * Weight) / Sum(Weight).
 * - percentage: (Raw Score / Max Available Score) * 100.
 * - nps: Primary 0-10 NPS rating extraction + overall percentage/index.
 */
export function calculateSurveyScoring(params: {
  version: SurveyVersion;
  sections: SurveySection[];
  questions: SurveyQuestion[];
  options: SurveyQuestionOption[];
  matrixRows: SurveyMatrixRow[];
  answers: SurveyAnswer[];
  matrixAnswers: SurveyMatrixAnswer[];
  answerOptionIdsByAnswerId: Map<string, string[]>;
}): AssignmentScoringResult {
  const {
    version,
    sections,
    questions,
    options,
    matrixRows,
    answers,
    matrixAnswers,
    answerOptionIdsByAnswerId,
  } = params;

  const optionById = new Map<string, SurveyQuestionOption>(options.map((o) => [o.id, o]));
  const answerByQuestionId = new Map<string, SurveyAnswer>(
    answers.map((a) => [a.surveyQuestionId, a]),
  );

  // Group matrix answers by question id
  const matrixAnswersByQ = new Map<string, SurveyMatrixAnswer[]>();
  for (const ma of matrixAnswers) {
    const list = matrixAnswersByQ.get(ma.surveyQuestionId) ?? [];
    list.push(ma);
    matrixAnswersByQ.set(ma.surveyQuestionId, list);
  }

  // Calculate score per question
  const questionScores: QuestionScoreDetail[] = [];
  let detectedNpsScore: number | null = null;

  for (const q of questions) {
    const weight = q.weight > 0 ? Number(q.weight) : 1;
    let rawScore: number | null = null;
    let maxScore: number | null = null;

    if (q.questionType === "rating") {
      const min = Number(q.config.min ?? 1);
      const max = Number(q.config.max ?? 5);
      maxScore = max;
      const ans = answerByQuestionId.get(q.id);
      if (ans && ans.valueNumeric !== null && ans.valueNumeric !== undefined) {
        rawScore = Number(ans.valueNumeric);
        if (max === 10 && min === 0) {
          // NPS question candidate
          detectedNpsScore = rawScore;
        }
      }
    } else if (q.questionType === "single_choice") {
      const qOptions = options.filter((o) => o.surveyQuestionId === q.id);
      const optScores = qOptions.map((o) => o.score ?? 0);
      maxScore = optScores.length > 0 ? Math.max(...optScores) : null;

      const ans = answerByQuestionId.get(q.id);
      if (ans) {
        const selectedIds = answerOptionIdsByAnswerId.get(ans.id) ?? [];
        if (selectedIds.length > 0) {
          const selectedOpt = optionById.get(selectedIds[0]);
          if (selectedOpt && selectedOpt.score !== null && selectedOpt.score !== undefined) {
            rawScore = Number(selectedOpt.score);
          }
        }
      }
    } else if (q.questionType === "multiple_choice") {
      const qOptions = options.filter((o) => o.surveyQuestionId === q.id);
      const positiveScores = qOptions.map((o) => o.score ?? 0).filter((s) => s > 0);
      maxScore = positiveScores.length > 0 ? positiveScores.reduce((a, b) => a + b, 0) : null;

      const ans = answerByQuestionId.get(q.id);
      if (ans) {
        const selectedIds = answerOptionIdsByAnswerId.get(ans.id) ?? [];
        let sumSelected = 0;
        let hasAnyScore = false;
        for (const sid of selectedIds) {
          const opt = optionById.get(sid);
          if (opt && opt.score !== null && opt.score !== undefined) {
            sumSelected += Number(opt.score);
            hasAnyScore = true;
          }
        }
        if (hasAnyScore) rawScore = sumSelected;
      }
    } else if (q.questionType === "matrix_rating" || q.questionType === "matrix_single_choice") {
      const mAnswers = matrixAnswersByQ.get(q.id) ?? [];
      const mRows = matrixRows.filter((r) => r.surveyQuestionId === q.id);
      const maxPerCol = Number(q.config.max ?? (q.questionType === "matrix_rating" ? 5 : 10));
      maxScore = mRows.length > 0 ? mRows.length * maxPerCol : null;

      if (mAnswers.length > 0) {
        let sumMatrix = 0;
        let answeredCount = 0;
        for (const ma of mAnswers) {
          if (ma.valueNumeric !== null && ma.valueNumeric !== undefined) {
            sumMatrix += Number(ma.valueNumeric);
            answeredCount++;
          } else if (ma.selectedOptionId) {
            const opt = optionById.get(ma.selectedOptionId);
            if (opt && opt.score !== null && opt.score !== undefined) {
              sumMatrix += Number(opt.score);
              answeredCount++;
            }
          }
        }
        if (answeredCount > 0) rawScore = sumMatrix;
      }
    }

    questionScores.push({
      questionId: q.id,
      questionCode: q.code,
      rawScore,
      maxScore,
      weight,
    });
  }

  // Calculate section scores
  const sectionScoreResults: SectionScoreDetail[] = [];
  for (const sec of sections) {
    const secQuestions = questions.filter((q) => q.sectionId === sec.id);
    const secQIds = new Set(secQuestions.map((q) => q.id));
    const secScores = questionScores.filter((qs) => secQIds.has(qs.questionId));

    let rawTotal = 0;
    let maxTotal = 0;
    let weightSum = 0;
    let weightedRawSum = 0;
    let hasAnyRaw = false;

    for (const qs of secScores) {
      if (qs.rawScore !== null) {
        rawTotal += qs.rawScore;
        hasAnyRaw = true;
        weightedRawSum += qs.rawScore * qs.weight;
        weightSum += qs.weight;
      }
      if (qs.maxScore !== null) {
        maxTotal += qs.maxScore;
      }
    }

    const percentage = maxTotal > 0 && hasAnyRaw ? Math.round((rawTotal / maxTotal) * 10000) / 100 : null;
    const weighted = weightSum > 0 && hasAnyRaw ? Math.round((weightedRawSum / weightSum) * 100) / 100 : null;

    sectionScoreResults.push({
      sectionId: sec.id,
      rawScore: hasAnyRaw ? rawTotal : null,
      maxScore: maxTotal > 0 ? maxTotal : null,
      percentageScore: percentage,
      weightedScore: weighted,
    });
  }

  // Overall total score calculation according to version scoring model
  const scoringModel = version.scoringModel || "sum";
  let totalScore: number | null = null;

  if (scoringModel === "sum") {
    let sumVal = 0;
    let hasVal = false;
    for (const qs of questionScores) {
      if (qs.rawScore !== null) {
        sumVal += qs.rawScore;
        hasVal = true;
      }
    }
    totalScore = hasVal ? sumVal : null;
  } else if (scoringModel === "weighted_average") {
    let weightSum = 0;
    let weightedValSum = 0;
    let hasVal = false;
    for (const qs of questionScores) {
      if (qs.rawScore !== null) {
        weightedValSum += qs.rawScore * qs.weight;
        weightSum += qs.weight;
        hasVal = true;
      }
    }
    totalScore = weightSum > 0 && hasVal ? Math.round((weightedValSum / weightSum) * 100) / 100 : null;
  } else if (scoringModel === "percentage") {
    let rawSum = 0;
    let maxAvailableSum = 0;
    let hasVal = false;
    for (const qs of questionScores) {
      if (qs.rawScore !== null) {
        rawSum += qs.rawScore;
        hasVal = true;
      }
      if (qs.maxScore !== null) {
        maxAvailableSum += qs.maxScore;
      }
    }
    totalScore =
      maxAvailableSum > 0 && hasVal ? Math.round((rawSum / maxAvailableSum) * 10000) / 100 : null;
  } else if (scoringModel === "nps") {
    totalScore = detectedNpsScore;
  }

  const npsClassification =
    detectedNpsScore !== null ? classifyNpsScore(detectedNpsScore) : null;

  return {
    totalScore,
    scoringModel,
    sectionScores: sectionScoreResults,
    npsScore: detectedNpsScore,
    npsClassification,
  };
}
