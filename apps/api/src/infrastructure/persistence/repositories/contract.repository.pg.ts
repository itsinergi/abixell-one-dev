import type { Pool } from "pg";
import type {
  Contract,
  ContractRepository,
  CreateContractInput,
} from "../../../domain/customer/contract.entity.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapRow(row: any): Contract {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    customerId: row.customer_id,
    code: row.code,
    name: row.name,
    startDate: row.start_date,
    endDate: row.end_date,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class PgContractRepository implements ContractRepository {
  constructor(private readonly pool: Pool) {}

  async create(input: CreateContractInput, createdBy: string | null): Promise<Contract> {
    const result = await this.pool.query(
      `INSERT INTO contracts
         (tenant_id, customer_id, code, name, start_date, end_date, status, created_by, updated_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $8)
       RETURNING *`,
      [
        input.tenantId,
        input.customerId,
        input.code,
        input.name,
        input.startDate ?? null,
        input.endDate ?? null,
        input.status ?? "active",
        createdBy,
      ],
    );
    return mapRow(result.rows[0]);
  }

  async findById(id: string): Promise<Contract | null> {
    const result = await this.pool.query(
      `SELECT * FROM contracts WHERE id = $1 AND deleted_at IS NULL`,
      [id],
    );
    return result.rows[0] ? mapRow(result.rows[0]) : null;
  }

  async listByCustomer(customerId: string): Promise<Contract[]> {
    const result = await this.pool.query(
      `SELECT * FROM contracts WHERE customer_id = $1 AND deleted_at IS NULL ORDER BY created_at ASC`,
      [customerId],
    );
    return result.rows.map(mapRow);
  }
}
