/**
 * Phase 11C — Workflow definitions, read-only.
 *
 * Lists WHICH lifecycle/approval definitions exist and what they govern.
 * Their internal steps, transitions, and conditions are not projected here:
 * that is authoring territory, and Phase 11C introduces no workflow editor.
 */
import { api, type AdminWorkflowSummary } from "../../../lib/api";
import { DataTable, StatusPill, type Column } from "../../../shell/components/ui";
import { AdminEmpty, AdminPanel, AdminSectionState } from "./AdminSection";
import { useAdminResource } from "./useAdminResource";

const COLUMNS: Column<AdminWorkflowSummary>[] = [
  { header: "Code", cell: (w) => <span className="font-medium text-slate-800">{w.code}</span> },
  { header: "Name", cell: (w) => w.name },
  { header: "Applies to", cell: (w) => w.entityType },
  {
    header: "Status",
    cell: (w) =>
      w.isActive ? (
        <StatusPill tone="success">Active</StatusPill>
      ) : (
        <StatusPill tone="neutral">Inactive</StatusPill>
      ),
  },
];

export function AdminWorkflowsView() {
  const { data, loading, error, denied, reload } = useAdminResource<AdminWorkflowSummary[]>(
    (token) => api.adminWorkflows(token),
    "Failed to load workflow definitions",
  );

  return (
    <AdminSectionState
      loading={loading}
      denied={denied}
      error={error}
      requiredPermission="workflow.definition.read"
      onRetry={reload}
    >
      <AdminPanel
        title="Workflow definitions"
        description="The approval and lifecycle definitions configured for this tenant, and what each one governs."
      >
        <DataTable
          columns={COLUMNS}
          rows={data ?? []}
          keyOf={(w) => w.code}
          empty={<AdminEmpty what="workflow definitions" />}
        />
      </AdminPanel>
    </AdminSectionState>
  );
}
