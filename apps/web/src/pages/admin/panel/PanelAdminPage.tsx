/**
 * Epic 15 — Panel Admin.
 *
 * One administrative surface for the tenant: eight configuration categories
 * on the left, the selected category's own screen on the right. Every category
 * renders the component that actually owns its data — there is no generic
 * "configuration" body standing in for three different things.
 *
 * The dashboard tiles carry real counts or none: a tile whose count the caller
 * may not read renders as an em dash, never a zero. Tile clicks drill into the
 * matching category through `?category=`.
 *
 * Permissions (Decision #7): 16 granular codes drop the old blanket
 * `config.manage`, which is still accepted for backward compatibility. Client
 * gates are UX only; every endpoint enforces its own permission.
 */
import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { api } from "../../../lib/api";
import { PERMISSIONS } from "../../../lib/capabilities";
import { useAuth } from "../../../auth/AuthContext";
import { Alert, PageHeader } from "../../../shell/components/ui";
import { useShell } from "../../../shell/layout/AppShell";
import { useAdminResource } from "../console/useAdminResource";
import { ConfigurationPanel, type ConfigurationSection } from "../../ConfigurationPanel";
import { WorkflowPanel } from "../../WorkflowPanel";
import { SharedServicesPanel } from "../../SharedServicesPanel";
import { OrganizationPanel } from "./OrganizationPanel";
import { UserAccessPanel } from "./UserAccessPanel";

/* ============================================================================
   Types & Constants
   ============================================================================ */

type CategoryKey =
  | "module"
  | "platform"
  | "organization"
  | "system"
  | "user"
  | "workflow"
  | "notification"
  | "document";

interface Category {
  key: CategoryKey;
  label: string;
  description: string;
  permissionRead: string;
  permissionManage: string;
}

const CATEGORIES: Category[] = [
  {
    key: "module",
    label: "Module",
    description: "Aktivasi module dan feature flag",
    permissionRead: PERMISSIONS.configModuleRead,
    permissionManage: PERMISSIONS.configModuleManage,
  },
  {
    key: "platform",
    label: "Platform",
    description: "Profil tenant dan terminology",
    permissionRead: PERMISSIONS.configPlatformRead,
    permissionManage: PERMISSIONS.configPlatformManage,
  },
  {
    key: "organization",
    label: "Organization",
    description: "Legal entity, unit, hierarki, department",
    permissionRead: PERMISSIONS.configOrgRead,
    permissionManage: PERMISSIONS.configOrgManage,
  },
  {
    key: "system",
    label: "System",
    description: "Data referensi, penomoran, parameter",
    permissionRead: PERMISSIONS.configSystemRead,
    permissionManage: PERMISSIONS.configSystemManage,
  },
  {
    key: "user",
    label: "User & Access",
    description: "User, role, permission, assignment",
    permissionRead: PERMISSIONS.configUserRead,
    permissionManage: PERMISSIONS.configUserManage,
  },
  {
    key: "workflow",
    label: "Workflow & Approval",
    description: "Definisi workflow dan jalur persetujuan",
    permissionRead: PERMISSIONS.configWorkflowRead,
    permissionManage: PERMISSIONS.configWorkflowManage,
  },
  {
    key: "notification",
    label: "Notification & Channel",
    description: "Mesin notifikasi dan kanal pengiriman",
    permissionRead: PERMISSIONS.configNotificationRead,
    permissionManage: PERMISSIONS.configNotificationManage,
  },
  {
    key: "document",
    label: "Document",
    description: "Manajemen dokumen dan layanan berkas",
    permissionRead: PERMISSIONS.configDocumentRead,
    permissionManage: PERMISSIONS.configDocumentManage,
  },
];

function isCategoryKey(value: string | null): value is CategoryKey {
  return CATEGORIES.some((category) => category.key === value);
}

type PanelMessage = { type: "error" | "success"; text: string };

/* ============================================================================
   Status dashboard
   ============================================================================ */

/** `value === null` means "this caller cannot read the count" — rendered as an
 *  em dash so it never reads as an empty system. */
interface DashboardTile {
  label: string;
  value: number | null;
  target: CategoryKey;
}

function StatusDashboard({
  tiles,
  onSelect,
}: {
  tiles: DashboardTile[];
  onSelect: (key: CategoryKey) => void;
}) {
  return (
    <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
      {tiles.map((tile) => (
        <button
          key={tile.label}
          type="button"
          onClick={() => onSelect(tile.target)}
          className="rounded border border-line bg-panel p-3 text-left transition-colors hover:bg-panel-2 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-1 focus-visible:ring-offset-ground"
        >
          <div className="text-lg font-semibold tabular-nums text-ink">
            {tile.value === null ? "—" : tile.value}
          </div>
          <div className="text-xs text-ink-dim">{tile.label}</div>
        </button>
      ))}
    </div>
  );
}

/* ============================================================================
   Sidebar
   ============================================================================ */

function Sidebar({
  categories,
  selected,
  onSelect,
  canRead,
}: {
  categories: Category[];
  selected: CategoryKey;
  onSelect: (key: CategoryKey) => void;
  canRead: (category: Category) => boolean;
}) {
  const visibleCategories = categories.filter(canRead);

  return (
    <nav
      aria-label="Kategori konfigurasi"
      className="w-full shrink-0 border-b border-line bg-panel-2 sm:w-72 sm:border-b-0 sm:border-r"
    >
      <ul className="flex gap-1 overflow-x-auto p-2 sm:flex-col sm:overflow-visible">
        {visibleCategories.length === 0 ? (
          <li className="px-2 py-3 text-xs text-ink-faint">Tidak ada kategori yang dapat diakses.</li>
        ) : (
          visibleCategories.map((category) => (
            <li key={category.key} className="shrink-0 sm:shrink">
              <button
                type="button"
                onClick={() => onSelect(category.key)}
                aria-current={selected === category.key ? "page" : undefined}
                className={`min-h-[44px] w-full rounded px-3 text-left text-sm transition-colors focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-1 focus-visible:ring-offset-ground sm:min-h-0 sm:py-2 ${
                  selected === category.key
                    ? "bg-panel text-ink ring-1 ring-inset ring-line-strong"
                    : "text-ink-dim hover:bg-panel hover:text-ink"
                }`}
              >
                {category.label}
              </button>
            </li>
          ))
        )}
      </ul>
    </nav>
  );
}

/* ============================================================================
   Category body
   ============================================================================ */

const CONFIG_SECTIONS: ConfigurationSection[] = ["module", "platform", "system"];

function isConfigurationSection(key: CategoryKey): key is ConfigurationSection {
  return (CONFIG_SECTIONS as string[]).includes(key);
}

function CategoryBody({
  category,
  token,
  orgUnits,
  canManage,
  canManageAccess,
  canRead,
  onMessage,
}: {
  category: Category;
  token: string;
  orgUnits: { id: string; name: string }[];
  canManage: boolean;
  canManageAccess: boolean;
  canRead: boolean;
  onMessage: (m: PanelMessage) => void;
}) {
  if (isConfigurationSection(category.key)) {
    return (
      <ConfigurationPanel
        section={category.key}
        token={token}
        orgUnits={orgUnits}
        canManage={canManage}
        onMessage={onMessage}
      />
    );
  }

  switch (category.key) {
    case "organization":
      return (
        <OrganizationPanel
          token={token}
          canManage={canManage}
          onMessage={onMessage}
        />
      );

    case "user":
      return <UserAccessPanel canManageAccess={canManageAccess} />;

    case "workflow":
      return (
        <WorkflowPanel
          token={token}
          orgUnits={orgUnits}
          canStart={canManage}
          canAct={canManage}
          canManage={canManage}
          onMessage={onMessage}
        />
      );

    case "notification":
    case "document":
      return (
        <SharedServicesPanel
          token={token}
          canManageDocuments={category.key === "document" && canManage}
          canManageScheduler={false}
          canReadIntegration={canRead}
          canManageIntegration={false}
          canReadObservability={canRead}
          onMessage={onMessage}
        />
      );
  }
}

/* ============================================================================
   Main component
   ============================================================================ */

export function PanelAdminPage() {
  const { session } = useAuth();
  const token = session!.accessToken;
  const { activeModuleCodes } = useShell();
  const [searchParams, setSearchParams] = useSearchParams();
  const requested = searchParams.get("category");
  const [selectedCategory, setSelectedCategory] = useState<CategoryKey>(
    isCategoryKey(requested) ? requested : "module",
  );
  const [orgUnits, setOrgUnits] = useState<{ id: string; name: string }[]>([]);
  const [permissions, setPermissions] = useState<string[]>([]);
  const [message, setMessage] = useState<PanelMessage | null>(null);

  // Permissions and unit options are both required by more than one category;
  // each failure degrades into an empty list rather than blocking the panel.
  useEffect(() => {
    void Promise.all([api.me(token), api.organizationUnits(token)])
      .then(([me, units]) => {
        setPermissions(me.permissions ?? []);
        setOrgUnits(units.map((unit) => ({ id: unit.id, name: unit.name })));
      })
      .catch(() => {
        setPermissions([]);
      });
  }, [token]);

  // Counts come from the console overview, which already reports each section
  // as `null` when the caller cannot read it.
  const overview = useAdminResource(
    api.adminOverview,
    "Gagal memuat ringkasan administrasi.",
  );

  const canRead = (category: Category) =>
    permissions.includes(category.permissionRead) ||
    permissions.includes(PERMISSIONS.configManage);

  const canManageCategory = (category: Category) =>
    permissions.includes(category.permissionManage) ||
    permissions.includes(PERMISSIONS.configManage);

  const canManageAccess = permissions.includes("user.role.manage");

  const selectCategory = (key: CategoryKey) => {
    setSelectedCategory(key);
    setMessage(null);
    setSearchParams(key === "module" ? {} : { category: key }, { replace: true });
  };

  const sections = overview.data?.sections;

  const dashboardTiles: DashboardTile[] = [
    { label: "Module aktif", value: sections?.modules.activeCount ?? null, target: "module" },
    { label: "Workflow", value: sections?.workflows.count ?? null, target: "workflow" },
    { label: "User", value: sections?.users.count ?? null, target: "user" },
    { label: "Role", value: sections?.roles.count ?? null, target: "user" },
  ];

  const category = CATEGORIES.find((c) => c.key === selectedCategory);
  const readableCategories = CATEGORIES.filter(canRead);

  return (
    <div className="flex min-h-full flex-col">
      <PageHeader
        title="Administrasi"
        subtitle="Konfigurasi tenant: module, platform, organisasi, pengguna, dan layanan bersama."
      />

      {activeModuleCodes.length === 0 && (
        <Alert tone="warning">
          Belum ada module aktif untuk tenant ini. Aktifkan module terlebih dahulu agar menu dan
          kategori konfigurasinya tersedia.
        </Alert>
      )}

      {overview.error && <Alert tone="error">{overview.error}</Alert>}

      <div className="mt-4 flex flex-col gap-4 sm:flex-row">
        <Sidebar
          categories={CATEGORIES}
          selected={selectedCategory}
          onSelect={selectCategory}
          canRead={canRead}
        />

        <div className="min-w-0 flex-1 space-y-4">
          <StatusDashboard tiles={dashboardTiles} onSelect={selectCategory} />

          {message && (
            <Alert tone={message.type === "error" ? "error" : "success"}>{message.text}</Alert>
          )}

          {!category || !canRead(category) ? (
            <Alert tone="info">
              {readableCategories.length === 0
                ? "Anda belum memiliki izin baca untuk kategori konfigurasi mana pun."
                : "Kategori ini memerlukan izin baca yang belum Anda miliki."}
            </Alert>
          ) : (
            <CategoryBody
              key={category.key}
              category={category}
              token={token}
              orgUnits={orgUnits}
              canManage={canManageCategory(category)}
              canManageAccess={canManageAccess}
              canRead={canRead(category)}
              onMessage={setMessage}
            />
          )}
        </div>
      </div>
    </div>
  );
}