import type { Pool } from "pg";
import type {
  CreateCustomerContactInput,
  CreateCustomerInput,
  Customer,
  CustomerContact,
  CustomerContactRepository,
  CustomerRepository,
} from "../../../domain/customer/customer.entity.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapCustomer(row: any): Customer {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    code: row.code,
    name: row.name,
    status: row.status,
    ownerOrganizationUnitId: row.owner_organization_unit_id,
    notes: row.notes,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class PgCustomerRepository implements CustomerRepository {
  constructor(private readonly pool: Pool) {}

  async create(input: CreateCustomerInput, createdBy: string | null): Promise<Customer> {
    const result = await this.pool.query(
      `INSERT INTO customers
         (tenant_id, code, name, status, owner_organization_unit_id, notes, created_by, updated_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $7)
       RETURNING *`,
      [
        input.tenantId,
        input.code,
        input.name,
        input.status ?? "active",
        input.ownerOrganizationUnitId ?? null,
        input.notes ?? null,
        createdBy,
      ],
    );
    return mapCustomer(result.rows[0]);
  }

  async findById(id: string): Promise<Customer | null> {
    const result = await this.pool.query(
      `SELECT * FROM customers WHERE id = $1 AND deleted_at IS NULL`,
      [id],
    );
    return result.rows[0] ? mapCustomer(result.rows[0]) : null;
  }

  async listByTenant(tenantId: string): Promise<Customer[]> {
    const result = await this.pool.query(
      `SELECT * FROM customers WHERE tenant_id = $1 AND deleted_at IS NULL ORDER BY created_at ASC`,
      [tenantId],
    );
    return result.rows.map(mapCustomer);
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapContact(row: any): CustomerContact {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    customerId: row.customer_id,
    name: row.name,
    email: row.email,
    phone: row.phone,
    isPrimary: row.is_primary,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class PgCustomerContactRepository implements CustomerContactRepository {
  constructor(private readonly pool: Pool) {}

  async create(
    input: CreateCustomerContactInput,
    createdBy: string | null,
  ): Promise<CustomerContact> {
    const result = await this.pool.query(
      `INSERT INTO customer_contacts
         (tenant_id, customer_id, name, email, phone, is_primary, created_by, updated_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $7)
       RETURNING *`,
      [
        input.tenantId,
        input.customerId,
        input.name,
        input.email ?? null,
        input.phone ?? null,
        input.isPrimary ?? false,
        createdBy,
      ],
    );
    return mapContact(result.rows[0]);
  }

  async listByCustomer(customerId: string): Promise<CustomerContact[]> {
    const result = await this.pool.query(
      `SELECT * FROM customer_contacts WHERE customer_id = $1 AND deleted_at IS NULL ORDER BY created_at ASC`,
      [customerId],
    );
    return result.rows.map(mapContact);
  }
}
