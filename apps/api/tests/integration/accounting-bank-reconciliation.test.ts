import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { pool } from "../../src/infrastructure/persistence/db.js";
import { PgBankReconRepository } from "../../src/modules/accounting/bank-recon/infrastructure/bank-recon.repository.pg.js";
import { BankReconService } from "../../src/modules/accounting/bank-recon/application/bank-recon.service.js";
import {
  fromCents,
  parseStatementCsv,
  signedLineCents,
  toCents,
} from "../../src/modules/accounting/bank-recon/domain/bank-recon.entity.js";
import { PgRbacRepository } from "../../src/infrastructure/persistence/repositories/rbac.repository.pg.js";
import { PgAuditLogRepository } from "../../src/infrastructure/persistence/repositories/audit-log.repository.pg.js";
import { RbacService } from "../../src/application/rbac/rbac.service.js";
import { AuditService } from "../../src/application/audit/audit.service.js";
import type { ActorContext } from "../../src/domain/shared-kernel/audit-context.js";
import { ConflictError, ValidationError } from "../../src/domain/shared-kernel/errors.js";

/**
 * WP-FIN-A6-04 — Bank reconciliation (ADR-0018).
 *
 * Contract under test:
 *   - money is exact 2-decimal cents on both sides (ledger precision);
 *   - csv_v1 is an explicit profile and a malformed row refuses the whole file;
 *   - import is idempotent per file and per (account, external id): a repeat
 *     fails closed, a duplicate line lands in the review queue, never dropped;
 *   - book movement (GL facts) and statement movement (imported lines) are
 *     reported side by side and neither overwrites the other;
 *   - matching fails closed on over-match, refuses a closed reconciliation, and
 *     is idempotent per key;
 *   - unmatch is a compensating row; closing freezes the match set.
 *
 * Pattern: real DB pool, dedicated tenant, CASCADE cleanup.
 */

const TS = `ak-br-${Date.now()}`;

describe("WP-FIN-A6-04 — Bank reconciliation", () => {
  let tenantId: string;
  let legalEntityId: string;
  let userId: string;
  let bankAccountId: string;
  let ledgerAccountId: string;
  let contraAccountId: string;
  let periodId: string;
  let service: BankReconService;
  let roleSeq = 0;
  let journalSeq = 0;

  const CSV_HEADER = "value_date,amount,currency,direction,external_transaction_id,reference,counterparty";

  async function actorWith(permissions: string[]): Promise<ActorContext> {
    const roleCode = `ROLE-BR-${++roleSeq}-${userId.slice(0, 8)}`;
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
      sessionId: "00000000-0000-4000-8000-000000000003",
      assignmentId: assignRes.rows[0].id,
      roleId,
      roleCode,
      scopeType: "tenant",
      scopeLegalEntityId: null,
      scopeOrganizationUnitId: null,
      scopeCustomerId: null,
    };
  }

  /** Post a balanced two-line journal and return the GL entry on the bank
   *  account — the only side reconciliation reads from the book. */
  async function postGl(debit: string, credit: string, postingDate: string): Promise<string> {
    const n = ++journalSeq;
    const header = await pool.query(
      `INSERT INTO journal_headers
         (tenant_id, legal_entity_id, journal_number, journal_date, accounting_date,
          period_id, currency, idempotency_key)
       VALUES ($1,$2,$3,$4,$4,$5,'IDR',$6) RETURNING id`,
      [tenantId, legalEntityId, `J-BR-${n}`, postingDate, periodId, `br-${n}`],
    );
    const bankLine = await pool.query(
      `INSERT INTO journal_lines
         (tenant_id, journal_header_id, account_id, line_number, debit, credit)
       VALUES ($1,$2,$3,1,$4,$5) RETURNING id`,
      [tenantId, header.rows[0].id, ledgerAccountId, debit, credit],
    );
    await pool.query(
      `INSERT INTO journal_lines
         (tenant_id, journal_header_id, account_id, line_number, debit, credit)
       VALUES ($1,$2,$3,2,$4,$5)`,
      [tenantId, header.rows[0].id, contraAccountId, credit, debit],
    );
    const gl = await pool.query(
      `INSERT INTO general_ledger_entries
         (tenant_id, account_id, period_id, journal_line_id, posting_date, debit, credit)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
      [tenantId, ledgerAccountId, periodId, bankLine.rows[0].id, postingDate, debit, credit],
    );
    return gl.rows[0].id as string;
  }

  function csv(...rows: string[]): string {
    return [CSV_HEADER, ...rows].join("\n");
  }

  /** `toCents` refuses a sign on purpose (it validates user-supplied amounts);
   *  a derived figure like `difference` can be negative, so parse it here. */
  function signedCents(value: string): bigint {
    return value.startsWith("-") ? -toCents(value.slice(1))! : toCents(value)!;
  }

  async function importFile(name: string, content: string) {
    const actor = await actorWith(["finance.accounting.configure"]);
    return service.importStatement(actor, {
      bankAccountId,
      formatProfile: "csv_v1",
      sourceFileName: name,
      content,
    });
  }

  beforeAll(async () => {
    const tenant = await pool.query(
      `INSERT INTO tenants (code, name) VALUES ($1, 'Bank Recon Test Tenant') RETURNING id`,
      [TS],
    );
    tenantId = tenant.rows[0].id;

    const le = await pool.query(
      `INSERT INTO legal_entities (tenant_id, name) VALUES ($1, 'LE Bank Recon') RETURNING id`,
      [tenantId],
    );
    legalEntityId = le.rows[0].id;

    const user = await pool.query(
      `INSERT INTO users (tenant_id, email, password_hash, full_name)
       VALUES ($1,$2,'x','Bank Recon Tester') RETURNING id`,
      [tenantId, `${TS}@test.local`],
    );
    userId = user.rows[0].id;

    const coa = await pool.query(
      `INSERT INTO chart_of_accounts (tenant_id, legal_entity_id, coa_version_code, coa_version_date)
       VALUES ($1,$2,'COA-BR','2026-01-01') RETURNING id`,
      [tenantId, legalEntityId],
    );
    const bankAcct = await pool.query(
      `INSERT INTO accounting_accounts
         (tenant_id, legal_entity_id, coa_id, account_code, account_name, account_class, normal_balance)
       VALUES ($1,$2,$3,'1100','Bank BCA','ASSET','debit') RETURNING id`,
      [tenantId, legalEntityId, coa.rows[0].id],
    );
    ledgerAccountId = bankAcct.rows[0].id;
    const contra = await pool.query(
      `INSERT INTO accounting_accounts
         (tenant_id, legal_entity_id, coa_id, account_code, account_name, account_class, normal_balance)
       VALUES ($1,$2,$3,'4100','Revenue','INCOME','credit') RETURNING id`,
      [tenantId, legalEntityId, coa.rows[0].id],
    );
    contraAccountId = contra.rows[0].id;

    const period = await pool.query(
      `INSERT INTO accounting_periods
         (tenant_id, legal_entity_id, fiscal_year_code, period_code, period_name,
          period_type, date_from, date_to)
       VALUES ($1,$2,'2026','2026-10','October 2026','monthly','2026-10-01','2026-10-31') RETURNING id`,
      [tenantId, legalEntityId],
    );
    periodId = period.rows[0].id;

    const repo = new PgBankReconRepository(pool);
    service = new BankReconService(
      repo,
      new RbacService(new PgRbacRepository(pool)),
      new AuditService(new PgAuditLogRepository(pool)),
    );

    const configure = await actorWith(["finance.accounting.configure"]);
    const account = await service.createBankAccount(configure, {
      legalEntityId,
      bankName: "Bank Central Asia",
      houseBankCode: "BCA-OPS",
      bankAccountId: "BCA-001",
      accountNumberMasked: "****4321",
      name: "BCA Operational",
      currency: "IDR",
      ledgerAccountId,
      reconciliationPolicy: "suggested",
      effectiveFrom: "2026-01-01",
    });
    bankAccountId = account.id;
  });

  afterAll(async () => {
    await pool.query(`DELETE FROM tenants WHERE id = $1`, [tenantId]);
  });

  // =========================================================================
  // Money + format (pure)
  // =========================================================================

  describe("exact 2-decimal money", () => {
    it("round-trips cents without float drift", () => {
      expect(toCents("1234.56")).toBe(123456n);
      expect(fromCents(123456n)).toBe("1234.56");
      expect(fromCents(-5n)).toBe("-0.05");
    });

    it("refuses more than 2 decimals instead of silently rounding", () => {
      expect(toCents("10.005")).toBeNull();
      expect(toCents("1e3")).toBeNull();
      expect(toCents("abc")).toBeNull();
    });

    it("credit is money in, debit is money out", () => {
      expect(signedLineCents("100.00", "credit")).toBe(10000n);
      expect(signedLineCents("100.00", "debit")).toBe(-10000n);
    });
  });

  describe("csv_v1 parsing", () => {
    it("derives direction from the amount sign when no direction column exists", () => {
      const { rows, errors } = parseStatementCsv(
        "value_date,amount,currency\n2026-10-02,-250.00,IDR\n2026-10-03,1500.00,IDR",
      );
      expect(errors).toHaveLength(0);
      expect(rows[0].direction).toBe("debit");
      expect(rows[0].amount).toBe("250.00");
      expect(rows[1].direction).toBe("credit");
    });

    it("keeps a quoted counterparty containing a comma intact", () => {
      const { rows } = parseStatementCsv(
        'value_date,amount,currency,counterparty\n2026-10-02,10.00,IDR,"PT A, Tbk"',
      );
      expect(rows[0].counterparty).toBe("PT A, Tbk");
    });

    it("reports the row number of a malformed record", () => {
      const { rows, errors } = parseStatementCsv(
        "value_date,amount,currency\n2026-10-02,10.00,IDR\n02-10-2026,10.00,IDR",
      );
      expect(rows).toHaveLength(1);
      expect(errors[0].rowNumber).toBe(3);
    });
  });

  // =========================================================================
  // Bank account identity (ADR-0018 §1)
  // =========================================================================

  describe("bank account", () => {
    it("refuses a full account number instead of storing it", async () => {
      const actor = await actorWith(["finance.accounting.configure"]);
      await expect(
        service.createBankAccount(actor, {
          legalEntityId,
          bankName: "Bank X",
          houseBankCode: "BX",
          bankAccountId: "BX-1",
          accountNumberMasked: "1234567890",
          name: "X",
          currency: "IDR",
          ledgerAccountId,
          reconciliationPolicy: "manual",
          effectiveFrom: "2026-01-01",
        }),
      ).rejects.toThrow(ValidationError);
    });

    it("requires finance.accounting.configure", async () => {
      const nobody = await actorWith([]);
      await expect(service.listBankAccounts(nobody, {})).rejects.toThrow(/permission/i);
    });
  });

  // =========================================================================
  // Import (ADR-0018 §2)
  // =========================================================================

  describe("statement import", () => {
    it("imports a statement and records the line count", async () => {
      const result = await importFile(
        "oct-2026.csv",
        csv(
          "2026-10-02,1500.00,IDR,credit,EXT-1,INV-001,PT Customer",
          "2026-10-05,250.00,IDR,debit,EXT-2,PAY-001,PT Supplier",
        ),
      );
      expect(result.lineCount).toBe(2);
      expect(result.duplicateLineCount).toBe(0);
      expect(result.lines.every((l) => l.duplicateStatus === "accepted")).toBe(true);
    });

    it("fails closed when the same file is imported twice", async () => {
      const content = csv("2026-10-09,99.00,IDR,credit,EXT-DUP-FILE,R1,PT Customer");
      await importFile("dup-file.csv", content);
      await expect(importFile("dup-file.csv", content)).rejects.toThrow(ConflictError);
    });

    it("holds a repeated external id in the review queue instead of double-counting", async () => {
      const second = await importFile(
        "oct-2026-rerun.csv",
        csv(
          "2026-10-02,1500.00,IDR,credit,EXT-1,INV-001,PT Customer",
          "2026-10-11,42.00,IDR,credit,EXT-3,INV-003,PT Customer",
        ),
      );
      expect(second.duplicateLineCount).toBe(1);
      const held = second.lines.find((l) => l.externalTransactionId === "EXT-1");
      expect(held?.duplicateStatus).toBe("review_queue");
      const fresh = second.lines.find((l) => l.externalTransactionId === "EXT-3");
      expect(fresh?.duplicateStatus).toBe("accepted");
    });

    it("refuses an unsupported format profile", async () => {
      const actor = await actorWith(["finance.accounting.configure"]);
      await expect(
        service.importStatement(actor, {
          bankAccountId,
          formatProfile: "mt940",
          sourceFileName: "x.mt940",
          content: "irrelevant",
        }),
      ).rejects.toThrow(/formatProfile/);
    });

    it("refuses a file with any malformed row", async () => {
      await expect(
        importFile("bad.csv", csv("2026-10-02,10.00,IDR,credit,EXT-BAD,R,PT", "not-a-date,10.00,IDR,credit,EXT-BAD2,R,PT")),
      ).rejects.toThrow(/malformed row/);
    });
  });

  // =========================================================================
  // Two balances, never merged (ADR-0018 §1)
  // =========================================================================

  describe("period movement", () => {
    it("reports book and statement movement separately, with their sources", async () => {
      await postGl("1500.00", "0.00", "2026-10-02");
      await postGl("0.00", "250.00", "2026-10-05");

      const actor = await actorWith(["finance.accounting.read"]);
      const movement = await service.periodMovement(actor, { bankAccountId, periodId });

      // Only the two journals above touch the bank account, so the book side is
      // exact; the statement side is whatever earlier tests imported.
      expect(movement.bookMovement).toBe("1250.00");
      expect(movement.bookSource).toBe("accounting_kernel_gl_entries");
      expect(movement.statementSource).toBe("imported_statement_lines");
    });

    it("a new statement line moves only the statement side", async () => {
      const actor = await actorWith(["finance.accounting.read"]);
      const before = await service.periodMovement(actor, { bankAccountId, periodId });

      await importFile("oct-extra.csv", csv("2026-10-12,100.00,IDR,credit,EXT-4,MISC,PT Customer"));
      const after = await service.periodMovement(actor, { bankAccountId, periodId });

      expect(after.bookMovement).toBe(before.bookMovement);
      expect(toCents(after.statementMovement)! - toCents(before.statementMovement)!).toBe(10000n);
      expect(signedCents(after.difference) - signedCents(before.difference)).toBe(-10000n);
    });
  });

  // =========================================================================
  // Matching (ADR-0018 §3)
  // =========================================================================

  describe("matching", () => {
    let reconciliationId: string;
    let gl1500: string;
    let line1500Id: string;

    beforeAll(async () => {
      const actor = await actorWith(["finance.accounting.configure"]);
      const recon = await service.openReconciliation(actor, { bankAccountId, periodId });
      reconciliationId = recon.id;

      const gl = await pool.query(
        `SELECT id FROM general_ledger_entries
          WHERE tenant_id = $1 AND account_id = $2 AND debit = 1500
          ORDER BY created_at LIMIT 1`,
        [tenantId, ledgerAccountId],
      );
      gl1500 = gl.rows[0].id;

      const line = await pool.query(
        `SELECT id FROM finance_bank_statement_lines
          WHERE tenant_id = $1 AND external_transaction_id = 'EXT-1' AND duplicate_status = 'accepted'`,
        [tenantId],
      );
      line1500Id = line.rows[0].id;
    });

    it("suggests the ledger entry whose amount matches exactly", async () => {
      const actor = await actorWith(["finance.accounting.read"]);
      const candidates = await service.suggestMatches(actor, line1500Id);
      expect(candidates.map((c) => c.glEntryId)).toContain(gl1500);
      expect(candidates.find((c) => c.glEntryId === gl1500)?.score).toBeGreaterThanOrEqual(60);
    });

    it("returns no suggestions under a manual policy", async () => {
      const configure = await actorWith(["finance.accounting.configure"]);
      const manual = await service.createBankAccount(configure, {
        legalEntityId,
        bankName: "Bank Manual",
        houseBankCode: "BM",
        bankAccountId: "BM-1",
        accountNumberMasked: "****0001",
        name: "Manual Bank",
        currency: "IDR",
        ledgerAccountId,
        reconciliationPolicy: "manual",
        effectiveFrom: "2026-01-01",
      });
      const imported = await service.importStatement(configure, {
        bankAccountId: manual.id,
        formatProfile: "csv_v1",
        sourceFileName: "manual.csv",
        content: csv("2026-10-02,1500.00,IDR,credit,EXT-M1,INV-001,PT Customer"),
      });
      const read = await actorWith(["finance.accounting.read"]);
      expect(await service.suggestMatches(read, imported.lines[0].id)).toHaveLength(0);
    });

    it("records a match and is idempotent per key", async () => {
      const actor = await actorWith(["finance.accounting.approve"]);
      const first = await service.createMatch(actor, {
        reconciliationId,
        statementLineId: line1500Id,
        glEntryId: gl1500,
        amount: "1500.00",
        matchKind: "manual",
        idempotencyKey: "match-1",
      });
      const again = await service.createMatch(actor, {
        reconciliationId,
        statementLineId: line1500Id,
        glEntryId: gl1500,
        amount: "1500.00",
        matchKind: "manual",
        idempotencyKey: "match-1",
      });
      expect(again.id).toBe(first.id);
    });

    it("fails closed on an over-match", async () => {
      const actor = await actorWith(["finance.accounting.approve"]);
      await expect(
        service.createMatch(actor, {
          reconciliationId,
          statementLineId: line1500Id,
          glEntryId: gl1500,
          amount: "0.01",
          matchKind: "manual",
          idempotencyKey: "match-over",
        }),
      ).rejects.toThrow(/exceeds/);
    });

    it("refuses a line held in the review queue", async () => {
      const held = await pool.query(
        `SELECT id FROM finance_bank_statement_lines
          WHERE tenant_id = $1 AND duplicate_status = 'review_queue' LIMIT 1`,
        [tenantId],
      );
      const actor = await actorWith(["finance.accounting.approve"]);
      await expect(
        service.createMatch(actor, {
          reconciliationId,
          statementLineId: held.rows[0].id,
          glEntryId: gl1500,
          amount: "1.00",
          matchKind: "manual",
          idempotencyKey: "match-held",
        }),
      ).rejects.toThrow(/review queue/);
    });

    it("unmatch is a compensating row, and a reversal cannot itself be reversed", async () => {
      const actor = await actorWith(["finance.accounting.approve", "finance.accounting.read"]);
      const matches = await service.listMatches(actor, reconciliationId);
      const original = matches.find((m) => m.idempotencyKey === "match-1")!;
      const compensating = await service.reverseMatch(actor, original.id, { idempotencyKey: "unmatch-1" });

      expect(compensating.reversesId).toBe(original.id);
      expect(compensating.amount).toBe(original.amount);
      await expect(
        service.reverseMatch(actor, compensating.id, { idempotencyKey: "unmatch-2" }),
      ).rejects.toThrow(/cannot itself be reversed/);

      const matched = await new PgBankReconRepository(pool).matchedAmountOf(
        pool,
        tenantId,
        original.statementLineId,
      );
      expect(matched).toBe("0.00");
    });

    it("closing freezes the balances and refuses further matches", async () => {
      const actor = await actorWith(["finance.accounting.approve"]);
      const closed = await service.closeReconciliation(actor, reconciliationId, {
        statementBalance: "1350.00",
      });
      expect(closed.status).toBe("closed");
      expect(closed.closedBookBalance).toBe("1250.00");
      expect(closed.closedStatementBalance).toBe("1350.00");

      await expect(
        service.createMatch(actor, {
          reconciliationId,
          statementLineId: line1500Id,
          glEntryId: gl1500,
          amount: "1.00",
          matchKind: "manual",
          idempotencyKey: "match-after-close",
        }),
      ).rejects.toThrow(/closed/);
    });
  });
});
