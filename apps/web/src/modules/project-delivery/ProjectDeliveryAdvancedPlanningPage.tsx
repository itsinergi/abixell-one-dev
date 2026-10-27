/**
 * Project Delivery Advanced — Planning page.
 *
 * WBS hierarchy with rolled-up cost; dependencies and critical path;
 * resource loading and levelling; baselines and variance analysis.
 *
 * Money fields are exact-decimal strings, never JS numbers (ADR-0026).
 */

import { useCallback, useEffect, useState } from "react";
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
import { formatDate, formatDateShort, formatMoney } from "../../shared/format";
import { useAuth } from "../../auth/AuthContext";
import {
  ApiError,
  api,
  type BaselineVarianceResult,
  type ProjectBaseline,
  type ProjectResource,
  type ProjectSchedule,
  type ProjectWbsNodeView,
  type ResourceLoadingResult,
} from "../../lib/api";

interface WbsDraft {
  code?: string;
  name?: string;
  description?: string | null;
}

interface ModalState {
  kind: "none" | "create-wbs" | "create-baseline";
  data?: WbsDraft;
}

const BASELINE_STATUS_TONE: Record<string, "neutral" | "info" | "success" | "warning" | "danger"> = {
  draft: "info",
  approved: "success",
  superseded: "warning",
};

const BASELINE_STATUS_LABEL: Record<string, string> = {
  draft: "Draft",
  approved: "Approved",
  superseded: "Superseded",
};

export function ProjectDeliveryAdvancedPlanningPage() {
  const { session } = useAuth();
  const token = session?.accessToken ?? "";

  // Projects list
  const [projects, setProjects] = useState<Array<{ id: string; name: string }>>([]);
  const [projectId, setProjectId] = useState<string>("");

  // WBS state
  const [wbsNodes, setWbsNodes] = useState<ProjectWbsNodeView[]>([]);

  // Schedule and critical path
  const [schedule, setSchedule] = useState<ProjectSchedule | null>(null);

  // Resources
  const [resources, setResources] = useState<ProjectResource[]>([]);
  const [loadingResult, setLoadingResult] = useState<ResourceLoadingResult | null>(null);

  // Baselines
  const [baselines, setBaselines] = useState<ProjectBaseline[]>([]);
  const [variance, setVariance] = useState<BaselineVarianceResult | null>(null);

  // UI state
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [modal, setModal] = useState<ModalState>({ kind: "none" });
  const [asOfDate, setAsOfDate] = useState<string>(new Date().toISOString().split("T")[0]); // YYYY-MM-DD

  // Load projects on mount
  useEffect(() => {
    const loadProjects = async () => {
      try {
        const resp = await api.projectDeliveryProjects(token);
        setProjects((resp || []).map(s => s.project));
      } catch {
        // Silent: an empty dropdown is the visible state, and the Load button
        // stays disabled until a project is chosen.
      }
    };
    if (token) loadProjects();
  }, [token]);

  const load = useCallback(async () => {
    if (!projectId) return;
    setLoading(true);
    setError(null);
    try {
      const [wbsResp, schedResp, resourcesResp, loadingResp, baselinesResp, varianceResp] = await Promise.all([
        api.projectDeliveryWbs(token, projectId),
        api.projectDeliverySchedule(token, projectId),
        api.projectDeliveryResources(token),
        api.projectDeliveryResourceLoading(token, projectId, asOfDate, asOfDate),
        api.projectDeliveryBaselines(token, projectId),
        api.projectDeliveryBaselineVariance(token, projectId, asOfDate),
      ]);

      setWbsNodes(wbsResp || []);
      setSchedule(schedResp || null);
      setResources(resourcesResp || []);
      setLoadingResult(loadingResp || null);
      setBaselines(baselinesResp || []);
      setVariance(varianceResp || null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to load planning data.");
    } finally {
      setLoading(false);
    }
  }, [projectId, token, asOfDate]);

  const createWbs = async () => {
    setBusy(true);
    setError(null);
    try {
      const body = modal.data ?? {};
      await api.createProjectDeliveryWbs(token, projectId, {
        code: body.code ?? "",
        name: body.name ?? "",
        description: body.description ?? null,
      });
      setNotice("WBS node created.");
      setModal({ kind: "none" });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to create WBS node.");
    } finally {
      setBusy(false);
    }
  };

  const createBaseline = async () => {
    setBusy(true);
    setError(null);
    try {
      const body = modal.data ?? {};
      await api.createProjectDeliveryBaseline(token, projectId, {
        code: body.code ?? "",
        description: body.description ?? null,
      });
      setNotice("Baseline created.");
      setModal({ kind: "none" });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to create baseline.");
    } finally {
      setBusy(false);
    }
  };

  const approveBaseline = async (baselineId: string) => {
    setBusy(true);
    setError(null);
    try {
      await api.approveProjectDeliveryBaseline(token, baselineId);
      setNotice("Baseline approved.");
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to approve baseline.");
    } finally {
      setBusy(false);
    }
  };

  const wbsColumns: Column<ProjectWbsNodeView>[] = [
    {
      header: "Code",
      cell: (row) => <span className="font-mono text-sm">{row.code}</span>,
    },
    {
      header: "Name",
      cell: (row) => (
        <span style={{ paddingLeft: `${Math.max(0, row.depth) * 16}px` }}>{row.name}</span>
      ),
    },
    {
      header: "Rolled-up Cost",
      className: "tabular-nums text-right",
      cell: (row) => <span>{formatMoney(row.rolledUpCost)}</span>,
    },
    {
      header: "Activities",
      className: "text-right",
      cell: (row) => <span>{row.activityCount}</span>,
    },
  ];

  const scheduleColumns: Column<ProjectSchedule["activities"][number]>[] = [
    {
      header: "Activity",
      cell: (row) => <span className="font-mono text-sm">{row.code}</span>,
    },
    {
      header: "Planned Start",
      cell: (row) => <span>{row.plannedStart ? formatDateShort(row.plannedStart) : "—"}</span>,
    },
    {
      header: "Planned Finish",
      cell: (row) => <span>{row.plannedFinish ? formatDateShort(row.plannedFinish) : "—"}</span>,
    },
    {
      header: "Critical Path",
      cell: (row) =>
        row.isCritical ? (
          <StatusPill tone="warning">Critical</StatusPill>
        ) : (
          <StatusPill tone="info">Non-critical</StatusPill>
        ),
    },
  ];

  const resourceColumns: Column<ProjectResource>[] = [
    {
      header: "Resource",
      cell: (row) => <span className="font-mono text-sm">{row.code}</span>,
    },
    {
      header: "Name",
      cell: (row) => <span>{row.name}</span>,
    },
    {
      header: "Type",
      cell: (row) => <Badge>{row.type}</Badge>,
    },
  ];

  const baselineColumns: Column<ProjectBaseline>[] = [
    {
      header: "Baseline",
      cell: (row) => <span className="font-mono text-sm">{row.code}</span>,
    },
    {
      header: "Status",
      cell: (row) => (
        <StatusPill tone={BASELINE_STATUS_TONE[row.status] ?? "neutral"}>
          {BASELINE_STATUS_LABEL[row.status] || row.status}
        </StatusPill>
      ),
    },
    {
      header: "Approved",
      cell: (row) =>
        row.approvedAt ? (
          formatDate(row.approvedAt)
        ) : (
          <span className="text-ink-dim">—</span>
        ),
    },
    {
      header: "Actions",
      mobileRole: "status",
      cell: (row) =>
        row.status === "draft" ? (
          <Button
            variant="secondary"
            disabled={busy}
            onClick={() => approveBaseline(row.id)}
          >
            Approve
          </Button>
        ) : null,
    },
  ];

  const varianceColumns: Column<BaselineVarianceResult["activities"][number]>[] = [
    { header: "Activity", cell: (row) => <span className="font-mono">{row.code}</span> },
    { header: "Planned", className: "tabular-nums", cell: (row) => <span>{formatMoney(row.plannedCost)}</span> },
    { header: "Actual", className: "tabular-nums", cell: (row) => <span>{formatMoney(row.actualCost)}</span> },
    { header: "Variance", className: "tabular-nums", cell: (row) => <span>{formatMoney(row.variance)}</span> },
  ];

  return (
    <div className="space-y-4">
      <PageHeader title="Planning" subtitle="WBS, schedule, resources, baselines, and variance." />

      {error && <Alert tone="error">{error}</Alert>}
      {notice && <Alert tone="success">{notice}</Alert>}

      <Card>
        <h2 className="mb-3 text-sm font-semibold text-ink">Select Project</h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Field label="Project" required>
            <Select value={projectId} onChange={(e) => setProjectId(e.target.value)}>
              <option value="">Select a project</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="As Of Date" required>
            <Input
              type="date"
              value={asOfDate}
              onChange={(e) => setAsOfDate(e.target.value)}
            />
          </Field>
          <div className="flex items-end gap-2">
            <Button onClick={() => load()} disabled={!projectId || loading}>
              {loading ? <Spinner /> : "Load"}
            </Button>
          </div>
        </div>
      </Card>

      {!projectId ? (
        <EmptyState title="No project selected" description="Pick a project to see planning data." />
      ) : loading ? (
        <div className="flex items-center justify-center p-8">
          <Spinner />
        </div>
      ) : (
        <div className="space-y-6">
          {/* WBS */}
          <div>
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-ink">Work Breakdown Structure</h2>
              <Button
                variant="secondary"
                disabled={busy}
                onClick={() => setModal({ kind: "create-wbs" })}
              >
                + WBS Node
              </Button>
            </div>
            <DataTable
              columns={wbsColumns}
              rows={wbsNodes}
              keyOf={(row) => row.id}
              empty={<EmptyState title="No WBS nodes" description="Create the first WBS node." />}
            />
          </div>

          {/* Schedule & Critical Path */}
          {schedule ? (
            <div>
              <div className="mb-3 flex items-center justify-between">
                <h2 className="text-sm font-semibold text-ink">Schedule & Critical Path</h2>
                <span className="text-sm text-ink-dim">
                  Project finish: {schedule.projectFinish ? formatDateShort(schedule.projectFinish) : "—"}
                </span>
              </div>
              <DataTable
                columns={scheduleColumns}
                rows={schedule.activities || []}
                keyOf={(row) => row.activityId}
                empty={<EmptyState title="No scheduled activities" description="Create dependencies to generate a schedule." />}
              />
            </div>
          ) : null}

          {/* Resources */}
          <div>
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-ink">Resources</h2>
            </div>
            <DataTable
              columns={resourceColumns}
              rows={resources}
              keyOf={(row) => row.id}
              empty={<EmptyState title="No resources" description="Define resources for the project." />}
            />
            {loadingResult && loadingResult.overallocations.length > 0 ? (
              <Alert tone="warning">
                {`Resource overallocations detected: ${loadingResult.overallocations.length} period(s) over-allocated. Levelling ${loadingResult.isLevellable ? "is available." : "is not possible with current constraints."}`}
              </Alert>
            ) : null}
          </div>

          {/* Baselines */}
          <div>
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-ink">Baselines</h2>
              <Button
                variant="secondary"
                disabled={busy}
                onClick={() => setModal({ kind: "create-baseline" })}
              >
                + Baseline
              </Button>
            </div>
            <DataTable
              columns={baselineColumns}
              rows={baselines}
              keyOf={(row) => row.id}
              empty={<EmptyState title="No baselines" description="Create the first baseline." />}
            />
          </div>

          {/* Variance */}
          {variance ? (
            <div>
              <h2 className="mb-3 text-sm font-semibold text-ink">Baseline Variance</h2>
              <DataTable
                columns={varianceColumns}
                rows={variance.activities || []}
                keyOf={(row) => row.activityId}
                empty={<EmptyState title="No variance data" description="No activities with cost recorded." />}
              />
            </div>
          ) : null}
        </div>
      )}

      {/* Modals */}
      {modal.kind === "create-wbs" ? (
        <Card>
          <h2 className="mb-3 text-sm font-semibold text-ink">Create WBS Node</h2>
          <div className="space-y-3">
            <Field label="Code" required>
              <Input
                placeholder="WBS-001"
                onChange={(e) => setModal({ ...modal, data: { ...modal.data, code: e.target.value } })}
              />
            </Field>
            <Field label="Name" required>
              <Input
                placeholder="Node name"
                onChange={(e) => setModal({ ...modal, data: { ...modal.data, name: e.target.value } })}
              />
            </Field>
            <Field label="Description">
              <Textarea
                rows={2}
                placeholder="Optional description"
                onChange={(e) => setModal({ ...modal, data: { ...modal.data, description: e.target.value || null } })}
              />
            </Field>
          </div>
          <div className="mt-3 flex gap-2">
            <Button disabled={busy} onClick={() => createWbs()}>
              Create
            </Button>
            <Button variant="ghost" disabled={busy} onClick={() => setModal({ kind: "none" })}>
              Cancel
            </Button>
          </div>
        </Card>
      ) : null}

      {modal.kind === "create-baseline" ? (
        <Card>
          <h2 className="mb-3 text-sm font-semibold text-ink">Create Baseline</h2>
          <div className="space-y-3">
            <Field label="Code" required>
              <Input
                placeholder="BL-001"
                onChange={(e) => setModal({ ...modal, data: { ...modal.data, code: e.target.value } })}
              />
            </Field>
            <Field label="Description">
              <Textarea
                rows={2}
                placeholder="Optional description"
                onChange={(e) => setModal({ ...modal, data: { ...modal.data, description: e.target.value || null } })}
              />
            </Field>
          </div>
          <div className="mt-3 flex gap-2">
            <Button disabled={busy} onClick={() => createBaseline()}>
              Create
            </Button>
            <Button variant="ghost" disabled={busy} onClick={() => setModal({ kind: "none" })}>
              Cancel
            </Button>
          </div>
        </Card>
      ) : null}
    </div>
  );
}
