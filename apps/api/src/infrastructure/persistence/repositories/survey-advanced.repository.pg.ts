import type { Pool } from "pg";
import type {
  BranchConditionOperator,
  BranchTargetAction,
  NpsDistribution,
  QuestionDropOffMetric,
  SurveyAdvancedRepository,
  SurveyAnalyticsOverview,
  SurveyBenchmarkItem,
  SurveyBenchmarkResult,
  SurveyBranchingRule,
  SurveyDistributionToken,
  SurveyMatrixAnswer,
  SurveyMatrixRow,
  SurveySectionScore,
  SurveyTranslation,
  TokenDistributionChannel,
  TranslationEntityType,
} from "../../../domain/survey/survey-advanced.entity.js";

function toBranchingRule(r: Record<string, unknown>): SurveyBranchingRule {
  return {
    id: r.id as string,
    tenantId: r.tenant_id as string,
    surveyVersionId: r.survey_version_id as string,
    sourceQuestionId: r.source_question_id as string,
    conditionOperator: r.condition_operator as BranchConditionOperator,
    conditionValue: r.condition_value,
    targetAction: r.target_action as BranchTargetAction,
    targetQuestionId: (r.target_question_id as string) ?? null,
    targetSectionId: (r.target_section_id as string) ?? null,
    priority: r.priority as number,
    createdAt: r.created_at as Date,
  };
}

function toMatrixRow(r: Record<string, unknown>): SurveyMatrixRow {
  return {
    id: r.id as string,
    tenantId: r.tenant_id as string,
    surveyQuestionId: r.survey_question_id as string,
    code: r.code as string,
    label: r.label as string,
    sortOrder: r.sort_order as number,
  };
}

function toMatrixAnswer(r: Record<string, unknown>): SurveyMatrixAnswer {
  return {
    id: r.id as string,
    tenantId: r.tenant_id as string,
    surveyAssignmentId: r.survey_assignment_id as string,
    surveyQuestionId: r.survey_question_id as string,
    matrixRowId: r.matrix_row_id as string,
    valueText: (r.value_text as string) ?? null,
    valueNumeric: r.value_numeric === null || r.value_numeric === undefined ? null : Number(r.value_numeric),
    selectedOptionId: (r.selected_option_id as string) ?? null,
    answeredAt: r.answered_at as Date,
  };
}

function toSectionScore(r: Record<string, unknown>): SurveySectionScore {
  return {
    id: r.id as string,
    tenantId: r.tenant_id as string,
    surveyAssignmentId: r.survey_assignment_id as string,
    surveySectionId: r.survey_section_id as string,
    rawScore: r.raw_score === null || r.raw_score === undefined ? null : Number(r.raw_score),
    maxScore: r.max_score === null || r.max_score === undefined ? null : Number(r.max_score),
    percentageScore: r.percentage_score === null || r.percentage_score === undefined ? null : Number(r.percentage_score),
    weightedScore: r.weighted_score === null || r.weighted_score === undefined ? null : Number(r.weighted_score),
    createdAt: r.created_at as Date,
  };
}

function toDistributionToken(r: Record<string, unknown>): SurveyDistributionToken {
  return {
    id: r.id as string,
    tenantId: r.tenant_id as string,
    surveyVersionId: r.survey_version_id as string,
    tokenHash: r.token_hash as string,
    channel: r.channel as TokenDistributionChannel,
    recipientLabel: (r.recipient_label as string) ?? null,
    maxUses: r.max_uses === null || r.max_uses === undefined ? null : Number(r.max_uses),
    usedCount: Number(r.used_count ?? 0),
    expiresAt: (r.expires_at as Date) ?? null,
    revokedAt: (r.revoked_at as Date) ?? null,
    metadata: (r.metadata as Record<string, unknown>) ?? {},
    createdBy: (r.created_by as string) ?? null,
    createdAt: r.created_at as Date,
  };
}

function toTranslation(r: Record<string, unknown>): SurveyTranslation {
  return {
    id: r.id as string,
    tenantId: r.tenant_id as string,
    surveyVersionId: r.survey_version_id as string,
    locale: r.locale as string,
    entityType: r.entity_type as TranslationEntityType,
    entityId: r.entity_id as string,
    fieldName: r.field_name as string,
    translatedText: r.translated_text as string,
    createdAt: r.created_at as Date,
    updatedAt: r.updated_at as Date,
  };
}

export class PgSurveyAdvancedRepository implements SurveyAdvancedRepository {
  constructor(private readonly pool: Pool) {}

  // --- Branching rules -----------------------------------------------------
  async createBranchingRule(input: {
    tenantId: string;
    surveyVersionId: string;
    sourceQuestionId: string;
    conditionOperator: BranchConditionOperator;
    conditionValue: unknown;
    targetAction: BranchTargetAction;
    targetQuestionId?: string | null;
    targetSectionId?: string | null;
    priority?: number;
  }): Promise<SurveyBranchingRule> {
    const r = await this.pool.query(
      `INSERT INTO survey_branching_rules
         (tenant_id, survey_version_id, source_question_id, condition_operator,
          condition_value, target_action, target_question_id, target_section_id, priority)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [
        input.tenantId,
        input.surveyVersionId,
        input.sourceQuestionId,
        input.conditionOperator,
        JSON.stringify(input.conditionValue ?? []),
        input.targetAction,
        input.targetQuestionId ?? null,
        input.targetSectionId ?? null,
        input.priority ?? 0,
      ],
    );
    return toBranchingRule(r.rows[0]);
  }

  async listBranchingRules(surveyVersionId: string): Promise<SurveyBranchingRule[]> {
    const r = await this.pool.query(
      `SELECT * FROM survey_branching_rules
        WHERE survey_version_id = $1
        ORDER BY priority ASC, created_at ASC`,
      [surveyVersionId],
    );
    return r.rows.map(toBranchingRule);
  }

  async deleteBranchingRule(tenantId: string, ruleId: string): Promise<boolean> {
    const r = await this.pool.query(
      `DELETE FROM survey_branching_rules WHERE tenant_id = $1 AND id = $2 RETURNING id`,
      [tenantId, ruleId],
    );
    return (r.rowCount ?? 0) > 0;
  }

  // --- Matrix rows & answers ----------------------------------------------
  async createMatrixRow(input: {
    tenantId: string;
    surveyQuestionId: string;
    code: string;
    label: string;
    sortOrder: number;
  }): Promise<SurveyMatrixRow> {
    const r = await this.pool.query(
      `INSERT INTO survey_matrix_rows
         (tenant_id, survey_question_id, code, label, sort_order)
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (survey_question_id, code)
       DO UPDATE SET label = EXCLUDED.label, sort_order = EXCLUDED.sort_order
       RETURNING *`,
      [input.tenantId, input.surveyQuestionId, input.code, input.label, input.sortOrder],
    );
    return toMatrixRow(r.rows[0]);
  }

  async listMatrixRows(surveyQuestionId: string): Promise<SurveyMatrixRow[]> {
    const r = await this.pool.query(
      `SELECT * FROM survey_matrix_rows WHERE survey_question_id = $1 ORDER BY sort_order ASC, code ASC`,
      [surveyQuestionId],
    );
    return r.rows.map(toMatrixRow);
  }

  async listMatrixRowsForVersion(surveyVersionId: string): Promise<SurveyMatrixRow[]> {
    const r = await this.pool.query(
      `SELECT mr.*
         FROM survey_matrix_rows mr
         JOIN survey_questions q ON q.id = mr.survey_question_id
        WHERE q.survey_version_id = $1
        ORDER BY mr.sort_order ASC, mr.code ASC`,
      [surveyVersionId],
    );
    return r.rows.map(toMatrixRow);
  }

  async upsertMatrixAnswer(input: {
    tenantId: string;
    surveyAssignmentId: string;
    surveyQuestionId: string;
    matrixRowId: string;
    valueText?: string | null;
    valueNumeric?: number | null;
    selectedOptionId?: string | null;
  }): Promise<SurveyMatrixAnswer> {
    const r = await this.pool.query(
      `INSERT INTO survey_matrix_answers
         (tenant_id, survey_assignment_id, survey_question_id, matrix_row_id,
          value_text, value_numeric, selected_option_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT (survey_assignment_id, survey_question_id, matrix_row_id)
       DO UPDATE SET
         value_text = EXCLUDED.value_text,
         value_numeric = EXCLUDED.value_numeric,
         selected_option_id = EXCLUDED.selected_option_id,
         answered_at = now()
       RETURNING *`,
      [
        input.tenantId,
        input.surveyAssignmentId,
        input.surveyQuestionId,
        input.matrixRowId,
        input.valueText ?? null,
        input.valueNumeric ?? null,
        input.selectedOptionId ?? null,
      ],
    );
    return toMatrixAnswer(r.rows[0]);
  }

  async listMatrixAnswers(surveyAssignmentId: string): Promise<SurveyMatrixAnswer[]> {
    const r = await this.pool.query(
      `SELECT * FROM survey_matrix_answers WHERE survey_assignment_id = $1`,
      [surveyAssignmentId],
    );
    return r.rows.map(toMatrixAnswer);
  }

  // --- Section scores -----------------------------------------------------
  async upsertSectionScore(input: {
    tenantId: string;
    surveyAssignmentId: string;
    surveySectionId: string;
    rawScore: number | null;
    maxScore: number | null;
    percentageScore: number | null;
    weightedScore: number | null;
  }): Promise<SurveySectionScore> {
    const r = await this.pool.query(
      `INSERT INTO survey_section_scores
         (tenant_id, survey_assignment_id, survey_section_id, raw_score, max_score, percentage_score, weighted_score)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT (survey_assignment_id, survey_section_id)
       DO UPDATE SET
         raw_score = EXCLUDED.raw_score,
         max_score = EXCLUDED.max_score,
         percentage_score = EXCLUDED.percentage_score,
         weighted_score = EXCLUDED.weighted_score
       RETURNING *`,
      [
        input.tenantId,
        input.surveyAssignmentId,
        input.surveySectionId,
        input.rawScore,
        input.maxScore,
        input.percentageScore,
        input.weightedScore,
      ],
    );
    return toSectionScore(r.rows[0]);
  }

  async listSectionScores(surveyAssignmentId: string): Promise<SurveySectionScore[]> {
    const r = await this.pool.query(
      `SELECT * FROM survey_section_scores WHERE survey_assignment_id = $1`,
      [surveyAssignmentId],
    );
    return r.rows.map(toSectionScore);
  }

  // --- Distribution tokens ------------------------------------------------
  async createDistributionToken(input: {
    tenantId: string;
    surveyVersionId: string;
    tokenHash: string;
    channel: TokenDistributionChannel;
    recipientLabel?: string | null;
    maxUses?: number | null;
    expiresAt?: Date | null;
    metadata?: Record<string, unknown>;
    createdBy?: string | null;
  }): Promise<SurveyDistributionToken> {
    const r = await this.pool.query(
      `INSERT INTO survey_distribution_tokens
         (tenant_id, survey_version_id, token_hash, channel, recipient_label,
          max_uses, expires_at, metadata, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [
        input.tenantId,
        input.surveyVersionId,
        input.tokenHash,
        input.channel,
        input.recipientLabel ?? null,
        input.maxUses ?? null,
        input.expiresAt ?? null,
        JSON.stringify(input.metadata ?? {}),
        input.createdBy ?? null,
      ],
    );
    return toDistributionToken(r.rows[0]);
  }

  async findDistributionTokenByHash(tokenHash: string): Promise<SurveyDistributionToken | null> {
    const r = await this.pool.query(
      `SELECT * FROM survey_distribution_tokens WHERE token_hash = $1`,
      [tokenHash],
    );
    return r.rows[0] ? toDistributionToken(r.rows[0]) : null;
  }

  async findDistributionTokenById(tenantId: string, tokenId: string): Promise<SurveyDistributionToken | null> {
    const r = await this.pool.query(
      `SELECT * FROM survey_distribution_tokens WHERE tenant_id = $1 AND id = $2`,
      [tenantId, tokenId],
    );
    return r.rows[0] ? toDistributionToken(r.rows[0]) : null;
  }

  async listDistributionTokens(tenantId: string, surveyVersionId: string): Promise<SurveyDistributionToken[]> {
    const r = await this.pool.query(
      `SELECT * FROM survey_distribution_tokens
        WHERE tenant_id = $1 AND survey_version_id = $2
        ORDER BY created_at DESC`,
      [tenantId, surveyVersionId],
    );
    return r.rows.map(toDistributionToken);
  }

  async incrementTokenUsage(tokenId: string): Promise<void> {
    await this.pool.query(
      `UPDATE survey_distribution_tokens SET used_count = used_count + 1 WHERE id = $1`,
      [tokenId],
    );
  }

  async revokeDistributionToken(tenantId: string, tokenId: string): Promise<boolean> {
    const r = await this.pool.query(
      `UPDATE survey_distribution_tokens SET revoked_at = now() WHERE tenant_id = $1 AND id = $2 AND revoked_at IS NULL RETURNING id`,
      [tenantId, tokenId],
    );
    return (r.rowCount ?? 0) > 0;
  }

  // --- Translations -------------------------------------------------------
  async upsertTranslation(input: {
    tenantId: string;
    surveyVersionId: string;
    locale: string;
    entityType: TranslationEntityType;
    entityId: string;
    fieldName: string;
    translatedText: string;
  }): Promise<SurveyTranslation> {
    const r = await this.pool.query(
      `INSERT INTO survey_translations
         (tenant_id, survey_version_id, locale, entity_type, entity_id, field_name, translated_text)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT (survey_version_id, locale, entity_type, entity_id, field_name)
       DO UPDATE SET translated_text = EXCLUDED.translated_text, updated_at = now()
       RETURNING *`,
      [
        input.tenantId,
        input.surveyVersionId,
        input.locale,
        input.entityType,
        input.entityId,
        input.fieldName,
        input.translatedText,
      ],
    );
    return toTranslation(r.rows[0]);
  }

  async listTranslations(surveyVersionId: string, locale?: string): Promise<SurveyTranslation[]> {
    if (locale) {
      const r = await this.pool.query(
        `SELECT * FROM survey_translations WHERE survey_version_id = $1 AND locale = $2`,
        [surveyVersionId, locale],
      );
      return r.rows.map(toTranslation);
    }
    const r = await this.pool.query(
      `SELECT * FROM survey_translations WHERE survey_version_id = $1 ORDER BY locale, entity_type, field_name`,
      [surveyVersionId],
    );
    return r.rows.map(toTranslation);
  }

  async deleteTranslation(tenantId: string, translationId: string): Promise<boolean> {
    const r = await this.pool.query(
      `DELETE FROM survey_translations WHERE tenant_id = $1 AND id = $2 RETURNING id`,
      [tenantId, translationId],
    );
    return (r.rowCount ?? 0) > 0;
  }

  // --- Analytics aggregates -----------------------------------------------
  async getAnalyticsOverview(tenantId: string, surveyDefinitionId: string): Promise<SurveyAnalyticsOverview> {
    // 1. Definition metadata
    const defRes = await this.pool.query(
      `SELECT id, code, name FROM survey_definitions WHERE tenant_id = $1 AND id = $2`,
      [tenantId, surveyDefinitionId],
    );
    if (!defRes.rows[0]) throw new Error("survey definition not found");
    const def = defRes.rows[0];

    // 2. Assignment counts & average score
    const countsRes = await this.pool.query(
      `SELECT
         COUNT(*)::int AS total,
         COUNT(*) FILTER (WHERE sa.status = 'submitted')::int AS submitted,
         COUNT(*) FILTER (WHERE sa.status = 'in_progress')::int AS in_progress,
         COUNT(*) FILTER (WHERE sa.status = 'expired')::int AS expired,
         ROUND(AVG(sa.total_score) FILTER (WHERE sa.status = 'submitted')::numeric, 2)::text AS avg_score
       FROM survey_assignments sa
       JOIN survey_versions sv ON sv.id = sa.survey_version_id
      WHERE sa.tenant_id = $1 AND sv.survey_definition_id = $2`,
      [tenantId, surveyDefinitionId],
    );
    const counts = countsRes.rows[0];
    const totalAssignments = Number(counts.total ?? 0);
    const submittedCount = Number(counts.submitted ?? 0);
    const inProgressCount = Number(counts.in_progress ?? 0);
    const expiredCount = Number(counts.expired ?? 0);
    const averageScore = counts.avg_score ? Number(counts.avg_score) : null;
    const completionRatePercent =
      totalAssignments > 0 ? Math.round((submittedCount / totalAssignments) * 10000) / 100 : 0;

    // Small-cell privacy suppression flag (< 5 submitted responses)
    const smallCellSuppressed = submittedCount > 0 && submittedCount < 5;

    // 3. NPS Breakdown across all submitted assignments
    const npsRes = await this.pool.query(
      `SELECT
         COUNT(sa.nps_score)::int AS nps_total,
         COUNT(*) FILTER (WHERE sa.nps_score >= 9)::int AS promoters,
         COUNT(*) FILTER (WHERE sa.nps_score >= 7 AND sa.nps_score <= 8)::int AS passives,
         COUNT(*) FILTER (WHERE sa.nps_score <= 6 AND sa.nps_score IS NOT NULL)::int AS detractors
       FROM survey_assignments sa
       JOIN survey_versions sv ON sv.id = sa.survey_version_id
      WHERE sa.tenant_id = $1 AND sv.survey_definition_id = $2 AND sa.status = 'submitted'`,
      [tenantId, surveyDefinitionId],
    );
    const npsRow = npsRes.rows[0];
    const npsTotal = Number(npsRow.nps_total ?? 0);
    const promoters = Number(npsRow.promoters ?? 0);
    const passives = Number(npsRow.passives ?? 0);
    const detractors = Number(npsRow.detractors ?? 0);

    const promoterPercent = npsTotal > 0 ? Math.round((promoters / npsTotal) * 10000) / 100 : 0;
    const passivePercent = npsTotal > 0 ? Math.round((passives / npsTotal) * 10000) / 100 : 0;
    const detractorPercent = npsTotal > 0 ? Math.round((detractors / npsTotal) * 10000) / 100 : 0;
    const netPromoterScore = npsTotal > 0 ? Math.round((promoterPercent - detractorPercent) * 100) / 100 : null;

    const nps: NpsDistribution = {
      totalNpsResponses: npsTotal,
      promoterCount: promoters,
      passiveCount: passives,
      detractorCount: detractors,
      promoterPercent,
      passivePercent,
      detractorPercent,
      netPromoterScore,
    };

    // 4. Section averages
    const sectionRes = await this.pool.query(
      `SELECT
         sec.id AS section_id,
         sec.code AS section_code,
         sec.title AS section_title,
         ROUND(AVG(ss.percentage_score)::numeric, 2)::text AS avg_pct,
         ROUND(AVG(ss.weighted_score)::numeric, 2)::text AS avg_weighted
       FROM survey_sections sec
       JOIN survey_versions sv ON sv.id = sec.survey_version_id
       LEFT JOIN survey_section_scores ss ON ss.survey_section_id = sec.id
      WHERE sv.survey_definition_id = $1
      GROUP BY sec.id, sec.code, sec.title, sec.sort_order
      ORDER BY sec.sort_order ASC`,
      [surveyDefinitionId],
    );
    const sectionAverages = sectionRes.rows.map((row) => ({
      sectionId: row.section_id as string,
      sectionCode: row.section_code as string,
      sectionTitle: row.section_title as string,
      averagePercentageScore: row.avg_pct ? Number(row.avg_pct) : null,
      averageWeightedScore: row.avg_weighted ? Number(row.avg_weighted) : null,
    }));

    // 5. Question drop-off metrics (views vs answers)
    const dropOffRes = await this.pool.query(
      `SELECT
         q.id AS question_id,
         q.code AS question_code,
         q.text AS question_text,
         (SELECT COUNT(*)::int
            FROM survey_assignments sa2
            JOIN survey_versions sv2 ON sv2.id = sa2.survey_version_id
           WHERE sv2.survey_definition_id = $1
             AND sa2.tenant_id = $2
             AND sa2.status IN ('in_progress', 'submitted')) AS views,
         (SELECT COUNT(DISTINCT ans.survey_assignment_id)::int
            FROM survey_answers ans
           WHERE ans.survey_question_id = q.id) AS answers
       FROM survey_questions q
       JOIN survey_versions sv ON sv.id = q.survey_version_id
      WHERE sv.survey_definition_id = $1 AND sv.is_current = true
      ORDER BY q.sort_order ASC`,
      [surveyDefinitionId, tenantId],
    );
    const questionDropOff: QuestionDropOffMetric[] = dropOffRes.rows.map((row) => {
      const views = Number(row.views ?? 0);
      const answers = Number(row.answers ?? 0);
      const dropOffRatePercent =
        views > 0 ? Math.round(((views - answers) / views) * 10000) / 100 : 0;
      return {
        questionId: row.question_id as string,
        questionCode: row.question_code as string,
        questionText: row.question_text as string,
        viewCount: views,
        answerCount: answers,
        dropOffRatePercent: Math.max(0, dropOffRatePercent),
      };
    });

    return {
      surveyDefinitionId,
      surveyDefinitionCode: def.code as string,
      surveyDefinitionName: def.name as string,
      totalAssignments,
      submittedCount,
      inProgressCount,
      expiredCount,
      completionRatePercent,
      averageScore,
      nps,
      sectionAverages,
      questionDropOff,
      smallCellSuppressed,
    };
  }

  async getBenchmarkByCategory(tenantId: string, surveyDefinitionId: string): Promise<SurveyBenchmarkResult> {
    // Benchmark across context entity types / categories (e.g. complaint categories, customer segments)
    const r = await this.pool.query(
      `SELECT
         COALESCE(sa.context_entity_type, 'direct') AS context_entity_type,
         COALESCE(sa.context_entity_id::text, 'none') AS context_entity_id,
         COALESCE(c.category, sa.context_entity_type, 'General') AS context_label,
         COUNT(*)::int AS response_count,
         ROUND(AVG(sa.total_score)::numeric, 2)::text AS avg_score,
         ROUND(AVG(sa.nps_score)::numeric, 2)::text AS avg_nps,
         ROUND((COUNT(*) FILTER (WHERE sa.status = 'submitted')::numeric / NULLIF(COUNT(*), 0) * 100)::numeric, 2)::text AS completion_rate
       FROM survey_assignments sa
       JOIN survey_versions sv ON sv.id = sa.survey_version_id
       LEFT JOIN complaints c ON sa.context_entity_type = 'complaint' AND c.id = sa.context_entity_id AND c.tenant_id = sa.tenant_id
      WHERE sa.tenant_id = $1 AND sv.survey_definition_id = $2
      GROUP BY sa.context_entity_type, sa.context_entity_id, COALESCE(c.category, sa.context_entity_type, 'General')
      ORDER BY response_count DESC`,
      [tenantId, surveyDefinitionId],
    );

    const items: SurveyBenchmarkItem[] = r.rows.map((row) => ({
      contextEntityType: row.context_entity_type as string,
      contextEntityId: row.context_entity_id as string,
      contextLabel: row.context_label as string,
      responseCount: Number(row.response_count ?? 0),
      averageScore: row.avg_score ? Number(row.avg_score) : null,
      npsScore: row.avg_nps ? Number(row.avg_nps) : null,
      completionRatePercent: row.completion_rate ? Number(row.completion_rate) : 0,
    }));

    return {
      surveyDefinitionId,
      benchmarkDimension: "category",
      items,
      generatedAt: new Date(),
    };
  }
}
