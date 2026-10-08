import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { pool } from "../../src/infrastructure/persistence/db.js";
import { PgAccountingKernelRepository } from "../../src/modules/accounting/kernel/infrastructure/accounting-kernel.repository.pg.js";
import { toCents } from "../../src/modules/accounting/kernel/domain/accounting-kernel.entity.js";

/**
 * WP-FIN-02 — Journal Reversal integration tests.
 *
 * Repository-level tests exercising the atomic reversal transaction:
 *   - reverse_correct: GL net zero, debit/credit swapped, two-way link
 *   - reverse_accrual: routed to next open period
 *   - one-time-reversal invariant (double reversal → null)
 *   - pending journal rejection
 *   - tenant isolation
 *   - money precision
 *
 * Pattern: real DB pool, dedicated tenant via direct insert, CASCADE cleanup.
 */

const TS = `akrev-${Date.now()}`;

describe("WP-FIN-02 — Journal Reversal (reverseJournal)", () => {
  let tenantId: string;
  let legalEntityId: string;
  let coaId: string;
  let userId: string;
  let repo: PgAccountingKernelRepository;

  beforeAll(async () => {
    const tenantResult = await pool.query(
      `INSERT INTO tenants (code, name) VALUES ($1, 'Phase 1D Reversal Tenant') RETURNING id`,
      [TS],
    );
    tenantId = tenantResult.rows[0].id;

    const leResult = await pool.query(
      `INSERT INTO legal_entities (tenant_id, name) VALUES ($1, 'LE Reversal') RETURNING id`,
      [tenantId],
    );
    legalEntityId = leResult.rows[0].id;

    const coaResult = await pool.query(
      `INSERT INTO chart_of_accounts (tenant_id, legal_entity_id, coa_version_code, coa_version_date)
       VALUES ($1, $2, 'COA-REV', '2026-01-01') RETURNING id`,
      [tenantId, legalEntityId],
    );
    coaId = coaResult.rows[0].id;

    const userResult = await pool.query(
      `INSERT INTO users (tenant_id, email, password_hash, full_name)
       VALUES ($1, $2, 'x', 'Reversal Test User') RETURNING id`,
      [tenantId, `${TS}@test.local`],
    );
    userId = userResult.rows[0].id;

    repo = new PgAccountingKernelRepository(pool);
  });

  afterAll(async () => {
    await pool.query(`DELETE FROM tenants WHERE code = $1`, [TS]);
  });

  // Helper: create an open period for a given month in 2026
  async function createOpenPeriod(code: string, month: string): Promise<string> {
    const p = await repo.createPeriod({
      tenantId,
      legalEntityId,
      fiscalYearCode: "FY2026",
      periodCode: code,
      periodName: `Period ${code}`,
      periodType: "monthly",
      dateFrom: `2026-${month}-01`,
      dateTo: `2026-${month}-28`,
      createdBy: userId,
    });
    await repo.setPeriodStatus(p.id, "open", userId);
    return p.id;
  }

  async function createClosedPeriod(code: string, month: string): Promise<string> {
    const p = await repo.createPeriod({
      tenantId,
      legalEntityId,
      fiscalYearCode: "FY2026",
      periodCode: code,
      periodName: `Period ${code}`,
      periodType: "monthly",
      dateFrom: `2026-${month}-01`,
      dateTo: `2026-${month}-28`,
      createdBy: userId,
    });
    await repo.setPeriodStatus(p.id, "closed", userId);
    return p.id;
  }

  async function createAccount(code: string, name: string, cls: string, normal: string): Promise<string> {
    const a = await repo.createAccount({
      tenantId,
      legalEntityId,
      coaId,
      accountCode: code,
      accountName: name,
      accountClass: cls as any,
      normalBalance: normal as any,
      accountType: null,
      parentAccountId: null,
      createdBy: userId,
    });
    return a.id;
  }

  // =========================================================================
  // 1. reverse_correct: GL net zero, debit/credit swapped, two-way link
  // =========================================================================
  it("reverse_correct: GL net zero, debit/credit swapped, two-way link", async () => {
    const periodId = await createOpenPeriod("REV-01", "01");
    const assetId = await createAccount("R1000", "Cash", "ASSET", "debit");
    const revenueId = await createAccount("R4000", "Revenue", "INCOME", "credit");

    const original = await repo.createJournal({
      tenantId,
      legalEntityId,
      journalNumber: `REV-001-${Date.now()}`,
      journalDate: "2026-01-15",
      accountingDate: "2026-01-15",
      periodId,
      description: "Sales transaction",
      currency: "IDR",
      postingRuleVersionId: null,
      idempotencyKey: `idem-rev1-${Date.now()}`,
      lines: [
        { accountId: assetId, lineNumber: 1, debit: "100.00", credit: "0.00", lineDescription: "Cash in", projectId: null, siteId: null },
        { accountId: revenueId, lineNumber: 2, debit: "0.00", credit: "100.00", lineDescription: "Revenue", projectId: null, siteId: null },
      ],
      createdBy: userId,
    });

    const posted = await repo.postJournal(original.id, userId);
    expect(posted).not.toBeNull();
    expect(posted!.journal.status).toBe("posted");

    const result = await repo.reverseJournal({
      tenantId,
      legalEntityId,
      reversalOfId: original.id,
      journalDate: "2026-01-15",
      accountingDate: "2026-01-15",
      periodId,
      journalNumber: `${original.journalNumber}-REV`,
      idempotencyKey: `rev-idem1-${Date.now()}`,
      reversalReason: "Erroneous transaction",
      reversalType: "reverse_correct",
      reversedBy: userId,
    });

    expect(result).not.toBeNull();
    const { reversal } = result!;
    expect(reversal.status).toBe("posted");
    expect(reversal.reversalOfId).toBe(original.id);
    expect(reversal.reversalReason).toBe("Erroneous transaction");
    expect(reversal.reversalType).toBe("reverse_correct");
    expect(reversal.reversedBy).toBe(userId);

    // Original flipped to 'reversed'
    const updatedOriginal = await repo.findJournalById(original.id);
    expect(updatedOriginal?.status).toBe("reversed");

    // GL net zero for asset account
    const glEntries = await repo.listGlEntries(tenantId, { accountId: assetId, periodId });
    let debitsCents = 0n;
    let creditsCents = 0n;
    for (const e of glEntries) {
      debitsCents += toCents(e.debit) || 0n;
      creditsCents += toCents(e.credit) || 0n;
    }
    expect(debitsCents).toBe(creditsCents);

    // Line links + swapped debit/credit
    const origLines = await repo.listJournalLines(original.id);
    const revLines = await repo.listJournalLines(reversal.id);
    expect(revLines).toHaveLength(2);
    expect(revLines[0].reversalOfLineId).toBe(origLines[0].id);
    expect(revLines[1].reversalOfLineId).toBe(origLines[1].id);

    // Original line 1: Dr 100 → reversal line 1: Cr 100
    expect(revLines[0].debit).toBe("0.00");
    expect(revLines[0].credit).toBe("100.00");
    // Original line 2: Cr 100 → reversal line 2: Dr 100
    expect(revLines[1].debit).toBe("100.00");
    expect(revLines[1].credit).toBe("0.00");
  });

  // =========================================================================
  // 2. reverse_accrual: closed original period → routed to next open period
  // =========================================================================
  it("reverse_accrual: closed original period → routed to next open period", async () => {
    const openP = await createOpenPeriod("REV-02O", "10"); // October 2026 (today)

    const acctId = await createAccount("R1001", "Receivables", "ASSET", "debit");

    // Create original journal in OPEN period and post it normally
    const original = await repo.createJournal({
      tenantId,
      legalEntityId,
      journalNumber: `REV-002-${Date.now()}`,
      journalDate: "2026-02-15",
      accountingDate: "2026-02-15",
      periodId: openP, // Use open period for creation
      description: "Original accrual entry",
      currency: "IDR",
      postingRuleVersionId: null,
      idempotencyKey: `idem-rev2-${Date.now()}`,
      lines: [
        { accountId: acctId, lineNumber: 1, debit: "200.00", credit: "0.00", lineDescription: "Accrual", projectId: null, siteId: null },
        { accountId: acctId, lineNumber: 2, debit: "0.00", credit: "200.00", lineDescription: "Offset", projectId: null, siteId: null },
      ],
      createdBy: userId,
    });

    // Post the journal
    const posted = await repo.postJournal(original.id, userId);
    expect(posted?.journal.status).toBe("posted");

    // Now close the period where it was posted (simulating period closure after posting)
    await repo.setPeriodStatus(openP, "closed", userId);

    // Create a new open period for the accrual reversal
    const newOpenP = await createOpenPeriod("REV-02N", "11");

    // findNextOpenPeriod from a date inside REV-02N's range should return it
    // (REV-02O is closed; the running date must fall within the target period).
    const next = await repo.findNextOpenPeriod(tenantId, legalEntityId, "2026-11-08");
    expect(next).not.toBeNull();
    expect(next!.id).toBe(newOpenP);

    // Reverse into the new open period using reverse_accrual
    const result = await repo.reverseJournal({
      tenantId,
      legalEntityId,
      reversalOfId: original.id,
      journalDate: "2026-11-08",
      accountingDate: "2026-11-08",
      periodId: newOpenP,
      journalNumber: `REV-002-REV-${Date.now()}`,
      idempotencyKey: `rev-idem2-${Date.now()}`,
      reversalReason: "Accrual reversal of closed-period entry",
      reversalType: "reverse_accrual",
      reversedBy: userId,
    });

    expect(result).not.toBeNull();
    expect(result!.reversal.periodId).toBe(newOpenP);
    expect(result!.reversal.reversalType).toBe("reverse_accrual");
  });

  // =========================================================================
  // 3. No open period available → findNextOpenPeriod returns null
  // =========================================================================
  it("findNextOpenPeriod returns null when no open period exists on or after date", async () => {
    // Create a new legal entity to isolate from other tests' periods
    const isolatedLeRes = await pool.query(
      `INSERT INTO legal_entities (tenant_id, name) VALUES ($1, 'Isolated LE') RETURNING id`,
      [tenantId],
    );
    const isolatedLe = isolatedLeRes.rows[0].id;

    // Create only closed periods; no open period
    const coa2 = await pool.query(
      `INSERT INTO chart_of_accounts (tenant_id, legal_entity_id, coa_version_code, coa_version_date)
       VALUES ($1, $2, 'COA-ISO', '2026-01-01') RETURNING id`,
      [tenantId, isolatedLe],
    );

    const closedP = await repo.createPeriod({
      tenantId,
      legalEntityId: isolatedLe,
      fiscalYearCode: "FY2026",
      periodCode: "REV-03C",
      periodName: "Period REV-03C",
      periodType: "monthly",
      dateFrom: "2026-03-01",
      dateTo: "2026-03-28",
      createdBy: userId,
    });
    await repo.setPeriodStatus(closedP.id, "closed", userId);

    // Search for an open period on/after June 15 — should find none (closed period is March)
    const next = await repo.findNextOpenPeriod(tenantId, isolatedLe, "2026-06-15");
    expect(next).toBeNull();
  });

  // =========================================================================
  // 4. Double reversal → null (one-time-reversal invariant)
  // =========================================================================
  it("double reversal → returns null (one-time-reversal invariant)", async () => {
    const periodId = await createOpenPeriod("REV-04", "04");
    const acctId = await createAccount("R1002", "Payables", "LIABILITY", "credit");
    const counterId = await createAccount("R1005", "Counter", "ASSET", "debit");

    const original = await repo.createJournal({
      tenantId,
      legalEntityId,
      journalNumber: `REV-004-${Date.now()}`,
      journalDate: "2026-04-15",
      accountingDate: "2026-04-15",
      periodId,
      description: "Test",
      currency: "IDR",
      postingRuleVersionId: null,
      idempotencyKey: `idem-rev4-${Date.now()}`,
      lines: [
        { accountId: counterId, lineNumber: 1, debit: "75.00", credit: "0.00", lineDescription: null, projectId: null, siteId: null },
        { accountId: acctId, lineNumber: 2, debit: "0.00", credit: "75.00", lineDescription: null, projectId: null, siteId: null },
      ],
      createdBy: userId,
    });

    const posted = await repo.postJournal(original.id, userId);
    expect(posted?.journal.status).toBe("posted");

    const rev1 = await repo.reverseJournal({
      tenantId,
      legalEntityId,
      reversalOfId: original.id,
      journalDate: "2026-04-15",
      accountingDate: "2026-04-15",
      periodId,
      journalNumber: `${original.journalNumber}-R1`,
      idempotencyKey: `rev4-r1-${Date.now()}`,
      reversalReason: "First reversal",
      reversalType: "reverse_correct",
      reversedBy: userId,
    });
    expect(rev1).not.toBeNull();

    const rev2 = await repo.reverseJournal({
      tenantId,
      legalEntityId,
      reversalOfId: original.id,
      journalDate: "2026-04-15",
      accountingDate: "2026-04-15",
      periodId,
      journalNumber: `${original.journalNumber}-R2`,
      idempotencyKey: `rev4-r2-${Date.now()}`,
      reversalReason: "Second reversal",
      reversalType: "reverse_correct",
      reversedBy: userId,
    });
    expect(rev2).toBeNull();
  });

  // =========================================================================
  // 5. Reversal of pending journal → null
  // =========================================================================
  it("reversal of pending journal → returns null", async () => {
    const periodId = await createOpenPeriod("REV-05", "05");
    const acctId = await createAccount("R1003", "Equity", "EQUITY", "credit");

    const draft = await repo.createJournal({
      tenantId,
      legalEntityId,
      journalNumber: `REV-005-${Date.now()}`,
      journalDate: "2026-05-15",
      accountingDate: "2026-05-15",
      periodId,
      description: "Pending",
      currency: "IDR",
      postingRuleVersionId: null,
      idempotencyKey: `idem-rev5-${Date.now()}`,
      lines: [
        { accountId: acctId, lineNumber: 1, debit: "0.00", credit: "150.00", lineDescription: null, projectId: null, siteId: null },
      ],
      createdBy: userId,
    });

    expect(draft.status).toBe("pending");

    const result = await repo.reverseJournal({
      tenantId,
      legalEntityId,
      reversalOfId: draft.id,
      journalDate: "2026-05-15",
      accountingDate: "2026-05-15",
      periodId,
      journalNumber: `${draft.journalNumber}-REV`,
      idempotencyKey: `rev5-r-${Date.now()}`,
      reversalReason: "Cannot reverse pending",
      reversalType: "reverse_correct",
      reversedBy: userId,
    });
    expect(result).toBeNull();
  });

  // =========================================================================
  // 6. Tenant isolation: journal from another tenant → null
  // =========================================================================
  it("tenant isolation: reversing another tenant's journal returns null", async () => {
    // Create second tenant
    const otherTenantRes = await pool.query(
      `INSERT INTO tenants (code, name) VALUES ($1, 'Other Tenant') RETURNING id`,
      [`${TS}-other`],
    );
    const otherTenant = otherTenantRes.rows[0].id;
    const otherLeRes = await pool.query(
      `INSERT INTO legal_entities (tenant_id, name) VALUES ($1, 'Other LE') RETURNING id`,
      [otherTenant],
    );
    const otherLe = otherLeRes.rows[0].id;

    // An open period in OUR tenant
    const myPeriod = await createOpenPeriod("REV-06", "06");
    const myAcct = await createAccount("R1004", "Mine", "ASSET", "debit");

    // A posted journal in OTHER tenant
    const otherJournalRes = await pool.query(
      `INSERT INTO journal_headers (tenant_id, legal_entity_id, journal_number, journal_date, accounting_date,
                                     period_id, currency, idempotency_key, status, is_balanced, posted_date, posted_by, created_by, updated_by)
       VALUES ($1, $2, $3, '2026-06-15', '2026-06-15', $4, 'IDR', $5, 'posted', true, now(), $6, $6, $6)
       RETURNING id`,
      [otherTenant, otherLe, `OTHER-006-${Date.now()}`, myPeriod, `other-idem-${Date.now()}`, userId],
    );
    const otherJournalId = otherJournalRes.rows[0].id;

    // Attempt reversal from OUR tenant — repo should not find the journal under our tenant's lock
    const result = await repo.reverseJournal({
      tenantId, // our tenant
      legalEntityId,
      reversalOfId: otherJournalId,
      journalDate: "2026-06-15",
      accountingDate: "2026-06-15",
      periodId: myPeriod,
      journalNumber: `CROSS-REV-${Date.now()}`,
      idempotencyKey: `cross-rev-${Date.now()}`,
      reversalReason: "Cross-tenant attempt",
      reversalType: "reverse_correct",
      reversedBy: userId,
    });
    expect(result).toBeNull();

    // Cleanup other tenant
    await pool.query(`DELETE FROM tenants WHERE id = $1`, [otherTenant]);
  });

  // =========================================================================
  // 7. Money precision: 100.10 + 200.20 + 300.30 reversal nets exactly zero
  // =========================================================================
  it("money precision: 100.10/200.20/300.30 reversal nets exactly zero", async () => {
    const periodId = await createOpenPeriod("REV-07", "07");
    const a1 = await createAccount("R2000", "Acct A", "ASSET", "debit");
    const a2 = await createAccount("R2001", "Acct B", "ASSET", "debit");
    const a3 = await createAccount("R2002", "Acct C", "LIABILITY", "credit");

    const original = await repo.createJournal({
      tenantId,
      legalEntityId,
      journalNumber: `REV-007-${Date.now()}`,
      journalDate: "2026-07-15",
      accountingDate: "2026-07-15",
      periodId,
      description: "Precision test",
      currency: "IDR",
      postingRuleVersionId: null,
      idempotencyKey: `idem-rev7-${Date.now()}`,
      lines: [
        { accountId: a1, lineNumber: 1, debit: "100.10", credit: "0.00", lineDescription: null, projectId: null, siteId: null },
        { accountId: a2, lineNumber: 2, debit: "200.20", credit: "0.00", lineDescription: null, projectId: null, siteId: null },
        { accountId: a3, lineNumber: 3, debit: "0.00", credit: "300.30", lineDescription: null, projectId: null, siteId: null },
      ],
      createdBy: userId,
    });

    const posted = await repo.postJournal(original.id, userId);
    expect(posted?.journal.status).toBe("posted");

    const result = await repo.reverseJournal({
      tenantId,
      legalEntityId,
      reversalOfId: original.id,
      journalDate: "2026-07-15",
      accountingDate: "2026-07-15",
      periodId,
      journalNumber: `${original.journalNumber}-REV`,
      idempotencyKey: `rev7-r-${Date.now()}`,
      reversalReason: "Precision check",
      reversalType: "reverse_correct",
      reversedBy: userId,
    });
    expect(result).not.toBeNull();

    // GL net zero across the period (using string-based cent arithmetic)
    const gle = await repo.listGlEntries(tenantId, { periodId });
    let totalDebitCents = 0n;
    let totalCreditCents = 0n;
    for (const e of gle) {
      const d = toCents(e.debit);
      const c = toCents(e.credit);
      if (d !== null) totalDebitCents += d;
      if (c !== null) totalCreditCents += c;
    }
    expect(totalDebitCents).toBe(totalCreditCents);
  });

  // =========================================================================
  // 8. Audit row written with reason + type
  // =========================================================================
  it("audit row written with reversal reason and type", async () => {
    const periodId = await createOpenPeriod("REV-08", "08");
    const acctId = await createAccount("R3000", "Audit Acct", "ASSET", "debit");
    const counterId = await createAccount("R3001", "Audit Counter", "INCOME", "credit");

    const original = await repo.createJournal({
      tenantId,
      legalEntityId,
      journalNumber: `REV-008-${Date.now()}`,
      journalDate: "2026-08-15",
      accountingDate: "2026-08-15",
      periodId,
      description: "Audit test",
      currency: "IDR",
      postingRuleVersionId: null,
      idempotencyKey: `idem-rev8-${Date.now()}`,
      lines: [
        { accountId: acctId, lineNumber: 1, debit: "50.00", credit: "0.00", lineDescription: null, projectId: null, siteId: null },
        { accountId: counterId, lineNumber: 2, debit: "0.00", credit: "50.00", lineDescription: null, projectId: null, siteId: null },
      ],
      createdBy: userId,
    });

    await repo.postJournal(original.id, userId);

    const reason = `Audit-${Date.now()}`;
    const result = await repo.reverseJournal({
      tenantId,
      legalEntityId,
      reversalOfId: original.id,
      journalDate: "2026-08-15",
      accountingDate: "2026-08-15",
      periodId,
      journalNumber: `${original.journalNumber}-REV`,
      idempotencyKey: `rev8-r-${Date.now()}`,
      reversalReason: reason,
      reversalType: "reverse_correct",
      reversedBy: userId,
    });
    expect(result).not.toBeNull();

    const auditRes = await pool.query(
      `SELECT * FROM audit_log
        WHERE tenant_id = $1
          AND action = 'accounting.journal.reversed'
          AND entity_id = $2
        ORDER BY created_at DESC LIMIT 1`,
      [tenantId, result!.reversal.id],
    );
    expect(auditRes.rows[0]).toBeTruthy();
    expect(auditRes.rows[0].metadata.reversalType).toBe("reverse_correct");
    expect(auditRes.rows[0].metadata.reason).toBe(reason);
  });
});
