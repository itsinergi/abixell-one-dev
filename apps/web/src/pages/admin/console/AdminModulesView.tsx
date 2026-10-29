/**
 * Phase 11C — Module activation, read-only.
 *
 * Shows the configuration records returned for this tenant. Activation is
 * NOT toggled here: Phase 11C adds no mutation surface.
 */
import { useT } from "../../../i18n/LocaleProvider";
import { api, type AdminModuleSummary } from "../../../lib/api";
import { DataTable, StatusPill, type Column } from "../../../shell/components/ui";
import { AdminEmpty, AdminPanel, AdminSectionState } from "./AdminSection";
import { useAdminResource } from "./useAdminResource";

export function AdminModulesView() {
  const t = useT();
  const { data, loading, error, denied, sessionExpired, reload } =
    useAdminResource<AdminModuleSummary[]>(
      (token) => api.adminModules(token),
      t("adminModules.loadFailed"),
    );

  const columns: Column<AdminModuleSummary>[] = [
    {
      header: t("adminModules.columnModule"),
      cell: (module) => <span className="font-medium text-ink">{module.moduleName}</span>,
      mobileRole: "title",
    },
    {
      header: t("adminModules.columnCode"),
      cell: (module) => <code className="break-all font-mono text-xs">{module.moduleCode}</code>,
    },
    {
      header: t("adminModules.columnStatus"),
      cell: (module) =>
        module.isActive ? (
          <StatusPill tone="success">{t("adminModules.statusActive")}</StatusPill>
        ) : (
          <StatusPill tone="neutral">{t("adminModules.statusInactive")}</StatusPill>
        ),
      mobileRole: "status",
    },
  ];

  return (
    <AdminSectionState
      loading={loading}
      loadingLabel={t("adminModules.loading")}
      denied={denied}
      sessionExpired={sessionExpired}
      error={error}
      requiredPermission="config.read"
      onRetry={reload}
    >
      <AdminPanel title={t("adminModules.title")} description={t("adminModules.description")}>
        <DataTable
          columns={columns}
          rows={data ?? []}
          keyOf={(module) => module.moduleCode}
          mobileBreakpoint="md"
          empty={
            <AdminEmpty
              title={t("adminModules.emptyTitle")}
              description={t("adminModules.emptyDescription")}
            />
          }
        />
      </AdminPanel>
    </AdminSectionState>
  );
}
