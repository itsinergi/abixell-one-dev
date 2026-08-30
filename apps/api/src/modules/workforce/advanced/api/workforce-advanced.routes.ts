import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Container } from "../../../../composition-root.js";

/**
 * Workforce Advanced HTTP routes (Wave A4).
 *
 * Scope:
 * - HR-ADV-001/002: Attendance, Shift & Roster
 * - HR-ADV-003/004: Leave & Overtime
 * - HR-ADV-005: Payroll, BPJS & PPh 21
 * - HR-ADV-006: Recruitment
 * - HR-ADV-007/008: Performance, Competency, Training & Career
 * - HR-ADV-009: Manpower Planning
 */

const dateOnlyRegex = /^\d{4}-\d{2}-\d{2}$/;
const timeRegex = /^\d{2}:\d{2}(:\d{2})?$/;

const idParamSchema = z.object({ id: z.string().uuid() });
const actionSchema = z.object({
  actionCode: z.string().min(1),
  comment: z.string().nullable().optional(),
});

const createShiftSchema = z.object({
  shiftCode: z.string().min(1),
  name: z.string().min(1),
  startTime: z.string().regex(timeRegex),
  endTime: z.string().regex(timeRegex),
  breakMinutes: z.number().int().min(0).optional(),
  isOvernight: z.boolean().optional(),
});
const setActiveSchema = z.object({ isActive: z.boolean() });

const upsertRosterSchema = z.object({
  employeeId: z.string().uuid(),
  shiftId: z.string().uuid(),
  rosterDate: z.string().regex(dateOnlyRegex),
  organizationUnitId: z.string().uuid().nullable().optional(),
  notes: z.string().nullable().optional(),
});

const recordAttendanceSchema = z.object({
  employeeId: z.string().uuid(),
  attendanceDate: z.string().regex(dateOnlyRegex),
  shiftId: z.string().uuid().nullable().optional(),
  clockIn: z.string().datetime().nullable().optional(),
  clockOut: z.string().datetime().nullable().optional(),
  status: z.enum(["present", "late", "absent", "leave", "holiday", "day_off"]).optional(),
  source: z.enum(["manual", "self_service", "import", "device"]).optional(),
  notes: z.string().nullable().optional(),
});

const createLeaveTypeSchema = z.object({
  code: z.string().min(1),
  name: z.string().min(1),
  annualAllowanceDays: z.number().nonnegative().optional(),
  isPaid: z.boolean().optional(),
  requiresAttachment: z.boolean().optional(),
});
const setLeaveAllocationSchema = z.object({
  employeeId: z.string().uuid(),
  leaveTypeId: z.string().uuid(),
  balanceYear: z.number().int().min(2000).max(2200),
  allocatedDays: z.number().nonnegative(),
});
const createLeaveRequestSchema = z.object({
  employeeId: z.string().uuid(),
  leaveTypeId: z.string().uuid(),
  startDate: z.string().regex(dateOnlyRegex),
  endDate: z.string().regex(dateOnlyRegex),
  totalDays: z.number().positive(),
  reason: z.string().nullable().optional(),
  attachmentDocumentId: z.string().uuid().nullable().optional(),
});

const createOvertimeRequestSchema = z.object({
  employeeId: z.string().uuid(),
  overtimeDate: z.string().regex(dateOnlyRegex),
  startTime: z.string().regex(timeRegex),
  endTime: z.string().regex(timeRegex),
  estimatedHours: z.number().positive(),
  reason: z.string().nullable().optional(),
});
const actualOvertimeSchema = z.object({ actualHours: z.number().nonnegative() });

const pphBracketSchema = z.object({
  upTo: z.number().positive().nullable(),
  rate: z.number().nonnegative(),
});
const pphTerBracketSchema = z.object({
  category: z.enum(["A", "B", "C"]),
  upTo: z.number().positive().nullable(),
  rate: z.number().nonnegative(),
});
const statutoryPolicySchema = z.object({
  policyCode: z.string().min(1),
  name: z.string().min(1),
  countryCode: z.string().min(2).max(3).optional(),
  effectiveFrom: z.string().regex(dateOnlyRegex),
  effectiveTo: z.string().regex(dateOnlyRegex).nullable().optional(),
  bpjsKesehatanRateEmployer: z.number().nonnegative().optional(),
  bpjsKesehatanRateEmployee: z.number().nonnegative().optional(),
  bpjsKesehatanCap: z.number().nonnegative().nullable().optional(),
  bpjsTkJhtRateEmployer: z.number().nonnegative().optional(),
  bpjsTkJhtRateEmployee: z.number().nonnegative().optional(),
  bpjsTkJkkRate: z.number().nonnegative().optional(),
  bpjsTkJkmRate: z.number().nonnegative().optional(),
  bpjsTkJpRateEmployer: z.number().nonnegative().optional(),
  bpjsTkJpRateEmployee: z.number().nonnegative().optional(),
  bpjsTkJpCap: z.number().nonnegative().nullable().optional(),
  occupationalCostRate: z.number().nonnegative().optional(),
  occupationalCostMonthlyCap: z.number().nonnegative().nullable().optional(),
  ptkpAnnualAmounts: z.record(z.string(), z.number()).optional(),
  pph21Brackets: z.array(pphBracketSchema).optional(),
  pph21TerBrackets: z.array(pphTerBracketSchema).optional(),
  pph21Method: z.enum(["annualized", "ter"]).optional(),
  nonNpwpSurchargeRate: z.number().nonnegative().optional(),
  roundingMode: z.enum(["half_up", "down", "up"]).optional(),
});
const salaryProfileSchema = z.object({
  employeeId: z.string().uuid(),
  baseSalary: z.number().nonnegative(),
  fixedAllowance: z.number().nonnegative().optional(),
  overtimeHourlyRate: z.number().nonnegative().nullable().optional(),
  ptkpStatus: z.enum(["TK/0", "TK/1", "TK/2", "TK/3", "K/0", "K/1", "K/2", "K/3"]),
  hasNpwp: z.boolean().optional(),
  bpjsKesehatanNumber: z.string().nullable().optional(),
  bpjsTkNumber: z.string().nullable().optional(),
  bankName: z.string().nullable().optional(),
  bankAccountNumber: z.string().nullable().optional(),
  effectiveFrom: z.string().regex(dateOnlyRegex),
});
const createPayrollRunSchema = z.object({
  periodMonth: z.number().int().min(1).max(12),
  periodYear: z.number().int().min(2000).max(2200),
  organizationUnitId: z.string().uuid().nullable().optional(),
});

const createJobPostingSchema = z.object({
  title: z.string().min(1),
  positionId: z.string().uuid().nullable().optional(),
  organizationUnitId: z.string().uuid().nullable().optional(),
  headcountTarget: z.number().int().positive().optional(),
  employmentType: z.string().nullable().optional(),
  jobDescription: z.string().nullable().optional(),
});
const createJobApplicationSchema = z.object({
  jobPostingId: z.string().uuid(),
  candidateName: z.string().min(1),
  candidateEmail: z.string().email().nullable().optional(),
  candidatePhone: z.string().nullable().optional(),
  resumeDocumentId: z.string().uuid().nullable().optional(),
});
const advanceJobApplicationSchema = z.object({
  stage: z.enum(["applied", "screening", "interview", "offer", "hired", "rejected", "withdrawn"]),
  rating: z.number().min(0).max(5).nullable().optional(),
  interviewerNotes: z.string().nullable().optional(),
  hiredEmployeeId: z.string().uuid().nullable().optional(),
});

const competencySchema = z.object({
  code: z.string().min(1),
  name: z.string().min(1),
  category: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
  scaleMin: z.number().int().optional(),
  scaleMax: z.number().int().optional(),
});
const assessCompetencySchema = z.object({
  employeeId: z.string().uuid(),
  competencyId: z.string().uuid(),
  proficiencyLevel: z.number().int(),
  notes: z.string().nullable().optional(),
});
const trainingCourseSchema = z.object({
  courseCode: z.string().min(1),
  title: z.string().min(1),
  provider: z.string().nullable().optional(),
  durationHours: z.number().nonnegative().optional(),
  competencyId: z.string().uuid().nullable().optional(),
  description: z.string().nullable().optional(),
});
const enrollTrainingSchema = z.object({
  trainingCourseId: z.string().uuid(),
  employeeId: z.string().uuid(),
});
const completeTrainingSchema = z.object({
  status: z.enum(["completed", "failed"]),
  completionDate: z.string().regex(dateOnlyRegex),
  score: z.number().nonnegative().nullable().optional(),
  certificateDocumentId: z.string().uuid().nullable().optional(),
});
const performanceReviewSchema = z.object({
  employeeId: z.string().uuid(),
  periodStart: z.string().regex(dateOnlyRegex),
  periodEnd: z.string().regex(dateOnlyRegex),
  reviewerUserId: z.string().uuid().nullable().optional(),
  goalsScore: z.number().nonnegative().nullable().optional(),
  competencyScore: z.number().nonnegative().nullable().optional(),
  overallRating: z.number().nonnegative().nullable().optional(),
  reviewNotes: z.string().nullable().optional(),
  developmentPlan: z.string().nullable().optional(),
});
const careerPathSchema = z.object({
  fromPositionId: z.string().uuid(),
  toPositionId: z.string().uuid(),
  requiredTenureMonths: z.number().int().nonnegative().optional(),
  requiredCompetencyIds: z.array(z.string().uuid()).optional(),
  guidelines: z.string().nullable().optional(),
});

const createManpowerPlanSchema = z.object({
  planYear: z.number().int().min(2000).max(2200),
  organizationUnitId: z.string().uuid().nullable().optional(),
  title: z.string().min(1),
  parameters: z.record(z.string(), z.unknown()).optional(),
});
const computeManpowerPlanSchema = z.object({
  targetHeadcountByPosition: z.record(z.string().uuid(), z.number().int().nonnegative()),
});
const manpowerPlanStatusQuerySchema = z
  .enum(["draft", "computed", "applied", "dismissed"])
  .optional();

function query(requestQuery: unknown): Record<string, string | undefined> {
  return requestQuery as Record<string, string | undefined>;
}

function booleanQuery(value: string | undefined): boolean | undefined {
  return value === undefined ? undefined : value === "true";
}

export function registerWorkforceAdvancedRoutes(app: FastifyInstance, container: Container) {
  const svc = () => container.workforceAdvanced;

  // --- Attendance, Shift & Roster (HR-ADV-001/002) -------------------------

  app.post("/workforce/advanced/shifts", { preHandler: app.authenticate }, async (request, reply) => {
    const body = createShiftSchema.parse(request.body);
    return reply.status(201).send(await svc().createShift(request.actor!, body));
  });

  app.get("/workforce/advanced/shifts", { preHandler: app.authenticate }, async (request, reply) => {
    const q = query(request.query);
    return reply.send(await svc().listShifts(request.actor!, booleanQuery(q.includeInactive)));
  });

  app.patch("/workforce/advanced/shifts/:id/active", { preHandler: app.authenticate }, async (request, reply) => {
    const { id } = idParamSchema.parse(request.params);
    const { isActive } = setActiveSchema.parse(request.body);
    return reply.send(await svc().setShiftActive(request.actor!, id, isActive));
  });

  app.put("/workforce/advanced/rosters", { preHandler: app.authenticate }, async (request, reply) => {
    const body = upsertRosterSchema.parse(request.body);
    return reply.send(await svc().upsertRoster(request.actor!, body));
  });

  app.get("/workforce/advanced/rosters", { preHandler: app.authenticate }, async (request, reply) => {
    const q = query(request.query);
    return reply.send(await svc().listRosters(request.actor!, q));
  });

  app.post("/workforce/advanced/attendance", { preHandler: app.authenticate }, async (request, reply) => {
    const body = recordAttendanceSchema.parse(request.body);
    return reply.status(201).send(await svc().recordAttendance(request.actor!, body));
  });

  app.get("/workforce/advanced/attendance", { preHandler: app.authenticate }, async (request, reply) => {
    const q = query(request.query);
    return reply.send(await svc().listAttendance(request.actor!, q));
  });

  // --- Leave & Overtime (HR-ADV-003/004) -----------------------------------

  app.post("/workforce/advanced/leave-types", { preHandler: app.authenticate }, async (request, reply) => {
    const body = createLeaveTypeSchema.parse(request.body);
    return reply.status(201).send(await svc().createLeaveType(request.actor!, body));
  });

  app.get("/workforce/advanced/leave-types", { preHandler: app.authenticate }, async (request, reply) => {
    const q = query(request.query);
    return reply.send(await svc().listLeaveTypes(request.actor!, booleanQuery(q.includeInactive)));
  });

  app.put("/workforce/advanced/leave-balances", { preHandler: app.authenticate }, async (request, reply) => {
    const body = setLeaveAllocationSchema.parse(request.body);
    return reply.send(await svc().setLeaveAllocation(request.actor!, body));
  });

  app.get("/workforce/advanced/leave-balances", { preHandler: app.authenticate }, async (request, reply) => {
    const q = query(request.query);
    const employeeId = z.string().uuid().parse(q.employeeId);
    return reply.send(
      await svc().listLeaveBalances(
        request.actor!,
        employeeId,
        q.balanceYear ? Number(q.balanceYear) : undefined,
      ),
    );
  });

  app.post("/workforce/advanced/leave-requests", { preHandler: app.authenticate }, async (request, reply) => {
    const body = createLeaveRequestSchema.parse(request.body);
    return reply.status(201).send(await svc().createLeaveRequest(request.actor!, body));
  });

  app.get("/workforce/advanced/leave-requests", { preHandler: app.authenticate }, async (request, reply) => {
    const q = query(request.query);
    return reply.send(await svc().listLeaveRequests(request.actor!, q));
  });

  app.post("/workforce/advanced/leave-requests/:id/act", { preHandler: app.authenticate }, async (request, reply) => {
    const { id } = idParamSchema.parse(request.params);
    const body = actionSchema.parse(request.body);
    return reply.send(await svc().actOnLeaveRequest(request.actor!, id, body.actionCode, body.comment ?? null));
  });

  app.post("/workforce/advanced/overtime-requests", { preHandler: app.authenticate }, async (request, reply) => {
    const body = createOvertimeRequestSchema.parse(request.body);
    return reply.status(201).send(await svc().createOvertimeRequest(request.actor!, body));
  });

  app.get("/workforce/advanced/overtime-requests", { preHandler: app.authenticate }, async (request, reply) => {
    const q = query(request.query);
    return reply.send(await svc().listOvertimeRequests(request.actor!, q));
  });

  app.post("/workforce/advanced/overtime-requests/:id/actual", { preHandler: app.authenticate }, async (request, reply) => {
    const { id } = idParamSchema.parse(request.params);
    const body = actualOvertimeSchema.parse(request.body);
    return reply.send(await svc().recordActualOvertimeHours(request.actor!, id, body.actualHours));
  });

  app.post("/workforce/advanced/overtime-requests/:id/act", { preHandler: app.authenticate }, async (request, reply) => {
    const { id } = idParamSchema.parse(request.params);
    const body = actionSchema.parse(request.body);
    return reply.send(await svc().actOnOvertimeRequest(request.actor!, id, body.actionCode, body.comment ?? null));
  });

  // --- Payroll, BPJS & PPh 21 (HR-ADV-005) ---------------------------------

  app.post("/workforce/advanced/statutory-policies", { preHandler: app.authenticate }, async (request, reply) => {
    const body = statutoryPolicySchema.parse(request.body);
    return reply.status(201).send(await svc().createStatutoryPolicy(request.actor!, body));
  });

  app.get("/workforce/advanced/statutory-policies", { preHandler: app.authenticate }, async (request, reply) => {
    return reply.send(await svc().listStatutoryPolicies(request.actor!));
  });

  app.put("/workforce/advanced/salary-profiles", { preHandler: app.authenticate }, async (request, reply) => {
    const body = salaryProfileSchema.parse(request.body);
    return reply.send(await svc().setSalaryProfile(request.actor!, body));
  });

  app.post("/workforce/advanced/payroll-runs", { preHandler: app.authenticate }, async (request, reply) => {
    const body = createPayrollRunSchema.parse(request.body);
    return reply.status(201).send(await svc().createPayrollRun(request.actor!, body));
  });

  app.get("/workforce/advanced/payroll-runs", { preHandler: app.authenticate }, async (request, reply) => {
    const q = query(request.query);
    return reply.send(await svc().listPayrollRuns(request.actor!, {
      organizationUnitId: q.organizationUnitId,
      periodYear: q.periodYear ? Number(q.periodYear) : undefined,
    }));
  });

  app.get("/workforce/advanced/payroll-runs/:id", { preHandler: app.authenticate }, async (request, reply) => {
    const { id } = idParamSchema.parse(request.params);
    return reply.send(await svc().getPayrollRun(request.actor!, id));
  });

  app.post("/workforce/advanced/payroll-runs/:id/calculate", { preHandler: app.authenticate }, async (request, reply) => {
    const { id } = idParamSchema.parse(request.params);
    return reply.send(await svc().calculatePayrollRun(request.actor!, id));
  });

  app.post("/workforce/advanced/payroll-runs/:id/act", { preHandler: app.authenticate }, async (request, reply) => {
    const { id } = idParamSchema.parse(request.params);
    const body = actionSchema.parse(request.body);
    return reply.send(await svc().actOnPayrollRun(request.actor!, id, body.actionCode, body.comment ?? null));
  });

  app.get("/workforce/advanced/payroll-runs/:id/payslips", { preHandler: app.authenticate }, async (request, reply) => {
    const { id } = idParamSchema.parse(request.params);
    return reply.send(await svc().listPayslipsByRun(request.actor!, id));
  });

  // --- Recruitment (HR-ADV-006) --------------------------------------------

  app.post("/workforce/advanced/job-postings", { preHandler: app.authenticate }, async (request, reply) => {
    const body = createJobPostingSchema.parse(request.body);
    return reply.status(201).send(await svc().createJobPosting(request.actor!, body));
  });

  app.get("/workforce/advanced/job-postings", { preHandler: app.authenticate }, async (request, reply) => {
    const q = query(request.query);
    return reply.send(await svc().listJobPostings(request.actor!, q));
  });

  app.post("/workforce/advanced/job-postings/:id/act", { preHandler: app.authenticate }, async (request, reply) => {
    const { id } = idParamSchema.parse(request.params);
    const body = actionSchema.parse(request.body);
    return reply.send(await svc().actOnJobPosting(request.actor!, id, body.actionCode, body.comment ?? null));
  });

  app.post("/workforce/advanced/job-applications", { preHandler: app.authenticate }, async (request, reply) => {
    const body = createJobApplicationSchema.parse(request.body);
    return reply.status(201).send(await svc().createJobApplication(request.actor!, body));
  });

  app.get("/workforce/advanced/job-applications", { preHandler: app.authenticate }, async (request, reply) => {
    const q = query(request.query);
    return reply.send(await svc().listJobApplications(request.actor!, q));
  });

  app.post("/workforce/advanced/job-applications/:id/stage", { preHandler: app.authenticate }, async (request, reply) => {
    const { id } = idParamSchema.parse(request.params);
    const body = advanceJobApplicationSchema.parse(request.body);
    return reply.send(await svc().advanceJobApplication(request.actor!, { id, ...body }));
  });

  // --- Performance, Competency, Training & Career (HR-ADV-007/008) ---------

  app.post("/workforce/advanced/competencies", { preHandler: app.authenticate }, async (request, reply) => {
    const body = competencySchema.parse(request.body);
    return reply.status(201).send(await svc().createCompetency(request.actor!, body));
  });

  app.get("/workforce/advanced/competencies", { preHandler: app.authenticate }, async (request, reply) => {
    const q = query(request.query);
    return reply.send(await svc().listCompetencies(request.actor!, booleanQuery(q.includeInactive)));
  });

  app.put("/workforce/advanced/employee-competencies", { preHandler: app.authenticate }, async (request, reply) => {
    const body = assessCompetencySchema.parse(request.body);
    return reply.send(await svc().assessEmployeeCompetency(request.actor!, body));
  });

  app.get("/workforce/advanced/employees/:id/competencies", { preHandler: app.authenticate }, async (request, reply) => {
    const { id } = idParamSchema.parse(request.params);
    return reply.send(await svc().listEmployeeCompetencies(request.actor!, id));
  });

  app.post("/workforce/advanced/training-courses", { preHandler: app.authenticate }, async (request, reply) => {
    const body = trainingCourseSchema.parse(request.body);
    return reply.status(201).send(await svc().createTrainingCourse(request.actor!, body));
  });

  app.get("/workforce/advanced/training-courses", { preHandler: app.authenticate }, async (request, reply) => {
    const q = query(request.query);
    return reply.send(await svc().listTrainingCourses(request.actor!, booleanQuery(q.includeInactive)));
  });

  app.post("/workforce/advanced/training-enrollments", { preHandler: app.authenticate }, async (request, reply) => {
    const body = enrollTrainingSchema.parse(request.body);
    return reply.status(201).send(await svc().enrollTraining(request.actor!, body));
  });

  app.get("/workforce/advanced/training-enrollments", { preHandler: app.authenticate }, async (request, reply) => {
    const q = query(request.query);
    const employeeId = z.string().uuid().parse(q.employeeId);
    return reply.send(await svc().listTrainingEnrollments(request.actor!, employeeId));
  });

  app.post("/workforce/advanced/training-enrollments/:id/complete", { preHandler: app.authenticate }, async (request, reply) => {
    const { id } = idParamSchema.parse(request.params);
    const body = completeTrainingSchema.parse(request.body);
    return reply.send(await svc().completeTraining(request.actor!, { id, ...body }));
  });

  app.post("/workforce/advanced/performance-reviews", { preHandler: app.authenticate }, async (request, reply) => {
    const body = performanceReviewSchema.parse(request.body);
    return reply.status(201).send(await svc().createPerformanceReview(request.actor!, body));
  });

  app.get("/workforce/advanced/performance-reviews", { preHandler: app.authenticate }, async (request, reply) => {
    const q = query(request.query);
    return reply.send(await svc().listPerformanceReviews(request.actor!, {
      employeeId: q.employeeId,
      periodYear: q.periodYear ? Number(q.periodYear) : undefined,
    }));
  });

  app.post("/workforce/advanced/performance-reviews/:id/act", { preHandler: app.authenticate }, async (request, reply) => {
    const { id } = idParamSchema.parse(request.params);
    const body = actionSchema.parse(request.body);
    return reply.send(await svc().actOnPerformanceReview(request.actor!, id, body.actionCode, body.comment ?? null));
  });

  app.post("/workforce/advanced/career-paths", { preHandler: app.authenticate }, async (request, reply) => {
    const body = careerPathSchema.parse(request.body);
    return reply.status(201).send(await svc().createCareerPath(request.actor!, body));
  });

  app.get("/workforce/advanced/career-paths", { preHandler: app.authenticate }, async (request, reply) => {
    const q = query(request.query);
    return reply.send(await svc().listCareerPaths(request.actor!, q.fromPositionId));
  });

  // --- Manpower Planning (HR-ADV-009) --------------------------------------

  app.post("/workforce/advanced/manpower-plans", { preHandler: app.authenticate }, async (request, reply) => {
    const body = createManpowerPlanSchema.parse(request.body);
    return reply.status(201).send(await svc().createManpowerPlan(request.actor!, body));
  });

  app.get("/workforce/advanced/manpower-plans", { preHandler: app.authenticate }, async (request, reply) => {
    const q = query(request.query);
    return reply.send(await svc().listManpowerPlans(request.actor!, {
      organizationUnitId: q.organizationUnitId,
      planYear: q.planYear ? Number(q.planYear) : undefined,
      status: manpowerPlanStatusQuerySchema.parse(q.status),
    }));
  });

  app.post("/workforce/advanced/manpower-plans/:id/compute", { preHandler: app.authenticate }, async (request, reply) => {
    const { id } = idParamSchema.parse(request.params);
    const body = computeManpowerPlanSchema.parse(request.body);
    return reply.send(await svc().computeManpowerPlan(request.actor!, { id, ...body }));
  });

  app.post("/workforce/advanced/manpower-plans/:id/apply", { preHandler: app.authenticate }, async (request, reply) => {
    const { id } = idParamSchema.parse(request.params);
    return reply.send(await svc().applyManpowerPlan(request.actor!, id));
  });

  app.post("/workforce/advanced/manpower-plans/:id/dismiss", { preHandler: app.authenticate }, async (request, reply) => {
    const { id } = idParamSchema.parse(request.params);
    return reply.send(await svc().dismissManpowerPlan(request.actor!, id));
  });
}
