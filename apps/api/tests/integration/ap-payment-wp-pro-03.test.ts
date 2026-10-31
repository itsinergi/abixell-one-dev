/**
 * AP Payment Batch (WP-PRO-03) Integration Tests (Test-First TDD)
 *
 * Tests: payment batch CRUD, approval workflow, nominal-limit enforcement (DEC-004-FU),
 * GL posting via accounting-ready events, and audit trail.
 *
 * Pattern: direct DB fixtures (tenant, legal_entity, user, role, supplier, approved invoice,
 * organization_units, accounting_periods). Mock workflow, event bus, configuration.
 * Cleanup via session_replication_role=replica.
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

const TS = `wp-pro-03-${Date.now()}`;

describe("WP-PRO-03: AP Payment Batch (Approved Invoice Payment)", () => {
  let tenantId: string;
  let legalEntityId: string;
  let organizationUnitId: string;
  let userId: string;
  let supplierId: string;
  let purchaseOrderId: string;
  let purchaseOrderLineId: string;
  let receivingRecordId: string;
  let receivingLineId: string;
  let coaId: string;
  // Shared approved invoice (status set directly). Each test that needs a
  // separate invoice creates its own — the UNIQUE(tenant_id, payment_batch_id,
  // vendor_invoice_id) + non-cancelled-line guard means a paid invoice cannot
  // be reused across batches.
  let vendorInvoiceId: string;
  const invoiceIds: string[] = [];
  let accountingPeriodId: string;
  let actor: ActorContext;
  // A second user holding the same role, used as the approver for over-limit
  // batches: DEC-004-FU person separation forbids the submitter approving.
  let approverActor: ActorContext;

  let service: SupplyChainAdvancedService;
  let rbac: RbacService;
  let audit: AuditService;
  let repo: PgSupplyChainAdvancedRepository;
  let mockWorkflow: WorkflowService;
  let mockEvents: EventBus;
  let mockConfiguration: ConfigurationService;

  // Helper: create an approved vendor invoice in the DB, return its id.
  async function makeApprovedInvoice(amount = 1000000): Promise<string> {
    const res = await pool.query(
      `INSERT INTO scm_vendor_invoices (tenant_id, invoice_number, idempotency_key, purchase_order_id, receiving_record_id, supplier_id, invoice_amount, currency, status, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'IDR', 'approved', $8) RETURNING id`,
      [
        tenantId,
        `VINV-${invoiceIds.length}-${randomUUID()}`,
        `vinv-${randomUUID()}`,
        purchaseOrderId,
        receivingRecordId,
        supplierId,
        amount,
        userId,
      ],
    );
    const id = res.rows[0].id;
    invoiceIds.push(id);
    return id;
  }

  beforeAll(async () => {
    // Tenant
    let result = await pool.query(
      `INSERT INTO tenants (code, name) VALUES ($1, 'Payment Batch Test') RETURNING id`,
      [TS],
    );
    tenantId = result.rows[0].id;

    // Legal entity
    result = await pool.query(
      `INSERT INTO legal_entities (tenant_id, name) VALUES ($1, 'Test LE') RETURNING id`,
      [tenantId],
    );
    legalEntityId = result.rows[0].id;

    // Organization unit (with legal_entity_id for GL posting)
    result = await pool.query(
      `INSERT INTO organization_units (tenant_id, legal_entity_id, name, unit_type)
       VALUES ($1, $2, 'Test Org Unit', 'Organization Unit') RETURNING id`,
      [tenantId, legalEntityId],
    );
    organizationUnitId = result.rows[0].id;

    // Accounting period (open, covering today)
    const today = new Date();
    const periodFrom = new Date(today.getFullYear(), today.getMonth(), 1);
    const periodTo = new Date(today.getFullYear(), today.getMonth() + 2, 0);
    result = await pool.query(
      `INSERT INTO accounting_periods (tenant_id, legal_entity_id, fiscal_year_code, period_code, period_name, period_type, date_from, date_to, status)
       VALUES ($1, $2, 'FY2026', 'M01', 'January 2026', 'monthly', $3, $4, 'open') RETURNING id`,
      [tenantId, legalEntityId, periodFrom, periodTo],
    );
    accountingPeriodId = result.rows[0].id;

    // User
    result = await pool.query(
      `INSERT INTO users (tenant_id, email, password_hash, full_name, status)
       VALUES ($1, $2, 'x', $2, 'active') RETURNING id`,
      [tenantId, `${TS}-user@test.local`],
    );
    userId = result.rows[0].id;

    // Role + assignment for actor
    result = await pool.query(
      `INSERT INTO roles (tenant_id, code, name) VALUES ($1, 'PAYMENT_APPROVER', 'Payment Approver') RETURNING id`,
      [tenantId],
    );
    const roleId = result.rows[0].id;

    // Grant payment permissions to role
    await pool.query(
      `INSERT INTO role_permissions (role_id, permission_id)
       SELECT $1, p.id FROM permissions p
       WHERE p.code = ANY($2)`,
      [
        roleId,
        [
          "supply_chain.payment.read",
          "supply_chain.payment.manage",
          "supply_chain.payment.approve",
          "supply_chain.vendor_invoice.read",
          "supply_chain.vendor_invoice.approve",
        ],
      ],
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
      roleCode: "PAYMENT_APPROVER",
      scopeType: "tenant",
      scopeLegalEntityId: null,
      scopeOrganizationUnitId: null,
      scopeCustomerId: null,
    };

    // Second user with the same role for the approver actor (person separation)
    result = await pool.query(
      `INSERT INTO users (tenant_id, email, password_hash, full_name, status)
       VALUES ($1, $2, 'x', $2, 'active') RETURNING id`,
      [tenantId, `${TS}-approver@test.local`],
    );
    const approverUserId = result.rows[0].id;

    result = await pool.query(
      `INSERT INTO user_role_assignments (user_id, role_id, scope_type)
       VALUES ($1, $2, 'tenant') RETURNING id`,
      [approverUserId, roleId],
    );
    const approverAssignmentId = result.rows[0].id;

    approverActor = {
      userId: approverUserId,
      tenantId,
      sessionId: randomUUID(),
      assignmentId: approverAssignmentId,
      roleId,
      roleCode: "PAYMENT_APPROVER",
      scopeType: "tenant",
      scopeLegalEntityId: null,
      scopeOrganizationUnitId: null,
      scopeCustomerId: null,
    };

    // Supplier
    result = await pool.query(
      `INSERT INTO suppliers (tenant_id, code, name, is_active)
       VALUES ($1, $2, $3, true) RETURNING id`,
      [tenantId, "SUP_PAYMENT_001", "Test Supplier"],
    );
    supplierId = result.rows[0].id;

    // Item
    result = await pool.query(
      `INSERT INTO items (tenant_id, code, name, unit_of_measure)
       VALUES ($1, $2, $3, $4) RETURNING id`,
      [tenantId, "ITEM_PAY_001", "Test Item", "pcs"],
    );
    const itemId: string = result.rows[0].id;

    // Warehouse
    result = await pool.query(
      `INSERT INTO scm_warehouses (tenant_id, code, name)
       VALUES ($1, $2, $3) RETURNING id`,
      [tenantId, "WH_PAYMENT_001", "Test Warehouse"],
    );
    const warehouseId: string = result.rows[0].id;

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

    // Receiving record + line
    result = await pool.query(
      `INSERT INTO scm_receiving_records (tenant_id, purchase_order_id, supplier_id, warehouse_id, receipt_number, idempotency_key, received_at, received_by)
       VALUES ($1, $2, $3, $4, $5, $6, now(), $7) RETURNING id`,
      [
        tenantId,
        purchaseOrderId,
        supplierId,
        warehouseId,
        `REC${Date.now()}`,
        `idkey-pay-${Date.now()}`,
        userId,
      ],
    );
    receivingRecordId = result.rows[0].id;

    result = await pool.query(
      `INSERT INTO scm_receiving_lines (tenant_id, receiving_record_id, purchase_order_line_id, item_id, warehouse_id, quantity_received, quantity_accepted, unit_cost, account_assignment_type)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
      [tenantId, receivingRecordId, purchaseOrderLineId, itemId, warehouseId, 100, 100, 10000, "expense"],
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

    // Create an approved vendor invoice (WP-PRO-01 prerequisite)
    // Workflow definition for vendor invoice
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

    // Workflow definition for payment batch
    let paymentWorkflowDefId = "";
    let paymentWorkflowVersionId = "";
    let paymentInitialStepId = "";
    {
      let res = await pool.query(
        `INSERT INTO workflow_definitions (tenant_id, code, name, entity_type, description)
         VALUES ($1, $2, $3, $4, $5) RETURNING id`,
        [tenantId, "scm_payment_batch", "Payment Batch Approval", "scm_payment_batch", "AP payment batch approval workflow"],
      );
      paymentWorkflowDefId = res.rows[0].id;

      res = await pool.query(
        `INSERT INTO workflow_versions (workflow_definition_id, version_number, status, is_current)
         VALUES ($1, 1, 'published', true) RETURNING id`,
        [paymentWorkflowDefId],
      );
      paymentWorkflowVersionId = res.rows[0].id;

      res = await pool.query(
        `INSERT INTO workflow_steps (workflow_version_id, code, name, step_type, is_initial, sequence_order)
         VALUES ($1, $2, $3, $4, true, 0) RETURNING id`,
        [paymentWorkflowVersionId, "initial", "Submit Payment", "task"],
      );
      paymentInitialStepId = res.rows[0].id;
    }

    // Create vendor invoice via direct insert (approved status)
    result = await pool.query(
      `INSERT INTO scm_vendor_invoices (tenant_id, invoice_number, idempotency_key, purchase_order_id, receiving_record_id, supplier_id, invoice_amount, currency, status, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'approved', $9) RETURNING id`,
      [
        tenantId,
        `VINV${Date.now()}`,
        `vinv-pay-${randomUUID()}`,
        purchaseOrderId,
        receivingRecordId,
        supplierId,
        1000000, // 1M IDR
        "IDR",
        userId,
      ],
    );
    vendorInvoiceId = result.rows[0].id;
    invoiceIds.push(vendorInvoiceId);

    // Initialize service dependencies
    repo = new PgSupplyChainAdvancedRepository(pool);
    rbac = new RbacService(new PgRbacRepository(pool));
    audit = new AuditService(new PgAuditLogRepository(pool));

    // Mock workflow service
    mockWorkflow = {
      startInstance: async (
        _actor: unknown,
        input: { definitionCode: string; entityId: string; contextData?: unknown },
      ) => {
        const res = await pool.query(
          `INSERT INTO workflow_instances (tenant_id, workflow_definition_id, workflow_version_id, entity_type, entity_id, current_step_id, context_data, started_by)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
          [
            tenantId,
            input.definitionCode === "scm_payment_batch" ? paymentWorkflowDefId : workflowDefId,
            input.definitionCode === "scm_payment_batch" ? paymentWorkflowVersionId : workflowVersionId,
            input.definitionCode,
            input.entityId,
            input.definitionCode === "scm_payment_batch" ? paymentInitialStepId : initialStepId,
            input.contextData || {},
            userId,
          ],
        );
        return { instance: { id: res.rows[0].id } };
      },
      getInstanceForEntityOwner: async (_tenantId: string, instanceId: string) => ({
        instance: { id: instanceId },
        assignments: [{ id: randomUUID(), status: "pending" }],
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
      }),
      getEntityStatuses: async () => [],
      listVersions: async () => [],
      createVersion: async () => ({ versionNumber: 1 }),
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
        number: `BATCH${Date.now()}`,
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
  // TEST 1: Create payment batch for approved invoice → OK, status='draft'
  // ============================================================================
  it("TEST 1: should create payment batch for approved invoice with status='draft'", async () => {
    const svc = new SupplyChainAdvancedService(repo, rbac, audit, mockWorkflow, mockEvents, mockConfiguration);

    const { paymentBatch, lines } = await svc.createPaymentBatch(actor, {
      organizationUnitId,
      currency: "IDR",
      idempotencyKey: `batch-1-${randomUUID()}`,
      lines: [
        {
          vendorInvoiceId,
          overrideReason: null,
        },
      ],
    });

    expect(paymentBatch.status).toBe("draft");
    expect(paymentBatch.organizationUnitId).toBe(organizationUnitId);
    expect(lines.length).toBe(1);
    expect(lines[0].vendorInvoiceId).toBe(vendorInvoiceId);
  });

  // ============================================================================
  // TEST 2: Create batch for non-approved invoice → ValidationError
  // ============================================================================
  it("TEST 2: should reject batch creation for non-approved invoice", async () => {
    // Create a draft vendor invoice
    const result = await pool.query(
      `INSERT INTO scm_vendor_invoices (tenant_id, invoice_number, idempotency_key, purchase_order_id, receiving_record_id, supplier_id, invoice_amount, currency, status, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'draft', $9) RETURNING id`,
      [
        tenantId,
        `VINV_DRAFT_${Date.now()}`,
        `vinv-draft-${randomUUID()}`,
        purchaseOrderId,
        receivingRecordId,
        supplierId,
        500000,
        "IDR",
        userId,
      ],
    );
    const draftInvoiceId = result.rows[0].id;

    const svc = new SupplyChainAdvancedService(repo, rbac, audit, mockWorkflow, mockEvents, mockConfiguration);

    expect.assertions(1);
    try {
      await svc.createPaymentBatch(actor, {
        organizationUnitId,
        currency: "IDR",
        idempotencyKey: `batch-2-${randomUUID()}`,
        lines: [
          {
            vendorInvoiceId: draftInvoiceId,
            overrideReason: null,
          },
        ],
      });
      expect.fail("Should reject non-approved invoice");
    } catch (err: unknown) {
      expect((err as Error).message).toMatch(/approved|status/i);
    }
  });

  // ============================================================================
  // TEST 3: Create batch with duplicate invoice → ValidationError (UNIQUE guard)
  // ============================================================================
  it("TEST 3: should reject batch with duplicate invoice within same batch", async () => {
    const svc = new SupplyChainAdvancedService(repo, rbac, audit, mockWorkflow, mockEvents, mockConfiguration);

    expect.assertions(1);
    try {
      await svc.createPaymentBatch(actor, {
        organizationUnitId,
        currency: "IDR",
        idempotencyKey: `batch-3-${randomUUID()}`,
        lines: [
          {
            vendorInvoiceId,
            overrideReason: null,
          },
          {
            vendorInvoiceId, // duplicate
            overrideReason: null,
          },
        ],
      });
      expect.fail("Should reject duplicate invoice");
    } catch (err: unknown) {
      expect((err as Error).message).toMatch(/duplicate|already|unique/i);
    }
  });

  // ============================================================================
  // TEST 3b: Cancelled batch releases invoice for a new payment batch
  // ============================================================================
  it("TEST 3b: should allow invoice reuse after the prior payment batch is cancelled", async () => {
    const svc = new SupplyChainAdvancedService(repo, rbac, audit, mockWorkflow, mockEvents, mockConfiguration);
    const reusableInvoiceId = await makeApprovedInvoice(1000000);

    const { paymentBatch: first } = await svc.createPaymentBatch(actor, {
      organizationUnitId,
      currency: "IDR",
      idempotencyKey: `batch-3b-first-${randomUUID()}`,
      lines: [{ vendorInvoiceId: reusableInvoiceId, overrideReason: null }],
    });

    await svc.cancelPaymentBatch(actor, first.id, "Release invoice");

    const { paymentBatch: second, lines } = await svc.createPaymentBatch(actor, {
      organizationUnitId,
      currency: "IDR",
      idempotencyKey: `batch-3b-second-${randomUUID()}`,
      lines: [{ vendorInvoiceId: reusableInvoiceId, overrideReason: null }],
    });

    expect(second.status).toBe("draft");
    expect(lines[0].vendorInvoiceId).toBe(reusableInvoiceId);
  });

  // ============================================================================
  // TEST 3c: A later return removes payment eligibility
  // ============================================================================
  it("TEST 3c: should reject payment for an invoice whose accepted supply was returned", async () => {
    const svc = new SupplyChainAdvancedService(repo, rbac, audit, mockWorkflow, mockEvents, mockConfiguration);
    const returnedInvoiceId = await makeApprovedInvoice(1000000);

    await pool.query(
      `INSERT INTO scm_vendor_invoice_lines (
         tenant_id, vendor_invoice_id, purchase_order_line_id, receiving_line_id,
         description, quantity_invoiced, unit_price, currency, line_amount,
         account_assignment_type, sort_order
       ) VALUES ($1, $2, $3, $4, 'Returned supply', 100, 10000, 'IDR', 1000000, 'expense', 0)`,
      [tenantId, returnedInvoiceId, purchaseOrderLineId, receivingLineId],
    );
    await pool.query(
      `UPDATE scm_receiving_lines
          SET quantity_returned = quantity_accepted
        WHERE tenant_id = $1 AND id = $2`,
      [tenantId, receivingLineId],
    );

    await expect(
      svc.createPaymentBatch(actor, {
        organizationUnitId,
        currency: "IDR",
        idempotencyKey: `batch-3c-${randomUUID()}`,
        lines: [{ vendorInvoiceId: returnedInvoiceId, overrideReason: null }],
      }),
    ).rejects.toThrow(/no longer payment-eligible|accepted-eligible/i);
  });

  // ============================================================================
  // TEST 4: Approve batch (within/NULL limit) → status='approved' + GL events
  // ============================================================================
  it("TEST 4: should approve batch and emit vendor.invoice.payment_approved events", async () => {
    const svc = new SupplyChainAdvancedService(repo, rbac, audit, mockWorkflow, mockEvents, mockConfiguration);

    const approveInvoiceId = await makeApprovedInvoice(1000000);

    // Create batch
    const { paymentBatch: created } = await svc.createPaymentBatch(actor, {
      organizationUnitId,
      currency: "IDR",
      idempotencyKey: `batch-4-${randomUUID()}`,
      lines: [
        {
          vendorInvoiceId: approveInvoiceId,
          overrideReason: null,
        },
      ],
    });

    // Submit
    await svc.submitPaymentBatch(actor, created.id);

    // Approve
    const { paymentBatch: approved } = await svc.approvePaymentBatch(actor, created.id);

    expect(approved.status).toBe("approved");

    // Verify accounting events were created
    const events = await pool.query(
      `SELECT * FROM scm_accounting_ready_events
       WHERE tenant_id = $1 AND source_document_id = $2
       AND event_type = 'vendor.invoice.payment_approved'`,
      [tenantId, created.id],
    );
    expect(events.rowCount).toBeGreaterThan(0);

    // Verify event payload has legalEntityId and periodId (jsonb is auto-parsed by pg)
    const eventPayload = events.rows[0].payload;
    expect(eventPayload.legalEntityId).toBe(legalEntityId);
    expect(eventPayload.periodId).toBe(accountingPeriodId);
  });

  // ============================================================================
  // TEST 5: Nominal limit: line > limit + no overrideReason → ValidationError
  // ============================================================================
  it("TEST 5: should reject approval when line exceeds nominal limit without override", async () => {
    const svc = new SupplyChainAdvancedService(repo, rbac, audit, mockWorkflow, mockEvents, mockConfiguration);

    // Set nominal limit for the actor's role
    await pool.query(
      `INSERT INTO scm_payment_approval_limits (tenant_id, role_code, nominal_limit)
       VALUES ($1, $2, $3)
       ON CONFLICT (tenant_id, role_code) DO UPDATE SET nominal_limit = $3`,
      [tenantId, "PAYMENT_APPROVER", 500000], // 500K limit
    );

    // Create fresh invoice so the non-cancelled-line guard doesn't fire
    const limitInvoiceId = await makeApprovedInvoice(1000000);

    // Create batch with line amount > limit (1M IDR > 500K)
    const { paymentBatch: created } = await svc.createPaymentBatch(actor, {
      organizationUnitId,
      currency: "IDR",
      idempotencyKey: `batch-5-${randomUUID()}`,
      lines: [
        {
          vendorInvoiceId: limitInvoiceId, // 1M IDR
          overrideReason: null, // no override
        },
      ],
    });

    await svc.submitPaymentBatch(actor, created.id);

    expect.assertions(1);
    try {
      await svc.approvePaymentBatch(actor, created.id);
      expect.fail("Should reject approval exceeding nominal limit");
    } catch (err: unknown) {
      expect((err as Error).message).toMatch(/limit|exceed/i);
    }
  });

  // ============================================================================
  // TEST 6: Nominal limit override: line > limit + overrideReason → approved OK
  // ============================================================================
  it("TEST 6: should approve batch when line > limit but overrideReason provided by a different approver", async () => {
    const svc = new SupplyChainAdvancedService(repo, rbac, audit, mockWorkflow, mockEvents, mockConfiguration);

    await pool.query(
      `INSERT INTO scm_payment_approval_limits (tenant_id, role_code, nominal_limit)
       VALUES ($1, $2, $3)
       ON CONFLICT (tenant_id, role_code) DO UPDATE SET nominal_limit = $3`,
      [tenantId, "PAYMENT_APPROVER", 500000],
    );

    const overrideInvoiceId = await makeApprovedInvoice(1000000);

    // Create batch with override reason
    const { paymentBatch: created } = await svc.createPaymentBatch(actor, {
      organizationUnitId,
      currency: "IDR",
      idempotencyKey: `batch-6-${randomUUID()}`,
      lines: [
        {
          vendorInvoiceId: overrideInvoiceId, // 1M IDR > 500K limit
          overrideReason: "Emergency supplier payment - approved by CFO", // has override
        },
      ],
    });

    // Submitter (actor) submits the batch
    await svc.submitPaymentBatch(actor, created.id);

    // A DIFFERENT approver approves (DEC-004-FU person separation)
    const { paymentBatch: approved } = await svc.approvePaymentBatch(approverActor, created.id);

    expect(approved.status).toBe("approved");
  });

  // ============================================================================
  // TEST 6b: Nominal limit: submitter cannot approve their own over-limit batch
  // ============================================================================
  it("TEST 6b: should reject approval when over-limit and approver is the submitter", async () => {
    const svc = new SupplyChainAdvancedService(repo, rbac, audit, mockWorkflow, mockEvents, mockConfiguration);

    await pool.query(
      `INSERT INTO scm_payment_approval_limits (tenant_id, role_code, nominal_limit)
       VALUES ($1, $2, $3)
       ON CONFLICT (tenant_id, role_code) DO UPDATE SET nominal_limit = $3`,
      [tenantId, "PAYMENT_APPROVER", 500000],
    );

    const sameUserInvoiceId = await makeApprovedInvoice(1000000);

    const { paymentBatch: created } = await svc.createPaymentBatch(actor, {
      organizationUnitId,
      currency: "IDR",
      idempotencyKey: `batch-6b-${randomUUID()}`,
      lines: [
        {
          vendorInvoiceId: sameUserInvoiceId,
          overrideReason: "Override present, but same person",
        },
      ],
    });

    await svc.submitPaymentBatch(actor, created.id);

    expect.assertions(1);
    try {
      await svc.approvePaymentBatch(actor, created.id); // same user as submitter
      expect.fail("Should reject same-user approval above the nominal limit");
    } catch (err: unknown) {
      expect((err as Error).message).toMatch(/differ|submitter/i);
    }
  });

  // ============================================================================
  // TEST 7: Cancel batch before approval → status='cancelled', no GL events
  // ============================================================================
  it("TEST 7: should cancel batch from draft/submitted without emitting GL events", async () => {
    const svc = new SupplyChainAdvancedService(repo, rbac, audit, mockWorkflow, mockEvents, mockConfiguration);

    const cancelInvoiceId = await makeApprovedInvoice(1000000);

    // Create batch
    const { paymentBatch: created } = await svc.createPaymentBatch(actor, {
      organizationUnitId,
      currency: "IDR",
      idempotencyKey: `batch-7-${randomUUID()}`,
      lines: [
        {
          vendorInvoiceId: cancelInvoiceId,
          overrideReason: null,
        },
      ],
    });

    // Cancel from draft
    const { paymentBatch: cancelled } = await svc.cancelPaymentBatch(actor, created.id, "Test cancellation");

    expect(cancelled.status).toBe("cancelled");

    // Verify NO accounting events were created for this batch
    const events = await pool.query(
      `SELECT * FROM scm_accounting_ready_events
       WHERE tenant_id = $1 AND source_document_id = $2`,
      [tenantId, created.id],
    );
    expect(events.rowCount).toBe(0);
  });

  // ============================================================================
  // TEST 7b: Terminal-state guard — an approved batch cannot be cancelled
  // ============================================================================
  it("TEST 7b: should reject cancelling an already-approved payment batch", async () => {
    const svc = new SupplyChainAdvancedService(repo, rbac, audit, mockWorkflow, mockEvents, mockConfiguration);

    // Clear any nominal limit left by earlier tests so this approval is unbounded.
    await pool.query(
      `INSERT INTO scm_payment_approval_limits (tenant_id, role_code, nominal_limit)
       VALUES ($1, $2, NULL)
       ON CONFLICT (tenant_id, role_code) DO UPDATE SET nominal_limit = NULL`,
      [tenantId, "PAYMENT_APPROVER"],
    );

    const guardInvoiceId = await makeApprovedInvoice(1000000);

    const { paymentBatch: created } = await svc.createPaymentBatch(actor, {
      organizationUnitId,
      currency: "IDR",
      idempotencyKey: `batch-7b-${randomUUID()}`,
      lines: [{ vendorInvoiceId: guardInvoiceId, overrideReason: null }],
    });

    await svc.submitPaymentBatch(actor, created.id);
    const { paymentBatch: approved } = await svc.approvePaymentBatch(actor, created.id);
    expect(approved.status).toBe("approved");

    await expect(svc.cancelPaymentBatch(actor, created.id, "should not work")).rejects.toThrow(
      /cancel|status/i,
    );
  });

  // ============================================================================
  // TEST 8: Regression — Vendor invoice approval still works (WP-PRO-01 intact)
  // ============================================================================
  it("TEST 8: regression - vendor invoice approval still works (WP-PRO-01 not broken)", async () => {
    // Create a fresh vendor invoice
    const result = await pool.query(
      `INSERT INTO scm_vendor_invoices (tenant_id, invoice_number, idempotency_key, purchase_order_id, receiving_record_id, supplier_id, invoice_amount, currency, status, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'draft', $9) RETURNING id`,
      [
        tenantId,
        `VINV_REG_${Date.now()}`,
        `vinv-reg-${randomUUID()}`,
        purchaseOrderId,
        receivingRecordId,
        supplierId,
        750000,
        "IDR",
        userId,
      ],
    );
    const regInvoiceId = result.rows[0].id;
    invoiceIds.push(regInvoiceId);

    // Add a line so the approval emits a vendor.invoice.approved event
    await pool.query(
      `INSERT INTO scm_vendor_invoice_lines (tenant_id, vendor_invoice_id, purchase_order_line_id, description, quantity_invoiced, unit_price, currency, line_amount, account_assignment_type, sort_order)
       VALUES ($1, $2, $3, $4, $5, $6, 'IDR', $7, 'expense', 0)`,
      [tenantId, regInvoiceId, purchaseOrderLineId, "Reg line", 10, 75000, 750000],
    );

    // Start workflow for the invoice
    const wfRes = await pool.query(
      `INSERT INTO workflow_instances (tenant_id, workflow_definition_id, workflow_version_id, entity_type, entity_id, current_step_id, started_by)
       SELECT $1, wd.id, wv.id, 'scm_vendor_invoice', $2, ws.id, $3
       FROM workflow_definitions wd
       JOIN workflow_versions wv ON wv.workflow_definition_id = wd.id
       JOIN workflow_steps ws ON ws.workflow_version_id = wv.id
       WHERE wd.tenant_id = $1 AND wd.code = 'scm_vendor_invoice' AND wv.is_current AND ws.is_initial
       RETURNING id`,
      [tenantId, regInvoiceId, userId],
    );
    const workflowInstanceId = wfRes.rows[0].id;

    // Update invoice with workflow_instance_id
    await pool.query(
      `UPDATE scm_vendor_invoices SET workflow_instance_id = $1 WHERE id = $2`,
      [workflowInstanceId, regInvoiceId],
    );

    const svc = new SupplyChainAdvancedService(repo, rbac, audit, mockWorkflow, mockEvents, mockConfiguration);

    // Submit invoice
    await svc.submitVendorInvoice(actor, regInvoiceId);

    // Approve invoice
    const approved = await svc.approveVendorInvoice(actor, regInvoiceId);

    expect(approved.vendorInvoice.status).toBe("approved");

    // Verify vendor.invoice.approved event was created (WP-PRO-01 event, not payment event)
    const events = await pool.query(
      `SELECT * FROM scm_accounting_ready_events
       WHERE tenant_id = $1 AND source_document_id = $2 AND event_type = 'vendor.invoice.approved'`,
      [tenantId, regInvoiceId],
    );
    expect(events.rowCount).toBeGreaterThan(0);
  });
});
