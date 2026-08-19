/**
 * Domain types for the Generic Survey & Assessment Engine (Checkpoint 1D.1).
 * Product Core, reusable across modules/clients. Hexagonal boundary:
 * `SurveyRepository` is the interface the application layer depends on; the
 * PostgreSQL implementation lives in infrastructure.
 *
 * Two aggregates (FD-1D-02): the Definition (template, immutable once
 * published) and the Assignment (instance + response container). Nothing here
 * knows about Complaint or any business module — `contextEntityType/Id` on an
 * Assignment is an opaque polymorphic reference (same posture as Document/
 * Workflow), authorized via the shared EntityAuthorizationResolver registry.
 */

export type SurveyVersionStatus = "draft" | "published" | "retired";
/** Full enum is future-ready; only the first three have behavior in 1D.1
 * (FD-1D-04). */
export type SurveyQuestionType =
  | "rating"
  | "single_choice"
  | "long_text"
  | "short_text"
  | "multiple_choice"
  | "numeric"
  | "yes_no"
  | "date";
export type SurveyAssignmentStatus =
  | "pending"
  | "in_progress"
  | "submitted"
  | "expired"
  | "cancelled";
export type SurveyRespondentType = "user" | "customer_contact";

export interface SurveyDefinition {
  id: string;
  tenantId: string;
  code: string;
  name: string;
  description: string | null;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface SurveyVersion {
  id: string;
  surveyDefinitionId: string;
  versionNumber: number;
  status: SurveyVersionStatus;
  isCurrent: boolean;
  publishedAt: Date | null;
  createdAt: Date;
}

export interface SurveySection {
  id: string;
  surveyVersionId: string;
  code: string;
  title: string;
  description: string | null;
  sortOrder: number;
}

export interface SurveyQuestion {
  id: string;
  surveyVersionId: string;
  sectionId: string | null;
  code: string;
  text: string;
  questionType: SurveyQuestionType;
  isRequired: boolean;
  config: Record<string, unknown>;
  sortOrder: number;
}

export interface SurveyQuestionOption {
  id: string;
  surveyQuestionId: string;
  code: string;
  label: string;
  score: number | null;
  sortOrder: number;
}

export interface SurveyAssignment {
  id: string;
  tenantId: string;
  surveyVersionId: string;
  respondentType: SurveyRespondentType;
  respondentUserId: string | null;
  respondentCustomerContactId: string | null;
  contextEntityType: string | null;
  contextEntityId: string | null;
  status: SurveyAssignmentStatus;
  dueAt: Date | null;
  totalScore: number | null;
  assignedBy: string | null;
  createdAt: Date;
  submittedAt: Date | null;
}

export interface SurveyAnswer {
  id: string;
  surveyAssignmentId: string;
  surveyQuestionId: string;
  valueText: string | null;
  valueNumeric: number | null;
  answeredAt: Date;
  updatedAt: Date;
}

export interface SurveyRepository {
  // --- Definitions ---------------------------------------------------------
  createDefinition(input: {
    tenantId: string;
    code: string;
    name: string;
    description: string | null;
    createdBy: string;
  }): Promise<SurveyDefinition>;
  findDefinitionById(id: string): Promise<SurveyDefinition | null>;
  findDefinitionByCode(tenantId: string, code: string): Promise<SurveyDefinition | null>;
  listDefinitions(tenantId: string): Promise<SurveyDefinition[]>;

  // --- Versions ------------------------------------------------------------
  createVersion(input: {
    surveyDefinitionId: string;
    versionNumber: number;
    createdBy: string;
  }): Promise<SurveyVersion>;
  findVersionById(id: string): Promise<SurveyVersion | null>;
  findVersion(surveyDefinitionId: string, versionNumber: number): Promise<SurveyVersion | null>;
  findCurrentVersion(surveyDefinitionId: string): Promise<SurveyVersion | null>;
  listVersions(surveyDefinitionId: string): Promise<SurveyVersion[]>;
  getNextVersionNumber(surveyDefinitionId: string): Promise<number>;
  /** Marks the version published + is_current, unsetting is_current on the
   * definition's other versions. */
  publishVersion(id: string): Promise<SurveyVersion>;
  retireVersion(id: string): Promise<SurveyVersion>;

  // --- Sections / Questions / Options -------------------------------------
  createSection(input: {
    surveyVersionId: string;
    code: string;
    title: string;
    description: string | null;
    sortOrder: number;
  }): Promise<SurveySection>;
  listSections(surveyVersionId: string): Promise<SurveySection[]>;
  findSectionById(id: string): Promise<SurveySection | null>;

  createQuestion(input: {
    surveyVersionId: string;
    sectionId: string | null;
    code: string;
    text: string;
    questionType: SurveyQuestionType;
    isRequired: boolean;
    config: Record<string, unknown>;
    sortOrder: number;
  }): Promise<SurveyQuestion>;
  listQuestions(surveyVersionId: string): Promise<SurveyQuestion[]>;
  findQuestionById(id: string): Promise<SurveyQuestion | null>;

  createOption(input: {
    surveyQuestionId: string;
    code: string;
    label: string;
    score: number | null;
    sortOrder: number;
  }): Promise<SurveyQuestionOption>;
  listOptions(surveyQuestionId: string): Promise<SurveyQuestionOption[]>;
  listOptionsForVersion(surveyVersionId: string): Promise<SurveyQuestionOption[]>;
  findOptionById(id: string): Promise<SurveyQuestionOption | null>;

  // --- Assignments ---------------------------------------------------------
  /** Validation helper: the tenant a user belongs to (null if no such user).
   * Used to reject assigning a survey to a respondent outside the actor's
   * tenant. Read-only cross-reference to the shared users table. */
  findUserTenantId(userId: string): Promise<string | null>;
  createAssignment(input: {
    tenantId: string;
    surveyVersionId: string;
    respondentType: SurveyRespondentType;
    respondentUserId: string | null;
    respondentCustomerContactId: string | null;
    contextEntityType: string | null;
    contextEntityId: string | null;
    dueAt: Date | null;
    assignedBy: string;
  }): Promise<SurveyAssignment>;
  findAssignmentById(id: string): Promise<SurveyAssignment | null>;
  listAssignmentsByRespondentUser(tenantId: string, userId: string): Promise<SurveyAssignment[]>;
  /** Guarded finalize: only succeeds if the assignment is still pending/
   * in_progress. Returns null if it was already submitted/cancelled/expired
   * (so submit is atomic and can never double-finalize). */
  finalizeSubmission(id: string, totalScore: number | null, submittedAt: Date): Promise<SurveyAssignment | null>;
  markInProgress(id: string): Promise<void>;

  // --- Answers -------------------------------------------------------------
  upsertAnswer(input: {
    surveyAssignmentId: string;
    surveyQuestionId: string;
    valueText: string | null;
    valueNumeric: number | null;
  }): Promise<SurveyAnswer>;
  replaceAnswerOptions(surveyAnswerId: string, optionIds: string[]): Promise<void>;
  listAnswers(surveyAssignmentId: string): Promise<SurveyAnswer[]>;
  listAnswerOptionIds(surveyAnswerId: string): Promise<string[]>;
}
