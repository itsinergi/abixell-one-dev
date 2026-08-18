import type { Pool, QueryResultRow } from "pg";
import type { DomainEvent, DomainEventRepository } from "../../../domain/event/event.entity.js";

export class PgDomainEventRepository implements DomainEventRepository {
  constructor(private readonly pool: Pool) {}

  async record(input: {
    tenantId: string;
    eventType: string;
    entityType: string;
    entityId: string | null;
    payload: Record<string, unknown>;
    createdBy: string | null;
  }): Promise<DomainEvent> {
    const result = await this.pool.query(
      `INSERT INTO domain_events (tenant_id, event_type, entity_type, entity_id, payload, created_by)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [
        input.tenantId,
        input.eventType,
        input.entityType,
        input.entityId,
        JSON.stringify(input.payload),
        input.createdBy,
      ],
    );
    return mapEvent(result.rows[0]);
  }

  async listRecentByTenant(tenantId: string, limit: number): Promise<DomainEvent[]> {
    const result = await this.pool.query(
      `SELECT * FROM domain_events WHERE tenant_id = $1 ORDER BY occurred_at DESC LIMIT $2`,
      [tenantId, limit],
    );
    return result.rows.map(mapEvent);
  }
}

function mapEvent(row: QueryResultRow): DomainEvent {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    eventType: row.event_type,
    entityType: row.entity_type,
    entityId: row.entity_id,
    payload: row.payload,
    occurredAt: row.occurred_at,
    createdBy: row.created_by,
  };
}
