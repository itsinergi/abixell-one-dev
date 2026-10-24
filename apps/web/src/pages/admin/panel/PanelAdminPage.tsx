/**
 * Epic 15 — Panel Admin antarmuka (Checkpoint 1C.1 admin consolidation).
 *
 * Replaces /administration route with single-pane administrative center:
 * - Left sidebar (280px fixed): 8 configuration categories nested
 * - Right panel (flex): category content + status dashboard (top tiles)
 * - ResourceState pattern: 403 denied, 401 sessionExpired, generic error
 * - Design: calm instrument panel (ENERGY 1 / RHYTHM 1 / MOTION 1)
 *
 * Categories (Decision #2):
 * 1. Module — Module activation, feature flags, module-level config
 * 2. Platform — Tenant-wide settings, system features
 * 3. Organization — Org units, hierarchy, structure
 * 4. System — Global system config, numbering, reference data
 * 5. User & Access — Users, roles, permissions, assignments
 * 6. Workflow & Approval — Workflow definitions, approval routing
 * 7. Notification & Channel — Notification engine, channels (SMTP, Web Push, Telegram)
 * 8. Document — Document management, file service
 *
 * Permissions (Decision #7): 16 granular codes (config.{category}.{read,manage})
 * Backward compat: old config.manage still works; new routes use granular codes (Wave 2)
 */

import { useEffect, useState } from "react";
import { api } from "../../../lib/api";
import { PERMISSIONS } from "../../../lib/capabilities";
import { useAuth } from "../../../auth/AuthContext";
import {
  Alert,
  Badge,
  Button,
  Card,
  PageHeader,
  Spinner,
  EmptyState,
  PermissionDeniedState,
} from "../../../shell/components/ui";
import { ConfigurationPanel } from "../../ConfigurationPanel";
import { WorkflowPanel } from "../../WorkflowPanel";
import { SharedServicesPanel } from "../../SharedServicesPanel";

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
  icon: string; // emoji placeholder for calm design
  permissionRead?: string;
  permissionManage?: string;
}

const CATEGORIES: Category[] = [
  {
    key: "module",
    label: "Module",
    description: "Activate modules, configure features, set defaults",
    icon: "📦",
    permissionRead: "config.module.read",
    permissionManage: "config.module.manage",
  },
  {
    key: "platform",
    label: "Platform",
    description: "Tenant-wide settings and system features",
    icon: "⚙",
    permissionRead: "config.platform.read",
    permissionManage: "config.platform.manage",
  },
  {
    key: "organization",
    label: "Organization",
    description: "Units, hierarchy, and structure",
    icon: "🏢",
    permissionRead: "config.org.read",
    permissionManage: "config.org.manage",
  },
  {
    key: "system",
    label: "System",
    description: "Global config, numbering, reference data",
    icon: "🔧",
    permissionRead: "config.system.read",
    permissionManage: "config.system.manage",
  },
  {
    key: "user",
    label: "User & Access",
    description: "Users, roles, permissions, and assignments",
    icon: "👥",
    permissionRead: "config.user.read",
    permissionManage: "config.user.manage",
  },
  {
    key: "workflow",
    label: "Workflow & Approval",
    description: "Workflow definitions and approval routing",
    icon: "⚡",
    permissionRead: "config.workflow.read",
    permissionManage: "config.workflow.manage",
  },
  {
    key: "notification",
    label: "Notification & Channel",
    description: "Notification engine and delivery channels",
    icon: "📢",
    permissionRead: "config.notification.read",
    permissionManage: "config.notification.manage",
  },
  {
    key: "document",
    label: "Document",
    description: "Document management and file service",
    icon: "📄",
    permissionRead: "config.document.read",
    permissionManage: "config.document.manage",
  },
];

interface ResourceState {
  loading: boolean;
  error: string | null;
  denied: boolean;
  sessionExpired: boolean;
}

const emptyResourceState: ResourceState = {
  loading: false,
  error: null,
  denied: false,
  sessionExpired: false,
};

/* ============================================================================
   Status Dashboard
   ============================================================================ */

interface DashboardTile {
  label: string;
  value: number | string;
  description?: string;
  drill?: () => void;
}

function StatusDashboard({ tiles }: { tiles: DashboardTile[] }) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 mb-6">
      {tiles.map((tile) => (
        <div
          key={tile.label}
          className="rounded border border-line bg-panel p-3 text-center"
        >
          <div className="text-lg font-semibold text-ink">{tile.value}</div>
          <div className="text-xs text-ink-dim">{tile.label}</div>
          {tile.description && (
            <div className="mt-1 text-[10.5px] text-ink-faint">
              {tile.description}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

/* ============================================================================
   Sidebar Navigation
   ============================================================================ */

interface SidebarProps {
  categories: Category[];
  selected: CategoryKey;
  onSelect: (key: CategoryKey) => void;
  canRead: (category: Category) => boolean;
}

function Sidebar({ categories, selected, onSelect, canRead }: SidebarProps) {
  const visibleCategories = categories.filter(canRead);

  return (
    <div className="w-80 shrink-0 border-r border-line bg-panel-2">
      <div className="sticky top-0 border-b border-line bg-panel p-3">
        <h2 className="text-sm font-semibold text-ink">Configuration</h2>
      </div>
      <nav className="space-y-1 p-2">
        {visibleCategories.length === 0 ? (
          <p className="px-2 py-3 text-xs text-ink-faint">
            No categories accessible
          </p>
        ) : (
          visibleCategories.map((category) => (
            <button
              key={category.key}
              onClick={() => onSelect(category.key)}
              className={`w-full rounded px-2 py-2 text-left text-sm transition-colors focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-1 focus-visible:ring-offset-ground ${
                selected === category.key
                  ? "bg-accent text-accent-on"
                  : "text-ink-dim hover:bg-panel hover:text-ink"
              }`}
            >
              <span className="inline-block w-5 text-center">
                {category.icon}
              </span>
              <span className="ml-2">{category.label}</span>
            </button>
          ))
        )}
      </nav>
    </div>
  );
}

/* ============================================================================
   Category Panel (placeholder for now)
   ============================================================================ */

type OrgUnitOption = { id: string; name: string };
type PanelMessage = { type: "error" | "success"; text: string };

interface CategoryPanelProps {
  category: Category;
  state: ResourceState;
  onRetry: () => void;
  token: string;
  orgUnits: OrgUnitOption[];
  canManage: boolean;
  canRead: boolean;
  onMessage: (m: PanelMessage) => void;
}

function CategoryPanel({
  category,
  state,
  onRetry,
  token,
  orgUnits,
  canManage,
  canRead,
  onMessage,
}: CategoryPanelProps) {
  if (state.sessionExpired) {
    return (
      <EmptyState
        title="Your session has expired"
        description="Sign in again to continue."
      />
    );
  }

  if (state.denied) {
    return (
      <PermissionDeniedState
        permission={category.permissionRead ?? PERMISSIONS.configManage}
        action={<Button onClick={onRetry}>Try again</Button>}
      />
    );
  }

  if (state.loading) {
    return <Spinner label={`Loading ${category.label}…`} />;
  }

  if (state.error) {
    return (
      <>
        <Alert tone="error">{state.error}</Alert>
        <Button variant="secondary" onClick={onRetry} className="mt-3">
          Try again
        </Button>
      </>
    );
  }

  // Step 3: Wire actual panels per category
  const renderCategoryContent = () => {
    switch (category.key) {
      // Configuration categories: Module, Platform, System
      case "module":
      case "platform":
      case "system":
        return (
          <ConfigurationPanel
            token={token}
            orgUnits={orgUnits}
            canManage={canManage}
            onMessage={onMessage}
          />
        );

      // Workflow category
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

      // Notification & Document categories
      case "notification":
      case "document":
        return (
          <SharedServicesPanel
            token={token}
            canManageDocuments={category.key === "document" ? canManage : false}
            canManageScheduler={false}
            canReadIntegration={canRead}
            canManageIntegration={false}
            canReadObservability={canRead}
            onMessage={onMessage}
          />
        );

      // Organization & User categories: placeholder (Step 3 Wave 2)
      case "organization":
        return (
          <Card>
            <div className="flex items-start justify-between">
              <div>
                <h3 className="text-base font-semibold">Organization</h3>
                <p className="mt-1 text-sm text-ink-dim">
                  Units, hierarchy, and structure
                </p>
              </div>
              <div className="shrink-0">
                <Badge>🏢</Badge>
              </div>
            </div>
            <div className="mt-4 rounded border border-dashed border-line-strong bg-panel-2 p-3 text-center text-sm text-ink-faint">
              Organization Units, Legal Entities, Hierarchy (wired in Step 3 Wave 2)
            </div>
          </Card>
        );

      case "user":
        return (
          <Card>
            <div className="flex items-start justify-between">
              <div>
                <h3 className="text-base font-semibold">User & Access</h3>
                <p className="mt-1 text-sm text-ink-dim">
                  Users, roles, permissions, and assignments
                </p>
              </div>
              <div className="shrink-0">
                <Badge>👥</Badge>
              </div>
            </div>
            <div className="mt-4 rounded border border-dashed border-line-strong bg-panel-2 p-3 text-center text-sm text-ink-faint">
              Users, Roles, Permissions, Audit Trail (wired in Step 3 Wave 2)
            </div>
          </Card>
        );

      default:
        return (
          <EmptyState
            title="Unknown category"
            description={`Category "${category.key}" is not supported.`}
          />
        );
    }
  };

  return renderCategoryContent();
}

/* ============================================================================
   Main Component
   ============================================================================ */

export function PanelAdminPage() {
  const { session } = useAuth();
  const token = session!.accessToken;
  const [selectedCategory, setSelectedCategory] = useState<CategoryKey>(
    "module"
  );
  const [categoryStates, setCategoryStates] = useState<
    Record<CategoryKey, ResourceState>
  >(
    Object.fromEntries(
      CATEGORIES.map((c) => [c.key, emptyResourceState])
    ) as Record<CategoryKey, ResourceState>
  );
  const [orgUnits, setOrgUnits] = useState<OrgUnitOption[]>([]);
  const [message, setMessage] = useState<PanelMessage | null>(null);

  const [permissions, setPermissions] = useState<string[]>([]);

  // Load permissions + org units once; both degrade silently into fallbacks.
  useEffect(() => {
    void Promise.all([api.me(token), api.organizationUnits(token)])
      .then(([me, units]) => {
        setPermissions(me.permissions ?? []);
        setOrgUnits(units.map((u) => ({ id: u.id, name: u.name })));
      })
      .catch(() => {
        setPermissions([]);
      });
  }, [token]);

  // Step 4: granular code from CATEGORIES (not deduced from key), with
  // fallback to config.manage for backward compat.
  const canRead = (category: Category) => {
    const code = category.permissionRead;
    return (
      !!code &&
      (permissions.includes(code) || permissions.includes(PERMISSIONS.configManage))
    );
  };

  const canManageCategory = (category: Category) => {
    const code = category.permissionManage;
    return (
      !!code &&
      (permissions.includes(code) || permissions.includes(PERMISSIONS.configManage))
    );
  };

  const handleCategorySelect = (key: CategoryKey) => {
    setSelectedCategory(key);
  };

  const handleRetry = () => {
    setCategoryStates((prev) => ({
      ...prev,
      [selectedCategory]: emptyResourceState,
    }));
  };

  // Placeholder dashboard tiles (Step 3+ will load real counts)
  const dashboardTiles: DashboardTile[] = [
    { label: "Modules Active", value: "" },
    { label: "Workflows Defined", value: "" },
    { label: "Users Assigned", value: "" },
    { label: "Documents Ready", value: "" },
  ];

  const selectedCategoryObj = CATEGORIES.find(
    (c) => c.key === selectedCategory
  );
  const selectedState = categoryStates[selectedCategory] || emptyResourceState;

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-ground">
      {/* Header */}
      <div className="border-b border-line bg-panel px-6 py-4">
        <PageHeader
          title="Administration"
          subtitle="Organization, users, configuration, and shared services."
        />
      </div>

      {/* Main layout: sidebar + right panel */}
      <div className="flex flex-1 overflow-hidden">
        {/* Sidebar */}
        <Sidebar
          categories={CATEGORIES}
          selected={selectedCategory}
          onSelect={handleCategorySelect}
          canRead={canRead}
        />

        {/* Right panel: status dashboard + category content */}
        <div className="flex-1 overflow-y-auto">
          <div className="space-y-6 p-6">
            {/* Status dashboard (top) */}
            <StatusDashboard tiles={dashboardTiles} />

            {/* Message display */}
            {message && (
              <Alert tone={message.type === "error" ? "error" : "success"}>
                {message.text}
              </Alert>
            )}

            {/* Category content */}
            {selectedCategoryObj ? (
              <CategoryPanel
                category={selectedCategoryObj}
                state={selectedState}
                onRetry={handleRetry}
                token={token}
                orgUnits={orgUnits}
                canManage={canManageCategory(selectedCategoryObj)}
                canRead={canRead(selectedCategoryObj)}
                onMessage={setMessage}
              />
            ) : (
              <EmptyState title="Category not found" />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
