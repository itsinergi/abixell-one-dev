import { createHash } from "node:crypto";
import type {
  PublicSurveyView,
  SurveyAdvancedRepository,
  SurveyMatrixRow,
} from "../../domain/survey/survey-advanced.entity.js";
import type {
  SurveyQuestion,
  SurveyQuestionOption,
  SurveyRepository,
} from "../../domain/survey/survey.entity.js";
import {
  ConflictError,
  NotFoundError,
  ValidationError,
} from "../../domain/shared-kernel/errors.js";
import type { AuditService } from "../audit/audit.service.js";
import type { EventBus } from "../event/event-bus.js";
import {
  determineSkippedQuestionIds,
  sortQuestionsForBranching,
  type QuestionAnswerState,
} from "./survey-branching.evaluator.js";
import { calculateSurveyScoring } from "./survey-scoring.calculator.js";

export interface PublicAnswerInput {
  questionId: string;
  valueText?: string | null;
  valueNumeric?: number | null;
  optionIds?: string[];
}

export interface PublicMatrixAnswerInput {
  questionId: string;
  matrixRowId: string;
  valueText?: string | null;
  valueNumeric?: number | null;
  selectedOptionId?: string | null;
}

export class SurveyPublicResponseService {
  constructor(
    private readonly repo: SurveyRepository,
    private readonly repoAdvanced: SurveyAdvancedRepository,
    private readonly audit: AuditService,
    private readonly eventBus: EventBus,
  ) {}

  /**
   * Loads the public survey questionnaire using a distribution token.
   * Resolves multi-language translations according to requested locale or defaultLocale.
   */
  async getPublicSurvey(rawToken: string, requestedLocale?: string): Promise<PublicSurveyView> {
    const tokenHash = createHash("sha256").update(rawToken).digest("hex");
    const distToken = await this.repoAdvanced.findDistributionTokenByHash(tokenHash);
    if (!distToken) {
      throw new NotFoundError("SurveyDistributionToken", "invalid_token");
    }

    if (distToken.revokedAt) {
      throw new ConflictError("This survey link has been revoked and is no longer accepting responses");
    }
    if (distToken.expiresAt && new Date(distToken.expiresAt) < new Date()) {
      throw new ConflictError("This survey link has expired and is no longer accepting responses");
    }
    if (distToken.maxUses !== null && distToken.usedCount >= distToken.maxUses) {
      throw new ConflictError("This survey link has reached its maximum response quota");
    }

    const version = await this.repo.findVersionById(distToken.surveyVersionId);
    if (!version || version.status !== "published") {
      throw new NotFoundError("SurveyVersion", distToken.surveyVersionId);
    }
    const definition = await this.repo.findDefinitionById(version.surveyDefinitionId);
    if (!definition || !definition.isActive) {
      throw new NotFoundError("SurveyDefinition", version.surveyDefinitionId);
    }

    const locale = requestedLocale || version.defaultLocale || "id-ID";

    const [sections, questions, options, matrixRows, branchingRules, translations] =
      await Promise.all([
        this.repo.listSections(version.id),
        this.repo.listQuestions(version.id),
        this.repo.listOptionsForVersion(version.id),
        this.repoAdvanced.listMatrixRowsForVersion(version.id),
        this.repoAdvanced.listBranchingRules(version.id),
        this.repoAdvanced.listTranslations(version.id, locale),
      ]);

    // Build translation lookup: map key = `${entityType}:${entityId}:${fieldName}` -> translatedText
    const transMap = new Map<string, string>();
    for (const t of translations) {
      transMap.set(`${t.entityType}:${t.entityId}:${t.fieldName}`, t.translatedText);
    }

    const optsByQuestion = new Map<string, SurveyQuestionOption[]>();
    for (const opt of options) {
      const list = optsByQuestion.get(opt.surveyQuestionId) ?? [];
      list.push(opt);
      optsByQuestion.set(opt.surveyQuestionId, list);
    }

    const matrixRowsByQuestion = new Map<string, SurveyMatrixRow[]>();
    for (const mr of matrixRows) {
      const list = matrixRowsByQuestion.get(mr.surveyQuestionId) ?? [];
      list.push(mr);
      matrixRowsByQuestion.set(mr.surveyQuestionId, list);
    }

    const translatedDefName = transMap.get(`definition:${definition.id}:name`) ?? definition.name;
    const translatedDefDesc = transMap.get(`definition:${definition.id}:description`) ?? definition.description;

    return {
      definitionCode: definition.code,
      definitionName: translatedDefName,
      description: translatedDefDesc,
      versionNumber: version.versionNumber,
      defaultLocale: version.defaultLocale,
      locale,
      sections: sections.map((s) => ({
        id: s.id,
        code: s.code,
        title: transMap.get(`section:${s.id}:title`) ?? s.title,
        description: transMap.get(`section:${s.id}:description`) ?? s.description,
        sortOrder: s.sortOrder,
      })),
      questions: questions.map((q) => {
        const qOptions = optsByQuestion.get(q.id) ?? [];
        const qMatrixRows = matrixRowsByQuestion.get(q.id) ?? [];
        return {
          id: q.id,
          sectionId: q.sectionId,
          code: q.code,
          text: transMap.get(`question:${q.id}:text`) ?? q.text,
          questionType: q.questionType,
          isRequired: q.isRequired,
          config: q.config,
          sortOrder: q.sortOrder,
          options: qOptions.map((o) => ({
            id: o.id,
            code: o.code,
            label: transMap.get(`option:${o.id}:label`) ?? o.label,
            sortOrder: o.sortOrder,
          })),
          matrixRows: qMatrixRows.map((r) => ({
            id: r.id,
            code: r.code,
            label: transMap.get(`matrix_row:${r.id}:label`) ?? r.label,
            sortOrder: r.sortOrder,
          })),
        };
      }),
      branchingRules: branchingRules.map((r) => ({
        sourceQuestionId: r.sourceQuestionId,
        conditionOperator: r.conditionOperator,
        conditionValue: r.conditionValue,
        targetAction: r.targetAction,
        targetQuestionId: r.targetQuestionId,
        targetSectionId: r.targetSectionId,
        priority: r.priority,
      })),
    };
  }

  /**
   * Submits answers for a public / anonymous survey.
   * Invariant: Never stores any user_id or customer_contact_id (Zero identity leakage).
   */
  async submitPublicSurvey(
    rawToken: string,
    input: {
      answers: PublicAnswerInput[];
      matrixAnswers?: PublicMatrixAnswerInput[];
    },
  ): Promise<{ assignmentId: string; totalScore: number | null; npsScore: number | null }> {
    const tokenHash = createHash("sha256").update(rawToken).digest("hex");
    const distToken = await this.repoAdvanced.findDistributionTokenByHash(tokenHash);
    if (!distToken) {
      throw new NotFoundError("SurveyDistributionToken", "invalid_token");
    }

    if (distToken.revokedAt) {
      throw new ConflictError("This survey link has been revoked and is no longer accepting responses");
    }
    if (distToken.expiresAt && new Date(distToken.expiresAt) < new Date()) {
      throw new ConflictError("This survey link has expired and is no longer accepting responses");
    }
    if (distToken.maxUses !== null && distToken.usedCount >= distToken.maxUses) {
      throw new ConflictError("This survey link has reached its maximum response quota");
    }

    const version = await this.repo.findVersionById(distToken.surveyVersionId);
    if (!version || version.status !== "published") {
      throw new NotFoundError("SurveyVersion", distToken.surveyVersionId);
    }

    const [sections, questions, options, matrixRows, branchingRules] = await Promise.all([
      this.repo.listSections(version.id),
      this.repo.listQuestions(version.id),
      this.repo.listOptionsForVersion(version.id),
      this.repoAdvanced.listMatrixRowsForVersion(version.id),
      this.repoAdvanced.listBranchingRules(version.id),
    ]);

    const optionById = new Map<string, SurveyQuestionOption>(options.map((o) => [o.id, o]));
    const matrixRowById = new Map<string, SurveyMatrixRow>(matrixRows.map((r) => [r.id, r]));
    const questionById = new Map<string, SurveyQuestion>(questions.map((q) => [q.id, q]));
    const sortedQuestions = sortQuestionsForBranching(sections, questions);
    const matrixQuestionIds = new Set(
      sortedQuestions
        .filter((q) => q.questionType === "matrix_rating" || q.questionType === "matrix_single_choice")
        .map((q) => q.id),
    );

    const normalizedAnswers = new Map<
      string,
      { valueText: string | null; valueNumeric: number | null; optionIds: string[] }
    >();
    const submittedQuestionIds = new Set<string>();
    for (const ans of input.answers) {
      if (submittedQuestionIds.has(ans.questionId)) {
        throw new ValidationError(`Duplicate answer detected for question '${ans.questionId}'`);
      }
      submittedQuestionIds.add(ans.questionId);
      const q = questionById.get(ans.questionId);
      if (!q) {
        throw new ValidationError(`Question ${ans.questionId} does not belong to this survey`);
      }
      if (matrixQuestionIds.has(q.id)) {
        throw new ValidationError(`Matrix question '${q.code}' must be answered through matrixAnswers`);
      }
      normalizedAnswers.set(q.id, validatePublicAnswerForType(q, ans, optionById));
    }

    const submittedMatrixRows = new Set<string>();
    for (const ma of input.matrixAnswers ?? []) {
      const rowKey = `${ma.questionId}:${ma.matrixRowId}`;
      if (submittedMatrixRows.has(rowKey)) {
        throw new ValidationError(`Duplicate matrix answer detected for question '${ma.questionId}' row '${ma.matrixRowId}'`);
      }
      submittedMatrixRows.add(rowKey);

      const q = questionById.get(ma.questionId);
      if (!q) {
        throw new ValidationError(`Question ${ma.questionId} does not belong to this survey`);
      }
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
    }

    // Build answer state for branching evaluation
    const answersByQ = new Map<string, QuestionAnswerState>();
    for (const ans of input.answers) {
      const q = questionById.get(ans.questionId);
      if (!q) continue;
      const normalized = normalizedAnswers.get(q.id);
      if (!normalized) continue;
      const optCodes = normalized.optionIds
        .map((oid) => optionById.get(oid)?.code)
        .filter((c): c is string => Boolean(c));
      answersByQ.set(ans.questionId, {
        valueText: ans.valueText ?? null,
        valueNumeric: ans.valueNumeric ?? null,
        selectedOptionCodes: optCodes,
      });
    }

    if (input.matrixAnswers) {
      for (const ma of input.matrixAnswers) {
        const existing = answersByQ.get(ma.questionId) ?? {
          valueText: null,
          valueNumeric: null,
          selectedOptionCodes: [],
          matrixRowsAnsweredCount: 0,
        };
        existing.matrixRowsAnsweredCount = (existing.matrixRowsAnsweredCount ?? 0) + 1;
        answersByQ.set(ma.questionId, existing);
      }
    }

    // Determine skipped questions from branching graph
    const skippedQuestionIds = determineSkippedQuestionIds(
      sortedQuestions,
      branchingRules,
      answersByQ,
    );

    // Validate required questions (excluding skipped)
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

    // Respondent identity isolation:
    // anonymous or public_link - zero user_id or customer_contact_id
    const respondentType = distToken.recipientLabel ? "public_link" : "anonymous";

    const assignment = await this.repo.createAssignment({
      tenantId: distToken.tenantId,
      surveyVersionId: version.id,
      respondentType,
      respondentUserId: null,
      respondentCustomerContactId: null,
      contextEntityType: null,
      contextEntityId: null,
      dueAt: null,
      assignedBy: null,
      distributionTokenId: distToken.id,
    });

    // Save flat answers
    const savedAnswers = [];
    const answerOptionIdsByAnswerId = new Map<string, string[]>();

    for (const ans of input.answers) {
      if (skippedQuestionIds.has(ans.questionId)) continue;
      const q = questionById.get(ans.questionId);
      if (!q) continue;
      const normalized = normalizedAnswers.get(q.id);
      if (!normalized) continue;

      const saved = await this.repo.upsertAnswer({
        surveyAssignmentId: assignment.id,
        surveyQuestionId: q.id,
        valueText: normalized.valueText,
        valueNumeric: normalized.valueNumeric,
      });
      savedAnswers.push(saved);

      if (normalized.optionIds.length > 0) {
        await this.repo.replaceAnswerOptions(saved.id, normalized.optionIds);
        answerOptionIdsByAnswerId.set(saved.id, normalized.optionIds);
      }
    }

    // Save matrix answers
    const savedMatrixAnswers = [];
    if (input.matrixAnswers) {
      for (const ma of input.matrixAnswers) {
        if (skippedQuestionIds.has(ma.questionId)) continue;
        const q = questionById.get(ma.questionId);
        const row = matrixRowById.get(ma.matrixRowId);
        if (!q || !row) continue;

        const savedMa = await this.repoAdvanced.upsertMatrixAnswer({
          tenantId: distToken.tenantId,
          surveyAssignmentId: assignment.id,
          surveyQuestionId: q.id,
          matrixRowId: row.id,
          valueText: ma.valueText ?? null,
          valueNumeric: ma.valueNumeric ?? null,
          selectedOptionId: ma.selectedOptionId ?? null,
        });
        savedMatrixAnswers.push(savedMa);
      }
    }

    // Calculate advanced scoring
    const scoringResult = calculateSurveyScoring({
      version,
      sections,
      questions: sortedQuestions.filter((q) => !skippedQuestionIds.has(q.id)),
      options,
      matrixRows,
      answers: savedAnswers,
      matrixAnswers: savedMatrixAnswers,
      answerOptionIdsByAnswerId,
    });

    // Persist section scores
    for (const ss of scoringResult.sectionScores) {
      await this.repoAdvanced.upsertSectionScore({
        tenantId: distToken.tenantId,
        surveyAssignmentId: assignment.id,
        surveySectionId: ss.sectionId,
        rawScore: ss.rawScore,
        maxScore: ss.maxScore,
        percentageScore: ss.percentageScore,
        weightedScore: ss.weightedScore,
      });
    }

    // Finalize assignment
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

    if (!finalized) {
      throw new ConflictError("Failed to finalize public survey response");
    }

    // Increment token usage
    await this.repoAdvanced.incrementTokenUsage(distToken.id);

    // Audit and event
    await this.audit.record({
      tenantId: distToken.tenantId,
      actorUserId: null,
      action: "survey.public.submitted",
      entityType: "survey_assignment",
      entityId: finalized.id,
      metadata: {
        distributionTokenId: distToken.id,
        totalScore: finalized.totalScore,
        npsScore: finalized.npsScore,
        respondentType,
      },
    });

    await this.eventBus.publish({
      tenantId: distToken.tenantId,
      eventType: "survey.submitted",
      entityType: "survey_assignment",
      entityId: finalized.id,
      payload: {
        surveyVersionId: version.id,
        distributionTokenId: distToken.id,
        totalScore: finalized.totalScore,
        npsScore: finalized.npsScore,
        respondentType,
      },
      createdBy: null,
    });

    return {
      assignmentId: finalized.id,
      totalScore: finalized.totalScore,
      npsScore: finalized.npsScore,
    };
  }
}

function validatePublicAnswerForType(
  q: SurveyQuestion,
  ans: PublicAnswerInput,
  optionById: Map<string, SurveyQuestionOption>,
): { valueText: string | null; valueNumeric: number | null; optionIds: string[] } {
  if (q.questionType === "rating") {
    const v = ans.valueNumeric;
    const min = q.config.min as number;
    const max = q.config.max as number;
    if (typeof v !== "number" || !Number.isInteger(v)) {
      throw new ValidationError(`Question '${q.code}' expects an integer rating`);
    }
    if (v < min || v > max) {
      throw new ValidationError(`Rating for '${q.code}' must be between ${min} and ${max}`);
    }
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
      const opt = optionById.get(oid);
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
  const opt = optionById.get(optionIds[0]);
  if (!opt || opt.surveyQuestionId !== q.id) {
    throw new ValidationError(`Selected option is not valid for question '${q.code}'`);
  }
  return { valueText: null, valueNumeric: null, optionIds };
}

