/**
 * Phase 11C — Recent activity, read-only and privacy-safe.
 *
 * Shows THAT an action occurred, not what it contained. The backend does
 * not send audit `metadata` (free-form, may carry business narrative or
 * reason text) or the affected `entityId`, and the list is capped server-side
 * so this can never become a bulk audit export. The full audit trail remains
 * behind the dedicated Audit surface.
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
  { header: "When", cell: (e) => formatTimestamp(e.createdAt) },
  { header: "Action", cell: (e) => <span className="font-medium text-slate-800">{e.action}</span> },
  { header: "Area", cell: (e) => e.entityType },
  {
    header: "Actor",
    cell: (e) =>
      e.actorUserId ?? <span className="text-slate-400">System</span>,
  },
];

export function AdminAuditView() {
  const { data, loading, error, denied, reload } = useAdminResource<AdminAuditEntry[]>(
    (token) => api.adminRecentAudit(token),
    "Failed to load recent activity",
  );

  return (
    <AdminSectionState
      loading={loading}
      denied={denied}
      error={error}
      requiredPermission="audit_log.read"
      onRetry={reload}
    >
      <AdminPanel
        title="Recent activity"
        description="The most recent recorded events in this tenant. Details of what changed are deliberately not shown here — open the Audit area for the full trail."
      >
        <DataTable
          columns={COLUMNS}
          rows={data ?? []}
          keyOf={(e) => e.id}
          empty={<AdminEmpty what="recorded activity" />}
        />
      </AdminPanel>
    </AdminSectionState>
  );
}
