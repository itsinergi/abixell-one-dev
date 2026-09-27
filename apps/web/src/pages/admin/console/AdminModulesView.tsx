/**
 * Phase 11C — Module activation, read-only.
 *
 * Shows the configuration records returned for this tenant. Activation is
 * NOT toggled here: Phase 11C adds no mutation surface.
 */
import { api, type AdminModuleSummary } from "../../../lib/api";
import { DataTable, StatusPill, type Column } from "../../../shell/components/ui";
import { AdminEmpty, AdminPanel, AdminSectionState } from "./AdminSection";
import { useAdminResource } from "./useAdminResource";

const COLUMNS: Column<AdminModuleSummary>[] = [
  {
    header: "Module",
    cell: (module) => <span className="font-medium text-ink">{module.moduleName}</span>,
    mobileRole: "title",
  },
  {
    header: "Code",
    cell: (module) => <code className="break-all font-mono text-xs">{module.moduleCode}</code>,
  },
  {
    header: "Status",
    cell: (module) =>
      module.isActive ? (
        <StatusPill tone="success">Active</StatusPill>
      ) : (
        <StatusPill tone="neutral">Inactive</StatusPill>
      ),
    mobileRole: "status",
  },
];

export function AdminModulesView() {
  const { data, loading, error, denied, sessionExpired, reload } =
    useAdminResource<AdminModuleSummary[]>(
      (token) => api.adminModules(token),
      "Failed to load modules",
    );

  return (
    <AdminSectionState
      loading={loading}
      loadingLabel="Loading module configuration…"
      denied={denied}
      sessionExpired={sessionExpired}
      error={error}
      requiredPermission="config.read"
      onRetry={reload}
    >
      <AdminPanel
        title="Modules"
        description="Module activation records configured for this tenant. This view provides no activation control."
      >
        <DataTable
          columns={COLUMNS}
          rows={data ?? []}
          keyOf={(module) => module.moduleCode}
          mobileBreakpoint="md"
          empty={
            <AdminEmpty
              title="No module configuration returned"
              description="No tenant module activation records are available to display."
            />
          }
        />
      </AdminPanel>
    </AdminSectionState>
  );
}
