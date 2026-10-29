/**
 * Phase 11C — Workflow definitions, read-only.
 *
 * Lists WHICH lifecycle/approval definitions exist and what they govern.
 * Internal steps, transitions, and conditions are authoring territory and
 * are intentionally not projected here.
 */
import { useT } from "../../../i18n/LocaleProvider";
import { api, type AdminWorkflowSummary } from "../../../lib/api";
import { DataTable, StatusPill, type Column } from "../../../shell/components/ui";
import { AdminEmpty, AdminPanel, AdminSectionState } from "./AdminSection";
import { useAdminResource } from "./useAdminResource";

export function AdminWorkflowsView() {
  const t = useT();
  const { data, loading, error, denied, sessionExpired, reload } =
    useAdminResource<AdminWorkflowSummary[]>(
      (token) => api.adminWorkflows(token),
      t("adminWorkflows.loadFailed"),
    );

  const columns: Column<AdminWorkflowSummary>[] = [
    {
      header: t("adminWorkflows.columnCode"),
      cell: (workflow) => (
        <code className="break-all font-mono text-xs font-medium text-ink">{workflow.code}</code>
      ),
      mobileRole: "title",
    },
    { header: t("adminWorkflows.columnName"), cell: (workflow) => workflow.name },
    {
      header: t("adminWorkflows.columnAppliesto"),
      cell: (workflow) => <code className="break-all font-mono text-xs">{workflow.entityType}</code>,
    },
    {
      header: t("adminWorkflows.columnStatus"),
      cell: (workflow) =>
        workflow.isActive ? (
          <StatusPill tone="success">{t("adminWorkflows.statusActive")}</StatusPill>
        ) : (
          <StatusPill tone="neutral">{t("adminWorkflows.statusInactive")}</StatusPill>
        ),
      mobileRole: "status",
    },
  ];

  return (
    <AdminSectionState
      loading={loading}
      loadingLabel={t("adminWorkflows.loading")}
      denied={denied}
      sessionExpired={sessionExpired}
      error={error}
      requiredPermission="workflow.definition.read"
      onRetry={reload}
    >
      <AdminPanel title={t("adminWorkflows.title")} description={t("adminWorkflows.description")}>
        <DataTable
          columns={columns}
          rows={data ?? []}
          keyOf={(workflow) => workflow.code}
          mobileBreakpoint="md"
          empty={
            <AdminEmpty
              title={t("adminWorkflows.emptyTitle")}
              description={t("adminWorkflows.emptyDescription")}
            />
          }
        />
      </AdminPanel>
    </AdminSectionState>
  );
}
