/** Wave A4 — statutory policies, employee salary profiles, payroll runs, calculation, and payslips. */
import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "../../auth/AuthContext";
import {
  api,
  ApiError,
  type Employee,
  type WorkforceEmployeeSalaryProfile,
  type WorkforcePayrollCalculation,
  type WorkforcePayrollRunDetail,
  type WorkforcePayrollRunRow,
  type WorkforcePayslip,
  type WorkforcePtkpStatus,
  type WorkforceStatutoryPolicy,
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
  type Column,
} from "../../shell/components/ui";
import { formatDateShort, formatMoney, statusTone } from "../../shared/format";

const PTKP_OPTIONS: WorkforcePtkpStatus[] = [
  "TK/0",
  "TK/1",
  "TK/2",
  "TK/3",
  "K/0",
  "K/1",
  "K/2",
  "K/3",
];

function label(value: string): string {
  return value.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());
}

function workflowLabel(status: WorkforceWorkflowStatus | null): string {
  return status?.stepName ?? status?.stepCode ?? (status ? label(status.instanceStatus) : "Draft");
}

function money(amount: number | string | null | undefined): string {
  if (amount == null) return "—";
  return formatMoney(String(amount));
}

export function WorkforcePayrollPage() {
  const { session } = useAuth();
  const token = session!.accessToken;
  const { permissions } = useShell();
  const canManage = permissions.includes(PERMISSIONS.workforcePayrollManage);
  const canApprove = permissions.includes(PERMISSIONS.workforcePayrollApprove);

  const [tab, setTab] = useState<"runs" | "profiles" | "policies">("runs");
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [policies, setPolicies] = useState<WorkforceStatutoryPolicy[]>([]);
  const [runs, setRuns] = useState<WorkforcePayrollRunRow[]>([]);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [runDetail, setRunDetail] = useState<WorkforcePayrollRunDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [yearFilter, setYearFilter] = useState(String(new Date().getFullYear()));
  const [unitFilter, setUnitFilter] = useState("");

  const [policyCode, setPolicyCode] = useState("");
  const [policyName, setPolicyName] = useState("");
  const [effectiveFromPolicy, setEffectiveFromPolicy] = useState(() => `${new Date().getFullYear()}-01-01`);

  const [profileEmployee, setProfileEmployee] = useState("");
  const [baseSalary, setBaseSalary] = useState("5000000");
  const [fixedAllowance, setFixedAllowance] = useState("0");
  const [overtimeRate, setOvertimeRate] = useState("");
  const [ptkpStatus, setPtkpStatus] = useState<WorkforcePtkpStatus>("TK/0");
  const [hasNpwp, setHasNpwp] = useState(true);
  const [bpjsKesNumber, setBpjsKesNumber] = useState("");
  const [bpjsTkNumber, setBpjsTkNumber] = useState("");
  const [bankName, setBankName] = useState("");
  const [bankAccount, setBankAccount] = useState("");
  const [profileEffectiveFrom, setProfileEffectiveFrom] = useState(() => `${new Date().getFullYear()}-01-01`);
  const [savedProfiles, setSavedProfiles] = useState<Record<string, WorkforceEmployeeSalaryProfile>>({});

  const [runMonth, setRunMonth] = useState(String(new Date().getMonth() + 1));
  const [runYear, setRunYear] = useState(String(new Date().getFullYear()));
  const [runUnit, setRunUnit] = useState("");
  const [actionComment, setActionComment] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [employeeList, policyList, runList] = await Promise.all([
        api.employees(token).catch(() => [] as Employee[]),
        api.workforceStatutoryPolicies(token),
        api.workforcePayrollRuns(token, {
          periodYear: Number(yearFilter) || undefined,
          organizationUnitId: unitFilter || undefined,
        }),
      ]);
      setEmployees(employeeList);
      setPolicies(policyList);
      setRuns(runList);
      if (selectedRunId) {
        try {
          setRunDetail(await api.workforcePayrollRun(token, selectedRunId));
        } catch {
          setRunDetail(null);
        }
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not load payroll records.");
    } finally {
      setLoading(false);
    }
  }, [token, yearFilter, unitFilter, selectedRunId]);

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

  async function runAction(action: () => Promise<unknown>, message: string) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await action();
      setNotice(message);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Payroll operation failed.");
    } finally {
      setBusy(false);
    }
  }

  async function createPolicy() {
    await runAction(
      () => api.createWorkforceStatutoryPolicy(token, {
        policyCode: policyCode.trim(),
        name: policyName.trim(),
        effectiveFrom: effectiveFromPolicy,
      }),
      `Statutory policy ${policyName} created.`,
    );
    setPolicyCode("");
    setPolicyName("");
  }

  async function saveProfile() {
    await runAction(async () => {
      const saved = await api.setWorkforceSalaryProfile(token, {
        employeeId: profileEmployee,
        baseSalary: Number(baseSalary),
        fixedAllowance: Number(fixedAllowance) || 0,
        overtimeHourlyRate: overtimeRate ? Number(overtimeRate) : null,
        ptkpStatus,
        hasNpwp,
        bpjsKesehatanNumber: bpjsKesNumber || null,
        bpjsTkNumber: bpjsTkNumber || null,
        bankName: bankName || null,
        bankAccountNumber: bankAccount || null,
        effectiveFrom: profileEffectiveFrom,
      });
      setSavedProfiles((current) => ({ ...current, [profileEmployee]: saved }));
    }, "Salary profile saved.");
  }

  async function createRun() {
    await runAction(
      () => api.createWorkforcePayrollRun(token, {
        periodMonth: Number(runMonth),
        periodYear: Number(runYear),
        organizationUnitId: runUnit || null,
      }),
      "Payroll period created.",
    );
  }

  async function calculateRun(id: string) {
    await runAction(async () => {
      const result: WorkforcePayrollCalculation = await api.calculateWorkforcePayrollRun(token, id);
      setSelectedRunId(id);
      setRunDetail(await api.workforcePayrollRun(token, id));
      return result;
    }, "Payroll calculation finished.");
  }

  async function executeWorkflow(actionCode: string) {
    if (!selectedRunId) return;
    await runAction(
      () => api.actOnWorkforcePayrollRun(token, selectedRunId, actionCode, actionComment || null),
      `Workflow action ${label(actionCode)} executed.`,
    );
    setActionComment("");
  }

  const runColumns: Column<WorkforcePayrollRunRow>[] = [
    {
      header: "Payroll Run",
      cell: ({ payrollRun }) => (
        <div>
          <div className="font-semibold text-slate-900">{payrollRun.runNumber}</div>
          <div className="text-xs text-slate-500">{payrollRun.periodMonth}/{payrollRun.periodYear}</div>
        </div>
      ),
      mobileRole: "title",
    },
    { header: "Employees", cell: ({ payrollRun }) => payrollRun.employeeCount },
    { header: "Total gross", cell: ({ payrollRun }) => money(payrollRun.totalGross) },
    { header: "Total deductions", cell: ({ payrollRun }) => money(payrollRun.totalDeductions) },
    { header: "Total net", cell: ({ payrollRun }) => <span className="font-semibold text-slate-900">{money(payrollRun.totalNet)}</span> },
    {
      header: "Status",
      cell: ({ status, payrollRun }) => (
        <StatusPill tone={statusTone(status?.instanceStatus)}>
          {payrollRun.closedAt ? "Closed" : workflowLabel(status)}
        </StatusPill>
      ),
      mobileRole: "status",
    },
    {
      header: "Actions",
      cell: ({ payrollRun }) => (
        <div className="flex flex-wrap gap-1" onClick={(event) => event.stopPropagation()}>
          <Button
            variant="secondary"
            className="text-xs"
            onClick={async () => {
              setSelectedRunId(payrollRun.id);
              try {
                setRunDetail(await api.workforcePayrollRun(token, payrollRun.id));
              } catch {
                setRunDetail(null);
              }
            }}
          >
            Details
          </Button>
          {canManage && !payrollRun.closedAt ? (
            <Button variant="secondary" className="text-xs" disabled={busy} onClick={() => void calculateRun(payrollRun.id)}>
              Calculate
            </Button>
          ) : null}
        </div>
      ),
    },
  ];

  const payslipColumns: Column<WorkforcePayslip>[] = [
    { header: "Employee", cell: (row) => <span className="font-semibold">{employeeName(row.employeeId)}</span>, mobileRole: "title" },
    { header: "PTKP", cell: (row) => <Badge>{row.ptkpStatus ?? "TK/0"}</Badge> },
    { header: "Base salary", cell: (row) => money(row.baseSalary) },
    { header: "Allowances", cell: (row) => money(row.allowances) },
    { header: "Gross", cell: (row) => money(row.grossSalary) },
    { header: "PPh 21", cell: (row) => money(row.pph21Withheld) },
    { header: "Deductions", cell: (row) => money(row.totalDeductions) },
    { header: "Net payout", cell: (row) => <span className="font-bold text-slate-900">{money(row.netSalary)}</span>, mobileRole: "status" },
  ];

  const policyColumns: Column<WorkforceStatutoryPolicy>[] = [
    {
      header: "Policy",
      cell: (row) => (
        <div>
          <div className="font-semibold text-slate-900">{row.name}</div>
          <div className="font-mono text-xs text-slate-500">{row.policyCode}</div>
        </div>
      ),
      mobileRole: "title",
    },
    { header: "Method", cell: (row) => label(row.pph21Method) },
    { header: "BPJS Kes (EE/ER)", cell: (row) => `${(row.bpjsKesehatanRateEmployee * 100).toFixed(1)}% / ${(row.bpjsKesehatanRateEmployer * 100).toFixed(1)}%` },
    { header: "BPJS TK JHT (EE/ER)", cell: (row) => `${(row.bpjsTkJhtRateEmployee * 100).toFixed(1)}% / ${(row.bpjsTkJhtRateEmployer * 100).toFixed(1)}%` },
    { header: "Effective from", cell: (row) => formatDateShort(row.effectiveFrom) },
    { header: "Status", cell: (row) => <StatusPill tone={row.isActive ? "success" : "neutral"}>{row.isActive ? "Active" : "Inactive"}</StatusPill>, mobileRole: "status" },
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
      <PageHeader title="Payroll" subtitle="Manage Indonesian statutory payroll policies, employee compensation profiles, calculations, and payslip runs." />
      {error ? <Alert tone="error">{error}</Alert> : null}
      {notice ? <Alert tone="success">{notice}</Alert> : null}
      {!canManage ? <Alert tone="info">Setting profiles, running payroll, and recalculations require <code className="font-mono text-xs">workforce.payroll.manage</code>.</Alert> : null}
      {!canApprove ? <Alert tone="info">Payroll approvals and closing periods require <code className="font-mono text-xs">workforce.payroll.approve</code>.</Alert> : null}

      <div className="flex overflow-x-auto border-b border-slate-200">
        {tabButton("runs", `Payroll runs (${runs.length})`)}
        {tabButton("profiles", "Salary profiles")}
        {tabButton("policies", `Statutory policies (${policies.length})`)}
      </div>

      <Card>
        <h2 className="mb-3 text-sm font-semibold text-slate-800">Scope Filters</h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Period year"><Input type="number" min="2000" max="2100" value={yearFilter} onChange={(event) => setYearFilter(event.target.value)} /></Field>
          <Field label="Organization unit ID"><Input value={unitFilter} onChange={(event) => setUnitFilter(event.target.value)} placeholder="All organization units" /></Field>
        </div>
      </Card>

      {canManage && tab === "runs" ? (
        <Card>
          <h2 className="mb-3 text-sm font-semibold text-slate-800">Create Payroll Run</h2>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Field label="Month" required><Input type="number" min="1" max="12" value={runMonth} onChange={(event) => setRunMonth(event.target.value)} /></Field>
            <Field label="Year" required><Input type="number" min="2000" max="2100" value={runYear} onChange={(event) => setRunYear(event.target.value)} /></Field>
            <Field label="Organization unit ID"><Input value={runUnit} onChange={(event) => setRunUnit(event.target.value)} placeholder="Optional scope" /></Field>
          </div>
          <Button className="mt-3" disabled={busy || !runMonth || !runYear} onClick={() => void createRun()}>Create payroll period</Button>
        </Card>
      ) : null}

      {canManage && tab === "profiles" ? (
        <Card>
          <h2 className="mb-3 text-sm font-semibold text-slate-800">Configure Employee Salary Profile</h2>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Field label="Employee" required><Select value={profileEmployee} onChange={(event) => setProfileEmployee(event.target.value)}><option value="">Select employee</option>{employees.map((employee) => <option key={employee.id} value={employee.id}>{employee.fullName}</option>)}</Select></Field>
            <Field label="Base salary" required><Input type="number" min="0" step="1000" value={baseSalary} onChange={(event) => setBaseSalary(event.target.value)} /></Field>
            <Field label="Fixed allowance"><Input type="number" min="0" step="1000" value={fixedAllowance} onChange={(event) => setFixedAllowance(event.target.value)} /></Field>
            <Field label="Overtime hourly rate"><Input type="number" min="0" step="1000" value={overtimeRate} onChange={(event) => setOvertimeRate(event.target.value)} placeholder="Auto-calculated if blank" /></Field>
            <Field label="PTKP status" required><Select value={ptkpStatus} onChange={(event) => setPtkpStatus(event.target.value as WorkforcePtkpStatus)}>{PTKP_OPTIONS.map((status) => <option key={status} value={status}>{status}</option>)}</Select></Field>
            <Field label="BPJS Kesehatan number"><Input value={bpjsKesNumber} onChange={(event) => setBpjsKesNumber(event.target.value)} /></Field>
            <Field label="BPJS Ketenagakerjaan number"><Input value={bpjsTkNumber} onChange={(event) => setBpjsTkNumber(event.target.value)} /></Field>
            <Field label="Effective from" required><Input type="date" value={profileEffectiveFrom} onChange={(event) => setProfileEffectiveFrom(event.target.value)} /></Field>
            <Field label="Bank name"><Input value={bankName} onChange={(event) => setBankName(event.target.value)} placeholder="BCA / Mandiri / BNI" /></Field>
            <Field label="Bank account number"><Input value={bankAccount} onChange={(event) => setBankAccount(event.target.value)} /></Field>
            <div className="flex items-center pt-6"><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={hasNpwp} onChange={(event) => setHasNpwp(event.target.checked)} />Has registered NPWP</label></div>
          </div>
          <Button className="mt-3" disabled={busy || !profileEmployee || Number(baseSalary) <= 0 || !profileEffectiveFrom} onClick={() => void saveProfile()}>Save salary profile</Button>
          {profileEmployee && savedProfiles[profileEmployee] ? (
            <div className="mt-3 rounded border border-slate-200 bg-slate-50 p-3 text-xs text-slate-700">
              <span className="font-semibold">Last saved profile:</span> Base {money(savedProfiles[profileEmployee].baseSalary)} | Allowance {money(savedProfiles[profileEmployee].fixedAllowance)} | PTKP {savedProfiles[profileEmployee].ptkpStatus}
            </div>
          ) : null}
        </Card>
      ) : null}

      {canManage && tab === "policies" ? (
        <Card>
          <h2 className="mb-3 text-sm font-semibold text-slate-800">Create Statutory Policy</h2>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Field label="Policy code" required><Input value={policyCode} onChange={(event) => setPolicyCode(event.target.value)} placeholder="ID_STATUTORY_2026" /></Field>
            <Field label="Policy name" required><Input value={policyName} onChange={(event) => setPolicyName(event.target.value)} placeholder="Indonesia Standard 2026" /></Field>
            <Field label="Effective from" required><Input type="date" value={effectiveFromPolicy} onChange={(event) => setEffectiveFromPolicy(event.target.value)} /></Field>
          </div>
          <Button className="mt-3" disabled={busy || !policyCode.trim() || !policyName.trim()} onClick={() => void createPolicy()}>Create statutory policy</Button>
        </Card>
      ) : null}

      {loading ? <Spinner label="Loading payroll data…" /> : (
        <>
          {tab === "runs" ? (
            <div className="space-y-4">
              <Card>
                <h2 className="mb-3 text-sm font-semibold text-slate-800">Payroll Runs</h2>
                <DataTable columns={runColumns} rows={runs} keyOf={(row) => row.payrollRun.id} mobileBreakpoint="md" empty={<EmptyState title="No payroll runs" description="Create a monthly period above to start calculation." />} />
              </Card>

              {runDetail ? (
                <Card>
                  <div className="mb-3 flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-3">
                    <div>
                      <h3 className="text-base font-semibold text-slate-900">{runDetail.payrollRun.runNumber} — Period {runDetail.payrollRun.periodMonth}/{runDetail.payrollRun.periodYear}</h3>
                      <div className="text-xs text-slate-500">Gross {money(runDetail.payrollRun.totalGross)} | Deductions {money(runDetail.payrollRun.totalDeductions)} | Net payout {money(runDetail.payrollRun.totalNet)}</div>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <StatusPill tone={statusTone(runDetail.status?.instanceStatus)}>{runDetail.payrollRun.closedAt ? "Closed" : workflowLabel(runDetail.status)}</StatusPill>
                      {canApprove && runDetail.availableActions.map((action) => (
                        <Button key={action.actionCode} variant="secondary" className="text-xs" disabled={busy} onClick={() => void executeWorkflow(action.actionCode)}>
                          {action.name}
                        </Button>
                      ))}
                    </div>
                  </div>
                  {canApprove && runDetail.availableActions.length > 0 ? (
                    <div className="mb-4 max-w-md">
                      <Field label="Approval comment"><Input value={actionComment} onChange={(event) => setActionComment(event.target.value)} placeholder="Reason or sign-off comment" /></Field>
                    </div>
                  ) : null}
                  <h4 className="mb-2 text-sm font-semibold text-slate-800">Generated Payslips ({runDetail.payslips.length})</h4>
                  <DataTable columns={payslipColumns} rows={runDetail.payslips} keyOf={(row) => row.id} mobileBreakpoint="md" empty={<EmptyState title="No payslips generated" description="Click Calculate on the payroll run to compute payslips." />} />
                </Card>
              ) : null}
            </div>
          ) : null}

          {tab === "policies" ? (
            <Card>
              <h2 className="mb-3 text-sm font-semibold text-slate-800">Configured Statutory Policies</h2>
              <DataTable columns={policyColumns} rows={policies} keyOf={(row) => row.id} empty={<EmptyState title="No statutory policies" description="Create the baseline policy above." />} />
            </Card>
          ) : null}
        </>
      )}
    </div>
  );
}
