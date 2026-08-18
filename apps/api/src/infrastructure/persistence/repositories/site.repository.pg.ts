import type { Pool } from "pg";
import type { CreateSiteInput, Site, SiteRepository } from "../../../domain/customer/site.entity.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapRow(row: any): Site {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    customerId: row.customer_id,
    projectId: row.project_id,
    code: row.code,
    name: row.name,
    address: row.address,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class PgSiteRepository implements SiteRepository {
  constructor(private readonly pool: Pool) {}

  async create(input: CreateSiteInput, createdBy: string | null): Promise<Site> {
    const result = await this.pool.query(
      `INSERT INTO sites
         (tenant_id, customer_id, project_id, code, name, address, status, created_by, updated_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $8)
       RETURNING *`,
      [
        input.tenantId,
        input.customerId,
        input.projectId ?? null,
        input.code,
        input.name,
        input.address ?? null,
        input.status ?? "active",
        createdBy,
      ],
    );
    return mapRow(result.rows[0]);
  }

  async findById(id: string): Promise<Site | null> {
    const result = await this.pool.query(`SELECT * FROM sites WHERE id = $1 AND deleted_at IS NULL`, [
      id,
    ]);
    return result.rows[0] ? mapRow(result.rows[0]) : null;
  }

  async listByCustomer(customerId: string): Promise<Site[]> {
    const result = await this.pool.query(
      `SELECT * FROM sites WHERE customer_id = $1 AND deleted_at IS NULL ORDER BY created_at ASC`,
      [customerId],
    );
    return result.rows.map(mapRow);
  }
}
