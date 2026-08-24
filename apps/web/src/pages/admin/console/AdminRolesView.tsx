/** Phase 11F — Tenant role summaries with on-demand permission inspection. */
import { useCallback, useRef, useState } from "react";
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
  const detailTriggerRef = useRef<HTMLButtonElement | null>(null);

  const closeDetails = useCallback(() => {
    const trigger = detailTriggerRef.current;
    setSelectedRole(null);
    setDetails(null);
    setDetailState("idle");
    setDetailError(null);
    window.setTimeout(() => trigger?.focus(), 0);
  }, []);

  const loadRoleDetails = useCallback(
    async (role: AdminRoleSummary) => {
      setSelectedRole(role);
      setDetails(null);
      setDetailState("loading");
      setDetailError(null);
      try {
        const result = await api.adminRolePermissions(token, role.code);
        setDetails(result);
        setDetailState("ready");
      } catch (err) {
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
              <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200">
                {details.permissions.map((permission) => (
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
      </OverlayDialog>
    </>
  );
}
