import type { Pool } from "pg";
import type {
  CreateCustomerServiceLinkInput,
  CreateServiceInput,
  CustomerServiceLink,
  CustomerServiceLinkRepository,
  Service,
  ServiceRepository,
  UpdateCustomerServiceLinkInput,
  UpdateServiceInput,
} from "../../../domain/customer/service.entity.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapService(row: any): Service {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    code: row.code,
    name: row.name,
    description: row.description,
    isActive: row.is_active,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class PgServiceRepository implements ServiceRepository {
  constructor(private readonly pool: Pool) {}

  async create(input: CreateServiceInput, createdBy: string | null): Promise<Service> {
    const result = await this.pool.query(
      `INSERT INTO services (tenant_id, code, name, description, created_by, updated_by)
       VALUES ($1, $2, $3, $4, $5, $5)
       RETURNING *`,
      [input.tenantId, input.code, input.name, input.description ?? null, createdBy],
    );
    return mapService(result.rows[0]);
  }

  async update(id: string, input: UpdateServiceInput, updatedBy: string | null): Promise<Service | null> {
    const result = await this.pool.query(
      `UPDATE services
          SET code = COALESCE($2, code),
              name = COALESCE($3, name),
              description = CASE WHEN $4::boolean THEN $5 ELSE description END,
              is_active = COALESCE($6, is_active),
              updated_by = $7,
              updated_at = now()
        WHERE id = $1
        RETURNING *`,
      [
        id,
        input.code ?? null,
        input.name ?? null,
        Object.prototype.hasOwnProperty.call(input, "description"),
        input.description ?? null,
        input.isActive ?? null,
        updatedBy,
      ],
    );
    return result.rows[0] ? mapService(result.rows[0]) : null;
  }

  async findById(id: string): Promise<Service | null> {
    const result = await this.pool.query(`SELECT * FROM services WHERE id = $1`, [id]);
    return result.rows[0] ? mapService(result.rows[0]) : null;
  }

  async listByTenant(tenantId: string): Promise<Service[]> {
    const result = await this.pool.query(
      `SELECT * FROM services WHERE tenant_id = $1 ORDER BY created_at ASC`,
      [tenantId],
    );
    return result.rows.map(mapService);
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapLink(row: any): CustomerServiceLink {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    customerId: row.customer_id,
    serviceId: row.service_id,
    contractId: row.contract_id,
    projectId: row.project_id,
    siteId: row.site_id,
    internalPicUserId: row.internal_pic_user_id,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class PgCustomerServiceLinkRepository implements CustomerServiceLinkRepository {
  constructor(private readonly pool: Pool) {}

  async create(
    input: CreateCustomerServiceLinkInput,
    createdBy: string | null,
  ): Promise<CustomerServiceLink> {
    const result = await this.pool.query(
      `INSERT INTO customer_service_links
         (tenant_id, customer_id, service_id, contract_id, project_id, site_id, internal_pic_user_id, created_by, updated_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $8)
       RETURNING *`,
      [
        input.tenantId,
        input.customerId,
        input.serviceId,
        input.contractId ?? null,
        input.projectId ?? null,
        input.siteId ?? null,
        input.internalPicUserId ?? null,
        createdBy,
      ],
    );
    return mapLink(result.rows[0]);
  }

  async update(
    id: string,
    input: UpdateCustomerServiceLinkInput,
    updatedBy: string | null,
  ): Promise<CustomerServiceLink | null> {
    const result = await this.pool.query(
      `UPDATE customer_service_links
          SET service_id = COALESCE($2, service_id),
              contract_id = CASE WHEN $3::boolean THEN $4 ELSE contract_id END,
              project_id = CASE WHEN $5::boolean THEN $6 ELSE project_id END,
              site_id = CASE WHEN $7::boolean THEN $8 ELSE site_id END,
              internal_pic_user_id = CASE WHEN $9::boolean THEN $10 ELSE internal_pic_user_id END,
              status = COALESCE($11, status),
              updated_by = $12,
              updated_at = now()
        WHERE id = $1
        RETURNING *`,
      [
        id,
        input.serviceId ?? null,
        Object.prototype.hasOwnProperty.call(input, "contractId"),
        input.contractId ?? null,
        Object.prototype.hasOwnProperty.call(input, "projectId"),
        input.projectId ?? null,
        Object.prototype.hasOwnProperty.call(input, "siteId"),
        input.siteId ?? null,
        Object.prototype.hasOwnProperty.call(input, "internalPicUserId"),
        input.internalPicUserId ?? null,
        input.status ?? null,
        updatedBy,
      ],
    );
    return result.rows[0] ? mapLink(result.rows[0]) : null;
  }

  async findById(id: string): Promise<CustomerServiceLink | null> {
    const result = await this.pool.query(`SELECT * FROM customer_service_links WHERE id = $1`, [id]);
    return result.rows[0] ? mapLink(result.rows[0]) : null;
  }

  async listByCustomer(customerId: string): Promise<CustomerServiceLink[]> {
    const result = await this.pool.query(
      `SELECT * FROM customer_service_links WHERE customer_id = $1 ORDER BY created_at ASC`,
      [customerId],
    );
    return result.rows.map(mapLink);
  }
}
