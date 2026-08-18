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
  createdAt: Date;
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
  }): Promise<IntegrationLogEntry>;

  listLog(tenantId: string, limit: number): Promise<IntegrationLogEntry[]>;
}
