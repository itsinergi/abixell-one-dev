/**
 * Phase 11C — Recent activity, read-only and privacy-safe.
 *
 * Shows THAT an action occurred, not what it contained. The backend omits
 * audit metadata and entity IDs, and caps the list server-side so this cannot
 * become a bulk audit export.
 */
import { api, type AdminAuditEntry } from "../../../lib/api";
import { DataTable, type Column } from "../../../shell/components/ui";
import { AdminEmpty, AdminPanel, AdminSectionState } from "./AdminSection";
import { useAdminResource } from "./useAdminResource";

function formatTimestamp(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

const COLUMNS: Column<AdminAuditEntry>[] = [
  {
    header: "When",
    cell: (entry) => (
      <time dateTime={entry.createdAt} className="whitespace-nowrap tabular-nums">
        {formatTimestamp(entry.createdAt)}
      </time>
    ),
    mobileRole: "title",
  },
  {
    header: "Action",
    cell: (entry) => <code className="break-all font-mono text-xs font-medium text-slate-800">{entry.action}</code>,
  },
  {
    header: "Area",
    cell: (entry) => <code className="break-all font-mono text-xs">{entry.entityType}</code>,
  },
  {
    header: "Actor",
    cell: (entry) =>
      entry.actorUserId ? (
        <code className="break-all font-mono text-xs">{entry.actorUserId}</code>
      ) : (
        <span className="text-slate-400">System</span>
      ),
  },
];

export function AdminAuditView() {
  const { data, loading, error, denied, sessionExpired, reload } =
    useAdminResource<AdminAuditEntry[]>(
      (token) => api.adminRecentAudit(token),
      "Failed to load recent activity",
    );

  return (
    <AdminSectionState
      loading={loading}
      loadingLabel="Loading recent administrative activity…"
      denied={denied}
      sessionExpired={sessionExpired}
      error={error}
      requiredPermission="audit_log.read"
      onRetry={reload}
    >
      <AdminPanel
        title="Recent activity"
        description="A bounded list of recent tenant events. Free-form metadata and affected entity IDs are deliberately omitted for privacy."
      >
        <DataTable
          columns={COLUMNS}
          rows={data ?? []}
          keyOf={(entry) => entry.id}
          mobileBreakpoint="md"
          empty={
            <AdminEmpty
              title="No recent activity recorded"
              description="The bounded recent-activity response contains no events."
            />
          }
        />
      </AdminPanel>
    </AdminSectionState>
  );
}
