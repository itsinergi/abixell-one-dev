/**
 * Phase 11C — Module activation, read-only.
 *
 * Shows which product areas are switched on for this tenant. Activation is
 * NOT toggled here: Phase 11C adds no mutation surface, and changing module
 * activation remains a deliberate act in the Administration area.
 */
import { api, type AdminModuleSummary } from "../../../lib/api";
import { DataTable, StatusPill, type Column } from "../../../shell/components/ui";
import { AdminEmpty, AdminPanel, AdminSectionState } from "./AdminSection";
import { useAdminResource } from "./useAdminResource";

const COLUMNS: Column<AdminModuleSummary>[] = [
  {
    header: "Module",
    cell: (m) => <span className="font-medium text-slate-800">{m.moduleName}</span>,
  },
  { header: "Code", cell: (m) => m.moduleCode },
  {
    header: "Status",
    cell: (m) =>
      m.isActive ? (
        <StatusPill tone="success">Active</StatusPill>
      ) : (
        <StatusPill tone="neutral">Inactive</StatusPill>
      ),
  },
];

export function AdminModulesView() {
  const { data, loading, error, denied, reload } = useAdminResource<AdminModuleSummary[]>(
    (token) => api.adminModules(token),
    "Failed to load modules",
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
        title="Modules"
        description="Which product areas are switched on for this tenant. Activation is changed in Administration, not here."
      >
        <DataTable
          columns={COLUMNS}
          rows={data ?? []}
          keyOf={(m) => m.moduleCode}
          empty={<AdminEmpty what="modules" />}
        />
      </AdminPanel>
    </AdminSectionState>
  );
}
