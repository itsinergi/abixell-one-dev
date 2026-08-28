/** Wave A3 — Asset maintenance work-order detail/actions/parts. */
import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useAuth } from "../../auth/AuthContext";
import {
  api,
  ApiError,
  type AssetMaintenanceWorkOrderDetail,
  type Employee,
  type ScmItem,
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
  Timeline,
  type Column,
} from "../../shell/components/ui";
import { formatDate, formatDateShort, statusTone } from "../../shared/format";

function label(value: string | null | undefined): string {
  return value ? value.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase()) : "—";
}

export function AssetMaintenanceWorkOrderDetailPage() {
  const { workOrderId } = useParams<{ workOrderId: string }>();
  const { session } = useAuth();
  const token = session!.accessToken;
  const { permissions } = useShell();

  const canManage = permissions.includes(PERMISSIONS.assetMaintenanceManage);

  const [detail, setDetail] = useState<AssetMaintenanceWorkOrderDetail | null>(null);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [items, setItems] = useState<ScmItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [assignedToUserId, setAssignedToUserId] = useState("");
  const [completionNotes, setCompletionNotes] = useState("");
  const [actualCost, setActualCost] = useState("");
  const [downtimeHours, setDowntimeHours] = useState("");
  const [currentMeterReading, setCurrentMeterReading] = useState("");
  const [verificationNotes, setVerificationNotes] = useState("");
  const [workflowComment, setWorkflowComment] = useState("");
  const [partItemId, setPartItemId] = useState("");
  const [partQuantity, setPartQuantity] = useState("1");
  const [partUnitCost, setPartUnitCost] = useState("");
  const [partNotes, setPartNotes] = useState("");

  const load = useCallback(async () => {
    if (!workOrderId) return;
    setLoading(true);
    setError(null);
    try {
      const [record, employeeList, itemList] = await Promise.all([
        api.assetMaintenanceWorkOrder(token, workOrderId),
        api.employees(token).catch(() => [] as Employee[]),
        api.scmItems(token).catch(() => [] as ScmItem[]),
      ]);
      setDetail(record);
      setEmployees(employeeList.filter((employee) => employee.userId && employee.employmentStatus === "active"));
      setItems(itemList.filter((item) => item.isActive));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not load maintenance work order.");
    } finally {
      setLoading(false);
    }
  }, [token, workOrderId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function run(action: () => Promise<unknown>, successMessage: string) {
    if (!canManage) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await action();
      setNotice(successMessage);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Action failed.");
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <Spinner label="Loading maintenance work order…" />;
  if (!detail) return <Alert tone="error">{error ?? "Maintenance work order not found."}</Alert>;

  const { workOrder, schedule, parts, status, availableActions } = detail;
  const assignee = employees.find((employee) => employee.userId === workOrder.assignedToUserId);
  const itemName = (id: string) => items.find((item) => item.id === id)?.name ?? id;

  const partColumns: Column<(typeof parts)[number]>[] = [
    { header: "Item", cell: (row) => <span className="font-semibold text-slate-900">{itemName(row.itemId)}</span>, mobileRole: "title" },
    { header: "Quantity", cell: (row) => row.quantity.toLocaleString(), mobileRole: "status" },
    { header: "Unit Cost", cell: (row) => row.unitCost ?? "—" },
    { header: "Recorded", cell: (row) => formatDate(row.recordedAt) },
    { header: "Notes", cell: (row) => row.notes ?? "—" },
  ];

  const timeline = [
    { key: "created", title: "Created", timestamp: workOrder.createdAt },
    { key: "assigned", title: "Assigned", timestamp: workOrder.assignedAt, detail: workOrder.assignedToUserId ?? undefined },
    { key: "started", title: "Started", timestamp: workOrder.startedAt },
    { key: "completed", title: "Completed", timestamp: workOrder.completedAt, detail: workOrder.completionNotes ?? undefined },
    { key: "verified", title: "Verified", timestamp: workOrder.verifiedAt, detail: workOrder.verificationNotes ?? undefined },
  ].filter((item) => item.timestamp);

  return (
    <div className="space-y-4">
      <PageHeader
        title={`${workOrder.orderNumber} — ${workOrder.title}`}
        subtitle={`Asset maintenance ${label(workOrder.maintenanceType)} work order`}
        actions={
          status ? (
            <StatusPill tone={statusTone(status.instanceStatus)}>
              {status.stepName ?? status.stepCode ?? status.instanceStatus}
            </StatusPill>
          ) : (
            <StatusPill tone={workOrder.verifiedAt ? "success" : workOrder.completedAt ? "info" : "neutral"}>
              {workOrder.verifiedAt ? "Verified" : workOrder.completedAt ? "Completed" : "Open"}
            </StatusPill>
          )
        }
      />

      {error ? <Alert tone="error">{error}</Alert> : null}
      {notice ? <Alert tone="success">{notice}</Alert> : null}
      {!canManage ? (
        <Alert tone="info">
          You can inspect this work order. Maintenance actions require permission{" "}
          <code className="font-mono text-xs">asset.maintenance.manage</code>.
        </Alert>
      ) : null}

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <h2 className="mb-3 text-sm font-semibold text-slate-800">Work Order Details</h2>
          <dl className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2 lg:grid-cols-3">
            <div>
              <dt className="text-slate-500">Asset</dt>
              <dd className="text-slate-900">
                <Link to={`/asset-maintenance/assets/${workOrder.assetId}`} className="underline hover:text-slate-700">
                  {workOrder.assetId}
                </Link>
              </dd>
            </div>
            <div><dt className="text-slate-500">Maintenance Type</dt><dd className="text-slate-900">{label(workOrder.maintenanceType)}</dd></div>
            <div><dt className="text-slate-500">Priority</dt><dd className="text-slate-900">{label(workOrder.priority)}</dd></div>
            <div><dt className="text-slate-500">Assigned To</dt><dd className="text-slate-900">{assignee?.fullName ?? workOrder.assignedToUserId ?? "Unassigned"}</dd></div>
            <div><dt className="text-slate-500">Cost Estimate</dt><dd className="text-slate-900">{workOrder.costEstimate ?? "—"}</dd></div>
            <div><dt className="text-slate-500">Actual Cost</dt><dd className="text-slate-900">{workOrder.actualCost ?? "—"}</dd></div>
            <div><dt className="text-slate-500">Downtime Hours</dt><dd className="text-slate-900">{workOrder.downtimeHours}</dd></div>
            <div><dt className="text-slate-500">Completed</dt><dd className="text-slate-900">{formatDate(workOrder.completedAt)}</dd></div>
            <div><dt className="text-slate-500">Verified</dt><dd className="text-slate-900">{formatDate(workOrder.verifiedAt)}</dd></div>
          </dl>
          {workOrder.description ? (
            <p className="mt-3 rounded-md bg-slate-50 p-3 text-sm text-slate-600">{workOrder.description}</p>
          ) : null}
        </Card>

        <Card>
          <h2 className="mb-3 text-sm font-semibold text-slate-800">Lifecycle Timeline</h2>
          <Timeline items={timeline} />
        </Card>
      </div>

      {schedule ? (
        <Card>
          <h2 className="mb-3 text-sm font-semibold text-slate-800">Linked Preventive Schedule</h2>
          <dl className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-4">
            <div><dt className="text-slate-500">Schedule Code</dt><dd className="font-mono text-xs text-slate-900">{schedule.scheduleCode}</dd></div>
            <div><dt className="text-slate-500">Title</dt><dd className="text-slate-900">{schedule.title}</dd></div>
            <div><dt className="text-slate-500">Frequency</dt><dd className="text-slate-900">{label(schedule.frequencyType)}</dd></div>
            <div><dt className="text-slate-500">Next Due</dt><dd className="text-slate-900">{schedule.nextDueDate ? formatDateShort(schedule.nextDueDate) : `${schedule.nextDueMeter ?? "—"} ${schedule.meterType ?? ""}`}</dd></div>
          </dl>
        </Card>
      ) : null}

      {canManage ? (
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
          <Card>
            <h2 className="mb-3 text-sm font-semibold text-slate-800">Assignment and Direct Actions</h2>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field label="Assign to user">
                <Select value={assignedToUserId} onChange={(e) => setAssignedToUserId(e.target.value)}>
                  <option value="">Select active user</option>
                  {employees.map((employee) => (
                    <option key={employee.id} value={employee.userId ?? ""}>{employee.fullName}</option>
                  ))}
                </Select>
              </Field>
              <div className="flex items-end gap-2">
                <Button
                  disabled={busy || !assignedToUserId || Boolean(workOrder.assignedAt)}
                  onClick={() => void run(() => api.assignAssetMaintenanceWorkOrder(token, workOrder.id, assignedToUserId), "Work order assigned.")}
                >
                  Assign
                </Button>
                <Button
                  variant="secondary"
                  disabled={busy || Boolean(workOrder.startedAt)}
                  onClick={() => void run(() => api.startAssetMaintenanceWorkOrder(token, workOrder.id), "Work order started.")}
                >
                  Start
                </Button>
              </div>
            </div>

            {availableActions.length > 0 ? (
              <div className="mt-4 border-t border-slate-100 pt-4">
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Workflow Actions</h3>
                <Field label="Workflow comment">
                  <Input value={workflowComment} onChange={(e) => setWorkflowComment(e.target.value)} placeholder="Optional comment" />
                </Field>
                <div className="mt-3 flex flex-wrap gap-2">
                  {availableActions.map((action) => (
                    <Button
                      key={action.actionCode}
                      variant="secondary"
                      disabled={busy}
                      onClick={() => void run(
                        () => api.actOnAssetMaintenanceWorkOrder(token, workOrder.id, action.actionCode, workflowComment || null),
                        `${action.name} recorded.`,
                      )}
                    >
                      {action.name}
                    </Button>
                  ))}
                </div>
              </div>
            ) : null}
          </Card>

          <Card>
            <h2 className="mb-3 text-sm font-semibold text-slate-800">Complete / Verify</h2>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field label="Actual Cost">
                <Input type="number" min="0" step="0.01" value={actualCost} onChange={(e) => setActualCost(e.target.value)} />
              </Field>
              <Field label="Downtime Hours">
                <Input type="number" min="0" step="0.01" value={downtimeHours} onChange={(e) => setDowntimeHours(e.target.value)} />
              </Field>
              <Field label="Current Meter Reading">
                <Input type="number" min="0" step="0.01" value={currentMeterReading} onChange={(e) => setCurrentMeterReading(e.target.value)} />
              </Field>
              <Field label="Verification Notes">
                <Input value={verificationNotes} onChange={(e) => setVerificationNotes(e.target.value)} />
              </Field>
              <div className="sm:col-span-2">
                <Field label="Completion Notes">
                  <Textarea rows={2} value={completionNotes} onChange={(e) => setCompletionNotes(e.target.value)} />
                </Field>
              </div>
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              <Button
                disabled={busy || Boolean(workOrder.completedAt)}
                onClick={() => void run(
                  () => api.completeAssetMaintenanceWorkOrder(token, workOrder.id, {
                    completionNotes: completionNotes || null,
                    actualCost: actualCost ? Number(actualCost) : null,
                    downtimeHours: downtimeHours ? Number(downtimeHours) : null,
                    currentMeterReading: currentMeterReading ? Number(currentMeterReading) : null,
                  }),
                  "Work order completed.",
                )}
              >
                Complete Work
              </Button>
              <Button
                variant="secondary"
                disabled={busy || !workOrder.completedAt || Boolean(workOrder.verifiedAt)}
                onClick={() => void run(
                  () => api.verifyAssetMaintenanceWorkOrder(token, workOrder.id, verificationNotes || null),
                  "Work order verified.",
                )}
              >
                Verify Work
              </Button>
            </div>
          </Card>
        </div>
      ) : null}

      <Card>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-sm font-semibold text-slate-800">Spare Parts Usage</h2>
            <p className="text-xs text-slate-500">Parts are recorded against this maintenance work order.</p>
          </div>
          <Badge>{parts.length} parts</Badge>
        </div>

        {canManage && !workOrder.completedAt ? (
          <div className="mb-4 grid grid-cols-1 gap-3 rounded-md border border-slate-200 bg-slate-50 p-3 sm:grid-cols-4">
            <Field label="Item" required>
              <Select value={partItemId} onChange={(e) => setPartItemId(e.target.value)}>
                <option value="">Select item</option>
                {items.map((item) => (
                  <option key={item.id} value={item.id}>{item.code} — {item.name}</option>
                ))}
              </Select>
            </Field>
            <Field label="Quantity" required>
              <Input type="number" min="0.01" step="0.01" value={partQuantity} onChange={(e) => setPartQuantity(e.target.value)} />
            </Field>
            <Field label="Unit Cost">
              <Input type="number" min="0" step="0.01" value={partUnitCost} onChange={(e) => setPartUnitCost(e.target.value)} />
            </Field>
            <Field label="Notes">
              <Input value={partNotes} onChange={(e) => setPartNotes(e.target.value)} />
            </Field>
            <div className="sm:col-span-4">
              <Button
                disabled={busy || !partItemId || !partQuantity}
                onClick={() => void run(
                  () => api.recordAssetMaintenancePart(token, workOrder.id, {
                    itemId: partItemId,
                    quantity: Number(partQuantity),
                    unitCost: partUnitCost ? Number(partUnitCost) : null,
                    notes: partNotes || null,
                  }),
                  "Spare part recorded.",
                )}
              >
                Record Part Usage
              </Button>
            </div>
          </div>
        ) : null}

        <DataTable
          columns={partColumns}
          rows={parts}
          keyOf={(row) => row.id}
          empty={<EmptyState title="No spare parts recorded" description="Record parts before completing the work order when inventory materials are consumed." />}
        />
      </Card>
    </div>
  );
}
