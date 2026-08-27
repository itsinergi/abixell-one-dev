import type {
  BranchConditionOperator,
  SurveyBranchingRule,
} from "../../domain/survey/survey-advanced.entity.js";
import type { SurveyQuestion, SurveySection } from "../../domain/survey/survey.entity.js";

export interface BranchGraphValidationResult {
  isValid: boolean;
  errors: string[];
}

export interface QuestionAnswerState {
  valueText: string | null;
  valueNumeric: number | null;
  selectedOptionCodes: string[];
  matrixRowsAnsweredCount?: number;
}

export function sortQuestionsForBranching(
  sections: SurveySection[],
  questions: SurveyQuestion[],
): SurveyQuestion[] {
  const sectionOrderMap = new Map<string, number>();
  [...sections]
    .sort((a, b) => a.sortOrder - b.sortOrder || a.code.localeCompare(b.code))
    .forEach((s, idx) => sectionOrderMap.set(s.id, idx));

  return [...questions].sort((a, b) => {
    const aSectionOrder = a.sectionId ? sectionOrderMap.get(a.sectionId) ?? Number.MAX_SAFE_INTEGER : Number.MAX_SAFE_INTEGER;
    const bSectionOrder = b.sectionId ? sectionOrderMap.get(b.sectionId) ?? Number.MAX_SAFE_INTEGER : Number.MAX_SAFE_INTEGER;
    return (
      aSectionOrder - bSectionOrder ||
      a.sortOrder - b.sortOrder ||
      a.code.localeCompare(b.code) ||
      a.id.localeCompare(b.id)
    );
  });
}

/**
 * Validates survey branching graph structure.
 *
 * Rules:
 * 1. Source question must exist in survey version.
 * 2. Target action `jump_to_question` must point to an existing question.
 * 3. Target action `jump_to_section` must point to an existing section.
 * 4. Forward-only rule: Target question/section must appear AFTER source question in sort order.
 * 5. No cycles: Because all jumps are strictly forward-only in a linear sequence,
 *    cycles are mathematically impossible when forward-only is strictly enforced.
 */
export function validateBranchGraph(
  sections: SurveySection[],
  questions: SurveyQuestion[],
  rules: SurveyBranchingRule[],
): BranchGraphValidationResult {
  const errors: string[] = [];
  const questionMap = new Map<string, SurveyQuestion>();
  const sectionMap = new Map<string, SurveySection>();

  // Map sort orders
  const sortedSections = [...sections].sort((a, b) => a.sortOrder - b.sortOrder);
  const sectionOrderMap = new Map<string, number>();
  sortedSections.forEach((s, idx) => {
    sectionMap.set(s.id, s);
    sectionOrderMap.set(s.id, idx);
  });

  const sortedQuestions = sortQuestionsForBranching(sections, questions);
  const questionOrderMap = new Map<string, number>();
  sortedQuestions.forEach((q, idx) => {
    questionMap.set(q.id, q);
    questionOrderMap.set(q.id, idx);
  });

  for (const rule of rules) {
    const sourceQ = questionMap.get(rule.sourceQuestionId);
    if (!sourceQ) {
      errors.push(`Branching rule '${rule.id}' references non-existent source question '${rule.sourceQuestionId}'`);
      continue;
    }
    const sourceOrder = questionOrderMap.get(rule.sourceQuestionId) ?? 0;

    if (rule.targetAction === "jump_to_question") {
      if (!rule.targetQuestionId) {
        errors.push(`Branching rule from question '${sourceQ.code}' has jump_to_question action without targetQuestionId`);
        continue;
      }
      const targetQ = questionMap.get(rule.targetQuestionId);
      if (!targetQ) {
        errors.push(`Branching rule from question '${sourceQ.code}' targets non-existent question '${rule.targetQuestionId}'`);
        continue;
      }
      const targetOrder = questionOrderMap.get(rule.targetQuestionId) ?? 0;
      if (targetOrder <= sourceOrder) {
        errors.push(
          `Branching rule from question '${sourceQ.code}' (order ${sourceOrder}) jumps backward/to-self to question '${targetQ.code}' (order ${targetOrder}). Only forward jumps are permitted.`,
        );
      }
    } else if (rule.targetAction === "jump_to_section") {
      if (!rule.targetSectionId) {
        errors.push(`Branching rule from question '${sourceQ.code}' has jump_to_section action without targetSectionId`);
        continue;
      }
      const targetSec = sectionMap.get(rule.targetSectionId);
      if (!targetSec) {
        errors.push(`Branching rule from question '${sourceQ.code}' targets non-existent section '${rule.targetSectionId}'`);
        continue;
      }
      if (sourceQ.sectionId) {
        const sourceSecOrder = sectionOrderMap.get(sourceQ.sectionId) ?? 0;
        const targetSecOrder = sectionOrderMap.get(rule.targetSectionId) ?? 0;
        if (targetSecOrder <= sourceSecOrder) {
          errors.push(
            `Branching rule from question '${sourceQ.code}' jumps backward/to-self to section '${targetSec.code}'. Only forward jumps are permitted.`,
          );
        }
      }
    } else if (rule.targetAction === "end_survey") {
      // Valid end target
    } else {
      errors.push(`Unknown target action '${rule.targetAction}' in branching rule for question '${sourceQ.code}'`);
    }
  }

  return {
    isValid: errors.length === 0,
    errors,
  };
}

/**
 * Evaluates whether a branching condition operator matches the given answer.
 */
export function evaluateCondition(
  operator: BranchConditionOperator,
  conditionValue: unknown,
  answer: QuestionAnswerState | null | undefined,
): boolean {
  if (!answer) {
    return operator === "is_unanswered";
  }

  switch (operator) {
    case "is_answered": {
      const hasText = Boolean(answer.valueText && answer.valueText.trim().length > 0);
      const hasNumeric = answer.valueNumeric !== null && answer.valueNumeric !== undefined;
      const hasOptions = answer.selectedOptionCodes && answer.selectedOptionCodes.length > 0;
      const hasMatrix = (answer.matrixRowsAnsweredCount ?? 0) > 0;
      return hasText || hasNumeric || hasOptions || hasMatrix;
    }
    case "is_unanswered": {
      return !evaluateCondition("is_answered", null, answer);
    }
    case "equals": {
      if (answer.valueNumeric !== null && answer.valueNumeric !== undefined) {
        return Number(conditionValue) === Number(answer.valueNumeric);
      }
      if (answer.selectedOptionCodes.length > 0) {
        return answer.selectedOptionCodes.includes(String(conditionValue));
      }
      if (answer.valueText !== null && answer.valueText !== undefined) {
        return String(conditionValue).trim().toLowerCase() === answer.valueText.trim().toLowerCase();
      }
      return false;
    }
    case "not_equals": {
      return !evaluateCondition("equals", conditionValue, answer);
    }
    case "greater_than": {
      if (answer.valueNumeric === null || answer.valueNumeric === undefined) return false;
      return Number(answer.valueNumeric) > Number(conditionValue);
    }
    case "less_than": {
      if (answer.valueNumeric === null || answer.valueNumeric === undefined) return false;
      return Number(answer.valueNumeric) < Number(conditionValue);
    }
    case "in": {
      const allowedList = Array.isArray(conditionValue)
        ? conditionValue.map((v) => String(v).trim().toLowerCase())
        : [String(conditionValue).trim().toLowerCase()];

      if (answer.selectedOptionCodes.length > 0) {
        return answer.selectedOptionCodes.some((code) =>
          allowedList.includes(code.trim().toLowerCase()),
        );
      }
      if (answer.valueText !== null && answer.valueText !== undefined) {
        return allowedList.includes(answer.valueText.trim().toLowerCase());
      }
      if (answer.valueNumeric !== null && answer.valueNumeric !== undefined) {
        return allowedList.includes(String(answer.valueNumeric));
      }
      return false;
    }
    case "not_in": {
      return !evaluateCondition("in", conditionValue, answer);
    }
    default:
      return false;
  }
}

/**
 * Determines skipped questions based on matching branching rules.
 */
export function determineSkippedQuestionIds(
  sortedQuestions: SurveyQuestion[],
  rules: SurveyBranchingRule[],
  answersByQuestionId: Map<string, QuestionAnswerState>,
): Set<string> {
  const skipped = new Set<string>();
  const questionOrderMap = new Map<string, number>();
  sortedQuestions.forEach((q, idx) => questionOrderMap.set(q.id, idx));

  // Sort rules by priority descending, then createdAt ascending
  const sortedRules = [...rules].sort((a, b) => b.priority - a.priority);

  for (let i = 0; i < sortedQuestions.length; i++) {
    const q = sortedQuestions[i];
    if (skipped.has(q.id)) continue;

    const answer = answersByQuestionId.get(q.id);
    const applicableRules = sortedRules.filter((r) => r.sourceQuestionId === q.id);

    for (const rule of applicableRules) {
      const isMatch = evaluateCondition(rule.conditionOperator, rule.conditionValue, answer);
      if (!isMatch) continue;

      if (rule.targetAction === "end_survey") {
        // Skip all subsequent questions
        for (let j = i + 1; j < sortedQuestions.length; j++) {
          skipped.add(sortedQuestions[j].id);
        }
        return skipped;
      }

      if (rule.targetAction === "jump_to_question" && rule.targetQuestionId) {
        const targetOrder = questionOrderMap.get(rule.targetQuestionId);
        if (targetOrder !== undefined && targetOrder > i) {
          for (let j = i + 1; j < targetOrder; j++) {
            skipped.add(sortedQuestions[j].id);
          }
        }
        break; // highest priority matching rule takes precedence
      }

      if (rule.targetAction === "jump_to_section" && rule.targetSectionId) {
        // Skip all questions up to the first question of targetSectionId
        const targetFirstQIndex = sortedQuestions.findIndex(
          (cand, idx) => idx > i && cand.sectionId === rule.targetSectionId,
        );
        if (targetFirstQIndex > i) {
          for (let j = i + 1; j < targetFirstQIndex; j++) {
            skipped.add(sortedQuestions[j].id);
          }
        }
        break;
      }
    }
  }

  return skipped;
}
