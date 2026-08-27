import type {
  SurveyAssignment,
  SurveyQuestion,
  SurveyQuestionOption,
  SurveyRepository,
} from "../../domain/survey/survey.entity.js";
import type {
  SurveyAdvancedRepository,
  SurveyMatrixRow,
} from "../../domain/survey/survey-advanced.entity.js";
import type { ActorContext } from "../../domain/shared-kernel/audit-context.js";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "../../domain/shared-kernel/errors.js";
import type { AuditService } from "../audit/audit.service.js";
import type { RbacService } from "../rbac/rbac.service.js";
import type { EventBus } from "../event/event-bus.js";
import {
  determineSkippedQuestionIds,
  sortQuestionsForBranching,
  type QuestionAnswerState,
} from "./survey-branching.evaluator.js";
import { calculateSurveyScoring } from "./survey-scoring.calculator.js";

export interface AnswerInput {
  questionId: string;
  valueText?: string | null;
  valueNumeric?: number | null;
  optionIds?: string[];
}

/** Wave A2 (SUR-ADV-003): one row of a matrix/grid question. Answered
 * separately from the flat `survey_answers` table. */
export interface MatrixAnswerInput {
  questionId: string;
  matrixRowId: string;
  valueText?: string | null;
  valueNumeric?: number | null;
  selectedOptionId?: string | null;
}

/**
 * Survey respondent flow (Checkpoint 1D.1). Gated on `survey.respond` AND
 * ownership (the assignment's respondent must be the actor). Draft answers
 * are upserted while pending/in_progress; submit validates required answers,
 * computes the score, and atomically finalizes — a submitted assignment is
 * immutable (FD-1D — no silent edit of submitted answers).
 */
export class SurveyResponseService {
  constructor(
    private readonly repo: SurveyRepository,
    private readonly audit: AuditService,
    private readonly rbac: RbacService,
    private readonly eventBus: EventBus,
    /** Optional Wave A2 repository: Core-only bootstraps/tests can omit it; matrix
     * answers and Advanced scoring persistence require it when those question
     * types are present. */
    private readonly repoAdvanced?: SurveyAdvancedRepository,
  ) {}

  /** Respondent list, enriched with the survey name + version number so the
   * UI can render a meaningful "My Surveys" list (the assignment itself only
   * references a version id). Small per-row enrichment — a respondent's list
   * is bounded. */
  async listMyAssignments(
    actor: ActorContext,
  ): Promise<{ assignment: SurveyAssignment; surveyName: string | null; versionNumber: number | null }[]> {
    await this.rbac.requirePermission(actor.userId, "survey.respond");
    const assignments = await this.repo.listAssignmentsByRespondentUser(actor.tenantId, actor.userId);
    const out = [];
    for (const assignment of assignments) {
      const version = await this.repo.findVersionById(assignment.surveyVersionId);
      const definition = version ? await this.repo.findDefinitionById(version.surveyDefinitionId) : null;
      out.push({
        assignment,
        surveyName: definition?.name ?? null,
        versionNumber: version?.versionNumber ?? null,
      });
    }
    return out;
  }

  async getAssignment(actor: ActorContext, assignmentId: string) {
    await this.rbac.requirePermission(actor.userId, "survey.respond");
    const assignment = await this.getOwnedAssignmentOrThrow(actor, assignmentId);
    const [sections, questions, options, answers, matrixRows, matrixAnswers, branchingRules] = await Promise.all([
      this.repo.listSections(assignment.surveyVersionId),
      this.repo.listQuestions(assignment.surveyVersionId),
      this.repo.listOptionsForVersion(assignment.surveyVersionId),
      this.repo.listAnswers(assignment.id),
      this.repoAdvanced ? this.repoAdvanced.listMatrixRowsForVersion(assignment.surveyVersionId) : Promise.resolve([]),
      this.repoAdvanced ? this.repoAdvanced.listMatrixAnswers(assignment.id) : Promise.resolve([]),
      this.repoAdvanced ? this.repoAdvanced.listBranchingRules(assignment.surveyVersionId) : Promise.resolve([]),
    ]);
    const optsByQuestion = groupOptions(options);
    const rowsByQuestion = groupMatrixRows(matrixRows);
    const answerViews = [];
    for (const a of answers) {
      answerViews.push({
        questionId: a.surveyQuestionId,
        valueText: a.valueText,
        valueNumeric: a.valueNumeric,
        selectedOptionIds: await this.repo.listAnswerOptionIds(a.id),
      });
    }
    const matrixAnswerViews = matrixAnswers.map((ma) => ({
      questionId: ma.surveyQuestionId,
      matrixRowId: ma.matrixRowId,
      valueText: ma.valueText,
      valueNumeric: ma.valueNumeric,
      selectedOptionId: ma.selectedOptionId,
    }));
    return {
      assignment,
      sections,
      questions: questions.map((q) => ({
        ...q,
        options: optsByQuestion.get(q.id) ?? [],
        matrixRows: rowsByQuestion.get(q.id) ?? [],
      })),
      answers: answerViews,
      matrixAnswers: matrixAnswerViews,
      branchingRules,
    };
  }

  async saveAnswers(
    actor: ActorContext,
    assignmentId: string,
    answers: AnswerInput[],
    matrixAnswers?: MatrixAnswerInput[],
  ): Promise<void> {
    await this.rbac.requirePermission(actor.userId, "survey.respond");
    const assignment = await this.getOwnedAssignmentOrThrow(actor, assignmentId);
    this.assertEditable(assignment);

    const [sections, questions, options] = await Promise.all([
      this.repo.listSections(assignment.surveyVersionId),
      this.repo.listQuestions(assignment.surveyVersionId),
      this.repo.listOptionsForVersion(assignment.surveyVersionId),
    ]);
    const questionById = new Map(questions.map((q) => [q.id, q]));
    const optionById = new Map(options.map((o) => [o.id, o]));
    const sortedQuestions = sortQuestionsForBranching(sections, questions);
    const matrixQuestionIds = new Set(
      sortedQuestions
        .filter((q) => q.questionType === "matrix_rating" || q.questionType === "matrix_single_choice")
        .map((q) => q.id),
    );

    const submittedQuestionIds = new Set<string>();
    for (const ans of answers) {
      if (submittedQuestionIds.has(ans.questionId)) {
        throw new ValidationError(`Duplicate answer detected for question '${ans.questionId}'`);
      }
      submittedQuestionIds.add(ans.questionId);
    }

    const submittedMatrixRows = new Set<string>();
    for (const ma of matrixAnswers ?? []) {
      const rowKey = `${ma.questionId}:${ma.matrixRowId}`;
      if (submittedMatrixRows.has(rowKey)) {
        throw new ValidationError(`Duplicate matrix answer detected for question '${ma.questionId}' row '${ma.matrixRowId}'`);
      }
      submittedMatrixRows.add(rowKey);
    }

    for (const ans of answers) {
      const q = questionById.get(ans.questionId);
      if (!q) throw new ValidationError(`Question ${ans.questionId} does not belong to this survey`);
      if (matrixQuestionIds.has(q.id)) {
        throw new ValidationError(`Matrix question '${q.code}' must be answered through matrixAnswers`);
      }
      const { valueText, valueNumeric, optionIds } = await this.validateAnswerForType(q, ans);
      const saved = await this.repo.upsertAnswer({
        surveyAssignmentId: assignment.id,
        surveyQuestionId: q.id,
        valueText,
        valueNumeric,
      });
      await this.repo.replaceAnswerOptions(saved.id, optionIds);
    }

    if (matrixAnswers && matrixAnswers.length > 0) {
      if (!this.repoAdvanced) {
        throw new ValidationError("Matrix answers are not available because Survey Advanced is not enabled");
      }

      const matrixRows = await this.repoAdvanced.listMatrixRowsForVersion(assignment.surveyVersionId);
      const matrixRowById = new Map(matrixRows.map((r) => [r.id, r]));

      for (const ma of matrixAnswers) {
        const q = questionById.get(ma.questionId);
        if (!q) throw new ValidationError(`Question ${ma.questionId} does not belong to this survey`);
        if (!matrixQuestionIds.has(q.id)) {
          throw new ValidationError(`Question '${q.code}' is not a matrix question`);
        }
        const row = matrixRowById.get(ma.matrixRowId);
        if (!row || row.surveyQuestionId !== q.id) {
          throw new ValidationError(`Matrix row ${ma.matrixRowId} is not valid for question '${q.code}'`);
        }

        if (q.questionType === "matrix_single_choice") {
          if (!ma.selectedOptionId) {
            throw new ValidationError(`Matrix single-choice question '${q.code}' requires a selected option per row`);
          }
          const selectedOption = optionById.get(ma.selectedOptionId);
          if (!selectedOption || selectedOption.surveyQuestionId !== q.id) {
            throw new ValidationError(`Selected option is not valid for matrix question '${q.code}'`);
          }
        }

        if (q.questionType === "matrix_rating") {
          const min = q.config.min as number;
          const max = q.config.max as number;
          if (typeof ma.valueNumeric !== "number" || !Number.isFinite(ma.valueNumeric)) {
            throw new ValidationError(`Matrix rating question '${q.code}' requires a numeric value per row`);
          }
          if (ma.valueNumeric < min || ma.valueNumeric > max) {
            throw new ValidationError(`Matrix rating for '${q.code}' must be between ${min} and ${max}`);
          }
        }

        await this.repoAdvanced.upsertMatrixAnswer({
          tenantId: actor.tenantId,
          surveyAssignmentId: assignment.id,
          surveyQuestionId: q.id,
          matrixRowId: row.id,
          valueText: ma.valueText ?? null,
          valueNumeric: ma.valueNumeric ?? null,
          selectedOptionId: ma.selectedOptionId ?? null,
        });
      }
    }

    if (assignment.status === "pending") await this.repo.markInProgress(assignment.id);
  }

  async submit(actor: ActorContext, assignmentId: string): Promise<SurveyAssignment> {
    await this.rbac.requirePermission(actor.userId, "survey.respond");
    const assignment = await this.getOwnedAssignmentOrThrow(actor, assignmentId);
    this.assertEditable(assignment);

    const version = await this.repo.findVersionById(assignment.surveyVersionId);
    if (!version) throw new NotFoundError("SurveyVersion", assignment.surveyVersionId);

    const [sections, questions, options, answers, matrixRows, matrixAnswers, branchingRules] = await Promise.all([
      this.repo.listSections(version.id),
      this.repo.listQuestions(version.id),
      this.repo.listOptionsForVersion(version.id),
      this.repo.listAnswers(assignment.id),
      this.repoAdvanced ? this.repoAdvanced.listMatrixRowsForVersion(version.id) : Promise.resolve([]),
      this.repoAdvanced ? this.repoAdvanced.listMatrixAnswers(assignment.id) : Promise.resolve([]),
      this.repoAdvanced ? this.repoAdvanced.listBranchingRules(version.id) : Promise.resolve([]),
    ]);

    const optionById = new Map<string, SurveyQuestionOption>(options.map((o) => [o.id, o]));
    const questionById = new Map<string, SurveyQuestion>(questions.map((q) => [q.id, q]));

    // Answer option map
    const answerOptionIdsByAnswerId = new Map<string, string[]>();
    for (const a of answers) {
      answerOptionIdsByAnswerId.set(a.id, await this.repo.listAnswerOptionIds(a.id));
    }

    // Build question answer state for branching evaluation
    const answersByQ = new Map<string, QuestionAnswerState>();
    for (const a of answers) {
      const q = questionById.get(a.surveyQuestionId);
      if (!q) continue;
      const optIds = answerOptionIdsByAnswerId.get(a.id) ?? [];
      const optCodes = optIds
        .map((oid) => optionById.get(oid)?.code)
        .filter((c): c is string => Boolean(c));
      answersByQ.set(q.id, {
        valueText: a.valueText ?? null,
        valueNumeric: a.valueNumeric ?? null,
        selectedOptionCodes: optCodes,
      });
    }

    if (matrixAnswers.length > 0) {
      for (const ma of matrixAnswers) {
        const existing = answersByQ.get(ma.surveyQuestionId) ?? {
          valueText: null,
          valueNumeric: null,
          selectedOptionCodes: [],
          matrixRowsAnsweredCount: 0,
        };
        existing.matrixRowsAnsweredCount = (existing.matrixRowsAnsweredCount ?? 0) + 1;
        answersByQ.set(ma.surveyQuestionId, existing);
      }
    }

    // Branching graph skip calculation
    const sortedQuestions = sortQuestionsForBranching(sections, questions);
    const skippedQuestionIds = determineSkippedQuestionIds(
      sortedQuestions,
      branchingRules,
      answersByQ,
    );

    // Required validation (backend authoritative, excluding skipped questions)
    for (const q of sortedQuestions) {
      if (!q.isRequired || skippedQuestionIds.has(q.id)) continue;
      const ansState = answersByQ.get(q.id);
      if (!ansState) {
        throw new ValidationError(`Required question '${q.code}' has no answer`);
      }
      if (q.questionType === "matrix_rating" || q.questionType === "matrix_single_choice") {
        const requiredRows = matrixRows.filter((r) => r.surveyQuestionId === q.id);
        const answeredCount = ansState.matrixRowsAnsweredCount ?? 0;
        if (answeredCount < requiredRows.length) {
          throw new ValidationError(
            `Matrix question '${q.code}' requires answers for all ${requiredRows.length} rows (got ${answeredCount})`,
          );
        }
      } else if (q.questionType === "rating" || q.questionType === "numeric") {
        if (ansState.valueNumeric === null || ansState.valueNumeric === undefined) {
          throw new ValidationError(`Numeric question '${q.code}' requires a numeric score`);
        }
      } else if (q.questionType === "single_choice" || q.questionType === "multiple_choice") {
        if (ansState.selectedOptionCodes.length === 0) {
          throw new ValidationError(`Choice question '${q.code}' requires a selection`);
        }
      } else if (
        q.questionType === "long_text" ||
        q.questionType === "short_text" ||
        q.questionType === "yes_no" ||
        q.questionType === "date"
      ) {
        if (!ansState.valueText || ansState.valueText.trim().length === 0) {
          throw new ValidationError(`Question '${q.code}' requires an answer`);
        }
      }
    }

    // Multi-dimensional scoring calculation
    const activeQuestions = sortedQuestions.filter((q) => !skippedQuestionIds.has(q.id));
    const activeAnswers = answers.filter((a) => !skippedQuestionIds.has(a.surveyQuestionId));
    const activeMatrixAnswers = matrixAnswers.filter((ma) => !skippedQuestionIds.has(ma.surveyQuestionId));

    const scoringResult = calculateSurveyScoring({
      version,
      sections,
      questions: activeQuestions,
      options,
      matrixRows,
      answers: activeAnswers,
      matrixAnswers: activeMatrixAnswers,
      answerOptionIdsByAnswerId,
    });

    // Persist section scores if Advanced repo available
    if (this.repoAdvanced) {
      for (const ss of scoringResult.sectionScores) {
        await this.repoAdvanced.upsertSectionScore({
          tenantId: actor.tenantId,
          surveyAssignmentId: assignment.id,
          surveySectionId: ss.sectionId,
          rawScore: ss.rawScore,
          maxScore: ss.maxScore,
          percentageScore: ss.percentageScore,
          weightedScore: ss.weightedScore,
        });
      }
    }

    // Atomic finalize — guarded so it can never double-submit.
    const finalized = await this.repo.finalizeSubmission(
      assignment.id,
      scoringResult.totalScore,
      new Date(),
      {
        npsScore: scoringResult.npsScore,
        scoringBreakdown: {
          scoringModel: scoringResult.scoringModel,
          sectionScores: scoringResult.sectionScores,
          npsClassification: scoringResult.npsClassification,
        },
      },
    );
    if (!finalized) throw new ConflictError("This survey is no longer open for submission");

    await this.audit.record({
      tenantId: actor.tenantId,
      actorUserId: actor.userId,
      action: "survey.submitted",
      entityType: "survey_assignment",
      entityId: finalized.id,
      metadata: {
        totalScore: finalized.totalScore,
        npsScore: finalized.npsScore,
      },
    });
    await this.eventBus.publish({
      tenantId: actor.tenantId,
      eventType: "survey.submitted",
      entityType: "survey_assignment",
      entityId: finalized.id,
      payload: {
        surveyVersionId: finalized.surveyVersionId,
        targetUserId: actor.userId,
        totalScore: finalized.totalScore,
        npsScore: finalized.npsScore,
        contextEntityType: finalized.contextEntityType,
        contextEntityId: finalized.contextEntityId,
      },
      createdBy: actor.userId,
    });
    return finalized;
  }

  // --- internals ----------------------------------------------------------

  private async getOwnedAssignmentOrThrow(actor: ActorContext, id: string): Promise<SurveyAssignment> {
    const assignment = await this.repo.findAssignmentById(id);
    if (!assignment || assignment.tenantId !== actor.tenantId) {
      throw new NotFoundError("SurveyAssignment", id);
    }
    if (assignment.respondentType !== "user" || assignment.respondentUserId !== actor.userId) {
      throw new ForbiddenError("This survey is not assigned to you");
    }
    return assignment;
  }

  private assertEditable(assignment: SurveyAssignment): void {
    if (assignment.status === "submitted") {
      throw new ConflictError("This survey has already been submitted and cannot be changed");
    }
    if (assignment.status === "cancelled" || assignment.status === "expired") {
      throw new ConflictError(`This survey is '${assignment.status}' and cannot be answered`);
    }
  }

  private async validateAnswerForType(
    q: SurveyQuestion,
    ans: AnswerInput,
  ): Promise<{ valueText: string | null; valueNumeric: number | null; optionIds: string[] }> {
    if (q.questionType === "rating") {
      const v = ans.valueNumeric;
      const min = q.config.min as number;
      const max = q.config.max as number;
      if (typeof v !== "number" || !Number.isInteger(v)) {
        throw new ValidationError(`Question '${q.code}' expects an integer rating`);
      }
      if (v < min || v > max) throw new ValidationError(`Rating for '${q.code}' must be between ${min} and ${max}`);
      return { valueText: null, valueNumeric: v, optionIds: [] };
    }
    if (q.questionType === "numeric") {
      const v = ans.valueNumeric;
      if (typeof v !== "number" || !Number.isFinite(v)) {
        throw new ValidationError(`Question '${q.code}' expects a numeric value`);
      }
      return { valueText: null, valueNumeric: v, optionIds: [] };
    }
    if (q.questionType === "long_text" || q.questionType === "short_text" || q.questionType === "date") {
      const t = ans.valueText;
      if (t !== null && t !== undefined && typeof t !== "string") {
        throw new ValidationError(`Question '${q.code}' expects text`);
      }
      return { valueText: t ?? null, valueNumeric: null, optionIds: [] };
    }
    if (q.questionType === "yes_no") {
      const t = ans.valueText;
      if (t !== "yes" && t !== "no") {
        throw new ValidationError(`Question '${q.code}' expects 'yes' or 'no'`);
      }
      return { valueText: t, valueNumeric: null, optionIds: [] };
    }
    if (q.questionType === "multiple_choice") {
      const optionIds = ans.optionIds ?? [];
      if (optionIds.length === 0) {
        throw new ValidationError(`Question '${q.code}' requires at least one selected option`);
      }
      for (const oid of optionIds) {
        const opt = await this.repo.findOptionById(oid);
        if (!opt || opt.surveyQuestionId !== q.id) {
          throw new ValidationError(`Selected option is not valid for question '${q.code}'`);
        }
      }
      return { valueText: null, valueNumeric: null, optionIds };
    }
    // single_choice
    const optionIds = ans.optionIds ?? [];
    if (optionIds.length !== 1) {
      throw new ValidationError(`Question '${q.code}' requires exactly one selected option`);
    }
    const opt = await this.repo.findOptionById(optionIds[0]);
    if (!opt || opt.surveyQuestionId !== q.id) {
      throw new ValidationError(`Selected option is not valid for question '${q.code}'`);
    }
    return { valueText: null, valueNumeric: null, optionIds };
  }
}

function groupOptions(options: SurveyQuestionOption[]): Map<string, SurveyQuestionOption[]> {
  const m = new Map<string, SurveyQuestionOption[]>();
  for (const o of options) {
    const arr = m.get(o.surveyQuestionId) ?? [];
    arr.push(o);
    m.set(o.surveyQuestionId, arr);
  }
  return m;
}

function groupMatrixRows(rows: SurveyMatrixRow[]): Map<string, SurveyMatrixRow[]> {
  const m = new Map<string, SurveyMatrixRow[]>();
  for (const r of rows) {
    const arr = m.get(r.surveyQuestionId) ?? [];
    arr.push(r);
    m.set(r.surveyQuestionId, arr);
  }
  return m;
}
