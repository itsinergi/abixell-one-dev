import type { Pool, PoolClient, QueryResultRow } from "pg";
import type {
  AdvanceJobApplicationInput,
  AssessEmployeeCompetencyInput,
  AttendanceListFilter,
  CompleteTrainingInput,
  CreateCareerPathInput,
  CreateCompetencyInput,
  CreateJobApplicationInput,
  CreateJobPostingInput,
  CreateLeaveRequestInput,
  CreateLeaveTypeInput,
  CreateManpowerPlanInput,
  CreateOvertimeRequestInput,
  CreatePayrollRunInput,
  CreatePerformanceReviewInput,
  CreateShiftInput,
  CreateStatutoryPolicyInput,
  CreateTrainingCourseInput,
  EmployeeReference,
  EnrollTrainingInput,
  JobApplicationListFilter,
  JobPostingListFilter,
  LeaveRequestListFilter,
  ManpowerGapEntry,
  ManpowerPlanListFilter,
  OvertimeRequestListFilter,
  PayrollRunListFilter,
  PerformanceReviewListFilter,
  RecordActualOvertimeInput,
  RecordAttendanceInput,
  RosterListFilter,
  SetLeaveAllocationInput,
  SetSalaryProfileInput,
  UpsertRosterInput,
  WorkforceAdvancedRepository,
  WorkforceAttendanceRecord,
  WorkforceCareerPath,
  WorkforceCompetency,
  WorkforceEmployeeCompetency,
  WorkforceEmployeeSalaryProfile,
  WorkforceJobApplication,
  WorkforceJobPosting,
  WorkforceLeaveBalance,
  WorkforceLeaveRequest,
  WorkforceLeaveType,
  WorkforceManpowerPlan,
  WorkforceOvertimeRequest,
  WorkforcePayrollRun,
  WorkforcePayslip,
  WorkforcePerformanceReview,
  WorkforceRoster,
  WorkforceShift,
  WorkforceStatutoryPolicy,
  WorkforceTrainingCourse,
  WorkforceTrainingEnrollment,
} from "../domain/workforce-advanced.entity.js";

function toDateString(val: unknown): string {
  if (!val) return "";
  if (typeof val === "string") {
    return val.includes("T") ? val.slice(0, 10) : val;
  }
  if (val instanceof Date) {
    return val.toISOString().slice(0, 10);
  }
  return String(val);
}

function toNullableDateString(val: unknown): string | null {
  if (!val) return null;
  if (typeof val === "string") {
    return val.includes("T") ? val.slice(0, 10) : val;
  }
  if (val instanceof Date) {
    return val.toISOString().slice(0, 10);
  }
  return String(val);
}

function toDate(val: unknown): Date {
  if (val instanceof Date) return val;
  if (typeof val === "string" || typeof val === "number") return new Date(val);
  return new Date();
}

function toNullableDate(val: unknown): Date | null {
  if (val === null || val === undefined) return null;
  if (val instanceof Date) return val;
  if (typeof val === "string" || typeof val === "number") return new Date(val);
  return null;
}

export class PgWorkforceAdvancedRepository implements WorkforceAdvancedRepository {
  constructor(private readonly pool: Pool) {}

  private async inTransaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const result = await fn(client);
      await client.query("COMMIT");
      return result;
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  }

  // ---------------------------------------------------------------------------
  // Core Reference Ports
  // ---------------------------------------------------------------------------
  async findEmployeeReference(tenantId: string, employeeId: string): Promise<EmployeeReference | null> {
    const res = await this.pool.query(
      `SELECT e.id, e.employee_number, e.full_name, e.employment_status,
              e.organization_unit_id, e.position_id
       FROM employees e
       WHERE e.tenant_id = $1 AND e.id = $2`,
      [tenantId, employeeId],
    );
    if (res.rows.length === 0) return null;
    const r = res.rows[0];
    return {
      id: r.id,
      employeeNumber: r.employee_number,
      fullName: r.full_name,
      organizationUnitId: r.organization_unit_id ?? null,
      positionId: r.position_id ?? null,
      employmentStatus: r.employment_status,
    };
  }

  async listActiveEmployeeReferences(tenantId: string, organizationUnitId?: string | null): Promise<EmployeeReference[]> {
    const params: unknown[] = [tenantId];
    let sql = `
      SELECT e.id, e.employee_number, e.full_name, e.employment_status,
             e.organization_unit_id, e.position_id
      FROM employees e
      WHERE e.tenant_id = $1 AND e.employment_status = 'active'
    `;
    if (organizationUnitId) {
      params.push(organizationUnitId);
      sql += ` AND e.organization_unit_id = $${params.length}`;
    }
    sql += ` ORDER BY e.employee_number ASC`;
    const res = await this.pool.query(sql, params);
    return res.rows.map((r) => ({
      id: r.id,
      employeeNumber: r.employee_number,
      fullName: r.full_name,
      organizationUnitId: r.organization_unit_id ?? null,
      positionId: r.position_id ?? null,
      employmentStatus: r.employment_status,
    }));
  }

  async positionExists(tenantId: string, positionId: string): Promise<boolean> {
    const res = await this.pool.query(
      `SELECT 1 FROM positions WHERE tenant_id = $1 AND id = $2`,
      [tenantId, positionId],
    );
    return (res.rowCount ?? 0) > 0;
  }

  async organizationUnitExists(tenantId: string, organizationUnitId: string): Promise<boolean> {
    const res = await this.pool.query(
      `SELECT 1 FROM organization_units WHERE tenant_id = $1 AND id = $2`,
      [tenantId, organizationUnitId],
    );
    return (res.rowCount ?? 0) > 0;
  }

  // ---------------------------------------------------------------------------
  // 1. Shifts, Roster & Attendance (HR-ADV-001 / HR-ADV-002)
  // ---------------------------------------------------------------------------
  async createShift(input: CreateShiftInput): Promise<WorkforceShift> {
    const res = await this.pool.query(
      `INSERT INTO workforce_shifts (
        tenant_id, shift_code, name, start_time, end_time, break_minutes, is_overnight, created_by
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING *`,
      [
        input.tenantId,
        input.shiftCode,
        input.name,
        input.startTime,
        input.endTime,
        input.breakMinutes ?? 0,
        input.isOvernight ?? false,
        input.createdBy ?? null,
      ],
    );
    return this.mapShift(res.rows[0]);
  }

  async findShiftById(tenantId: string, id: string): Promise<WorkforceShift | null> {
    const res = await this.pool.query(
      `SELECT * FROM workforce_shifts WHERE tenant_id = $1 AND id = $2`,
      [tenantId, id],
    );
    return res.rows.length > 0 ? this.mapShift(res.rows[0]) : null;
  }

  async listShifts(tenantId: string, includeInactive = false): Promise<WorkforceShift[]> {
    const params: unknown[] = [tenantId];
    let sql = `SELECT * FROM workforce_shifts WHERE tenant_id = $1`;
    if (!includeInactive) {
      sql += ` AND is_active = true`;
    }
    sql += ` ORDER BY shift_code ASC`;
    const res = await this.pool.query(sql, params);
    return res.rows.map(this.mapShift);
  }

  async setShiftActive(tenantId: string, id: string, isActive: boolean): Promise<WorkforceShift> {
    const res = await this.pool.query(
      `UPDATE workforce_shifts SET is_active = $3, updated_at = NOW()
       WHERE tenant_id = $1 AND id = $2
       RETURNING *`,
      [tenantId, id, isActive],
    );
    if (res.rows.length === 0) {
      throw new Error(`Shift ${id} not found`);
    }
    return this.mapShift(res.rows[0]);
  }

  async upsertRoster(input: UpsertRosterInput): Promise<WorkforceRoster> {
    const res = await this.pool.query(
      `INSERT INTO workforce_rosters (
        tenant_id, employee_id, shift_id, roster_date, organization_unit_id, notes, created_by
      ) VALUES ($1, $2, $3, $4, $5, $6, $7)
      ON CONFLICT (tenant_id, employee_id, roster_date)
      DO UPDATE SET shift_id = EXCLUDED.shift_id,
                    organization_unit_id = EXCLUDED.organization_unit_id,
                    notes = EXCLUDED.notes,
                    updated_by = EXCLUDED.created_by,
                    updated_at = NOW()
      RETURNING *`,
      [
        input.tenantId,
        input.employeeId,
        input.shiftId,
        input.rosterDate,
        input.organizationUnitId ?? null,
        input.notes ?? null,
        input.actorUserId ?? null,
      ],
    );
    return this.mapRoster(res.rows[0]);
  }

  async listRosters(tenantId: string, filter: RosterListFilter): Promise<WorkforceRoster[]> {
    const params: unknown[] = [tenantId];
    let sql = `SELECT * FROM workforce_rosters WHERE tenant_id = $1`;
    if (filter.employeeId) {
      params.push(filter.employeeId);
      sql += ` AND employee_id = $${params.length}`;
    }
    if (filter.organizationUnitId) {
      params.push(filter.organizationUnitId);
      sql += ` AND organization_unit_id = $${params.length}`;
    }
    if (filter.fromDate) {
      params.push(filter.fromDate);
      sql += ` AND roster_date >= $${params.length}`;
    }
    if (filter.toDate) {
      params.push(filter.toDate);
      sql += ` AND roster_date <= $${params.length}`;
    }
    sql += ` ORDER BY roster_date ASC, employee_id ASC`;
    const res = await this.pool.query(sql, params);
    return res.rows.map(this.mapRoster);
  }

  async recordAttendance(input: RecordAttendanceInput): Promise<WorkforceAttendanceRecord> {
    const res = await this.pool.query(
      `INSERT INTO workforce_attendance_records (
        tenant_id, employee_id, attendance_date, shift_id, clock_in, clock_out,
        status, source, notes
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      ON CONFLICT (tenant_id, employee_id, attendance_date)
      DO UPDATE SET shift_id = COALESCE(EXCLUDED.shift_id, workforce_attendance_records.shift_id),
                    clock_in = COALESCE(EXCLUDED.clock_in, workforce_attendance_records.clock_in),
                    clock_out = COALESCE(EXCLUDED.clock_out, workforce_attendance_records.clock_out),
                    status = COALESCE(EXCLUDED.status, workforce_attendance_records.status),
                    source = COALESCE(EXCLUDED.source, workforce_attendance_records.source),
                    notes = COALESCE(EXCLUDED.notes, workforce_attendance_records.notes),
                    updated_at = NOW()
      RETURNING *`,
      [
        input.tenantId,
        input.employeeId,
        input.attendanceDate,
        input.shiftId ?? null,
        input.clockIn ?? null,
        input.clockOut ?? null,
        input.status ?? "present",
        input.source ?? "manual",
        input.notes ?? null,
      ],
    );
    return this.mapAttendance(res.rows[0]);
  }

  async listAttendance(tenantId: string, filter: AttendanceListFilter): Promise<WorkforceAttendanceRecord[]> {
    const params: unknown[] = [tenantId];
    let sql = `SELECT * FROM workforce_attendance_records WHERE tenant_id = $1`;
    if (filter.employeeId) {
      params.push(filter.employeeId);
      sql += ` AND employee_id = $${params.length}`;
    }
    if (filter.fromDate) {
      params.push(filter.fromDate);
      sql += ` AND attendance_date >= $${params.length}`;
    }
    if (filter.toDate) {
      params.push(filter.toDate);
      sql += ` AND attendance_date <= $${params.length}`;
    }
    if (filter.status) {
      params.push(filter.status);
      sql += ` AND status = $${params.length}`;
    }
    sql += ` ORDER BY attendance_date DESC, employee_id ASC`;
    const res = await this.pool.query(sql, params);
    return res.rows.map(this.mapAttendance);
  }

  // ---------------------------------------------------------------------------
  // 2. Leave & Overtime (HR-ADV-003 / HR-ADV-004)
  // ---------------------------------------------------------------------------
  async createLeaveType(input: CreateLeaveTypeInput): Promise<WorkforceLeaveType> {
    const res = await this.pool.query(
      `INSERT INTO workforce_leave_types (
        tenant_id, code, name, annual_allowance_days, is_paid, requires_attachment, created_by
      ) VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING *`,
      [
        input.tenantId,
        input.code,
        input.name,
        input.annualAllowanceDays ?? 0,
        input.isPaid ?? true,
        input.requiresAttachment ?? false,
        input.createdBy ?? null,
      ],
    );
    return this.mapLeaveType(res.rows[0]);
  }

  async listLeaveTypes(tenantId: string, includeInactive = false): Promise<WorkforceLeaveType[]> {
    const params: unknown[] = [tenantId];
    let sql = `SELECT * FROM workforce_leave_types WHERE tenant_id = $1`;
    if (!includeInactive) {
      sql += ` AND is_active = true`;
    }
    sql += ` ORDER BY code ASC`;
    const res = await this.pool.query(sql, params);
    return res.rows.map(this.mapLeaveType);
  }

  async setLeaveAllocation(input: SetLeaveAllocationInput): Promise<WorkforceLeaveBalance> {
    const res = await this.pool.query(
      `INSERT INTO workforce_leave_balances (
        tenant_id, employee_id, leave_type_id, balance_year, allocated_days, used_days, pending_days
      ) VALUES ($1, $2, $3, $4, $5, 0, 0)
      ON CONFLICT (tenant_id, employee_id, leave_type_id, balance_year)
      DO UPDATE SET allocated_days = EXCLUDED.allocated_days,
                    updated_at = NOW()
      RETURNING *`,
      [
        input.tenantId,
        input.employeeId,
        input.leaveTypeId,
        input.balanceYear,
        input.allocatedDays,
      ],
    );
    return this.mapLeaveBalance(res.rows[0]);
  }

  async findLeaveBalance(tenantId: string, employeeId: string, leaveTypeId: string, balanceYear: number): Promise<WorkforceLeaveBalance | null> {
    const res = await this.pool.query(
      `SELECT * FROM workforce_leave_balances
       WHERE tenant_id = $1 AND employee_id = $2 AND leave_type_id = $3 AND balance_year = $4`,
      [tenantId, employeeId, leaveTypeId, balanceYear],
    );
    return res.rows.length > 0 ? this.mapLeaveBalance(res.rows[0]) : null;
  }

  async listLeaveBalances(tenantId: string, employeeId: string, balanceYear: number): Promise<WorkforceLeaveBalance[]> {
    const res = await this.pool.query(
      `SELECT * FROM workforce_leave_balances
       WHERE tenant_id = $1 AND employee_id = $2 AND balance_year = $3
       ORDER BY leave_type_id ASC`,
      [tenantId, employeeId, balanceYear],
    );
    return res.rows.map(this.mapLeaveBalance);
  }

  async adjustLeaveBalancePending(
    tenantId: string,
    employeeId: string,
    leaveTypeId: string,
    balanceYear: number,
    pendingDelta: number,
    usedDelta: number,
  ): Promise<void> {
    await this.pool.query(
      `UPDATE workforce_leave_balances
       SET pending_days = pending_days + $5,
           used_days = used_days + $6,
           updated_at = NOW()
       WHERE tenant_id = $1 AND employee_id = $2 AND leave_type_id = $3 AND balance_year = $4`,
      [tenantId, employeeId, leaveTypeId, balanceYear, pendingDelta, usedDelta],
    );
  }

  async createLeaveRequest(input: CreateLeaveRequestInput, requestNumber: string): Promise<WorkforceLeaveRequest> {
    const res = await this.pool.query(
      `INSERT INTO workforce_leave_requests (
        tenant_id, request_number, employee_id, leave_type_id, start_date, end_date, total_days,
        reason, attachment_document_id, submitted_at, created_by
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW(), $10)
      RETURNING *`,
      [
        input.tenantId,
        requestNumber,
        input.employeeId,
        input.leaveTypeId,
        input.startDate,
        input.endDate,
        input.totalDays,
        input.reason ?? null,
        input.attachmentDocumentId ?? null,
        input.actorUserId,
      ],
    );
    return this.mapLeaveRequest(res.rows[0]);
  }

  async findLeaveRequestById(tenantId: string, id: string): Promise<WorkforceLeaveRequest | null> {
    const res = await this.pool.query(
      `SELECT * FROM workforce_leave_requests WHERE tenant_id = $1 AND id = $2`,
      [tenantId, id],
    );
    return res.rows.length > 0 ? this.mapLeaveRequest(res.rows[0]) : null;
  }

  async listLeaveRequests(tenantId: string, filter: LeaveRequestListFilter): Promise<WorkforceLeaveRequest[]> {
    const params: unknown[] = [tenantId];
    let sql = `SELECT * FROM workforce_leave_requests WHERE tenant_id = $1`;
    if (filter.employeeId) {
      params.push(filter.employeeId);
      sql += ` AND employee_id = $${params.length}`;
    }
    if (filter.leaveTypeId) {
      params.push(filter.leaveTypeId);
      sql += ` AND leave_type_id = $${params.length}`;
    }
    if (filter.fromDate) {
      params.push(filter.fromDate);
      sql += ` AND start_date >= $${params.length}`;
    }
    if (filter.toDate) {
      params.push(filter.toDate);
      sql += ` AND end_date <= $${params.length}`;
    }
    sql += ` ORDER BY submitted_at DESC, id DESC`;
    const res = await this.pool.query(sql, params);
    return res.rows.map(this.mapLeaveRequest);
  }

  async setLeaveRequestWorkflowInstance(tenantId: string, id: string, workflowInstanceId: string): Promise<void> {
    await this.pool.query(
      `UPDATE workforce_leave_requests SET workflow_instance_id = $3, updated_at = NOW()
       WHERE tenant_id = $1 AND id = $2`,
      [tenantId, id, workflowInstanceId],
    );
  }

  async projectLeaveRequestDecision(tenantId: string, id: string, decision: "approved" | "rejected" | "cancelled", at: Date): Promise<WorkforceLeaveRequest> {
    let updateField = "";
    if (decision === "approved") updateField = "approved_at = $3";
    else if (decision === "rejected") updateField = "rejected_at = $3";
    else if (decision === "cancelled") updateField = "cancelled_at = $3";

    const res = await this.pool.query(
      `UPDATE workforce_leave_requests SET ${updateField}, updated_at = NOW()
       WHERE tenant_id = $1 AND id = $2
       RETURNING *`,
      [tenantId, id, at],
    );
    if (res.rows.length === 0) {
      throw new Error(`Leave request ${id} not found`);
    }
    return this.mapLeaveRequest(res.rows[0]);
  }

  async deleteLeaveRequestWithoutWorkflow(tenantId: string, id: string): Promise<void> {
    await this.pool.query(
      `DELETE FROM workforce_leave_requests WHERE tenant_id = $1 AND id = $2 AND workflow_instance_id IS NULL`,
      [tenantId, id],
    );
  }

  async createOvertimeRequest(input: CreateOvertimeRequestInput, requestNumber: string): Promise<WorkforceOvertimeRequest> {
    const res = await this.pool.query(
      `INSERT INTO workforce_overtime_requests (
        tenant_id, request_number, employee_id, overtime_date, start_time, end_time,
        estimated_hours, reason, submitted_at, created_by
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW(), $9)
      RETURNING *`,
      [
        input.tenantId,
        requestNumber,
        input.employeeId,
        input.overtimeDate,
        input.startTime,
        input.endTime,
        input.estimatedHours,
        input.reason ?? null,
        input.actorUserId,
      ],
    );
    return this.mapOvertimeRequest(res.rows[0]);
  }

  async findOvertimeRequestById(tenantId: string, id: string): Promise<WorkforceOvertimeRequest | null> {
    const res = await this.pool.query(
      `SELECT * FROM workforce_overtime_requests WHERE tenant_id = $1 AND id = $2`,
      [tenantId, id],
    );
    return res.rows.length > 0 ? this.mapOvertimeRequest(res.rows[0]) : null;
  }

  async listOvertimeRequests(tenantId: string, filter: OvertimeRequestListFilter): Promise<WorkforceOvertimeRequest[]> {
    const params: unknown[] = [tenantId];
    let sql = `SELECT * FROM workforce_overtime_requests WHERE tenant_id = $1`;
    if (filter.employeeId) {
      params.push(filter.employeeId);
      sql += ` AND employee_id = $${params.length}`;
    }
    if (filter.fromDate) {
      params.push(filter.fromDate);
      sql += ` AND overtime_date >= $${params.length}`;
    }
    if (filter.toDate) {
      params.push(filter.toDate);
      sql += ` AND overtime_date <= $${params.length}`;
    }
    sql += ` ORDER BY submitted_at DESC, id DESC`;
    const res = await this.pool.query(sql, params);
    return res.rows.map(this.mapOvertimeRequest);
  }

  async setOvertimeRequestWorkflowInstance(tenantId: string, id: string, workflowInstanceId: string): Promise<void> {
    await this.pool.query(
      `UPDATE workforce_overtime_requests SET workflow_instance_id = $3, updated_at = NOW()
       WHERE tenant_id = $1 AND id = $2`,
      [tenantId, id, workflowInstanceId],
    );
  }

  async projectOvertimeRequestDecision(tenantId: string, id: string, decision: "approved" | "rejected" | "cancelled", at: Date): Promise<WorkforceOvertimeRequest> {
    let updateField = "";
    if (decision === "approved") updateField = "approved_at = $3";
    else if (decision === "rejected") updateField = "rejected_at = $3";
    else if (decision === "cancelled") updateField = "cancelled_at = $3";

    const res = await this.pool.query(
      `UPDATE workforce_overtime_requests SET ${updateField}, updated_at = NOW()
       WHERE tenant_id = $1 AND id = $2
       RETURNING *`,
      [tenantId, id, at],
    );
    if (res.rows.length === 0) {
      throw new Error(`Overtime request ${id} not found`);
    }
    return this.mapOvertimeRequest(res.rows[0]);
  }

  async recordActualOvertimeHours(input: RecordActualOvertimeInput): Promise<WorkforceOvertimeRequest> {
    const res = await this.pool.query(
      `UPDATE workforce_overtime_requests SET actual_hours = $3, updated_at = NOW()
       WHERE tenant_id = $1 AND id = $2
       RETURNING *`,
      [input.tenantId, input.id, input.actualHours],
    );
    if (res.rows.length === 0) {
      throw new Error(`Overtime request ${input.id} not found`);
    }
    return this.mapOvertimeRequest(res.rows[0]);
  }

  async deleteOvertimeRequestWithoutWorkflow(tenantId: string, id: string): Promise<void> {
    await this.pool.query(
      `DELETE FROM workforce_overtime_requests WHERE tenant_id = $1 AND id = $2 AND workflow_instance_id IS NULL`,
      [tenantId, id],
    );
  }

  // ---------------------------------------------------------------------------
  // 3. Payroll, BPJS & PPh 21 (HR-ADV-005)
  // ---------------------------------------------------------------------------
  async createStatutoryPolicy(input: CreateStatutoryPolicyInput): Promise<WorkforceStatutoryPolicy> {
    const res = await this.pool.query(
      `INSERT INTO workforce_statutory_policies (
        tenant_id, policy_code, name, country_code, effective_from, effective_to,
        bpjs_kesehatan_rate_employer, bpjs_kesehatan_rate_employee, bpjs_kesehatan_cap,
        bpjs_tk_jht_rate_employer, bpjs_tk_jht_rate_employee,
        bpjs_tk_jkk_rate, bpjs_tk_jkm_rate,
        bpjs_tk_jp_rate_employer, bpjs_tk_jp_rate_employee, bpjs_tk_jp_cap,
        occupational_cost_rate, occupational_cost_monthly_cap,
        ptkp_annual_amounts, pph21_brackets, pph21_ter_brackets, pph21_method,
        non_npwp_surcharge_rate, rounding_mode, created_by
      ) VALUES (
        $1, $2, $3, $4, $5, $6,
        $7, $8, $9,
        $10, $11,
        $12, $13,
        $14, $15, $16,
        $17, $18,
        $19, $20, $21, $22,
        $23, $24, $25
      ) RETURNING *`,
      [
        input.tenantId,
        input.policyCode,
        input.name,
        input.countryCode ?? "ID",
        input.effectiveFrom,
        input.effectiveTo ?? null,
        input.bpjsKesehatanRateEmployer ?? 0.04,
        input.bpjsKesehatanRateEmployee ?? 0.01,
        input.bpjsKesehatanCap ?? null,
        input.bpjsTkJhtRateEmployer ?? 0.037,
        input.bpjsTkJhtRateEmployee ?? 0.02,
        input.bpjsTkJkkRate ?? 0.0024,
        input.bpjsTkJkmRate ?? 0.003,
        input.bpjsTkJpRateEmployer ?? 0.02,
        input.bpjsTkJpRateEmployee ?? 0.01,
        input.bpjsTkJpCap ?? null,
        input.occupationalCostRate ?? 0.05,
        input.occupationalCostMonthlyCap ?? 500000,
        JSON.stringify(input.ptkpAnnualAmounts ?? {}),
        JSON.stringify(input.pph21Brackets ?? []),
        JSON.stringify(input.pph21TerBrackets ?? []),
        input.pph21Method ?? "annualized",
        input.nonNpwpSurchargeRate ?? 0.20,
        input.roundingMode ?? "half_up",
        input.createdBy ?? null,
      ],
    );
    return this.mapStatutoryPolicy(res.rows[0]);
  }

  async findActiveStatutoryPolicy(tenantId: string, asOfDate: string): Promise<WorkforceStatutoryPolicy | null> {
    const res = await this.pool.query(
      `SELECT * FROM workforce_statutory_policies
       WHERE tenant_id = $1 AND is_active = true
         AND effective_from <= $2
         AND (effective_to IS NULL OR effective_to >= $2)
       ORDER BY effective_from DESC
       LIMIT 1`,
      [tenantId, asOfDate],
    );
    return res.rows.length > 0 ? this.mapStatutoryPolicy(res.rows[0]) : null;
  }

  async listStatutoryPolicies(tenantId: string): Promise<WorkforceStatutoryPolicy[]> {
    const res = await this.pool.query(
      `SELECT * FROM workforce_statutory_policies WHERE tenant_id = $1 ORDER BY effective_from DESC`,
      [tenantId],
    );
    return res.rows.map(this.mapStatutoryPolicy);
  }

  async setSalaryProfile(input: SetSalaryProfileInput): Promise<WorkforceEmployeeSalaryProfile> {
    const res = await this.pool.query(
      `INSERT INTO workforce_employee_salary_profiles (
        tenant_id, employee_id, base_salary, fixed_allowance, overtime_hourly_rate,
        ptkp_status, has_npwp, bpjs_kesehatan_number, bpjs_tk_number,
        bank_name, bank_account_number, effective_from, created_by
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
      RETURNING *`,
      [
        input.tenantId,
        input.employeeId,
        input.baseSalary,
        input.fixedAllowance ?? 0,
        input.overtimeHourlyRate ?? null,
        input.ptkpStatus ?? "TK/0",
        input.hasNpwp ?? true,
        input.bpjsKesehatanNumber ?? null,
        input.bpjsTkNumber ?? null,
        input.bankName ?? null,
        input.bankAccountNumber ?? null,
        input.effectiveFrom,
        input.actorUserId ?? null,
      ],
    );
    return this.mapSalaryProfile(res.rows[0]);
  }

  async findCurrentSalaryProfile(tenantId: string, employeeId: string): Promise<WorkforceEmployeeSalaryProfile | null> {
    const res = await this.pool.query(
      `SELECT * FROM workforce_employee_salary_profiles
       WHERE tenant_id = $1 AND employee_id = $2
         AND effective_from <= CURRENT_DATE
         AND (effective_to IS NULL OR effective_to >= CURRENT_DATE)
       ORDER BY effective_from DESC
       LIMIT 1`,
      [tenantId, employeeId],
    );
    return res.rows.length > 0 ? this.mapSalaryProfile(res.rows[0]) : null;
  }

  async closeOpenSalaryProfile(tenantId: string, employeeId: string, effectiveTo: string): Promise<void> {
    await this.pool.query(
      `UPDATE workforce_employee_salary_profiles
       SET effective_to = $3, updated_at = NOW()
       WHERE tenant_id = $1 AND employee_id = $2 AND effective_to IS NULL`,
      [tenantId, employeeId, effectiveTo],
    );
  }

  async createPayrollRun(input: CreatePayrollRunInput, runNumber: string): Promise<WorkforcePayrollRun> {
    const res = await this.pool.query(
      `INSERT INTO workforce_payroll_runs (
        tenant_id, run_number, period_month, period_year, organization_unit_id, created_by
      ) VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING *`,
      [
        input.tenantId,
        runNumber,
        input.periodMonth,
        input.periodYear,
        input.organizationUnitId ?? null,
        input.actorUserId,
      ],
    );
    return this.mapPayrollRun(res.rows[0]);
  }

  async findPayrollRunById(tenantId: string, id: string): Promise<WorkforcePayrollRun | null> {
    const res = await this.pool.query(
      `SELECT * FROM workforce_payroll_runs WHERE tenant_id = $1 AND id = $2`,
      [tenantId, id],
    );
    return res.rows.length > 0 ? this.mapPayrollRun(res.rows[0]) : null;
  }

  async listPayrollRuns(tenantId: string, filter: PayrollRunListFilter): Promise<WorkforcePayrollRun[]> {
    const params: unknown[] = [tenantId];
    let sql = `SELECT * FROM workforce_payroll_runs WHERE tenant_id = $1`;
    if (filter.organizationUnitId) {
      params.push(filter.organizationUnitId);
      sql += ` AND organization_unit_id = $${params.length}`;
    }
    if (filter.periodYear) {
      params.push(filter.periodYear);
      sql += ` AND period_year = $${params.length}`;
    }
    sql += ` ORDER BY period_year DESC, period_month DESC, id DESC`;
    const res = await this.pool.query(sql, params);
    return res.rows.map(this.mapPayrollRun);
  }

  async setPayrollRunWorkflowInstance(tenantId: string, id: string, workflowInstanceId: string): Promise<void> {
    await this.pool.query(
      `UPDATE workforce_payroll_runs SET workflow_instance_id = $3, updated_at = NOW()
       WHERE tenant_id = $1 AND id = $2`,
      [tenantId, id, workflowInstanceId],
    );
  }

  async deletePayrollRunWithoutWorkflow(tenantId: string, id: string): Promise<void> {
    await this.pool.query(
      `DELETE FROM workforce_payroll_runs WHERE tenant_id = $1 AND id = $2 AND workflow_instance_id IS NULL`,
      [tenantId, id],
    );
  }

  async savePayslipsAndTotals(
    tenantId: string,
    payrollRunId: string,
    payslips: Array<Omit<WorkforcePayslip, "id" | "tenantId" | "payrollRunId" | "createdAt">>,
    totals: { totalGross: number; totalDeductions: number; totalNet: number; totalEmployerContributions: number; employeeCount: number },
  ): Promise<void> {
    await this.inTransaction(async (client) => {
      await client.query(
        `DELETE FROM workforce_payslips WHERE tenant_id = $1 AND payroll_run_id = $2`,
        [tenantId, payrollRunId],
      );

      for (const p of payslips) {
        await client.query(
          `INSERT INTO workforce_payslips (
            tenant_id, payroll_run_id, employee_id, base_salary, allowances, overtime_hours, overtime_pay, gross_salary,
            bpjs_kesehatan_employee, bpjs_kesehatan_employer,
            bpjs_tk_jht_employee, bpjs_tk_jht_employer,
            bpjs_tk_jkk_employer, bpjs_tk_jkm_employer,
            bpjs_tk_jp_employee, bpjs_tk_jp_employer,
            pph21_withheld, other_deductions, total_deductions, employer_contributions,
            net_salary, ptkp_status, calculation_breakdown
          ) VALUES (
            $1, $2, $3, $4, $5, $6, $7, $8,
            $9, $10,
            $11, $12,
            $13, $14,
            $15, $16,
            $17, $18, $19, $20,
            $21, $22, $23
          )`,
          [
            tenantId,
            payrollRunId,
            p.employeeId,
            p.baseSalary,
            p.allowances,
            p.overtimeHours,
            p.overtimePay,
            p.grossSalary,
            p.bpjsKesehatanEmployee,
            p.bpjsKesehatanEmployer,
            p.bpjsTkJhtEmployee,
            p.bpjsTkJhtEmployer,
            p.bpjsTkJkkEmployer,
            p.bpjsTkJkmEmployer,
            p.bpjsTkJpEmployee,
            p.bpjsTkJpEmployer,
            p.pph21Withheld,
            p.otherDeductions,
            p.totalDeductions,
            p.employerContributions,
            p.netSalary,
            p.ptkpStatus ?? null,
            JSON.stringify(p.calculationBreakdown ?? {}),
          ],
        );
      }

      await client.query(
        `UPDATE workforce_payroll_runs
         SET total_gross = $3,
             total_deductions = $4,
             total_net = $5,
             total_employer_contributions = $6,
             employee_count = $7,
             calculated_at = NOW(),
             updated_at = NOW()
         WHERE tenant_id = $1 AND id = $2`,
        [
          tenantId,
          payrollRunId,
          totals.totalGross,
          totals.totalDeductions,
          totals.totalNet,
          totals.totalEmployerContributions,
          totals.employeeCount,
        ],
      );
    });
  }

  async projectPayrollRunDecision(tenantId: string, id: string, decision: "approved" | "closed", at: Date): Promise<WorkforcePayrollRun> {
    let updateField = "";
    if (decision === "approved") updateField = "approved_at = $3";
    else if (decision === "closed") updateField = "closed_at = $3";

    const res = await this.pool.query(
      `UPDATE workforce_payroll_runs SET ${updateField}, updated_at = NOW()
       WHERE tenant_id = $1 AND id = $2
       RETURNING *`,
      [tenantId, id, at],
    );
    if (res.rows.length === 0) {
      throw new Error(`Payroll run ${id} not found`);
    }
    return this.mapPayrollRun(res.rows[0]);
  }

  async listPayslipsByRun(tenantId: string, payrollRunId: string): Promise<WorkforcePayslip[]> {
    const res = await this.pool.query(
      `SELECT * FROM workforce_payslips WHERE tenant_id = $1 AND payroll_run_id = $2 ORDER BY id ASC`,
      [tenantId, payrollRunId],
    );
    return res.rows.map(this.mapPayslip);
  }

  // ---------------------------------------------------------------------------
  // 4. Recruitment (HR-ADV-006)
  // ---------------------------------------------------------------------------
  async createJobPosting(input: CreateJobPostingInput, postingCode: string): Promise<WorkforceJobPosting> {
    const res = await this.pool.query(
      `INSERT INTO workforce_job_postings (
        tenant_id, posting_code, title, position_id, organization_unit_id,
        headcount_target, employment_type, job_description, status, created_by
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'draft', $9)
      RETURNING *`,
      [
        input.tenantId,
        postingCode,
        input.title,
        input.positionId ?? null,
        input.organizationUnitId ?? null,
        input.headcountTarget ?? 1,
        input.employmentType ?? "permanent",
        input.jobDescription ?? null,
        input.actorUserId,
      ],
    );
    return this.mapJobPosting(res.rows[0]);
  }

  async findJobPostingById(tenantId: string, id: string): Promise<WorkforceJobPosting | null> {
    const res = await this.pool.query(
      `SELECT * FROM workforce_job_postings WHERE tenant_id = $1 AND id = $2`,
      [tenantId, id],
    );
    return res.rows.length > 0 ? this.mapJobPosting(res.rows[0]) : null;
  }

  async listJobPostings(tenantId: string, filter: JobPostingListFilter): Promise<WorkforceJobPosting[]> {
    const params: unknown[] = [tenantId];
    let sql = `SELECT * FROM workforce_job_postings WHERE tenant_id = $1`;
    if (filter.status) {
      params.push(filter.status);
      sql += ` AND status = $${params.length}`;
    }
    if (filter.organizationUnitId) {
      params.push(filter.organizationUnitId);
      sql += ` AND organization_unit_id = $${params.length}`;
    }
    sql += ` ORDER BY created_at DESC`;
    const res = await this.pool.query(sql, params);
    return res.rows.map(this.mapJobPosting);
  }

  async setJobPostingWorkflowInstance(tenantId: string, id: string, workflowInstanceId: string): Promise<void> {
    await this.pool.query(
      `UPDATE workforce_job_postings SET workflow_instance_id = $3, updated_at = NOW()
       WHERE tenant_id = $1 AND id = $2`,
      [tenantId, id, workflowInstanceId],
    );
  }

  async projectJobPostingDecision(tenantId: string, id: string, decision: "published" | "closed" | "cancelled", at: Date): Promise<WorkforceJobPosting> {
    let updateField = "status = $3";
    if (decision === "published") updateField += ", published_at = $4";
    else if (decision === "closed" || decision === "cancelled") updateField += ", closed_at = $4";

    const res = await this.pool.query(
      `UPDATE workforce_job_postings SET ${updateField}, updated_at = NOW()
       WHERE tenant_id = $1 AND id = $2
       RETURNING *`,
      [tenantId, id, decision, at],
    );
    if (res.rows.length === 0) {
      throw new Error(`Job posting ${id} not found`);
    }
    return this.mapJobPosting(res.rows[0]);
  }

  async deleteJobPostingWithoutWorkflow(tenantId: string, id: string): Promise<void> {
    await this.pool.query(
      `DELETE FROM workforce_job_postings WHERE tenant_id = $1 AND id = $2 AND workflow_instance_id IS NULL`,
      [tenantId, id],
    );
  }

  async createJobApplication(input: CreateJobApplicationInput): Promise<WorkforceJobApplication> {
    const res = await this.pool.query(
      `INSERT INTO workforce_job_applications (
        tenant_id, job_posting_id, candidate_name, candidate_email, candidate_phone,
        resume_document_id, stage, created_by
      ) VALUES ($1, $2, $3, $4, $5, $6, 'applied', $7)
      RETURNING *`,
      [
        input.tenantId,
        input.jobPostingId,
        input.candidateName,
        input.candidateEmail ?? null,
        input.candidatePhone ?? null,
        input.resumeDocumentId ?? null,
        input.actorUserId ?? null,
      ],
    );
    return this.mapJobApplication(res.rows[0]);
  }

  async findJobApplicationById(tenantId: string, id: string): Promise<WorkforceJobApplication | null> {
    const res = await this.pool.query(
      `SELECT * FROM workforce_job_applications WHERE tenant_id = $1 AND id = $2`,
      [tenantId, id],
    );
    return res.rows.length > 0 ? this.mapJobApplication(res.rows[0]) : null;
  }

  async listJobApplications(tenantId: string, filter: JobApplicationListFilter): Promise<WorkforceJobApplication[]> {
    const params: unknown[] = [tenantId];
    let sql = `SELECT * FROM workforce_job_applications WHERE tenant_id = $1`;
    if (filter.jobPostingId) {
      params.push(filter.jobPostingId);
      sql += ` AND job_posting_id = $${params.length}`;
    }
    if (filter.stage) {
      params.push(filter.stage);
      sql += ` AND stage = $${params.length}`;
    }
    sql += ` ORDER BY applied_at ASC`;
    const res = await this.pool.query(sql, params);
    return res.rows.map(this.mapJobApplication);
  }

  async advanceJobApplication(input: AdvanceJobApplicationInput): Promise<WorkforceJobApplication> {
    const updates: string[] = ["stage = $3"];
    const params: unknown[] = [input.tenantId, input.id, input.stage];
    let idx = 4;

    if (input.rating !== undefined) { updates.push(`rating = $${idx++}`); params.push(input.rating); }
    if (input.interviewerNotes !== undefined) { updates.push(`interviewer_notes = $${idx++}`); params.push(input.interviewerNotes); }
    if (input.hiredEmployeeId !== undefined) { updates.push(`hired_employee_id = $${idx++}`); params.push(input.hiredEmployeeId); }

    if (input.stage === "hired" || input.stage === "rejected" || input.stage === "withdrawn") {
      updates.push(`decided_at = NOW()`);
    }

    const res = await this.pool.query(
      `UPDATE workforce_job_applications SET ${updates.join(", ")}, updated_at = NOW()
       WHERE tenant_id = $1 AND id = $2
       RETURNING *`,
      params,
    );
    if (res.rows.length === 0) {
      throw new Error(`Job application ${input.id} not found`);
    }
    return this.mapJobApplication(res.rows[0]);
  }

  // ---------------------------------------------------------------------------
  // 5. Competency, Training, Performance & Career (HR-ADV-007 / HR-ADV-008)
  // ---------------------------------------------------------------------------
  async createCompetency(input: CreateCompetencyInput): Promise<WorkforceCompetency> {
    const res = await this.pool.query(
      `INSERT INTO workforce_competencies (
        tenant_id, code, name, category, description, scale_min, scale_max, created_by
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING *`,
      [
        input.tenantId,
        input.code,
        input.name,
        input.category ?? null,
        input.description ?? null,
        input.scaleMin ?? 1,
        input.scaleMax ?? 5,
        input.createdBy ?? null,
      ],
    );
    return this.mapCompetency(res.rows[0]);
  }

  async listCompetencies(tenantId: string, includeInactive = false): Promise<WorkforceCompetency[]> {
    const params: unknown[] = [tenantId];
    let sql = `SELECT * FROM workforce_competencies WHERE tenant_id = $1`;
    if (!includeInactive) {
      sql += ` AND is_active = true`;
    }
    sql += ` ORDER BY code ASC`;
    const res = await this.pool.query(sql, params);
    return res.rows.map(this.mapCompetency);
  }

  async assessEmployeeCompetency(input: AssessEmployeeCompetencyInput): Promise<WorkforceEmployeeCompetency> {
    const res = await this.pool.query(
      `INSERT INTO workforce_employee_competencies (
        tenant_id, employee_id, competency_id, proficiency_level,
        last_assessed_date, assessed_by_user_id, notes
      ) VALUES ($1, $2, $3, $4, CURRENT_DATE, $5, $6)
      ON CONFLICT (tenant_id, employee_id, competency_id)
      DO UPDATE SET proficiency_level = EXCLUDED.proficiency_level,
                    last_assessed_date = CURRENT_DATE,
                    assessed_by_user_id = EXCLUDED.assessed_by_user_id,
                    notes = EXCLUDED.notes,
                    updated_at = NOW()
      RETURNING *`,
      [
        input.tenantId,
        input.employeeId,
        input.competencyId,
        input.proficiencyLevel,
        input.actorUserId,
        input.notes ?? null,
      ],
    );
    return this.mapEmployeeCompetency(res.rows[0]);
  }

  async listEmployeeCompetencies(tenantId: string, employeeId: string): Promise<WorkforceEmployeeCompetency[]> {
    const res = await this.pool.query(
      `SELECT * FROM workforce_employee_competencies
       WHERE tenant_id = $1 AND employee_id = $2
       ORDER BY last_assessed_date DESC NULLS LAST`,
      [tenantId, employeeId],
    );
    return res.rows.map(this.mapEmployeeCompetency);
  }

  async createTrainingCourse(input: CreateTrainingCourseInput): Promise<WorkforceTrainingCourse> {
    const res = await this.pool.query(
      `INSERT INTO workforce_training_courses (
        tenant_id, course_code, title, provider, duration_hours, competency_id, description, created_by
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING *`,
      [
        input.tenantId,
        input.courseCode,
        input.title,
        input.provider ?? null,
        input.durationHours ?? 0,
        input.competencyId ?? null,
        input.description ?? null,
        input.createdBy ?? null,
      ],
    );
    return this.mapTrainingCourse(res.rows[0]);
  }

  async listTrainingCourses(tenantId: string, includeInactive = false): Promise<WorkforceTrainingCourse[]> {
    const params: unknown[] = [tenantId];
    let sql = `SELECT * FROM workforce_training_courses WHERE tenant_id = $1`;
    if (!includeInactive) {
      sql += ` AND is_active = true`;
    }
    sql += ` ORDER BY course_code ASC`;
    const res = await this.pool.query(sql, params);
    return res.rows.map(this.mapTrainingCourse);
  }

  async enrollTraining(input: EnrollTrainingInput): Promise<WorkforceTrainingEnrollment> {
    const res = await this.pool.query(
      `INSERT INTO workforce_training_enrollments (
        tenant_id, training_course_id, employee_id, status, enrolled_at
      ) VALUES ($1, $2, $3, 'enrolled', NOW())
      ON CONFLICT (tenant_id, training_course_id, employee_id)
      DO UPDATE SET status = 'enrolled', updated_at = NOW()
      RETURNING *`,
      [input.tenantId, input.trainingCourseId, input.employeeId],
    );
    return this.mapTrainingEnrollment(res.rows[0]);
  }

  async findTrainingEnrollmentById(tenantId: string, id: string): Promise<WorkforceTrainingEnrollment | null> {
    const res = await this.pool.query(
      `SELECT * FROM workforce_training_enrollments WHERE tenant_id = $1 AND id = $2`,
      [tenantId, id],
    );
    return res.rows.length > 0 ? this.mapTrainingEnrollment(res.rows[0]) : null;
  }

  async completeTraining(input: CompleteTrainingInput): Promise<WorkforceTrainingEnrollment> {
    const res = await this.pool.query(
      `UPDATE workforce_training_enrollments
       SET status = $3,
           completion_date = $4,
           score = $5,
           certificate_document_id = $6,
           updated_at = NOW()
       WHERE tenant_id = $1 AND id = $2
       RETURNING *`,
      [
        input.tenantId,
        input.id,
        input.status,
        input.completionDate,
        input.score ?? null,
        input.certificateDocumentId ?? null,
      ],
    );
    if (res.rows.length === 0) {
      throw new Error(`Training enrollment ${input.id} not found`);
    }
    return this.mapTrainingEnrollment(res.rows[0]);
  }

  async listTrainingEnrollments(tenantId: string, employeeId: string): Promise<WorkforceTrainingEnrollment[]> {
    const res = await this.pool.query(
      `SELECT * FROM workforce_training_enrollments
       WHERE tenant_id = $1 AND employee_id = $2
       ORDER BY enrolled_at DESC`,
      [tenantId, employeeId],
    );
    return res.rows.map(this.mapTrainingEnrollment);
  }

  async createPerformanceReview(input: CreatePerformanceReviewInput, reviewCode: string): Promise<WorkforcePerformanceReview> {
    const res = await this.pool.query(
      `INSERT INTO workforce_performance_reviews (
        tenant_id, review_code, employee_id, period_start, period_end,
        reviewer_user_id, goals_score, competency_score, overall_rating,
        review_notes, development_plan, created_by
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
      RETURNING *`,
      [
        input.tenantId,
        reviewCode,
        input.employeeId,
        input.periodStart,
        input.periodEnd,
        input.reviewerUserId ?? null,
        input.goalsScore ?? null,
        input.competencyScore ?? null,
        input.overallRating ?? null,
        input.reviewNotes ?? null,
        input.developmentPlan ?? null,
        input.actorUserId,
      ],
    );
    return this.mapPerformanceReview(res.rows[0]);
  }

  async findPerformanceReviewById(tenantId: string, id: string): Promise<WorkforcePerformanceReview | null> {
    const res = await this.pool.query(
      `SELECT * FROM workforce_performance_reviews WHERE tenant_id = $1 AND id = $2`,
      [tenantId, id],
    );
    return res.rows.length > 0 ? this.mapPerformanceReview(res.rows[0]) : null;
  }

  async listPerformanceReviews(tenantId: string, filter: PerformanceReviewListFilter): Promise<WorkforcePerformanceReview[]> {
    const params: unknown[] = [tenantId];
    let sql = `SELECT * FROM workforce_performance_reviews WHERE tenant_id = $1`;
    if (filter.employeeId) {
      params.push(filter.employeeId);
      sql += ` AND employee_id = $${params.length}`;
    }
    if (filter.periodYear) {
      params.push(`${filter.periodYear}-%`);
      sql += ` AND period_start::text LIKE $${params.length}`;
    }
    sql += ` ORDER BY period_end DESC, id DESC`;
    const res = await this.pool.query(sql, params);
    return res.rows.map(this.mapPerformanceReview);
  }

  async setPerformanceReviewWorkflowInstance(tenantId: string, id: string, workflowInstanceId: string): Promise<void> {
    await this.pool.query(
      `UPDATE workforce_performance_reviews SET workflow_instance_id = $3, updated_at = NOW()
       WHERE tenant_id = $1 AND id = $2`,
      [tenantId, id, workflowInstanceId],
    );
  }

  async projectPerformanceReviewDecision(tenantId: string, id: string, decision: "submitted" | "finalized", at: Date): Promise<WorkforcePerformanceReview> {
    let updateField = "";
    if (decision === "submitted") updateField = "submitted_at = $3";
    else if (decision === "finalized") updateField = "finalized_at = $3";

    const res = await this.pool.query(
      `UPDATE workforce_performance_reviews SET ${updateField}, updated_at = NOW()
       WHERE tenant_id = $1 AND id = $2
       RETURNING *`,
      [tenantId, id, at],
    );
    if (res.rows.length === 0) {
      throw new Error(`Performance review ${id} not found`);
    }
    return this.mapPerformanceReview(res.rows[0]);
  }

  async deletePerformanceReviewWithoutWorkflow(tenantId: string, id: string): Promise<void> {
    await this.pool.query(
      `DELETE FROM workforce_performance_reviews WHERE tenant_id = $1 AND id = $2 AND workflow_instance_id IS NULL`,
      [tenantId, id],
    );
  }

  async createCareerPath(input: CreateCareerPathInput): Promise<WorkforceCareerPath> {
    const res = await this.pool.query(
      `INSERT INTO workforce_career_paths (
        tenant_id, from_position_id, to_position_id, required_tenure_months,
        required_competency_ids, guidelines, created_by
      ) VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING *`,
      [
        input.tenantId,
        input.fromPositionId,
        input.toPositionId,
        input.requiredTenureMonths ?? 0,
        JSON.stringify(input.requiredCompetencyIds ?? []),
        input.guidelines ?? null,
        input.createdBy ?? null,
      ],
    );
    return this.mapCareerPath(res.rows[0]);
  }

  async listCareerPaths(tenantId: string, fromPositionId?: string): Promise<WorkforceCareerPath[]> {
    const params: unknown[] = [tenantId];
    let sql = `SELECT * FROM workforce_career_paths WHERE tenant_id = $1 AND is_active = true`;
    if (fromPositionId) {
      params.push(fromPositionId);
      sql += ` AND from_position_id = $${params.length}`;
    }
    sql += ` ORDER BY created_at DESC`;
    const res = await this.pool.query(sql, params);
    return res.rows.map(this.mapCareerPath);
  }

  // ---------------------------------------------------------------------------
  // 6. Manpower Planning (HR-ADV-009)
  // ---------------------------------------------------------------------------
  async createManpowerPlan(input: CreateManpowerPlanInput, planNumber: string): Promise<WorkforceManpowerPlan> {
    const res = await this.pool.query(
      `INSERT INTO workforce_manpower_plans (
        tenant_id, plan_number, plan_year, organization_unit_id, title,
        status, parameters, created_by
      ) VALUES ($1, $2, $3, $4, $5, 'draft', $6, $7)
      RETURNING *`,
      [
        input.tenantId,
        planNumber,
        input.planYear,
        input.organizationUnitId ?? null,
        input.title,
        JSON.stringify(input.parameters ?? {}),
        input.actorUserId,
      ],
    );
    return this.mapManpowerPlan(res.rows[0]);
  }

  async findManpowerPlanById(tenantId: string, id: string): Promise<WorkforceManpowerPlan | null> {
    const res = await this.pool.query(
      `SELECT * FROM workforce_manpower_plans WHERE tenant_id = $1 AND id = $2`,
      [tenantId, id],
    );
    return res.rows.length > 0 ? this.mapManpowerPlan(res.rows[0]) : null;
  }

  async listManpowerPlans(tenantId: string, filter: ManpowerPlanListFilter): Promise<WorkforceManpowerPlan[]> {
    const params: unknown[] = [tenantId];
    let sql = `SELECT * FROM workforce_manpower_plans WHERE tenant_id = $1`;
    if (filter.organizationUnitId) {
      params.push(filter.organizationUnitId);
      sql += ` AND organization_unit_id = $${params.length}`;
    }
    if (filter.planYear) {
      params.push(filter.planYear);
      sql += ` AND plan_year = $${params.length}`;
    }
    if (filter.status) {
      params.push(filter.status);
      sql += ` AND status = $${params.length}`;
    }
    sql += ` ORDER BY plan_year DESC, created_at DESC`;
    const res = await this.pool.query(sql, params);
    return res.rows.map(this.mapManpowerPlan);
  }

  async saveManpowerPlanComputation(
    tenantId: string,
    id: string,
    computation: {
      currentHeadcount: number;
      plannedHeadcount: number;
      varianceHeadcount: number;
      currentCostProjection: number;
      plannedCostProjection: number;
      varianceCostProjection: number;
      gapAnalysis: ManpowerGapEntry[];
    },
  ): Promise<WorkforceManpowerPlan> {
    const res = await this.pool.query(
      `UPDATE workforce_manpower_plans
       SET current_headcount = $3,
           planned_headcount = $4,
           variance_headcount = $5,
           current_cost_projection = $6,
           planned_cost_projection = $7,
           variance_cost_projection = $8,
           gap_analysis = $9,
           status = 'computed',
           computed_at = NOW(),
           updated_at = NOW()
       WHERE tenant_id = $1 AND id = $2
       RETURNING *`,
      [
        tenantId,
        id,
        computation.currentHeadcount,
        computation.plannedHeadcount,
        computation.varianceHeadcount,
        computation.currentCostProjection,
        computation.plannedCostProjection,
        computation.varianceCostProjection,
        JSON.stringify(computation.gapAnalysis ?? []),
      ],
    );
    if (res.rows.length === 0) {
      throw new Error(`Manpower plan ${id} not found`);
    }
    return this.mapManpowerPlan(res.rows[0]);
  }

  async applyManpowerPlan(tenantId: string, id: string, actorUserId: string): Promise<WorkforceManpowerPlan> {
    const res = await this.pool.query(
      `UPDATE workforce_manpower_plans
       SET status = 'applied',
           applied_at = NOW(),
           applied_by = $3,
           updated_at = NOW()
       WHERE tenant_id = $1 AND id = $2
       RETURNING *`,
      [tenantId, id, actorUserId],
    );
    if (res.rows.length === 0) {
      throw new Error(`Manpower plan ${id} not found`);
    }
    return this.mapManpowerPlan(res.rows[0]);
  }

  async dismissManpowerPlan(tenantId: string, id: string): Promise<WorkforceManpowerPlan> {
    const res = await this.pool.query(
      `UPDATE workforce_manpower_plans
       SET status = 'dismissed',
           updated_at = NOW()
       WHERE tenant_id = $1 AND id = $2
       RETURNING *`,
      [tenantId, id],
    );
    if (res.rows.length === 0) {
      throw new Error(`Manpower plan ${id} not found`);
    }
    return this.mapManpowerPlan(res.rows[0]);
  }

  // ---------------------------------------------------------------------------
  // Mappers
  // ---------------------------------------------------------------------------
  private mapShift(r: QueryResultRow): WorkforceShift {
    return {
      id: r.id,
      tenantId: r.tenant_id,
      shiftCode: r.shift_code,
      name: r.name,
      startTime: r.start_time,
      endTime: r.end_time,
      breakMinutes: Number(r.break_minutes ?? 0),
      isOvernight: Boolean(r.is_overnight),
      isActive: Boolean(r.is_active),
      createdAt: toDate(r.created_at),
      createdBy: r.created_by ?? null,
      updatedAt: toDate(r.updated_at),
      updatedBy: r.updated_by ?? null,
    };
  }

  private mapRoster(r: QueryResultRow): WorkforceRoster {
    return {
      id: r.id,
      tenantId: r.tenant_id,
      employeeId: r.employee_id,
      shiftId: r.shift_id,
      rosterDate: toDateString(r.roster_date),
      organizationUnitId: r.organization_unit_id ?? null,
      notes: r.notes ?? null,
      createdAt: toDate(r.created_at),
      createdBy: r.created_by ?? null,
      updatedAt: toDate(r.updated_at),
      updatedBy: r.updated_by ?? null,
    };
  }

  private mapAttendance(r: QueryResultRow): WorkforceAttendanceRecord {
    return {
      id: r.id,
      tenantId: r.tenant_id,
      employeeId: r.employee_id,
      attendanceDate: toDateString(r.attendance_date),
      shiftId: r.shift_id ?? null,
      clockIn: toNullableDate(r.clock_in),
      clockOut: toNullableDate(r.clock_out),
      workedMinutes: r.worked_minutes !== null && r.worked_minutes !== undefined ? Number(r.worked_minutes) : null,
      lateMinutes: Number(r.late_minutes ?? 0),
      earlyOutMinutes: Number(r.early_out_minutes ?? 0),
      status: r.status,
      source: r.source,
      notes: r.notes ?? null,
      createdAt: toDate(r.created_at),
      updatedAt: toDate(r.updated_at),
    };
  }

  private mapLeaveType(r: QueryResultRow): WorkforceLeaveType {
    return {
      id: r.id,
      tenantId: r.tenant_id,
      code: r.code,
      name: r.name,
      annualAllowanceDays: Number(r.annual_allowance_days ?? 0),
      isPaid: Boolean(r.is_paid),
      requiresAttachment: Boolean(r.requires_attachment),
      isActive: Boolean(r.is_active),
      createdAt: toDate(r.created_at),
      updatedAt: toDate(r.updated_at),
    };
  }

  private mapLeaveBalance(r: QueryResultRow): WorkforceLeaveBalance {
    return {
      id: r.id,
      tenantId: r.tenant_id,
      employeeId: r.employee_id,
      leaveTypeId: r.leave_type_id,
      balanceYear: Number(r.balance_year),
      allocatedDays: Number(r.allocated_days ?? 0),
      usedDays: Number(r.used_days ?? 0),
      pendingDays: Number(r.pending_days ?? 0),
      createdAt: toDate(r.created_at),
      updatedAt: toDate(r.updated_at),
    };
  }

  private mapLeaveRequest(r: QueryResultRow): WorkforceLeaveRequest {
    return {
      id: r.id,
      tenantId: r.tenant_id,
      requestNumber: r.request_number,
      employeeId: r.employee_id,
      leaveTypeId: r.leave_type_id,
      startDate: toDateString(r.start_date),
      endDate: toDateString(r.end_date),
      totalDays: Number(r.total_days ?? 0),
      reason: r.reason ?? null,
      attachmentDocumentId: r.attachment_document_id ?? null,
      workflowInstanceId: r.workflow_instance_id ?? null,
      submittedAt: toDate(r.submitted_at),
      approvedAt: toNullableDate(r.approved_at),
      rejectedAt: toNullableDate(r.rejected_at),
      cancelledAt: toNullableDate(r.cancelled_at),
    };
  }

  private mapOvertimeRequest(r: QueryResultRow): WorkforceOvertimeRequest {
    return {
      id: r.id,
      tenantId: r.tenant_id,
      requestNumber: r.request_number,
      employeeId: r.employee_id,
      overtimeDate: toDateString(r.overtime_date),
      startTime: r.start_time,
      endTime: r.end_time,
      estimatedHours: Number(r.estimated_hours ?? 0),
      actualHours: r.actual_hours !== null && r.actual_hours !== undefined ? Number(r.actual_hours) : null,
      reason: r.reason ?? null,
      workflowInstanceId: r.workflow_instance_id ?? null,
      submittedAt: toDate(r.submitted_at),
      approvedAt: toNullableDate(r.approved_at),
      rejectedAt: toNullableDate(r.rejected_at),
      cancelledAt: toNullableDate(r.cancelled_at),
    };
  }

  private mapStatutoryPolicy(r: QueryResultRow): WorkforceStatutoryPolicy {
    return {
      id: r.id,
      tenantId: r.tenant_id,
      policyCode: r.policy_code,
      name: r.name ?? r.policy_code,
      countryCode: r.country_code,
      effectiveFrom: toDateString(r.effective_from),
      effectiveTo: toNullableDateString(r.effective_to),
      bpjsKesehatanRateEmployer: Number(r.bpjs_kesehatan_rate_employer),
      bpjsKesehatanRateEmployee: Number(r.bpjs_kesehatan_rate_employee),
      bpjsKesehatanCap: r.bpjs_kesehatan_cap !== null ? Number(r.bpjs_kesehatan_cap) : null,
      bpjsTkJhtRateEmployer: Number(r.bpjs_tk_jht_rate_employer),
      bpjsTkJhtRateEmployee: Number(r.bpjs_tk_jht_rate_employee),
      bpjsTkJkkRate: Number(r.bpjs_tk_jkk_rate),
      bpjsTkJkmRate: Number(r.bpjs_tk_jkm_rate),
      bpjsTkJpRateEmployer: Number(r.bpjs_tk_jp_rate_employer),
      bpjsTkJpRateEmployee: Number(r.bpjs_tk_jp_rate_employee),
      bpjsTkJpCap: r.bpjs_tk_jp_cap !== null ? Number(r.bpjs_tk_jp_cap) : null,
      occupationalCostRate: Number(r.occupational_cost_rate ?? 0.05),
      occupationalCostMonthlyCap: r.occupational_cost_monthly_cap !== null ? Number(r.occupational_cost_monthly_cap) : null,
      ptkpAnnualAmounts: typeof r.ptkp_annual_amounts === "string" ? JSON.parse(r.ptkp_annual_amounts) : (r.ptkp_annual_amounts ?? {}),
      pph21Brackets: typeof r.pph21_brackets === "string" ? JSON.parse(r.pph21_brackets) : (r.pph21_brackets ?? []),
      pph21TerBrackets: typeof r.pph21_ter_brackets === "string" ? JSON.parse(r.pph21_ter_brackets) : (r.pph21_ter_brackets ?? []),
      pph21Method: r.pph21_method ?? "annualized",
      nonNpwpSurchargeRate: Number(r.non_npwp_surcharge_rate ?? 0.20),
      roundingMode: r.rounding_mode ?? "half_up",
      isActive: Boolean(r.is_active),
    };
  }

  private mapSalaryProfile(r: QueryResultRow): WorkforceEmployeeSalaryProfile {
    return {
      id: r.id,
      tenantId: r.tenant_id,
      employeeId: r.employee_id,
      baseSalary: Number(r.base_salary),
      fixedAllowance: Number(r.fixed_allowance ?? 0),
      overtimeHourlyRate: r.overtime_hourly_rate !== null ? Number(r.overtime_hourly_rate) : null,
      ptkpStatus: r.ptkp_status,
      hasNpwp: Boolean(r.has_npwp),
      bpjsKesehatanNumber: r.bpjs_kesehatan_number ?? null,
      bpjsTkNumber: r.bpjs_tk_number ?? null,
      bankName: r.bank_name ?? null,
      bankAccountNumber: r.bank_account_number ?? null,
      effectiveFrom: toDateString(r.effective_from),
      effectiveTo: toNullableDateString(r.effective_to),
    };
  }

  private mapPayrollRun(r: QueryResultRow): WorkforcePayrollRun {
    return {
      id: r.id,
      tenantId: r.tenant_id,
      runNumber: r.run_number,
      periodMonth: Number(r.period_month),
      periodYear: Number(r.period_year),
      organizationUnitId: r.organization_unit_id ?? null,
      statutoryPolicyId: r.statutory_policy_id ?? null,
      workflowInstanceId: r.workflow_instance_id ?? null,
      employeeCount: Number(r.employee_count ?? 0),
      totalGross: Number(r.total_gross ?? 0),
      totalDeductions: Number(r.total_deductions ?? 0),
      totalNet: Number(r.total_net ?? 0),
      totalEmployerContributions: Number(r.total_employer_contributions ?? 0),
      calculatedAt: toNullableDate(r.calculated_at),
      approvedAt: toNullableDate(r.approved_at),
      closedAt: toNullableDate(r.closed_at),
    };
  }

  private mapPayslip(r: QueryResultRow): WorkforcePayslip {
    return {
      id: r.id,
      tenantId: r.tenant_id,
      payrollRunId: r.payroll_run_id,
      employeeId: r.employee_id,
      baseSalary: Number(r.base_salary),
      allowances: Number(r.allowances ?? 0),
      overtimeHours: Number(r.overtime_hours ?? 0),
      overtimePay: Number(r.overtime_pay ?? 0),
      grossSalary: Number(r.gross_salary),
      bpjsKesehatanEmployee: Number(r.bpjs_kesehatan_employee ?? 0),
      bpjsKesehatanEmployer: Number(r.bpjs_kesehatan_employer ?? 0),
      bpjsTkJhtEmployee: Number(r.bpjs_tk_jht_employee ?? 0),
      bpjsTkJhtEmployer: Number(r.bpjs_tk_jht_employer ?? 0),
      bpjsTkJkkEmployer: Number(r.bpjs_tk_jkk_employer ?? 0),
      bpjsTkJkmEmployer: Number(r.bpjs_tk_jkm_employer ?? 0),
      bpjsTkJpEmployee: Number(r.bpjs_tk_jp_employee ?? 0),
      bpjsTkJpEmployer: Number(r.bpjs_tk_jp_employer ?? 0),
      pph21Withheld: Number(r.pph21_withheld ?? 0),
      otherDeductions: Number(r.other_deductions ?? 0),
      totalDeductions: Number(r.total_deductions ?? 0),
      employerContributions: Number(r.employer_contributions ?? 0),
      netSalary: Number(r.net_salary),
      ptkpStatus: r.ptkp_status ?? null,
      calculationBreakdown: typeof r.calculation_breakdown === "string" ? JSON.parse(r.calculation_breakdown) : (r.calculation_breakdown ?? {}),
      createdAt: toDate(r.created_at),
    };
  }

  private mapJobPosting(r: QueryResultRow): WorkforceJobPosting {
    return {
      id: r.id,
      tenantId: r.tenant_id,
      postingCode: r.posting_code,
      title: r.title,
      positionId: r.position_id ?? null,
      organizationUnitId: r.organization_unit_id ?? null,
      headcountTarget: Number(r.headcount_target ?? 1),
      employmentType: r.employment_type ?? "permanent",
      jobDescription: r.job_description ?? null,
      status: r.status ?? "draft",
      workflowInstanceId: r.workflow_instance_id ?? null,
      publishedAt: toNullableDate(r.published_at),
      closedAt: toNullableDate(r.closed_at),
    };
  }

  private mapJobApplication(r: QueryResultRow): WorkforceJobApplication {
    return {
      id: r.id,
      tenantId: r.tenant_id,
      jobPostingId: r.job_posting_id,
      candidateName: r.candidate_name,
      candidateEmail: r.candidate_email ?? null,
      candidatePhone: r.candidate_phone ?? null,
      resumeDocumentId: r.resume_document_id ?? null,
      stage: r.stage,
      rating: r.rating !== null ? Number(r.rating) : null,
      interviewerNotes: r.interviewer_notes ?? null,
      hiredEmployeeId: r.hired_employee_id ?? null,
      appliedAt: toDate(r.applied_at ?? r.created_at),
      decidedAt: toNullableDate(r.decided_at),
    };
  }

  private mapCompetency(r: QueryResultRow): WorkforceCompetency {
    return {
      id: r.id,
      tenantId: r.tenant_id,
      code: r.code,
      name: r.name,
      category: r.category ?? null,
      description: r.description ?? null,
      scaleMin: Number(r.scale_min ?? 1),
      scaleMax: Number(r.scale_max ?? 5),
      isActive: Boolean(r.is_active),
    };
  }

  private mapEmployeeCompetency(r: QueryResultRow): WorkforceEmployeeCompetency {
    return {
      id: r.id,
      tenantId: r.tenant_id,
      employeeId: r.employee_id,
      competencyId: r.competency_id,
      proficiencyLevel: Number(r.proficiency_level),
      lastAssessedDate: toNullableDateString(r.last_assessed_date),
      assessedByUserId: r.assessed_by_user_id ?? null,
      notes: r.notes ?? null,
    };
  }

  private mapTrainingCourse(r: QueryResultRow): WorkforceTrainingCourse {
    return {
      id: r.id,
      tenantId: r.tenant_id,
      courseCode: r.course_code,
      title: r.title,
      provider: r.provider ?? null,
      durationHours: Number(r.duration_hours ?? 0),
      competencyId: r.competency_id ?? null,
      description: r.description ?? null,
      isActive: Boolean(r.is_active),
    };
  }

  private mapTrainingEnrollment(r: QueryResultRow): WorkforceTrainingEnrollment {
    return {
      id: r.id,
      tenantId: r.tenant_id,
      trainingCourseId: r.training_course_id,
      employeeId: r.employee_id,
      status: r.status,
      enrolledAt: toDate(r.enrolled_at ?? r.created_at),
      completionDate: toNullableDateString(r.completion_date),
      score: r.score !== null ? Number(r.score) : null,
      certificateDocumentId: r.certificate_document_id ?? null,
      notes: r.notes ?? null,
    };
  }

  private mapPerformanceReview(r: QueryResultRow): WorkforcePerformanceReview {
    return {
      id: r.id,
      tenantId: r.tenant_id,
      reviewCode: r.review_code,
      employeeId: r.employee_id,
      periodStart: toDateString(r.period_start),
      periodEnd: toDateString(r.period_end),
      reviewerUserId: r.reviewer_user_id ?? null,
      goalsScore: r.goals_score !== null ? Number(r.goals_score) : null,
      competencyScore: r.competency_score !== null ? Number(r.competency_score) : null,
      overallRating: r.overall_rating !== null ? Number(r.overall_rating) : null,
      reviewNotes: r.review_notes ?? null,
      developmentPlan: r.development_plan ?? null,
      workflowInstanceId: r.workflow_instance_id ?? null,
      submittedAt: toNullableDate(r.submitted_at),
      finalizedAt: toNullableDate(r.finalized_at),
    };
  }

  private mapCareerPath(r: QueryResultRow): WorkforceCareerPath {
    return {
      id: r.id,
      tenantId: r.tenant_id,
      fromPositionId: r.from_position_id,
      toPositionId: r.to_position_id,
      requiredTenureMonths: Number(r.required_tenure_months ?? 0),
      requiredCompetencyIds: typeof r.required_competency_ids === "string" ? JSON.parse(r.required_competency_ids) : (r.required_competency_ids ?? []),
      guidelines: r.guidelines ?? null,
      isActive: Boolean(r.is_active),
    };
  }

  private mapManpowerPlan(r: QueryResultRow): WorkforceManpowerPlan {
    return {
      id: r.id,
      tenantId: r.tenant_id,
      planNumber: r.plan_number,
      planYear: Number(r.plan_year),
      organizationUnitId: r.organization_unit_id ?? null,
      title: r.title,
      status: r.status,
      parameters: typeof r.parameters === "string" ? JSON.parse(r.parameters) : (r.parameters ?? {}),
      currentHeadcount: Number(r.current_headcount ?? 0),
      plannedHeadcount: Number(r.planned_headcount ?? 0),
      varianceHeadcount: Number(r.variance_headcount ?? 0),
      currentCostProjection: Number(r.current_cost_projection ?? 0),
      plannedCostProjection: Number(r.planned_cost_projection ?? 0),
      varianceCostProjection: Number(r.variance_cost_projection ?? 0),
      gapAnalysis: typeof r.gap_analysis === "string" ? JSON.parse(r.gap_analysis) : (r.gap_analysis ?? []),
      computedAt: toNullableDate(r.computed_at),
      appliedAt: toNullableDate(r.applied_at),
      appliedBy: r.applied_by ?? null,
    };
  }
}
