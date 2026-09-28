import { randomBytes, createHash } from "node:crypto";
import type {
  BranchConditionOperator,
  BranchTargetAction,
  SurveyAdvancedRepository,
  SurveyAnalyticsOverview,
  SurveyBenchmarkResult,
  SurveyBranchingRule,
  SurveyDistributionToken,
  SurveyMatrixRow,
  SurveyTranslation,
  TokenDistributionChannel,
  TranslationEntityType,
} from "../../domain/survey/survey-advanced.entity.js";
import type {
  SurveyDefinition,
  SurveyRepository,
  SurveyVersion,
} from "../../domain/survey/survey.entity.js";
import type { ActorContext } from "../../domain/shared-kernel/audit-context.js";
import {
  ConflictError,
  NotFoundError,
  ValidationError,
} from "../../domain/shared-kernel/errors.js";
import type { AuditService } from "../audit/audit.service.js";
import type { RbacService } from "../rbac/rbac.service.js";
import type { EventBus } from "../event/event-bus.js";
import { validateBranchGraph } from "./survey-branching.evaluator.js";

export class SurveyAnalyticsService {
  constructor(
    private readonly repo: SurveyRepository,
    private readonly repoAdvanced: SurveyAdvancedRepository,
    private readonly audit: AuditService,
    private readonly rbac: RbacService,
    private readonly eventBus: EventBus,
  ) {}

  // =========================================================================
  // SUR-ADV-003: Branching Rules & Matrix Rows Management (Authoring)
  // =========================================================================

  async addBranchingRule(
    actor: ActorContext,
    versionId: string,
    input: {
      sourceQuestionId: string;
      conditionOperator: BranchConditionOperator;
      conditionValue: unknown;
      targetAction: BranchTargetAction;
      targetQuestionId?: string | null;
      targetSectionId?: string | null;
      priority?: number;
    },
  ): Promise<SurveyBranchingRule> {
    await this.rbac.requirePermission(actor, "survey.manage");
    const { version } = await this.getEditableVersionOrThrow(actor, versionId);

    const questions = await this.repo.listQuestions(version.id);
    const sections = await this.repo.listSections(version.id);
    const existingRules = await this.repoAdvanced.listBranchingRules(version.id);

    const dummyRule: SurveyBranchingRule = {
      id: "candidate",
      tenantId: actor.tenantId,
      surveyVersionId: version.id,
      sourceQuestionId: input.sourceQuestionId,
      conditionOperator: input.conditionOperator,
      conditionValue: input.conditionValue,
      targetAction: input.targetAction,
      targetQuestionId: input.targetQuestionId ?? null,
      targetSectionId: input.targetSectionId ?? null,
      priority: input.priority ?? 0,
      createdAt: new Date(),
    };

    const graphCheck = validateBranchGraph(sections, questions, [...existingRules, dummyRule]);
    if (!graphCheck.isValid) {
      throw new ValidationError("Invalid branching rule graph", graphCheck.errors);
    }

    const rule = await this.repoAdvanced.createBranchingRule({
      tenantId: actor.tenantId,
      surveyVersionId: version.id,
      sourceQuestionId: input.sourceQuestionId,
      conditionOperator: input.conditionOperator,
      conditionValue: input.conditionValue,
      targetAction: input.targetAction,
      targetQuestionId: input.targetQuestionId ?? null,
      targetSectionId: input.targetSectionId ?? null,
      priority: input.priority ?? 0,
    });

    await this.audit.record({
      tenantId: actor.tenantId,
      actorUserId: actor.userId,
      action: "survey.branching_rule.created",
      entityType: "survey_branching_rule",
      entityId: rule.id,
      metadata: { surveyVersionId: version.id, sourceQuestionId: input.sourceQuestionId },
    });

    return rule;
  }

  async listBranchingRules(actor: ActorContext, versionId: string): Promise<SurveyBranchingRule[]> {
    await this.rbac.requirePermission(actor, "survey.manage");
    await this.getVersionOrThrow(actor, versionId);
    return this.repoAdvanced.listBranchingRules(versionId);
  }

  async deleteBranchingRule(actor: ActorContext, versionId: string, ruleId: string): Promise<void> {
    await this.rbac.requirePermission(actor, "survey.manage");
    await this.getEditableVersionOrThrow(actor, versionId);
    const deleted = await this.repoAdvanced.deleteBranchingRule(actor.tenantId, ruleId);
    if (!deleted) throw new NotFoundError("SurveyBranchingRule", ruleId);

    await this.audit.record({
      tenantId: actor.tenantId,
      actorUserId: actor.userId,
      action: "survey.branching_rule.deleted",
      entityType: "survey_branching_rule",
      entityId: ruleId,
      metadata: { surveyVersionId: versionId },
    });
  }

  async addMatrixRow(
    actor: ActorContext,
    questionId: string,
    input: { code: string; label: string; sortOrder?: number },
  ): Promise<SurveyMatrixRow> {
    await this.rbac.requirePermission(actor, "survey.manage");
    const question = await this.repo.findQuestionById(questionId);
    if (!question) throw new NotFoundError("SurveyQuestion", questionId);
    await this.getEditableVersionOrThrow(actor, question.surveyVersionId);

    if (question.questionType !== "matrix_single_choice" && question.questionType !== "matrix_rating") {
      throw new ValidationError(
        `Matrix rows can only be added to matrix questions (is '${question.questionType}')`,
      );
    }

    return this.repoAdvanced.createMatrixRow({
      tenantId: actor.tenantId,
      surveyQuestionId: question.id,
      code: input.code,
      label: input.label,
      sortOrder: input.sortOrder ?? 0,
    });
  }

  async listMatrixRows(actor: ActorContext, questionId: string): Promise<SurveyMatrixRow[]> {
    await this.rbac.requirePermission(actor, "survey.manage");
    const question = await this.repo.findQuestionById(questionId);
    if (!question) throw new NotFoundError("SurveyQuestion", questionId);
    await this.getVersionOrThrow(actor, question.surveyVersionId);
    return this.repoAdvanced.listMatrixRows(questionId);
  }

  // =========================================================================
  // SUR-ADV-005: Distribution Tokens Management
  // =========================================================================

  async createDistributionToken(
    actor: ActorContext,
    versionId: string,
    input: {
      channel?: TokenDistributionChannel;
      recipientLabel?: string | null;
      maxUses?: number | null;
      expiresAt?: string | null;
      metadata?: Record<string, unknown>;
    },
  ): Promise<{ token: SurveyDistributionToken; rawToken: string }> {
    await this.rbac.requirePermission(actor, "survey.manage");
    const version = await this.getVersionOrThrow(actor, versionId);
    if (version.status !== "published") {
      throw new ConflictError("Distribution tokens can only be created for published survey versions");
    }

    const rawToken = randomBytes(32).toString("hex");
    const tokenHash = createHash("sha256").update(rawToken).digest("hex");

    const token = await this.repoAdvanced.createDistributionToken({
      tenantId: actor.tenantId,
      surveyVersionId: version.id,
      tokenHash,
      channel: input.channel ?? "link",
      recipientLabel: input.recipientLabel ?? null,
      maxUses: input.maxUses ?? null,
      expiresAt: input.expiresAt ? new Date(input.expiresAt) : null,
      metadata: input.metadata ?? {},
      createdBy: actor.userId,
    });

    await this.audit.record({
      tenantId: actor.tenantId,
      actorUserId: actor.userId,
      action: "survey.distribution_token.created",
      entityType: "survey_distribution_token",
      entityId: token.id,
      metadata: {
        surveyVersionId: version.id,
        channel: token.channel,
        recipientLabel: token.recipientLabel,
        maxUses: token.maxUses,
      },
    });

    return { token, rawToken };
  }

  async listDistributionTokens(actor: ActorContext, versionId: string): Promise<SurveyDistributionToken[]> {
    await this.rbac.requirePermission(actor, "survey.manage");
    await this.getVersionOrThrow(actor, versionId);
    return this.repoAdvanced.listDistributionTokens(actor.tenantId, versionId);
  }

  async revokeDistributionToken(actor: ActorContext, tokenId: string): Promise<void> {
    await this.rbac.requirePermission(actor, "survey.manage");
    const token = await this.repoAdvanced.findDistributionTokenById(actor.tenantId, tokenId);
    if (!token) throw new NotFoundError("SurveyDistributionToken", tokenId);

    const revoked = await this.repoAdvanced.revokeDistributionToken(actor.tenantId, tokenId);
    if (!revoked) throw new ConflictError("Token is already revoked");

    await this.audit.record({
      tenantId: actor.tenantId,
      actorUserId: actor.userId,
      action: "survey.distribution_token.revoked",
      entityType: "survey_distribution_token",
      entityId: tokenId,
      metadata: { surveyVersionId: token.surveyVersionId },
    });
  }

  // =========================================================================
  // SUR-ADV-006: Multi-Language Survey Translations
  // =========================================================================

  async upsertTranslation(
    actor: ActorContext,
    versionId: string,
    input: {
      locale: string;
      entityType: TranslationEntityType;
      entityId: string;
      fieldName: string;
      translatedText: string;
    },
  ): Promise<SurveyTranslation> {
    await this.rbac.requirePermission(actor, "survey.manage");
    const { version } = await this.getEditableVersionOrThrow(actor, versionId);

    const translation = await this.repoAdvanced.upsertTranslation({
      tenantId: actor.tenantId,
      surveyVersionId: version.id,
      locale: input.locale,
      entityType: input.entityType,
      entityId: input.entityId,
      fieldName: input.fieldName,
      translatedText: input.translatedText,
    });

    await this.audit.record({
      tenantId: actor.tenantId,
      actorUserId: actor.userId,
      action: "survey.translation.upserted",
      entityType: "survey_translation",
      entityId: translation.id,
      metadata: {
        surveyVersionId: version.id,
        locale: input.locale,
        entityType: input.entityType,
        fieldName: input.fieldName,
      },
    });

    return translation;
  }

  async listTranslations(
    actor: ActorContext,
    versionId: string,
    locale?: string,
  ): Promise<SurveyTranslation[]> {
    await this.rbac.requirePermission(actor, "survey.manage");
    await this.getVersionOrThrow(actor, versionId);
    return this.repoAdvanced.listTranslations(versionId, locale);
  }

  async deleteTranslation(
    actor: ActorContext,
    versionId: string,
    translationId: string,
  ): Promise<void> {
    await this.rbac.requirePermission(actor, "survey.manage");
    await this.getEditableVersionOrThrow(actor, versionId);
    const deleted = await this.repoAdvanced.deleteTranslation(actor.tenantId, translationId);
    if (!deleted) throw new NotFoundError("SurveyTranslation", translationId);
  }

  // =========================================================================
  // SUR-ADV-007: Cross-Survey Analytics & Benchmarking
  // =========================================================================

  async getAnalyticsOverview(actor: ActorContext, definitionCode: string): Promise<SurveyAnalyticsOverview> {
    await this.rbac.requirePermission(actor, "survey.analytics.read");
    const definition = await this.repo.findDefinitionByCode(actor.tenantId, definitionCode);
    if (!definition) throw new NotFoundError("SurveyDefinition", definitionCode);

    return this.repoAdvanced.getAnalyticsOverview(actor.tenantId, definition.id);
  }

  async getBenchmark(actor: ActorContext, definitionCode: string): Promise<SurveyBenchmarkResult> {
    await this.rbac.requirePermission(actor, "survey.analytics.read");
    const definition = await this.repo.findDefinitionByCode(actor.tenantId, definitionCode);
    if (!definition) throw new NotFoundError("SurveyDefinition", definitionCode);

    return this.repoAdvanced.getBenchmarkByCategory(actor.tenantId, definition.id);
  }

  // =========================================================================
  // Internals
  // =========================================================================

  private async getVersionOrThrow(actor: ActorContext, versionId: string): Promise<SurveyVersion> {
    const version = await this.repo.findVersionById(versionId);
    if (!version) throw new NotFoundError("SurveyVersion", versionId);
    const definition = await this.repo.findDefinitionById(version.surveyDefinitionId);
    if (!definition || definition.tenantId !== actor.tenantId) {
      throw new NotFoundError("SurveyVersion", versionId);
    }
    return version;
  }

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
}
