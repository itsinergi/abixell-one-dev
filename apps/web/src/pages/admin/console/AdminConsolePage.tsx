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
import { useT } from "../../../i18n/LocaleProvider";
import type { MessageKey } from "../../../i18n/dictionaries/en";
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
import { AdminAssignmentsView } from "./AdminAssignmentsView";

type SectionKey =
  | "overview"
  | "users"
  | "assignments"
  | "roles"
  | "permissions"
  | "modules"
  | "workflows"
  | "audit";

const SECTIONS: { key: SectionKey; label: MessageKey }[] = [
  { key: "overview", label: "adminConsole.navOverview" },
  { key: "users", label: "adminConsole.navUsers" },
  { key: "assignments", label: "adminConsole.navAssignments" },
  { key: "roles", label: "adminConsole.navRoles" },
  { key: "permissions", label: "adminConsole.navPermissions" },
  { key: "modules", label: "adminConsole.navModules" },
  { key: "workflows", label: "adminConsole.navWorkflows" },
  { key: "audit", label: "adminConsole.navAudit" },
];

function isSectionKey(value: string | null): value is SectionKey {
  return SECTIONS.some((section) => section.key === value);
}

function sectionUrl(section: SectionKey): string {
  return section === "overview" ? "/admin" : `/admin?section=${section}`;
}

export function AdminConsolePage() {
  const { permissions, scopeTypes } = useShell();
  const t = useT();

  // Client-side gates are UX conveniences only. Every endpoint independently
  // enforces `admin.console.read`, its section permission, and tenant scope.
  if (!permissions.includes(PERMISSIONS.adminConsoleRead)) {
    return (
      <>
        <PageHeader title={t("adminConsole.title")} />
        <PermissionDeniedState permission={PERMISSIONS.adminConsoleRead} />
      </>
    );
  }

  if (!isInternalScope(scopeTypes)) {
    return (
      <>
        <PageHeader title={t("adminConsole.title")} />
        <EmptyState
          title={t("adminConsole.noScope")}
          description={t("adminConsole.noScopeDesc")}
        />
      </>
    );
  }

  return <AdminConsoleContent />;
}

function AdminConsoleContent() {
  const { permissions, scopeTypes } = useShell();
  const [searchParams] = useSearchParams();
  const t = useT();
  const requestedSection = searchParams.get("section");
  const activeSection: SectionKey = isSectionKey(requestedSection) ? requestedSection : "overview";
  const overview = useAdminResource<AdminOverview>(
    (token) => api.adminOverview(token),
    t("adminConsole.loadFailed"),
  );
  // The overview's capability tuple is tenant-scoped only, but Wave 2
  // assignment authority accepts Organization-Unit scope too (the backend
  // resolves `user.role.manage` visibility per assignment). The shell's
  // effective permission list is scope-agnostic, so it is the honest gate
  // here; the endpoints still refuse what this permits, and their 403/404
  // states render through the views' own resource state.
  const canManageAccess = permissions.includes("user.role.manage");

  return (
    <>
      <PageHeader
        title={t("adminConsole.title")}
        subtitle={t("adminConsole.subtitle")}
        actions={
          overview.data?.capabilities.readOnly &&
          !(permissions.includes(PERMISSIONS.tenantUpdate) && scopeTypes.includes("tenant")) ? (
            <Badge>{t("adminConsole.readOnly")}</Badge>
          ) : undefined
        }
      />

      <nav
        className="mb-6 overflow-x-auto border-b border-line"
        aria-label={t("adminConsole.sectionsLabel")}
      >
        <div className="flex min-w-max gap-1">
          {SECTIONS.map((section) => (
            <Link
              key={section.key}
              to={sectionUrl(section.key)}
              aria-current={activeSection === section.key ? "page" : undefined}
              className={`-mb-px inline-flex min-h-[44px] items-center rounded-t px-3 py-1.5 text-sm font-medium transition-colors focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent sm:min-h-[36px] ${
                activeSection === section.key
                  ? "border-b-2 border-accent text-ink"
                  : "border-b-2 border-transparent text-ink-dim hover:text-ink"
              }`}
            >
              {t(section.label)}
            </Link>
          ))}
        </div>
      </nav>

      {activeSection === "overview" && <AdminOverviewView resource={overview} />}
      {activeSection === "users" && (
        <AdminUsersView canManageAccess={canManageAccess} />
      )}
      {activeSection === "assignments" && (
        <AdminAssignmentsView canManageAccess={canManageAccess} />
      )}
      {activeSection === "roles" && (
        <AdminRolesView
          canManage={Boolean(overview.data?.capabilities.roleManage)}
          canRead={Boolean(overview.data?.capabilities.rolePermissionRead)}
        />
      )}
      {activeSection === "permissions" && <AdminPermissionsView />}
      {activeSection === "modules" && <AdminModulesView />}
      {activeSection === "workflows" && <AdminWorkflowsView />}
      {activeSection === "audit" && <AdminAuditView />}
    </>
  );
}

function AdminOverviewView({ resource }: { resource: AdminResourceState<AdminOverview> }) {
  const t = useT();
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
      setEditError(t("adminConsole.tenantNameInvalid"));
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
      setEditMessage(t("adminConsole.tenantNameUpdated"));
      setEditOpen(false);
    } catch (err) {
      if (lifetime.current !== life) return;
      setEditError(
        err instanceof ApiError ? err.message : t("adminConsole.tenantNameFailed"),
      );
    } finally {
      if (lifetime.current === life) setEditPending(false);
    }
  }, [token, canEditTenant, editPending, setTenantName, t]);
  const scopeLabels = [
    scopeTypes.includes("tenant") ? t("adminConsole.scopeTenant") : null,
    scopeTypes.includes("organization_unit") ? t("adminConsole.scopeOrgUnit") : null,
    scopeTypes.includes("customer") ? t("adminConsole.scopeCustomer") : null,
  ].filter((label): label is string => label !== null);

  return (
    <AdminSectionState
      loading={loading}
      loadingLabel={t("adminConsole.loading")}
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
              title={t("adminConsole.navUsers")}
              description={t("adminConsole.cardUsersDesc")}
              section={data.sections.users}
              destination="users"
            />
            <OverviewCard
              title={t("adminConsole.navRoles")}
              description={t("adminConsole.cardRolesDesc")}
              section={data.sections.roles}
              destination="roles"
            />
            <OverviewCard
              title={t("adminConsole.navPermissions")}
              description={t("adminConsole.cardPermissionsDesc")}
              section={data.sections.permissions}
              destination="permissions"
            />
            <OverviewCard
              title={t("adminConsole.navModules")}
              description={t("adminConsole.cardModulesDesc")}
              section={data.sections.modules}
              destination="modules"
              footnote={
                data.sections.modules.activeCount === null
                  ? undefined
                  : t("adminConsole.activeCount", { count: data.sections.modules.activeCount })
              }
            />
            <OverviewCard
              title={t("adminConsole.navWorkflows")}
              description={t("adminConsole.cardWorkflowsDesc")}
              section={data.sections.workflows}
              destination="workflows"
            />
            <OverviewCard
              title={t("adminConsole.navAudit")}
              description={t("adminConsole.cardAuditDesc")}
              section={data.sections.audit}
              destination="audit"
            />
          </div>

          <Card className="mt-6">
            <h2 className="text-sm font-semibold text-ink">{t("adminConsole.tenantScopeTitle")}</h2>
            <dl className="mt-3 grid gap-3 text-sm sm:grid-cols-2">
              <div>
                <dt className="text-xs font-medium uppercase tracking-wide text-ink-faint">{t("adminConsole.workspace")}</dt>
                <dd className="mt-1 wrap-break-word text-ink-dim">{tenantName || t("adminConsole.currentTenant")}</dd>
              </div>
              <div>
                <dt className="text-xs font-medium uppercase tracking-wide text-ink-faint">{t("adminConsole.reportedScope")}</dt>
                <dd className="mt-1 text-ink-dim">
                  {scopeLabels.length > 0 ? scopeLabels.join(" · ") : t("adminConsole.noScopeReported")}
                </dd>
              </div>
            </dl>
            <p className="mt-4 text-sm text-ink-dim">{t("adminConsole.summaryNote")}</p>
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
                  {t("adminConsole.editTenantName")}
                </Button>
                {editMessage && <Alert tone="success">{editMessage}</Alert>}
              </div>
            )}
          </Card>

          <Card className="mt-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="text-sm font-semibold text-ink">
                  {data.capabilities.userRoleManage
                    ? t("adminConsole.manageTitle")
                    : t("adminConsole.statusTitle")}
                </h2>
                <p className="mt-1 text-sm text-ink-dim">
                  {data.capabilities.userRoleManage
                    ? t("adminConsole.manageBody")
                    : t("adminConsole.statusBody")}
                </p>
              </div>
              <Badge>
                {data.capabilities.userRoleManage
                  ? t("adminConsole.badgeManager")
                  : t("adminConsole.badgeDeclared")}
              </Badge>
            </div>
          </Card>

          {canEditTenant && (
            <OverlayDialog
              open={editOpen}
              title={t("adminConsole.editTenantName")}
              description={t("adminConsole.editTenantDesc")}
              pending={editPending}
              onClose={closeEdit}
              restoreFocusRef={editTriggerRef}
              footer={
                <>
                  <Button variant="secondary" onClick={closeEdit} disabled={editPending}>
                    {t("adminConsole.cancel")}
                  </Button>
                  <Button
                    variant="primary"
                    onClick={() => editFormRef.current?.requestSubmit()}
                    disabled={editPending}
                  >
                    {editPending ? t("adminConsole.saving") : t("adminConsole.saveChanges")}
                  </Button>
                </>
              }
            >
              <form ref={editFormRef} onSubmit={handleEdit} className="space-y-4">
                {editError && <Alert tone="error">{editError}</Alert>}
                <Field
                label={t("adminConsole.tenantNameLabel")}
                required
                hint={t("adminConsole.tenantNameHint")}
              >
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
  destination?: Exclude<SectionKey, "overview" | "assignments">;
  footnote?: string;
}) {
  const t = useT();
  const content = (
    <Card className={`h-full ${section.visible && destination ? "transition-colors group-hover:border-line-strong group-hover:bg-panel-2" : ""}`}>
      <div className="flex items-start justify-between gap-3">
        <h2 className="text-sm font-semibold text-ink">{title}</h2>
        {!section.visible ? (
          <StatusPill tone="neutral">{t("adminConsole.restricted")}</StatusPill>
        ) : destination ? (
          <span aria-hidden="true" className="text-ink-faint transition-transform group-hover:translate-x-0.5 group-hover:text-ink-dim">
            →
          </span>
        ) : null}
      </div>
      {section.visible ? (
        <>
          <p className="mt-3 text-2xl font-semibold tabular-nums text-ink">{section.count ?? "—"}</p>
          <p className="mt-1 text-sm text-ink-dim">{description}</p>
          {footnote && <p className="mt-1 text-xs tabular-nums text-ink-faint">{footnote}</p>}
        </>
      ) : (
        <p className="mt-3 text-sm text-ink-dim">
          {t("adminConsole.requires")}{" "}
          <code className="rounded bg-panel-3 px-1.5 py-0.5 font-mono text-xs text-ink-dim">
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
      className="group rounded focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2"
      aria-label={t("adminConsole.openSection", { section: title })}
    >
      {content}
    </Link>
  );
}
