import type { Pool, QueryResultRow } from "pg";
import type {
  IntegrationDirection,
  IntegrationEndpoint,
  IntegrationLogEntry,
  IntegrationLogStatus,
  IntegrationRepository,
} from "../../../domain/integration/integration.entity.js";

export class PgIntegrationRepository implements IntegrationRepository {
  constructor(private readonly pool: Pool) {}

  async createEndpoint(input: {
    tenantId: string;
    code: string;
    name: string;
    direction: IntegrationDirection;
    baseUrl: string | null;
    webhookSecret: string | null;
  }): Promise<IntegrationEndpoint> {
    const result = await this.pool.query(
      `INSERT INTO integration_endpoints (tenant_id, code, name, direction, base_url, webhook_secret)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [input.tenantId, input.code, input.name, input.direction, input.baseUrl, input.webhookSecret],
    );
    return mapEndpoint(result.rows[0]);
  }

  async listEndpoints(tenantId: string): Promise<IntegrationEndpoint[]> {
    const result = await this.pool.query(
      `SELECT * FROM integration_endpoints WHERE tenant_id = $1 ORDER BY code`,
      [tenantId],
    );
    return result.rows.map(mapEndpoint);
  }

  async findEndpointByCode(tenantId: string, code: string): Promise<IntegrationEndpoint | null> {
    const result = await this.pool.query(
      `SELECT * FROM integration_endpoints WHERE tenant_id = $1 AND code = $2`,
      [tenantId, code],
    );
    return result.rows[0] ? mapEndpoint(result.rows[0]) : null;
  }

  async setEndpointActive(id: string, isActive: boolean): Promise<IntegrationEndpoint | null> {
    const result = await this.pool.query(
      `UPDATE integration_endpoints SET is_active = $2 WHERE id = $1 RETURNING *`,
      [id, isActive],
    );
    return result.rows[0] ? mapEndpoint(result.rows[0]) : null;
  }

  async logEvent(input: {
    tenantId: string;
    integrationEndpointId: string | null;
    direction: IntegrationDirection;
    eventType: string;
    payload: Record<string, unknown>;
    status: IntegrationLogStatus;
    errorMessage: string | null;
    idempotencyKey?: string | null;
  }): Promise<IntegrationLogEntry> {
    const result = await this.pool.query(
      `INSERT INTO integration_event_log
         (tenant_id, integration_endpoint_id, direction, event_type, payload, status, error_message, idempotency_key)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING *`,
      [
        input.tenantId,
        input.integrationEndpointId,
        input.direction,
        input.eventType,
        JSON.stringify(input.payload),
        input.status,
        input.errorMessage,
        input.idempotencyKey ?? null,
      ],
    );
    return mapLog(result.rows[0]);
  }

  async findByIdempotencyKey(
    integrationEndpointId: string,
    idempotencyKey: string,
  ): Promise<IntegrationLogEntry | null> {
    const result = await this.pool.query(
      `SELECT * FROM integration_event_log
        WHERE integration_endpoint_id = $1 AND idempotency_key = $2 AND direction = 'inbound'
        LIMIT 1`,
      [integrationEndpointId, idempotencyKey],
    );
    return result.rows[0] ? mapLog(result.rows[0]) : null;
  }

  async listLog(tenantId: string, limit: number): Promise<IntegrationLogEntry[]> {
    const result = await this.pool.query(
      `SELECT * FROM integration_event_log WHERE tenant_id = $1 ORDER BY created_at DESC LIMIT $2`,
      [tenantId, limit],
    );
    return result.rows.map(mapLog);
  }
}

function mapEndpoint(row: QueryResultRow): IntegrationEndpoint {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    code: row.code,
    name: row.name,
    direction: row.direction,
    baseUrl: row.base_url,
    webhookSecret: row.webhook_secret,
    isActive: row.is_active,
    createdAt: row.created_at,
  };
}

function mapLog(row: QueryResultRow): IntegrationLogEntry {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    integrationEndpointId: row.integration_endpoint_id,
    direction: row.direction,
    eventType: row.event_type,
    payload: row.payload,
    status: row.status,
    errorMessage: row.error_message,
    idempotencyKey: row.idempotency_key,
    createdAt: row.created_at,
  };
}
