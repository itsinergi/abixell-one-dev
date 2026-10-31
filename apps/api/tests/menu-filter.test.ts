/**
 * Epic 3 Wave 2 — the server-side menu filter (CORE-ROADMAP.md §4.3 step 7).
 *
 * "Penyaring menu di server: penanda `boleh untuk eksternal` (daftar putih
 * customer) → status modul → hak role. Default tertutup: menu tanpa penanda
 * tidak pernah dikirim ke user eksternal."
 *
 * The roadmap's own risk register asks for two pieces of evidence, and this
 * file is where both live:
 *
 *   "Test payload user eksternal memastikan menu internal tidak ada, bukan
 *    hanya disabled; test internal memastikan aturan role tetap berlaku."
 *
 * So the external assertion is not "the internal menu is locked" — it is "no
 * non-whitelisted node appears in the payload AT ALL, in ANY state". A test
 * that accepted a disabled internal menu would pass a build that leaks the
 * whole internal information architecture to a customer's browser.
 *
 * The filter is also exercised as a unit (menu-filter.test.ts); these tests go
 * through `GET /me` so the route, the service and the repository are covered
 * together — the same path the shell actually reads.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { pool } from "../src/infrastructure/persistence/db.js";
import type { MenuNode } from "../src/domain/configuration/app-metadata.entity.js";
import {
  activateAllModules,
  authHeader,
  bootstrapTenant,
  login,
  provisionExternalCustomerUser,
  provisionFirstAdmin,
  provisionInternalUser,
} from "./integration/helpers.js";

// Tenant codes are capped at 32 characters, so the distinguishing part of the
// name is short and the uniqueness comes from the run suffix.
const RUN = `${Date.now()}`.slice(-9);
/** Every module active: the filter's step 2 must not be the reason a test passes. */
const ACTIVE_TENANT = `mf-active-${RUN}`;
/** Nothing active: a tenant that has turned its modules off. */
const INACTIVE_TENANT = `mf-off-${RUN}`;

const ADMIN_PASSWORD = "Filter-Check-1!";

function flatten(nodes: MenuNode[]): MenuNode[] {
  return nodes.flatMap((node) => [node, ...flatten(node.children)]);
}

async function me(app: Awaited<ReturnType<typeof buildApp>>, tenantCode: string, email: string) {
  const session = await login(app, tenantCode, email, ADMIN_PASSWORD);
  if (session.statusCode !== 200 || !("accessToken" in session.body)) {
    throw new Error(`login failed: ${session.statusCode} ${JSON.stringify(session.body)}`);
  }
  const response = await app.inject({
    method: "GET",
    url: "/me",
    headers: authHeader(session.body.accessToken),
  });
  if (response.statusCode !== 200) {
    throw new Error(`/me failed: ${response.statusCode} ${response.body}`);
  }
  return response.json() as { menu: MenuNode[]; scopeTypes: string[] };
}

describe("Epic 3 Wave 2 — server-side menu filter", () => {
  let app: Awaited<ReturnType<typeof buildApp>>;
  const tenantIds: string[] = [];

  beforeAll(async () => {
    app = buildApp();

    const active = await bootstrapTenant(app, ACTIVE_TENANT, "Filter Active Tenant");
    tenantIds.push(active.id);
    await activateAllModules(active.id);

    const inactive = await bootstrapTenant(app, INACTIVE_TENANT, "Filter Inactive Tenant");
    tenantIds.push(inactive.id);

    await provisionFirstAdmin({
      tenantId: active.id,
      email: `filter-admin-${RUN}@example.test`,
      password: ADMIN_PASSWORD,
    });
    await provisionFirstAdmin({
      tenantId: inactive.id,
      email: `filter-inactive-admin-${RUN}@example.test`,
      password: ADMIN_PASSWORD,
    });
    // One permission only. Every other page must therefore arrive LOCKED
    // rather than absent — that is the internal half of the rule.
    await provisionInternalUser({
      tenantId: active.id,
      email: `filter-internal-${RUN}@example.test`,
      password: ADMIN_PASSWORD,
      roleCode: "COMPLAINT_READER",
      permissionCodes: ["complaint.read"],
    });
    await provisionExternalCustomerUser({
      tenantId: active.id,
      email: `filter-external-${RUN}@example.test`,
      password: ADMIN_PASSWORD,
      permissionCodes: ["complaint.read"],
    });
  });

  afterAll(async () => {
    for (const id of tenantIds) {
      await pool.query(`DELETE FROM tenants WHERE id = $1`, [id]);
    }
    await app.close();
  });

  it("sends an external user only whitelisted menus — internal ones are ABSENT, not disabled", () => {
    // The claim is about the payload, so the assertion is made over every node
    // in it, in every state. `isExternalAllowed` is the flag the filter's step
    // 1 reads, and the filter only ever keeps a flagged node for an external
    // caller — so a leak shows up here as an unflagged node that arrived.
    return me(app, ACTIVE_TENANT, `filter-external-${RUN}@example.test`).then((body) => {
      expect(body.scopeTypes).toEqual(["customer"]);

      const leaked = flatten(body.menu)
        .filter((node) => !node.isExternalAllowed)
        .map((node) => `${node.code} (${node.isSummary ? "folder" : "page"})`);
      expect(
        leaked,
        `internal menus reached an external payload: ${leaked.join(", ")}`,
      ).toEqual([]);

      const codes = flatten(body.menu).map((node) => node.code);
      // Named pages, not just a shape check: the workforce and finance
      // modules are the ones a customer has no business knowing about.
      expect(codes).not.toContain("nav-workforce");
      expect(codes).not.toContain("nav-finance");
      expect(codes).not.toContain("nav-settings");
      expect(codes).not.toContain("nav-enterprise-core");

      // And something did arrive, so an empty payload cannot pass as "clean".
      expect(codes).toContain("nav-customer_complaint-complaints");
    });
  });

  it("still applies the role rule to the menus an external user may see", () => {
    // §4.3 step 3 runs after the whitelist, so a whitelisted page whose
    // permission the caller lacks is LOCKED — the whitelist decides reach,
    // permissions decide state, and neither one replaces the other.
    return me(app, ACTIVE_TENANT, `filter-external-${RUN}@example.test`).then((body) => {
      const byCode = new Map(flatten(body.menu).map((node) => [node.code, node]));
      const mine = byCode.get("nav-customer_complaint-complaints");
      expect(mine?.locked).toBe(false);

      const notMine = byCode.get("nav-survey_assessment-my-surveys");
      expect(notMine?.locked).toBe(true);
      expect(notMine?.lockedReason).toContain("survey.respond");
    });
  });

  it("sends an internal user the whole active structure, locking only what the role cannot open", async () => {
    const body = await me(app, ACTIVE_TENANT, `filter-internal-${RUN}@example.test`);
    expect(body.scopeTypes).toEqual(["tenant"]);

    const byCode = new Map(flatten(body.menu).map((node) => [node.code, node]));

    // Present, and open: the one page the role can actually reach.
    const mine = byCode.get("nav-customer_complaint-complaints");
    expect(mine).toBeDefined();
    expect(mine?.locked).toBe(false);

    // Present, and locked with a reason: an internal role sees that the
    // function exists and what to ask for, instead of a menu that silently
    // is not there.
    const other = byCode.get("nav-workforce-workforce-payroll");
    expect(other).toBeDefined();
    expect(other?.locked).toBe(true);
    expect(other?.lockedReason).toContain("workforce.payroll");

    // A page with no permission requirement is never locked.
    expect(byCode.get("nav-overview")?.locked).toBe(false);
  });

  it("hides an inactive module's menus from an internal user instead of locking them", async () => {
    // The second cause, second effect: inactivity is a tenant decision, so
    // there is nothing for the user to ask for and nothing to show.
    const body = await me(app, INACTIVE_TENANT, `filter-inactive-admin-${RUN}@example.test`);
    const codes = flatten(body.menu).map((node) => node.code);

    expect(codes).not.toContain("nav-workforce-workforce-payroll");
    expect(codes).not.toContain("nav-workforce");
    expect(codes).not.toContain("nav-finance");

    // The platform pages carry no module (`app_menus.module_id IS NULL`), so
    // turning every module off still leaves a usable workspace: Overview.
    expect(codes).toContain("nav-overview");
  });

  it("drops a group once nothing survives beneath it", async () => {
    // A group is a container, not an entry. Leaving `nav-enterprise-core` in
    // the payload with no children would render an expandable section that
    // opens onto nothing.
    const body = await me(app, INACTIVE_TENANT, `filter-inactive-admin-${RUN}@example.test`);
    const groups = body.menu.map((group) => group.code);

    // Enterprise Core is built entirely from module folders, so every child
    // dies and the group goes with them. Operations and Governance each hold a
    // module-less platform page (Overview; Administration and Admin Console),
    // so they survive with exactly those.
    expect(groups).toEqual(["nav-operations", "nav-governance"]);

    const emptyContainers = flatten(body.menu)
      .filter((node) => node.isSummary && node.children.length === 0)
      .map((node) => node.code);
    expect(
      emptyContainers,
      `folders served with no reachable child: ${emptyContainers.join(", ")}`,
    ).toEqual([]);
  });
});
