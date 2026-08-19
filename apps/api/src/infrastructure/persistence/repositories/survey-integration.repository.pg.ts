import type { Pool, QueryResultRow } from "pg";
import type {
  CompleteExecutionInput,
  CreatePolicyInput,
  SurveyIntegrationExecution,
  SurveyIntegrationExecutionStatus,
  SurveyIntegrationPolicy,
  SurveyIntegrationRepository,
  RespondentResolution,
} from "../../../domain/survey-integration/survey-integration.entity.js";

const UNIQUE_VIOLATION = "23505";

export class PgSurveyIntegrationRepository implements SurveyIntegrationRepository {
  constructor(private readonly pool: Pool) {}

  async createPolicy(input: CreatePolicyInput): Promise<SurveyIntegrationPolicy> {
    const result = await this.pool.query(
      `INSERT INTO survey_integration_policies
         (tenant_id, code, name, enabled, source_entity_type, source_event_type,
          survey_definition_code, respondent_resolution, one_per_entity_lifetime,
          created_by, updated_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$10)
       RETURNING *`,
      [
        input.tenantId,
        input.code,
        input.name,
        input.enabled ?? true,
        input.sourceEntityType,
        input.sourceEventType,
        input.surveyDefinitionCode,
        input.respondentResolution,
        input.onePerEntityLifetime ?? true,
        input.createdBy,
      ],
    );
    return mapPolicy(result.rows[0]);
  }

  async findPolicyByCode(tenantId: string, code: string): Promise<SurveyIntegrationPolicy | null> {
    const result = await this.pool.query(
      `SELECT * FROM survey_integration_policies WHERE tenant_id = $1 AND code = $2`,
      [tenantId, code],
    );
    return result.rows[0] ? mapPolicy(result.rows[0]) : null;
  }

  async findEnabledPolicies(
    tenantId: string,
    sourceEntityType: string,
    sourceEventType: string,
  ): Promise<SurveyIntegrationPolicy[]> {
    const result = await this.pool.query(
      `SELECT * FROM survey_integration_policies
        WHERE tenant_id = $1 AND enabled = true
          AND source_entity_type = $2 AND source_event_type = $3
        ORDER BY code`,
      [tenantId, sourceEntityType, sourceEventType],
    );
    return result.rows.map(mapPolicy);
  }

  async startExecution(input: {
    tenantId: string;
    policyId: string;
    triggerDomainEventId: string;
    sourceEntityType: string;
    sourceEntityId: string;
  }): Promise<{ execution: SurveyIntegrationExecution | null; duplicate: boolean }> {
    // ON CONFLICT on the (policy_id, trigger_domain_event_id) unique index:
    // a reprocessed event inserts nothing and RETURNING yields no row.
    const result = await this.pool.query(
      `INSERT INTO survey_integration_executions
         (tenant_id, policy_id, trigger_domain_event_id, source_entity_type,
          source_entity_id, status)
       VALUES ($1,$2,$3,$4,$5,'processing')
       ON CONFLICT (policy_id, trigger_domain_event_id) DO NOTHING
       RETURNING *`,
      [input.tenantId, input.policyId, input.triggerDomainEventId, input.sourceEntityType, input.sourceEntityId],
    );
    if (!result.rows[0]) return { execution: null, duplicate: true };
    return { execution: mapExecution(result.rows[0]), duplicate: false };
  }

  async findAssignedLifetimeExecution(
    policyId: string,
    sourceEntityType: string,
    sourceEntityId: string,
  ): Promise<SurveyIntegrationExecution | null> {
    const result = await this.pool.query(
      `SELECT * FROM survey_integration_executions
        WHERE policy_id = $1 AND source_entity_type = $2 AND source_entity_id = $3
          AND status = 'assigned'
        LIMIT 1`,
      [policyId, sourceEntityType, sourceEntityId],
    );
    return result.rows[0] ? mapExecution(result.rows[0]) : null;
  }

  async completeExecution(
    id: string,
    input: CompleteExecutionInput,
  ): Promise<{ lifetimeConflict: boolean }> {
    try {
      await this.pool.query(
        `UPDATE survey_integration_executions
            SET status = $2,
                survey_assignment_id = COALESCE($3, survey_assignment_id),
                respondent_user_id = COALESCE($4, respondent_user_id),
                error_code = $5,
                error_message = $6,
                completed_at = now()
          WHERE id = $1`,
        [
          id,
          input.status,
          input.surveyAssignmentId ?? null,
          input.respondentUserId ?? null,
          input.errorCode ?? null,
          input.errorMessage ?? null,
        ],
      );
      return { lifetimeConflict: false };
    } catch (error) {
      if (
        input.status === "assigned" &&
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        (error as { code?: string }).code === UNIQUE_VIOLATION
      ) {
        return { lifetimeConflict: true };
      }
      throw error;
    }
  }

  async findExecutionById(id: string): Promise<SurveyIntegrationExecution | null> {
    const result = await this.pool.query(
      `SELECT * FROM survey_integration_executions WHERE id = $1`,
      [id],
    );
    return result.rows[0] ? mapExecution(result.rows[0]) : null;
  }
}

function mapPolicy(row: QueryResultRow): SurveyIntegrationPolicy {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    code: row.code,
    name: row.name,
    enabled: row.enabled,
    sourceEntityType: row.source_entity_type,
    sourceEventType: row.source_event_type,
    surveyDefinitionCode: row.survey_definition_code,
    respondentResolution: row.respondent_resolution as RespondentResolution,
    onePerEntityLifetime: row.one_per_entity_lifetime,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapExecution(row: QueryResultRow): SurveyIntegrationExecution {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    policyId: row.policy_id,
    triggerDomainEventId: row.trigger_domain_event_id,
    sourceEntityType: row.source_entity_type,
    sourceEntityId: row.source_entity_id,
    surveyAssignmentId: row.survey_assignment_id,
    respondentUserId: row.respondent_user_id,
    status: row.status as SurveyIntegrationExecutionStatus,
    errorCode: row.error_code,
    errorMessage: row.error_message,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    createdAt: row.created_at,
  };
}
