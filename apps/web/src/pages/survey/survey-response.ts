import type {
  SurveyBranchingRule,
  SurveyMatrixRow,
  SurveyQuestion,
  SurveyQuestionOption,
  SurveySection,
} from "../../lib/api";

export type ResponseAnswerState = {
  valueText?: string | null;
  valueNumeric?: number | null;
  optionIds?: string[];
  matrixRowsAnsweredCount?: number;
};

type ResponseQuestion = SurveyQuestion & {
  options?: SurveyQuestionOption[];
  matrixRows?: SurveyMatrixRow[];
};

/** Keep the browser path order identical to the backend branching evaluator. */
export function sortSurveyQuestions(
  sections: SurveySection[],
  questions: ResponseQuestion[],
): ResponseQuestion[] {
  const sectionOrderMap = new Map<string, number>();
  [...sections]
    .sort((a, b) => a.sortOrder - b.sortOrder || a.code.localeCompare(b.code))
    .forEach((section, index) => sectionOrderMap.set(section.id, index));

  return [...questions].sort((a, b) => {
    const aSectionOrder = a.sectionId
      ? sectionOrderMap.get(a.sectionId) ?? Number.MAX_SAFE_INTEGER
      : Number.MAX_SAFE_INTEGER;
    const bSectionOrder = b.sectionId
      ? sectionOrderMap.get(b.sectionId) ?? Number.MAX_SAFE_INTEGER
      : Number.MAX_SAFE_INTEGER;
    return (
      aSectionOrder - bSectionOrder ||
      a.sortOrder - b.sortOrder ||
      a.code.localeCompare(b.code) ||
      a.id.localeCompare(b.id)
    );
  });
}

function hasAnswer(answer: ResponseAnswerState | undefined): boolean {
  if (!answer) return false;
  return Boolean(
    (answer.valueText && answer.valueText.trim().length > 0) ||
      (answer.valueNumeric !== null && answer.valueNumeric !== undefined) ||
      (answer.optionIds && answer.optionIds.length > 0) ||
      (answer.matrixRowsAnsweredCount ?? 0) > 0,
  );
}

function optionCodes(question: ResponseQuestion, answer: ResponseAnswerState): string[] {
  const selected = new Set(answer.optionIds ?? []);
  return (question.options ?? [])
    .filter((option) => selected.has(option.id))
    .map((option) => option.code);
}

function conditionMatches(
  question: ResponseQuestion,
  rule: SurveyBranchingRule,
  answer: ResponseAnswerState | undefined,
): boolean {
  if (!answer) return rule.conditionOperator === "is_unanswered";

  const selectedOptionCodes = optionCodes(question, answer);
  switch (rule.conditionOperator) {
    case "is_answered":
      return hasAnswer(answer);
    case "is_unanswered":
      return !hasAnswer(answer);
    case "equals":
      if (answer.valueNumeric !== null && answer.valueNumeric !== undefined) {
        return Number(rule.conditionValue) === Number(answer.valueNumeric);
      }
      if (selectedOptionCodes.length > 0) {
        return selectedOptionCodes.includes(String(rule.conditionValue));
      }
      if (answer.valueText !== null && answer.valueText !== undefined) {
        return String(rule.conditionValue).trim().toLowerCase() === answer.valueText.trim().toLowerCase();
      }
      return false;
    case "not_equals":
      return !conditionMatches(question, { ...rule, conditionOperator: "equals" }, answer);
    case "greater_than":
      return answer.valueNumeric !== null &&
        answer.valueNumeric !== undefined &&
        Number(answer.valueNumeric) > Number(rule.conditionValue);
    case "less_than":
      return answer.valueNumeric !== null &&
        answer.valueNumeric !== undefined &&
        Number(answer.valueNumeric) < Number(rule.conditionValue);
    case "in": {
      const allowed = (Array.isArray(rule.conditionValue) ? rule.conditionValue : [rule.conditionValue])
        .map((value) => String(value).trim().toLowerCase());
      if (selectedOptionCodes.length > 0) {
        return selectedOptionCodes.some((code) => allowed.includes(code.trim().toLowerCase()));
      }
      if (answer.valueText !== null && answer.valueText !== undefined) {
        return allowed.includes(answer.valueText.trim().toLowerCase());
      }
      if (answer.valueNumeric !== null && answer.valueNumeric !== undefined) {
        return allowed.includes(String(answer.valueNumeric));
      }
      return false;
    }
    case "not_in":
      return !conditionMatches(question, { ...rule, conditionOperator: "in" }, answer);
  }
}

/** Evaluate only forward rules; the backend remains authoritative at submission. */
export function determineSkippedSurveyQuestionIds(
  sortedQuestions: ResponseQuestion[],
  rules: SurveyBranchingRule[],
  answers: Record<string, ResponseAnswerState>,
): Set<string> {
  const skipped = new Set<string>();
  const questionOrderMap = new Map<string, number>();
  sortedQuestions.forEach((question, index) => questionOrderMap.set(question.id, index));
  const sortedRules = [...rules].sort((a, b) => b.priority - a.priority);

  for (let index = 0; index < sortedQuestions.length; index += 1) {
    const question = sortedQuestions[index];
    if (skipped.has(question.id)) continue;

    const rulesForQuestion = sortedRules.filter((rule) => rule.sourceQuestionId === question.id);
    for (const rule of rulesForQuestion) {
      if (!conditionMatches(question, rule, answers[question.id])) continue;

      if (rule.targetAction === "end_survey") {
        for (let next = index + 1; next < sortedQuestions.length; next += 1) {
          skipped.add(sortedQuestions[next].id);
        }
        return skipped;
      }

      if (rule.targetAction === "jump_to_question" && rule.targetQuestionId) {
        const targetIndex = questionOrderMap.get(rule.targetQuestionId);
        if (targetIndex !== undefined && targetIndex > index) {
          for (let next = index + 1; next < targetIndex; next += 1) {
            skipped.add(sortedQuestions[next].id);
          }
        }
        break;
      }

      if (rule.targetAction === "jump_to_section" && rule.targetSectionId) {
        const targetIndex = sortedQuestions.findIndex(
          (candidate, candidateIndex) =>
            candidateIndex > index && candidate.sectionId === rule.targetSectionId,
        );
        if (targetIndex > index) {
          for (let next = index + 1; next < targetIndex; next += 1) {
            skipped.add(sortedQuestions[next].id);
          }
        }
        break;
      }
    }
  }

  return skipped;
}
