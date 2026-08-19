import type {
  SurveyAnswer,
  SurveyAssignment,
  SurveyQuestion,
  SurveyQuestionOption,
  SurveyRepository,
} from "../../domain/survey/survey.entity.js";
import type { ActorContext } from "../../domain/shared-kernel/audit-context.js";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "../../domain/shared-kernel/errors.js";
import type { AuditService } from "../audit/audit.service.js";
import type { RbacService } from "../rbac/rbac.service.js";
import type { EventBus } from "../event/event-bus.js";

export interface AnswerInput {
  questionId: string;
  valueText?: string | null;
  valueNumeric?: number | null;
  optionIds?: string[];
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
    const [sections, questions, options, answers] = await Promise.all([
      this.repo.listSections(assignment.surveyVersionId),
      this.repo.listQuestions(assignment.surveyVersionId),
      this.repo.listOptionsForVersion(assignment.surveyVersionId),
      this.repo.listAnswers(assignment.id),
    ]);
    const optsByQuestion = groupOptions(options);
    const answerViews = [];
    for (const a of answers) {
      answerViews.push({
        questionId: a.surveyQuestionId,
        valueText: a.valueText,
        valueNumeric: a.valueNumeric,
        selectedOptionIds: await this.repo.listAnswerOptionIds(a.id),
      });
    }
    return {
      assignment,
      sections,
      questions: questions.map((q) => ({ ...q, options: optsByQuestion.get(q.id) ?? [] })),
      answers: answerViews,
    };
  }

  async saveAnswers(actor: ActorContext, assignmentId: string, answers: AnswerInput[]): Promise<void> {
    await this.rbac.requirePermission(actor.userId, "survey.respond");
    const assignment = await this.getOwnedAssignmentOrThrow(actor, assignmentId);
    this.assertEditable(assignment);

    const questions = await this.repo.listQuestions(assignment.surveyVersionId);
    const questionById = new Map(questions.map((q) => [q.id, q]));

    for (const ans of answers) {
      const q = questionById.get(ans.questionId);
      if (!q) throw new ValidationError(`Question ${ans.questionId} does not belong to this survey`);
      const { valueText, valueNumeric, optionIds } = await this.validateAnswerForType(q, ans);
      const saved = await this.repo.upsertAnswer({
        surveyAssignmentId: assignment.id,
        surveyQuestionId: q.id,
        valueText,
        valueNumeric,
      });
      await this.repo.replaceAnswerOptions(saved.id, optionIds);
    }

    if (assignment.status === "pending") await this.repo.markInProgress(assignment.id);
  }

  async submit(actor: ActorContext, assignmentId: string): Promise<SurveyAssignment> {
    await this.rbac.requirePermission(actor.userId, "survey.respond");
    const assignment = await this.getOwnedAssignmentOrThrow(actor, assignmentId);
    this.assertEditable(assignment);

    const [questions, answers] = await Promise.all([
      this.repo.listQuestions(assignment.surveyVersionId),
      this.repo.listAnswers(assignment.id),
    ]);
    const answerByQuestion = new Map(answers.map((a) => [a.surveyQuestionId, a]));

    // Required validation (backend authoritative).
    for (const q of questions) {
      if (!q.isRequired) continue;
      const a = answerByQuestion.get(q.id);
      if (!a || !(await this.answerHasValue(q, a))) {
        throw new ValidationError(`Required question '${q.code}' has no answer`);
      }
    }

    // Score: rating -> value; single_choice -> selected option score; long_text -> none.
    let totalScore: number | null = null;
    for (const q of questions) {
      const a = answerByQuestion.get(q.id);
      if (!a) continue;
      if (q.questionType === "rating" && a.valueNumeric !== null) {
        totalScore = (totalScore ?? 0) + a.valueNumeric;
      } else if (q.questionType === "single_choice") {
        const optionIds = await this.repo.listAnswerOptionIds(a.id);
        for (const oid of optionIds) {
          const opt = await this.repo.findOptionById(oid);
          if (opt?.score !== null && opt?.score !== undefined) totalScore = (totalScore ?? 0) + opt.score;
        }
      }
    }

    // Atomic finalize — guarded so it can never double-submit.
    const finalized = await this.repo.finalizeSubmission(assignment.id, totalScore, new Date());
    if (!finalized) throw new ConflictError("This survey is no longer open for submission");

    await this.audit.record({
      tenantId: actor.tenantId,
      actorUserId: actor.userId,
      action: "survey.submitted",
      entityType: "survey_assignment",
      entityId: finalized.id,
      metadata: { totalScore: finalized.totalScore },
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
    if (q.questionType === "long_text") {
      const t = ans.valueText;
      if (t !== null && t !== undefined && typeof t !== "string") {
        throw new ValidationError(`Question '${q.code}' expects text`);
      }
      return { valueText: t ?? null, valueNumeric: null, optionIds: [] };
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

  private async answerHasValue(q: SurveyQuestion, a: SurveyAnswer): Promise<boolean> {
    if (q.questionType === "rating") return a.valueNumeric !== null;
    if (q.questionType === "long_text") return !!(a.valueText && a.valueText.trim().length > 0);
    // single_choice
    const optionIds = await this.repo.listAnswerOptionIds(a.id);
    return optionIds.length > 0;
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
