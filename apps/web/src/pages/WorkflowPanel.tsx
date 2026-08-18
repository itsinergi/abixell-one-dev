import { useCallback, useEffect, useState } from "react";
import { api, ApiError, type WorkflowAssignment, type WorkflowInstance } from "../lib/api";

/**
 * Checkpoint 0D — Workflow & Approval Engine panel.
 *
 * Demonstrates the generic engine end-to-end against a dummy transaction
 * only: start an instance, see the "My Tasks" queue for the signed-in
 * user (role+scope OR specific-user routing), act on a task (Approve /
 * Reject / Return / Resubmit — whatever the current Step's Transitions
 * allow), inspect the full History of one instance, and trigger the
 * Escalation sweep. No Complaint/Survey/Procurement business logic here
 * by design — this proves the engine, not a business module.
 */

type OrgUnitOption = { id: string; name: string };

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
  const [selectedInstanceId, setSelectedInstanceId] = useState<string>("");
  const [history, setHistory] = useState<
    Array<{ actionCode: string; occurredAt: string; comment: string | null }>
  >([]);
  const [startOrgUnitId, setStartOrgUnitId] = useState("");
  const [startCategory, setStartCategory] = useState("normal");

  const refresh = useCallback(async () => {
    try {
      const [instanceList, mine] = await Promise.all([
        api.workflowInstances(token),
        api.myWorkflowAssignments(token).catch(() => [] as WorkflowAssignment[]),
      ]);
      setInstances(instanceList);
      setMyAssignments(mine);
    } catch (err) {
      onMessage({ type: "error", text: err instanceof ApiError ? err.message : "Failed to load Workflow data" });
    }
  }, [token, onMessage]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    if (orgUnits.length > 0 && !startOrgUnitId) setStartOrgUnitId(orgUnits[0].id);
  }, [orgUnits, startOrgUnitId]);

  useEffect(() => {
    if (!selectedInstanceId) {
      setHistory([]);
      return;
    }
    api
      .workflowInstanceHistory(token, selectedInstanceId)
      .then(setHistory)
      .catch(() => setHistory([]));
  }, [token, selectedInstanceId]);

  async function handleStartInstance() {
    try {
      const tx = await api.createDemoTransaction(token, `Demo transaction ${new Date().toISOString()}`);
      const result = await api.startWorkflowInstance(token, {
        definitionCode: "demo_approval_workflow",
        entityId: tx.id,
        contextData: { organizationUnitId: startOrgUnitId, category: startCategory },
      });
      onMessage({
        type: "success",
        text: `Workflow Instance started (category: ${startCategory}) — routed to ${
          result.assignment.assignmentType === "role"
            ? `role '${result.assignment.assignedRoleCode}'`
            : "the submitting user"
        }.`,
      });
      setSelectedInstanceId(result.instance.id);
      refresh();
    } catch (err) {
      onMessage({ type: "error", text: err instanceof ApiError ? err.message : "Failed" });
    }
  }

  async function handleAct(assignmentId: string, actionCode: string) {
    try {
      const result = await api.actOnWorkflowAssignment(token, assignmentId, {
        actionCode,
        comment: `${actionCode} via Dashboard`,
      });
      onMessage({
        type: "success",
        text: `Action '${actionCode}' recorded — Instance status is now '${result.instance.status}'.`,
      });
      refresh();
    } catch (err) {
      onMessage({ type: "error", text: err instanceof ApiError ? err.message : "Failed" });
    }
  }

  async function handleEscalationSweep() {
    try {
      const result = await api.triggerWorkflowEscalationSweep(token);
      onMessage({
        type: "success",
        text: `Escalation sweep complete — ${result.escalatedCount} overdue Assignment(s) reassigned.`,
      });
      refresh();
    } catch (err) {
      onMessage({ type: "error", text: err instanceof ApiError ? err.message : "Failed" });
    }
  }

  async function handleClaim(assignmentId: string) {
    try {
      await api.claimWorkflowAssignment(token, assignmentId);
      onMessage({ type: "success", text: "Task claimed — reserved for you for 15 minutes (ADR-0008)." });
      refresh();
    } catch (err) {
      onMessage({ type: "error", text: err instanceof ApiError ? err.message : "Failed" });
    }
  }

  async function handleReleaseClaim(assignmentId: string) {
    try {
      await api.releaseWorkflowAssignmentClaim(token, assignmentId);
      onMessage({ type: "success", text: "Claim released — any eligible teammate can now claim/act on it." });
      refresh();
    } catch (err) {
      onMessage({ type: "error", text: err instanceof ApiError ? err.message : "Failed" });
    }
  }

  return (
    <div className="space-y-6">
      <h2 className="text-sm font-semibold text-slate-500">Workflow &amp; Approval Engine (Checkpoint 0D)</h2>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Start a new instance */}
        {canStart && (
          <section className="rounded border border-slate-200 bg-white p-4">
            <h3 className="mb-2 text-sm font-semibold">Start a Workflow Instance</h3>
            <p className="mb-2 text-xs text-slate-500">
              Creates a generic dummy transaction and starts{" "}
              <span className="font-mono">demo_approval_workflow</span> against it — proves the engine, not a
              business module.
            </p>
            <select
              value={startOrgUnitId}
              onChange={(e) => setStartOrgUnitId(e.target.value)}
              className="mb-2 w-full rounded border border-slate-300 px-2 py-1 text-sm"
            >
              {orgUnits.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
            </select>
            <select
              value={startCategory}
              onChange={(e) => setStartCategory(e.target.value)}
              className="mb-2 w-full rounded border border-slate-300 px-2 py-1 text-sm"
            >
              <option value="normal">category: normal (routes to Site Reviewer)</option>
              <option value="high_risk">category: high_risk (Condition routes to tenant Manager)</option>
            </select>
            <button onClick={handleStartInstance} className="rounded bg-slate-900 px-3 py-1 text-sm text-white">
              Start Instance
            </button>
          </section>
        )}

        {/* My tasks */}
        <section className="rounded border border-slate-200 bg-white p-4">
          <h3 className="mb-2 text-sm font-semibold">My Tasks (pending Assignments)</h3>
          <ul className="space-y-2 text-sm text-slate-700">
            {myAssignments.length === 0 && <li className="text-xs text-slate-400">Nothing pending.</li>}
            {myAssignments.map((a) => (
              <li key={a.id} className="border-b border-slate-100 pb-2">
                <div className="text-xs text-slate-500">
                  {a.assignmentType === "role" ? `Role: ${a.assignedRoleCode}` : "Assigned to you directly"}
                  {a.dueAt && <> — due {new Date(a.dueAt).toLocaleString()}</>}
                  {a.claimedByUserId && <span className="ml-1 rounded bg-indigo-100 px-1 text-indigo-700">claimed</span>}
                </div>
                {canAct && (
                  <div className="mt-1 flex flex-wrap gap-2">
                    <button
                      onClick={() => handleAct(a.id, "approve")}
                      className="rounded bg-green-100 px-2 py-0.5 text-xs text-green-700"
                    >
                      Approve
                    </button>
                    <button
                      onClick={() => handleAct(a.id, "reject")}
                      className="rounded bg-red-100 px-2 py-0.5 text-xs text-red-700"
                    >
                      Reject
                    </button>
                    <button
                      onClick={() => handleAct(a.id, "return")}
                      className="rounded bg-amber-100 px-2 py-0.5 text-xs text-amber-700"
                    >
                      Return
                    </button>
                    <button
                      onClick={() => handleAct(a.id, "resubmit")}
                      className="rounded bg-slate-100 px-2 py-0.5 text-xs text-slate-700"
                    >
                      Resubmit
                    </button>
                    {a.claimedByUserId ? (
                      <button
                        onClick={() => handleReleaseClaim(a.id)}
                        className="rounded bg-indigo-100 px-2 py-0.5 text-xs text-indigo-700"
                      >
                        Release claim
                      </button>
                    ) : (
                      <button
                        onClick={() => handleClaim(a.id)}
                        className="rounded bg-indigo-100 px-2 py-0.5 text-xs text-indigo-700"
                      >
                        Claim (ADR-0008)
                      </button>
                    )}
                  </div>
                )}
              </li>
            ))}
          </ul>
        </section>

        {/* Instances + history */}
        <section className="rounded border border-slate-200 bg-white p-4 lg:col-span-2">
          <h3 className="mb-2 text-sm font-semibold">Workflow Instances</h3>
          <table className="mb-3 w-full text-left text-xs text-slate-700">
            <thead>
              <tr className="text-slate-400">
                <th className="pb-1">Entity</th>
                <th className="pb-1">Status</th>
                <th className="pb-1">Started</th>
                <th className="pb-1"></th>
              </tr>
            </thead>
            <tbody>
              {instances.map((i) => (
                <tr key={i.id} className="border-t border-slate-100">
                  <td className="py-1 font-mono">{i.entityId.slice(0, 8)}…</td>
                  <td className="py-1">{i.status}</td>
                  <td className="py-1">{new Date(i.startedAt).toLocaleString()}</td>
                  <td className="py-1">
                    <button
                      onClick={() => setSelectedInstanceId(i.id)}
                      className="text-xs text-slate-500 underline"
                    >
                      View History
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {selectedInstanceId && (
            <div className="border-t border-slate-100 pt-2">
              <div className="mb-1 text-xs font-medium text-slate-500">
                History for {selectedInstanceId.slice(0, 8)}…
              </div>
              <ul className="space-y-1 text-xs text-slate-600">
                {history.map((h, idx) => (
                  <li key={idx}>
                    <span className="font-mono">{new Date(h.occurredAt).toLocaleString()}</span> —{" "}
                    <span className="font-medium">{h.actionCode}</span>
                    {h.comment ? ` (${h.comment})` : ""}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>

        {/* Escalation sweep */}
        {canManage && (
          <section className="rounded border border-slate-200 bg-white p-4 lg:col-span-2">
            <h3 className="mb-2 text-sm font-semibold">Escalation Sweep</h3>
            <p className="mb-2 text-xs text-slate-500">
              This sweep now also runs automatically every 2 minutes via the Scheduler (Checkpoint 0E) — see
              the Shared Services panel below for job run history. This button triggers the exact same sweep
              on demand.
            </p>
            <button onClick={handleEscalationSweep} className="rounded bg-slate-900 px-3 py-1 text-sm text-white">
              Run Escalation Sweep
            </button>
          </section>
        )}
      </div>
    </div>
  );
}
