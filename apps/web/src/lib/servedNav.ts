/**
 * The shell's navigation, built from what the SERVER sent (Epic 3 Wave 2,
 * CORE-ROADMAP.md §4.3 step 7).
 *
 * Wave 1 served the menu catalogue and proved it matched the navigation of the
 * day; the shell kept rendering from `capabilities.ts` while that was checked.
 * Wave 2 switches the render source: the tree below is the filtered payload
 * from `GET /me`, so the browser no longer decides who sees what. The filter
 * (external whitelist → module status → role rights) runs on the server; this
 * module only reshapes what survived it.
 *
 * Nothing here re-derives visibility. In particular `locked` is read from the
 * payload, never computed from permissions: the server owns that decision, and
 * a second opinion in the browser is how the two drift apart.
 *
 * `capabilities.ts` keeps `NAV_SECTIONS` / `MODULE_METADATA` / `NAV_GROUPS` —
 * they are the derivation the seed migration is checked against
 * (apps/api/tests/menu-seed-parity.test.ts) — but the shell no longer renders
 * from them.
 */

import type { MenuNode } from "./api";
import { resolveNavLabel } from "../i18n/navLabels";
import type { Locale } from "../i18n/LocaleProvider";

/** One page. `locked` is the server's answer, not a local calculation. */
export interface ServedNavPage {
  type: "page";
  code: string;
  label: string;
  description?: string;
  path: string;
  locked: boolean;
  lockedReason?: string;
}

/** One module folder. `moduleCode` is the expansion key. */
export interface ServedNavModule {
  type: "module";
  moduleCode: string;
  label: string;
  pages: ServedNavPage[];
}

/** A standalone page hangs directly under the group; a module does not. */
export type ServedNavNode = ServedNavPage | ServedNavModule;

export interface ServedNavGroup {
  /** The served menu code, which is stable and unique — used for DOM ids. */
  key: string;
  label: string;
  description: string;
  nodes: ServedNavNode[];
}

function isPage(node: MenuNode): boolean {
  return !node.isSummary && node.path !== undefined;
}

/**
 * Shape the served tree for rendering. A folder with no reachable page is
 * already dropped by the server, so an empty module here means the payload was
 * malformed — skipping it keeps the shell from rendering a folder that opens
 * onto nothing.
 *
 * Labels are localized here rather than at render time, so every consumer
 * (sidebar, Overview cards, nav search) sees the same text and search matches
 * what is on screen.
 */
export function servedNavGroups(menu: MenuNode[], locale: Locale = "en"): ServedNavGroup[] {
  const label = (code: string, name: string) => resolveNavLabel(code, name, locale);
  const description = (code: string, text: string | undefined) =>
    resolveNavLabel(code, text ?? "", locale, "description");

  return menu.flatMap((group) => {
    const nodes: ServedNavNode[] = [];

    for (const child of group.children) {
      if (isPage(child)) {
        nodes.push({
          type: "page",
          code: child.code,
          label: label(child.code, child.name),
          description: description(child.code, child.description),
          path: child.path as string,
          locked: child.locked === true,
          lockedReason: child.lockedReason,
        });
        continue;
      }
      const pages = child.children.filter(isPage).map(
        (page): ServedNavPage => ({
          type: "page",
          code: page.code,
          label: label(page.code, page.name),
          description: description(page.code, page.description),
          path: page.path as string,
          locked: page.locked === true,
          lockedReason: page.lockedReason,
        }),
      );
      if (pages.length === 0) continue;
      nodes.push({
        type: "module",
        // A module folder always names its module (the seed guarantees it, and
        // the parity check asserts it); the code is the fallback so an odd row
        // still expands rather than crashing the shell.
        moduleCode: child.moduleCode ?? child.code,
        label: label(child.code, child.name),
        pages,
      });
    }

    return nodes.length === 0
      ? []
      : [
          {
            key: group.code,
            label: label(group.code, group.name),
            description: description(group.code, group.description),
            nodes,
          },
        ];
  });
}

/**
 * Every page in a group, whether it hangs directly under the group or inside a
 * module folder. Overview lists destinations, not folders, so it needs the
 * pages without the shape they arrived in.
 */
export function servedGroupPages(group: ServedNavGroup): ServedNavPage[] {
  return group.nodes.flatMap((node) => (node.type === "page" ? [node] : node.pages));
}

/** Search only already-served nodes; a module-label match retains all its pages. */
export function filterServedNav(groups: ServedNavGroup[], query: string): ServedNavGroup[] {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  if (!normalizedQuery) return groups;
  const matches = (page: ServedNavPage) =>
    `${page.label} ${page.description ?? ""}`.toLocaleLowerCase().includes(normalizedQuery);

  return groups
    .map((group) => ({
      ...group,
      nodes: group.nodes.flatMap((node): ServedNavNode[] => {
        if (node.type === "page") return matches(node) ? [node] : [];
        const pages = node.label.toLocaleLowerCase().includes(normalizedQuery)
          ? node.pages
          : node.pages.filter(matches);
        return pages.length > 0 ? [{ ...node, pages }] : [];
      }),
    }))
    .filter((group) => group.nodes.length > 0);
}

/** Same case-insensitive segment boundary as NavLink; /assets-old is not /assets. */
export function activeServedModuleCodes(groups: ServedNavGroup[], pathname: string): string[] {
  const current = pathname.toLocaleLowerCase();
  return groups.flatMap((group) =>
    group.nodes.flatMap((node) => {
      if (node.type !== "module") return [];
      return node.pages.some(({ path }) => {
        const destination = path.toLocaleLowerCase();
        return (
          current === destination ||
          (destination !== "/" && current.startsWith(`${destination}/`))
        );
      })
        ? [node.moduleCode]
        : [];
    }),
  );
}
