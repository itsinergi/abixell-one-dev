import type { Pool } from "pg";
import type {
  CreateProjectInput,
  Project,
  ProjectRepository,
} from "../../../domain/customer/project.entity.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapRow(row: any): Project {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    customerId: row.customer_id,
    contractId: row.contract_id,
    code: row.code,
    name: row.name,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class PgProjectRepository implements ProjectRepository {
  constructor(private readonly pool: Pool) {}

  async create(input: CreateProjectInput, createdBy: string | null): Promise<Project> {
    const result = await this.pool.query(
      `INSERT INTO projects
         (tenant_id, customer_id, contract_id, code, name, status, created_by, updated_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $7)
       RETURNING *`,
      [
        input.tenantId,
        input.customerId,
        input.contractId ?? null,
        input.code,
        input.name,
        input.status ?? "active",
        createdBy,
      ],
    );
    return mapRow(result.rows[0]);
  }

  async findById(id: string): Promise<Project | null> {
    const result = await this.pool.query(
      `SELECT * FROM projects WHERE id = $1 AND deleted_at IS NULL`,
      [id],
    );
    return result.rows[0] ? mapRow(result.rows[0]) : null;
  }

  async listByCustomer(customerId: string): Promise<Project[]> {
    const result = await this.pool.query(
      `SELECT * FROM projects WHERE customer_id = $1 AND deleted_at IS NULL ORDER BY created_at ASC`,
      [customerId],
    );
    return result.rows.map(mapRow);
  }
}
