/**
 * Workforce Advanced — domain types and port interface.
 *
 * Wave A4 (HR-ADV-001…009). Workforce Core (`employees`, `positions`,
 * `employee_assignments`) answers identity and placement only; everything
 * here is optional depth layered on top through `employeeId` / `positionId`
 * references — Core never imports anything from this module.
 *
 * Scope discipline:
 * - HR-ADV-001/002 (Attendance, Shift & Roster): `WorkforceShift`,
 *   `WorkforceRoster`, `WorkforceAttendanceRecord`.
 * - HR-ADV-003/004 (Leave & Overtime): `WorkforceLeaveType`,
 *   `WorkforceLeaveBalance`, `WorkforceLeaveRequest`,
 *   `WorkforceOvertimeRequest`. Lifecycle is owned EXCLUSIVELY by the
 *   generic Workflow Engine via `workflowInstanceId` — no competing status
 *   column; `submittedAt`/`approvedAt`/`rejectedAt`/`cancelledAt` are
 *   bookkeeping projections of workflow transitions.
 * - HR-ADV-005 (Payroll, BPJS & PPh 21): `WorkforceStatutoryPolicy`
 *   (effective-dated statutory rates/brackets as DATA, never code
 *   constants), `WorkforceEmployeeSalaryProfile`, `WorkforcePayrollRun`
 *   (workflow-delegated), `WorkforcePayslip` (immutable calculation
 *   snapshot per run per employee).
 * - HR-ADV-006 (Recruitment): `WorkforceJobPosting` (workflow-delegated),
 *   `WorkforceJobApplication`.
 * - HR-ADV-007/008 (Performance, Competency, Training & Career):
 *   `WorkforceCompetency`, `WorkforceEmployeeCompetency`,
 *   `WorkforceTrainingCourse`, `WorkforceTrainingEnrollment`,
 *   `WorkforcePerformanceReview` (workflow-delegated), `WorkforceCareerPath`.
 * - HR-ADV-009 (Manpower Planning): `WorkforceManpowerPlan`, deterministic
 *   advisory-only — applying a plan never mutates employee records.
 */

// ---------------------------------------------------------------------------
// Attendance, Shift & Roster (HR-ADV-001, HR-ADV-002)
// ---------------------------------------------------------------------------

export interface WorkforceShift {
  id: string;
  tenantId: string;
  shiftCode: string;
  name: string;
  startTime: string; // HH:MM:SS
  endTime: string; // HH:MM:SS
  breakMinutes: number;
  isOvernight: boolean;
  isActive: boolean;
  createdAt: Date;
  createdBy: string | null;
  updatedAt: Date;
  updatedBy: string | null;
}

export interface CreateShiftInput {
  tenantId: string;
  shiftCode: string;
  name: string;
  startTime: string;
  endTime: string;
  breakMinutes?: number;
  isOvernight?: boolean;
  createdBy: string | null;
}

export interface WorkforceRoster {
  id: string;
  tenantId: string;
  employeeId: string;
  shiftId: string;
  rosterDate: string; // YYYY-MM-DD
  organizationUnitId: string | null;
  notes: string | null;
  createdAt: Date;
  createdBy: string | null;
  updatedAt: Date;
  updatedBy: string | null;
}

export interface UpsertRosterInput {
  tenantId: string;
  employeeId: string;
  shiftId: string;
  rosterDate: string;
  organizationUnitId?: string | null;
  notes?: string | null;
  actorUserId: string | null;
}

export interface RosterListFilter {
  employeeId?: string;
  organizationUnitId?: string;
  fromDate?: string;
  toDate?: string;
}

export type AttendanceStatus = "present" | "late" | "absent" | "leave" | "holiday" | "day_off";
export type AttendanceSource = "manual" | "self_service" | "import" | "device";

export interface WorkforceAttendanceRecord {
  id: string;
  tenantId: string;
  employeeId: string;
  attendanceDate: string; // YYYY-MM-DD
  shiftId: string | null;
  clockIn: Date | null;
  clockOut: Date | null;
  workedMinutes: number | null;
  lateMinutes: number;
  earlyOutMinutes: number;
  status: AttendanceStatus;
  source: AttendanceSource;
  notes: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface RecordAttendanceInput {
  tenantId: string;
  employeeId: string;
  attendanceDate: string;
  shiftId?: string | null;
  clockIn?: string | null; // ISO timestamp
  clockOut?: string | null; // ISO timestamp
  status?: AttendanceStatus;
  source?: AttendanceSource;
  notes?: string | null;
  actorUserId: string | null;
}

export interface AttendanceListFilter {
  employeeId?: string;
  fromDate?: string;
  toDate?: string;
  status?: AttendanceStatus;
}

// ---------------------------------------------------------------------------
// Leave & Overtime (HR-ADV-003, HR-ADV-004)
// ---------------------------------------------------------------------------

export interface WorkforceLeaveType {
  id: string;
  tenantId: string;
  code: string;
  name: string;
  annualAllowanceDays: number;
  isPaid: boolean;
  requiresAttachment: boolean;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateLeaveTypeInput {
  tenantId: string;
  code: string;
  name: string;
  annualAllowanceDays?: number;
  isPaid?: boolean;
  requiresAttachment?: boolean;
  createdBy: string | null;
}

export interface WorkforceLeaveBalance {
  id: string;
  tenantId: string;
  employeeId: string;
  leaveTypeId: string;
  balanceYear: number;
  allocatedDays: number;
  usedDays: number;
  pendingDays: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface SetLeaveAllocationInput {
  tenantId: string;
  employeeId: string;
  leaveTypeId: string;
  balanceYear: number;
  allocatedDays: number;
  actorUserId: string | null;
}

/**
 * NOTE: deliberately NO `status` field. Lifecycle state (submitted, approved,
 * rejected, cancelled) is read from the Workflow Engine via
 * `workflowInstanceId`. Timestamps are bookkeeping written as each
 * transition fires — never an independent state machine.
 */
export interface WorkforceLeaveRequest {
  id: string;
  tenantId: string;
  requestNumber: string;
  employeeId: string;
  leaveTypeId: string;
  startDate: string;
  endDate: string;
  totalDays: number;
  reason: string | null;
  attachmentDocumentId: string | null;
  workflowInstanceId: string | null;
  submittedAt: Date;
  approvedAt: Date | null;
  rejectedAt: Date | null;
  cancelledAt: Date | null;
}

export interface CreateLeaveRequestInput {
  tenantId: string;
  employeeId: string;
  leaveTypeId: string;
  startDate: string;
  endDate: string;
  totalDays: number;
  reason?: string | null;
  attachmentDocumentId?: string | null;
  actorUserId: string;
}

export interface LeaveRequestListFilter {
  employeeId?: string;
  leaveTypeId?: string;
  fromDate?: string;
  toDate?: string;
}

export interface WorkforceOvertimeRequest {
  id: string;
  tenantId: string;
  requestNumber: string;
  employeeId: string;
  overtimeDate: string;
  startTime: string;
  endTime: string;
  estimatedHours: number;
  actualHours: number | null;
  reason: string | null;
  workflowInstanceId: string | null;
  submittedAt: Date;
  approvedAt: Date | null;
  rejectedAt: Date | null;
  cancelledAt: Date | null;
}

export interface CreateOvertimeRequestInput {
  tenantId: string;
  employeeId: string;
  overtimeDate: string;
  startTime: string;
  endTime: string;
  estimatedHours: number;
  reason?: string | null;
  actorUserId: string;
}

export interface RecordActualOvertimeInput {
  tenantId: string;
  id: string;
  actualHours: number;
  actorUserId: string;
}

export interface OvertimeRequestListFilter {
  employeeId?: string;
  fromDate?: string;
  toDate?: string;
}

// ---------------------------------------------------------------------------
// Payroll, BPJS & PPh 21 (HR-ADV-005)
// ---------------------------------------------------------------------------

export type RoundingMode = "half_up" | "down" | "up";

export interface PphBracket {
  upTo: number | null; // null = no upper bound (top bracket)
  rate: number; // fraction, e.g. 0.05 = 5%
}

export interface PphTerBracket {
  category: "A" | "B" | "C";
  upTo: number | null;
  rate: number;
}

export type Pph21Method = "annualized" | "ter";

export interface WorkforceStatutoryPolicy {
  id: string;
  tenantId: string;
  policyCode: string;
  name: string;
  countryCode: string;
  effectiveFrom: string;
  effectiveTo: string | null;
  bpjsKesehatanRateEmployer: number;
  bpjsKesehatanRateEmployee: number;
  bpjsKesehatanCap: number | null;
  bpjsTkJhtRateEmployer: number;
  bpjsTkJhtRateEmployee: number;
  bpjsTkJkkRate: number;
  bpjsTkJkmRate: number;
  bpjsTkJpRateEmployer: number;
  bpjsTkJpRateEmployee: number;
  bpjsTkJpCap: number | null;
  occupationalCostRate: number;
  occupationalCostMonthlyCap: number | null;
  ptkpAnnualAmounts: Record<string, number>;
  pph21Brackets: PphBracket[];
  pph21TerBrackets: PphTerBracket[];
  pph21Method: Pph21Method;
  nonNpwpSurchargeRate: number;
  roundingMode: RoundingMode;
  isActive: boolean;
}

export interface CreateStatutoryPolicyInput {
  tenantId: string;
  policyCode: string;
  name: string;
  countryCode?: string;
  effectiveFrom: string;
  effectiveTo?: string | null;
  bpjsKesehatanRateEmployer?: number;
  bpjsKesehatanRateEmployee?: number;
  bpjsKesehatanCap?: number | null;
  bpjsTkJhtRateEmployer?: number;
  bpjsTkJhtRateEmployee?: number;
  bpjsTkJkkRate?: number;
  bpjsTkJkmRate?: number;
  bpjsTkJpRateEmployer?: number;
  bpjsTkJpRateEmployee?: number;
  bpjsTkJpCap?: number | null;
  occupationalCostRate?: number;
  occupationalCostMonthlyCap?: number | null;
  ptkpAnnualAmounts?: Record<string, number>;
  pph21Brackets?: PphBracket[];
  pph21TerBrackets?: PphTerBracket[];
  pph21Method?: Pph21Method;
  nonNpwpSurchargeRate?: number;
  roundingMode?: RoundingMode;
  createdBy: string | null;
}

export type PtkpStatus =
  | "TK/0" | "TK/1" | "TK/2" | "TK/3"
  | "K/0" | "K/1" | "K/2" | "K/3";

export interface WorkforceEmployeeSalaryProfile {
  id: string;
  tenantId: string;
  employeeId: string;
  baseSalary: number;
  fixedAllowance: number;
  overtimeHourlyRate: number | null;
  ptkpStatus: PtkpStatus;
  hasNpwp: boolean;
  bpjsKesehatanNumber: string | null;
  bpjsTkNumber: string | null;
  bankName: string | null;
  bankAccountNumber: string | null;
  effectiveFrom: string;
  effectiveTo: string | null;
}

export interface SetSalaryProfileInput {
  tenantId: string;
  employeeId: string;
  baseSalary: number;
  fixedAllowance?: number;
  overtimeHourlyRate?: number | null;
  ptkpStatus: PtkpStatus;
  hasNpwp?: boolean;
  bpjsKesehatanNumber?: string | null;
  bpjsTkNumber?: string | null;
  bankName?: string | null;
  bankAccountNumber?: string | null;
  effectiveFrom: string;
  actorUserId: string | null;
}

/**
 * NOTE: deliberately NO `status` field — see AssetMaintenanceWorkOrder
 * precedent. `calculatedAt`/`approvedAt`/`closedAt` are bookkeeping
 * projections of `workflowInstanceId` transitions.
 */
export interface WorkforcePayrollRun {
  id: string;
  tenantId: string;
  runNumber: string;
  periodMonth: number;
  periodYear: number;
  organizationUnitId: string | null;
  statutoryPolicyId: string | null;
  workflowInstanceId: string | null;
  employeeCount: number;
  totalGross: number;
  totalDeductions: number;
  totalNet: number;
  totalEmployerContributions: number;
  calculatedAt: Date | null;
  approvedAt: Date | null;
  closedAt: Date | null;
}

export interface CreatePayrollRunInput {
  tenantId: string;
  periodMonth: number;
  periodYear: number;
  organizationUnitId?: string | null;
  actorUserId: string;
}

export interface WorkforcePayslip {
  id: string;
  tenantId: string;
  payrollRunId: string;
  employeeId: string;
  baseSalary: number;
  allowances: number;
  overtimeHours: number;
  overtimePay: number;
  grossSalary: number;
  bpjsKesehatanEmployee: number;
  bpjsKesehatanEmployer: number;
  bpjsTkJhtEmployee: number;
  bpjsTkJhtEmployer: number;
  bpjsTkJkkEmployer: number;
  bpjsTkJkmEmployer: number;
  bpjsTkJpEmployee: number;
  bpjsTkJpEmployer: number;
  pph21Withheld: number;
  otherDeductions: number;
  totalDeductions: number;
  employerContributions: number;
  netSalary: number;
  ptkpStatus: string | null;
  calculationBreakdown: Record<string, unknown>;
  createdAt: Date;
}

export interface PayrollRunListFilter {
  organizationUnitId?: string;
  periodYear?: number;
}

// ---------------------------------------------------------------------------
// Recruitment (HR-ADV-006)
// ---------------------------------------------------------------------------

export type JobPostingStatus = "draft" | "published" | "closed" | "cancelled";

export interface WorkforceJobPosting {
  id: string;
  tenantId: string;
  postingCode: string;
  title: string;
  positionId: string | null;
  organizationUnitId: string | null;
  headcountTarget: number;
  employmentType: string | null;
  jobDescription: string | null;
  status: JobPostingStatus;
  workflowInstanceId: string | null;
  publishedAt: Date | null;
  closedAt: Date | null;
}

export interface CreateJobPostingInput {
  tenantId: string;
  title: string;
  positionId?: string | null;
  organizationUnitId?: string | null;
  headcountTarget?: number;
  employmentType?: string | null;
  jobDescription?: string | null;
  actorUserId: string;
}

export interface JobPostingListFilter {
  status?: JobPostingStatus;
  organizationUnitId?: string;
}

export type JobApplicationStage =
  | "applied" | "screening" | "interview" | "offer" | "hired" | "rejected" | "withdrawn";

export interface WorkforceJobApplication {
  id: string;
  tenantId: string;
  jobPostingId: string;
  candidateName: string;
  candidateEmail: string | null;
  candidatePhone: string | null;
  resumeDocumentId: string | null;
  stage: JobApplicationStage;
  rating: number | null;
  interviewerNotes: string | null;
  hiredEmployeeId: string | null;
  appliedAt: Date;
  decidedAt: Date | null;
}

export interface CreateJobApplicationInput {
  tenantId: string;
  jobPostingId: string;
  candidateName: string;
  candidateEmail?: string | null;
  candidatePhone?: string | null;
  resumeDocumentId?: string | null;
  actorUserId: string | null;
}

export interface AdvanceJobApplicationInput {
  tenantId: string;
  id: string;
  stage: JobApplicationStage;
  rating?: number | null;
  interviewerNotes?: string | null;
  hiredEmployeeId?: string | null;
  actorUserId: string;
}

export interface JobApplicationListFilter {
  jobPostingId?: string;
  stage?: JobApplicationStage;
}

// ---------------------------------------------------------------------------
// Competency, Training, Performance & Career (HR-ADV-007, HR-ADV-008)
// ---------------------------------------------------------------------------

export interface WorkforceCompetency {
  id: string;
  tenantId: string;
  code: string;
  name: string;
  category: string | null;
  description: string | null;
  scaleMin: number;
  scaleMax: number;
  isActive: boolean;
}

export interface CreateCompetencyInput {
  tenantId: string;
  code: string;
  name: string;
  category?: string | null;
  description?: string | null;
  scaleMin?: number;
  scaleMax?: number;
  createdBy: string | null;
}

export interface WorkforceEmployeeCompetency {
  id: string;
  tenantId: string;
  employeeId: string;
  competencyId: string;
  proficiencyLevel: number;
  lastAssessedDate: string | null;
  assessedByUserId: string | null;
  notes: string | null;
}

export interface AssessEmployeeCompetencyInput {
  tenantId: string;
  employeeId: string;
  competencyId: string;
  proficiencyLevel: number;
  notes?: string | null;
  actorUserId: string;
}

export interface WorkforceTrainingCourse {
  id: string;
  tenantId: string;
  courseCode: string;
  title: string;
  provider: string | null;
  durationHours: number;
  competencyId: string | null;
  description: string | null;
  isActive: boolean;
}

export interface CreateTrainingCourseInput {
  tenantId: string;
  courseCode: string;
  title: string;
  provider?: string | null;
  durationHours?: number;
  competencyId?: string | null;
  description?: string | null;
  createdBy: string | null;
}

export type TrainingEnrollmentStatus = "enrolled" | "in_progress" | "completed" | "failed" | "cancelled";

export interface WorkforceTrainingEnrollment {
  id: string;
  tenantId: string;
  trainingCourseId: string;
  employeeId: string;
  status: TrainingEnrollmentStatus;
  enrolledAt: Date;
  completionDate: string | null;
  score: number | null;
  certificateDocumentId: string | null;
  notes: string | null;
}

export interface EnrollTrainingInput {
  tenantId: string;
  trainingCourseId: string;
  employeeId: string;
  actorUserId: string | null;
}

export interface CompleteTrainingInput {
  tenantId: string;
  id: string;
  status: Extract<TrainingEnrollmentStatus, "completed" | "failed">;
  completionDate: string;
  score?: number | null;
  certificateDocumentId?: string | null;
  actorUserId: string;
}

/**
 * NOTE: deliberately NO `status` field. `submittedAt`/`finalizedAt` are
 * bookkeeping projections of `workflowInstanceId` transitions.
 */
export interface WorkforcePerformanceReview {
  id: string;
  tenantId: string;
  reviewCode: string;
  employeeId: string;
  periodStart: string;
  periodEnd: string;
  reviewerUserId: string | null;
  goalsScore: number | null;
  competencyScore: number | null;
  overallRating: number | null;
  reviewNotes: string | null;
  developmentPlan: string | null;
  workflowInstanceId: string | null;
  submittedAt: Date | null;
  finalizedAt: Date | null;
}

export interface CreatePerformanceReviewInput {
  tenantId: string;
  employeeId: string;
  periodStart: string;
  periodEnd: string;
  reviewerUserId?: string | null;
  goalsScore?: number | null;
  competencyScore?: number | null;
  overallRating?: number | null;
  reviewNotes?: string | null;
  developmentPlan?: string | null;
  actorUserId: string;
}

export interface PerformanceReviewListFilter {
  employeeId?: string;
  periodYear?: number;
}

export interface WorkforceCareerPath {
  id: string;
  tenantId: string;
  fromPositionId: string;
  toPositionId: string;
  requiredTenureMonths: number;
  requiredCompetencyIds: string[];
  guidelines: string | null;
  isActive: boolean;
}

export interface CreateCareerPathInput {
  tenantId: string;
  fromPositionId: string;
  toPositionId: string;
  requiredTenureMonths?: number;
  requiredCompetencyIds?: string[];
  guidelines?: string | null;
  createdBy: string | null;
}

// ---------------------------------------------------------------------------
// Manpower Planning (HR-ADV-009) — deterministic advisory-only
// ---------------------------------------------------------------------------

export type ManpowerPlanStatus = "draft" | "computed" | "applied" | "dismissed";

export interface ManpowerGapEntry {
  organizationUnitId: string | null;
  positionId: string | null;
  currentHeadcount: number;
  plannedHeadcount: number;
  variance: number;
  costImpact: number;
}

export interface WorkforceManpowerPlan {
  id: string;
  tenantId: string;
  planNumber: string;
  planYear: number;
  organizationUnitId: string | null;
  title: string;
  status: ManpowerPlanStatus;
  parameters: Record<string, unknown>;
  currentHeadcount: number;
  plannedHeadcount: number;
  varianceHeadcount: number;
  currentCostProjection: number;
  plannedCostProjection: number;
  varianceCostProjection: number;
  gapAnalysis: ManpowerGapEntry[];
  computedAt: Date | null;
  appliedAt: Date | null;
  appliedBy: string | null;
}

export interface CreateManpowerPlanInput {
  tenantId: string;
  planYear: number;
  organizationUnitId?: string | null;
  title: string;
  parameters?: Record<string, unknown>;
  actorUserId: string;
}

export interface ComputeManpowerPlanInput {
  tenantId: string;
  id: string;
  targetHeadcountByPosition: Record<string, number>; // positionId -> planned headcount
  actorUserId: string;
}

export interface ApplyManpowerPlanInput {
  tenantId: string;
  id: string;
  actorUserId: string;
}

export interface ManpowerPlanListFilter {
  organizationUnitId?: string;
  planYear?: number;
  status?: ManpowerPlanStatus;
}

// ---------------------------------------------------------------------------
// Narrow read ports into Workforce Core (never import CoreService directly)
// ---------------------------------------------------------------------------

export interface EmployeeReference {
  id: string;
  employeeNumber: string;
  fullName: string;
  organizationUnitId: string | null;
  positionId: string | null;
  employmentStatus: string;
}

// ---------------------------------------------------------------------------
// Repository port
// ---------------------------------------------------------------------------

export interface WorkforceAdvancedRepository {
  // -- narrow Core read port --------------------------------------------
  findEmployeeReference(tenantId: string, employeeId: string): Promise<EmployeeReference | null>;
  organizationUnitExists(tenantId: string, organizationUnitId: string): Promise<boolean>;
  findLegalEntityIdForOrganizationUnit(tenantId: string, organizationUnitId: string): Promise<string | null>;
  listOpenAccountingPeriods(
    tenantId: string,
    legalEntityId: string,
  ): Promise<Array<{ id: string; dateFrom: Date; dateTo: Date }>>;
  positionExists(tenantId: string, positionId: string): Promise<boolean>;
  listOrganizationUnitDescendantIds(tenantId: string, rootIds: string[]): Promise<string[]>;
  listActiveEmployeeReferences(tenantId: string, organizationUnitIds?: string[] | null): Promise<EmployeeReference[]>;

  // -- Shifts, Roster & Attendance --------------------------------------
  createShift(input: CreateShiftInput): Promise<WorkforceShift>;
  findShiftById(tenantId: string, id: string): Promise<WorkforceShift | null>;
  listShifts(tenantId: string, includeInactive?: boolean): Promise<WorkforceShift[]>;
  setShiftActive(tenantId: string, id: string, isActive: boolean): Promise<WorkforceShift>;

  upsertRoster(input: UpsertRosterInput): Promise<WorkforceRoster>;
  listRosters(tenantId: string, filter: RosterListFilter, organizationUnitIds: string[] | null): Promise<WorkforceRoster[]>;

  recordAttendance(input: RecordAttendanceInput): Promise<WorkforceAttendanceRecord>;
  listAttendance(tenantId: string, filter: AttendanceListFilter, organizationUnitIds: string[] | null): Promise<WorkforceAttendanceRecord[]>;

  // -- Leave & Overtime ---------------------------------------------------
  createLeaveType(input: CreateLeaveTypeInput): Promise<WorkforceLeaveType>;
  listLeaveTypes(tenantId: string, includeInactive?: boolean): Promise<WorkforceLeaveType[]>;

  setLeaveAllocation(input: SetLeaveAllocationInput): Promise<WorkforceLeaveBalance>;
  findLeaveBalance(tenantId: string, employeeId: string, leaveTypeId: string, balanceYear: number): Promise<WorkforceLeaveBalance | null>;
  listLeaveBalances(tenantId: string, employeeId: string, balanceYear: number): Promise<WorkforceLeaveBalance[]>;
  adjustLeaveBalancePending(tenantId: string, employeeId: string, leaveTypeId: string, balanceYear: number, pendingDelta: number, usedDelta: number): Promise<void>;

  createLeaveRequest(input: CreateLeaveRequestInput, requestNumber: string): Promise<WorkforceLeaveRequest>;
  findLeaveRequestById(tenantId: string, id: string): Promise<WorkforceLeaveRequest | null>;
  listLeaveRequests(tenantId: string, filter: LeaveRequestListFilter, organizationUnitIds: string[] | null): Promise<WorkforceLeaveRequest[]>;
  setLeaveRequestWorkflowInstance(tenantId: string, id: string, workflowInstanceId: string): Promise<void>;
  projectLeaveRequestDecision(tenantId: string, id: string, decision: "approved" | "rejected" | "cancelled", at: Date): Promise<WorkforceLeaveRequest>;
  deleteLeaveRequestWithoutWorkflow(tenantId: string, id: string): Promise<void>;

  createOvertimeRequest(input: CreateOvertimeRequestInput, requestNumber: string): Promise<WorkforceOvertimeRequest>;
  findOvertimeRequestById(tenantId: string, id: string): Promise<WorkforceOvertimeRequest | null>;
  listOvertimeRequests(tenantId: string, filter: OvertimeRequestListFilter, organizationUnitIds: string[] | null): Promise<WorkforceOvertimeRequest[]>;
  findApprovedOvertimeHoursForEmployeePeriod(tenantId: string, employeeId: string, fromDate: string, toDate: string): Promise<number>;
  setOvertimeRequestWorkflowInstance(tenantId: string, id: string, workflowInstanceId: string): Promise<void>;
  projectOvertimeRequestDecision(tenantId: string, id: string, decision: "approved" | "rejected" | "cancelled", at: Date): Promise<WorkforceOvertimeRequest>;
  recordActualOvertimeHours(input: RecordActualOvertimeInput): Promise<WorkforceOvertimeRequest>;
  deleteOvertimeRequestWithoutWorkflow(tenantId: string, id: string): Promise<void>;

  // -- Payroll, BPJS & PPh 21 ----------------------------------------------
  createStatutoryPolicy(input: CreateStatutoryPolicyInput): Promise<WorkforceStatutoryPolicy>;
  findActiveStatutoryPolicy(tenantId: string, asOfDate: string): Promise<WorkforceStatutoryPolicy | null>;
  listStatutoryPolicies(tenantId: string): Promise<WorkforceStatutoryPolicy[]>;

  setSalaryProfile(input: SetSalaryProfileInput): Promise<WorkforceEmployeeSalaryProfile>;
  findCurrentSalaryProfile(tenantId: string, employeeId: string, asOfDate?: string): Promise<WorkforceEmployeeSalaryProfile | null>;
  closeOpenSalaryProfile(tenantId: string, employeeId: string, effectiveTo: string): Promise<void>;

  createPayrollRun(input: CreatePayrollRunInput, runNumber: string): Promise<WorkforcePayrollRun>;
  findPayrollRunById(tenantId: string, id: string): Promise<WorkforcePayrollRun | null>;
  listPayrollRuns(tenantId: string, filter: PayrollRunListFilter, organizationUnitIds: string[] | null): Promise<WorkforcePayrollRun[]>;
  setPayrollRunWorkflowInstance(tenantId: string, id: string, workflowInstanceId: string): Promise<void>;
  deletePayrollRunWithoutWorkflow(tenantId: string, id: string): Promise<void>;
  savePayslipsAndTotals(
    tenantId: string,
    payrollRunId: string,
    payslips: Array<Omit<WorkforcePayslip, "id" | "tenantId" | "payrollRunId" | "createdAt">>,
    totals: { totalGross: number; totalDeductions: number; totalNet: number; totalEmployerContributions: number; employeeCount: number },
  ): Promise<void>;
  projectPayrollRunDecision(tenantId: string, id: string, decision: "approved" | "closed", at: Date): Promise<WorkforcePayrollRun>;
  listPayslipsByRun(tenantId: string, payrollRunId: string): Promise<WorkforcePayslip[]>;

  // -- Recruitment ----------------------------------------------------------
  createJobPosting(input: CreateJobPostingInput, postingCode: string): Promise<WorkforceJobPosting>;
  findJobPostingById(tenantId: string, id: string): Promise<WorkforceJobPosting | null>;
  listJobPostings(tenantId: string, filter: JobPostingListFilter, organizationUnitIds: string[] | null): Promise<WorkforceJobPosting[]>;
  setJobPostingWorkflowInstance(tenantId: string, id: string, workflowInstanceId: string): Promise<void>;
  projectJobPostingDecision(tenantId: string, id: string, decision: "published" | "closed" | "cancelled", at: Date): Promise<WorkforceJobPosting>;
  deleteJobPostingWithoutWorkflow(tenantId: string, id: string): Promise<void>;

  createJobApplication(input: CreateJobApplicationInput): Promise<WorkforceJobApplication>;
  findJobApplicationById(tenantId: string, id: string): Promise<WorkforceJobApplication | null>;
  listJobApplications(tenantId: string, filter: JobApplicationListFilter, organizationUnitIds: string[] | null): Promise<WorkforceJobApplication[]>;
  advanceJobApplication(input: AdvanceJobApplicationInput): Promise<WorkforceJobApplication>;

  // -- Competency, Training, Performance & Career --------------------------
  createCompetency(input: CreateCompetencyInput): Promise<WorkforceCompetency>;
  listCompetencies(tenantId: string, includeInactive?: boolean): Promise<WorkforceCompetency[]>;

  assessEmployeeCompetency(input: AssessEmployeeCompetencyInput): Promise<WorkforceEmployeeCompetency>;
  listEmployeeCompetencies(tenantId: string, employeeId: string): Promise<WorkforceEmployeeCompetency[]>;

  createTrainingCourse(input: CreateTrainingCourseInput): Promise<WorkforceTrainingCourse>;
  listTrainingCourses(tenantId: string, includeInactive?: boolean): Promise<WorkforceTrainingCourse[]>;

  enrollTraining(input: EnrollTrainingInput): Promise<WorkforceTrainingEnrollment>;
  findTrainingEnrollmentById(tenantId: string, id: string): Promise<WorkforceTrainingEnrollment | null>;
  completeTraining(input: CompleteTrainingInput): Promise<WorkforceTrainingEnrollment>;
  listTrainingEnrollments(tenantId: string, employeeId: string): Promise<WorkforceTrainingEnrollment[]>;

  createPerformanceReview(input: CreatePerformanceReviewInput, reviewCode: string): Promise<WorkforcePerformanceReview>;
  findPerformanceReviewById(tenantId: string, id: string): Promise<WorkforcePerformanceReview | null>;
  listPerformanceReviews(tenantId: string, filter: PerformanceReviewListFilter, organizationUnitIds: string[] | null): Promise<WorkforcePerformanceReview[]>;
  setPerformanceReviewWorkflowInstance(tenantId: string, id: string, workflowInstanceId: string): Promise<void>;
  projectPerformanceReviewDecision(tenantId: string, id: string, decision: "submitted" | "finalized", at: Date): Promise<WorkforcePerformanceReview>;
  deletePerformanceReviewWithoutWorkflow(tenantId: string, id: string): Promise<void>;

  createCareerPath(input: CreateCareerPathInput): Promise<WorkforceCareerPath>;
  listCareerPaths(tenantId: string, fromPositionId?: string): Promise<WorkforceCareerPath[]>;

  // -- Manpower Planning ------------------------------------------------
  createManpowerPlan(input: CreateManpowerPlanInput, planNumber: string): Promise<WorkforceManpowerPlan>;
  findManpowerPlanById(tenantId: string, id: string): Promise<WorkforceManpowerPlan | null>;
  listManpowerPlans(tenantId: string, filter: ManpowerPlanListFilter, organizationUnitIds: string[] | null): Promise<WorkforceManpowerPlan[]>;
  saveManpowerPlanComputation(
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
  ): Promise<WorkforceManpowerPlan>;
  applyManpowerPlan(tenantId: string, id: string, actorUserId: string): Promise<WorkforceManpowerPlan>;
  dismissManpowerPlan(tenantId: string, id: string): Promise<WorkforceManpowerPlan>;

  // -- Numbering fallback helpers (composed with ConfigurationService in the
  //    application layer via generateNumberForTenant; no direct dependency).
}
