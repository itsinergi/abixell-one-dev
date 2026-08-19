/**
 * Checkpoint 1C.1 — Overview (workspace landing).
 *
 * A real page (no mock data): it reflects the signed-in user's actual
 * Tenant and granted capabilities, and links only to the sections that
 * user may see. It is the neutral entry point every persona lands on.
 */
import { Link } from "react-router-dom";
import { useShell } from "../shell/layout/AppShell";
import { visibleSections } from "../lib/capabilities";
import { Card, PageHeader, StatusPill } from "../shell/components/ui";

export function OverviewPage() {
  const { permissions, tenantName } = useShell();
  // Everything except Overview itself, in nav order.
  const sections = visibleSections(permissions).filter((s) => s.key !== "overview");

  return (
    <div>
      <PageHeader
        title={`Welcome to ${tenantName || "your workspace"}`}
        subtitle="Choose an area to continue. You only see the sections your access allows."
      />

      {sections.length === 0 ? (
        <Card>
          <p className="text-sm text-slate-600">
            You are signed in, but no work areas are currently available to your account.
            Please contact your administrator if you expect access to more.
          </p>
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {sections.map((s) => (
            <Link
              key={s.key}
              to={s.path}
              className="block rounded-lg border border-slate-200 bg-white p-4 transition-colors hover:border-slate-300 hover:bg-slate-50"
            >
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-semibold text-slate-900">{s.label}</h2>
                <StatusPill tone="info">Available</StatusPill>
              </div>
              <p className="mt-1 text-sm text-slate-500">{s.description}</p>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
