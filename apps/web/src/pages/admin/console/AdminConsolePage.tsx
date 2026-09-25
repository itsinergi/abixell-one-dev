/**
 * Phase 11C/11E/11F — Business Admin Console Foundation.
 *
 * A tenant-local consolidation of platform administration: who exists, what
 * access is defined, which modules and workflows are configured, and what
 * happened recently. Phase 11F adds governed user-role assignment changes and
 * this page permits a separately-gated tenant-name update. Other sections
 * remain read only. This is not the Platform Architect or Builder Console and
 * provides no metadata, schema, query, or package tools.
 */
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useAuth } from "../../../auth/AuthContext";
import { api, ApiError, type AdminCountSection, type AdminOverview } from "../../../lib/api";
import { isInternalScope, PERMISSIONS } from "../../../lib/capabilities";
import { OverlayDialog } from "../../../shell/components/OverlayDialog";
import {
  Alert,
  Badge,
  Button,
  Card,
  EmptyState,
  Field,
  Input,
  PageHeader,
  PermissionDeniedState,
  StatusPill,
} from "../../../shell/components/ui";
import { useShell } from "../../../shell/layout/AppShell";
import { AdminSectionState } from "./AdminSection";
import { useAdminResource, type AdminResourceState } from "./useAdminResource";
import { AdminRolesView } from "./AdminRolesView";
import { AdminPermissionsView } from "./AdminPermissionsView";
import { AdminModulesView } from "./AdminModulesView";
import { AdminWorkflowsView } from "./AdminWorkflowsView";
import { AdminAuditView } from "./AdminAuditView";
import { AdminUsersView } from "./AdminUsersView";

type SectionKey = "overview" | "users" | "roles" | "permissions" | "modules" | "workflows" | "audit";

const SECTIONS: { key: SectionKey; label: string }[] = [
  { key: "overview", label: "Overview" },
  { key: "users", label: "Users" },
  { key: "roles", label: "Roles" },
  { key: "permissions", label: "Permissions" },
  { key: "modules", label: "Modules" },
  { key: "workflows", label: "Workflows" },
  { key: "audit", label: "Recent activity" },
];

function isSectionKey(value: string | null): value is SectionKey {
  return SECTIONS.some((section) => section.key === value);
}

function sectionUrl(section: SectionKey): string {
  return section === "overview" ? "/admin" : `/admin?section=${section}`;
}

export function AdminConsolePage() {
  const { permissions, scopeTypes } = useShell();

  // Client-side gates are UX conveniences only. Every endpoint independently
  // enforces `admin.console.read`, its section permission, and tenant scope.
  if (!permissions.includes(PERMISSIONS.adminConsoleRead)) {
    return (
      <>
        <PageHeader title="Admin Console" />
        <PermissionDeniedState permission={PERMISSIONS.adminConsoleRead} />
      </>
    );
  }

  if (!isInternalScope(scopeTypes)) {
    return (
      <>
        <PageHeader title="Admin Console" />
        <EmptyState
          title="An internal data scope is required"
          description="The Admin Console is available only to actors with an explicit tenant or organization unit scope. Backend authorization remains authoritative."
        />
      </>
    );
  }

  return <AdminConsoleContent />;
}

function AdminConsoleContent() {
  const { permissions, scopeTypes } = useShell();
  const [searchParams] = useSearchParams();
  const requestedSection = searchParams.get("section");
  const activeSection: SectionKey = isSectionKey(requestedSection) ? requestedSection : "overview";
  const overview = useAdminResource<AdminOverview>(
    (token) => api.adminOverview(token),
    "Failed to load the administration overview",
  );

  return (
    <>
      <PageHeader
        title="Admin Console"
        subtitle="Tenant-local administration summaries with section-specific permission checks."
        actions={
          overview.data?.capabilities.readOnly &&
          !(permissions.includes(PERMISSIONS.tenantUpdate) && scopeTypes.includes("tenant")) ? (
            <Badge>Read only</Badge>
          ) : undefined
        }
      />

      <nav
        className="mb-6 overflow-x-auto border-b border-slate-200"
        aria-label="Admin Console sections"
      >
        <div className="flex min-w-max gap-1">
          {SECTIONS.map((section) => (
            <Link
              key={section.key}
              to={sectionUrl(section.key)}
              aria-current={activeSection === section.key ? "page" : undefined}
              className={`-mb-px inline-flex min-h-[44px] items-center rounded-t px-3 py-1.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-slate-400 sm:min-h-[36px] ${
                activeSection === section.key
                  ? "border-b-2 border-slate-900 text-slate-900"
                  : "border-b-2 border-transparent text-slate-500 hover:text-slate-700"
              }`}
            >
              {section.label}
            </Link>
          ))}
        </div>
      </nav>

      {activeSection === "overview" && <AdminOverviewView resource={overview} />}
      {activeSection === "users" && (
        <AdminUsersView
          canManageAccess={Boolean(
            overview.data?.capabilities.userRoleManage &&
              overview.data.capabilities.userAccessRead &&
              overview.data.capabilities.rolePermissionRead,
          )}
        />
      )}
      {activeSection === "roles" && <AdminRolesView />}
      {activeSection === "permissions" && <AdminPermissionsView />}
      {activeSection === "modules" && <AdminModulesView />}
      {activeSection === "workflows" && <AdminWorkflowsView />}
      {activeSection === "audit" && <AdminAuditView />}
    </>
  );
}

function AdminOverviewView({ resource }: { resource: AdminResourceState<AdminOverview> }) {
  const { session } = useAuth();
  const token = session!.accessToken;
  const assignmentId = session!.assignmentId;
  const { tenantName, setTenantName, permissions, scopeTypes } = useShell();
  const { data, loading, error, denied, sessionExpired, reload } = resource;
  const [editOpen, setEditOpen] = useState(false);
  const [editPending, setEditPending] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  const [editMessage, setEditMessage] = useState<string | null>(null);
  const editFormRef = useRef<HTMLFormElement>(null);
  const editTriggerRef = useRef<HTMLButtonElement | null>(null);
  const lifetime = useRef(0);
  const canEditTenant = permissions.includes(PERMISSIONS.tenantUpdate) && scopeTypes.includes("tenant") && Boolean(tenantName);

  useEffect(() => () => {
    lifetime.current += 1;
  }, [token, assignmentId]);

  const closeEdit = useCallback(() => {
    if (editPending) return;
    setEditOpen(false);
    setEditError(null);
  }, [editPending]);

  const handleEdit = useCallback(async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (editPending || !editFormRef.current || !canEditTenant) return;
    const name = String(new FormData(editFormRef.current).get("name") ?? "").trim();
    if (name.length < 2 || name.length > 120) {
      setEditError("Tenant name must be between 2 and 120 characters.");
      return;
    }
    const life = lifetime.current;
    setEditError(null);
    setEditMessage(null);
    setEditPending(true);
    try {
      const updated = await api.updateTenantName(token, { name });
      if (lifetime.current !== life) return;
      setTenantName(updated.name);
      setEditMessage("Tenant name updated.");
      setEditOpen(false);
    } catch (err) {
      if (lifetime.current !== life) return;
      setEditError(err instanceof ApiError ? err.message : "Failed to update tenant name");
    } finally {
      if (lifetime.current === life) setEditPending(false);
    }
  }, [token, canEditTenant, editPending, setTenantName]);
  const scopeLabels = [
    scopeTypes.includes("tenant") ? "Tenant-wide" : null,
    scopeTypes.includes("organization_unit") ? "Organization unit" : null,
    scopeTypes.includes("customer") ? "Customer" : null,
  ].filter((label): label is string => label !== null);

  return (
    <AdminSectionState
      loading={loading}
      loadingLabel="Loading administration overview…"
      denied={denied}
      sessionExpired={sessionExpired}
      error={error}
      requiredPermission={PERMISSIONS.adminConsoleRead}
      onRetry={reload}
    >
      {data && (
        <>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            <OverviewCard
              title="Users"
              description="User accounts and their governed role assignments."
              section={data.sections.users}
              destination="users"
            />
            <OverviewCard
              title="Roles"
              description="Tenant-local role definitions and assignment totals."
              section={data.sections.roles}
              destination="roles"
            />
            <OverviewCard
              title="Permissions"
              description="The fixed catalogue of grantable platform capabilities."
              section={data.sections.permissions}
              destination="permissions"
            />
            <OverviewCard
              title="Modules"
              description="Configured module activation records for this tenant."
              section={data.sections.modules}
              destination="modules"
              footnote={
                data.sections.modules.activeCount === null
                  ? undefined
                  : `${data.sections.modules.activeCount} active`
              }
            />
            <OverviewCard
              title="Workflows"
              description="Configured approval and lifecycle definitions."
              section={data.sections.workflows}
              destination="workflows"
            />
            <OverviewCard
              title="Recent activity"
              description="A bounded list of recent privacy-safe audit events."
              section={data.sections.audit}
              destination="audit"
            />
          </div>

          <Card className="mt-6">
            <h2 className="text-sm font-semibold text-slate-900">Tenant and data scope</h2>
            <dl className="mt-3 grid gap-3 text-sm sm:grid-cols-2">
              <div>
                <dt className="text-xs font-medium uppercase tracking-wide text-slate-400">Workspace</dt>
                <dd className="mt-1 break-words text-slate-700">{tenantName || "Current tenant"}</dd>
              </div>
              <div>
                <dt className="text-xs font-medium uppercase tracking-wide text-slate-400">Reported scope</dt>
                <dd className="mt-1 text-slate-700">
                  {scopeLabels.length > 0 ? scopeLabels.join(" · ") : "No data scope reported"}
                </dd>
              </div>
            </dl>
            <p className="mt-4 text-sm text-slate-500">
              Tenant-owned summaries are returned within the current deployment and actor scope. The
              permission catalogue is fixed platform metadata and contains no tenant, user, or business
              record data.
            </p>
            {canEditTenant && (
              <div className="mt-4 flex flex-wrap items-center gap-3">
                <Button
                  variant="secondary"
                  onClick={(event) => {
                    editTriggerRef.current = event.currentTarget;
                    setEditError(null);
                    setEditMessage(null);
                    setEditOpen(true);
                  }}
                >
                  Edit tenant name
                </Button>
                {editMessage && <Alert tone="success">{editMessage}</Alert>}
              </div>
            )}
          </Card>

          <Card className="mt-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="text-sm font-semibold text-slate-900">
                  {data.capabilities.userRoleManage ? "Governed user access management" : "Assignment access status"}
                </h2>
                <p className="mt-1 text-sm text-slate-500">
                  {data.capabilities.userRoleManage
                    ? "You can add or remove user role assignments through mandatory review and server-authoritative reload. Roles, permission definitions, modules, and workflows remain read only."
                    : "You can inspect administration summaries and access assignments. Changes remain limited to separately permissioned controls, such as tenant name when available."}
                </p>
              </div>
              <Badge>{data.capabilities.userRoleManage ? "User access manager" : "API declared"}</Badge>
            </div>
          </Card>

          {canEditTenant && (
            <OverlayDialog
              open={editOpen}
              title="Edit tenant name"
              description="Update the name shown for this tenant. Its code, status, and business data will not change."
              pending={editPending}
              onClose={closeEdit}
              restoreFocusRef={editTriggerRef}
              footer={
                <>
                  <Button variant="secondary" onClick={closeEdit} disabled={editPending}>
                    Cancel
                  </Button>
                  <Button
                    variant="primary"
                    onClick={() => editFormRef.current?.requestSubmit()}
                    disabled={editPending}
                  >
                    {editPending ? "Saving…" : "Save changes"}
                  </Button>
                </>
              }
            >
              <form ref={editFormRef} onSubmit={handleEdit} className="space-y-4">
                {editError && <Alert tone="error">{editError}</Alert>}
                <Field label="Tenant name" required hint="Between 2 and 120 characters.">
                  <Input
                    name="name"
                    required
                    minLength={2}
                    maxLength={120}
                    defaultValue={tenantName}
                    disabled={editPending}
                    autoComplete="organization"
                  />
                </Field>
              </form>
            </OverlayDialog>
          )}
        </>
      )}
    </AdminSectionState>
  );
}

function OverviewCard({
  title,
  description,
  section,
  destination,
  footnote,
}: {
  title: string;
  description: string;
  section: AdminCountSection;
  destination?: Exclude<SectionKey, "overview">;
  footnote?: string;
}) {
  const content = (
    <Card className={`h-full ${section.visible && destination ? "transition-colors group-hover:border-slate-300 group-hover:bg-slate-50" : ""}`}>
      <div className="flex items-start justify-between gap-3">
        <h2 className="text-sm font-semibold text-slate-900">{title}</h2>
        {!section.visible ? (
          <StatusPill tone="neutral">Restricted</StatusPill>
        ) : destination ? (
          <span aria-hidden="true" className="text-slate-300 transition-transform group-hover:translate-x-0.5 group-hover:text-slate-500">
            →
          </span>
        ) : null}
      </div>
      {section.visible ? (
        <>
          <p className="mt-3 text-2xl font-semibold tabular-nums text-slate-900">{section.count ?? "—"}</p>
          <p className="mt-1 text-sm text-slate-500">{description}</p>
          {footnote && <p className="mt-1 text-xs tabular-nums text-slate-400">{footnote}</p>}
        </>
      ) : (
        <p className="mt-3 text-sm text-slate-500">
          Requires{" "}
          <code className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-xs text-slate-700">
            {section.requiredPermission}
          </code>
          .
        </p>
      )}
    </Card>
  );

  if (!section.visible || !destination) return content;

  return (
    <Link
      to={sectionUrl(destination)}
      className="group rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400 focus-visible:ring-offset-2"
      aria-label={`Open ${title}`}
    >
      {content}
    </Link>
  );
}
