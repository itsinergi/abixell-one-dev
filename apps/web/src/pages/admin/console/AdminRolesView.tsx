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
  { header: "Code", cell: (r) => <span className="font-medium text-slate-800">{r.code}</span> },
  { header: "Name", cell: (r) => r.name },
  {
    header: "Access",
    cell: (r) =>
      r.isFullAccess ? (
        <StatusPill tone="warning">Full access</StatusPill>
      ) : (
        <StatusPill tone="neutral">Scoped</StatusPill>
      ),
  },
  { header: "Permissions", cell: (r) => r.permissionCount, className: "text-right" },
  { header: "Users", cell: (r) => r.assignedUserCount, className: "text-right" },
];

export function AdminRolesView() {
  const { data, loading, error, denied, reload } = useAdminResource<AdminRoleSummary[]>(
    (token) => api.adminRoles(token),
    "Failed to load roles",
  );

  return (
    <AdminSectionState
      loading={loading}
      denied={denied}
      error={error}
      requiredPermission="config.read"
      onRetry={reload}
    >
      <AdminPanel
        title="Roles"
        description="The roles defined in this tenant, with how much each one grants and how many people hold it."
      >
        <DataTable
          columns={COLUMNS}
          rows={data ?? []}
          keyOf={(r) => r.code}
          empty={<AdminEmpty what="roles" />}
        />
      </AdminPanel>
    </AdminSectionState>
  );
}
