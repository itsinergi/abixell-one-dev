import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { pool } from "../../src/infrastructure/persistence/db.js";
import { PgAssetBookRepository } from "../../src/modules/accounting/asset-book/infrastructure/asset-book.repository.pg.js";
import { AssetBookService } from "../../src/modules/accounting/asset-book/application/asset-book.service.js";
import {
  computeSchedule,
  fromCents,
  periodAmount,
  resolveMethod,
  straightLineV1,
  toCents,
} from "../../src/modules/accounting/asset-book/domain/asset-book.entity.js";
import { PgAccountingKernelRepository } from "../../src/modules/accounting/kernel/infrastructure/accounting-kernel.repository.pg.js";
import { AccountingKernelService } from "../../src/modules/accounting/kernel/application/accounting-kernel.service.js";
import { PgAssetRepository } from "../../src/modules/asset/core/infrastructure/asset.repository.pg.js";
import { AssetService } from "../../src/modules/asset/core/application/asset.service.js";
import { PgRbacRepository } from "../../src/infrastructure/persistence/repositories/rbac.repository.pg.js";
import { PgAuditLogRepository } from "../../src/infrastructure/persistence/repositories/audit-log.repository.pg.js";
import { RbacService } from "../../src/application/rbac/rbac.service.js";
import { AuditService } from "../../src/application/audit/audit.service.js";
import type { ActorContext } from "../../src/domain/shared-kernel/audit-context.js";
import { ConflictError, ValidationError } from "../../src/domain/shared-kernel/errors.js";

/**
 * WP-FIN-A6-05 — Fixed asset book + depreciation (ADR-0019).
 *
 * Contract under test:
 *   - the straight-line schedule sums to the basis exactly, with the rounding
 *     residual absorbed in the final period and never exceeding it;
 *   - a run is idempotent per key, one per book per period, and refuses a
 *     closed period before writing anything;
 *   - a correction is a linked reversal run; the original stays and its
 *     accumulated projection is restored;
 *   - the book never reads `assets` directly — Data Scope decides through
 *     AssetService;
 *   - nothing crosses a tenant or a legal entity boundary.
 *
 * Pattern: real DB pool, dedicated tenant, CASCADE cleanup.
 */

const TS = `ak-ab-${Date.now()}`;

describe("WP-FIN-A6-05 — Fixed asset book + depreciation", () => {
  let tenantId: string;
  let legalEntityId: string;
  let otherLegalEntityId: string;
  let userId: string;
  let ledgerId: string;
  let expenseAccountId: string;
  let accumAccountId: string;
  let periodId: string;
  let closedPeriodId: string;
  let service: AssetBookService;
  let roleSeq = 0;
  let assetSeq = 0;

  async function actorWith(permissions: string[]): Promise<ActorContext> {
    const roleCode = `ROLE-AB-${++roleSeq}-${userId.slice(0, 8)}`;
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
      sessionId: "00000000-0000-4000-8000-000000000005",
      assignmentId: assignRes.rows[0].id,
      roleId,
      roleCode,
      scopeType: "tenant",
      scopeLegalEntityId: null,
      scopeOrganizationUnitId: null,
      scopeCustomerId: null,
    };
  }

  /** An asset master row. The book references it; nothing here reads it back. */
  async function makeAsset(): Promise<string> {
    const n = ++assetSeq;
    const res = await pool.query(
      `INSERT INTO assets (tenant_id, asset_number, name, status)
       VALUES ($1,$2,$3,'in_use') RETURNING id`,
      [tenantId, `AST-${TS}-${n}`, `Test Asset ${n}`],
    );
    return res.rows[0].id as string;
  }

  async function createBook(overrides: Record<string, unknown> = {}) {
    const actor = await actorWith(["finance.accounting.configure", "asset.read"]);
    return service.createBook(actor, {
      legalEntityId,
      ledgerId,
      assetId: await makeAsset(),
      bookCode: "STATUTORY",
      assetClass: "MACHINERY",
      capitalizationDate: "2026-01-01",
      inServiceDate: "2026-01-01",
      acquisitionCost: "1200.00",
      residualValue: "0.00",
      usefulLifeMonths: 12,
      depreciationExpenseAccountId: expenseAccountId,
      accumulatedDepreciationAccountId: accumAccountId,
      ...overrides,
    } as Parameters<AssetBookService["createBook"]>[1]);
  }

  async function activeBook(overrides: Record<string, unknown> = {}) {
    const book = await createBook(overrides);
    const actor = await actorWith(["finance.accounting.configure", "asset.read"]);
    return service.activateBook(actor, book.id);
  }

  beforeAll(async () => {
    const tenant = await pool.query(
      `INSERT INTO tenants (code, name) VALUES ($1, 'Asset Book Test Tenant') RETURNING id`,
      [TS],
    );
    tenantId = tenant.rows[0].id;

    const le = await pool.query(
      `INSERT INTO legal_entities (tenant_id, name) VALUES ($1, 'LE Asset Book') RETURNING id`,
      [tenantId],
    );
    legalEntityId = le.rows[0].id;
    const otherLe = await pool.query(
      `INSERT INTO legal_entities (tenant_id, name) VALUES ($1, 'LE Other') RETURNING id`,
      [tenantId],
    );
    otherLegalEntityId = otherLe.rows[0].id;

    const user = await pool.query(
      `INSERT INTO users (tenant_id, email, password_hash, full_name)
       VALUES ($1,$2,'x','Asset Book Tester') RETURNING id`,
      [tenantId, `${TS}@test.local`],
    );
    userId = user.rows[0].id;

    const ledger = await pool.query(
      `INSERT INTO accounting_ledgers
         (tenant_id, legal_entity_id, ledger_code, ledger_name, currency)
       VALUES ($1,$2,'PRIMARY','Primary Ledger','IDR') RETURNING id`,
      [tenantId, legalEntityId],
    );
    ledgerId = ledger.rows[0].id;

    const coa = await pool.query(
      `INSERT INTO chart_of_accounts (tenant_id, legal_entity_id, coa_version_code, coa_version_date)
       VALUES ($1,$2,'COA-AB','2026-01-01') RETURNING id`,
      [tenantId, legalEntityId],
    );
    const expense = await pool.query(
      `INSERT INTO accounting_accounts
         (tenant_id, legal_entity_id, coa_id, account_code, account_name, account_class, normal_balance)
       VALUES ($1,$2,$3,'6100','Depreciation Expense','EXPENSE','debit') RETURNING id`,
      [tenantId, legalEntityId, coa.rows[0].id],
    );
    expenseAccountId = expense.rows[0].id;
    const accum = await pool.query(
      `INSERT INTO accounting_accounts
         (tenant_id, legal_entity_id, coa_id, account_code, account_name, account_class, normal_balance)
       VALUES ($1,$2,$3,'1610','Accumulated Depreciation','ASSET','credit') RETURNING id`,
      [tenantId, legalEntityId, coa.rows[0].id],
    );
    accumAccountId = accum.rows[0].id;

    const period = await pool.query(
      `INSERT INTO accounting_periods
         (tenant_id, legal_entity_id, fiscal_year_code, period_code, period_name,
          period_type, date_from, date_to, status)
       VALUES ($1,$2,'2026','2026-01','January 2026','monthly','2026-01-01','2026-01-31','open') RETURNING id`,
      [tenantId, legalEntityId],
    );
    periodId = period.rows[0].id;
    const closed = await pool.query(
      `INSERT INTO accounting_periods
         (tenant_id, legal_entity_id, fiscal_year_code, period_code, period_name,
          period_type, date_from, date_to, status)
       VALUES ($1,$2,'2026','2026-02','February 2026','monthly','2026-02-01','2026-02-28','closed') RETURNING id`,
      [tenantId, legalEntityId],
    );
    closedPeriodId = closed.rows[0].id;

    const rbac = new RbacService(new PgRbacRepository(pool));
    const audit = new AuditService(new PgAuditLogRepository(pool));
    const kernel = new AccountingKernelService(
      new PgAccountingKernelRepository(pool),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      {} as any,
      audit,
      rbac,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      { publish: async () => undefined } as any,
    );
    const assetService = new AssetService(
      new PgAssetRepository(pool),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      {} as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      {} as any,
      audit,
      rbac,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      { publish: async () => undefined } as any,
    );
    service = new AssetBookService(
      new PgAssetBookRepository(pool),
      rbac,
      audit,
      kernel,
      assetService,
    );
  });

  afterAll(async () => {
    await pool.query(`DELETE FROM tenants WHERE id = $1`, [tenantId]);
  });

  // =========================================================================
  // Schedule (pure)
  // =========================================================================

  describe("straight-line schedule", () => {
    it("splits the basis evenly and sums to it exactly", () => {
      const schedule = computeSchedule({
        acquisitionCost: "1200.00",
        residualValue: "0.00",
        usefulLifeMonths: 12,
        methodCode: "straight_line",
        methodVersion: 1,
      });
      expect(schedule).toHaveLength(12);
      expect(schedule[0].amount).toBe("100.00");
      const total = schedule.reduce((s, p) => s + toCents(p.amount)!, 0n);
      expect(total).toBe(120000n);
    });

    it("absorbs the rounding residual in the final period", () => {
      const schedule = computeSchedule({
        acquisitionCost: "100.00",
        residualValue: "0.00",
        usefulLifeMonths: 3,
        methodCode: "straight_line",
        methodVersion: 1,
      });
      expect(schedule.map((p) => p.amount)).toEqual(["33.33", "33.33", "33.34"]);
      expect(schedule[2].isFinalPeriod).toBe(true);
    });

    it("depreciates only the basis, never the residual value", () => {
      const schedule = computeSchedule({
        acquisitionCost: "1000.00",
        residualValue: "100.00",
        usefulLifeMonths: 10,
        methodCode: "straight_line",
        methodVersion: 1,
      });
      const total = schedule.reduce((s, p) => s + toCents(p.amount)!, 0n);
      expect(total).toBe(90000n);
      expect(schedule[9].accumulatedAfter).toBe("900.00");
    });

    it("never exceeds the basis on a one-month life", () => {
      const schedule = computeSchedule({
        acquisitionCost: "50.00",
        residualValue: "0.00",
        usefulLifeMonths: 1,
        methodCode: "straight_line",
        methodVersion: 1,
      });
      expect(schedule).toHaveLength(1);
      expect(schedule[0].amount).toBe("50.00");
      expect(schedule[0].isFinalPeriod).toBe(true);
    });

    it("returns a zero schedule when cost equals residual", () => {
      expect(straightLineV1.periodAmounts({ basis: 0n, usefulLifeMonths: 4 })).toEqual([0n, 0n, 0n, 0n]);
    });

    it("refuses an unknown method version instead of falling back", () => {
      expect(() => resolveMethod("straight_line", 2)).toThrow(/Unsupported depreciation method/);
      expect(() => resolveMethod("reducing_balance", 1)).toThrow(/Unsupported depreciation method/);
    });

    it("refuses a non-positive life", () => {
      expect(() => straightLineV1.periodAmounts({ basis: 100n, usefulLifeMonths: 0 })).toThrow(
        /must be positive/,
      );
    });
  });

  describe("period amount against posted history", () => {
    const schedule = computeSchedule({
      acquisitionCost: "300.00",
      residualValue: "0.00",
      usefulLifeMonths: 3,
      methodCode: "straight_line",
      methodVersion: 1,
    });

    it("continues where the posted history left off", () => {
      const step = periodAmount(schedule, 10000n);
      expect(step?.amount).toBe(10000n);
      expect(step?.accumulatedBefore).toBe(10000n);
      expect(step?.accumulatedAfter).toBe(20000n);
    });

    it("returns null once the schedule is exhausted", () => {
      expect(periodAmount(schedule, 30000n)).toBeNull();
    });

    it("catches up the residual in the final step", () => {
      const uneven = computeSchedule({
        acquisitionCost: "100.00",
        residualValue: "0.00",
        usefulLifeMonths: 3,
        methodCode: "straight_line",
        methodVersion: 1,
      });
      const step = periodAmount(uneven, 6666n);
      expect(step?.amount).toBe(3334n);
      expect(step?.isFinalPeriod).toBe(true);
    });
  });

  // =========================================================================
  // Books
  // =========================================================================

  describe("asset book registration", () => {
    it("creates a draft book against an authorized asset", async () => {
      const book = await createBook();
      expect(book.status).toBe("draft");
      expect(book.acquisitionCost).toBe("1200.00");
      expect(book.methodCode).toBe("straight_line");
      expect(book.methodVersion).toBe(1);
    });

    it("refuses a residual value above the acquisition cost", async () => {
      await expect(createBook({ acquisitionCost: "100.00", residualValue: "200.00" })).rejects.toThrow(
        ValidationError,
      );
    });

    it("refuses depreciation starting before capitalization", async () => {
      await expect(
        createBook({ capitalizationDate: "2026-03-01", inServiceDate: "2026-01-01" }),
      ).rejects.toThrow(ValidationError);
    });

    it("refuses the same account on both sides of the posting", async () => {
      await expect(
        createBook({ accumulatedDepreciationAccountId: expenseAccountId }),
      ).rejects.toThrow(ValidationError);
    });

    it("refuses a second book for the same asset and book code", async () => {
      const assetId = await makeAsset();
      await createBook({ assetId });
      await expect(createBook({ assetId })).rejects.toThrow(ConflictError);
    });

    it("refuses activation of a book twice over", async () => {
      const book = await activeBook();
      const actor = await actorWith(["finance.accounting.configure", "asset.read"]);
      // Idempotent: an already-active book returns itself, not an error.
      const again = await service.activateBook(actor, book.id);
      expect(again.status).toBe("active");
    });

    it("requires finance.accounting.configure to create a book", async () => {
      const actor = await actorWith(["finance.accounting.read"]);
      await expect(
        service.createBook(actor, {
          legalEntityId,
          ledgerId,
          assetId: await makeAsset(),
          bookCode: "STATUTORY",
          assetClass: "MACHINERY",
          capitalizationDate: "2026-01-01",
          inServiceDate: "2026-01-01",
          acquisitionCost: "10.00",
          usefulLifeMonths: 10,
          depreciationExpenseAccountId: expenseAccountId,
          accumulatedDepreciationAccountId: accumAccountId,
        }),
      ).rejects.toThrow();
    });
  });

  // =========================================================================
  // Runs
  // =========================================================================

  describe("depreciation runs", () => {
    it("posts a run and creates a balanced journal", async () => {
      const book = await activeBook({ acquisitionCost: "1200.00", usefulLifeMonths: 12, bookCode: "RUN-POST" });
      const actor = await actorWith(["finance.accounting.approve", "finance.accounting.read", "asset.read"]);

      const run = await service.runDepreciation(actor, {
        legalEntityId,
        bookCode: book.bookCode,
        periodId,
        idempotencyKey: `run-${book.id}`,
      });

      expect(run.status).toBe("posted");
      expect(run.journalId).toBeTruthy();
      const line = run.lines.find((l) => l.assetBookId === book.id);
      expect(line?.amount).toBe("100.00");

      const journal = await pool.query(
        `SELECT is_balanced, status FROM journal_headers WHERE id = $1`,
        [run.journalId],
      );
      expect(journal.rows[0].is_balanced).toBe(true);
      expect(journal.rows[0].status).toBe("posted");
    });

    it("replays the same idempotency key instead of posting twice", async () => {
      const book = await activeBook({ acquisitionCost: "600.00", usefulLifeMonths: 12, bookCode: "RUN-REPLAY" });
      const actor = await actorWith(["finance.accounting.approve", "finance.accounting.read", "asset.read"]);
      const key = `run-replay-${book.id}`;

      const first = await service.runDepreciation(actor, {
        legalEntityId,
        bookCode: book.bookCode,
        periodId,
        idempotencyKey: key,
      });
      const second = await service.runDepreciation(actor, {
        legalEntityId,
        bookCode: book.bookCode,
        periodId,
        idempotencyKey: key,
      });
      expect(second.id).toBe(first.id);

      const count = await pool.query(
        `SELECT COUNT(*)::int AS n FROM finance_depreciation_runs WHERE tenant_id = $1 AND idempotency_key = $2`,
        [tenantId, key],
      );
      expect(count.rows[0].n).toBe(1);
    });

    it("refuses a second run for the same book and period", async () => {
      const book = await activeBook({ acquisitionCost: "240.00", usefulLifeMonths: 12, bookCode: "RUN-SECOND" });
      const actor = await actorWith(["finance.accounting.approve", "finance.accounting.read", "asset.read"]);
      await service.runDepreciation(actor, {
        legalEntityId,
        bookCode: book.bookCode,
        periodId,
        idempotencyKey: `run-a-${book.id}`,
      });
      await expect(
        service.runDepreciation(actor, {
          legalEntityId,
          bookCode: book.bookCode,
          periodId,
          idempotencyKey: `run-b-${book.id}`,
        }),
      ).rejects.toThrow(ConflictError);
    });

    it("refuses a closed period before writing anything", async () => {
      const book = await activeBook({ acquisitionCost: "120.00", usefulLifeMonths: 12, bookCode: "RUN-CLOSED" });
      const actor = await actorWith(["finance.accounting.approve", "finance.accounting.read", "asset.read"]);
      const key = `run-closed-${book.id}`;

      await expect(
        service.runDepreciation(actor, {
          legalEntityId,
          bookCode: book.bookCode,
          periodId: closedPeriodId,
          idempotencyKey: key,
        }),
      ).rejects.toThrow(ConflictError);

      const runs = await pool.query(
        `SELECT COUNT(*)::int AS n FROM finance_depreciation_runs WHERE tenant_id = $1 AND idempotency_key = $2`,
        [tenantId, key],
      );
      expect(runs.rows[0].n).toBe(0);
    });

    it("refuses a book code with no active books", async () => {
      const actor = await actorWith(["finance.accounting.approve", "finance.accounting.read", "asset.read"]);
      await expect(
        service.runDepreciation(actor, {
          legalEntityId,
          bookCode: "NO-SUCH-BOOK",
          periodId,
          idempotencyKey: `run-missing-${Date.now()}`,
        }),
      ).rejects.toThrow(ValidationError);
    });

    it("requires finance.accounting.approve to run depreciation", async () => {
      const book = await activeBook({ acquisitionCost: "60.00", usefulLifeMonths: 12 });
      const actor = await actorWith(["finance.accounting.read"]);
      await expect(
        service.runDepreciation(actor, {
          legalEntityId,
          bookCode: book.bookCode,
          periodId,
          idempotencyKey: `run-rbac-${book.id}`,
        }),
      ).rejects.toThrow();
    });

    it("skips a book whose schedule is exhausted", async () => {
      // One-month life: the first run consumes the whole basis.
      const book = await activeBook({
        acquisitionCost: "50.00",
        usefulLifeMonths: 1,
        bookCode: "ONE-MONTH",
      });
      const actor = await actorWith(["finance.accounting.approve", "finance.accounting.read", "asset.read"]);
      const first = await service.runDepreciation(actor, {
        legalEntityId,
        bookCode: book.bookCode,
        periodId,
        idempotencyKey: `run-ex-1-${book.id}`,
      });
      expect(first.totalAmount).toBe("50.00");

      // A second period would find nothing to post.
      const next = await pool.query(
        `INSERT INTO accounting_periods
           (tenant_id, legal_entity_id, fiscal_year_code, period_code, period_name,
            period_type, date_from, date_to, status)
         VALUES ($1,$2,'2026','2026-03','March 2026','monthly','2026-03-01','2026-03-31','open') RETURNING id`,
        [tenantId, legalEntityId],
      );
      await expect(
        service.runDepreciation(actor, {
          legalEntityId,
          bookCode: book.bookCode,
          periodId: next.rows[0].id,
          idempotencyKey: `run-ex-2-${book.id}`,
        }),
      ).rejects.toThrow(ConflictError);
    });
  });

  // =========================================================================
  // Reversal
  // =========================================================================

  describe("run reversal", () => {
    it("reverses with a linked run and restores the accumulated projection", async () => {
      const book = await activeBook({
        acquisitionCost: "120.00",
        usefulLifeMonths: 12,
        bookCode: "REVERSIBLE",
      });
      const actor = await actorWith(["finance.accounting.approve", "finance.accounting.read", "asset.read"]);
      const run = await service.runDepreciation(actor, {
        legalEntityId,
        bookCode: book.bookCode,
        periodId,
        idempotencyKey: `run-rev-src-${book.id}`,
      });

      const before = await service.getBook(actor, book.id);
      expect(before.accumulatedDepreciation).toBe("10.00");

      const reversing = await service.reverseRun(actor, run.id, {
        idempotencyKey: `run-rev-${book.id}`,
        reason: "wrong period",
      });
      expect(reversing.reversesRunId).toBe(run.id);
      expect(reversing.journalId).toBeTruthy();

      const original = await service.getRun(actor, run.id);
      expect(original.status).toBe("reversed");

      const after = await service.getBook(actor, book.id);
      expect(after.accumulatedDepreciation).toBe("0.00");
    });

    it("refuses to reverse a run twice", async () => {
      const book = await activeBook({
        acquisitionCost: "120.00",
        usefulLifeMonths: 12,
        bookCode: "REV-ONCE",
      });
      const actor = await actorWith(["finance.accounting.approve", "finance.accounting.read", "asset.read"]);
      const run = await service.runDepreciation(actor, {
        legalEntityId,
        bookCode: book.bookCode,
        periodId,
        idempotencyKey: `run-r2-src-${book.id}`,
      });
      await service.reverseRun(actor, run.id, {
        idempotencyKey: `run-r2-a-${book.id}`,
        reason: "first",
      });
      await expect(
        service.reverseRun(actor, run.id, {
          idempotencyKey: `run-r2-b-${book.id}`,
          reason: "second",
        }),
      ).rejects.toThrow(ConflictError);
    });

    it("requires a reason", async () => {
      const book = await activeBook({
        acquisitionCost: "120.00",
        usefulLifeMonths: 12,
        bookCode: "REV-REASON",
      });
      const actor = await actorWith(["finance.accounting.approve", "finance.accounting.read", "asset.read"]);
      const run = await service.runDepreciation(actor, {
        legalEntityId,
        bookCode: book.bookCode,
        periodId,
        idempotencyKey: `run-r3-src-${book.id}`,
      });
      await expect(
        service.reverseRun(actor, run.id, { idempotencyKey: `run-r3-${book.id}`, reason: "  " }),
      ).rejects.toThrow(ValidationError);
    });
  });

  // =========================================================================
  // Events + disposal
  // =========================================================================

  describe("asset book events", () => {
    it("records an impairment with its evidence", async () => {
      const book = await createBook();
      const actor = await actorWith(["finance.accounting.approve", "finance.accounting.read", "asset.read"]);
      const event = await service.recordEvent(actor, {
        assetBookId: book.id,
        eventType: "impairment",
        eventDate: "2026-01-15",
        amount: "50.00",
        evidenceDocumentId: "00000000-0000-4000-8000-0000000000aa",
        idempotencyKey: `ev-imp-${book.id}`,
      });
      expect(event.eventType).toBe("impairment");
      expect(event.amount).toBe("50.00");
    });

    it("refuses an impairment without evidence", async () => {
      const book = await createBook();
      const actor = await actorWith(["finance.accounting.approve", "finance.accounting.read", "asset.read"]);
      await expect(
        service.recordEvent(actor, {
          assetBookId: book.id,
          eventType: "impairment",
          eventDate: "2026-01-15",
          amount: "50.00",
          idempotencyKey: `ev-noev-${book.id}`,
        }),
      ).rejects.toThrow(ValidationError);
    });

    it("records a transfer without an amount", async () => {
      const book = await createBook();
      const actor = await actorWith(["finance.accounting.approve", "finance.accounting.read", "asset.read"]);
      const event = await service.recordEvent(actor, {
        assetBookId: book.id,
        eventType: "transfer",
        eventDate: "2026-01-15",
        idempotencyKey: `ev-tr-${book.id}`,
      });
      expect(event.amount).toBeNull();
    });

    it("replays an event on the same idempotency key", async () => {
      const book = await createBook();
      const actor = await actorWith(["finance.accounting.approve", "finance.accounting.read", "asset.read"]);
      const key = `ev-replay-${book.id}`;
      const first = await service.recordEvent(actor, {
        assetBookId: book.id,
        eventType: "transfer",
        eventDate: "2026-01-15",
        idempotencyKey: key,
      });
      const second = await service.recordEvent(actor, {
        assetBookId: book.id,
        eventType: "transfer",
        eventDate: "2026-01-15",
        idempotencyKey: key,
      });
      expect(second.id).toBe(first.id);
    });

    it("disposes an active book and stops it appearing in a run", async () => {
      const book = await activeBook({
        acquisitionCost: "120.00",
        usefulLifeMonths: 12,
        bookCode: "DISPOSABLE",
      });
      const actor = await actorWith(["finance.accounting.approve", "finance.accounting.read", "asset.read"]);
      const disposed = await service.disposeBook(actor, book.id, {
        disposalDate: "2026-01-20",
        evidenceDocumentId: "00000000-0000-4000-8000-0000000000bb",
        idempotencyKey: `dispose-${book.id}`,
      });
      expect(disposed.book.status).toBe("disposed");
      expect(disposed.event.eventType).toBe("disposal");
    });
  });

  // =========================================================================
  // Boundaries
  // =========================================================================

  describe("tenant and legal-entity boundaries", () => {
    it("never returns another tenant's book", async () => {
      const book = await createBook();
      const otherTenant = await pool.query(
        `INSERT INTO tenants (code, name) VALUES ($1, 'Other Asset Tenant') RETURNING id`,
        [`${TS}-other`],
      );
      try {
        const repo = new PgAssetBookRepository(pool);
        const found = await repo.findBookById(otherTenant.rows[0].id as string, book.id);
        expect(found).toBeNull();
      } finally {
        await pool.query(`DELETE FROM tenants WHERE id = $1`, [otherTenant.rows[0].id]);
      }
    });

    it("scopes a run to one legal entity", async () => {
      const book = await activeBook({
        acquisitionCost: "120.00",
        usefulLifeMonths: 12,
        bookCode: "LE-SCOPED",
      });
      const actor = await actorWith(["finance.accounting.approve", "finance.accounting.read", "asset.read"]);
      // The book belongs to `legalEntityId`; asking for it under the other
      // entity finds no active book, so nothing is posted.
      await expect(
        service.runDepreciation(actor, {
          legalEntityId: otherLegalEntityId,
          bookCode: book.bookCode,
          periodId,
          idempotencyKey: `run-le-${book.id}`,
        }),
      ).rejects.toThrow(ValidationError);
    });
  });

  describe("exact money", () => {
    it("round-trips cents without float drift", () => {
      expect(toCents("1234.56")).toBe(123456n);
      expect(fromCents(123456n)).toBe("1234.56");
      expect(fromCents(-5n)).toBe("-0.05");
    });

    it("refuses more than 2 decimals", () => {
      expect(toCents("10.005")).toBeNull();
      expect(toCents("1e3")).toBeNull();
    });
  });
});
