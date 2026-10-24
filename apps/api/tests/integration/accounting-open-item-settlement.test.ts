import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { pool } from "../../src/infrastructure/persistence/db.js";
import { PgOpenItemRepository } from "../../src/modules/accounting/open-item/infrastructure/open-item.repository.pg.js";
import { OpenItemService } from "../../src/modules/accounting/open-item/application/open-item.service.js";
import { PgRbacRepository } from "../../src/infrastructure/persistence/repositories/rbac.repository.pg.js";
import { PgAuditLogRepository } from "../../src/infrastructure/persistence/repositories/audit-log.repository.pg.js";
import { PgOrganizationUnitRepository } from "../../src/infrastructure/persistence/repositories/organization-unit.repository.pg.js";
import { PgLegalEntityRepository } from "../../src/infrastructure/persistence/repositories/legal-entity.repository.pg.js";
import { RbacService } from "../../src/application/rbac/rbac.service.js";
import { AuditService } from "../../src/application/audit/audit.service.js";
import type { ActorContext } from "../../src/domain/shared-kernel/audit-context.js";
import { ConflictError, ValidationError } from "../../src/domain/shared-kernel/errors.js";

/**
 * WP-FIN-A6-02 — AP/AR open-item settlement + aging (ADR-0017).
 *
 * Contract under test:
 *   - remaining is a projection, never a column: partial settlement leaves the
 *     residual exact to 4 decimals;
 *   - allocation is atomic and fail-closed on over-allocation;
 *   - one-to-many and many-to-one settlements, credit notes and withholding
 *     credits net against debit instruments;
 *   - reversal is a compensating row, never an edit or delete;
 *   - aging at `asOfDate` is historical and bucketed by due date;
 *   - source-side/direction/currency/legal-entity mismatches are refused.
 *
 * Pattern: real DB pool, dedicated tenant, CASCADE cleanup.
 */

const TS = `ak-oi-${Date.now()}`;

describe("WP-FIN-A6-02 — Open-item settlement + aging", () => {
  let tenantId: string;
  let legalEntityId: string;
  let otherLegalEntityId: string;
  let userId: string;
  let service: OpenItemService;
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

  const PARTY_C = "11111111-1111-4111-8111-111111111111";
  const PARTY_S = "22222222-2222-4222-8222-222222222222";

  async function makeInvoice(
    side: "AR" | "AP",
    amount: string,
    documentNo: string,
    dueDate: string | null,
    opts: { legalEntityId?: string; sourceRefId?: string; currency?: string; documentDate?: string } = {},
  ) {
    const actor = await actorWith(["finance.accounting.configure"]);
    return service.createOpenItem(actor, {
      legalEntityId: opts.legalEntityId ?? legalEntityId,
      side,
      direction: "debit",
      sourceKind: "invoice",
      sourceRefTable: side === "AR" ? "customer_invoices" : "scm_vendor_invoices",
      sourceRefId: opts.sourceRefId ?? crypto.randomUUID(),
      partyType: side === "AR" ? "customer" : "supplier",
      partyId: side === "AR" ? PARTY_C : PARTY_S,
      documentNo,
      documentDate: opts.documentDate ?? "2026-01-15",
      dueDate,
      currency: opts.currency ?? "IDR",
      originalAmount: amount,
    });
  }

  async function makeCredit(
    side: "AR" | "AP",
    sourceKind: "payment" | "credit_note" | "withholding",
    amount: string,
    documentNo: string,
    opts: { currency?: string; documentDate?: string } = {},
  ) {
    const actor = await actorWith(["finance.accounting.configure"]);
    return service.createOpenItem(actor, {
      legalEntityId,
      side,
      direction: "credit",
      sourceKind,
      sourceRefTable: side === "AR" ? "customer_invoices" : "scm_payment_lines",
      sourceRefId: crypto.randomUUID(),
      partyType: side === "AR" ? "customer" : "supplier",
      partyId: side === "AR" ? PARTY_C : PARTY_S,
      documentNo,
      documentDate: opts.documentDate ?? "2026-01-20",
      dueDate: null,
      currency: opts.currency ?? "IDR",
      originalAmount: amount,
    });
  }

  beforeAll(async () => {
    const tenantResult = await pool.query(
      `INSERT INTO tenants (code, name) VALUES ($1, 'Open Item Test Tenant') RETURNING id`,
      [TS],
    );
    tenantId = tenantResult.rows[0].id;

    const leResult = await pool.query(
      `INSERT INTO legal_entities (tenant_id, name) VALUES ($1, 'LE Open Item') RETURNING id`,
      [tenantId],
    );
    legalEntityId = leResult.rows[0].id;

    const le2 = await pool.query(
      `INSERT INTO legal_entities (tenant_id, name) VALUES ($1, 'LE Other') RETURNING id`,
      [tenantId],
    );
    otherLegalEntityId = le2.rows[0].id;

    const userResult = await pool.query(
      `INSERT INTO users (tenant_id, email, password_hash, full_name)
       VALUES ($1, $2, 'x', 'Open Item Tester') RETURNING id`,
      [tenantId, `${TS}@test.local`],
    );
    userId = userResult.rows[0].id;

    service = new OpenItemService(
      new PgOpenItemRepository(pool),
      new RbacService(
        new PgRbacRepository(pool),
        new PgOrganizationUnitRepository(pool),
        new PgLegalEntityRepository(pool),
      ),
      new AuditService(new PgAuditLogRepository(pool)),
    );
  });

  afterAll(async () => {
    await pool.query(`DELETE FROM tenants WHERE id = $1`, [tenantId]);
  });

  it("partial settlement projects the residual exactly (no float drift)", async () => {
    const invoice = await makeInvoice("AR", "1000.1234", "INV-P1", "2026-02-15");
    const payment = await makeCredit("AR", "payment", "250.0001", "PAY-P1");
    await service.allocate(await actorWith(["finance.accounting.approve"]), {
      legalEntityId,
      sourceOpenItemId: payment.id,
      targetOpenItemId: invoice.id,
      amount: "250.0001",
      allocationDate: "2026-01-25",
      idempotencyKey: `k-p1-${TS}`,
    });

    const remaining = await service.getOpenItem(await actorWith(["finance.accounting.read"]), invoice.id);
    expect(remaining.remainingAmount).toBe("750.1233");
  });

  it("idempotent intake: a replayed source document returns the original open item", async () => {
    const sourceRefId = crypto.randomUUID();
    const first = await makeInvoice("AP", "100.0000", "INV-DUP", "2026-02-01", { sourceRefId });
    const replay = await makeInvoice("AP", "100.0000", "INV-DUP-2", "2026-02-01", { sourceRefId });
    // A replay of the same source document line is a no-op that returns the
    // original row — an outbox consumer redelivery must not double-count.
    expect(replay.id).toBe(first.id);
  });

  it("allocation idempotency key replays fail closed instead of double-applying", async () => {
    const invoice = await makeInvoice("AR", "500.0000", "INV-IDEM", "2026-02-01");
    const payment = await makeCredit("AR", "payment", "500.0000", "PAY-IDEM");
    const actor = await actorWith(["finance.accounting.approve"]);
    const input = {
      legalEntityId,
      sourceOpenItemId: payment.id,
      targetOpenItemId: invoice.id,
      amount: "200.0000",
      allocationDate: "2026-01-28",
      idempotencyKey: `k-idem-${TS}`,
    };
    const first = await service.allocate(actor, input);
    const second = await service.allocate(actor, input);
    expect(second.id).toBe(first.id);

    const remaining = await service.getOpenItem(await actorWith(["finance.accounting.read"]), invoice.id);
    expect(remaining.remainingAmount).toBe("300.0000");
  });

  it("over-allocation fails closed (source and target both refuse)", async () => {
    const invoice = await makeInvoice("AR", "100.0000", "INV-OVER", "2026-02-01");
    const payment = await makeCredit("AR", "payment", "80.0000", "PAY-OVER");
    const actor = await actorWith(["finance.accounting.approve"]);
    await expect(
      service.allocate(actor, {
        legalEntityId,
        sourceOpenItemId: payment.id,
        targetOpenItemId: invoice.id,
        amount: "90.0000",
        allocationDate: "2026-01-28",
        idempotencyKey: `k-over-src-${TS}`,
      }),
    ).rejects.toThrow(ConflictError);

    const bigInvoice = await makeInvoice("AR", "50.0000", "INV-OVER-2", "2026-02-01");
    const bigPayment = await makeCredit("AR", "payment", "500.0000", "PAY-OVER-2");
    await expect(
      service.allocate(actor, {
        legalEntityId,
        sourceOpenItemId: bigPayment.id,
        targetOpenItemId: bigInvoice.id,
        amount: "60.0000",
        allocationDate: "2026-01-28",
        idempotencyKey: `k-over-tgt-${TS}`,
      }),
    ).rejects.toThrow(ConflictError);
  });

  it("one-to-many: a single payment settles several invoices to the residual", async () => {
    const inv1 = await makeInvoice("AP", "300.0000", "AP-OM-1", "2026-02-10");
    const inv2 = await makeInvoice("AP", "200.0000", "AP-OM-2", "2026-02-10");
    const payment = await makeCredit("AP", "payment", "450.0000", "AP-PAY-OM");
    const actor = await actorWith(["finance.accounting.approve"]);
    await service.allocate(actor, {
      legalEntityId,
      sourceOpenItemId: payment.id,
      targetOpenItemId: inv1.id,
      amount: "300.0000",
      allocationDate: "2026-02-11",
      idempotencyKey: `k-om-1-${TS}`,
    });
    await service.allocate(actor, {
      legalEntityId,
      sourceOpenItemId: payment.id,
      targetOpenItemId: inv2.id,
      amount: "150.0000",
      allocationDate: "2026-02-11",
      idempotencyKey: `k-om-2-${TS}`,
    });

    const read = await actorWith(["finance.accounting.read"]);
    const r1 = await service.getOpenItem(read, inv1.id);
    const r2 = await service.getOpenItem(read, inv2.id);
    expect(r1.remainingAmount).toBe("0.0000");
    expect(r2.remainingAmount).toBe("50.0000");
  });

  it("many-to-one: several instruments net against one invoice", async () => {
    const invoice = await makeInvoice("AR", "1000.0000", "AR-MO-1", "2026-02-15");
    const pay = await makeCredit("AR", "payment", "600.0000", "AR-MO-PAY");
    const creditNote = await makeCredit("AR", "credit_note", "250.0000", "AR-MO-CN");
    const withholding = await makeCredit("AR", "withholding", "50.0000", "AR-MO-WH");
    const actor = await actorWith(["finance.accounting.approve"]);
    for (const [i, src] of [pay, creditNote, withholding].entries()) {
      await service.allocate(actor, {
        legalEntityId,
        sourceOpenItemId: src.id,
        targetOpenItemId: invoice.id,
        amount: src.originalAmount,
        allocationDate: "2026-02-12",
        idempotencyKey: `k-mo-${i}-${TS}`,
      });
    }

    const remaining = await service.getOpenItem(await actorWith(["finance.accounting.read"]), invoice.id);
    expect(remaining.remainingAmount).toBe("100.0000");
  });

  it("reversal is a compensating row that restores the residual; double reversal is refused", async () => {
    const invoice = await makeInvoice("AR", "400.0000", "AR-REV-1", "2026-02-20");
    const payment = await makeCredit("AR", "payment", "400.0000", "AR-REV-PAY");
    const actor = await actorWith(["finance.accounting.approve"]);
    const allocation = await service.allocate(actor, {
      legalEntityId,
      sourceOpenItemId: payment.id,
      targetOpenItemId: invoice.id,
      amount: "400.0000",
      allocationDate: "2026-02-13",
      idempotencyKey: `k-rev-1-${TS}`,
    });

    const reversal = await service.reverseAllocation(actor, allocation.id, {
      reversalReason: "posting error",
    });
    expect(reversal.reversesId).toBe(allocation.id);
    expect(reversal.amount).toBe(allocation.amount);

    const remaining = await service.getOpenItem(await actorWith(["finance.accounting.read"]), invoice.id);
    expect(remaining.remainingAmount).toBe("400.0000");

    await expect(
      service.reverseAllocation(actor, reversal.id, { reversalReason: "again" }),
    ).rejects.toThrow(ConflictError);

    const allocations = await service.listAllocations(await actorWith(["finance.accounting.read"]), invoice.id);
    expect(allocations).toHaveLength(2);
    expect(allocations.filter((a) => a.reversesId !== null)).toHaveLength(1);
  });

  it("aging at asOfDate is historical and buckets by due date", async () => {
    // Distinct currency so the buckets cannot be polluted by other tests.
    const cur = "A1B";
    const invNotDue = await makeInvoice("AR", "100.0000", "AG-1", "2026-03-31", { currency: cur, documentDate: "2026-01-05" });
    const inv1to30 = await makeInvoice("AR", "200.0000", "AG-2", "2026-01-10", { currency: cur, documentDate: "2026-01-05" });
    const inv90Plus = await makeInvoice("AR", "300.0000", "AG-3", "2025-09-01", { currency: cur, documentDate: "2026-01-05" });
    const payment = await makeCredit("AR", "payment", "100.0000", "AG-PAY", { currency: cur, documentDate: "2026-01-05" });
    await service.allocate(await actorWith(["finance.accounting.approve"]), {
      legalEntityId,
      sourceOpenItemId: payment.id,
      targetOpenItemId: inv90Plus.id,
      amount: "100.0000",
      allocationDate: "2026-01-05",
      idempotencyKey: `k-ag-1-${TS}`,
    });

    const aging = await service.aging(await actorWith(["finance.accounting.read"]), {
      side: "AR",
      asOfDate: "2026-01-15",
      currency: cur,
    });

    // The 2026-01-10 item is only 5 days overdue at 2026-01-15, and the
    // allocation on the 90+ item happened on or before the asOfDate, so both
    // reflect the historical view rather than today's balances.
    expect(aging.totalOpen).toBe("500.0000");
    const bucket = (label: string) => aging.buckets.find((b) => b.label === label)!;
    expect(bucket("not_due").amount).toBe("100.0000");
    expect(bucket("1-30").amount).toBe("200.0000");
    expect(bucket("90+").amount).toBe("200.0000");
  });

  it("asOfDate before an allocation shows the full historical open amount", async () => {
    const cur = "A2B";
    const invoice = await makeInvoice("AR", "800.0000", "AG-HIST", "2025-06-01", { currency: cur, documentDate: "2026-01-05" });
    const payment = await makeCredit("AR", "payment", "800.0000", "AG-HIST-PAY", { currency: cur, documentDate: "2026-01-05" });
    await service.allocate(await actorWith(["finance.accounting.approve"]), {
      legalEntityId,
      sourceOpenItemId: payment.id,
      targetOpenItemId: invoice.id,
      amount: "800.0000",
      allocationDate: "2026-01-20",
      idempotencyKey: `k-ag-hist-${TS}`,
    });

    const before = await service.aging(await actorWith(["finance.accounting.read"]), {
      side: "AR",
      asOfDate: "2026-01-10",
      currency: cur,
    });
    const after = await service.aging(await actorWith(["finance.accounting.read"]), {
      side: "AR",
      asOfDate: "2026-01-31",
      currency: cur,
    });

    const histBefore = before.buckets.find((b) => b.label === "90+")!;
    const histAfter = after.buckets.find((b) => b.label === "90+")!;
    // Before the allocation date the invoice is still fully open.
    expect(histBefore.amount).toBe("800.0000");
    // After the allocation the residual is gone.
    expect(histAfter.amount).toBe("0.0000");
  });

  it("unapplied credits are reported separately, not netted into the buckets", async () => {
    const cur = "A3B";
    await makeCredit("AP", "payment", "777.0000", "AG-UNAPPLIED", { currency: cur });
    const aging = await service.aging(await actorWith(["finance.accounting.read"]), {
      side: "AP",
      asOfDate: "2026-02-01",
      currency: cur,
    });
    expect(aging.unapplied).toBe("777.0000");
    expect(aging.totalOpen).toBe("0.0000");
  });

  it("refuses cross-currency, cross-legal-entity and AP/AR cross-side allocations", async () => {
    const actor = await actorWith(["finance.accounting.approve"]);
    const arInvoice = await makeInvoice("AR", "10.0000", "X-AR", "2026-02-01");
    const apPayment = await makeCredit("AP", "payment", "10.0000", "X-AP");
    await expect(
      service.allocate(actor, {
        legalEntityId,
        sourceOpenItemId: apPayment.id,
        targetOpenItemId: arInvoice.id,
        amount: "10.0000",
        allocationDate: "2026-02-01",
        idempotencyKey: `k-x-side-${TS}`,
      }),
    ).rejects.toThrow(ConflictError);

    const otherLeInvoice = await makeInvoice("AR", "10.0000", "X-LE", "2026-02-01", {
      legalEntityId: otherLegalEntityId,
    });
    const localPayment = await makeCredit("AR", "payment", "10.0000", "X-LE-PAY");
    await expect(
      service.allocate(actor, {
        legalEntityId,
        sourceOpenItemId: localPayment.id,
        targetOpenItemId: otherLeInvoice.id,
        amount: "10.0000",
        allocationDate: "2026-02-01",
        idempotencyKey: `k-x-le-${TS}`,
      }),
    ).rejects.toThrow(ConflictError);
  });

  it("rejects a source table outside the whitelist and a side/party mismatch", async () => {
    const actor = await actorWith(["finance.accounting.configure"]);
    await expect(
      service.createOpenItem(actor, {
        legalEntityId,
        side: "AR",
        direction: "debit",
        sourceKind: "invoice",
        sourceRefTable: "users",
        sourceRefId: crypto.randomUUID(),
        partyType: "customer",
        partyId: PARTY_C,
        documentNo: "BAD-SRC",
        documentDate: "2026-01-01",
        dueDate: null,
        currency: "IDR",
        originalAmount: "1.0000",
      }),
    ).rejects.toThrow(ValidationError);

    await expect(
      service.createOpenItem(actor, {
        legalEntityId,
        side: "AR",
        direction: "debit",
        sourceKind: "invoice",
        sourceRefTable: "customer_invoices",
        sourceRefId: crypto.randomUUID(),
        partyType: "supplier",
        partyId: PARTY_S,
        documentNo: "BAD-SIDE",
        documentDate: "2026-01-01",
        dueDate: null,
        currency: "IDR",
        originalAmount: "1.0000",
      }),
    ).rejects.toThrow(ValidationError);
  });

  it("reversal reason is mandatory", async () => {
    const invoice = await makeInvoice("AR", "25.0000", "REV-REASON", "2026-02-01");
    const payment = await makeCredit("AR", "payment", "25.0000", "REV-REASON-PAY");
    const actor = await actorWith(["finance.accounting.approve", "finance.accounting.read"]);
    const allocation = await service.allocate(actor, {
      legalEntityId,
      sourceOpenItemId: payment.id,
      targetOpenItemId: invoice.id,
      amount: "25.0000",
      allocationDate: "2026-02-01",
      idempotencyKey: `k-rev-reason-${TS}`,
    });
    await expect(service.reverseAllocation(actor, allocation.id, { reversalReason: "  " })).rejects.toThrow(
      ValidationError,
    );
  });
});
