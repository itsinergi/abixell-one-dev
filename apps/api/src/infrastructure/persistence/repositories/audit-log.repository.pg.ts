import type { Pool } from "pg";
import type {
  AuditLogEntry,
  AuditLogRepository,
  RecordAuditEntryInput,
} from "../../../domain/audit/audit-log.entity.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapRow(row: any): AuditLogEntry {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    actorUserId: row.actor_user_id,
    action: row.action,
    entityType: row.entity_type,
    entityId: row.entity_id,
    metadata: row.metadata,
    createdAt: row.created_at,
  };
}

export class PgAuditLogRepository implements AuditLogRepository {
  constructor(private readonly pool: Pool) {}

  async record(input: RecordAuditEntryInput): Promise<AuditLogEntry> {
    const result = await this.pool.query(
      `INSERT INTO audit_log (tenant_id, actor_user_id, action, entity_type, entity_id, metadata)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [
        input.tenantId,
        input.actorUserId,
        input.action,
        input.entityType,
        input.entityId,
        JSON.stringify(input.metadata ?? {}),
      ],
    );
    return mapRow(result.rows[0]);
  }

  async listByEntity(entityType: string, entityId: string): Promise<AuditLogEntry[]> {
    const result = await this.pool.query(
      `SELECT * FROM audit_log WHERE entity_type = $1 AND entity_id = $2 ORDER BY created_at DESC`,
      [entityType, entityId],
    );
    return result.rows.map(mapRow);
  }

  async listRecentByTenant(tenantId: string, limit: number): Promise<AuditLogEntry[]> {
    const result = await this.pool.query(
      `SELECT * FROM audit_log WHERE tenant_id = $1 ORDER BY created_at DESC LIMIT $2`,
      [tenantId, limit],
    );
    return result.rows.map(mapRow);
  }
}
