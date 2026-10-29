/**
 * Checkpoint 1D.2 — Respondent "My Surveys" list (survey.respond). Shows only
 * the actor's own assignments (backend-scoped).
 */
import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../../auth/AuthContext";
import { api, ApiError, type MySurveyItem } from "../../lib/api";
import {
  Alert,
  Badge,
  DataTable,
  EmptyState,
  PageHeader,
  Spinner,
  StatusPill,
  type Column,
} from "../../shell/components/ui";
import { formatDateShort } from "../complaints/format";
import { useT } from "../../i18n/LocaleProvider";

function statusTone(s: string): "neutral" | "info" | "success" | "warning" {
  if (s === "submitted") return "success";
  if (s === "in_progress") return "info";
  if (s === "expired" || s === "cancelled") return "neutral";
  return "warning"; // pending
}

export function MySurveysPage() {
  const t = useT();
  const { session } = useAuth();
  const token = session!.accessToken;
  const navigate = useNavigate();

  const [rows, setRows] = useState<MySurveyItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setRows(await api.mySurveyAssignments(token));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("mySurveys.loadFailed"));
    } finally {
      setLoading(false);
    }
  }, [token, t]);

  useEffect(() => {
    load();
  }, [load]);

  const columns: Column<MySurveyItem>[] = [
    { header: t("mySurveys.colSurvey"), cell: (i) => i.surveyName ?? t("common.notAvailable") },
    { header: t("mySurveys.colVersion"), cell: (i) => (i.versionNumber != null ? `v${i.versionNumber}` : t("common.notAvailable")) },
    {
      header: t("mySurveys.colStatus"),
      cell: (i) => <StatusPill tone={statusTone(i.assignment.status)}>{i.assignment.status}</StatusPill>,
    },
    { header: t("mySurveys.colDue"), cell: (i) => formatDateShort(i.assignment.dueAt) },
    {
      header: t("mySurveys.colSubmitted"),
      cell: (i) =>
        i.assignment.submittedAt ? (
          <Badge>{formatDateShort(i.assignment.submittedAt)}</Badge>
        ) : (
          <span className="text-ink-faint">{t("common.notAvailable")}</span>
        ),
    },
  ];

  return (
    <div>
      <PageHeader title={t("mySurveys.title")} subtitle={t("mySurveys.subtitle")} />
      {error ? (
        <Alert tone="error">{error}</Alert>
      ) : loading ? (
        <Spinner label={t("mySurveys.loading")} />
      ) : (
        <DataTable
          columns={columns}
          rows={rows}
          keyOf={(i) => i.assignment.id}
          onRowClick={(i) => navigate(`/my-surveys/${i.assignment.id}`)}
          empty={
            <EmptyState
              title={t("mySurveys.emptyTitle")}
              description={t("mySurveys.emptyDesc")}
            />
          }
        />
      )}
    </div>
  );
}
