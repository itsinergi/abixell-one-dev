import type { Pool, PoolClient, QueryResultRow } from "pg";
import type {
  Asset,
  AssetListFilter,
  AssetMovement,
  AssetPlacementChange,
  AssetRepository,
  AssetStatus,
  CreateAssetInput,
  CustodianReference,
  RecordMovementInput,
  UpdateAssetInput,
} from "../domain/asset.entity.js";
import { isTerminalAssetStatus } from "../domain/asset.entity.js";

/**
 * Asset Core persistence (Phase 5).
 *
 * The whole point of this file is that **current state can never contradict
 * history**. Every applied movement locks the asset row, snapshots the real
 * previous placement, writes the new one, and takes the resulting version as
 * its ledger sequence — in one transaction. A unique index on
 * `(asset_id, sequence)` makes a lost update impossible at the database
 * level rather than by convention.
 */
export class PgAssetRepository implements AssetRepository {
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

  // --- Asset master -----------------------------------------------------

  async createAsset(input: CreateAssetInput): Promise<Asset> {
    const r = await this.pool.query(
      `INSERT INTO assets
         (tenant_id, asset_number, asset_tag, name, description, category, status,
          organization_unit_id, custodian_employee_id, project_id, site_id, location_detail,
          acquisition_reference, acquired_at, retired_at, created_by, updated_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,
               CASE WHEN $7 IN ('retired','disposed') THEN now() ELSE NULL END, $15, $15)
       RETURNING *`,
      [
        input.tenantId,
        input.assetNumber,
        input.assetTag,
        input.name,
        input.description,
        input.category,
        input.status,
        input.organizationUnitId,
        input.custodianEmployeeId,
        input.projectId,
        input.siteId,
        input.locationDetail,
        input.acquisitionReference,
        input.acquiredAt,
        input.createdBy,
      ],
    );
    return toAsset(r.rows[0]);
  }

  async findAssetById(id: string): Promise<Asset | null> {
    const r = await this.pool.query(`SELECT * FROM assets WHERE id = $1`, [id]);
    return r.rows[0] ? toAsset(r.rows[0]) : null;
  }

  async findAssetByNumber(tenantId: string, assetNumber: string): Promise<Asset | null> {
    const r = await this.pool.query(`SELECT * FROM assets WHERE tenant_id = $1 AND asset_number = $2`, [
      tenantId,
      assetNumber,
    ]);
    return r.rows[0] ? toAsset(r.rows[0]) : null;
  }

  async findAssetByTag(tenantId: string, assetTag: string): Promise<Asset | null> {
    const r = await this.pool.query(`SELECT * FROM assets WHERE tenant_id = $1 AND asset_tag = $2`, [
      tenantId,
      assetTag,
    ]);
    return r.rows[0] ? toAsset(r.rows[0]) : null;
  }

  async listAssets(tenantId: string, filter: AssetListFilter): Promise<Asset[]> {
    const conditions = [`tenant_id = $1`];
    const params: unknown[] = [tenantId];
    const add = (sql: (i: number) => string, value: unknown) => {
      params.push(value);
      conditions.push(sql(params.length));
    };
    if (filter.search) {
      add(
        (i) => `(name ILIKE $${i} OR asset_number ILIKE $${i} OR asset_tag ILIKE $${i})`,
        `%${filter.search}%`,
      );
    }
    if (filter.category) add((i) => `category = $${i}`, filter.category);
    if (filter.status) add((i) => `status = $${i}`, filter.status);
    if (filter.organizationUnitId) add((i) => `organization_unit_id = $${i}`, filter.organizationUnitId);
    if (filter.siteId) add((i) => `site_id = $${i}`, filter.siteId);
    if (filter.custodianEmployeeId) add((i) => `custodian_employee_id = $${i}`, filter.custodianEmployeeId);
    if (!filter.includeTerminal && !filter.status) {
      conditions.push(`status NOT IN ('retired', 'disposed')`);
    }
    const r = await this.pool.query(
      `SELECT * FROM assets WHERE ${conditions.join(" AND ")} ORDER BY asset_number`,
      params,
    );
    return r.rows.map(toAsset);
  }

  /** Descriptive fields only — placement and status are never editable here,
   * so no change can bypass the movement ledger. */
  async updateAsset(id: string, input: UpdateAssetInput, updatedBy: string | null): Promise<Asset | null> {
    const r = await this.pool.query(
      `UPDATE assets
          SET asset_tag = CASE WHEN $2::boolean THEN $3 ELSE asset_tag END,
              name = COALESCE($4, name),
              description = CASE WHEN $5::boolean THEN $6 ELSE description END,
              category = CASE WHEN $7::boolean THEN $8 ELSE category END,
              acquisition_reference = CASE WHEN $9::boolean THEN $10 ELSE acquisition_reference END,
              acquired_at = CASE WHEN $11::boolean THEN $12::date ELSE acquired_at END,
              updated_by = $13, updated_at = now()
        WHERE id = $1
        RETURNING *`,
      [
        id,
        input.assetTag !== undefined,
        input.assetTag ?? null,
        input.name ?? null,
        input.description !== undefined,
        input.description ?? null,
        input.category !== undefined,
        input.category ?? null,
        input.acquisitionReference !== undefined,
        input.acquisitionReference ?? null,
        input.acquiredAt !== undefined,
        input.acquiredAt ?? null,
        updatedBy,
      ],
    );
    return r.rows[0] ? toAsset(r.rows[0]) : null;
  }

  // --- Movement ledger --------------------------------------------------

  async recordAndApplyMovement(
    input: RecordMovementInput,
  ): Promise<{ asset: Asset; movement: AssetMovement } | null> {
    return this.inTransaction(async (client) => {
      const current = await lockAsset(client, input.tenantId, input.assetId);
      // Terminal assets never move again. Checked under the row lock so a
      // concurrent retirement cannot slip a movement past it.
      if (!current || isTerminalAssetStatus(current.status)) return null;

      const target = resolveTarget(current, input.change);
      const asset = await applyToAsset(client, current, target, input.requestedByUserId);

      const m = await client.query(
        `INSERT INTO asset_movements
           (tenant_id, asset_id, sequence, movement_type, reason, effective_date, requested_change,
            from_organization_unit_id, from_custodian_employee_id, from_project_id, from_site_id,
            from_location_detail, from_status,
            to_organization_unit_id, to_custodian_employee_id, to_project_id, to_site_id,
            to_location_detail, to_status,
            workflow_instance_id, requested_by_user_id, applied_at, applied_by_user_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,
                 $8,$9,$10,$11,$12,$13,
                 $14,$15,$16,$17,$18,$19,
                 NULL,$20, now(), $20)
         RETURNING *`,
        [
          input.tenantId,
          input.assetId,
          asset.version,
          input.movementType,
          input.reason,
          input.effectiveDate,
          JSON.stringify(input.change),
          current.organizationUnitId,
          current.custodianEmployeeId,
          current.projectId,
          current.siteId,
          current.locationDetail,
          current.status,
          target.organizationUnitId,
          target.custodianEmployeeId,
          target.projectId,
          target.siteId,
          target.locationDetail,
          target.status,
          input.requestedByUserId,
        ],
      );
      return { asset, movement: toMovement(m.rows[0]) };
    });
  }

  async recordPendingMovement(input: RecordMovementInput): Promise<AssetMovement | null> {
    return this.inTransaction(async (client) => {
      const current = await lockAsset(client, input.tenantId, input.assetId);
      if (!current || isTerminalAssetStatus(current.status)) return null;

      const m = await client.query(
        `INSERT INTO asset_movements
           (tenant_id, asset_id, movement_type, reason, effective_date, requested_change, requested_by_user_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7)
         RETURNING *`,
        [
          input.tenantId,
          input.assetId,
          input.movementType,
          input.reason,
          input.effectiveDate,
          JSON.stringify(input.change),
          input.requestedByUserId,
        ],
      );
      return toMovement(m.rows[0]);
    });
  }

  /**
   * Completes a pending movement. This is not a mutation of history: the
   * resolved snapshot columns and `applied_at` move from NULL to their one
   * and only value, guarded by `applied_at IS NULL`.
   */
  async applyPendingMovement(
    movementId: string,
    appliedBy: string | null,
  ): Promise<{ asset: Asset; movement: AssetMovement } | null> {
    return this.inTransaction(async (client) => {
      const pending = await client.query(
        `SELECT * FROM asset_movements WHERE id = $1 FOR UPDATE`,
        [movementId],
      );
      if (!pending.rows[0]) return null;
      const movement = toMovement(pending.rows[0]);
      if (movement.appliedAt) return null;

      const current = await lockAsset(client, movement.tenantId, movement.assetId);
      if (!current || isTerminalAssetStatus(current.status)) return null;

      const target = resolveTarget(current, movement.requestedChange);
      const asset = await applyToAsset(client, current, target, appliedBy);

      const updated = await client.query(
        `UPDATE asset_movements
            SET sequence = $2,
                from_organization_unit_id = $3, from_custodian_employee_id = $4,
                from_project_id = $5, from_site_id = $6,
                from_location_detail = $7, from_status = $8,
                to_organization_unit_id = $9, to_custodian_employee_id = $10,
                to_project_id = $11, to_site_id = $12,
                to_location_detail = $13, to_status = $14,
                applied_at = now(), applied_by_user_id = $15
          WHERE id = $1 AND applied_at IS NULL
          RETURNING *`,
        [
          movementId,
          asset.version,
          current.organizationUnitId,
          current.custodianEmployeeId,
          current.projectId,
          current.siteId,
          current.locationDetail,
          current.status,
          target.organizationUnitId,
          target.custodianEmployeeId,
          target.projectId,
          target.siteId,
          target.locationDetail,
          target.status,
          appliedBy,
        ],
      );
      // Someone else applied it between the lock and here: roll everything
      // back rather than leave the asset ahead of its ledger.
      if (!updated.rows[0]) return null;
      return { asset, movement: toMovement(updated.rows[0]) };
    });
  }

  async findMovementById(id: string): Promise<AssetMovement | null> {
    const r = await this.pool.query(`SELECT * FROM asset_movements WHERE id = $1`, [id]);
    return r.rows[0] ? toMovement(r.rows[0]) : null;
  }

  async listMovements(assetId: string): Promise<AssetMovement[]> {
    const r = await this.pool.query(
      `SELECT * FROM asset_movements
        WHERE asset_id = $1
        ORDER BY sequence NULLS LAST, created_at`,
      [assetId],
    );
    return r.rows.map(toMovement);
  }

  async findPendingMovementForAsset(assetId: string): Promise<AssetMovement | null> {
    const r = await this.pool.query(
      `SELECT * FROM asset_movements
        WHERE asset_id = $1 AND applied_at IS NULL AND workflow_instance_id IS NOT NULL
        ORDER BY created_at DESC
        LIMIT 1`,
      [assetId],
    );
    return r.rows[0] ? toMovement(r.rows[0]) : null;
  }

  async setMovementWorkflowInstance(id: string, workflowInstanceId: string): Promise<void> {
    await this.pool.query(`UPDATE asset_movements SET workflow_instance_id = $2 WHERE id = $1`, [
      id,
      workflowInstanceId,
    ]);
  }

  // --- Cross-domain reads kept behind this port -------------------------

  async organizationUnitExists(tenantId: string, organizationUnitId: string): Promise<boolean> {
    const r = await this.pool.query(
      `SELECT 1 FROM organization_units WHERE id = $1 AND tenant_id = $2`,
      [organizationUnitId, tenantId],
    );
    return r.rowCount! > 0;
  }

  async projectExists(tenantId: string, projectId: string): Promise<boolean> {
    const r = await this.pool.query(`SELECT 1 FROM projects WHERE id = $1 AND tenant_id = $2`, [
      projectId,
      tenantId,
    ]);
    return r.rowCount! > 0;
  }

  async siteExists(tenantId: string, siteId: string): Promise<boolean> {
    const r = await this.pool.query(`SELECT 1 FROM sites WHERE id = $1 AND tenant_id = $2`, [siteId, tenantId]);
    return r.rowCount! > 0;
  }

  /** Three identifying columns and nothing else — see the port docs. */
  async findCustodianReference(tenantId: string, employeeId: string): Promise<CustodianReference | null> {
    const r = await this.pool.query(
      `SELECT id, employee_number, full_name FROM employees WHERE id = $1 AND tenant_id = $2`,
      [employeeId, tenantId],
    );
    return r.rows[0] ? toCustodian(r.rows[0]) : null;
  }

  /** Batched so an asset list never issues one custodian query per row. */
  async listCustodianReferences(tenantId: string, employeeIds: string[]): Promise<CustodianReference[]> {
    if (employeeIds.length === 0) return [];
    const r = await this.pool.query(
      `SELECT id, employee_number, full_name FROM employees WHERE tenant_id = $1 AND id = ANY($2::uuid[])`,
      [tenantId, employeeIds],
    );
    return r.rows.map(toCustodian);
  }
}

// ---------------------------------------------------------------------------
// Transactional helpers
// ---------------------------------------------------------------------------

/** Serialises concurrent movements on one asset. The second transaction
 * waits, then reads the state the first one committed — so its history row
 * chains onto the first instead of overwriting it. */
async function lockAsset(client: PoolClient, tenantId: string, assetId: string): Promise<Asset | null> {
  const r = await client.query(`SELECT * FROM assets WHERE id = $1 AND tenant_id = $2 FOR UPDATE`, [
    assetId,
    tenantId,
  ]);
  return r.rows[0] ? toAsset(r.rows[0]) : null;
}

interface ResolvedPlacement {
  organizationUnitId: string | null;
  custodianEmployeeId: string | null;
  projectId: string | null;
  siteId: string | null;
  locationDetail: string | null;
  status: AssetStatus;
}

/** An absent key keeps the current value; an explicit null clears it. */
function resolveTarget(current: Asset, change: AssetPlacementChange): ResolvedPlacement {
  const pick = <T>(key: keyof AssetPlacementChange, fallback: T): T =>
    key in change ? ((change[key] ?? null) as T) : fallback;
  return {
    organizationUnitId: pick("organizationUnitId", current.organizationUnitId),
    custodianEmployeeId: pick("custodianEmployeeId", current.custodianEmployeeId),
    projectId: pick("projectId", current.projectId),
    siteId: pick("siteId", current.siteId),
    locationDetail: pick("locationDetail", current.locationDetail),
    status: change.status ?? current.status,
  };
}

/** Guarded on the version we just read: the ledger sequence and the asset
 * version advance together or not at all. */
async function applyToAsset(
  client: PoolClient,
  current: Asset,
  target: ResolvedPlacement,
  actorUserId: string | null,
): Promise<Asset> {
  const r = await client.query(
    `UPDATE assets
        SET organization_unit_id = $3, custodian_employee_id = $4,
            project_id = $5, site_id = $6, location_detail = $7, status = $8,
            retired_at = CASE
              WHEN $8 IN ('retired','disposed') AND retired_at IS NULL THEN now()
              ELSE retired_at END,
            version = version + 1,
            updated_by = $9, updated_at = now()
      WHERE id = $1 AND version = $2
      RETURNING *`,
    [
      current.id,
      current.version,
      target.organizationUnitId,
      target.custodianEmployeeId,
      target.projectId,
      target.siteId,
      target.locationDetail,
      target.status,
      actorUserId,
    ],
  );
  if (!r.rows[0]) {
    // Unreachable while the row lock above is held; loud rather than silent
    // if that ever stops being true.
    throw new Error("Asset version guard failed — concurrent modification");
  }
  return toAsset(r.rows[0]);
}

// ---------------------------------------------------------------------------
// Row mapping
// ---------------------------------------------------------------------------

/** pg returns a `date` column as a Date at LOCAL midnight; converting via
 * toISOString() would shift it a day for negative UTC offsets. Read the
 * local components instead (the Phase 3 calendar-date lesson). */
function toDateString(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) {
    const y = value.getFullYear();
    const m = String(value.getMonth() + 1).padStart(2, "0");
    const d = String(value.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }
  return String(value).slice(0, 10);
}

function toAsset(row: QueryResultRow): Asset {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    assetNumber: row.asset_number,
    assetTag: row.asset_tag,
    name: row.name,
    description: row.description,
    category: row.category,
    status: row.status as AssetStatus,
    organizationUnitId: row.organization_unit_id,
    custodianEmployeeId: row.custodian_employee_id,
    projectId: row.project_id,
    siteId: row.site_id,
    locationDetail: row.location_detail,
    acquisitionReference: row.acquisition_reference,
    acquiredAt: toDateString(row.acquired_at),
    version: Number(row.version),
    retiredAt: row.retired_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toMovement(row: QueryResultRow): AssetMovement {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    assetId: row.asset_id,
    sequence: row.sequence === null ? null : Number(row.sequence),
    movementType: row.movement_type,
    reason: row.reason,
    effectiveDate: toDateString(row.effective_date),
    requestedChange: (row.requested_change ?? {}) as AssetPlacementChange,
    fromOrganizationUnitId: row.from_organization_unit_id,
    fromCustodianEmployeeId: row.from_custodian_employee_id,
    fromProjectId: row.from_project_id,
    fromSiteId: row.from_site_id,
    fromLocationDetail: row.from_location_detail,
    fromStatus: row.from_status,
    toOrganizationUnitId: row.to_organization_unit_id,
    toCustodianEmployeeId: row.to_custodian_employee_id,
    toProjectId: row.to_project_id,
    toSiteId: row.to_site_id,
    toLocationDetail: row.to_location_detail,
    toStatus: row.to_status,
    workflowInstanceId: row.workflow_instance_id,
    requestedByUserId: row.requested_by_user_id,
    appliedAt: row.applied_at,
    appliedByUserId: row.applied_by_user_id,
    createdAt: row.created_at,
  };
}

function toCustodian(row: QueryResultRow): CustodianReference {
  return { id: row.id, employeeNumber: row.employee_number, fullName: row.full_name };
}
