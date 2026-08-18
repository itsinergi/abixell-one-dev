import type { PropsWithChildren } from "react";

/**
 * Application Shell — Checkpoint 0A skeleton.
 *
 * Per 08-Application-Shell-Design-System-Foundation.md this shell is the
 * SAME structure for every Tenant/client. What differs per Tenant (active
 * modules in Navigation, Dashboard widgets, branding) comes from the
 * Configuration Engine (Checkpoint 0C onward) — never a separate build.
 *
 * Regions: Navigation, Dashboard, Workspace, Module, Transaction, Approval,
 * Reporting, Administration. Only Navigation + a placeholder content area
 * exist at Checkpoint 0A; the rest are filled in as their foundations land.
 */
export function ApplicationShell({ children }: PropsWithChildren) {
  return (
    <div className="flex min-h-screen bg-slate-50 text-slate-900">
      <aside className="w-60 shrink-0 border-r border-slate-200 bg-white">
        <div className="px-4 py-4 text-sm font-semibold text-slate-500">
          {/* Application name is Tenant Branding Configuration, not hardcoded. */}
          Enterprise Management System
        </div>
        <nav className="px-2 text-sm text-slate-600">
          <div className="rounded px-2 py-1.5">Dashboard</div>
          <div className="rounded px-2 py-1.5 text-slate-400">
            Workspace (Checkpoint 0B+)
          </div>
          <div className="rounded px-2 py-1.5 text-slate-400">
            Administration (Checkpoint 0C+)
          </div>
        </nav>
      </aside>
      <main className="flex-1 p-6">{children}</main>
    </div>
  );
}
