/**
 * Checkpoint 1C.1 — Overview (workspace landing).
 *
 * A real page (no mock data): it reflects the signed-in user's actual
 * Tenant and the destinations the SERVER said that user may reach.
 *
 * Epic 3 Wave 2 — the cards are built from the served menu (§4.3 step 7), the
 * same payload the sidebar renders from. Before this, the page re-derived its
 * areas from `capabilities.ts`, which made it the one place a page could list
 * an area the server had already filtered out — an external Customer User
 * would have been shown a card for an internal module. There is one source of
 * truth now, and it is the server's.
 *
 * A locked page is listed but not linked, matching the sidebar (§4.3 step 6):
 * a role that cannot open something should still see that it exists and what
 * to ask an administrator for. A card that promised a destination and then
 * denied it would be the worse version of the same information.
 */
import { Link } from "react-router-dom";
import { useShell } from "../shell/layout/AppShell";
import { servedGroupPages } from "../lib/servedNav";
import { EmptyState, PageHeader } from "../shell/components/ui";

export function OverviewPage() {
  const { navGroups, tenantName } = useShell();

  // The landing page does not list itself, and a group whose only served page
  // is Overview has nothing to offer — dropping it keeps the page from
  // rendering a heading over an empty grid.
  const groups = navGroups
    .map((group) => ({
      ...group,
      pages: servedGroupPages(group).filter((page) => page.path !== "/"),
    }))
    .filter((group) => group.pages.length > 0);

  return (
    <div>
      <PageHeader
        title={`Welcome to ${tenantName || "your workspace"}`}
        subtitle="Choose an area to continue. You only see the sections your access allows."
      />

      {groups.length === 0 ? (
        <EmptyState
          title="No work areas available"
          description="You are signed in, but no destination is currently available to your account. Contact your administrator if you expect additional access."
        />
      ) : (
        <div className="space-y-8">
          {groups.map((group) => (
            <section key={group.key} aria-labelledby={`overview-${group.key}`}>
              <div className="mb-3">
                <h2 id={`overview-${group.key}`} className="text-sm font-semibold text-slate-900">
                  {group.label}
                </h2>
                <p className="mt-0.5 text-sm text-slate-500">{group.description}</p>
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {group.pages.map((page) =>
                  page.locked ? (
                    <div
                      key={page.code}
                      aria-disabled="true"
                      data-overview-locked={page.code}
                      className="flex min-h-[112px] flex-col rounded-lg border border-dashed border-slate-200 bg-slate-50 p-4"
                    >
                      <h3 className="text-sm font-semibold text-slate-400">{page.label}</h3>
                      <p className="mt-1 text-sm leading-5 text-slate-400">
                        {page.lockedReason ?? "You do not have access to this area."}
                      </p>
                    </div>
                  ) : (
                    <Link
                      key={page.code}
                      to={page.path}
                      className="group flex min-h-[112px] flex-col rounded-lg border border-slate-200 bg-white p-4 transition-colors hover:border-slate-300 hover:bg-slate-50 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-slate-400 focus-visible:ring-offset-2"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <h3 className="text-sm font-semibold text-slate-900">{page.label}</h3>
                        <span
                          aria-hidden="true"
                          className="text-slate-300 transition-transform group-hover:translate-x-0.5 group-hover:text-slate-500"
                        >
                          →
                        </span>
                      </div>
                      <p className="mt-1 text-sm leading-5 text-slate-500">{page.description}</p>
                    </Link>
                  ),
                )}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
