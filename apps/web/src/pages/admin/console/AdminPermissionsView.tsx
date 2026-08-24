/**
 * Phase 11C — Permission catalogue, read-only.
 *
 * This is the fixed list of capabilities that CAN be granted, not a record
 * of who holds them. It is global platform metadata — identical in every
 * deployment and naming no tenant, user, or record.
 */
import { useMemo, useState } from "react";
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

const COLUMNS: Column<AdminPermission>[] = [
  {
    header: "Code",
    cell: (permission) => (
      <code className="break-all font-mono text-xs font-medium text-slate-800">{permission.code}</code>
    ),
    mobileRole: "title",
  },
  { header: "Description", cell: (permission) => permission.description },
];

export function AdminPermissionsView() {
  const { data, loading, error, denied, sessionExpired, reload } =
    useAdminResource<AdminPermission[]>(
      (token) => api.adminPermissions(token),
      "Failed to load permissions",
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

  return (
    <AdminSectionState
      loading={loading}
      loadingLabel="Loading permission catalogue…"
      denied={denied}
      sessionExpired={sessionExpired}
      error={error}
      requiredPermission="config.read"
      onRetry={reload}
    >
      <AdminPanel
        title="Permissions"
        description="Grantable capability metadata fixed by the platform. This is not a user assignment list and cannot be edited here."
      >
        <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div className="w-full max-w-sm">
            <label htmlFor="admin-permission-filter" className="text-sm font-medium text-slate-700">
              Filter permissions
            </label>
            <Input
              id="admin-permission-filter"
              type="search"
              value={filter}
              onChange={(event) => setFilter(event.target.value)}
              placeholder="Search code or description"
            />
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <p className="text-sm tabular-nums text-slate-500" role="status" aria-live="polite">
              Showing {rows.length} of {(data ?? []).length}
            </p>
            {hasFilter && (
              <Button variant="secondary" onClick={() => setFilter("")}>
                Clear filters
              </Button>
            )}
          </div>
        </div>
        <DataTable
          columns={COLUMNS}
          rows={rows}
          keyOf={(permission) => permission.code}
          mobileBreakpoint="md"
          empty={
            hasFilter ? (
              <EmptyState
                title={`No permissions match “${filter.trim()}”`}
                description="Try a different code or description."
                action={
                  <Button variant="secondary" onClick={() => setFilter("")}>
                    Clear filters
                  </Button>
                }
              />
            ) : (
              <AdminEmpty
                title="No permissions available"
                description="The platform permission catalogue returned no entries."
              />
            )
          }
        />
      </AdminPanel>
    </AdminSectionState>
  );
}
