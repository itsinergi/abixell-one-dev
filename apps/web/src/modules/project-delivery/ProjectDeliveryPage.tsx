/** Phase 8 — Project Delivery Core (PRJ-CORE-001…010). */
import { useT } from "../../i18n/LocaleProvider";
import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../../auth/AuthContext";
import { api, ApiError, type ProjectDeliveryProjectSummary } from "../../lib/api";
import {
  Alert,
  Button,
  Card,
  DataTable,
  EmptyState,
  PageHeader,
  Spinner,
  StatusPill,
  type Column,
} from "../../shell/components/ui";

export function ProjectDeliveryPage() {
  const t = useT();
  const { session } = useAuth();
  const token = session!.accessToken;
  const navigate = useNavigate();
  const [projects, setProjects] = useState<ProjectDeliveryProjectSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setProjects(await api.projectDeliveryProjects(token));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("pd.main.msg.couldNotLoadProjectDeliveryRecords"));
    } finally {
      setLoading(false);
    }
  }, [token, t]);

  useEffect(() => {
    void load();
  }, [load]);

  const columns: Column<ProjectDeliveryProjectSummary>[] = [
    { header: t("pd.main.h.project"), cell: (row) => <span className="font-medium">{row.project.name}</span> },
    { header: t("pd.main.h.code"), cell: (row) => row.project.code },
    {
      header: t("pd.main.h.progress"),
      cell: (row) => (
        <div className="min-w-[140px]">
          <div className="h-2 rounded bg-slate-100">
            <div className="h-2 rounded bg-blue-500" style={{ width: `${row.progress.progressPercent}%` }} />
          </div>
          <span className="text-xs text-slate-500">{row.progress.progressPercent}%</span>
        </div>
      ),
    },
    {
      header: t("pd.main.h.activities"),
      cell: (row) => `${row.progress.completedActivityCount}/${row.progress.activityCount}`,
    },
    {
      header: t("pd.main.h.milestones"),
      cell: (row) => `${row.progress.achievedMilestoneCount}/${row.progress.milestoneCount}`,
    },
    { header: t("pd.main.h.status"), cell: (row) => <StatusPill tone="info">{row.project.status}</StatusPill> },
  ];

  return (
    <div className="space-y-4">
      <PageHeader
        title={t("pd.main.title.projectDelivery")}
        subtitle={t("pd.main.sub.deliveryActivitiesMilestonesPicsDatesSta")}
      />
      {error ? <Alert tone="error">{error}</Alert> : null}
      <Card>
        <p className="text-sm text-slate-600">
          This module tracks execution records linked to the existing Customer & Commercial project master. WBS,
          dependencies, Gantt, earned value, and project accounting are outside Core scope.
        </p>
      </Card>
      {loading ? (
        <Spinner />
      ) : (
        <DataTable
          columns={columns}
          rows={projects}
          keyOf={(row) => row.project.id}
          onRowClick={(row) => navigate(`/project-delivery/${row.project.id}`)}
          empty={
            <EmptyState
              title={t("pd.main.title.noProjectDeliveryRecordsYet")}
              description={t("pd.main.d.createActivitiesOrMilestonesFromAProject")}
              action={<Button onClick={load}>{t("pd.main.t.refresh")}</Button>}
            />
          }
        />
      )}
    </div>
  );
}
