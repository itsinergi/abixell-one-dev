/**
 * Checkpoint 1C.1 — Reusable enterprise Application Shell.
 *
 * Replaces the Phase 0 static placeholder shell. The SAME shell renders
 * for every Tenant/client (ADR-0003); what differs — the workspace title
 * (Tenant name) and which navigation sections appear — is driven by data
 * (Tenant record + the user's granted permissions), never a per-client
 * build.
 *
 * Responsibilities:
 *  - Fetch the signed-in user's context once (`/me` + `/tenants/me`) and
 *    expose it via ShellContext so nested pages don't each re-fetch it.
 *  - Render responsive, grouped, capability-gated navigation (persistent
 *    sidebar on desktop, an accessible overlay drawer below 1024px).
 *  - Own the workspace header, scope summary, and sign-out affordances.
 *  - Render the active section through <Outlet/>.
 *
 * Navigation is capability-gated for UX only — see capabilities.ts. All
 * authorization remains backend-enforced.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type RefObject,
} from "react";
import { NavLink, Outlet, useLocation } from "react-router-dom";
import { useAuth } from "../../auth/AuthContext";
import { api, ApiError } from "../../lib/api";
import {
  activeNavModuleCodes,
  filterNavTree,
  visibleNavTree,
  type ModuleCode,
  type VisibleNavTreeGroup,
} from "../../lib/capabilities";
import { Alert, Button, Spinner } from "../components/ui";
import { useOnlineStatus } from "../useOnlineStatus";

interface ShellContextValue {
  /** Raw permission codes from `GET /me`. */
  permissions: string[];
  /** Data-Scope types the actor holds (customer / organization_unit / tenant). */
  scopeTypes: string[];
  /** Active module codes reported by the tenant-scoped `GET /me`. */
  activeModuleCodes: string[];
  userId: string;
  tenantName: string;
}

const ShellContext = createContext<ShellContextValue | null>(null);

/** Read the shell-provided user context from within a routed page. */
export function useShell(): ShellContextValue {
  const ctx = useContext(ShellContext);
  if (!ctx) throw new Error("useShell must be used within AppShell");
  return ctx;
}

function scopeSummary(scopeTypes: string[]): string {
  const labels = [
    scopeTypes.includes("tenant") ? "Tenant-wide scope" : null,
    scopeTypes.includes("organization_unit") ? "Organization unit scope" : null,
    scopeTypes.includes("customer") ? "Customer scope" : null,
  ].filter((label): label is string => label !== null);

  return labels.length > 0 ? labels.join(" · ") : "No data scope reported";
}

function NavigationContent({
  groups,
  query,
  onQueryChange,
  expandedModules,
  onToggleModule,
  onNavigate,
  filterId,
}: {
  groups: VisibleNavTreeGroup[];
  query: string;
  onQueryChange: (query: string) => void;
  expandedModules: Record<string, boolean>;
  onToggleModule: (moduleCode: ModuleCode) => void;
  onNavigate?: () => void;
  filterId: string;
}) {
  const filterInputRef = useRef<HTMLInputElement>(null);
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const filteredGroups = useMemo(
    () => filterNavTree(groups, query),
    [groups, query],
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="px-3 pb-3">
        <label htmlFor={filterId} className="sr-only">
          Filter navigation
        </label>
        <div className="relative">
          <input
            ref={filterInputRef}
            id={filterId}
            type="search"
            value={query}
            onChange={(event) => onQueryChange(event.target.value)}
            placeholder="Filter navigation"
            autoComplete="off"
            className="min-h-[44px] w-full rounded-md border border-slate-300 bg-white px-3 pr-9 text-sm text-slate-800 placeholder:text-slate-400 focus:border-slate-500 focus:outline-none focus:ring-2 focus:ring-slate-200 lg:min-h-[36px]"
          />
          {query && (
            <button
              type="button"
              onClick={() => {
                onQueryChange("");
                filterInputRef.current?.focus();
              }}
              aria-label="Clear navigation filter"
              className="absolute inset-y-0 right-0 flex min-h-[44px] min-w-[44px] items-center justify-center rounded-r-md text-lg leading-none text-slate-400 hover:text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-slate-400 lg:min-h-[36px] lg:min-w-[36px]"
            >
              ×
            </button>
          )}
        </div>
      </div>

      <nav aria-label="Primary navigation" className="min-h-0 flex-1 overflow-y-auto px-2 pb-4">
        {filteredGroups.length > 0 ? (
          <div className="space-y-5">
            {filteredGroups.map((group) => (
              <section key={group.key} aria-labelledby={`${filterId}-${group.key}`}>
                <h2
                  id={`${filterId}-${group.key}`}
                  className="px-3 text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-400"
                  title={group.description}
                >
                  {group.label}
                </h2>
                <div className="mt-1 space-y-1">
                  {group.nodes.map((node) => {
                    if (node.type === "section") {
                      return (
                        <NavLink
                          key={node.section.key}
                          to={node.section.path}
                          end={node.section.path === "/"}
                          onClick={onNavigate}
                          className={({ isActive }) =>
                            `flex min-h-[44px] items-center rounded-md px-3 py-2 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400 focus-visible:ring-offset-1 lg:min-h-[36px] ${
                              isActive
                                ? "bg-slate-900 font-medium text-white shadow-sm"
                                : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
                            }`
                          }
                        >
                          {node.section.label}
                        </NavLink>
                      );
                    }

                    const isExpanded = Boolean(
                      normalizedQuery || expandedModules[node.moduleCode],
                    );
                    const triggerId = `${filterId}-module-${node.moduleCode}-trigger`;
                    const contentId = `${filterId}-module-${node.moduleCode}-content`;

                    return (
                      <div key={node.moduleCode} className="space-y-0.5">
                        <button
                          id={triggerId}
                          type="button"
                          aria-expanded={isExpanded}
                          aria-controls={contentId}
                          onClick={() => onToggleModule(node.moduleCode)}
                          className="flex min-h-[44px] w-full items-center justify-between rounded-md px-3 py-2 text-left text-sm font-medium text-slate-700 hover:bg-slate-100 hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400 focus-visible:ring-offset-1 lg:min-h-[36px]"
                        >
                          <span className="flex min-w-0 items-center gap-2">
                            <svg
                              aria-hidden="true"
                              className={`h-4 w-4 shrink-0 transition-transform duration-150 ${
                                isExpanded ? "rotate-90 text-slate-700" : "text-slate-400"
                              }`}
                              viewBox="0 0 20 20"
                              fill="currentColor"
                            >
                              <path
                                fillRule="evenodd"
                                d="M7.21 14.77a.75.75 0 01.02-1.06L11.168 10 7.23 6.29a.75.75 0 111.04-1.08l4.5 4.25a.75.75 0 010 1.08l-4.5 4.25a.75.75 0 01-1.06-.02z"
                                clipRule="evenodd"
                              />
                            </svg>
                            <span className="truncate">{node.label}</span>
                          </span>
                          <span className="ml-2 inline-flex min-w-[20px] items-center justify-center rounded-full bg-slate-100 px-1.5 py-0.5 text-[11px] font-semibold text-slate-500">
                            {node.sections.length}
                          </span>
                        </button>

                        <div
                          id={contentId}
                          role="region"
                          aria-labelledby={triggerId}
                          hidden={!isExpanded}
                          className="ml-4 space-y-0.5 border-l border-slate-200 pl-2"
                        >
                          {node.sections.map((section) => (
                            <NavLink
                              key={section.key}
                              to={section.path}
                              end={section.path === "/"}
                              onClick={onNavigate}
                              className={({ isActive }) =>
                                `flex min-h-[44px] items-center rounded-md px-2.5 py-1.5 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400 focus-visible:ring-offset-1 lg:min-h-[32px] ${
                                  isActive
                                    ? "bg-slate-900 font-medium text-white shadow-sm"
                                    : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
                                }`
                              }
                            >
                              {section.label}
                            </NavLink>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </section>
            ))}
          </div>
        ) : (
          <div
            className="mx-1 rounded-md border border-dashed border-slate-300 bg-slate-50 px-3 py-4 text-sm text-slate-500"
            role="status"
          >
            No visible areas match “{query.trim()}”.
            <button
              type="button"
              onClick={() => {
                onQueryChange("");
                filterInputRef.current?.focus();
              }}
              className="mt-2 flex min-h-[44px] items-center font-medium text-slate-700 underline decoration-slate-300 underline-offset-4 hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400 lg:min-h-[36px]"
            >
              Clear filter
            </button>
          </div>
        )}
      </nav>
    </div>
  );
}

function focusableElements(container: HTMLElement): HTMLElement[] {
  return Array.from(
    container.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
    ),
  ).filter((element) => !element.hasAttribute("hidden"));
}

function useNavigationDrawer(
  open: boolean,
  setOpen: (open: boolean) => void,
  drawerRef: RefObject<HTMLElement>,
  triggerRef: RefObject<HTMLButtonElement>,
) {
  const wasOpen = useRef(false);

  useEffect(() => {
    if (!open) {
      if (wasOpen.current && triggerRef.current?.getClientRects().length) {
        triggerRef.current.focus();
      }
      wasOpen.current = false;
      return;
    }

    wasOpen.current = true;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const focusFrame = window.requestAnimationFrame(() => {
      focusableElements(drawerRef.current ?? document.body)[0]?.focus();
    });

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        setOpen(false);
        return;
      }
      if (event.key !== "Tab" || !drawerRef.current) return;

      const focusable = focusableElements(drawerRef.current);
      if (focusable.length === 0) {
        event.preventDefault();
        drawerRef.current.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (!drawerRef.current.contains(document.activeElement)) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
      } else if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      window.cancelAnimationFrame(focusFrame);
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [drawerRef, open, setOpen, triggerRef]);
}

export function AppShell() {
  const { session, logout } = useAuth();
  const token = session!.accessToken;
  const location = useLocation();

  const [permissions, setPermissions] = useState<string[]>([]);
  const [scopeTypes, setScopeTypes] = useState<string[]>([]);
  const [activeModuleCodes, setActiveModuleCodes] = useState<string[]>([]);
  const [expandedModules, setExpandedModules] = useState<Record<string, boolean>>({});
  const [tenantName, setTenantName] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [navigationQuery, setNavigationQuery] = useState("");
  const drawerRef = useRef<HTMLElement>(null);
  const menuTriggerRef = useRef<HTMLButtonElement>(null);
  const online = useOnlineStatus();

  const closeMobileNavigation = useCallback(() => setMobileNavOpen(false), []);
  const toggleModule = useCallback((moduleCode: ModuleCode) => {
    setExpandedModules((prev) => ({
      ...prev,
      [moduleCode]: !prev[moduleCode],
    }));
  }, []);

  useNavigationDrawer(
    mobileNavOpen,
    setMobileNavOpen,
    drawerRef,
    menuTriggerRef,
  );

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      // `/me` (permissions + active modules) is required — it drives navigation.
      const me = await api.me(token);
      setPermissions(me.permissions);
      setScopeTypes(me.scopeTypes);
      setActiveModuleCodes(me.activeModuleCodes ?? []);
      // The Tenant name is only the workspace title, and reading it needs
      // `tenant.read` — a permission a Customer User does NOT hold. Fetch it
      // best-effort so its absence never blocks the shell; fall back to the
      // neutral title (ADR-0003) instead.
      try {
        const tenant = await api.tenant(token);
        setTenantName(tenant.name);
      } catch {
        setTenantName("");
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to load your workspace");
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    closeMobileNavigation();
  }, [closeMobileNavigation, location.pathname, location.search]);

  useEffect(() => {
    const desktopBreakpoint = window.matchMedia("(min-width: 1024px)");
    const closeAtDesktopBreakpoint = (event: MediaQueryListEvent) => {
      if (event.matches) closeMobileNavigation();
    };

    if (desktopBreakpoint.matches) closeMobileNavigation();
    desktopBreakpoint.addEventListener("change", closeAtDesktopBreakpoint);
    return () => {
      desktopBreakpoint.removeEventListener("change", closeAtDesktopBreakpoint);
    };
  }, [closeMobileNavigation]);

  const groups = useMemo(
    () => visibleNavTree(permissions, scopeTypes, activeModuleCodes),
    [permissions, scopeTypes, activeModuleCodes],
  );

  useEffect(() => {
    const activeCodes = activeNavModuleCodes(groups, location.pathname);
    if (activeCodes.length === 0) return;
    setExpandedModules((prev) => {
      let changed = false;
      const next = { ...prev };
      for (const code of activeCodes) {
        if (!next[code]) {
          next[code] = true;
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [groups, location.pathname]);

  // Client-neutral fallback while the Tenant name loads (ADR-0003).
  const workspaceTitle = tenantName || "Enterprise Management System";
  const currentScopeSummary = scopeSummary(scopeTypes);

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 lg:flex">
      <a
        href="#main-content"
        className="fixed left-3 top-3 z-[60] -translate-y-20 rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white shadow-lg transition-transform focus:translate-y-0 focus:outline-none focus:ring-2 focus:ring-slate-400 focus:ring-offset-2"
      >
        Skip to main content
      </a>

      {/* Persistent desktop navigation. */}
      <aside className="sticky top-0 hidden h-screen w-60 shrink-0 border-r border-slate-200 bg-white lg:flex lg:flex-col">
        <div className="border-b border-slate-100 px-4 py-4">
          <div className="truncate text-sm font-semibold text-slate-800" title={workspaceTitle}>
            {workspaceTitle}
          </div>
          <div className="mt-1 text-xs text-slate-500">{currentScopeSummary}</div>
        </div>
        <NavigationContent
          groups={groups}
          query={navigationQuery}
          onQueryChange={setNavigationQuery}
          expandedModules={expandedModules}
          onToggleModule={toggleModule}
          filterId="desktop-navigation-filter"
        />
        <div className="border-t border-slate-200 p-3">
          <div className="truncate px-1 text-xs text-slate-500" title={session!.userId}>
            Signed in as {session!.userId}
          </div>
          <Button variant="secondary" className="mt-2 w-full" onClick={logout}>
            Sign out
          </Button>
        </div>
      </aside>

      {/* Tablet/mobile overlay navigation. */}
      {mobileNavOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <button
            type="button"
            className="absolute inset-0 h-full w-full cursor-default bg-slate-950/40"
            onClick={closeMobileNavigation}
            aria-label="Close navigation"
            tabIndex={-1}
          />
          <aside
            id="mobile-navigation"
            ref={drawerRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="mobile-navigation-title"
            tabIndex={-1}
            className="relative flex h-full w-full flex-col bg-white shadow-2xl focus:outline-none sm:max-w-sm"
          >
            <div className="flex min-h-[64px] items-start justify-between gap-3 border-b border-slate-200 px-4 py-3">
              <div className="min-w-0">
                <h2 id="mobile-navigation-title" className="truncate text-sm font-semibold text-slate-800">
                  {workspaceTitle}
                </h2>
                <p className="mt-0.5 text-xs text-slate-500">{currentScopeSummary}</p>
              </div>
              <button
                type="button"
                onClick={closeMobileNavigation}
                aria-label="Close navigation"
                className="flex min-h-[44px] min-w-[44px] shrink-0 items-center justify-center rounded-md text-xl text-slate-500 hover:bg-slate-100 hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400"
              >
                ×
              </button>
            </div>
            <div className="min-h-0 flex flex-1 flex-col pt-3">
              <NavigationContent
                groups={groups}
                query={navigationQuery}
                onQueryChange={setNavigationQuery}
                expandedModules={expandedModules}
                onToggleModule={toggleModule}
                onNavigate={closeMobileNavigation}
                filterId="drawer-navigation-filter"
              />
            </div>
            <div className="border-t border-slate-200 p-3">
              <div className="truncate px-1 text-xs text-slate-500" title={session!.userId}>
                Signed in as {session!.userId}
              </div>
              <Button variant="secondary" className="mt-2 min-h-[44px] w-full" onClick={logout}>
                Sign out
              </Button>
            </div>
          </aside>
        </div>
      )}

      <div className="flex min-h-screen min-w-0 flex-1 flex-col">
        <div className="sticky top-0 z-20">
          <header className="flex min-h-[60px] items-center justify-between gap-3 border-b border-slate-200 bg-white/95 px-4 backdrop-blur sm:px-6">
            <div className="flex min-w-0 items-center gap-3">
              <button
                ref={menuTriggerRef}
                type="button"
                aria-expanded={mobileNavOpen}
                aria-controls="mobile-navigation"
                aria-label="Open navigation"
                onClick={() => setMobileNavOpen(true)}
                className="flex min-h-[44px] min-w-[44px] shrink-0 items-center justify-center rounded-md border border-slate-300 bg-white text-sm font-medium text-slate-700 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400 lg:hidden"
              >
                Menu
              </button>
              <div className="min-w-0 lg:hidden">
                <div className="truncate text-sm font-semibold text-slate-800">{workspaceTitle}</div>
                <div className="truncate text-xs text-slate-500">{currentScopeSummary}</div>
              </div>
              <div className="hidden min-w-0 lg:block">
                <div className="text-sm font-medium text-slate-700">Workspace</div>
                <div className="text-xs text-slate-500">{currentScopeSummary}</div>
              </div>
            </div>
            <div className="hidden min-w-0 items-center gap-3 lg:flex">
              <span className="max-w-xs truncate text-xs text-slate-500" title={session!.userId}>
                {session!.userId}
              </span>
              <Button variant="secondary" onClick={logout}>
                Sign out
              </Button>
            </div>
          </header>
          {!online && (
            <div
              className="border-b border-amber-300 bg-amber-100 px-4 py-2 text-center text-xs font-medium text-amber-900"
              role="status"
              aria-live="polite"
            >
              You are offline — some actions may be unavailable until the connection returns.
            </div>
          )}
        </div>

        <main id="main-content" tabIndex={-1} className="min-w-0 flex-1 p-4 focus:outline-none sm:p-6">
          <div className="mx-auto w-full max-w-[1600px]">
            {loading ? (
              <Spinner label="Loading your workspace…" />
            ) : error ? (
              <div className="space-y-3">
                <Alert tone="error">{error}</Alert>
                <Button variant="secondary" onClick={load}>
                  Retry
                </Button>
              </div>
            ) : (
              <ShellContext.Provider
                value={{
                  permissions,
                  scopeTypes,
                  activeModuleCodes,
                  userId: session!.userId,
                  tenantName,
                }}
              >
                <Outlet />
              </ShellContext.Provider>
            )}
          </div>
        </main>
      </div>
    </div>
  );
}
