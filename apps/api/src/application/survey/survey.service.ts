import type {
  SurveyAssignment,
  SurveyDefinition,
  SurveyQuestion,
  SurveyQuestionOption,
  SurveyQuestionType,
  SurveyRepository,
  SurveySection,
  SurveyVersion,
} from "../../domain/survey/survey.entity.js";
import type { ActorContext } from "../../domain/shared-kernel/audit-context.js";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "../../domain/shared-kernel/errors.js";
import type { AuditService } from "../audit/audit.service.js";
import type { RbacService } from "../rbac/rbac.service.js";
import type { EventBus } from "../event/event-bus.js";
import type { EntityAuthorizationResolverRegistry } from "../document/entity-authorization-resolver.js";

/** Question types with real behavior in 1D.1 (FD-1D-04). The domain enum is
 * wider (future-ready); creating any other type is rejected here. */
export const SUPPORTED_QUESTION_TYPES: SurveyQuestionType[] = ["rating", "single_choice", "long_text"];

export interface QuestionWithOptions extends SurveyQuestion {
  options: SurveyQuestionOption[];
}
export interface SurveyVersionDetail {
  version: SurveyVersion;
  sections: SurveySection[];
  questions: QuestionWithOptions[];
}

/**
 * Generic Survey & Assessment Engine — Definition authoring + Assignment +
 * Results (Checkpoint 1D.1). Manage/assign gated on `survey.manage`, result
 * reads on `survey.results.read`. Respondent flow lives in
 * SurveyResponseService. Product Core: no Complaint/1E integration here.
 */
export class SurveyService {
  constructor(
    private readonly repo: SurveyRepository,
    private readonly audit: AuditService,
    private readonly rbac: RbacService,
    private readonly eventBus: EventBus,
    /** Reused ADR-0012 registry — authorizes an Assignment's optional context
     * entity (e.g. a Complaint) without Survey Core knowing that module. */
    private readonly contextResolvers: EntityAuthorizationResolverRegistry = new Map(),
  ) {}

  // ===================================================================
  // Definition authoring
  // ===================================================================

  async createDefinition(
    actor: ActorContext,
    input: { code: string; name: string; description?: string | null },
  ): Promise<{ definition: SurveyDefinition; version: SurveyVersion }> {
    await this.rbac.requirePermission(actor.userId, "survey.manage");
    const existing = await this.repo.findDefinitionByCode(actor.tenantId, input.code);
    if (existing) throw new ConflictError(`Survey Definition '${input.code}' already exists`);
    const definition = await this.repo.createDefinition({
      tenantId: actor.tenantId,
      code: input.code,
      name: input.name,
      description: input.description ?? null,
      createdBy: actor.userId,
    });
    const version = await this.repo.createVersion({
      surveyDefinitionId: definition.id,
      versionNumber: 1,
      createdBy: actor.userId,
    });
    await this.audit.record({
      tenantId: actor.tenantId,
      actorUserId: actor.userId,
      action: "survey.definition.created",
      entityType: "survey_definition",
      entityId: definition.id,
      metadata: { code: definition.code, name: definition.name },
    });
    return { definition, version };
  }

  async createVersion(actor: ActorContext, definitionCode: string): Promise<SurveyVersion> {
    await this.rbac.requirePermission(actor.userId, "survey.manage");
    const definition = await this.getDefinitionOrThrow(actor, definitionCode);
    const versionNumber = await this.repo.getNextVersionNumber(definition.id);
    const version = await this.repo.createVersion({
      surveyDefinitionId: definition.id,
      versionNumber,
      createdBy: actor.userId,
    });
    await this.audit.record({
      tenantId: actor.tenantId,
      actorUserId: actor.userId,
      action: "survey.version.created",
      entityType: "survey_version",
      entityId: version.id,
      metadata: { definitionCode, versionNumber },
    });
    return version;
  }

  async addSection(
    actor: ActorContext,
    versionId: string,
    input: { code: string; title: string; description?: string | null; sortOrder?: number },
  ): Promise<SurveySection> {
    await this.rbac.requirePermission(actor.userId, "survey.manage");
    const { version } = await this.getEditableVersionOrThrow(actor, versionId);
    return this.repo.createSection({
      surveyVersionId: version.id,
      code: input.code,
      title: input.title,
      description: input.description ?? null,
      sortOrder: input.sortOrder ?? 0,
    });
  }

  async addQuestion(
    actor: ActorContext,
    versionId: string,
    input: {
      sectionId?: string | null;
      code: string;
      text: string;
      questionType: string;
      isRequired?: boolean;
      config?: Record<string, unknown>;
      sortOrder?: number;
    },
  ): Promise<SurveyQuestion> {
    await this.rbac.requirePermission(actor.userId, "survey.manage");
    const { version } = await this.getEditableVersionOrThrow(actor, versionId);

    if (!SUPPORTED_QUESTION_TYPES.includes(input.questionType as SurveyQuestionType)) {
      throw new ValidationError(
        `Question type '${input.questionType}' is not supported in this release (supported: ${SUPPORTED_QUESTION_TYPES.join(", ")})`,
      );
    }
    const config = input.config ?? {};
    if (input.questionType === "rating") this.validateRatingConfig(config);

    if (input.sectionId) {
      const section = await this.repo.findSectionById(input.sectionId);
      if (!section || section.surveyVersionId !== version.id) {
        throw new ValidationError("sectionId does not belong to this survey version");
      }
    }

    return this.repo.createQuestion({
      surveyVersionId: version.id,
      sectionId: input.sectionId ?? null,
      code: input.code,
      text: input.text,
      questionType: input.questionType as SurveyQuestionType,
      isRequired: input.isRequired ?? false,
      config,
      sortOrder: input.sortOrder ?? 0,
    });
  }

  async addOption(
    actor: ActorContext,
    questionId: string,
    input: { code: string; label: string; score?: number | null; sortOrder?: number },
  ): Promise<SurveyQuestionOption> {
    await this.rbac.requirePermission(actor.userId, "survey.manage");
    const question = await this.repo.findQuestionById(questionId);
    if (!question) throw new NotFoundError("SurveyQuestion", questionId);
    await this.getEditableVersionOrThrow(actor, question.surveyVersionId);
    if (question.questionType !== "single_choice" && question.questionType !== "multiple_choice") {
      throw new ValidationError(`Options are only valid for choice questions, not '${question.questionType}'`);
    }
    return this.repo.createOption({
      surveyQuestionId: question.id,
      code: input.code,
      label: input.label,
      score: input.score ?? null,
      sortOrder: input.sortOrder ?? 0,
    });
  }

  async publishVersion(
    actor: ActorContext,
    definitionCode: string,
    versionNumber: number,
  ): Promise<SurveyVersion> {
    await this.rbac.requirePermission(actor.userId, "survey.manage");
    const definition = await this.getDefinitionOrThrow(actor, definitionCode);
    const version = await this.repo.findVersion(definition.id, versionNumber);
    if (!version) throw new NotFoundError("SurveyVersion", String(versionNumber));
    if (version.status !== "draft") {
      throw new ConflictError(`Survey Version ${versionNumber} is '${version.status}', not 'draft'`);
    }

    const questions = await this.repo.listQuestions(version.id);
    const problems: string[] = [];
    if (questions.length === 0) problems.push("Version must have at least one question");
    for (const q of questions) {
      if (!SUPPORTED_QUESTION_TYPES.includes(q.questionType)) {
        problems.push(`Question '${q.code}' has unsupported type '${q.questionType}'`);
      }
      if (q.questionType === "rating") {
        try {
          this.validateRatingConfig(q.config);
        } catch (e) {
          problems.push(`Question '${q.code}': ${(e as Error).message}`);
        }
      }
      if (q.questionType === "single_choice") {
        const opts = await this.repo.listOptions(q.id);
        if (opts.length === 0) problems.push(`Single-choice question '${q.code}' has no options`);
      }
    }
    if (problems.length > 0) throw new ValidationError("Survey Version failed publish validation", problems);

    const published = await this.repo.publishVersion(version.id);
    await this.audit.record({
      tenantId: actor.tenantId,
      actorUserId: actor.userId,
      action: "survey.published",
      entityType: "survey_version",
      entityId: published.id,
      metadata: { definitionCode, versionNumber },
    });
    await this.eventBus.publish({
      tenantId: actor.tenantId,
      eventType: "survey.published",
      entityType: "survey_version",
      entityId: published.id,
      payload: { definitionCode, versionNumber },
      createdBy: actor.userId,
    });
    return published;
  }

  async retireVersion(
    actor: ActorContext,
    definitionCode: string,
    versionNumber: number,
  ): Promise<SurveyVersion> {
    await this.rbac.requirePermission(actor.userId, "survey.manage");
    const definition = await this.getDefinitionOrThrow(actor, definitionCode);
    const version = await this.repo.findVersion(definition.id, versionNumber);
    if (!version) throw new NotFoundError("SurveyVersion", String(versionNumber));
    if (version.status !== "published") {
      throw new ConflictError(`Only a published version can be retired (is '${version.status}')`);
    }
    const retired = await this.repo.retireVersion(version.id);
    await this.audit.record({
      tenantId: actor.tenantId,
      actorUserId: actor.userId,
      action: "survey.version.retired",
      entityType: "survey_version",
      entityId: retired.id,
      metadata: { definitionCode, versionNumber },
    });
    return retired;
  }

  async listDefinitions(actor: ActorContext): Promise<SurveyDefinition[]> {
    await this.rbac.requirePermission(actor.userId, "survey.manage");
    return this.repo.listDefinitions(actor.tenantId);
  }

  async getDefinition(
    actor: ActorContext,
    definitionCode: string,
  ): Promise<{ definition: SurveyDefinition; versions: SurveyVersion[]; current: SurveyVersionDetail | null }> {
    await this.rbac.requirePermission(actor.userId, "survey.manage");
    const definition = await this.getDefinitionOrThrow(actor, definitionCode);
    const versions = await this.repo.listVersions(definition.id);
    const current = await this.repo.findCurrentVersion(definition.id);
    return {
      definition,
      versions,
      current: current ? await this.buildVersionDetail(current) : null,
    };
  }

  // ===================================================================
  // Assignment
  // ===================================================================

  async createAssignment(
    actor: ActorContext,
    input: {
      surveyDefinitionCode?: string;
      surveyVersionId?: string;
      respondentUserId: string;
      contextEntityType?: string | null;
      contextEntityId?: string | null;
      dueAt?: string | null;
    },
  ): Promise<SurveyAssignment> {
    await this.rbac.requirePermission(actor.userId, "survey.manage");

    const version = await this.resolveAssignableVersion(actor, input);
    // Respondent (v1: authenticated user only, FD-1D — must be same tenant).
    if (!input.respondentUserId) throw new ValidationError("respondentUserId is required");
    const respondentTenant = await this.repo.findUserTenantId(input.respondentUserId);
    if (!respondentTenant) throw new NotFoundError("User", input.respondentUserId);
    if (respondentTenant !== actor.tenantId) {
      throw new ForbiddenError("Cannot assign a survey to a respondent in another tenant");
    }
    if ((input.contextEntityType && !input.contextEntityId) || (!input.contextEntityType && input.contextEntityId)) {
      throw new ValidationError("contextEntityType and contextEntityId must be provided together");
    }

    const assignment = await this.repo.createAssignment({
      tenantId: actor.tenantId,
      surveyVersionId: version.id,
      respondentType: "user",
      respondentUserId: input.respondentUserId,
      respondentCustomerContactId: null,
      contextEntityType: input.contextEntityType ?? null,
      contextEntityId: input.contextEntityId ?? null,
      dueAt: input.dueAt ? new Date(input.dueAt) : null,
      assignedBy: actor.userId,
    });

    await this.audit.record({
      tenantId: actor.tenantId,
      actorUserId: actor.userId,
      action: "survey.assignment.created",
      entityType: "survey_assignment",
      entityId: assignment.id,
      metadata: {
        surveyVersionId: version.id,
        respondentUserId: input.respondentUserId,
        contextEntityType: assignment.contextEntityType,
      },
    });
    await this.eventBus.publish({
      tenantId: actor.tenantId,
      eventType: "survey.assigned",
      entityType: "survey_assignment",
      entityId: assignment.id,
      payload: {
        surveyVersionId: version.id,
        targetUserId: input.respondentUserId,
        contextEntityType: assignment.contextEntityType,
        contextEntityId: assignment.contextEntityId,
      },
      createdBy: actor.userId,
    });
    return assignment;
  }

  // ===================================================================
  // Results (survey.results.read)
  // ===================================================================

  async getResult(actor: ActorContext, assignmentId: string) {
    await this.rbac.requirePermission(actor.userId, "survey.results.read");
    const assignment = await this.repo.findAssignmentById(assignmentId);
    if (!assignment || assignment.tenantId !== actor.tenantId) {
      throw new NotFoundError("SurveyAssignment", assignmentId);
    }
    // If the survey is bound to a context entity and that entityType has a
    // registered resolver, respect it (reuse ADR-0012). No context or no
    // resolver → tenant + permission is the gate.
    if (assignment.contextEntityType && assignment.contextEntityId) {
      const resolver = this.contextResolvers.get(assignment.contextEntityType);
      if (resolver) {
        const allowed = await resolver.canAccess(actor, assignment.contextEntityId);
        if (!allowed) throw new ForbiddenError("Your Data Scope does not cover this survey's context");
      }
    }

    const version = await this.repo.findVersionById(assignment.surveyVersionId);
    const detail = version ? await this.buildVersionDetail(version) : null;
    const answers = await this.repo.listAnswers(assignment.id);
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
      version: detail,
      answers: answerViews,
    };
  }

  // ===================================================================
  // Internals
  // ===================================================================

  private async getDefinitionOrThrow(actor: ActorContext, code: string): Promise<SurveyDefinition> {
    const definition = await this.repo.findDefinitionByCode(actor.tenantId, code);
    if (!definition) throw new NotFoundError("SurveyDefinition", code);
    return definition;
  }

  /** Loads a version and asserts it belongs to the actor's tenant AND is a
   * DRAFT (only drafts are editable — published/retired are immutable). */
  private async getEditableVersionOrThrow(
    actor: ActorContext,
    versionId: string,
  ): Promise<{ version: SurveyVersion; definition: SurveyDefinition }> {
    const version = await this.repo.findVersionById(versionId);
    if (!version) throw new NotFoundError("SurveyVersion", versionId);
    const definition = await this.repo.findDefinitionById(version.surveyDefinitionId);
    if (!definition || definition.tenantId !== actor.tenantId) {
      throw new NotFoundError("SurveyVersion", versionId);
    }
    if (version.status !== "draft") {
      throw new ConflictError(`Survey Version is '${version.status}' — only a 'draft' version can be edited`);
    }
    return { version, definition };
  }

  private async resolveAssignableVersion(
    actor: ActorContext,
    input: { surveyDefinitionCode?: string; surveyVersionId?: string },
  ): Promise<SurveyVersion> {
    let version: SurveyVersion | null = null;
    if (input.surveyVersionId) {
      version = await this.repo.findVersionById(input.surveyVersionId);
    } else if (input.surveyDefinitionCode) {
      const definition = await this.getDefinitionOrThrow(actor, input.surveyDefinitionCode);
      version = await this.repo.findCurrentVersion(definition.id);
    } else {
      throw new ValidationError("Either surveyVersionId or surveyDefinitionCode is required");
    }
    if (!version) throw new NotFoundError("SurveyVersion", input.surveyVersionId ?? input.surveyDefinitionCode ?? "");
    const definition = await this.repo.findDefinitionById(version.surveyDefinitionId);
    if (!definition || definition.tenantId !== actor.tenantId) {
      throw new NotFoundError("SurveyVersion", version.id);
    }
    if (version.status !== "published") {
      throw new ConflictError(`Only a published version can be assigned (is '${version.status}')`);
    }
    return version;
  }

  private async buildVersionDetail(version: SurveyVersion): Promise<SurveyVersionDetail> {
    const [sections, questions, options] = await Promise.all([
      this.repo.listSections(version.id),
      this.repo.listQuestions(version.id),
      this.repo.listOptionsForVersion(version.id),
    ]);
    const optsByQuestion = new Map<string, SurveyQuestionOption[]>();
    for (const o of options) {
      const arr = optsByQuestion.get(o.surveyQuestionId) ?? [];
      arr.push(o);
      optsByQuestion.set(o.surveyQuestionId, arr);
    }
    return {
      version,
      sections,
      questions: questions.map((q) => ({ ...q, options: optsByQuestion.get(q.id) ?? [] })),
    };
  }

  private validateRatingConfig(config: Record<string, unknown>): void {
    const min = config.min;
    const max = config.max;
    if (typeof min !== "number" || typeof max !== "number" || !Number.isInteger(min) || !Number.isInteger(max)) {
      throw new ValidationError("Rating question requires integer 'min' and 'max' in config");
    }
    if (min >= max) throw new ValidationError("Rating 'min' must be less than 'max'");
    if (max - min > 100) throw new ValidationError("Rating range is unreasonably large");
  }
}
