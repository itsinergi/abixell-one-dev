import type { Pool } from "pg";
import type {
  SurveyAnswer,
  SurveyAssignment,
  SurveyDefinition,
  SurveyQuestion,
  SurveyQuestionOption,
  SurveyRepository,
  SurveySection,
  SurveyVersion,
} from "../../../domain/survey/survey.entity.js";

/** Row → domain mappers (snake_case → camelCase). numeric comes back as
 * string from pg; coerced to number where the domain expects a number. */
function toDefinition(r: Record<string, unknown>): SurveyDefinition {
  return {
    id: r.id as string,
    tenantId: r.tenant_id as string,
    code: r.code as string,
    name: r.name as string,
    description: (r.description as string) ?? null,
    isActive: r.is_active as boolean,
    createdAt: r.created_at as Date,
    updatedAt: r.updated_at as Date,
  };
}
function toVersion(r: Record<string, unknown>): SurveyVersion {
  return {
    id: r.id as string,
    surveyDefinitionId: r.survey_definition_id as string,
    versionNumber: r.version_number as number,
    status: r.status as SurveyVersion["status"],
    isCurrent: r.is_current as boolean,
    publishedAt: (r.published_at as Date) ?? null,
    createdAt: r.created_at as Date,
    scoringModel: (r.scoring_model as SurveyVersion["scoringModel"]) ?? "sum",
    defaultLocale: (r.default_locale as string) ?? "id-ID",
  };
}
function toSection(r: Record<string, unknown>): SurveySection {
  return {
    id: r.id as string,
    surveyVersionId: r.survey_version_id as string,
    code: r.code as string,
    title: r.title as string,
    description: (r.description as string) ?? null,
    sortOrder: r.sort_order as number,
    scoringModel: (r.scoring_model as SurveySection["scoringModel"]) ?? null,
    weight: r.weight === null || r.weight === undefined ? 1 : Number(r.weight),
  };
}
function toQuestion(r: Record<string, unknown>): SurveyQuestion {
  return {
    id: r.id as string,
    surveyVersionId: r.survey_version_id as string,
    sectionId: (r.section_id as string) ?? null,
    code: r.code as string,
    text: r.text as string,
    questionType: r.question_type as SurveyQuestion["questionType"],
    isRequired: r.is_required as boolean,
    config: (r.config as Record<string, unknown>) ?? {},
    sortOrder: r.sort_order as number,
    weight: r.weight === null || r.weight === undefined ? 1 : Number(r.weight),
  };
}
function toOption(r: Record<string, unknown>): SurveyQuestionOption {
  return {
    id: r.id as string,
    surveyQuestionId: r.survey_question_id as string,
    code: r.code as string,
    label: r.label as string,
    score: r.score === null || r.score === undefined ? null : Number(r.score),
    sortOrder: r.sort_order as number,
  };
}
function toAssignment(r: Record<string, unknown>): SurveyAssignment {
  return {
    id: r.id as string,
    tenantId: r.tenant_id as string,
    surveyVersionId: r.survey_version_id as string,
    respondentType: r.respondent_type as SurveyAssignment["respondentType"],
    respondentUserId: (r.respondent_user_id as string) ?? null,
    respondentCustomerContactId: (r.respondent_customer_contact_id as string) ?? null,
    contextEntityType: (r.context_entity_type as string) ?? null,
    contextEntityId: (r.context_entity_id as string) ?? null,
    status: r.status as SurveyAssignment["status"],
    dueAt: (r.due_at as Date) ?? null,
    totalScore: r.total_score === null || r.total_score === undefined ? null : Number(r.total_score),
    assignedBy: (r.assigned_by as string) ?? null,
    createdAt: r.created_at as Date,
    submittedAt: (r.submitted_at as Date) ?? null,
    npsScore: r.nps_score === null || r.nps_score === undefined ? null : Number(r.nps_score),
    scoringBreakdown: (r.scoring_breakdown as Record<string, unknown>) ?? null,
    distributionTokenId: (r.distribution_token_id as string) ?? null,
  };
}
function toAnswer(r: Record<string, unknown>): SurveyAnswer {
  return {
    id: r.id as string,
    surveyAssignmentId: r.survey_assignment_id as string,
    surveyQuestionId: r.survey_question_id as string,
    valueText: (r.value_text as string) ?? null,
    valueNumeric: r.value_numeric === null || r.value_numeric === undefined ? null : Number(r.value_numeric),
    answeredAt: r.answered_at as Date,
    updatedAt: r.updated_at as Date,
  };
}

export class PgSurveyRepository implements SurveyRepository {
  constructor(private readonly pool: Pool) {}

  // --- Definitions ---------------------------------------------------------
  async createDefinition(input: {
    tenantId: string;
    code: string;
    name: string;
    description: string | null;
    createdBy: string;
  }): Promise<SurveyDefinition> {
    const r = await this.pool.query(
      `INSERT INTO survey_definitions (tenant_id, code, name, description, created_by, updated_by)
       VALUES ($1,$2,$3,$4,$5,$5) RETURNING *`,
      [input.tenantId, input.code, input.name, input.description, input.createdBy],
    );
    return toDefinition(r.rows[0]);
  }
  async findDefinitionById(id: string): Promise<SurveyDefinition | null> {
    const r = await this.pool.query(`SELECT * FROM survey_definitions WHERE id=$1`, [id]);
    return r.rows[0] ? toDefinition(r.rows[0]) : null;
  }
  async findDefinitionByCode(tenantId: string, code: string): Promise<SurveyDefinition | null> {
    const r = await this.pool.query(`SELECT * FROM survey_definitions WHERE tenant_id=$1 AND code=$2`, [
      tenantId,
      code,
    ]);
    return r.rows[0] ? toDefinition(r.rows[0]) : null;
  }
  async listDefinitions(tenantId: string): Promise<SurveyDefinition[]> {
    const r = await this.pool.query(
      `SELECT * FROM survey_definitions WHERE tenant_id=$1 ORDER BY created_at DESC`,
      [tenantId],
    );
    return r.rows.map(toDefinition);
  }

  // --- Versions ------------------------------------------------------------
  async createVersion(input: Parameters<SurveyRepository["createVersion"]>[0]): Promise<SurveyVersion> {
    const r = await this.pool.query(
      `INSERT INTO survey_versions
         (survey_definition_id, version_number, status, created_by, scoring_model, default_locale)
       VALUES ($1,$2,'draft',$3,$4,$5) RETURNING *`,
      [
        input.surveyDefinitionId,
        input.versionNumber,
        input.createdBy,
        input.scoringModel ?? "sum",
        input.defaultLocale ?? "id-ID",
      ],
    );
    return toVersion(r.rows[0]);
  }
  async findVersionById(id: string): Promise<SurveyVersion | null> {
    const r = await this.pool.query(`SELECT * FROM survey_versions WHERE id=$1`, [id]);
    return r.rows[0] ? toVersion(r.rows[0]) : null;
  }
  async findVersion(surveyDefinitionId: string, versionNumber: number): Promise<SurveyVersion | null> {
    const r = await this.pool.query(
      `SELECT * FROM survey_versions WHERE survey_definition_id=$1 AND version_number=$2`,
      [surveyDefinitionId, versionNumber],
    );
    return r.rows[0] ? toVersion(r.rows[0]) : null;
  }
  async findCurrentVersion(surveyDefinitionId: string): Promise<SurveyVersion | null> {
    const r = await this.pool.query(
      `SELECT * FROM survey_versions WHERE survey_definition_id=$1 AND is_current=true`,
      [surveyDefinitionId],
    );
    return r.rows[0] ? toVersion(r.rows[0]) : null;
  }
  async listVersions(surveyDefinitionId: string): Promise<SurveyVersion[]> {
    const r = await this.pool.query(
      `SELECT * FROM survey_versions WHERE survey_definition_id=$1 ORDER BY version_number`,
      [surveyDefinitionId],
    );
    return r.rows.map(toVersion);
  }
  async getNextVersionNumber(surveyDefinitionId: string): Promise<number> {
    const r = await this.pool.query(
      `SELECT COALESCE(max(version_number),0)+1 AS n FROM survey_versions WHERE survey_definition_id=$1`,
      [surveyDefinitionId],
    );
    return r.rows[0].n as number;
  }
  async publishVersion(id: string): Promise<SurveyVersion> {
    const version = await this.findVersionById(id);
    if (!version) throw new Error("version not found");
    await this.pool.query(
      `UPDATE survey_versions SET is_current=false WHERE survey_definition_id=$1 AND id<>$2`,
      [version.surveyDefinitionId, id],
    );
    const r = await this.pool.query(
      `UPDATE survey_versions SET status='published', is_current=true, published_at=now() WHERE id=$1 RETURNING *`,
      [id],
    );
    return toVersion(r.rows[0]);
  }
  async retireVersion(id: string): Promise<SurveyVersion> {
    const r = await this.pool.query(
      `UPDATE survey_versions SET status='retired', is_current=false WHERE id=$1 RETURNING *`,
      [id],
    );
    return toVersion(r.rows[0]);
  }

  // --- Sections / Questions / Options -------------------------------------
  async createSection(input: Parameters<SurveyRepository["createSection"]>[0]): Promise<SurveySection> {
    const r = await this.pool.query(
      `INSERT INTO survey_sections
         (survey_version_id, code, title, description, sort_order, scoring_model, weight)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [
        input.surveyVersionId,
        input.code,
        input.title,
        input.description,
        input.sortOrder,
        input.scoringModel ?? null,
        input.weight ?? 1,
      ],
    );
    return toSection(r.rows[0]);
  }
  async listSections(surveyVersionId: string): Promise<SurveySection[]> {
    const r = await this.pool.query(
      `SELECT * FROM survey_sections WHERE survey_version_id=$1 ORDER BY sort_order, code`,
      [surveyVersionId],
    );
    return r.rows.map(toSection);
  }
  async findSectionById(id: string): Promise<SurveySection | null> {
    const r = await this.pool.query(`SELECT * FROM survey_sections WHERE id=$1`, [id]);
    return r.rows[0] ? toSection(r.rows[0]) : null;
  }

  async createQuestion(input: Parameters<SurveyRepository["createQuestion"]>[0]): Promise<SurveyQuestion> {
    const r = await this.pool.query(
      `INSERT INTO survey_questions
         (survey_version_id, section_id, code, text, question_type, is_required, config, sort_order, weight)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [
        input.surveyVersionId,
        input.sectionId,
        input.code,
        input.text,
        input.questionType,
        input.isRequired,
        JSON.stringify(input.config ?? {}),
        input.sortOrder,
        input.weight ?? 1,
      ],
    );
    return toQuestion(r.rows[0]);
  }
  async listQuestions(surveyVersionId: string): Promise<SurveyQuestion[]> {
    const r = await this.pool.query(
      `SELECT * FROM survey_questions WHERE survey_version_id=$1 ORDER BY sort_order, code`,
      [surveyVersionId],
    );
    return r.rows.map(toQuestion);
  }
  async findQuestionById(id: string): Promise<SurveyQuestion | null> {
    const r = await this.pool.query(`SELECT * FROM survey_questions WHERE id=$1`, [id]);
    return r.rows[0] ? toQuestion(r.rows[0]) : null;
  }

  async createOption(input: {
    surveyQuestionId: string;
    code: string;
    label: string;
    score: number | null;
    sortOrder: number;
  }): Promise<SurveyQuestionOption> {
    const r = await this.pool.query(
      `INSERT INTO survey_question_options (survey_question_id, code, label, score, sort_order)
       VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [input.surveyQuestionId, input.code, input.label, input.score, input.sortOrder],
    );
    return toOption(r.rows[0]);
  }
  async listOptions(surveyQuestionId: string): Promise<SurveyQuestionOption[]> {
    const r = await this.pool.query(
      `SELECT * FROM survey_question_options WHERE survey_question_id=$1 ORDER BY sort_order, code`,
      [surveyQuestionId],
    );
    return r.rows.map(toOption);
  }
  async listOptionsForVersion(surveyVersionId: string): Promise<SurveyQuestionOption[]> {
    const r = await this.pool.query(
      `SELECT o.* FROM survey_question_options o
         JOIN survey_questions q ON q.id = o.survey_question_id
        WHERE q.survey_version_id=$1 ORDER BY o.sort_order, o.code`,
      [surveyVersionId],
    );
    return r.rows.map(toOption);
  }
  async findOptionById(id: string): Promise<SurveyQuestionOption | null> {
    const r = await this.pool.query(`SELECT * FROM survey_question_options WHERE id=$1`, [id]);
    return r.rows[0] ? toOption(r.rows[0]) : null;
  }

  // --- Assignments ---------------------------------------------------------
  async findUserTenantId(userId: string): Promise<string | null> {
    const r = await this.pool.query(`SELECT tenant_id FROM users WHERE id=$1`, [userId]);
    return r.rows[0] ? (r.rows[0].tenant_id as string) : null;
  }
  async createAssignment(input: Parameters<SurveyRepository["createAssignment"]>[0]): Promise<SurveyAssignment> {
    const r = await this.pool.query(
      `INSERT INTO survey_assignments
         (tenant_id, survey_version_id, respondent_type, respondent_user_id, respondent_customer_contact_id,
          context_entity_type, context_entity_id, due_at, assigned_by, distribution_token_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
      [
        input.tenantId,
        input.surveyVersionId,
        input.respondentType,
        input.respondentUserId,
        input.respondentCustomerContactId,
        input.contextEntityType,
        input.contextEntityId,
        input.dueAt,
        input.assignedBy,
        input.distributionTokenId ?? null,
      ],
    );
    return toAssignment(r.rows[0]);
  }
  async findAssignmentById(id: string): Promise<SurveyAssignment | null> {
    const r = await this.pool.query(`SELECT * FROM survey_assignments WHERE id=$1`, [id]);
    return r.rows[0] ? toAssignment(r.rows[0]) : null;
  }
  async listAssignmentsByRespondentUser(tenantId: string, userId: string): Promise<SurveyAssignment[]> {
    const r = await this.pool.query(
      `SELECT * FROM survey_assignments
        WHERE tenant_id=$1 AND respondent_user_id=$2 AND status <> 'cancelled'
        ORDER BY created_at DESC`,
      [tenantId, userId],
    );
    return r.rows.map(toAssignment);
  }
  async listAssignments(tenantId: string): Promise<SurveyAssignment[]> {
    const r = await this.pool.query(
      `SELECT * FROM survey_assignments
        WHERE tenant_id=$1 AND status <> 'cancelled'
        ORDER BY created_at DESC`,
      [tenantId],
    );
    return r.rows.map(toAssignment);
  }
  async finalizeSubmission(
    id: string,
    totalScore: number | null,
    submittedAt: Date,
    options?: {
      npsScore?: number | null;
      scoringBreakdown?: Record<string, unknown> | null;
    },
  ): Promise<SurveyAssignment | null> {
    const r = await this.pool.query(
      `UPDATE survey_assignments
          SET status='submitted', total_score=$2, submitted_at=$3,
              nps_score=$4, scoring_breakdown=$5
        WHERE id=$1 AND status IN ('pending','in_progress')
        RETURNING *`,
      [
        id,
        totalScore,
        submittedAt,
        options?.npsScore ?? null,
        options?.scoringBreakdown ? JSON.stringify(options.scoringBreakdown) : null,
      ],
    );
    return r.rows[0] ? toAssignment(r.rows[0]) : null;
  }
  async markInProgress(id: string): Promise<void> {
    await this.pool.query(
      `UPDATE survey_assignments SET status='in_progress' WHERE id=$1 AND status='pending'`,
      [id],
    );
  }

  /** Atomically expire due assignments. The CTE locks candidate rows with
   * SKIP LOCKED so two scheduler replicas never expire the same assignment
   * twice, then flips them to 'expired' in one statement. */
  async expireDueAssignments(
    tenantId: string,
    now: Date,
    limit: number,
  ): Promise<SurveyAssignment[]> {
    const r = await this.pool.query(
      `WITH due AS (
         SELECT id FROM survey_assignments
          WHERE tenant_id = $1
            AND status IN ('pending', 'in_progress')
            AND due_at IS NOT NULL
            AND due_at <= $2
          ORDER BY due_at
          LIMIT $3
          FOR UPDATE SKIP LOCKED
       )
       UPDATE survey_assignments a
          SET status = 'expired'
         FROM due
        WHERE a.id = due.id
       RETURNING a.*`,
      [tenantId, now, limit],
    );
    return r.rows.map(toAssignment);
  }

  // --- Answers -------------------------------------------------------------
  async upsertAnswer(input: {
    surveyAssignmentId: string;
    surveyQuestionId: string;
    valueText: string | null;
    valueNumeric: number | null;
  }): Promise<SurveyAnswer> {
    const r = await this.pool.query(
      `INSERT INTO survey_answers (survey_assignment_id, survey_question_id, value_text, value_numeric)
       VALUES ($1,$2,$3,$4)
       ON CONFLICT (survey_assignment_id, survey_question_id)
       DO UPDATE SET value_text=EXCLUDED.value_text, value_numeric=EXCLUDED.value_numeric, updated_at=now()
       RETURNING *`,
      [input.surveyAssignmentId, input.surveyQuestionId, input.valueText, input.valueNumeric],
    );
    return toAnswer(r.rows[0]);
  }
  async replaceAnswerOptions(surveyAnswerId: string, optionIds: string[]): Promise<void> {
    await this.pool.query(`DELETE FROM survey_answer_options WHERE survey_answer_id=$1`, [surveyAnswerId]);
    for (const optionId of optionIds) {
      await this.pool.query(
        `INSERT INTO survey_answer_options (survey_answer_id, survey_question_option_id) VALUES ($1,$2)`,
        [surveyAnswerId, optionId],
      );
    }
  }
  async listAnswers(surveyAssignmentId: string): Promise<SurveyAnswer[]> {
    const r = await this.pool.query(
      `SELECT * FROM survey_answers WHERE survey_assignment_id=$1`,
      [surveyAssignmentId],
    );
    return r.rows.map(toAnswer);
  }
  async listAnswerOptionIds(surveyAnswerId: string): Promise<string[]> {
    const r = await this.pool.query(
      `SELECT survey_question_option_id FROM survey_answer_options WHERE survey_answer_id=$1`,
      [surveyAnswerId],
    );
    return r.rows.map((x) => x.survey_question_option_id as string);
  }
}
