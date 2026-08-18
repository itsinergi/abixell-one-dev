import type { Pool } from "pg";
import type {
  CreateOrganizationUnitInput,
  OrganizationUnit,
  OrganizationUnitRepository,
} from "../../../domain/organization-unit/organization-unit.entity.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapRow(row: any): OrganizationUnit {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    legalEntityId: row.legal_entity_id,
    parentId: row.parent_id,
    name: row.name,
    unitType: row.unit_type,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class PgOrganizationUnitRepository implements OrganizationUnitRepository {
  constructor(private readonly pool: Pool) {}

  async create(
    input: CreateOrganizationUnitInput,
    createdBy: string | null,
  ): Promise<OrganizationUnit> {
    const result = await this.pool.query(
      `INSERT INTO organization_units
         (tenant_id, legal_entity_id, parent_id, name, unit_type, created_by, updated_by)
       VALUES ($1, $2, $3, $4, $5, $6, $6)
       RETURNING *`,
      [
        input.tenantId,
        input.legalEntityId,
        input.parentId ?? null,
        input.name,
        input.unitType ?? "Organization Unit",
        createdBy,
      ],
    );
    return mapRow(result.rows[0]);
  }

  async findById(id: string): Promise<OrganizationUnit | null> {
    const result = await this.pool.query(
      `SELECT * FROM organization_units WHERE id = $1 AND deleted_at IS NULL`,
      [id],
    );
    return result.rows[0] ? mapRow(result.rows[0]) : null;
  }

  async listByTenant(tenantId: string): Promise<OrganizationUnit[]> {
    const result = await this.pool.query(
      `SELECT * FROM organization_units WHERE tenant_id = $1 AND deleted_at IS NULL ORDER BY created_at ASC`,
      [tenantId],
    );
    return result.rows.map(mapRow);
  }
}
