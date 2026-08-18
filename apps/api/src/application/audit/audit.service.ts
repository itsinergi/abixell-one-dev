import type { AuditLogRepository } from "../../domain/audit/audit-log.entity.js";

/**
 * Thin wrapper around the Audit Log repository so every use-case records
 * audit entries the same way. Per 02-Identity-Security-RBAC-Foundation.md,
 * audit is append-only and mandatory for every entity change subject to
 * RBAC — this service is called from every mutating use-case in this
 * checkpoint, never optionally.
 */
export class AuditService {
  constructor(private readonly repo: AuditLogRepository) {}

  record(params: {
    tenantId: string | null;
    actorUserId: string | null;
    action: string;
    entityType: string;
    entityId: string | null;
    metadata?: Record<string, unknown>;
  }) {
    return this.repo.record(params);
  }

  listByEntity(entityType: string, entityId: string) {
    return this.repo.listByEntity(entityType, entityId);
  }

  listRecentByTenant(tenantId: string, limit = 50) {
    return this.repo.listRecentByTenant(tenantId, limit);
  }
}
