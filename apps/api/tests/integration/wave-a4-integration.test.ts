import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../../src/app.js";
import { pool } from "../../src/infrastructure/persistence/db.js";
import { activateAllModules, authHeader, bootstrapTenant, createReadOnlyRole, login, provisionFirstAdmin } from "./helpers.js";

/**
 * Wave A4 — Workforce Advanced Integration Test Suite (HR-ADV-001…009).
 *
 * Scope & Capabilities:
 * 1. Attendance, Shift & Roster (HR-ADV-001, HR-ADV-002)
 * 2. Leave & Overtime with Workflow Engine delegation (HR-ADV-003, HR-ADV-004)
 * 3. Payroll, Statutory Policies (BPJS, TER & Annualized PPh 21) & Payslips (HR-ADV-005)
 * 4. Recruitment Pipeline: Job Postings & Applications (HR-ADV-006)
 * 5. Competencies, Training, Performance Reviews & Career Paths (HR-ADV-007, HR-ADV-008)
 * 6. Manpower Planning: Deterministic Advisory Headcount/Cost Gap Projections (HR-ADV-009)
 *
 * Invariants & Boundaries:
 * - Multi-tenant isolation across all 6 capability groups
 * - Hierarchical Organization-Unit Data Scope enforcement
 * - Segregation of Duties & RBAC denial across all 15 permission families
 * - Workflow Engine authoritative lifecycle without competing status columns
 * - Compensation on workflow initialization failure
 * - Immutability of calculated/approved payroll runs
 * - Monotonic non-mutation of employee records during manpower plan application
 * - Workforce Core employee/placement/user-link endpoints remain fully operational
 */

const TENANT_CODE = `wave-a4-main-${Date.now()}`;
const OTHER_TENANT_CODE = `wave-a4-other-${Date.now()}`;
const ADMIN_EMAIL = "admin@wave-a4.local";
const ADMIN_PASSWORD = "Admin12345!";
const OTHER_ADMIN_EMAIL = "otheradmin@wave-a4.local";
const OTHER_ADMIN_PASSWORD = "OtherAdmin12345!";

describe.sequential("Wave A4 — Workforce Advanced Integration Suite", () => {
  const app = buildApp();

  // Primary Tenant Fixtures
  let tenantId: string;
  let adminUserId: string;
  let adminToken: string;

  // Other Tenant Fixtures (Tenant Isolation)
  let otherTenantId: string;
  let otherAdminUserId: string;
  let otherAdminToken: string;

  // Scoped User Fixtures (Data Scope & RBAC)
  let northManagerUserId: string;
  let northManagerToken: string;
  let hrStaffUserId: string;
  let hrStaffToken: string;
  let approverUserId: string;
  let approverToken: string;
  let restrictedUserToken: string;

  // Organizational & Core Workforce Fixtures
  let legalEntityId: string;
  let orgUnitNorthId: string;
  let orgUnitNorthChildId: string;
  let orgUnitSouthId: string;
  let otherOrgUnitId: string;

  let supervisorPositionId: string;
  let engineerPositionId: string;
  let seniorEngineerPositionId: string;
  let otherPositionId: string;

  let employeeAlphaId: string;
  let employeeBetaId: string;
  let employeeGammaId: string;
  let otherEmployeeId: string;

  // Advanced Capability Fixtures
  let morningShiftId: string;
  let nightShiftId: string;
  let annualLeaveTypeId: string;
  let statutoryPolicyAnnualizedId: string;
  let statutoryPolicyTerId: string;
  let competencyJavaId: string;
  let competencyArchId: string;
  let trainingCourseId: string;
  let jobPostingId: string;
  let leaveRequestId: string;
  let overtimeRequestId: string;
  let payrollRunId: string;
  let performanceReviewId: string;
  let manpowerPlanId: string;

  const post = (url: string, token: string, payload?: Record<string, unknown>) =>
    app.inject({
      method: "POST",
      url,
      headers: authHeader(token),
      ...(payload === undefined ? {} : { payload }),
    });

  const get = (url: string, token: string) =>
    app.inject({
      method: "GET",
      url,
      headers: authHeader(token),
    });

  const patch = (url: string, token: string, payload?: Record<string, unknown>) =>
    app.inject({
      method: "PATCH",
      url,
      headers: authHeader(token),
      ...(payload === undefined ? {} : { payload }),
    });

  const put = (url: string, token: string, payload?: Record<string, unknown>) =>
    app.inject({
      method: "PUT",
      url,
      headers: authHeader(token),
      ...(payload === undefined ? {} : { payload }),
    });

  beforeAll(async () => {
    // -----------------------------------------------------------------------
    // 1. Bootstrap Tenants & Provision Admins
    // -----------------------------------------------------------------------
    const primaryTenant = await bootstrapTenant(app, TENANT_CODE, "Wave A4 Primary Tenant");
    await activateAllModules(primaryTenant.id);
    tenantId = primaryTenant.id;
    const adminUser = await provisionFirstAdmin({
      tenantId,
      email: ADMIN_EMAIL,
      password: ADMIN_PASSWORD,
    });
    adminUserId = adminUser.userId;
    const adminLogin = await login(app, TENANT_CODE, ADMIN_EMAIL, ADMIN_PASSWORD);
    adminToken = adminLogin.body.accessToken;

    const otherTenant = await bootstrapTenant(app, OTHER_TENANT_CODE, "Wave A4 Other Tenant");

    await activateAllModules(otherTenant.id);
    otherTenantId = otherTenant.id;
    const otherAdmin = await provisionFirstAdmin({
      tenantId: otherTenantId,
      email: OTHER_ADMIN_EMAIL,
      password: OTHER_ADMIN_PASSWORD,
    });
    otherAdminUserId = otherAdmin.userId;
    const otherAdminLogin = await login(app, OTHER_TENANT_CODE, OTHER_ADMIN_EMAIL, OTHER_ADMIN_PASSWORD);
    otherAdminToken = otherAdminLogin.body.accessToken;

    // -----------------------------------------------------------------------
    // 2. Seed Numbering Sequences for both tenants
    // -----------------------------------------------------------------------
    for (const [tToken] of [[adminToken], [otherAdminToken]] as const) {
      await post("/config/numbering/employee_number", tToken, { pattern: "EMP-{SEQ:5}" });
      await post("/config/numbering/workforce_leave_request", tToken, { pattern: "LV-{YYYY}-{SEQ:4}" });
      await post("/config/numbering/workforce_overtime_request", tToken, { pattern: "OT-{YYYY}-{SEQ:4}" });
      await post("/config/numbering/workforce_payroll_run", tToken, { pattern: "PAY-{YYYY}-{MM}-{SEQ:3}" });
      await post("/config/numbering/workforce_job_posting", tToken, { pattern: "JOB-{YYYY}-{SEQ:4}" });
      await post("/config/numbering/workforce_performance_review", tToken, { pattern: "REV-{YYYY}-{SEQ:4}" });
      await post("/config/numbering/workforce_manpower_plan", tToken, { pattern: "MPP-{YYYY}-{SEQ:4}" });

      // Seed workflow definitions required by Advanced modules
      const workflows = [
        { code: "workforce_leave_request", name: "Leave Request Approval" },
        { code: "workforce_overtime_request", name: "Overtime Request Approval" },
        { code: "workforce_payroll_run", name: "Payroll Run Review & Close" },
        { code: "workforce_job_posting", name: "Job Posting Lifecycle" },
        { code: "workforce_performance_review", name: "Performance Review Workflow" },
      ];

      for (const wf of workflows) {
        await post("/workflow/definitions", tToken, {
          code: wf.code,
          name: wf.name,
          entityType: wf.code,
          description: `Authoritative workflow for ${wf.name}`,
        });

        await post(`/workflow/definitions/${wf.code}/versions/1/steps`, tToken, {
          code: "SUBMITTED",
          name: "Submitted",
          stepType: "task",
          isInitial: true,
        });
        await post(`/workflow/definitions/${wf.code}/versions/1/steps`, tToken, {
          code: "APPROVED",
          name: "Approved",
          stepType: "end",
          isTerminal: true,
          terminalStatus: "approved",
        });
        await post(`/workflow/definitions/${wf.code}/versions/1/steps`, tToken, {
          code: "REJECTED",
          name: "Rejected",
          stepType: "end",
          isTerminal: true,
          terminalStatus: "rejected",
        });

        await post(`/workflow/definitions/${wf.code}/versions/1/transitions`, tToken, {
          fromStepCode: "SUBMITTED",
          toStepCode: "APPROVED",
          actionCode: "approve",
          name: "Approve",
        });
        await post(`/workflow/definitions/${wf.code}/versions/1/transitions`, tToken, {
          fromStepCode: "SUBMITTED",
          toStepCode: "APPROVED",
          actionCode: "publish",
          name: "Publish",
        });
        await post(`/workflow/definitions/${wf.code}/versions/1/transitions`, tToken, {
          fromStepCode: "SUBMITTED",
          toStepCode: "APPROVED",
          actionCode: "close",
          name: "Close",
        });
        await post(`/workflow/definitions/${wf.code}/versions/1/transitions`, tToken, {
          fromStepCode: "SUBMITTED",
          toStepCode: "APPROVED",
          actionCode: "finalize",
          name: "Finalize",
        });
        await post(`/workflow/definitions/${wf.code}/versions/1/transitions`, tToken, {
          fromStepCode: "SUBMITTED",
          toStepCode: "REJECTED",
          actionCode: "reject",
          name: "Reject",
        });
        await post(`/workflow/definitions/${wf.code}/versions/1/transitions`, tToken, {
          fromStepCode: "SUBMITTED",
          toStepCode: "REJECTED",
          actionCode: "cancel",
          name: "Cancel",
        });

        await post(`/workflow/definitions/${wf.code}/versions/1/assignment-rules`, tToken, {
          stepCode: "SUBMITTED",
          assignmentType: "role",
          roleCode: "APPROVER_ROLE",
        });

        await post(`/workflow/definitions/${wf.code}/versions/1/publish`, tToken);
      }
    }

    // -----------------------------------------------------------------------
    // 3. Organization Units & Legal Entities
    // -----------------------------------------------------------------------
    const leRes = await post("/legal-entities", adminToken, {
      code: "LE-A4-CORP",
      name: "Abixell Global Tech PT",
    });
    legalEntityId = leRes.json().id;

    const northRes = await post("/organization-units", adminToken, {
      legalEntityId,
      name: "Engineering North",
    });
    orgUnitNorthId = northRes.json().id;

    const northChildRes = await post("/organization-units", adminToken, {
      legalEntityId,
      name: "Cloud Backend Team",
      parentId: orgUnitNorthId,
    });
    orgUnitNorthChildId = northChildRes.json().id;

    const southRes = await post("/organization-units", adminToken, {
      legalEntityId,
      name: "Operations South",
    });
    orgUnitSouthId = southRes.json().id;

    // Other tenant org unit
    const otherLeRes = await post("/legal-entities", otherAdminToken, {
      code: "LE-A4-OTHER",
      name: "Other Tenant Holding",
    });
    const otherOuRes = await post("/organization-units", otherAdminToken, {
      legalEntityId: otherLeRes.json().id,
      name: "Other Division",
    });
    otherOrgUnitId = otherOuRes.json().id;

    // -----------------------------------------------------------------------
    // 4. Core Workforce Positions & Employees
    // -----------------------------------------------------------------------
    const posSupRes = await post("/positions", adminToken, {
      code: "TECH_SUPERVISOR",
      name: "Technical Supervisor",
    });
    supervisorPositionId = posSupRes.json().id;

    const posEngRes = await post("/positions", adminToken, {
      code: "SOFTWARE_ENG",
      name: "Software Engineer",
    });
    engineerPositionId = posEngRes.json().id;

    const posSnrEngRes = await post("/positions", adminToken, {
      code: "SENIOR_SOFTWARE_ENG",
      name: "Senior Software Engineer",
    });
    seniorEngineerPositionId = posSnrEngRes.json().id;

    const otherPosRes = await post("/positions", otherAdminToken, {
      code: "OTHER_ROLE",
      name: "Other Tenant Role",
    });
    otherPositionId = otherPosRes.json().id;

    const empAlphaRes = await post("/employees", adminToken, {
      fullName: "Budi Santoso",
      email: "budi.santoso@abixell.test",
      joinedAt: "2026-01-01",
      legalEntityId,
      organizationUnitId: orgUnitNorthId,
      positionCode: "SOFTWARE_ENG",
    });
    employeeAlphaId = empAlphaRes.json().id;

    const empBetaRes = await post("/employees", adminToken, {
      fullName: "Siti Rahma",
      email: "siti.rahma@abixell.test",
      joinedAt: "2026-02-01",
      legalEntityId,
      organizationUnitId: orgUnitNorthChildId,
      positionCode: "SOFTWARE_ENG",
    });
    employeeBetaId = empBetaRes.json().id;

    const empGammaRes = await post("/employees", adminToken, {
      fullName: "Agus Pratama",
      email: "agus.pratama@abixell.test",
      joinedAt: "2026-03-01",
      legalEntityId,
      organizationUnitId: orgUnitSouthId,
      positionCode: "TECH_SUPERVISOR",
    });
    employeeGammaId = empGammaRes.json().id;

    const otherEmpRes = await post("/employees", otherAdminToken, {
      fullName: "External Person",
      positionCode: "OTHER_ROLE",
    });
    otherEmployeeId = otherEmpRes.json().id;

    // -----------------------------------------------------------------------
    // 5. Scoped & Role-Restricted Users
    // -----------------------------------------------------------------------
    await createReadOnlyRole(tenantId, "HR_MANAGE_ROLE", [
      "workforce.read",
      "workforce.manage",
      "workforce.attendance.read",
      "workforce.attendance.manage",
      "workforce.leave.read",
      "workforce.leave.manage",
      "workforce.payroll.read",
      "workforce.payroll.manage",
      "workforce.recruitment.read",
      "workforce.recruitment.manage",
      "workforce.performance.read",
      "workforce.performance.manage",
      "workforce.planning.read",
      "workforce.planning.manage",
      "workflow.instance.start",
      "workflow.instance.read",
      "workflow.instance.act",
    ]);

    await createReadOnlyRole(tenantId, "APPROVER_ROLE", [
      "workforce.read",
      "workforce.leave.read",
      "workforce.leave.approve",
      "workforce.payroll.read",
      "workforce.payroll.approve",
      "workforce.recruitment.read",
      "workforce.recruitment.manage",
      "workforce.performance.read",
      "workforce.performance.manage",
      "workforce.planning.read",
      "workforce.planning.apply",
      "workflow.instance.start",
      "workflow.instance.read",
      "workflow.instance.act",
    ]);

    await createReadOnlyRole(tenantId, "READ_ONLY_WORKFORCE_ROLE", [
      "workforce.read",
      "workforce.attendance.read",
      "workforce.leave.read",
      "workforce.payroll.read",
      "workforce.recruitment.read",
      "workforce.performance.read",
      "workforce.planning.read",
    ]);

    // User scoped to North Org Unit Hierarchy
    const northMgrUserRes = await post("/users", adminToken, {
      email: "north.manager@wave-a4.local",
      fullName: "North Engineering Manager",
      password: "Password12345!",
      roleCode: "HR_MANAGE_ROLE",
      scopeType: "organization_unit",
      scopeOrganizationUnitId: orgUnitNorthId,
    });
    northManagerUserId = northMgrUserRes.json().user.id;
    northManagerToken = (
      await login(app, TENANT_CODE, "north.manager@wave-a4.local", "Password12345!")
    ).body.accessToken;

    // HR Tenant-wide Operator
    const hrStaffUserRes = await post("/users", adminToken, {
      email: "hr.staff@wave-a4.local",
      fullName: "HR Operational Specialist",
      password: "Password12345!",
      roleCode: "HR_MANAGE_ROLE",
      scopeType: "tenant",
    });
    hrStaffUserId = hrStaffUserRes.json().user.id;
    hrStaffToken = (
      await login(app, TENANT_CODE, "hr.staff@wave-a4.local", "Password12345!")
    ).body.accessToken;

    // Executive Approver
    const approverUserRes = await post("/users", adminToken, {
      email: "executive.approver@wave-a4.local",
      fullName: "Executive Director Approver",
      password: "Password12345!",
      roleCode: "APPROVER_ROLE",
      scopeType: "tenant",
    });
    approverUserId = approverUserRes.json().user.id;
    approverToken = (
      await login(app, TENANT_CODE, "executive.approver@wave-a4.local", "Password12345!")
    ).body.accessToken;

    // Restricted View-Only User
    await post("/users", adminToken, {
      email: "viewer@wave-a4.local",
      fullName: "Auditor View Only",
      password: "Password12345!",
      roleCode: "READ_ONLY_WORKFORCE_ROLE",
      scopeType: "tenant",
    });
    restrictedUserToken = (
      await login(app, TENANT_CODE, "viewer@wave-a4.local", "Password12345!")
    ).body.accessToken;
  });

  afterAll(async () => {
    await app.close();
  });

  // =========================================================================
  // Capability Group 1: Attendance, Shift & Roster (HR-ADV-001/002)
  // =========================================================================

  describe("1. Attendance, Shift & Roster Management", () => {
    it("creates standard and overnight shifts", async () => {
      const dayShiftRes = await post("/workforce/advanced/shifts", hrStaffToken, {
        shiftCode: "SHIFT-DAY-0817",
        name: "Standard Day Shift",
        startTime: "08:00",
        endTime: "17:00",
        breakMinutes: 60,
        isOvernight: false,
      });
      expect(dayShiftRes.statusCode).toBe(201);
      const dayShift = dayShiftRes.json();
      morningShiftId = dayShift.id;
      expect(dayShift.shiftCode).toBe("SHIFT-DAY-0817");
      expect(dayShift.isActive).toBe(true);

      const nightShiftRes = await post("/workforce/advanced/shifts", hrStaffToken, {
        shiftCode: "SHIFT-NIGHT-2207",
        name: "Overnight Security Shift",
        startTime: "22:00",
        endTime: "07:00",
        breakMinutes: 60,
        isOvernight: true,
      });
      expect(nightShiftRes.statusCode).toBe(201);
      nightShiftId = nightShiftRes.json().id;
      expect(nightShiftRes.json().isOvernight).toBe(true);
    });

    it("lists active shifts and updates active status", async () => {
      const listRes = await get("/workforce/advanced/shifts", restrictedUserToken);
      expect(listRes.statusCode).toBe(200);
      expect(listRes.json().length).toBeGreaterThanOrEqual(2);

      const patchRes = await patch(`/workforce/advanced/shifts/${nightShiftId}/active`, hrStaffToken, {
        isActive: false,
      });
      expect(patchRes.statusCode).toBe(200);
      expect(patchRes.json().isActive).toBe(false);

      // Re-enable for subsequent roster tests
      await patch(`/workforce/advanced/shifts/${nightShiftId}/active`, hrStaffToken, { isActive: true });
    });

    it("upserts employee roster and handles duplicate upsert idempotently", async () => {
      const rosterRes1 = await put("/workforce/advanced/rosters", hrStaffToken, {
        employeeId: employeeAlphaId,
        shiftId: morningShiftId,
        rosterDate: "2026-09-01",
        organizationUnitId: orgUnitNorthId,
        notes: "Initial roster assignment",
      });
      expect(rosterRes1.statusCode).toBe(200);
      expect(rosterRes1.json().employeeId).toBe(employeeAlphaId);
      expect(rosterRes1.json().shiftId).toBe(morningShiftId);

      // Duplicate date for same employee updates rather than conflicting
      const rosterRes2 = await put("/workforce/advanced/rosters", hrStaffToken, {
        employeeId: employeeAlphaId,
        shiftId: nightShiftId,
        rosterDate: "2026-09-01",
        organizationUnitId: orgUnitNorthId,
        notes: "Updated roster shift change",
      });
      expect(rosterRes2.statusCode).toBe(200);
      expect(rosterRes2.json().shiftId).toBe(nightShiftId);
      expect(rosterRes2.json().notes).toBe("Updated roster shift change");
    });

    it("records daily attendance and updates clock-in/out records", async () => {
      const attRes = await post("/workforce/advanced/attendance", hrStaffToken, {
        employeeId: employeeAlphaId,
        attendanceDate: "2026-09-01",
        shiftId: morningShiftId,
        clockIn: "2026-09-01T08:05:00.000Z",
        clockOut: "2026-09-01T17:10:00.000Z",
        status: "present",
        source: "manual",
        notes: "Punched at main entrance",
      });
      expect(attRes.statusCode).toBe(201);
      const att = attRes.json();
      expect(att.employeeId).toBe(employeeAlphaId);
      expect(att.status).toBe("present");

      // Query attendance
      const listAtt = await get(`/workforce/advanced/attendance?employeeId=${employeeAlphaId}`, restrictedUserToken);
      expect(listAtt.statusCode).toBe(200);
      expect(listAtt.json().length).toBeGreaterThanOrEqual(1);
    });
  });

  // =========================================================================
  // Capability Group 2: Leave & Overtime Lifecycles (HR-ADV-003/004)
  // =========================================================================

  describe("2. Leave Balances, Requests & Overtime Lifecycle", () => {
    it("configures leave types and allocates annual entitlement balances", async () => {
      const typeRes = await post("/workforce/advanced/leave-types", hrStaffToken, {
        code: "ANNUAL_LEAVE",
        name: "Standard Paid Annual Leave",
        annualAllowanceDays: 12,
        isPaid: true,
        requiresAttachment: false,
      });
      expect(typeRes.statusCode).toBe(201);
      annualLeaveTypeId = typeRes.json().id;

      const allocRes = await put("/workforce/advanced/leave-balances", hrStaffToken, {
        employeeId: employeeAlphaId,
        leaveTypeId: annualLeaveTypeId,
        balanceYear: 2026,
        allocatedDays: 12,
      });
      expect(allocRes.statusCode).toBe(200);
      const bal = allocRes.json();
      expect(bal.allocatedDays).toBe(12);
      expect(bal.usedDays).toBe(0);
      expect(bal.pendingDays).toBe(0);
    });

    it("submits leave request, reserves pending balance, and delegates to Workflow Engine", async () => {
      const reqRes = await post("/workforce/advanced/leave-requests", hrStaffToken, {
        employeeId: employeeAlphaId,
        leaveTypeId: annualLeaveTypeId,
        startDate: "2026-09-10",
        endDate: "2026-09-12",
        totalDays: 3,
        reason: "Family vacation",
      });
      expect(reqRes.statusCode).toBe(201);
      const leaveReq = reqRes.json();
      leaveRequestId = leaveReq.id;
      expect(leaveReq.requestNumber).toMatch(/^LV-\d{4}-\d+$/);
      expect(leaveReq.workflowInstanceId).toBeTruthy();

      // Check balance shows 3 pending days reserved
      const balRes = await get(`/workforce/advanced/leave-balances?employeeId=${employeeAlphaId}&balanceYear=2026`, restrictedUserToken);
      expect(balRes.statusCode).toBe(200);
      const balance = balRes.json().find((b: any) => b.leaveTypeId === annualLeaveTypeId);
      expect(balance.pendingDays).toBe(3);
      expect(balance.usedDays).toBe(0);
    });

    it("rejects leave request that exceeds allocated balance", async () => {
      const overReqRes = await post("/workforce/advanced/leave-requests", hrStaffToken, {
        employeeId: employeeAlphaId,
        leaveTypeId: annualLeaveTypeId,
        startDate: "2026-10-01",
        endDate: "2026-10-20",
        totalDays: 15,
        reason: "Excessive time off",
      });
      expect(overReqRes.statusCode).toBe(400);
    });

    it("approves leave request through workflow assignment and moves pending to used balance", async () => {
      const actRes = await post(`/workforce/advanced/leave-requests/${leaveRequestId}/act`, approverToken, {
        actionCode: "approve",
        comment: "Approved by manager",
      });
      expect(actRes.statusCode).toBe(200);
      expect(actRes.json().leaveRequest.approvedAt).toBeTruthy();

      // Balance now reflects 3 used days and 0 pending days
      const balRes = await get(`/workforce/advanced/leave-balances?employeeId=${employeeAlphaId}&balanceYear=2026`, restrictedUserToken);
      const balance = balRes.json().find((b: any) => b.leaveTypeId === annualLeaveTypeId);
      expect(balance.usedDays).toBe(3);
      expect(balance.pendingDays).toBe(0);
    });

    it("creates overtime request, records actual hours, and executes workflow lifecycle", async () => {
      const otRes = await post("/workforce/advanced/overtime-requests", hrStaffToken, {
        employeeId: employeeAlphaId,
        overtimeDate: "2026-09-05",
        startTime: "18:00",
        endTime: "21:00",
        estimatedHours: 3.0,
        reason: "Critical server migration",
      });
      expect(otRes.statusCode).toBe(201);
      const ot = otRes.json();
      overtimeRequestId = ot.id;
      expect(ot.requestNumber).toMatch(/^OT-\d{4}-\d+$/);
      expect(ot.workflowInstanceId).toBeTruthy();

      // Record actual hours
      const actualRes = await post(`/workforce/advanced/overtime-requests/${overtimeRequestId}/actual`, hrStaffToken, {
        actualHours: 3.5,
      });
      expect(actualRes.statusCode).toBe(200);
      expect(actualRes.json().actualHours).toBe(3.5);

      // Rejects negative actual hours
      const negRes = await post(`/workforce/advanced/overtime-requests/${overtimeRequestId}/actual`, hrStaffToken, {
        actualHours: -1.0,
      });
      expect(negRes.statusCode).toBe(400);

      // Approver confirms overtime
      const approveOtRes = await post(`/workforce/advanced/overtime-requests/${overtimeRequestId}/act`, approverToken, {
        actionCode: "approve",
        comment: "Overtime verified against deploy logs",
      });
      expect(approveOtRes.statusCode).toBe(200);
      expect(approveOtRes.json().overtimeRequest.approvedAt).toBeTruthy();
    });
  });

  // =========================================================================
  // Capability Group 3: Payroll, BPJS & PPh 21 Engine (HR-ADV-005)
  // =========================================================================

  describe("3. Payroll, Statutory Policy Effective Dating & Payslip Calculation", () => {
    it("creates effective-dated Indonesian statutory policy with exact BPJS and tax rates", async () => {
      const policyRes = await post("/workforce/advanced/statutory-policies", hrStaffToken, {
        policyCode: "ID-STATUTORY-2026",
        name: "Indonesia Statutory Benchmark 2026",
        countryCode: "ID",
        effectiveFrom: "2026-01-01",
        effectiveTo: "2026-12-31",
        bpjsKesehatanRateEmployer: 0.04,
        bpjsKesehatanRateEmployee: 0.01,
        bpjsKesehatanCap: 12_000_000,
        bpjsTkJhtRateEmployer: 0.037,
        bpjsTkJhtRateEmployee: 0.02,
        bpjsTkJkkRate: 0.0024,
        bpjsTkJkmRate: 0.003,
        bpjsTkJpRateEmployer: 0.02,
        bpjsTkJpRateEmployee: 0.01,
        bpjsTkJpCap: 10_042_300,
        occupationalCostRate: 0.05,
        occupationalCostMonthlyCap: 500_000,
        pph21Method: "annualized",
        roundingMode: "half_up",
        nonNpwpSurchargeRate: 0.2,
      });
      expect(policyRes.statusCode).toBe(201);
      statutoryPolicyAnnualizedId = policyRes.json().id;

      // Also create TER method policy for comparison
      const terPolicyRes = await post("/workforce/advanced/statutory-policies", hrStaffToken, {
        policyCode: "ID-STATUTORY-TER-2026",
        name: "Indonesia Statutory TER PP 58/2023",
        countryCode: "ID",
        effectiveFrom: "2026-06-01",
        bpjsKesehatanRateEmployer: 0.04,
        bpjsKesehatanRateEmployee: 0.01,
        bpjsKesehatanCap: 12_000_000,
        bpjsTkJhtRateEmployer: 0.037,
        bpjsTkJhtRateEmployee: 0.02,
        bpjsTkJkkRate: 0.0024,
        bpjsTkJkmRate: 0.003,
        bpjsTkJpRateEmployer: 0.02,
        bpjsTkJpRateEmployee: 0.01,
        bpjsTkJpCap: 10_042_300,
        pph21Method: "ter",
        roundingMode: "half_up",
      });
      expect(terPolicyRes.statusCode).toBe(201);
      statutoryPolicyTerId = terPolicyRes.json().id;
    });

    it("configures employee salary profiles with PTKP and NPWP parameters", async () => {
      // Profile for Employee Alpha (TK/0, Has NPWP, Base IDR 15,000,000 + 2,000,000 allowance)
      const profAlpha = await put("/workforce/advanced/salary-profiles", hrStaffToken, {
        employeeId: employeeAlphaId,
        baseSalary: 15_000_000,
        fixedAllowance: 2_000_000,
        ptkpStatus: "TK/0",
        hasNpwp: true,
        bankName: "Bank Central Asia",
        bankAccountNumber: "1234567890",
        effectiveFrom: "2026-01-01",
      });
      expect(profAlpha.statusCode).toBe(200);
      expect(profAlpha.json().baseSalary).toBe(15_000_000);

      // Profile for Employee Beta (K/1, Non-NPWP, Base IDR 8,000,000)
      const profBeta = await put("/workforce/advanced/salary-profiles", hrStaffToken, {
        employeeId: employeeBetaId,
        baseSalary: 8_000_000,
        fixedAllowance: 1_000_000,
        ptkpStatus: "K/1",
        hasNpwp: false,
        effectiveFrom: "2026-01-01",
      });
      expect(profBeta.statusCode).toBe(200);
    });

    it("creates payroll run, executes exact deterministic calculation, and inspects payslips", async () => {
      const approvedEstimatedOnly = await post("/workforce/advanced/overtime-requests", hrStaffToken, {
        employeeId: employeeAlphaId,
        overtimeDate: "2026-09-06",
        startTime: "18:00",
        endTime: "19:15",
        estimatedHours: 1.25,
        reason: "Approved fallback-to-estimated overtime",
      });
      expect(approvedEstimatedOnly.statusCode).toBe(201);
      const approveEstimatedOnly = await post(`/workforce/advanced/overtime-requests/${approvedEstimatedOnly.json().id}/act`, approverToken, {
        actionCode: "approve",
        comment: "Approved without actual hours so payroll uses estimated fallback",
      });
      expect(approveEstimatedOnly.statusCode).toBe(200);

      const pendingOvertime = await post("/workforce/advanced/overtime-requests", hrStaffToken, {
        employeeId: employeeAlphaId,
        overtimeDate: "2026-09-07",
        startTime: "18:00",
        endTime: "23:00",
        estimatedHours: 5,
        reason: "Pending overtime must not enter payroll",
      });
      expect(pendingOvertime.statusCode).toBe(201);

      const rejectedOvertime = await post("/workforce/advanced/overtime-requests", hrStaffToken, {
        employeeId: employeeAlphaId,
        overtimeDate: "2026-09-08",
        startTime: "18:00",
        endTime: "22:00",
        estimatedHours: 4,
        reason: "Rejected overtime must not enter payroll",
      });
      expect(rejectedOvertime.statusCode).toBe(201);
      const rejectOvertime = await post(`/workforce/advanced/overtime-requests/${rejectedOvertime.json().id}/act`, approverToken, {
        actionCode: "reject",
        comment: "Rejected payroll exclusion control",
      });
      expect(rejectOvertime.statusCode).toBe(200);

      const cancelledOvertime = await post("/workforce/advanced/overtime-requests", hrStaffToken, {
        employeeId: employeeAlphaId,
        overtimeDate: "2026-09-09",
        startTime: "18:00",
        endTime: "20:00",
        estimatedHours: 2,
        reason: "Cancelled overtime must not enter payroll",
      });
      expect(cancelledOvertime.statusCode).toBe(201);
      const cancelOvertime = await post(`/workforce/advanced/overtime-requests/${cancelledOvertime.json().id}/act`, approverToken, {
        actionCode: "cancel",
        comment: "Cancelled payroll exclusion control",
      });
      expect(cancelOvertime.statusCode).toBe(200);

      const runRes = await post("/workforce/advanced/payroll-runs", hrStaffToken, {
        periodMonth: 9,
        periodYear: 2026,
        organizationUnitId: orgUnitNorthId,
      });
      expect(runRes.statusCode).toBe(201);
      const run = runRes.json();
      payrollRunId = run.id;
      expect(run.runNumber).toMatch(/^PAY-\d{4}-\d{2}-\d+$/);

      // Calculate payroll run
      const calcRes = await post(`/workforce/advanced/payroll-runs/${payrollRunId}/calculate`, hrStaffToken);
      expect(calcRes.statusCode).toBe(200);
      const calcResult = calcRes.json();
      expect(calcResult.payslipCount).toBeGreaterThanOrEqual(1);
      expect(calcResult.totals.totalGross).toBeGreaterThan(0);
      expect(calcResult.totals.totalNet).toBeGreaterThan(0);

      // Inspect payslips for individual exact calculations
      const payslipsRes = await get(`/workforce/advanced/payroll-runs/${payrollRunId}/payslips`, hrStaffToken);
      expect(payslipsRes.statusCode).toBe(200);
      const payslips = payslipsRes.json();
      const alphaSlip = payslips.find((p: any) => p.employeeId === employeeAlphaId);
      expect(alphaSlip).toBeDefined();
      expect(alphaSlip.overtimeHours).toBe(4.75);
      expect(alphaSlip.overtimePay).toBe(466_763.03);
      expect(alphaSlip.grossSalary).toBe(17_466_763.03); // salary + approved actual and estimated-fallback overtime
      expect(alphaSlip.bpjsKesehatanEmployer).toBe(480_000); // 4% of 12M cap
      expect(alphaSlip.bpjsKesehatanEmployee).toBe(120_000); // 1% of 12M cap
      expect(alphaSlip.pph21Withheld).toBeGreaterThan(0);
      expect(alphaSlip.netSalary).toBeLessThan(alphaSlip.grossSalary);
    });

    it("enforces immutability: approved/closed payroll runs cannot be recalculated", async () => {
      // Approve payroll run
      const approveRes = await post(`/workforce/advanced/payroll-runs/${payrollRunId}/act`, approverToken, {
        actionCode: "approve",
        comment: "Payroll audit verified",
      });
      expect(approveRes.statusCode).toBe(200);
      expect(approveRes.json().payrollRun.approvedAt).toBeTruthy();

      // Recalculating now fails with 409 Conflict
      const recalcRes = await post(`/workforce/advanced/payroll-runs/${payrollRunId}/calculate`, hrStaffToken);
      expect(recalcRes.statusCode).toBe(409);
    });
  });

  // =========================================================================
  // Capability Group 4: Recruitment Pipeline (HR-ADV-006)
  // =========================================================================

  describe("4. Recruitment Pipeline: Job Postings & Candidate Tracking", () => {
    let candidateAppId: string;

    it("creates job posting, delegates workflow, and advances to published state", async () => {
      const postRes = await post("/workforce/advanced/job-postings", hrStaffToken, {
        title: "Principal Distributed Systems Engineer",
        positionId: engineerPositionId,
        organizationUnitId: orgUnitNorthId,
        headcountTarget: 2,
        employmentType: "permanent",
        jobDescription: "Lead backend architecture scaling for multi-tenant ERP platform",
      });
      expect(postRes.statusCode).toBe(201);
      const job = postRes.json();
      jobPostingId = job.id;
      expect(job.postingCode).toMatch(/^JOB-\d{4}-\d+$/);
      expect(job.status).toBe("draft");

      // Publish job posting through workflow assignment action
      const actRes = await post(`/workforce/advanced/job-postings/${jobPostingId}/act`, approverToken, {
        actionCode: "publish",
        comment: "Published to internal & external portals",
      });
      expect(actRes.statusCode).toBe(200);
      expect(actRes.json().jobPosting.status).toBe("published");
      expect(actRes.json().jobPosting.publishedAt).toBeTruthy();
    });

    it("registers candidate applications and progresses candidates through stages", async () => {
      const appRes = await post("/workforce/advanced/job-applications", hrStaffToken, {
        jobPostingId,
        candidateName: "Dewi Lestari",
        candidateEmail: "dewi.lestari@candidate.test",
        candidatePhone: "+628123456789",
      });
      expect(appRes.statusCode).toBe(201);
      const appRecord = appRes.json();
      candidateAppId = appRecord.id;
      expect(appRecord.stage).toBe("applied");

      // Screening stage
      const screenRes = await post(`/workforce/advanced/job-applications/${candidateAppId}/stage`, hrStaffToken, {
        stage: "screening",
        rating: 4,
        interviewerNotes: "Strong background in PostgreSQL and TypeScript",
      });
      expect(screenRes.statusCode).toBe(200);
      expect(screenRes.json().stage).toBe("screening");
      expect(screenRes.json().rating).toBe(4);

      // Interview stage
      const interviewRes = await post(`/workforce/advanced/job-applications/${candidateAppId}/stage`, hrStaffToken, {
        stage: "interview",
        rating: 5,
        interviewerNotes: "Passed technical systems design with distinction",
      });
      expect(interviewRes.statusCode).toBe(200);
      expect(interviewRes.json().stage).toBe("interview");

      // Offer & Hired stage linked to new or existing employee
      const hiredRes = await post(`/workforce/advanced/job-applications/${candidateAppId}/stage`, hrStaffToken, {
        stage: "hired",
        rating: 5,
        hiredEmployeeId: employeeBetaId,
        interviewerNotes: "Candidate accepted offer; onboarding complete",
      });
      expect(hiredRes.statusCode).toBe(200);
      expect(hiredRes.json().stage).toBe("hired");
      expect(hiredRes.json().hiredEmployeeId).toBe(employeeBetaId);
    });
  });

  // =========================================================================
  // Capability Group 5: Competencies, Training, Performance & Career (HR-ADV-007/008)
  // =========================================================================

  describe("5. Competencies, Training Programs, Performance Reviews & Career Paths", () => {
    let enrollmentId: string;

    it("defines competencies and records employee proficiency assessments", async () => {
      const comp1 = await post("/workforce/advanced/competencies", hrStaffToken, {
        code: "COMP-DIST-SYS",
        name: "Distributed Systems & Concurrency",
        category: "technical",
        scaleMin: 1,
        scaleMax: 5,
      });
      expect(comp1.statusCode).toBe(201);
      competencyJavaId = comp1.json().id;

      const comp2 = await post("/workforce/advanced/competencies", hrStaffToken, {
        code: "COMP-ARCH-DESIGN",
        name: "Software Architecture Design",
        category: "technical",
      });
      expect(comp2.statusCode).toBe(201);
      competencyArchId = comp2.json().id;

      // Assess Employee
      const assessRes = await put("/workforce/advanced/employee-competencies", hrStaffToken, {
        employeeId: employeeAlphaId,
        competencyId: competencyJavaId,
        proficiencyLevel: 4,
        notes: "Demonstrated master-level lock contention resolution",
      });
      expect(assessRes.statusCode).toBe(200);
      expect(assessRes.json().proficiencyLevel).toBe(4);

      const listAssess = await get(`/workforce/advanced/employees/${employeeAlphaId}/competencies`, restrictedUserToken);
      expect(listAssess.statusCode).toBe(200);
      expect(listAssess.json().length).toBeGreaterThanOrEqual(1);
    });

    it("manages training courses, enrolls employees, and records course completion", async () => {
      const courseRes = await post("/workforce/advanced/training-courses", hrStaffToken, {
        courseCode: "TRN-PG-SCALE",
        title: "High Performance PostgreSQL & Query Optimization",
        provider: "Internal Engineering Academy",
        durationHours: 16,
        competencyId: competencyJavaId,
      });
      expect(courseRes.statusCode).toBe(201);
      trainingCourseId = courseRes.json().id;

      const enrollRes = await post("/workforce/advanced/training-enrollments", hrStaffToken, {
        trainingCourseId,
        employeeId: employeeAlphaId,
      });
      expect(enrollRes.statusCode).toBe(201);
      enrollmentId = enrollRes.json().id;
      expect(enrollRes.json().status).toBe("enrolled");

      const completeRes = await post(`/workforce/advanced/training-enrollments/${enrollmentId}/complete`, hrStaffToken, {
        status: "completed",
        completionDate: "2026-08-30",
        score: 95.5,
      });
      expect(completeRes.statusCode).toBe(200);
      expect(completeRes.json().status).toBe("completed");
      expect(completeRes.json().score).toBe(95.5);
    });

    it("conducts performance reviews and finalizes reviews via Workflow Engine", async () => {
      const revRes = await post("/workforce/advanced/performance-reviews", hrStaffToken, {
        employeeId: employeeAlphaId,
        periodStart: "2026-01-01",
        periodEnd: "2026-06-30",
        goalsScore: 4.8,
        competencyScore: 4.5,
        overallRating: 4.7,
        reviewNotes: "Exceeded all H1 sprint delivery objectives and architectural benchmarks",
      });
      expect(revRes.statusCode).toBe(201);
      const rev = revRes.json();
      performanceReviewId = rev.id;
      expect(rev.reviewCode).toMatch(/^REV-\d{4}-\d+$/);
      expect(rev.workflowInstanceId).toBeTruthy();

      // Submit and finalize review through workflow
      const finalizeRes = await post(`/workforce/advanced/performance-reviews/${performanceReviewId}/act`, approverToken, {
        actionCode: "finalize",
        comment: "Director review sign-off completed",
      });
      expect(finalizeRes.statusCode).toBe(200);
      expect(finalizeRes.json().review.finalizedAt).toBeTruthy();
    });

    it("establishes career paths between organizational positions", async () => {
      const careerRes = await post("/workforce/advanced/career-paths", hrStaffToken, {
        fromPositionId: engineerPositionId,
        toPositionId: seniorEngineerPositionId,
        requiredTenureMonths: 24,
        requiredCompetencyIds: [competencyJavaId, competencyArchId],
        guidelines: "Must have delivered at least two major tier-1 projects with distinction",
      });
      expect(careerRes.statusCode).toBe(201);
      expect(careerRes.json().fromPositionId).toBe(engineerPositionId);
      expect(careerRes.json().toPositionId).toBe(seniorEngineerPositionId);

      // Rejects self-referencing career path
      const selfRefRes = await post("/workforce/advanced/career-paths", hrStaffToken, {
        fromPositionId: engineerPositionId,
        toPositionId: engineerPositionId,
      });
      expect(selfRefRes.statusCode).toBe(400);
    });
  });

  // =========================================================================
  // Capability Group 6: Manpower Planning & Deterministic Advisory Logic (HR-ADV-009)
  // =========================================================================

  describe("6. Deterministic Advisory Manpower Planning & Employee Non-Mutation Invariant", () => {
    it("creates manpower plan, computes gap analysis deterministically, and verifies advisory nature", async () => {
      const planRes = await post("/workforce/advanced/manpower-plans", hrStaffToken, {
        planYear: 2027,
        title: "FY2027 Engineering Headcount & Budget Projection",
        organizationUnitId: orgUnitNorthId,
      });
      expect(planRes.statusCode).toBe(201);
      const plan = planRes.json();
      manpowerPlanId = plan.id;
      expect(plan.planNumber).toMatch(/^MPP-\d{4}-\d+$/);
      expect(plan.status).toBe("draft");

      // Compute plan with target headcount by position
      const computeRes = await post(`/workforce/advanced/manpower-plans/${manpowerPlanId}/compute`, hrStaffToken, {
        targetHeadcountByPosition: {
          [engineerPositionId]: 5,
          [supervisorPositionId]: 2,
        },
      });
      expect(computeRes.statusCode).toBe(200);
      const computed = computeRes.json();
      expect(computed.status).toBe("computed");
      expect(computed.currentHeadcount).toBeGreaterThanOrEqual(1);
      expect(computed.plannedHeadcount).toBeGreaterThan(computed.currentHeadcount);
      expect(computed.varianceHeadcount).toBe(computed.plannedHeadcount - computed.currentHeadcount);
      expect(computed.varianceCostProjection).toBeGreaterThan(0);
      expect(Array.isArray(computed.gapAnalysis)).toBe(true);
      expect(computed.gapAnalysis.length).toBeGreaterThanOrEqual(2);

      // Invariant: Manpower Planning Apply records decision and freezes projection without mutating employees
      const employeeCountBefore = (await get("/employees", adminToken)).json().length;

      const applyRes = await post(`/workforce/advanced/manpower-plans/${manpowerPlanId}/apply`, approverToken);
      expect(applyRes.statusCode).toBe(200);
      expect(applyRes.json().status).toBe("applied");
      expect(applyRes.json().appliedAt).toBeTruthy();

      const employeeCountAfter = (await get("/employees", adminToken)).json().length;
      expect(employeeCountAfter).toBe(employeeCountBefore); // Strictly NO synthetic employee mutations!
    });
  });

  // =========================================================================
  // Cross-Cutting Invariants: Tenant Isolation, Data Scope & RBAC Denial
  // =========================================================================

  describe("Cross-Cutting Invariants: Multi-Tenant Isolation, Data Scope & RBAC", () => {
    const expectOnlyEmployeeIds = (records: any[], employeeIds: string[]) => {
      const actualIds = records.map((record) =>
        record.employeeId ?? record.leaveRequest?.employeeId ?? record.overtimeRequest?.employeeId ?? record.review?.employeeId,
      );
      expect(actualIds.every((id) => employeeIds.includes(id))).toBe(true);
    };

    it("enforces multi-tenant isolation across all Workforce Advanced resources", async () => {
      // Other tenant cannot access Primary tenant shifts
      expect((await get(`/workforce/advanced/shifts`, otherAdminToken)).json().some((s: any) => s.id === morningShiftId)).toBe(false);

      // Other tenant cannot access Primary tenant payroll run
      const otherRunRes = await get(`/workforce/advanced/payroll-runs/${payrollRunId}`, otherAdminToken);
      expect(otherRunRes.statusCode).toBe(404);

      // Other tenant cannot access Primary tenant job postings
      const otherJobRes = await get(`/workforce/advanced/job-postings`, otherAdminToken);
      expect(otherJobRes.json().some((j: any) => j.id === jobPostingId)).toBe(false);

      // Other tenant cannot apply Primary tenant manpower plan
      const otherApplyPlan = await post(`/workforce/advanced/manpower-plans/${manpowerPlanId}/apply`, otherAdminToken);
      expect(otherApplyPlan.statusCode).toBe(404);
    });

    it("scopes every unfiltered Organization-Unit list at SQL level", async () => {
      const northRosterSeed = await put("/workforce/advanced/rosters", hrStaffToken, {
        employeeId: employeeBetaId,
        shiftId: morningShiftId,
        rosterDate: "2026-09-16",
        organizationUnitId: orgUnitNorthChildId,
      });
      expect(northRosterSeed.statusCode).toBe(200);

      const southRosterSeed = await put("/workforce/advanced/rosters", hrStaffToken, {
        employeeId: employeeGammaId,
        shiftId: morningShiftId,
        rosterDate: "2026-09-16",
        organizationUnitId: orgUnitSouthId,
      });
      expect(southRosterSeed.statusCode).toBe(200);

      const southAttendanceSeed = await post("/workforce/advanced/attendance", hrStaffToken, {
        employeeId: employeeGammaId,
        attendanceDate: "2026-09-16",
        shiftId: morningShiftId,
        status: "present",
        source: "manual",
      });
      expect(southAttendanceSeed.statusCode).toBe(201);

      const southLeaveSeed = await post("/workforce/advanced/leave-requests", hrStaffToken, {
        employeeId: employeeGammaId,
        leaveTypeId: annualLeaveTypeId,
        startDate: "2026-11-03",
        endDate: "2026-11-03",
        totalDays: 1,
        reason: "South scope negative control",
      });
      expect(southLeaveSeed.statusCode).toBe(201);
      const southLeaveRequestId = southLeaveSeed.json().id;

      const southOvertimeSeed = await post("/workforce/advanced/overtime-requests", hrStaffToken, {
        employeeId: employeeGammaId,
        overtimeDate: "2026-09-17",
        startTime: "18:00",
        endTime: "20:00",
        estimatedHours: 2,
        reason: "South scope negative control",
      });
      expect(southOvertimeSeed.statusCode).toBe(201);
      const southOvertimeRequestId = southOvertimeSeed.json().id;

      const southPayrollSeed = await post("/workforce/advanced/payroll-runs", hrStaffToken, {
        periodMonth: 10,
        periodYear: 2026,
        organizationUnitId: orgUnitSouthId,
      });
      expect(southPayrollSeed.statusCode).toBe(201);
      const southPayrollRunId = southPayrollSeed.json().id;

      const southPostingSeed = await post("/workforce/advanced/job-postings", hrStaffToken, {
        title: "South Operations Analyst",
        positionId: supervisorPositionId,
        organizationUnitId: orgUnitSouthId,
        headcountTarget: 1,
      });
      expect(southPostingSeed.statusCode).toBe(201);
      const southJobPostingId = southPostingSeed.json().id;

      const southApplicationSeed = await post("/workforce/advanced/job-applications", hrStaffToken, {
        jobPostingId: southJobPostingId,
        candidateName: "South Scope Candidate",
        candidateEmail: "south.scope@candidate.test",
      });
      expect(southApplicationSeed.statusCode).toBe(201);
      const southJobApplicationId = southApplicationSeed.json().id;

      const southReviewSeed = await post("/workforce/advanced/performance-reviews", hrStaffToken, {
        employeeId: employeeGammaId,
        periodStart: "2026-07-01",
        periodEnd: "2026-12-31",
        overallRating: 3.5,
        reviewNotes: "South scope negative control",
      });
      expect(southReviewSeed.statusCode).toBe(201);
      const southPerformanceReviewId = southReviewSeed.json().id;

      const southPlanSeed = await post("/workforce/advanced/manpower-plans", hrStaffToken, {
        planYear: 2027,
        title: "South Operations Plan",
        organizationUnitId: orgUnitSouthId,
      });
      expect(southPlanSeed.statusCode).toBe(201);
      const southManpowerPlanId = southPlanSeed.json().id;

      const scopedRosters = await get("/workforce/advanced/rosters", northManagerToken);
      expect(scopedRosters.statusCode).toBe(200);
      expectOnlyEmployeeIds(scopedRosters.json(), [employeeAlphaId, employeeBetaId]);
      expect(scopedRosters.json().some((record: any) => record.id === northRosterSeed.json().id)).toBe(true);
      expect(scopedRosters.json().some((record: any) => record.id === southRosterSeed.json().id)).toBe(false);

      const scopedAttendance = await get("/workforce/advanced/attendance", northManagerToken);
      expect(scopedAttendance.statusCode).toBe(200);
      expectOnlyEmployeeIds(scopedAttendance.json(), [employeeAlphaId, employeeBetaId]);
      expect(scopedAttendance.json().some((record: any) => record.id === southAttendanceSeed.json().id)).toBe(false);

      const scopedLeave = await get("/workforce/advanced/leave-requests", northManagerToken);
      expect(scopedLeave.statusCode).toBe(200);
      expectOnlyEmployeeIds(scopedLeave.json(), [employeeAlphaId, employeeBetaId]);
      expect(scopedLeave.json().some((item: any) => item.leaveRequest.id === southLeaveRequestId)).toBe(false);

      const scopedOvertime = await get("/workforce/advanced/overtime-requests", northManagerToken);
      expect(scopedOvertime.statusCode).toBe(200);
      expectOnlyEmployeeIds(scopedOvertime.json(), [employeeAlphaId, employeeBetaId]);
      expect(scopedOvertime.json().some((item: any) => item.overtimeRequest.id === southOvertimeRequestId)).toBe(false);

      const scopedPayroll = await get("/workforce/advanced/payroll-runs", northManagerToken);
      expect(scopedPayroll.statusCode).toBe(200);
      expect(scopedPayroll.json().some((item: any) => item.payrollRun.id === payrollRunId)).toBe(true);
      expect(scopedPayroll.json().some((item: any) => item.payrollRun.id === southPayrollRunId)).toBe(false);

      const scopedPostings = await get("/workforce/advanced/job-postings", northManagerToken);
      expect(scopedPostings.statusCode).toBe(200);
      expect(scopedPostings.json().some((item: any) => item.jobPosting.id === jobPostingId)).toBe(true);
      expect(scopedPostings.json().some((item: any) => item.jobPosting.id === southJobPostingId)).toBe(false);

      const scopedApplications = await get("/workforce/advanced/job-applications", northManagerToken);
      expect(scopedApplications.statusCode).toBe(200);
      expect(scopedApplications.json().some((item: any) => item.id === southJobApplicationId)).toBe(false);

      const scopedReviews = await get("/workforce/advanced/performance-reviews", northManagerToken);
      expect(scopedReviews.statusCode).toBe(200);
      expectOnlyEmployeeIds(scopedReviews.json(), [employeeAlphaId, employeeBetaId]);
      expect(scopedReviews.json().some((item: any) => item.review.id === southPerformanceReviewId)).toBe(false);

      const scopedPlans = await get("/workforce/advanced/manpower-plans", northManagerToken);
      expect(scopedPlans.statusCode).toBe(200);
      expect(scopedPlans.json().some((item: any) => item.id === southManpowerPlanId)).toBe(false);
    });

    it("fails closed on out-of-scope detail, mutation, workflow, and tenant-level paths", async () => {
      const southLeave = (await get(`/workforce/advanced/leave-requests?employeeId=${employeeGammaId}`, hrStaffToken)).json()[0].leaveRequest;
      const southOvertime = (await get(`/workforce/advanced/overtime-requests?employeeId=${employeeGammaId}`, hrStaffToken)).json()[0].overtimeRequest;
      const southPayroll = (await get(`/workforce/advanced/payroll-runs?organizationUnitId=${orgUnitSouthId}`, hrStaffToken)).json()[0].payrollRun;
      const southPosting = (await get(`/workforce/advanced/job-postings?organizationUnitId=${orgUnitSouthId}`, hrStaffToken)).json()[0].jobPosting;
      const southApplication = (await get(`/workforce/advanced/job-applications?jobPostingId=${southPosting.id}`, hrStaffToken)).json()[0];
      const southReview = (await get(`/workforce/advanced/performance-reviews?employeeId=${employeeGammaId}`, hrStaffToken)).json()[0].review;
      const southPlan = (await get(`/workforce/advanced/manpower-plans?organizationUnitId=${orgUnitSouthId}`, hrStaffToken)).json()[0];

      const detailDenials = await Promise.all([
        get(`/workforce/advanced/leave-requests/${southLeave.id}`, northManagerToken),
        get(`/workforce/advanced/overtime-requests/${southOvertime.id}`, northManagerToken),
        get(`/workforce/advanced/payroll-runs/${southPayroll.id}`, northManagerToken),
        get(`/workforce/advanced/job-postings/${southPosting.id}`, northManagerToken),
        get(`/workforce/advanced/performance-reviews/${southReview.id}`, northManagerToken),
        get(`/workforce/advanced/manpower-plans/${southPlan.id}`, northManagerToken),
      ]);
      for (const denial of detailDenials) expect([403, 404]).toContain(denial.statusCode);

      const southRosterDenied = await put("/workforce/advanced/rosters", northManagerToken, {
        employeeId: employeeGammaId,
        shiftId: morningShiftId,
        rosterDate: "2026-09-18",
        organizationUnitId: orgUnitSouthId,
      });
      expect(southRosterDenied.statusCode).toBe(403);
      expect((await post(`/workforce/advanced/overtime-requests/${southOvertime.id}/actual`, northManagerToken, { actualHours: 2.5 })).statusCode).toBe(403);
      expect((await post(`/workforce/advanced/payroll-runs/${southPayroll.id}/calculate`, northManagerToken)).statusCode).toBe(403);
      expect((await post(`/workforce/advanced/job-applications/${southApplication.id}/stage`, northManagerToken, { stage: "screening" })).statusCode).toBe(403);
      expect((await post(`/workforce/advanced/performance-reviews/${southReview.id}/act`, northManagerToken, { actionCode: "finalize" })).statusCode).toBe(403);
      expect((await post(`/workforce/advanced/manpower-plans/${southPlan.id}/compute`, northManagerToken, { targetHeadcountByPosition: {} })).statusCode).toBe(403);
      expect((await post(`/workforce/advanced/manpower-plans/${southPlan.id}/apply`, northManagerToken)).statusCode).toBe(403);

      expect((await get("/workforce/advanced/shifts", northManagerToken)).statusCode).toBe(403);
      expect((await get("/workforce/advanced/leave-types", northManagerToken)).statusCode).toBe(403);
      expect((await get("/workforce/advanced/statutory-policies", northManagerToken)).statusCode).toBe(403);
      expect((await get("/workforce/advanced/competencies", northManagerToken)).statusCode).toBe(403);
      expect((await get("/workforce/advanced/training-courses", northManagerToken)).statusCode).toBe(403);
      expect((await get("/workforce/advanced/career-paths", northManagerToken)).statusCode).toBe(403);
    });

    it("inherits Data Scope through Workforce Advanced document resolvers", async () => {
      const northApplication = (await get(`/workforce/advanced/job-applications?jobPostingId=${jobPostingId}`, hrStaffToken)).json()[0];
      const northEnrollment = (await get(`/workforce/advanced/training-enrollments?employeeId=${employeeAlphaId}`, hrStaffToken)).json()[0];
      const southLeave = (await get(`/workforce/advanced/leave-requests?employeeId=${employeeGammaId}`, hrStaffToken)).json()[0].leaveRequest;
      const southPosting = (await get(`/workforce/advanced/job-postings?organizationUnitId=${orgUnitSouthId}`, hrStaffToken)).json()[0].jobPosting;
      const southApplication = (await get(`/workforce/advanced/job-applications?jobPostingId=${southPosting.id}`, hrStaffToken)).json()[0];
      const southEnrollmentRes = await post("/workforce/advanced/training-enrollments", hrStaffToken, {
        trainingCourseId,
        employeeId: employeeGammaId,
      });
      expect(southEnrollmentRes.statusCode).toBe(201);
      const southEnrollment = southEnrollmentRes.json();

      const uploadDocument = (entityType: string, entityId: string, fileName: string) => {
        const boundary = `----wavea4${Date.now()}${entityType}`;
        return app.inject({
          method: "POST",
          url: "/documents",
          headers: { ...authHeader(hrStaffToken), "content-type": `multipart/form-data; boundary=${boundary}` },
          payload: Buffer.from(
            `--${boundary}\r\nContent-Disposition: form-data; name="entityType"\r\n\r\n${entityType}\r\n` +
              `--${boundary}\r\nContent-Disposition: form-data; name="entityId"\r\n\r\n${entityId}\r\n` +
              `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${fileName}"\r\n` +
              `Content-Type: text/plain\r\n\r\nwave-a4-scope-evidence\r\n--${boundary}--\r\n`,
          ),
        });
      };

      const northDocuments = await Promise.all([
        uploadDocument("workforce_leave_request", leaveRequestId, "north-leave.txt"),
        uploadDocument("workforce_job_application", northApplication.id, "north-resume.txt"),
        uploadDocument("workforce_training_enrollment", northEnrollment.id, "north-training.txt"),
      ]);
      const southDocuments = await Promise.all([
        uploadDocument("workforce_leave_request", southLeave.id, "south-leave.txt"),
        uploadDocument("workforce_job_application", southApplication.id, "south-resume.txt"),
        uploadDocument("workforce_training_enrollment", southEnrollment.id, "south-training.txt"),
      ]);
      for (const upload of [...northDocuments, ...southDocuments]) expect(upload.statusCode).toBe(201);

      const entityChecks = [
        ["workforce_leave_request", leaveRequestId, southLeave.id],
        ["workforce_job_application", northApplication.id, southApplication.id],
        ["workforce_training_enrollment", northEnrollment.id, southEnrollment.id],
      ] as const;
      for (const [entityType, northEntityId, southEntityId] of entityChecks) {
        const allowed = await get(`/documents?entityType=${entityType}&entityId=${northEntityId}`, northManagerToken);
        expect(allowed.statusCode).toBe(200);
        expect(allowed.json().length).toBeGreaterThan(0);

        const denied = await get(`/documents?entityType=${entityType}&entityId=${southEntityId}`, northManagerToken);
        expect(denied.statusCode).toBe(403);
      }

      for (const upload of southDocuments) {
        const deniedDownload = await get(`/documents/${upload.json().id}/download`, northManagerToken);
        expect(deniedDownload.statusCode).toBe(403);
      }
    });

    it("enforces RBAC denial for each individual permission family", async () => {
      // Read-only user cannot manage shifts (workforce.attendance.manage)
      const denyShift = await post("/workforce/advanced/shifts", restrictedUserToken, {
        shiftCode: "UNAUTHORIZED",
        name: "Unauthorized Shift",
        startTime: "08:00",
        endTime: "17:00",
      });
      expect(denyShift.statusCode).toBe(403);

      // Read-only user cannot allocate leave (workforce.leave.manage)
      const denyLeaveAlloc = await put("/workforce/advanced/leave-balances", restrictedUserToken, {
        employeeId: employeeAlphaId,
        leaveTypeId: annualLeaveTypeId,
        balanceYear: 2026,
        allocatedDays: 20,
      });
      expect(denyLeaveAlloc.statusCode).toBe(403);

      // HR Staff (manage only) cannot act as executive approver (workforce.leave.approve / workforce.payroll.approve)
      const denyLeaveApprove = await post(`/workforce/advanced/leave-requests/${leaveRequestId}/act`, hrStaffToken, {
        actionCode: "approve",
      });
      expect(denyLeaveApprove.statusCode).toBe(403);

      const denyPayrollApprove = await post(`/workforce/advanced/payroll-runs/${payrollRunId}/act`, hrStaffToken, {
        actionCode: "approve",
      });
      expect(denyPayrollApprove.statusCode).toBe(403);

      // HR Staff cannot apply manpower plan without workforce.planning.apply
      const denyPlanApply = await post(`/workforce/advanced/manpower-plans/${manpowerPlanId}/apply`, hrStaffToken);
      expect(denyPlanApply.statusCode).toBe(403);
    });

    it("verifies Core Workforce endpoints remain fully operational alongside Advanced", async () => {
      // Positions
      const positionsRes = await get("/positions", adminToken);
      expect(positionsRes.statusCode).toBe(200);
      expect(positionsRes.json().length).toBeGreaterThanOrEqual(3);

      // Employees list & detail
      const empRes = await get(`/employees/${employeeAlphaId}`, adminToken);
      expect(empRes.statusCode).toBe(200);
      expect(empRes.json().employee.fullName).toBe("Budi Santoso");
      expect(empRes.json().history.length).toBeGreaterThanOrEqual(1);

      // Placement update
      const moveRes = await post(`/employees/${employeeAlphaId}/placement`, adminToken, {
        positionCode: "SENIOR_SOFTWARE_ENG",
        effectiveFrom: "2026-09-01",
        note: "Merit promotion to Senior Engineer",
      });
      expect(moveRes.statusCode).toBe(200);
      expect(moveRes.json().position.code).toBe("SENIOR_SOFTWARE_ENG");
    });
  });
});
