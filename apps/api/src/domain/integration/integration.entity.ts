/**
 * Domain types for the Integration Boundary (Checkpoint 0E), per
 * 07-API-Integration-Foundation.md: third-party integrations "tidak boleh
 * mengakses database secara langsung atau menyisip logic ke domain
 * layer" — everything goes through this boundary instead.
 *
 * `IntegrationEndpoint` is Tenant Configuration (which third-party
 * integrations this Tenant has, outbound or inbound). `integration_event_log`
 * is the record of every attempt, both directions — this is what proves
 * the boundary is real: outbound calls are logged stubs (no actual
 * third-party credentials exist for any pilot client yet, per doc 07's
 * open question), inbound calls are genuine signature-validated webhook
 * receipts that only ever produce a Domain Event, never a direct write
 * to any domain table.
 */

export type IntegrationDirection = "outbound" | "inbound";
export type IntegrationLogStatus = "sent" | "failed" | "received" | "rejected";
export type IntegrationOutboxStatus =
  | "pending"
  | "processing"
  | "retry"
  | "succeeded"
  | "terminal_failed";

export interface IntegrationEndpoint {
  id: string;
  tenantId: string;
  code: string;
  name: string;
  direction: IntegrationDirection;
  baseUrl: string | null;
  webhookSecret: string | null;
  isActive: boolean;
  createdAt: Date;
}

export interface IntegrationLogEntry {
  id: string;
  tenantId: string;
  integrationEndpointId: string | null;
  direction: IntegrationDirection;
  eventType: string;
  payload: Record<string, unknown>;
  status: IntegrationLogStatus;
  errorMessage: string | null;
  /** Checkpoint 0F — optional dedupe key for inbound webhook deliveries
   * (see migration 1756000000000). Null for outbound stub entries and
   * for inbound deliveries whose sender didn't provide one. */
  idempotencyKey: string | null;
  createdAt: Date;
}

export interface IntegrationOutboxDelivery {
  id: string;
  tenantId: string;
  domainEventId: string;
  integrationEndpointId: string;
  endpointCode: string;
  eventType: string;
  payload: Record<string, unknown>;
  status: IntegrationOutboxStatus;
  attemptCount: number;
  nextAttemptAt: Date;
  lockedAt: Date | null;
  lastError: string | null;
  lastLogStatus: "sent" | "failed" | null;
  completedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface IntegrationOutboxSummary {
  tenantId: string;
  reconciled: number;
  claimed: number;
  succeeded: number;
  retried: number;
  terminalFailed: number;
}

export interface IntegrationRepository {
  createEndpoint(input: {
    tenantId: string;
    code: string;
    name: string;
    direction: IntegrationDirection;
    baseUrl: string | null;
    webhookSecret: string | null;
  }): Promise<IntegrationEndpoint>;

  listEndpoints(tenantId: string): Promise<IntegrationEndpoint[]>;
  findEndpointByCode(tenantId: string, code: string): Promise<IntegrationEndpoint | null>;
  setEndpointActive(id: string, isActive: boolean): Promise<IntegrationEndpoint | null>;

  logEvent(input: {
    tenantId: string;
    integrationEndpointId: string | null;
    direction: IntegrationDirection;
    eventType: string;
    payload: Record<string, unknown>;
    status: IntegrationLogStatus;
    errorMessage: string | null;
    idempotencyKey?: string | null;
  }): Promise<IntegrationLogEntry>;

  enqueueOutboundDeliveries(input: {
    tenantId: string;
    domainEventId: string;
  }): Promise<number>;
  reconcileMissingOutboundDeliveries(tenantId: string): Promise<number>;
  recoverStaleOutboundClaims(tenantId: string, staleBefore: Date): Promise<number>;
  claimDueOutboundDeliveries(
    tenantId: string,
    limit: number,
  ): Promise<IntegrationOutboxDelivery[]>;
  markOutboundDeliverySucceeded(deliveryId: string): Promise<void>;
  markOutboundDeliveryRetry(input: {
    deliveryId: string;
    nextAttemptAt: Date;
    errorMessage: string;
  }): Promise<void>;
  markOutboundDeliveryTerminalFailed(input: {
    deliveryId: string;
    errorMessage: string;
  }): Promise<void>;

  /** Checkpoint 0F — the existing log entry for a prior inbound delivery
   * with this exact (endpointId, idempotencyKey) pair, if any. Used to
   * make webhook redelivery a safe no-op instead of a duplicate Domain
   * Event. Only meaningful when `idempotencyKey` is non-null. */
  findByIdempotencyKey(
    integrationEndpointId: string,
    idempotencyKey: string,
  ): Promise<IntegrationLogEntry | null>;

  listLog(tenantId: string, limit: number): Promise<IntegrationLogEntry[]>;
}
