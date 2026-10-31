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
import { useT } from "../../../i18n/LocaleProvider";
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
  const t = useT();
  const { roleCode } = useParams<{ roleCode: string }>();

  const back = () => navigate("/settings?tab=access");

  if (!permissions.includes(PERMISSIONS.adminConsoleRead)) {
    return (
      <>
        <PageHeader title={t("adminRoleDef.title")} />
        <PermissionDeniedState permission={PERMISSIONS.adminConsoleRead} />
      </>
    );
  }

  if (!isInternalScope(scopeTypes)) {
    return (
      <>
        <PageHeader title={t("adminRoleDef.title")} />
        <EmptyState
          title={t("adminRoleDef.error.noScope")}
          description={t("adminRoleDef.error.noScopeDesc")}
        />
      </>
    );
  }

  if (!roleCode) {
    return (
      <>
        <PageHeader title={t("adminRoleDef.title")} />
        <EmptyState
          title={t("adminRoleDef.error.noRole")}
          description={t("adminRoleDef.error.noRoleDesc")}
        />
      </>
    );
  }

  return (
    <>
      <PageHeader title={t("adminRoleDef.title")} subtitle={t("adminRoleDef.subtitle")} />
      <AdminRoleDefinitionView
        roleCode={roleCode}
        canRead={permissions.includes("config.read")}
        canManage={permissions.includes(ROLE_MANAGE)}
        onBack={back}
      />
    </>
  );
}
