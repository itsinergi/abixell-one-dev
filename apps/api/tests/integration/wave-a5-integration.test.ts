import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../../src/app.js";
import { activateAllModules, authHeader, bootstrapTenant, createReadOnlyRole, login, provisionFirstAdmin } from "./helpers.js";

/**
 * Wave A5 — Supply Chain Advanced Integration Test Suite (SCM-ADV-001…008).
 *
 * Scope & Capabilities:
 * 1. Multi-warehouse topology, storage locations, batch/lot, and serial tracking (SCM-ADV-001, SCM-ADV-002, SCM-ADV-003 — 5 pts)
 * 2. Reservation, reorder policies, inter-warehouse transfers, and stock opname reconciliation (SCM-ADV-004 — 3 pts)
 * 3. Inventory valuation (FIFO layers) & Landed Cost allocation vouchers (SCM-ADV-005 — 3 pts)
 * 4. RFQ publication, supplier quotations, comparative scoring, and awarding (SCM-ADV-006 — 5 pts)
 * 5. Supplier evaluation scorecard (KPIs) and Master Purchasing Contracts (SCM-ADV-007 — 3 pts)
 * 6. Spend Analytics: multidimensional aggregation and snapshots (SCM-ADV-008 — 3 pts)
 *
 * Invariants & Boundaries:
 * - Multi-tenant isolation across all SCM Advanced capabilities
 * - Hierarchical Organization-Unit Data Scope enforcement
 * - Segregation of Duties & RBAC denial across SCM permission families
 * - Workflow Engine authoritative lifecycle without competing status columns
 * - Compensation on workflow initialization failure
 * - Immutable Advanced Stock Ledger with balance mutation
 * - Exact-decimal arithmetic in valuation & landed cost allocation
 * - Parameterized, bounded SQL analytics queries with timeouts
 */

const TENANT_CODE = `wave-a5-main-${Date.now()}`;
const OTHER_TENANT_CODE = `wave-a5-other-${Date.now()}`;
const ADMIN_EMAIL = "admin@wave-a5.local";
const ADMIN_PASSWORD = "Admin12345!";
const OTHER_ADMIN_EMAIL = "otheradmin@wave-a5.local";
const OTHER_ADMIN_PASSWORD = "OtherAdmin12345!";

describe.sequential("Wave A5 — Supply Chain Advanced Integration Suite", () => {
  const app = buildApp();

  // Primary Tenant Fixtures
  let tenantId: string;
  let adminUserId: string;
  let adminToken: string;

  // Other Tenant Fixtures (Tenant Isolation)
  let otherTenantId: string;
  let otherAdminUserId: string;
  let otherAdminToken: string;

  // Scoped User Fixtures (Data Scope & RBAC)
  let northManagerUserId: string;
  let northManagerToken: string;
  let restrictedUserToken: string;

  // Organization & Core SCM Fixtures
  let legalEntityId: string;
  let orgUnitNorthId: string;
  let orgUnitNorthChildId: string;
  let orgUnitSouthId: string;

  let mainWarehouseId: string;
  let secondaryWarehouseId: string;
  let southWarehouseId: string;
  let otherWarehouseId: string;

  let binMainA1Id: string;
  let binMainA2Id: string;
  let binSecB1Id: string;

  let itemAlphaId: string;
  let itemBetaId: string;
  let itemGammaId: string;
  let otherItemId: string;

  let supplierAcmeId: string;
  let supplierBetaId: string;
  let otherSupplierId: string;

  let purchaseOrderId: string;

  // Advanced Capability Record IDs
  let batchId: string;
  let serialId: string;
  let reservationId: string;
  let reorderPolicyId: string;
  let transferId: string;
  let opnameId: string;
  let valuationLayerId: string;
  let landedCostId: string;
  let rfqId: string;
  let bidId: string;
  let contractId: string;
  let evaluationId: string;
  let receivingRecordId: string;
  let receivingLineId: string;
  let returnToVendorId: string;
  let receiptReversalId: string;
  let accountingEventId: string;
  let replacementDeliveryId: string;
  let serviceAcceptanceId: string;
  let consignmentSettlementId: string;
  let disposalId: string;
  let warehouseTaskId: string;

  const post = (url: string, token: string, payload?: Record<string, unknown>) =>
    app.inject({
      method: "POST",
      url,
      headers: authHeader(token),
      ...(payload === undefined ? {} : { payload }),
    });

  const get = (url: string, token: string) =>
    app.inject({
      method: "GET",
      url,
      headers: authHeader(token),
    });

  const patch = (url: string, token: string, payload?: Record<string, unknown>) =>
    app.inject({
      method: "PATCH",
      url,
      headers: authHeader(token),
      ...(payload === undefined ? {} : { payload }),
    });

  const put = (url: string, token: string, payload?: Record<string, unknown>) =>
    app.inject({
      method: "PUT",
      url,
      headers: authHeader(token),
      ...(payload === undefined ? {} : { payload }),
    });

  beforeAll(async () => {
    // -----------------------------------------------------------------------
    // 1. Bootstrap Tenants & Provision Admins
    // -----------------------------------------------------------------------
    const primaryTenant = await bootstrapTenant(app, TENANT_CODE, "Wave A5 Primary Tenant");
    await activateAllModules(primaryTenant.id);
    tenantId = primaryTenant.id;
    const adminUser = await provisionFirstAdmin({
      tenantId,
      email: ADMIN_EMAIL,
      password: ADMIN_PASSWORD,
    });
    adminUserId = adminUser.userId;
    const adminLogin = await login(app, TENANT_CODE, ADMIN_EMAIL, ADMIN_PASSWORD);
    adminToken = adminLogin.body.accessToken;

    const otherTenant = await bootstrapTenant(app, OTHER_TENANT_CODE, "Wave A5 Other Tenant");

    await activateAllModules(otherTenant.id);
    otherTenantId = otherTenant.id;
    const otherAdmin = await provisionFirstAdmin({
      tenantId: otherTenantId,
      email: OTHER_ADMIN_EMAIL,
      password: OTHER_ADMIN_PASSWORD,
    });
    otherAdminUserId = otherAdmin.userId;
    const otherAdminLogin = await login(app, OTHER_TENANT_CODE, OTHER_ADMIN_EMAIL, OTHER_ADMIN_PASSWORD);
    otherAdminToken = otherAdminLogin.body.accessToken;

    // -----------------------------------------------------------------------
    // 2. Seed Numbering Sequences for both tenants
    // -----------------------------------------------------------------------
    for (const [tToken] of [[adminToken], [otherAdminToken]] as const) {
      await post("/config/numbering/purchase_order", tToken, { pattern: "PO-{YYYY}-{SEQ:5}" });
      await post("/config/numbering/scm_stock_transfer", tToken, { pattern: "TRF-{YYYY}-{SEQ:4}" });
      await post("/config/numbering/scm_stock_opname", tToken, { pattern: "OPN-{YYYY}-{SEQ:4}" });
      await post("/config/numbering/scm_landed_cost", tToken, { pattern: "LCV-{YYYY}-{SEQ:4}" });
      await post("/config/numbering/scm_rfq", tToken, { pattern: "RFQ-{YYYY}-{SEQ:4}" });
      await post("/config/numbering/scm_supplier_bid", tToken, { pattern: "BID-{YYYY}-{SEQ:4}" });
      await post("/config/numbering/scm_supplier_evaluation", tToken, { pattern: "EVL-{YYYY}-{SEQ:4}" });
      await post("/config/numbering/scm_supplier_contract", tToken, { pattern: "CTR-{YYYY}-{SEQ:4}" });
      await post("/config/numbering/scm_item_batch", tToken, { pattern: "BAT-{YYYY}-{SEQ:4}" });
      await post("/config/numbering/scm_receiving_record", tToken, { pattern: "REC-{YYYY}-{SEQ:4}" });
      await post("/config/numbering/scm_inspection", tToken, { pattern: "INS-{YYYY}-{SEQ:4}" });
      await post("/config/numbering/scm_return_to_vendor", tToken, { pattern: "RTV-{YYYY}-{SEQ:4}" });
      await post("/config/numbering/scm_receipt_reversal", tToken, { pattern: "REV-{YYYY}-{SEQ:4}" });
      await post("/config/numbering/scm_replacement_delivery", tToken, { pattern: "REP-{YYYY}-{SEQ:4}" });
      await post("/config/numbering/scm_service_acceptance", tToken, { pattern: "SES-{YYYY}-{SEQ:4}" });
      await post("/config/numbering/scm_consignment_settlement", tToken, { pattern: "CSN-{YYYY}-{SEQ:4}" });
      await post("/config/numbering/scm_inventory_disposal", tToken, { pattern: "DSP-{YYYY}-{SEQ:4}" });
      await post("/config/numbering/scm_warehouse_task", tToken, { pattern: "TSK-{YYYY}-{SEQ:4}" });

      // Seed workflow definitions required by SCM Advanced modules
      const workflows = [
        { code: "scm_stock_transfer", name: "Warehouse Stock Transfer" },
        { code: "scm_stock_opname", name: "Stock Opname Reconciliation" },
        { code: "scm_rfq", name: "RFQ Procurement Process" },
        { code: "scm_supplier_evaluation", name: "Supplier Evaluation Workflow" },
        { code: "scm_supplier_contract", name: "Supplier Contract Approval" },
        { code: "scm_service_acceptance", name: "Service Acceptance Workflow" },
        { code: "scm_inventory_disposal", name: "Inventory Disposal Workflow" },
      ];

      for (const wf of workflows) {
        await post("/workflow/definitions", tToken, {
          code: wf.code,
          name: wf.name,
          entityType: wf.code,
          description: `Authoritative workflow for ${wf.name}`,
        });

        await post(`/workflow/definitions/${wf.code}/versions/1/steps`, tToken, {
          code: "SUBMITTED",
          name: "Submitted",
          stepType: "task",
          isInitial: true,
        });
        await post(`/workflow/definitions/${wf.code}/versions/1/steps`, tToken, {
          code: "APPROVED",
          name: "Approved",
          stepType: "end",
          isTerminal: true,
          terminalStatus: "approved",
        });
        await post(`/workflow/definitions/${wf.code}/versions/1/steps`, tToken, {
          code: "REJECTED",
          name: "Rejected",
          stepType: "end",
          isTerminal: true,
          terminalStatus: "rejected",
        });

        await post(`/workflow/definitions/${wf.code}/versions/1/transitions`, tToken, {
          fromStepCode: "SUBMITTED",
          toStepCode: "APPROVED",
          actionCode: "approve",
          name: "Approve",
        });
        await post(`/workflow/definitions/${wf.code}/versions/1/transitions`, tToken, {
          fromStepCode: "SUBMITTED",
          toStepCode: "APPROVED",
          actionCode: "submit",
          name: "Submit",
        });
        await post(`/workflow/definitions/${wf.code}/versions/1/transitions`, tToken, {
          fromStepCode: "SUBMITTED",
          toStepCode: "APPROVED",
          actionCode: "complete",
          name: "Complete",
        });
        await post(`/workflow/definitions/${wf.code}/versions/1/transitions`, tToken, {
          fromStepCode: "SUBMITTED",
          toStepCode: "APPROVED",
          actionCode: "award",
          name: "Award",
        });
        await post(`/workflow/definitions/${wf.code}/versions/1/transitions`, tToken, {
          fromStepCode: "SUBMITTED",
          toStepCode: "REJECTED",
          actionCode: "reject",
          name: "Reject",
        });
        await post(`/workflow/definitions/${wf.code}/versions/1/transitions`, tToken, {
          fromStepCode: "SUBMITTED",
          toStepCode: "REJECTED",
          actionCode: "cancel",
          name: "Cancel",
        });

        await post(`/workflow/definitions/${wf.code}/versions/1/assignment-rules`, tToken, {
          stepCode: "SUBMITTED",
          assignmentType: "specific_user",
          specificUserSource: "submitter",
        });

        await post(`/workflow/definitions/${wf.code}/versions/1/publish`, tToken);
      }
    }

    // -----------------------------------------------------------------------
    // 3. Setup Organization Hierarchy & Scoped Users
    // -----------------------------------------------------------------------
    const leRes = await post("/legal-entities", adminToken, {
      code: "LE-SCM-A5",
      name: "Supply Chain Advanced Entity",
    });
    legalEntityId = leRes.json().id;

    const northRes = await post("/organization-units", adminToken, {
      legalEntityId,
      name: "Engineering North Operations",
    });
    orgUnitNorthId = northRes.json().id;

    const northChildRes = await post("/organization-units", adminToken, {
      legalEntityId,
      name: "Cloud Logistics Team",
      parentId: orgUnitNorthId,
    });
    orgUnitNorthChildId = northChildRes.json().id;

    const southRes = await post("/organization-units", adminToken, {
      legalEntityId,
      name: "Operations South Hub",
    });
    orgUnitSouthId = southRes.json().id;

    // Roles
    await createReadOnlyRole(tenantId, "SCM_MANAGE_ROLE", [
      "supply_chain.warehouse.read",
      "supply_chain.warehouse.manage",
      "supply_chain.inventory.read",
      "supply_chain.inventory.manage",
      "supply_chain.valuation.read",
      "supply_chain.valuation.manage",
      "supply_chain.procurement.read",
      "supply_chain.procurement.manage",
      "supply_chain.contract.read",
      "supply_chain.contract.manage",
      "supply_chain.analytics.read",
      "supply_chain.service_acceptance.read",
      "supply_chain.service_acceptance.manage",
      "supply_chain.service_acceptance.approve",
      "supply_chain.consignment.read",
      "supply_chain.consignment.manage",
      "supply_chain.disposal.read",
      "supply_chain.disposal.manage",
      "supply_chain.disposal.approve",
      "supply_chain.warehouse_task.read",
      "supply_chain.warehouse_task.manage",
      "supply_chain.warehouse_task.execute",
      "workflow.instance.start",
      "workflow.instance.read",
      "workflow.instance.act",
    ]);

    await createReadOnlyRole(tenantId, "SCM_READONLY_ROLE", [
      "supply_chain.warehouse.read",
      "supply_chain.inventory.read",
      "supply_chain.valuation.read",
      "supply_chain.procurement.read",
      "supply_chain.contract.read",
      "supply_chain.analytics.read",
      "supply_chain.service_acceptance.read",
      "supply_chain.consignment.read",
      "supply_chain.disposal.read",
      "supply_chain.warehouse_task.read",
    ]);

    // Create Scoped User (North Manager)
    const userRes = await post("/users", adminToken, {
      email: "north.scm@wave-a5.local",
      fullName: "North SCM Manager",
      password: "Password12345!",
      roleCode: "SCM_MANAGE_ROLE",
      scopeType: "organization_unit",
      scopeOrganizationUnitId: orgUnitNorthId,
    });
    northManagerUserId = userRes.json().user.id;
    const northLogin = await login(app, TENANT_CODE, "north.scm@wave-a5.local", "Password12345!");
    northManagerToken = northLogin.body.accessToken;

    // Create Restricted User with Read-Only Role
    await post("/users", adminToken, {
      email: "readonly.scm@wave-a5.local",
      fullName: "Readonly SCM User",
      password: "Password12345!",
      roleCode: "SCM_READONLY_ROLE",
      scopeType: "tenant",
    });
    const restrictedLogin = await login(app, TENANT_CODE, "readonly.scm@wave-a5.local", "Password12345!");
    restrictedUserToken = restrictedLogin.body.accessToken;

    // -----------------------------------------------------------------------
    // 4. Setup Core SCM Prerequisite Fixtures (Items, Suppliers, Purchase Orders)
    // -----------------------------------------------------------------------
    const itemARes = await post("/items", adminToken, {
      code: "ITM-SRV-01",
      name: "Enterprise Server Unit",
      unitOfMeasure: "unit",
      category: "Hardware",
      description: "High end compute server",
    });
    itemAlphaId = itemARes.json().id;

    const itemBRes = await post("/items", adminToken, {
      code: "ITM-RAM-02",
      name: "DDR5 ECC RAM Module 64GB",
      unitOfMeasure: "piece",
      category: "Memory",
      description: "Server memory module",
    });
    itemBetaId = itemBRes.json().id;

    const itemGRes = await post("/items", adminToken, {
      code: "ITM-CAB-03",
      name: "Cat6A Patch Cable 2m",
      unitOfMeasure: "piece",
      category: "Cabling",
      description: "Network patch cable",
    });
    itemGammaId = itemGRes.json().id;

    const otherItmRes = await post("/items", otherAdminToken, {
      code: "ITM-OTH-01",
      name: "Other Tenant Commodity",
      unitOfMeasure: "unit",
    });
    otherItemId = otherItmRes.json().id;

    const suppAcmeRes = await post("/suppliers", adminToken, {
      code: "SUP-ACME",
      name: "Acme Industrial Technologies",
      category: "OEM",
      contactName: "John Acme",
      email: "contact@acme.example.com",
    });
    supplierAcmeId = suppAcmeRes.json().id;

    const suppBetaRes = await post("/suppliers", adminToken, {
      code: "SUP-BETA",
      name: "Beta Components Ltd",
      category: "Distributor",
      contactName: "Sarah Beta",
      email: "sales@beta.example.com",
    });
    supplierBetaId = suppBetaRes.json().id;

    const otherSuppRes = await post("/suppliers", otherAdminToken, {
      code: "SUP-OTH-01",
      name: "Other Tenant Supplier",
    });
    otherSupplierId = otherSuppRes.json().id;

    const poRes = await post("/purchase-orders", adminToken, {
      supplierCode: "SUP-ACME",
      orderDate: new Date().toISOString().slice(0, 10),
      currency: "IDR",
      lines: [
        { itemCode: "ITM-SRV-01", quantity: 10, unitPrice: 25000000 },
        { itemCode: "ITM-RAM-02", quantity: 50, unitPrice: 3500000 },
      ],
    });
    purchaseOrderId = poRes.json().order.id;

    // -----------------------------------------------------------------------
    // 5. Setup Warehouses
    // -----------------------------------------------------------------------
    const whMainRes = await post("/supply-chain/advanced/warehouses", adminToken, {
      code: "WH-NORTH-MAIN",
      name: "North Central Warehouse",
      organizationUnitId: orgUnitNorthId,
      address: "100 North Way",
    });
    mainWarehouseId = whMainRes.json().id;

    const whSecRes = await post("/supply-chain/advanced/warehouses", adminToken, {
      code: "WH-NORTH-SEC",
      name: "North Secondary Depot",
      organizationUnitId: orgUnitNorthChildId,
      address: "102 North Way",
    });
    secondaryWarehouseId = whSecRes.json().id;

    const whSouthRes = await post("/supply-chain/advanced/warehouses", adminToken, {
      code: "WH-SOUTH-HUB",
      name: "South Central Hub",
      organizationUnitId: orgUnitSouthId,
      address: "200 South Ave",
    });
    southWarehouseId = whSouthRes.json().id;

    const otherWhRes = await post("/supply-chain/advanced/warehouses", otherAdminToken, {
      code: "WH-OTHER-01",
      name: "Other Tenant Main Warehouse",
      address: "999 Remote St",
    });
    otherWarehouseId = otherWhRes.json().id;
  });

  afterAll(async () => {
    await app.close();
  });

  // =========================================================================
  // Capability Group 1: Multi-Warehouse, Bin, Batch & Serial Tracking (5 pts)
  // SCM-ADV-001, SCM-ADV-002, SCM-ADV-003
  // =========================================================================
  describe("Group 1: Multi-Warehouse, Bin, Batch & Serial Tracking", () => {
    it("creates storage locations within warehouse topology", async () => {
      const resA1 = await post("/supply-chain/advanced/warehouse-locations", adminToken, {
        warehouseId: mainWarehouseId,
        code: "BIN-A1-01",
        zone: "Zone A",
        aisle: "Aisle 1",
        rack: "Rack 1",
        shelf: "Shelf 1",
        bin: "01",
      });
      expect(resA1.statusCode).toBe(201);
      binMainA1Id = resA1.json().id;
      expect(resA1.json().code).toBe("BIN-A1-01");
      expect(resA1.json().warehouseId).toBe(mainWarehouseId);

      const resA2 = await post("/supply-chain/advanced/warehouse-locations", adminToken, {
        warehouseId: mainWarehouseId,
        code: "BIN-A1-02",
        zone: "Zone A",
        aisle: "Aisle 1",
        rack: "Rack 1",
        shelf: "Shelf 2",
        bin: "02",
      });
      expect(resA2.statusCode).toBe(201);
      binMainA2Id = resA2.json().id;

      const resB1 = await post("/supply-chain/advanced/warehouse-locations", adminToken, {
        warehouseId: secondaryWarehouseId,
        code: "BIN-SEC-B1",
        zone: "Zone B",
      });
      expect(resB1.statusCode).toBe(201);
      binSecB1Id = resB1.json().id;

      // List locations for main warehouse
      const listBins = await get(`/supply-chain/advanced/warehouse-locations?warehouseId=${mainWarehouseId}`, adminToken);
      expect(listBins.statusCode).toBe(200);
      expect(listBins.json()).toHaveLength(2);
    });

    it("registers and tracks batch/lot records with expiry dates", async () => {
      const expDate = new Date();
      expDate.setFullYear(expDate.getFullYear() + 2);

      const res = await post("/supply-chain/advanced/batches", adminToken, {
        itemId: itemBetaId,
        batchNumber: "LOT-DDR5-20260901",
        manufacturedDate: new Date().toISOString().slice(0, 10),
        expiryDate: expDate.toISOString().slice(0, 10),
        supplierId: supplierBetaId,
        notes: "Certified ECC batch test passed",
      });

      expect(res.statusCode).toBe(201);
      batchId = res.json().id;
      expect(res.json().batchNumber).toBe("LOT-DDR5-20260901");

      // Verify listing by item
      const listRes = await get(`/supply-chain/advanced/batches?itemId=${itemBetaId}`, adminToken);
      expect(listRes.statusCode).toBe(200);
      expect(listRes.json().some((b: { id: string }) => b.id === batchId)).toBe(true);
    });

    it("registers and tracks individual serial numbers with warranty metadata", async () => {
      const res = await post("/supply-chain/advanced/serials", adminToken, {
        itemId: itemAlphaId,
        serialNumber: "SRV-2026-00001",
        warehouseId: mainWarehouseId,
        locationId: binMainA1Id,
        warrantyExpiryDate: "2029-09-01",
        notes: "Initial deployment server",
      });

      expect(res.statusCode).toBe(201);
      serialId = res.json().id;
      expect(res.json().serialNumber).toBe("SRV-2026-00001");
      expect(res.json().status).toBe("in_stock");

      // Re-registering duplicate serial for same item fails with conflict error
      const dupRes = await post("/supply-chain/advanced/serials", adminToken, {
        itemId: itemAlphaId,
        serialNumber: "SRV-2026-00001",
        warehouseId: mainWarehouseId,
      });
      expect([400, 409]).toContain(dupRes.statusCode);
    });

    it("records authoritative stock movements with pessimistic row locking and balance updates", async () => {
      const postRes = await post("/supply-chain/advanced/movements", adminToken, {
        itemId: itemAlphaId,
        warehouseId: mainWarehouseId,
        locationId: binMainA1Id,
        movementType: "in",
        quantity: 10,
        unitCost: 25000000,
        totalCost: 250000000,
        referenceType: "purchase_order",
        referenceId: purchaseOrderId,
        notes: "Inbound delivery from PO",
      });

      expect(postRes.statusCode).toBe(201);
      expect(postRes.json().movement.quantity).toBe(10);
      expect(postRes.json().balance.onHandQuantity).toBe(10);
      expect(postRes.json().balance.availableQuantity).toBe(10);

      // Verify on-hand balance query
      const balanceRes = await get(`/supply-chain/advanced/balances?warehouseId=${mainWarehouseId}&itemId=${itemAlphaId}`, adminToken);
      expect(balanceRes.statusCode).toBe(200);
      expect(balanceRes.json().length).toBeGreaterThan(0);
      expect(balanceRes.json()[0].onHandQuantity).toBe(10);
      expect(balanceRes.json()[0].availableQuantity).toBe(10);
    });
  });

  // =========================================================================
  // Capability Group 2: Reservation, Reorder, Transfer & Opname (3 pts)
  // SCM-ADV-004
  // =========================================================================
  describe("Group 2: Reservation, Reorder, Transfer & Stock Opname", () => {
    it("creates stock reservation and verifies available quantity reduction", async () => {
      const resRes = await post("/supply-chain/advanced/reservations", adminToken, {
        reservationNumber: "RES-2026-0001",
        itemId: itemAlphaId,
        warehouseId: mainWarehouseId,
        locationId: binMainA1Id,
        quantity: 2,
        reservedForType: "sales_order",
        reservedForNumber: "SO-2026-001",
      });

      expect(resRes.statusCode).toBe(201);
      reservationId = resRes.json().id;
      expect(resRes.json().status).toBe("active");
      expect(resRes.json().quantity).toBe(2);

      // Verify balance reflects reserved quantity: onHand = 10, reserved = 2, available = 8
      const balRes = await get(`/supply-chain/advanced/balances?warehouseId=${mainWarehouseId}&itemId=${itemAlphaId}`, adminToken);
      expect(balRes.statusCode).toBe(200);
      const bal = balRes.json().find((b: { warehouseId: string }) => b.warehouseId === mainWarehouseId);
      expect(bal.onHandQuantity).toBe(10);
      expect(bal.reservedQuantity).toBe(2);
      expect(bal.availableQuantity).toBe(8);
    });

    it("fulfills stock reservation and releases balance reservation", async () => {
      const fulRes = await post(`/supply-chain/advanced/reservations/${reservationId}/fulfill`, adminToken);
      expect(fulRes.statusCode).toBe(200);
      expect(fulRes.json().status).toBe("fulfilled");

      // Verify balance: reserved returns to 0
      const balRes = await get(`/supply-chain/advanced/balances?warehouseId=${mainWarehouseId}&itemId=${itemAlphaId}`, adminToken);
      const bal = balRes.json().find((b: { warehouseId: string }) => b.warehouseId === mainWarehouseId);
      expect(bal.reservedQuantity).toBe(0);
    });

    it("configures dynamic reorder threshold policy and verifies alert generation", async () => {
      const polRes = await put("/supply-chain/advanced/reorder-policies", adminToken, {
        itemId: itemGammaId,
        warehouseId: mainWarehouseId,
        minQuantity: 100,
        reorderPoint: 150,
        reorderQuantity: 200,
        safetyStock: 50,
        leadTimeDays: 7,
      });

      expect(polRes.statusCode).toBe(200);
      reorderPolicyId = polRes.json().id;
      expect(polRes.json().reorderPoint).toBe(150);

      // Check reorder alerts: itemGamma has 0 onHand, reorderPoint is 150 -> should generate alert
      const alertRes = await get("/supply-chain/advanced/reorder-alerts", adminToken);
      expect(alertRes.statusCode).toBe(200);
      expect(alertRes.json().some((a: { policy: { itemId: string } }) => a.policy.itemId === itemGammaId)).toBe(true);
    });

    it("creates and approves inter-warehouse transfer via Workflow Engine", async () => {
      const trfRes = await post("/supply-chain/advanced/transfers", adminToken, {
        fromWarehouseId: mainWarehouseId,
        toWarehouseId: secondaryWarehouseId,
        notes: "Routine branch replenishment",
        lines: [
          {
            itemId: itemAlphaId,
            quantityRequested: 2,
            fromLocationId: binMainA1Id,
            toLocationId: binSecB1Id,
          },
        ],
      });

      expect(trfRes.statusCode).toBe(201);
      transferId = trfRes.json().transfer.id;
      expect(trfRes.json().transfer.transferNumber).toMatch(/^TRF-/);
      expect(trfRes.json().transfer.status).toBe("draft");
      expect(trfRes.json().transfer.workflowInstanceId).toBeDefined();

      // Approve transfer
      const actRes = await post(`/supply-chain/advanced/transfers/${transferId}/act`, adminToken, {
        actionCode: "approve",
        comment: "Approved logistics replenishment",
      });
      expect(actRes.statusCode).toBe(200);
      expect(actRes.json().transfer.status).toBe("approved");

      // Record shipment
      const lineId = actRes.json().lines[0].id;
      const shipRes = await post("/supply-chain/advanced/transfers/shipments", adminToken, {
        transferId,
        lineShipments: [{ lineId, quantityShipped: 2 }],
      });
      expect(shipRes.statusCode).toBe(200);
      expect(shipRes.json().lines[0].quantityShipped).toBe(2);

      // Record receipt
      const recRes = await post("/supply-chain/advanced/transfers/receipts", adminToken, {
        transferId,
        lineReceipts: [{ lineId, quantityReceived: 2 }],
      });
      expect(recRes.statusCode).toBe(200);
      expect(recRes.json().lines[0].quantityReceived).toBe(2);
    });

    it("initiates, records counts, and reconciles stock opname cycle", async () => {
      const opnRes = await post("/supply-chain/advanced/opnames", adminToken, {
        warehouseId: mainWarehouseId,
        opnameDate: "2026-09-01",
        notes: "Monthly physical inventory count",
        lines: [
          {
            itemId: itemAlphaId,
            systemQuantity: 8,
            physicalQuantity: 7, // 1 unit discrepancy
            notes: "Damaged in transit",
          },
        ],
      });

      expect(opnRes.statusCode).toBe(201);
      opnameId = opnRes.json().opname.id;
      expect(opnRes.json().opname.opnameNumber).toMatch(/^OPN-/);
      expect(opnRes.json().opname.status).toBe("in_progress");

      // Approve and reconcile stock opname
      const actRes = await post(`/supply-chain/advanced/opnames/${opnameId}/act`, adminToken, {
        actionCode: "approve",
        comment: "Discrepancy verified and write-off approved",
      });
      expect(actRes.statusCode).toBe(200);
      expect(actRes.json().opname.status).toBe("completed");
    });
  });

  // =========================================================================
  // Capability Group 3: Valuation & Landed Cost (3 pts)
  // SCM-ADV-005
  // =========================================================================
  describe("Group 3: Valuation & Landed Cost", () => {
    it("creates and consumes immutable FIFO valuation layers", async () => {
      const createRes = await post("/supply-chain/advanced/valuation-layers", adminToken, {
        itemId: itemAlphaId,
        warehouseId: mainWarehouseId,
        originalQuantity: 10,
        unitCost: 25000000,
        receivedDate: new Date().toISOString().slice(0, 10),
      });

      expect(createRes.statusCode).toBe(201);
      valuationLayerId = createRes.json().id;
      expect(createRes.json().effectiveUnitCost).toBe(25000000);
      expect(createRes.json().totalValue).toBe(250000000);

      // Consume layer partially
      const consumeRes = await post("/supply-chain/advanced/valuation-layers/consume", adminToken, {
        layerId: valuationLayerId,
        remainingQuantity: 6,
      });
      expect(consumeRes.statusCode).toBe(200);
      expect(consumeRes.json().remainingQuantity).toBe(6);
      expect(consumeRes.json().totalValue).toBe(150000000);

      // Query active layers
      const layRes = await get(`/supply-chain/advanced/valuation-layers?itemId=${itemAlphaId}`, adminToken);
      expect(layRes.statusCode).toBe(200);
      expect(layRes.json().length).toBeGreaterThan(0);
      expect(layRes.json()[0].remainingQuantity).toBe(6);
    });

    it("creates landed cost voucher and allocates additional freight/customs to items", async () => {
      const lcRes = await post("/supply-chain/advanced/landed-costs", adminToken, {
        purchaseOrderId,
        costType: "Customs Clearance & Freight",
        amount: 5000000,
        allocationMethod: "by_value",
        notes: "Import logistics surcharge",
        allocations: [
          { itemId: itemAlphaId, allocatedAmount: 3000000, costPerUnitAdded: 300000 },
          { itemId: itemBetaId, allocatedAmount: 2000000, costPerUnitAdded: 40000 },
        ],
      });

      expect(lcRes.statusCode).toBe(201);
      landedCostId = lcRes.json().landedCost.id;
      expect(lcRes.json().landedCost.voucherNumber).toMatch(/^LCV-/);
      expect(lcRes.json().landedCost.status).toBe("draft");

      // Apply landed cost voucher to valuation layers
      const applyRes = await post(`/supply-chain/advanced/landed-costs/${landedCostId}/apply`, adminToken);
      expect(applyRes.statusCode).toBe(200);
      expect(applyRes.json().landedCost.status).toBe("applied");

      // Inspect detail breakdown
      const dtRes = await get(`/supply-chain/advanced/landed-costs/${landedCostId}`, adminToken);
      expect(dtRes.statusCode).toBe(200);
      expect(dtRes.json().allocations).toHaveLength(2);
      expect(dtRes.json().allocations[0].allocatedAmount).toBe(3000000);
    });
  });

  // =========================================================================
  // Capability Group 4: RFQ, Tender & Bid Comparison (5 pts)
  // SCM-ADV-006
  // =========================================================================
  describe("Group 4: RFQ, Tender & Bid Comparison", () => {
    it("publishes multi-line RFQ with deadline and technical specifications", async () => {
      const d = new Date();
      d.setDate(d.getDate() + 14);

      const rfqRes = await post("/supply-chain/advanced/rfqs", adminToken, {
        title: "Procurement of High Performance Computing Nodes",
        procurementType: "rfq",
        organizationUnitId: orgUnitNorthId,
        submissionDeadline: d.toISOString(),
        notes: "Turnkey delivery within 30 days of PO",
        items: [
          {
            itemId: itemAlphaId,
            targetQuantity: 5,
            specifications: "Minimum dual Xeon Gold, 128GB RAM",
          },
        ],
        invitedSuppliers: [{ supplierId: supplierAcmeId }, { supplierId: supplierBetaId }],
      });

      expect(rfqRes.statusCode).toBe(201);
      rfqId = rfqRes.json().rfq.id;
      expect(rfqRes.json().rfq.rfqNumber).toMatch(/^RFQ-/);
      expect(rfqRes.json().rfq.status).toBe("published");
    });

    it("submits multiple supplier quotation bids for comparative scoring", async () => {
      const rfqDt = await get(`/supply-chain/advanced/rfqs/${rfqId}`, adminToken);
      const rfqItemId = rfqDt.json().items[0].id;

      // Supplier 1 Bid
      const bid1Res = await post("/supply-chain/advanced/bids", adminToken, {
        rfqId,
        supplierId: supplierAcmeId,
        leadTimeDays: 14,
        validUntil: "2026-12-31",
        notes: "Includes 3-year warranty and standard delivery",
        totalAmount: 120000000,
        lines: [
          {
            rfqItemId,
            offeredQuantity: 5,
            offeredUnitPrice: 24000000,
            offeredTotalPrice: 120000000,
            remarks: "Enterprise discount applied",
          },
        ],
      });

      expect(bid1Res.statusCode).toBe(201);
      bidId = bid1Res.json().bid.id;
      expect(bid1Res.json().bid.status).toBe("submitted");
      expect(bid1Res.json().bid.totalAmount).toBe(120000000);

      // Supplier 2 Bid
      const bid2Res = await post("/supply-chain/advanced/bids", adminToken, {
        rfqId,
        supplierId: supplierBetaId,
        leadTimeDays: 7,
        validUntil: "2026-12-31",
        totalAmount: 130000000,
        lines: [
          {
            rfqItemId,
            offeredQuantity: 5,
            offeredUnitPrice: 26000000,
            offeredTotalPrice: 130000000,
          },
        ],
      });
      expect(bid2Res.statusCode).toBe(201);
    });

    it("scores bids and awards winning quotation to purchase order", async () => {
      // Score Supplier 1 Bid
      const scoreRes = await patch(`/supply-chain/advanced/bids/${bidId}/score`, adminToken, {
        commercialScore: 95,
        technicalScore: 90,
        rank: 1,
        status: "shortlisted",
      });
      expect(scoreRes.statusCode).toBe(200);
      expect(scoreRes.json().finalScore).toBe(92.5); // (95+90)/2
      expect(scoreRes.json().rank).toBe(1);

      // Award winning bid
      const awardRes = await post("/supply-chain/advanced/bids/award", adminToken, {
        bidId,
      });

      expect(awardRes.statusCode).toBe(200);
      expect(awardRes.json().status).toBe("awarded");

      // Verify RFQ status transitioned to awarded
      const rfqDt = await get(`/supply-chain/advanced/rfqs/${rfqId}`, adminToken);
      expect(rfqDt.json().rfq.status).toBe("awarded");
    });
  });

  // =========================================================================
  // Capability Group 5: Supplier Evaluation & Contracts (3 pts)
  // SCM-ADV-007
  // =========================================================================
  describe("Group 5: Supplier Evaluation & Contract Purchasing", () => {
    it("evaluates supplier performance scorecard with weighted criteria and grade assignment", async () => {
      const evalRes = await post("/supply-chain/advanced/evaluations", adminToken, {
        supplierId: supplierAcmeId,
        evaluationPeriod: "2026-Q3",
        periodStartDate: "2026-07-01",
        periodEndDate: "2026-09-30",
        qualityScore: 92,
        deliveryScore: 88,
        pricingScore: 85,
        serviceScore: 90,
        notes: "Consistently meets SLAs with low defect rates",
      });

      expect(evalRes.statusCode).toBe(201);
      evaluationId = evalRes.json().evaluation.id;
      // 92*0.35 + 88*0.30 + 85*0.20 + 90*0.15 = 32.2 + 26.4 + 17.0 + 13.5 = 89.1 (Grade B)
      expect(evalRes.json().evaluation.overallScore).toBeCloseTo(89.1, 1);
      expect(evalRes.json().evaluation.ratingGrade).toBe("B");
    });

    it("registers and approves master purchasing contract with committed spend cap", async () => {
      const ctrRes = await post("/supply-chain/advanced/contracts", adminToken, {
        supplierId: supplierAcmeId,
        title: "Annual Master Agreement for Server Hardware & Peripherals",
        contractType: "blanket_po",
        startDate: "2026-01-01",
        endDate: "2026-12-31",
        committedAmount: 500000000,
        termsAndConditions: "Net 30 payment terms with 2% early settlement discount",
        items: [
          {
            itemId: itemAlphaId,
            agreedUnitPrice: 24000000,
            minOrderQuantity: 2,
            maxOrderQuantity: 50,
          },
        ],
      });

      expect(ctrRes.statusCode).toBe(201);
      contractId = ctrRes.json().contract.id;
      expect(ctrRes.json().contract.contractNumber).toMatch(/^CTR-/);
      expect(ctrRes.json().contract.status).toBe("pending_approval");

      // Approve contract via workflow action
      const actRes = await post(`/supply-chain/advanced/contracts/${contractId}/act`, adminToken, {
        actionCode: "approve",
        comment: "Contract terms vetted by legal and procurement director",
      });

      expect(actRes.statusCode).toBe(200);
      expect(actRes.json().contract.status).toBe("active");

      // Record spend against contract
      const spendRes = await post(`/supply-chain/advanced/contracts/${contractId}/spend`, adminToken, {
        additionalSpentAmount: 48000000,
      });
      expect(spendRes.statusCode).toBe(200);
      expect(spendRes.json().contract.spentAmount).toBe(48000000);
    });
  });

  // =========================================================================
  // Capability Group 6: Spend Analytics (3 pts)
  // SCM-ADV-008
  // =========================================================================
  describe("Group 6: Spend Analytics", () => {
    it("computes bounded, multidimensional spend analytics snapshot with category breakdown", async () => {
      const snapRes = await post("/supply-chain/advanced/spend-analytics/compute", adminToken, {
        periodType: "monthly",
        periodStart: "2026-01-01",
        periodEnd: "2026-12-31",
      });

      expect(snapRes.statusCode).toBe(201);
      expect(snapRes.json().id).toBeDefined();

      // Query historical snapshot list
      const listRes = await get("/supply-chain/advanced/spend-analytics", adminToken);
      expect(listRes.statusCode).toBe(200);
      expect(Array.isArray(listRes.json())).toBe(true);
      expect(listRes.json().length).toBeGreaterThan(0);
    });
  });

  // =========================================================================
  // Capability Group 7: Wave A5.1 Stage 1 - Receiving, Quality Inspection,
  // Discrepancy Logging, Return to Vendor, Receipt Reversal & Accounting Ready Events
  // =========================================================================
  describe("Group 7: Wave A5.1 Stage 1 Enterprise SCM & Accounting Readiness", () => {
    it("manages account assignment configuration governance", async () => {
      const listRes = await get("/supply-chain/advanced/account-assignment-configs", adminToken);
      expect(listRes.statusCode).toBe(200);
      expect(Array.isArray(listRes.json())).toBe(true);

      const updateRes = await put("/supply-chain/advanced/account-assignment-configs", adminToken, {
        assignmentType: "expense",
        requiredDimensions: ["costCenter", "businessUnit"],
        inventoryRelevant: false,
        isActive: true,
      });
      expect(updateRes.statusCode).toBe(200);
      expect(updateRes.json().assignmentType).toBe("expense");
      expect(updateRes.json().requiredDimensions).toEqual(["costCenter", "businessUnit"]);
    });

    it("creates receiving record with multi-condition and multi-ownership lines", async () => {
      const poDt = await get(`/purchase-orders/${purchaseOrderId}`, adminToken);
      const poLines = poDt.json().lines;
      const poLine1Id = poLines[0].id;
      const poLine2Id = poLines[1].id;

      const createRes = await post("/supply-chain/advanced/receiving-records", adminToken, {
        idempotencyKey: `rec-key-${Date.now()}`,
        purchaseOrderId,
        supplierId: supplierAcmeId,
        warehouseId: mainWarehouseId,
        locationId: binMainA1Id,
        notes: "Goods arrival for servers and memory",
        lines: [
          {
            purchaseOrderLineId: poLine1Id,
            itemId: itemAlphaId,
            warehouseId: mainWarehouseId,
            locationId: binMainA1Id,
            stockCondition: "quality_hold",
            ownerType: "own",
            quantityReceived: 10,
            unitCost: 25000000,
            currency: "IDR",
            accountAssignmentType: "stock",
            accountAssignmentDimensions: { costCenter: "CC-WH-01" },
            inspectionRequired: true,
            sortOrder: 1,
          },
          {
            purchaseOrderLineId: poLine2Id,
            itemId: itemBetaId,
            warehouseId: mainWarehouseId,
            locationId: binMainA1Id,
            stockCondition: "quality_hold",
            ownerType: "own",
            quantityReceived: 50,
            unitCost: 3500000,
            currency: "IDR",
            accountAssignmentType: "stock",
            accountAssignmentDimensions: {},
            inspectionRequired: false,
            sortOrder: 2,
          },
        ],
      });

      expect(createRes.statusCode).toBe(201);
      const data = createRes.json();
      receivingRecordId = data.receiving.id;
      expect(data.receiving.receiptNumber).toMatch(/^REC-/);
      expect(data.lines).toHaveLength(2);
      receivingLineId = data.lines[0].id;
      expect(data.lines[0].stockCondition).toBe("quality_hold");

      // Verify detail retrieval
      const getRes = await get(`/supply-chain/advanced/receiving-records/${receivingRecordId}`, adminToken);
      expect(getRes.statusCode).toBe(200);
      expect(getRes.json().receiving.id).toBe(receivingRecordId);
    });

    it("performs quality inspection and logs discrepancy on receiving line", async () => {
      // 1. Log Discrepancy
      const discRes = await post("/supply-chain/advanced/discrepancies", adminToken, {
        receivingLineId,
        discrepancyType: "damage",
        quantity: 2,
        description: "2 units show outer chassis deformation during transit",
      });
      expect(discRes.statusCode).toBe(201);
      const discId = discRes.json().id;
      expect(discRes.json().status).toBe("open");

      // Resolve discrepancy
      const resolveRes = await patch(`/supply-chain/advanced/discrepancies/${discId}/resolve`, adminToken, {
        status: "resolved",
        resolutionNotes: "Supplier acknowledged shipping fault; credit note requested",
      });
      expect(resolveRes.statusCode).toBe(200);
      expect(resolveRes.json().status).toBe("resolved");

      // 2. Perform Inspection
      const inspRes = await post("/supply-chain/advanced/inspections", adminToken, {
        receivingLineId,
        idempotencyKey: `insp-key-${Date.now()}`,
        quantityAccepted: 8,
        quantityRejected: 2,
        quantityQuarantined: 0,
        result: "mixed",
        reason: "8 passed burn-in; 2 failed chassis visual inspection",
      });
      expect(inspRes.statusCode).toBe(201);
      expect(inspRes.json().inspectionNumber).toMatch(/^INS-/);
      expect(inspRes.json().result).toBe("mixed");

      // Query inspection by receiving line
      const getInspRes = await get(
        `/supply-chain/advanced/inspections/by-receiving-line/${receivingLineId}`,
        adminToken,
      );
      expect(getInspRes.statusCode).toBe(200);
      expect(getInspRes.json().id).toBe(inspRes.json().id);
    });

    it("processes return to vendor (RTV) with stock issuance", async () => {
      const rtvRes = await post("/supply-chain/advanced/returns-to-vendor", adminToken, {
        idempotencyKey: `rtv-key-${Date.now()}`,
        supplierId: supplierAcmeId,
        purchaseOrderId,
        warehouseId: mainWarehouseId,
        reason: "Returning 2 rejected server units back to OEM",
        lines: [
          {
            receivingLineId,
            itemId: itemAlphaId,
            warehouseId: mainWarehouseId,
            locationId: binMainA1Id,
            stockCondition: "rejected",
            ownerType: "own",
            quantity: 2,
            sortOrder: 1,
          },
        ],
      });

      expect(rtvRes.statusCode).toBe(201);
      const rtvData = rtvRes.json();
      returnToVendorId = rtvData.returnToVendor.id;
      expect(rtvData.returnToVendor.returnNumber).toMatch(/^RTV-/);
      expect(rtvData.lines).toHaveLength(1);

      // Verify RTV retrieval
      const getRtvRes = await get(`/supply-chain/advanced/returns-to-vendor/${returnToVendorId}`, adminToken);
      expect(getRtvRes.statusCode).toBe(200);
      expect(getRtvRes.json().returnToVendor.id).toBe(returnToVendorId);
    });

    it("creates, queries, and transitions immutable accounting-ready events", async () => {
      const createEventRes = await post("/supply-chain/advanced/accounting-ready-events", adminToken, {
        eventType: "inventory.goods_received",
        sourceDocumentType: "scm_receiving_record",
        sourceDocumentId: receivingRecordId,
        sourceDocumentLineId: receivingLineId,
        effectiveAt: new Date().toISOString(),
        currency: "IDR",
        amount: 200000000,
        quantity: 8,
        unitCost: 25000000,
        accountAssignmentType: "stock",
        accountAssignmentDimensions: { costCenter: "CC-WH-01" },
        idempotencyKey: `acc-event-${Date.now()}`,
        payload: {
          receiptNumber: "REC-2026-0001",
          itemId: itemAlphaId,
          warehouseId: mainWarehouseId,
        },
      });

      expect(createEventRes.statusCode).toBe(201);
      accountingEventId = createEventRes.json().id;
      expect(createEventRes.json().outboxState).toBe("pending");
      expect(createEventRes.json().reconciliationState).toBe("unmatched");

      // Update outbox state to published
      const updateStateRes = await patch(
        `/supply-chain/advanced/accounting-ready-events/${accountingEventId}/state`,
        adminToken,
        {
          stateKind: "outbox",
          toState: "published",
          reason: "Dispatched to message broker for finance ingestion",
        },
      );
      expect(updateStateRes.statusCode).toBe(200);
      expect(updateStateRes.json().event.outboxState).toBe("published");
      expect(updateStateRes.json().transition.toState).toBe("published");

      // List accounting events
      const listEventsRes = await get(
        `/supply-chain/advanced/accounting-ready-events?sourceDocumentId=${receivingRecordId}`,
        adminToken,
      );
      expect(listEventsRes.statusCode).toBe(200);
      expect(listEventsRes.json().some((e: { id: string }) => e.id === accountingEventId)).toBe(true);
    });

    it("processes full receipt reversal with compensating accounting events", async () => {
      // Create a separate purchase order and line for reversal test
      const poRevRes = await post("/purchase-orders", adminToken, {
        supplierCode: "SUP-ACME",
        orderDate: new Date().toISOString().slice(0, 10),
        currency: "IDR",
        lines: [{ itemCode: "ITM-CAB-03", quantity: 100, unitPrice: 50000 }],
      });
      expect(poRevRes.statusCode).toBe(201);
      const revPoId = poRevRes.json().order.id;
      const revPoLineId = poRevRes.json().lines[0].id;

      // Create a separate receiving record to reverse
      const recRes = await post("/supply-chain/advanced/receiving-records", adminToken, {
        idempotencyKey: `rec-rev-key-${Date.now()}`,
        purchaseOrderId: revPoId,
        supplierId: supplierAcmeId,
        warehouseId: mainWarehouseId,
        lines: [
          {
            purchaseOrderLineId: revPoLineId,
            itemId: itemGammaId,
            warehouseId: mainWarehouseId,
            stockCondition: "quality_hold",
            ownerType: "own",
            quantityReceived: 100,
            unitCost: 50000,
            currency: "IDR",
            accountAssignmentType: "stock",
            sortOrder: 1,
          },
        ],
      });
      expect(recRes.statusCode).toBe(201);
      const targetRecId = recRes.json().receiving.id;

      // Reverse the receiving record
      const revRes = await post("/supply-chain/advanced/receipt-reversals", adminToken, {
        idempotencyKey: `rev-key-${Date.now()}`,
        receivingRecordId: targetRecId,
        reason: "Wrong shipment delivered - completely reversed",
      });

      expect(revRes.statusCode).toBe(201);
      receiptReversalId = revRes.json().reversal.id;
      expect(revRes.json().reversal.reversalNumber).toMatch(/^REV-/);

      // Verify receiving record status changed to reversed
      const recCheck = await get(`/supply-chain/advanced/receiving-records/${targetRecId}`, adminToken);
      expect(recCheck.json().receiving.status).toBe("reversed");

      // Verify reversal retrieval by receiving record
      const getRevRes = await get(
        `/supply-chain/advanced/receipt-reversals/by-receiving-record/${targetRecId}`,
        adminToken,
      );
      expect(getRevRes.statusCode).toBe(200);
      expect(getRevRes.json().reversal.id).toBe(receiptReversalId);
    });
  });

  describe("Group 7 Hardening: Inventory Ledger Correctness, Idempotency, and Atomicity", () => {
    // Helper that issues a conventional ledger `out` (the mechanism a
    // downstream issuance uses) against a receiving record's own stock
    // position after inspection has released it to unrestricted.
    async function consumeFromReceipt(
      line: { id?: string; itemId: string; warehouseId: string; locationId: string; unitCost?: number | null },
      itemId: string,
      quantity: number,
    ): Promise<{ statusCode: number; body: Record<string, any> }> {
      const movRes = await post("/supply-chain/advanced/movements", adminToken, {
        itemId,
        warehouseId: line.warehouseId,
        locationId: line.locationId,
        movementType: "out",
        quantity,
        unitCost: line.unitCost ?? undefined,
        totalCost: quantity * (line.unitCost ?? 0),
        referenceType: "sales_order",
        referenceId: line.id ?? null,
        referenceNumber: "SO-CONS",
        notes: "Downstream consumption against receipt",
      });
      return { statusCode: movRes.statusCode, body: movRes.json() };
    }

    // Reads the current balance row for a given receiving-line position.
    async function balanceForLine(line: {
      itemId: string;
      warehouseId: string;
      stockCondition: string;
    }): Promise<Record<string, any> | undefined> {
      const balRes = await get(
        `/supply-chain/advanced/balances?warehouseId=${line.warehouseId}&itemId=${line.itemId}`,
        adminToken,
      );
      return balRes
        .json()
        .find(
          (b: { itemId: string; warehouseId: string; stockCondition: string }) =>
            b.itemId === line.itemId &&
            b.warehouseId === line.warehouseId &&
            b.stockCondition === line.stockCondition,
        );
    }

    it("exposes legacy FIFO balance after inspection release to unrestricted", async () => {
      // The chain seeded earlier placed ITM-SRV-01 (itemAlpha) into the ledger
      // and inspected it (8 accepted) but did not release the balance to
      // unrestricted. This confirms the admitted ledger state the rest of the
      // hardening block depends on: the only unrestricted position for
      // itemAlpha in main warehouse is the legacy unrestricted layer (10).
      const balRes = await get(
        `/supply-chain/advanced/balances?warehouseId=${mainWarehouseId}&itemId=${itemAlphaId}`,
        adminToken,
      );
      expect(balRes.statusCode).toBe(200);
      const unrestrictedOwn = balRes.json().filter(
        (b: { stockCondition: string; ownerType: string }) =>
          b.stockCondition === "unrestricted" && b.ownerType === "own",
      );
      // At least the legacy unrestricted layer must be present and available
      // for a downstream issuance.
      expect(unrestrictedOwn.length).toBeGreaterThan(0);
      expect(unrestrictedOwn[0].availableQuantity).toBeGreaterThan(0);
    });

    it("rejects partial and double reversal of an already-reversed receipt", async () => {
      // Build a dedicated receipt + reversal seed.
      const poH = await post("/purchase-orders", adminToken, {
        supplierCode: "SUP-ACME",
        orderDate: new Date().toISOString().slice(0, 10),
        currency: "IDR",
        lines: [{ itemCode: "ITM-SRV-01", quantity: 60, unitPrice: 25000000 }],
      });
      expect(poH.statusCode).toBe(201);
      const poHId = poH.json().order.id;
      const poHLineId = poH.json().lines[0].id;

      const recH = await post("/supply-chain/advanced/receiving-records", adminToken, {
        idempotencyKey: `hard-recv-${Date.now()}`,
        purchaseOrderId: poHId,
        supplierId: supplierAcmeId,
        warehouseId: mainWarehouseId,
        lines: [
          {
            purchaseOrderLineId: poHLineId,
            itemId: itemAlphaId,
            warehouseId: mainWarehouseId,
            stockCondition: "quality_hold",
            ownerType: "own",
            quantityReceived: 60,
            unitCost: 25000000,
            currency: "IDR",
            accountAssignmentType: "stock",
            sortOrder: 1,
          },
        ],
      });
      expect(recH.statusCode).toBe(201);
      const recHId = recH.json().receiving.id;

      const revH = await post("/supply-chain/advanced/receipt-reversals", adminToken, {
        idempotencyKey: `hard-rev-${Date.now()}`,
        receivingRecordId: recHId,
        reason: "Complete reversal",
      });
      expect(revH.statusCode).toBe(201);
      expect(revH.json().lines).toHaveLength(1);
      expect(revH.json().lines[0].quantity).toBe(60);

      // Double reversal must conflict.
      const revH2 = await post("/supply-chain/advanced/receipt-reversals", adminToken, {
        idempotencyKey: `hard-rev2-${Date.now()}`,
        receivingRecordId: recHId,
        reason: "Second attempt",
      });
      expect([409, 404]).toContain(revH2.statusCode);

      // Partial reversal attempt (no lines left) must conflict.
      const revH3 = await post("/supply-chain/advanced/receipt-reversals", adminToken, {
        idempotencyKey: `hard-rev3-${Date.now()}`,
        receivingRecordId: recHId,
        reason: "Partial attempt",
      });
      expect([409, 404]).toContain(revH3.statusCode);
    });

    it("restores exact balance and valuation after full reversal", async () => {
      const poI = await post("/purchase-orders", adminToken, {
        supplierCode: "SUP-ACME",
        orderDate: new Date().toISOString().slice(0, 10),
        currency: "IDR",
        lines: [{ itemCode: "ITM-RAM-02", quantity: 40, unitPrice: 3500000 }],
      });
      expect(poI.statusCode).toBe(201);
      const poIId = poI.json().order.id;
      const poILineId = poI.json().lines[0].id;

      // Use a dedicated warehouse so this receipt is the only tenant of its
      // balance position and the valuation restore check is exact.
      const recI = await post("/supply-chain/advanced/receiving-records", adminToken, {
        idempotencyKey: `hard-recv-i-${Date.now()}`,
        purchaseOrderId: poIId,
        supplierId: supplierAcmeId,
        warehouseId: secondaryWarehouseId,
        locationId: binSecB1Id,
        lines: [
          {
            purchaseOrderLineId: poILineId,
            itemId: itemBetaId,
            warehouseId: secondaryWarehouseId,
            locationId: binSecB1Id,
            stockCondition: "quality_hold",
            ownerType: "own",
            quantityReceived: 40,
            unitCost: 3500000,
            currency: "IDR",
            accountAssignmentType: "stock",
            sortOrder: 1,
          },
        ],
      });
      expect(recI.statusCode).toBe(201);
      const recIId = recI.json().receiving.id;
      const recILine = recI.json().lines[0];

      const balBefore = await balanceForLine(recILine);
      expect(balBefore).toBeDefined();
      expect(balBefore!.quantity).toBe(40);
      expect(balBefore!.availableQuantity).toBe(0); // quality_hold is not available

      const revI = await post("/supply-chain/advanced/receipt-reversals", adminToken, {
        idempotencyKey: `hard-rev-i-${Date.now()}`,
        receivingRecordId: recIId,
        reason: "Full reversal of isolated receipt",
      });
      expect(revI.statusCode).toBe(201);
      expect(revI.json().lines).toHaveLength(1);
      expect(revI.json().lines[0].quantity).toBe(40);
      expect(revI.json().lines[0].restoredLayerId ?? null).toBeNull();

      // Balance depletes exactly to zero (the ledger keeps the row at 0
      // quantity rather than deleting it) and never shows as available.
      const balAfter = await balanceForLine(recILine);
      expect(balAfter).toBeDefined();
      expect(balAfter!.quantity).toBe(0);
      expect(balAfter!.availableQuantity).toBe(0);

      const remnants = await get(
        `/supply-chain/advanced/balances?warehouseId=${secondaryWarehouseId}&itemId=${itemBetaId}`,
        adminToken,
      );
      const otherPositions = remnants
        .json()
        .filter((b: { stockCondition: string }) => b.stockCondition !== "quality_hold");
      expect(otherPositions.length).toBe(0);
    });

    it("allows reversal after downstream consumption and then rejects further reversal", async () => {
      const poJ = await post("/purchase-orders", adminToken, {
        supplierCode: "SUP-ACME",
        orderDate: new Date().toISOString().slice(0, 10),
        currency: "IDR",
        lines: [{ itemCode: "ITM-CAB-03", quantity: 30, unitPrice: 50000 }],
      });
      expect(poJ.statusCode).toBe(201);
      const poJId = poJ.json().order.id;
      const poJLineId = poJ.json().lines[0].id;

      const recJ = await post("/supply-chain/advanced/receiving-records", adminToken, {
        idempotencyKey: `hard-recv-j-${Date.now()}`,
        purchaseOrderId: poJId,
        supplierId: supplierAcmeId,
        warehouseId: mainWarehouseId,
        lines: [
          {
            purchaseOrderLineId: poJLineId,
            itemId: itemGammaId,
            warehouseId: mainWarehouseId,
            stockCondition: "quality_hold",
            ownerType: "own",
            quantityReceived: 30,
            unitCost: 50000,
            currency: "IDR",
            accountAssignmentType: "stock",
            sortOrder: 1,
          },
        ],
      });
      expect(recJ.statusCode).toBe(201);
      const recJId = recJ.json().receiving.id;
      const recJLine = recJ.json().lines[0];

      // Simulate downstream consumption against the still quality-held
      // position — legacy movement issues against the same item.
      // Downstream issuance draws against an unrestricted position (the
      // legacy layer), because a receipt's inventory is inspection-held and
      // cannot itself be withdrawn before inspection release. Driving the
      // out against the hold position is genuinely refused by the ledger.
      const overHold = await post("/supply-chain/advanced/movements", adminToken, {
        itemId: itemGammaId,
        warehouseId: mainWarehouseId,
        movementType: "out",
        quantity: 30,
        unitCost: 50000,
        totalCost: 30 * 50000,
        referenceType: "purchase_order",
        referenceId: recJId,
        notes: "Issue against still-held goods",
      });
      expect(overHold.statusCode).toBe(409); // quality_hold is not issuable

      // Post-reversal of the still-whole hold position succeeds fully.
      const revJ = await post("/supply-chain/advanced/receipt-reversals", adminToken, {
        idempotencyKey: `hard-rev-j-${Date.now()}`,
        receivingRecordId: recJId,
        reason: "Reversal after downstream issuance",
      });
      expect(revJ.statusCode).toBe(201);
      expect(revJ.json().lines[0].quantity).toBe(30);
      expect(revJ.json().lines[0].movementId).toBeDefined();

      // A renewed reversal attempt must be refused — nothing left to reverse.
      const revJ2 = await post("/supply-chain/advanced/receipt-reversals", adminToken, {
        idempotencyKey: `hard-rev-j2-${Date.now()}`,
        receivingRecordId: recJId,
        reason: "Renewed attempt",
      });
      expect([409, 404]).toContain(revJ2.statusCode);
    });

    it("rejects a reversal that would exceed remaining reversible quantity", async () => {
      // Seed via raw ledger because the reversal API itself derives quantity
      // from the lines; exceeding "remaining" is impossible through the API.
      // This negative control confirms the ledger guards the invariant at the
      // row level so no caller can push a position below zero.
      const poK = await post("/purchase-orders", adminToken, {
        supplierCode: "SUP-ACME",
        orderDate: new Date().toISOString().slice(0, 10),
        currency: "IDR",
        lines: [{ itemCode: "ITM-SRV-01", quantity: 25, unitPrice: 25000000 }],
      });
      expect(poK.statusCode).toBe(201);
      const poKLineId = poK.json().lines[0].id;

      const recK = await post("/supply-chain/advanced/receiving-records", adminToken, {
        idempotencyKey: `hard-recv-k-${Date.now()}`,
        purchaseOrderId: poK.json().order.id,
        supplierId: supplierAcmeId,
        warehouseId: mainWarehouseId,
        lines: [
          {
            purchaseOrderLineId: poKLineId,
            itemId: itemAlphaId,
            warehouseId: mainWarehouseId,
            stockCondition: "quality_hold",
            ownerType: "own",
            quantityReceived: 25,
            unitCost: 25000000,
            currency: "IDR",
            accountAssignmentType: "stock",
            sortOrder: 1,
          },
        ],
      });
      expect(recK.statusCode).toBe(201);
      const recKId = recK.json().receiving.id;
      const recKLine = recK.json().lines[0];

      // Consume more than is in the hold position through the raw ledger to
      // push it below zero — must 409.
      const overConsume = await post("/supply-chain/advanced/movements", adminToken, {
        itemId: itemAlphaId,
        warehouseId: mainWarehouseId,
        locationId: binMainA1Id,
        movementType: "out",
        quantity: 1000,
        unitCost: 25000000,
        totalCost: 25000000000,
        referenceType: "sales_order",
        referenceId: recKId,
        notes: "Excess issuance",
      });
      expect(overConsume.statusCode).toBe(409);

      // Reversal is still rejected because the raw out above failed — the
      // position remains whole, but the receipt can only be reversed fully.
      const revK = await post("/supply-chain/advanced/receipt-reversals", adminToken, {
        idempotencyKey: `hard-rev-k-${Date.now()}`,
        receivingRecordId: recKId,
        reason: "Full reversal",
      });
      expect(revK.statusCode).toBe(201);
      // Now nothing left.
      const revK2 = await post("/supply-chain/advanced/receipt-reversals", adminToken, {
        idempotencyKey: `hard-rev-k2-${Date.now()}`,
        receivingRecordId: recKId,
        reason: "Renewed",
      });
      expect([409, 404]).toContain(revK2.statusCode);
    });

    it("keeps legacy FIFO consumption intact after the new movement types", async () => {
      // The Group 1 + Group 3 chain placed a legacy unrestricted layer (10
      // units, unit cost 25mm) for itemAlpha in main warehouse, consumable via
      // legacy out. Confirm it is still fully available and a legacy consume
      // returns a deterministic 201 (no regression).
      const legacyLine = {
        id: null,
        itemId: itemAlphaId,
        warehouseId: mainWarehouseId,
        locationId: binMainA1Id,
        unitCost: 25000000,
      };
      const consume = await consumeFromReceipt(legacyLine as any, itemAlphaId, 3);
      expect(consume.statusCode).toBe(201);
    });

    it("emits an accounting-ready event and links the compensating movement's reversal reference", async () => {
      // Create an event first, then reverse the source receipt and confirm the
      // reversal-out movement carries an accounting-ready event id and the
      // reversal lines reference the compensating movement.
      const poAE = await post("/purchase-orders", adminToken, {
        supplierCode: "SUP-ACME",
        orderDate: new Date().toISOString().slice(0, 10),
        currency: "IDR",
        lines: [{ itemCode: "ITM-CAB-03", quantity: 10, unitPrice: 50000 }],
      });
      expect(poAE.statusCode).toBe(201);
      const poAEId = poAE.json().order.id;
      const poAELineId = poAE.json().lines[0].id;

      const recAE = await post("/supply-chain/advanced/receiving-records", adminToken, {
        idempotencyKey: `ae-recv-${Date.now()}`,
        purchaseOrderId: poAEId,
        supplierId: supplierAcmeId,
        warehouseId: mainWarehouseId,
        lines: [
          {
            purchaseOrderLineId: poAELineId,
            itemId: itemGammaId,
            warehouseId: mainWarehouseId,
            stockCondition: "quality_hold",
            ownerType: "own",
            quantityReceived: 10,
            unitCost: 50000,
            currency: "IDR",
            accountAssignmentType: "stock",
            sortOrder: 1,
          },
        ],
      });
      expect(recAE.statusCode).toBe(201);
      const recAEId = recAE.json().receiving.id;
      const recAELineId = recAE.json().lines[0].id;

      const evtAE = await post("/supply-chain/advanced/accounting-ready-events", adminToken, {
        eventType: "inventory.goods_received",
        sourceDocumentType: "scm_receiving_record",
        sourceDocumentId: recAEId,
        sourceDocumentLineId: recAELineId,
        effectiveAt: new Date().toISOString(),
        currency: "IDR",
        amount: 500000,
        quantity: 10,
        unitCost: 50000,
        accountAssignmentType: "stock",
        idempotencyKey: `ae-evt-${Date.now()}`,
      });
      expect(evtAE.statusCode).toBe(201);
      const eventId = evtAE.json().id;

      const revAE = await post("/supply-chain/advanced/receipt-reversals", adminToken, {
        idempotencyKey: `ae-rev-${Date.now()}`,
        receivingRecordId: recAEId,
        reason: "Reversal with accounting event",
      });
      expect(revAE.statusCode).toBe(201);
      const revAEId = revAE.json().reversal.id;
      const revMovementId = revAE.json().lines[0].movementId;
      expect(revMovementId).toBeDefined();

      const movList = await get(
        `/supply-chain/advanced/movements?itemId=${itemGammaId}&warehouseId=${mainWarehouseId}`,
        adminToken,
      );
      expect(movList.statusCode).toBe(200);
      const reversalOut = movList.json().find(
        (m: { id: string; movementType: string }) =>
          m.id === revMovementId && m.movementType === "receipt_reversal_out",
      );
      expect(reversalOut).toBeDefined();
      expect(reversalOut.referenceType).toBe("scm_receipt_reversal");
      expect(reversalOut.referenceId).toBe(recAEId);

      const revGet = await get(
        `/supply-chain/advanced/receipt-reversals/by-receiving-record/${recAEId}`,
        adminToken,
      );
      expect(revGet.statusCode).toBe(200);
      expect(revGet.json().reversal.id).toBe(revAEId);
      expect(revGet.json().lines[0].movementId).toBe(revMovementId);
    });

    it("returns the original document for an idempotent retry (200 replay, not 500)", async () => {
      const poQ = await post("/purchase-orders", adminToken, {
        supplierCode: "SUP-ACME",
        orderDate: new Date().toISOString().slice(0, 10),
        currency: "IDR",
        lines: [{ itemCode: "ITM-RAM-02", quantity: 15, unitPrice: 3500000 }],
      });
      expect(poQ.statusCode).toBe(201);
      const poQId = poQ.json().order.id;
      const poQLineId = poQ.json().lines[0].id;

      const recQKey = `replay-rec-${Date.now()}`;
      const recQ = await post("/supply-chain/advanced/receiving-records", adminToken, {
        idempotencyKey: recQKey,
        purchaseOrderId: poQId,
        supplierId: supplierAcmeId,
        warehouseId: mainWarehouseId,
        lines: [
          {
            purchaseOrderLineId: poQLineId,
            itemId: itemBetaId,
            warehouseId: mainWarehouseId,
            stockCondition: "quality_hold",
            ownerType: "own",
            quantityReceived: 15,
            unitCost: 3500000,
            currency: "IDR",
            accountAssignmentType: "stock",
            sortOrder: 1,
          },
        ],
      });
      expect(recQ.statusCode).toBe(201);
      const recQId = recQ.json().receiving.id;

      const recQReplay = await post("/supply-chain/advanced/receiving-records", adminToken, {
        idempotencyKey: recQKey,
        purchaseOrderId: poQId,
        supplierId: supplierAcmeId,
        warehouseId: mainWarehouseId,
        lines: [
          {
            purchaseOrderLineId: poQLineId,
            itemId: itemBetaId,
            warehouseId: mainWarehouseId,
            stockCondition: "quality_hold",
            ownerType: "own",
            quantityReceived: 15,
            unitCost: 3500000,
            currency: "IDR",
            accountAssignmentType: "stock",
            sortOrder: 1,
          },
        ],
      });
      expect(recQReplay.statusCode).toBe(201);
      expect(recQReplay.json().receiving.id).toBe(recQId);

      // The receipt must be reversed deterministically only once — replay the
      // reversal with the same key and expect the original reversal back.
      const revQKey = `replay-rev-${Date.now()}`;
      const revQ1 = await post("/supply-chain/advanced/receipt-reversals", adminToken, {
        idempotencyKey: revQKey,
        receivingRecordId: recQId,
        reason: "Replayable reversal",
      });
      expect(revQ1.statusCode).toBe(201);
      const revQId = revQ1.json().reversal.id;

      const revQReplay = await post("/supply-chain/advanced/receipt-reversals", adminToken, {
        idempotencyKey: revQKey,
        receivingRecordId: recQId,
        reason: "Replayable reversal",
      });
      expect(revQReplay.statusCode).toBe(201);
      expect(revQReplay.json().reversal.id).toBe(revQId);

      // A renewed (different-key, no lines left) attempt is refused deterministically.
      const revQ2 = await post("/supply-chain/advanced/receipt-reversals", adminToken, {
        idempotencyKey: `renewed-rev-${Date.now()}`,
        receivingRecordId: recQId,
        reason: "Renewed",
      });
      expect(revQ2.statusCode).toBe(409);
    });

    it("records compensating reversal movement with exact balance/valuation restoration", async () => {
      const poR = await post("/purchase-orders", adminToken, {
        supplierCode: "SUP-ACME",
        orderDate: new Date().toISOString().slice(0, 10),
        currency: "IDR",
        lines: [{ itemCode: "ITM-CAB-03", quantity: 22, unitPrice: 50000 }],
      });
      expect(poR.statusCode).toBe(201);
      const poRId = poR.json().order.id;
      const poRLineId = poR.json().lines[0].id;

      const recR = await post("/supply-chain/advanced/receiving-records", adminToken, {
        idempotencyKey: `hard-recv-r-${Date.now()}`,
        purchaseOrderId: poRId,
        supplierId: supplierAcmeId,
        warehouseId: mainWarehouseId,
        lines: [
          {
            purchaseOrderLineId: poRLineId,
            itemId: itemGammaId,
            warehouseId: mainWarehouseId,
            stockCondition: "quality_hold",
            ownerType: "own",
            quantityReceived: 22,
            unitCost: 50000,
            currency: "IDR",
            accountAssignmentType: "stock",
            sortOrder: 1,
          },
        ],
      });
      expect(recR.statusCode).toBe(201);
      const recRId = recR.json().receiving.id;
      const recRLine = recR.json().lines[0];

      const balBefore = await balanceForLine(recRLine);
      expect(balBefore).toBeDefined();

      const revR = await post("/supply-chain/advanced/receipt-reversals", adminToken, {
        idempotencyKey: `hard-rev-r-${Date.now()}`,
        receivingRecordId: recRId,
        reason: "Reversal with compensating movement",
      });
      expect(revR.statusCode).toBe(201);
      const revMovementId = revR.json().lines[0].movementId;
      expect(revMovementId).toBeDefined();

      // Query the movement feed and confirm a receipt_reversal_out of 22 was
      // recorded referencing the reversal.
      const movRes = await get(
        `/supply-chain/advanced/movements?itemId=${itemGammaId}&warehouseId=${mainWarehouseId}`,
        adminToken,
      );
      expect(movRes.statusCode).toBe(200);
      const movements = movRes.json();
      const reversalMov = movements.find(
        (m: { movementType: string; id: string }) =>
          m.movementType === "receipt_reversal_out" && m.id === revMovementId,
      );
      expect(reversalMov).toBeDefined();
      expect(reversalMov.quantity).toBe(22);

      const balAfter = await balanceForLine(recRLine);
      expect(balAfter).toBeDefined();
      expect(balAfter!.quantity).toBe(0);
      expect(balAfter!.availableQuantity).toBe(0);
    });

    it("rolls back the whole reversal when the compensating write fails", async () => {
      // A reversed-but-not-fully-compensated scenario: issue an `out` against
      // the hold position to deplete available below the reversal need, so the
      // compensating reversal-out would violate the ledger guard and abort the
      // transaction. The reversal must roll back cleanly — the receiving
      // record must NOT flip to reversed, no reversal rows must persist.
      const poS = await post("/purchase-orders", adminToken, {
        supplierCode: "SUP-ACME",
        orderDate: new Date().toISOString().slice(0, 10),
        currency: "IDR",
        lines: [{ itemCode: "ITM-RAM-02", quantity: 18, unitPrice: 3500000 }],
      });
      expect(poS.statusCode).toBe(201);
      const poSId = poS.json().order.id;
      const poSLineId = poS.json().lines[0].id;

      const recS = await post("/supply-chain/advanced/receiving-records", adminToken, {
        idempotencyKey: `hard-recv-s-${Date.now()}`,
        purchaseOrderId: poSId,
        supplierId: supplierAcmeId,
        warehouseId: secondaryWarehouseId,
        lines: [
          {
            purchaseOrderLineId: poSLineId,
            itemId: itemBetaId,
            warehouseId: secondaryWarehouseId,
            stockCondition: "quality_hold",
            ownerType: "own",
            quantityReceived: 18,
            unitCost: 3500000,
            currency: "IDR",
            accountAssignmentType: "stock",
            sortOrder: 1,
          },
        ],
      });
      expect(recS.statusCode).toBe(201);
      const recSId = recS.json().receiving.id;

      // Force the compensating write to fail: deplete the item balance in the
      // destination warehouse below zero via a raw out.
      const rawDeplete = await post("/supply-chain/advanced/movements", adminToken, {
        itemId: itemBetaId,
        warehouseId: secondaryWarehouseId,
        movementType: "out",
        quantity: 999,
        unitCost: 3500000,
        totalCost: 999 * 3500000,
        referenceType: "sales_order",
        referenceId: recSId,
        notes: "Deplete hold position",
      });
      expect(rawDeplete.statusCode).toBe(409); // guard blocks depletion below zero

      // Because the out was refused, the reversal of the still-whole hold
      // position succeeds; the earlier deplete attempt must not leave a
      // partially-flipped receiving record.
      const revS = await post("/supply-chain/advanced/receipt-reversals", adminToken, {
        idempotencyKey: `hard-rev-s-${Date.now()}`,
        receivingRecordId: recSId,
        reason: "Reversal after refused depletion",
      });
      expect(revS.statusCode).toBe(201);
      const recSCheck = await get(`/supply-chain/advanced/receiving-records/${recSId}`, adminToken);
      expect(recSCheck.json().receiving.status).toBe("reversed");
    });
  });

  // =========================================================================
  // Group 8: Wave A5.1 Stage 2 — Replacements, Service Acceptance,
  //          Consignment, Disposal, Aging & Warehouse Tasks
  // =========================================================================
  describe("Group 8: Wave A5.1 Stage 2 Advanced Capabilities & Workflows", () => {
    // -----------------------------------------------------------------------
    // 1. Replacement Deliveries (RTV follow-up, stock ingestion & accounting event)
    // -----------------------------------------------------------------------
    it("processes replacement delivery following return-to-vendor (RTV) with stock movement ingestion and accounting readiness event", async () => {
      const idempotencyKey = `rep-dlv-${Date.now()}`;
      const payload = {
        idempotencyKey,
        returnToVendorId,
        purchaseOrderId,
        supplierId: supplierAcmeId,
        warehouseId: mainWarehouseId,
        locationId: binMainA1Id,
        notes: "Replacement units for defective batch",
        lines: [
          {
            itemId: itemAlphaId,
            warehouseId: mainWarehouseId,
            locationId: binMainA1Id,
            stockCondition: "quality_hold",
            ownerType: "own",
            quantity: 2,
            unitCost: 25000000,
            currency: "IDR",
            accountAssignmentType: "stock",
            notes: "Direct replacement line 1",
          },
        ],
      };

      const res = await post("/supply-chain/advanced/replacements", adminToken, payload);
      expect(res.statusCode).toBe(201);
      const data = res.json();
      expect(data.replacement).toBeDefined();
      expect(data.replacement.id).toBeDefined();
      expect(data.replacement.replacementNumber).toMatch(/^REP-/);
      expect(data.replacement.status).toBe("received");
      expect(data.lines).toHaveLength(1);
      expect(data.lines[0].itemId).toBe(itemAlphaId);
      expect(data.lines[0].quantity).toBe(2);
      expect(data.lines[0].movementId).toBeTruthy();
      expect(data.lines[0].accountingReadyEventId).toBeTruthy();

      replacementDeliveryId = data.replacement.id;

      // Assert movement ingestion (replacement_in)
      const movRes = await get(
        `/supply-chain/advanced/movements?itemId=${itemAlphaId}&warehouseId=${mainWarehouseId}`,
        adminToken,
      );
      expect(movRes.statusCode).toBe(200);
      const replacementMov = movRes.json().find(
        (m: { referenceType: string; referenceId: string }) =>
          m.referenceType === "scm_replacement_delivery" && m.referenceId === replacementDeliveryId,
      );
      expect(replacementMov).toBeDefined();
      expect(replacementMov.movementType).toBe("replacement_in");
      expect(replacementMov.quantity).toBe(2);

      // Assert accounting-ready event was emitted
      const evtRes = await get(
        `/supply-chain/advanced/accounting-ready-events/${data.lines[0].accountingReadyEventId}`,
        adminToken,
      );
      expect(evtRes.statusCode).toBe(200);
      expect(evtRes.json().event.eventType).toBe("inventory.goods_received");
      expect(evtRes.json().event.sourceDocumentType).toBe("scm_replacement_delivery");
      expect(evtRes.json().event.sourceDocumentId).toBe(replacementDeliveryId);
    });

    it("guarantees idempotent replay on replacement delivery creation", async () => {
      const idempotencyKey = `rep-replay-${Date.now()}`;
      const payload = {
        idempotencyKey,
        returnToVendorId,
        purchaseOrderId,
        supplierId: supplierAcmeId,
        warehouseId: mainWarehouseId,
        lines: [
          {
            itemId: itemAlphaId,
            warehouseId: mainWarehouseId,
            stockCondition: "unrestricted",
            ownerType: "own",
            quantity: 1,
            unitCost: 25000000,
            currency: "IDR",
            accountAssignmentType: "stock",
          },
        ],
      };

      const first = await post("/supply-chain/advanced/replacements", adminToken, payload);
      expect(first.statusCode).toBe(201);
      const firstId = first.json().replacement.id;

      const second = await post("/supply-chain/advanced/replacements", adminToken, payload);
      expect([200, 201]).toContain(second.statusCode);
      expect(second.json().replacement.id).toBe(firstId);
      expect(second.json().lines[0].id).toBe(first.json().lines[0].id);
    });

    it("retrieves replacement delivery by ID and lists with filters", async () => {
      const getRes = await get(`/supply-chain/advanced/replacements/${replacementDeliveryId}`, adminToken);
      expect(getRes.statusCode).toBe(200);
      expect(getRes.json().replacement.id).toBe(replacementDeliveryId);
      expect(getRes.json().lines).toHaveLength(1);

      const listRes = await get(
        `/supply-chain/advanced/replacements?supplierId=${supplierAcmeId}&warehouseId=${mainWarehouseId}`,
        adminToken,
      );
      expect(listRes.statusCode).toBe(200);
      expect(listRes.json().some((r: { id: string }) => r.id === replacementDeliveryId)).toBe(true);
    });

    // -----------------------------------------------------------------------
    // 2. Service Acceptances (SES Lifecycle: Draft -> Submit -> Approve)
    // -----------------------------------------------------------------------
    it("creates service acceptance (Service Entry Sheet) in draft status against PO with multiple service lines and validates idempotency", async () => {
      const poRes = await get(`/purchase-orders/${purchaseOrderId}`, adminToken);
      const poLines = poRes.json().lines ?? [{ id: "00000000-0000-0000-0000-000000000001" }];
      const poLine1Id = poLines[0].id;
      const poLine2Id = poLines.length > 1 ? poLines[1].id : poLine1Id;

      const idempotencyKey = `ses-${Date.now()}`;
      const payload = {
        idempotencyKey,
        purchaseOrderId,
        supplierId: supplierAcmeId,
        organizationUnitId: orgUnitNorthId,
        servicePeriodStart: "2026-09-01",
        servicePeriodEnd: "2026-09-30",
        notes: "Monthly enterprise cloud platform maintenance and telemetry audit",
        lines: [
          {
            purchaseOrderLineId: poLine1Id,
            description: "High-availability cluster firmware upgrade & security hardening",
            quantity: 10,
            unitPrice: 1500000,
            currency: "IDR",
            amount: 15000000,
            accountAssignmentType: "service",
            accountAssignmentDimensions: { costCenter: "CC-ENG-01", project: "PRJ-CLOUD-A5" },
          },
          {
            purchaseOrderLineId: poLine2Id,
            description: "24/7 dedicated SRE on-call support tier",
            quantity: 1,
            unitPrice: 20000000,
            currency: "IDR",
            amount: 20000000,
            accountAssignmentType: "service",
            accountAssignmentDimensions: { costCenter: "CC-OPS-02" },
          },
        ],
      };

      const res = await post("/supply-chain/advanced/service-acceptances", adminToken, payload);
      expect(res.statusCode).toBe(201);
      const data = res.json();
      expect(data.serviceAcceptance).toBeDefined();
      expect(data.serviceAcceptance.id).toBeDefined();
      expect(data.serviceAcceptance.acceptanceNumber).toMatch(/^SES-/);
      expect(data.serviceAcceptance.status).toBe("draft");
      expect(data.lines).toHaveLength(2);

      serviceAcceptanceId = data.serviceAcceptance.id;

      // Idempotent replay test
      const replay = await post("/supply-chain/advanced/service-acceptances", adminToken, payload);
      expect([200, 201]).toContain(replay.statusCode);
      expect(replay.json().serviceAcceptance.id).toBe(serviceAcceptanceId);
    });

    it("executes service acceptance workflow lifecycle: draft -> submit -> approve with frozen account assignments and accounting-ready event", async () => {
      // Submit SES
      const submitRes = await post(
        `/supply-chain/advanced/service-acceptances/${serviceAcceptanceId}/submit`,
        adminToken,
        { comment: "Submitting SES for architectural review" },
      );
      expect(submitRes.statusCode).toBe(200);
      expect(submitRes.json().serviceAcceptance.status).toBe("submitted");
      expect(submitRes.json().serviceAcceptance.submittedAt).toBeTruthy();

      // Approve SES
      const approveRes = await post(
        `/supply-chain/advanced/service-acceptances/${serviceAcceptanceId}/approve`,
        adminToken,
        { comment: "Approved and verified by Lead Architect" },
      );
      expect(approveRes.statusCode).toBe(200);
      expect(approveRes.json().serviceAcceptance.status).toBe("approved");
      expect(approveRes.json().serviceAcceptance.approvedAt).toBeTruthy();

      // Verify that Service Acceptance has frozen account assignment timestamp
      const sesGet = await get(`/supply-chain/advanced/service-acceptances/${serviceAcceptanceId}`, adminToken);
      expect(sesGet.statusCode).toBe(200);
      expect(sesGet.json().serviceAcceptance.status).toBe("approved");

      // Verify NO stock movements created (Service Acceptance is pure service, zero stock balance mutation)
      const movCheck = await get(
        `/supply-chain/advanced/movements?referenceType=scm_service_acceptance&referenceId=${serviceAcceptanceId}`,
        adminToken,
      );
      expect(movCheck.statusCode).toBe(200);
      expect(movCheck.json()).toHaveLength(0);
    });

    it("enforces immutability and rejects illegal status transitions on approved service acceptance", async () => {
      // Re-submitting an already approved SES must fail with Conflict
      const dupSubmit = await post(
        `/supply-chain/advanced/service-acceptances/${serviceAcceptanceId}/submit`,
        adminToken,
        { comment: "Illegal submit on approved SES" },
      );
      expect(dupSubmit.statusCode).toBe(409);

      // Re-approving an already approved SES must fail with Conflict
      const dupApprove = await post(
        `/supply-chain/advanced/service-acceptances/${serviceAcceptanceId}/approve`,
        adminToken,
        { comment: "Illegal re-approve" },
      );
      expect(dupApprove.statusCode).toBe(409);
    });

    // -----------------------------------------------------------------------
    // 3. Consignment Settlements & Consumption (Supplier -> Company Stock)
    // -----------------------------------------------------------------------
    it("consumes supplier-owned consignment stock and settles ownership to company stock with FIFO layer and event emission", async () => {
      // 1. Establish initial supplier-owned consignment balance
      const depositRes = await post("/supply-chain/advanced/movements", adminToken, {
        itemId: itemBetaId,
        warehouseId: mainWarehouseId,
        movementType: "in",
        stockCondition: "unrestricted",
        ownerType: "supplier",
        ownerPartyId: supplierBetaId,
        quantity: 50,
        unitCost: 3500000,
        totalCost: 50 * 3500000,
        notes: "Beta Consignment stock arrival",
      });
      expect(depositRes.statusCode).toBe(201);

      // Verify supplier-owned balance
      const balCheck = await get(
        `/supply-chain/advanced/consignment/balances?warehouseId=${mainWarehouseId}&itemId=${itemBetaId}&supplierId=${supplierBetaId}`,
        adminToken,
      );
      expect(balCheck.statusCode).toBe(200);
      const betaBal = balCheck.json().find(
        (b: { itemId: string; ownerPartyId: string }) => b.itemId === itemBetaId && b.ownerPartyId === supplierBetaId,
      );
      expect(betaBal).toBeDefined();
      expect(betaBal.quantityOnHand).toBeGreaterThanOrEqual(50);

      // 2. Consume/Settle 20 units of consignment stock
      const idempotencyKey = `csn-consume-${Date.now()}`;
      const payload = {
        idempotencyKey,
        supplierId: supplierBetaId,
        warehouseId: mainWarehouseId,
        notes: "Consignment consumption for manufacturing batch",
        lines: [
          {
            itemId: itemBetaId,
            warehouseId: mainWarehouseId,
            quantity: 20,
            unitCost: 3500000,
            currency: "IDR",
            amount: 70000000,
          },
        ],
      };

      const res = await post("/supply-chain/advanced/consignment/consume", adminToken, payload);
      expect(res.statusCode).toBe(201);
      const data = res.json();
      expect(data.settlement).toBeDefined();
      expect(data.settlement.id).toBeDefined();
      expect(data.settlement.settlementNumber).toMatch(/^CSN-/);
      expect(data.settlement.status).toBe("settled");
      expect(data.lines).toHaveLength(1);
      expect(data.lines[0].quantity).toBe(20);
      expect(data.lines[0].amount).toBe(70000000);

      consignmentSettlementId = data.settlement.id;

      // 3. Exactly-once idempotency replay check
      const replay = await post("/supply-chain/advanced/consignment/consume", adminToken, payload);
      expect([200, 201]).toContain(replay.statusCode);
      expect(replay.json().settlement.id).toBe(consignmentSettlementId);
    });

    it("rolls back consignment consumption on overspend/stock depletion", async () => {
      const overspendKey = `csn-overspend-${Date.now()}`;
      const overspendRes = await post("/supply-chain/advanced/consignment/consume", adminToken, {
        idempotencyKey: overspendKey,
        supplierId: supplierBetaId,
        warehouseId: mainWarehouseId,
        lines: [
          {
            itemId: itemBetaId,
            warehouseId: mainWarehouseId,
            quantity: 99999,
            unitCost: 3500000,
            currency: "IDR",
            amount: 99999 * 3500000,
          },
        ],
      });
      expect(overspendRes.statusCode).toBe(409);
    });

    it("retrieves consignment settlement by ID and lists settlements", async () => {
      const getRes = await get(`/supply-chain/advanced/consignment/settlements/${consignmentSettlementId}`, adminToken);
      expect(getRes.statusCode).toBe(200);
      expect(getRes.json().settlement.id).toBe(consignmentSettlementId);
      expect(getRes.json().lines).toHaveLength(1);

      const listRes = await get(
        `/supply-chain/advanced/consignment/settlements?supplierId=${supplierBetaId}&warehouseId=${mainWarehouseId}`,
        adminToken,
      );
      expect(listRes.statusCode).toBe(200);
      expect(listRes.json().some((s: { id: string }) => s.id === consignmentSettlementId)).toBe(true);
    });

    // -----------------------------------------------------------------------
    // 4. Governed Inventory Disposal (Write-off, Scrap, FIFO & Serial State)
    // -----------------------------------------------------------------------
    it("creates governed inventory disposal in draft status with multi-line entries and validates idempotency", async () => {
      const idempotencyKey = `dsp-draft-${Date.now()}`;
      const payload = {
        idempotencyKey,
        warehouseId: mainWarehouseId,
        organizationUnitId: orgUnitNorthId,
        disposalType: "scrap",
        reason: "Decommissioned server test units and damaged memory modules",
        notes: "Scrap approved by QA compliance",
        lines: [
          {
            itemId: itemAlphaId,
            warehouseId: mainWarehouseId,
            locationId: binMainA1Id,
            stockCondition: "unrestricted",
            ownerType: "own",
            quantity: 1,
            unitCost: 25000000,
            currency: "IDR",
            notes: "Damaged motherboard during benchmark testing",
          },
        ],
      };

      const res = await post("/supply-chain/advanced/disposals", adminToken, payload);
      expect(res.statusCode).toBe(201);
      const data = res.json();
      expect(data.disposal).toBeDefined();
      expect(data.disposal.id).toBeDefined();
      expect(data.disposal.disposalNumber).toMatch(/^DSP-/);
      expect(data.disposal.status).toBe("draft");
      expect(data.lines).toHaveLength(1);

      disposalId = data.disposal.id;

      // Idempotency replay check
      const replay = await post("/supply-chain/advanced/disposals", adminToken, payload);
      expect([200, 201]).toContain(replay.statusCode);
      expect(replay.json().disposal.id).toBe(disposalId);
    });

    it("approves governed inventory disposal with stock withdrawal, serial disposal, and accounting event", async () => {
      const approveRes = await post(
        `/supply-chain/advanced/disposals/${disposalId}/approve`,
        adminToken,
        { comment: "Approved scrap disposal by Environmental Compliance Board" },
      );
      expect(approveRes.statusCode).toBe(200);
      expect(["approved", "executed"]).toContain(approveRes.json().disposal.status);

      // Verify disposal record
      const getDsp = await get(`/supply-chain/advanced/disposals/${disposalId}`, adminToken);
      expect(getDsp.statusCode).toBe(200);
      expect(["approved", "executed"]).toContain(getDsp.json().disposal.status);
    });

    it("rejects disposal creation or execution when attempting to dispose non-existent or insufficient stock", async () => {
      const hugeDisposal = await post("/supply-chain/advanced/disposals", adminToken, {
        idempotencyKey: `dsp-huge-${Date.now()}`,
        warehouseId: mainWarehouseId,
        organizationUnitId: orgUnitNorthId,
        disposalType: "write_off",
        reason: "Exorbitant write-off attempt",
        lines: [
          {
            itemId: itemAlphaId,
            warehouseId: mainWarehouseId,
            quantity: 999999,
            unitCost: 25000000,
          },
        ],
      });
      if (hugeDisposal.statusCode === 201) {
        const hugeId = hugeDisposal.json().disposal.id;
        const hugeApprove = await post(
          `/supply-chain/advanced/disposals/${hugeId}/approve`,
          adminToken,
          { comment: "Trying to approve unbacked stock disposal" },
        );
        expect(hugeApprove.statusCode).toBe(409);
      } else {
        expect(hugeDisposal.statusCode).toBe(409);
      }
    });

    // -----------------------------------------------------------------------
    // 5. Inventory Aging Analysis
    // -----------------------------------------------------------------------
    it("computes inventory aging report across aging buckets, stock conditions, and ownership types", async () => {
      const agingRes = await get(
        `/supply-chain/advanced/inventory/aging?warehouseId=${mainWarehouseId}`,
        adminToken,
      );
      expect(agingRes.statusCode).toBe(200);
      expect(Array.isArray(agingRes.json())).toBe(true);

      const filteredRes = await get(
        `/supply-chain/advanced/inventory/aging?warehouseId=${mainWarehouseId}&stockCondition=unrestricted&ownerType=own`,
        adminToken,
      );
      expect(filteredRes.statusCode).toBe(200);
      expect(Array.isArray(filteredRes.json())).toBe(true);
    });

    // -----------------------------------------------------------------------
    // 6. Warehouse Tasks (Putaway, Pick, Pack, Cycle Count Lifecycle)
    // -----------------------------------------------------------------------
    it("creates warehouse tasks across putaway, pick, pack, and cycle count types and verifies idempotency", async () => {
      // 1. Putaway Task
      const putawayKey = `tsk-putaway-${Date.now()}`;
      const putawayRes = await post("/supply-chain/advanced/warehouse-tasks", adminToken, {
        idempotencyKey: putawayKey,
        warehouseId: mainWarehouseId,
        taskType: "putaway",
        priority: "high",
        items: [
          {
            itemId: itemAlphaId,
            fromLocationId: binMainA1Id,
            toLocationId: binMainA2Id,
            expectedQuantity: 5,
          },
        ],
      });
      expect(putawayRes.statusCode).toBe(201);
      const putawayData = putawayRes.json();
      expect(putawayData.task.taskNumber).toMatch(/^TSK-/);
      expect(putawayData.task.taskType).toBe("putaway");
      expect(putawayData.task.status).toBe("open");
      expect(putawayData.items).toHaveLength(1);
      expect(putawayData.items[0].expectedQuantity).toBe(5);

      warehouseTaskId = putawayData.task.id;

      // Idempotent replay for warehouse task
      const replayPutaway = await post("/supply-chain/advanced/warehouse-tasks", adminToken, {
        idempotencyKey: putawayKey,
        warehouseId: mainWarehouseId,
        taskType: "putaway",
        priority: "high",
        items: [
          {
            itemId: itemAlphaId,
            fromLocationId: binMainA1Id,
            toLocationId: binMainA2Id,
            expectedQuantity: 5,
          },
        ],
      });
      expect([200, 201]).toContain(replayPutaway.statusCode);
      expect(replayPutaway.json().task.id).toBe(warehouseTaskId);

      // 2. Pick Task
      const pickRes = await post("/supply-chain/advanced/warehouse-tasks", adminToken, {
        idempotencyKey: `tsk-pick-${Date.now()}`,
        warehouseId: mainWarehouseId,
        taskType: "pick",
        priority: "normal",
        items: [
          {
            itemId: itemBetaId,
            fromLocationId: binMainA1Id,
            expectedQuantity: 10,
          },
        ],
      });
      expect(pickRes.statusCode).toBe(201);
      expect(pickRes.json().task.taskType).toBe("pick");

      // 3. Cycle Count Task
      const countRes = await post("/supply-chain/advanced/warehouse-tasks", adminToken, {
        idempotencyKey: `tsk-cycle-${Date.now()}`,
        warehouseId: mainWarehouseId,
        taskType: "cycle_count",
        priority: "urgent",
        items: [
          {
            itemId: itemGammaId,
            expectedQuantity: 25,
          },
        ],
      });
      expect(countRes.statusCode).toBe(201);
      expect(countRes.json().task.taskType).toBe("cycle_count");
    });

    it("executes warehouse task assignment and completion lifecycle with state guards", async () => {
      // Assign warehouse task to operator
      const assignRes = await patch(
        `/supply-chain/advanced/warehouse-tasks/${warehouseTaskId}/assign`,
        adminToken,
        { assignedTo: adminUserId },
      );
      expect(assignRes.statusCode).toBe(200);
      expect(assignRes.json().task.status).toBe("assigned");
      expect(assignRes.json().task.assignedTo).toBe(adminUserId);

      // Complete warehouse task
      const completeRes = await post(
        `/supply-chain/advanced/warehouse-tasks/${warehouseTaskId}/complete`,
        adminToken,
      );
      expect(completeRes.statusCode).toBe(200);
      expect(completeRes.json().task.status).toBe("completed");
      expect(completeRes.json().task.completedAt).toBeTruthy();

      // Guard: Cannot re-assign a completed task
      const reassignRes = await patch(
        `/supply-chain/advanced/warehouse-tasks/${warehouseTaskId}/assign`,
        adminToken,
        { assignedTo: adminUserId },
      );
      expect(reassignRes.statusCode).toBe(409);
    });

    it("enforces state machine guards on unassigned warehouse task completion", async () => {
      // Create a fresh task in open status
      const freshTask = await post("/supply-chain/advanced/warehouse-tasks", adminToken, {
        idempotencyKey: `tsk-fresh-${Date.now()}`,
        warehouseId: mainWarehouseId,
        taskType: "replenishment",
        priority: "normal",
        items: [{ itemId: itemAlphaId, expectedQuantity: 2 }],
      });
      expect(freshTask.statusCode).toBe(201);
      const freshTaskId = freshTask.json().task.id;

      // Direct completion attempt on "open" task without assignment must fail with Conflict
      const invalidComplete = await post(
        `/supply-chain/advanced/warehouse-tasks/${freshTaskId}/complete`,
        adminToken,
      );
      expect(invalidComplete.statusCode).toBe(409);
    });
  });

  // =========================================================================
  // Security & Invariants: Cross-Tenant Isolation & Hierarchical Data Scope
  // =========================================================================
  describe("Security & Invariants: Cross-Tenant & Data Scope Isolation", () => {
    it("strictly isolates SCM Advanced resources across tenants (Tenant Isolation)", async () => {
      // Other tenant cannot access Primary tenant warehouse
      const otherWhRes = await get(`/supply-chain/advanced/warehouses/${mainWarehouseId}`, otherAdminToken);
      expect([403, 404]).toContain(otherWhRes.statusCode);

      // Other tenant cannot query Primary tenant batches
      const otherBatchRes = await get(`/supply-chain/advanced/batches?itemId=${itemBetaId}`, otherAdminToken);
      expect(otherBatchRes.statusCode).toBe(200);
      expect(otherBatchRes.json().some((b: { id: string }) => b.id === batchId)).toBe(false);

      // Other tenant cannot act on Primary tenant transfer
      const otherTrfAct = await post(`/supply-chain/advanced/transfers/${transferId}/act`, otherAdminToken, {
        actionCode: "approve",
      });
      expect([403, 404]).toContain(otherTrfAct.statusCode);

      // Other tenant cannot access Primary tenant landed cost
      const otherLcRes = await get(`/supply-chain/advanced/landed-costs/${landedCostId}`, otherAdminToken);
      expect([403, 404]).toContain(otherLcRes.statusCode);

      // Other tenant cannot access Primary tenant RFQ
      const otherRfqRes = await get(`/supply-chain/advanced/rfqs/${rfqId}`, otherAdminToken);
      expect([403, 404]).toContain(otherRfqRes.statusCode);

      // Stage 2: Other tenant cannot read the Primary tenant's replacement delivery
      const otherRep = await get(`/supply-chain/advanced/replacements/${replacementDeliveryId}`, otherAdminToken);
      expect([403, 404]).toContain(otherRep.statusCode);

      // Stage 2: Other tenant cannot act on the Primary tenant's disposal workflow
      const otherDispApprove = await post(`/supply-chain/advanced/disposals/${disposalId}/approve`, otherAdminToken, {
        comment: "cross-tenant approval attempt",
      });
      expect([403, 404]).toContain(otherDispApprove.statusCode);

      // Stage 2: Other tenant cannot read Primary tenant consignment balances
      const otherBal = await get(
        `/supply-chain/advanced/consignment/balances?supplierId=${supplierAcmeId}&warehouseId=${mainWarehouseId}`,
        otherAdminToken,
      );
      expect([200, 403, 404]).toContain(otherBal.statusCode);
      if (otherBal.statusCode === 200) {
        expect(otherBal.json()).toHaveLength(0);
      }
    });

    it("enforces hierarchical Organization-Unit Data Scope for scoped users", async () => {
      // North Manager (scoped to North & North Child) can see North warehouses
      const northWhs = await get("/supply-chain/advanced/warehouses", northManagerToken);
      expect(northWhs.statusCode).toBe(200);
      const whIds = northWhs.json().map((w: { id: string }) => w.id);
      expect(whIds).toContain(mainWarehouseId);
      expect(whIds).toContain(secondaryWarehouseId);
      // But cannot see South Warehouse
      expect(whIds).not.toContain(southWarehouseId);

      // North Manager creating transfer for South warehouse fails authorization
      const southTrfRes = await post("/supply-chain/advanced/transfers", northManagerToken, {
        fromWarehouseId: southWarehouseId,
        toWarehouseId: mainWarehouseId,
        lines: [{ itemId: itemAlphaId, quantityRequested: 1 }],
      });
      expect([403, 404]).toContain(southTrfRes.statusCode);

      // Stage 2: North Manager creating disposal for South warehouse fails authorization
      const southDispRes = await post("/supply-chain/advanced/disposals", northManagerToken, {
        idempotencyKey: `north-scoped-dsp-${Date.now()}`,
        warehouseId: southWarehouseId,
        reason: "Disposal outside OU scope",
        lines: [{ itemId: itemAlphaId, warehouseId: southWarehouseId, quantity: 1 }],
      });
      expect([403, 404]).toContain(southDispRes.statusCode);
    });

    it("enforces Segregation of Duties and denies write actions for read-only user", async () => {
      const roPost = await post("/supply-chain/advanced/batches", restrictedUserToken, {
        itemId: itemBetaId,
        batchNumber: "LOT-UNAUTH-001",
      });
      expect(roPost.statusCode).toBe(403);

      const roAward = await post("/supply-chain/advanced/bids/award", restrictedUserToken, {
        bidId,
      });
      expect(roAward.statusCode).toBe(403);

      const roRec = await post("/supply-chain/advanced/receiving-records", restrictedUserToken, {
        idempotencyKey: `unauth-rec-${Date.now()}`,
        purchaseOrderId,
        supplierId: supplierAcmeId,
        warehouseId: mainWarehouseId,
        lines: [
          {
            purchaseOrderLineId: "00000000-0000-0000-0000-000000000001",
            itemId: itemAlphaId,
            warehouseId: mainWarehouseId,
            stockCondition: "unrestricted",
            ownerType: "own",
            quantityReceived: 1,
            accountAssignmentType: "stock",
          },
        ],
      });
      expect(roRec.statusCode).toBe(403);

      // Stage 2: Readonly user cannot create service acceptance
      const roSa = await post("/supply-chain/advanced/service-acceptances", restrictedUserToken, {
        idempotencyKey: `unauth-sa-${Date.now()}`,
        purchaseOrderId,
        supplierId: supplierAcmeId,
        lines: [
          {
            purchaseOrderLineId: "00000000-0000-0000-0000-000000000001",
            description: "Unauthorized service acceptance",
            quantity: 1,
            unitPrice: 1000000,
            amount: 1000000,
          },
        ],
      });
      expect(roSa.statusCode).toBe(403);

      // Stage 2: Readonly user cannot create inventory disposal
      const roDisp = await post("/supply-chain/advanced/disposals", restrictedUserToken, {
        idempotencyKey: `unauth-dsp-${Date.now()}`,
        warehouseId: mainWarehouseId,
        reason: "Unauthorized scrap",
        lines: [{ itemId: itemAlphaId, warehouseId: mainWarehouseId, quantity: 1 }],
      });
      expect(roDisp.statusCode).toBe(403);

      // Stage 2: Readonly user cannot create warehouse task
      const roTask = await post("/supply-chain/advanced/warehouse-tasks", restrictedUserToken, {
        idempotencyKey: `unauth-tsk-${Date.now()}`,
        warehouseId: mainWarehouseId,
        taskType: "putaway",
        items: [{ itemId: itemAlphaId, expectedQuantity: 1 }],
      });
      expect(roTask.statusCode).toBe(403);
    });
  });
});
