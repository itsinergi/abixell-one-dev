import type { Pool } from "pg";
import type {
  CreateTenantInput,
  Tenant,
  TenantRepository,
} from "../../../domain/tenant/tenant.entity.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapRow(row: any): Tenant {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class PgTenantRepository implements TenantRepository {
  constructor(private readonly pool: Pool) {}

  async create(input: CreateTenantInput, createdBy: string | null): Promise<Tenant> {
    const result = await this.pool.query(
      `INSERT INTO tenants (code, name, created_by, updated_by)
       VALUES ($1, $2, $3, $3)
       RETURNING *`,
      [input.code, input.name, createdBy],
    );
    return mapRow(result.rows[0]);
  }

  async findById(id: string): Promise<Tenant | null> {
    const result = await this.pool.query(
      `SELECT * FROM tenants WHERE id = $1 AND deleted_at IS NULL`,
      [id],
    );
    return result.rows[0] ? mapRow(result.rows[0]) : null;
  }

  async findByCode(code: string): Promise<Tenant | null> {
    const result = await this.pool.query(
      `SELECT * FROM tenants WHERE code = $1 AND deleted_at IS NULL`,
      [code],
    );
    return result.rows[0] ? mapRow(result.rows[0]) : null;
  }

  async list(): Promise<Tenant[]> {
    const result = await this.pool.query(
      `SELECT * FROM tenants WHERE deleted_at IS NULL ORDER BY created_at ASC`,
    );
    return result.rows.map(mapRow);
  }
}
