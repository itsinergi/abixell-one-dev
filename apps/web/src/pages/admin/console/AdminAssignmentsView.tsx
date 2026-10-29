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
import { useT } from "../../../i18n/LocaleProvider";
import { DataTable, EmptyState, Field, Input, StatusPill } from "../../../shell/components/ui";
import { AdminPanel, AdminSectionState } from "./AdminSection";
import { useAdminResource } from "./useAdminResource";
import { api } from "../../../lib/api";

type Translate = ReturnType<typeof useT>;

function roleLabel(t: Translate, assignment: AdminRoleAssignmentSummary): string {
  return assignment.roleState === "available"
    ? assignment.roleName ?? assignment.roleCode ?? t("adminAssignments.roleUnavailable")
    : t("adminAssignments.roleUnavailable");
}

/** Wave 3 — the inventory reads the same lifecycle state the user-centric
 * surface shows, so one policy never splits into two labels. */
function stateLabel(t: Translate, assignment: AdminRoleAssignmentSummary): string {
  switch (assignment.assignmentState) {
    case "active":
      return t("adminAssignments.stateActive");
    case "revoked":
      return t("adminAssignments.stateRevoked");
    case "invalidated":
      return t("adminAssignments.stateInvalidated");
    default:
      return t("adminAssignments.stateUnavailable");
  }
}

function scopeLabel(t: Translate, assignment: AdminRoleAssignmentSummary): string {
  if (assignment.scopeType === "tenant") return t("adminAssignments.scopeTenantWide");
  if (assignment.scopeType === "legal_entity") {
    return assignment.scopeState === "available"
      ? assignment.scopeLegalEntityName ?? t("adminAssignments.legalEntityUnavailable")
      : t("adminAssignments.legalEntityUnavailable");
  }
  if (assignment.scopeType === "organization_unit") {
    return assignment.scopeState === "available"
      ? assignment.scopeOrganizationUnitName ?? t("adminAssignments.orgUnitUnavailable")
      : t("adminAssignments.orgUnitUnavailable");
  }
  return assignment.scopeState === "available"
    ? assignment.scopeCustomerName ?? t("adminAssignments.customerUnavailable")
    : t("adminAssignments.customerUnavailable");
}

export function AdminAssignmentsView({
  canManageAccess,
}: {
  canManageAccess: boolean;
}) {
  const t = useT();
  const resource = useAdminResource<AdminAssignmentRow[]>(
    (token) => api.adminAssignments(token),
    t("adminAssignments.loadFailed"),
    canManageAccess,
  );
  const [query, setQuery] = useState("");
  const rows = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase();
    if (!normalized) return resource.data ?? [];
    return (resource.data ?? []).filter((row) =>
      `${row.userName} ${row.userEmail} ${row.roleName ?? ""} ${row.roleCode ?? ""} ${scopeLabel(t, row)}`
        .toLocaleLowerCase()
        .includes(normalized),
    );
  }, [query, resource.data, t]);

  if (!canManageAccess) return null;

  return (
    <AdminSectionState
      loading={resource.loading}
      loadingLabel={t("adminAssignments.loading")}
      denied={resource.denied}
      sessionExpired={resource.sessionExpired}
      error={resource.error}
      requiredPermission="user.role.manage"
      onRetry={resource.reload}
    >
      <AdminPanel
        title={t("adminAssignments.title")}
        description={t("adminAssignments.description")}
      >
        <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <Field label={t("adminAssignments.searchLabel")}>
            <Input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t("adminAssignments.searchPlaceholder")}
              aria-label={t("adminAssignments.searchAria")}
              autoComplete="off"
              className="sm:w-80"
            />
          </Field>
          <p className="text-sm tabular-nums text-ink-dim" role="status" aria-live="polite">
            {t("adminAssignments.showing", {
              shown: rows.length,
              total: (resource.data ?? []).length,
            })}
          </p>
        </div>
        <DataTable
          rows={rows}
          keyOf={(row) => row.id}
          mobileBreakpoint="md"
          empty={
            <EmptyState
              title={t("adminAssignments.emptyTitle")}
              description={
                query
                  ? t("adminAssignments.emptySearch")
                  : t("adminAssignments.emptyAll")
              }
            />
          }
          columns={[
            {
              header: t("adminAssignments.columnUser"),
              mobileRole: "title",
              cell: (row) => (
                <div>
                  <div className="font-medium text-ink">{row.userName}</div>
                  <div className="break-all text-xs text-ink-dim">{row.userEmail}</div>
                </div>
              ),
            },
            {
              header: t("adminAssignments.columnUserStatus"),
              mobileRole: "status",
              cell: (row) => (
                <StatusPill tone={row.userStatus === "active" ? "success" : "neutral"}>
                  {row.userStatus}
                </StatusPill>
              ),
            },
            {
              header: t("adminAssignments.columnRole"),
              cell: (row) => (
                <div>
                  <div className="text-sm text-ink">{roleLabel(t, row)}</div>
                  {row.roleCode && (
                    <code className="break-all font-mono text-[11.5px] text-ink-dim">
                      {row.roleCode}
                    </code>
                  )}
                </div>
              ),
            },
            {
              header: t("adminAssignments.columnScope"),
              mobileRole: "detail",
              cell: (row) => (
                <span className="text-sm text-ink-dim">{scopeLabel(t, row)}</span>
              ),
            },
            {
              header: t("adminAssignments.columnState"),
              mobileRole: "status",
              cell: (row) => (
                <StatusPill tone={row.assignmentState === "active" ? "success" : "warning"}>
                  {stateLabel(t, row)}
                </StatusPill>
              ),
            },
            {
              header: t("adminAssignments.columnRevoked"),
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