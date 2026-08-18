export interface AuditLogEntry {
  id: string;
  tenantId: string | null;
  actorUserId: string | null;
  action: string;
  entityType: string;
  entityId: string | null;
  metadata: Record<string, unknown>;
  createdAt: Date;
}

export interface RecordAuditEntryInput {
  tenantId: string | null;
  actorUserId: string | null;
  action: string;
  entityType: string;
  entityId: string | null;
  metadata?: Record<string, unknown>;
}

export interface AuditLogRepository {
  /** Append-only by design — there is no update/delete method. */
  record(input: RecordAuditEntryInput): Promise<AuditLogEntry>;
  listByEntity(entityType: string, entityId: string): Promise<AuditLogEntry[]>;
  listRecentByTenant(tenantId: string, limit: number): Promise<AuditLogEntry[]>;
}
