/**
 * Domain types for the Event Foundation (Checkpoint 0E), per
 * 07-API-Integration-Foundation.md's "Event System": important events
 * (ApprovalGranted, etc.) are published as domain events and consumed by
 * the Notification Engine, the Integration Service, and future modules —
 * "tanpa perlu mengubah modul yang mempublikasikan event".
 *
 * This module is entity-agnostic on purpose: `entityType`/`entityId` are
 * an opaque polymorphic reference (same pattern as Workflow Instance in
 * 0D), and `payload` is caller-supplied JSON. Nothing here knows about
 * Complaint, Survey, Procurement, or Workflow specifics — 0D's
 * WorkflowService publishes events into this system, it does not define
 * it.
 */

export interface DomainEvent {
  id: string;
  tenantId: string;
  eventType: string;
  entityType: string;
  entityId: string | null;
  payload: Record<string, unknown>;
  occurredAt: Date;
  createdBy: string | null;
}

export interface DomainEventRepository {
  record(input: {
    tenantId: string;
    eventType: string;
    entityType: string;
    entityId: string | null;
    payload: Record<string, unknown>;
    createdBy: string | null;
  }): Promise<DomainEvent>;

  listRecentByTenant(tenantId: string, limit: number): Promise<DomainEvent[]>;
}
