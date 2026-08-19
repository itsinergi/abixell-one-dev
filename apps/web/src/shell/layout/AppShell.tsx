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
 *  - Render a responsive, capability-gated navigation (persistent sidebar
 *    on desktop, a collapsible drawer on mobile).
 *  - Own the workspace header (title + signed-in user + sign out).
 *  - Render the active section through <Outlet/>.
 *
 * Navigation is capability-gated for UX only — see capabilities.ts. All
 * authorization remains backend-enforced.
 */
import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { NavLink, Outlet } from "react-router-dom";
import { useAuth } from "../../auth/AuthContext";
import { api, ApiError } from "../../lib/api";
import { visibleSections } from "../../lib/capabilities";
import { Alert, Button, Spinner } from "../components/ui";

interface ShellContextValue {
  /** Raw permission codes from `GET /me`. */
  permissions: string[];
  /** Data-Scope types the actor holds (customer / organization_unit / tenant). */
  scopeTypes: string[];
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

export function AppShell() {
  const { session, logout } = useAuth();
  const token = session!.accessToken;

  const [permissions, setPermissions] = useState<string[]>([]);
  const [scopeTypes, setScopeTypes] = useState<string[]>([]);
  const [tenantName, setTenantName] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      // `/me` (permissions) is required — it drives the whole navigation.
      const me = await api.me(token);
      setPermissions(me.permissions);
      setScopeTypes(me.scopeTypes);
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

  const sections = visibleSections(permissions, scopeTypes);
  // Client-neutral fallback while the Tenant name loads (ADR-0003).
  const workspaceTitle = tenantName || "Enterprise Management System";

  const navLinks = (
    <nav className="flex flex-col gap-0.5 text-sm">
      {sections.map((s) => (
        <NavLink
          key={s.key}
          to={s.path}
          end={s.path === "/"}
          onClick={() => setMobileNavOpen(false)}
          className={({ isActive }) =>
            `rounded px-3 py-2 transition-colors ${
              isActive
                ? "bg-slate-900 font-medium text-white"
                : "text-slate-600 hover:bg-slate-100"
            }`
          }
        >
          {s.label}
        </NavLink>
      ))}
    </nav>
  );

  return (
    <div className="flex min-h-screen flex-col bg-slate-50 text-slate-900 md:flex-row">
      {/* Mobile top bar */}
      <header className="flex items-center justify-between border-b border-slate-200 bg-white px-4 py-3 md:hidden">
        <span className="truncate text-sm font-semibold text-slate-700">{workspaceTitle}</span>
        <Button
          variant="secondary"
          aria-expanded={mobileNavOpen}
          aria-label="Toggle navigation"
          onClick={() => setMobileNavOpen((v) => !v)}
        >
          Menu
        </Button>
      </header>

      {/* Sidebar (desktop) / drawer (mobile) */}
      <aside
        className={`w-full shrink-0 border-slate-200 bg-white md:block md:w-60 md:border-r ${
          mobileNavOpen ? "block border-b" : "hidden"
        }`}
      >
        <div className="hidden px-4 py-4 md:block">
          <div className="truncate text-sm font-semibold text-slate-700">{workspaceTitle}</div>
          <div className="mt-0.5 truncate text-xs text-slate-400">Signed in as {session!.userId}</div>
        </div>
        <div className="px-2 pb-3 md:pb-4">{navLinks}</div>
      </aside>

      {/* Main content region */}
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="hidden items-center justify-end border-b border-slate-200 bg-white px-6 py-2 md:flex">
          <span className="mr-3 text-xs text-slate-400">{session!.userId}</span>
          <Button variant="secondary" onClick={logout}>
            Sign out
          </Button>
        </div>
        <main className="min-w-0 flex-1 p-4 sm:p-6">
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
              value={{ permissions, scopeTypes, userId: session!.userId, tenantName }}
            >
              <Outlet />
              {/* Sign out is also reachable on mobile from the bottom of content. */}
              <div className="mt-8 md:hidden">
                <Button variant="secondary" onClick={logout}>
                  Sign out
                </Button>
              </div>
            </ShellContext.Provider>
          )}
        </main>
      </div>
    </div>
  );
}
