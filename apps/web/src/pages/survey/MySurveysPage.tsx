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

function statusTone(s: string): "neutral" | "info" | "success" | "warning" {
  if (s === "submitted") return "success";
  if (s === "in_progress") return "info";
  if (s === "expired" || s === "cancelled") return "neutral";
  return "warning"; // pending
}

export function MySurveysPage() {
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
      setError(err instanceof ApiError ? err.message : "Failed to load your surveys");
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    load();
  }, [load]);

  const columns: Column<MySurveyItem>[] = [
    { header: "Survey", cell: (i) => i.surveyName ?? "—" },
    { header: "Version", cell: (i) => (i.versionNumber != null ? `v${i.versionNumber}` : "—") },
    {
      header: "Status",
      cell: (i) => <StatusPill tone={statusTone(i.assignment.status)}>{i.assignment.status}</StatusPill>,
    },
    { header: "Due", cell: (i) => formatDateShort(i.assignment.dueAt) },
    {
      header: "Submitted",
      cell: (i) =>
        i.assignment.submittedAt ? (
          <Badge>{formatDateShort(i.assignment.submittedAt)}</Badge>
        ) : (
          <span className="text-slate-400">—</span>
        ),
    },
  ];

  return (
    <div>
      <PageHeader title="My Surveys" subtitle="Surveys assigned to you. Respond and submit." />
      {error ? (
        <Alert tone="error">{error}</Alert>
      ) : loading ? (
        <Spinner label="Loading your surveys…" />
      ) : (
        <DataTable
          columns={columns}
          rows={rows}
          keyOf={(i) => i.assignment.id}
          onRowClick={(i) => navigate(`/my-surveys/${i.assignment.id}`)}
          empty={
            <EmptyState
              title="No surveys assigned"
              description="When a survey is assigned to you it will appear here."
            />
          }
        />
      )}
    </div>
  );
}
