import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { pool } from "../../src/infrastructure/persistence/db.js";
import { PgAccountingKernelRepository } from "../../src/modules/accounting/kernel/infrastructure/accounting-kernel.repository.pg.js";
import { AccountingKernelService } from "../../src/modules/accounting/kernel/application/accounting-kernel.service.js";
import { PgRbacRepository } from "../../src/infrastructure/persistence/repositories/rbac.repository.pg.js";
import { PgAuditLogRepository } from "../../src/infrastructure/persistence/repositories/audit-log.repository.pg.js";
import { PgOrganizationUnitRepository } from "../../src/infrastructure/persistence/repositories/organization-unit.repository.pg.js";
import { PgLegalEntityRepository } from "../../src/infrastructure/persistence/repositories/legal-entity.repository.pg.js";
import { RbacService } from "../../src/application/rbac/rbac.service.js";
import { AuditService } from "../../src/application/audit/audit.service.js";
import { EventBus } from "../../src/application/event/event-bus.js";
import { PgDomainEventRepository } from "../../src/infrastructure/persistence/repositories/domain-event.repository.pg.js";
import type { ActorContext } from "../../src/domain/shared-kernel/audit-context.js";
import { ConflictError, ValidationError } from "../../src/domain/shared-kernel/errors.js";

/**
 * WP-FIN-03 — Period Reopen (maker-checker, Epic 14 §4.14).
 *
 * Exercises the service layer with the REAL RbacService and AuditService (so
 * permission enforcement and the append-only audit trail are genuinely
 * tested), the real pg repository, and the real database triggers.
 *
 * Contract under test (§4.14 verbatim):
 *   "Pembukaan ulang periode yang sudah tutup adalah alur maker-checker
 *    tersendiri: pengaju dan penyetuju harus dua orang berbeda, alasan wajib,
 *    bukti dampak wajib, dan seluruh jejaknya append-only. Super Admin tidak
 *    punya jalan pintas yang melewati alur ini."
 *
 * Pattern: real DB pool, dedicated tenant, CASCADE cleanup.
 */

const TS = `ak-reopen-${Date.now()}`;

describe("WP-FIN-03 — Accounting Kernel Period Reopen (maker-checker)", () => {
  let tenantId: string;
  let legalEntityId: string;
  let periodId: string;
  let makerUserId: string;
  let checkerUserId: string;
  let noPermUserId: string;
  let service: AccountingKernelService;
  let repo: PgAccountingKernelRepository;

  let roleSeq = 0;

  /** A tenant-scoped actor holding exactly the given permission codes. */
  async function actorWith(
    userId: string,
    permissions: string[],
  ): Promise<ActorContext> {
    const roleCode = `ROLE-${++roleSeq}-${userId.slice(0, 8)}`;
    const roleRes = await pool.query(
      `INSERT INTO roles (tenant_id, code, name) VALUES ($1, $2, $2) RETURNING id`,
      [tenantId, roleCode],
    );
    const roleId = roleRes.rows[0].id;
    if (permissions.length > 0) {
      await pool.query(
        `INSERT INTO role_permissions (role_id, permission_id)
         SELECT $1, p.id FROM permissions p WHERE p.code = ANY($2)`,
        [roleId, permissions],
      );
    }
    const assignRes = await pool.query(
      `INSERT INTO user_role_assignments (user_id, role_id, scope_type)
       VALUES ($1, $2, 'tenant') RETURNING id`,
      [userId, roleId],
    );
    return {
      userId,
      tenantId,
      sessionId: "00000000-0000-4000-8000-000000000001",
      assignmentId: assignRes.rows[0].id,
      roleId,
      roleCode,
      scopeType: "tenant",
      scopeLegalEntityId: null,
      scopeOrganizationUnitId: null,
      scopeCustomerId: null,
    };
  }

  beforeAll(async () => {
    const tenantResult = await pool.query(
      `INSERT INTO tenants (code, name) VALUES ($1, 'Period Reopen Test Tenant') RETURNING id`,
      [TS],
    );
    tenantId = tenantResult.rows[0].id;

    const leResult = await pool.query(
      `INSERT INTO legal_entities (tenant_id, name) VALUES ($1, 'LE Reopen') RETURNING id`,
      [tenantId],
    );
    legalEntityId = leResult.rows[0].id;

    const mkUser = async (email: string) => {
      const r = await pool.query(
        `INSERT INTO users (tenant_id, email, password_hash, full_name)
         VALUES ($1, $2, 'x', $3) RETURNING id`,
        [tenantId, email, email],
      );
      return r.rows[0].id as string;
    };
    makerUserId = await mkUser(`${TS}-maker@test.local`);
    checkerUserId = await mkUser(`${TS}-checker@test.local`);
    noPermUserId = await mkUser(`${TS}-noperm@test.local`);

    repo = new PgAccountingKernelRepository(pool);
    service = new AccountingKernelService(
      repo,
      // ConfigurationService is unused by the period paths under test; the
      // reopen flow never reads configuration.
      {} as never,
      new AuditService(new PgAuditLogRepository(pool)),
      new RbacService(
        new PgRbacRepository(pool),
        new PgOrganizationUnitRepository(pool),
        new PgLegalEntityRepository(pool),
      ),
      new EventBus(new PgDomainEventRepository(pool), () => {}),
    );

    const period = await repo.createPeriod({
      tenantId,
      legalEntityId,
      fiscalYearCode: "FY2026",
      periodCode: `REOPEN-${Date.now()}`,
      periodName: "Reopen Test Period",
      periodType: "monthly",
      dateFrom: "2026-03-01",
      dateTo: "2026-03-31",
      createdBy: null,
    });
    periodId = period.id;
  });

  afterAll(async () => {
    await pool.query(`DELETE FROM tenants WHERE id = $1`, [tenantId]);
    await pool.end();
  });

  /** Bring the shared period to a known `closed` state between tests. */
  async function setClosed() {
    await pool.query(
      `UPDATE accounting_periods
         SET status = 'closed',
             reopen_requested_date = NULL, reopen_requested_by = NULL,
             reopen_reason = NULL, reopen_impact_evidence = NULL,
             reopen_approved_by = NULL, reopen_approved_date = NULL,
             reopen_rejected_by = NULL, reopen_rejected_date = NULL,
             reopen_reject_reason = NULL
       WHERE id = $1`,
      [periodId],
    );
  }

  // =========================================================================
  // Happy path
  // =========================================================================

  it("close → request (reopenable) → approve by a different person → open", async () => {
    await setClosed();
    const maker = await actorWith(makerUserId, ["finance.accounting.period.lock"]);
    const checker = await actorWith(checkerUserId, ["finance.accounting.approve"]);

    const requested = await service.requestPeriodReopen(maker, periodId, {
      reason: "Correction needed for March",
      impactEvidence: "Rp 1.2M misposted to 1000 instead of 1000-01",
    });
    expect(requested.status).toBe("reopenable");
    expect(requested.reopenRequestedBy).toBe(makerUserId);
    expect(requested.reopenReason).toBe("Correction needed for March");
    expect(requested.reopenImpactEvidence).toContain("Rp 1.2M");

    const approved = await service.approvePeriodReopen(checker, periodId, {
      note: "Evidence reviewed",
    });
    expect(approved.status).toBe("open");
    expect(approved.reopenApprovedBy).toBe(checkerUserId);
    expect(approved.reopenApprovedDate).not.toBeNull();
  });

  // =========================================================================
  // Separation of duties
  // =========================================================================

  it("rejects approval by the requester themselves (maker-checker SoD)", async () => {
    await setClosed();
    // One super-admin-style actor holding BOTH permissions.
    const both = await actorWith(makerUserId, [
      "finance.accounting.period.lock",
      "finance.accounting.approve",
    ]);

    await service.requestPeriodReopen(both, periodId, {
      reason: "Self-approval attempt",
      impactEvidence: "Evidence",
    });

    await expect(service.approvePeriodReopen(both, periodId, {})).rejects.toBeInstanceOf(
      ConflictError,
    );
    await expect(service.approvePeriodReopen(both, periodId, {})).rejects.toThrow(
      /different person/i,
    );

    // The period stays reopenable — the attempt changed nothing.
    const row = await pool.query(`SELECT status FROM accounting_periods WHERE id = $1`, [periodId]);
    expect(row.rows[0].status).toBe("reopenable");
  });

  // =========================================================================
  // Mandatory fields
  // =========================================================================

  it("rejects an empty request reason", async () => {
    await setClosed();
    const maker = await actorWith(makerUserId, ["finance.accounting.period.lock"]);
    await expect(
      service.requestPeriodReopen(maker, periodId, { reason: "   ", impactEvidence: "Evidence" }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("rejects empty impact evidence", async () => {
    await setClosed();
    const maker = await actorWith(makerUserId, ["finance.accounting.period.lock"]);
    await expect(
      service.requestPeriodReopen(maker, periodId, { reason: "Reason", impactEvidence: "  " }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  // =========================================================================
  // Rejection path
  // =========================================================================

  it("reject returns the period to closed and records the rejecter", async () => {
    await setClosed();
    const maker = await actorWith(makerUserId, ["finance.accounting.period.lock"]);
    const checker = await actorWith(checkerUserId, ["finance.accounting.approve"]);

    await service.requestPeriodReopen(maker, periodId, {
      reason: "Attempt",
      impactEvidence: "Evidence",
    });

    const rejected = await service.rejectPeriodReopen(checker, periodId, {
      reason: "Insufficient evidence",
    });
    expect(rejected.status).toBe("closed");
    expect(rejected.reopenRejectedBy).toBe(checkerUserId);
    expect(rejected.reopenRejectReason).toBe("Insufficient evidence");
  });

  // =========================================================================
  // State guards
  // =========================================================================

  it("rejects a request when the period is not closed", async () => {
    // Route through draft: the guard_period_reopen trigger blocks any
    // non-draft → open transition, so reset first.
    await pool.query(
      `UPDATE accounting_periods SET status = 'draft',
         reopen_requested_by = NULL, reopen_approved_by = NULL, reopen_rejected_by = NULL
       WHERE id = $1`,
      [periodId],
    );
    await pool.query(`UPDATE accounting_periods SET status = 'open' WHERE id = $1`, [periodId]);
    const maker = await actorWith(makerUserId, ["finance.accounting.period.lock"]);
    await expect(
      service.requestPeriodReopen(maker, periodId, { reason: "R", impactEvidence: "E" }),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it("rejects a second request while one is already pending", async () => {
    await setClosed();
    const maker = await actorWith(makerUserId, ["finance.accounting.period.lock"]);
    await service.requestPeriodReopen(maker, periodId, { reason: "First", impactEvidence: "E" });
    await expect(
      service.requestPeriodReopen(maker, periodId, { reason: "Second", impactEvidence: "E" }),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it("rejects approve/reject when no request is pending", async () => {
    await setClosed();
    const checker = await actorWith(checkerUserId, ["finance.accounting.approve"]);
    await expect(service.approvePeriodReopen(checker, periodId, {})).rejects.toBeInstanceOf(
      ConflictError,
    );
    await expect(
      service.rejectPeriodReopen(checker, periodId, { reason: "n/a" }),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  // =========================================================================
  // Locking must not wipe a pending maker-checker request
  // =========================================================================

  it("refuses lockPeriod while a reopen request is pending", async () => {
    await setClosed();
    const maker = await actorWith(makerUserId, ["finance.accounting.period.lock"]);
    await service.requestPeriodReopen(maker, periodId, { reason: "R", impactEvidence: "E" });

    await expect(service.lockPeriod(maker, periodId, "Trying to bypass the checker")).rejects.toBeInstanceOf(
      ConflictError,
    );

    // The pending request and its evidence survive untouched.
    const row = await pool.query(
      `SELECT status, reopen_reason, reopen_impact_evidence FROM accounting_periods WHERE id = $1`,
      [periodId],
    );
    expect(row.rows[0].status).toBe("reopenable");
    expect(row.rows[0].reopen_reason).toBe("R");
    expect(row.rows[0].reopen_impact_evidence).toBe("E");
  });

  it("lockPeriod still works on a fresh open period", async () => {
    await pool.query(
      `UPDATE accounting_periods SET status = 'draft',
         reopen_requested_by = NULL, reopen_approved_by = NULL, reopen_rejected_by = NULL
       WHERE id = $1`,
      [periodId],
    );
    await pool.query(`UPDATE accounting_periods SET status = 'open' WHERE id = $1`, [periodId]);
    const maker = await actorWith(makerUserId, ["finance.accounting.period.lock"]);
    await service.lockPeriod(maker, periodId, "Normal close");
    const row = await pool.query(`SELECT status FROM accounting_periods WHERE id = $1`, [periodId]);
    expect(row.rows[0].status).toBe("closed");
  });

  // =========================================================================
  // Permission enforcement
  // =========================================================================

  it("requires finance.accounting.period.lock to request a reopen", async () => {
    await setClosed();
    const nobody = await actorWith(noPermUserId, []);
    await expect(
      service.requestPeriodReopen(nobody, periodId, { reason: "R", impactEvidence: "E" }),
    ).rejects.toThrow(/permission/i);
  });

  it("requires finance.accounting.approve to approve a reopen", async () => {
    await setClosed();
    const maker = await actorWith(makerUserId, ["finance.accounting.period.lock"]);
    const nobody = await actorWith(noPermUserId, []);
    await service.requestPeriodReopen(maker, periodId, { reason: "R", impactEvidence: "E" });
    await expect(service.approvePeriodReopen(nobody, periodId, {})).rejects.toThrow(/permission/i);
  });

  // =========================================================================
  // Fail-closed: a reopenable period refuses postings
  // =========================================================================

  it("DB trigger refuses a GL insert while the period is reopenable", async () => {
    await setClosed();
    const maker = await actorWith(makerUserId, ["finance.accounting.period.lock"]);
    await service.requestPeriodReopen(maker, periodId, { reason: "R", impactEvidence: "E" });

    await expect(
      pool.query(
        `INSERT INTO general_ledger_entries (tenant_id, account_id, period_id, journal_line_id, debit, credit, posting_date)
         VALUES ($1, '00000000-0000-4000-8000-000000000098', $2, '00000000-0000-4000-8000-000000000099', '1.00', '0.00', now())`,
        [tenantId, periodId],
      ),
    ).rejects.toThrow(/non-open accounting period/i);
  });

  // =========================================================================
  // DB guard: no raw UPDATE can bypass the maker-checker flow
  // =========================================================================

  it("DB guard refuses a raw UPDATE from closed straight to open", async () => {
    await setClosed();
    await expect(
      pool.query(`UPDATE accounting_periods SET status = 'open' WHERE id = $1`, [periodId]),
    ).rejects.toThrow(/maker-checker approval/i);
  });

  it("DB guard refuses a raw UPDATE from reopenable to open without an approval", async () => {
    await setClosed();
    const maker = await actorWith(makerUserId, ["finance.accounting.period.lock"]);
    await service.requestPeriodReopen(maker, periodId, { reason: "R", impactEvidence: "E" });

    await expect(
      pool.query(`UPDATE accounting_periods SET status = 'open' WHERE id = $1`, [periodId]),
    ).rejects.toThrow(/maker-checker approval/i);
  });

  // =========================================================================
  // Append-only audit trail
  // =========================================================================

  it("records reopen_requested / reopen_approved audit rows with metadata", async () => {
    await setClosed();
    const maker = await actorWith(makerUserId, ["finance.accounting.period.lock"]);
    const checker = await actorWith(checkerUserId, ["finance.accounting.approve"]);

    const before = await pool.query(
      `SELECT count(*)::int AS n FROM audit_log
        WHERE tenant_id = $1 AND entity_id = $2
          AND action LIKE 'accounting.period.reopen%'`,
      [tenantId, periodId],
    );

    await service.requestPeriodReopen(maker, periodId, {
      reason: "Audit trail check",
      impactEvidence: "Evidence for audit",
    });
    await service.approvePeriodReopen(checker, periodId, { note: "ok" });

    const rows = await pool.query(
      `SELECT action, actor_user_id, metadata FROM audit_log
        WHERE tenant_id = $1 AND entity_id = $2
          AND action LIKE 'accounting.period.reopen%'
        ORDER BY created_at`,
      [tenantId, periodId],
    );
    expect(rows.rowCount).toBe(before.rows[0].n + 2);

    const requested = rows.rows.findLast((r) => r.action === "accounting.period.reopen_requested");
    expect(requested).toBeDefined();
    expect(requested.actor_user_id).toBe(makerUserId);
    expect(requested.metadata.reason).toBe("Audit trail check");

    const approved = rows.rows.findLast((r) => r.action === "accounting.period.reopen_approved");
    expect(approved).toBeDefined();
    expect(approved.actor_user_id).toBe(checkerUserId);
    expect(approved.metadata.requestedBy).toBe(makerUserId);
  });
});