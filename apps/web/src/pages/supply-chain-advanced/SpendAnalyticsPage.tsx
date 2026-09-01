/**
 * Wave A5 — Spend Analytics: Category, Supplier, Time & Anomaly Drilldown (SCM-ADV-008).
 */
import { useCallback, useEffect, useState } from "react";
import { useAuth } from "../../auth/AuthContext";
import {
  api,
  ApiError,
  type ScmSpendAnalyticsSnapshot,
} from "../../lib/api";
import {
  Alert,
  Badge,
  Button,
  Card,
  DataTable,
  Field,
  Input,
  PageHeader,
  Spinner,
  type Column,
} from "../../shell/components/ui";
import { formatMoney } from "../../shared/format";

export function SpendAnalyticsPage() {
  const { session } = useAuth();
  const token = session!.accessToken;

  const [startDate, setStartDate] = useState(() => {
    const d = new Date();
    d.setFullYear(d.getFullYear() - 1);
    return d.toISOString().slice(0, 10);
  });
  const [endDate, setEndDate] = useState(() => new Date().toISOString().slice(0, 10));

  const [snapshots, setSnapshots] = useState<ScmSpendAnalyticsSnapshot[]>([]);
  const [loading, setLoading] = useState(true);
  const [computing, setComputing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const snapList = await api.scmSpendSnapshots(token);
      setSnapshots(snapList);
    } catch (err: unknown) {
      setError(err instanceof ApiError ? err.message : "Failed to load spend analytics");
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  async function handleCompute() {
    setComputing(true);
    setError(null);
    setNotice(null);
    try {
      const computed = await api.computeScmSpendSnapshot(token, {
        periodType: "monthly",
        periodStart: startDate,
        periodEnd: endDate,
      });
      setSnapshots(computed);
      setNotice(`Spend analytics snapshots recomputed (${computed.length} periods).`);
    } catch (err: unknown) {
      setError(err instanceof ApiError ? err.message : "Failed to recompute spend analytics");
    } finally {
      setComputing(false);
    }
  }

  const totalSpend = snapshots.reduce((sum, s) => sum + s.totalSpend, 0);
  const totalPOs = snapshots.reduce((sum, s) => sum + s.poCount, 0);
  const totalItems = snapshots.reduce((sum, s) => sum + s.itemsPurchasedCount, 0);

  const snapshotColumns: Column<ScmSpendAnalyticsSnapshot>[] = [
    {
      header: "Period Key",
      cell: (r) => <span className="font-mono font-semibold">{r.periodKey}</span>,
      mobileRole: "title",
    },
    { header: "Type", cell: (r) => r.periodType },
    {
      header: "PO Volume",
      cell: (r) => <span className="font-mono">{r.poCount}</span>,
    },
    {
      header: "Items Purchased",
      cell: (r) => <span className="font-mono">{r.itemsPurchasedCount}</span>,
    },
    {
      header: "Avg PO Value",
      cell: (r) => <span className="font-mono">{formatMoney(String(r.avgPoValue))}</span>,
    },
    {
      header: "Total Spend",
      cell: (r) => <span className="font-mono font-bold text-slate-900">{formatMoney(String(r.totalSpend))}</span>,
      mobileRole: "status",
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Spend Analytics"
        subtitle="Multidimensional spend analysis across suppliers, commodity categories, time series, and anomaly detection."
      />

      {error && <Alert tone="error">{error}</Alert>}
      {notice && <Alert tone="success">{notice}</Alert>}

      <Card>
        <h3 className="text-base font-semibold text-slate-900 mb-3">Analytics Date Range & Computation Engine</h3>
        <div className="flex flex-wrap items-end gap-4">
          <Field label="Period Start">
            <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} disabled={computing} />
          </Field>
          <Field label="Period End">
            <Input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} disabled={computing} />
          </Field>
          <Button variant="primary" onClick={handleCompute} disabled={computing}>
            Recompute Analytics Snapshot
          </Button>
        </div>
      </Card>

      {loading ? (
        <div className="flex justify-center p-8"><Spinner /></div>
      ) : (
        <div className="space-y-6">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <Card>
              <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Total Evaluated Spend</div>
              <div className="mt-2 text-2xl font-black text-slate-900 font-mono">{formatMoney(String(totalSpend))}</div>
            </Card>
            <Card>
              <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Purchase Orders Analyzed</div>
              <div className="mt-2 text-2xl font-black text-blue-600 font-mono">{totalPOs}</div>
            </Card>
            <Card>
              <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Items Purchased Volume</div>
              <div className="mt-2 text-2xl font-black text-emerald-600 font-mono">{totalItems}</div>
            </Card>
          </div>

          <Card>
            <h3 className="text-base font-semibold text-slate-900 mb-3">Historical Spend Trend by Period</h3>
            <DataTable
              columns={snapshotColumns}
              rows={snapshots}
              keyOf={(r) => r.id}
              empty={<p className="text-slate-500 py-4 text-center text-sm">No spend analytics snapshots generated yet. Click recompute above.</p>}
            />
          </Card>
        </div>
      )}
    </div>
  );
}
