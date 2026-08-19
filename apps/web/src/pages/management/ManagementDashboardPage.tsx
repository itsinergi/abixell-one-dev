/**
 * Checkpoint 1C.5 — Management Dashboard & Action Center.
 *
 * Answers: what is the current state, where is the risk, and what needs
 * action now. All figures come from the backend aggregate read-model
 * (permission-gated + Data-Scope-aware); the Action Center drills into the
 * authorized complaint detail. No decorative metrics — satisfaction and
 * structured root cause are intentionally absent (deferred to 1D/1E and a
 * future taxonomy decision).
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../../auth/AuthContext";
import {
  api,
  ApiError,
  type BreakdownRow,
  type Customer,
  type DashboardResult,
} from "../../lib/api";
import {
  Alert,
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
import { severityTone, formatDate } from "../complaints/format";
import type { ActionCenterItem } from "../../lib/api";

function toDateInput(iso: string): string {
  return new Date(iso).toISOString().slice(0, 10);
}

function BarList({ rows, emptyLabel }: { rows: BreakdownRow[]; emptyLabel: string }) {
  const max = Math.max(1, ...rows.map((r) => r.count));
  if (rows.length === 0) return <p className="text-sm text-slate-400">{emptyLabel}</p>;
  return (
    <ul className="space-y-2">
      {rows.map((r) => (
        <li key={r.key}>
          <div className="flex items-center justify-between text-sm">
            <span className="truncate text-slate-600">{r.label}</span>
            <span className="ml-2 shrink-0 font-medium text-slate-800">{r.count}</span>
          </div>
          <div className="mt-1 h-1.5 w-full rounded-full bg-slate-100">
            <div
              className="h-1.5 rounded-full bg-slate-400"
              style={{ width: `${Math.round((r.count / max) * 100)}%` }}
            />
          </div>
        </li>
      ))}
    </ul>
  );
}

function Kpi({ label, value, tone }: { label: string; value: string | number; tone?: "danger" | "warning" }) {
  const color = tone === "danger" ? "text-red-600" : tone === "warning" ? "text-amber-600" : "text-slate-800";
  return (
    <Card className="p-3">
      <div className="text-xs text-slate-400">{label}</div>
      <div className={`text-2xl font-semibold ${color}`}>{value}</div>
    </Card>
  );
}

export function ManagementDashboardPage() {
  const { session } = useAuth();
  const token = session!.accessToken;
  const navigate = useNavigate();

  const [customers, setCustomers] = useState<Customer[]>([]);
  const [filters, setFilters] = useState<{ from: string; to: string; customerId: string; severity: string }>(
    () => {
      const to = new Date();
      const from = new Date(to.getTime() - 30 * 24 * 60 * 60 * 1000);
      return { from: toDateInput(from.toISOString()), to: toDateInput(to.toISOString()), customerId: "", severity: "" };
    },
  );
  const [data, setData] = useState<DashboardResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // Customers for the filter — best-effort (manager holds customer.read).
    api.customers(token).then(setCustomers).catch(() => setCustomers([]));
  }, [token]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.complaintDashboard(token, {
        // Send the 'to' as end-of-day so the selected day is inclusive.
        from: new Date(filters.from + "T00:00:00").toISOString(),
        to: new Date(filters.to + "T23:59:59").toISOString(),
        customerId: filters.customerId || undefined,
        severity: filters.severity || undefined,
      });
      setData(res);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to load the dashboard");
    } finally {
      setLoading(false);
    }
  }, [token, filters]);

  useEffect(() => {
    load();
  }, [load]);

  const actionColumns: Column<ActionCenterItem>[] = useMemo(
    () => [
      {
        header: "Number",
        cell: (i) => <span className="font-mono font-medium text-slate-800">{i.complaintNumber}</span>,
      },
      { header: "Customer", cell: (i) => i.customerName ?? "—" },
      {
        header: "Severity",
        cell: (i) => <StatusPill tone={severityTone(i.severity)}>{i.severity}</StatusPill>,
      },
      { header: "Stage", cell: (i) => i.stepName ?? "—" },
      {
        header: "Attention",
        cell: (i) => (
          <div className="flex flex-wrap gap-1">
            {i.overdue && <StatusPill tone="danger">Overdue</StatusPill>}
            {i.critical && <StatusPill tone="warning">Critical</StatusPill>}
          </div>
        ),
      },
      { header: "SLA due", cell: (i) => (i.dueAt ? formatDate(i.dueAt) : "—") },
    ],
    [],
  );

  return (
    <div>
      <PageHeader title="Management" subtitle="Complaint performance, SLA, and what needs attention now." />

      {/* Filters */}
      <Card className="mb-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
          <Field label="From">
            <Input type="date" value={filters.from} onChange={(e) => setFilters((f) => ({ ...f, from: e.target.value }))} />
          </Field>
          <Field label="To">
            <Input type="date" value={filters.to} onChange={(e) => setFilters((f) => ({ ...f, to: e.target.value }))} />
          </Field>
          <Field label="Customer">
            <Select value={filters.customerId} onChange={(e) => setFilters((f) => ({ ...f, customerId: e.target.value }))}>
              <option value="">All in scope</option>
              {customers.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Severity">
            <Select value={filters.severity} onChange={(e) => setFilters((f) => ({ ...f, severity: e.target.value }))}>
              <option value="">All</option>
              <option value="critical">Critical</option>
              <option value="major">Major</option>
              <option value="minor">Minor</option>
            </Select>
          </Field>
        </div>
      </Card>

      {error ? (
        <Alert tone="error">{error}</Alert>
      ) : loading || !data ? (
        <Spinner label="Loading dashboard…" />
      ) : (
        <div className="space-y-6">
          {/* KPI */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            <Kpi label="Submitted today" value={data.summary.submittedToday} />
            <Kpi label="Open" value={data.summary.open} />
            <Kpi label="Critical" value={data.summary.critical} tone={data.summary.critical > 0 ? "warning" : undefined} />
            <Kpi label="SLA overdue" value={data.summary.slaOverdue} tone={data.summary.slaOverdue > 0 ? "danger" : undefined} />
            <Kpi
              label="Resolution rate"
              value={data.summary.resolutionRatePercent === null ? "—" : `${data.summary.resolutionRatePercent}%`}
            />
            <Kpi
              label="Avg resolution"
              value={data.summary.avgResolutionHours === null ? "—" : `${data.summary.avgResolutionHours}h`}
            />
          </div>

          {/* Action Center */}
          <section>
            <div className="mb-2 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-slate-700">Action Center</h2>
              <span className="text-xs text-slate-400">Open complaints needing attention now</span>
            </div>
            <DataTable
              columns={actionColumns}
              rows={data.actionCenter}
              keyOf={(i) => i.complaintId}
              onRowClick={(i) => navigate(`/queue/${i.complaintId}`)}
              empty={<EmptyState title="Nothing needs attention" description="No open complaints are overdue or critical in scope." />}
            />
          </section>

          {/* Escalation */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Kpi label="Escalation events (period)" value={data.escalation.escalatedEvents} />
            <Kpi label="Open escalated" value={data.escalation.openEscalatedComplaints} tone={data.escalation.openEscalatedComplaints > 0 ? "warning" : undefined} />
          </div>

          {/* Breakdowns */}
          <section>
            <h2 className="mb-2 text-sm font-semibold text-slate-700">Breakdowns (selected period)</h2>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
              <Card>
                <h3 className="mb-3 text-sm font-medium text-slate-600">By workflow stage</h3>
                <BarList rows={data.breakdowns.byStatus} emptyLabel="No complaints in period." />
              </Card>
              <Card>
                <h3 className="mb-3 text-sm font-medium text-slate-600">By severity</h3>
                <BarList rows={data.breakdowns.bySeverity} emptyLabel="No complaints in period." />
              </Card>
              <Card>
                <h3 className="mb-3 text-sm font-medium text-slate-600">By category</h3>
                <BarList rows={data.breakdowns.byCategory} emptyLabel="No complaints in period." />
              </Card>
              <Card>
                <h3 className="mb-3 text-sm font-medium text-slate-600">By customer</h3>
                <BarList rows={data.breakdowns.byCustomer} emptyLabel="No complaints in period." />
              </Card>
              <Card>
                <h3 className="mb-3 text-sm font-medium text-slate-600">By site</h3>
                <BarList rows={data.breakdowns.bySite} emptyLabel="No complaints in period." />
              </Card>
              <Card>
                <h3 className="mb-3 text-sm font-medium text-slate-600">By service</h3>
                <BarList rows={data.breakdowns.byService} emptyLabel="No complaints in period." />
              </Card>
            </div>
          </section>

          <p className="text-xs text-slate-400">
            Aggregated across {data.scope.customerCount} customer(s) in your scope. Customer satisfaction and
            structured root-cause analytics are not yet available.
          </p>
        </div>
      )}
    </div>
  );
}
