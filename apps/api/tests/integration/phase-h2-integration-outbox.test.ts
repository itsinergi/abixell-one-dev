import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { IntegrationService } from "../../src/application/integration/integration.service.js";
import { SchedulerService } from "../../src/application/scheduler/scheduler.service.js";
import type { ScheduledJob, SchedulerRepository } from "../../src/domain/scheduler/scheduler.entity.js";
import type { EventBus } from "../../src/application/event/event-bus.js";
import type { AuditService } from "../../src/application/audit/audit.service.js";
import type { RbacService } from "../../src/application/rbac/rbac.service.js";
import type { TenantRepository } from "../../src/domain/tenant/tenant.entity.js";
import { PgIntegrationRepository } from "../../src/infrastructure/persistence/repositories/integration.repository.pg.js";
import { PgSchedulerRepository } from "../../src/infrastructure/persistence/repositories/scheduler.repository.pg.js";
import { buildApp } from "../../src/app.js";
import { pool } from "../../src/infrastructure/persistence/db.js";
import {
  authHeader,
  bootstrapTenant,
  createScheduledJobFixture,
  deleteScheduledJobFixture,
  login,
  provisionFirstAdmin,
} from "./helpers.js";

const FIXTURE_ID = `${Date.now()}-${process.pid}`;
const TENANT_A_CODE = `test-h2-a-${FIXTURE_ID}`;
const TENANT_B_CODE = `test-h2-b-${FIXTURE_ID}`;
const OUTBOX_JOB_CODE = `test-h2-outbox-reconciliation-${FIXTURE_ID}`;

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
    await createScheduledJobFixture({
      jobCode: OUTBOX_JOB_CODE,
      handlerKey: "integration-outbox-reconciliation",
      name: "Test PH-8 Integration Outbox Reconciliation",
    });
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

  beforeEach(async () => {
    service.failureMode = "none";
    delete process.env.INTEGRATION_OUTBOX_MAX_ATTEMPTS;
    delete process.env.INTEGRATION_OUTBOX_RETRY_BASE_SECONDS;
    await pool.query(
      `DELETE FROM integration_endpoints
        WHERE tenant_id = ANY($1::uuid[])
          AND id <> ALL($2::uuid[])`,
      [[tenantAId, tenantBId], [endpointAId, endpointBId]],
    );
    await pool.query(`DELETE FROM domain_events WHERE tenant_id = ANY($1::uuid[])`, [
      [tenantAId, tenantBId],
    ]);
    await pool.query(
      `DELETE FROM integration_endpoint_inactive_windows
        WHERE integration_endpoint_id = ANY($1::uuid[])`,
      [[endpointAId, endpointBId]],
    );
    await pool.query(
      `UPDATE integration_endpoints
          SET is_active = true,
              eligible_from = now(),
              deactivated_at = NULL
        WHERE id = ANY($1::uuid[])`,
      [[endpointAId, endpointBId]],
    );
  });

  afterAll(async () => {
    await pool.query(`DELETE FROM tenants WHERE id = ANY($1::uuid[])`, [[tenantAId, tenantBId]]);
    await deleteScheduledJobFixture(OUTBOX_JOB_CODE);
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

  it("scopes manual Scheduler execution and visible run summaries to the caller's Tenant", async () => {
    const eventAId = await recordEvent(tenantAId, "phase-h2.scheduler-tenant-a");
    const eventBId = await recordEvent(tenantBId, "phase-h2.scheduler-tenant-b");
    await repo.enqueueOutboundDeliveries({ tenantId: tenantAId, domainEventId: eventAId });
    await repo.enqueueOutboundDeliveries({ tenantId: tenantBId, domainEventId: eventBId });

    const first = await app.inject({
      method: "POST",
      url: `/scheduler/jobs/${OUTBOX_JOB_CODE}/trigger`,
      headers: authHeader(adminToken),
    });
    expect(first.statusCode).toBe(200);
    expect(first.json()).toMatchObject({
      trigger: "manual",
      status: "success",
      resultSummary: { tenantsSwept: 1 },
    });
    expect(first.json().resultSummary.perTenant).toBeUndefined();

    const deliveries = await pool.query(
      `SELECT tenant_id, status
         FROM integration_outbox_deliveries
        WHERE domain_event_id = ANY($1::uuid[])`,
      [[eventAId, eventBId]],
    );
    expect(deliveries.rows.find((row) => row.tenant_id === tenantAId)?.status).toBe("succeeded");
    expect(deliveries.rows.find((row) => row.tenant_id === tenantBId)?.status).toBe("pending");

    const jobs = await app.inject({
      method: "GET",
      url: "/scheduler/jobs",
      headers: authHeader(adminToken),
    });
    expect(jobs.statusCode).toBe(200);
    expect(
      jobs
        .json()
        .find(
          (job: { jobCode: string }) =>
            job.jobCode === OUTBOX_JOB_CODE,
        ),
    ).toMatchObject({
      lastRunAt: first.json().startedAt,
      lastStatus: "success",
      lastError: null,
    });

    const runs = await app.inject({
      method: "GET",
      url: `/scheduler/jobs/${OUTBOX_JOB_CODE}/runs`,
      headers: authHeader(adminToken),
    });
    expect(runs.statusCode).toBe(200);
    expect(runs.json()[0]).toMatchObject({ trigger: "manual", status: "success" });
    expect(runs.json()[0].resultSummary.perTenant).toBeUndefined();
  });

  it("uses the original PH-8 cutover for existing Endpoints and excludes new and inactive-window events", async () => {
    const ph8Cutover = (
      await pool.query(
        `SELECT run_on
           FROM pgmigrations
          WHERE name = '1771000000000_phase-h2-production-hardening'`,
      )
    ).rows[0].run_on as Date;
    await pool.query(
      `UPDATE integration_endpoints
          SET eligible_from = $2
        WHERE id = $1`,
      [endpointAId, ph8Cutover],
    );

    const prePh8EventId = await recordEvent(
      tenantAId,
      "phase-h2.pre-ph8-ineligible",
    );
    const missedExistingEventId = await recordEvent(
      tenantAId,
      "phase-h2.post-ph8-missed",
    );
    await pool.query(
      `UPDATE domain_events
          SET occurred_at = CASE id
            WHEN $1 THEN $3::timestamptz - interval '1 second'
            WHEN $2 THEN $3::timestamptz + interval '1 second'
          END
        WHERE id = ANY($4::uuid[])`,
      [
        prePh8EventId,
        missedExistingEventId,
        ph8Cutover,
        [prePh8EventId, missedExistingEventId],
      ],
    );

    const recovered = await service.reconcileAndProcessTenant(tenantAId);
    expect(recovered.reconciled).toBeGreaterThanOrEqual(1);
    const cutoverRows = await pool.query(
      `SELECT domain_event_id, status
         FROM integration_outbox_deliveries
        WHERE integration_endpoint_id = $1
          AND domain_event_id = ANY($2::uuid[])`,
      [endpointAId, [prePh8EventId, missedExistingEventId]],
    );
    expect(
      cutoverRows.rows.some(
        (row) => row.domain_event_id === prePh8EventId,
      ),
    ).toBe(false);
    expect(
      cutoverRows.rows.find(
        (row) => row.domain_event_id === missedExistingEventId,
      )?.status,
    ).toBe("succeeded");

    await pool.query(
      `UPDATE integration_endpoints
          SET eligible_from = now()
        WHERE id = $1`,
      [endpointAId],
    );
    const cutoverEventId = await recordEvent(tenantAId, "phase-h2.cutover-event");
    const endpointId = (
      await pool.query(
        `INSERT INTO integration_endpoints
           (tenant_id, code, name, direction, eligible_from)
         VALUES ($1, 'outbox-cutover', 'Outbox Cutover', 'outbound', now())
         RETURNING id`,
        [tenantAId],
      )
    ).rows[0].id as string;
    const eligibleFrom = (
      await pool.query(`SELECT eligible_from FROM integration_endpoints WHERE id = $1`, [endpointId])
    ).rows[0].eligible_from as Date;
    await pool.query(`UPDATE domain_events SET occurred_at = $2 WHERE id = $1`, [
      cutoverEventId,
      new Date(eligibleFrom.getTime() - 1_000),
    ]);
    await service.reconcileAndProcessTenant(tenantAId);
    expect(
      (
        await pool.query(
          `SELECT count(*)::int AS count
             FROM integration_outbox_deliveries
            WHERE domain_event_id = $1 AND integration_endpoint_id = $2`,
          [cutoverEventId, endpointId],
        )
      ).rows[0].count,
    ).toBe(0);

    const missedBeforeDisable = await recordEvent(
      tenantAId,
      "phase-h2.before-disable-missed",
    );
    await repo.setEndpointActive(endpointAId, false);
    const inactiveEventId = await recordEvent(
      tenantAId,
      "phase-h2.inactive-event",
    );
    await repo.setEndpointActive(endpointAId, true);
    await service.reconcileAndProcessTenant(tenantAId);
    const lifecycleRows = await pool.query(
      `SELECT domain_event_id, status
         FROM integration_outbox_deliveries
        WHERE integration_endpoint_id = $1
          AND domain_event_id = ANY($2::uuid[])`,
      [endpointAId, [missedBeforeDisable, inactiveEventId]],
    );
    expect(
      lifecycleRows.rows.find((row) => row.domain_event_id === missedBeforeDisable)?.status,
    ).toBe("succeeded");
    expect(
      lifecycleRows.rows.some((row) => row.domain_event_id === inactiveEventId),
    ).toBe(false);
  });

  it("fences finalization to the active claim token", async () => {
    const eventId = await recordEvent(tenantAId, "phase-h2.claim-fencing");
    await repo.enqueueOutboundDeliveries({ tenantId: tenantAId, domainEventId: eventId });
    const firstClaim = (await repo.claimDueOutboundDeliveries(tenantAId, 1, 5))[0];
    expect(firstClaim.claimToken).toBeTruthy();

    await pool.query(
      `UPDATE integration_outbox_deliveries SET locked_at = now() - interval '10 minutes' WHERE id = $1`,
      [firstClaim.id],
    );
    await repo.recoverStaleOutboundClaims(tenantAId, new Date(), 5, "Recovered interrupted delivery claim");
    const secondClaim = (await repo.claimDueOutboundDeliveries(tenantAId, 1, 5))[0];
    expect(secondClaim.claimToken).not.toBe(firstClaim.claimToken);

    expect(await repo.markOutboundDeliverySucceeded(firstClaim.id, firstClaim.claimToken)).toBe(false);
    expect(await repo.markOutboundDeliverySucceeded(secondClaim.id, secondClaim.claimToken)).toBe(true);

    const logs = await pool.query(
      `SELECT count(*)::int AS count FROM integration_event_log
        WHERE tenant_id = $1 AND event_type = 'phase-h2.claim-fencing'`,
      [tenantAId],
    );
    expect(logs.rows[0].count).toBe(1);
  });

  it("terminalizes stale claims at the attempt ceiling without dispatching again", async () => {
    process.env.INTEGRATION_OUTBOX_MAX_ATTEMPTS = "1";
    const eventId = await recordEvent(tenantAId, "phase-h2.stale-max-attempts");
    await repo.enqueueOutboundDeliveries({ tenantId: tenantAId, domainEventId: eventId });
    const claim = (await repo.claimDueOutboundDeliveries(tenantAId, 1, 1))[0];
    await pool.query(
      `UPDATE integration_outbox_deliveries SET locked_at = now() - interval '10 minutes' WHERE id = $1`,
      [claim.id],
    );

    const dispatchSpy = vi.spyOn(service as unknown as { dispatchOutbound(): Promise<void> }, "dispatchOutbound");
    const result = await service.reconcileAndProcessTenant(tenantAId);
    expect(result).toMatchObject({ claimed: 0, terminalFailed: 1 });
    expect(dispatchSpy).not.toHaveBeenCalled();
    dispatchSpy.mockRestore();

    const delivery = await pool.query(
      `SELECT status, attempt_count, last_log_status
         FROM integration_outbox_deliveries WHERE id = $1`,
      [claim.id],
    );
    expect(delivery.rows[0]).toMatchObject({
      status: "terminal_failed",
      attempt_count: 1,
      last_log_status: "failed",
    });
  });

  it("does not create timers on a Scheduler-disabled process", async () => {
    const job: ScheduledJob = {
      id: "job-id",
      jobCode: "test-job",
      name: "Test Job",
      description: "Test",
      intervalSeconds: 60,
      handlerKey: "test-handler",
      isEnabled: true,
      lastRunAt: null,
      lastStatus: null,
      lastDurationMs: null,
      lastError: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const schedulerRepo = {
      listJobs: vi.fn(async () => [job]),
    } as unknown as SchedulerRepository;
    const schedulerRbac = {
      requirePermission: vi.fn(async () => undefined),
    } as unknown as RbacService;
    const setIntervalSpy = vi.spyOn(globalThis, "setInterval");
    const scheduler = new SchedulerService(schedulerRepo, schedulerRbac, undefined, {
      timersDisabled: true,
    });

    await scheduler.start();
    expect(setIntervalSpy).not.toHaveBeenCalled();
    setIntervalSpy.mockRestore();
  });

  it("bounds each invocation to the configured batch size", async () => {
    process.env.INTEGRATION_OUTBOX_BATCH_SIZE = "2";
    const eventIds = await Promise.all(
      Array.from({ length: 3 }, (_, index) =>
        recordEvent(tenantAId, `phase-h2.batch-bound-${index}`),
      ),
    );
    for (const eventId of eventIds) {
      await repo.enqueueOutboundDeliveries({ tenantId: tenantAId, domainEventId: eventId });
    }

    const first = await service.reconcileAndProcessTenant(tenantAId);
    expect(first.claimed).toBe(2);
    const remaining = await pool.query(
      `SELECT count(*)::int AS count
         FROM integration_outbox_deliveries
        WHERE domain_event_id = ANY($1::uuid[])
          AND status = 'pending'`,
      [eventIds],
    );
    expect(remaining.rows[0].count).toBe(1);
    delete process.env.INTEGRATION_OUTBOX_BATCH_SIZE;
  });

  it("terminalizes retry rows stranded above a lowered attempt ceiling", async () => {
    const eventId = await recordEvent(tenantAId, "phase-h2.lowered-max");
    await repo.enqueueOutboundDeliveries({ tenantId: tenantAId, domainEventId: eventId });
    await pool.query(
      `UPDATE integration_outbox_deliveries
          SET status = 'retry', attempt_count = 4, next_attempt_at = now()
        WHERE domain_event_id = $1`,
      [eventId],
    );
    process.env.INTEGRATION_OUTBOX_MAX_ATTEMPTS = "3";

    const result = await service.reconcileAndProcessTenant(tenantAId);
    expect(result).toMatchObject({ claimed: 0, terminalFailed: 1 });
    expect(
      (
        await pool.query(
          `SELECT status, last_log_status
             FROM integration_outbox_deliveries
            WHERE domain_event_id = $1`,
          [eventId],
        )
      ).rows[0],
    ).toMatchObject({ status: "terminal_failed", last_log_status: "failed" });
  });

  it("fences Scheduler execution per registered fixture across service replicas", async () => {
    const schedulerRepo = new PgSchedulerRepository(pool);
    const job = await schedulerRepo.findJobByCode(OUTBOX_JOB_CODE);
    expect(job).not.toBeNull();
    const independentJobCode = `${OUTBOX_JOB_CODE}-independent`;
    const independentJobId = await createScheduledJobFixture({
      jobCode: independentJobCode,
      handlerKey: "integration-outbox-reconciliation",
      name: "Test PH-8 Independent Outbox Lock",
    });

    try {
      const firstToken = await schedulerRepo.claimExecution(
        job!.id,
        new Date(),
      );
      expect(firstToken).toBeTruthy();
      expect(
        await schedulerRepo.claimExecution(job!.id, new Date(0)),
      ).toBeNull();

      const independentToken = await schedulerRepo.claimExecution(
        independentJobId,
        new Date(),
      );
      expect(independentToken).toBeTruthy();
      expect(
        await schedulerRepo.renewExecution(job!.id, firstToken!),
      ).toBe(true);
      await schedulerRepo.releaseExecution(independentJobId, independentToken!);
      await schedulerRepo.releaseExecution(job!.id, firstToken!);

      const secondToken = await schedulerRepo.claimExecution(
        job!.id,
        new Date(),
      );
      expect(secondToken).toBeTruthy();
      await schedulerRepo.releaseExecution(job!.id, secondToken!);
    } finally {
      await deleteScheduledJobFixture(independentJobCode);
    }
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
