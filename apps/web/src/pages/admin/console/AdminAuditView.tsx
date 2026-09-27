/**
 * Phase 11C — Recent activity, read-only and privacy-safe.
 *
 * Shows THAT an action occurred, not what it contained. The backend omits
 * audit metadata and entity IDs, and caps the list server-side so this cannot
 * become a bulk audit export.
 */
import { useMemo } from "react";
import { api, type AdminAuditEntry } from "../../../lib/api";
import { DataTable, type Column } from "../../../shell/components/ui";
import { useShell } from "../../../shell/layout/AppShell";
import { AdminEmpty, AdminPanel, AdminSectionState } from "./AdminSection";
import { useAdminResource } from "./useAdminResource";

interface AuditViewData {
  entries: AdminAuditEntry[];
  actorNames: Record<string, string>;
  /** Distinguishes "we could not resolve names at all" (no user.read, or the
   * lookup failed) from "this particular actor is gone". Both used to render
   * the same string, which reads as a data error to an admin who simply
   * lacks the permission. */
  actorNamesResolved: boolean;
}

function formatTimestamp(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function auditColumns(
  actorNames: Record<string, string>,
  actorNamesResolved: boolean,
): Column<AdminAuditEntry>[] {
  return [
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
      cell: (entry) => <code className="break-all font-mono text-xs font-medium text-ink">{entry.action}</code>,
    },
    {
      header: "Area",
      cell: (entry) => <code className="break-all font-mono text-xs">{entry.entityType}</code>,
    },
    {
      header: "Actor",
      cell: (entry) =>
        entry.actorUserId ? (
          <span>
            {actorNames[entry.actorUserId] ??
              (actorNamesResolved ? "User unavailable" : "Name not shown")}
          </span>
        ) : (
          <span className="text-ink-faint">System</span>
        ),
    },
  ];
}

export function AdminAuditView() {
  const { permissions } = useShell();
  const canReadUsers = permissions.includes("user.read");
  const { data, loading, error, denied, sessionExpired, reload } =
    useAdminResource<AuditViewData>(
      async (token) => {
        const entries = await api.adminRecentAudit(token);
        if (!canReadUsers) return { entries, actorNames: {}, actorNamesResolved: false };

        try {
          const users = await api.users(token);
          return {
            entries,
            actorNames: Object.fromEntries(users.map((user) => [user.id, user.fullName])),
            actorNamesResolved: true,
          };
        } catch {
          return { entries, actorNames: {}, actorNamesResolved: false };
        }
      },
      "Failed to load recent activity",
    );
  const columns = useMemo(
    () => auditColumns(data?.actorNames ?? {}, data?.actorNamesResolved ?? false),
    [data?.actorNames, data?.actorNamesResolved],
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
          columns={columns}
          rows={data?.entries ?? []}
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
