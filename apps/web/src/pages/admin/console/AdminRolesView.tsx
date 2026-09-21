/** Phase 11F — Tenant role summaries with on-demand permission inspection. */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "../../../auth/AuthContext";
import {
  api,
  ApiError,
  type AdminRolePermissions,
  type AdminRoleSummary,
} from "../../../lib/api";
import {
  Alert,
  Button,
  DataTable,
  EmptyState,
  Field,
  Input,
  Spinner,
  StatusPill,
  type Column,
} from "../../../shell/components/ui";
import { OverlayDialog } from "../../../shell/components/OverlayDialog";
import { AdminEmpty, AdminPanel, AdminSectionState } from "./AdminSection";
import { useAdminResource } from "./useAdminResource";

export function AdminRolesView() {
  const { session, logout } = useAuth();
  const token = session!.accessToken;
  const { data, loading, error, denied, sessionExpired, reload } =
    useAdminResource<AdminRoleSummary[]>(
      (accessToken) => api.adminRoles(accessToken),
      "Failed to load roles",
    );
  const [selectedRole, setSelectedRole] = useState<AdminRoleSummary | null>(null);
  const [details, setDetails] = useState<AdminRolePermissions | null>(null);
  const [detailState, setDetailState] = useState<
    "idle" | "loading" | "ready" | "denied" | "session-expired" | "error"
  >("idle");
  const [detailError, setDetailError] = useState<string | null>(null);
  const [permissionQuery, setPermissionQuery] = useState("");
  const detailTriggerRef = useRef<HTMLButtonElement | null>(null);
  // Guards against a slower earlier request resolving after a newer one and
  // overwriting the permissions shown for the role currently on screen.
  const detailRequestRef = useRef(0);

  useEffect(() => () => {
    detailRequestRef.current += 1;
  }, []);

  const closeDetails = useCallback(() => {
    const trigger = detailTriggerRef.current;
    detailRequestRef.current += 1;
    setSelectedRole(null);
    setDetails(null);
    setDetailState("idle");
    setDetailError(null);
    setPermissionQuery("");
    window.setTimeout(() => trigger?.focus(), 0);
  }, []);

  const loadRoleDetails = useCallback(
    async (role: AdminRoleSummary) => {
      const requestId = detailRequestRef.current + 1;
      detailRequestRef.current = requestId;
      setSelectedRole(role);
      setDetails(null);
      setDetailState("loading");
      setDetailError(null);
      setPermissionQuery("");
      try {
        const result = await api.adminRolePermissions(token, role.code);
        if (detailRequestRef.current !== requestId) return;
        setDetails(result);
        setDetailState("ready");
      } catch (err) {
        if (detailRequestRef.current !== requestId) return;
        if (err instanceof ApiError && err.status === 403) {
          setDetailState("denied");
        } else if (err instanceof ApiError && err.status === 401) {
          setDetailState("session-expired");
        } else {
          setDetailError(err instanceof ApiError ? err.message : "Failed to load role permissions");
          setDetailState("error");
        }
      }
    },
    [token],
  );

  const filteredPermissions = useMemo(() => {
    if (!details?.permissions) return [];
    const normalized = permissionQuery.trim().toLocaleLowerCase();
    if (!normalized) return details.permissions;
    return details.permissions.filter((p) =>
      `${p.code} ${p.description}`.toLocaleLowerCase().includes(normalized),
    );
  }, [details?.permissions, permissionQuery]);

  const columns: Column<AdminRoleSummary>[] = [
    {
      header: "Code",
      cell: (role) => <code className="font-mono text-xs font-medium text-slate-800">{role.code}</code>,
      mobileRole: "title",
    },
    { header: "Name", cell: (role) => role.name },
    {
      header: "Access",
      cell: (role) =>
        role.isFullAccess ? (
          <StatusPill tone="warning">Full access</StatusPill>
        ) : (
          <StatusPill tone="neutral">Scoped</StatusPill>
        ),
      mobileRole: "status",
    },
    {
      header: "Permissions",
      cell: (role) => <span className="tabular-nums">{role.permissionCount}</span>,
      className: "text-right tabular-nums",
    },
    {
      header: "Users",
      cell: (role) => <span className="tabular-nums">{role.assignedUserCount}</span>,
      className: "text-right tabular-nums",
    },
    {
      header: "Details",
      cell: (role) => (
        <Button
          variant="secondary"
          className="w-full sm:min-h-[44px] sm:w-auto"
          onClick={(event) => {
            detailTriggerRef.current = event.currentTarget;
            void loadRoleDetails(role);
          }}
        >
          View permissions
        </Button>
      ),
      className: "text-right",
    },
  ];

  return (
    <>
      <AdminSectionState
        loading={loading}
        loadingLabel="Loading tenant roles…"
        denied={denied}
        sessionExpired={sessionExpired}
        error={error}
        requiredPermission="config.read"
        onRetry={reload}
      >
        <AdminPanel
          title="Roles"
          description="Tenant-local roles, access breadth, permission totals, and assignment totals. Open one role to inspect its current grants."
        >
          <DataTable
            columns={columns}
            rows={data ?? []}
            keyOf={(role) => role.code}
            mobileBreakpoint="md"
            empty={
              <AdminEmpty
                title="No roles configured"
                description="No tenant-local role definitions were returned for this tenant."
              />
            }
          />
        </AdminPanel>
      </AdminSectionState>

      <OverlayDialog
        open={selectedRole !== null}
        title={selectedRole ? `${selectedRole.name} permissions` : "Role permissions"}
        description={
          selectedRole ? (
            <>
              On-demand grants for <code className="font-mono text-xs">{selectedRole.code}</code>.
            </>
          ) : undefined
        }
        onClose={closeDetails}
        restoreFocusRef={detailTriggerRef}
        footer={
          <Button variant="secondary" className="min-h-[44px]" onClick={closeDetails}>
            Close
          </Button>
        }
      >
        {detailState === "loading" && <Spinner label="Loading role permissions…" />}
        {detailState === "denied" && (
          <EmptyState
            title="Permission details are restricted"
            description="You can see the role summary, but your access does not allow its permission membership to be inspected."
          />
        )}
        {detailState === "session-expired" && (
          <EmptyState
            title="Your session has expired"
            description="Sign in again to inspect this role."
            action={<Button onClick={logout}>Sign in again</Button>}
          />
        )}
        {detailState === "error" && (
          <Alert tone="error">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <span>{detailError}</span>
              {selectedRole && (
                <Button variant="secondary" onClick={() => void loadRoleDetails(selectedRole)}>
                  Retry
                </Button>
              )}
            </div>
          </Alert>
        )}
        {detailState === "ready" && details && (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-200 bg-slate-50 p-3">
              <div>
                <div className="font-medium text-slate-900">{details.roleName}</div>
                <code className="font-mono text-xs text-slate-600">{details.roleCode}</code>
              </div>
              {details.isFullAccess ? (
                <StatusPill tone="warning">Full access</StatusPill>
              ) : (
                <StatusPill tone="neutral">Scoped access</StatusPill>
              )}
            </div>
            {details.permissions.length === 0 ? (
              <EmptyState
                title="No permissions assigned"
                description="This role currently has no listed permission grants."
              />
            ) : (
              <div className="space-y-3">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
                  <Field label="Filter permissions">
                    <Input
                      type="search"
                      value={permissionQuery}
                      onChange={(e) => setPermissionQuery(e.target.value)}
                      placeholder="Search by code or description"
                      autoComplete="off"
                      aria-label="Filter role permissions"
                      className="sm:w-80"
                    />
                  </Field>
                  <div className="flex items-center gap-3">
                    <p
                      className="text-sm tabular-nums text-slate-500"
                      role="status"
                      aria-live="polite"
                    >
                      Showing {filteredPermissions.length} of {details.permissions.length}
                    </p>
                    {permissionQuery.trim() !== "" && (
                      <Button variant="ghost" onClick={() => setPermissionQuery("")}>
                        Clear search
                      </Button>
                    )}
                  </div>
                </div>
                {filteredPermissions.length === 0 ? (
                  <EmptyState
                    title="No matching permissions"
                    description="Try a different search term or clear the filter."
                  />
                ) : (
                  <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200">
                    {filteredPermissions.map((permission) => (
                      <li key={permission.code} className="px-3 py-3">
                        <code className="break-all font-mono text-xs font-medium text-slate-800">
                          {permission.code}
                        </code>
                        <p className="mt-1 text-sm text-slate-500">{permission.description}</p>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </div>
        )}
      </OverlayDialog>
    </>
  );
}
