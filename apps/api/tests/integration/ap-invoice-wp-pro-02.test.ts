/**
 * WP-PRO-02: 3-Way Match (PO/GR/Invoice) Integration Tests
 *
 * Tests the per-line 3-way match validation gate inside createVendorInvoice.
 * Replaces WP-PRO-01's coarse header guard with real PO/GR/Invoice alignment.
 *
 * Each test gets its own isolated PO + PO line + receiving record/line via
 * `makeFixture()`, so cumulative-invoiced-quantity checks in one test never
 * leak into another. Pattern: real service, direct-DB fixtures, mocked
 * WorkflowService/EventBus/ConfigurationService, cleanup via
 * session_replication_role=replica.
 */

import { randomUUID } from "crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { pool } from "../../src/infrastructure/persistence/db.js";
import { SupplyChainAdvancedService } from "../../src/modules/supply-chain/advanced/application/supply-chain-advanced.service.js";
import { PgSupplyChainAdvancedRepository } from "../../src/modules/supply-chain/advanced/infrastructure/supply-chain-advanced.repository.pg.js";
import { PgRbacRepository } from "../../src/infrastructure/persistence/repositories/rbac.repository.pg.js";
import { PgAuditLogRepository } from "../../src/infrastructure/persistence/repositories/audit-log.repository.pg.js";
import { RbacService } from "../../src/application/rbac/rbac.service.js";
import { AuditService } from "../../src/application/audit/audit.service.js";
import type { ActorContext } from "../../src/domain/shared-kernel/audit-context.js";
import type { WorkflowService } from "../../src/application/workflow/workflow.service.js";
import type { EventBus } from "../../src/application/event/event-bus.js";
import type { ConfigurationService } from "../../src/application/configuration/configuration.service.js";

const TS = `vi-wp-pro-02-${Date.now()}`;

describe("WP-PRO-02: 3-Way Match (PO/GR/Invoice) Validation", () => {
  let tenantId: string;
  let legalEntityId: string;
  let userId: string;
  let supplierId: string;
  let itemId: string;
  let warehouseId: string;
  let coaId: string;
  let actor: ActorContext;

  let service: SupplyChainAdvancedService;
  let rbac: RbacService;
  let audit: AuditService;
  let repo: PgSupplyChainAdvancedRepository;
  let mockWorkflow: WorkflowService;
  let mockEvents: EventBus;
  let mockConfiguration: ConfigurationService;

  /**
   * Creates an isolated PO (one line) + one receiving record (one line) so
   * each test's cumulative-invoiced-quantity math starts from zero. Returns
   * the ids `createVendorInvoice` needs.
   */
  async function makeFixture(opts: {
    unitPrice: number;
    quantityOrdered?: number;
    quantityAccepted: number;
    quantityReturned?: number;
    quantityReversed?: number;
  }): Promise<{ purchaseOrderId: string; purchaseOrderLineId: string; receivingRecordId: string }> {
    const poResult = await pool.query(
      `INSERT INTO purchase_orders (tenant_id, supplier_id, order_number, issued_at, created_by, currency)
       VALUES ($1, $2, $3, now(), $4, 'IDR') RETURNING id`,
      [tenantId, supplierId, `PO-${randomUUID()}`, userId],
    );
    const purchaseOrderId = poResult.rows[0].id;

    const poLineResult = await pool.query(
      `INSERT INTO purchase_order_lines (tenant_id, purchase_order_id, item_id, quantity_ordered, unit_price)
       VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [tenantId, purchaseOrderId, itemId, opts.quantityOrdered ?? opts.quantityAccepted, opts.unitPrice],
    );
    const purchaseOrderLineId = poLineResult.rows[0].id;

    const grResult = await pool.query(
      `INSERT INTO scm_receiving_records (tenant_id, purchase_order_id, supplier_id, warehouse_id, receipt_number, idempotency_key, received_at, received_by)
       VALUES ($1, $2, $3, $4, $5, $6, now(), $7) RETURNING id`,
      [tenantId, purchaseOrderId, supplierId, warehouseId, `REC-${randomUUID()}`, `idkey-${randomUUID()}`, userId],
    );
    const receivingRecordId = grResult.rows[0].id;

    await pool.query(
      `INSERT INTO scm_receiving_lines (tenant_id, receiving_record_id, purchase_order_line_id, item_id, warehouse_id, quantity_received, quantity_accepted, quantity_returned, quantity_reversed, unit_cost, currency, account_assignment_type)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
      [
        tenantId,
        receivingRecordId,
        purchaseOrderLineId,
        itemId,
        warehouseId,
        opts.quantityAccepted,
        opts.quantityAccepted,
        opts.quantityReturned ?? 0,
        opts.quantityReversed ?? 0,
        opts.unitPrice,
        "IDR",
        "expense",
      ],
    );

    return { purchaseOrderId, purchaseOrderLineId, receivingRecordId };
  }

  /** Adds a second PO line + matching receiving line to an existing PO/GR (for multi-line tests). */
  async function addLine(
    purchaseOrderId: string,
    receivingRecordId: string,
    opts: { unitPrice: number; quantityOrdered?: number; quantityAccepted: number },
  ): Promise<string> {
    const poLineResult = await pool.query(
      `INSERT INTO purchase_order_lines (tenant_id, purchase_order_id, item_id, quantity_ordered, unit_price)
       VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [tenantId, purchaseOrderId, itemId, opts.quantityOrdered ?? opts.quantityAccepted, opts.unitPrice],
    );
    const purchaseOrderLineId = poLineResult.rows[0].id;

    await pool.query(
      `INSERT INTO scm_receiving_lines (tenant_id, receiving_record_id, purchase_order_line_id, item_id, warehouse_id, quantity_received, quantity_accepted, quantity_returned, quantity_reversed, unit_cost, currency, account_assignment_type)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 0, 0, $8, $9, $10)`,
      [tenantId, receivingRecordId, purchaseOrderLineId, itemId, warehouseId, opts.quantityAccepted, opts.quantityAccepted, opts.unitPrice, "IDR", "expense"],
    );

    return purchaseOrderLineId;
  }

  beforeAll(async () => {
    let result = await pool.query(
      `INSERT INTO tenants (code, name) VALUES ($1, '3-Way Match Test') RETURNING id`,
      [TS],
    );
    tenantId = result.rows[0].id;

    result = await pool.query(
      `INSERT INTO legal_entities (tenant_id, name) VALUES ($1, 'Test LE') RETURNING id`,
      [tenantId],
    );
    legalEntityId = result.rows[0].id;

    result = await pool.query(
      `INSERT INTO users (tenant_id, email, password_hash, full_name, status)
       VALUES ($1, $2, 'x', $2, 'active') RETURNING id`,
      [tenantId, `${TS}-user@test.local`],
    );
    userId = result.rows[0].id;

    result = await pool.query(
      `INSERT INTO roles (tenant_id, code, name) VALUES ($1, 'VINVOICE', 'Vendor Invoice') RETURNING id`,
      [tenantId],
    );
    const roleId = result.rows[0].id;

    await pool.query(
      `INSERT INTO role_permissions (role_id, permission_id)
       SELECT $1, p.id FROM permissions p
       WHERE p.code = ANY($2)`,
      [roleId, ['supply_chain.vendor_invoice.read', 'supply_chain.vendor_invoice.manage', 'supply_chain.vendor_invoice.approve']],
    );

    result = await pool.query(
      `INSERT INTO user_role_assignments (user_id, role_id, scope_type)
       VALUES ($1, $2, 'tenant') RETURNING id`,
      [userId, roleId],
    );
    const assignmentId = result.rows[0].id;

    actor = {
      userId,
      tenantId,
      sessionId: randomUUID(),
      assignmentId,
      roleId,
      roleCode: "VINVOICE",
      scopeType: "tenant",
      scopeLegalEntityId: null,
      scopeOrganizationUnitId: null,
      scopeCustomerId: null,
    };

    result = await pool.query(
      `INSERT INTO suppliers (tenant_id, code, name)
       VALUES ($1, $2, $3) RETURNING id`,
      [tenantId, "SUP-PRO02", "Test Supplier"],
    );
    supplierId = result.rows[0].id;

    result = await pool.query(
      `INSERT INTO items (tenant_id, code, name, unit_of_measure)
       VALUES ($1, $2, $3, $4) RETURNING id`,
      [tenantId, "ITEM-PRO02", "Test Item", "pcs"],
    );
    itemId = result.rows[0].id;

    result = await pool.query(
      `INSERT INTO scm_warehouses (tenant_id, code, name)
       VALUES ($1, $2, $3) RETURNING id`,
      [tenantId, "WH-PRO02", "Test Warehouse"],
    );
    warehouseId = result.rows[0].id;

    result = await pool.query(
      `INSERT INTO chart_of_accounts (tenant_id, legal_entity_id, coa_version_code, coa_version_date, is_active, created_by)
       VALUES ($1, $2, $3, $4, true, $5) RETURNING id`,
      [tenantId, legalEntityId, "FY2026", "2026-01-01", userId],
    );
    coaId = result.rows[0].id;

    await pool.query(
      `INSERT INTO accounting_accounts (tenant_id, legal_entity_id, coa_id, account_code, account_name, account_class, normal_balance, is_active, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, true, $8)`,
      [tenantId, legalEntityId, coaId, "2101", "Accounts Payable", "LIABILITY", "credit", userId],
    );
    await pool.query(
      `INSERT INTO accounting_accounts (tenant_id, legal_entity_id, coa_id, account_code, account_name, account_class, normal_balance, is_active, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, true, $8)`,
      [tenantId, legalEntityId, coaId, "6101", "Expense", "EXPENSE", "debit", userId],
    );

    repo = new PgSupplyChainAdvancedRepository(pool);
    rbac = new RbacService(new PgRbacRepository(pool));
    audit = new AuditService(new PgAuditLogRepository(pool));

    let workflowDefId = "";
    let workflowVersionId = "";
    let initialStepId = "";
    {
      let res = await pool.query(
        `INSERT INTO workflow_definitions (tenant_id, code, name, entity_type, description)
         VALUES ($1, $2, $3, $4, $5) RETURNING id`,
        [tenantId, "scm_vendor_invoice", "Vendor Invoice Approval", "scm_vendor_invoice", "AP invoice approval workflow"],
      );
      workflowDefId = res.rows[0].id;

      res = await pool.query(
        `INSERT INTO workflow_versions (workflow_definition_id, version_number, status, is_current)
         VALUES ($1, 1, 'published', true) RETURNING id`,
        [workflowDefId],
      );
      workflowVersionId = res.rows[0].id;

      res = await pool.query(
        `INSERT INTO workflow_steps (workflow_version_id, code, name, step_type, is_initial, sequence_order)
         VALUES ($1, $2, $3, $4, true, 0) RETURNING id`,
        [workflowVersionId, "initial", "Initial Submission", "task"],
      );
      initialStepId = res.rows[0].id;
    }

    mockWorkflow = {
      startInstance: async (_actor: any, input: any) => {
        const res = await pool.query(
          `INSERT INTO workflow_instances (tenant_id, workflow_definition_id, workflow_version_id, entity_type, entity_id, current_step_id, context_data, started_by)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
          [tenantId, workflowDefId, workflowVersionId, input.definitionCode, input.entityId, initialStepId, input.contextData || {}, userId],
        );
        return { instance: { id: res.rows[0].id } } as any;
      },
      getInstanceForEntityOwner: async (_tenantId: string, instanceId: string) => ({
        instance: { id: instanceId },
        assignments: [{ id: randomUUID(), status: "pending" } as any],
        currentStep: null,
        history: [],
      }),
      actOnAssignment: async () => undefined,
      getEntityStatus: async () => ({
        instanceStatus: "approved",
        currentStepCode: "final",
        currentStepName: "Final",
        pendingActionCode: null,
        pendingAssignment: null,
      } as any),
      getEntityStatuses: async () => [],
      listVersions: async () => [],
      createVersion: async () => ({ versionNumber: 1 } as any),
      publishVersion: async () => undefined,
      updateStep: async () => undefined,
      removeStep: async () => undefined,
      addTransition: async () => undefined,
      removeTransition: async () => undefined,
    } as unknown as WorkflowService;

    mockEvents = {
      publish: async () => undefined,
      subscribe: () => undefined,
    } as unknown as EventBus;

    mockConfiguration = {
      generateNumberForTenant: async () => ({
        number: `INV${Date.now()}`,
        sequence: 1,
      }),
    } as unknown as ConfigurationService;

    service = new SupplyChainAdvancedService(
      repo,
      rbac,
      audit,
      mockWorkflow,
      mockEvents,
      mockConfiguration,
    );
  });

  afterAll(async () => {
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

  // ============================================================================
  // TEST 1: Exact Match (qty=accepted, price=PO) → Create OK
  // ============================================================================
  it("TEST 1: exact match (qty=accepted, price=PO) → create OK", async () => {
    const fx = await makeFixture({ unitPrice: 10000, quantityAccepted: 100 });

    const { vendorInvoice, lines } = await service.createVendorInvoice(actor, {
      invoiceNumber: `INV${Date.now()}001`,
      idempotencyKey: `${randomUUID()}:1`,
      purchaseOrderId: fx.purchaseOrderId,
      receivingRecordId: fx.receivingRecordId,
      supplierId,
      invoiceAmount: 1000000,
      currency: "IDR",
      lines: [
        {
          purchaseOrderLineId: fx.purchaseOrderLineId,
          description: "Test item",
          quantityInvoiced: 100,
          unitPrice: 10000,
          currency: "IDR",
          lineAmount: 1000000,
        },
      ],
    });

    expect(vendorInvoice.status).toBe("draft");
    expect(lines.length).toBe(1);
    expect(lines[0].quantityInvoiced).toBe(100);
    expect(lines[0].unitPrice).toBe(10000);
  });

  // ============================================================================
  // TEST 2: Partial Invoicing → Two Invoices Totaling Accepted Qty Both OK
  // ============================================================================
  it("TEST 2: partial invoicing: two invoices totaling accepted qty → both OK", async () => {
    const fx = await makeFixture({ unitPrice: 10000, quantityAccepted: 100 });

    const first = await service.createVendorInvoice(actor, {
      invoiceNumber: `INV${Date.now()}002A`,
      idempotencyKey: `${randomUUID()}:2a`,
      purchaseOrderId: fx.purchaseOrderId,
      receivingRecordId: fx.receivingRecordId,
      supplierId,
      invoiceAmount: 500000,
      currency: "IDR",
      lines: [
        {
          purchaseOrderLineId: fx.purchaseOrderLineId,
          description: "Part 1",
          quantityInvoiced: 50,
          unitPrice: 10000,
          currency: "IDR",
          lineAmount: 500000,
        },
      ],
    });

    const second = await service.createVendorInvoice(actor, {
      invoiceNumber: `INV${Date.now()}002B`,
      idempotencyKey: `${randomUUID()}:2b`,
      purchaseOrderId: fx.purchaseOrderId,
      receivingRecordId: fx.receivingRecordId,
      supplierId,
      invoiceAmount: 500000,
      currency: "IDR",
      lines: [
        {
          purchaseOrderLineId: fx.purchaseOrderLineId,
          description: "Part 2",
          quantityInvoiced: 50,
          unitPrice: 10000,
          currency: "IDR",
          lineAmount: 500000,
        },
      ],
    });

    expect(first.vendorInvoice.status).toBe("draft");
    expect(second.vendorInvoice.status).toBe("draft");
    expect(first.vendorInvoice.id).not.toBe(second.vendorInvoice.id);
  });

  // ============================================================================
  // TEST 3: Over-Invoiced Qty (Cumulative > Accepted) → ValidationError
  // ============================================================================
  it("TEST 3: over-invoiced qty (cumulative > accepted) → ValidationError", async () => {
    const fx = await makeFixture({ unitPrice: 10000, quantityAccepted: 100 });

    expect.assertions(1);
    try {
      await service.createVendorInvoice(actor, {
        invoiceNumber: `INV${Date.now()}003`,
        idempotencyKey: `${randomUUID()}:3`,
        purchaseOrderId: fx.purchaseOrderId,
        receivingRecordId: fx.receivingRecordId,
        supplierId,
        invoiceAmount: 1100000,
        currency: "IDR",
        lines: [
          {
            purchaseOrderLineId: fx.purchaseOrderLineId,
            description: "Over qty",
            quantityInvoiced: 110,
            unitPrice: 10000,
            currency: "IDR",
            lineAmount: 1100000,
          },
        ],
      });
      expect.fail("Should reject over-invoiced qty");
    } catch (err: unknown) {
      expect((err as Error).message).toMatch(/exceed|accepted-eligible|cumulative/i);
    }
  });

  // ============================================================================
  // TEST 4: Rejected Invoice Excluded from Cumulative → OK
  // ============================================================================
  it("TEST 4: rejected invoice doesn't consume quantity → OK", async () => {
    const fx = await makeFixture({ unitPrice: 10000, quantityAccepted: 100 });

    const rejected = await service.createVendorInvoice(actor, {
      invoiceNumber: `INV${Date.now()}004A`,
      idempotencyKey: `${randomUUID()}:4a`,
      purchaseOrderId: fx.purchaseOrderId,
      receivingRecordId: fx.receivingRecordId,
      supplierId,
      invoiceAmount: 500000,
      currency: "IDR",
      lines: [
        {
          purchaseOrderLineId: fx.purchaseOrderLineId,
          description: "Will be rejected",
          quantityInvoiced: 50,
          unitPrice: 10000,
          currency: "IDR",
          lineAmount: 500000,
        },
      ],
    });

    await pool.query(
      `UPDATE scm_vendor_invoices SET status = $1, rejected_at = now(), rejected_by = $2
       WHERE id = $3`,
      ["rejected", actor.userId, rejected.vendorInvoice.id],
    );

    // Full 100 qty should now succeed — the rejected 50 must not count.
    const next = await service.createVendorInvoice(actor, {
      invoiceNumber: `INV${Date.now()}004B`,
      idempotencyKey: `${randomUUID()}:4b`,
      purchaseOrderId: fx.purchaseOrderId,
      receivingRecordId: fx.receivingRecordId,
      supplierId,
      invoiceAmount: 1000000,
      currency: "IDR",
      lines: [
        {
          purchaseOrderLineId: fx.purchaseOrderLineId,
          description: "Full qty",
          quantityInvoiced: 100,
          unitPrice: 10000,
          currency: "IDR",
          lineAmount: 1000000,
        },
      ],
    });

    expect(next.vendorInvoice.status).toBe("draft");
  });

  // ============================================================================
  // TEST 5: Cancelled Invoice Excluded → OK
  // ============================================================================
  it("TEST 5: cancelled invoice doesn't consume quantity → OK", async () => {
    const fx = await makeFixture({ unitPrice: 10000, quantityAccepted: 100 });

    const cancelled = await service.createVendorInvoice(actor, {
      invoiceNumber: `INV${Date.now()}005A`,
      idempotencyKey: `${randomUUID()}:5a`,
      purchaseOrderId: fx.purchaseOrderId,
      receivingRecordId: fx.receivingRecordId,
      supplierId,
      invoiceAmount: 300000,
      currency: "IDR",
      lines: [
        {
          purchaseOrderLineId: fx.purchaseOrderLineId,
          description: "Will be cancelled",
          quantityInvoiced: 30,
          unitPrice: 10000,
          currency: "IDR",
          lineAmount: 300000,
        },
      ],
    });

    await pool.query(
      `UPDATE scm_vendor_invoices SET status = $1 WHERE id = $2`,
      ["cancelled", cancelled.vendorInvoice.id],
    );

    // Full 100 qty should succeed — the cancelled 30 must not count.
    const next = await service.createVendorInvoice(actor, {
      invoiceNumber: `INV${Date.now()}005B`,
      idempotencyKey: `${randomUUID()}:5b`,
      purchaseOrderId: fx.purchaseOrderId,
      receivingRecordId: fx.receivingRecordId,
      supplierId,
      invoiceAmount: 1000000,
      currency: "IDR",
      lines: [
        {
          purchaseOrderLineId: fx.purchaseOrderLineId,
          description: "Full qty",
          quantityInvoiced: 100,
          unitPrice: 10000,
          currency: "IDR",
          lineAmount: 1000000,
        },
      ],
    });

    expect(next.vendorInvoice.status).toBe("draft");
  });

  // ============================================================================
  // TEST 6: Price Deviation > 0.5% → ValidationError
  // ============================================================================
  it("TEST 6: price deviation >0.5% → ValidationError", async () => {
    const fx = await makeFixture({ unitPrice: 10000, quantityAccepted: 100 });

    expect.assertions(1);
    try {
      // PO price 10000, invoice price 10100 (1% deviation)
      await service.createVendorInvoice(actor, {
        invoiceNumber: `INV${Date.now()}006`,
        idempotencyKey: `${randomUUID()}:6`,
        purchaseOrderId: fx.purchaseOrderId,
        receivingRecordId: fx.receivingRecordId,
        supplierId,
        invoiceAmount: 1010000,
        currency: "IDR",
        lines: [
          {
            purchaseOrderLineId: fx.purchaseOrderLineId,
            description: "Price too high",
            quantityInvoiced: 100,
            unitPrice: 10100,
            currency: "IDR",
            lineAmount: 1010000,
          },
        ],
      });
      expect.fail("Should reject price deviation >0.5%");
    } catch (err: unknown) {
      expect((err as Error).message).toMatch(/price|differ|0\.5%/i);
    }
  });

  // ============================================================================
  // TEST 7: Price Deviation ≤ 0.5% (Rounding) → OK
  // ============================================================================
  it("TEST 7: price deviation ≤0.5% (rounding) → OK", async () => {
    const fx = await makeFixture({ unitPrice: 10000, quantityAccepted: 100 });

    // PO price 10000, invoice price 10050 (exactly 0.5%)
    const { vendorInvoice } = await service.createVendorInvoice(actor, {
      invoiceNumber: `INV${Date.now()}007`,
      idempotencyKey: `${randomUUID()}:7`,
      purchaseOrderId: fx.purchaseOrderId,
      receivingRecordId: fx.receivingRecordId,
      supplierId,
      invoiceAmount: 1005000,
      currency: "IDR",
      lines: [
        {
          purchaseOrderLineId: fx.purchaseOrderLineId,
          description: "Rounding OK",
          quantityInvoiced: 100,
          unitPrice: 10050,
          currency: "IDR",
          lineAmount: 1005000,
        },
      ],
    });

    expect(vendorInvoice.status).toBe("draft");
  });

  // ============================================================================
  // TEST 8: lineAmount ≠ qty × price → ValidationError
  // ============================================================================
  it("TEST 8: lineAmount ≠ qty × price → ValidationError", async () => {
    const fx = await makeFixture({ unitPrice: 10000, quantityAccepted: 100 });

    expect.assertions(1);
    try {
      await service.createVendorInvoice(actor, {
        invoiceNumber: `INV${Date.now()}008`,
        idempotencyKey: `${randomUUID()}:8`,
        purchaseOrderId: fx.purchaseOrderId,
        receivingRecordId: fx.receivingRecordId,
        supplierId,
        invoiceAmount: 1000001,
        currency: "IDR",
        lines: [
          {
            purchaseOrderLineId: fx.purchaseOrderLineId,
            description: "Bad line amount",
            quantityInvoiced: 100,
            unitPrice: 10000,
            currency: "IDR",
            lineAmount: 1000001,
          },
        ],
      });
      expect.fail("Should reject incorrect lineAmount");
    } catch (err: unknown) {
      expect((err as Error).message).toMatch(/lineAmount|does not match/i);
    }
  });

  // ============================================================================
  // TEST 9: Header Amount ≠ Σ Lines → ValidationError
  // ============================================================================
  it("TEST 9: header amount ≠ Σ lines → ValidationError", async () => {
    const fx = await makeFixture({ unitPrice: 10000, quantityAccepted: 100 });

    expect.assertions(1);
    try {
      await service.createVendorInvoice(actor, {
        invoiceNumber: `INV${Date.now()}009`,
        idempotencyKey: `${randomUUID()}:9`,
        purchaseOrderId: fx.purchaseOrderId,
        receivingRecordId: fx.receivingRecordId,
        supplierId,
        invoiceAmount: 600000, // mismatch vs line sum (500000)
        currency: "IDR",
        lines: [
          {
            purchaseOrderLineId: fx.purchaseOrderLineId,
            description: "Single line",
            quantityInvoiced: 50,
            unitPrice: 10000,
            currency: "IDR",
            lineAmount: 500000,
          },
        ],
      });
      expect.fail("Should reject header/line mismatch");
    } catch (err: unknown) {
      expect((err as Error).message).toMatch(/header|sum of line/i);
    }
  });

  // ============================================================================
  // TEST 10: PO Line from Another PO → ValidationError
  // ============================================================================
  it("TEST 10: PO line from another PO → ValidationError", async () => {
    const fx = await makeFixture({ unitPrice: 10000, quantityAccepted: 100 });
    const otherFx = await makeFixture({ unitPrice: 5000, quantityAccepted: 50 });

    expect.assertions(1);
    try {
      // References fx's PO but otherFx's PO line
      await service.createVendorInvoice(actor, {
        invoiceNumber: `INV${Date.now()}010`,
        idempotencyKey: `${randomUUID()}:10`,
        purchaseOrderId: fx.purchaseOrderId,
        receivingRecordId: fx.receivingRecordId,
        supplierId,
        invoiceAmount: 500000,
        currency: "IDR",
        lines: [
          {
            purchaseOrderLineId: otherFx.purchaseOrderLineId,
            description: "Wrong PO line",
            quantityInvoiced: 50,
            unitPrice: 10000,
            currency: "IDR",
            lineAmount: 500000,
          },
        ],
      });
      expect.fail("Should reject PO line from another PO");
    } catch (err: unknown) {
      expect((err as Error).message).toMatch(/not found|not in PO/i);
    }
  });

  // ============================================================================
  // TEST 11: Returned/Reversed Qty Reduces Eligible Qty → ValidationError on Exceed
  // ============================================================================
  it("TEST 11: returned/reversed quantity reduces eligible qty → ValidationError when exceeding", async () => {
    // accepted=60, returned=20 → eligible = 40
    const fx = await makeFixture({ unitPrice: 10000, quantityAccepted: 60, quantityReturned: 20 });

    // Exact eligible qty (40) must pass
    const ok = await service.createVendorInvoice(actor, {
      invoiceNumber: `INV${Date.now()}011A`,
      idempotencyKey: `${randomUUID()}:11a`,
      purchaseOrderId: fx.purchaseOrderId,
      receivingRecordId: fx.receivingRecordId,
      supplierId,
      invoiceAmount: 400000,
      currency: "IDR",
      lines: [
        {
          purchaseOrderLineId: fx.purchaseOrderLineId,
          description: "Exactly eligible",
          quantityInvoiced: 40,
          unitPrice: 10000,
          currency: "IDR",
          lineAmount: 400000,
        },
      ],
    });
    expect(ok.vendorInvoice.status).toBe("draft");

    // One more unit must be rejected — eligible qty is exhausted.
    expect.assertions(2);
    try {
      await service.createVendorInvoice(actor, {
        invoiceNumber: `INV${Date.now()}011B`,
        idempotencyKey: `${randomUUID()}:11b`,
        purchaseOrderId: fx.purchaseOrderId,
        receivingRecordId: fx.receivingRecordId,
        supplierId,
        invoiceAmount: 10000,
        currency: "IDR",
        lines: [
          {
            purchaseOrderLineId: fx.purchaseOrderLineId,
            description: "Exceeds returned-reduced eligible",
            quantityInvoiced: 1,
            unitPrice: 10000,
            currency: "IDR",
            lineAmount: 10000,
          },
        ],
      });
      expect.fail("Should reject exceeding returned-reduced eligible qty");
    } catch (err: unknown) {
      expect((err as Error).message).toMatch(/exceed|accepted-eligible|cumulative/i);
    }
  });

  // ============================================================================
  // TEST 12: Multi-Line Invoice with Mixed Validation
  // ============================================================================
  it("TEST 12: multi-line invoice with mixed validation", async () => {
    const fx = await makeFixture({ unitPrice: 10000, quantityAccepted: 100 });
    const poLine2Id = await addLine(fx.purchaseOrderId, fx.receivingRecordId, {
      unitPrice: 20000,
      quantityAccepted: 50,
    });

    const { vendorInvoice, lines } = await service.createVendorInvoice(actor, {
      invoiceNumber: `INV${Date.now()}012`,
      idempotencyKey: `${randomUUID()}:12`,
      purchaseOrderId: fx.purchaseOrderId,
      receivingRecordId: fx.receivingRecordId,
      supplierId,
      invoiceAmount: 2000000,
      currency: "IDR",
      lines: [
        {
          purchaseOrderLineId: fx.purchaseOrderLineId,
          description: "First PO line",
          quantityInvoiced: 100,
          unitPrice: 10000,
          currency: "IDR",
          lineAmount: 1000000,
        },
        {
          purchaseOrderLineId: poLine2Id,
          description: "Second PO line",
          quantityInvoiced: 50,
          unitPrice: 20000,
          currency: "IDR",
          lineAmount: 1000000,
        },
      ],
    });

    expect(vendorInvoice.status).toBe("draft");
    expect(lines.length).toBe(2);
  });

  // ============================================================================
  // TEST 13: Concurrent Invoicing (TOCTOU Race Guard)
  // ============================================================================
  it("TEST 13: concurrent invoices each requesting full qty (TOCTOU guard) → one OK, one fails", async () => {
    const fx = await makeFixture({ unitPrice: 10000, quantityAccepted: 100 });

    // Fire both invoices concurrently with distinct idempotency keys, each requesting 100% of accepted qty.
    // The lock-inside-transaction ensures only ONE will successfully read cumulative=0 and pass Rule 2.
    const [result1, result2] = await Promise.allSettled([
      service.createVendorInvoice(actor, {
        invoiceNumber: `INV${Date.now()}013A`,
        idempotencyKey: `${randomUUID()}:13a`,
        purchaseOrderId: fx.purchaseOrderId,
        receivingRecordId: fx.receivingRecordId,
        supplierId,
        invoiceAmount: 1000000,
        currency: "IDR",
        lines: [
          {
            purchaseOrderLineId: fx.purchaseOrderLineId,
            description: "Concurrent 1",
            quantityInvoiced: 100,
            unitPrice: 10000,
            currency: "IDR",
            lineAmount: 1000000,
          },
        ],
      }),
      service.createVendorInvoice(actor, {
        invoiceNumber: `INV${Date.now()}013B`,
        idempotencyKey: `${randomUUID()}:13b`,
        purchaseOrderId: fx.purchaseOrderId,
        receivingRecordId: fx.receivingRecordId,
        supplierId,
        invoiceAmount: 1000000,
        currency: "IDR",
        lines: [
          {
            purchaseOrderLineId: fx.purchaseOrderLineId,
            description: "Concurrent 2",
            quantityInvoiced: 100,
            unitPrice: 10000,
            currency: "IDR",
            lineAmount: 1000000,
          },
        ],
      }),
    ]);

    // One should succeed
    const successes = [result1, result2].filter((r) => r.status === "fulfilled");
    expect(successes.length).toBe(1);

    // One should fail with cumulative qty exceeded
    const failures = [result1, result2].filter((r) => r.status === "rejected");
    expect(failures.length).toBe(1);
    expect((failures[0] as PromiseRejectedResult).reason.message).toMatch(/cumulative invoiced qty|exceeds GR/i);
  });

  // ============================================================================
  // TEST 14: PO Currency Mismatch
  // ============================================================================
  it("TEST 14: PO currency (IDR) vs invoice currency (USD) mismatch → ValidationError", async () => {
    const fx = await makeFixture({ unitPrice: 10000, quantityAccepted: 100 });

    await expect(
      service.createVendorInvoice(actor, {
        invoiceNumber: `INV${Date.now()}014`,
        idempotencyKey: `${randomUUID()}:14`,
        purchaseOrderId: fx.purchaseOrderId,
        receivingRecordId: fx.receivingRecordId,
        supplierId,
        invoiceAmount: 1000000,
        currency: "USD",
        lines: [
          {
            purchaseOrderLineId: fx.purchaseOrderLineId,
            description: "Wrong currency",
            quantityInvoiced: 100,
            unitPrice: 10000,
            currency: "USD",
            lineAmount: 1000000,
          },
        ],
      }),
    ).rejects.toThrow(/currency.*does not match.*IDR/i);
  });
});
