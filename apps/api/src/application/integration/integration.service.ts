import { createHmac, timingSafeEqual } from "node:crypto";
import type { AuditService } from "../audit/audit.service.js";
import type { RbacService } from "../rbac/rbac.service.js";
import type { EventBus } from "../event/event-bus.js";
import type { ActorContext } from "../../domain/shared-kernel/audit-context.js";
import { ForbiddenError, NotFoundError } from "../../domain/shared-kernel/errors.js";
import type {
  IntegrationDirection,
  IntegrationEndpoint,
  IntegrationLogEntry,
  IntegrationOutboxDelivery,
  IntegrationOutboxSummary,
  IntegrationRepository,
} from "../../domain/integration/integration.entity.js";
import type { DomainEvent } from "../../domain/event/event.entity.js";
import type { TenantRepository } from "../../domain/tenant/tenant.entity.js";

/**
 * Integration Boundary (Checkpoint 0E), per
 * 07-API-Integration-Foundation.md: "Integrasi pihak ketiga ... tidak
 * boleh mengakses database secara langsung atau menyisip logic ke domain
 * layer." Both directions are enforced structurally:
 *
 *  - Outbound: `handleDomainEvent` is an `EventBus` wildcard subscriber
 *    (registered in composition-root.ts) — it reacts to events, it does
 *    not query domain tables. No real third-party call is made (no pilot
 *    client integration credentials exist yet, doc 07's open question) —
 *    each active outbound Integration Endpoint gets a logged 'sent' stub
 *    entry per event, proving the dispatch *point* fires correctly.
 *  - Inbound: `receiveWebhook` validates an HMAC-SHA256 signature against
 *    the Endpoint's stored secret before anything else happens. On
 *    success it does exactly one thing — publish a Domain Event — never
 *    a direct write to any domain table, which is the whole point of the
 *    boundary: adding a new inbound integration later means a new
 *    Endpoint row and a new EventBus subscriber, never new domain-layer
 *    code.
 */
export class IntegrationService {
  constructor(
    private readonly repo: IntegrationRepository,
    private readonly tenantRepo: TenantRepository,
    private readonly eventBus: EventBus,
    private readonly audit: AuditService,
    private readonly rbac: RbacService,
  ) {}

  async createEndpoint(
    actor: ActorContext,
    input: { code: string; name: string; direction: IntegrationDirection; baseUrl: string | null; webhookSecret: string | null },
  ): Promise<IntegrationEndpoint> {
    await this.rbac.requirePermission(actor.userId, "integration.manage");
    const endpoint = await this.repo.createEndpoint({ tenantId: actor.tenantId, ...input });
    await this.audit.record({
      tenantId: actor.tenantId,
      actorUserId: actor.userId,
      action: "integration.endpoint.created",
      entityType: "integration_endpoint",
      entityId: endpoint.id,
      metadata: { code: input.code, direction: input.direction },
    });
    return endpoint;
  }

  async listEndpoints(actor: ActorContext): Promise<IntegrationEndpoint[]> {
    await this.rbac.requirePermission(actor.userId, "integration.read");
    return this.repo.listEndpoints(actor.tenantId);
  }

  async setEndpointActive(actor: ActorContext, code: string, isActive: boolean): Promise<IntegrationEndpoint> {
    await this.rbac.requirePermission(actor.userId, "integration.manage");
    const endpoint = await this.repo.findEndpointByCode(actor.tenantId, code);
    if (!endpoint) throw new NotFoundError("IntegrationEndpoint", code);
    const updated = await this.repo.setEndpointActive(endpoint.id, isActive);
    return updated!;
  }

  async listLog(actor: ActorContext, limit = 100): Promise<IntegrationLogEntry[]> {
    await this.rbac.requirePermission(actor.userId, "integration.read");
    return this.repo.listLog(actor.tenantId, limit);
  }

  /**
   * Phase H2 outbound dispatch point. EventBus keeps its existing synchronous,
   * best-effort subscriber behavior, but the subscriber now only performs an
   * idempotent durable enqueue. The worker handles side effects separately, so
   * a subscriber failure never rolls back the publishing business operation.
   */
  async handleDomainEvent(event: DomainEvent): Promise<void> {
    await this.repo.enqueueOutboundDeliveries({
      tenantId: event.tenantId,
      domainEventId: event.id,
    });
  }

  /**
   * Reconcile every persisted Domain Event against the Tenant's currently
   * active outbound Endpoints, recover interrupted claims, and process due
   * deliveries. PostgreSQL uniqueness makes both enqueue and reconciliation
   * repeatable; tenant-scoped claims plus SKIP LOCKED make parallel workers
   * safe even beyond the Scheduler's in-process overlap guard.
   */
  async reconcileAndProcessTenant(tenantId: string): Promise<IntegrationOutboxSummary> {
    const reconciled = await this.repo.reconcileMissingOutboundDeliveries(tenantId);
    const recovery = await this.repo.recoverStaleOutboundClaims(
      tenantId,
      new Date(Date.now() - this.outboxClaimTimeoutMs()),
      this.outboxMaxAttempts(),
      "Recovered interrupted delivery claim at maximum attempts",
    );

    let claimedCount = 0;
    let succeeded = 0;
    let retried = 0;
    let terminalFailed = recovery.terminalFailed;
    // Claim one delivery at a time so a batch does not hold leases while
    // preceding rows are dispatched. The configured batch size bounds the
    // complete invocation, preserving fairness across Tenants and timer runs.
    while (claimedCount < this.outboxBatchSize()) {
      const delivery = (
        await this.repo.claimDueOutboundDeliveries(
          tenantId,
          1,
          this.outboxMaxAttempts(),
        )
      )[0];
      if (!delivery) break;
      claimedCount += 1;
      const outcome = await this.processOutboundDelivery(delivery);
      if (outcome === "succeeded") succeeded += 1;
      if (outcome === "retry") retried += 1;
      if (outcome === "terminal_failed") terminalFailed += 1;
    }

    return {
      tenantId,
      reconciled,
      claimed: claimedCount,
      succeeded,
      retried,
      terminalFailed,
    };
  }

  private async processOutboundDelivery(
    delivery: IntegrationOutboxDelivery,
  ): Promise<"succeeded" | "retry" | "terminal_failed" | null> {
    if (!(await this.repo.renewOutboundDeliveryClaim(delivery.id, delivery.claimToken))) {
      return null;
    }

    const heartbeat = setInterval(() => {
      this.repo.renewOutboundDeliveryClaim(delivery.id, delivery.claimToken).catch(() => {});
    }, Math.max(1_000, Math.floor(this.outboxClaimTimeoutMs() / 3)));
    heartbeat.unref?.();

    try {
      await this.dispatchOutbound();
      return (await this.repo.markOutboundDeliverySucceeded(delivery.id, delivery.claimToken))
        ? "succeeded"
        : null;
    } catch (error) {
      const errorMessage = sanitizeOperationalError(error);
      if (delivery.attemptCount >= this.outboxMaxAttempts()) {
        return (await this.repo.markOutboundDeliveryTerminalFailed({
          deliveryId: delivery.id,
          claimToken: delivery.claimToken,
          errorMessage,
        }))
          ? "terminal_failed"
          : null;
      }

      return (await this.repo.markOutboundDeliveryRetry({
        deliveryId: delivery.id,
        claimToken: delivery.claimToken,
        nextAttemptAt: new Date(Date.now() + this.retryDelayMs(delivery.attemptCount)),
        errorMessage,
      }))
        ? "retry"
        : null;
    } finally {
      clearInterval(heartbeat);
    }
  }

  /**
   * Transport hook for a future, separately approved endpoint adapter. The
   * current Integration Boundary is still a logged stub, so successful
   * delivery has no external side effect here; repository completion writes
   * the existing `sent` log in the same transaction as outbox completion.
   */
  protected async dispatchOutbound(): Promise<void> {}

  private outboxBatchSize(): number {
    return positiveInteger(process.env.INTEGRATION_OUTBOX_BATCH_SIZE, 100);
  }

  private outboxMaxAttempts(): number {
    return positiveInteger(process.env.INTEGRATION_OUTBOX_MAX_ATTEMPTS, 5);
  }

  private outboxClaimTimeoutMs(): number {
    return positiveInteger(process.env.INTEGRATION_OUTBOX_CLAIM_TIMEOUT_SECONDS, 300) * 1000;
  }

  private retryDelayMs(attemptCount: number): number {
    const baseSeconds = positiveInteger(process.env.INTEGRATION_OUTBOX_RETRY_BASE_SECONDS, 30);
    return baseSeconds * 2 ** Math.min(Math.max(attemptCount - 1, 0), 10) * 1000;
  }

  /** Inbound webhook receiver. `tenantCode` + `endpointCode` together
   * identify which Endpoint's secret to validate against — both are
   * public identifiers (part of the webhook URL), never the secret
   * itself. Returns the logged entry; throws NotFoundError if no such
   * Tenant/Endpoint exists, ForbiddenError if the signature is invalid
   * (and still logs a 'rejected' entry for that case, for Observability
   * — an attacker probing the endpoint is itself worth recording). */
  async receiveWebhook(
    tenantCode: string,
    endpointCode: string,
    rawBody: string,
    signatureHeader: string | undefined,
    idempotencyKey?: string | null,
  ): Promise<IntegrationLogEntry> {
    const tenant = await this.tenantRepo.findByCode(tenantCode);
    if (!tenant) throw new NotFoundError("Tenant", tenantCode);
    const endpoint = await this.repo.findEndpointByCode(tenant.id, endpointCode);
    if (!endpoint || endpoint.direction !== "inbound" || !endpoint.isActive) {
      throw new NotFoundError("IntegrationEndpoint", endpointCode);
    }

    const valid = verifySignature(endpoint.webhookSecret ?? "", rawBody, signatureHeader);
    if (!valid) {
      await this.repo.logEvent({
        tenantId: tenant.id,
        integrationEndpointId: endpoint.id,
        direction: "inbound",
        eventType: `integration.${endpointCode}.rejected`,
        payload: safeParseJson(rawBody),
        status: "rejected",
        errorMessage: "Invalid or missing webhook signature",
      });
      throw new ForbiddenError("Invalid webhook signature");
    }

    // Reliability/Idempotency (Checkpoint 0F): a sender that provides an
    // idempotency key and retries the SAME delivery gets back the
    // original logged entry, unchanged — no second Domain Event is
    // published. A sender that never sends a key keeps the pre-0F
    // behavior (every signature-valid delivery is processed), which is
    // an explicit, documented trade-off: idempotency here is opt-in by
    // the sender, not enforced platform-wide, because there is no
    // reliable dedupe key to fall back to (payload hash would reject
    // legitimately-identical-but-distinct events).
    if (idempotencyKey) {
      const existing = await this.repo.findByIdempotencyKey(endpoint.id, idempotencyKey);
      if (existing) return existing;
    }

    const payload = safeParseJson(rawBody);
    let entry: IntegrationLogEntry;
    try {
      entry = await this.repo.logEvent({
        tenantId: tenant.id,
        integrationEndpointId: endpoint.id,
        direction: "inbound",
        eventType: `integration.${endpointCode}.received`,
        payload,
        status: "received",
        errorMessage: null,
        idempotencyKey: idempotencyKey ?? null,
      });
    } catch (error) {
      // Race window: two concurrent deliveries with the same key both
      // passed the findByIdempotencyKey check above before either
      // inserted — the partial unique index (migration 1756000000000)
      // rejects the second insert (Postgres error code 23505). Treat
      // that as "someone else already logged this delivery" and return
      // the row that won, rather than surfacing a 500 to a webhook
      // sender that did nothing wrong.
      if (
        idempotencyKey &&
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        (error as { code?: string }).code === "23505"
      ) {
        const winner = await this.repo.findByIdempotencyKey(endpoint.id, idempotencyKey);
        if (winner) return winner;
      }
      throw error;
    }

    await this.eventBus.publish({
      tenantId: tenant.id,
      eventType: `integration.${endpointCode}.received`,
      entityType: "integration_endpoint",
      entityId: endpoint.id,
      payload,
      createdBy: null,
    });

    return entry;
  }
}

function verifySignature(secret: string, rawBody: string, signatureHeader: string | undefined): boolean {
  if (!secret || !signatureHeader) return false;
  const expected = createHmac("sha256", secret).update(rawBody).digest("hex");
  const expectedBuf = Buffer.from(expected, "hex");
  const providedBuf = Buffer.from(signatureHeader, "hex");
  if (expectedBuf.length !== providedBuf.length) return false;
  return timingSafeEqual(expectedBuf, providedBuf);
}

function safeParseJson(raw: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(raw);
    return typeof parsed === "object" && parsed !== null ? parsed : { raw };
  } catch {
    return { raw };
  }
}

function positiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

/** Keep worker/audit metadata operational: never persist arbitrary objects,
 * response bodies, webhook payloads, URLs, credentials, or stack traces. */
function sanitizeOperationalError(error: unknown): string {
  const raw = error instanceof Error ? error.message : "Unknown outbound integration error";
  return raw
    .replace(/\b(?:postgres(?:ql)?|https?):\/\/[^\s]+/gi, "[redacted-url]")
    .replace(/\b(?:authorization|cookie|set-cookie|api[-_ ]?key|token|secret|password)\s*[:=]\s*[^\s,;]+/gi, "$1=[redacted]")
    .replace(/[\r\n\t]+/g, " ")
    .slice(0, 500);
}
