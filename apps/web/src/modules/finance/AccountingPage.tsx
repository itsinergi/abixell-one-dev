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
import { useT } from "../../i18n/LocaleProvider";
import type { MessageKey } from "../../i18n/t";

type LegalEntityOption = { id: string; name: string };

const PERIOD_TONES: Record<AccountingPeriodRecord["status"], "neutral" | "info" | "success" | "warning" | "danger"> = {
  draft: "neutral",
  open: "info",
  closed: "success",
  reopenable: "warning",
  tombstone: "danger",
};

/** The stored status stays the API's; only the word on screen changes. */
const PERIOD_LABEL_KEYS: Record<AccountingPeriodRecord["status"], MessageKey> = {
  draft: "finAcct.periodDraft",
  open: "finAcct.periodOpen",
  closed: "finAcct.periodClosed",
  reopenable: "finAcct.periodReopenable",
  tombstone: "finAcct.periodTombstone",
};

export function AccountingPage() {
  const t = useT();
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
      setError(err instanceof ApiError ? err.message : t("finAcct.loadFailed"));
    } finally {
      setLoading(false);
    }
  }, [token, legalEntityId, t]);

  useEffect(() => {
    void load();
  }, [load]);

  const periodLabel = (periodId: string) => {
    const period = periods.find((p) => p.id === periodId);
    return period ? `${period.periodCode} ${period.fiscalYearCode}` : periodId;
  };

  const periodColumns: Column<AccountingPeriodRecord>[] = [
    {
      header: t("finAcct.period"),
      mobileRole: "title",
      cell: (row) => <span className="font-medium text-ink">{row.periodName}</span>,
    },
    { header: t("finAcct.year"), cell: (row) => row.fiscalYearCode },
    { header: t("fin.common.type"), cell: (row) => <Badge>{row.periodType}</Badge> },
    { header: t("fin.common.from"), className: "tabular-nums", cell: (row) => formatDate(row.dateFrom) },
    { header: t("fin.common.to"), className: "tabular-nums", cell: (row) => formatDate(row.dateTo) },
    {
      header: t("fin.common.status"),
      mobileRole: "status",
      cell: (row) => (
        <StatusPill tone={PERIOD_TONES[row.status]}>{t(PERIOD_LABEL_KEYS[row.status])}</StatusPill>
      ),
    },
  ];

  const closingColumns: Column<AccountingFiscalClosingRecord>[] = [
    {
      header: t("finAcct.period"),
      mobileRole: "title",
      cell: (row) => <span className="font-medium text-ink">{periodLabel(row.periodId)}</span>,
    },
    {
      header: t("finAcct.close"),
      cell: (row) => (
        <Badge>{row.closeKind === "year_end" ? t("finAcct.yearEnd") : t("finAcct.monthEnd")}</Badge>
      ),
    },
    { header: t("finAcct.closed"), className: "tabular-nums", cell: (row) => formatDate(row.closedAt) },
    {
      header: t("finAcct.retainedEarnings"),
      className: "text-right tabular-nums",
      mobileRole: "detail",
      cell: (row) =>
        row.retainedEarningsDelta === null
          ? t("fin.common.notAvailable")
          : formatMoney(row.retainedEarningsDelta),
    },
  ];

  const ledgerColumns: Column<AccountingLedgerRecord>[] = [
    {
      header: t("finAcct.ledger"),
      mobileRole: "title",
      cell: (row) => <span className="font-medium text-ink">{row.ledgerName}</span>,
    },
    { header: t("fin.common.code"), className: "font-mono text-xs", cell: (row) => row.ledgerCode },
    { header: t("fin.common.currency"), cell: (row) => row.currency },
    {
      header: t("finAcct.role"),
      mobileRole: "status",
      cell: (row) =>
        row.isPrimary ? (
          <StatusPill tone="success">{t("finAcct.primary")}</StatusPill>
        ) : (
          <StatusPill>{row.ledgerRole}</StatusPill>
        ),
    },
  ];

  const chartColumns: Column<AccountingChartRecord>[] = [
    {
      header: t("finAcct.version"),
      mobileRole: "title",
      cell: (row) => <span className="font-mono text-xs text-ink">{row.coaVersionCode}</span>,
    },
    { header: t("fin.common.date"), className: "tabular-nums", cell: (row) => formatDate(row.coaVersionDate) },
    {
      header: t("finAcct.template"),
      cell: (row) => (row.templateType ? <Badge>{row.templateType}</Badge> : t("finAcct.custom")),
    },
    {
      header: t("fin.common.status"),
      mobileRole: "status",
      cell: (row) =>
        row.coaStatus === "approved" ? (
          <StatusPill tone="success">{t("finAcct.approved")}</StatusPill>
        ) : (
          <StatusPill tone="warning">{t("finAcct.periodDraft")}</StatusPill>
        ),
    },
  ];

  const accountColumns: Column<AccountingAccountRecord>[] = [
    { header: t("fin.common.code"), className: "font-mono text-xs", cell: (row) => row.accountCode },
    {
      header: t("fin.common.account"),
      mobileRole: "title",
      cell: (row) => <span className="font-medium text-ink">{row.accountName}</span>,
    },
    { header: t("finAcct.class"), cell: (row) => <Badge>{row.accountClass}</Badge> },
    { header: t("finAcct.normal"), cell: (row) => row.normalBalance },
    {
      header: t("fin.state.active"),
      mobileRole: "status",
      cell: (row) =>
        row.isActive ? (
          <StatusPill tone="success">{t("fin.state.active")}</StatusPill>
        ) : (
          <StatusPill>{t("fin.state.inactive")}</StatusPill>
        ),
    },
  ];

  return (
    <div className="space-y-4">
      <PageHeader title={t("finAcct.title")} subtitle={t("finAcct.subtitle")} />

      {error ? <Alert tone="error">{error}</Alert> : null}

      <Card>
        <Field label={t("fin.common.legalEntity")} required>
          <Select value={legalEntityId} onChange={(e) => setLegalEntityId(e.target.value)}>
            <option value="">{t("fin.common.chooseLegalEntity")}</option>
            {entities.map((entity) => (
              <option key={entity.id} value={entity.id}>
                {entity.name}
              </option>
            ))}
          </Select>
        </Field>
      </Card>

      {!legalEntityId ? (
        <EmptyState title={t("fin.common.chooseLegalEntity")} description={t("finAcct.chooseEntityDesc")} />
      ) : loading ? (
        <Spinner />
      ) : (
        <>
          <div>
            <h2 className="mb-2 text-sm font-semibold text-ink">{t("finAcct.periods")}</h2>
            <DataTable
              columns={periodColumns}
              rows={periods}
              keyOf={(row) => row.id}
              empty={<EmptyState title={t("finAcct.noPeriodsTitle")} description={t("finAcct.noPeriodsDesc")} />}
            />
          </div>

          <div>
            <h2 className="mb-2 text-sm font-semibold text-ink">{t("finAcct.fiscalClosings")}</h2>
            <DataTable
              columns={closingColumns}
              rows={closings}
              keyOf={(row) => row.id}
              empty={<EmptyState title={t("finAcct.noClosingsTitle")} description={t("finAcct.noClosingsDesc")} />}
            />
          </div>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <div>
              <h2 className="mb-2 text-sm font-semibold text-ink">{t("finAcct.ledgers")}</h2>
              <DataTable
                columns={ledgerColumns}
                rows={ledgers}
                keyOf={(row) => row.id}
                empty={<EmptyState title={t("finAcct.noLedgerTitle")} description={t("finAcct.noLedgerDesc")} />}
              />
            </div>
            <div>
              <h2 className="mb-2 text-sm font-semibold text-ink">{t("finAcct.chartVersions")}</h2>
              <DataTable
                columns={chartColumns}
                rows={charts}
                keyOf={(row) => row.id}
                empty={<EmptyState title={t("finAcct.noChartTitle")} description={t("finAcct.noChartDesc")} />}
              />
            </div>
          </div>

          <div>
            <h2 className="mb-2 text-sm font-semibold text-ink">{t("fin.common.accounts")}</h2>
            <DataTable
              columns={accountColumns}
              rows={accounts}
              keyOf={(row) => row.id}
              empty={<EmptyState title={t("finCashflow.noAccountsTitle")} description={t("finAcct.noAccountsDesc")} />}
            />
          </div>
        </>
      )}
    </div>
  );
}
