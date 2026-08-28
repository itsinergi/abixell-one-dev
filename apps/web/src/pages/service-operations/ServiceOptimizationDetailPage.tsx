/** Wave A3 — Optimization proposal detail and explicit human decision. */
import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useAuth } from "../../auth/AuthContext";
import { api, ApiError, type OptimizationRun } from "../../lib/api";
import { PERMISSIONS } from "../../lib/capabilities";
import { useShell } from "../../shell/layout/AppShell";
import {
  Alert,
  Badge,
  Button,
  Card,
  DataTable,
  EmptyState,
  PageHeader,
  Spinner,
  StatusPill,
  type Column,
} from "../../shell/components/ui";
import { formatDate } from "../../shared/format";

function runTone(status: string): "neutral" | "info" | "success" | "warning" | "danger" {
  if (status === "applied") return "success";
  if (status === "proposed") return "info";
  return "neutral";
}

export function ServiceOptimizationDetailPage() {
  const { runId } = useParams<{ runId: string }>();
  const { session } = useAuth();
  const token = session!.accessToken;
  const { permissions } = useShell();
  const canApply = permissions.includes(PERMISSIONS.serviceOperationsOptimizationApply);

  const [run, setRun] = useState<OptimizationRun | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [confirmAction, setConfirmAction] = useState<"apply" | "dismiss" | null>(null);

  const load = useCallback(async () => {
    if (!runId) return;
    setLoading(true);
    setError(null);
    try {
      setRun(await api.optimizationRun(token, runId));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not load optimization run.");
    } finally {
      setLoading(false);
    }
  }, [runId, token]);

  useEffect(() => {
    void load();
  }, [load]);

  async function applyRun() {
    if (!run || !canApply) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const result = await api.applyOptimizationRun(token, run.id);
      setNotice(
        `${result.appliedCount} assignments applied; ${result.skippedCount} skipped because those work orders were already assigned.`,
      );
      setConfirmAction(null);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not apply this run.");
    } finally {
      setBusy(false);
    }
  }

  async function dismissRun() {
    if (!run || !canApply) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await api.dismissOptimizationRun(token, run.id);
      setNotice("Optimization run dismissed. No work-order assignments were changed.");
      setConfirmAction(null);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not dismiss this run.");
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <Spinner label="Loading optimization run…" />;
  if (!run) return <Alert tone="error">{error ?? "Optimization run not found."}</Alert>;

  const columns: Column<OptimizationRun["proposals"][number]>[] = [
    {
      header: "Work Order",
      cell: (row) => (
        <div>
          <Link
            to={`/work-orders/${row.workOrderId}`}
            className="font-semibold text-slate-900 underline hover:text-slate-700"
          >
            {row.workOrderNumber}
          </Link>
          <div className="text-xs text-slate-500">{row.title}</div>
        </div>
      ),
      mobileRole: "title",
    },
    {
      header: "Priority",
      cell: (row) => <Badge>{row.priority ?? "medium"}</Badge>,
      mobileRole: "status",
    },
    {
      header: "Recommended Assignee",
      cell: (row) => (
        <div>
          <span className="font-medium text-slate-800">{row.recommendedUserName}</span>
          <div className="font-mono text-[11px] text-slate-400">{row.recommendedUserId}</div>
        </div>
      ),
    },
    {
      header: "Est. Duration",
      cell: (row) => `${row.estimatedMinutes} min`,
    },
    {
      header: "Recommendation Rationale",
      cell: (row) => (
        <p className="max-w-xl whitespace-normal text-xs leading-5 text-slate-600">
          {row.rationale}
        </p>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      <PageHeader
        title={`${run.runNumber} — Assignment Proposals`}
        subtitle={`Target date ${run.targetDate}. This run is advisory until a human explicitly applies it.`}
        actions={
          <StatusPill tone={runTone(run.status)}>{run.status.toUpperCase()}</StatusPill>
        }
      />

      {error ? <Alert tone="error">{error}</Alert> : null}
      {notice ? <Alert tone="success">{notice}</Alert> : null}

      <Card>
        <div className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2 lg:grid-cols-5">
          <div>
            <div className="text-xs font-medium uppercase tracking-wide text-slate-400">Target date</div>
            <div className="mt-1 font-semibold text-slate-900">{run.targetDate}</div>
          </div>
          <div>
            <div className="text-xs font-medium uppercase tracking-wide text-slate-400">Proposals</div>
            <div className="mt-1 font-semibold text-slate-900">{run.proposals.length}</div>
          </div>
          <div>
            <div className="text-xs font-medium uppercase tracking-wide text-slate-400">Max per worker</div>
            <div className="mt-1 font-semibold text-slate-900">
              {run.parameters.maxWorkOrdersPerWorker ?? "Default"}
            </div>
          </div>
          <div>
            <div className="text-xs font-medium uppercase tracking-wide text-slate-400">Generated</div>
            <div className="mt-1 text-slate-900">{formatDate(run.createdAt)}</div>
          </div>
          <div>
            <div className="text-xs font-medium uppercase tracking-wide text-slate-400">Organization unit</div>
            <div className="mt-1 break-all font-mono text-xs text-slate-700">
              {run.organizationUnitId ?? "Tenant-wide"}
            </div>
          </div>
        </div>
      </Card>

      <Card>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-slate-800">Explainable Assignment Proposals</h2>
            <p className="text-xs text-slate-500">
              Each recommendation identifies its selected worker and capacity-leveling rationale.
            </p>
          </div>
          <Badge>{run.proposals.length} proposals</Badge>
        </div>
        <DataTable
          columns={columns}
          rows={run.proposals}
          keyOf={(row) => row.workOrderId}
          mobileBreakpoint="md"
          empty={
            <EmptyState
              title="No assignment proposals"
              description="No eligible unassigned work orders matched this run's date and scope."
            />
          }
        />
      </Card>

      {run.status === "proposed" ? (
        <Card className="border-slate-300">
          <h2 className="text-sm font-semibold text-slate-900">Human Decision Required</h2>
          <p className="mt-1 text-sm text-slate-600">
            Applying assigns eligible, still-unassigned work orders. If any order was assigned since this run
            was generated, the backend skips it safely. Dismissing changes no work orders.
          </p>

          {!canApply ? (
            <Alert tone="info">
              You can inspect these proposals, but applying or dismissing requires permission{" "}
              <code className="font-mono text-xs">service_operations.optimization.apply</code>.
            </Alert>
          ) : confirmAction === null ? (
            <div className="mt-4 flex flex-wrap gap-2">
              <Button disabled={busy} onClick={() => setConfirmAction("apply")}>
                Review and Apply Proposals
              </Button>
              <Button
                variant="secondary"
                disabled={busy}
                onClick={() => setConfirmAction("dismiss")}
              >
                Dismiss Run
              </Button>
            </div>
          ) : (
            <div className="mt-4 rounded-md border border-amber-200 bg-amber-50 p-4">
              <h3 className="text-sm font-semibold text-amber-900">
                {confirmAction === "apply"
                  ? `Apply ${run.proposals.length} assignment proposals?`
                  : "Dismiss this optimization run?"}
              </h3>
              <p className="mt-1 text-xs text-amber-800">
                {confirmAction === "apply"
                  ? "This is the explicit human confirmation step. Work orders that remain unassigned will be assigned to the recommended workers."
                  : "The run will be retained in history as dismissed and no assignments will change."}
              </p>
              <div className="mt-3 flex gap-2">
                <Button
                  disabled={busy}
                  onClick={() => void (confirmAction === "apply" ? applyRun() : dismissRun())}
                >
                  {busy
                    ? "Processing…"
                    : confirmAction === "apply"
                      ? "Confirm and Apply"
                      : "Confirm Dismissal"}
                </Button>
                <Button variant="ghost" disabled={busy} onClick={() => setConfirmAction(null)}>
                  Cancel
                </Button>
              </div>
            </div>
          )}
        </Card>
      ) : (
        <Alert tone={run.status === "applied" ? "success" : "info"}>
          This run was {run.status}
          {run.appliedAt ? ` on ${formatDate(run.appliedAt)}` : ""}. Its proposals remain available as an
          audit record.
        </Alert>
      )}
    </div>
  );
}
