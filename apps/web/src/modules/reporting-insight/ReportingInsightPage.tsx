/** Phase 9 — Reporting & Operational Insight Core (RPT-CORE-001…008). */
import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "../../auth/AuthContext";
import {
  api,
  ApiError,
  type DashboardModule,
  type ReportDefinition,
  type ReportRow,
  type StandardReportResult,
} from "../../lib/api";
import {
  Alert,
  Button,
  Card,
  DataTable,
  EmptyState,
  PageHeader,
  Select,
  Spinner,
  StatusPill,
  type Column,
} from "../../shell/components/ui";
import { formatMoney } from "../../shared/format";

export function ReportingInsightPage() {
  const { session } = useAuth();
  const token = session!.accessToken;

  const [reports, setReports] = useState<ReportDefinition[]>([]);
  const [dashboard, setDashboard] = useState<DashboardModule[]>([]);
  const [selectedCode, setSelectedCode] = useState("");
  const [result, setResult] = useState<StandardReportResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [reportLoading, setReportLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selectedReport = reports.find((report) => report.code === selectedCode) ?? null;

  const loadFoundation = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [reportList, dashboardResult] = await Promise.all([
        api.reportingReports(token),
        api.reportingDashboard(token),
      ]);
      setReports(reportList);
      setDashboard(dashboardResult.modules);
      setSelectedCode((current) => current || reportList[0]?.code || "");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not load reporting insight.");
    } finally {
      setLoading(false);
    }
  }, [token]);

  const loadReport = useCallback(async () => {
    if (!selectedCode) {
      setResult(null);
      return;
    }
    setReportLoading(true);
    setError(null);
    try {
      setResult(await api.reportingReport(token, selectedCode));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not load the selected report.");
    } finally {
      setReportLoading(false);
    }
  }, [token, selectedCode]);

  useEffect(() => {
    void loadFoundation();
  }, [loadFoundation]);

  useEffect(() => {
    if (!loading) void loadReport();
  }, [loading, loadReport]);

  const exportReport = async () => {
    if (!selectedCode) return;
    setExporting(true);
    setError(null);
    try {
      const exported = await api.exportReportingReport(token, selectedCode);
      const blob = new Blob([exported.content], { type: "text/csv;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = exported.filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not export the selected report.");
    } finally {
      setExporting(false);
    }
  };

  const columns = useMemo<Column<ReportRow>[]>(() => {
    if (!result) return [];
    return result.columns.map((column) => ({
      header: column.label,
      className: column.type === "number" || column.type === "money" || column.type === "percent" ? "text-right tabular-nums" : undefined,
      cell: (row) => formatValue(row[column.key], column.type),
    }));
  }, [result]);

  return (
    <div className="space-y-4">
      <PageHeader
        title="Reporting"
        subtitle="Scope-safe operational reports, export, and executive dashboard across activated modules."
        actions={<Button onClick={loadFoundation} variant="secondary">Refresh</Button>}
      />

      {error ? <Alert tone="error">{error}</Alert> : null}

      <Card>
        <p className="text-sm text-slate-600">
          Reports are read-only and generated from backend Data Scope filtered projections. Dashboard totals and CSV
          exports use the same scoped report result; inactive modules are omitted.
        </p>
      </Card>

      {loading ? (
        <Spinner />
      ) : reports.length === 0 ? (
        <EmptyState title="No reports available" description="No activated module currently exposes a standard report for your permissions." />
      ) : (
        <>
          <section>
            <h2 className="mb-2 text-sm font-semibold text-slate-800">Executive dashboard</h2>
            <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
              {dashboard.map((module) => (
                <Card key={module.moduleCode}>
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <h3 className="font-medium text-slate-900">{module.moduleName}</h3>
                    <StatusPill tone="info">Active</StatusPill>
                  </div>
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                    {module.cards.map((card) => (
                      <div key={`${module.moduleCode}-${card.label}`} className="rounded border border-slate-100 bg-slate-50 p-3">
                        <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{card.label}</p>
                        <p className="mt-1 text-lg font-semibold tabular-nums text-slate-900">{card.value}</p>
                      </div>
                    ))}
                  </div>
                </Card>
              ))}
            </div>
          </section>

          <section className="space-y-3">
            <Card>
              <div className="grid grid-cols-1 gap-3 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
                <label className="block text-sm">
                  <span className="font-medium text-slate-700">Standard report</span>
                  <Select value={selectedCode} onChange={(event) => setSelectedCode(event.target.value)}>
                    {reports.map((report) => (
                      <option key={report.code} value={report.code}>{report.title}</option>
                    ))}
                  </Select>
                </label>
                <Button onClick={exportReport} disabled={!selectedCode || exporting} variant="secondary">
                  {exporting ? "Exporting…" : "Export CSV"}
                </Button>
              </div>
              {selectedReport ? <p className="mt-2 text-sm text-slate-500">{selectedReport.description}</p> : null}
            </Card>

            {reportLoading ? (
              <Spinner />
            ) : result ? (
              <>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  {Object.entries(result.summary).map(([key, value]) => (
                    <Card key={key}>
                      <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{humanize(key)}</p>
                      <p className="mt-1 text-xl font-semibold tabular-nums text-slate-900">{value}</p>
                    </Card>
                  ))}
                </div>
                <DataTable
                  columns={columns}
                  rows={result.rows}
                  keyOf={(row) => `${result.code}-${row.label}-${JSON.stringify(row)}`}
                  empty={<EmptyState title="No scoped rows" description="No records are available within your Data Scope for this report." />}
                />
              </>
            ) : null}
          </section>
        </>
      )}
    </div>
  );
}

function formatValue(value: string | number | null, type: string) {
  if (value == null || value === "") return "—";
  if (type === "money") return formatMoney(String(value));
  if (type === "percent") return `${value}%`;
  return String(value);
}

function humanize(key: string): string {
  return key.replace(/([A-Z])/g, " $1").replace(/^./, (first) => first.toUpperCase());
}
