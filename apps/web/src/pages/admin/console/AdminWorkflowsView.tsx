/**
 * Phase 11C — Workflow definitions, read-only.
 *
 * Lists WHICH lifecycle/approval definitions exist and what they govern.
 * Internal steps, transitions, and conditions are authoring territory and
 * are intentionally not projected here.
 */
import { api, type AdminWorkflowSummary } from "../../../lib/api";
import { DataTable, StatusPill, type Column } from "../../../shell/components/ui";
import { AdminEmpty, AdminPanel, AdminSectionState } from "./AdminSection";
import { useAdminResource } from "./useAdminResource";

const COLUMNS: Column<AdminWorkflowSummary>[] = [
  {
    header: "Code",
    cell: (workflow) => (
      <code className="break-all font-mono text-xs font-medium text-ink">{workflow.code}</code>
    ),
    mobileRole: "title",
  },
  { header: "Name", cell: (workflow) => workflow.name },
  {
    header: "Applies to",
    cell: (workflow) => <code className="break-all font-mono text-xs">{workflow.entityType}</code>,
  },
  {
    header: "Status",
    cell: (workflow) =>
      workflow.isActive ? (
        <StatusPill tone="success">Active</StatusPill>
      ) : (
        <StatusPill tone="neutral">Inactive</StatusPill>
      ),
    mobileRole: "status",
  },
];

export function AdminWorkflowsView() {
  const { data, loading, error, denied, sessionExpired, reload } =
    useAdminResource<AdminWorkflowSummary[]>(
      (token) => api.adminWorkflows(token),
      "Failed to load workflow definitions",
    );

  return (
    <AdminSectionState
      loading={loading}
      loadingLabel="Loading workflow definitions…"
      denied={denied}
      sessionExpired={sessionExpired}
      error={error}
      requiredPermission="workflow.definition.read"
      onRetry={reload}
    >
      <AdminPanel
        title="Workflow definitions"
        description="Configured approval and lifecycle definitions and the entity type each governs. This view does not expose authoring controls or rule internals."
      >
        <DataTable
          columns={COLUMNS}
          rows={data ?? []}
          keyOf={(workflow) => workflow.code}
          mobileBreakpoint="md"
          empty={
            <AdminEmpty
              title="No workflow definitions configured"
              description="No configured workflow definitions were returned for this tenant."
            />
          }
        />
      </AdminPanel>
    </AdminSectionState>
  );
}
