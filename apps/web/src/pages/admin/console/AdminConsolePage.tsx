/**
 * Phase 11C/11E — Business Admin Console Foundation.
 *
 * A tenant-local, strictly READ-ONLY consolidation of platform administration:
 * who exists, what access is defined, which modules and workflows are
 * configured, and what happened recently. It renders no create/edit/delete
 * control because the backend offers none. This is not the Platform Architect
 * or Builder Console and provides no metadata, schema, query, or package tools.
 */
import { Link, useSearchParams } from "react-router-dom";
import { useShell } from "../../../shell/layout/AppShell";
import { isInternalScope, PERMISSIONS } from "../../../lib/capabilities";
import { api, type AdminCountSection, type AdminOverview } from "../../../lib/api";
import {
  Badge,
  Card,
  EmptyState,
  PageHeader,
  PermissionDeniedState,
  StatusPill,
} from "../../../shell/components/ui";
import { AdminSectionState } from "./AdminSection";
import { useAdminResource, type AdminResourceState } from "./useAdminResource";
import { AdminRolesView } from "./AdminRolesView";
import { AdminPermissionsView } from "./AdminPermissionsView";
import { AdminModulesView } from "./AdminModulesView";
import { AdminWorkflowsView } from "./AdminWorkflowsView";
import { AdminAuditView } from "./AdminAuditView";

type SectionKey = "overview" | "roles" | "permissions" | "modules" | "workflows" | "audit";

const SECTIONS: { key: SectionKey; label: string }[] = [
  { key: "overview", label: "Overview" },
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
        actions={overview.data?.capabilities.readOnly ? <Badge>Read only</Badge> : undefined}
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
      {activeSection === "roles" && <AdminRolesView />}
      {activeSection === "permissions" && <AdminPermissionsView />}
      {activeSection === "modules" && <AdminModulesView />}
      {activeSection === "workflows" && <AdminWorkflowsView />}
      {activeSection === "audit" && <AdminAuditView />}
    </>
  );
}

function AdminOverviewView({ resource }: { resource: AdminResourceState<AdminOverview> }) {
  const { tenantName, scopeTypes } = useShell();
  const { data, loading, error, denied, sessionExpired, reload } = resource;
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
              description="User accounts registered in this tenant."
              section={data.sections.users}
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
          </Card>

          {data.capabilities.readOnly && (
            <Card className="mt-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h2 className="text-sm font-semibold text-slate-900">Read-only foundation</h2>
                  <p className="mt-1 text-sm text-slate-500">
                    This console exposes summaries only. It does not create or change users, roles,
                    module activation, permissions, or workflow definitions.
                  </p>
                </div>
                <Badge>API declared</Badge>
              </div>
            </Card>
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
