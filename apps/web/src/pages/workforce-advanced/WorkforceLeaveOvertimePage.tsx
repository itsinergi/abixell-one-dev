/** Wave A4 — leave balances, requests, overtime, and delegated approvals. */
import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "../../auth/AuthContext";
import {
  api,
  ApiError,
  type Employee,
  type WorkforceLeaveBalance,
  type WorkforceLeaveRequestRow,
  type WorkforceLeaveType,
  type WorkforceOvertimeRequestRow,
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
  return status?.stepName ?? status?.stepCode ?? (status ? label(status.instanceStatus) : "Submitted");
}

function toTime(value: string): string {
  return value.length === 5 ? `${value}:00` : value;
}

export function WorkforceLeaveOvertimePage() {
  const { session } = useAuth();
  const token = session!.accessToken;
  const { permissions } = useShell();
  const canManage = permissions.includes(PERMISSIONS.workforceLeaveManage);
  const canApprove = permissions.includes(PERMISSIONS.workforceLeaveApprove);

  const [tab, setTab] = useState<"leave" | "overtime" | "balances" | "types">("leave");
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [leaveTypes, setLeaveTypes] = useState<WorkforceLeaveType[]>([]);
  const [balances, setBalances] = useState<WorkforceLeaveBalance[]>([]);
  const [leaveRequests, setLeaveRequests] = useState<WorkforceLeaveRequestRow[]>([]);
  const [overtimeRequests, setOvertimeRequests] = useState<WorkforceOvertimeRequestRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [employeeFilter, setEmployeeFilter] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [balanceYear, setBalanceYear] = useState(String(new Date().getFullYear()));

  const [typeCode, setTypeCode] = useState("");
  const [typeName, setTypeName] = useState("");
  const [allowance, setAllowance] = useState("12");
  const [typePaid, setTypePaid] = useState(true);
  const [requiresAttachment, setRequiresAttachment] = useState(false);

  const [allocationEmployee, setAllocationEmployee] = useState("");
  const [allocationType, setAllocationType] = useState("");
  const [allocatedDays, setAllocatedDays] = useState("12");

  const [leaveEmployee, setLeaveEmployee] = useState("");
  const [leaveTypeId, setLeaveTypeId] = useState("");
  const [leaveStart, setLeaveStart] = useState("");
  const [leaveEnd, setLeaveEnd] = useState("");
  const [leaveDays, setLeaveDays] = useState("1");
  const [leaveReason, setLeaveReason] = useState("");
  const [leaveAttachmentId, setLeaveAttachmentId] = useState("");

  const [overtimeEmployee, setOvertimeEmployee] = useState("");
  const [overtimeDate, setOvertimeDate] = useState("");
  const [overtimeStart, setOvertimeStart] = useState("17:00");
  const [overtimeEnd, setOvertimeEnd] = useState("19:00");
  const [estimatedHours, setEstimatedHours] = useState("2");
  const [overtimeReason, setOvertimeReason] = useState("");
  const [actualHoursById, setActualHoursById] = useState<Record<string, string>>({});
  const [actionCodeById, setActionCodeById] = useState<Record<string, string>>({});
  const [commentById, setCommentById] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [employeeList, typeList, leaveList, overtimeList] = await Promise.all([
        api.employees(token).catch(() => [] as Employee[]),
        api.workforceLeaveTypes(token, true),
        api.workforceLeaveRequests(token, {
          employeeId: employeeFilter || undefined,
          fromDate: fromDate || undefined,
          toDate: toDate || undefined,
        }),
        api.workforceOvertimeRequests(token, {
          employeeId: employeeFilter || undefined,
          fromDate: fromDate || undefined,
          toDate: toDate || undefined,
        }),
      ]);
      setEmployees(employeeList);
      setLeaveTypes(typeList);
      setLeaveRequests(leaveList);
      setOvertimeRequests(overtimeList);
      if (employeeFilter) {
        setBalances(await api.workforceLeaveBalances(token, employeeFilter, Number(balanceYear)));
      } else {
        setBalances([]);
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not load leave and overtime data.");
    } finally {
      setLoading(false);
    }
  }, [token, employeeFilter, fromDate, toDate, balanceYear]);

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
  const leaveTypeName = useMemo(
    () => (id: string) => leaveTypes.find((item) => item.id === id)?.name ?? id,
    [leaveTypes],
  );

  async function run(action: () => Promise<unknown>, message: string) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await action();
      setNotice(message);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "The action could not be completed.");
    } finally {
      setBusy(false);
    }
  }

  async function createLeaveType() {
    await run(
      () => api.createWorkforceLeaveType(token, {
        code: typeCode.trim(),
        name: typeName.trim(),
        annualAllowanceDays: Number(allowance),
        isPaid: typePaid,
        requiresAttachment,
      }),
      `Leave type ${typeName} created.`,
    );
    setTypeCode("");
    setTypeName("");
  }

  async function allocateBalance() {
    await run(
      () => api.setWorkforceLeaveAllocation(token, {
        employeeId: allocationEmployee,
        leaveTypeId: allocationType,
        balanceYear: Number(balanceYear),
        allocatedDays: Number(allocatedDays),
      }),
      "Leave allocation saved.",
    );
  }

  async function submitLeave() {
    await run(
      () => api.createWorkforceLeaveRequest(token, {
        employeeId: leaveEmployee,
        leaveTypeId,
        startDate: leaveStart,
        endDate: leaveEnd,
        totalDays: Number(leaveDays),
        reason: leaveReason || null,
        attachmentDocumentId: leaveAttachmentId || null,
      }),
      "Leave request submitted to the approval workflow.",
    );
    setLeaveReason("");
    setLeaveAttachmentId("");
  }

  async function submitOvertime() {
    await run(
      () => api.createWorkforceOvertimeRequest(token, {
        employeeId: overtimeEmployee,
        overtimeDate,
        startTime: toTime(overtimeStart),
        endTime: toTime(overtimeEnd),
        estimatedHours: Number(estimatedHours),
        reason: overtimeReason || null,
      }),
      "Overtime request submitted to the approval workflow.",
    );
    setOvertimeReason("");
  }

  async function act(kind: "leave" | "overtime", id: string) {
    const actionCode = actionCodeById[id]?.trim();
    if (!actionCode) return;
    await run(
      () => kind === "leave"
        ? api.actOnWorkforceLeaveRequest(token, id, actionCode, commentById[id] || null)
        : api.actOnWorkforceOvertimeRequest(token, id, actionCode, commentById[id] || null),
      `${label(actionCode)} action completed.`,
    );
  }

  const leaveColumns: Column<WorkforceLeaveRequestRow>[] = [
    {
      header: "Request",
      cell: ({ leaveRequest }) => (
        <div>
          <div className="font-semibold text-slate-900">{leaveRequest.requestNumber}</div>
          <div className="text-xs text-slate-500">{employeeName(leaveRequest.employeeId)}</div>
        </div>
      ),
      mobileRole: "title",
    },
    { header: "Leave type", cell: ({ leaveRequest }) => <Badge>{leaveTypeName(leaveRequest.leaveTypeId)}</Badge> },
    { header: "Dates", cell: ({ leaveRequest }) => `${formatDateShort(leaveRequest.startDate)} – ${formatDateShort(leaveRequest.endDate)}` },
    { header: "Days", cell: ({ leaveRequest }) => leaveRequest.totalDays },
    {
      header: "Workflow",
      cell: ({ status }) => <StatusPill tone={statusTone(status?.instanceStatus)}>{workflowLabel(status)}</StatusPill>,
      mobileRole: "status",
    },
    {
      header: "Approval action",
      cell: ({ leaveRequest, status }) => canApprove && status?.instanceStatus === "in_progress" ? (
        <div className="min-w-[180px] space-y-1" onClick={(event) => event.stopPropagation()}>
          <Input
            aria-label={`Action code for ${leaveRequest.requestNumber}`}
            placeholder="Action code"
            value={actionCodeById[leaveRequest.id] ?? ""}
            onChange={(event) => setActionCodeById((current) => ({ ...current, [leaveRequest.id]: event.target.value }))}
          />
          <Input
            aria-label={`Comment for ${leaveRequest.requestNumber}`}
            placeholder="Optional comment"
            value={commentById[leaveRequest.id] ?? ""}
            onChange={(event) => setCommentById((current) => ({ ...current, [leaveRequest.id]: event.target.value }))}
          />
          <Button variant="secondary" disabled={busy || !actionCodeById[leaveRequest.id]?.trim()} onClick={() => void act("leave", leaveRequest.id)}>
            Run action
          </Button>
        </div>
      ) : <span className="text-slate-400">—</span>,
    },
  ];

  const overtimeColumns: Column<WorkforceOvertimeRequestRow>[] = [
    {
      header: "Request",
      cell: ({ overtimeRequest }) => (
        <div>
          <div className="font-semibold text-slate-900">{overtimeRequest.requestNumber}</div>
          <div className="text-xs text-slate-500">{employeeName(overtimeRequest.employeeId)}</div>
        </div>
      ),
      mobileRole: "title",
    },
    { header: "Date", cell: ({ overtimeRequest }) => formatDateShort(overtimeRequest.overtimeDate) },
    { header: "Planned", cell: ({ overtimeRequest }) => `${overtimeRequest.startTime}–${overtimeRequest.endTime} (${overtimeRequest.estimatedHours}h)` },
    { header: "Actual", cell: ({ overtimeRequest }) => overtimeRequest.actualHours == null ? "—" : `${overtimeRequest.actualHours}h` },
    {
      header: "Workflow",
      cell: ({ status }) => <StatusPill tone={statusTone(status?.instanceStatus)}>{workflowLabel(status)}</StatusPill>,
      mobileRole: "status",
    },
    {
      header: "Actions",
      cell: ({ overtimeRequest, status }) => (
        <div className="min-w-[190px] space-y-1" onClick={(event) => event.stopPropagation()}>
          {canManage && overtimeRequest.approvedAt && overtimeRequest.actualHours == null ? (
            <div className="flex items-end gap-1">
              <Input
                aria-label={`Actual hours for ${overtimeRequest.requestNumber}`}
                type="number"
                min="0"
                step="0.25"
                placeholder="Actual hours"
                value={actualHoursById[overtimeRequest.id] ?? ""}
                onChange={(event) => setActualHoursById((current) => ({ ...current, [overtimeRequest.id]: event.target.value }))}
              />
              <Button
                variant="secondary"
                disabled={busy || !actualHoursById[overtimeRequest.id]}
                onClick={() => void run(
                  () => api.recordWorkforceActualOvertime(token, overtimeRequest.id, Number(actualHoursById[overtimeRequest.id])),
                  "Actual overtime recorded.",
                )}
              >
                Save
              </Button>
            </div>
          ) : null}
          {canApprove && status?.instanceStatus === "in_progress" ? (
            <>
              <Input
                aria-label={`Action code for ${overtimeRequest.requestNumber}`}
                placeholder="Workflow action code"
                value={actionCodeById[overtimeRequest.id] ?? ""}
                onChange={(event) => setActionCodeById((current) => ({ ...current, [overtimeRequest.id]: event.target.value }))}
              />
              <Input
                aria-label={`Comment for ${overtimeRequest.requestNumber}`}
                placeholder="Optional comment"
                value={commentById[overtimeRequest.id] ?? ""}
                onChange={(event) => setCommentById((current) => ({ ...current, [overtimeRequest.id]: event.target.value }))}
              />
              <Button variant="secondary" disabled={busy || !actionCodeById[overtimeRequest.id]?.trim()} onClick={() => void act("overtime", overtimeRequest.id)}>
                Run action
              </Button>
            </>
          ) : null}
          {(!canApprove || status?.instanceStatus !== "in_progress") &&
            (!canManage || !overtimeRequest.approvedAt || overtimeRequest.actualHours != null) ? <span className="text-slate-400">—</span> : null}
        </div>
      ),
    },
  ];

  const balanceColumns: Column<WorkforceLeaveBalance>[] = [
    { header: "Employee", cell: (row) => <span className="font-semibold">{employeeName(row.employeeId)}</span>, mobileRole: "title" },
    { header: "Leave type", cell: (row) => leaveTypeName(row.leaveTypeId) },
    { header: "Year", cell: (row) => row.balanceYear },
    { header: "Allocated", cell: (row) => row.allocatedDays },
    { header: "Used", cell: (row) => row.usedDays },
    { header: "Pending", cell: (row) => row.pendingDays },
    {
      header: "Available",
      cell: (row) => <StatusPill tone={row.allocatedDays - row.usedDays - row.pendingDays > 0 ? "success" : "warning"}>
        {row.allocatedDays - row.usedDays - row.pendingDays} days
      </StatusPill>,
      mobileRole: "status",
    },
  ];

  const typeColumns: Column<WorkforceLeaveType>[] = [
    {
      header: "Leave type",
      cell: (row) => <div><div className="font-semibold">{row.name}</div><div className="font-mono text-xs text-slate-500">{row.code}</div></div>,
      mobileRole: "title",
    },
    { header: "Annual allowance", cell: (row) => `${row.annualAllowanceDays} days` },
    { header: "Paid", cell: (row) => row.isPaid ? "Yes" : "No" },
    { header: "Attachment", cell: (row) => row.requiresAttachment ? "Required" : "Optional" },
    { header: "State", cell: (row) => <StatusPill tone={row.isActive ? "success" : "neutral"}>{row.isActive ? "Active" : "Inactive"}</StatusPill>, mobileRole: "status" },
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
      <PageHeader title="Leave & Overtime" subtitle="Keep entitlements accurate and route leave and overtime through configured approval workflows." />
      {error ? <Alert tone="error">{error}</Alert> : null}
      {notice ? <Alert tone="success">{notice}</Alert> : null}
      {!canManage ? <Alert tone="info">Leave setup and request submission require <code className="font-mono text-xs">workforce.leave.manage</code>.</Alert> : null}
      {!canApprove ? <Alert tone="info">Workflow decisions require <code className="font-mono text-xs">workforce.leave.approve</code>.</Alert> : null}

      <div className="flex overflow-x-auto border-b border-slate-200">
        {tabButton("leave", `Leave requests (${leaveRequests.length})`)}
        {tabButton("overtime", `Overtime (${overtimeRequests.length})`)}
        {tabButton("balances", `Balances (${balances.length})`)}
        {tabButton("types", `Leave types (${leaveTypes.length})`)}
      </div>

      <Card>
        <h2 className="mb-3 text-sm font-semibold text-slate-800">Filters</h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Employee">
            <Select value={employeeFilter} onChange={(event) => setEmployeeFilter(event.target.value)}>
              <option value="">All employees</option>
              {employees.map((employee) => <option key={employee.id} value={employee.id}>{employee.fullName} ({employee.employeeNumber})</option>)}
            </Select>
          </Field>
          <Field label="From"><Input type="date" value={fromDate} onChange={(event) => setFromDate(event.target.value)} /></Field>
          <Field label="To"><Input type="date" value={toDate} onChange={(event) => setToDate(event.target.value)} /></Field>
          <Field label="Balance year"><Input type="number" min="2000" max="2100" value={balanceYear} onChange={(event) => setBalanceYear(event.target.value)} /></Field>
        </div>
        {tab === "balances" && !employeeFilter ? <p className="mt-2 text-xs text-slate-500">Select an employee to load scoped leave balances.</p> : null}
      </Card>

      {canManage && tab === "leave" ? (
        <Card>
          <h2 className="mb-3 text-sm font-semibold text-slate-800">Submit Leave Request</h2>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Field label="Employee" required><Select value={leaveEmployee} onChange={(event) => setLeaveEmployee(event.target.value)}><option value="">Select employee</option>{employees.map((employee) => <option key={employee.id} value={employee.id}>{employee.fullName}</option>)}</Select></Field>
            <Field label="Leave type" required><Select value={leaveTypeId} onChange={(event) => setLeaveTypeId(event.target.value)}><option value="">Select leave type</option>{leaveTypes.filter((item) => item.isActive).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</Select></Field>
            <Field label="Start date" required><Input type="date" value={leaveStart} onChange={(event) => setLeaveStart(event.target.value)} /></Field>
            <Field label="End date" required><Input type="date" value={leaveEnd} onChange={(event) => setLeaveEnd(event.target.value)} /></Field>
            <Field label="Total days" required><Input type="number" min="0.5" step="0.5" value={leaveDays} onChange={(event) => setLeaveDays(event.target.value)} /></Field>
            <Field label="Attachment document ID" hint="Required when the selected policy requires evidence."><Input value={leaveAttachmentId} onChange={(event) => setLeaveAttachmentId(event.target.value)} /></Field>
            <div className="sm:col-span-2"><Field label="Reason"><Textarea rows={2} value={leaveReason} onChange={(event) => setLeaveReason(event.target.value)} /></Field></div>
          </div>
          <Button className="mt-3" disabled={busy || !leaveEmployee || !leaveTypeId || !leaveStart || !leaveEnd || Number(leaveDays) <= 0} onClick={() => void submitLeave()}>Submit leave request</Button>
        </Card>
      ) : null}

      {canManage && tab === "overtime" ? (
        <Card>
          <h2 className="mb-3 text-sm font-semibold text-slate-800">Submit Overtime Request</h2>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Field label="Employee" required><Select value={overtimeEmployee} onChange={(event) => setOvertimeEmployee(event.target.value)}><option value="">Select employee</option>{employees.map((employee) => <option key={employee.id} value={employee.id}>{employee.fullName}</option>)}</Select></Field>
            <Field label="Overtime date" required><Input type="date" value={overtimeDate} onChange={(event) => setOvertimeDate(event.target.value)} /></Field>
            <Field label="Start time" required><Input type="time" value={overtimeStart} onChange={(event) => setOvertimeStart(event.target.value)} /></Field>
            <Field label="End time" required><Input type="time" value={overtimeEnd} onChange={(event) => setOvertimeEnd(event.target.value)} /></Field>
            <Field label="Estimated hours" required><Input type="number" min="0.25" step="0.25" value={estimatedHours} onChange={(event) => setEstimatedHours(event.target.value)} /></Field>
            <div className="sm:col-span-2 lg:col-span-3"><Field label="Reason"><Textarea rows={2} value={overtimeReason} onChange={(event) => setOvertimeReason(event.target.value)} /></Field></div>
          </div>
          <Button className="mt-3" disabled={busy || !overtimeEmployee || !overtimeDate || !overtimeStart || !overtimeEnd || Number(estimatedHours) <= 0} onClick={() => void submitOvertime()}>Submit overtime request</Button>
        </Card>
      ) : null}

      {canManage && tab === "balances" ? (
        <Card>
          <h2 className="mb-3 text-sm font-semibold text-slate-800">Set Leave Allocation</h2>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
            <Field label="Employee" required><Select value={allocationEmployee} onChange={(event) => setAllocationEmployee(event.target.value)}><option value="">Select employee</option>{employees.map((employee) => <option key={employee.id} value={employee.id}>{employee.fullName}</option>)}</Select></Field>
            <Field label="Leave type" required><Select value={allocationType} onChange={(event) => setAllocationType(event.target.value)}><option value="">Select type</option>{leaveTypes.filter((item) => item.isActive).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</Select></Field>
            <Field label="Year" required><Input type="number" min="2000" max="2100" value={balanceYear} onChange={(event) => setBalanceYear(event.target.value)} /></Field>
            <Field label="Allocated days" required><Input type="number" min="0" step="0.5" value={allocatedDays} onChange={(event) => setAllocatedDays(event.target.value)} /></Field>
          </div>
          <Button className="mt-3" disabled={busy || !allocationEmployee || !allocationType || Number(allocatedDays) < 0} onClick={() => void allocateBalance()}>Save allocation</Button>
        </Card>
      ) : null}

      {canManage && tab === "types" ? (
        <Card>
          <h2 className="mb-3 text-sm font-semibold text-slate-800">Create Leave Type</h2>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Field label="Code" required><Input value={typeCode} onChange={(event) => setTypeCode(event.target.value)} placeholder="ANNUAL" /></Field>
            <Field label="Name" required><Input value={typeName} onChange={(event) => setTypeName(event.target.value)} placeholder="Annual leave" /></Field>
            <Field label="Annual allowance"><Input type="number" min="0" step="0.5" value={allowance} onChange={(event) => setAllowance(event.target.value)} /></Field>
          </div>
          <div className="mt-3 flex flex-wrap gap-5 text-sm text-slate-700">
            <label className="flex items-center gap-2"><input type="checkbox" checked={typePaid} onChange={(event) => setTypePaid(event.target.checked)} />Paid leave</label>
            <label className="flex items-center gap-2"><input type="checkbox" checked={requiresAttachment} onChange={(event) => setRequiresAttachment(event.target.checked)} />Requires attachment</label>
          </div>
          <Button className="mt-3" disabled={busy || !typeCode.trim() || !typeName.trim()} onClick={() => void createLeaveType()}>Create leave type</Button>
        </Card>
      ) : null}

      {loading ? <Spinner label="Loading leave and overtime records…" /> : (
        <Card>
          {tab === "leave" ? <DataTable columns={leaveColumns} rows={leaveRequests} keyOf={(row) => row.leaveRequest.id} mobileBreakpoint="md" empty={<EmptyState title="No leave requests" description="Submit a request above or adjust the filters." />} /> : null}
          {tab === "overtime" ? <DataTable columns={overtimeColumns} rows={overtimeRequests} keyOf={(row) => row.overtimeRequest.id} mobileBreakpoint="md" empty={<EmptyState title="No overtime requests" description="Submit an overtime request above or adjust the filters." />} /> : null}
          {tab === "balances" ? <DataTable columns={balanceColumns} rows={balances} keyOf={(row) => row.id} empty={<EmptyState title="No balances loaded" description="Select an employee and year to view leave balances." />} /> : null}
          {tab === "types" ? <DataTable columns={typeColumns} rows={leaveTypes} keyOf={(row) => row.id} empty={<EmptyState title="No leave types" description="Create the first leave entitlement policy above." />} /> : null}
        </Card>
      )}
    </div>
  );
}
