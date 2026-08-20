/**
 * Phase 2 — Field executor work list (SO-CORE-014). Shows only the work
 * assigned to this user (backend-scoped). Mobile-first: the shared DataTable
 * renders stacked cards below the `sm` breakpoint.
 */
import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../../auth/AuthContext";
import { api, ApiError, type WorkOrderRow } from "../../lib/api";
import {
  Alert,
  DataTable,
  EmptyState,
  PageHeader,
  Spinner,
  StatusPill,
  type Column,
} from "../../shell/components/ui";
import { dueIndicator, formatDateShort, statusTone } from "../../shared/format";

export function MyWorkPage() {
  const { session } = useAuth();
  const token = session!.accessToken;
  const navigate = useNavigate();

  const [rows, setRows] = useState<WorkOrderRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setRows(await api.myWorkOrders(token));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not load your work.");
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  const columns: Column<WorkOrderRow>[] = [
    {
      header: "Work",
      cell: (row) => (
        <span className="font-medium">
          {row.workOrder.workOrderNumber} — {row.workOrder.title}
        </span>
      ),
    },
    {
      header: "Status",
      cell: (row) => (
        <StatusPill tone={statusTone(row.status?.instanceStatus)}>
          {row.status?.stepName ?? row.status?.stepCode ?? "—"}
        </StatusPill>
      ),
    },
    {
      header: "Due",
      cell: (row) => {
        const indicator = dueIndicator(row.workOrder.dueAt);
        return (
          <span className="flex flex-wrap items-center gap-2">
            {formatDateShort(row.workOrder.dueAt)}
            {indicator ? <StatusPill tone={indicator.tone}>{indicator.label}</StatusPill> : null}
          </span>
        );
      },
    },
    {
      header: "Progress",
      cell: (row) =>
        row.workOrder.completedAt ? (
          <StatusPill tone="success">Completed</StatusPill>
        ) : row.workOrder.startedAt ? (
          <StatusPill tone="info">In progress</StatusPill>
        ) : (
          <StatusPill tone="neutral">Not started</StatusPill>
        ),
    },
  ];

  return (
    <div>
      <PageHeader title="My Work" subtitle="The jobs assigned to you. Open one to record what you did." />
      {error ? <Alert tone="error">{error}</Alert> : null}
      {loading ? (
        <Spinner />
      ) : (
        <DataTable
          columns={columns}
          rows={rows}
          keyOf={(row) => row.workOrder.id}
          onRowClick={(row) => navigate(`/my-work/${row.workOrder.id}`)}
          empty={<EmptyState title="Nothing assigned" description="Work assigned to you will appear here." />}
        />
      )}
    </div>
  );
}
