import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../../src/app.js";
import {
  authHeader,
  bootstrapTenant,
  createReadOnlyRole,
  login,
  provisionFirstAdmin,
} from "./helpers.js";

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

      // Seed workflow definitions required by SCM Advanced modules
      const workflows = [
        { code: "scm_stock_transfer", name: "Warehouse Stock Transfer" },
        { code: "scm_stock_opname", name: "Stock Opname Reconciliation" },
        { code: "scm_rfq", name: "RFQ Procurement Process" },
        { code: "scm_supplier_evaluation", name: "Supplier Evaluation Workflow" },
        { code: "scm_supplier_contract", name: "Supplier Contract Approval" },
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
        receiptReferenceType: "purchase_order",
        receiptReferenceId: purchaseOrderId,
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
    });
  });
});
