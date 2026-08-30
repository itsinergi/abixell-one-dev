/**
 * Wave A4 — Workforce Advanced Attendance & Rosters Page (HR-ADV-001, HR-ADV-002).
 *
 * Surfaces shift configuration, daily/weekly roster scheduling, and attendance recording.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "../../auth/AuthContext";
import {
  api,
  ApiError,
  type Employee,
  type WorkforceAttendanceRecord,
  type WorkforceAttendanceSource,
  type WorkforceAttendanceStatus,
  type WorkforceRoster,
  type WorkforceShift,
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
import { formatDate, formatDateShort } from "../../shared/format";

const ATTENDANCE_STATUSES: WorkforceAttendanceStatus[] = [
  "present",
  "late",
  "absent",
  "leave",
  "holiday",
  "day_off",
];

const ATTENDANCE_SOURCES: WorkforceAttendanceSource[] = [
  "manual",
  "self_service",
  "import",
  "device",
];

function statusTone(status: WorkforceAttendanceStatus) {
  switch (status) {
    case "present":
      return "success";
    case "late":
      return "warning";
    case "absent":
      return "danger";
    case "leave":
    case "holiday":
    case "day_off":
      return "info";
    default:
      return "neutral";
  }
}

function label(value: string): string {
  return value.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());
}

export function WorkforceAttendancePage() {
  const { session } = useAuth();
  const token = session!.accessToken;
  const { permissions } = useShell();

  const canManage = permissions.includes(PERMISSIONS.workforceAttendanceManage);

  const [activeTab, setActiveTab] = useState<"attendance" | "rosters" | "shifts">("attendance");
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [shifts, setShifts] = useState<WorkforceShift[]>([]);
  const [rosters, setRosters] = useState<WorkforceRoster[]>([]);
  const [attendanceRecords, setAttendanceRecords] = useState<WorkforceAttendanceRecord[]>([]);

  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // Filters
  const [filterEmployeeId, setFilterEmployeeId] = useState("");
  const [filterStatus, setFilterStatus] = useState<WorkforceAttendanceStatus | "">("");
  const [filterFromDate, setFilterFromDate] = useState("");
  const [filterToDate, setFilterToDate] = useState("");

  // Shift Form
  const [shiftCode, setShiftCode] = useState("");
  const [shiftName, setShiftName] = useState("");
  const [shiftStartTime, setShiftStartTime] = useState("08:00:00");
  const [shiftEndTime, setShiftEndTime] = useState("17:00:00");
  const [shiftBreakMinutes, setShiftBreakMinutes] = useState("60");
  const [shiftIsOvernight, setShiftIsOvernight] = useState(false);

  // Roster Form
  const [rosterEmployeeId, setRosterEmployeeId] = useState("");
  const [rosterShiftId, setRosterShiftId] = useState("");
  const [rosterDate, setRosterDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [rosterNotes, setRosterNotes] = useState("");

  // Attendance Form
  const [attEmployeeId, setAttEmployeeId] = useState("");
  const [attDate, setAttDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [attShiftId, setAttShiftId] = useState("");
  const [attClockIn, setAttClockIn] = useState("");
  const [attClockOut, setAttClockOut] = useState("");
  const [attStatus, setAttStatus] = useState<WorkforceAttendanceStatus>("present");
  const [attSource, setAttSource] = useState<WorkforceAttendanceSource>("manual");
  const [attNotes, setAttNotes] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [empList, shiftList, rosterList, attendanceList] = await Promise.all([
        api.employees(token).catch(() => [] as Employee[]),
        api.workforceShifts(token, true),
        api.workforceRosters(token, {
          employeeId: filterEmployeeId || undefined,
          fromDate: filterFromDate || undefined,
          toDate: filterToDate || undefined,
        }),
        api.workforceAttendance(token, {
          employeeId: filterEmployeeId || undefined,
          status: (filterStatus as WorkforceAttendanceStatus) || undefined,
          fromDate: filterFromDate || undefined,
          toDate: filterToDate || undefined,
        }),
      ]);
      setEmployees(empList);
      setShifts(shiftList);
      setRosters(rosterList);
      setAttendanceRecords(attendanceList);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not load attendance & roster data.");
    } finally {
      setLoading(false);
    }
  }, [token, filterEmployeeId, filterStatus, filterFromDate, filterToDate]);

  useEffect(() => {
    void load();
  }, [load]);

  const employeeName = useMemo(
    () => (id: string | null) => {
      if (!id) return "—";
      const emp = employees.find((e) => e.id === id);
      return emp ? `${emp.fullName} (${emp.employeeNumber})` : id;
    },
    [employees],
  );

  const shiftLabel = useMemo(
    () => (id: string | null) => {
      if (!id) return "—";
      const s = shifts.find((x) => x.id === id);
      return s ? `${s.name} (${s.startTime}–${s.endTime})` : id;
    },
    [shifts],
  );

  async function handleCreateShift() {
    if (!canManage) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const created = await api.createWorkforceShift(token, {
        shiftCode,
        name: shiftName,
        startTime: shiftStartTime,
        endTime: shiftEndTime,
        breakMinutes: Number(shiftBreakMinutes) || 0,
        isOvernight: shiftIsOvernight,
      });
      setNotice(`Shift ${created.name} (${created.shiftCode}) created successfully.`);
      setShiftCode("");
      setShiftName("");
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to create shift.");
    } finally {
      setBusy(false);
    }
  }

  async function handleToggleShiftActive(shift: WorkforceShift) {
    if (!canManage) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const updated = await api.setWorkforceShiftActive(token, shift.id, !shift.isActive);
      setNotice(`Shift ${updated.shiftCode} is now ${updated.isActive ? "active" : "inactive"}.`);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to update shift status.");
    } finally {
      setBusy(false);
    }
  }

  async function handleUpsertRoster() {
    if (!canManage) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await api.upsertWorkforceRoster(token, {
        employeeId: rosterEmployeeId,
        shiftId: rosterShiftId,
        rosterDate,
        notes: rosterNotes || null,
      });
      setNotice(`Roster updated for date ${rosterDate}.`);
      setRosterNotes("");
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to assign roster.");
    } finally {
      setBusy(false);
    }
  }

  async function handleRecordAttendance() {
    if (!canManage) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await api.recordWorkforceAttendance(token, {
        employeeId: attEmployeeId,
        attendanceDate: attDate,
        shiftId: attShiftId || null,
        clockIn: attClockIn ? new Date(attClockIn).toISOString() : null,
        clockOut: attClockOut ? new Date(attClockOut).toISOString() : null,
        status: attStatus,
        source: attSource,
        notes: attNotes || null,
      });
      setNotice(`Attendance recorded for employee for date ${attDate}.`);
      setAttClockIn("");
      setAttClockOut("");
      setAttNotes("");
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to record attendance.");
    } finally {
      setBusy(false);
    }
  }

  const attendanceColumns: Column<WorkforceAttendanceRecord>[] = [
    {
      header: "Date",
      cell: (row) => (
        <div>
          <span className="font-semibold text-slate-900">{formatDateShort(row.attendanceDate)}</span>
          <div className="text-xs text-slate-500">{employeeName(row.employeeId)}</div>
        </div>
      ),
      mobileRole: "title",
    },
    {
      header: "Status",
      cell: (row) => <StatusPill tone={statusTone(row.status)}>{label(row.status)}</StatusPill>,
      mobileRole: "status",
    },
    { header: "Shift", cell: (row) => shiftLabel(row.shiftId) },
    {
      header: "Clock In / Out",
      cell: (row) => (
        <span className="font-mono text-xs">
          {row.clockIn ? formatDate(row.clockIn) : "—"} / {row.clockOut ? formatDate(row.clockOut) : "—"}
        </span>
      ),
    },
    {
      header: "Variances",
      cell: (row) => (
        <div className="text-xs space-y-0.5">
          {row.lateMinutes > 0 && <Badge className="bg-amber-50 text-amber-700">Late: {row.lateMinutes}m</Badge>}
          {row.earlyOutMinutes > 0 && <Badge className="bg-red-50 text-red-700">Early out: {row.earlyOutMinutes}m</Badge>}
          {row.lateMinutes === 0 && row.earlyOutMinutes === 0 && <span className="text-slate-400">On time</span>}
        </div>
      ),
    },
    { header: "Source", cell: (row) => <Badge>{label(row.source)}</Badge> },
  ];

  const rosterColumns: Column<WorkforceRoster>[] = [
    {
      header: "Employee",
      cell: (row) => (
        <div>
          <span className="font-semibold text-slate-900">{employeeName(row.employeeId)}</span>
          <div className="text-xs text-slate-500">{row.notes || "No notes"}</div>
        </div>
      ),
      mobileRole: "title",
    },
    { header: "Date", cell: (row) => formatDateShort(row.rosterDate), mobileRole: "status" },
    { header: "Assigned Shift", cell: (row) => <Badge>{shiftLabel(row.shiftId)}</Badge> },
  ];

  const shiftColumns: Column<WorkforceShift>[] = [
    {
      header: "Shift Code",
      cell: (row) => (
        <div>
          <span className="font-semibold text-slate-900">{row.name}</span>
          <div className="font-mono text-xs text-slate-500">{row.shiftCode}</div>
        </div>
      ),
      mobileRole: "title",
    },
    {
      header: "Schedule",
      cell: (row) => (
        <span className="font-mono text-xs">
          {row.startTime} – {row.endTime} {row.isOvernight ? "(Overnight)" : ""}
        </span>
      ),
    },
    { header: "Break", cell: (row) => `${row.breakMinutes} mins` },
    {
      header: "Status",
      cell: (row) => <StatusPill tone={row.isActive ? "success" : "neutral"}>{row.isActive ? "Active" : "Inactive"}</StatusPill>,
      mobileRole: "status",
    },
    {
      header: "Actions",
      cell: (row) =>
        canManage ? (
          <Button
            variant="ghost"
            disabled={busy}
            onClick={() => void handleToggleShiftActive(row)}
            className="text-xs"
          >
            {row.isActive ? "Deactivate" : "Activate"}
          </Button>
        ) : null,
    },
  ];

  return (
    <div className="space-y-4">
      <PageHeader
        title="Attendance & Rosters"
        subtitle="Configure work shifts, publish daily employee rosters, and maintain operational attendance records."
      />

      {error ? <Alert tone="error">{error}</Alert> : null}
      {notice ? <Alert tone="success">{notice}</Alert> : null}
      {!canManage ? (
        <Alert tone="info">
          You are viewing in read-only mode. Creating shifts, updating rosters, and recording attendance requires{" "}
          <code className="font-mono text-xs">workforce.attendance.manage</code>.
        </Alert>
      ) : null}

      <div className="flex border-b border-slate-200 text-sm font-medium">
        <button
          type="button"
          onClick={() => setActiveTab("attendance")}
          className={`px-4 py-2 border-b-2 transition-colors ${
            activeTab === "attendance"
              ? "border-slate-900 text-slate-900 font-semibold"
              : "border-transparent text-slate-500 hover:text-slate-700"
          }`}
        >
          Attendance Logs ({attendanceRecords.length})
        </button>
        <button
          type="button"
          onClick={() => setActiveTab("rosters")}
          className={`px-4 py-2 border-b-2 transition-colors ${
            activeTab === "rosters"
              ? "border-slate-900 text-slate-900 font-semibold"
              : "border-transparent text-slate-500 hover:text-slate-700"
          }`}
        >
          Rosters ({rosters.length})
        </button>
        <button
          type="button"
          onClick={() => setActiveTab("shifts")}
          className={`px-4 py-2 border-b-2 transition-colors ${
            activeTab === "shifts"
              ? "border-slate-900 text-slate-900 font-semibold"
              : "border-transparent text-slate-500 hover:text-slate-700"
          }`}
        >
          Work Shifts ({shifts.length})
        </button>
      </div>

      <Card>
        <h2 className="mb-3 text-sm font-semibold text-slate-800">Filter Criteria</h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Employee">
            <Select value={filterEmployeeId} onChange={(e) => setFilterEmployeeId(e.target.value)}>
              <option value="">All employees</option>
              {employees.map((emp) => (
                <option key={emp.id} value={emp.id}>
                  {emp.fullName} ({emp.employeeNumber})
                </option>
              ))}
            </Select>
          </Field>
          {activeTab === "attendance" && (
            <Field label="Status">
              <Select value={filterStatus} onChange={(e) => setFilterStatus(e.target.value as WorkforceAttendanceStatus)}>
                <option value="">All statuses</option>
                {ATTENDANCE_STATUSES.map((st) => (
                  <option key={st} value={st}>{label(st)}</option>
                ))}
              </Select>
            </Field>
          )}
          <Field label="From Date">
            <Input type="date" value={filterFromDate} onChange={(e) => setFilterFromDate(e.target.value)} />
          </Field>
          <Field label="To Date">
            <Input type="date" value={filterToDate} onChange={(e) => setFilterToDate(e.target.value)} />
          </Field>
        </div>
      </Card>

      {canManage && (
        <>
          {activeTab === "attendance" && (
            <Card>
              <h2 className="mb-3 text-sm font-semibold text-slate-800">Record Daily Attendance</h2>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <Field label="Employee" required>
                  <Select value={attEmployeeId} onChange={(e) => setAttEmployeeId(e.target.value)}>
                    <option value="">Select employee</option>
                    {employees.map((emp) => (
                      <option key={emp.id} value={emp.id}>{emp.fullName} ({emp.employeeNumber})</option>
                    ))}
                  </Select>
                </Field>
                <Field label="Attendance Date" required>
                  <Input type="date" value={attDate} onChange={(e) => setAttDate(e.target.value)} />
                </Field>
                <Field label="Shift">
                  <Select value={attShiftId} onChange={(e) => setAttShiftId(e.target.value)}>
                    <option value="">No shift / Default</option>
                    {shifts.filter((s) => s.isActive).map((s) => (
                      <option key={s.id} value={s.id}>{s.name} ({s.shiftCode})</option>
                    ))}
                  </Select>
                </Field>
                <Field label="Status">
                  <Select value={attStatus} onChange={(e) => setAttStatus(e.target.value as WorkforceAttendanceStatus)}>
                    {ATTENDANCE_STATUSES.map((st) => (
                      <option key={st} value={st}>{label(st)}</option>
                    ))}
                  </Select>
                </Field>
                <Field label="Clock In (ISO / Time)">
                  <Input type="datetime-local" value={attClockIn} onChange={(e) => setAttClockIn(e.target.value)} />
                </Field>
                <Field label="Clock Out (ISO / Time)">
                  <Input type="datetime-local" value={attClockOut} onChange={(e) => setAttClockOut(e.target.value)} />
                </Field>
                <Field label="Source">
                  <Select value={attSource} onChange={(e) => setAttSource(e.target.value as WorkforceAttendanceSource)}>
                    {ATTENDANCE_SOURCES.map((src) => (
                      <option key={src} value={src}>{label(src)}</option>
                    ))}
                  </Select>
                </Field>
                <div className="sm:col-span-2 lg:col-span-4">
                  <Field label="Notes">
                    <Input value={attNotes} onChange={(e) => setAttNotes(e.target.value)} placeholder="Optional attendance notes" />
                  </Field>
                </div>
              </div>
              <div className="mt-3">
                <Button disabled={busy || !attEmployeeId || !attDate} onClick={() => void handleRecordAttendance()}>
                  Save Attendance Record
                </Button>
              </div>
            </Card>
          )}

          {activeTab === "rosters" && (
            <Card>
              <h2 className="mb-3 text-sm font-semibold text-slate-800">Assign Employee Roster</h2>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <Field label="Employee" required>
                  <Select value={rosterEmployeeId} onChange={(e) => setRosterEmployeeId(e.target.value)}>
                    <option value="">Select employee</option>
                    {employees.map((emp) => (
                      <option key={emp.id} value={emp.id}>{emp.fullName} ({emp.employeeNumber})</option>
                    ))}
                  </Select>
                </Field>
                <Field label="Shift" required>
                  <Select value={rosterShiftId} onChange={(e) => setRosterShiftId(e.target.value)}>
                    <option value="">Select shift</option>
                    {shifts.filter((s) => s.isActive).map((s) => (
                      <option key={s.id} value={s.id}>{s.name} ({s.shiftCode})</option>
                    ))}
                  </Select>
                </Field>
                <Field label="Roster Date" required>
                  <Input type="date" value={rosterDate} onChange={(e) => setRosterDate(e.target.value)} />
                </Field>
                <div className="sm:col-span-3">
                  <Field label="Notes">
                    <Input value={rosterNotes} onChange={(e) => setRosterNotes(e.target.value)} placeholder="Roster allocation notes" />
                  </Field>
                </div>
              </div>
              <div className="mt-3">
                <Button disabled={busy || !rosterEmployeeId || !rosterShiftId || !rosterDate} onClick={() => void handleUpsertRoster()}>
                  Save Roster Assignment
                </Button>
              </div>
            </Card>
          )}

          {activeTab === "shifts" && (
            <Card>
              <h2 className="mb-3 text-sm font-semibold text-slate-800">Create Work Shift</h2>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                <Field label="Shift Code" required>
                  <Input value={shiftCode} onChange={(e) => setShiftCode(e.target.value)} placeholder="SHIFT_MORNING" />
                </Field>
                <Field label="Shift Name" required>
                  <Input value={shiftName} onChange={(e) => setShiftName(e.target.value)} placeholder="Morning Standard" />
                </Field>
                <Field label="Start Time (HH:MM:SS)" required>
                  <Input value={shiftStartTime} onChange={(e) => setShiftStartTime(e.target.value)} placeholder="08:00:00" />
                </Field>
                <Field label="End Time (HH:MM:SS)" required>
                  <Input value={shiftEndTime} onChange={(e) => setShiftEndTime(e.target.value)} placeholder="17:00:00" />
                </Field>
                <Field label="Break Minutes">
                  <Input type="number" min="0" value={shiftBreakMinutes} onChange={(e) => setShiftBreakMinutes(e.target.value)} />
                </Field>
                <div className="flex items-center pt-6">
                  <label className="flex items-center gap-2 text-sm text-slate-700 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={shiftIsOvernight}
                      onChange={(e) => setShiftIsOvernight(e.target.checked)}
                      className="rounded border-slate-300"
                    />
                    <span>Is Overnight Shift</span>
                  </label>
                </div>
              </div>
              <div className="mt-3">
                <Button disabled={busy || !shiftCode || !shiftName || !shiftStartTime || !shiftEndTime} onClick={() => void handleCreateShift()}>
                  Create Shift
                </Button>
              </div>
            </Card>
          )}
        </>
      )}

      {loading ? (
        <Spinner label="Loading records…" />
      ) : (
        <>
          {activeTab === "attendance" && (
            <Card>
              <h2 className="mb-3 text-sm font-semibold text-slate-800">Attendance Records</h2>
              <DataTable
                columns={attendanceColumns}
                rows={attendanceRecords}
                keyOf={(row) => row.id}
                empty={<EmptyState title="No attendance records found" description="Adjust your filters or record attendance above." />}
              />
            </Card>
          )}

          {activeTab === "rosters" && (
            <Card>
              <h2 className="mb-3 text-sm font-semibold text-slate-800">Assigned Rosters</h2>
              <DataTable
                columns={rosterColumns}
                rows={rosters}
                keyOf={(row) => row.id}
                empty={<EmptyState title="No roster assignments found" description="Assign employees to shifts above." />}
              />
            </Card>
          )}

          {activeTab === "shifts" && (
            <Card>
              <h2 className="mb-3 text-sm font-semibold text-slate-800">Configured Work Shifts</h2>
              <DataTable
                columns={shiftColumns}
                rows={shifts}
                keyOf={(row) => row.id}
                empty={<EmptyState title="No shifts defined" description="Create standard or overnight shifts above." />}
              />
            </Card>
          )}
        </>
      )}
    </div>
  );
}
