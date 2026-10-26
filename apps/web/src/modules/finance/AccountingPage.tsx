/**
 * Wave A6.1 — Accounting overview.
 *
 * Read-only. Periods, their fiscal closings, the ledgers in force, and the
 * chart versions that back them. Nothing here writes: closing a period,
 * approving a chart, and creating a ledger stay on the API until their own
 * screens exist.
 *
 * The legal entity is the scope for every figure on this page, so it is a
 * required choice rather than an optional filter: periods, ledgers, charts,
 * and accounts are all per-entity in the kernel.
 */
import { useCallback, useEffect, useState } from "react";
import { useAuth } from "../../auth/AuthContext";
import {
  api,
  ApiError,
  type AccountingAccountRecord,
  type AccountingChartRecord,
  type AccountingFiscalClosingRecord,
  type AccountingLedgerRecord,
  type AccountingPeriodRecord,
} from "../../lib/api";
import {
  Alert,
  Badge,
  Card,
  DataTable,
  EmptyState,
  Field,
  PageHeader,
  Select,
  Spinner,
  StatusPill,
  type Column,
} from "../../shell/components/ui";
import { formatDate, formatMoney } from "../../shared/format";

type LegalEntityOption = { id: string; name: string };

const PERIOD_TONES: Record<AccountingPeriodRecord["status"], "neutral" | "info" | "success" | "warning" | "danger"> = {
  draft: "neutral",
  open: "info",
  closed: "success",
  reopenable: "warning",
  tombstone: "danger",
};

const PERIOD_LABELS: Record<AccountingPeriodRecord["status"], string> = {
  draft: "Draft",
  open: "Open",
  closed: "Closed",
  reopenable: "Reopenable",
  tombstone: "Tombstone",
};

export function AccountingPage() {
  const { session } = useAuth();
  const token = session!.accessToken;

  const [entities, setEntities] = useState<LegalEntityOption[]>([]);
  const [legalEntityId, setLegalEntityId] = useState("");

  const [periods, setPeriods] = useState<AccountingPeriodRecord[]>([]);
  const [closings, setClosings] = useState<AccountingFiscalClosingRecord[]>([]);
  const [ledgers, setLedgers] = useState<AccountingLedgerRecord[]>([]);
  const [charts, setCharts] = useState<AccountingChartRecord[]>([]);
  const [accounts, setAccounts] = useState<AccountingAccountRecord[]>([]);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      const list = await api.legalEntities(token).catch(() => [] as LegalEntityOption[]);
      setEntities(list);
      setLegalEntityId((current) => current || list[0]?.id || "");
    })();
  }, [token]);

  const load = useCallback(async () => {
    if (!legalEntityId) {
      setPeriods([]);
      setClosings([]);
      setLedgers([]);
      setCharts([]);
      setAccounts([]);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const [periodList, closingList, ledgerList, chartList, accountList] = await Promise.all([
        api.accountingPeriods(token, { legalEntityId }),
        api.accountingFiscalClosings(token, { legalEntityId }),
        // `ledgers` requires the entity and rejects the call without it, so it
        // is fetched only once one is chosen — never with an empty string.
        api.accountingLedgers(token, legalEntityId),
        api.accountingCharts(token, { legalEntityId }),
        api.accountingAccounts(token, { legalEntityId }),
      ]);
      setPeriods(periodList);
      setClosings(closingList);
      setLedgers(ledgerList);
      setCharts(chartList);
      setAccounts(accountList);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not load the accounting records.");
    } finally {
      setLoading(false);
    }
  }, [token, legalEntityId]);

  useEffect(() => {
    void load();
  }, [load]);

  const periodLabel = (periodId: string) => {
    const period = periods.find((p) => p.id === periodId);
    return period ? `${period.periodCode} ${period.fiscalYearCode}` : periodId;
  };

  const periodColumns: Column<AccountingPeriodRecord>[] = [
    {
      header: "Period",
      mobileRole: "title",
      cell: (row) => <span className="font-medium text-ink">{row.periodName}</span>,
    },
    { header: "Year", cell: (row) => row.fiscalYearCode },
    { header: "Type", cell: (row) => <Badge>{row.periodType}</Badge> },
    { header: "From", className: "tabular-nums", cell: (row) => formatDate(row.dateFrom) },
    { header: "To", className: "tabular-nums", cell: (row) => formatDate(row.dateTo) },
    {
      header: "Status",
      mobileRole: "status",
      cell: (row) => <StatusPill tone={PERIOD_TONES[row.status]}>{PERIOD_LABELS[row.status]}</StatusPill>,
    },
  ];

  const closingColumns: Column<AccountingFiscalClosingRecord>[] = [
    { header: "Period", mobileRole: "title", cell: (row) => <span className="font-medium text-ink">{periodLabel(row.periodId)}</span> },
    { header: "Close", cell: (row) => <Badge>{row.closeKind === "year_end" ? "Year end" : "Month end"}</Badge> },
    { header: "Closed", className: "tabular-nums", cell: (row) => formatDate(row.closedAt) },
    {
      header: "Retained earnings",
      className: "text-right tabular-nums",
      mobileRole: "detail",
      cell: (row) => (row.retainedEarningsDelta === null ? "—" : formatMoney(row.retainedEarningsDelta)),
    },
  ];

  const ledgerColumns: Column<AccountingLedgerRecord>[] = [
    { header: "Ledger", mobileRole: "title", cell: (row) => <span className="font-medium text-ink">{row.ledgerName}</span> },
    { header: "Code", className: "font-mono text-xs", cell: (row) => row.ledgerCode },
    { header: "Currency", cell: (row) => row.currency },
    {
      header: "Role",
      mobileRole: "status",
      cell: (row) =>
        row.isPrimary ? <StatusPill tone="success">Primary</StatusPill> : <StatusPill>{row.ledgerRole}</StatusPill>,
    },
  ];

  const chartColumns: Column<AccountingChartRecord>[] = [
    { header: "Version", mobileRole: "title", cell: (row) => <span className="font-mono text-xs text-ink">{row.coaVersionCode}</span> },
    { header: "Date", className: "tabular-nums", cell: (row) => formatDate(row.coaVersionDate) },
    { header: "Template", cell: (row) => (row.templateType ? <Badge>{row.templateType}</Badge> : "Custom") },
    {
      header: "Status",
      mobileRole: "status",
      cell: (row) =>
        row.coaStatus === "approved" ? (
          <StatusPill tone="success">Approved</StatusPill>
        ) : (
          <StatusPill tone="warning">Draft</StatusPill>
        ),
    },
  ];

  const accountColumns: Column<AccountingAccountRecord>[] = [
    { header: "Code", className: "font-mono text-xs", cell: (row) => row.accountCode },
    { header: "Account", mobileRole: "title", cell: (row) => <span className="font-medium text-ink">{row.accountName}</span> },
    { header: "Class", cell: (row) => <Badge>{row.accountClass}</Badge> },
    { header: "Normal", cell: (row) => row.normalBalance },
    {
      header: "Active",
      mobileRole: "status",
      cell: (row) =>
        row.isActive ? <StatusPill tone="success">Active</StatusPill> : <StatusPill>Inactive</StatusPill>,
    },
  ];

  return (
    <div className="space-y-4">
      <PageHeader
        title="Accounting"
        subtitle="The periods you keep, the ledgers behind them, and the chart of accounts in force."
      />

      {error ? <Alert tone="error">{error}</Alert> : null}

      <Card>
        <Field label="Legal entity" required>
          <Select value={legalEntityId} onChange={(e) => setLegalEntityId(e.target.value)}>
            <option value="">Choose a legal entity</option>
            {entities.map((entity) => (
              <option key={entity.id} value={entity.id}>
                {entity.name}
              </option>
            ))}
          </Select>
        </Field>
      </Card>

      {!legalEntityId ? (
        <EmptyState
          title="Choose a legal entity"
          description="Accounting records belong to one legal entity, so nothing is shown until one is chosen."
        />
      ) : loading ? (
        <Spinner />
      ) : (
        <>
          <div>
            <h2 className="mb-2 text-sm font-semibold text-ink">Periods</h2>
            <DataTable
              columns={periodColumns}
              rows={periods}
              keyOf={(row) => row.id}
              empty={
                <EmptyState
                  title="No periods yet"
                  description="A legal entity needs at least one accounting period before journals can be posted."
                />
              }
            />
          </div>

          <div>
            <h2 className="mb-2 text-sm font-semibold text-ink">Fiscal closings</h2>
            <DataTable
              columns={closingColumns}
              rows={closings}
              keyOf={(row) => row.id}
              empty={
                <EmptyState
                  title="Nothing closed yet"
                  description="Month-end and year-end close runs appear here once they are recorded."
                />
              }
            />
          </div>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <div>
              <h2 className="mb-2 text-sm font-semibold text-ink">Ledgers</h2>
              <DataTable
                columns={ledgerColumns}
                rows={ledgers}
                keyOf={(row) => row.id}
                empty={<EmptyState title="No ledger" description="This entity has no ledger in force yet." />}
              />
            </div>
            <div>
              <h2 className="mb-2 text-sm font-semibold text-ink">Chart versions</h2>
              <DataTable
                columns={chartColumns}
                rows={charts}
                keyOf={(row) => row.id}
                empty={<EmptyState title="No chart" description="No chart of accounts version exists for this entity." />}
              />
            </div>
          </div>

          <div>
            <h2 className="mb-2 text-sm font-semibold text-ink">Accounts</h2>
            <DataTable
              columns={accountColumns}
              rows={accounts}
              keyOf={(row) => row.id}
              empty={<EmptyState title="No accounts" description="Instantiate a chart template to create the account list." />}
            />
          </div>
        </>
      )}
    </div>
  );
}
