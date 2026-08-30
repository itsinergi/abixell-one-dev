/** Wave A4 — job openings, applicants, hiring stages, and workflow lifecycle. */
import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "../../auth/AuthContext";
import {
  api,
  ApiError,
  type PositionRecord,
  type WorkforceJobApplication,
  type WorkforceJobApplicationStage,
  type WorkforceJobPostingRow,
  type WorkforceJobPostingStatus,
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

const APPLICATION_STAGES: WorkforceJobApplicationStage[] = [
  "applied",
  "screening",
  "interview",
  "offer",
  "hired",
  "rejected",
  "withdrawn",
];

function label(value: string): string {
  return value.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());
}

function workflowLabel(status: WorkforceWorkflowStatus | null, fallback: string): string {
  return status?.stepName ?? status?.stepCode ?? (status ? label(status.instanceStatus) : label(fallback));
}

function stageTone(stage: WorkforceJobApplicationStage) {
  switch (stage) {
    case "hired":
      return "success";
    case "interview":
    case "offer":
      return "info";
    case "screening":
    case "applied":
      return "neutral";
    case "rejected":
    case "withdrawn":
      return "danger";
    default:
      return "neutral";
  }
}

export function WorkforceRecruitmentPage() {
  const { session } = useAuth();
  const token = session!.accessToken;
  const { permissions } = useShell();
  const canManage = permissions.includes(PERMISSIONS.workforceRecruitmentManage);

  const [tab, setTab] = useState<"postings" | "applications">("postings");
  const [positions, setPositions] = useState<PositionRecord[]>([]);
  const [postings, setPostings] = useState<WorkforceJobPostingRow[]>([]);
  const [applications, setApplications] = useState<WorkforceJobApplication[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [statusFilter, setStatusFilter] = useState<WorkforceJobPostingStatus | "">("");
  const [selectedPostingId, setSelectedPostingId] = useState<string>("");
  const [stageFilter, setStageFilter] = useState<WorkforceJobApplicationStage | "">("");

  const [postingTitle, setPostingTitle] = useState("");
  const [positionId, setPositionId] = useState("");
  const [headcountTarget, setHeadcountTarget] = useState("1");
  const [employmentType, setEmploymentType] = useState("full_time");
  const [jobDescription, setJobDescription] = useState("");

  const [candidateName, setCandidateName] = useState("");
  const [candidateEmail, setCandidateEmail] = useState("");
  const [candidatePhone, setCandidatePhone] = useState("");
  const [resumeId, setResumeId] = useState("");

  const [nextStageById, setNextStageById] = useState<Record<string, WorkforceJobApplicationStage>>({});
  const [ratingById, setRatingById] = useState<Record<string, string>>({});
  const [notesById, setNotesById] = useState<Record<string, string>>({});
  const [postingActionById, setPostingActionById] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [positionList, postingList, applicationList] = await Promise.all([
        api.positions(token).catch(() => [] as PositionRecord[]),
        api.workforceJobPostings(token, {
          status: (statusFilter as WorkforceJobPostingStatus) || undefined,
        }),
        api.workforceJobApplications(token, {
          jobPostingId: selectedPostingId || undefined,
          stage: (stageFilter as WorkforceJobApplicationStage) || undefined,
        }),
      ]);
      setPositions(positionList.filter((item) => item.isActive));
      setPostings(postingList);
      setApplications(applicationList);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not load recruitment data.");
    } finally {
      setLoading(false);
    }
  }, [token, statusFilter, selectedPostingId, stageFilter]);

  useEffect(() => {
    void load();
  }, [load]);

  const postingTitleById = useMemo(
    () => (id: string) => postings.find((item) => item.jobPosting.id === id)?.jobPosting.title ?? id,
    [postings],
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
      setError(err instanceof ApiError ? err.message : "Recruitment action failed.");
    } finally {
      setBusy(false);
    }
  }

  async function createPosting() {
    await runAction(
      () => api.createWorkforceJobPosting(token, {
        title: postingTitle.trim(),
        positionId: positionId || null,
        headcountTarget: Number(headcountTarget) || 1,
        employmentType: employmentType || null,
        jobDescription: jobDescription || null,
      }),
      `Job posting ${postingTitle} created.`,
    );
    setPostingTitle("");
    setJobDescription("");
  }

  async function actOnPosting(id: string) {
    const actionCode = postingActionById[id]?.trim();
    if (!actionCode) return;
    await runAction(
      () => api.actOnWorkforceJobPosting(token, id, actionCode, null),
      `Job posting updated via action ${label(actionCode)}.`,
    );
  }

  async function createApplication() {
    if (!selectedPostingId) return;
    await runAction(
      () => api.createWorkforceJobApplication(token, {
        jobPostingId: selectedPostingId,
        candidateName: candidateName.trim(),
        candidateEmail: candidateEmail.trim() || null,
        candidatePhone: candidatePhone.trim() || null,
        resumeDocumentId: resumeId.trim() || null,
      }),
      `Candidate ${candidateName} added to the pipeline.`,
    );
    setCandidateName("");
    setCandidateEmail("");
    setCandidatePhone("");
    setResumeId("");
  }

  async function advanceStage(id: string) {
    const stage = nextStageById[id];
    if (!stage) return;
    await runAction(
      () => api.advanceWorkforceJobApplication(token, id, {
        stage,
        rating: ratingById[id] ? Number(ratingById[id]) : null,
        interviewerNotes: notesById[id] || null,
      }),
      `Application advanced to ${label(stage)}.`,
    );
  }

  const postingColumns: Column<WorkforceJobPostingRow>[] = [
    {
      header: "Opening",
      cell: ({ jobPosting }) => (
        <div>
          <div className="font-semibold text-slate-900">{jobPosting.title}</div>
          <div className="font-mono text-xs text-slate-500">{jobPosting.postingCode}</div>
        </div>
      ),
      mobileRole: "title",
    },
    { header: "Headcount target", cell: ({ jobPosting }) => jobPosting.headcountTarget },
    { header: "Employment type", cell: ({ jobPosting }) => label(jobPosting.employmentType ?? "—") },
    {
      header: "Status",
      cell: ({ jobPosting, status }) => (
        <StatusPill tone={statusTone(status?.instanceStatus)}>{workflowLabel(status, jobPosting.status)}</StatusPill>
      ),
      mobileRole: "status",
    },
    {
      header: "Workflow actions",
      cell: ({ jobPosting }) => canManage ? (
        <div className="flex flex-wrap items-center gap-1" onClick={(event) => event.stopPropagation()}>
          <Input
            aria-label={`Workflow action code for ${jobPosting.title}`}
            placeholder="Action code"
            value={postingActionById[jobPosting.id] ?? ""}
            onChange={(event) => setPostingActionById((current) => ({ ...current, [jobPosting.id]: event.target.value }))}
            className="!w-32 text-xs"
          />
          <Button
            variant="secondary"
            className="text-xs"
            disabled={busy || !postingActionById[jobPosting.id]?.trim()}
            onClick={() => void actOnPosting(jobPosting.id)}
          >
            Apply
          </Button>
        </div>
      ) : <span className="text-slate-400">—</span>,
    },
  ];

  const applicationColumns: Column<WorkforceJobApplication>[] = [
    {
      header: "Candidate",
      cell: (row) => (
        <div>
          <div className="font-semibold text-slate-900">{row.candidateName}</div>
          <div className="text-xs text-slate-500">{row.candidateEmail ?? row.candidatePhone ?? "No contact details"}</div>
        </div>
      ),
      mobileRole: "title",
    },
    { header: "Opening", cell: (row) => <Badge>{postingTitleById(row.jobPostingId)}</Badge> },
    { header: "Applied", cell: (row) => formatDateShort(row.appliedAt) },
    {
      header: "Stage",
      cell: (row) => <StatusPill tone={stageTone(row.stage)}>{label(row.stage)}</StatusPill>,
      mobileRole: "status",
    },
    { header: "Rating", cell: (row) => row.rating != null ? `${row.rating}/5` : "—" },
    {
      header: "Advance stage",
      cell: (row) => canManage ? (
        <div className="space-y-1 min-w-[210px]" onClick={(event) => event.stopPropagation()}>
          <div className="flex items-center gap-1">
            <Select
              aria-label={`Select target stage for ${row.candidateName}`}
              value={nextStageById[row.id] ?? row.stage}
              onChange={(event) => setNextStageById((current) => ({ ...current, [row.id]: event.target.value as WorkforceJobApplicationStage }))}
            >
              {APPLICATION_STAGES.map((stage) => <option key={stage} value={stage}>{label(stage)}</option>)}
            </Select>
            <Input
              aria-label={`Rating out of 5 for ${row.candidateName}`}
              type="number"
              min="1"
              max="5"
              placeholder="Rating"
              value={ratingById[row.id] ?? ""}
              onChange={(event) => setRatingById((current) => ({ ...current, [row.id]: event.target.value }))}
              className="!w-20"
            />
          </div>
          <Input
            aria-label={`Interviewer notes for ${row.candidateName}`}
            placeholder="Interviewer notes"
            value={notesById[row.id] ?? ""}
            onChange={(event) => setNotesById((current) => ({ ...current, [row.id]: event.target.value }))}
          />
          <Button variant="secondary" className="text-xs" disabled={busy} onClick={() => void advanceStage(row.id)}>
            Update stage
          </Button>
        </div>
      ) : <span className="text-slate-400">—</span>,
    },
  ];

  return (
    <div className="space-y-4">
      <PageHeader title="Recruitment" subtitle="Publish openings, source candidates, run interview feedback, and advance through the pipeline." />
      {error ? <Alert tone="error">{error}</Alert> : null}
      {notice ? <Alert tone="success">{notice}</Alert> : null}
      {!canManage ? <Alert tone="info">Posting openings and advancing candidates require <code className="font-mono text-xs">workforce.recruitment.manage</code>.</Alert> : null}

      <div className="flex border-b border-slate-200 text-sm">
        <button
          type="button"
          onClick={() => setTab("postings")}
          className={`px-3 py-2 border-b-2 font-medium ${tab === "postings" ? "border-slate-900 font-semibold text-slate-900" : "border-transparent text-slate-500 hover:text-slate-700"}`}
        >
          Job openings ({postings.length})
        </button>
        <button
          type="button"
          onClick={() => setTab("applications")}
          className={`px-3 py-2 border-b-2 font-medium ${tab === "applications" ? "border-slate-900 font-semibold text-slate-900" : "border-transparent text-slate-500 hover:text-slate-700"}`}
        >
          Candidate pipeline ({applications.length})
        </button>
      </div>

      <Card>
        <h2 className="mb-3 text-sm font-semibold text-slate-800">Filters</h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Field label="Job opening">
            <Select value={selectedPostingId} onChange={(event) => setSelectedPostingId(event.target.value)}>
              <option value="">All openings</option>
              {postings.map(({ jobPosting }) => <option key={jobPosting.id} value={jobPosting.id}>{jobPosting.title} ({jobPosting.postingCode})</option>)}
            </Select>
          </Field>
          {tab === "postings" ? (
            <Field label="Posting status">
              <Select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as WorkforceJobPostingStatus)}>
                <option value="">All statuses</option>
                <option value="draft">Draft</option>
                <option value="published">Published</option>
                <option value="closed">Closed</option>
                <option value="cancelled">Cancelled</option>
              </Select>
            </Field>
          ) : (
            <Field label="Pipeline stage">
              <Select value={stageFilter} onChange={(event) => setStageFilter(event.target.value as WorkforceJobApplicationStage)}>
                <option value="">All stages</option>
                {APPLICATION_STAGES.map((stage) => <option key={stage} value={stage}>{label(stage)}</option>)}
              </Select>
            </Field>
          )}
        </div>
      </Card>

      {canManage && tab === "postings" ? (
        <Card>
          <h2 className="mb-3 text-sm font-semibold text-slate-800">Create Job Opening</h2>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Field label="Title" required><Input value={postingTitle} onChange={(event) => setPostingTitle(event.target.value)} placeholder="Senior Site Supervisor" /></Field>
            <Field label="Position"><Select value={positionId} onChange={(event) => setPositionId(event.target.value)}><option value="">None / Custom</option>{positions.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</Select></Field>
            <Field label="Headcount target"><Input type="number" min="1" value={headcountTarget} onChange={(event) => setHeadcountTarget(event.target.value)} /></Field>
            <Field label="Employment type"><Select value={employmentType} onChange={(event) => setEmploymentType(event.target.value)}><option value="full_time">Full time</option><option value="contract">Contract</option><option value="temporary">Temporary</option></Select></Field>
            <div className="sm:col-span-2 lg:col-span-4"><Field label="Job description"><Textarea rows={2} value={jobDescription} onChange={(event) => setJobDescription(event.target.value)} /></Field></div>
          </div>
          <Button className="mt-3" disabled={busy || !postingTitle.trim()} onClick={() => void createPosting()}>Publish opening</Button>
        </Card>
      ) : null}

      {canManage && tab === "applications" ? (
        <Card>
          <h2 className="mb-3 text-sm font-semibold text-slate-800">Add Candidate Application</h2>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Field label="Opening" required>
              <Select value={selectedPostingId} onChange={(event) => setSelectedPostingId(event.target.value)}>
                <option value="">Select opening</option>
                {postings.map(({ jobPosting }) => <option key={jobPosting.id} value={jobPosting.id}>{jobPosting.title}</option>)}
              </Select>
            </Field>
            <Field label="Candidate full name" required><Input value={candidateName} onChange={(event) => setCandidateName(event.target.value)} /></Field>
            <Field label="Candidate email"><Input type="email" value={candidateEmail} onChange={(event) => setCandidateEmail(event.target.value)} /></Field>
            <Field label="Candidate phone"><Input value={candidatePhone} onChange={(event) => setCandidatePhone(event.target.value)} /></Field>
            <Field label="Resume document ID"><Input value={resumeId} onChange={(event) => setResumeId(event.target.value)} placeholder="Optional document ID" /></Field>
          </div>
          <Button className="mt-3" disabled={busy || !selectedPostingId || !candidateName.trim()} onClick={() => void createApplication()}>Record application</Button>
        </Card>
      ) : null}

      {loading ? <Spinner label="Loading recruitment records…" /> : (
        <Card>
          {tab === "postings" ? (
            <DataTable columns={postingColumns} rows={postings} keyOf={(row) => row.jobPosting.id} mobileBreakpoint="md" empty={<EmptyState title="No openings found" description="Create a job opening above." />} />
          ) : (
            <DataTable columns={applicationColumns} rows={applications} keyOf={(row) => row.id} mobileBreakpoint="md" empty={<EmptyState title="No applications in pipeline" description="Record candidates above to track the hiring workflow." />} />
          )}
        </Card>
      )}
    </div>
  );
}
