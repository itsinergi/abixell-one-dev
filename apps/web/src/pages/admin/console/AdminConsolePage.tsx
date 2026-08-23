/**
 * Phase 11C — Business Admin Console Foundation.
 *
 * A tenant-local, strictly READ-ONLY consolidation of the platform
 * administration areas: who exists, what access is defined, which modules
 * and workflows are configured, and what happened recently. It renders no
 * create/edit/delete control anywhere, because the backend offers none —
 * `capabilities` from `GET /admin/overview` states this explicitly so the
 * UI can never advertise an action the API would refuse.
 *
 * This is NOT the Platform Architect / Builder Console: no metadata
 * authoring, no schema editing, no query console, no module installation.
 * Deeper administration continues to live in the existing Administration
 * area; the console links there rather than duplicating its controls.
 */
import { useState } from "react";
import { useShell } from "../../../shell/layout/AppShell";
import { PERMISSIONS } from "../../../lib/capabilities";
import { api, type AdminCountSection, type AdminOverview } from "../../../lib/api";
import { Badge, Card, EmptyState, PageHeader, StatusPill } from "../../../shell/components/ui";
import { AdminSectionState } from "./AdminSection";
import { useAdminResource } from "./useAdminResource";
import { AdminRolesView } from "./AdminRolesView";
import { AdminPermissionsView } from "./AdminPermissionsView";
import { AdminModulesView } from "./AdminModulesView";
import { AdminWorkflowsView } from "./AdminWorkflowsView";
import { AdminAuditView } from "./AdminAuditView";

type TabKey = "overview" | "roles" | "permissions" | "modules" | "workflows" | "audit";

const TABS: { key: TabKey; label: string }[] = [
  { key: "overview", label: "Overview" },
  { key: "roles", label: "Roles" },
  { key: "permissions", label: "Permissions" },
  { key: "modules", label: "Modules" },
  { key: "workflows", label: "Workflows" },
  { key: "audit", label: "Recent activity" },
];

export function AdminConsolePage() {
  const { permissions } = useShell();
  const [tab, setTab] = useState<TabKey>("overview");

  // Client-side gate is a UX courtesy only — every endpoint below
  // re-enforces `admin.console.read` plus its own per-area permission.
  if (!permissions.includes(PERMISSIONS.adminConsoleRead)) {
    return (
      <>
        <PageHeader title="Admin Console" />
        <EmptyState
          title="You do not have access to the Admin Console"
          description={`Opening the console requires the "${PERMISSIONS.adminConsoleRead}" permission. Ask an administrator to grant it to one of your roles.`}
        />
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Admin Console"
        subtitle="A read-only overview of administration across this tenant."
        actions={<Badge>Read only</Badge>}
      />

      <nav className="mb-6 flex flex-wrap gap-1 border-b border-slate-200" aria-label="Admin Console sections">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            aria-current={tab === t.key ? "page" : undefined}
            className={`-mb-px min-h-[36px] rounded-t px-3 py-1.5 text-sm font-medium transition-colors ${
              tab === t.key
                ? "border-b-2 border-slate-900 text-slate-900"
                : "border-b-2 border-transparent text-slate-500 hover:text-slate-700"
            }`}
          >
            {t.label}
          </button>
        ))}
      </nav>

      {tab === "overview" && <AdminOverviewView />}
      {tab === "roles" && <AdminRolesView />}
      {tab === "permissions" && <AdminPermissionsView />}
      {tab === "modules" && <AdminModulesView />}
      {tab === "workflows" && <AdminWorkflowsView />}
      {tab === "audit" && <AdminAuditView />}
    </>
  );
}

function AdminOverviewView() {
  const { data, loading, error, denied, reload } = useAdminResource<AdminOverview>(
    (token) => api.adminOverview(token),
    "Failed to load the administration overview",
  );

  return (
    <AdminSectionState
      loading={loading}
      denied={denied}
      error={error}
      requiredPermission={PERMISSIONS.adminConsoleRead}
      onRetry={reload}
    >
      {data && (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <OverviewCard
              title="Users"
              description="People who can sign in to this tenant."
              section={data.sections.users}
            />
            <OverviewCard
              title="Roles"
              description="Named sets of permissions users are assigned to."
              section={data.sections.roles}
            />
            <OverviewCard
              title="Permissions"
              description="Every capability that can be granted here."
              section={data.sections.permissions}
            />
            <OverviewCard
              title="Modules"
              description="Which product areas are switched on."
              section={data.sections.modules}
              footnote={
                data.sections.modules.activeCount === null
                  ? undefined
                  : `${data.sections.modules.activeCount} active`
              }
            />
            <OverviewCard
              title="Workflows"
              description="Approval and lifecycle definitions in use."
              section={data.sections.workflows}
            />
            <OverviewCard
              title="Recent activity"
              description="The latest recorded administrative events."
              section={data.sections.audit}
            />
          </div>

          <Card className="mt-6">
            <h2 className="text-sm font-semibold text-slate-900">Data scope</h2>
            <p className="mt-1 text-sm text-slate-500">
              Everything shown here belongs to your own tenant. The permission catalogue is the one
              exception: it is the same fixed list of grantable capabilities in every deployment and
              names no tenant, user, or record.
            </p>
          </Card>

          <Card className="mt-4">
            <h2 className="text-sm font-semibold text-slate-900">Making changes</h2>
            <p className="mt-1 text-sm text-slate-500">
              This console only reads. To create or change users, roles, configuration, or workflow
              definitions, use the Administration area — where each action enforces its own
              permission.
            </p>
          </Card>
        </>
      )}
    </AdminSectionState>
  );
}

function OverviewCard({
  title,
  description,
  section,
  footnote,
}: {
  title: string;
  description: string;
  section: AdminCountSection;
  footnote?: string;
}) {
  return (
    <Card>
      <div className="flex items-start justify-between gap-3">
        <h2 className="text-sm font-semibold text-slate-900">{title}</h2>
        {!section.visible && <StatusPill tone="neutral">Restricted</StatusPill>}
      </div>
      {section.visible ? (
        <>
          {/* `count` is null only when the section is hidden, which the
              branch above already handles — the fallback is defensive. */}
          <p className="mt-3 text-2xl font-semibold text-slate-900">{section.count ?? "—"}</p>
          <p className="mt-1 text-sm text-slate-500">{description}</p>
          {footnote && <p className="mt-1 text-xs text-slate-400">{footnote}</p>}
        </>
      ) : (
        <p className="mt-3 text-sm text-slate-500">
          Requires the <span className="font-medium text-slate-700">{section.requiredPermission}</span>{" "}
          permission.
        </p>
      )}
    </Card>
  );
}
