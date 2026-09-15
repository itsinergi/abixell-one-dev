/**
 * Checkpoint 1C.1 — Overview (workspace landing).
 *
 * A real page (no mock data): it reflects the signed-in user's actual
 * Tenant and granted capabilities, and links only to the sections that
 * user may see. It is the neutral entry point every persona lands on.
 */
import { Link } from "react-router-dom";
import { useShell } from "../shell/layout/AppShell";
import { visibleSectionGroups } from "../lib/capabilities";
import { EmptyState, PageHeader } from "../shell/components/ui";

export function OverviewPage() {
  const { permissions, scopeTypes, activeModuleCodes, tenantName } = useShell();
  const groups = visibleSectionGroups(permissions, scopeTypes, activeModuleCodes)
    .map((group) => ({
      ...group,
      sections: group.sections.filter((section) => section.key !== "overview"),
    }))
    .filter((group) => group.sections.length > 0);

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
                {group.sections.map((section) => (
                  <Link
                    key={section.key}
                    to={section.path}
                    className="group flex min-h-[112px] flex-col rounded-lg border border-slate-200 bg-white p-4 transition-colors hover:border-slate-300 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400 focus-visible:ring-offset-2"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <h3 className="text-sm font-semibold text-slate-900">{section.label}</h3>
                      <span
                        aria-hidden="true"
                        className="text-slate-300 transition-transform group-hover:translate-x-0.5 group-hover:text-slate-500"
                      >
                        →
                      </span>
                    </div>
                    <p className="mt-1 text-sm leading-5 text-slate-500">{section.description}</p>
                  </Link>
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
