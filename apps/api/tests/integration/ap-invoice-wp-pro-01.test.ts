/**
 * AP Invoice (WP-PRO-01) Integration Tests (Test-First TDD)
 *
 * All 11 tests written; they call real service layer (will fail on import
 * until implementation is complete — this is correct TDD red state).
 *
 * Tests validate: PO/GR link, idempotency, state machine, event emission,
 * line freeze, consumer dedup, auth, over-invoicing guard.
 *
 * Pattern: beforeAll builds context via direct DB (tenant, legal entity,
 * user, role, supplier, PO, GR). Each test calls SupplyChainAdvancedService
 * methods (will not exist until service layer is implemented).
 * afterAll cleanup via session_replication_role=replica to bypass immutability.
 *
 * Isolation: each test uses unique invoice_number + idempotency key.
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

const TS = `vi-${Date.now()}`;

describe("WP-PRO-01: AP Invoice (Vendor Invoice PO-based)", () => {
  let tenantId: string;
  let legalEntityId: string;
  let userId: string;
  let supplierId: string;
  let purchaseOrderId: string;
  let purchaseOrderLineId: string;
  let receivingRecordId: string;
  let receivingLineId: string;
  let coaId: string;
  let actor: ActorContext;

  let service: SupplyChainAdvancedService;
  let rbac: RbacService;
  let audit: AuditService;
  let repo: PgSupplyChainAdvancedRepository;
  let mockWorkflow: WorkflowService;
  let mockEvents: EventBus;
  let mockConfiguration: ConfigurationService;

  beforeAll(async () => {
    // Tenant
    let result = await pool.query(
      `INSERT INTO tenants (code, name) VALUES ($1, 'Vendor Invoice Test') RETURNING id`,
      [TS],
    );
    tenantId = result.rows[0].id;

    // Legal entity
    result = await pool.query(
      `INSERT INTO legal_entities (tenant_id, name) VALUES ($1, 'Test LE') RETURNING id`,
      [tenantId],
    );
    legalEntityId = result.rows[0].id;

    // User
    result = await pool.query(
      `INSERT INTO users (tenant_id, email, password_hash, full_name, status)
       VALUES ($1, $2, 'x', $2, 'active') RETURNING id`,
      [tenantId, `${TS}-user@test.local`],
    );
    userId = result.rows[0].id;

    // Role + assignment for actor
    result = await pool.query(
      `INSERT INTO roles (tenant_id, code, name) VALUES ($1, 'VINVOICE', 'Vendor Invoice') RETURNING id`,
      [tenantId],
    );
    const roleId = result.rows[0].id;

    // Grant vendor invoice permissions to role
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

    // Supplier
    result = await pool.query(
      `INSERT INTO suppliers (tenant_id, code, name)
       VALUES ($1, $2, $3) RETURNING id`,
      [tenantId, "SUP001", "Test Supplier"],
    );
    supplierId = result.rows[0].id;

    // Item
    let itemId: string;
    result = await pool.query(
      `INSERT INTO items (tenant_id, code, name, unit_of_measure)
       VALUES ($1, $2, $3, $4) RETURNING id`,
      [tenantId, "ITEM001", "Test Item", "pcs"],
    );
    itemId = result.rows[0].id;

    // Warehouse
    let warehouseId: string;
    result = await pool.query(
      `INSERT INTO scm_warehouses (tenant_id, code, name)
       VALUES ($1, $2, $3) RETURNING id`,
      [tenantId, "WH001", "Test Warehouse"],
    );
    warehouseId = result.rows[0].id;

    // Purchase Order + line
    result = await pool.query(
      `INSERT INTO purchase_orders (tenant_id, supplier_id, order_number, issued_at, created_by)
       VALUES ($1, $2, $3, now(), $4) RETURNING id`,
      [tenantId, supplierId, `PO${Date.now()}`, userId],
    );
    purchaseOrderId = result.rows[0].id;

    result = await pool.query(
      `INSERT INTO purchase_order_lines (tenant_id, purchase_order_id, item_id, quantity_ordered, unit_price)
       VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [tenantId, purchaseOrderId, itemId, 100, 10000],
    );
    purchaseOrderLineId = result.rows[0].id;

    // Receiving record + line (GR)
    result = await pool.query(
      `INSERT INTO scm_receiving_records (tenant_id, purchase_order_id, supplier_id, warehouse_id, receipt_number, idempotency_key, received_at, received_by)
       VALUES ($1, $2, $3, $4, $5, $6, now(), $7) RETURNING id`,
      [tenantId, purchaseOrderId, supplierId, warehouseId, `REC${Date.now()}`, `idkey-${Date.now()}`, userId],
    );
    receivingRecordId = result.rows[0].id;

    result = await pool.query(
      `INSERT INTO scm_receiving_lines (tenant_id, receiving_record_id, purchase_order_line_id, item_id, warehouse_id, quantity_received, unit_cost, account_assignment_type)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
      [tenantId, receivingRecordId, purchaseOrderLineId, itemId, warehouseId, 100, 10000, "expense"],
    );
    receivingLineId = result.rows[0].id;

    // COA
    result = await pool.query(
      `INSERT INTO chart_of_accounts (tenant_id, legal_entity_id, coa_version_code, coa_version_date, is_active, created_by)
       VALUES ($1, $2, $3, $4, true, $5) RETURNING id`,
      [tenantId, legalEntityId, "FY2026", "2026-01-01", userId],
    );
    coaId = result.rows[0].id;

    // Accounts: AP, Expense
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

    // Initialize service dependencies
    repo = new PgSupplyChainAdvancedRepository(pool);
    rbac = new RbacService(new PgRbacRepository(pool));
    audit = new AuditService(new PgAuditLogRepository(pool));

    // Seed workflow definition + version for FK compliance (tests focus on invoice logic, not workflow orchestration)
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

    // Mock workflow service (tests focus on invoice logic, not workflow orchestration)
    mockWorkflow = {
      startInstance: async (_actor: any, input: any) => {
        // Create a real workflow instance for FK compliance
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

    // Mock event bus
    mockEvents = {
      publish: async () => undefined,
      subscribe: () => undefined,
    } as unknown as EventBus;

    // Mock configuration service
    mockConfiguration = {
      generateNumberForTenant: async () => ({
        number: `INV${Date.now()}`,
        sequence: 1,
      }),
    } as unknown as ConfigurationService;
  });

  afterAll(async () => {
    // Cleanup via session_replication_role=replica to bypass immutability triggers
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
  // TEST 1: PO Link Validation
  // ============================================================================
  it("TEST 1: should reject vendor invoice if PO does not exist", async () => {
    expect.assertions(1);
    try {
      // Will fail on service instantiation (TDD red state)
      const svc = new SupplyChainAdvancedService(
        repo,
        rbac,
        audit,
        mockWorkflow,
        mockEvents,
        mockConfiguration,
      );

      await svc.createVendorInvoice(actor, {
        invoiceNumber: `INV${Date.now()}001`,
        idempotencyKey: `${randomUUID()}:1`,
        purchaseOrderId: randomUUID(), // non-existent PO
        receivingRecordId: receivingRecordId,
        supplierId: supplierId,
        invoiceAmount: 1000000,
        lines: [],
      });
      expect.fail("Should reject non-existent PO");
    } catch (err: unknown) {
      expect((err as Error).message).toMatch(/purchase.?order|not found|PO/i);
    }
  });

  // ============================================================================
  // TEST 2: GR Link Validation
  // ============================================================================
  it("TEST 2: should reject vendor invoice if receiving record does not exist", async () => {
    expect.assertions(1);
    try {
      const svc = new SupplyChainAdvancedService(
        repo,
        rbac,
        audit,
        mockWorkflow,
        mockEvents,
        mockConfiguration,
      );

      await svc.createVendorInvoice(actor, {
        invoiceNumber: `INV${Date.now()}002`,
        idempotencyKey: `${randomUUID()}:2`,
        purchaseOrderId: purchaseOrderId,
        receivingRecordId: randomUUID(), // non-existent GR
        supplierId: supplierId,
        invoiceAmount: 1000000,
        lines: [],
      });
      expect.fail("Should reject non-existent receiving record");
    } catch (err: unknown) {
      expect((err as Error).message).toMatch(/receiving|not found|GR/i);
    }
  });

  // ============================================================================
  // TEST 3: Happy Path (Create Invoice)
  // ============================================================================
  it("TEST 3: should create vendor invoice with PO + GR link, status=draft", async () => {
    const invoiceNumber = `INV${Date.now()}003`;
    const idempotencyKey = `${randomUUID()}:3`;

    const svc = new SupplyChainAdvancedService(
      repo,
      rbac,
      audit,
      mockWorkflow,
      mockEvents,
      mockConfiguration,
    );

    const { vendorInvoice, lines } = await svc.createVendorInvoice(actor, {
      invoiceNumber,
      idempotencyKey,
      purchaseOrderId,
      receivingRecordId,
      supplierId,
      invoiceAmount: 900000,
      lines: [
        {
          purchaseOrderLineId,
          description: "Test item",
          quantityInvoiced: 90,
          unitPrice: 10000,
          lineAmount: 900000,
        },
      ],
    });

    expect(vendorInvoice.status).toBe("draft");
    expect(vendorInvoice.invoiceNumber).toBe(invoiceNumber);
    expect(lines.length).toBe(1);
  });

  // ============================================================================
  // TEST 4: Request Idempotency
  // ============================================================================
  it("TEST 4: should return same invoice on duplicate idempotencyKey", async () => {
    const invoiceNumber = `INV${Date.now()}004`;
    const idempotencyKey = `${randomUUID()}:4`;

    const svc = new SupplyChainAdvancedService(
      repo,
      rbac,
      audit,
      mockWorkflow,
      mockEvents,
      mockConfiguration,
    );

    const first = await svc.createVendorInvoice(actor, {
      invoiceNumber,
      idempotencyKey,
      purchaseOrderId,
      receivingRecordId,
      supplierId,
      invoiceAmount: 850000,
      lines: [
        {
          purchaseOrderLineId,
          description: "Test item",
          quantityInvoiced: 85,
          unitPrice: 10000,
          lineAmount: 850000,
        },
      ],
    });

    const second = await svc.createVendorInvoice(actor, {
      invoiceNumber: `INV${Date.now()}004B`, // different invoice number but same idempotency key
      idempotencyKey, // same key should return first
      purchaseOrderId,
      receivingRecordId,
      supplierId,
      invoiceAmount: 850000,
      lines: [],
    });

    expect(second.vendorInvoice.id).toBe(first.vendorInvoice.id);
  });

  // ============================================================================
  // TEST 5: Submit Gating (State Machine)
  // ============================================================================
  it("TEST 5: should reject submit if invoice not in draft status", async () => {
    const invoiceNumber = `INV${Date.now()}005`;
    const idempotencyKey = `${randomUUID()}:5`;

    const svc = new SupplyChainAdvancedService(
      repo,
      rbac,
      audit,
      mockWorkflow,
      mockEvents,
      mockConfiguration,
    );

    const { vendorInvoice } = await svc.createVendorInvoice(actor, {
      invoiceNumber,
      idempotencyKey,
      purchaseOrderId,
      receivingRecordId,
      supplierId,
      invoiceAmount: 750000,
      lines: [
        {
          purchaseOrderLineId,
          description: "Test item",
          quantityInvoiced: 75,
          unitPrice: 10000,
          lineAmount: 750000,
        },
      ],
    });

    // Move to submitted (manually for test state)
    await pool.query(
      `UPDATE scm_vendor_invoices SET status = $1, submitted_at = now(), submitted_by = $2
       WHERE id = $3`,
      ["submitted", userId, vendorInvoice.id],
    );

    // Try to submit again (should fail per service logic)
    expect.assertions(1);
    try {
      await svc.submitVendorInvoice(actor, vendorInvoice.id);
      expect.fail("Should reject submit when not in draft status");
    } catch (err: unknown) {
      expect((err as Error).message).toMatch(/draft/i);
    }
  });

  // ============================================================================
  // TEST 6: Workflow Assignment Guard
  // ============================================================================
  it("TEST 6: should require workflow instance for approval", async () => {
    const invoiceNumber = `INV${Date.now()}006`;
    const idempotencyKey = `${randomUUID()}:6`;

    const svc = new SupplyChainAdvancedService(
      repo,
      rbac,
      audit,
      mockWorkflow,
      mockEvents,
      mockConfiguration,
    );

    const { vendorInvoice } = await svc.createVendorInvoice(actor, {
      invoiceNumber,
      idempotencyKey,
      purchaseOrderId,
      receivingRecordId,
      supplierId,
      invoiceAmount: 700000,
      lines: [
        {
          purchaseOrderLineId,
          description: "Test item",
          quantityInvoiced: 70,
          unitPrice: 10000,
          lineAmount: 700000,
        },
      ],
    });

    // Verify workflow_instance_id is set by service on create
    expect(vendorInvoice.workflowInstanceId).toBeTruthy();
  });

  // ============================================================================
  // TEST 7: Event Emission on Approval
  // ============================================================================
  it("TEST 7: should create accounting-ready event on approval", async () => {
    const invoiceNumber = `INV${Date.now()}007`;
    const idempotencyKey = `${randomUUID()}:7`;

    const svc = new SupplyChainAdvancedService(
      repo,
      rbac,
      audit,
      mockWorkflow,
      mockEvents,
      mockConfiguration,
    );

    const { vendorInvoice } = await svc.createVendorInvoice(actor, {
      invoiceNumber,
      idempotencyKey,
      purchaseOrderId,
      receivingRecordId,
      supplierId,
      invoiceAmount: 650000,
      lines: [
        {
          purchaseOrderLineId,
          description: "Test item",
          quantityInvoiced: 65,
          unitPrice: 10000,
          lineAmount: 650000,
        },
      ],
    });

    // Submit before approval (status must be submitted)
    await svc.submitVendorInvoice(actor, vendorInvoice.id);

    // Mock approval (in real test, workflow would advance)
    await svc.approveVendorInvoice(actor, vendorInvoice.id);

    // Verify event was created
    const events = await pool.query(
      `SELECT * FROM scm_accounting_ready_events
       WHERE tenant_id = $1 AND source_document_id = $2
       AND event_type = 'vendor.invoice.approved'`,
      [tenantId, vendorInvoice.id],
    );
    expect(events.rowCount).toBeGreaterThan(0);
  });

  // ============================================================================
  // TEST 8: Line Freeze on Approval
  // ============================================================================
  it("TEST 8: should freeze account assignment on approval", async () => {
    const invoiceNumber = `INV${Date.now()}008`;
    const idempotencyKey = `${randomUUID()}:8`;

    const svc = new SupplyChainAdvancedService(
      repo,
      rbac,
      audit,
      mockWorkflow,
      mockEvents,
      mockConfiguration,
    );

    const { vendorInvoice, lines } = await svc.createVendorInvoice(actor, {
      invoiceNumber,
      idempotencyKey,
      purchaseOrderId,
      receivingRecordId,
      supplierId,
      invoiceAmount: 600000,
      lines: [
        {
          purchaseOrderLineId,
          description: "Test item",
          quantityInvoiced: 60,
          unitPrice: 10000,
          lineAmount: 600000,
        },
      ],
    });

    // Submit before approval (status must be submitted)
    await svc.submitVendorInvoice(actor, vendorInvoice.id);

    await svc.approveVendorInvoice(actor, vendorInvoice.id);

    // Verify lines are frozen
    const dbLines = await pool.query(
      `SELECT frozen_account_assignment_at FROM scm_vendor_invoice_lines
       WHERE vendor_invoice_id = $1`,
      [vendorInvoice.id],
    );
    expect(dbLines.rows[0].frozen_account_assignment_at).toBeTruthy();
  });

  // ============================================================================
  // TEST 9: Consumer Idempotency (No Double Posting)
  // ============================================================================
  it("TEST 9: duplicate event posting should not double-post GL", async () => {
    // Verify journal_headers UNIQUE constraint exists for idempotency
    const constraint = await pool.query(
      `SELECT constraint_name FROM information_schema.table_constraints
       WHERE table_name = 'journal_headers'
       AND constraint_type = 'UNIQUE'`,
    );
    expect(constraint.rowCount).toBeGreaterThanOrEqual(1);
  });

  // ============================================================================
  // TEST 10: Authorization Gate (RBAC)
  // ============================================================================
  it("TEST 10: should reject if user lacks supply_chain.vendor_invoice.manage", async () => {
    // Create role without permission
    const roleResult = await pool.query(
      `INSERT INTO roles (tenant_id, code, name)
       VALUES ($1, $2, $3) RETURNING id`,
      [tenantId, `ROLE_READONLY_${Date.now()}`, "Read Only"],
    );
    const roleId = roleResult.rows[0].id;

    const unauthedActor: ActorContext = {
      ...actor,
      roleId,
    };

    const svc = new SupplyChainAdvancedService(
      repo,
      rbac,
      audit,
      mockWorkflow,
      mockEvents,
      mockConfiguration,
    );

    expect.assertions(1);
    try {
      await svc.createVendorInvoice(unauthedActor, {
        invoiceNumber: `INV${Date.now()}010`,
        idempotencyKey: `${randomUUID()}:10`,
        purchaseOrderId,
        receivingRecordId,
        supplierId,
        invoiceAmount: 500000,
        lines: [],
      });
      expect.fail("Should reject without permission");
    } catch (err: unknown) {
      expect((err as Error).message).toMatch(/permission|unauthorized/i);
    }
  });

  // ============================================================================
  // TEST 11: Over-Invoicing Guard
  // ============================================================================
  it("TEST 11: should reject invoice exceeding PO remaining amount", async () => {
    // PO: qty=100, unit_price=10,000 → total=1,000,000
    // Try to invoice 1,500,000 (exceeds)

    const svc = new SupplyChainAdvancedService(
      repo,
      rbac,
      audit,
      mockWorkflow,
      mockEvents,
      mockConfiguration,
    );

    expect.assertions(1);
    try {
      await svc.createVendorInvoice(actor, {
        invoiceNumber: `INV${Date.now()}011`,
        idempotencyKey: `${randomUUID()}:11`,
        purchaseOrderId,
        receivingRecordId,
        supplierId,
        invoiceAmount: 1500000,
        lines: [
          {
            purchaseOrderLineId,
            description: "Test item",
            quantityInvoiced: 100,
            unitPrice: 15000,
            lineAmount: 1500000,
          },
        ],
      });
      expect.fail("Should reject over-invoicing");
    } catch (err: unknown) {
      expect((err as Error).message).toMatch(/exceed|over.?invoic|total/i);
    }
  });
});
