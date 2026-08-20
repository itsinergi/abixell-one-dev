/**
 * Phase 6 — Operational cashflow (FIN-CORE-007, FIN-CORE-011).
 *
 * In, out, net over a period, plus the opening and closing position and a
 * breakdown by category. Every figure comes from the backend, summed by the
 * database — this page adds nothing up.
 *
 * This is NOT a Cash Flow Statement: there is no operating / investing /
 * financing classification, no profit and loss, no balance sheet, and no
 * ratio. Only transactions that actually took effect are counted.
 */
import { useCallback, useEffect, useState } from "react";
import { useAuth } from "../../auth/AuthContext";
import { api, ApiError, type CashflowResult, type FinanceAccount } from "../../lib/api";
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
import { formatMoney, monthRange } from "./money";

type CategoryLine = CashflowResult["byCategory"][number];

export function CashflowPage() {
  const { session } = useAuth();
  const token = session!.accessToken;
  const initial = monthRange();

  const [result, setResult] = useState<CashflowResult | null>(null);
  const [accounts, setAccounts] = useState<FinanceAccount[]>([]);
  const [categories, setCategories] = useState<{ code: string; label: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [from, setFrom] = useState(initial.from);
  const [to, setTo] = useState(initial.to);
  const [accountCode, setAccountCode] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setResult(await api.financeCashflow(token, { from, to, accountCode: accountCode || undefined }));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not load the cashflow view.");
    } finally {
      setLoading(false);
    }
  }, [token, from, to, accountCode]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    void (async () => {
      const [accountList, categoryList] = await Promise.all([
        api.financeAccounts(token).catch(() => [] as FinanceAccount[]),
        api.financeCategories(token).catch(() => [] as { code: string; label: string }[]),
      ]);
      setAccounts(accountList);
      setCategories(categoryList);
    })();
  }, [token]);

  const categoryLabel = (code: string) => categories.find((c) => c.code === code)?.label ?? code;

  const categoryColumns: Column<CategoryLine>[] = [
    { header: "Category", cell: (row) => categoryLabel(row.categoryCode) },
    {
      header: "Direction",
      cell: (row) => (
        <StatusPill tone={row.direction === "income" ? "success" : "neutral"}>
          {row.direction === "income" ? "Money in" : "Money out"}
        </StatusPill>
      ),
    },
    {
      header: "Amount",
      className: "text-right tabular-nums",
      cell: (row) => <span className="font-medium">{formatMoney(row.amount)}</span>,
    },
  ];

  const accountColumns: Column<FinanceAccount>[] = [
    { header: "Account", cell: (row) => <span className="font-medium">{row.name}</span> },
    { header: "Currency", cell: (row) => row.currency },
    {
      header: "Balance",
      className: "text-right tabular-nums",
      cell: (row) => <span className="font-medium">{formatMoney(row.balance)}</span>,
    },
  ];

  return (
    <div className="space-y-4">
      <PageHeader title="Cashflow" subtitle="What moved this period, and where you stand now." />

      {error ? <Alert tone="error">{error}</Alert> : null}

      <Card>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Field label="From" required>
            <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </Field>
          <Field label="To" required>
            <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </Field>
          <Field label="Account">
            <Select value={accountCode} onChange={(e) => setAccountCode(e.target.value)}>
              <option value="">All accounts</option>
              {accounts.map((a) => (
                <option key={a.id} value={a.code}>
                  {a.name}
                </option>
              ))}
            </Select>
          </Field>
        </div>
      </Card>

      {loading ? (
        <Spinner />
      ) : result ? (
        <>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Card>
              <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Opening</p>
              <p className="mt-1 text-xl font-semibold tabular-nums text-slate-900">{formatMoney(result.opening)}</p>
            </Card>
            <Card>
              <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Money in</p>
              <p className="mt-1 text-xl font-semibold tabular-nums text-emerald-700">
                {formatMoney(result.totals.income)}
              </p>
            </Card>
            <Card>
              <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Money out</p>
              <p className="mt-1 text-xl font-semibold tabular-nums text-slate-800">
                {formatMoney(result.totals.expense)}
              </p>
            </Card>
            <Card>
              <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Closing</p>
              <p className="mt-1 text-xl font-semibold tabular-nums text-slate-900">{formatMoney(result.closing)}</p>
              <p className="mt-1 text-xs text-slate-500">Net {formatMoney(result.totals.net)}</p>
            </Card>
          </div>

          <div>
            <h2 className="mb-2 text-sm font-semibold text-slate-800">By category</h2>
            <DataTable
              columns={categoryColumns}
              rows={result.byCategory}
              keyOf={(row) => `${row.categoryCode}-${row.direction}`}
              empty={
                <EmptyState
                  title="Nothing moved in this period"
                  description="Only transactions that have been approved are counted here."
                />
              }
            />
          </div>

          <div>
            <h2 className="mb-2 text-sm font-semibold text-slate-800">Account balances</h2>
            <DataTable
              columns={accountColumns}
              rows={result.accounts}
              keyOf={(row) => row.id}
              empty={<EmptyState title="No accounts" description="Add a cash or bank account first." />}
            />
          </div>
        </>
      ) : null}
    </div>
  );
}
