import type { ActorContext } from "../shared-kernel/audit-context.js";

/**
 * Employee Placement — effective-dated placement record (Epic 6 Gelombang 2).
 *
 * A placement is an immutable assignment of an employee to:
 * - A legal entity (tenant-scoped owner, never NULL)
 * - An organization unit within that legal entity (never NULL)
 * - A department (optional, reporting-only; never participates in authorization)
 * - An effective date range [effective_from, effective_to)
 *
 * Placement type is one of:
 * - `primary`: exactly one non-overlapping active placement per employee at any date
 *             (enforced by GiST exclusion constraint at DB level).
 * - `secondary`: optional coexisting placements (dotted-line, temporary, etc.).
 *                multiple allowed per employee, no overlap enforcement.
 *
 * Both types are immutable: once created, closed (effective_to set) placements
 * are never edited. New placements close old ones via application logic, not
 * in-place updates. Timestamps:
 * - published_at / recorded_at: system-time audit (when written)
 * - effective_from / effective_to: business-time validity (point-in-time reads)
 *
 * Ownership: (tenant_id, employee_profile_id) composite FK enforces tenant
 * isolation; department is never used for scope.
 */

export type PlacementType = "primary" | "secondary";

export const PLACEMENT_TYPES: readonly PlacementType[] = ["primary", "secondary"];

export interface EmployeePlacement {
  id: string;
  tenantId: string;
  employeeProfileId: string;
  placementType: PlacementType;
  legalEntityId: string;
  organizationUnitId: string;
  departmentId: string | null;
  effectiveFrom: Date;
  effectiveTo: Date | null;
  publishedAt: Date;
  publishedBy: string | null;
  recordedAt: Date;
  reason: string;
  actorUserId: string | null;
  createdBy: string | null;
  createdAt: Date;
  updatedBy: string | null;
  updatedAt: Date;
}

export interface CreateEmployeePlacementInput {
  employeeProfileId: string;
  placementType: PlacementType;
  legalEntityId: string;
  organizationUnitId: string;
  departmentId?: string | null;
  effectiveFrom: Date;
  effectiveTo?: Date | null;
  reason: string;
}

export interface EmployeePlacementRepository {
  findById(tenantId: string, id: string): Promise<EmployeePlacement | null>;

  /** Get active (or at a specific date) placement for employee, primary first. */
  getActiveAtDate(
    tenantId: string,
    employeeProfileId: string,
    dateAt: Date,
  ): Promise<{ primary: EmployeePlacement | null; secondary: EmployeePlacement[] }>;

  /** List all placements for employee (by effective date descending). */
  listByEmployee(
    tenantId: string,
    employeeProfileId: string,
    options?: { limit?: number; offset?: number },
  ): Promise<EmployeePlacement[]>;

  /** Create a new placement inside a governed transaction. */
  create(
    tenantId: string,
    input: CreateEmployeePlacementInput,
    actor: ActorContext,
  ): Promise<EmployeePlacement>;

  /** Close a placement (set effective_to, immutable thereafter). */
  close(
    tenantId: string,
    id: string,
    effectiveTo: Date,
    actor: ActorContext,
  ): Promise<EmployeePlacement>;
}
