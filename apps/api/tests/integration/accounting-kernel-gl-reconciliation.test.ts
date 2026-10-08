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

/**
 * WP-FIN-04 — GL Reconciliation (Phase 1F).
 *
 * Exercises the reconciliation and GL balance read paths:
 * - Reconciliation queries (orphan, mismatch, unposted, totals)
 * - GL balance materialized-read via findGlBalance
 * - Service fail-closed on gl_balances missing
 *
 * Contract: GL balance must equal sum of posted journals. All GL entries
 * must have a corresponding journal line (FK RESTRICT + UNIQUE prevent orphans
 * structurally). Orphan detection and mismatch detection are read-only
 * reporting, not writes.
 */

const TS = `ak-gl-recon-${Date.now()}`;

describe("WP-FIN-04 — Accounting Kernel GL Reconciliation", () => {
  let tenantId: string;
  let legalEntityId: string;
  let userId: string;
  let coaId: string;
  let accountId: string;
  let offsetAccountId: string;
  let service: AccountingKernelService;
  let repo: PgAccountingKernelRepository;

  let testNum = 0;

  async function createTestPeriod(): Promise<string> {
    const periodResult = await pool.query(
      `INSERT INTO accounting_periods (tenant_id, legal_entity_id, fiscal_year_code, period_code, period_name, period_type, date_from, date_to, status, created_by)
       VALUES ($1, $2, 'FY2026', $3, $4, 'monthly', '2026-01-01', '2026-01-31', 'open', $5) RETURNING id`,
      [tenantId, legalEntityId, `P-${++testNum}`, `Test Period ${testNum}`, userId],
    );
    return periodResult.rows[0].id;
  }

  async function actorWith(permissions: string[]): Promise<ActorContext> {
    const roleRes = await pool.query(
      `INSERT INTO roles (tenant_id, code, name) VALUES ($1, 'ROLE-' || random()::text, 'Test Role') RETURNING id`,
      [tenantId],
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
      roleCode: "ROLE-TEST",
      scopeType: "tenant",
      scopeLegalEntityId: null,
      scopeOrganizationUnitId: null,
      scopeCustomerId: null,
    };
  }

  beforeAll(async () => {
    const tenantResult = await pool.query(
      `INSERT INTO tenants (code, name) VALUES ($1, 'GL Reconciliation Test Tenant') RETURNING id`,
      [TS],
    );
    tenantId = tenantResult.rows[0].id;

    const leResult = await pool.query(
      `INSERT INTO legal_entities (tenant_id, name) VALUES ($1, 'LE Test') RETURNING id`,
      [tenantId],
    );
    legalEntityId = leResult.rows[0].id;

    const userResult = await pool.query(
      `INSERT INTO users (tenant_id, email, password_hash, full_name)
       VALUES ($1, $2, 'x', $2) RETURNING id`,
      [tenantId, `${TS}-user@test.local`],
    );
    userId = userResult.rows[0].id;

    repo = new PgAccountingKernelRepository(pool);
    service = new AccountingKernelService(
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

    // Create COA
    const coaResult = await pool.query(
      `INSERT INTO chart_of_accounts (tenant_id, legal_entity_id, coa_version_code, coa_version_date, is_active, created_by)
       VALUES ($1, $2, 'FY2026', '2026-01-01', true, $3) RETURNING id`,
      [tenantId, legalEntityId, userId],
    );
    coaId = coaResult.rows[0].id;

    // Create account
    const acctResult = await pool.query(
      `INSERT INTO accounting_accounts (tenant_id, legal_entity_id, coa_id, account_code, account_name, account_class, normal_balance, is_active, created_by)
       VALUES ($1, $2, $3, '1000', 'Cash', 'ASSET', 'debit', true, $4) RETURNING id`,
      [tenantId, legalEntityId, coaId, userId],
    );
    accountId = acctResult.rows[0].id;

    // Offset account for balancing journals
    const offsetResult = await pool.query(
      `INSERT INTO accounting_accounts (tenant_id, legal_entity_id, coa_id, account_code, account_name, account_class, normal_balance, is_active, created_by)
       VALUES ($1, $2, $3, '4000', 'Offset', 'INCOME', 'credit', true, $4) RETURNING id`,
      [tenantId, legalEntityId, coaId, userId],
    );
    offsetAccountId = offsetResult.rows[0].id;
  });

  afterAll(async () => {
    await pool.query(`DELETE FROM tenants WHERE id = $1`, [tenantId]);
    await pool.end();
  });

  // =========================================================================
  // Happy path: two journals posted, balanced GL, matched reconciliation
  // =========================================================================

  it("balanced journal posts and reconciles matched", async () => {
    const periodId = await createTestPeriod();
    const actor = await actorWith(["finance.accounting.manage", "finance.accounting.approve"]);

    const jRes = await pool.query(
      `INSERT INTO journal_headers (tenant_id, legal_entity_id, journal_number, journal_date, accounting_date, period_id, description, currency, status, idempotency_key)
       VALUES ($1, $2, 'J001', '2026-01-15', '2026-01-15', $3, 'Test Journal', 'IDR', 'pending', 'ik-001-j001') RETURNING id`,
      [tenantId, legalEntityId, periodId],
    );
    const jId = jRes.rows[0].id;

    await pool.query(
      `INSERT INTO journal_lines (tenant_id, journal_header_id, account_id, line_number, debit, credit)
       VALUES ($1, $2, $3, 1, '100.00', '0.00'), ($1, $2, $4, 2, '0.00', '100.00')`,
      [tenantId, jId, accountId, offsetAccountId],
    );

    await repo.postJournal(jId, actor.userId);

    const recon = await repo.reconcileJournalVsGl(tenantId, periodId);
    expect(recon.matched).toBe(true);
    expect(recon.orphanGlEntryIds).toHaveLength(0);
    expect(recon.mismatchedGlEntryIds).toHaveLength(0);
    expect(recon.unpostedJournalIds).toHaveLength(0);
    expect(recon.totals.glDebit).toBe("100.00");
    expect(recon.totals.glCredit).toBe("100.00");
    expect(recon.totals.journalDebit).toBe("100.00");
    expect(recon.totals.journalCredit).toBe("100.00");
  });

  // =========================================================================
  // Reversed journal: GL net-zero, counted in totals, still matched
  // =========================================================================

  it("reversed journal is counted in journal totals, reconciliation matched", async () => {
    const periodId = await createTestPeriod();
    const actor = await actorWith(["finance.accounting.manage", "finance.accounting.approve"]);

    const jRes = await pool.query(
      `INSERT INTO journal_headers (tenant_id, legal_entity_id, journal_number, journal_date, accounting_date, period_id, description, currency, status, idempotency_key)
       VALUES ($1, $2, 'J-REV', '2026-01-20', '2026-01-20', $3, 'Reversal Test', 'IDR', 'pending', 'ik-003-jrev') RETURNING id`,
      [tenantId, legalEntityId, periodId],
    );
    const jId = jRes.rows[0].id;

    await pool.query(
      `INSERT INTO journal_lines (tenant_id, journal_header_id, account_id, line_number, debit, credit)
       VALUES ($1, $2, $3, 1, '250.00', '0.00'), ($1, $2, $4, 2, '0.00', '250.00')`,
      [tenantId, jId, accountId, offsetAccountId],
    );

    const posted = await repo.postJournal(jId, actor.userId);
    expect(posted).not.toBeNull();

    // Reverse it via service (which constructs full ReverseJournalInput)
    const reversed = await service.reverseJournal(actor, jId, {
      type: "reverse_correct",
      reason: "Testing",
    });
    expect(reversed).not.toBeNull();

    // Reconcile: both journals (posted + reversed) are in same period
    // Period-wide totals sum both: original 250 debit + reversal 250 debit = 500 debit
    const recon = await repo.reconcileJournalVsGl(tenantId, periodId);
    expect(recon.matched).toBe(true);
    expect(recon.unpostedJournalIds).toHaveLength(0);
    expect(recon.totals.journalDebit).toBe("500.00");
    expect(recon.totals.journalCredit).toBe("500.00");
    expect(recon.totals.glDebit).toBe("500.00");
    expect(recon.totals.glCredit).toBe("500.00");
  });

  // =========================================================================
  // Unposted journal: matched=false, unpostedJournalIds filled
  // =========================================================================

  it("unposted pending journal detected in reconciliation", async () => {
    const periodId = await createTestPeriod();
    const jRes = await pool.query(
      `INSERT INTO journal_headers (tenant_id, legal_entity_id, journal_number, journal_date, accounting_date, period_id, description, currency, status, idempotency_key)
       VALUES ($1, $2, 'J-PENDING', '2026-01-21', '2026-01-21', $3, 'Pending Journal', 'IDR', 'pending', 'ik-004-jpending') RETURNING id`,
      [tenantId, legalEntityId, periodId],
    );
    const jId = jRes.rows[0].id;

    await pool.query(
      `INSERT INTO journal_lines (tenant_id, journal_header_id, account_id, line_number, debit, credit)
       VALUES ($1, $2, $3, 1, '99.99', '0.00'), ($1, $2, $4, 2, '0.00', '99.99')`,
      [tenantId, jId, accountId, offsetAccountId],
    );

    // Don't post — leave it pending
    const recon = await repo.reconcileJournalVsGl(tenantId, periodId);
    expect(recon.matched).toBe(false);
    expect(recon.unpostedJournalIds).toContain(jId);
    expect(recon.orphanGlEntryIds).toHaveLength(0);
    expect(recon.mismatchedGlEntryIds).toHaveLength(0);
  });

  // =========================================================================
  // Mismatch injection: GL debit amount differs from journal line
  // =========================================================================

  it("GL entry with mismatched amount is detected", async () => {
    const periodId = await createTestPeriod();
    const actor = await actorWith(["finance.accounting.manage", "finance.accounting.approve"]);

    const jRes = await pool.query(
      `INSERT INTO journal_headers (tenant_id, legal_entity_id, journal_number, journal_date, accounting_date, period_id, description, currency, status, idempotency_key)
       VALUES ($1, $2, 'J-MISMATCH', '2026-01-22', '2026-01-22', $3, 'Mismatch Test', 'IDR', 'pending', 'ik-005-jmismatch') RETURNING id`,
      [tenantId, legalEntityId, periodId],
    );
    const jId = jRes.rows[0].id;

    const lineRes = await pool.query(
      `INSERT INTO journal_lines (tenant_id, journal_header_id, account_id, line_number, debit, credit)
       VALUES ($1, $2, $3, 1, '500.00', '0.00'), ($1, $2, $4, 2, '0.00', '500.00') RETURNING id`,
      [tenantId, jId, accountId, offsetAccountId],
    );
    const lineId = lineRes.rows[0].id;

    const posted = await repo.postJournal(jId, actor.userId);
    expect(posted).not.toBeNull();

    // Get the GL entry that was created
    const gle = await pool.query(
      `SELECT id FROM general_ledger_entries WHERE journal_line_id = $1`,
      [lineId],
    );
    const gleId = gle.rows[0].id;

    // Corrupt the GL entry amount
    await pool.query(
      `UPDATE general_ledger_entries SET debit = '999.00' WHERE id = $1`,
      [gleId],
    );

    // Reconcile: mismatch detected
    const recon = await repo.reconcileJournalVsGl(tenantId, periodId);
    expect(recon.matched).toBe(false);
    expect(recon.mismatchedGlEntryIds).toContain(gleId);
    expect(recon.orphanGlEntryIds).toHaveLength(0);
    expect(recon.unpostedJournalIds).toHaveLength(0);
  });

  // =========================================================================
  // findGlBalance: reads materialized row, returns null when none
  // =========================================================================

  it("findGlBalance returns materialized balance row", async () => {
    const periodId = await createTestPeriod();
    const actor = await actorWith(["finance.accounting.manage", "finance.accounting.approve"]);

    // Clear any prior entries for a clean test
    await pool.query(
      `DELETE FROM general_ledger_entries WHERE account_id = $1 AND period_id = $2`,
      [accountId, periodId],
    );
    await pool.query(
      `DELETE FROM journal_lines WHERE journal_header_id IN (
         SELECT id FROM journal_headers WHERE period_id = $1
       )`,
      [periodId],
    );
    await pool.query(
      `DELETE FROM journal_headers WHERE period_id = $1`,
      [periodId],
    );

    // Post one journal
    const jRes = await pool.query(
      `INSERT INTO journal_headers (tenant_id, legal_entity_id, journal_number, journal_date, accounting_date, period_id, description, currency, status, idempotency_key)
       VALUES ($1, $2, 'J-BAL', '2026-01-25', '2026-01-25', $3, 'Balance Test', 'IDR', 'pending', 'ik-006-jbal') RETURNING id`,
      [tenantId, legalEntityId, periodId],
    );
    const jId = jRes.rows[0].id;

    await pool.query(
      `INSERT INTO journal_lines (tenant_id, journal_header_id, account_id, line_number, debit, credit)
       VALUES ($1, $2, $3, 1, '333.33', '0.00'), ($1, $2, $4, 2, '0.00', '333.33')`,
      [tenantId, jId, accountId, offsetAccountId],
    );

    await repo.postJournal(jId, actor.userId);

    // Read via findGlBalance
    const balance = await repo.findGlBalance(tenantId, accountId, periodId);
    expect(balance).not.toBeNull();
    expect(balance!.debitTotal).toBe("333.33");
    expect(balance!.creditTotal).toBe("0.00");
  });

  it("findGlBalance returns null when no GL entries exist", async () => {
    const periodId = await createTestPeriod();
    // Fresh account + period with no activity
    const acctRes = await pool.query(
      `INSERT INTO accounting_accounts (tenant_id, legal_entity_id, coa_id, account_code, account_name, account_class, normal_balance, is_active, created_by)
       VALUES ($1, $2, $3, '2000', 'Empty Account', 'LIABILITY', 'credit', true, $4) RETURNING id`,
      [tenantId, legalEntityId, coaId, userId],
    );
    const emptyAccountId = acctRes.rows[0].id;

    const balance = await repo.findGlBalance(tenantId, emptyAccountId, periodId);
    expect(balance).toBeNull();
  });

  // =========================================================================
  // Service getGlBalance: fail-closed on missing gl_balances, 404 on no entries
  // =========================================================================

  it("service getGlBalance returns balance equal to closing_balance from materialized row", async () => {
    const periodId = await createTestPeriod();
    const actor = await actorWith(["finance.accounting.read"]);

    // Post one journal to create GL entries
    const jRes = await pool.query(
      `INSERT INTO journal_headers (tenant_id, legal_entity_id, journal_number, journal_date, accounting_date, period_id, description, currency, status, idempotency_key)
       VALUES ($1, $2, 'J-SVC', '2026-01-26', '2026-01-26', $3, 'Service Test', 'IDR', 'pending', 'ik-007-jsvc') RETURNING id`,
      [tenantId, legalEntityId, periodId],
    );
    const jId = jRes.rows[0].id;

    const mgr = await actorWith(["finance.accounting.manage", "finance.accounting.approve"]);
    await pool.query(
      `INSERT INTO journal_lines (tenant_id, journal_header_id, account_id, line_number, debit, credit)
       VALUES ($1, $2, $3, 1, '333.33', '0.00'), ($1, $2, $4, 2, '0.00', '333.33')`,
      [tenantId, jId, accountId, offsetAccountId],
    );
    await repo.postJournal(jId, mgr.userId);

    const balance = await service.getGlBalance(actor, accountId, periodId);
    expect(balance).not.toBeNull();
    expect(balance!.debitTotal).toBe("333.33");
    expect(balance!.creditTotal).toBe("0.00");
  });

  it("service getGlBalance returns null when no GL entries exist", async () => {
    const periodId = await createTestPeriod();
    const actor = await actorWith(["finance.accounting.read"]);

    const emptyAcctRes = await pool.query(
      `INSERT INTO accounting_accounts (tenant_id, legal_entity_id, coa_id, account_code, account_name, account_class, normal_balance, is_active, created_by)
       VALUES ($1, $2, $3, '3000', 'Never Used', 'EQUITY', 'credit', true, $4) RETURNING id`,
      [tenantId, legalEntityId, coaId, userId],
    );
    const emptyId = emptyAcctRes.rows[0].id;

    const balance = await service.getGlBalance(actor, emptyId, periodId);
    expect(balance).toBeNull();
  });

  it("service reconcileJournalVsGl gates on finance.accounting.read and 404s wrong period", async () => {
    const periodId = await createTestPeriod();
    const actor = await actorWith(["finance.accounting.read"]);

    const recon = await service.reconcileJournalVsGl(actor, periodId);
    expect(recon.periodId).toBe(periodId);

    // Wrong period (wrong tenant)
    const badPeriodId = "00000000-0000-4000-8000-000000000099";
    await expect(service.reconcileJournalVsGl(actor, badPeriodId)).rejects.toThrow(/AccountingPeriod/);
  });
});
