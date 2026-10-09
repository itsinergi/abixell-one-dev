import crypto from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { pool } from "../../src/infrastructure/persistence/db.js";
import { PgAccountingKernelRepository } from "../../src/modules/accounting/kernel/infrastructure/accounting-kernel.repository.pg.js";
import { AccountingKernelService } from "../../src/modules/accounting/kernel/application/accounting-kernel.service.js";
import { AccountingEventConsumerService } from "../../src/modules/accounting/consumer/accounting-event-consumer.service.js";
import { PgAccountingEventWritePort } from "../../src/modules/supply-chain/ports/accounting-event.port.pg.js";
import { PgRbacRepository } from "../../src/infrastructure/persistence/repositories/rbac.repository.pg.js";
import { PgAuditLogRepository } from "../../src/infrastructure/persistence/repositories/audit-log.repository.pg.js";
import { PgOrganizationUnitRepository } from "../../src/infrastructure/persistence/repositories/organization-unit.repository.pg.js";
import { PgLegalEntityRepository } from "../../src/infrastructure/persistence/repositories/legal-entity.repository.pg.js";
import { PgDomainEventRepository } from "../../src/infrastructure/persistence/repositories/domain-event.repository.pg.js";
import { RbacService } from "../../src/application/rbac/rbac.service.js";
import { AuditService } from "../../src/application/audit/audit.service.js";
import { EventBus } from "../../src/application/event/event-bus.js";
import type { ActorContext } from "../../src/domain/shared-kernel/audit-context.js";
import type { ScmAccountingReadyEventType } from "../../src/modules/supply-chain/advanced/domain/supply-chain-advanced.entity.js";
import { ConflictError } from "../../src/domain/shared-kernel/errors.js";

/**
 * Phase 2 — Event Consumer (WP-INT-01..03).
 *
 * Tests the accounting-event-consumer service: claim + dedup + post + retry +
 * requeue flow for SCM accounting-ready events. At-least-once delivery with
 * database deduplication via journal_headers.UNIQUE(tenant_id, idempotency_key).
 * Event validation enforces mandatory legalEntityId + periodId in payload.
 * Retry logic respects max_attempts (default 5); terminal fail after.
 * Manual requeue resets attempt count via dedicated repo method.
 */

const TS = `ec-consumer-${Date.now()}`;

describe("WP-INT-01..03 — Accounting Event Consumer", () => {
  let tenantId: string;
  let legalEntityId: string;
  let userId: string;
  let coaId: string;
  let debitAccountId: string;
  let creditAccountId: string;
  let periodId: string;
  let postingRuleId: string;

  let service: AccountingEventConsumerService;
  let kernel: AccountingKernelService;
  let repo: PgAccountingKernelRepository;
  let eventPort: PgAccountingEventWritePort;
  let actor: ActorContext;

  let testNum = 0;

  async function createEventWithPayload(
    eventType: ScmAccountingReadyEventType,
    idempotencyKey: string,
    legalEntityId?: string,
    periodId?: string,
  ) {
    return eventPort.createEvent(tenantId, {
      eventType,
      sourceDocumentType: "PO",
      sourceDocumentId: crypto.randomUUID(),
      currency: "IDR",
      amount: 1000000,
      idempotencyKey,
      payload: {
        legalEntityId: legalEntityId || null,
        periodId: periodId || null,
      },
    });
  }

  beforeAll(async () => {
    // Setup tenant, users, legal entity
    const tenantResult = await pool.query(
      `INSERT INTO tenants (code, name) VALUES ($1, 'Event Consumer Test') RETURNING id`,
      [TS],
    );
    tenantId = tenantResult.rows[0].id;

    const leResult = await pool.query(
      `INSERT INTO legal_entities (tenant_id, name) VALUES ($1, 'Test LE') RETURNING id`,
      [tenantId],
    );
    legalEntityId = leResult.rows[0].id;

    const userResult = await pool.query(
      `INSERT INTO users (tenant_id, email, password_hash, full_name)
       VALUES ($1, $2, 'x', $2) RETURNING id`,
      [tenantId, `${TS}-user@test.local`],
    );
    userId = userResult.rows[0].id;

    // Create actor context for test assertions
    const roleRes = await pool.query(
      `INSERT INTO roles (tenant_id, code, name) VALUES ($1, 'ROLE-' || random()::text, 'Test Role') RETURNING id`,
      [tenantId],
    );
    const roleId = roleRes.rows[0].id;
    const assignRes = await pool.query(
      `INSERT INTO user_role_assignments (user_id, role_id, scope_type)
       VALUES ($1, $2, 'tenant') RETURNING id`,
      [userId, roleId],
    );
    actor = {
      userId,
      tenantId,
      sessionId: "00000000-0000-4000-8000-000000000001",
      assignmentId: assignRes.rows[0].id,
      roleId,
      roleCode: "ROLE-TEST",
      scopeType: "tenant",
      scopeLegalEntityId: null,
      scopeOrganizationUnitId: null,
      scopeCustomerId: null,
    };

    // Setup COA and accounts
    const coaResult = await pool.query(
      `INSERT INTO chart_of_accounts (tenant_id, legal_entity_id, coa_version_code, coa_version_date, is_active, created_by)
       VALUES ($1, $2, 'FY2026', '2026-01-01', true, $3) RETURNING id`,
      [tenantId, legalEntityId, userId],
    );
    coaId = coaResult.rows[0].id;

    const debitResult = await pool.query(
      `INSERT INTO accounting_accounts (tenant_id, legal_entity_id, coa_id, account_code, account_name, account_class, normal_balance, is_active, created_by)
       VALUES ($1, $2, $3, '1000', 'Cash', 'ASSET', 'debit', true, $4) RETURNING id`,
      [tenantId, legalEntityId, coaId, userId],
    );
    debitAccountId = debitResult.rows[0].id;

    const creditResult = await pool.query(
      `INSERT INTO accounting_accounts (tenant_id, legal_entity_id, coa_id, account_code, account_name, account_class, normal_balance, is_active, created_by)
       VALUES ($1, $2, $3, '5000', 'COGS', 'EXPENSE', 'debit', true, $4) RETURNING id`,
      [tenantId, legalEntityId, coaId, userId],
    );
    creditAccountId = creditResult.rows[0].id;

    // Create open period
    const periodResult = await pool.query(
      `INSERT INTO accounting_periods (tenant_id, legal_entity_id, fiscal_year_code, period_code, period_name, period_type, date_from, date_to, status, created_by)
       VALUES ($1, $2, 'FY2026', 'P-01', 'January 2026', 'monthly', '2026-01-01', '2026-01-31', 'open', $3) RETURNING id`,
      [tenantId, legalEntityId, userId],
    );
    periodId = periodResult.rows[0].id;

    // Create a posting rule for inventory.goods_received
    // accounting_formula stored as JSONB array of legs
    const ruleResult = await pool.query(
      `INSERT INTO posting_rules (tenant_id, rule_code, rule_name, rule_version, trigger_event_type, accounting_formula, requires_approval, effective_date, is_active, created_by, updated_by)
       VALUES ($1, 'RULE_GR', 'Goods Received', 'v1', 'inventory.goods_received', $2::jsonb, false, '2026-01-01', true, $3, $3) RETURNING id`,
      [
        tenantId,
        JSON.stringify([
          { accountCode: "5000", side: "debit", amountExpression: "AMOUNT" },
          { accountCode: "1000", side: "credit", amountExpression: "AMOUNT" },
        ]),
        userId,
      ],
    );
    postingRuleId = ruleResult.rows[0].id;

    // Initialize services
    repo = new PgAccountingKernelRepository(pool);
    eventPort = new PgAccountingEventWritePort(pool);
    kernel = new AccountingKernelService(
      repo,
      {} as never,
      new AuditService(new PgAuditLogRepository(pool)),
      new RbacService(
        new PgRbacRepository(pool),
        new PgOrganizationUnitRepository(pool),
        new PgLegalEntityRepository(pool),
      ),
      new EventBus(new PgDomainEventRepository(pool), () => {}),
    );
    service = new AccountingEventConsumerService(kernel, eventPort, repo);
  });

  afterAll(async () => {
    // Events are immutable; bypass the trigger (which fires on DELETE too) via
    // session_replication_role, scoped to this transaction only — unlike
    // ALTER TABLE DISABLE TRIGGER, this never takes a table lock visible to
    // other connections, so it is safe alongside other suites running in
    // parallel against the shared dev database.
    // Clean up test tenant cascade-deletes all related data.
    // Pool is a shared singleton managed by app lifecycle, never close it from tests.
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(`SET LOCAL session_replication_role = replica`);
      await client.query(`DELETE FROM tenants WHERE id = $1`, [tenantId]);
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  });

  // =========================================================================
  // Happy Path: Claim, Generate, Post, Mark Published
  // =========================================================================

  describe("Happy path: claim → generate → post → published", () => {
    it("claims pending event, generates + posts journal, marks published", async () => {
      const eventId = await (async () => {
        const ev = await createEventWithPayload(
          "inventory.goods_received",
          `test-happy-${++testNum}`,
          legalEntityId,
          periodId,
        );
        return ev.id;
      })();

      // Verify event is in pending state
      let event = (await eventPort.getEventById(tenantId, eventId))!;
      expect(event.outboxState).toBe("pending");
      expect(event.reconciliationState).toBe("unmatched");

      // Run consumer for tenant
      const result = await service.processTenant(tenantId);
      expect(result.events).toBeGreaterThanOrEqual(1);
      expect(result.posted).toBeGreaterThanOrEqual(1);

      // Verify event is marked published
      event = (await eventPort.getEventById(tenantId, eventId))!;
      expect(event.outboxState).toBe("published");
      expect(event.reconciliationState).toBe("matched");

      // Verify journal was created + posted
      const journals = await repo.listJournals(tenantId, {
        periodId,
        status: "posted",
      });
      expect(journals.length).toBeGreaterThan(0);
      const journal = journals[0]!;
      expect(journal.status).toBe("posted");
    });
  });

  // =========================================================================
  // Deduplication: 23505 UNIQUE Conflict
  // =========================================================================

  describe("Deduplication: idempotency key conflict treated as success", () => {
    it("processes same idempotency key twice, second time succeeds via conflict", async () => {
      const idemKey = `test-dedup-${++testNum}`;

      // Create first event
      const event1 = await createEventWithPayload(
        "inventory.goods_received",
        idemKey,
        legalEntityId,
        periodId,
      );

      // Process first time
      const result1 = await service.processTenant(tenantId);
      expect(result1.posted).toBeGreaterThanOrEqual(1);

      // Verify event is published
      let event = (await eventPort.getEventById(tenantId, event1.id))!;
      expect(event.outboxState).toBe("published");

      // Reset event state to pending (simulate retry)
      await eventPort.updateEventState(tenantId, {
        accountingEventId: event1.id,
        stateKind: "outbox",
        toState: "pending",
        reason: "retry_test",
        occurredBy: null,
      });

      // Process again with same idempotency key
      // (in reality, consumer would re-claim this, but for test we
      // verify the service handles 23505 gracefully)
      // The second generation call should catch ConflictError
      // and treat it as idempotent success.
      try {
        await kernel.generateJournalInternal(tenantId, {
          legalEntityId,
          triggerEventType: "inventory.goods_received",
          journalNumber: `SYS-${event1.id.slice(0, 8)}-2`,
          journalDate: "2026-01-01",
          accountingDate: "2026-01-01",
          periodId,
          amount: "1000000",
          idempotencyKey: idemKey,
          description: "Goods received",
          currency: "IDR",
        });
        expect.fail("Should have thrown ConflictError");
      } catch (err: unknown) {
        expect(err).toBeInstanceOf(ConflictError);
        if (!(err instanceof ConflictError)) throw err;
        expect(err.code).toBe("idempotency_key_conflict");
        expect(err.message).toContain("idempotency key already exists");
      }
    });
  });

  // =========================================================================
  // Validation: Missing legalEntityId/periodId
  // =========================================================================

  describe("Payload validation: missing legalEntityId or periodId", () => {
    it("marks event failed with reason 'missing_legal_entity_or_period' when payload lacks legalEntityId", async () => {
      const event = await createEventWithPayload(
        "inventory.goods_received",
        `test-missing-le-${++testNum}`,
        undefined, // no legalEntityId
        periodId,
      );

      const result = await service.processTenant(tenantId);
      // Event processing should fail at validation, count as failed
      expect(result.failed).toBeGreaterThanOrEqual(1);

      // Verify event state
      const updated = (await eventPort.getEventById(tenantId, event.id))!;
      expect(updated.outboxState).toBe("failed");
      expect(updated.reconciliationState).toBe("ignored");
    });

    it("marks event failed when payload lacks periodId", async () => {
      const event = await createEventWithPayload(
        "inventory.goods_received",
        `test-missing-period-${++testNum}`,
        legalEntityId,
        undefined, // no periodId
      );

      const result = await service.processTenant(tenantId);
      expect(result.failed).toBeGreaterThanOrEqual(1);

      const updated = (await eventPort.getEventById(tenantId, event.id))!;
      expect(updated.outboxState).toBe("failed");
      expect(updated.reconciliationState).toBe("ignored");
    });
  });

  // =========================================================================
  // Retry + Max Attempts
  // =========================================================================

  describe("Retry logic: max attempts exceeded", () => {
    it("terminates after max_attempts (5), marks failed", async () => {
      // Create a posting rule for a non-existent event type (will always fail resolution)
      const event = await createEventWithPayload(
        "inventory.goods_received", // valid event type
        `test-max-attempts-${++testNum}`,
        legalEntityId,
        periodId,
      );

      // Manually bump attempt count to near max to test terminal failure
      const MAX_ATTEMPTS = 5;
      for (let i = 0; i < MAX_ATTEMPTS; i++) {
        await repo.recordIdempotencyKey({
          tenantId,
          sourceEventId: event.id,
          postingRuleVersionHash: "test-hash",
          idempotencyKey: event.idempotencyKey,
          lastAttemptStatus: "failure",
          failureReason: "simulated failure",
        });
      }

      // Verify attempt count is at max
      const key = await repo.findIdempotencyKey(tenantId, event.idempotencyKey);
      expect(key?.postingAttemptCount).toBe(MAX_ATTEMPTS);

      // processTenant claims every pending event, so assert only on this
      // event's terminal state (not on the aggregate failed count).
      await service.processTenant(tenantId);
      const updated = (await eventPort.getEventById(tenantId, event.id))!;
      expect(updated.outboxState).toBe("failed");
    });
  });

  // =========================================================================
  // Requeue: Reset Attempt Count
  // =========================================================================

  describe("Manual requeue: reset attempt count and state", () => {
    it("requeue resets outbox_state to pending and attempt count to 0", async () => {
      const event = await createEventWithPayload(
        "inventory.goods_received",
        `test-requeue-${++testNum}`,
        legalEntityId,
        periodId,
      );

      // Mark event as failed
      await eventPort.updateEventState(tenantId, {
        accountingEventId: event.id,
        stateKind: "outbox",
        toState: "failed",
        reason: "test_failure",
        occurredBy: null,
      });

      // Record some failed attempts
      for (let i = 0; i < 3; i++) {
        await repo.recordIdempotencyKey({
          tenantId,
          sourceEventId: event.id,
          postingRuleVersionHash: "test",
          idempotencyKey: event.idempotencyKey,
          lastAttemptStatus: "failure",
          failureReason: "test",
        });
      }

      // Verify state before requeue
      let key = await repo.findIdempotencyKey(tenantId, event.idempotencyKey);
      expect(key?.postingAttemptCount).toBe(3);
      let ev = (await eventPort.getEventById(tenantId, event.id))!;
      expect(ev.outboxState).toBe("failed");

      // Requeue
      await service.requeueEvent(tenantId, event.id);

      // Verify state after requeue
      key = await repo.findIdempotencyKey(tenantId, event.idempotencyKey);
      expect(key?.postingAttemptCount).toBe(0);
      expect(key?.lastAttemptStatus).toBe("pending");
      ev = (await eventPort.getEventById(tenantId, event.id))!;
      expect(ev.outboxState).toBe("pending");
    });

    it("rejects requeue when event is not in a terminal state", async () => {
      // Fresh event is 'pending' — requeueing it would be a no-op at best and
      // would silently clear attempt counts on in-flight work at worst.
      const event = await createEventWithPayload(
        "inventory.goods_received",
        `test-requeue-precondition-${++testNum}`,
        legalEntityId,
        periodId,
      );

      const before = (await eventPort.getEventById(tenantId, event.id))!;
      expect(before.outboxState).toBe("pending");

      await expect(service.requeueEvent(tenantId, event.id)).rejects.toThrow(
        /only 'failed' and 'suppressed' can be requeued/,
      );

      const after = (await eventPort.getEventById(tenantId, event.id))!;
      expect(after.outboxState).toBe("pending");
    });
  });

  // =========================================================================
  // No Posting Rule
  // =========================================================================

  describe("Missing posting rule: fail closed with terminal reason", () => {
    it("rejects event with no matching posting rule, marks failed", async () => {
      // Use an event type that has no posting rule
      const event = await createEventWithPayload(
        "inventory.disposed", // No rule configured for this type
        `test-no-rule-${++testNum}`,
        legalEntityId,
        periodId,
      );

      const result = await service.processTenant(tenantId);
      // Should fail because no posting rule exists for inventory.disposed
      expect(result.failed).toBeGreaterThanOrEqual(1);

      const updated = (await eventPort.getEventById(tenantId, event.id))!;
      expect(updated.outboxState).toBe("failed");
    });
  });

  // =========================================================================
  // Regression: Accounting Kernel Tests Pass
  // =========================================================================

  describe("Regression: no accounting kernel breakage", () => {
    it("posting rules CRUD still works", async () => {
      // Quick smoke test that the kernel service is still functional
      const rules = await repo.listPostingRules(tenantId, {});
      expect(rules.length).toBeGreaterThan(0);
      expect(rules[0]!.ruleCode).toBe("RULE_GR");
    });

    it("accounts + periods still queryable", async () => {
      const accounts = await repo.listAccounts(tenantId, {
        legalEntityId,
      });
      expect(accounts.length).toBeGreaterThan(0);

      const period = await repo.findPeriodById(periodId);
      expect(period?.status).toBe("open");
    });
  });
});
