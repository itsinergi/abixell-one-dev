/**
 * Epic 4 Wave 2 §4.4 step 13 — assignment-centric inventory.
 *
 * This intentionally loads its own endpoint. GET /admin/assignments requires
 * `user.role.manage`, unlike the user-centric screen's `user.read`; hiding
 * this panel when the derived capability is absent is a UX convenience only.
 * The service remains authoritative and returns 403 for a handcrafted request.
 */
import { useMemo, useState } from "react";
import {
  type AdminAssignmentRow,
  type AdminRoleAssignmentSummary,
} from "../../../lib/api";
import { DataTable, EmptyState, Field, Input, StatusPill } from "../../../shell/components/ui";
import { AdminPanel, AdminSectionState } from "./AdminSection";
import { useAdminResource } from "./useAdminResource";
import { api } from "../../../lib/api";

function roleLabel(assignment: AdminRoleAssignmentSummary): string {
  return assignment.roleState === "available"
    ? assignment.roleName ?? assignment.roleCode ?? "Unavailable role"
    : "Unavailable role";
}

/** Wave 3 — the inventory reads the same lifecycle state the user-centric
 * surface shows, so one policy never splits into two labels. */
function stateLabel(assignment: AdminRoleAssignmentSummary): string {
  switch (assignment.assignmentState) {
    case "active":
      return "Active";
    case "revoked":
      return "Revoked";
    case "invalidated":
      return "Invalidated";
    default:
      return "Unavailable";
  }
}

function scopeLabel(assignment: AdminRoleAssignmentSummary): string {
  if (assignment.scopeType === "tenant") return "Tenant-wide";
  if (assignment.scopeType === "legal_entity") {
    return assignment.scopeState === "available"
      ? assignment.scopeLegalEntityName ?? "Unavailable legal entity"
      : "Unavailable legal entity";
  }
  if (assignment.scopeType === "organization_unit") {
    return assignment.scopeState === "available"
      ? assignment.scopeOrganizationUnitName ?? "Unavailable organization unit"
      : "Unavailable organization unit";
  }
  return assignment.scopeState === "available"
    ? assignment.scopeCustomerName ?? "Unavailable customer"
    : "Unavailable customer";
}

export function AdminAssignmentsView({
  canManageAccess,
}: {
  canManageAccess: boolean;
}) {
  const resource = useAdminResource<AdminAssignmentRow[]>(
    (token) => api.adminAssignments(token),
    "Failed to load assignment inventory",
    canManageAccess,
  );
  const [query, setQuery] = useState("");
  const rows = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase();
    if (!normalized) return resource.data ?? [];
    return (resource.data ?? []).filter((row) =>
      `${row.userName} ${row.userEmail} ${row.roleName ?? ""} ${row.roleCode ?? ""} ${scopeLabel(row)}`
        .toLocaleLowerCase()
        .includes(normalized),
    );
  }, [query, resource.data]);

  if (!canManageAccess) return null;

  return (
    <AdminSectionState
      loading={resource.loading}
      loadingLabel="Loading assignment inventory…"
      denied={resource.denied}
      sessionExpired={resource.sessionExpired}
      error={resource.error}
      requiredPermission="user.role.manage"
      onRetry={resource.reload}
    >
      <AdminPanel
        title="Assignment inventory"
        description="Cross-user view of role grants inside your current administrative visibility."
      >
        <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <Field label="Search assignments">
            <Input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="User, email, role, or scope"
              aria-label="Search assignments by user, email, role, or scope"
              autoComplete="off"
              className="sm:w-80"
            />
          </Field>
          <p className="text-sm tabular-nums text-ink-dim" role="status" aria-live="polite">
            Showing {rows.length} of {(resource.data ?? []).length}
          </p>
        </div>
        <DataTable
          rows={rows}
          keyOf={(row) => row.id}
          mobileBreakpoint="md"
          empty={
            <EmptyState
              title="No assignments found"
              description={query ? "Try a different search term." : "No visible role assignments exist."}
            />
          }
          columns={[
            {
              header: "User",
              mobileRole: "title",
              cell: (row) => (
                <div>
                  <div className="font-medium text-ink">{row.userName}</div>
                  <div className="break-all text-xs text-ink-dim">{row.userEmail}</div>
                </div>
              ),
            },
            {
              header: "User status",
              mobileRole: "status",
              cell: (row) => (
                <StatusPill tone={row.userStatus === "active" ? "success" : "neutral"}>
                  {row.userStatus}
                </StatusPill>
              ),
            },
            {
              header: "Role",
              cell: (row) => (
                <div>
                  <div className="text-sm text-ink">{roleLabel(row)}</div>
                  {row.roleCode && (
                    <code className="break-all font-mono text-[11.5px] text-ink-dim">
                      {row.roleCode}
                    </code>
                  )}
                </div>
              ),
            },
            {
              header: "Scope",
              mobileRole: "detail",
              cell: (row) => <span className="text-sm text-ink-dim">{scopeLabel(row)}</span>,
            },
            {
              header: "State",
              mobileRole: "status",
              cell: (row) => (
                <StatusPill tone={row.assignmentState === "active" ? "success" : "warning"}>
                  {stateLabel(row)}
                </StatusPill>
              ),
            },
            {
              header: "Revoked",
              mobileRole: "detail",
              cell: (row) =>
                row.revokedAt ? (
                  <div>
                    <div className="text-sm text-ink">{new Date(row.revokedAt).toLocaleString()}</div>
                    {row.revokeReason && (
                      <div className="text-xs text-ink-dim">{row.revokeReason}</div>
                    )}
                  </div>
                ) : (
                  <span className="text-sm text-ink-faint">—</span>
                ),
            },
          ]}
        />
      </AdminPanel>
    </AdminSectionState>
  );
}
