/**
 * Phase 11C — Roles, read-only. Shows what each role is and how widely it is
 * used, deliberately NOT which permission codes it grants: the console
 * summarises access, it is not a covert permission-matrix export.
 */
import { api, type AdminRoleSummary } from "../../../lib/api";
import { DataTable, StatusPill, type Column } from "../../../shell/components/ui";
import { AdminEmpty, AdminPanel, AdminSectionState } from "./AdminSection";
import { useAdminResource } from "./useAdminResource";

const COLUMNS: Column<AdminRoleSummary>[] = [
  {
    header: "Code",
    cell: (role) => <code className="font-mono text-xs font-medium text-slate-800">{role.code}</code>,
    mobileRole: "title",
  },
  { header: "Name", cell: (role) => role.name },
  {
    header: "Access",
    cell: (role) =>
      role.isFullAccess ? (
        <StatusPill tone="warning">Full access</StatusPill>
      ) : (
        <StatusPill tone="neutral">Scoped</StatusPill>
      ),
    mobileRole: "status",
  },
  {
    header: "Permissions",
    cell: (role) => <span className="tabular-nums">{role.permissionCount}</span>,
    className: "text-right tabular-nums",
  },
  {
    header: "Users",
    cell: (role) => <span className="tabular-nums">{role.assignedUserCount}</span>,
    className: "text-right tabular-nums",
  },
];

export function AdminRolesView() {
  const { data, loading, error, denied, sessionExpired, reload } =
    useAdminResource<AdminRoleSummary[]>(
      (token) => api.adminRoles(token),
      "Failed to load roles",
    );

  return (
    <AdminSectionState
      loading={loading}
      loadingLabel="Loading tenant roles…"
      denied={denied}
      sessionExpired={sessionExpired}
      error={error}
      requiredPermission="config.read"
      onRetry={reload}
    >
      <AdminPanel
        title="Roles"
        description="Tenant-local roles, access breadth, permission totals, and assignment totals. Permission membership is not exposed here."
      >
        <DataTable
          columns={COLUMNS}
          rows={data ?? []}
          keyOf={(role) => role.code}
          mobileBreakpoint="md"
          empty={
            <AdminEmpty
              title="No roles configured"
              description="No tenant-local role definitions were returned for this tenant."
            />
          }
        />
      </AdminPanel>
    </AdminSectionState>
  );
}
