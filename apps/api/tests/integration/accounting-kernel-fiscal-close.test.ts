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
 * WP-FIN-A6-01 — Fiscal close + ledger governance (ADR-0015 §3, ADR-0016 §4).
 *
 * Contract under test:
 *   - month-end close: checklist blockers fail closed; successful close locks
 *     the period and records an append-only fiscal_closings row; a second
 *     close fails closed (idempotent by unique constraint).
 *   - year-end close: closing journal zeroes P&L accounts into Laba Ditahan
 *     (3200) with exact decimal arithmetic, then locks the period.
 *   - ledger governance: one active primary ledger per Legal Entity enforced
 *     in the service and by the partial unique index.
 *
 * Pattern: real DB pool, dedicated tenant, CASCADE cleanup.
 */

const TS = `ak-close-${Date.now()}`;

const CONFIRMED = {
  bankReconConfirmed: true,
  apArConfirmed: true,
  depreciationConfirmed: true,
  accrualsConfirmed: true,
};

describe("WP-FIN-A6-01 — Fiscal close + ledger governance", () => {
  let tenantId: string;
  let legalEntityId: string;
  let userId: string;
  let service: AccountingKernelService;
  let repo: PgAccountingKernelRepository;
  let roleSeq = 0;

  async function actorWith(permissions: string[]): Promise<ActorContext> {
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

  /** Fresh open period; returns its id. */
  async function makeOpenPeriod(code: string, fy: string, from: string, to: string): Promise<string> {
    const r = await pool.query(
      `INSERT INTO accounting_periods
         (tenant_id, legal_entity_id, fiscal_year_code, period_code, period_name,
          period_type, date_from, date_to, status)
       VALUES ($1, $2, $3, $4, $4, 'monthly', $5::date, $6::date, 'open')
       RETURNING id`,
      [tenantId, legalEntityId, fy, code, from, to],
    );
    return r.rows[0].id;
  }

  async function makeAccount(code: string, cls: string, normal: string): Promise<string> {
    const r = await pool.query(
      `INSERT INTO accounting_accounts
         (tenant_id, legal_entity_id, coa_id, account_code, account_name,
          account_class, normal_balance)
       SELECT $1, $2, c.id, $3, $3, $4, $5
         FROM chart_of_accounts c
        WHERE c.tenant_id = $1 AND c.legal_entity_id = $2
        LIMIT 1
       RETURNING id`,
      [tenantId, legalEntityId, code, cls, normal],
    );
    return r.rows[0].id;
  }

  async function postSimpleJournal(
    periodId: string,
    debitAccountId: string,
    creditAccountId: string,
    amount: string,
  ): Promise<void> {
    const actor = await actorWith(["finance.accounting.manage", "finance.accounting.approve"]);
    const journal = await service.createJournal(actor, {
      legalEntityId,
      journalNumber: `J-${++roleSeq}-${Date.now()}`,
      journalDate: "2026-12-31",
      accountingDate: "2026-12-31",
      periodId,
      description: null,
      currency: "IDR",
      lines: [
        { accountId: debitAccountId, lineNumber: 1, debit: amount, credit: "0.00", lineDescription: null, projectId: null, siteId: null },
        { accountId: creditAccountId, lineNumber: 2, debit: "0.00", credit: amount, lineDescription: null, projectId: null, siteId: null },
      ],
    });
    await service.postJournal(actor, journal.id);
  }

  beforeAll(async () => {
    const tenantResult = await pool.query(
      `INSERT INTO tenants (code, name) VALUES ($1, 'Fiscal Close Test Tenant') RETURNING id`,
      [TS],
    );
    tenantId = tenantResult.rows[0].id;

    const leResult = await pool.query(
      `INSERT INTO legal_entities (tenant_id, name) VALUES ($1, 'LE Close') RETURNING id`,
      [tenantId],
    );
    legalEntityId = leResult.rows[0].id;

    const userResult = await pool.query(
      `INSERT INTO users (tenant_id, email, password_hash, full_name)
       VALUES ($1, $2, 'x', 'Close Tester') RETURNING id`,
      [tenantId, `${TS}@test.local`],
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

    // A chart of accounts so account inserts have a coa_id to point at.
    await pool.query(
      `INSERT INTO chart_of_accounts
         (tenant_id, legal_entity_id, coa_version_code, coa_version_date, coa_status)
       VALUES ($1, $2, 'TEST-V1', '2026-01-01', 'approved')`,
      [tenantId, legalEntityId],
    );
    // Retained earnings 3200 (Laba Ditahan) — required by year-end close.
    await makeAccount("3200", "EQUITY", "credit");
  });

  afterAll(async () => {
    await pool.query(`DELETE FROM tenants WHERE id = $1`, [tenantId]);
  });

  it("month-end close refuses when a runbook attestation is missing", async () => {
    const actor = await actorWith(["finance.accounting.period.lock"]);
    const periodId = await makeOpenPeriod("M01", "2026", "2026-01-01", "2026-01-31");
    await expect(
      service.closeMonthEnd(actor, periodId, {
        ...CONFIRMED,
        bankReconConfirmed: false,
      }),
    ).rejects.toThrow(ValidationError);
  });

  it("month-end close refuses while unposted journals remain (fail closed)", async () => {
    const actor = await actorWith(["finance.accounting.period.lock", "finance.accounting.manage"]);
    const periodId = await makeOpenPeriod("M02", "2026", "2026-02-01", "2026-02-28");
    const debit = await makeAccount("1110", "ASSET", "debit");
    const credit = await makeAccount("4100", "INCOME", "credit");
    // Create but do NOT post — the close must see it as a blocker.
    await service.createJournal(actor, {
      legalEntityId,
      journalNumber: `J-M02-pending`,
      journalDate: "2026-02-28",
      accountingDate: "2026-02-28",
      periodId,
      description: null,
      currency: "IDR",
      lines: [
        { accountId: debit, lineNumber: 1, debit: "100.00", credit: "0.00", lineDescription: null, projectId: null, siteId: null },
        { accountId: credit, lineNumber: 2, debit: "0.00", credit: "100.00", lineDescription: null, projectId: null, siteId: null },
      ],
    });
    await expect(service.closeMonthEnd(actor, periodId, CONFIRMED)).rejects.toThrow(
      ConflictError,
    );
  });

  it("month-end close locks the period and records an append-only closing row", async () => {
    const actor = await actorWith(["finance.accounting.period.lock"]);
    const periodId = await makeOpenPeriod("M03", "2026", "2026-03-01", "2026-03-31");
    const closing = await service.closeMonthEnd(actor, periodId, CONFIRMED);

    expect(closing.closeKind).toBe("month_end");
    expect(closing.periodId).toBe(periodId);
    expect(closing.checklist.unpostedJournals).toBe(0);
    expect(closing.incomeTotal).toBeNull(); // month_end carries no P&L totals

    const period = await repo.findPeriodById(periodId);
    expect(period?.status).toBe("closed");
  });

  it("a second month-end close of the same period fails closed", async () => {
    const actor = await actorWith(["finance.accounting.period.lock"]);
    const periodId = await makeOpenPeriod("M04", "2026", "2026-04-01", "2026-04-30");
    await service.closeMonthEnd(actor, periodId, CONFIRMED);
    await expect(service.closeMonthEnd(actor, periodId, CONFIRMED)).rejects.toThrow(
      ConflictError,
    );
  });

  it("year-end close zeroes P&L into Laba Ditahan and locks the period", async () => {
    const actor = await actorWith([
      "finance.accounting.period.lock",
      "finance.accounting.approve",
      "finance.accounting.manage",
    ]);
    const periodId = await makeOpenPeriod("Y12", "2026", "2026-12-01", "2026-12-31");
    const cash = await makeAccount("1110-Y", "ASSET", "debit");
    const income = await makeAccount("4100-Y", "INCOME", "credit");
    const expense = await makeAccount("5100-Y", "EXPENSE", "debit");

    // Income 1000.00 (credit-normal), expense 300.00 (debit-normal)
    await postSimpleJournal(periodId, cash, income, "1000.00");
    await postSimpleJournal(periodId, expense, cash, "300.00");

    const closing = await service.closeYearEnd(actor, periodId, CONFIRMED);

    expect(closing.closeKind).toBe("year_end");
    expect(closing.incomeTotal).toBe("1000.00");
    expect(closing.expenseTotal).toBe("300.00");
    expect(closing.retainedEarningsDelta).toBe("700.00");
    expect(closing.closingJournalId).not.toBeNull();

    // Closing journal is posted and balanced; RE line credits Laba Ditahan 700.
    const lines = await repo.listJournalLines(closing.closingJournalId!);
    const reLine = lines.find((l) => l.credit === "700.00" || l.debit === "700.00");
    expect(reLine).toBeDefined();
    expect(reLine!.credit).toBe("700.00");

    const journal = await repo.findJournalById(closing.closingJournalId!);
    expect(journal?.status).toBe("posted");
    expect(journal?.isBalanced).toBe(true);

    const period = await repo.findPeriodById(periodId);
    expect(period?.status).toBe("closed");
  });

  it("year-end close records a loss as a debit to Laba Ditahan", async () => {
    const actor = await actorWith([
      "finance.accounting.period.lock",
      "finance.accounting.approve",
      "finance.accounting.manage",
    ]);
    const periodId = await makeOpenPeriod("Y13", "2027", "2027-12-01", "2027-12-31");
    const cash = await makeAccount("1110-Z", "ASSET", "debit");
    const expense = await makeAccount("5100-Z", "EXPENSE", "debit");

    await postSimpleJournal(periodId, expense, cash, "500.00");

    const closing = await service.closeYearEnd(actor, periodId, CONFIRMED);
    expect(closing.retainedEarningsDelta).toBe("-500.00");

    const lines = await repo.listJournalLines(closing.closingJournalId!);
    const reLine = lines.find((l) => l.debit === "500.00");
    expect(reLine).toBeDefined();
    expect(reLine!.credit).toBe("0.00");
  });

  it("ledger governance: second active primary ledger for the same LE is refused", async () => {
    const actor = await actorWith(["finance.accounting.configure", "finance.accounting.read"]);
    const first = await service.createLedger(actor, {
      legalEntityId,
      ledgerCode: "PRIMARY",
      ledgerName: "Ledger Utama",
      currency: "IDR",
    });
    expect(first.isPrimary).toBe(true);
    expect(first.ledgerRole).toBe("primary");

    await expect(
      service.createLedger(actor, {
        legalEntityId,
        ledgerCode: "PRIMARY-2",
        ledgerName: "Duplikat",
        currency: "IDR",
      }),
    ).rejects.toThrow(ConflictError);

    const ledgers = await service.listLedgers(actor, legalEntityId);
    expect(ledgers).toHaveLength(1);
  });

  it("ledger currency must be a 3-letter ISO code", async () => {
    const otherLe = await pool.query(
      `INSERT INTO legal_entities (tenant_id, name) VALUES ($1, 'LE Close 2') RETURNING id`,
      [tenantId],
    );
    const actor = await actorWith(["finance.accounting.configure"]);
    await expect(
      service.createLedger(actor, {
        legalEntityId: otherLe.rows[0].id,
        ledgerCode: "PRIMARY",
        ledgerName: "Ledger",
        currency: "rupiah",
      }),
    ).rejects.toThrow(ValidationError);
  });
});
