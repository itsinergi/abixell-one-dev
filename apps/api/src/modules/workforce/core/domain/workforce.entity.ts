/**
 * Workforce / HR Core — domain types (Phase 3).
 *
 * Built under the frozen target repository architecture
 * (`modules/<module>/core/{domain,application,infrastructure,api}`).
 *
 * Scope discipline: this module answers *who the employee is and where they
 * belong*. It contains no attendance, shift/roster, leave, overtime,
 * payroll, recruitment, performance, competency, or manpower-planning
 * concept — all of those are Advanced Workforce capabilities.
 */

/** Finite Core lifecycle values — they drive behaviour, so they are not
 * Tenant Configuration. Employment TYPE (permanent/contract/…) is
 * configurable reference data instead. */
export type EmploymentStatus = "active" | "inactive" | "ended";

export const EMPLOYMENT_STATUSES: EmploymentStatus[] = ["active", "inactive", "ended"];

export interface Position {
  id: string;
  tenantId: string;
  code: string;
  name: string;
  description: string | null;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface Employee {
  id: string;
  tenantId: string;
  employeeNumber: string;
  fullName: string;
  email: string | null;
  phone: string | null;
  employmentType: string | null;
  employmentStatus: EmploymentStatus;
  joinedAt: string | null;
  endedAt: string | null;
  legalEntityId: string | null;
  organizationUnitId: string | null;
  positionId: string | null;
  /** OPTIONAL platform user account. An employee may have no login at all
   * — Workforce never assumes Employee == User (HR-CORE-008). */
  userId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/** One placement/status period. `effectiveTo === null` marks the current
 * period; closing a period never rewrites its facts (HR-CORE-007). */
export interface EmployeeAssignment {
  id: string;
  employeeId: string;
  legalEntityId: string | null;
  organizationUnitId: string | null;
  positionId: string | null;
  employmentStatus: EmploymentStatus;
  effectiveFrom: string;
  effectiveTo: string | null;
  note: string | null;
  createdAt: Date;
}

export interface CreatePositionInput {
  tenantId: string;
  code: string;
  name: string;
  description?: string | null;
  createdBy: string | null;
}

export interface CreateEmployeeInput {
  tenantId: string;
  employeeNumber: string;
  fullName: string;
  email?: string | null;
  phone?: string | null;
  employmentType?: string | null;
  employmentStatus: EmploymentStatus;
  joinedAt?: string | null;
  legalEntityId?: string | null;
  organizationUnitId?: string | null;
  positionId?: string | null;
  userId?: string | null;
  createdBy: string | null;
}

export interface UpdateEmployeeProfileInput {
  fullName?: string;
  email?: string | null;
  phone?: string | null;
  employmentType?: string | null;
}

export interface PlacementInput {
  legalEntityId: string | null;
  organizationUnitId: string | null;
  positionId: string | null;
  employmentStatus: EmploymentStatus;
  effectiveFrom: string;
  note?: string | null;
}

export interface EmployeeListFilter {
  organizationUnitIds?: string[];
  legalEntityId?: string;
  employmentStatus?: EmploymentStatus;
  search?: string;
}

export interface WorkforceRepository {
  // --- Positions (HR-CORE-004) ---------------------------------------
  createPosition(input: CreatePositionInput): Promise<Position>;
  findPositionById(id: string): Promise<Position | null>;
  findPositionByCode(tenantId: string, code: string): Promise<Position | null>;
  listPositions(tenantId: string): Promise<Position[]>;
  setPositionActive(id: string, isActive: boolean, updatedBy: string | null): Promise<Position | null>;

  // --- Employees (HR-CORE-001/002/005/008) ---------------------------
  createEmployee(input: CreateEmployeeInput): Promise<Employee>;
  findEmployeeById(id: string): Promise<Employee | null>;
  findEmployeeByNumber(tenantId: string, employeeNumber: string): Promise<Employee | null>;
  findEmployeeByUserId(tenantId: string, userId: string): Promise<Employee | null>;
  listEmployees(tenantId: string, filter: EmployeeListFilter): Promise<Employee[]>;
  updateEmployeeProfile(
    id: string,
    input: UpdateEmployeeProfileInput,
    updatedBy: string | null,
  ): Promise<Employee | null>;
  /** Apply a new current placement/status to the employee record. */
  applyPlacement(
    id: string,
    input: {
      legalEntityId: string | null;
      organizationUnitId: string | null;
      positionId: string | null;
      employmentStatus: EmploymentStatus;
      endedAt: string | null;
    },
    updatedBy: string | null,
  ): Promise<Employee | null>;
  setEmployeeUser(id: string, userId: string | null, updatedBy: string | null): Promise<Employee | null>;

  // --- Placement history (HR-CORE-003/007) ---------------------------
  /** Close the currently open period (if any) the day before `effectiveTo`
   * semantics are applied by the caller. */
  closeOpenAssignment(employeeId: string, effectiveTo: string): Promise<void>;
  createAssignment(input: {
    employeeId: string;
    legalEntityId: string | null;
    organizationUnitId: string | null;
    positionId: string | null;
    employmentStatus: EmploymentStatus;
    effectiveFrom: string;
    note: string | null;
    createdBy: string | null;
  }): Promise<EmployeeAssignment>;
  listAssignments(employeeId: string): Promise<EmployeeAssignment[]>;

  // --- Cross-domain reads (Platform Core, kept behind this port) ------
  findUserTenantId(userId: string): Promise<string | null>;
  organizationUnitExists(tenantId: string, organizationUnitId: string): Promise<boolean>;
  legalEntityExists(tenantId: string, legalEntityId: string): Promise<boolean>;
}
