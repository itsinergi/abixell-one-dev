/**
 * Domain types for Wave A2 — Survey & Assessment Advanced (SUR-ADV-003…007).
 * Hexagonal boundary: `SurveyAdvancedRepository` is the interface the
 * application layer depends on; the PostgreSQL implementation lives in
 * `apps/api/src/infrastructure/persistence/repositories/survey-advanced.repository.pg.ts`.
 */

import type { SurveyScoringModel } from "./survey.entity.js";

// ===========================================================================
// SUR-ADV-003 — Conditional Branching & Matrix Questions
// ===========================================================================

export type BranchConditionOperator =
  | "equals"
  | "not_equals"
  | "greater_than"
  | "less_than"
  | "in"
  | "not_in"
  | "is_answered"
  | "is_unanswered";

export type BranchTargetAction = "jump_to_question" | "jump_to_section" | "end_survey";

export interface SurveyBranchingRule {
  id: string;
  tenantId: string;
  surveyVersionId: string;
  sourceQuestionId: string;
  conditionOperator: BranchConditionOperator;
  /** JSON array/primitive value for matching (e.g. `["opt_1", "opt_2"]` or `4`). */
  conditionValue: unknown;
  targetAction: BranchTargetAction;
  targetQuestionId: string | null;
  targetSectionId: string | null;
  priority: number;
  createdAt: Date;
}

export interface SurveyMatrixRow {
  id: string;
  tenantId: string;
  surveyQuestionId: string;
  code: string;
  label: string;
  sortOrder: number;
}

export interface SurveyMatrixAnswer {
  id: string;
  tenantId: string;
  surveyAssignmentId: string;
  surveyQuestionId: string;
  matrixRowId: string;
  valueText: string | null;
  valueNumeric: number | null;
  selectedOptionId: string | null;
  answeredAt: Date;
}

// ===========================================================================
// SUR-ADV-004 — Weighted, Section-Level, and NPS Scoring
// ===========================================================================

export interface SurveySectionScore {
  id: string;
  tenantId: string;
  surveyAssignmentId: string;
  surveySectionId: string;
  rawScore: number | null;
  maxScore: number | null;
  percentageScore: number | null;
  weightedScore: number | null;
  createdAt: Date;
}

export type NpsCategory = "promoter" | "passive" | "detractor";

export interface NpsClassification {
  category: NpsCategory;
  score: number;
}

export interface AssignmentScoringResult {
  totalScore: number | null;
  scoringModel: SurveyScoringModel;
  sectionScores: Array<{
    sectionId: string;
    rawScore: number | null;
    maxScore: number | null;
    percentageScore: number | null;
    weightedScore: number | null;
  }>;
  npsScore: number | null;
  npsClassification: NpsClassification | null;
}

// ===========================================================================
// SUR-ADV-005 — Anonymous & Public-Token Distribution
// ===========================================================================

export type TokenDistributionChannel = "link" | "email" | "sms" | "qr";

export interface SurveyDistributionToken {
  id: string;
  tenantId: string;
  surveyVersionId: string;
  tokenHash: string;
  channel: TokenDistributionChannel;
  recipientLabel: string | null;
  maxUses: number | null;
  usedCount: number;
  expiresAt: Date | null;
  revokedAt: Date | null;
  metadata: Record<string, unknown>;
  createdBy: string | null;
  createdAt: Date;
}

export interface PublicSurveyView {
  definitionCode: string;
  definitionName: string;
  description: string | null;
  versionNumber: number;
  defaultLocale: string;
  locale: string;
  sections: Array<{
    id: string;
    code: string;
    title: string;
    description: string | null;
    sortOrder: number;
  }>;
  questions: Array<{
    id: string;
    sectionId: string | null;
    code: string;
    text: string;
    questionType: string;
    isRequired: boolean;
    config: Record<string, unknown>;
    sortOrder: number;
    options: Array<{
      id: string;
      code: string;
      label: string;
      sortOrder: number;
    }>;
    matrixRows: Array<{
      id: string;
      code: string;
      label: string;
      sortOrder: number;
    }>;
  }>;
  branchingRules: Array<{
    sourceQuestionId: string;
    conditionOperator: BranchConditionOperator;
    conditionValue: unknown;
    targetAction: BranchTargetAction;
    targetQuestionId: string | null;
    targetSectionId: string | null;
    priority: number;
  }>;
}

// ===========================================================================
// SUR-ADV-006 — Multi-Language Survey Content
// ===========================================================================

export type TranslationEntityType = "definition" | "section" | "question" | "option" | "matrix_row";

export interface SurveyTranslation {
  id: string;
  tenantId: string;
  surveyVersionId: string;
  locale: string;
  entityType: TranslationEntityType;
  entityId: string;
  fieldName: string;
  translatedText: string;
  createdAt: Date;
  updatedAt: Date;
}

// ===========================================================================
// SUR-ADV-007 — Cross-Survey Analytics & Benchmarking
// ===========================================================================

export interface QuestionDropOffMetric {
  questionId: string;
  questionCode: string;
  questionText: string;
  viewCount: number;
  answerCount: number;
  dropOffRatePercent: number;
}

export interface NpsDistribution {
  totalNpsResponses: number;
  promoterCount: number;
  passiveCount: number;
  detractorCount: number;
  promoterPercent: number;
  passivePercent: number;
  detractorPercent: number;
  netPromoterScore: number | null;
}

export interface SurveyAnalyticsOverview {
  surveyDefinitionId: string;
  surveyDefinitionCode: string;
  surveyDefinitionName: string;
  totalAssignments: number;
  submittedCount: number;
  inProgressCount: number;
  expiredCount: number;
  completionRatePercent: number;
  averageScore: number | null;
  nps: NpsDistribution;
  sectionAverages: Array<{
    sectionId: string;
    sectionCode: string;
    sectionTitle: string;
    averagePercentageScore: number | null;
    averageWeightedScore: number | null;
  }>;
  questionDropOff: QuestionDropOffMetric[];
  /** Privacy flag: when respondent count is <5, individual demographic
   * cells are suppressed to prevent re-identification. */
  smallCellSuppressed: boolean;
}

export interface SurveyBenchmarkItem {
  contextEntityType: string;
  contextEntityId: string;
  contextLabel: string;
  responseCount: number;
  averageScore: number | null;
  npsScore: number | null;
  completionRatePercent: number;
}

export interface SurveyBenchmarkResult {
  surveyDefinitionId: string;
  benchmarkDimension: "category" | "organization_unit" | "time_period";
  items: SurveyBenchmarkItem[];
  generatedAt: Date;
}

// ===========================================================================
// SurveyAdvancedRepository interface
// ===========================================================================

export interface SurveyAdvancedRepository {
  // --- Branching rules -----------------------------------------------------
  createBranchingRule(input: {
    tenantId: string;
    surveyVersionId: string;
    sourceQuestionId: string;
    conditionOperator: BranchConditionOperator;
    conditionValue: unknown;
    targetAction: BranchTargetAction;
    targetQuestionId?: string | null;
    targetSectionId?: string | null;
    priority?: number;
  }): Promise<SurveyBranchingRule>;
  listBranchingRules(surveyVersionId: string): Promise<SurveyBranchingRule[]>;
  deleteBranchingRule(tenantId: string, ruleId: string): Promise<boolean>;

  // --- Matrix rows & answers ----------------------------------------------
  createMatrixRow(input: {
    tenantId: string;
    surveyQuestionId: string;
    code: string;
    label: string;
    sortOrder: number;
  }): Promise<SurveyMatrixRow>;
  listMatrixRows(surveyQuestionId: string): Promise<SurveyMatrixRow[]>;
  listMatrixRowsForVersion(surveyVersionId: string): Promise<SurveyMatrixRow[]>;
  upsertMatrixAnswer(input: {
    tenantId: string;
    surveyAssignmentId: string;
    surveyQuestionId: string;
    matrixRowId: string;
    valueText?: string | null;
    valueNumeric?: number | null;
    selectedOptionId?: string | null;
  }): Promise<SurveyMatrixAnswer>;
  listMatrixAnswers(surveyAssignmentId: string): Promise<SurveyMatrixAnswer[]>;

  // --- Section scores -----------------------------------------------------
  upsertSectionScore(input: {
    tenantId: string;
    surveyAssignmentId: string;
    surveySectionId: string;
    rawScore: number | null;
    maxScore: number | null;
    percentageScore: number | null;
    weightedScore: number | null;
  }): Promise<SurveySectionScore>;
  listSectionScores(surveyAssignmentId: string): Promise<SurveySectionScore[]>;

  // --- Distribution tokens ------------------------------------------------
  createDistributionToken(input: {
    tenantId: string;
    surveyVersionId: string;
    tokenHash: string;
    channel: TokenDistributionChannel;
    recipientLabel?: string | null;
    maxUses?: number | null;
    expiresAt?: Date | null;
    metadata?: Record<string, unknown>;
    createdBy?: string | null;
  }): Promise<SurveyDistributionToken>;
  findDistributionTokenByHash(tokenHash: string): Promise<SurveyDistributionToken | null>;
  findDistributionTokenById(tenantId: string, tokenId: string): Promise<SurveyDistributionToken | null>;
  listDistributionTokens(tenantId: string, surveyVersionId: string): Promise<SurveyDistributionToken[]>;
  incrementTokenUsage(tokenId: string): Promise<void>;
  revokeDistributionToken(tenantId: string, tokenId: string): Promise<boolean>;

  // --- Translations -------------------------------------------------------
  upsertTranslation(input: {
    tenantId: string;
    surveyVersionId: string;
    locale: string;
    entityType: TranslationEntityType;
    entityId: string;
    fieldName: string;
    translatedText: string;
  }): Promise<SurveyTranslation>;
  listTranslations(surveyVersionId: string, locale?: string): Promise<SurveyTranslation[]>;
  deleteTranslation(tenantId: string, translationId: string): Promise<boolean>;

  // --- Analytics aggregates -----------------------------------------------
  getAnalyticsOverview(tenantId: string, surveyDefinitionId: string): Promise<SurveyAnalyticsOverview>;
  getBenchmarkByCategory(tenantId: string, surveyDefinitionId: string): Promise<SurveyBenchmarkResult>;
}
