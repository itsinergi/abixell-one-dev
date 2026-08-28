/**
 * Wave A3 — Route, Roster & Workload Optimization (SO-ADV-002…005).
 *
 * Provides capacity analysis, explainable assignment proposals, and explicit
 * human-action apply / dismiss workflow. Generated runs are always advisory
 * until explicitly applied.
 */
import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../../auth/AuthContext";
import {
  api,
  ApiError,
  type ApplyOptimizationResponse,
  type OptimizationRun,
  type OptimizationRunStatus,
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
  type Column,
} from "../../shell/components/ui";
import { formatDate } from "../../shared/format";

function optimizationStatusTone(
  status: OptimizationRunStatus,
): "neutral" | "info" | "success" | "warning" | "danger" {
  switch (status) {
    case "applied":
      return "success";
    case "dismissed":
      return "neutral";
    case "proposed":
      return "info";
    default:
      return "neutral";
  }
}

export function ServiceOptimizationPage() {
  const { session } = useAuth();
  const token = session!.accessToken;
  const { permissions } = useShell();
  const navigate = useNavigate();

  const canApply = permissions.includes(PERMISSIONS.serviceOperationsOptimizationApply);

  const [runs, setRuns] = useState<OptimizationRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // Form state
  const [targetDate, setTargetDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [maxOrders, setMaxOrders] = useState("8");
  const [maxMinutes, setMaxMinutes] = useState("480");
  const [prioritizeSla, setPrioritizeSla] = useState(true);
  const [groupDistanceNear, setGroupDistanceNear] = useState(false);
  const [orgUnits, setOrgUnits] = useState<{ id: string; name: string }[]>([]);
  const [selectedOrgUnit, setSelectedOrgUnit] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [list, unitList] = await Promise.all([
        api.optimizationRuns(token, 50),
        api.organizationUnits(token).catch(() => [] as { id: string; name: string }[]),
      ]);
      setRuns(list);
      setOrgUnits(unitList);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not load optimization runs.");
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  async function handleGenerate() {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const generated = await api.generateOptimizationRun(token, {
        targetDate,
        organizationUnitId: selectedOrgUnit || null,
        parameters: {
          maxWorkOrdersPerWorker: maxOrders ? Number(maxOrders) : undefined,
          maxMinutesPerWorker: maxMinutes ? Number(maxMinutes) : undefined,
          prioritizeSla,
          groupDistanceNear,
        },
      });
      setNotice(
        `Optimization run ${generated.runNumber} generated with ${generated.proposals.length} proposed assignments.`,
      );
      await load();
      navigate(`/service-optimization/${generated.id}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not generate optimization run.");
    } finally {
      setBusy(false);
    }
  }

  async function handleApply(runId: string) {
    if (!canApply) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res: ApplyOptimizationResponse = await api.applyOptimizationRun(token, runId);
      setNotice(
        `Optimization applied: ${res.appliedCount} work orders assigned (${res.skippedCount} skipped / already assigned).`,
      );
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not apply optimization proposals.");
    } finally {
      setBusy(false);
    }
  }

  async function handleDismiss(runId: string) {
    if (!canApply) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const dismissed = await api.dismissOptimizationRun(token, runId);
      setNotice(`Optimization run ${dismissed.runNumber} dismissed.`);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not dismiss optimization run.");
    } finally {
      setBusy(false);
    }
  }

  const columns: Column<OptimizationRun>[] = [
    {
      header: "Run Number",
      cell: (row) => (
        <Link
          to={`/service-optimization/${row.id}`}
          className="font-semibold text-slate-900 underline hover:text-slate-700"
        >
          {row.runNumber}
        </Link>
      ),
      mobileRole: "title",
    },
    {
      header: "Target Date",
      cell: (row) => row.targetDate,
    },
    {
      header: "Proposals",
      cell: (row) => <Badge>{row.proposals.length} orders</Badge>,
    },
    {
      header: "Status",
      cell: (row) => (
        <StatusPill tone={optimizationStatusTone(row.status)}>
          {row.status.toUpperCase()}
        </StatusPill>
      ),
      mobileRole: "status",
    },
    {
      header: "Created",
      cell: (row) => formatDate(row.createdAt),
    },
    {
      header: "Actions",
      cell: (row) => (
        <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
          <Button
            variant="ghost"
            onClick={() => navigate(`/service-optimization/${row.id}`)}
          >
            Inspect
          </Button>
          {row.status === "proposed" && canApply ? (
            <>
              <Button
                variant="primary"
                disabled={busy}
                onClick={() => void handleApply(row.id)}
              >
                Apply
              </Button>
              <Button
                variant="secondary"
                disabled={busy}
                onClick={() => void handleDismiss(row.id)}
              >
                Dismiss
              </Button>
            </>
          ) : null}
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      <PageHeader
        title="Service Operations Optimization"
        subtitle="Advisory dispatch and workload optimization runs (SO-ADV-002…005). Inspect proposed rationales and apply with explicit human confirmation."
      />

      {error ? <Alert tone="error">{error}</Alert> : null}
      {notice ? <Alert tone="success">{notice}</Alert> : null}

      <Card>
        <h2 className="mb-3 text-sm font-semibold text-slate-800">
          Generate Advisory Optimization Run
        </h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Target Schedule Date" required>
            <Input
              type="date"
              value={targetDate}
              onChange={(e) => setTargetDate(e.target.value)}
            />
          </Field>
          <Field label="Organization Unit">
            <Select
              value={selectedOrgUnit}
              onChange={(e) => setSelectedOrgUnit(e.target.value)}
            >
              <option value="">Tenant-wide (All units)</option>
              {orgUnits.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Max Orders per Worker">
            <Input
              type="number"
              min="1"
              max="50"
              value={maxOrders}
              onChange={(e) => setMaxOrders(e.target.value)}
            />
          </Field>
          <Field label="Max Minutes per Worker">
            <Input
              type="number"
              min="30"
              max="1440"
              value={maxMinutes}
              onChange={(e) => setMaxMinutes(e.target.value)}
            />
          </Field>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-4">
          <label className="flex items-center gap-2 text-xs text-slate-700">
            <input
              type="checkbox"
              className="h-4 w-4 rounded border-slate-300"
              checked={prioritizeSla}
              onChange={(e) => setPrioritizeSla(e.target.checked)}
            />
            Prioritize earlier SLA due dates
          </label>
          <label className="flex items-center gap-2 text-xs text-slate-700">
            <input
              type="checkbox"
              className="h-4 w-4 rounded border-slate-300"
              checked={groupDistanceNear}
              onChange={(e) => setGroupDistanceNear(e.target.checked)}
            />
            Cluster assignments by site location
          </label>
        </div>

        <div className="mt-4">
          <Button disabled={busy || !targetDate} onClick={() => void handleGenerate()}>
            {busy ? "Analyzing workload…" : "Generate Optimization Run"}
          </Button>
        </div>
      </Card>

      <Card>
        <h2 className="mb-3 text-sm font-semibold text-slate-800">Recent Optimization Runs</h2>
        {loading ? (
          <Spinner label="Loading optimization history…" />
        ) : (
          <DataTable
            columns={columns}
            rows={runs}
            keyOf={(row) => row.id}
            onRowClick={(row) => navigate(`/service-optimization/${row.id}`)}
            empty={
              <EmptyState
                title="No optimization runs recorded"
                description="Generate an optimization run above to analyze pending work orders and produce explainable assignment proposals."
              />
            }
          />
        )}
      </Card>
    </div>
  );
}
