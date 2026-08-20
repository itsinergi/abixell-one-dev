import type { Pool, QueryResultRow } from "pg";
import type {
  CreateEmployeeInput,
  CreatePositionInput,
  Employee,
  EmployeeAssignment,
  EmployeeListFilter,
  EmploymentStatus,
  Position,
  UpdateEmployeeProfileInput,
  WorkforceRepository,
} from "../domain/workforce.entity.js";

export class PgWorkforceRepository implements WorkforceRepository {
  constructor(private readonly pool: Pool) {}

  // --- Positions -------------------------------------------------------

  async createPosition(input: CreatePositionInput): Promise<Position> {
    const r = await this.pool.query(
      `INSERT INTO positions (tenant_id, code, name, description, created_by, updated_by)
       VALUES ($1,$2,$3,$4,$5,$5) RETURNING *`,
      [input.tenantId, input.code, input.name, input.description ?? null, input.createdBy],
    );
    return toPosition(r.rows[0]);
  }

  async findPositionById(id: string): Promise<Position | null> {
    const r = await this.pool.query(`SELECT * FROM positions WHERE id = $1`, [id]);
    return r.rows[0] ? toPosition(r.rows[0]) : null;
  }

  async findPositionByCode(tenantId: string, code: string): Promise<Position | null> {
    const r = await this.pool.query(`SELECT * FROM positions WHERE tenant_id = $1 AND code = $2`, [tenantId, code]);
    return r.rows[0] ? toPosition(r.rows[0]) : null;
  }

  async listPositions(tenantId: string): Promise<Position[]> {
    const r = await this.pool.query(`SELECT * FROM positions WHERE tenant_id = $1 ORDER BY code`, [tenantId]);
    return r.rows.map(toPosition);
  }

  async setPositionActive(id: string, isActive: boolean, updatedBy: string | null): Promise<Position | null> {
    const r = await this.pool.query(
      `UPDATE positions SET is_active = $2, updated_by = $3, updated_at = now() WHERE id = $1 RETURNING *`,
      [id, isActive, updatedBy],
    );
    return r.rows[0] ? toPosition(r.rows[0]) : null;
  }

  // --- Employees -------------------------------------------------------

  async createEmployee(input: CreateEmployeeInput): Promise<Employee> {
    const r = await this.pool.query(
      `INSERT INTO employees
         (tenant_id, employee_number, full_name, email, phone, employment_type, employment_status,
          joined_at, legal_entity_id, organization_unit_id, position_id, user_id, created_by, updated_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$13) RETURNING *`,
      [
        input.tenantId,
        input.employeeNumber,
        input.fullName,
        input.email ?? null,
        input.phone ?? null,
        input.employmentType ?? null,
        input.employmentStatus,
        input.joinedAt ?? null,
        input.legalEntityId ?? null,
        input.organizationUnitId ?? null,
        input.positionId ?? null,
        input.userId ?? null,
        input.createdBy,
      ],
    );
    return toEmployee(r.rows[0]);
  }

  async findEmployeeById(id: string): Promise<Employee | null> {
    const r = await this.pool.query(`SELECT * FROM employees WHERE id = $1 AND deleted_at IS NULL`, [id]);
    return r.rows[0] ? toEmployee(r.rows[0]) : null;
  }

  async findEmployeeByNumber(tenantId: string, employeeNumber: string): Promise<Employee | null> {
    const r = await this.pool.query(
      `SELECT * FROM employees WHERE tenant_id = $1 AND employee_number = $2 AND deleted_at IS NULL`,
      [tenantId, employeeNumber],
    );
    return r.rows[0] ? toEmployee(r.rows[0]) : null;
  }

  async findEmployeeByUserId(tenantId: string, userId: string): Promise<Employee | null> {
    const r = await this.pool.query(
      `SELECT * FROM employees WHERE tenant_id = $1 AND user_id = $2 AND deleted_at IS NULL`,
      [tenantId, userId],
    );
    return r.rows[0] ? toEmployee(r.rows[0]) : null;
  }

  async listEmployees(tenantId: string, filter: EmployeeListFilter): Promise<Employee[]> {
    const conditions = [`tenant_id = $1`, `deleted_at IS NULL`];
    const params: unknown[] = [tenantId];
    if (filter.organizationUnitIds) {
      params.push(filter.organizationUnitIds);
      conditions.push(`organization_unit_id = ANY($${params.length})`);
    }
    if (filter.legalEntityId) {
      params.push(filter.legalEntityId);
      conditions.push(`legal_entity_id = $${params.length}`);
    }
    if (filter.employmentStatus) {
      params.push(filter.employmentStatus);
      conditions.push(`employment_status = $${params.length}`);
    }
    if (filter.search) {
      params.push(`%${filter.search}%`);
      conditions.push(`(full_name ILIKE $${params.length} OR employee_number ILIKE $${params.length})`);
    }
    const r = await this.pool.query(
      `SELECT * FROM employees WHERE ${conditions.join(" AND ")} ORDER BY employee_number`,
      params,
    );
    return r.rows.map(toEmployee);
  }

  async updateEmployeeProfile(
    id: string,
    input: UpdateEmployeeProfileInput,
    updatedBy: string | null,
  ): Promise<Employee | null> {
    const r = await this.pool.query(
      `UPDATE employees
          SET full_name = COALESCE($2, full_name),
              email = CASE WHEN $3::boolean THEN $4 ELSE email END,
              phone = CASE WHEN $5::boolean THEN $6 ELSE phone END,
              employment_type = CASE WHEN $7::boolean THEN $8 ELSE employment_type END,
              updated_by = $9, updated_at = now()
        WHERE id = $1 AND deleted_at IS NULL RETURNING *`,
      [
        id,
        input.fullName ?? null,
        input.email !== undefined,
        input.email ?? null,
        input.phone !== undefined,
        input.phone ?? null,
        input.employmentType !== undefined,
        input.employmentType ?? null,
        updatedBy,
      ],
    );
    return r.rows[0] ? toEmployee(r.rows[0]) : null;
  }

  async applyPlacement(
    id: string,
    input: {
      legalEntityId: string | null;
      organizationUnitId: string | null;
      positionId: string | null;
      employmentStatus: EmploymentStatus;
      endedAt: string | null;
    },
    updatedBy: string | null,
  ): Promise<Employee | null> {
    const r = await this.pool.query(
      `UPDATE employees
          SET legal_entity_id = $2, organization_unit_id = $3, position_id = $4,
              employment_status = $5, ended_at = $6, updated_by = $7, updated_at = now()
        WHERE id = $1 AND deleted_at IS NULL RETURNING *`,
      [
        id,
        input.legalEntityId,
        input.organizationUnitId,
        input.positionId,
        input.employmentStatus,
        input.endedAt,
        updatedBy,
      ],
    );
    return r.rows[0] ? toEmployee(r.rows[0]) : null;
  }

  async setEmployeeUser(id: string, userId: string | null, updatedBy: string | null): Promise<Employee | null> {
    const r = await this.pool.query(
      `UPDATE employees SET user_id = $2, updated_by = $3, updated_at = now()
        WHERE id = $1 AND deleted_at IS NULL RETURNING *`,
      [id, userId, updatedBy],
    );
    return r.rows[0] ? toEmployee(r.rows[0]) : null;
  }

  // --- Placement history ----------------------------------------------

  async closeOpenAssignment(employeeId: string, effectiveTo: string): Promise<void> {
    await this.pool.query(
      `UPDATE employee_assignments SET effective_to = $2
        WHERE employee_id = $1 AND effective_to IS NULL`,
      [employeeId, effectiveTo],
    );
  }

  async createAssignment(input: {
    employeeId: string;
    legalEntityId: string | null;
    organizationUnitId: string | null;
    positionId: string | null;
    employmentStatus: EmploymentStatus;
    effectiveFrom: string;
    note: string | null;
    createdBy: string | null;
  }): Promise<EmployeeAssignment> {
    const r = await this.pool.query(
      `INSERT INTO employee_assignments
         (employee_id, legal_entity_id, organization_unit_id, position_id,
          employment_status, effective_from, note, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [
        input.employeeId,
        input.legalEntityId,
        input.organizationUnitId,
        input.positionId,
        input.employmentStatus,
        input.effectiveFrom,
        input.note,
        input.createdBy,
      ],
    );
    return toAssignment(r.rows[0]);
  }

  async listAssignments(employeeId: string): Promise<EmployeeAssignment[]> {
    const r = await this.pool.query(
      `SELECT * FROM employee_assignments WHERE employee_id = $1
        ORDER BY effective_from DESC, created_at DESC`,
      [employeeId],
    );
    return r.rows.map(toAssignment);
  }

  // --- Cross-domain reads ----------------------------------------------

  async findUserTenantId(userId: string): Promise<string | null> {
    const r = await this.pool.query(`SELECT tenant_id FROM users WHERE id = $1 AND deleted_at IS NULL`, [userId]);
    return r.rows[0]?.tenant_id ?? null;
  }

  async organizationUnitExists(tenantId: string, organizationUnitId: string): Promise<boolean> {
    const r = await this.pool.query(
      `SELECT 1 FROM organization_units WHERE id = $1 AND tenant_id = $2`,
      [organizationUnitId, tenantId],
    );
    return r.rows.length > 0;
  }

  async legalEntityExists(tenantId: string, legalEntityId: string): Promise<boolean> {
    const r = await this.pool.query(`SELECT 1 FROM legal_entities WHERE id = $1 AND tenant_id = $2`, [
      legalEntityId,
      tenantId,
    ]);
    return r.rows.length > 0;
  }
}

// --- Row mappers -------------------------------------------------------

/** `date` columns come back from pg as a JS Date at LOCAL midnight. The
 * domain models them as plain calendar strings, so the components must be
 * read locally — `toISOString()` would shift the date by a day in any
 * timezone east of UTC. */
function toDateString(value: unknown): string | null {
  if (!value) return null;
  if (value instanceof Date) {
    const year = value.getFullYear();
    const month = String(value.getMonth() + 1).padStart(2, "0");
    const day = String(value.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }
  return String(value).slice(0, 10);
}

function toPosition(r: QueryResultRow): Position {
  return {
    id: r.id,
    tenantId: r.tenant_id,
    code: r.code,
    name: r.name,
    description: r.description,
    isActive: r.is_active,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

function toEmployee(r: QueryResultRow): Employee {
  return {
    id: r.id,
    tenantId: r.tenant_id,
    employeeNumber: r.employee_number,
    fullName: r.full_name,
    email: r.email,
    phone: r.phone,
    employmentType: r.employment_type,
    employmentStatus: r.employment_status as EmploymentStatus,
    joinedAt: toDateString(r.joined_at),
    endedAt: toDateString(r.ended_at),
    legalEntityId: r.legal_entity_id,
    organizationUnitId: r.organization_unit_id,
    positionId: r.position_id,
    userId: r.user_id,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

function toAssignment(r: QueryResultRow): EmployeeAssignment {
  return {
    id: r.id,
    employeeId: r.employee_id,
    legalEntityId: r.legal_entity_id,
    organizationUnitId: r.organization_unit_id,
    positionId: r.position_id,
    employmentStatus: r.employment_status as EmploymentStatus,
    effectiveFrom: toDateString(r.effective_from)!,
    effectiveTo: toDateString(r.effective_to),
    note: r.note,
    createdAt: r.created_at,
  };
}
