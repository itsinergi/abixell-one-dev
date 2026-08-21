/** Phase 8 — Project Delivery Core (PRJ-CORE-001…010). */
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
      setError(err instanceof ApiError ? err.message : "Could not load project delivery records.");
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  const columns: Column<ProjectDeliveryProjectSummary>[] = [
    { header: "Project", cell: (row) => <span className="font-medium">{row.project.name}</span> },
    { header: "Code", cell: (row) => row.project.code },
    {
      header: "Progress",
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
      header: "Activities",
      cell: (row) => `${row.progress.completedActivityCount}/${row.progress.activityCount}`,
    },
    {
      header: "Milestones",
      cell: (row) => `${row.progress.achievedMilestoneCount}/${row.progress.milestoneCount}`,
    },
    { header: "Status", cell: (row) => <StatusPill tone="info">{row.project.status}</StatusPill> },
  ];

  return (
    <div className="space-y-4">
      <PageHeader
        title="Project Delivery"
        subtitle="Delivery activities, milestones, PICs, dates, status, and progress over existing projects."
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
              title="No project delivery records yet"
              description="Create activities or milestones from a project detail view once a project is available."
              action={<Button onClick={load}>Refresh</Button>}
            />
          }
        />
      )}
    </div>
  );
}
