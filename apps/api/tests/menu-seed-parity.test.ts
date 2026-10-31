/**
 * Epic 3 Wave 1 — menu catalogue parity (CORE-ROADMAP.md §4.3 step 5).
 *
 * "Memeriksa hasilnya terhadap menu hari ini: daftar menu harus sama persis
 * sebelum ada penyesuaian baru. Ini titik pembuktian bahwa pemindahan tidak
 * menghilangkan apa pun."
 *
 * The seed migration holds a snapshot of a derivation: the navigation tree
 * today comes from `NAV_GROUPS` / `MODULE_METADATA` / `NAV_SECTIONS` in
 * apps/web/src/lib/capabilities.ts, and the migration transcribed that
 * structure into `app_menus` + `app_menu_tree`. Nothing in the build forces
 * the transcription to stay true. A section added to capabilities without
 * re-running the seed, a module label changed on one side only, or a leaf
 * hung under the wrong folder all look fine from the outside — the menu the
 * server serves would simply describe an application that no longer exists.
 *
 * It does NOT read the migration file. Reading the file would only prove the
 * file agrees with itself. It re-derives the expected tree from the browser's
 * own source (the two registries are plain data with no React dependency, so
 * one test can import both sides) and compares against what the seed actually
 * wrote for a freshly bootstrapped tenant — exercising the trigger path, not
 * just the backfill.
 *
 * Order is compared, not just membership: §4.3 lists "salah urutan" as one of
 * the ways a menu migration silently changes behaviour.
 *
 * Wave 2 note: `/me` now filters the catalogue per caller, so this test
 * activates every module for its fixture tenant and uses the ADMIN role, which
 * holds every permission. Both filter steps that can remove something are
 * therefore satisfied and the served tree IS the whole catalogue again — the
 * parity claim stays about the seed, which is what it was written to check.
 * That the filter itself works is proved separately, with restricted callers,
 * in menu-filter.test.ts.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { pool } from "../src/infrastructure/persistence/db.js";
import type { MenuNode } from "../src/domain/configuration/app-metadata.entity.js";
import { MODULE_METADATA, NAV_GROUPS, NAV_SECTIONS } from "../../web/src/lib/capabilities.js";
import {
  activateAllModules,
  bootstrapTenant,
  authHeader,
  login,
  provisionFirstAdmin,
} from "./integration/helpers.js";

const TENANT_CODE = `test-menu-parity-${Date.now()}`;
const ADMIN_EMAIL = `menu-parity-${Date.now()}@example.test`;
const ADMIN_PASSWORD = "Parity-Check-1!";

/** Every menu code the derivation expects for one section. */
function pageCodes(): string[] {
  return NAV_SECTIONS.map((section) =>
    section.moduleCode ? `nav-${section.moduleCode}-${section.key}` : `nav-${section.key}`,
  );
}

describe("Epic 3 Wave 1 — menu catalogue parity", () => {
  let tenantId: string;
  let servedMenu: MenuNode[];

  beforeAll(async () => {
    const app = buildApp();
    const tenant = await bootstrapTenant(app, TENANT_CODE, "Test Tenant Menu Parity");
    tenantId = tenant.id;
    await provisionFirstAdmin({
      tenantId,
      email: ADMIN_EMAIL,
      password: ADMIN_PASSWORD,
    });
    // Module activation is not seeded (scripts/seed.ts), and an inactive
    // module is removed by the server filter's step 2 — so without this the
    // served tree would be empty and every assertion below would fail for a
    // reason that has nothing to do with the seed this test guards.
    await activateAllModules(tenantId);

    // Read the served tree the way the shell does — through `GET /me` — so
    // the test covers the route, the service and the repository together,
    // not the repository alone.
    const session = await login(app, TENANT_CODE, ADMIN_EMAIL, ADMIN_PASSWORD);
    if (session.statusCode !== 200 || !("accessToken" in session.body)) {
      throw new Error(`login failed: ${session.statusCode} ${JSON.stringify(session.body)}`);
    }
    const me = await app.inject({
      method: "GET",
      url: "/me",
      headers: authHeader(session.body.accessToken),
    });
    if (me.statusCode !== 200) throw new Error(`/me failed: ${me.statusCode} ${me.body}`);
    servedMenu = me.json().menu as MenuNode[];

    await app.close();
  });

  afterAll(async () => {
    await pool.query(`DELETE FROM tenants WHERE id = $1`, [tenantId]);
  });

  function flatten(nodes: MenuNode[]): MenuNode[] {
    return nodes.flatMap((node) => [node, ...flatten(node.children)]);
  }

  it("serves the same number of groups the navigation declares", () => {
    expect(servedMenu.map((group) => group.name)).toEqual(
      NAV_GROUPS.map((group) => group.label),
    );
  });

  it("serves every section as exactly one page, and invents none", () => {
    const served = flatten(servedMenu)
      .filter((node) => !node.isSummary)
      .map((node) => node.code)
      .sort();
    const expected = pageCodes().sort();
    const missing = expected.filter((code) => !served.includes(code));
    const extra = served.filter((code) => !expected.includes(code));
    expect(missing, `sections with no served menu: ${missing.join(", ")}`).toEqual([]);
    expect(extra, `served pages with no section: ${extra.join(", ")}`).toEqual([]);
  });

  it("serves every section at its declared route", () => {
    const pathByCode = new Map(
      flatten(servedMenu)
        .filter((node) => !node.isSummary)
        .map((node) => [node.code, node.path]),
    );
    const wrong = NAV_SECTIONS.map((section) => {
      const code = section.moduleCode
        ? `nav-${section.moduleCode}-${section.key}`
        : `nav-${section.key}`;
      return { code, expected: section.path, actual: pathByCode.get(code) };
    })
      .filter((row) => row.expected !== row.actual)
      .map((row) => `${row.code}: expected ${row.expected}, served ${row.actual}`);
    expect(wrong, wrong.join("\n")).toEqual([]);
  });

  it("hangs every page under its module folder, in section order", () => {
    // Re-derivation, not a re-read: the expected grouping comes from the code
    // that renders today's navigation, the actual grouping from the seed.
    const expected = NAV_GROUPS.map((group) => ({
      group: group.label,
      // Standalone sections are direct children; module sections collapse
      // into one folder per module, in first-appearance order, and the
      // sections inside each folder keep their declared order.
      children: NAV_SECTIONS.filter((section) => section.group === group.key)
        .reduce<string[]>((codes, section) => {
          const folder = section.moduleCode
            ? `nav-${section.moduleCode}`
            : `nav-${section.key}`;
          return codes.includes(folder) ? codes : [...codes, folder];
        }, []),
    }));

    const actual = servedMenu.map((group) => ({
      group: group.name,
      children: group.children.map((child) => child.code),
    }));

    expect(actual).toEqual(expected);
  });

  it("labels every module folder the way the module catalogue does", () => {
    const folderLabels = new Map(
      servedMenu.flatMap((group) =>
        group.children
          .filter((child) => child.isSummary && child.moduleCode)
          .map((child) => [child.moduleCode as string, child.name]),
      ),
    );
    const wrong = Object.entries(MODULE_METADATA)
      .map(([code, meta]) => ({ code, expected: meta.label, actual: folderLabels.get(code) }))
      .filter((row) => row.expected !== row.actual)
      .map((row) => `${row.code}: expected ${row.expected}, served ${row.actual}`);
    expect(wrong, wrong.join("\n")).toEqual([]);
  });

  it("keeps section order inside each module folder", () => {
    const served = flatten(servedMenu)
      .filter((node) => node.isSummary && node.moduleCode)
      .map((folder) => ({
        moduleCode: folder.moduleCode as string,
        pages: folder.children.filter((child) => !child.isSummary).map((child) => child.code),
      }));
    const wrong = served
      .map((folder) => ({
        moduleCode: folder.moduleCode,
        expected: NAV_SECTIONS.filter((section) => section.moduleCode === folder.moduleCode).map(
          (section) => `nav-${section.moduleCode}-${section.key}`,
        ),
        actual: folder.pages,
      }))
      .filter((row) => JSON.stringify(row.expected) !== JSON.stringify(row.actual))
      .map(
        (row) =>
          `${row.moduleCode}:\n  expected ${row.expected.join(", ")}\n  served   ${row.actual.join(", ")}`,
      );
    expect(wrong, wrong.join("\n")).toEqual([]);
  });

  it("never exceeds the four-level tree", () => {
    const depth = (nodes: MenuNode[], level: number): number =>
      nodes.length === 0 ? level - 1 : Math.max(...nodes.map((node) => depth(node.children, level + 1)));
    expect(depth(servedMenu, 1)).toBeLessThanOrEqual(3);
  });

  it("marks a folder as summary, and a page as not", () => {
    // A folder that claims a destination, or a page without one, would render
    // a navigation entry that cannot go anywhere.
    const wrong = flatten(servedMenu)
      .filter((node) => node.isSummary !== (node.path === undefined))
      .map((node) => `${node.code}: isSummary=${node.isSummary}, path=${node.path ?? "none"}`);
    expect(wrong, wrong.join("\n")).toEqual([]);
  });

  it("gives every page the module the derivation declares, standalone pages none", () => {
    // Three sections are standalone global links — Overview, Administration,
    // Admin Console — and the derivation marks them by omitting `moduleCode`.
    // Those hang directly under their group; every other page must sit in the
    // folder its own module names, or the tree would describe a different
    // information architecture than the one the browser renders.
    const declaredModule = new Map(
      NAV_SECTIONS.map((section) => [
        section.moduleCode ? `nav-${section.moduleCode}-${section.key}` : `nav-${section.key}`,
        section.moduleCode ?? undefined,
      ]),
    );

    const wrong = flatten(servedMenu)
      .filter((node) => !node.isSummary)
      .map((node) => ({
        code: node.code,
        expected: declaredModule.get(node.code) ?? "(standalone)",
        actual: node.moduleCode ?? "(standalone)",
      }))
      .filter((row) => row.expected !== row.actual)
      .map((row) => `${row.code}: expected ${row.expected}, served ${row.actual}`);
    expect(wrong, wrong.join("\n")).toEqual([]);

    // And the standalone set is exactly two, so a seed that dropped every
    // module link at once could not pass by declaring everything standalone.
    const standalone = flatten(servedMenu).filter((node) => !node.isSummary && !node.moduleCode);
    expect(standalone.map((node) => node.code).sort()).toEqual([
      "nav-overview",
      "nav-settings",
    ]);
  });

  it("keeps the external whitelist closed by default, and open all the way down", () => {
    // §4.3: "menu tanpa penanda tidak pernah dikirim ke user eksternal."
    // The whitelist must also hold along the path — an allowed page behind a
    // closed folder would be unreachable, so a folder must be allowed whenever
    // any descendant page is.
    const hasAllowedDescendant = (node: MenuNode): boolean =>
      node.children.some((child) => child.isExternalAllowed || hasAllowedDescendant(child));

    const closedButReachable = flatten(servedMenu)
      .filter((node) => node.isSummary && !node.isExternalAllowed && hasAllowedDescendant(node))
      .map((node) => node.code);
    expect(
      closedButReachable,
      `closed folders holding an allowed page: ${closedButReachable.join(", ")}`,
    ).toEqual([]);

    // And the whitelist is genuinely closed by default: most pages are NOT
    // external. A seed that accidentally marked everything allowed would pass
    // the check above while leaking the whole internal menu.
    const pages = flatten(servedMenu).filter((node) => !node.isSummary);
    const allowed = pages.filter((node) => node.isExternalAllowed);
    expect(allowed.length).toBeGreaterThan(0);
    expect(allowed.length).toBeLessThan(pages.length);
  });
});
