import type { Pool } from "pg";
import type {
  CreateLegalEntityInput,
  LegalEntity,
  LegalEntityRepository,
} from "../../../domain/legal-entity/legal-entity.entity.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapRow(row: any): LegalEntity {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    name: row.name,
    registrationNo: row.registration_no,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class PgLegalEntityRepository implements LegalEntityRepository {
  constructor(private readonly pool: Pool) {}

  async create(
    input: CreateLegalEntityInput,
    createdBy: string | null,
  ): Promise<LegalEntity> {
    const result = await this.pool.query(
      `INSERT INTO legal_entities (tenant_id, name, registration_no, created_by, updated_by)
       VALUES ($1, $2, $3, $4, $4)
       RETURNING *`,
      [input.tenantId, input.name, input.registrationNo ?? null, createdBy],
    );
    return mapRow(result.rows[0]);
  }

  async findById(id: string): Promise<LegalEntity | null> {
    const result = await this.pool.query(
      `SELECT * FROM legal_entities WHERE id = $1 AND deleted_at IS NULL`,
      [id],
    );
    return result.rows[0] ? mapRow(result.rows[0]) : null;
  }

  async listByTenant(tenantId: string): Promise<LegalEntity[]> {
    const result = await this.pool.query(
      `SELECT * FROM legal_entities WHERE tenant_id = $1 AND deleted_at IS NULL ORDER BY created_at ASC`,
      [tenantId],
    );
    return result.rows.map(mapRow);
  }
}
