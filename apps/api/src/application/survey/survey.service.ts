import type {
  SurveyAnswer,
  SurveyAssignment,
  SurveyDefinition,
  SurveyQuestion,
  SurveyQuestionOption,
  SurveyQuestionType,
  SurveyRepository,
  SurveyScoringModel,
  SurveySection,
  SurveyVersion,
} from "../../domain/survey/survey.entity.js";
import type { SurveyAdvancedRepository } from "../../domain/survey/survey-advanced.entity.js";
import type { ActorContext } from "../../domain/shared-kernel/audit-context.js";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "../../domain/shared-kernel/errors.js";
import type { AuditService } from "../audit/audit.service.js";
import type { RbacService } from "../rbac/rbac.service.js";
import type { EventBus } from "../event/event-bus.js";
import type { EntityAuthorizationResolverRegistry } from "../document/entity-authorization-resolver.js";
import { validateBranchGraph } from "./survey-branching.evaluator.js";

/** Question types with real behavior. 1D.1 (FD-1D-04) shipped the first three;
 * Wave A2 (SUR-ADV-003) activates the rest, including the matrix types which
 * are answered through `survey_matrix_answers` rather than `survey_answers`.
 * The domain enum stays the single source of truth — anything not listed here
 * is still rejected at authoring time. */
export const SUPPORTED_QUESTION_TYPES: SurveyQuestionType[] = [
  "rating",
  "single_choice",
  "long_text",
  "short_text",
  "multiple_choice",
  "numeric",
  "yes_no",
  "date",
  "matrix_single_choice",
  "matrix_rating",
];

/** Question types whose answers live in `survey_matrix_answers` (one row per
 * matrix row) instead of the flat `survey_answers` table. */
export const MATRIX_QUESTION_TYPES: SurveyQuestionType[] = ["matrix_single_choice", "matrix_rating"];

/** Question types that require at least one option to be publishable. */
const CHOICE_QUESTION_TYPES: SurveyQuestionType[] = [
  "single_choice",
  "multiple_choice",
  "matrix_single_choice",
];

const SCORING_MODELS: SurveyScoringModel[] = ["sum", "weighted_average", "percentage", "nps"];

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
    /** Wave A2 repository is optional so Core-only tests/bootstraps can keep
     * constructing SurveyService without enabling Advanced routes. When present,
     * publish validation runs branching-graph cycle & forward-jump checks. */
    private readonly repoAdvanced?: SurveyAdvancedRepository,
  ) {}

  // ===================================================================
  // Definition authoring
  // ===================================================================

  async createDefinition(
    actor: ActorContext,
    input: {
      code: string;
      name: string;
      description?: string | null;
      scoringModel?: SurveyScoringModel;
      defaultLocale?: string;
    },
  ): Promise<{ definition: SurveyDefinition; version: SurveyVersion }> {
    await this.rbac.requirePermission(actor.userId, "survey.manage");
    const existing = await this.repo.findDefinitionByCode(actor.tenantId, input.code);
    if (existing) throw new ConflictError(`Survey Definition '${input.code}' already exists`);
    if (input.scoringModel && !SCORING_MODELS.includes(input.scoringModel)) {
      throw new ValidationError(
        `Invalid scoring model '${input.scoringModel}' (valid: ${SCORING_MODELS.join(", ")})`,
      );
    }
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
      scoringModel: input.scoringModel ?? "sum",
      defaultLocale: input.defaultLocale ?? "id-ID",
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

  async createVersion(
    actor: ActorContext,
    definitionCode: string,
    input?: { scoringModel?: SurveyScoringModel; defaultLocale?: string },
  ): Promise<SurveyVersion> {
    await this.rbac.requirePermission(actor.userId, "survey.manage");
    const definition = await this.getDefinitionOrThrow(actor, definitionCode);
    if (input?.scoringModel && !SCORING_MODELS.includes(input.scoringModel)) {
      throw new ValidationError(
        `Invalid scoring model '${input.scoringModel}' (valid: ${SCORING_MODELS.join(", ")})`,
      );
    }
    const versionNumber = await this.repo.getNextVersionNumber(definition.id);
    const version = await this.repo.createVersion({
      surveyDefinitionId: definition.id,
      versionNumber,
      createdBy: actor.userId,
      scoringModel: input?.scoringModel ?? "sum",
      defaultLocale: input?.defaultLocale ?? "id-ID",
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
    input: {
      code: string;
      title: string;
      description?: string | null;
      sortOrder?: number;
      scoringModel?: SurveyScoringModel | null;
      weight?: number;
    },
  ): Promise<SurveySection> {
    await this.rbac.requirePermission(actor.userId, "survey.manage");
    const { version } = await this.getEditableVersionOrThrow(actor, versionId);
    if (input.scoringModel && !SCORING_MODELS.includes(input.scoringModel)) {
      throw new ValidationError(
        `Invalid section scoring model '${input.scoringModel}' (valid: ${SCORING_MODELS.join(", ")})`,
      );
    }
    if (input.weight !== undefined && (typeof input.weight !== "number" || input.weight < 0)) {
      throw new ValidationError("Section weight must be a non-negative number");
    }
    return this.repo.createSection({
      surveyVersionId: version.id,
      code: input.code,
      title: input.title,
      description: input.description ?? null,
      sortOrder: input.sortOrder ?? 0,
      scoringModel: input.scoringModel ?? null,
      weight: input.weight ?? 1,
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
      weight?: number;
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
    if (input.questionType === "matrix_rating") this.validateMatrixRatingConfig(config);

    if (input.weight !== undefined && (typeof input.weight !== "number" || input.weight < 0)) {
      throw new ValidationError("Question weight must be a non-negative number");
    }

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
      weight: input.weight ?? 1,
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
    if (!CHOICE_QUESTION_TYPES.includes(question.questionType)) {
      throw new ValidationError(
        `Options are only valid for choice/matrix-choice questions, not '${question.questionType}'`,
      );
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
      if (q.questionType === "matrix_rating") {
        try {
          this.validateMatrixRatingConfig(q.config);
        } catch (e) {
          problems.push(`Question '${q.code}': ${(e as Error).message}`);
        }
      }
      if (CHOICE_QUESTION_TYPES.includes(q.questionType)) {
        const opts = await this.repo.listOptions(q.id);
        if (opts.length === 0) problems.push(`Choice question '${q.code}' has no options`);
      }
      if (MATRIX_QUESTION_TYPES.includes(q.questionType) && this.repoAdvanced) {
        const rows = await this.repoAdvanced.listMatrixRows(q.id);
        if (rows.length === 0) problems.push(`Matrix question '${q.code}' has no matrix rows`);
      }
    }

    // Wave A2 (SUR-ADV-003): the branching graph must be free of backward/
    // self jumps before a version can go live — an invalid graph would let a
    // respondent hit an unresolvable branch mid-submission.
    if (this.repoAdvanced) {
      const sections = await this.repo.listSections(version.id);
      const rules = await this.repoAdvanced.listBranchingRules(version.id);
      if (rules.length > 0) {
        const graphCheck = validateBranchGraph(sections, questions, rules);
        if (!graphCheck.isValid) problems.push(...graphCheck.errors);
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

  /** Checkpoint 1D.2 — read a specific version's full detail (any status), so
   * the admin UI can author a DRAFT (getDefinition only returns the current
   * published version). survey.manage + tenant-guarded. */
  async getVersionDetail(actor: ActorContext, versionId: string): Promise<SurveyVersionDetail> {
    await this.rbac.requirePermission(actor.userId, "survey.manage");
    const version = await this.repo.findVersionById(versionId);
    if (!version) throw new NotFoundError("SurveyVersion", versionId);
    const definition = await this.repo.findDefinitionById(version.surveyDefinitionId);
    if (!definition || definition.tenantId !== actor.tenantId) {
      throw new NotFoundError("SurveyVersion", versionId);
    }
    return this.buildVersionDetail(version);
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
  // Trusted integration seam (Checkpoint 1E.1)
  // ===================================================================
  // A business module that has ALREADY authorized an automated action
  // (the Survey Integration orchestrator) calls these instead of the
  // permission-gated `createAssignment`. "Trusted caller" bypasses ONLY
  // the human `survey.manage` permission check — every business/data
  // invariant (tenant match, published-only, respondent same tenant,
  // context pairing) is still enforced here, exactly as for a human
  // assigner. Survey Core stays generic: it never learns what a
  // "complaint" is; the caller supplies an opaque context entity.

  /** Resolve the current published version of a definition by code, or
   * null when the definition is missing OR has no current published
   * version. Deliberately returns null (never throws) so the integration
   * layer can record a `skipped_no_published_version` execution instead
   * of failing the triggering business transaction (FD-1E-04). */
  async resolvePublishedVersionForTrustedIntegration(
    tenantId: string,
    surveyDefinitionCode: string,
  ): Promise<SurveyVersion | null> {
    const definition = await this.repo.findDefinitionByCode(tenantId, surveyDefinitionCode);
    if (!definition) return null;
    const version = await this.repo.findCurrentVersion(definition.id);
    if (!version || version.status !== "published") return null;
    return version;
  }

  /** Create a Survey Assignment on behalf of an automated integration.
   * `assignedBy` is stored NULL (no human assigner) and the audit entry
   * marks `creationMode: automation` + the triggering domain event, so
   * the record is never presented as manually created by the respondent
   * (FD-1E-03). Reuses the existing `survey.assigned` event (FD-1E §24). */
  async createAssignmentForTrustedIntegration(input: {
    tenantId: string;
    surveyVersionId: string;
    respondentUserId: string;
    contextEntityType: string;
    contextEntityId: string;
    automationTriggerEventId: string;
  }): Promise<SurveyAssignment> {
    const version = await this.repo.findVersionById(input.surveyVersionId);
    if (!version) throw new NotFoundError("SurveyVersion", input.surveyVersionId);
    const definition = await this.repo.findDefinitionById(version.surveyDefinitionId);
    if (!definition || definition.tenantId !== input.tenantId) {
      throw new NotFoundError("SurveyVersion", input.surveyVersionId);
    }
    if (version.status !== "published") {
      throw new ConflictError(`Only a published version can be assigned (is '${version.status}')`);
    }
    const respondentTenant = await this.repo.findUserTenantId(input.respondentUserId);
    if (!respondentTenant) throw new NotFoundError("User", input.respondentUserId);
    if (respondentTenant !== input.tenantId) {
      throw new ForbiddenError("Cannot assign a survey to a respondent in another tenant");
    }

    const assignment = await this.repo.createAssignment({
      tenantId: input.tenantId,
      surveyVersionId: version.id,
      respondentType: "user",
      respondentUserId: input.respondentUserId,
      respondentCustomerContactId: null,
      contextEntityType: input.contextEntityType,
      contextEntityId: input.contextEntityId,
      dueAt: null,
      assignedBy: null,
    });

    await this.audit.record({
      tenantId: input.tenantId,
      actorUserId: null,
      action: "survey.assignment.created",
      entityType: "survey_assignment",
      entityId: assignment.id,
      metadata: {
        surveyVersionId: version.id,
        respondentUserId: input.respondentUserId,
        contextEntityType: assignment.contextEntityType,
        creationMode: "automation",
        triggerDomainEventId: input.automationTriggerEventId,
      },
    });
    await this.eventBus.publish({
      tenantId: input.tenantId,
      eventType: "survey.assigned",
      entityType: "survey_assignment",
      entityId: assignment.id,
      payload: {
        surveyVersionId: version.id,
        targetUserId: input.respondentUserId,
        contextEntityType: assignment.contextEntityType,
        contextEntityId: assignment.contextEntityId,
      },
      createdBy: null,
    });
    return assignment;
  }

  /**
   * Trusted read of a SUBMITTED result for the integration orchestrator
   * (Checkpoint 1E.2, FD-1E §43/§44). Bypasses only the human
   * `survey.results.read` permission — tenant ownership and submitted state
   * are still enforced, and this is never exposed over HTTP. Returns the
   * questions of the assignment's own immutable version plus its answers,
   * so the caller can evaluate a configured question CODE without Survey
   * Core knowing what that code means. Null when the assignment is missing,
   * belongs to another tenant, or is not yet submitted.
   */
  async getResultForTrustedIntegration(
    tenantId: string,
    assignmentId: string,
  ): Promise<{
    assignment: SurveyAssignment;
    questions: SurveyQuestion[];
    answers: SurveyAnswer[];
    optionsByQuestionId: Map<string, SurveyQuestionOption[]>;
    selectedOptionIdsByAnswerId: Map<string, string[]>;
  } | null> {
    const assignment = await this.repo.findAssignmentById(assignmentId);
    if (!assignment || assignment.tenantId !== tenantId) return null;
    if (assignment.status !== "submitted") return null;

    const questions = await this.repo.listQuestions(assignment.surveyVersionId);
    const answers = await this.repo.listAnswers(assignment.id);

    const optionsByQuestionId = new Map<string, SurveyQuestionOption[]>();
    for (const option of await this.repo.listOptionsForVersion(assignment.surveyVersionId)) {
      const list = optionsByQuestionId.get(option.surveyQuestionId) ?? [];
      list.push(option);
      optionsByQuestionId.set(option.surveyQuestionId, list);
    }
    const selectedOptionIdsByAnswerId = new Map<string, string[]>();
    for (const answer of answers) {
      selectedOptionIdsByAnswerId.set(answer.id, await this.repo.listAnswerOptionIds(answer.id));
    }
    return { assignment, questions, answers, optionsByQuestionId, selectedOptionIdsByAnswerId };
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

  private validateMatrixRatingConfig(config: Record<string, unknown>): void {
    const min = config.min;
    const max = config.max;
    if (typeof min !== "number" || typeof max !== "number" || !Number.isInteger(min) || !Number.isInteger(max)) {
      throw new ValidationError("Matrix rating question requires integer 'min' and 'max' in config");
    }
    if (min >= max) throw new ValidationError("Matrix rating 'min' must be less than 'max'");
    if (max - min > 100) throw new ValidationError("Matrix rating range is unreasonably large");
  }
}
