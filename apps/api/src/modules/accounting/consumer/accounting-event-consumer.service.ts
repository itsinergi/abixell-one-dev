/**
 * Phase 2 — Event Consumer Service (WP-INT-01..03).
 *
 * Consumes scm_accounting_ready_events from the outbox, generates journals via
 * posting rules, posts them atomically, and records idempotency metadata for
 * retry safety. At-least-once delivery with database deduplication via
 * journal_headers.UNIQUE(tenant_id, idempotency_key).
 *
 * Architecture:
 * - Claims events via FOR UPDATE SKIP LOCKED in a per-tenant loop (scheduler
 *   job handler pattern from job-handlers.ts:30-46).
 * - Validates payload legalEntityId/periodId (mandatory); fails closed if missing.
 * - Calls generateJournalInternal → postJournalInternal (system principal bypass).
 * - Catches 23505 UNIQUE conflict as idempotent success (already posted).
 * - Records attempts via posting_idempotency_keys ON CONFLICT upsert.
 * - Retries up to MAX_POSTING_ATTEMPTS (default 5); terminal fail after.
 * - Manual requeue via POST /accounting/events/:id/requeue endpoint.
 */

import type {
  AccountingKernelRepository,
} from "../kernel/domain/accounting-kernel.entity.js";
import { NotFoundError, ConflictError, ValidationError } from "../../../domain/shared-kernel/errors.js";

const MAX_POSTING_ATTEMPTS = 5;
const BATCH_SIZE = 50; // Claim up to 50 pending events per sweep

/**
 * Local structural port for the SCM accounting-ready outbox.
 *
 * Declared here rather than imported from the Supply Chain module: the
 * platform boundary validator blocks cross-module implementation imports,
 * and the consumer only needs these four reads/writes. The concrete
 * `PgAccountingEventWritePort` satisfies this shape structurally and is
 * injected by the composition root.
 */
type ConsumerOutboxState = "pending" | "published" | "failed" | "suppressed";
type ConsumerReconciliationState = "unmatched" | "matched" | "reversed" | "ignored";

export interface ConsumerOutboxEvent {
  id: string;
  eventType: string;
  sourceDocumentType: string;
  effectiveAt: Date;
  currency: string;
  amount: number;
  idempotencyKey: string;
  outboxState: ConsumerOutboxState;
  payload: Record<string, unknown>;
}

export interface ConsumerOutboxPort {
  claimPendingEvents(tenantId: string, limit: number): Promise<ConsumerOutboxEvent[]>;
  getEventById(tenantId: string, eventId: string): Promise<ConsumerOutboxEvent | null>;
  updateEventState(
    tenantId: string,
    input: {
      accountingEventId: string;
      stateKind: "outbox" | "reconciliation";
      toState: ConsumerOutboxState | ConsumerReconciliationState;
      reason?: string | null;
      occurredAt?: Date;
      occurredBy?: string | null;
    },
  ): Promise<unknown>;
}

/**
 * Local structural port for the Accounting Kernel's system-principal
 * posting surface. Both methods live on `AccountingKernelService` in this
 * same module; the narrow shape keeps the consumer from depending on the
 * service's full public surface.
 */
export interface ConsumerJournal {
  id: string;
  status: string;
}

export interface ConsumerKernelPort {
  generateJournalInternal(
    tenantId: string,
    input: {
      legalEntityId: string;
      triggerEventType: string;
      journalNumber: string;
      journalDate: string;
      accountingDate: string;
      periodId: string;
      amount: string;
      idempotencyKey: string;
      description: string | null;
      currency: string;
    },
  ): Promise<ConsumerJournal>;
  postJournalInternal(tenantId: string, journalId: string): Promise<ConsumerJournal>;
}

/**
 * Payload fields that must exist for event posting.
 * Generated events MUST include legalEntityId + periodId.
 */
interface EventPayloadRequirements {
  legalEntityId?: unknown;
  periodId?: unknown;
  [key: string]: unknown;
}

export interface ConsumerResult {
  tenantsSwept: number;
  totalEvents: number;
  totalPosted: number;
  totalFailed: number;
  perTenant?: Record<
    string,
    { events: number; posted: number; failed: number; errors: string[] }
  >;
}

export class AccountingEventConsumerService {
  constructor(
    private readonly kernel: ConsumerKernelPort,
    private readonly eventPort: ConsumerOutboxPort,
    private readonly kernelRepo: AccountingKernelRepository,
  ) {}

  /**
   * Sweep and process pending accounting events for a single tenant.
   * Called by the scheduler's per-tenant loop.
   *
   * @param tenantId tenant scope
   * @returns counts: events claimed, posted, failed
   */
  async processTenant(tenantId: string): Promise<{
    events: number;
    posted: number;
    failed: number;
    errors: string[];
  }> {
    const errors: string[] = [];
    let posted = 0;
    let failed = 0;

    let claimed = 0;
    try {
      // Claim up to BATCH_SIZE pending events (FOR UPDATE SKIP LOCKED).
      // The scheduler's execution lease (claimExecution + heartbeat in
      // scheduler.service.ts:232-307) fences this entire consumer job
      // across replicas, so per-transaction row locks sufficient.
      const events = await this.eventPort.claimPendingEvents(tenantId, BATCH_SIZE);
      claimed = events.length;

      for (const event of events) {
        try {
          await this.processEvent(tenantId, event);
          posted++;
        } catch (err) {
          failed++;
          const msg = err instanceof Error ? err.message : String(err);
          errors.push(`Event ${event.id}: ${msg}`);
          console.error(
            `[EventConsumer] event '${event.id}' (tenant ${tenantId}) posting failed:`,
            msg,
          );
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`Tenant sweep failed: ${msg}`);
      console.error(
        `[EventConsumer] tenant ${tenantId} sweep critical error:`,
        msg,
      );
    }

    return { events: claimed, posted, failed, errors };
  }

  /**
   * Process a single event: validate, generate, post, and mark.
   * Catches ConflictError (23505 UNIQUE) as idempotent success.
   *
   * @throws if legalEntityId/periodId missing, or posting fails with a
   *         non-conflict error; does NOT throw on conflict (idempotent).
   */
  private async processEvent(
    tenantId: string,
    event: ConsumerOutboxEvent,
  ): Promise<void> {
    // Step 1: Validate payload and event have required fields.
    const payload = event.payload as EventPayloadRequirements;
    const { legalEntityId, periodId } = payload;

    if (
      typeof legalEntityId !== "string" ||
      typeof periodId !== "string" ||
      !event.effectiveAt
    ) {
      // Missing required fields: mark failed, ignore (no retry).
      await this.eventPort.updateEventState(tenantId, {
        accountingEventId: event.id,
        stateKind: "outbox",
        toState: "failed",
        reason: "missing_required_fields",
        occurredBy: null,
      });
      await this.eventPort.updateEventState(tenantId, {
        accountingEventId: event.id,
        stateKind: "reconciliation",
        toState: "ignored",
        reason: "missing_required_fields",
        occurredBy: null,
      });
      throw new ValidationError("Event missing legalEntityId, periodId, or effectiveAt");
    }

    // Step 2: Check if already exceeded max attempts.
    const idempotencyKey = event.idempotencyKey;
    const existingKey = await this.kernelRepo.findIdempotencyKey(
      tenantId,
      idempotencyKey,
    );
    if (
      existingKey &&
      existingKey.postingAttemptCount >= MAX_POSTING_ATTEMPTS
    ) {
      // Terminal failure: already exceeded max attempts.
      await this.eventPort.updateEventState(tenantId, {
        accountingEventId: event.id,
        stateKind: "outbox",
        toState: "failed",
        reason: `max_attempts_exceeded: ${existingKey.failureReason || "unknown"}`,
        occurredBy: null,
      });
      throw new ConflictError(
        `Event exceeded max posting attempts (${MAX_POSTING_ATTEMPTS})`,
      );
    }

    // Step 3: Generate + post via internal methods (bypass RBAC).
    let journal: { id: string } | null = null;
    try {
      const effectiveDateStr = event.effectiveAt.toISOString().split("T")[0]!;
      journal = await this.kernel.generateJournalInternal(tenantId, {
        legalEntityId,
        triggerEventType: event.eventType,
        journalNumber: `SYS-${event.id}-${Date.now()}`,
        journalDate: effectiveDateStr,
        accountingDate: effectiveDateStr,
        periodId,
        amount: String(event.amount ?? "0.00"),
        idempotencyKey,
        description: `Event: ${event.eventType} (${event.sourceDocumentType})`,
        currency: event.currency ?? "IDR",
      });

      // Post immediately (no separate approval gate for system postings).
      await this.kernel.postJournalInternal(tenantId, journal.id);
    } catch (err: unknown) {
      if (
        err instanceof ConflictError &&
        err.code === "idempotency_key_conflict"
      ) {
        // Idempotent: a journal for this key already exists (prior attempt
        // won the INSERT race or crashed after create but before post).
        // Retrieve it and finish posting if it never got posted — swallowing
        // the conflict without this would leave the GL unposted forever.
        const existing = await this.kernelRepo.findJournalByIdempotencyKey(
          tenantId,
          idempotencyKey,
        );
        if (!existing) {
          // Conflict said the key exists, but the row can't be found — never
          // happens absent a bug elsewhere. Rethrow instead of treating a
          // silent inconsistency as success.
          throw err;
        }
        journal = existing;
        if (existing.status === "pending") {
          await this.kernel.postJournalInternal(tenantId, existing.id);
        }
      } else {
        // Record failure, mark event failed, and rethrow so aggregate counts
        // still report this event as failed.
        const msg = err instanceof Error ? err.message : String(err);
        await this.recordAttemptFailure(tenantId, event.id, idempotencyKey, msg);
        await this.eventPort.updateEventState(tenantId, {
          accountingEventId: event.id,
          stateKind: "outbox",
          toState: "failed",
          reason: msg.slice(0, 500),
          occurredBy: null,
        });
        throw err;
      }
    }

    // Step 4: Mark event published on success.
    await this.eventPort.updateEventState(tenantId, {
      accountingEventId: event.id,
      stateKind: "outbox",
      toState: "published",
      occurredBy: null,
    });
    await this.eventPort.updateEventState(tenantId, {
      accountingEventId: event.id,
      stateKind: "reconciliation",
      toState: "matched",
      occurredBy: null,
    });

    // Record success in idempotency ledger. Link the journal we just produced
    // (null on idempotent-conflict path — the existing row keeps its link).
    await this.kernelRepo.recordIdempotencyKey({
      tenantId,
      sourceEventId: event.id,
      postingRuleVersionHash: "system",
      idempotencyKey,
      lastAttemptStatus: "success",
      failureReason: null,
      journalHeaderId: journal?.id ?? null,
    });
  }

  /**
   * Record a posting attempt failure in idempotency ledger.
   * Does NOT update event state (caller handles that).
   */
  private async recordAttemptFailure(
    tenantId: string,
    eventId: string,
    idempotencyKey: string,
    failureReason: string,
  ): Promise<void> {
    try {
      await this.kernelRepo.recordIdempotencyKey({
        tenantId,
        sourceEventId: eventId,
        postingRuleVersionHash: "system",
        idempotencyKey,
        lastAttemptStatus: "failure",
        failureReason: failureReason.slice(0, 500),
      });
    } catch (err) {
      console.error(
        `[EventConsumer] event '${eventId}' (tenant ${tenantId}) failed to record attempt failure:`,
        err,
      );
    }
  }

  /**
   * Requeue a failed event for retry (manual requeue endpoint).
   * Resets outbox_state to 'pending' and clears attempt count.
   * Precondition: event must be in failed or suppressed state (terminal states).
   *
   * Permission: finance.accounting.configure
   */
  async requeueEvent(tenantId: string, eventId: string): Promise<void> {
    const event = await this.eventPort.getEventById(tenantId, eventId);
    if (!event) {
      throw new NotFoundError("AccountingReadyEvent", eventId);
    }

    // Precondition: only failed or suppressed events can be requeued.
    // (published = already done, pending/ignored = no retry)
    if (event.outboxState !== "failed" && event.outboxState !== "suppressed") {
      throw new ValidationError(
        `Cannot requeue event in state '${event.outboxState}'; only 'failed' and 'suppressed' can be requeued`,
      );
    }

    // Reset outbox state and attempt counter. Both are idempotent on success
    // (event pending + count reset = ready for retry), so partial failure is
    // safe as long as precondition check above ensures only failed/suppressed
    // events are requeued (prevents stuck published or pending states).
    await this.eventPort.updateEventState(tenantId, {
      accountingEventId: eventId,
      stateKind: "outbox",
      toState: "pending",
      reason: "manual_requeue",
      occurredBy: null, // System action
    });

    // Reset attempt counter so the scheduler sweep re-claims and retries it.
    // recordIdempotencyKey always increments on conflict, so we use the
    // dedicated resetIdempotencyKeyAttempts method (Phase 2 WP-INT-03).
    await this.kernelRepo.resetIdempotencyKeyAttempts(
      tenantId,
      event.idempotencyKey,
    );

    console.info(
      `[EventConsumer] event '${eventId}' (tenant ${tenantId}) requeued for retry`,
    );
  }
}
