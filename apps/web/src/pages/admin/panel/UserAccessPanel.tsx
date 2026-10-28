import { useState } from "react";
import { useShell } from "../../../shell/layout/AppShell";
import { AdminAssignmentsView } from "../console/AdminAssignmentsView";
import { AdminPermissionsView } from "../console/AdminPermissionsView";
import { AdminRolesView } from "../console/AdminRolesView";
import { AdminUsersView } from "../console/AdminUsersView";

/**
 * Panel Admin — User & Access category (Epic 15 Decision #2).
 *
 * Composes the Admin Console's existing views rather than re-implementing
 * them: each one already owns its resource state, its permission gate, and
 * its governed write dialogs. This panel adds only the local tab strip, so a
 * tenant administrator stays in the configuration surface instead of being
 * bounced to the read-only `/admin` console.
 */
type Tab = "users" | "assignments" | "roles" | "permissions";

const TABS: { key: Tab; label: string }[] = [
  { key: "users", label: "User" },
  { key: "assignments", label: "Assignment" },
  { key: "roles", label: "Role" },
  { key: "permissions", label: "Permission" },
];

export function UserAccessPanel({ canManageAccess }: { canManageAccess: boolean }) {
  const { permissions } = useShell();
  const [tab, setTab] = useState<Tab>("users");
  const canReadDefinitions = permissions.includes("config.read");
  const canManageRoles = permissions.includes("role.manage");

  return (
    <div className="space-y-4">
      <div role="tablist" aria-label="Bagian akses pengguna" className="flex flex-wrap gap-1 border-b border-line">
        {TABS.map((entry) => (
          <button
            key={entry.key}
            type="button"
            role="tab"
            aria-selected={tab === entry.key}
            onClick={() => setTab(entry.key)}
            className={`min-h-[44px] rounded-t px-3 text-sm transition-colors focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-1 focus-visible:ring-offset-ground sm:min-h-0 sm:py-2 ${
              tab === entry.key
                ? "border-b-2 border-line-strong font-medium text-ink"
                : "text-ink-dim hover:text-ink"
            }`}
          >
            {entry.label}
          </button>
        ))}
      </div>

      <div role="tabpanel">
        {tab === "users" && <AdminUsersView canManageAccess={canManageAccess} />}
        {tab === "assignments" && <AdminAssignmentsView canManageAccess={canManageAccess} />}
        {tab === "roles" && <AdminRolesView canManage={canManageRoles} canRead={canReadDefinitions} />}
        {tab === "permissions" && <AdminPermissionsView />}
      </div>

      <p className="text-xs text-ink-faint">
        Setiap bagian memeriksa izinnya sendiri. Daftar yang tidak dapat Anda baca ditampilkan sebagai
        penolakan, bukan daftar kosong.
      </p>
    </div>
  );
}