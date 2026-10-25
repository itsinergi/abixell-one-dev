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
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../../auth/AuthContext";
import { api, ApiError, type MenuNode } from "../../lib/api";
import {
  activeServedModuleCodes,
  filterServedNav,
  servedNavGroups,
  type ServedNavGroup,
  type ServedNavPage,
} from "../../lib/servedNav";
import { GUARD_ENFORCE, evaluateRouteAccess, isEntryFlowRoute } from "../../lib/routeRegistry";
import { Alert, Button, Spinner } from "../components/ui";
import { ThemeToggle } from "../components/ThemeToggle";
import { UserMenu } from "../components/UserMenu";
import { SwitchRoleDialog } from "../components/SwitchRoleDialog";
import { useOnlineStatus } from "../useOnlineStatus";

interface ShellContextValue {
  /** Raw permission codes from `GET /me`. */
  permissions: string[];
  /** Data-Scope types the actor holds (customer / organization_unit / tenant). */
  scopeTypes: string[];
  /** Active module codes reported by the tenant-scoped `GET /me`. */
  activeModuleCodes: string[];
  /**
   * The navigation the server filtered for THIS caller (§4.3 step 7), shaped
   * for rendering. The sidebar and Overview both render from it — a page that
   * needs destinations must read them here, never from `capabilities.ts`,
   * which describes the whole application rather than this caller's view.
   */
  navGroups: ServedNavGroup[];
  userId: string;
  tenantName: string;
  setTenantName: (name: string) => void;
}

const ShellContext = createContext<ShellContextValue | null>(null);

/** Read the shell-provided user context from within a routed page. */
export function useShell(): ShellContextValue {
  const ctx = useContext(ShellContext);
  if (!ctx) throw new Error("useShell must be used within AppShell");
  return ctx;
}

/**
 * One navigation row (§4.3 step 6).
 *
 * A page the server marked `locked` is rendered as text, never as a link: the
 * caller's role cannot open it, so an anchor would only produce a denied page
 * on click. It stays visible with the reason the server sent, which is the
 * whole point of the state — a role that cannot do something should still be
 * able to see that the function exists and what to ask an administrator for
 * ("MODUL AKTIF + role tidak boleh → menu tampil, NONAKTIF + keterangan").
 *
 * The reason is rendered as visible text, not a `title` alone: a tooltip is
 * unreachable on touch and easy to miss with a keyboard.
 */
function NavRow({
  page,
  nested,
  onNavigate,
}: {
  page: ServedNavPage;
  nested: boolean;
  onNavigate?: () => void;
}) {
  const base = nested
    ? "flex min-h-[44px] flex-col justify-center rounded px-2.5 py-1.5 text-sm lg:min-h-[32px]"
    : "flex min-h-[44px] flex-col justify-center rounded px-3 py-2 text-sm lg:min-h-[36px]";

  if (page.locked) {
    return (
      <div
        className={`${base} cursor-not-allowed text-ink-faint`}
        aria-disabled="true"
        data-nav-locked={page.code}
      >
        <span className="truncate">{page.label}</span>
        {page.lockedReason && (
          <span className="text-[11px] leading-snug text-ink-faint">{page.lockedReason}</span>
        )}
      </div>
    );
  }

  return (
    <NavLink
      to={page.path}
      end={page.path === "/"}
      onClick={onNavigate}
      className={({ isActive }: { isActive: boolean }) =>
        `${base} transition-colors focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-1 ${
          isActive
            ? "bg-accent font-medium text-accent-on shadow-xs"
            : "text-ink-dim hover:bg-panel-3 hover:text-ink"
        }`
      }
    >
      {page.label}
    </NavLink>
  );
}

function scopeSummary(scopeTypes: string[]): string {
  const labels = [
    scopeTypes.includes("tenant") ? "All Project" : null,
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
  groups: ServedNavGroup[];
  query: string;
  onQueryChange: (query: string) => void;
  expandedModules: Record<string, boolean>;
  onToggleModule: (moduleCode: string) => void;
  onNavigate?: () => void;
  filterId: string;
}) {
  const filterInputRef = useRef<HTMLInputElement>(null);
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const filteredGroups = useMemo(
    () => filterServedNav(groups, query),
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
            className="min-h-[44px] w-full rounded border border-line-strong bg-panel px-3 pr-9 text-sm text-ink placeholder:text-ink-faint focus:border-accent focus:outline-hidden focus:ring-2 focus:ring-2 focus:ring-accent-soft lg:min-h-[36px]"
          />
          {query && (
            <button
              type="button"
              onClick={() => {
                onQueryChange("");
                filterInputRef.current?.focus();
              }}
              aria-label="Clear navigation filter"
              className="absolute inset-y-0 right-0 flex min-h-[44px] min-w-[44px] items-center justify-center rounded-r text-lg leading-none text-ink-faint hover:text-ink-dim focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent lg:min-h-[36px] lg:min-w-[36px]"
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
                  className="px-3 text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-faint"
                  title={group.description}
                >
                  {group.label}
                </h2>
                <div className="mt-1 space-y-1">
                  {group.nodes.map((node) => {
                    if (node.type === "page") {
                      return (
                        <NavRow
                          key={node.code}
                          page={node}
                          nested={false}
                          onNavigate={onNavigate}
                        />
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
                          className="flex min-h-[44px] w-full items-center justify-between rounded px-3 py-2 text-left text-sm font-medium text-ink-dim hover:bg-panel-3 hover:text-ink focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-1 lg:min-h-[36px]"
                        >
                          <span className="flex min-w-0 items-center gap-2">
                            <svg
                              aria-hidden="true"
                              className={`h-4 w-4 shrink-0 transition-transform duration-150 ${
                                isExpanded ? "rotate-90 text-ink-dim" : "text-ink-faint"
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
                          <span className="ml-2 inline-flex min-w-[20px] items-center justify-center rounded-full bg-panel-3 px-1.5 py-0.5 text-[11px] font-semibold text-ink-dim">
                            {node.pages.length}
                          </span>
                        </button>

                        <div
                          id={contentId}
                          role="region"
                          aria-labelledby={triggerId}
                          hidden={!isExpanded}
                          className="ml-4 space-y-0.5 border-l border-line pl-2"
                        >
                          {node.pages.map((page) => (
                            <NavRow
                              key={page.code}
                              page={page}
                              nested
                              onNavigate={onNavigate}
                            />
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
            className="mx-1 rounded border border-dashed border-line-strong bg-panel-2 px-3 py-4 text-sm text-ink-dim"
            role="status"
          >
            No visible areas match “{query.trim()}”.
            <button
              type="button"
              onClick={() => {
                onQueryChange("");
                filterInputRef.current?.focus();
              }}
              className="mt-2 flex min-h-[44px] items-center font-medium text-ink-dim underline decoration-line-strong underline-offset-4 hover:text-ink focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-accent lg:min-h-[36px]"
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
  drawerRef: RefObject<HTMLElement | null>,
  triggerRef: RefObject<HTMLButtonElement | null>,
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
  const { session, logout, updateSession } = useAuth();
  const token = session!.accessToken;
  const assignmentId = session!.assignmentId;
  const location = useLocation();
  const navigate = useNavigate();

  const [permissions, setPermissions] = useState<string[]>([]);
  const [scopeTypes, setScopeTypes] = useState<string[]>([]);
  const [activeModuleCodes, setActiveModuleCodes] = useState<string[]>([]);
  // The navigation the server sent for THIS caller (§4.3 step 7). Held as the
  // payload, not as a rendered tree: `groups` below is derived from it.
  const [menu, setMenu] = useState<MenuNode[]>([]);
  const [expandedModules, setExpandedModules] = useState<Record<string, boolean>>({});
  const [tenantName, setTenantName] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [navigationQuery, setNavigationQuery] = useState("");
  const [switchRoleOpen, setSwitchRoleOpen] = useState(false);
  const drawerRef = useRef<HTMLElement>(null);
  const menuTriggerRef = useRef<HTMLButtonElement>(null);
  const loadGeneration = useRef(0);
  const online = useOnlineStatus();

  // Route guard (Epic 3 Wave 1 §4.3 step 1; Wave 2 step 8 adds the third
  // cause). It resolves the current path against the route registry;
  // GUARD_ENFORCE decides whether the shell acts on the answer. Derived, not
  // stored: `location` and `permissions` already trigger the render, so an
  // extra effect would only add a frame of stale state.
  //
  // Entry-flow routes are exempt: /login, /select-workspace and the public
  // survey render outside the shell's navigation by design and carry no
  // permission, so withholding them would lock a user out of their own sign-in.
  const routeGuardReport = useMemo(
    () => evaluateRouteAccess(location.pathname, permissions),
    [location.pathname, permissions],
  );
  // §4.3 step 8's second cause. `activeModuleCodes` comes from `/me`, so a
  // route is withheld as module-inactive exactly when the server's own filter
  // hid its menu — the two cannot disagree. `platform` is exempt: it is the
  // shell's own module (Overview, Profile, Administration, Admin Console), is
  // never activated per tenant, and every page behind it is permission-gated
  // anyway; a naive check here would lock the whole workspace out.
  const moduleInactive = useMemo(() => {
    const code = routeGuardReport.entry?.moduleCode;
    return (
      GUARD_ENFORCE
      && code !== undefined
      && code !== "platform"
      && !activeModuleCodes.includes(code)
    );
  }, [routeGuardReport.entry, activeModuleCodes]);
  // Three causes can withhold a page (§4.3 step 8), and they ask different
  // things of the user: an inactive module is a tenant decision, a missing
  // right is an administrator decision, an unknown address is neither.
  const guardBlocks =
    GUARD_ENFORCE && !loading && !error
    && (!routeGuardReport.ok || moduleInactive)
    && !isEntryFlowRoute(routeGuardReport.entry);

  const closeMobileNavigation = useCallback(() => setMobileNavOpen(false), []);
  const toggleModule = useCallback((moduleCode: string) => {
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
    // Guard against a slower earlier load resolving after a newer one (token
    // or assignment changed mid-flight) and overwriting the newer context.
    const generation = ++loadGeneration.current;
    setLoading(true);
    setError(null);
    try {
      // `/me` (permissions + active modules) is required — it drives navigation.
      // Epic 1 (§4.1 C): the server reports the SESSION's active assignment
      // (resolved from the sessions row), not a client-chosen one. Switching
      // context goes through POST /auth/switch-role, and the next /me — and
      // thus this load — reflects it.
      const me = await api.me(token);
      if (loadGeneration.current !== generation) return;
      setPermissions(me.permissions);
      setScopeTypes(me.scopeTypes);
      setActiveModuleCodes(me.activeModuleCodes ?? []);
      setMenu(me.menu ?? []);
      updateSession({
        fullName: me.fullName,
        email: me.email,
        sessionId: me.sessionId,
        assignmentId: me.activeAssignmentId ?? undefined,
        activeRoleName: me.activeAssignmentName ?? undefined,
        activeScopeName: me.activeScopeName ?? undefined,
      });
      // The Tenant name is only the workspace title, and reading it needs
      // `tenant.read` — a permission a Customer User does NOT hold. Fetch it
      // best-effort so its absence never blocks the shell; fall back to the
      // neutral title (ADR-0003) instead.
      try {
        const tenant = await api.tenant(token);
        if (loadGeneration.current !== generation) return;
        setTenantName(tenant.name);
      } catch {
        if (loadGeneration.current !== generation) return;
        setTenantName("");
      }
    } catch (err) {
      if (loadGeneration.current !== generation) return;
      setError(err instanceof ApiError ? err.message : "Failed to load your workspace");
    } finally {
      if (loadGeneration.current === generation) setLoading(false);
    }
  }, [token, updateSession]);

  useEffect(() => {
    load();
    // `assignmentId` re-runs the load on a Role switch: the server has
    // already rewritten the session's active Role, `updateSession` recorded
    // the new value, and this refresh is what pulls the new permission set
    // and navigation (Epic 1 §4.1 C). Keeping it out of `load`'s own
    // dependency list is deliberate — the callback body does not read it.
  }, [load, assignmentId]);

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

  // The render source is the served tree (§4.3 step 7), not a local
  // recalculation: what the server filtered out of `menu` cannot reappear
  // here, and `locked` arrives already decided. Labels and descriptions come
  // from the served `MenuNode`, so a tenant label override served by the
  // dictionary shows up without the shell knowing about it.
  const groups = useMemo(() => servedNavGroups(menu), [menu]);

  useEffect(() => {
    const activeCodes = activeServedModuleCodes(groups, location.pathname);
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
    <div className="min-h-screen bg-ground text-ink lg:flex">
      <a
        href="#main-content"
        className="fixed left-3 top-3 z-60 -translate-y-20 rounded bg-accent px-4 py-2 text-sm font-medium text-accent-on shadow-lg transition-transform focus:translate-y-0 focus:outline-hidden focus:ring-2 focus:ring-accent focus:ring-offset-2 focus:ring-offset-ground"
      >
        Skip to main content
      </a>

      {/* Persistent desktop navigation. */}
      <aside className="sticky top-0 hidden h-screen w-60 shrink-0 border-r border-line bg-panel lg:flex lg:flex-col">
        <div className="border-b border-line px-4 py-4">
          <div className="truncate text-sm font-semibold text-ink" title={workspaceTitle}>
            {workspaceTitle}
          </div>
          <div className="mt-1 text-xs text-ink-dim">{currentScopeSummary}</div>
        </div>
        <NavigationContent
          groups={groups}
          query={navigationQuery}
          onQueryChange={setNavigationQuery}
          expandedModules={expandedModules}
          onToggleModule={toggleModule}
          filterId="desktop-navigation-filter"
        />
        <div className="border-t border-line p-3">
          <UserMenu
            fullName={session?.fullName}
            email={session?.email}
            activeRoleName={session?.activeRoleName}
            activeScopeName={session?.activeScopeName}
            onSwitchRole={() => setSwitchRoleOpen(true)}
            onSignOut={logout}
          />
        </div>
      </aside>

      {/* Tablet/mobile overlay navigation. */}
      {mobileNavOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <button
            type="button"
            className="absolute inset-0 h-full w-full cursor-default bg-black/50"
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
            className="relative flex h-full w-full flex-col bg-panel shadow-2xl focus:outline-hidden sm:max-w-sm"
          >
            <div className="flex min-h-[64px] items-start justify-between gap-3 border-b border-line px-4 py-3">
              <div className="min-w-0">
                <h2 id="mobile-navigation-title" className="truncate text-sm font-semibold text-ink">
                  {workspaceTitle}
                </h2>
                <p className="mt-0.5 text-xs text-ink-dim">{currentScopeSummary}</p>
              </div>
              <button
                type="button"
                onClick={closeMobileNavigation}
                aria-label="Close navigation"
                className="flex min-h-[44px] min-w-[44px] shrink-0 items-center justify-center rounded text-xl text-ink-dim hover:bg-panel-3 hover:text-ink focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-accent"
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
            <div className="border-t border-line p-3">
              <UserMenu
            fullName={session?.fullName}
            email={session?.email}
            activeRoleName={session?.activeRoleName}
            activeScopeName={session?.activeScopeName}
            onSwitchRole={() => setSwitchRoleOpen(true)}
            onSignOut={logout}
          />
            </div>
          </aside>
        </div>
      )}

      <div className="flex min-h-screen min-w-0 flex-1 flex-col">
        <div className="sticky top-0 z-20">
          <header className="flex min-h-[60px] items-center justify-between gap-3 border-b border-line bg-panel/95 px-4 backdrop-blur-sm sm:px-6">
            <div className="flex min-w-0 items-center gap-3">
              <button
                ref={menuTriggerRef}
                type="button"
                aria-expanded={mobileNavOpen}
                aria-controls="mobile-navigation"
                aria-label="Open navigation"
                onClick={() => setMobileNavOpen(true)}
                className="flex min-h-[44px] min-w-[44px] shrink-0 items-center justify-center rounded border border-line-strong bg-panel text-sm font-medium text-ink-dim hover:bg-panel-2 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-accent lg:hidden"
              >
                Menu
              </button>
              <div className="min-w-0 lg:hidden">
                <div className="truncate text-sm font-semibold text-ink">{workspaceTitle}</div>
                <div className="truncate text-xs text-ink-dim">{currentScopeSummary}</div>
              </div>
              <div className="hidden min-w-0 lg:block">
                <div className="truncate text-sm font-medium text-ink-dim" title={workspaceTitle}>
                  {workspaceTitle}
                </div>
                <div className="text-xs text-ink-dim">{currentScopeSummary}</div>
              </div>
            </div>
            <div className="hidden min-w-0 items-center gap-3 lg:flex">
              <ThemeToggle />
              <UserMenu
            fullName={session?.fullName}
            email={session?.email}
            activeRoleName={session?.activeRoleName}
            activeScopeName={session?.activeScopeName}
            onSwitchRole={() => setSwitchRoleOpen(true)}
            onSignOut={logout}
          />
            </div>
          </header>
          {!online && (
            <div
              className="border-b border-status-warn bg-status-warn-soft px-4 py-2 text-center text-xs font-medium text-status-warn"
              role="status"
              aria-live="polite"
            >
              You are offline — some actions may be unavailable until the connection returns.
            </div>
          )}
          {/* Report mode only. Gated on the loaded state — while /me is in
              flight `permissions` is still [], so every gated route would read
              as denied and flash a false warning on each reload. */}
          {!GUARD_ENFORCE && !loading && !error && !routeGuardReport.ok && (
            <div
              className="border-b border-status-warn bg-status-warn-soft px-4 py-2 text-center text-xs font-medium text-status-warn"
              role="status"
              aria-live="polite"
            >
              {!routeGuardReport.registered
                ? `Route registry: ${routeGuardReport.pathname} is not registered (belum_terdaftar).`
                : `Route registry: ${routeGuardReport.pathname} needs one of ${routeGuardReport.missingPermissions.join(", ")}.`}{" "}
              Report only — the page still renders.
            </div>
          )}
        </div>

        <main id="main-content" tabIndex={-1} className="min-w-0 flex-1 p-4 focus:outline-hidden sm:p-6">
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
            ) : guardBlocks ? (
              /* §4.3 "Penjelasan saat alamat dibuka langsung". Three causes,
                 three explanations, because they ask different things of the
                 user: an inactive module is a tenant decision ("ask them to
                 turn it on"), a missing right is an administrator decision
                 ("ask for access"), an unknown address is neither ("check the
                 address"). Reporting an inactive module as a permission
                 problem would send the user to the wrong person. Copy is in
                 the shell's language; the roadmap states the meaning, not the
                 literal string. No silent redirect to Overview: the user
                 chooses to go there. */
              <div className="mx-auto max-w-xl space-y-3 py-8 text-center">
                <h1 className="text-lg font-semibold text-ink">
                  {moduleInactive
                    ? "This module is not active for your tenant."
                    : routeGuardReport.registered
                      ? "You do not have access to this page."
                      : "Page not found."}
                </h1>
                <p className="text-sm text-ink-dim">
                  {moduleInactive
                    ? `${routeGuardReport.pathname} belongs to the ${routeGuardReport.entry?.moduleCode} module, which is turned off for your tenant. Ask your tenant administrator to activate it.`
                    : routeGuardReport.registered
                      ? `${routeGuardReport.pathname} requires one of: ${routeGuardReport.missingPermissions.join(", ")}. Ask your tenant administrator for access.`
                      : `The address ${routeGuardReport.pathname} is not part of this application.`}
                </p>
                <Button variant="secondary" onClick={() => navigate("/")}>
                  Back to Overview
                </Button>
              </div>
            ) : (
              <ShellContext.Provider
                value={{
                  permissions,
                  scopeTypes,
                  activeModuleCodes,
                  navGroups: groups,
                  userId: session!.userId,
                  tenantName,
                  setTenantName,
                }}
              >
                <Outlet />
              </ShellContext.Provider>
            )}
          </div>
        </main>
      </div>

      {/* Epic 1 (§4.1 C): switching the session's active Role. Rendered once
          at the shell level so every UserMenu instance (desktop sidebar,
          mobile drawer, header) opens the same dialog. Recording the new
          assignmentId re-runs `load` above, which is what refreshes the
          permission set, the served menu and the scope label. */}
      <SwitchRoleDialog
        open={switchRoleOpen}
        token={token}
        currentAssignmentId={assignmentId}
        onClose={() => setSwitchRoleOpen(false)}
        onSwitched={(patch) => updateSession(patch)}
      />
    </div>
  );
}
