/** Phase 11F — Tenant role summaries, with the Epic 4 Wave 1 definition
 *  editor reached per role. The summary list and the definition resource are
 *  separate reads with separate permissions: an actor may list roles without
 *  being allowed to open a definition, so the row link is only offered when
 *  the definition is readable. */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import type { MouseEvent } from "react";
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
import { CreateRoleDialog } from "./AdminRoleDefinitionView";

export function AdminRolesView({
  canManage,
  canRead,
}: {
  /** `role.manage`, tenant-scoped — mirrors the server's write gate. */
  canManage: boolean;
  /** `config.read`, tenant-scoped — mirrors the server's definition read gate. */
  canRead: boolean;
}) {
  const { session, logout } = useAuth();
  const token = session!.accessToken;
  const navigate = useNavigate();
  const [createOpen, setCreateOpen] = useState(false);
  const [copySource, setCopySource] = useState<AdminRoleSummary | null>(null);
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
      cell: (role) => <code className="font-mono text-xs font-medium text-ink">{role.code}</code>,
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
    },
    {
      // Epic 4 open item 2 — lifecycle is a SEPARATE fact from access breadth,
      // so it gets its own column rather than overloading the Access pill. A
      // deactivated Role still appears here (it owns assignment history); what
      // changes is that it can no longer be granted.
      header: "Status",
      cell: (role) =>
        role.isActive ? (
          <StatusPill tone="success">Active</StatusPill>
        ) : (
          <StatusPill tone="neutral">Inactive</StatusPill>
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
        <div className="flex flex-wrap items-center justify-end gap-2">
          <Button
            variant="secondary"
            className="w-full sm:min-h-[44px] sm:w-auto"
            onClick={(event) => {
              // The row itself opens the definition; this button must not.
              event.stopPropagation();
              detailTriggerRef.current = event.currentTarget;
              void loadRoleDetails(role);
            }}
          >
            View permissions
          </Button>
          {canRead && (
            <Link
              to={`/admin/roles/${encodeURIComponent(role.code)}`}
              onClick={(event: MouseEvent<HTMLAnchorElement>) => event.stopPropagation()}
              className="inline-flex min-h-[44px] items-center justify-center rounded border border-line-strong bg-panel px-3 py-1.5 text-sm font-medium text-ink-dim hover:bg-panel-2 hover:text-ink focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-accent sm:min-h-[36px]"
            >
              Definition
            </Link>
          )}
          {canManage && (
            <Button
              variant="ghost"
              className="w-full sm:min-h-[44px] sm:w-auto"
              onClick={(event) => {
                event.stopPropagation();
                setCopySource(role);
              }}
            >
              Copy
            </Button>
          )}
        </div>
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
          actions={
            canManage && (
              <Button onClick={() => setCreateOpen(true)}>New role</Button>
            )
          }
        >
          <DataTable
            columns={columns}
            rows={data ?? []}
            keyOf={(role) => role.code}
            mobileBreakpoint="md"
            onRowClick={
              canRead ? (role) => navigate(`/admin/roles/${encodeURIComponent(role.code)}`) : undefined
            }
            empty={
              <AdminEmpty
                title="No roles configured"
                description="No tenant-local role definitions were returned for this tenant."
              />
            }
          />
        </AdminPanel>
      </AdminSectionState>

      <CreateRoleDialog
        open={createOpen}
        mode="create"
        canManage={canManage}
        onClose={() => setCreateOpen(false)}
        onCreated={(roleCode) => {
          setCreateOpen(false);
          void reload();
          navigate(`/admin/roles/${encodeURIComponent(roleCode)}`);
        }}
      />

      <CreateRoleDialog
        open={copySource !== null}
        mode="copy"
        sourceCode={copySource?.code}
        canManage={canManage}
        onClose={() => setCopySource(null)}
        onCreated={(roleCode) => {
          setCopySource(null);
          void reload();
          navigate(`/admin/roles/${encodeURIComponent(roleCode)}`);
        }}
      />

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
            <div className="flex flex-wrap items-center justify-between gap-3 rounded border border-line bg-panel-2 p-3">
              <div>
                <div className="font-medium text-ink">{details.roleName}</div>
                <code className="font-mono text-xs text-ink-dim">{details.roleCode}</code>
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
                      className="text-sm tabular-nums text-ink-dim"
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
                  <ul className="divide-y divide-line rounded border border-line">
                    {filteredPermissions.map((permission) => (
                      <li key={permission.code} className="px-3 py-3">
                        <code className="break-all font-mono text-xs font-medium text-ink">
                          {permission.code}
                        </code>
                        <p className="mt-1 text-sm text-ink-dim">{permission.description}</p>
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
