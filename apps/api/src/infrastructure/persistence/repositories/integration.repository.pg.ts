import type { Pool, QueryResultRow } from "pg";
import type {
  IntegrationDirection,
  IntegrationEndpoint,
  IntegrationLogEntry,
  IntegrationLogStatus,
  IntegrationOutboxDelivery,
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
         (tenant_id, integration_endpoint_id, direction, event_type, payload, status,
          error_message, idempotency_key)
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

  async enqueueOutboundDeliveries(input: {
    tenantId: string;
    domainEventId: string;
  }): Promise<number> {
    const result = await this.pool.query(
      `INSERT INTO integration_outbox_deliveries
         (tenant_id, domain_event_id, integration_endpoint_id)
       SELECT de.tenant_id, de.id, ie.id
         FROM domain_events de
         JOIN integration_endpoints ie
           ON ie.tenant_id = de.tenant_id
          AND ie.direction = 'outbound'
          AND ie.is_active = true
        WHERE de.id = $1
          AND de.tenant_id = $2
       ON CONFLICT (domain_event_id, integration_endpoint_id) DO NOTHING`,
      [input.domainEventId, input.tenantId],
    );
    return result.rowCount ?? 0;
  }

  async reconcileMissingOutboundDeliveries(tenantId: string): Promise<number> {
    const result = await this.pool.query(
      `INSERT INTO integration_outbox_deliveries
         (tenant_id, domain_event_id, integration_endpoint_id)
       SELECT de.tenant_id, de.id, ie.id
         FROM domain_events de
         JOIN integration_endpoints ie
           ON ie.tenant_id = de.tenant_id
          AND ie.direction = 'outbound'
          AND ie.is_active = true
        WHERE de.tenant_id = $1
       ON CONFLICT (domain_event_id, integration_endpoint_id) DO NOTHING`,
      [tenantId],
    );
    return result.rowCount ?? 0;
  }

  async recoverStaleOutboundClaims(tenantId: string, staleBefore: Date): Promise<number> {
    const result = await this.pool.query(
      `UPDATE integration_outbox_deliveries
          SET status = 'retry',
              next_attempt_at = now(),
              locked_at = NULL,
              last_error = 'Recovered interrupted delivery claim',
              updated_at = now()
        WHERE tenant_id = $1
          AND status = 'processing'
          AND locked_at < $2`,
      [tenantId, staleBefore],
    );
    return result.rowCount ?? 0;
  }

  async claimDueOutboundDeliveries(
    tenantId: string,
    limit: number,
  ): Promise<IntegrationOutboxDelivery[]> {
    const result = await this.pool.query(
      `WITH due AS (
         SELECT iod.id
           FROM integration_outbox_deliveries iod
           JOIN integration_endpoints ie
             ON ie.id = iod.integration_endpoint_id
            AND ie.tenant_id = iod.tenant_id
          WHERE iod.tenant_id = $1
            AND iod.status IN ('pending', 'retry')
            AND iod.next_attempt_at <= now()
            AND ie.direction = 'outbound'
            AND ie.is_active = true
          ORDER BY iod.next_attempt_at, iod.created_at
          LIMIT $2
          FOR UPDATE OF iod SKIP LOCKED
       )
       UPDATE integration_outbox_deliveries iod
          SET status = 'processing',
              attempt_count = iod.attempt_count + 1,
              locked_at = now(),
              updated_at = now()
         FROM due
        WHERE iod.id = due.id
       RETURNING iod.*,
         (SELECT ie.code FROM integration_endpoints ie WHERE ie.id = iod.integration_endpoint_id) AS endpoint_code,
         (SELECT de.event_type FROM domain_events de WHERE de.id = iod.domain_event_id) AS event_type,
         (SELECT de.payload FROM domain_events de WHERE de.id = iod.domain_event_id) AS event_payload`,
      [tenantId, limit],
    );
    return result.rows.map(mapOutboxDelivery);
  }

  async markOutboundDeliverySucceeded(deliveryId: string): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const delivery = await client.query(
        `SELECT iod.*, de.event_type, de.payload
           FROM integration_outbox_deliveries iod
           JOIN domain_events de
             ON de.id = iod.domain_event_id
            AND de.tenant_id = iod.tenant_id
          WHERE iod.id = $1
          FOR UPDATE OF iod`,
        [deliveryId],
      );
      const row = delivery.rows[0];
      if (!row || row.status !== "processing") {
        await client.query("ROLLBACK");
        return;
      }
      if (row.last_log_status !== "sent") {
        await client.query(
          `INSERT INTO integration_event_log
             (tenant_id, integration_endpoint_id, direction, event_type, payload,
              status, error_message, idempotency_key)
           VALUES ($1, $2, 'outbound', $3, $4, 'sent', NULL, NULL)`,
          [row.tenant_id, row.integration_endpoint_id, row.event_type, row.payload],
        );
      }
      await client.query(
        `UPDATE integration_outbox_deliveries
            SET status = 'succeeded', completed_at = now(), locked_at = NULL,
                last_error = NULL, last_log_status = 'sent', updated_at = now()
          WHERE id = $1`,
        [deliveryId],
      );
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async markOutboundDeliveryRetry(input: {
    deliveryId: string;
    nextAttemptAt: Date;
    errorMessage: string;
  }): Promise<void> {
    await this.pool.query(
      `UPDATE integration_outbox_deliveries
          SET status = 'retry', next_attempt_at = $2, locked_at = NULL,
              last_error = $3, updated_at = now()
        WHERE id = $1 AND status = 'processing'`,
      [input.deliveryId, input.nextAttemptAt, input.errorMessage],
    );
  }

  async markOutboundDeliveryTerminalFailed(input: {
    deliveryId: string;
    errorMessage: string;
  }): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const delivery = await client.query(
        `SELECT iod.*, de.event_type
           FROM integration_outbox_deliveries iod
           JOIN domain_events de
             ON de.id = iod.domain_event_id
            AND de.tenant_id = iod.tenant_id
          WHERE iod.id = $1
          FOR UPDATE OF iod`,
        [input.deliveryId],
      );
      const row = delivery.rows[0];
      if (!row || row.status !== "processing") {
        await client.query("ROLLBACK");
        return;
      }
      if (row.last_log_status !== "failed") {
        await client.query(
          `INSERT INTO integration_event_log
             (tenant_id, integration_endpoint_id, direction, event_type, payload,
              status, error_message, idempotency_key)
           VALUES ($1, $2, 'outbound', $3, '{}'::jsonb, 'failed', $4, NULL)`,
          [row.tenant_id, row.integration_endpoint_id, row.event_type, input.errorMessage],
        );
      }
      await client.query(
        `UPDATE integration_outbox_deliveries
            SET status = 'terminal_failed', completed_at = now(), locked_at = NULL,
                last_error = $2, last_log_status = 'failed', updated_at = now()
          WHERE id = $1`,
        [input.deliveryId, input.errorMessage],
      );
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
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

function mapOutboxDelivery(row: QueryResultRow): IntegrationOutboxDelivery {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    domainEventId: row.domain_event_id,
    integrationEndpointId: row.integration_endpoint_id,
    endpointCode: row.endpoint_code,
    eventType: row.event_type,
    payload: row.event_payload,
    status: row.status,
    attemptCount: row.attempt_count,
    nextAttemptAt: row.next_attempt_at,
    lockedAt: row.locked_at,
    lastError: row.last_error,
    lastLogStatus: row.last_log_status,
    completedAt: row.completed_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
