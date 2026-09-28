import type { ActorContext } from "../../../../domain/shared-kernel/audit-context.js";
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from "../../../../domain/shared-kernel/errors.js";
import type { AuditService } from "../../../../application/audit/audit.service.js";
import type { RbacService } from "../../../../application/rbac/rbac.service.js";
import type { EventBus } from "../../../../application/event/event-bus.js";
import type { ConfigurationService } from "../../../../application/configuration/configuration.service.js";
import type {
  Employee,
  EmployeeAssignment,
  EmploymentStatus,
  Position,
  UpdateEmployeeProfileInput,
  WorkforceRepository,
} from "../domain/workforce.entity.js";
import { EMPLOYMENT_STATUSES } from "../domain/workforce.entity.js";

/** Tenant Configuration code used when an employee number is generated
 * rather than supplied explicitly. */
export const EMPLOYEE_NUMBERING_CODE = "employee_number";

export interface EmployeeDetailView {
  employee: Employee;
  position: Position | null;
  history: EmployeeAssignment[];
}

/**
 * Workforce / HR Core (Phase 3, HR-CORE-001…010).
 *
 * Answers: who is the employee, what is their employment relationship, where
 * do they sit organisationally, what position do they hold, and what basic
 * records exist.
 *
 * Architectural constraints honoured here:
 * - **Employee is not a system user.** The link to a platform user account is
 *   optional and one-to-one per tenant; an employee may have no login at all
 *   (HR-CORE-008). Workforce never becomes an authentication system.
 * - **Organisation is not duplicated.** Placement references the existing
 *   Legal Entity / Organization Unit hierarchy from Platform Core.
 * - **History is preserved.** A placement change closes the open period and
 *   opens a new one; historical facts are never overwritten (HR-CORE-007).
 * - **No Workflow for plain master-data CRUD.** The Workflow Engine is not
 *   used merely because it exists.
 * - **No Advanced HR.** No attendance, shift/roster, leave, overtime,
 *   payroll, recruitment, performance, competency, or manpower planning.
 * - **No country-specific compliance** and deliberate data minimisation: no
 *   statutory identifiers, tax, banking, medical, or family data.
 */
export class WorkforceService {
  constructor(
    private readonly repo: WorkforceRepository,
    private readonly configuration: ConfigurationService,
    private readonly audit: AuditService,
    private readonly rbac: RbacService,
    private readonly eventBus: EventBus,
  ) {}

  // ===================================================================
  // Positions — HR-CORE-004
  // ===================================================================

  async createPosition(
    actor: ActorContext,
    input: { code: string; name: string; description?: string | null },
  ): Promise<Position> {
    await this.rbac.requirePermission(actor, "workforce.configure");
    const existing = await this.repo.findPositionByCode(actor.tenantId, input.code);
    if (existing) throw new ConflictError("Position already exists: " + input.code);

    const position = await this.repo.createPosition({
      tenantId: actor.tenantId,
      code: input.code,
      name: input.name,
      description: input.description ?? null,
      createdBy: actor.userId,
    });
    await this.audit.record({
      tenantId: actor.tenantId,
      actorUserId: actor.userId,
      action: "workforce.position.created",
      entityType: "position",
      entityId: position.id,
      metadata: { code: position.code, name: position.name },
    });
    return position;
  }

  async listPositions(actor: ActorContext): Promise<Position[]> {
    await this.rbac.requirePermission(actor, "workforce.read");
    return this.repo.listPositions(actor.tenantId);
  }

  async setPositionActive(actor: ActorContext, code: string, isActive: boolean): Promise<Position> {
    await this.rbac.requirePermission(actor, "workforce.configure");
    const position = await this.repo.findPositionByCode(actor.tenantId, code);
    if (!position) throw new NotFoundError("Position", code);
    return (await this.repo.setPositionActive(position.id, isActive, actor.userId))!;
  }

  // ===================================================================
  // Employees — HR-CORE-001/002/003/005/008
  // ===================================================================

  async createEmployee(
    actor: ActorContext,
    input: {
      employeeNumber?: string;
      fullName: string;
      email?: string | null;
      phone?: string | null;
      employmentType?: string | null;
      employmentStatus?: string;
      joinedAt?: string | null;
      legalEntityId?: string | null;
      organizationUnitId?: string | null;
      positionCode?: string | null;
      userId?: string | null;
    },
  ): Promise<Employee> {
    await this.rbac.requirePermission(actor, "workforce.manage");

    const employmentStatus = this.parseStatus(input.employmentStatus ?? "active");
    const joinedAt = this.parseDate(input.joinedAt, "joinedAt");
    const legalEntityId = await this.resolveLegalEntity(actor, input.legalEntityId ?? null);
    const organizationUnitId = await this.resolveOrganizationUnit(actor, input.organizationUnitId ?? null);
    const position = await this.resolvePosition(actor, input.positionCode ?? null);
    const userId = await this.resolveUserLink(actor, input.userId ?? null, null);

    // Employee number: supplied explicitly, or generated through Numbering
    // Core (never hand-rolled inside this module).
    let employeeNumber = input.employeeNumber?.trim();
    if (employeeNumber) {
      const clash = await this.repo.findEmployeeByNumber(actor.tenantId, employeeNumber);
      if (clash) throw new ConflictError("Employee number already exists: " + employeeNumber);
    } else {
      const generated = await this.configuration.generateNumberForTenant(
        actor.tenantId,
        EMPLOYEE_NUMBERING_CODE,
        actor.userId,
      );
      employeeNumber = generated.number;
    }

    const employee = await this.repo.createEmployee({
      tenantId: actor.tenantId,
      employeeNumber,
      fullName: input.fullName,
      email: input.email ?? null,
      phone: input.phone ?? null,
      employmentType: input.employmentType ?? null,
      employmentStatus,
      joinedAt,
      legalEntityId,
      organizationUnitId,
      positionId: position?.id ?? null,
      userId,
      createdBy: actor.userId,
    });

    // Opening placement period — history starts when the employee does.
    await this.repo.createAssignment({
      employeeId: employee.id,
      legalEntityId,
      organizationUnitId,
      positionId: position?.id ?? null,
      employmentStatus,
      effectiveFrom: joinedAt ?? today(),
      note: "Initial placement",
      createdBy: actor.userId,
    });

    await this.audit.record({
      tenantId: actor.tenantId,
      actorUserId: actor.userId,
      action: "workforce.employee.created",
      entityType: "employee",
      entityId: employee.id,
      // Deliberately minimal metadata — no contact details in the audit log.
      metadata: { employeeNumber, organizationUnitId, positionId: position?.id ?? null },
    });
    await this.eventBus.publish({
      tenantId: actor.tenantId,
      eventType: "workforce.employee.created",
      entityType: "employee",
      entityId: employee.id,
      payload: { employeeNumber, organizationUnitId, targetUserId: actor.userId },
      createdBy: actor.userId,
    });
    return employee;
  }

  async listEmployees(
    actor: ActorContext,
    filter: { legalEntityId?: string; employmentStatus?: string; search?: string } = {},
  ): Promise<Employee[]> {
    await this.rbac.requirePermission(actor, "workforce.read");
    const employees = await this.repo.listEmployees(actor.tenantId, {
      legalEntityId: filter.legalEntityId,
      employmentStatus: filter.employmentStatus ? this.parseStatus(filter.employmentStatus) : undefined,
      search: filter.search,
    });
    return this.filterByDataScope(actor, employees);
  }

  async getEmployee(actor: ActorContext, id: string): Promise<EmployeeDetailView> {
    await this.rbac.requirePermission(actor, "workforce.read");
    const employee = await this.getAuthorizedEmployee(actor, id);
    return this.buildDetail(employee);
  }

  /** HR-CORE-005 — contact/profile maintenance. Placement and status are
   * deliberately NOT editable here; they go through `changePlacement` so a
   * history period is always recorded. */
  async updateEmployeeProfile(
    actor: ActorContext,
    id: string,
    input: UpdateEmployeeProfileInput,
  ): Promise<Employee> {
    await this.rbac.requirePermission(actor, "workforce.manage");
    const employee = await this.getAuthorizedEmployee(actor, id);
    const updated = await this.repo.updateEmployeeProfile(employee.id, input, actor.userId);
    await this.audit.record({
      tenantId: actor.tenantId,
      actorUserId: actor.userId,
      action: "workforce.employee.updated",
      entityType: "employee",
      entityId: employee.id,
      metadata: { fields: Object.keys(input) },
    });
    return updated!;
  }

  /**
   * HR-CORE-003/007 — change organisational placement, position, and/or
   * employment status. Closes the open history period and opens a new one;
   * previous facts are never rewritten.
   */
  async changePlacement(
    actor: ActorContext,
    id: string,
    input: {
      legalEntityId?: string | null;
      organizationUnitId?: string | null;
      positionCode?: string | null;
      employmentStatus?: string;
      effectiveFrom?: string;
      note?: string | null;
    },
  ): Promise<EmployeeDetailView> {
    await this.rbac.requirePermission(actor, "workforce.manage");
    const employee = await this.getAuthorizedEmployee(actor, id);

    const effectiveFrom = this.parseDate(input.effectiveFrom ?? today(), "effectiveFrom")!;
    const employmentStatus = this.parseStatus(input.employmentStatus ?? employee.employmentStatus);
    const legalEntityId =
      input.legalEntityId === undefined
        ? employee.legalEntityId
        : await this.resolveLegalEntity(actor, input.legalEntityId);
    const organizationUnitId =
      input.organizationUnitId === undefined
        ? employee.organizationUnitId
        : await this.resolveOrganizationUnit(actor, input.organizationUnitId);
    const position =
      input.positionCode === undefined
        ? employee.positionId
          ? await this.repo.findPositionById(employee.positionId)
          : null
        : await this.resolvePosition(actor, input.positionCode);

    const history = await this.repo.listAssignments(employee.id);
    const open = history.find((a) => a.effectiveTo === null);
    if (open && effectiveFrom < open.effectiveFrom) {
      throw new ValidationError("effectiveFrom cannot be earlier than the current placement period");
    }

    await this.repo.closeOpenAssignment(employee.id, effectiveFrom);
    await this.repo.createAssignment({
      employeeId: employee.id,
      legalEntityId,
      organizationUnitId,
      positionId: position?.id ?? null,
      employmentStatus,
      effectiveFrom,
      note: input.note ?? null,
      createdBy: actor.userId,
    });
    await this.repo.applyPlacement(
      employee.id,
      {
        legalEntityId,
        organizationUnitId,
        positionId: position?.id ?? null,
        employmentStatus,
        endedAt: employmentStatus === "ended" ? effectiveFrom : null,
      },
      actor.userId,
    );

    await this.audit.record({
      tenantId: actor.tenantId,
      actorUserId: actor.userId,
      action: "workforce.employment.changed",
      entityType: "employee",
      entityId: employee.id,
      metadata: { organizationUnitId, positionId: position?.id ?? null, employmentStatus, effectiveFrom },
    });
    if (employmentStatus !== employee.employmentStatus) {
      await this.eventBus.publish({
        tenantId: actor.tenantId,
        eventType:
          employmentStatus === "active"
            ? "workforce.employee.activated"
            : "workforce.employee.deactivated",
        entityType: "employee",
        entityId: employee.id,
        payload: {
          employeeNumber: employee.employeeNumber,
          employmentStatus,
          targetUserId: employee.userId,
        },
        createdBy: actor.userId,
      });
    }

    const refreshed = await this.repo.findEmployeeById(employee.id);
    return this.buildDetail(refreshed!);
  }

  /** HR-CORE-008 — optional link to a platform user account. Linking never
   * creates, modifies, or deactivates the account itself: Identity remains a
   * separate domain and Workforce never becomes an auth system. */
  async setEmployeeUserLink(actor: ActorContext, id: string, userId: string | null): Promise<Employee> {
    await this.rbac.requirePermission(actor, "workforce.manage");
    const employee = await this.getAuthorizedEmployee(actor, id);
    const resolved = await this.resolveUserLink(actor, userId, employee.id);
    const updated = await this.repo.setEmployeeUser(employee.id, resolved, actor.userId);
    await this.audit.record({
      tenantId: actor.tenantId,
      actorUserId: actor.userId,
      action: "workforce.employee.user_link.changed",
      entityType: "employee",
      entityId: employee.id,
      metadata: { userId: resolved },
    });
    return updated!;
  }

  /** Minimum self-service (HR-CORE-010): the employee record belonging to
   * the signed-in user, if one is linked. Requires no Workforce capability —
   * a person may always see their own record. Nothing else is exposed: no
   * leave, payslip, attendance, or document workflow. */
  async getMyEmployeeRecord(actor: ActorContext): Promise<EmployeeDetailView | null> {
    const employee = await this.repo.findEmployeeByUserId(actor.tenantId, actor.userId);
    if (!employee) return null;
    return this.buildDetail(employee);
  }

  /**
   * Document Core authorization hook (HR-CORE-006). Employee documents are
   * more sensitive than ordinary business records, so this requires the
   * dedicated `workforce.documents.read` capability IN ADDITION to Data
   * Scope — holding `workforce.read` alone is deliberately not enough.
   */
  async canAccessForDocument(actor: ActorContext, employeeId: string): Promise<boolean> {
    const employee = await this.repo.findEmployeeById(employeeId);
    if (!employee || employee.tenantId !== actor.tenantId) return false;
    if (employee.userId && employee.userId === actor.userId) return true;
    const permissions = await this.rbac.getActivePermissions(actor);
    if (!permissions.has("workforce.documents.read")) return false;
    return this.isWithinDataScope(actor, employee);
  }

  // ===================================================================
  // Internals
  // ===================================================================

  private async buildDetail(employee: Employee): Promise<EmployeeDetailView> {
    const [position, history] = await Promise.all([
      employee.positionId ? this.repo.findPositionById(employee.positionId) : Promise.resolve(null),
      this.repo.listAssignments(employee.id),
    ]);
    return { employee, position, history };
  }

  private parseStatus(value: string): EmploymentStatus {
    if (!EMPLOYMENT_STATUSES.includes(value as EmploymentStatus)) {
      throw new ValidationError(
        "employmentStatus must be one of: " + EMPLOYMENT_STATUSES.join(", "),
      );
    }
    return value as EmploymentStatus;
  }

  /** Calendar dates carry no timezone. A plain `YYYY-MM-DD` input is kept
   * exactly as given (only validated), so a date can never shift by a day
   * through timezone conversion. */
  private parseDate(value: string | null | undefined, field: string): string | null {
    if (value === null || value === undefined || value === "") return null;
    const plain = /^\d{4}-\d{2}-\d{2}$/.exec(value.trim());
    if (plain) {
      const date = new Date(value.trim() + "T00:00:00Z");
      if (Number.isNaN(date.getTime())) throw new ValidationError(field + " is not a valid date");
      return value.trim();
    }
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) throw new ValidationError(field + " is not a valid date");
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }

  private async resolveLegalEntity(actor: ActorContext, legalEntityId: string | null): Promise<string | null> {
    if (!legalEntityId) return null;
    if (!(await this.repo.legalEntityExists(actor.tenantId, legalEntityId))) {
      throw new NotFoundError("LegalEntity", legalEntityId);
    }
    return legalEntityId;
  }

  private async resolveOrganizationUnit(
    actor: ActorContext,
    organizationUnitId: string | null,
  ): Promise<string | null> {
    if (!organizationUnitId) return null;
    if (!(await this.repo.organizationUnitExists(actor.tenantId, organizationUnitId))) {
      throw new NotFoundError("OrganizationUnit", organizationUnitId);
    }
    // Reuses the platform's hierarchical Organization Unit Data Scope
    // (ADR-0009) instead of re-deriving scope here. This also prevents an
    // employee being moved into a unit outside the actor's own scope.
    await this.rbac.requireOrganizationUnitScopeForActor(actor, organizationUnitId);
    return organizationUnitId;
  }

  private async resolvePosition(actor: ActorContext, positionCode: string | null): Promise<Position | null> {
    if (!positionCode) return null;
    const position = await this.repo.findPositionByCode(actor.tenantId, positionCode);
    if (!position) throw new NotFoundError("Position", positionCode);
    if (!position.isActive) throw new ConflictError("Position is not active: " + positionCode);
    return position;
  }

  private async resolveUserLink(
    actor: ActorContext,
    userId: string | null,
    currentEmployeeId: string | null,
  ): Promise<string | null> {
    if (!userId) return null;
    const userTenant = await this.repo.findUserTenantId(userId);
    if (!userTenant) throw new NotFoundError("User", userId);
    if (userTenant !== actor.tenantId) {
      throw new ForbiddenError("Cannot link a user account from another tenant");
    }
    const existing = await this.repo.findEmployeeByUserId(actor.tenantId, userId);
    if (existing && existing.id !== currentEmployeeId) {
      throw new ConflictError("That user account is already linked to another employee");
    }
    return userId;
  }

  private async getAuthorizedEmployee(actor: ActorContext, id: string): Promise<Employee> {
    const employee = await this.repo.findEmployeeById(id);
    if (!employee || employee.tenantId !== actor.tenantId) throw new NotFoundError("Employee", id);
    if (!(await this.isWithinDataScope(actor, employee))) {
      throw new ForbiddenError("Your assigned Data Scope does not cover this employee");
    }
    return employee;
  }

  /** HR-CORE-009 — an employee with no Organization Unit is tenant-level and
   * visible to any capability holder; an employee placed in a unit is visible
   * only within that unit's hierarchical scope. */
  private async isWithinDataScope(actor: ActorContext, employee: Employee): Promise<boolean> {
    if (!employee.organizationUnitId) return true;
    return this.rbac.isActiveOrganizationUnitScopeCovered(actor, employee.organizationUnitId);
  }

  private async filterByDataScope(actor: ActorContext, employees: Employee[]): Promise<Employee[]> {
    if (await this.rbac.hasTenantScope(actor)) return employees;
    // Resolve each DISTINCT organization unit once rather than per row.
    const decisions = new Map<string, boolean>();
    const allowed: Employee[] = [];
    for (const employee of employees) {
      if (!employee.organizationUnitId) {
        allowed.push(employee);
        continue;
      }
      let ok = decisions.get(employee.organizationUnitId);
      if (ok === undefined) {
        ok = await this.rbac.isActiveOrganizationUnitScopeCovered(actor, employee.organizationUnitId);
        decisions.set(employee.organizationUnitId, ok);
      }
      if (ok) allowed.push(employee);
    }
    return allowed;
  }
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}
