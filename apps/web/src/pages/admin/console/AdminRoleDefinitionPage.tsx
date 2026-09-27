/**
 * Epic 4 Wave 1 — the Role definition route.
 *
 * The console gates below decide what is worth rendering, never what is
 * allowed: `GET /admin/roles/:code/definition` and
 * `GET /admin/role-definition-options` each re-check `admin.console.read`,
 * `config.read`, and one tenant-scoped assignment on the server, and every
 * write re-checks `role.manage` inside the tenant-locked transaction.
 */
import { useNavigate, useParams } from "react-router-dom";
import { PageHeader, PermissionDeniedState, EmptyState } from "../../../shell/components/ui";
import { isInternalScope, PERMISSIONS } from "../../../lib/capabilities";
import { useShell } from "../../../shell/layout/AppShell";
import { AdminRoleDefinitionView } from "./AdminRoleDefinitionView";

/** Permission the server requires to save a definition. Kept as a local
 *  literal because the shared capabilities map has no role-management entry
 *  yet; the string matches `ROLE_MANAGE` in the admin-console service. */
const ROLE_MANAGE = "role.manage";

export function AdminRoleDefinitionPage() {
  const { permissions, scopeTypes } = useShell();
  const navigate = useNavigate();
  const { roleCode } = useParams<{ roleCode: string }>();

  const back = () => navigate("/admin?section=roles");

  if (!permissions.includes(PERMISSIONS.adminConsoleRead)) {
    return (
      <>
        <PageHeader title="Role definition" />
        <PermissionDeniedState permission={PERMISSIONS.adminConsoleRead} />
      </>
    );
  }

  if (!isInternalScope(scopeTypes)) {
    return (
      <>
        <PageHeader title="Role definition" />
        <EmptyState
          title="An internal data scope is required"
          description="Role definitions are tenant-local. Backend authorization remains authoritative."
        />
      </>
    );
  }

  if (!roleCode) {
    return (
      <>
        <PageHeader title="Role definition" />
        <EmptyState
          title="No role was named"
          description="Open a Role from the Admin Console roles list to view or change its definition."
        />
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Role definition"
        subtitle="Permissions and Window access recorded for this Role, with impact preview before any change is saved."
      />
      <AdminRoleDefinitionView
        roleCode={roleCode}
        canRead={permissions.includes("config.read")}
        canManage={permissions.includes(ROLE_MANAGE)}
        onBack={back}
      />
    </>
  );
}
