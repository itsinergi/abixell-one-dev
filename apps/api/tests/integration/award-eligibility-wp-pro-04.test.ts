/**
 * Award Eligibility Gate (WP-PRO-04) Integration Tests
 *
 * Tests: pre-award eligibility checks on supplier active status, bid status, RFQ status.
 * Each rejection is documented with a reason visible in the error message.
 *
 * Pattern: direct DB fixtures (tenant, legal_entity, user, role, supplier [active/inactive],
 * RFQ [various statuses], supplier bids [various statuses]). No mocking needed for the award
 * gate itself (pure service logic). Cleanup via session_replication_role=replica.
 *
 * Note: scm_supplier_bids has UNIQUE(tenant_id, rfq_id, supplier_id) — each test creates
 * its own RFQ + bid pair to avoid colliding on that constraint.
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

const TS = `wp-pro-04-${Date.now()}`;

describe("WP-PRO-04: Award Eligibility Gate (Supplier Active, Bid Status, RFQ Status)", () => {
  let tenantId: string;
  let organizationUnitId: string;
  let userId: string;
  let activeSupplierId: string;
  let inactiveSupplierId: string;
  let actor: ActorContext;

  let svc: SupplyChainAdvancedService;
  let repo: PgSupplyChainAdvancedRepository;
  let rbac: RbacService;
  let audit: AuditService;
  let mockWorkflow: WorkflowService;
  let mockEvents: EventBus;
  let mockConfiguration: ConfigurationService;

  // Helper: create an RFQ with a given status, return its id.
  async function makeRfq(status: string, suffix: string): Promise<string> {
    const res = await pool.query(
      `INSERT INTO scm_rfqs (tenant_id, rfq_number, title, organization_unit_id, submission_deadline, status, created_by)
       VALUES ($1, $2, $3, $4, now() + interval '30 days', $5, $6) RETURNING id`,
      [tenantId, `RFQ-${suffix}-${randomUUID()}`, `RFQ ${suffix}`, organizationUnitId, status, userId],
    );
    return res.rows[0].id;
  }

  // Helper: create a supplier bid with a given status, return its id.
  async function makeBid(
    rfqId: string,
    supplierId: string,
    status: string,
    suffix: string,
  ): Promise<string> {
    const res = await pool.query(
      `INSERT INTO scm_supplier_bids (tenant_id, bid_number, rfq_id, supplier_id, status, submitted_at)
       VALUES ($1, $2, $3, $4, $5, now()) RETURNING id`,
      [tenantId, `BID-${suffix}-${randomUUID()}`, rfqId, supplierId, status],
    );
    return res.rows[0].id;
  }

  beforeAll(async () => {
    // Tenant
    let result = await pool.query(
      `INSERT INTO tenants (code, name) VALUES ($1, 'Award Eligibility Test') RETURNING id`,
      [TS],
    );
    tenantId = result.rows[0].id;

    // Legal entity
    result = await pool.query(
      `INSERT INTO legal_entities (tenant_id, name) VALUES ($1, 'Test LE') RETURNING id`,
      [tenantId],
    );
    const legalEntityId = result.rows[0].id;

    // Organization unit
    result = await pool.query(
      `INSERT INTO organization_units (tenant_id, legal_entity_id, name, unit_type)
       VALUES ($1, $2, 'Test Org Unit', 'Organization Unit') RETURNING id`,
      [tenantId, legalEntityId],
    );
    organizationUnitId = result.rows[0].id;

    // User
    result = await pool.query(
      `INSERT INTO users (tenant_id, email, password_hash, full_name, status)
       VALUES ($1, $2, 'x', $2, 'active') RETURNING id`,
      [tenantId, `${TS}-user@test.local`],
    );
    userId = result.rows[0].id;

    // Role + assignment for actor (supply_chain.procurement.manage)
    result = await pool.query(
      `INSERT INTO roles (tenant_id, code, name) VALUES ($1, 'PROCUREMENT_MGR', 'Procurement Manager') RETURNING id`,
      [tenantId],
    );
    const roleId = result.rows[0].id;

    // Grant procurement.manage permission
    await pool.query(
      `INSERT INTO role_permissions (role_id, permission_id)
       SELECT $1, p.id FROM permissions p WHERE p.code = 'supply_chain.procurement.manage'`,
      [roleId],
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
      roleCode: "PROCUREMENT_MGR",
      scopeType: "tenant",
      scopeLegalEntityId: null,
      scopeOrganizationUnitId: null,
      scopeCustomerId: null,
    };

    // Create active and inactive suppliers
    result = await pool.query(
      `INSERT INTO suppliers (tenant_id, code, name, is_active)
       VALUES ($1, $2, $3, true) RETURNING id`,
      [tenantId, "SUP_AWARD_ACTIVE_001", "Active Supplier"],
    );
    activeSupplierId = result.rows[0].id;

    result = await pool.query(
      `INSERT INTO suppliers (tenant_id, code, name, is_active)
       VALUES ($1, $2, $3, false) RETURNING id`,
      [tenantId, "SUP_AWARD_INACTIVE_001", "Inactive Supplier"],
    );
    inactiveSupplierId = result.rows[0].id;

    // Initialize service dependencies
    repo = new PgSupplyChainAdvancedRepository(pool);
    rbac = new RbacService(new PgRbacRepository(pool));
    audit = new AuditService(new PgAuditLogRepository(pool));

    // Mock workflow service (minimal)
    mockWorkflow = {
      startInstance: async () => ({ instance: { id: randomUUID() } }),
      getInstanceForEntityOwner: async () => ({
        instance: { id: randomUUID() },
        assignments: [],
        currentStep: null,
        history: [],
      }),
      actOnAssignment: async () => undefined,
      getEntityStatus: async () => ({ instanceStatus: "pending" }),
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

    // Mock configuration
    mockConfiguration = {
      generateNumberForTenant: async () => ({ number: `CFG${Date.now()}`, sequence: 1 }),
    } as unknown as ConfigurationService;

    svc = new SupplyChainAdvancedService(repo, rbac, audit, mockWorkflow, mockEvents, mockConfiguration);
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
  // TEST 1: Supplier inactive → award throws ValidationError
  // ============================================================================
  it("TEST 1: should reject award when supplier is inactive", async () => {
    const rfq = await makeRfq("in_evaluation", "t1");
    const bidId = await makeBid(rfq, inactiveSupplierId, "evaluated", "t1");

    await expect(svc.awardSupplierBid(actor, bidId)).rejects.toThrow(/inactive/i);
  });

  // ============================================================================
  // TEST 2: Bid status='rejected' → award throws ValidationError
  // ============================================================================
  it("TEST 2: should reject award when bid status is 'rejected'", async () => {
    const rfq = await makeRfq("in_evaluation", "t2");
    const bidId = await makeBid(rfq, activeSupplierId, "rejected", "t2");

    await expect(svc.awardSupplierBid(actor, bidId)).rejects.toThrow(/status|rejected/i);
  });

  // ============================================================================
  // TEST 3: Bid status='awarded' → award throws ValidationError
  // ============================================================================
  it("TEST 3: should reject award when bid status is already 'awarded'", async () => {
    const rfq = await makeRfq("in_evaluation", "t3");
    const bidId = await makeBid(rfq, activeSupplierId, "awarded", "t3");

    await expect(svc.awardSupplierBid(actor, bidId)).rejects.toThrow(/status|awarded/i);
  });

  // ============================================================================
  // TEST 4: Bid status='evaluated' → award OK
  // ============================================================================
  it("TEST 4: should allow award when bid status is 'evaluated'", async () => {
    const rfq = await makeRfq("in_evaluation", "t4");
    const bidId = await makeBid(rfq, activeSupplierId, "evaluated", "t4");

    const awarded = await svc.awardSupplierBid(actor, bidId);
    expect(awarded.status).toBe("awarded");
    expect(awarded.isWinningBid).toBe(true);
  });

  // ============================================================================
  // TEST 5: Bid status='shortlisted' → award OK
  // ============================================================================
  it("TEST 5: should allow award when bid status is 'shortlisted'", async () => {
    const rfq = await makeRfq("in_evaluation", "t5");
    const bidId = await makeBid(rfq, activeSupplierId, "shortlisted", "t5");

    const awarded = await svc.awardSupplierBid(actor, bidId);
    expect(awarded.status).toBe("awarded");
  });

  // ============================================================================
  // TEST 6: RFQ status='cancelled' → award throws ValidationError
  // ============================================================================
  it("TEST 6: should reject award when RFQ status is 'cancelled'", async () => {
    const rfq = await makeRfq("cancelled", "t6");
    const bidId = await makeBid(rfq, activeSupplierId, "evaluated", "t6");

    await expect(svc.awardSupplierBid(actor, bidId)).rejects.toThrow(/rfq|status|cancelled/i);
  });

  // ============================================================================
  // TEST 7: RFQ status='in_evaluation' → award OK
  // ============================================================================
  it("TEST 7: should allow award when RFQ status is 'in_evaluation'", async () => {
    const rfq = await makeRfq("in_evaluation", "t7");
    const bidId = await makeBid(rfq, activeSupplierId, "shortlisted", "t7");

    const awarded = await svc.awardSupplierBid(actor, bidId);
    expect(awarded.status).toBe("awarded");
  });

  // ============================================================================
  // TEST 8: Rejection reason visible in error message
  // ============================================================================
  it("TEST 8: should include reason in error message when award is rejected", async () => {
    const rfq = await makeRfq("in_evaluation", "t8");
    const bidId = await makeBid(rfq, inactiveSupplierId, "evaluated", "t8");

    try {
      await svc.awardSupplierBid(actor, bidId);
      throw new Error("Expected ValidationError");
    } catch (err: unknown) {
      expect((err as Error).message).toMatch(/inactive|Supplier/i);
    }
  });

  // ============================================================================
  // TEST 9: Regression — awarded status mutation + RFQ projection update still work
  // ============================================================================
  it("TEST 9: should update bid status and RFQ projection when award succeeds", async () => {
    const rfq = await makeRfq("in_evaluation", "t9");
    const bidId = await makeBid(rfq, activeSupplierId, "evaluated", "t9");

    const awarded = await svc.awardSupplierBid(actor, bidId);

    expect(awarded.status).toBe("awarded");
    expect(awarded.isWinningBid).toBe(true);

    const updatedRfq = await repo.findRfqById(tenantId, rfq);
    expect(updatedRfq?.rfq.status).toBe("awarded");
    expect(updatedRfq?.rfq.awardedAt).not.toBeNull();
  });

  it("TEST 10: should reject an ineligible status at the repository write boundary", async () => {
    const rfq = await makeRfq("in_evaluation", "t10");
    const bidId = await makeBid(rfq, activeSupplierId, "rejected", "t10");

    const awarded = await repo.awardSupplierBid(tenantId, {
      bidId,
      updatedBy: userId,
    });

    expect(awarded).toBeNull();
    const unchanged = await repo.findSupplierBidById(tenantId, bidId);
    expect(unchanged?.bid.status).toBe("rejected");
    expect(unchanged?.bid.isWinningBid).toBe(false);
  });
});
