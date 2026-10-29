/**
 * Phase 11C — Permission catalogue, read-only.
 *
 * This is the fixed list of capabilities that CAN be granted, not a record
 * of who holds them. It is global platform metadata — identical in every
 * deployment and naming no tenant, user, or record.
 */
import { useMemo, useState } from "react";
import { useT } from "../../../i18n/LocaleProvider";
import { api, type AdminPermission } from "../../../lib/api";
import {
  Button,
  DataTable,
  EmptyState,
  Input,
  type Column,
} from "../../../shell/components/ui";
import { AdminEmpty, AdminPanel, AdminSectionState } from "./AdminSection";
import { useAdminResource } from "./useAdminResource";

export function AdminPermissionsView() {
  const t = useT();
  const { data, loading, error, denied, sessionExpired, reload } =
    useAdminResource<AdminPermission[]>(
      (token) => api.adminPermissions(token),
      t("adminPermissions.loadFailed"),
    );
  const [filter, setFilter] = useState("");

  // The catalogue is long; filtering is purely client-side over data the
  // actor already holds, so it adds no request and no new exposure.
  const rows = useMemo(() => {
    const needle = filter.trim().toLocaleLowerCase();
    if (!needle) return data ?? [];
    return (data ?? []).filter(
      (permission) =>
        permission.code.toLocaleLowerCase().includes(needle) ||
        permission.description.toLocaleLowerCase().includes(needle),
    );
  }, [data, filter]);
  const hasFilter = filter.trim().length > 0;

  const columns: Column<AdminPermission>[] = [
    {
      header: t("adminPermissions.columnCode"),
      cell: (permission) => (
        <code className="break-all font-mono text-xs font-medium text-ink">{permission.code}</code>
      ),
      mobileRole: "title",
    },
    { header: t("adminPermissions.columnDescription"), cell: (permission) => permission.description },
  ];

  return (
    <AdminSectionState
      loading={loading}
      loadingLabel={t("adminPermissions.loading")}
      denied={denied}
      sessionExpired={sessionExpired}
      error={error}
      requiredPermission="config.read"
      onRetry={reload}
    >
      <AdminPanel
        title={t("adminPermissions.title")}
        description={t("adminPermissions.description")}
      >
        <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div className="w-full max-w-sm">
            <label htmlFor="admin-permission-filter" className="text-sm font-medium text-ink-dim">
              {t("adminPermissions.filterLabel")}
            </label>
            <Input
              id="admin-permission-filter"
              type="search"
              value={filter}
              onChange={(event) => setFilter(event.target.value)}
              placeholder={t("adminPermissions.filterPlaceholder")}
            />
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <p className="text-sm tabular-nums text-ink-dim" role="status" aria-live="polite">
              {t("adminPermissions.showing", { shown: rows.length, total: (data ?? []).length })}
            </p>
            {hasFilter && (
              <Button variant="secondary" onClick={() => setFilter("")}>
                {t("adminPermissions.clearFilters")}
              </Button>
            )}
          </div>
        </div>
        <DataTable
          columns={columns}
          rows={rows}
          keyOf={(permission) => permission.code}
          mobileBreakpoint="md"
          empty={
            hasFilter ? (
              <EmptyState
                title={t("adminPermissions.noMatch", { query: filter.trim() })}
                description={t("adminPermissions.noMatchDescription")}
                action={
                  <Button variant="secondary" onClick={() => setFilter("")}>
                    {t("adminPermissions.clearFilters")}
                  </Button>
                }
              />
            ) : (
              <AdminEmpty
                title={t("adminPermissions.emptyTitle")}
                description={t("adminPermissions.emptyDescription")}
              />
            )
          }
        />
      </AdminPanel>
    </AdminSectionState>
  );
}
