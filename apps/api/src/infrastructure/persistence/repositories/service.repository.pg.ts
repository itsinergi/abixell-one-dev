import type { Pool } from "pg";
import type {
  CreateCustomerServiceLinkInput,
  CreateServiceInput,
  CustomerServiceLink,
  CustomerServiceLinkRepository,
  Service,
  ServiceRepository,
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

  async listByCustomer(customerId: string): Promise<CustomerServiceLink[]> {
    const result = await this.pool.query(
      `SELECT * FROM customer_service_links WHERE customer_id = $1 ORDER BY created_at ASC`,
      [customerId],
    );
    return result.rows.map(mapLink);
  }
}
