import type { DomainEvent, DomainEventRepository } from "../../domain/event/event.entity.js";

export type DomainEventHandler = (event: DomainEvent) => Promise<void>;

/**
 * In-process publish/subscribe Event Bus — the mechanism half of the
 * Event Foundation (`domain_events` is the durable log half, see
 * `event.entity.ts`). Every `publish()` call:
 *   1. Persists a `domain_events` row (durable, queryable — this is what
 *      Observability reads).
 *   2. Invokes every subscriber registered for that `eventType` AND every
 *      subscriber registered for `'*'` (wildcard — used by the
 *      Integration Service's outbound stub, which wants to see
 *      everything).
 *
 * This is intentionally NOT a message queue: subscribers run in-process,
 * synchronously, within the same request that published the event (or
 * within the Scheduler's job execution). That is a deliberate Phase 0
 * simplification — per 07-API-Integration-Foundation.md the event-driven
 * *shape* (publishers don't know their subscribers) is the requirement
 * doc 07 asks for, not necessarily an out-of-process broker. Swapping
 * this for a real queue (e.g. so a slow Notification channel can't block
 * the publishing request) is additive infrastructure work later, not a
 * redesign — nothing about `DomainEvent`'s shape or how modules call
 * `publish()` would need to change.
 *
 * A handler that throws is caught and logged as a failed subscriber
 * rather than allowed to fail the publishing operation — one broken
 * Notification template must never block a Workflow approval from
 * completing. This mirrors doc 07's separation of "validasi transaksi
 * yang ketat secara synchronous" (the actual business operation) from
 * "side-effect... dipropagasikan lewat event" (best-effort side effects).
 */
export class EventBus {
  private readonly handlers = new Map<string, DomainEventHandler[]>();

  constructor(
    private readonly repo: DomainEventRepository,
    private readonly onSubscriberError: (eventType: string, error: unknown) => void = () => {},
  ) {}

  subscribe(eventType: string, handler: DomainEventHandler): void {
    const list = this.handlers.get(eventType) ?? [];
    list.push(handler);
    this.handlers.set(eventType, list);
  }

  async publish(input: {
    tenantId: string;
    eventType: string;
    entityType: string;
    entityId: string | null;
    payload: Record<string, unknown>;
    createdBy: string | null;
  }): Promise<DomainEvent> {
    const event = await this.repo.record(input);

    const specific = this.handlers.get(event.eventType) ?? [];
    const wildcard = this.handlers.get("*") ?? [];
    for (const handler of [...specific, ...wildcard]) {
      try {
        await handler(event);
      } catch (error) {
        this.onSubscriberError(event.eventType, error);
      }
    }

    return event;
  }

  listRecentByTenant(tenantId: string, limit = 100): Promise<DomainEvent[]> {
    return this.repo.listRecentByTenant(tenantId, limit);
  }
}
