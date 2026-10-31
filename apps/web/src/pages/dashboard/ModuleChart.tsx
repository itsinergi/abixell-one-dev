/**
 * Chart rendering for the dynamic dashboard.
 *
 * Picks a chart type per module from the server-provided `chart.rows`. All
 * series labels come from i18n; numeric values are parsed from the report's
 * text/number cells (money and stock quantities arrive as strings).
 */
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { DashboardModule, ReportRow } from "../../lib/api";
import { useT } from "../../i18n/LocaleProvider";

const PALETTE = ["#2563eb", "#f59e0b", "#10b981", "#8b5cf6", "#ef4444", "#06b6d4"];

const num = (v: string | number | null): number => {
  if (typeof v === "number") return v;
  return Number(v) || 0;
};

type Series = { key: string; name: string };

function GroupedBar({ rows, xKey, series }: { rows: ReportRow[]; xKey: string; series: Series[] }) {
  return (
    <ResponsiveContainer width="100%" height={220}>
      <BarChart data={rows} margin={{ top: 4, right: 8, bottom: 0, left: -16 }}>
        <CartesianGrid strokeDasharray="3 3" vertical={false} />
        <XAxis dataKey={xKey} tick={{ fontSize: 11 }} interval={0} angle={-20} height={52} textAnchor="end" />
        <YAxis tick={{ fontSize: 11 }} />
        <Tooltip />
        <Legend wrapperStyle={{ fontSize: 12 }} />
        {series.map((s, i) => (
          <Bar key={s.key} dataKey={(row: ReportRow) => num(row[s.key])} name={s.name} fill={PALETTE[i % PALETTE.length]} radius={[3, 3, 0, 0]} />
        ))}
      </BarChart>
    </ResponsiveContainer>
  );
}

function StackedBar({ rows, xKey, series }: { rows: ReportRow[]; xKey: string; series: Series[] }) {
  return (
    <ResponsiveContainer width="100%" height={220}>
      <BarChart data={rows} margin={{ top: 4, right: 8, bottom: 0, left: -16 }}>
        <CartesianGrid strokeDasharray="3 3" vertical={false} />
        <XAxis dataKey={xKey} tick={{ fontSize: 11 }} interval={0} angle={-20} height={52} textAnchor="end" />
        <YAxis tick={{ fontSize: 11 }} />
        <Tooltip />
        <Legend wrapperStyle={{ fontSize: 12 }} />
        {series.map((s, i) => (
          <Bar key={s.key} dataKey={(row: ReportRow) => num(row[s.key])} name={s.name} stackId="a" fill={PALETTE[i % PALETTE.length]} />
        ))}
      </BarChart>
    </ResponsiveContainer>
  );
}

function HorizontalBar({ rows, xKey, valueKey, seriesName }: { rows: ReportRow[]; xKey: string; valueKey: string; seriesName: string }) {
  const top = [...rows].sort((a, b) => num(b[valueKey]) - num(a[valueKey])).slice(0, 8);
  return (
    <ResponsiveContainer width="100%" height={Math.max(160, top.length * 32)}>
      <BarChart data={top} layout="vertical" margin={{ top: 4, right: 24, bottom: 0, left: 8 }}>
        <CartesianGrid strokeDasharray="3 3" horizontal={false} />
        <XAxis type="number" tick={{ fontSize: 11 }} />
        <YAxis type="category" dataKey={xKey} width={140} tick={{ fontSize: 11 }} />
        <Tooltip />
        <Bar dataKey={(row: ReportRow) => num(row[valueKey])} name={seriesName} fill={PALETTE[0]} radius={[0, 3, 3, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}

function Donut({ rows, nameKey, valueKey }: { rows: ReportRow[]; nameKey: string; valueKey: string }) {
  return (
    <ResponsiveContainer width="100%" height={200}>
      <PieChart>
        <Pie
          data={rows}
          dataKey={(row: ReportRow) => num(row[valueKey])}
          nameKey={nameKey}
          innerRadius={50}
          outerRadius={80}
          paddingAngle={2}
          label={(e: { name?: string; percent?: number }) => `${e.name} ${Math.round((e.percent ?? 0) * 100)}%`}
          labelLine={false}
        >
          {rows.map((_, i) => (
            <Cell key={i} fill={PALETTE[i % PALETTE.length]} />
          ))}
        </Pie>
        <Tooltip />
        <Legend wrapperStyle={{ fontSize: 12 }} />
      </PieChart>
    </ResponsiveContainer>
  );
}

function FinanceBar({ rows }: { rows: ReportRow[] }) {
  const byCategory = new Map<string, { label: string; income: number; expense: number }>();
  for (const row of rows) {
    const label = String(row.label ?? "—");
    const entry = byCategory.get(label) ?? { label, income: 0, expense: 0 };
    if (row.direction === "income") entry.income += num(row.amount);
    else entry.expense += num(row.amount);
    byCategory.set(label, entry);
  }
  const data = [...byCategory.values()].sort((a, b) => b.income + b.expense - (a.income + a.expense)).slice(0, 8);
  return (
    <ResponsiveContainer width="100%" height={220}>
      <BarChart data={data} margin={{ top: 4, right: 8, bottom: 0, left: -16 }}>
        <CartesianGrid strokeDasharray="3 3" vertical={false} />
        <XAxis dataKey="label" tick={{ fontSize: 11 }} interval={0} angle={-20} height={52} textAnchor="end" />
        <YAxis tick={{ fontSize: 11 }} />
        <Tooltip />
        <Legend wrapperStyle={{ fontSize: 12 }} />
        <Bar dataKey="income" fill={PALETTE[2]} radius={[3, 3, 0, 0]} />
        <Bar dataKey="expense" fill={PALETTE[4]} radius={[3, 3, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}

export function ModuleChart({ module }: { module: DashboardModule }) {
  const t = useT();
  const chart = module.chart;
  if (!chart || chart.rows.length === 0) return null;

  switch (module.moduleCode) {
    case "customer_commercial":
      return (
        <GroupedBar
          rows={chart.rows}
          xKey="label"
          series={[
            { key: "projects", name: t("dashboard.chart.projects") },
            { key: "sites", name: t("dashboard.chart.sites") },
          ]}
        />
      );
    case "customer_complaint":
      return (
        <StackedBar
          rows={chart.rows}
          xKey="label"
          series={[
            { key: "open", name: t("dashboard.chart.open") },
            { key: "closed", name: t("dashboard.chart.closed") },
          ]}
        />
      );
    case "survey_assessment":
      return <Donut rows={chart.rows} nameKey="label" valueKey="total" />;
    case "service_operations":
      return (
        <GroupedBar
          rows={chart.rows}
          xKey="label"
          series={[
            { key: "open", name: t("dashboard.chart.open") },
            { key: "completed", name: t("dashboard.chart.completed") },
          ]}
        />
      );
    case "supply_chain":
      return <HorizontalBar rows={chart.rows} xKey="label" valueKey="quantity" seriesName={t("dashboard.chart.stockQuantity")} />;
    case "finance":
      return <FinanceBar rows={chart.rows} />;
    default:
      return null;
  }
}
