/**
 * Phase 11C — Permission catalogue, read-only.
 *
 * This is the fixed list of capabilities that CAN be granted, not a record
 * of who holds them. It is global platform metadata — identical in every
 * deployment and naming no tenant, user, or record — so showing it leaks
 * nothing across tenant boundaries.
 */
import { useMemo, useState } from "react";
import { api, type AdminPermission } from "../../../lib/api";
import { DataTable, EmptyState, Input, type Column } from "../../../shell/components/ui";
import { AdminEmpty, AdminPanel, AdminSectionState } from "./AdminSection";
import { useAdminResource } from "./useAdminResource";

const COLUMNS: Column<AdminPermission>[] = [
  { header: "Code", cell: (p) => <span className="font-medium text-slate-800">{p.code}</span> },
  { header: "Description", cell: (p) => p.description },
];

export function AdminPermissionsView() {
  const { data, loading, error, denied, reload } = useAdminResource<AdminPermission[]>(
    (token) => api.adminPermissions(token),
    "Failed to load permissions",
  );
  const [filter, setFilter] = useState("");

  // The catalogue is long; filtering is purely client-side over data the
  // actor already holds, so it adds no request and no new exposure.
  const rows = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    if (!needle) return data ?? [];
    return (data ?? []).filter(
      (p) =>
        p.code.toLowerCase().includes(needle) || p.description.toLowerCase().includes(needle),
    );
  }, [data, filter]);

  return (
    <AdminSectionState
      loading={loading}
      denied={denied}
      error={error}
      requiredPermission="config.read"
      onRetry={reload}
    >
      <AdminPanel
        title="Permissions"
        description="Every capability that can be granted to a role here. This list is fixed by the platform and cannot be edited."
      >
        <div className="mb-4 max-w-sm">
          <Input
            type="search"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filter permissions…"
            aria-label="Filter permissions"
          />
        </div>
        <DataTable
          columns={COLUMNS}
          rows={rows}
          keyOf={(p) => p.code}
          empty={
            filter.trim() ? (
              <EmptyState
                title="No permissions match that filter"
                description="Try a shorter or different search term."
              />
            ) : (
              <AdminEmpty what="permissions" />
            )
          }
        />
      </AdminPanel>
    </AdminSectionState>
  );
}
