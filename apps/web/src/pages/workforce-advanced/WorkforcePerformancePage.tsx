/** Wave A4 — competency framework, training catalog, performance cycles, and career paths. */
import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "../../auth/AuthContext";
import {
  api,
  ApiError,
  type Employee,
  type PositionRecord,
  type WorkforceCareerPath,
  type WorkforceCompetency,
  type WorkforceEmployeeCompetency,
  type WorkforcePerformanceReviewRow,
  type WorkforceTrainingCourse,
  type WorkforceTrainingEnrollment,
  type WorkforceWorkflowStatus,
} from "../../lib/api";
import { PERMISSIONS } from "../../lib/capabilities";
import { useShell } from "../../shell/layout/AppShell";
import {
  Alert,
  Badge,
  Button,
  Card,
  DataTable,
  EmptyState,
  Field,
  Input,
  PageHeader,
  Select,
  Spinner,
  StatusPill,
  Textarea,
  type Column,
} from "../../shell/components/ui";
import { formatDateShort, statusTone } from "../../shared/format";

function label(value: string): string {
  return value.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());
}

function workflowLabel(status: WorkforceWorkflowStatus | null): string {
  return status?.stepName ?? status?.stepCode ?? (status ? label(status.instanceStatus) : "Draft");
}

export function WorkforcePerformancePage() {
  const { session } = useAuth();
  const token = session!.accessToken;
  const { permissions } = useShell();
  const canManage = permissions.includes(PERMISSIONS.workforcePerformanceManage);

  const [tab, setTab] = useState<"reviews" | "competencies" | "training" | "career">("reviews");
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [positions, setPositions] = useState<PositionRecord[]>([]);
  const [competencies, setCompetencies] = useState<WorkforceCompetency[]>([]);
  const [employeeCompetencies, setEmployeeCompetencies] = useState<WorkforceEmployeeCompetency[]>([]);
  const [courses, setCourses] = useState<WorkforceTrainingCourse[]>([]);
  const [enrollments, setEnrollments] = useState<WorkforceTrainingEnrollment[]>([]);
  const [reviews, setReviews] = useState<WorkforcePerformanceReviewRow[]>([]);
  const [careerPaths, setCareerPaths] = useState<WorkforceCareerPath[]>([]);

  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [selectedEmployeeId, setSelectedEmployeeId] = useState("");
  const [yearFilter, setYearFilter] = useState(String(new Date().getFullYear()));

  const [compCode, setCompCode] = useState("");
  const [compName, setCompName] = useState("");
  const [compCategory, setCompCategory] = useState("core");
  const [scaleMin, setScaleMin] = useState("1");
  const [scaleMax, setScaleMax] = useState("5");

  const [assessEmployeeId, setAssessEmployeeId] = useState("");
  const [assessCompetencyId, setAssessCompetencyId] = useState("");
  const [assessLevel, setAssessLevel] = useState("3");
  const [assessNotes, setAssessNotes] = useState("");

  const [courseCode, setCourseCode] = useState("");
  const [courseTitle, setCourseTitle] = useState("");
  const [courseProvider, setCourseProvider] = useState("");
  const [durationHours, setDurationHours] = useState("8");
  const [courseCompetencyId, setCourseCompetencyId] = useState("");

  const [enrollEmployeeId, setEnrollEmployeeId] = useState("");
  const [enrollCourseId, setEnrollCourseId] = useState("");

  const [reviewEmployeeId, setReviewEmployeeId] = useState("");
  const [reviewStart, setReviewStart] = useState(() => `${new Date().getFullYear()}-01-01`);
  const [reviewEnd, setReviewEnd] = useState(() => `${new Date().getFullYear()}-12-31`);
  const [goalsScore, setGoalsScore] = useState("80");
  const [competencyScore, setCompetencyScore] = useState("85");
  const [overallRating, setOverallRating] = useState("4");
  const [reviewNotes, setReviewNotes] = useState("");
  const [developmentPlan, setDevelopmentPlan] = useState("");
  const [reviewActionById, setReviewActionById] = useState<Record<string, string>>({});

  const [fromPositionId, setFromPositionId] = useState("");
  const [toPositionId, setToPositionId] = useState("");
  const [tenureMonths, setTenureMonths] = useState("12");
  const [careerGuidelines, setCareerGuidelines] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [empList, posList, compList, courseList, reviewList, careerList] = await Promise.all([
        api.employees(token).catch(() => [] as Employee[]),
        api.positions(token).catch(() => [] as PositionRecord[]),
        api.workforceCompetencies(token, true),
        api.workforceTrainingCourses(token, true),
        api.workforcePerformanceReviews(token, {
          employeeId: selectedEmployeeId || undefined,
          periodYear: Number(yearFilter) || undefined,
        }),
        api.workforceCareerPaths(token),
      ]);
      setEmployees(empList);
      setPositions(posList.filter((item) => item.isActive));
      setCompetencies(compList);
      setCourses(courseList);
      setReviews(reviewList);
      setCareerPaths(careerList);

      if (selectedEmployeeId) {
        const [empComps, empEnrollments] = await Promise.all([
          api.workforceEmployeeCompetencies(token, selectedEmployeeId).catch(() => []),
          api.workforceTrainingEnrollments(token, selectedEmployeeId).catch(() => []),
        ]);
        setEmployeeCompetencies(empComps);
        setEnrollments(empEnrollments);
      } else {
        setEmployeeCompetencies([]);
        setEnrollments([]);
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not load performance and talent records.");
    } finally {
      setLoading(false);
    }
  }, [token, selectedEmployeeId, yearFilter]);

  useEffect(() => {
    void load();
  }, [load]);

  const employeeName = useMemo(
    () => (id: string) => {
      const employee = employees.find((item) => item.id === id);
      return employee ? `${employee.fullName} (${employee.employeeNumber})` : id;
    },
    [employees],
  );

  const positionName = useMemo(
    () => (id: string) => positions.find((item) => item.id === id)?.name ?? id,
    [positions],
  );

  const competencyName = useMemo(
    () => (id: string) => competencies.find((item) => item.id === id)?.name ?? id,
    [competencies],
  );

  const courseTitleById = useMemo(
    () => (id: string) => courses.find((item) => item.id === id)?.title ?? id,
    [courses],
  );

  async function runAction(action: () => Promise<unknown>, message: string) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await action();
      setNotice(message);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Action failed.");
    } finally {
      setBusy(false);
    }
  }

  async function createCompetency() {
    await runAction(
      () => api.createWorkforceCompetency(token, {
        code: compCode.trim(),
        name: compName.trim(),
        category: compCategory || null,
        scaleMin: Number(scaleMin) || 1,
        scaleMax: Number(scaleMax) || 5,
      }),
      `Competency ${compName} created.`,
    );
    setCompCode("");
    setCompName("");
  }

  async function assessCompetency() {
    await runAction(
      () => api.assessWorkforceEmployeeCompetency(token, {
        employeeId: assessEmployeeId,
        competencyId: assessCompetencyId,
        proficiencyLevel: Number(assessLevel),
        notes: assessNotes || null,
      }),
      "Employee competency assessed.",
    );
    setAssessNotes("");
  }

  async function createCourse() {
    await runAction(
      () => api.createWorkforceTrainingCourse(token, {
        courseCode: courseCode.trim(),
        title: courseTitle.trim(),
        provider: courseProvider || null,
        durationHours: Number(durationHours) || 1,
        competencyId: courseCompetencyId || null,
      }),
      `Training course ${courseTitle} added.`,
    );
    setCourseCode("");
    setCourseTitle("");
    setCourseProvider("");
  }

  async function enrollEmployee() {
    await runAction(
      () => api.enrollWorkforceTraining(token, {
        trainingCourseId: enrollCourseId,
        employeeId: enrollEmployeeId,
      }),
      "Employee enrolled in training.",
    );
  }

  async function completeTraining(id: string) {
    await runAction(
      () => api.completeWorkforceTraining(token, id, {
        status: "completed",
        completionDate: new Date().toISOString().slice(0, 10),
      }),
      "Training marked as completed.",
    );
  }

  async function createReview() {
    await runAction(
      () => api.createWorkforcePerformanceReview(token, {
        employeeId: reviewEmployeeId,
        periodStart: reviewStart,
        periodEnd: reviewEnd,
        goalsScore: Number(goalsScore) || null,
        competencyScore: Number(competencyScore) || null,
        overallRating: Number(overallRating) || null,
        reviewNotes: reviewNotes || null,
        developmentPlan: developmentPlan || null,
      }),
      "Performance review recorded and dispatched to workflow.",
    );
    setReviewNotes("");
    setDevelopmentPlan("");
  }

  async function actOnReview(id: string) {
    const actionCode = reviewActionById[id]?.trim();
    if (!actionCode) return;
    await runAction(
      () => api.actOnWorkforcePerformanceReview(token, id, actionCode, null),
      `Performance review updated via ${label(actionCode)}.`,
    );
  }

  async function createCareerPath() {
    await runAction(
      () => api.createWorkforceCareerPath(token, {
        fromPositionId,
        toPositionId,
        requiredTenureMonths: Number(tenureMonths) || 0,
        guidelines: careerGuidelines || null,
      }),
      "Career pathway configured.",
    );
    setCareerGuidelines("");
  }

  const reviewColumns: Column<WorkforcePerformanceReviewRow>[] = [
    {
      header: "Review",
      cell: ({ review }) => (
        <div>
          <div className="font-semibold text-slate-900">{review.reviewCode}</div>
          <div className="text-xs text-slate-500">{employeeName(review.employeeId)}</div>
        </div>
      ),
      mobileRole: "title",
    },
    { header: "Period", cell: ({ review }) => `${formatDateShort(review.periodStart)} – ${formatDateShort(review.periodEnd)}` },
    { header: "Goals", cell: ({ review }) => review.goalsScore != null ? `${review.goalsScore}%` : "—" },
    { header: "Competency", cell: ({ review }) => review.competencyScore != null ? `${review.competencyScore}%` : "—" },
    { header: "Rating", cell: ({ review }) => review.overallRating != null ? `${review.overallRating}/5` : "—" },
    {
      header: "Workflow",
      cell: ({ status }) => <StatusPill tone={statusTone(status?.instanceStatus)}>{workflowLabel(status)}</StatusPill>,
      mobileRole: "status",
    },
    {
      header: "Actions",
      cell: ({ review }) => canManage ? (
        <div className="flex items-center gap-1" onClick={(event) => event.stopPropagation()}>
          <Input
            aria-label={`Workflow action code for ${review.reviewCode}`}
            placeholder="Action"
            value={reviewActionById[review.id] ?? ""}
            onChange={(event) => setReviewActionById((current) => ({ ...current, [review.id]: event.target.value }))}
            className="w-28! text-xs"
          />
          <Button
            variant="secondary"
            className="text-xs"
            disabled={busy || !reviewActionById[review.id]?.trim()}
            onClick={() => void actOnReview(review.id)}
          >
            Run
          </Button>
        </div>
      ) : <span className="text-slate-400">—</span>,
    },
  ];

  const competencyColumns: Column<WorkforceCompetency>[] = [
    {
      header: "Competency",
      cell: (row) => (
        <div>
          <div className="font-semibold text-slate-900">{row.name}</div>
          <div className="font-mono text-xs text-slate-500">{row.code}</div>
        </div>
      ),
      mobileRole: "title",
    },
    { header: "Category", cell: (row) => <Badge>{label(row.category ?? "General")}</Badge> },
    { header: "Scale", cell: (row) => `${row.scaleMin} to ${row.scaleMax}` },
    { header: "State", cell: (row) => <StatusPill tone={row.isActive ? "success" : "neutral"}>{row.isActive ? "Active" : "Inactive"}</StatusPill>, mobileRole: "status" },
  ];

  const employeeCompColumns: Column<WorkforceEmployeeCompetency>[] = [
    { header: "Competency", cell: (row) => <span className="font-semibold">{competencyName(row.competencyId)}</span>, mobileRole: "title" },
    { header: "Proficiency Level", cell: (row) => <Badge>{row.proficiencyLevel}</Badge>, mobileRole: "status" },
    { header: "Last assessed", cell: (row) => formatDateShort(row.lastAssessedDate) },
    { header: "Notes", cell: (row) => row.notes ?? "—" },
  ];

  const courseColumns: Column<WorkforceTrainingCourse>[] = [
    {
      header: "Course",
      cell: (row) => (
        <div>
          <div className="font-semibold text-slate-900">{row.title}</div>
          <div className="font-mono text-xs text-slate-500">{row.courseCode}</div>
        </div>
      ),
      mobileRole: "title",
    },
    { header: "Provider", cell: (row) => row.provider ?? "Internal" },
    { header: "Duration", cell: (row) => `${row.durationHours} hours` },
    { header: "Linked competency", cell: (row) => row.competencyId ? competencyName(row.competencyId) : "None" },
    { header: "Status", cell: (row) => <StatusPill tone={row.isActive ? "success" : "neutral"}>{row.isActive ? "Active" : "Inactive"}</StatusPill>, mobileRole: "status" },
  ];

  const enrollmentColumns: Column<WorkforceTrainingEnrollment>[] = [
    { header: "Training course", cell: (row) => <span className="font-semibold">{courseTitleById(row.trainingCourseId)}</span>, mobileRole: "title" },
    { header: "Enrolled", cell: (row) => formatDateShort(row.enrolledAt) },
    { header: "Status", cell: (row) => <StatusPill tone={statusTone(row.status)}>{label(row.status)}</StatusPill>, mobileRole: "status" },
    {
      header: "Completion",
      cell: (row) => canManage && row.status !== "completed" ? (
        <Button variant="secondary" className="text-xs" disabled={busy} onClick={() => void completeTraining(row.id)}>
          Mark completed
        </Button>
      ) : <span className="text-xs text-slate-500">{row.completionDate ? formatDateShort(row.completionDate) : "—"}</span>,
    },
  ];

  const careerColumns: Column<WorkforceCareerPath>[] = [
    { header: "From position", cell: (row) => <span className="font-semibold">{positionName(row.fromPositionId)}</span>, mobileRole: "title" },
    { header: "To position", cell: (row) => <span className="font-semibold text-slate-900">{positionName(row.toPositionId)}</span> },
    { header: "Required tenure", cell: (row) => `${row.requiredTenureMonths} months` },
    { header: "Guidelines", cell: (row) => row.guidelines ?? "Standard career progression" },
  ];

  const tabButton = (value: typeof tab, text: string) => (
    <button
      type="button"
      onClick={() => setTab(value)}
      className={`whitespace-nowrap border-b-2 px-3 py-2 text-sm ${tab === value ? "border-slate-900 font-semibold text-slate-900" : "border-transparent text-slate-500 hover:text-slate-700"}`}
    >
      {text}
    </button>
  );

  return (
    <div className="space-y-4">
      <PageHeader title="Talent & Performance" subtitle="Maintain competencies, training catalogs, structured appraisal cycles, and career mobility paths." />
      {error ? <Alert tone="error">{error}</Alert> : null}
      {notice ? <Alert tone="success">{notice}</Alert> : null}
      {!canManage ? <Alert tone="info">Performance evaluations and catalog maintenance require <code className="font-mono text-xs">workforce.performance.manage</code>.</Alert> : null}

      <div className="flex overflow-x-auto border-b border-slate-200">
        {tabButton("reviews", `Appraisals (${reviews.length})`)}
        {tabButton("competencies", `Competencies (${competencies.length})`)}
        {tabButton("training", `Training & courses (${courses.length})`)}
        {tabButton("career", `Career pathways (${careerPaths.length})`)}
      </div>

      <Card>
        <h2 className="mb-3 text-sm font-semibold text-slate-800">Scoped Filters</h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <Field label="Employee context">
            <Select value={selectedEmployeeId} onChange={(event) => setSelectedEmployeeId(event.target.value)}>
              <option value="">All employees</option>
              {employees.map((employee) => <option key={employee.id} value={employee.id}>{employee.fullName} ({employee.employeeNumber})</option>)}
            </Select>
          </Field>
          <Field label="Year"><Input type="number" min="2000" max="2100" value={yearFilter} onChange={(event) => setYearFilter(event.target.value)} /></Field>
        </div>
      </Card>

      {canManage && tab === "reviews" ? (
        <Card>
          <h2 className="mb-3 text-sm font-semibold text-slate-800">Create Performance Review</h2>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Field label="Employee" required><Select value={reviewEmployeeId} onChange={(event) => setReviewEmployeeId(event.target.value)}><option value="">Select employee</option>{employees.map((employee) => <option key={employee.id} value={employee.id}>{employee.fullName}</option>)}</Select></Field>
            <Field label="Period start" required><Input type="date" value={reviewStart} onChange={(event) => setReviewStart(event.target.value)} /></Field>
            <Field label="Period end" required><Input type="date" value={reviewEnd} onChange={(event) => setReviewEnd(event.target.value)} /></Field>
            <Field label="Overall rating (1-5)"><Input type="number" min="1" max="5" value={overallRating} onChange={(event) => setOverallRating(event.target.value)} /></Field>
            <Field label="Goals score (%)"><Input type="number" min="0" max="100" value={goalsScore} onChange={(event) => setGoalsScore(event.target.value)} /></Field>
            <Field label="Competency score (%)"><Input type="number" min="0" max="100" value={competencyScore} onChange={(event) => setCompetencyScore(event.target.value)} /></Field>
            <div className="sm:col-span-2 lg:col-span-4"><Field label="Review notes"><Textarea rows={2} value={reviewNotes} onChange={(event) => setReviewNotes(event.target.value)} /></Field></div>
            <div className="sm:col-span-2 lg:col-span-4"><Field label="Development plan"><Textarea rows={2} value={developmentPlan} onChange={(event) => setDevelopmentPlan(event.target.value)} /></Field></div>
          </div>
          <Button className="mt-3" disabled={busy || !reviewEmployeeId || !reviewStart || !reviewEnd} onClick={() => void createReview()}>Submit performance appraisal</Button>
        </Card>
      ) : null}

      {canManage && tab === "competencies" ? (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <Card>
            <h2 className="mb-3 text-sm font-semibold text-slate-800">Add Competency Definition</h2>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field label="Code" required><Input value={compCode} onChange={(event) => setCompCode(event.target.value)} placeholder="LEADERSHIP" /></Field>
              <Field label="Name" required><Input value={compName} onChange={(event) => setCompName(event.target.value)} placeholder="Team Leadership" /></Field>
              <Field label="Category"><Input value={compCategory} onChange={(event) => setCompCategory(event.target.value)} /></Field>
              <div className="grid grid-cols-2 gap-2">
                <Field label="Min"><Input type="number" min="1" value={scaleMin} onChange={(event) => setScaleMin(event.target.value)} /></Field>
                <Field label="Max"><Input type="number" min="1" value={scaleMax} onChange={(event) => setScaleMax(event.target.value)} /></Field>
              </div>
            </div>
            <Button className="mt-3" disabled={busy || !compCode.trim() || !compName.trim()} onClick={() => void createCompetency()}>Save competency</Button>
          </Card>

          <Card>
            <h2 className="mb-3 text-sm font-semibold text-slate-800">Assess Employee Competency</h2>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field label="Employee" required><Select value={assessEmployeeId} onChange={(event) => setAssessEmployeeId(event.target.value)}><option value="">Select employee</option>{employees.map((employee) => <option key={employee.id} value={employee.id}>{employee.fullName}</option>)}</Select></Field>
              <Field label="Competency" required><Select value={assessCompetencyId} onChange={(event) => setAssessCompetencyId(event.target.value)}><option value="">Select competency</option>{competencies.filter((item) => item.isActive).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</Select></Field>
              <Field label="Proficiency level" required><Input type="number" min="1" max="10" value={assessLevel} onChange={(event) => setAssessLevel(event.target.value)} /></Field>
              <Field label="Assessment notes"><Input value={assessNotes} onChange={(event) => setAssessNotes(event.target.value)} /></Field>
            </div>
            <Button className="mt-3" disabled={busy || !assessEmployeeId || !assessCompetencyId} onClick={() => void assessCompetency()}>Save assessment</Button>
          </Card>
        </div>
      ) : null}

      {canManage && tab === "training" ? (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <Card>
            <h2 className="mb-3 text-sm font-semibold text-slate-800">Add Training Course</h2>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field label="Course code" required><Input value={courseCode} onChange={(event) => setCourseCode(event.target.value)} placeholder="SAFE_001" /></Field>
              <Field label="Title" required><Input value={courseTitle} onChange={(event) => setCourseTitle(event.target.value)} placeholder="Field Safety Protocol" /></Field>
              <Field label="Provider"><Input value={courseProvider} onChange={(event) => setCourseProvider(event.target.value)} /></Field>
              <Field label="Duration (hours)"><Input type="number" min="1" value={durationHours} onChange={(event) => setDurationHours(event.target.value)} /></Field>
              <div className="sm:col-span-2">
                <Field label="Linked competency">
                  <Select value={courseCompetencyId} onChange={(event) => setCourseCompetencyId(event.target.value)}>
                    <option value="">None</option>
                    {competencies.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
                  </Select>
                </Field>
              </div>
            </div>
            <Button className="mt-3" disabled={busy || !courseCode.trim() || !courseTitle.trim()} onClick={() => void createCourse()}>Save course</Button>
          </Card>

          <Card>
            <h2 className="mb-3 text-sm font-semibold text-slate-800">Enroll Employee</h2>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field label="Employee" required><Select value={enrollEmployeeId} onChange={(event) => setEnrollEmployeeId(event.target.value)}><option value="">Select employee</option>{employees.map((employee) => <option key={employee.id} value={employee.id}>{employee.fullName}</option>)}</Select></Field>
              <Field label="Course" required><Select value={enrollCourseId} onChange={(event) => setEnrollCourseId(event.target.value)}><option value="">Select course</option>{courses.filter((item) => item.isActive).map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}</Select></Field>
            </div>
            <Button className="mt-3" disabled={busy || !enrollEmployeeId || !enrollCourseId} onClick={() => void enrollEmployee()}>Enroll in training</Button>
          </Card>
        </div>
      ) : null}

      {canManage && tab === "career" ? (
        <Card>
          <h2 className="mb-3 text-sm font-semibold text-slate-800">Create Career Pathway</h2>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Field label="From position" required><Select value={fromPositionId} onChange={(event) => setFromPositionId(event.target.value)}><option value="">Select current position</option>{positions.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</Select></Field>
            <Field label="To target position" required><Select value={toPositionId} onChange={(event) => setToPositionId(event.target.value)}><option value="">Select target position</option>{positions.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</Select></Field>
            <Field label="Required tenure (months)"><Input type="number" min="0" value={tenureMonths} onChange={(event) => setTenureMonths(event.target.value)} /></Field>
            <div className="sm:col-span-3"><Field label="Career mobility guidelines"><Textarea rows={2} value={careerGuidelines} onChange={(event) => setCareerGuidelines(event.target.value)} /></Field></div>
          </div>
          <Button className="mt-3" disabled={busy || !fromPositionId || !toPositionId} onClick={() => void createCareerPath()}>Save career path</Button>
        </Card>
      ) : null}

      {loading ? <Spinner label="Loading performance records…" /> : (
        <Card>
          {tab === "reviews" ? <DataTable columns={reviewColumns} rows={reviews} keyOf={(row) => row.review.id} mobileBreakpoint="md" empty={<EmptyState title="No appraisals found" description="Create a performance review above." />} /> : null}
          {tab === "competencies" ? (
            <div className="space-y-4">
              <DataTable columns={competencyColumns} rows={competencies} keyOf={(row) => row.id} empty={<EmptyState title="No competencies defined" description="Create a competency model above." />} />
              {selectedEmployeeId ? (
                <>
                  <h3 className="text-sm font-semibold text-slate-800">Assessed Competencies for Selected Employee</h3>
                  <DataTable columns={employeeCompColumns} rows={employeeCompetencies} keyOf={(row) => row.id} empty={<EmptyState title="No assessments recorded" description="Assess competency levels above." />} />
                </>
              ) : null}
            </div>
          ) : null}
          {tab === "training" ? (
            <div className="space-y-4">
              <DataTable columns={courseColumns} rows={courses} keyOf={(row) => row.id} empty={<EmptyState title="No training courses" description="Add training courses above." />} />
              {selectedEmployeeId ? (
                <>
                  <h3 className="text-sm font-semibold text-slate-800">Enrollments for Selected Employee</h3>
                  <DataTable columns={enrollmentColumns} rows={enrollments} keyOf={(row) => row.id} empty={<EmptyState title="No enrollments recorded" description="Enroll this employee in courses above." />} />
                </>
              ) : null}
            </div>
          ) : null}
          {tab === "career" ? <DataTable columns={careerColumns} rows={careerPaths} keyOf={(row) => row.id} empty={<EmptyState title="No career pathways" description="Define role-to-role progression paths above." />} /> : null}
        </Card>
      )}
    </div>
  );
}
