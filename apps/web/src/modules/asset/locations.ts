/**
 * Phase 5 — location catalogue for the Asset surfaces.
 *
 * Asset owns no site or project master (§28): both come from the existing
 * Customer & Commercial hierarchy. The backend lists them per customer, so
 * this resolves the full catalogue ONCE per screen — the movement pickers
 * and the history labels then read from that single copy instead of issuing
 * a lookup per row.
 *
 * Every call is best-effort: a user who holds only asset permissions may be
 * denied the customer surface entirely, in which case the pickers are empty
 * and the register still works.
 */
import { api, type ProjectRecord, type SiteRecord } from "../../lib/api";

export interface LocationCatalogue {
  sites: SiteRecord[];
  projects: ProjectRecord[];
}

export async function loadLocationCatalogue(token: string): Promise<LocationCatalogue> {
  const customers = await api.customers(token).catch(() => []);
  if (customers.length === 0) return { sites: [], projects: [] };

  const perCustomer = await Promise.all(
    customers.map(async (customer) => {
      const [sites, projects] = await Promise.all([
        api.sitesForCustomer(token, customer.id).catch(() => [] as SiteRecord[]),
        api.projectsForCustomer(token, customer.id).catch(() => [] as ProjectRecord[]),
      ]);
      return { sites, projects };
    }),
  );

  const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name);
  return {
    sites: perCustomer.flatMap((r) => r.sites).sort(byName),
    projects: perCustomer.flatMap((r) => r.projects).sort(byName),
  };
}
