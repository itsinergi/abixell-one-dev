/**
 * Generic drill-down list (`/drilldown?dataset=…&status=…`).
 *
 * Resolves the `dataset` query param against `DRILL_DATASETS`, fetches the
 * filtered records, and renders them in a `DataTable` whose rows navigate to
 * the single-record detail page. Hidden from navigation — reachable only from
 * a dashboard card's drill target.
 */
import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useAuth } from "../../auth/AuthContext";
import { useT } from "../../i18n/LocaleProvider";
import { ApiError } from "../../lib/api";
import { Alert, DataTable, EmptyState, PageHeader, Spinner } from "../../shell/components/ui";
import { DRILL_DATASETS } from "./drillDatasets";

export function DrillDownListPage() {
  const t = useT();
  const { session } = useAuth();
  const token = session!.accessToken;
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const dataset = DRILL_DATASETS[searchParams.get("dataset") ?? ""];
  const filterKey = searchParams.toString();

  const [rows, setRows] = useState<unknown[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!dataset) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    const filter = Object.fromEntries(new URLSearchParams(filterKey).entries());
    dataset
      .apiCall(token, filter)
      .then((res) => {
        if (!cancelled) setRows(res);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof ApiError ? err.message : t("dashboard.msg.failedToLoadDashboard"));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [dataset, token, filterKey, t]);

  if (!dataset) {
    return (
      <div>
        <PageHeader title={t("drilldown.title.unknown")} />
        <Alert tone="error">{t("drilldown.msg.unknownDataset")}</Alert>
      </div>
    );
  }

  return (
    <div>
      <PageHeader title={t(dataset.titleKey as Parameters<typeof t>[0])} />
      {error ? (
        <Alert tone="error">{error}</Alert>
      ) : loading ? (
        <Spinner label={t("dashboard.f.loadingDashboard")} />
      ) : (
        <DataTable
          columns={dataset.columns}
          rows={rows}
          keyOf={dataset.keyOf}
          onRowClick={dataset.detailPath ? (row) => navigate(dataset.detailPath!(row)) : undefined}
          empty={<EmptyState title={t("dashboard.title.noData")} description={t("drilldown.d.noRecords")} />}
        />
      )}
    </div>
  );
}
