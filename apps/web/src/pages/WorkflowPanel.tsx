import { useCallback, useEffect, useRef, useState } from "react";
import { api, ApiError, type WorkflowAssignment, type WorkflowInstance } from "../lib/api";
import { OverlayDialog } from "../shell/components/OverlayDialog";
import {
  Button,
  Card,
  DataTable,
  EmptyState,
  Field,
  Input,
  Select,
  StatusPill,
  Timeline,
  type Column,
} from "../shell/components/ui";
import { AdminSectionState } from "./admin/console/AdminSection";

/**
 * Checkpoint 0D — Workflow & Approval Engine panel.
 *
 * Demonstrates the generic engine end-to-end against a demo transaction
 * only: start an instance, act on a task (Approve / Reject / Return /
 * Resubmit — whatever the current Step's Transitions allow), inspect the
 * History of one instance, and trigger the Escalation sweep. No
 * Complaint/Survey/Procurement business logic here by design — this proves
 * the engine, not a business module.
 */

type OrgUnitOption = { id: string; name: string };
type HistoryEntry = { id?: string; actionCode: string; occurredAt: string; comment: string | null };
type ResourceState = { loading: boolean; error: string | null; denied: boolean; sessionExpired: boolean };

const initialResourceState: ResourceState = { loading: true, error: null, denied: false, sessionExpired: false };

/** A failed read must never render as an empty queue: 401 and 403 stay
 * distinct from a load failure, matching the console resource model. */
function describeFailure(error: unknown, fallback: string): ResourceState {
  const denied = error instanceof ApiError && error.status === 403;
  const sessionExpired = error instanceof ApiError && error.status === 401;
  return {
    loading: false,
    denied,
    sessionExpired,
    error: sessionExpired
      ? "Your session has expired. Sign in again."
      : denied
        ? "You do not have permission to read this resource."
        : error instanceof ApiError
          ? error.message
          : fallback,
  };
}

export function WorkflowPanel({
  token,
  orgUnits,
  canStart,
  canAct,
  canManage,
  onMessage,
}: {
  token: string;
  orgUnits: OrgUnitOption[];
  canStart: boolean;
  canAct: boolean;
  canManage: boolean;
  onMessage: (m: { type: "error" | "success"; text: string }) => void;
}) {
  const [instances, setInstances] = useState<WorkflowInstance[]>([]);
  const [myAssignments, setMyAssignments] = useState<WorkflowAssignment[]>([]);
  const [instancesState, setInstancesState] = useState<ResourceState>(initialResourceState);
  const [assignmentsState, setAssignmentsState] = useState<ResourceState>(initialResourceState);
  const [selectedInstanceId, setSelectedInstanceId] = useState("");

  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [historyPending, setHistoryPending] = useState(false);

  const [startOpen, setStartOpen] = useState(false);
  const [startOrgUnitId, setStartOrgUnitId] = useState("");
  const [startCategory, setStartCategory] = useState("normal");
  const [startPending, setStartPending] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);

  const [actionOpen, setActionOpen] = useState(false);
  const [actionAssignment, setActionAssignment] = useState<WorkflowAssignment | null>(null);
  const [actionCode, setActionCode] = useState("");
  const [actionComment, setActionComment] = useState("");
  const [actionPending, setActionPending] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const [claimTarget, setClaimTarget] = useState<{ assignment: WorkflowAssignment; releasing: boolean } | null>(null);
  const [claimPending, setClaimPending] = useState(false);
  const [claimError, setClaimError] = useState<string | null>(null);

  const [sweepOpen, setSweepOpen] = useState(false);
  const [sweepPending, setSweepPending] = useState(false);
  const [sweepError, setSweepError] = useState<string | null>(null);

  const refreshGeneration = useRef(0);
  const historyGeneration = useRef(0);
  const lifetime = useRef(0);
  const startBusy = useRef(false);
  const actionBusy = useRef(false);
  const claimBusy = useRef(false);
  const sweepBusy = useRef(false);

  useEffect(() => {
    lifetime.current += 1;
    return () => {
      lifetime.current += 1;
      refreshGeneration.current += 1;
      historyGeneration.current += 1;
      startBusy.current = false;
      actionBusy.current = false;
      claimBusy.current = false;
      sweepBusy.current = false;
    };
  }, [token]);

  const refresh = useCallback(async () => {
    const generation = ++refreshGeneration.current;
    setInstancesState((state) => ({ ...state, loading: true, error: null }));
    setAssignmentsState((state) => ({ ...state, loading: true, error: null }));

    const [instanceResult, assignmentResult] = await Promise.allSettled([
      api.workflowInstances(token),
      api.myWorkflowAssignments(token),
    ]);
    if (generation !== refreshGeneration.current) return;

    if (instanceResult.status === "fulfilled") {
      setInstances(instanceResult.value);
      setInstancesState({ loading: false, error: null, denied: false, sessionExpired: false });
    } else {
      setInstancesState(describeFailure(instanceResult.reason, "Failed to load workflow instances."));
    }

    if (assignmentResult.status === "fulfilled") {
      setMyAssignments(assignmentResult.value);
      setAssignmentsState({ loading: false, error: null, denied: false, sessionExpired: false });
    } else {
      setAssignmentsState(describeFailure(assignmentResult.reason, "Failed to load your tasks."));
    }
  }, [token]);

  useEffect(() => {
    void refresh();
    return () => {
      refreshGeneration.current += 1;
    };
  }, [refresh]);

  useEffect(() => {
    if (orgUnits.length > 0 && !orgUnits.some((unit) => unit.id === startOrgUnitId)) {
      setStartOrgUnitId(orgUnits[0].id);
    }
  }, [orgUnits, startOrgUnitId]);

  const openHistory = useCallback(
    async (instanceId: string) => {
      const generation = ++historyGeneration.current;
      setSelectedInstanceId(instanceId);
      setHistoryOpen(true);
      setHistoryPending(true);
      setHistoryError(null);
      try {
        const result = await api.workflowInstanceHistory(token, instanceId);
        if (generation !== historyGeneration.current) return;
        setHistory(result);
      } catch (err) {
        if (generation !== historyGeneration.current) return;
        setHistory([]);
        setHistoryError(err instanceof ApiError ? err.message : "Failed to load workflow history.");
      } finally {
        if (generation === historyGeneration.current) setHistoryPending(false);
      }
    },
    [token],
  );

  async function handleStartInstance() {
    if (startBusy.current || !startOrgUnitId || !canStart) return;
    const life = lifetime.current;
    startBusy.current = true;
    setStartPending(true);
    setStartError(null);
    try {
      const orgUnitId = startOrgUnitId;
      const category = startCategory;
      const tx = await api.createDemoTransaction(token, `Demo transaction ${new Date().toISOString()}`);
      const result = await api.startWorkflowInstance(token, {
        definitionCode: "demo_approval_workflow",
        entityId: tx.id,
        contextData: { organizationUnitId: orgUnitId, category },
      });
      if (lifetime.current !== life) return;
      onMessage({
        type: "success",
        text: `Workflow Instance started (category: ${category}) — routed to ${
          result.assignment.assignmentType === "role"
            ? `role '${result.assignment.assignedRoleCode}'`
            : "the submitting user"
        }.`,
      });
      setStartOpen(false);
      setSelectedInstanceId(result.instance.id);
      await refresh();
    } catch (err) {
      if (lifetime.current === life) setStartError(err instanceof ApiError ? err.message : "Failed to start workflow instance.");
    } finally {
      if (lifetime.current === life) setStartPending(false);
      startBusy.current = false;
    }
  }

  function openAction(assignment: WorkflowAssignment, code: string) {
    if (actionBusy.current) return;
    setActionAssignment(assignment);
    setActionCode(code);
    setActionComment("");
    setActionError(null);
    setActionOpen(true);
  }

  async function handleAct() {
    if (!actionAssignment || actionBusy.current || !actionCode || !canAct) return;
    const assignment = actionAssignment;
    const code = actionCode;
    const comment = actionComment.trim() || null;
    const life = lifetime.current;
    actionBusy.current = true;
    setActionPending(true);
    setActionError(null);
    try {
      const result = await api.actOnWorkflowAssignment(token, assignment.id, { actionCode: code, comment });
      if (lifetime.current !== life) return;
      onMessage({ type: "success", text: `Action '${code}' recorded — Instance status is now '${result.instance.status}'.` });
      setActionOpen(false);
      await refresh();
    } catch (err) {
      if (lifetime.current === life) setActionError(err instanceof ApiError ? err.message : "Failed to record workflow action.");
    } finally {
      if (lifetime.current === life) setActionPending(false);
      actionBusy.current = false;
    }
  }

  function openClaim(assignment: WorkflowAssignment) {
    if (claimBusy.current) return;
    setClaimTarget({ assignment, releasing: Boolean(assignment.claimedByUserId) });
    setClaimError(null);
  }

  async function handleClaimDecision() {
    if (!claimTarget || claimBusy.current || !canAct) return;
    const { assignment, releasing } = claimTarget;
    const life = lifetime.current;
    claimBusy.current = true;
    setClaimPending(true);
    setClaimError(null);
    try {
      if (releasing) {
        await api.releaseWorkflowAssignmentClaim(token, assignment.id);
      } else {
        await api.claimWorkflowAssignment(token, assignment.id);
      }
      if (lifetime.current !== life) return;
      onMessage({
        type: "success",
        text: releasing
          ? "Claim released — any eligible teammate can now claim/act on it."
          : "Task claimed — reserved for you for 15 minutes (ADR-0008).",
      });
      setClaimTarget(null);
      await refresh();
    } catch (err) {
      if (lifetime.current === life) {
        setClaimError(err instanceof ApiError ? err.message : releasing ? "Failed to release claim." : "Failed to claim task.");
      }
    } finally {
      if (lifetime.current === life) setClaimPending(false);
      claimBusy.current = false;
    }
  }

  async function handleEscalationSweep() {
    if (sweepBusy.current || !canManage) return;
    const life = lifetime.current;
    sweepBusy.current = true;
    setSweepPending(true);
    setSweepError(null);
    try {
      const result = await api.triggerWorkflowEscalationSweep(token);
      if (lifetime.current !== life) return;
      onMessage({ type: "success", text: `Escalation sweep complete — ${result.escalatedCount} overdue Assignment(s) reassigned.` });
      setSweepOpen(false);
      await refresh();
    } catch (err) {
      if (lifetime.current === life) setSweepError(err instanceof ApiError ? err.message : "Failed to run escalation sweep.");
    } finally {
      if (lifetime.current === life) setSweepPending(false);
      sweepBusy.current = false;
    }
  }

  const instanceColumns: Column<WorkflowInstance>[] = [
    { header: "Entity", mobileRole: "title", cell: (row) => <span className="font-mono">{row.entityId.slice(0, 8)}…</span> },
    {
      header: "Status",
      mobileRole: "status",
      cell: (row) => (
        <StatusPill tone={row.status === "approved" ? "success" : row.status === "rejected" ? "danger" : "info"}>{row.status}</StatusPill>
      ),
    },
    { header: "Started", cell: (row) => new Date(row.startedAt).toLocaleString() },
    {
      header: "Action",
      cell: (row) => (
        <Button variant="ghost" className="min-h-0 px-1 py-1 text-xs underline" onClick={() => void openHistory(row.id)}>
          View history
        </Button>
      ),
    },
  ];

  const assignmentColumns: Column<WorkflowAssignment>[] = [
    {
      header: "Routing",
      mobileRole: "title",
      cell: (row) => (row.assignmentType === "role" ? `Role: ${row.assignedRoleCode ?? "Unavailable"}` : "Assigned to you directly"),
    },
    { header: "Due", cell: (row) => (row.dueAt ? new Date(row.dueAt).toLocaleString() : "No due date") },
    {
      header: "Status",
      mobileRole: "status",
      cell: (row) => (
        <StatusPill tone={row.claimedByUserId ? "info" : "warning"}>{row.claimedByUserId ? "Claimed" : row.status}</StatusPill>
      ),
    },
    {
      header: "Actions",
      cell: (row) =>
        canAct ? (
          <div className="flex flex-wrap gap-1">
            {(["approve", "reject", "return", "resubmit"] as const).map((code) => (
              <Button key={code} variant="secondary" className="min-h-0 px-2 py-1 text-xs" onClick={() => openAction(row, code)}>
                {code[0].toUpperCase() + code.slice(1)}
              </Button>
            ))}
            <Button variant="ghost" className="min-h-0 px-2 py-1 text-xs" onClick={() => openClaim(row)}>
              {row.claimedByUserId ? "Release claim" : "Claim"}
            </Button>
          </div>
        ) : (
          "—"
        ),
    },
  ];

  const historyItems = history.map((entry, index) => ({
    key: entry.id ?? `${entry.occurredAt}-${index}`,
    title: entry.actionCode,
    timestamp: entry.occurredAt,
    detail: entry.comment ?? undefined,
  }));
  const actionTitle = actionCode ? actionCode[0].toUpperCase() + actionCode.slice(1) : "Workflow";

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-xl font-semibold text-slate-900">Workflow &amp; Approval Engine</h2>
          <p className="text-sm text-slate-500">
            Loaded workflow instances and My Tasks. Counts reflect only the data currently loaded from the server.
          </p>
        </div>
        {canStart && (
          <Button
            onClick={() => {
              setStartError(null);
              setStartOpen(true);
            }}
          >
            Start workflow
          </Button>
        )}
      </div>

      <Card>
        <div className="mb-3 flex items-baseline justify-between gap-2">
          <div>
            <h3 className="text-base font-semibold">My Tasks</h3>
            <p className="text-xs text-slate-500">Pending assignments routed to the signed-in user.</p>
          </div>
          {assignmentsState.loading === false && assignmentsState.error === null && (
            <span className="text-xs text-slate-500">
              {myAssignments.length} result{myAssignments.length === 1 ? "" : "s"}
            </span>
          )}
        </div>
        <AdminSectionState {...assignmentsState} loadingLabel="Loading your tasks…" onRetry={() => void refresh()}>
          <DataTable
            columns={assignmentColumns}
            rows={myAssignments}
            keyOf={(row) => row.id}
            empty={<EmptyState title="Nothing pending" description="There are no pending assignments for you." />}
            mobileBreakpoint="md"
          />
        </AdminSectionState>
      </Card>

      <Card>
        <div className="mb-3 flex items-baseline justify-between gap-2">
          <div>
            <h3 className="text-base font-semibold">Workflow Instances</h3>
            <p className="text-xs text-slate-500">Instances created through the existing workflow engine.</p>
          </div>
          {instancesState.loading === false && instancesState.error === null && (
            <span className="text-xs text-slate-500">
              {instances.length} result{instances.length === 1 ? "" : "s"}
            </span>
          )}
        </div>
        <AdminSectionState {...instancesState} loadingLabel="Loading workflow instances…" onRetry={() => void refresh()}>
          <DataTable
            columns={instanceColumns}
            rows={instances}
            keyOf={(row) => row.id}
            empty={
              <EmptyState
                title="No workflow instances"
                description="Start a workflow to create the demo transaction used by this engine demonstration."
              />
            }
          />
        </AdminSectionState>
      </Card>

      {canManage && (
        <Card>
          <h3 className="text-base font-semibold">Escalation Sweep</h3>
          <p className="mt-1 text-sm text-slate-500">
            Triggers the same existing sweep that the scheduler runs automatically. Overdue assignments are reassigned according to
            server-side rules.
          </p>
          <Button
            className="mt-3"
            onClick={() => {
              setSweepError(null);
              setSweepOpen(true);
            }}
          >
            Run escalation sweep
          </Button>
        </Card>
      )}

      <OverlayDialog
        open={startOpen}
        title="Start workflow"
        description="This creates a demo transaction, then starts the existing demo_approval_workflow against it. It does not create a business transaction."
        pending={startPending}
        onClose={() => setStartOpen(false)}
        footer={
          <>
            <Button variant="secondary" disabled={startPending} onClick={() => setStartOpen(false)}>
              Cancel
            </Button>
            <Button disabled={startPending || !startOrgUnitId} onClick={() => void handleStartInstance()}>
              {startPending ? "Starting…" : "Start workflow"}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          {startError && (
            <div role="alert" className="rounded border border-red-200 bg-red-50 p-3 text-sm text-red-800">
              {startError}
            </div>
          )}
          <Field label="Organization Unit" required hint="The existing workflow context scope.">
            <Select value={startOrgUnitId} onChange={(event) => setStartOrgUnitId(event.target.value)} disabled={startPending}>
              <option value="" disabled>
                Select an organization unit
              </option>
              {orgUnits.map((unit) => (
                <option key={unit.id} value={unit.id}>
                  {unit.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Category" required hint="The existing demo condition routes high_risk to the tenant Manager.">
            <Select value={startCategory} onChange={(event) => setStartCategory(event.target.value)} disabled={startPending}>
              <option value="normal">Normal — Site Reviewer</option>
              <option value="high_risk">High risk — tenant Manager</option>
            </Select>
          </Field>
        </div>
      </OverlayDialog>

      <OverlayDialog
        open={actionOpen}
        title={`${actionTitle} assignment`}
        description={`Confirm the existing '${actionCode}' transition. The server remains authoritative for permissions and valid transitions.`}
        pending={actionPending}
        onClose={() => setActionOpen(false)}
        footer={
          <>
            <Button variant="secondary" disabled={actionPending} onClick={() => setActionOpen(false)}>
              Cancel
            </Button>
            <Button disabled={actionPending} onClick={() => void handleAct()}>
              {actionPending ? "Saving…" : `Confirm ${actionCode}`}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          {actionError && (
            <div role="alert" className="rounded border border-red-200 bg-red-50 p-3 text-sm text-red-800">
              {actionError}
            </div>
          )}
          <Field label="Task" hint="The assignment this decision applies to.">
            <Input
              readOnly
              value={
                actionAssignment
                  ? actionAssignment.assignmentType === "role"
                    ? `Role: ${actionAssignment.assignedRoleCode ?? "Unavailable"}`
                    : "Assigned to you directly"
                  : ""
              }
            />
          </Field>
          <Field label="Comment" hint="Optional. Leave blank to send no comment.">
            <Input
              value={actionComment}
              onChange={(event) => setActionComment(event.target.value)}
              disabled={actionPending}
              placeholder="Add a comment"
            />
          </Field>
        </div>
      </OverlayDialog>

      <OverlayDialog
        open={claimTarget !== null}
        title={claimTarget?.releasing ? "Release claim" : "Claim task"}
        description={
          claimTarget?.releasing
            ? "Releases your reservation so any eligible teammate can claim or act on this task."
            : "Reserves this task for you for 15 minutes (ADR-0008). Acting does not require a claim."
        }
        pending={claimPending}
        onClose={() => setClaimTarget(null)}
        footer={
          <>
            <Button variant="secondary" disabled={claimPending} onClick={() => setClaimTarget(null)}>
              Cancel
            </Button>
            <Button disabled={claimPending} onClick={() => void handleClaimDecision()}>
              {claimPending ? "Saving…" : claimTarget?.releasing ? "Release claim" : "Claim task"}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          {claimError && (
            <div role="alert" className="rounded border border-red-200 bg-red-50 p-3 text-sm text-red-800">
              {claimError}
            </div>
          )}
          {claimTarget && (
            <p className="text-sm text-slate-600">
              Task:{" "}
              <strong>
                {claimTarget.assignment.assignmentType === "role"
                  ? `Role: ${claimTarget.assignment.assignedRoleCode ?? "Unavailable"}`
                  : "Assigned to you directly"}
              </strong>
            </p>
          )}
          <p className="text-sm text-slate-500">The server re-checks eligibility and claim ownership when you confirm.</p>
        </div>
      </OverlayDialog>

      <OverlayDialog
        open={historyOpen}
        title="Workflow history"
        description={selectedInstanceId ? `History for instance ${selectedInstanceId.slice(0, 8)}…` : undefined}
        pending={historyPending}
        onClose={() => setHistoryOpen(false)}
        footer={
          <Button variant="secondary" onClick={() => setHistoryOpen(false)}>
            Close
          </Button>
        }
      >
        {historyError ? (
          <div role="alert" className="rounded border border-red-200 bg-red-50 p-3 text-sm text-red-800">
            {historyError}
          </div>
        ) : historyPending ? (
          <p className="text-sm text-slate-500">Loading history…</p>
        ) : (
          <Timeline items={historyItems} />
        )}
      </OverlayDialog>

      <OverlayDialog
        open={sweepOpen}
        title="Run escalation sweep"
        description="This invokes the existing escalation endpoint and may reassign overdue work. Confirm only if you intend to run it."
        pending={sweepPending}
        onClose={() => setSweepOpen(false)}
        footer={
          <>
            <Button variant="secondary" disabled={sweepPending} onClick={() => setSweepOpen(false)}>
              Cancel
            </Button>
            <Button disabled={sweepPending} onClick={() => void handleEscalationSweep()}>
              {sweepPending ? "Running…" : "Confirm sweep"}
            </Button>
          </>
        }
      >
        {sweepError && (
          <div role="alert" className="rounded border border-red-200 bg-red-50 p-3 text-sm text-red-800">
            {sweepError}
          </div>
        )}
        <p className="text-sm text-slate-600">The server will apply its existing permission and overdue-assignment rules.</p>
      </OverlayDialog>
    </div>
  );
}
