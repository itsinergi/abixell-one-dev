import type { Pool, PoolClient, QueryResultRow } from "pg";
import { ConflictError } from "../../../../domain/shared-kernel/errors.js";
import type {
  ApplyScmLandedCostInput,
  AwardScmSupplierBidInput,
  ConsumeScmValuationLayerInput,
  CreateScmItemBatchInput,
  CreateScmItemSerialInput,
  CreateScmLandedCostInput,
  CreateScmRfqInput,
  CreateScmSpendAnalyticsSnapshotInput,
  CreateScmStockOpnameInput,
  CreateScmStockReservationInput,
  CreateScmStockTransferInput,
  CreateScmSupplierBidInput,
  CreateScmSupplierContractInput,
  CreateScmSupplierEvaluationInput,
  CreateScmWarehouseInput,
  CreateScmWarehouseLocationInput,
  CreateScmValuationLayerInput,
  RecordScmAdvancedStockMovementInput,
  RecordScmStockOpnameCountInput,
  RecordScmStockTransferReceiptInput,
  RecordScmStockTransferShipmentInput,
  RecordScmSupplierContractSpendInput,
  ScmAdvancedStockBalance,
  ScmAdvancedStockBalanceFilter,
  ScmAdvancedStockMovement,
  ScmAdvancedStockMovementFilter,
  ScmItemBatch,
  ScmItemBatchListFilter,
  ScmItemSerial,
  ScmItemSerialListFilter,
  ScmLandedCost,
  ScmLandedCostAllocation,
  ScmLandedCostFilter,
  ScmReorderPolicy,
  ScmReorderPolicyFilter,
  ScmReservationStatus,
  ScmRfq,
  ScmRfqFilter,
  ScmRfqInvitedSupplier,
  ScmRfqItem,
  ScmSpendAnalyticsPeriodType,
  ScmSpendAnalyticsSnapshot,
  ScmSpendAnalyticsSnapshotFilter,
  ScmStockOpname,
  ScmStockOpnameFilter,
  ScmStockOpnameLine,
  ScmStockReservation,
  ScmStockReservationFilter,
  ScmStockTransfer,
  ScmStockTransferFilter,
  ScmStockTransferLine,
  ScmSupplierBid,
  ScmSupplierBidFilter,
  ScmSupplierBidLine,
  ScmSupplierContract,
  ScmSupplierContractFilter,
  ScmSupplierContractItem,
  ScmSupplierEvaluation,
  ScmSupplierEvaluationFilter,
  ScmValuationLayer,
  ScmValuationLayerFilter,
  ScmWarehouse,
  ScmWarehouseListFilter,
  ScmWarehouseLocation,
  ScmWarehouseLocationListFilter,
  SupplyChainAdvancedRepository,
  UpdateScmItemSerialInput,
  UpdateScmRfqProjectionInput,
  UpdateScmStockOpnameProjectionInput,
  UpdateScmStockTransferProjectionInput,
  UpdateScmSupplierBidScoreInput,
  UpdateScmSupplierContractProjectionInput,
  UpdateScmSupplierEvaluationProjectionInput,
  UpdateScmWarehouseInput,
  UpdateScmWarehouseLocationInput,
  UpsertScmReorderPolicyInput,
} from "../domain/supply-chain-advanced.entity.js";

export class PgSupplyChainAdvancedRepository implements SupplyChainAdvancedRepository {
  constructor(private readonly pool: Pool) {}

  private async inTransaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const result = await fn(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  // =========================================================================
  // 1. Warehouses & Storage Locations
  // =========================================================================

  async listOrganizationUnitDescendantIds(tenantId: string, rootIds: string[]): Promise<string[]> {
    if (rootIds.length === 0) return [];
    const r = await this.pool.query(
      `WITH RECURSIVE descendants AS (
         SELECT id
           FROM organization_units
          WHERE tenant_id = $1
            AND id = ANY($2::uuid[])
            AND deleted_at IS NULL
         UNION
         SELECT ou.id
           FROM organization_units ou
           JOIN descendants d ON ou.parent_id = d.id
          WHERE ou.tenant_id = $1
            AND ou.deleted_at IS NULL
       )
       SELECT id FROM descendants`,
      [tenantId, rootIds],
    );
    return r.rows.map((row) => row.id as string);
  }

  async createWarehouse(tenantId: string, input: CreateScmWarehouseInput): Promise<ScmWarehouse> {
    const r = await this.pool.query(
      `INSERT INTO scm_warehouses (
         tenant_id, code, name, site_id, organization_unit_id, address, is_active, created_by, updated_by
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $8)
       RETURNING *`,
      [
        tenantId,
        input.code,
        input.name,
        input.siteId ?? null,
        input.organizationUnitId ?? null,
        input.address ?? null,
        input.isActive ?? true,
        input.createdBy ?? null,
      ],
    );
    return toWarehouse(r.rows[0]!);
  }

  async updateWarehouse(
    tenantId: string,
    warehouseId: string,
    input: UpdateScmWarehouseInput,
  ): Promise<ScmWarehouse | null> {
    const r = await this.pool.query(
      `UPDATE scm_warehouses
          SET name = COALESCE($3, name),
              site_id = CASE WHEN $4::boolean THEN $5 ELSE site_id END,
              organization_unit_id = CASE WHEN $6::boolean THEN $7 ELSE organization_unit_id END,
              address = CASE WHEN $8::boolean THEN $9 ELSE address END,
              is_active = COALESCE($10, is_active),
              updated_by = $11,
              updated_at = now()
        WHERE tenant_id = $1 AND id = $2
        RETURNING *`,
      [
        tenantId,
        warehouseId,
        input.name ?? null,
        input.siteId !== undefined,
        input.siteId ?? null,
        input.organizationUnitId !== undefined,
        input.organizationUnitId ?? null,
        input.address !== undefined,
        input.address ?? null,
        input.isActive ?? null,
        input.updatedBy ?? null,
      ],
    );
    return r.rows[0] ? toWarehouse(r.rows[0]) : null;
  }

  async findWarehouseById(tenantId: string, warehouseId: string): Promise<ScmWarehouse | null> {
    const r = await this.pool.query(
      `SELECT * FROM scm_warehouses WHERE tenant_id = $1 AND id = $2`,
      [tenantId, warehouseId],
    );
    return r.rows[0] ? toWarehouse(r.rows[0]) : null;
  }

  async findWarehouseByCode(tenantId: string, code: string): Promise<ScmWarehouse | null> {
    const r = await this.pool.query(
      `SELECT * FROM scm_warehouses WHERE tenant_id = $1 AND code = $2`,
      [tenantId, code],
    );
    return r.rows[0] ? toWarehouse(r.rows[0]) : null;
  }

  async listWarehouses(tenantId: string, filter: ScmWarehouseListFilter = {}): Promise<ScmWarehouse[]> {
    const conditions = [`tenant_id = $1`];
    const params: unknown[] = [tenantId];

    if (filter.organizationUnitIds !== undefined) {
      if (filter.organizationUnitIds === null) {
        // tenant wide, no filter
      } else if (filter.organizationUnitIds.length === 0) {
        conditions.push(`organization_unit_id IS NULL`);
      } else {
        params.push(filter.organizationUnitIds);
        conditions.push(`(organization_unit_id IS NULL OR organization_unit_id = ANY($${params.length}))`);
      }
    }
    if (filter.siteId) {
      params.push(filter.siteId);
      conditions.push(`site_id = $${params.length}`);
    }
    if (filter.activeOnly) {
      conditions.push(`is_active = true`);
    }

    const r = await this.pool.query(
      `SELECT * FROM scm_warehouses WHERE ${conditions.join(" AND ")} ORDER BY code`,
      params,
    );
    return r.rows.map(toWarehouse);
  }

  async createWarehouseLocation(
    tenantId: string,
    input: CreateScmWarehouseLocationInput,
  ): Promise<ScmWarehouseLocation> {
    const r = await this.pool.query(
      `INSERT INTO scm_warehouse_locations (
         tenant_id, warehouse_id, code, zone, aisle, rack, shelf, bin, is_active, created_by, updated_by
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $10)
       RETURNING *`,
      [
        tenantId,
        input.warehouseId,
        input.code,
        input.zone ?? null,
        input.aisle ?? null,
        input.rack ?? null,
        input.shelf ?? null,
        input.bin ?? null,
        input.isActive ?? true,
        input.createdBy ?? null,
      ],
    );
    return toWarehouseLocation(r.rows[0]!);
  }

  async updateWarehouseLocation(
    tenantId: string,
    locationId: string,
    input: UpdateScmWarehouseLocationInput,
  ): Promise<ScmWarehouseLocation | null> {
    const r = await this.pool.query(
      `UPDATE scm_warehouse_locations
          SET zone = CASE WHEN $3::boolean THEN $4 ELSE zone END,
              aisle = CASE WHEN $5::boolean THEN $6 ELSE aisle END,
              rack = CASE WHEN $7::boolean THEN $8 ELSE rack END,
              shelf = CASE WHEN $9::boolean THEN $10 ELSE shelf END,
              bin = CASE WHEN $11::boolean THEN $12 ELSE bin END,
              is_active = COALESCE($13, is_active),
              updated_by = $14,
              updated_at = now()
        WHERE tenant_id = $1 AND id = $2
        RETURNING *`,
      [
        tenantId,
        locationId,
        input.zone !== undefined,
        input.zone ?? null,
        input.aisle !== undefined,
        input.aisle ?? null,
        input.rack !== undefined,
        input.rack ?? null,
        input.shelf !== undefined,
        input.shelf ?? null,
        input.bin !== undefined,
        input.bin ?? null,
        input.isActive ?? null,
        input.updatedBy ?? null,
      ],
    );
    return r.rows[0] ? toWarehouseLocation(r.rows[0]) : null;
  }

  async findWarehouseLocationById(tenantId: string, locationId: string): Promise<ScmWarehouseLocation | null> {
    const r = await this.pool.query(
      `SELECT * FROM scm_warehouse_locations WHERE tenant_id = $1 AND id = $2`,
      [tenantId, locationId],
    );
    return r.rows[0] ? toWarehouseLocation(r.rows[0]) : null;
  }

  async listWarehouseLocations(
    tenantId: string,
    filter: ScmWarehouseLocationListFilter = {},
  ): Promise<ScmWarehouseLocation[]> {
    const conditions = [`tenant_id = $1`];
    const params: unknown[] = [tenantId];

    if (filter.warehouseId) {
      params.push(filter.warehouseId);
      conditions.push(`warehouse_id = $${params.length}`);
    }
    if (filter.activeOnly) {
      conditions.push(`is_active = true`);
    }

    const r = await this.pool.query(
      `SELECT * FROM scm_warehouse_locations WHERE ${conditions.join(" AND ")} ORDER BY code`,
      params,
    );
    return r.rows.map(toWarehouseLocation);
  }

  // =========================================================================
  // Batches & Serials
  // =========================================================================

  async createItemBatch(tenantId: string, input: CreateScmItemBatchInput): Promise<ScmItemBatch> {
    const r = await this.pool.query(
      `INSERT INTO scm_item_batches (
         tenant_id, item_id, batch_number, manufactured_date, expiry_date, supplier_id, notes, is_active, created_by, updated_by
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $9)
       RETURNING *`,
      [
        tenantId,
        input.itemId,
        input.batchNumber,
        input.manufacturedDate ?? null,
        input.expiryDate ?? null,
        input.supplierId ?? null,
        input.notes ?? null,
        input.isActive ?? true,
        input.createdBy ?? null,
      ],
    );
    return toItemBatch(r.rows[0]!);
  }

  async findItemBatchById(tenantId: string, batchId: string): Promise<ScmItemBatch | null> {
    const r = await this.pool.query(
      `SELECT * FROM scm_item_batches WHERE tenant_id = $1 AND id = $2`,
      [tenantId, batchId],
    );
    return r.rows[0] ? toItemBatch(r.rows[0]) : null;
  }

  async listItemBatches(tenantId: string, filter: ScmItemBatchListFilter = {}): Promise<ScmItemBatch[]> {
    const conditions = [`tenant_id = $1`];
    const params: unknown[] = [tenantId];

    if (filter.itemId) {
      params.push(filter.itemId);
      conditions.push(`item_id = $${params.length}`);
    }
    if (!filter.includeExpired) {
      conditions.push(`(expiry_date IS NULL OR expiry_date >= CURRENT_DATE)`);
    }

    const r = await this.pool.query(
      `SELECT * FROM scm_item_batches WHERE ${conditions.join(" AND ")} ORDER BY created_at DESC`,
      params,
    );
    return r.rows.map(toItemBatch);
  }

  async createItemSerial(tenantId: string, input: CreateScmItemSerialInput): Promise<ScmItemSerial> {
    try {
      const r = await this.pool.query(
        `INSERT INTO scm_item_serials (
           tenant_id, item_id, serial_number, batch_id, warehouse_id, location_id, status, warranty_expiry_date, notes, created_by, updated_by
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $10)
         RETURNING *`,
        [
          tenantId,
          input.itemId,
          input.serialNumber,
          input.batchId ?? null,
          input.warehouseId ?? null,
          input.locationId ?? null,
          input.status ?? "in_stock",
          input.warrantyExpiryDate ?? null,
          input.notes ?? null,
          input.createdBy ?? null,
        ],
      );
      return toItemSerial(r.rows[0]!);
    } catch (error: any) {
      if (error?.code === "23505") {
        throw new ConflictError(`Serial number ${input.serialNumber} already exists for this item`);
      }
      throw error;
    }
  }

  async updateItemSerial(
    tenantId: string,
    serialId: string,
    input: UpdateScmItemSerialInput,
  ): Promise<ScmItemSerial | null> {
    const r = await this.pool.query(
      `UPDATE scm_item_serials
          SET batch_id = CASE WHEN $3::boolean THEN $4 ELSE batch_id END,
              warehouse_id = CASE WHEN $5::boolean THEN $6 ELSE warehouse_id END,
              location_id = CASE WHEN $7::boolean THEN $8 ELSE location_id END,
              status = COALESCE($9, status),
              warranty_expiry_date = CASE WHEN $10::boolean THEN $11 ELSE warranty_expiry_date END,
              notes = CASE WHEN $12::boolean THEN $13 ELSE notes END,
              updated_by = $14,
              updated_at = now()
        WHERE tenant_id = $1 AND id = $2
        RETURNING *`,
      [
        tenantId,
        serialId,
        input.batchId !== undefined,
        input.batchId ?? null,
        input.warehouseId !== undefined,
        input.warehouseId ?? null,
        input.locationId !== undefined,
        input.locationId ?? null,
        input.status ?? null,
        input.warrantyExpiryDate !== undefined,
        input.warrantyExpiryDate ?? null,
        input.notes !== undefined,
        input.notes ?? null,
        input.updatedBy ?? null,
      ],
    );
    return r.rows[0] ? toItemSerial(r.rows[0]) : null;
  }

  async findItemSerialById(tenantId: string, serialId: string): Promise<ScmItemSerial | null> {
    const r = await this.pool.query(
      `SELECT * FROM scm_item_serials WHERE tenant_id = $1 AND id = $2`,
      [tenantId, serialId],
    );
    return r.rows[0] ? toItemSerial(r.rows[0]) : null;
  }

  async listItemSerials(tenantId: string, filter: ScmItemSerialListFilter = {}): Promise<ScmItemSerial[]> {
    const conditions = [`tenant_id = $1`];
    const params: unknown[] = [tenantId];

    if (filter.itemId) {
      params.push(filter.itemId);
      conditions.push(`item_id = $${params.length}`);
    }
    if (filter.warehouseId) {
      params.push(filter.warehouseId);
      conditions.push(`warehouse_id = $${params.length}`);
    }
    if (filter.warehouseIds !== undefined) {
      if (filter.warehouseIds === null) {
        // tenant wide
      } else if (filter.warehouseIds.length === 0) {
        conditions.push("1 = 0");
      } else {
        params.push(filter.warehouseIds);
        conditions.push(`warehouse_id = ANY($${params.length})`);
      }
    }
    if (filter.locationId !== undefined) {
      params.push(filter.locationId);
      conditions.push(`location_id = $${params.length}`);
    }
    if (filter.batchId !== undefined) {
      params.push(filter.batchId);
      conditions.push(`batch_id = $${params.length}`);
    }
    if (filter.status) {
      params.push(filter.status);
      conditions.push(`status = $${params.length}`);
    }

    const r = await this.pool.query(
      `SELECT * FROM scm_item_serials WHERE ${conditions.join(" AND ")} ORDER BY serial_number`,
      params,
    );
    return r.rows.map(toItemSerial);
  }

  // =========================================================================
  // Advanced Stock Balances & Immutable Ledger
  // =========================================================================

  async findAdvancedStockBalance(
    tenantId: string,
    itemId: string,
    warehouseId: string,
    locationId: string | null = null,
    batchId: string | null = null,
  ): Promise<ScmAdvancedStockBalance | null> {
    const r = await this.pool.query(
      `SELECT * FROM scm_advanced_stock_balances
        WHERE tenant_id = $1
          AND item_id = $2
          AND warehouse_id = $3
          AND (location_id IS NOT DISTINCT FROM $4)
          AND (batch_id IS NOT DISTINCT FROM $5)`,
      [tenantId, itemId, warehouseId, locationId, batchId],
    );
    return r.rows[0] ? toStockBalance(r.rows[0]) : null;
  }

  async listAdvancedStockBalances(
    tenantId: string,
    filter: ScmAdvancedStockBalanceFilter = {},
  ): Promise<ScmAdvancedStockBalance[]> {
    const conditions = [`tenant_id = $1`];
    const params: unknown[] = [tenantId];

    if (filter.itemId) {
      params.push(filter.itemId);
      conditions.push(`item_id = $${params.length}`);
    }
    if (filter.warehouseId) {
      params.push(filter.warehouseId);
      conditions.push(`warehouse_id = $${params.length}`);
    }
    if (filter.warehouseIds && filter.warehouseIds.length > 0) {
      params.push(filter.warehouseIds);
      conditions.push(`warehouse_id = ANY($${params.length})`);
    }
    if (filter.locationId !== undefined) {
      params.push(filter.locationId);
      conditions.push(`location_id = $${params.length}`);
    }
    if (filter.batchId !== undefined) {
      params.push(filter.batchId);
      conditions.push(`batch_id = $${params.length}`);
    }

    const r = await this.pool.query(
      `SELECT * FROM scm_advanced_stock_balances WHERE ${conditions.join(" AND ")} ORDER BY item_id, warehouse_id`,
      params,
    );
    return r.rows.map(toStockBalance);
  }

  async recordAdvancedStockMovement(
    tenantId: string,
    input: RecordScmAdvancedStockMovementInput,
  ): Promise<{ movement: ScmAdvancedStockMovement; balance: ScmAdvancedStockBalance }> {
    return this.inTransaction(async (client) => {
      // 1. Insert immutable movement row
      const movRes = await client.query(
        `INSERT INTO scm_advanced_stock_movements (
           tenant_id, item_id, warehouse_id, location_id, batch_id, serial_id,
           movement_type, quantity, unit_cost, total_cost, reference_type,
           reference_id, reference_number, notes, occurred_at, created_by
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, COALESCE($15, now()), $16)
         RETURNING *`,
        [
          tenantId,
          input.itemId,
          input.warehouseId,
          input.locationId ?? null,
          input.batchId ?? null,
          input.serialId ?? null,
          input.movementType,
          input.quantity,
          input.unitCost ?? null,
          input.totalCost ?? null,
          input.referenceType ?? null,
          input.referenceId ?? null,
          input.referenceNumber ?? null,
          input.notes ?? null,
          input.occurredAt ?? null,
          input.createdBy ?? null,
        ],
      );
      const movement = toStockMovement(movRes.rows[0]!);

      // Calculate quantity delta: in/transfer_in/adjustment_in/opname_in are positive; others negative
      const isPositive =
        input.movementType === "in" ||
        input.movementType === "transfer_in" ||
        input.movementType === "adjustment_in" ||
        input.movementType === "opname_in";
      const delta = isPositive ? input.quantity : -input.quantity;

      // 2. Fetch balance with FOR UPDATE
      const balRes = await client.query(
        `SELECT * FROM scm_advanced_stock_balances
          WHERE tenant_id = $1
            AND item_id = $2
            AND warehouse_id = $3
            AND (location_id IS NOT DISTINCT FROM $4)
            AND (batch_id IS NOT DISTINCT FROM $5)
          FOR UPDATE`,
        [tenantId, input.itemId, input.warehouseId, input.locationId ?? null, input.batchId ?? null],
      );

      let balance: ScmAdvancedStockBalance;

      if (balRes.rows.length > 0) {
        const existing = balRes.rows[0]!;
        const currentQty = num(existing.quantity);
        const currentReserved = num(existing.reserved_qty);
        const newQty = currentQty + delta;

        if (newQty < 0) {
          throw new ConflictError(
            `Insufficient stock: current balance is ${currentQty}, requested reduction is ${input.quantity}`,
          );
        }
        if (newQty < currentReserved) {
          throw new ConflictError(
            `Stock reduction exceeds unreserved balance: remaining ${newQty} would drop below reserved ${currentReserved}`,
          );
        }

        const upRes = await client.query(
          `UPDATE scm_advanced_stock_balances
              SET quantity = $1, updated_at = now()
            WHERE id = $2
            RETURNING *`,
          [newQty, existing.id],
        );
        balance = toStockBalance(upRes.rows[0]!);
      } else {
        if (delta < 0) {
          throw new ConflictError(
            `Insufficient stock: no balance exists in warehouse for item ${input.itemId}`,
          );
        }
        const insRes = await client.query(
          `INSERT INTO scm_advanced_stock_balances (
             tenant_id, item_id, warehouse_id, location_id, batch_id, quantity, reserved_qty, updated_at
           ) VALUES ($1, $2, $3, $4, $5, $6, 0, now())
           RETURNING *`,
          [tenantId, input.itemId, input.warehouseId, input.locationId ?? null, input.batchId ?? null, input.quantity],
        );
        balance = toStockBalance(insRes.rows[0]!);
      }

      // 3. If serialId provided, update serial status
      if (input.serialId) {
        let newStatus = "in_stock";
        if (input.movementType === "out" || input.movementType === "adjustment_out") {
          newStatus = "issued";
        } else if (input.movementType === "transfer_out") {
          newStatus = "in_transit";
        } else if (input.movementType === "transfer_in" || input.movementType === "in") {
          newStatus = "in_stock";
        }
        await client.query(
          `UPDATE scm_item_serials
              SET status = $1,
                  warehouse_id = $2,
                  location_id = $3,
                  batch_id = COALESCE($4, batch_id),
                  updated_at = now()
            WHERE tenant_id = $5 AND id = $6`,
          [newStatus, input.warehouseId, input.locationId ?? null, input.batchId ?? null, tenantId, input.serialId],
        );
      }

      return { movement, balance };
    });
  }

  async listAdvancedStockMovements(
    tenantId: string,
    filter: ScmAdvancedStockMovementFilter = {},
  ): Promise<ScmAdvancedStockMovement[]> {
    const conditions = [`tenant_id = $1`];
    const params: unknown[] = [tenantId];

    if (filter.itemId) {
      params.push(filter.itemId);
      conditions.push(`item_id = $${params.length}`);
    }
    if (filter.warehouseId) {
      params.push(filter.warehouseId);
      conditions.push(`warehouse_id = $${params.length}`);
    }
    if (filter.warehouseIds && filter.warehouseIds.length > 0) {
      params.push(filter.warehouseIds);
      conditions.push(`warehouse_id = ANY($${params.length})`);
    }
    if (filter.movementType) {
      params.push(filter.movementType);
      conditions.push(`movement_type = $${params.length}`);
    }
    if (filter.occurredFrom) {
      params.push(filter.occurredFrom);
      conditions.push(`occurred_at >= $${params.length}`);
    }
    if (filter.occurredTo) {
      params.push(filter.occurredTo);
      conditions.push(`occurred_at <= $${params.length}`);
    }

    const limit = filter.limit && filter.limit > 0 ? filter.limit : 100;
    params.push(limit);

    const r = await this.pool.query(
      `SELECT * FROM scm_advanced_stock_movements
        WHERE ${conditions.join(" AND ")}
        ORDER BY occurred_at DESC
        LIMIT $${params.length}`,
      params,
    );
    return r.rows.map(toStockMovement);
  }

  // =========================================================================
  // 2. Reorder Policies
  // =========================================================================

  async upsertReorderPolicy(tenantId: string, input: UpsertScmReorderPolicyInput): Promise<ScmReorderPolicy> {
    const r = await this.pool.query(
      `INSERT INTO scm_reorder_policies (
         tenant_id, item_id, warehouse_id, min_quantity, reorder_point,
         reorder_quantity, safety_stock, lead_time_days, is_active, created_by, updated_by
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $10)
       ON CONFLICT (tenant_id, item_id, warehouse_id) WHERE warehouse_id IS NOT NULL
       DO UPDATE SET
         min_quantity = EXCLUDED.min_quantity,
         reorder_point = EXCLUDED.reorder_point,
         reorder_quantity = EXCLUDED.reorder_quantity,
         safety_stock = EXCLUDED.safety_stock,
         lead_time_days = EXCLUDED.lead_time_days,
         is_active = EXCLUDED.is_active,
         updated_by = EXCLUDED.updated_by,
         updated_at = now()
       RETURNING *`,
      [
        tenantId,
        input.itemId,
        input.warehouseId ?? null,
        input.minQuantity,
        input.reorderPoint,
        input.reorderQuantity,
        input.safetyStock ?? 0,
        input.leadTimeDays ?? 0,
        input.isActive ?? true,
        input.createdBy ?? input.updatedBy ?? null,
      ],
    );
    return toReorderPolicy(r.rows[0]!);
  }

  async listReorderPolicies(tenantId: string, filter: ScmReorderPolicyFilter = {}): Promise<ScmReorderPolicy[]> {
    const conditions = [`tenant_id = $1`];
    const params: unknown[] = [tenantId];

    if (filter.itemId) {
      params.push(filter.itemId);
      conditions.push(`item_id = $${params.length}`);
    }
    if (filter.warehouseId !== undefined) {
      if (filter.warehouseId === null) {
        conditions.push(`warehouse_id IS NULL`);
      } else {
        params.push(filter.warehouseId);
        conditions.push(`warehouse_id = $${params.length}`);
      }
    }
    if (filter.activeOnly) {
      conditions.push(`is_active = true`);
    }

    const r = await this.pool.query(
      `SELECT * FROM scm_reorder_policies WHERE ${conditions.join(" AND ")} ORDER BY item_id`,
      params,
    );
    return r.rows.map(toReorderPolicy);
  }

  // =========================================================================
  // Stock Reservations
  // =========================================================================

  async createStockReservation(
    tenantId: string,
    input: CreateScmStockReservationInput,
  ): Promise<ScmStockReservation> {
    return this.inTransaction(async (client) => {
      // 1. Lock and increment reserved_qty on balance
      const balRes = await client.query(
        `SELECT * FROM scm_advanced_stock_balances
          WHERE tenant_id = $1
            AND item_id = $2
            AND warehouse_id = $3
            AND (location_id IS NOT DISTINCT FROM $4)
            AND (batch_id IS NOT DISTINCT FROM $5)
          FOR UPDATE`,
        [tenantId, input.itemId, input.warehouseId, input.locationId ?? null, input.batchId ?? null],
      );

      if (balRes.rows.length === 0) {
        throw new ConflictError("Cannot reserve stock: no balance exists for this item in warehouse");
      }

      const bal = balRes.rows[0]!;
      const available = num(bal.quantity) - num(bal.reserved_qty);
      if (available < input.quantity) {
        throw new ConflictError(
          `Insufficient available stock for reservation: requested ${input.quantity}, available ${available}`,
        );
      }

      await client.query(
        `UPDATE scm_advanced_stock_balances
            SET reserved_qty = reserved_qty + $1, updated_at = now()
          WHERE id = $2`,
        [input.quantity, bal.id],
      );

      // 2. Insert reservation record
      const resRes = await client.query(
        `INSERT INTO scm_stock_reservations (
           tenant_id, reservation_number, item_id, warehouse_id, location_id, batch_id,
           quantity, reserved_for_type, reserved_for_id, reserved_for_number,
           status, valid_until, notes, created_by, updated_by
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'active', $11, $12, $13, $13)
         RETURNING *`,
        [
          tenantId,
          input.reservationNumber,
          input.itemId,
          input.warehouseId,
          input.locationId ?? null,
          input.batchId ?? null,
          input.quantity,
          input.reservedForType,
          input.reservedForId ?? null,
          input.reservedForNumber ?? null,
          input.validUntil ?? null,
          input.notes ?? null,
          input.createdBy ?? null,
        ],
      );

      return toStockReservation(resRes.rows[0]!);
    });
  }

  async updateStockReservationStatus(
    tenantId: string,
    reservationId: string,
    status: ScmReservationStatus,
    timestamp: Date,
  ): Promise<ScmStockReservation | null> {
    return this.inTransaction(async (client) => {
      const resRes = await client.query(
        `SELECT * FROM scm_stock_reservations WHERE tenant_id = $1 AND id = $2 FOR UPDATE`,
        [tenantId, reservationId],
      );
      if (resRes.rows.length === 0) return null;
      const reservation = toStockReservation(resRes.rows[0]!);

      if (reservation.status === "active" && (status === "cancelled" || status === "expired" || status === "fulfilled")) {
        // Release reserved_qty on balance
        await client.query(
          `UPDATE scm_advanced_stock_balances
              SET reserved_qty = GREATEST(0, reserved_qty - $1), updated_at = now()
            WHERE tenant_id = $2
              AND item_id = $3
              AND warehouse_id = $4
              AND (location_id IS NOT DISTINCT FROM $5)
              AND (batch_id IS NOT DISTINCT FROM $6)`,
          [
            reservation.quantity,
            tenantId,
            reservation.itemId,
            reservation.warehouseId,
            reservation.locationId,
            reservation.batchId,
          ],
        );
      }

      const fulfilledAt = status === "fulfilled" ? timestamp : reservation.fulfilledAt;
      const cancelledAt = (status === "cancelled" || status === "expired") ? timestamp : reservation.cancelledAt;

      const upRes = await client.query(
        `UPDATE scm_stock_reservations
            SET status = $1,
                fulfilled_at = $2,
                cancelled_at = $3,
                updated_at = now()
          WHERE tenant_id = $4 AND id = $5
          RETURNING *`,
        [status, fulfilledAt, cancelledAt, tenantId, reservationId],
      );
      return toStockReservation(upRes.rows[0]!);
    });
  }

  async findStockReservationById(tenantId: string, reservationId: string): Promise<ScmStockReservation | null> {
    const r = await this.pool.query(
      `SELECT * FROM scm_stock_reservations WHERE tenant_id = $1 AND id = $2`,
      [tenantId, reservationId],
    );
    return r.rows[0] ? toStockReservation(r.rows[0]) : null;
  }

  async listStockReservations(
    tenantId: string,
    filter: ScmStockReservationFilter = {},
  ): Promise<ScmStockReservation[]> {
    const conditions = [`tenant_id = $1`];
    const params: unknown[] = [tenantId];

    if (filter.itemId) {
      params.push(filter.itemId);
      conditions.push(`item_id = $${params.length}`);
    }
    if (filter.warehouseId) {
      params.push(filter.warehouseId);
      conditions.push(`warehouse_id = $${params.length}`);
    }
    if (filter.warehouseIds && filter.warehouseIds.length > 0) {
      params.push(filter.warehouseIds);
      conditions.push(`warehouse_id = ANY($${params.length})`);
    }
    if (filter.status) {
      params.push(filter.status);
      conditions.push(`status = $${params.length}`);
    }
    if (filter.reservedForType) {
      params.push(filter.reservedForType);
      conditions.push(`reserved_for_type = $${params.length}`);
    }
    if (filter.reservedForId) {
      params.push(filter.reservedForId);
      conditions.push(`reserved_for_id = $${params.length}`);
    }

    const r = await this.pool.query(
      `SELECT * FROM scm_stock_reservations WHERE ${conditions.join(" AND ")} ORDER BY created_at DESC`,
      params,
    );
    return r.rows.map(toStockReservation);
  }

  // =========================================================================
  // Stock Transfers
  // =========================================================================

  async createStockTransfer(
    tenantId: string,
    input: CreateScmStockTransferInput,
  ): Promise<{ transfer: ScmStockTransfer; lines: ScmStockTransferLine[] }> {
    return this.inTransaction(async (client) => {
      const trRes = await client.query(
        `INSERT INTO scm_stock_transfers (
           tenant_id, transfer_number, from_warehouse_id, to_warehouse_id,
           status, notes, created_by, updated_by
         ) VALUES ($1, $2, $3, $4, 'draft', $5, $6, $6)
         RETURNING *`,
        [
          tenantId,
          input.transferNumber,
          input.fromWarehouseId,
          input.toWarehouseId,
          input.notes ?? null,
          input.createdBy ?? null,
        ],
      );
      const transfer = toStockTransfer(trRes.rows[0]!);

      const lines: ScmStockTransferLine[] = [];
      let sort = 0;
      for (const line of input.lines) {
        const lRes = await client.query(
          `INSERT INTO scm_stock_transfer_lines (
             tenant_id, transfer_id, item_id, from_location_id, to_location_id,
             batch_id, quantity_requested, quantity_shipped, quantity_received, notes, sort_order
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, 0, 0, $8, $9)
           RETURNING *`,
          [
            tenantId,
            transfer.id,
            line.itemId,
            line.fromLocationId ?? null,
            line.toLocationId ?? null,
            line.batchId ?? null,
            line.quantityRequested,
            line.notes ?? null,
            line.sortOrder ?? sort++,
          ],
        );
        lines.push(toStockTransferLine(lRes.rows[0]!));
      }

      return { transfer, lines };
    });
  }

  async updateStockTransferProjection(
    tenantId: string,
    input: UpdateScmStockTransferProjectionInput,
  ): Promise<ScmStockTransfer | null> {
    const r = await this.pool.query(
      `UPDATE scm_stock_transfers
          SET status = $3,
              workflow_instance_id = CASE WHEN $4::boolean THEN $5 ELSE workflow_instance_id END,
              shipped_at = CASE WHEN $6::boolean THEN $7 ELSE shipped_at END,
              received_at = CASE WHEN $8::boolean THEN $9 ELSE received_at END,
              cancelled_at = CASE WHEN $10::boolean THEN $11 ELSE cancelled_at END,
              notes = CASE WHEN $12::boolean THEN $13 ELSE notes END,
              updated_by = $14,
              updated_at = now()
        WHERE tenant_id = $1 AND id = $2
        RETURNING *`,
      [
        tenantId,
        input.transferId,
        input.status,
        input.workflowInstanceId !== undefined,
        input.workflowInstanceId ?? null,
        input.shippedAt !== undefined,
        input.shippedAt ?? null,
        input.receivedAt !== undefined,
        input.receivedAt ?? null,
        input.cancelledAt !== undefined,
        input.cancelledAt ?? null,
        input.notes !== undefined,
        input.notes ?? null,
        input.updatedBy ?? null,
      ],
    );
    return r.rows[0] ? toStockTransfer(r.rows[0]) : null;
  }

  async deleteStockTransferWithoutWorkflow(tenantId: string, transferId: string): Promise<void> {
    await this.pool.query(
      `DELETE FROM scm_stock_transfers
        WHERE tenant_id = $1 AND id = $2 AND workflow_instance_id IS NULL`,
      [tenantId, transferId],
    );
  }

  async recordStockTransferShipment(
    tenantId: string,
    input: RecordScmStockTransferShipmentInput,
  ): Promise<ScmStockTransferLine[]> {
    return this.inTransaction(async (client) => {
      const updatedLines: ScmStockTransferLine[] = [];
      for (const item of input.lineShipments) {
        const r = await client.query(
          `UPDATE scm_stock_transfer_lines
              SET quantity_shipped = quantity_shipped + $3
            WHERE tenant_id = $1 AND id = $2 AND transfer_id = $4
            RETURNING *`,
          [tenantId, item.lineId, item.quantityShipped, input.transferId],
        );
        if (r.rows[0]) updatedLines.push(toStockTransferLine(r.rows[0]));
      }

      await client.query(
        `UPDATE scm_stock_transfers
            SET status = 'in_transit', shipped_at = now(), updated_at = now()
          WHERE tenant_id = $1 AND id = $2`,
        [tenantId, input.transferId],
      );

      return updatedLines;
    });
  }

  async recordStockTransferReceipt(
    tenantId: string,
    input: RecordScmStockTransferReceiptInput,
  ): Promise<ScmStockTransferLine[]> {
    return this.inTransaction(async (client) => {
      const updatedLines: ScmStockTransferLine[] = [];
      for (const item of input.lineReceipts) {
        const r = await client.query(
          `UPDATE scm_stock_transfer_lines
              SET quantity_received = quantity_received + $3
            WHERE tenant_id = $1 AND id = $2 AND transfer_id = $4
            RETURNING *`,
          [tenantId, item.lineId, item.quantityReceived, input.transferId],
        );
        if (r.rows[0]) updatedLines.push(toStockTransferLine(r.rows[0]));
      }

      await client.query(
        `UPDATE scm_stock_transfers
            SET status = 'received', received_at = now(), updated_at = now()
          WHERE tenant_id = $1 AND id = $2`,
        [tenantId, input.transferId],
      );

      return updatedLines;
    });
  }

  async findStockTransferById(
    tenantId: string,
    transferId: string,
  ): Promise<{ transfer: ScmStockTransfer; lines: ScmStockTransferLine[] } | null> {
    const trRes = await this.pool.query(
      `SELECT * FROM scm_stock_transfers WHERE tenant_id = $1 AND id = $2`,
      [tenantId, transferId],
    );
    if (!trRes.rows[0]) return null;

    const linesRes = await this.pool.query(
      `SELECT * FROM scm_stock_transfer_lines WHERE tenant_id = $1 AND transfer_id = $2 ORDER BY sort_order`,
      [tenantId, transferId],
    );
    return {
      transfer: toStockTransfer(trRes.rows[0]),
      lines: linesRes.rows.map(toStockTransferLine),
    };
  }

  async listStockTransfers(tenantId: string, filter: ScmStockTransferFilter = {}): Promise<ScmStockTransfer[]> {
    const conditions = [`tenant_id = $1`];
    const params: unknown[] = [tenantId];

    if (filter.fromWarehouseId) {
      params.push(filter.fromWarehouseId);
      conditions.push(`from_warehouse_id = $${params.length}`);
    }
    if (filter.toWarehouseId) {
      params.push(filter.toWarehouseId);
      conditions.push(`to_warehouse_id = $${params.length}`);
    }
    if (filter.warehouseIds && filter.warehouseIds.length > 0) {
      params.push(filter.warehouseIds);
      conditions.push(`(from_warehouse_id = ANY($${params.length}) OR to_warehouse_id = ANY($${params.length}))`);
    }
    if (filter.status) {
      params.push(filter.status);
      conditions.push(`status = $${params.length}`);
    }

    const r = await this.pool.query(
      `SELECT * FROM scm_stock_transfers WHERE ${conditions.join(" AND ")} ORDER BY created_at DESC`,
      params,
    );
    return r.rows.map(toStockTransfer);
  }

  // =========================================================================
  // Stock Opname
  // =========================================================================

  async createStockOpname(
    tenantId: string,
    input: CreateScmStockOpnameInput,
  ): Promise<{ opname: ScmStockOpname; lines: ScmStockOpnameLine[] }> {
    return this.inTransaction(async (client) => {
      const opRes = await client.query(
        `INSERT INTO scm_stock_opnames (
           tenant_id, opname_number, warehouse_id, opname_date, status, notes, created_by, updated_by
         ) VALUES ($1, $2, $3, $4, 'draft', $5, $6, $6)
         RETURNING *`,
        [
          tenantId,
          input.opnameNumber,
          input.warehouseId,
          input.opnameDate,
          input.notes ?? null,
          input.createdBy ?? null,
        ],
      );
      const opname = toStockOpname(opRes.rows[0]!);

      const lines: ScmStockOpnameLine[] = [];
      let sort = 0;
      for (const line of input.lines) {
        const physical = line.physicalQuantity ?? null;
        const variance = physical !== null ? physical - line.systemQuantity : null;
        const lRes = await client.query(
          `INSERT INTO scm_stock_opname_lines (
             tenant_id, opname_id, item_id, location_id, batch_id,
             system_quantity, physical_quantity, variance_quantity, notes, sort_order
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
           RETURNING *`,
          [
            tenantId,
            opname.id,
            line.itemId,
            line.locationId ?? null,
            line.batchId ?? null,
            line.systemQuantity,
            physical,
            variance,
            line.notes ?? null,
            line.sortOrder ?? sort++,
          ],
        );
        lines.push(toStockOpnameLine(lRes.rows[0]!));
      }

      return { opname, lines };
    });
  }

  async updateStockOpnameProjection(
    tenantId: string,
    input: UpdateScmStockOpnameProjectionInput,
  ): Promise<ScmStockOpname | null> {
    const r = await this.pool.query(
      `UPDATE scm_stock_opnames
          SET status = $3,
              workflow_instance_id = CASE WHEN $4::boolean THEN $5 ELSE workflow_instance_id END,
              completed_at = CASE WHEN $6::boolean THEN $7 ELSE completed_at END,
              completed_by = CASE WHEN $8::boolean THEN $9 ELSE completed_by END,
              notes = CASE WHEN $10::boolean THEN $11 ELSE notes END,
              updated_by = $12,
              updated_at = now()
        WHERE tenant_id = $1 AND id = $2
        RETURNING *`,
      [
        tenantId,
        input.opnameId,
        input.status,
        input.workflowInstanceId !== undefined,
        input.workflowInstanceId ?? null,
        input.completedAt !== undefined,
        input.completedAt ?? null,
        input.completedBy !== undefined,
        input.completedBy ?? null,
        input.notes !== undefined,
        input.notes ?? null,
        input.updatedBy ?? null,
      ],
    );
    return r.rows[0] ? toStockOpname(r.rows[0]) : null;
  }

  async deleteStockOpnameWithoutWorkflow(tenantId: string, opnameId: string): Promise<void> {
    await this.pool.query(
      `DELETE FROM scm_stock_opnames
        WHERE tenant_id = $1 AND id = $2 AND workflow_instance_id IS NULL`,
      [tenantId, opnameId],
    );
  }

  async recordStockOpnameCount(
    tenantId: string,
    input: RecordScmStockOpnameCountInput,
  ): Promise<ScmStockOpnameLine | null> {
    const r = await this.pool.query(
      `UPDATE scm_stock_opname_lines
          SET physical_quantity = $3,
              variance_quantity = $3 - system_quantity
        WHERE tenant_id = $1 AND id = $2
        RETURNING *`,
      [tenantId, input.lineId, input.physicalQuantity],
    );
    return r.rows[0] ? toStockOpnameLine(r.rows[0]) : null;
  }

  async linkOpnameLineAdjustmentMovement(
    tenantId: string,
    lineId: string,
    adjustmentMovementId: string,
  ): Promise<ScmStockOpnameLine | null> {
    const r = await this.pool.query(
      `UPDATE scm_stock_opname_lines
          SET adjustment_movement_id = $3
        WHERE tenant_id = $1 AND id = $2
        RETURNING *`,
      [tenantId, lineId, adjustmentMovementId],
    );
    return r.rows[0] ? toStockOpnameLine(r.rows[0]) : null;
  }

  async findStockOpnameById(
    tenantId: string,
    opnameId: string,
  ): Promise<{ opname: ScmStockOpname; lines: ScmStockOpnameLine[] } | null> {
    const opRes = await this.pool.query(
      `SELECT * FROM scm_stock_opnames WHERE tenant_id = $1 AND id = $2`,
      [tenantId, opnameId],
    );
    if (!opRes.rows[0]) return null;

    const linesRes = await this.pool.query(
      `SELECT * FROM scm_stock_opname_lines WHERE tenant_id = $1 AND opname_id = $2 ORDER BY sort_order`,
      [tenantId, opnameId],
    );
    return {
      opname: toStockOpname(opRes.rows[0]),
      lines: linesRes.rows.map(toStockOpnameLine),
    };
  }

  async listStockOpnames(tenantId: string, filter: ScmStockOpnameFilter = {}): Promise<ScmStockOpname[]> {
    const conditions = [`tenant_id = $1`];
    const params: unknown[] = [tenantId];

    if (filter.warehouseId) {
      params.push(filter.warehouseId);
      conditions.push(`warehouse_id = $${params.length}`);
    }
    if (filter.warehouseIds && filter.warehouseIds.length > 0) {
      params.push(filter.warehouseIds);
      conditions.push(`warehouse_id = ANY($${params.length})`);
    }
    if (filter.status) {
      params.push(filter.status);
      conditions.push(`status = $${params.length}`);
    }

    const r = await this.pool.query(
      `SELECT * FROM scm_stock_opnames WHERE ${conditions.join(" AND ")} ORDER BY opname_date DESC`,
      params,
    );
    return r.rows.map(toStockOpname);
  }

  // =========================================================================
  // 3. Valuation & Landed Cost
  // =========================================================================

  async createValuationLayer(tenantId: string, input: CreateScmValuationLayerInput): Promise<ScmValuationLayer> {
    const r = await this.pool.query(
      `INSERT INTO scm_valuation_layers (
         tenant_id, item_id, warehouse_id, receipt_movement_id, received_date,
         original_quantity, remaining_quantity, unit_cost, landed_cost_added,
         effective_unit_cost, total_value
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       RETURNING *`,
      [
        tenantId,
        input.itemId,
        input.warehouseId ?? null,
        input.receiptMovementId ?? null,
        input.receivedDate,
        input.originalQuantity,
        input.remainingQuantity,
        input.unitCost,
        input.landedCostAdded ?? 0,
        input.effectiveUnitCost,
        input.totalValue,
      ],
    );
    return toValuationLayer(r.rows[0]!);
  }

  async updateValuationLayerRemainingQuantity(
    tenantId: string,
    input: ConsumeScmValuationLayerInput,
  ): Promise<ScmValuationLayer | null> {
    const r = await this.pool.query(
      `UPDATE scm_valuation_layers
          SET remaining_quantity = $3,
              total_value = $3 * effective_unit_cost
        WHERE tenant_id = $1 AND id = $2
        RETURNING *`,
      [tenantId, input.layerId, input.remainingQuantity],
    );
    return r.rows[0] ? toValuationLayer(r.rows[0]) : null;
  }

  async findValuationLayerById(tenantId: string, layerId: string): Promise<ScmValuationLayer | null> {
    const r = await this.pool.query(
      `SELECT * FROM scm_valuation_layers WHERE tenant_id = $1 AND id = $2`,
      [tenantId, layerId],
    );
    return r.rows[0] ? toValuationLayer(r.rows[0]) : null;
  }

  async listValuationLayers(
    tenantId: string,
    filter: ScmValuationLayerFilter = {},
  ): Promise<ScmValuationLayer[]> {
    const conditions = [`tenant_id = $1`];
    const params: unknown[] = [tenantId];

    if (filter.itemId) {
      params.push(filter.itemId);
      conditions.push(`item_id = $${params.length}`);
    }
    if (filter.warehouseId) {
      params.push(filter.warehouseId);
      conditions.push(`warehouse_id = $${params.length}`);
    }
    if (filter.onlyWithRemaining) {
      conditions.push(`remaining_quantity > 0`);
    }

    const r = await this.pool.query(
      `SELECT * FROM scm_valuation_layers WHERE ${conditions.join(" AND ")} ORDER BY received_date ASC`,
      params,
    );
    return r.rows.map(toValuationLayer);
  }

  async createLandedCost(
    tenantId: string,
    input: CreateScmLandedCostInput,
  ): Promise<{ landedCost: ScmLandedCost; allocations: ScmLandedCostAllocation[] }> {
    return this.inTransaction(async (client) => {
      const lcRes = await client.query(
        `INSERT INTO scm_landed_costs (
           tenant_id, voucher_number, purchase_order_id, cost_type, currency,
           amount, allocation_method, status, notes, created_by, updated_by
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, 'draft', $8, $9, $9)
         RETURNING *`,
        [
          tenantId,
          input.voucherNumber,
          input.purchaseOrderId,
          input.costType,
          input.currency ?? "IDR",
          input.amount,
          input.allocationMethod,
          input.notes ?? null,
          input.createdBy ?? null,
        ],
      );
      const landedCost = toLandedCost(lcRes.rows[0]!);

      const allocations: ScmLandedCostAllocation[] = [];
      for (const item of input.allocations) {
        const aRes = await client.query(
          `INSERT INTO scm_landed_cost_allocations (
             tenant_id, landed_cost_id, item_id, valuation_layer_id,
             allocated_amount, cost_per_unit_added
           ) VALUES ($1, $2, $3, $4, $5, $6)
           RETURNING *`,
          [
            tenantId,
            landedCost.id,
            item.itemId,
            item.valuationLayerId ?? null,
            item.allocatedAmount,
            item.costPerUnitAdded,
          ],
        );
        allocations.push(toLandedCostAllocation(aRes.rows[0]!));
      }

      return { landedCost, allocations };
    });
  }

  async applyLandedCost(tenantId: string, input: ApplyScmLandedCostInput): Promise<ScmLandedCost | null> {
    return this.inTransaction(async (client) => {
      const r = await client.query(
        `UPDATE scm_landed_costs
            SET status = 'applied', applied_at = COALESCE($3, now()), updated_at = now()
          WHERE tenant_id = $1 AND id = $2 AND status = 'draft'
          RETURNING *`,
        [tenantId, input.landedCostId, input.appliedAt ?? null],
      );
      if (!r.rows[0]) return null;

      // Update valuation layers referenced in allocations
      const allocs = await client.query(
        `SELECT * FROM scm_landed_cost_allocations WHERE tenant_id = $1 AND landed_cost_id = $2`,
        [tenantId, input.landedCostId],
      );

      for (const a of allocs.rows) {
        if (a.valuation_layer_id) {
          await client.query(
            `UPDATE scm_valuation_layers
                SET landed_cost_added = landed_cost_added + $1,
                    effective_unit_cost = effective_unit_cost + $2,
                    total_value = remaining_quantity * (effective_unit_cost + $2)
              WHERE tenant_id = $3 AND id = $4`,
            [a.allocated_amount, a.cost_per_unit_added, tenantId, a.valuation_layer_id],
          );
        }
      }

      return toLandedCost(r.rows[0]);
    });
  }

  async findLandedCostById(
    tenantId: string,
    landedCostId: string,
  ): Promise<{ landedCost: ScmLandedCost; allocations: ScmLandedCostAllocation[] } | null> {
    const lcRes = await this.pool.query(
      `SELECT * FROM scm_landed_costs WHERE tenant_id = $1 AND id = $2`,
      [tenantId, landedCostId],
    );
    if (!lcRes.rows[0]) return null;

    const allocRes = await this.pool.query(
      `SELECT * FROM scm_landed_cost_allocations WHERE tenant_id = $1 AND landed_cost_id = $2`,
      [tenantId, landedCostId],
    );
    return {
      landedCost: toLandedCost(lcRes.rows[0]),
      allocations: allocRes.rows.map(toLandedCostAllocation),
    };
  }

  async listLandedCosts(tenantId: string, filter: ScmLandedCostFilter = {}): Promise<ScmLandedCost[]> {
    const conditions = [`tenant_id = $1`];
    const params: unknown[] = [tenantId];

    if (filter.purchaseOrderId) {
      params.push(filter.purchaseOrderId);
      conditions.push(`purchase_order_id = $${params.length}`);
    }
    if (filter.status) {
      params.push(filter.status);
      conditions.push(`status = $${params.length}`);
    }

    const r = await this.pool.query(
      `SELECT * FROM scm_landed_costs WHERE ${conditions.join(" AND ")} ORDER BY created_at DESC`,
      params,
    );
    return r.rows.map(toLandedCost);
  }

  // =========================================================================
  // 4. RFQ, Tender & Bids
  // =========================================================================

  async createRfq(
    tenantId: string,
    input: CreateScmRfqInput,
  ): Promise<{ rfq: ScmRfq; items: ScmRfqItem[]; invitedSuppliers: ScmRfqInvitedSupplier[] }> {
    return this.inTransaction(async (client) => {
      const rfqRes = await client.query(
        `INSERT INTO scm_rfqs (
           tenant_id, rfq_number, title, procurement_type, organization_unit_id,
           purchase_request_id, submission_deadline, status, notes, created_by, updated_by
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, 'draft', $8, $9, $9)
         RETURNING *`,
        [
          tenantId,
          input.rfqNumber,
          input.title,
          input.procurementType,
          input.organizationUnitId ?? null,
          input.purchaseRequestId ?? null,
          input.submissionDeadline,
          input.notes ?? null,
          input.createdBy ?? null,
        ],
      );
      const rfq = toRfq(rfqRes.rows[0]!);

      const items: ScmRfqItem[] = [];
      let sort = 0;
      for (const item of input.items) {
        const itemRes = await client.query(
          `INSERT INTO scm_rfq_items (
             tenant_id, rfq_id, item_id, target_quantity, target_unit_price, specifications, sort_order
           ) VALUES ($1, $2, $3, $4, $5, $6, $7)
           RETURNING *`,
          [
            tenantId,
            rfq.id,
            item.itemId,
            item.targetQuantity,
            item.targetUnitPrice ?? null,
            item.specifications ?? null,
            item.sortOrder ?? sort++,
          ],
        );
        items.push(toRfqItem(itemRes.rows[0]!));
      }

      const invitedSuppliers: ScmRfqInvitedSupplier[] = [];
      for (const inv of input.invitedSuppliers) {
        const invRes = await client.query(
          `INSERT INTO scm_rfq_invited_suppliers (
             tenant_id, rfq_id, supplier_id, invited_at, responded_at
           ) VALUES ($1, $2, $3, now(), $4)
           RETURNING *`,
          [tenantId, rfq.id, inv.supplierId, inv.respondedAt ?? null],
        );
        invitedSuppliers.push(toRfqInvitedSupplier(invRes.rows[0]!));
      }

      return { rfq, items, invitedSuppliers };
    });
  }

  async updateRfqProjection(tenantId: string, input: UpdateScmRfqProjectionInput): Promise<ScmRfq | null> {
    const r = await this.pool.query(
      `UPDATE scm_rfqs
          SET status = $3,
              workflow_instance_id = CASE WHEN $4::boolean THEN $5 ELSE workflow_instance_id END,
              awarded_at = CASE WHEN $6::boolean THEN $7 ELSE awarded_at END,
              cancelled_at = CASE WHEN $8::boolean THEN $9 ELSE cancelled_at END,
              notes = CASE WHEN $10::boolean THEN $11 ELSE notes END,
              updated_by = $12,
              updated_at = now()
        WHERE tenant_id = $1 AND id = $2
        RETURNING *`,
      [
        tenantId,
        input.rfqId,
        input.status,
        input.workflowInstanceId !== undefined,
        input.workflowInstanceId ?? null,
        input.awardedAt !== undefined,
        input.awardedAt ?? null,
        input.cancelledAt !== undefined,
        input.cancelledAt ?? null,
        input.notes !== undefined,
        input.notes ?? null,
        input.updatedBy ?? null,
      ],
    );
    return r.rows[0] ? toRfq(r.rows[0]) : null;
  }

  async deleteRfqWithoutWorkflow(tenantId: string, rfqId: string): Promise<void> {
    await this.pool.query(
      `DELETE FROM scm_rfqs
        WHERE tenant_id = $1 AND id = $2 AND workflow_instance_id IS NULL`,
      [tenantId, rfqId],
    );
  }

  async findRfqById(
    tenantId: string,
    rfqId: string,
  ): Promise<{ rfq: ScmRfq; items: ScmRfqItem[]; invitedSuppliers: ScmRfqInvitedSupplier[] } | null> {
    const rfqRes = await this.pool.query(
      `SELECT * FROM scm_rfqs WHERE tenant_id = $1 AND id = $2`,
      [tenantId, rfqId],
    );
    if (!rfqRes.rows[0]) return null;

    const itemsRes = await this.pool.query(
      `SELECT * FROM scm_rfq_items WHERE tenant_id = $1 AND rfq_id = $2 ORDER BY sort_order`,
      [tenantId, rfqId],
    );
    const invRes = await this.pool.query(
      `SELECT * FROM scm_rfq_invited_suppliers WHERE tenant_id = $1 AND rfq_id = $2`,
      [tenantId, rfqId],
    );

    return {
      rfq: toRfq(rfqRes.rows[0]),
      items: itemsRes.rows.map(toRfqItem),
      invitedSuppliers: invRes.rows.map(toRfqInvitedSupplier),
    };
  }

  async listRfqs(tenantId: string, filter: ScmRfqFilter = {}): Promise<ScmRfq[]> {
    const conditions = [`tenant_id = $1`];
    const params: unknown[] = [tenantId];

    if (filter.organizationUnitIds !== undefined) {
      if (filter.organizationUnitIds === null) {
        // tenant wide
      } else if (filter.organizationUnitIds.length === 0) {
        conditions.push(`organization_unit_id IS NULL`);
      } else {
        params.push(filter.organizationUnitIds);
        conditions.push(`(organization_unit_id IS NULL OR organization_unit_id = ANY($${params.length}))`);
      }
    }
    if (filter.purchaseRequestId) {
      params.push(filter.purchaseRequestId);
      conditions.push(`purchase_request_id = $${params.length}`);
    }
    if (filter.procurementType) {
      params.push(filter.procurementType);
      conditions.push(`procurement_type = $${params.length}`);
    }
    if (filter.status) {
      params.push(filter.status);
      conditions.push(`status = $${params.length}`);
    }

    const r = await this.pool.query(
      `SELECT * FROM scm_rfqs WHERE ${conditions.join(" AND ")} ORDER BY created_at DESC`,
      params,
    );
    return r.rows.map(toRfq);
  }

  async createSupplierBid(
    tenantId: string,
    input: CreateScmSupplierBidInput,
  ): Promise<{ bid: ScmSupplierBid; lines: ScmSupplierBidLine[] }> {
    return this.inTransaction(async (client) => {
      const bidRes = await client.query(
        `INSERT INTO scm_supplier_bids (
           tenant_id, bid_number, rfq_id, supplier_id, currency, total_amount,
           lead_time_days, valid_until, status, notes, created_by, updated_by
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'submitted', $9, $10, $10)
         RETURNING *`,
        [
          tenantId,
          input.bidNumber,
          input.rfqId,
          input.supplierId,
          input.currency ?? "IDR",
          input.totalAmount ?? 0,
          input.leadTimeDays ?? 0,
          input.validUntil ?? null,
          input.notes ?? null,
          input.createdBy ?? null,
        ],
      );
      const bid = toSupplierBid(bidRes.rows[0]!);

      const lines: ScmSupplierBidLine[] = [];
      for (const line of input.lines) {
        const lRes = await client.query(
          `INSERT INTO scm_supplier_bid_lines (
             tenant_id, bid_id, rfq_item_id, offered_quantity, offered_unit_price,
             offered_total_price, remarks
           ) VALUES ($1, $2, $3, $4, $5, $6, $7)
           RETURNING *`,
          [
            tenantId,
            bid.id,
            line.rfqItemId,
            line.offeredQuantity,
            line.offeredUnitPrice,
            line.offeredTotalPrice,
            line.remarks ?? null,
          ],
        );
        lines.push(toSupplierBidLine(lRes.rows[0]!));
      }

      return { bid, lines };
    });
  }

  async updateSupplierBidScore(
    tenantId: string,
    input: UpdateScmSupplierBidScoreInput,
  ): Promise<ScmSupplierBid | null> {
    const r = await this.pool.query(
      `UPDATE scm_supplier_bids
          SET technical_score = CASE WHEN $3::boolean THEN $4 ELSE technical_score END,
              commercial_score = CASE WHEN $5::boolean THEN $6 ELSE commercial_score END,
              final_score = CASE WHEN $7::boolean THEN $8 ELSE final_score END,
              rank = CASE WHEN $9::boolean THEN $10 ELSE rank END,
              status = COALESCE($11, status),
              updated_by = $12,
              updated_at = now()
        WHERE tenant_id = $1 AND id = $2
        RETURNING *`,
      [
        tenantId,
        input.bidId,
        input.technicalScore !== undefined,
        input.technicalScore ?? null,
        input.commercialScore !== undefined,
        input.commercialScore ?? null,
        input.finalScore !== undefined,
        input.finalScore ?? null,
        input.rank !== undefined,
        input.rank ?? null,
        input.status ?? null,
        input.updatedBy ?? null,
      ],
    );
    return r.rows[0] ? toSupplierBid(r.rows[0]) : null;
  }

  async awardSupplierBid(tenantId: string, input: AwardScmSupplierBidInput): Promise<ScmSupplierBid | null> {
    const r = await this.pool.query(
      `UPDATE scm_supplier_bids
          SET is_winning_bid = true,
              status = 'awarded',
              resulting_po_id = $3,
              updated_by = $4,
              updated_at = now()
        WHERE tenant_id = $1 AND id = $2
        RETURNING *`,
      [tenantId, input.bidId, input.resultingPurchaseOrderId ?? null, input.updatedBy ?? null],
    );
    return r.rows[0] ? toSupplierBid(r.rows[0]) : null;
  }

  async findSupplierBidById(
    tenantId: string,
    bidId: string,
  ): Promise<{ bid: ScmSupplierBid; lines: ScmSupplierBidLine[] } | null> {
    const bidRes = await this.pool.query(
      `SELECT * FROM scm_supplier_bids WHERE tenant_id = $1 AND id = $2`,
      [tenantId, bidId],
    );
    if (!bidRes.rows[0]) return null;

    const linesRes = await this.pool.query(
      `SELECT * FROM scm_supplier_bid_lines WHERE tenant_id = $1 AND bid_id = $2`,
      [tenantId, bidId],
    );
    return {
      bid: toSupplierBid(bidRes.rows[0]),
      lines: linesRes.rows.map(toSupplierBidLine),
    };
  }

  async listSupplierBids(tenantId: string, filter: ScmSupplierBidFilter = {}): Promise<ScmSupplierBid[]> {
    const conditions = [`tenant_id = $1`];
    const params: unknown[] = [tenantId];

    if (filter.rfqId) {
      params.push(filter.rfqId);
      conditions.push(`rfq_id = $${params.length}`);
    }
    if (filter.supplierId) {
      params.push(filter.supplierId);
      conditions.push(`supplier_id = $${params.length}`);
    }
    if (filter.status) {
      params.push(filter.status);
      conditions.push(`status = $${params.length}`);
    }
    if (filter.winningOnly) {
      conditions.push(`is_winning_bid = true`);
    }

    const r = await this.pool.query(
      `SELECT * FROM scm_supplier_bids WHERE ${conditions.join(" AND ")} ORDER BY final_score DESC NULLS LAST, total_amount ASC`,
      params,
    );
    return r.rows.map(toSupplierBid);
  }

  // =========================================================================
  // 5. Supplier Evaluation & Contracts
  // =========================================================================

  async createSupplierEvaluation(
    tenantId: string,
    input: CreateScmSupplierEvaluationInput,
  ): Promise<ScmSupplierEvaluation> {
    const r = await this.pool.query(
      `INSERT INTO scm_supplier_evaluations (
         tenant_id, evaluation_number, supplier_id, evaluation_period,
         period_start_date, period_end_date, quality_score, delivery_score,
         pricing_score, service_score, overall_score, rating_grade, status,
         notes, evaluated_by, evaluated_at, created_by, updated_by
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, 'draft', $13, $14, $15, $16, $16)
       RETURNING *`,
      [
        tenantId,
        input.evaluationNumber,
        input.supplierId,
        input.evaluationPeriod,
        input.periodStartDate,
        input.periodEndDate,
        input.qualityScore ?? 0,
        input.deliveryScore ?? 0,
        input.pricingScore ?? 0,
        input.serviceScore ?? 0,
        input.overallScore ?? 0,
        input.ratingGrade ?? "B",
        input.notes ?? null,
        input.evaluatedBy ?? null,
        input.evaluatedAt ?? null,
        input.createdBy ?? null,
      ],
    );
    return toSupplierEvaluation(r.rows[0]!);
  }

  async updateSupplierEvaluationProjection(
    tenantId: string,
    input: UpdateScmSupplierEvaluationProjectionInput,
  ): Promise<ScmSupplierEvaluation | null> {
    const r = await this.pool.query(
      `UPDATE scm_supplier_evaluations
          SET status = $3,
              workflow_instance_id = CASE WHEN $4::boolean THEN $5 ELSE workflow_instance_id END,
              notes = CASE WHEN $6::boolean THEN $7 ELSE notes END,
              updated_by = $8,
              updated_at = now()
        WHERE tenant_id = $1 AND id = $2
        RETURNING *`,
      [
        tenantId,
        input.evaluationId,
        input.status,
        input.workflowInstanceId !== undefined,
        input.workflowInstanceId ?? null,
        input.notes !== undefined,
        input.notes ?? null,
        input.updatedBy ?? null,
      ],
    );
    return r.rows[0] ? toSupplierEvaluation(r.rows[0]) : null;
  }

  async deleteSupplierEvaluationWithoutWorkflow(tenantId: string, evaluationId: string): Promise<void> {
    await this.pool.query(
      `DELETE FROM scm_supplier_evaluations
        WHERE tenant_id = $1 AND id = $2 AND workflow_instance_id IS NULL`,
      [tenantId, evaluationId],
    );
  }

  async findSupplierEvaluationById(tenantId: string, evaluationId: string): Promise<ScmSupplierEvaluation | null> {
    const r = await this.pool.query(
      `SELECT * FROM scm_supplier_evaluations WHERE tenant_id = $1 AND id = $2`,
      [tenantId, evaluationId],
    );
    return r.rows[0] ? toSupplierEvaluation(r.rows[0]) : null;
  }

  async listSupplierEvaluations(
    tenantId: string,
    filter: ScmSupplierEvaluationFilter = {},
  ): Promise<ScmSupplierEvaluation[]> {
    const conditions = [`tenant_id = $1`];
    const params: unknown[] = [tenantId];

    if (filter.supplierId) {
      params.push(filter.supplierId);
      conditions.push(`supplier_id = $${params.length}`);
    }
    if (filter.status) {
      params.push(filter.status);
      conditions.push(`status = $${params.length}`);
    }
    if (filter.ratingGrade) {
      params.push(filter.ratingGrade);
      conditions.push(`rating_grade = $${params.length}`);
    }

    const r = await this.pool.query(
      `SELECT * FROM scm_supplier_evaluations WHERE ${conditions.join(" AND ")} ORDER BY period_end_date DESC`,
      params,
    );
    return r.rows.map(toSupplierEvaluation);
  }

  async createSupplierContract(
    tenantId: string,
    input: CreateScmSupplierContractInput,
  ): Promise<{ contract: ScmSupplierContract; items: ScmSupplierContractItem[] }> {
    return this.inTransaction(async (client) => {
      const cRes = await client.query(
        `INSERT INTO scm_supplier_contracts (
           tenant_id, contract_number, supplier_id, title, contract_type,
           start_date, end_date, currency, committed_amount, spent_amount,
           status, terms_and_conditions, created_by, updated_by
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 0, 'draft', $10, $11, $11)
         RETURNING *`,
        [
          tenantId,
          input.contractNumber,
          input.supplierId,
          input.title,
          input.contractType,
          input.startDate,
          input.endDate,
          input.currency ?? "IDR",
          input.committedAmount ?? 0,
          input.termsAndConditions ?? null,
          input.createdBy ?? null,
        ],
      );
      const contract = toSupplierContract(cRes.rows[0]!);

      const items: ScmSupplierContractItem[] = [];
      for (const item of input.items) {
        const itemRes = await client.query(
          `INSERT INTO scm_supplier_contract_items (
             tenant_id, contract_id, item_id, agreed_unit_price,
             min_order_quantity, max_order_quantity, lead_time_days, notes
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
           RETURNING *`,
          [
            tenantId,
            contract.id,
            item.itemId,
            item.agreedUnitPrice,
            item.minOrderQuantity ?? 1,
            item.maxOrderQuantity ?? null,
            item.leadTimeDays ?? 0,
            item.notes ?? null,
          ],
        );
        items.push(toSupplierContractItem(itemRes.rows[0]!));
      }

      return { contract, items };
    });
  }

  async updateSupplierContractProjection(
    tenantId: string,
    input: UpdateScmSupplierContractProjectionInput,
  ): Promise<ScmSupplierContract | null> {
    const r = await this.pool.query(
      `UPDATE scm_supplier_contracts
          SET status = $3,
              workflow_instance_id = CASE WHEN $4::boolean THEN $5 ELSE workflow_instance_id END,
              approved_at = CASE WHEN $6::boolean THEN $7 ELSE approved_at END,
              closed_at = CASE WHEN $8::boolean THEN $9 ELSE closed_at END,
              updated_by = $10,
              updated_at = now()
        WHERE tenant_id = $1 AND id = $2
        RETURNING *`,
      [
        tenantId,
        input.contractId,
        input.status,
        input.workflowInstanceId !== undefined,
        input.workflowInstanceId ?? null,
        input.approvedAt !== undefined,
        input.approvedAt ?? null,
        input.closedAt !== undefined,
        input.closedAt ?? null,
        input.updatedBy ?? null,
      ],
    );
    return r.rows[0] ? toSupplierContract(r.rows[0]) : null;
  }

  async deleteSupplierContractWithoutWorkflow(tenantId: string, contractId: string): Promise<void> {
    await this.pool.query(
      `DELETE FROM scm_supplier_contracts
        WHERE tenant_id = $1 AND id = $2 AND workflow_instance_id IS NULL`,
      [tenantId, contractId],
    );
  }

  async recordSupplierContractSpend(
    tenantId: string,
    input: RecordScmSupplierContractSpendInput,
  ): Promise<ScmSupplierContract | null> {
    const r = await this.pool.query(
      `UPDATE scm_supplier_contracts
          SET spent_amount = spent_amount + $3, updated_at = now()
        WHERE tenant_id = $1 AND id = $2
        RETURNING *`,
      [tenantId, input.contractId, input.additionalSpentAmount],
    );
    return r.rows[0] ? toSupplierContract(r.rows[0]) : null;
  }

  async findSupplierContractById(
    tenantId: string,
    contractId: string,
  ): Promise<{ contract: ScmSupplierContract; items: ScmSupplierContractItem[] } | null> {
    const cRes = await this.pool.query(
      `SELECT * FROM scm_supplier_contracts WHERE tenant_id = $1 AND id = $2`,
      [tenantId, contractId],
    );
    if (!cRes.rows[0]) return null;

    const itemsRes = await this.pool.query(
      `SELECT * FROM scm_supplier_contract_items WHERE tenant_id = $1 AND contract_id = $2`,
      [tenantId, contractId],
    );
    return {
      contract: toSupplierContract(cRes.rows[0]),
      items: itemsRes.rows.map(toSupplierContractItem),
    };
  }

  async listSupplierContracts(
    tenantId: string,
    filter: ScmSupplierContractFilter = {},
  ): Promise<ScmSupplierContract[]> {
    const conditions = [`tenant_id = $1`];
    const params: unknown[] = [tenantId];

    if (filter.supplierId) {
      params.push(filter.supplierId);
      conditions.push(`supplier_id = $${params.length}`);
    }
    if (filter.contractType) {
      params.push(filter.contractType);
      conditions.push(`contract_type = $${params.length}`);
    }
    if (filter.status) {
      params.push(filter.status);
      conditions.push(`status = $${params.length}`);
    }

    const r = await this.pool.query(
      `SELECT * FROM scm_supplier_contracts WHERE ${conditions.join(" AND ")} ORDER BY created_at DESC`,
      params,
    );
    return r.rows.map(toSupplierContract);
  }

  // =========================================================================
  // 6. Spend Analytics
  // =========================================================================

  async createSpendAnalyticsSnapshot(
    tenantId: string,
    input: CreateScmSpendAnalyticsSnapshotInput,
  ): Promise<ScmSpendAnalyticsSnapshot> {
    const r = await this.pool.query(
      `INSERT INTO scm_spend_analytics_snapshots (
         tenant_id, snapshot_date, period_type, period_key, organization_unit_id,
         supplier_id, item_category, total_spend, po_count, items_purchased_count,
         avg_po_value, created_by
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
       RETURNING *`,
      [
        tenantId,
        input.snapshotDate,
        input.periodType,
        input.periodKey,
        input.organizationUnitId ?? null,
        input.supplierId ?? null,
        input.itemCategory ?? null,
        input.totalSpend,
        input.poCount,
        input.itemsPurchasedCount,
        input.avgPoValue,
        input.createdBy ?? null,
      ],
    );
    return toSpendAnalyticsSnapshot(r.rows[0]!);
  }

  async listSpendAnalyticsSnapshots(
    tenantId: string,
    filter: ScmSpendAnalyticsSnapshotFilter = {},
  ): Promise<ScmSpendAnalyticsSnapshot[]> {
    const conditions = [`tenant_id = $1`];
    const params: unknown[] = [tenantId];

    if (filter.snapshotDateFrom) {
      params.push(filter.snapshotDateFrom);
      conditions.push(`snapshot_date >= $${params.length}`);
    }
    if (filter.snapshotDateTo) {
      params.push(filter.snapshotDateTo);
      conditions.push(`snapshot_date <= $${params.length}`);
    }
    if (filter.periodType) {
      params.push(filter.periodType);
      conditions.push(`period_type = $${params.length}`);
    }
    if (filter.organizationUnitIds !== undefined) {
      if (filter.organizationUnitIds === null) {
        // tenant wide
      } else if (filter.organizationUnitIds.length === 0) {
        conditions.push(`organization_unit_id IS NULL`);
      } else {
        params.push(filter.organizationUnitIds);
        conditions.push(`(organization_unit_id IS NULL OR organization_unit_id = ANY($${params.length}))`);
      }
    }
    if (filter.supplierId) {
      params.push(filter.supplierId);
      conditions.push(`supplier_id = $${params.length}`);
    }
    if (filter.itemCategory) {
      params.push(filter.itemCategory);
      conditions.push(`item_category = $${params.length}`);
    }

    const limit = filter.limit && filter.limit > 0 ? filter.limit : 100;
    params.push(limit);

    const r = await this.pool.query(
      `SELECT * FROM scm_spend_analytics_snapshots
        WHERE ${conditions.join(" AND ")}
        ORDER BY snapshot_date DESC
        LIMIT $${params.length}`,
      params,
    );
    return r.rows.map(toSpendAnalyticsSnapshot);
  }

  async findSpendAnalyticsSnapshotById(
    tenantId: string,
    snapshotId: string,
  ): Promise<ScmSpendAnalyticsSnapshot | null> {
    const r = await this.pool.query(
      `SELECT * FROM scm_spend_analytics_snapshots WHERE tenant_id = $1 AND id = $2`,
      [tenantId, snapshotId],
    );
    return r.rows[0] ? toSpendAnalyticsSnapshot(r.rows[0]) : null;
  }

  async computeSpendAnalyticsSnapshot(
    tenantId: string,
    input: {
      periodType: ScmSpendAnalyticsPeriodType;
      periodStart: string;
      periodEnd: string;
      organizationUnitId?: string | null;
      createdBy?: string | null;
    },
  ): Promise<ScmSpendAnalyticsSnapshot> {
    return this.inTransaction(async (client) => {
      await client.query("SET LOCAL statement_timeout = '15000'");
      const conditions = [
        "po.tenant_id = $1",
        "po.deleted_at IS NULL",
        "po.cancelled_at IS NULL",
        "po.issued_at IS NOT NULL",
        "po.order_date >= $2::date",
        "po.order_date <= $3::date",
      ];
      const params: unknown[] = [tenantId, input.periodStart, input.periodEnd];
      if (input.organizationUnitId) {
        params.push(input.organizationUnitId);
        conditions.push(`pr.organization_unit_id = $${params.length}`);
      }
      const query = `
        SELECT
          COALESCE(SUM(pol.quantity_ordered * COALESCE(pol.unit_price, 0)), 0) AS total_spend,
          COUNT(DISTINCT po.id) AS po_count,
          COALESCE(SUM(pol.quantity_ordered), 0) AS items_purchased_count
        FROM purchase_orders po
        LEFT JOIN purchase_requests pr ON pr.id = po.purchase_request_id AND pr.tenant_id = po.tenant_id
        JOIN purchase_order_lines pol ON pol.purchase_order_id = po.id
        WHERE ${conditions.join(" AND ")}
      `;
      const res = await client.query(query, params);
      const row = res.rows[0]!;
      const totalSpend = num(row.total_spend);
      const poCount = parseInt(row.po_count, 10) || 0;
      const itemsCount = num(row.items_purchased_count);
      const avgPoValue = poCount > 0 ? Math.round((totalSpend / poCount) * 10000) / 10000 : 0;
      const periodKey = `${input.periodStart}_${input.periodEnd}`;

      const ins = await client.query(
        `INSERT INTO scm_spend_analytics_snapshots (
           tenant_id, snapshot_date, period_type, period_key, organization_unit_id,
           total_spend, po_count, items_purchased_count, avg_po_value, created_by
         ) VALUES ($1, CURRENT_DATE, $2, $3, $4, $5, $6, $7, $8, $9)
         RETURNING *`,
        [
          tenantId,
          input.periodType,
          periodKey,
          input.organizationUnitId ?? null,
          totalSpend,
          poCount,
          itemsCount,
          avgPoValue,
          input.createdBy ?? null,
        ],
      );
      return toSpendAnalyticsSnapshot(ins.rows[0]!);
    });
  }

  // =========================================================================
  // Reference checks
  // =========================================================================

  async itemExists(tenantId: string, itemId: string): Promise<boolean> {
    const r = await this.pool.query(`SELECT 1 FROM items WHERE tenant_id = $1 AND id = $2`, [tenantId, itemId]);
    return (r.rowCount ?? 0) > 0;
  }

  async supplierExists(tenantId: string, supplierId: string): Promise<boolean> {
    const r = await this.pool.query(`SELECT 1 FROM suppliers WHERE tenant_id = $1 AND id = $2`, [tenantId, supplierId]);
    return (r.rowCount ?? 0) > 0;
  }

  async purchaseOrderExists(tenantId: string, purchaseOrderId: string): Promise<boolean> {
    const r = await this.pool.query(`SELECT 1 FROM purchase_orders WHERE tenant_id = $1 AND id = $2`, [tenantId, purchaseOrderId]);
    return (r.rowCount ?? 0) > 0;
  }

  async purchaseRequestExists(tenantId: string, purchaseRequestId: string): Promise<boolean> {
    const r = await this.pool.query(`SELECT 1 FROM purchase_requests WHERE tenant_id = $1 AND id = $2`, [tenantId, purchaseRequestId]);
    return (r.rowCount ?? 0) > 0;
  }

  async organizationUnitExists(tenantId: string, organizationUnitId: string): Promise<boolean> {
    const r = await this.pool.query(`SELECT 1 FROM organization_units WHERE tenant_id = $1 AND id = $2`, [tenantId, organizationUnitId]);
    return (r.rowCount ?? 0) > 0;
  }
}

// === Mapping Helpers =========================================================

function num(value: unknown): number {
  if (value === null || value === undefined) return 0;
  const n = Number(value);
  return Number.isNaN(n) ? 0 : n;
}

function numOrNull(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const n = Number(value);
  return Number.isNaN(n) ? null : n;
}

function toDateString(value: unknown): string | null {
  if (!value) return null;
  if (value instanceof Date) {
    const y = value.getFullYear();
    const m = String(value.getMonth() + 1).padStart(2, "0");
    const d = String(value.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }
  return String(value).slice(0, 10);
}

function toWarehouse(r: QueryResultRow): ScmWarehouse {
  return {
    id: r.id,
    tenantId: r.tenant_id,
    code: r.code,
    name: r.name,
    siteId: r.site_id,
    organizationUnitId: r.organization_unit_id,
    address: r.address,
    isActive: r.is_active,
    createdAt: r.created_at,
    createdBy: r.created_by,
    updatedAt: r.updated_at,
    updatedBy: r.updated_by,
  };
}

function toWarehouseLocation(r: QueryResultRow): ScmWarehouseLocation {
  return {
    id: r.id,
    tenantId: r.tenant_id,
    warehouseId: r.warehouse_id,
    code: r.code,
    zone: r.zone,
    aisle: r.aisle,
    rack: r.rack,
    shelf: r.shelf,
    bin: r.bin,
    isActive: r.is_active,
    createdAt: r.created_at,
    createdBy: r.created_by,
    updatedAt: r.updated_at,
    updatedBy: r.updated_by,
  };
}

function toItemBatch(r: QueryResultRow): ScmItemBatch {
  return {
    id: r.id,
    tenantId: r.tenant_id,
    itemId: r.item_id,
    batchNumber: r.batch_number,
    manufacturedDate: toDateString(r.manufactured_date),
    expiryDate: toDateString(r.expiry_date),
    supplierId: r.supplier_id,
    notes: r.notes,
    isActive: r.is_active,
    createdAt: r.created_at,
    createdBy: r.created_by,
    updatedAt: r.updated_at,
    updatedBy: r.updated_by,
  };
}

function toItemSerial(r: QueryResultRow): ScmItemSerial {
  return {
    id: r.id,
    tenantId: r.tenant_id,
    itemId: r.item_id,
    serialNumber: r.serial_number,
    batchId: r.batch_id,
    warehouseId: r.warehouse_id,
    locationId: r.location_id,
    status: r.status,
    warrantyExpiryDate: toDateString(r.warranty_expiry_date),
    notes: r.notes,
    createdAt: r.created_at,
    createdBy: r.created_by,
    updatedAt: r.updated_at,
    updatedBy: r.updated_by,
  };
}

function toStockBalance(r: QueryResultRow): ScmAdvancedStockBalance {
  const qty = num(r.quantity);
  const reserved = num(r.reserved_qty);
  return {
    id: r.id,
    tenantId: r.tenant_id,
    itemId: r.item_id,
    warehouseId: r.warehouse_id,
    locationId: r.location_id,
    batchId: r.batch_id,
    quantity: qty,
    reservedQty: reserved,
    onHandQuantity: qty,
    reservedQuantity: reserved,
    availableQuantity: Math.max(0, qty - reserved),
    updatedAt: r.updated_at,
  };
}

function toStockMovement(r: QueryResultRow): ScmAdvancedStockMovement {
  return {
    id: r.id,
    tenantId: r.tenant_id,
    itemId: r.item_id,
    warehouseId: r.warehouse_id,
    locationId: r.location_id,
    batchId: r.batch_id,
    serialId: r.serial_id,
    movementType: r.movement_type,
    quantity: num(r.quantity),
    unitCost: numOrNull(r.unit_cost),
    totalCost: numOrNull(r.total_cost),
    referenceType: r.reference_type,
    referenceId: r.reference_id,
    referenceNumber: r.reference_number,
    notes: r.notes,
    occurredAt: r.occurred_at,
    createdBy: r.created_by,
    createdAt: r.created_at,
  };
}

function toReorderPolicy(r: QueryResultRow): ScmReorderPolicy {
  return {
    id: r.id,
    tenantId: r.tenant_id,
    itemId: r.item_id,
    warehouseId: r.warehouse_id,
    minQuantity: num(r.min_quantity),
    reorderPoint: num(r.reorder_point),
    reorderQuantity: num(r.reorder_quantity),
    safetyStock: num(r.safety_stock),
    leadTimeDays: num(r.lead_time_days),
    isActive: r.is_active,
    createdAt: r.created_at,
    createdBy: r.created_by,
    updatedAt: r.updated_at,
    updatedBy: r.updated_by,
  };
}

function toStockReservation(r: QueryResultRow): ScmStockReservation {
  return {
    id: r.id,
    tenantId: r.tenant_id,
    reservationNumber: r.reservation_number,
    itemId: r.item_id,
    warehouseId: r.warehouse_id,
    locationId: r.location_id,
    batchId: r.batch_id,
    quantity: num(r.quantity),
    reservedForType: r.reserved_for_type,
    reservedForId: r.reserved_for_id,
    reservedForNumber: r.reserved_for_number,
    status: r.status,
    validUntil: r.valid_until,
    fulfilledAt: r.fulfilled_at,
    cancelledAt: r.cancelled_at,
    notes: r.notes,
    createdAt: r.created_at,
    createdBy: r.created_by,
    updatedAt: r.updated_at,
    updatedBy: r.updated_by,
  };
}

function toStockTransfer(r: QueryResultRow): ScmStockTransfer {
  return {
    id: r.id,
    tenantId: r.tenant_id,
    transferNumber: r.transfer_number,
    fromWarehouseId: r.from_warehouse_id,
    toWarehouseId: r.to_warehouse_id,
    status: r.status,
    shippedAt: r.shipped_at,
    receivedAt: r.received_at,
    cancelledAt: r.cancelled_at,
    workflowInstanceId: r.workflow_instance_id,
    notes: r.notes,
    createdAt: r.created_at,
    createdBy: r.created_by,
    updatedAt: r.updated_at,
    updatedBy: r.updated_by,
  };
}

function toStockTransferLine(r: QueryResultRow): ScmStockTransferLine {
  return {
    id: r.id,
    tenantId: r.tenant_id,
    transferId: r.transfer_id,
    itemId: r.item_id,
    fromLocationId: r.from_location_id,
    toLocationId: r.to_location_id,
    batchId: r.batch_id,
    quantityRequested: num(r.quantity_requested),
    quantityShipped: num(r.quantity_shipped),
    quantityReceived: num(r.quantity_received),
    notes: r.notes,
    sortOrder: num(r.sort_order),
  };
}

function toStockOpname(r: QueryResultRow): ScmStockOpname {
  return {
    id: r.id,
    tenantId: r.tenant_id,
    opnameNumber: r.opname_number,
    warehouseId: r.warehouse_id,
    opnameDate: toDateString(r.opname_date)!,
    status: r.status,
    workflowInstanceId: r.workflow_instance_id,
    completedAt: r.completed_at,
    completedBy: r.completed_by,
    notes: r.notes,
    createdAt: r.created_at,
    createdBy: r.created_by,
    updatedAt: r.updated_at,
    updatedBy: r.updated_by,
  };
}

function toStockOpnameLine(r: QueryResultRow): ScmStockOpnameLine {
  return {
    id: r.id,
    tenantId: r.tenant_id,
    opnameId: r.opname_id,
    itemId: r.item_id,
    locationId: r.location_id,
    batchId: r.batch_id,
    systemQuantity: num(r.system_quantity),
    physicalQuantity: numOrNull(r.physical_quantity),
    varianceQuantity: numOrNull(r.variance_quantity),
    adjustmentMovementId: r.adjustment_movement_id,
    notes: r.notes,
    sortOrder: num(r.sort_order),
  };
}

function toValuationLayer(r: QueryResultRow): ScmValuationLayer {
  return {
    id: r.id,
    tenantId: r.tenant_id,
    itemId: r.item_id,
    warehouseId: r.warehouse_id,
    receiptMovementId: r.receipt_movement_id,
    receivedDate: toDateString(r.received_date)!,
    originalQuantity: num(r.original_quantity),
    remainingQuantity: num(r.remaining_quantity),
    unitCost: num(r.unit_cost),
    landedCostAdded: num(r.landed_cost_added),
    effectiveUnitCost: num(r.effective_unit_cost),
    totalValue: num(r.total_value),
    createdAt: r.created_at,
  };
}

function toLandedCost(r: QueryResultRow): ScmLandedCost {
  return {
    id: r.id,
    tenantId: r.tenant_id,
    voucherNumber: r.voucher_number,
    purchaseOrderId: r.purchase_order_id,
    costType: r.cost_type,
    currency: r.currency,
    amount: num(r.amount),
    allocationMethod: r.allocation_method,
    status: r.status,
    appliedAt: r.applied_at,
    notes: r.notes,
    createdAt: r.created_at,
    createdBy: r.created_by,
    updatedAt: r.updated_at,
    updatedBy: r.updated_by,
  };
}

function toLandedCostAllocation(r: QueryResultRow): ScmLandedCostAllocation {
  return {
    id: r.id,
    tenantId: r.tenant_id,
    landedCostId: r.landed_cost_id,
    itemId: r.item_id,
    valuationLayerId: r.valuation_layer_id,
    allocatedAmount: num(r.allocated_amount),
    costPerUnitAdded: num(r.cost_per_unit_added),
  };
}

function toRfq(r: QueryResultRow): ScmRfq {
  return {
    id: r.id,
    tenantId: r.tenant_id,
    rfqNumber: r.rfq_number,
    title: r.title,
    procurementType: r.procurement_type,
    organizationUnitId: r.organization_unit_id,
    purchaseRequestId: r.purchase_request_id,
    submissionDeadline: r.submission_deadline,
    status: r.status,
    workflowInstanceId: r.workflow_instance_id,
    awardedAt: r.awarded_at,
    cancelledAt: r.cancelled_at,
    notes: r.notes,
    createdAt: r.created_at,
    createdBy: r.created_by,
    updatedAt: r.updated_at,
    updatedBy: r.updated_by,
  };
}

function toRfqItem(r: QueryResultRow): ScmRfqItem {
  return {
    id: r.id,
    tenantId: r.tenant_id,
    rfqId: r.rfq_id,
    itemId: r.item_id,
    targetQuantity: num(r.target_quantity),
    targetUnitPrice: numOrNull(r.target_unit_price),
    specifications: r.specifications,
    sortOrder: num(r.sort_order),
  };
}

function toRfqInvitedSupplier(r: QueryResultRow): ScmRfqInvitedSupplier {
  return {
    id: r.id,
    tenantId: r.tenant_id,
    rfqId: r.rfq_id,
    supplierId: r.supplier_id,
    invitedAt: r.invited_at,
    respondedAt: r.responded_at,
  };
}

function toSupplierBid(r: QueryResultRow): ScmSupplierBid {
  return {
    id: r.id,
    tenantId: r.tenant_id,
    bidNumber: r.bid_number,
    rfqId: r.rfq_id,
    supplierId: r.supplier_id,
    submittedAt: r.submitted_at,
    currency: r.currency,
    totalAmount: num(r.total_amount),
    leadTimeDays: num(r.lead_time_days),
    validUntil: toDateString(r.valid_until),
    status: r.status,
    technicalScore: numOrNull(r.technical_score),
    commercialScore: numOrNull(r.commercial_score),
    finalScore: numOrNull(r.final_score),
    rank: numOrNull(r.rank),
    isWinningBid: r.is_winning_bid,
    resultingPurchaseOrderId: r.resulting_po_id,
    notes: r.notes,
    createdAt: r.created_at,
    createdBy: r.created_by,
    updatedAt: r.updated_at,
    updatedBy: r.updated_by,
  };
}

function toSupplierBidLine(r: QueryResultRow): ScmSupplierBidLine {
  return {
    id: r.id,
    tenantId: r.tenant_id,
    bidId: r.bid_id,
    rfqItemId: r.rfq_item_id,
    offeredQuantity: num(r.offered_quantity),
    offeredUnitPrice: num(r.offered_unit_price),
    offeredTotalPrice: num(r.offered_total_price),
    remarks: r.remarks,
  };
}

function toSupplierEvaluation(r: QueryResultRow): ScmSupplierEvaluation {
  return {
    id: r.id,
    tenantId: r.tenant_id,
    evaluationNumber: r.evaluation_number,
    supplierId: r.supplier_id,
    evaluationPeriod: r.evaluation_period,
    periodStartDate: toDateString(r.period_start_date)!,
    periodEndDate: toDateString(r.period_end_date)!,
    qualityScore: num(r.quality_score),
    deliveryScore: num(r.delivery_score),
    pricingScore: num(r.pricing_score),
    serviceScore: num(r.service_score),
    overallScore: num(r.overall_score),
    ratingGrade: r.rating_grade,
    status: r.status,
    workflowInstanceId: r.workflow_instance_id,
    notes: r.notes,
    evaluatedBy: r.evaluated_by,
    evaluatedAt: r.evaluated_at,
    createdAt: r.created_at,
    createdBy: r.created_by,
    updatedAt: r.updated_at,
    updatedBy: r.updated_by,
  };
}

function toSupplierContract(r: QueryResultRow): ScmSupplierContract {
  return {
    id: r.id,
    tenantId: r.tenant_id,
    contractNumber: r.contract_number,
    supplierId: r.supplier_id,
    title: r.title,
    contractType: r.contract_type,
    startDate: toDateString(r.start_date)!,
    endDate: toDateString(r.end_date)!,
    currency: r.currency,
    committedAmount: num(r.committed_amount),
    spentAmount: num(r.spent_amount),
    status: r.status,
    workflowInstanceId: r.workflow_instance_id,
    termsAndConditions: r.terms_and_conditions,
    approvedAt: r.approved_at,
    closedAt: r.closed_at,
    createdAt: r.created_at,
    createdBy: r.created_by,
    updatedAt: r.updated_at,
    updatedBy: r.updated_by,
  };
}

function toSupplierContractItem(r: QueryResultRow): ScmSupplierContractItem {
  return {
    id: r.id,
    tenantId: r.tenant_id,
    contractId: r.contract_id,
    itemId: r.item_id,
    agreedUnitPrice: num(r.agreed_unit_price),
    minOrderQuantity: num(r.min_order_quantity),
    maxOrderQuantity: numOrNull(r.max_order_quantity),
    leadTimeDays: num(r.lead_time_days),
    notes: r.notes,
  };
}

function toSpendAnalyticsSnapshot(r: QueryResultRow): ScmSpendAnalyticsSnapshot {
  return {
    id: r.id,
    tenantId: r.tenant_id,
    snapshotDate: toDateString(r.snapshot_date)!,
    periodType: r.period_type,
    periodKey: r.period_key,
    organizationUnitId: r.organization_unit_id,
    supplierId: r.supplier_id,
    itemCategory: r.item_category,
    totalSpend: num(r.total_spend),
    poCount: num(r.po_count),
    itemsPurchasedCount: num(r.items_purchased_count),
    avgPoValue: num(r.avg_po_value),
    createdAt: r.created_at,
    createdBy: r.created_by,
  };
}
