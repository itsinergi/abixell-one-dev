/**
 * Wave A3 — Asset Advanced maintenance center (AST-ADV-001…002).
 *
 * Surfaces preventive schedules and maintenance work orders while keeping
 * lifecycle state delegated to the backend Workflow Engine.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../../auth/AuthContext";
import {
  api,
  ApiError,
  type AssetMaintenanceSchedule,
  type AssetMaintenanceWorkOrderRow,
  type AssetRecord,
  type MaintenanceFrequencyType,
  type MaintenancePriority,
  type MaintenanceType,
  type MeterReadingType,
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

const MAINTENANCE_TYPES: MaintenanceType[] = ["preventive", "corrective", "emergency"];
const PRIORITIES: MaintenancePriority[] = ["low", "medium", "high", "critical"];
const METER_TYPES: MeterReadingType[] = ["hours", "km", "cycles"];

function label(value: string): string {
  return value.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());
}

function workOrderDisplayState(row: AssetMaintenanceWorkOrderRow): string {
  if (row.status) return row.status.stepName ?? row.status.stepCode ?? row.status.instanceStatus;
  if (row.workOrder.verifiedAt) return "Verified";
  if (row.workOrder.completedAt) return "Completed";
  if (row.workOrder.startedAt) return "In progress";
  if (row.workOrder.assignedAt) return "Assigned";
  return "Created";
}

export function AssetMaintenancePage() {
  const { session } = useAuth();
  const token = session!.accessToken;
  const navigate = useNavigate();
  const { permissions } = useShell();

  const canManage = permissions.includes(PERMISSIONS.assetMaintenanceManage);

  const [assets, setAssets] = useState<AssetRecord[]>([]);
  const [schedules, setSchedules] = useState<AssetMaintenanceSchedule[]>([]);
  const [dueSchedules, setDueSchedules] = useState<AssetMaintenanceSchedule[]>([]);
  const [workOrders, setWorkOrders] = useState<AssetMaintenanceWorkOrderRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [assetFilter, setAssetFilter] = useState("");
  const [typeFilter, setTypeFilter] = useState("");
  const [asOfDate, setAsOfDate] = useState(() => new Date().toISOString().slice(0, 10));

  const [scheduleAssetId, setScheduleAssetId] = useState("");
  const [scheduleCode, setScheduleCode] = useState("");
  const [scheduleTitle, setScheduleTitle] = useState("");
  const [scheduleDescription, setScheduleDescription] = useState("");
  const [frequencyType, setFrequencyType] = useState<MaintenanceFrequencyType>("calendar");
  const [intervalDays, setIntervalDays] = useState("30");
  const [meterInterval, setMeterInterval] = useState("");
  const [meterType, setMeterType] = useState<MeterReadingType>("hours");
  const [nextDueDate, setNextDueDate] = useState("");
  const [nextDueMeter, setNextDueMeter] = useState("");

  const [woAssetId, setWoAssetId] = useState("");
  const [woScheduleId, setWoScheduleId] = useState("");
  const [woType, setWoType] = useState<MaintenanceType>("preventive");
  const [woPriority, setWoPriority] = useState<MaintenancePriority>("medium");
  const [woTitle, setWoTitle] = useState("");
  const [woDescription, setWoDescription] = useState("");
  const [costEstimate, setCostEstimate] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [assetResult, scheduleList, dueList, orderList] = await Promise.all([
        api.assets(token, { includeTerminal: false }).catch(() => ({ assets: [] as AssetRecord[], custodians: [] })),
        api.assetMaintenanceSchedules(token, assetFilter || undefined),
        api.dueAssetMaintenanceSchedules(token, asOfDate || undefined),
        api.assetMaintenanceWorkOrders(token, {
          assetId: assetFilter || undefined,
          maintenanceType: typeFilter ? (typeFilter as MaintenanceType) : undefined,
        }),
      ]);
      setAssets(assetResult.assets);
      setSchedules(scheduleList);
      setDueSchedules(dueList);
      setWorkOrders(orderList);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not load asset maintenance data.");
    } finally {
      setLoading(false);
    }
  }, [token, assetFilter, typeFilter, asOfDate]);

  useEffect(() => {
    void load();
  }, [load]);

  const assetName = useMemo(
    () => (id: string | null) => {
      if (!id) return "—";
      const asset = assets.find((a) => a.id === id);
      return asset ? `${asset.assetNumber} — ${asset.name}` : id;
    },
    [assets],
  );

  const availableSchedulesForWorkOrder = schedules.filter(
    (schedule) => !woAssetId || schedule.assetId === woAssetId,
  );

  async function createSchedule() {
    if (!canManage) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const created = await api.createAssetMaintenanceSchedule(token, {
        assetId: scheduleAssetId,
        scheduleCode,
        title: scheduleTitle,
        description: scheduleDescription || null,
        frequencyType,
        intervalDays: frequencyType === "calendar" ? Number(intervalDays) : null,
        meterInterval: frequencyType === "meter" ? Number(meterInterval) : null,
        meterType: frequencyType === "meter" ? meterType : null,
        nextDueDate: nextDueDate || null,
        nextDueMeter: nextDueMeter ? Number(nextDueMeter) : null,
      });
      setNotice(`Maintenance schedule ${created.scheduleCode} created.`);
      setScheduleCode("");
      setScheduleTitle("");
      setScheduleDescription("");
      setNextDueDate("");
      setNextDueMeter("");
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not create maintenance schedule.");
    } finally {
      setBusy(false);
    }
  }

  async function createWorkOrder() {
    if (!canManage) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const created = await api.createAssetMaintenanceWorkOrder(token, {
        assetId: woAssetId,
        scheduleId: woScheduleId || null,
        maintenanceType: woType,
        priority: woPriority,
        title: woTitle,
        description: woDescription || null,
        costEstimate: costEstimate ? Number(costEstimate) : null,
      });
      setNotice(`Maintenance work order ${created.orderNumber} created.`);
      setWoTitle("");
      setWoDescription("");
      setCostEstimate("");
      await load();
      navigate(`/asset-maintenance/work-orders/${created.id}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not create maintenance work order.");
    } finally {
      setBusy(false);
    }
  }

  const scheduleColumns: Column<AssetMaintenanceSchedule>[] = [
    {
      header: "Schedule",
      cell: (row) => (
        <div>
          <span className="font-semibold text-slate-900">{row.title}</span>
          <div className="font-mono text-[11px] text-slate-400">{row.scheduleCode}</div>
        </div>
      ),
      mobileRole: "title",
    },
    { header: "Asset", cell: (row) => assetName(row.assetId) },
    { header: "Frequency", cell: (row) => label(row.frequencyType) },
    {
      header: "Next Due",
      cell: (row) =>
        row.frequencyType === "calendar"
          ? formatDateShort(row.nextDueDate)
          : row.nextDueMeter
            ? `${row.nextDueMeter} ${row.meterType ?? ""}`
            : "—",
      mobileRole: "status",
    },
    {
      header: "State",
      cell: (row) => <StatusPill tone={row.isActive ? "success" : "neutral"}>{row.isActive ? "Active" : "Inactive"}</StatusPill>,
    },
  ];

  const dueScheduleColumns: Column<AssetMaintenanceSchedule>[] = [
    { header: "Due Schedule", cell: (row) => <span className="font-semibold">{row.title}</span>, mobileRole: "title" },
    { header: "Asset", cell: (row) => assetName(row.assetId) },
    { header: "Due", cell: (row) => row.nextDueDate ? formatDateShort(row.nextDueDate) : `${row.nextDueMeter ?? "—"} ${row.meterType ?? ""}` },
    { header: "Type", cell: (row) => <Badge>{label(row.frequencyType)}</Badge>, mobileRole: "status" },
  ];

  const workOrderColumns: Column<AssetMaintenanceWorkOrderRow>[] = [
    {
      header: "Work Order",
      cell: (row) => (
        <Link
          to={`/asset-maintenance/work-orders/${row.workOrder.id}`}
          className="font-semibold text-slate-900 underline hover:text-slate-700"
        >
          {row.workOrder.orderNumber}
        </Link>
      ),
      mobileRole: "title",
    },
    { header: "Title", cell: (row) => row.workOrder.title },
    { header: "Asset", cell: (row) => assetName(row.workOrder.assetId) },
    { header: "Type", cell: (row) => <Badge>{label(row.workOrder.maintenanceType)}</Badge> },
    { header: "Priority", cell: (row) => <Badge>{label(row.workOrder.priority)}</Badge> },
    {
      header: "Lifecycle",
      cell: (row) => (
        <StatusPill tone={statusTone(row.status?.instanceStatus)}>{workOrderDisplayState(row)}</StatusPill>
      ),
      mobileRole: "status",
    },
  ];

  return (
    <div className="space-y-4">
      <PageHeader
        title="Asset Maintenance"
        subtitle="Preventive schedules, maintenance work orders, and due-work planning for Asset Advanced."
      />

      {error ? <Alert tone="error">{error}</Alert> : null}
      {notice ? <Alert tone="success">{notice}</Alert> : null}
      {!canManage ? (
        <Alert tone="info">
          You can view maintenance records. Creating schedules or work orders requires permission{" "}
          <code className="font-mono text-xs">asset.maintenance.manage</code>.
        </Alert>
      ) : null}

      <Card>
        <h2 className="mb-3 text-sm font-semibold text-slate-800">Filters</h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Asset">
            <Select value={assetFilter} onChange={(e) => setAssetFilter(e.target.value)}>
              <option value="">All assets</option>
              {assets.map((asset) => (
                <option key={asset.id} value={asset.id}>
                  {asset.assetNumber} — {asset.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Maintenance type">
            <Select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}>
              <option value="">All types</option>
              {MAINTENANCE_TYPES.map((type) => (
                <option key={type} value={type}>{label(type)}</option>
              ))}
            </Select>
          </Field>
          <Field label="Due as of">
            <Input type="date" value={asOfDate} onChange={(e) => setAsOfDate(e.target.value)} />
          </Field>
        </div>
      </Card>

      {canManage ? (
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
          <Card>
            <h2 className="mb-3 text-sm font-semibold text-slate-800">Create Maintenance Schedule</h2>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field label="Asset" required>
                <Select value={scheduleAssetId} onChange={(e) => setScheduleAssetId(e.target.value)}>
                  <option value="">Select asset</option>
                  {assets.map((asset) => (
                    <option key={asset.id} value={asset.id}>{asset.assetNumber} — {asset.name}</option>
                  ))}
                </Select>
              </Field>
              <Field label="Schedule Code" required>
                <Input value={scheduleCode} onChange={(e) => setScheduleCode(e.target.value)} placeholder="pm_generator_30d" />
              </Field>
              <Field label="Title" required>
                <Input value={scheduleTitle} onChange={(e) => setScheduleTitle(e.target.value)} placeholder="30-day preventive inspection" />
              </Field>
              <Field label="Frequency Type">
                <Select value={frequencyType} onChange={(e) => setFrequencyType(e.target.value as MaintenanceFrequencyType)}>
                  <option value="calendar">Calendar</option>
                  <option value="meter">Meter</option>
                </Select>
              </Field>
              {frequencyType === "calendar" ? (
                <>
                  <Field label="Interval Days" required>
                    <Input type="number" min="1" value={intervalDays} onChange={(e) => setIntervalDays(e.target.value)} />
                  </Field>
                  <Field label="Next Due Date">
                    <Input type="date" value={nextDueDate} onChange={(e) => setNextDueDate(e.target.value)} />
                  </Field>
                </>
              ) : (
                <>
                  <Field label="Meter Interval" required>
                    <Input type="number" min="0" step="0.01" value={meterInterval} onChange={(e) => setMeterInterval(e.target.value)} />
                  </Field>
                  <Field label="Meter Type">
                    <Select value={meterType} onChange={(e) => setMeterType(e.target.value as MeterReadingType)}>
                      {METER_TYPES.map((type) => <option key={type} value={type}>{label(type)}</option>)}
                    </Select>
                  </Field>
                  <Field label="Next Due Meter">
                    <Input type="number" min="0" step="0.01" value={nextDueMeter} onChange={(e) => setNextDueMeter(e.target.value)} />
                  </Field>
                </>
              )}
              <div className="sm:col-span-2">
                <Field label="Description">
                  <Textarea rows={2} value={scheduleDescription} onChange={(e) => setScheduleDescription(e.target.value)} />
                </Field>
              </div>
            </div>
            <div className="mt-3">
              <Button
                disabled={busy || !scheduleAssetId || !scheduleCode || !scheduleTitle || (frequencyType === "calendar" && !intervalDays) || (frequencyType === "meter" && !meterInterval)}
                onClick={() => void createSchedule()}
              >
                Create Schedule
              </Button>
            </div>
          </Card>

          <Card>
            <h2 className="mb-3 text-sm font-semibold text-slate-800">Create Maintenance Work Order</h2>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field label="Asset" required>
                <Select value={woAssetId} onChange={(e) => { setWoAssetId(e.target.value); setWoScheduleId(""); }}>
                  <option value="">Select asset</option>
                  {assets.map((asset) => (
                    <option key={asset.id} value={asset.id}>{asset.assetNumber} — {asset.name}</option>
                  ))}
                </Select>
              </Field>
              <Field label="Schedule">
                <Select value={woScheduleId} onChange={(e) => setWoScheduleId(e.target.value)}>
                  <option value="">No linked schedule</option>
                  {availableSchedulesForWorkOrder.map((schedule) => (
                    <option key={schedule.id} value={schedule.id}>{schedule.scheduleCode} — {schedule.title}</option>
                  ))}
                </Select>
              </Field>
              <Field label="Maintenance Type">
                <Select value={woType} onChange={(e) => setWoType(e.target.value as MaintenanceType)}>
                  {MAINTENANCE_TYPES.map((type) => <option key={type} value={type}>{label(type)}</option>)}
                </Select>
              </Field>
              <Field label="Priority">
                <Select value={woPriority} onChange={(e) => setWoPriority(e.target.value as MaintenancePriority)}>
                  {PRIORITIES.map((priority) => <option key={priority} value={priority}>{label(priority)}</option>)}
                </Select>
              </Field>
              <Field label="Title" required>
                <Input value={woTitle} onChange={(e) => setWoTitle(e.target.value)} placeholder="Inspect pump seal" />
              </Field>
              <Field label="Cost Estimate">
                <Input type="number" min="0" step="0.01" value={costEstimate} onChange={(e) => setCostEstimate(e.target.value)} />
              </Field>
              <div className="sm:col-span-2">
                <Field label="Description">
                  <Textarea rows={2} value={woDescription} onChange={(e) => setWoDescription(e.target.value)} />
                </Field>
              </div>
            </div>
            <div className="mt-3">
              <Button disabled={busy || !woAssetId || !woTitle} onClick={() => void createWorkOrder()}>
                Create Work Order
              </Button>
            </div>
          </Card>
        </div>
      ) : null}

      {loading ? (
        <Spinner label="Loading maintenance records…" />
      ) : (
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
          <Card>
            <h2 className="mb-3 text-sm font-semibold text-slate-800">Due Maintenance Schedules</h2>
            <DataTable
              columns={dueScheduleColumns}
              rows={dueSchedules}
              keyOf={(row) => row.id}
              empty={<EmptyState title="No schedules currently due" description="Due schedules appear here when their date or meter threshold has been reached." />}
            />
          </Card>
          <Card>
            <h2 className="mb-3 text-sm font-semibold text-slate-800">Maintenance Schedules</h2>
            <DataTable
              columns={scheduleColumns}
              rows={schedules}
              keyOf={(row) => row.id}
              empty={<EmptyState title="No maintenance schedules" description="Create calendar or meter-based preventive schedules for critical assets." />}
            />
          </Card>
          <Card className="xl:col-span-2">
            <h2 className="mb-3 text-sm font-semibold text-slate-800">Maintenance Work Orders</h2>
            <DataTable
              columns={workOrderColumns}
              rows={workOrders}
              keyOf={(row) => row.workOrder.id}
              onRowClick={(row) => navigate(`/asset-maintenance/work-orders/${row.workOrder.id}`)}
              mobileBreakpoint="md"
              empty={<EmptyState title="No maintenance work orders" description="Create preventive, corrective, or emergency maintenance work orders above." />}
            />
          </Card>
        </div>
      )}
    </div>
  );
}
