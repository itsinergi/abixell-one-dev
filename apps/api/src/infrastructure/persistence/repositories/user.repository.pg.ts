import type { Pool } from "pg";
import type {
  CreateUserInput,
  User,
  UserRepository,
  UserWithPasswordHash,
} from "../../../domain/identity/user.entity.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapRow(row: any): User {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    email: row.email,
    fullName: row.full_name,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class PgUserRepository implements UserRepository {
  constructor(private readonly pool: Pool) {}

  async create(input: CreateUserInput, createdBy: string | null): Promise<User> {
    const result = await this.pool.query(
      `INSERT INTO users (tenant_id, email, password_hash, full_name, created_by, updated_by)
       VALUES ($1, $2, $3, $4, $5, $5)
       RETURNING *`,
      [input.tenantId, input.email.toLowerCase(), input.passwordHash, input.fullName, createdBy],
    );
    return mapRow(result.rows[0]);
  }

  async findById(id: string): Promise<User | null> {
    const result = await this.pool.query(
      `SELECT * FROM users WHERE id = $1 AND deleted_at IS NULL`,
      [id],
    );
    return result.rows[0] ? mapRow(result.rows[0]) : null;
  }

  async findByEmailInTenant(
    tenantId: string,
    email: string,
  ): Promise<UserWithPasswordHash | null> {
    const result = await this.pool.query(
      `SELECT * FROM users WHERE tenant_id = $1 AND email = $2 AND deleted_at IS NULL`,
      [tenantId, email.toLowerCase()],
    );
    if (!result.rows[0]) return null;
    return { ...mapRow(result.rows[0]), passwordHash: result.rows[0].password_hash };
  }

  async listByTenant(tenantId: string): Promise<User[]> {
    const result = await this.pool.query(
      `SELECT * FROM users WHERE tenant_id = $1 AND deleted_at IS NULL ORDER BY created_at ASC`,
      [tenantId],
    );
    return result.rows.map(mapRow);
  }
}
