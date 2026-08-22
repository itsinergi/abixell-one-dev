import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { IntegrationService } from "../../src/application/integration/integration.service.js";
import type { EventBus } from "../../src/application/event/event-bus.js";
import type { AuditService } from "../../src/application/audit/audit.service.js";
import type { RbacService } from "../../src/application/rbac/rbac.service.js";
import type { TenantRepository } from "../../src/domain/tenant/tenant.entity.js";
import { PgIntegrationRepository } from "../../src/infrastructure/persistence/repositories/integration.repository.pg.js";
import { buildApp } from "../../src/app.js";
import { pool } from "../../src/infrastructure/persistence/db.js";
import { authHeader, bootstrapTenant, login, provisionFirstAdmin } from "./helpers.js";

const TENANT_A_CODE = `test-h2-outbox-a-${Date.now()}`;
const TENANT_B_CODE = `test-h2-outbox-b-${Date.now()}`;

class TestableIntegrationService extends IntegrationService {
  failureMode: "none" | "transient" | "terminal" = "none";

  protected override async dispatchOutbound(): Promise<void> {
    if (this.failureMode !== "none") {
      throw new Error(`Simulated ${this.failureMode} transport failure\nsecond line`);
    }
  }
}

/**
 * Phase H2 / PH-8 integration tests run against PostgreSQL and prove the
 * durable source-to-outbox-to-log lifecycle. The scheduler timer is disabled by
 * the test script; manual triggers execute the identical registered handler.
 */
describe("Phase H2 — durable Integration outbox", () => {
  const app = buildApp();
  const repo = new PgIntegrationRepository(pool);
  const service = new TestableIntegrationService(
    repo,
    {} as TenantRepository,
    {} as EventBus,
    {} as AuditService,
    {} as RbacService,
  );
  let tenantAId: string;
  let tenantBId: string;
  let adminToken: string;
  let endpointAId: string;
  let endpointBId: string;

  beforeAll(async () => {
    const tenantA = await bootstrapTenant(app, TENANT_A_CODE, "PH-8 Tenant A");
    const tenantB = await bootstrapTenant(app, TENANT_B_CODE, "PH-8 Tenant B");
    tenantAId = tenantA.id;
    tenantBId = tenantB.id;
    await provisionFirstAdmin({
      tenantId: tenantAId,
      email: "admin@test-h2-outbox.local",
      password: "Admin12345!",
    });
    adminToken = (await login(app, TENANT_A_CODE, "admin@test-h2-outbox.local", "Admin12345!")).body.accessToken;

    endpointAId = (
      await pool.query(
        `INSERT INTO integration_endpoints (tenant_id, code, name, direction)
         VALUES ($1, 'outbox-a', 'Outbox A', 'outbound') RETURNING id`,
        [tenantAId],
      )
    ).rows[0].id;
    endpointBId = (
      await pool.query(
        `INSERT INTO integration_endpoints (tenant_id, code, name, direction)
         VALUES ($1, 'outbox-b', 'Outbox B', 'outbound') RETURNING id`,
        [tenantBId],
      )
    ).rows[0].id;
  });

  beforeEach(() => {
    service.failureMode = "none";
    delete process.env.INTEGRATION_OUTBOX_MAX_ATTEMPTS;
    delete process.env.INTEGRATION_OUTBOX_RETRY_BASE_SECONDS;
  });

  afterAll(async () => {
    await pool.query(`DELETE FROM tenants WHERE id = ANY($1::uuid[])`, [[tenantAId, tenantBId]]);
    await app.close();
    await pool.end();
  });

  async function recordEvent(tenantId: string, eventType: string) {
    return (
      await pool.query(
        `INSERT INTO domain_events
           (tenant_id, event_type, entity_type, entity_id, payload, created_by)
         VALUES ($1, $2, 'phase_h2_probe', NULL, $3, NULL)
         RETURNING id`,
        [tenantId, eventType, JSON.stringify({ safeReference: eventType })],
      )
    ).rows[0].id as string;
  }

  it("creates one outbox delivery per Domain Event and Endpoint, idempotently", async () => {
    const eventId = await recordEvent(tenantAId, "phase-h2.outbox-created");

    expect(await repo.enqueueOutboundDeliveries({ tenantId: tenantAId, domainEventId: eventId })).toBe(1);
    expect(await repo.enqueueOutboundDeliveries({ tenantId: tenantAId, domainEventId: eventId })).toBe(0);
    expect(await repo.enqueueOutboundDeliveries({ tenantId: tenantBId, domainEventId: eventId })).toBe(0);

    const rows = await pool.query(
      `SELECT tenant_id, integration_endpoint_id
         FROM integration_outbox_deliveries
        WHERE domain_event_id = $1`,
      [eventId],
    );
    expect(rows.rows).toEqual([{ tenant_id: tenantAId, integration_endpoint_id: endpointAId }]);
  });

  it("reconciles an interrupted enqueue and processes it exactly once", async () => {
    const eventId = await recordEvent(tenantAId, "phase-h2.reconciled-success");
    const result = await service.reconcileAndProcessTenant(tenantAId);
    expect(result.reconciled).toBeGreaterThanOrEqual(1);
    expect(result.succeeded).toBeGreaterThanOrEqual(1);

    const delivery = await pool.query(
      `SELECT status, attempt_count FROM integration_outbox_deliveries
        WHERE domain_event_id = $1 AND integration_endpoint_id = $2`,
      [eventId, endpointAId],
    );
    expect(delivery.rows[0]).toMatchObject({ status: "succeeded", attempt_count: 1 });

    const second = await service.reconcileAndProcessTenant(tenantAId);
    expect(second.reconciled).toBe(0);
    const logs = await pool.query(
      `SELECT count(*)::int AS count FROM integration_event_log
        WHERE tenant_id = $1 AND integration_endpoint_id = $2
          AND event_type = 'phase-h2.reconciled-success' AND status = 'sent'`,
      [tenantAId, endpointAId],
    );
    expect(logs.rows[0].count).toBe(1);
  });

  it("persists a transient failure, retries when due, then succeeds without duplicate effects", async () => {
    process.env.INTEGRATION_OUTBOX_RETRY_BASE_SECONDS = "1";
    const eventId = await recordEvent(tenantAId, "phase-h2.transient-retry");
    await repo.enqueueOutboundDeliveries({ tenantId: tenantAId, domainEventId: eventId });
    service.failureMode = "transient";

    const first = await service.reconcileAndProcessTenant(tenantAId);
    expect(first.retried).toBe(1);
    const retry = await pool.query(
      `SELECT status, attempt_count, last_error FROM integration_outbox_deliveries
        WHERE domain_event_id = $1 AND integration_endpoint_id = $2`,
      [eventId, endpointAId],
    );
    expect(retry.rows[0]).toMatchObject({ status: "retry", attempt_count: 1 });
    expect(retry.rows[0].last_error).not.toContain("\n");
    expect(retry.rows[0].last_error.length).toBeLessThanOrEqual(500);

    await pool.query(
      `UPDATE integration_outbox_deliveries SET next_attempt_at = now() WHERE domain_event_id = $1`,
      [eventId],
    );
    service.failureMode = "none";
    const second = await service.reconcileAndProcessTenant(tenantAId);
    expect(second.succeeded).toBe(1);

    const logs = await pool.query(
      `SELECT count(*)::int AS count FROM integration_event_log
        WHERE tenant_id = $1 AND event_type = 'phase-h2.transient-retry'`,
      [tenantAId],
    );
    expect(logs.rows[0].count).toBe(1);
  });

  it("exposes terminal failure with sanitized metadata and no event payload", async () => {
    process.env.INTEGRATION_OUTBOX_MAX_ATTEMPTS = "2";
    process.env.INTEGRATION_OUTBOX_RETRY_BASE_SECONDS = "1";
    const eventId = await recordEvent(tenantAId, "phase-h2.terminal-failure");
    await repo.enqueueOutboundDeliveries({ tenantId: tenantAId, domainEventId: eventId });
    service.failureMode = "terminal";

    await service.reconcileAndProcessTenant(tenantAId);
    await pool.query(
      `UPDATE integration_outbox_deliveries SET next_attempt_at = now() WHERE domain_event_id = $1`,
      [eventId],
    );
    const second = await service.reconcileAndProcessTenant(tenantAId);
    expect(second.terminalFailed).toBe(1);

    const delivery = await pool.query(
      `SELECT status, attempt_count, last_error, last_log_status
         FROM integration_outbox_deliveries WHERE domain_event_id = $1`,
      [eventId],
    );
    expect(delivery.rows[0]).toMatchObject({
      status: "terminal_failed",
      attempt_count: 2,
      last_log_status: "failed",
    });
    expect(delivery.rows[0].last_error).not.toContain("\n");

    const log = await pool.query(
      `SELECT payload, error_message FROM integration_event_log
        WHERE tenant_id = $1 AND event_type = 'phase-h2.terminal-failure'`,
      [tenantAId],
    );
    expect(log.rows).toHaveLength(1);
    expect(log.rows[0].payload).toEqual({});
    expect(log.rows[0].error_message).not.toContain("\n");
  });

  it("claims and reconciles only within the requested Tenant", async () => {
    const eventAId = await recordEvent(tenantAId, "phase-h2.tenant-a");
    const eventBId = await recordEvent(tenantBId, "phase-h2.tenant-b");
    await repo.enqueueOutboundDeliveries({ tenantId: tenantAId, domainEventId: eventAId });
    await repo.enqueueOutboundDeliveries({ tenantId: tenantBId, domainEventId: eventBId });

    await service.reconcileAndProcessTenant(tenantAId);
    const rows = await pool.query(
      `SELECT tenant_id, integration_endpoint_id, status
         FROM integration_outbox_deliveries
        WHERE domain_event_id = ANY($1::uuid[])
        ORDER BY tenant_id`,
      [[eventAId, eventBId]],
    );
    expect(rows.rows.find((row) => row.tenant_id === tenantAId)).toMatchObject({
      integration_endpoint_id: endpointAId,
      status: "succeeded",
    });
    expect(rows.rows.find((row) => row.tenant_id === tenantBId)).toMatchObject({
      integration_endpoint_id: endpointBId,
      status: "pending",
    });
  });

  it("uses the Scheduler trigger safely and records worker observability", async () => {
    await recordEvent(tenantAId, "phase-h2.scheduler-trigger");
    const first = await app.inject({
      method: "POST",
      url: "/scheduler/jobs/integration-outbox-reconciliation/trigger",
      headers: authHeader(adminToken),
    });
    expect(first.statusCode).toBe(200);
    expect(first.json().status).toBe("success");
    expect(first.json().resultSummary.tenantsSwept).toBeGreaterThanOrEqual(2);

    const runs = await app.inject({
      method: "GET",
      url: "/scheduler/jobs/integration-outbox-reconciliation/runs",
      headers: authHeader(adminToken),
    });
    expect(runs.statusCode).toBe(200);
    expect(runs.json()[0]).toMatchObject({ trigger: "manual", status: "success" });
  });

  it("partitions concurrent worker claims without duplicate side effects", async () => {
    const eventIds = await Promise.all(
      Array.from({ length: 4 }, (_, index) =>
        recordEvent(tenantAId, `phase-h2.concurrent-claim-${index}`),
      ),
    );
    for (const eventId of eventIds) {
      await repo.enqueueOutboundDeliveries({ tenantId: tenantAId, domainEventId: eventId });
    }

    const [first, second] = await Promise.all([
      service.reconcileAndProcessTenant(tenantAId),
      service.reconcileAndProcessTenant(tenantAId),
    ]);
    expect(first.succeeded + second.succeeded).toBe(4);

    const deliveries = await pool.query(
      `SELECT domain_event_id, status, attempt_count
         FROM integration_outbox_deliveries
        WHERE domain_event_id = ANY($1::uuid[])
        ORDER BY domain_event_id`,
      [eventIds],
    );
    expect(deliveries.rows).toHaveLength(4);
    expect(deliveries.rows.every((row) => row.status === "succeeded" && row.attempt_count === 1)).toBe(true);

    const logs = await pool.query(
      `SELECT event_type, count(*)::int AS count
         FROM integration_event_log
        WHERE tenant_id = $1
          AND event_type LIKE 'phase-h2.concurrent-claim-%'
        GROUP BY event_type`,
      [tenantAId],
    );
    expect(logs.rows).toHaveLength(4);
    expect(logs.rows.every((row) => row.count === 1)).toBe(true);
  });
});
