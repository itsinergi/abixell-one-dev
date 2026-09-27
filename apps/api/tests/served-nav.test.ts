/**
 * Epic 3 Wave 2 — the render-tree adapter (CORE-ROADMAP.md §4.3 step 7).
 *
 * `servedNav.ts` lives in apps/web because the shell imports it, but apps/web
 * has no vitest — so the test lives here, importing across workspaces the same
 * way menu-seed-parity.test.ts imports capabilities.ts. The module is plain
 * data shaping (no React, no fetch at import time), so it runs in node as-is.
 *
 * The adapter's contract is narrow on purpose: reshape the served payload,
 * never re-derive visibility. `locked` must arrive at the rendered node exactly
 * as the server decided it, and a page the server did not send must not
 * reappear from some local list — these tests pin both directions.
 */
import { describe, expect, it } from "vitest";
import {
  activeServedModuleCodes,
  filterServedNav,
  servedGroupPages,
  servedNavGroups,
  type ServedNavGroup,
} from "../../web/src/lib/servedNav.js";
import type { MenuNode } from "../src/domain/configuration/app-metadata.entity.js";

function page(overrides: Partial<MenuNode> & { code: string; path: string }): MenuNode {
  return {
    name: overrides.code,
    isSummary: false,
    isExternalAllowed: true,
    requiredPermissions: [],
    seqNo: 0,
    children: [],
    ...overrides,
  };
}

function folder(code: string, children: MenuNode[], overrides: Partial<MenuNode> = {}): MenuNode {
  return {
    code,
    name: code,
    isSummary: true,
    isExternalAllowed: true,
    requiredPermissions: [],
    seqNo: 0,
    moduleCode: undefined,
    children,
    ...overrides,
  };
}

function group(code: string, children: MenuNode[], description = `${code} description`): MenuNode {
  return { ...folder(code, children, { moduleCode: undefined }), description };
}

const MENU: MenuNode[] = [
  group("nav-operations", [
    page({ code: "nav-overview", path: "/", name: "Overview", description: "Workspace landing" }),
    folder("nav-workforce", [
      page({
        code: "nav-workforce-payroll",
        path: "/workforce/payroll",
        name: "Payroll",
        moduleCode: "workforce",
        locked: true,
        lockedReason: "Requires one of: workforce.payroll",
      }),
      page({
        code: "nav-workforce-leave",
        path: "/workforce/leave",
        name: "Leave",
        moduleCode: "workforce",
        locked: false,
      }),
    ], { moduleCode: "workforce", name: "Workforce" }),
  ]),
];

describe("servedNavGroups", () => {
  it("shapes the served tree into groups, modules and pages", () => {
    const [operations] = servedNavGroups(MENU);
    expect(operations.key).toBe("nav-operations");
    expect(operations.label).toBe("nav-operations");
    expect(operations.description).toBe("nav-operations description");

    const [overview, workforce] = operations.nodes;
    expect(overview.type).toBe("page");
    expect(overview.path).toBe("/");
    expect(workforce.type).toBe("module");
    if (workforce.type !== "module") return;
    expect(workforce.moduleCode).toBe("workforce");
    expect(workforce.pages.map((p) => p.code)).toEqual([
      "nav-workforce-payroll",
      "nav-workforce-leave",
    ]);
  });

  it("passes `locked` through from the payload, in both directions", () => {
    // Neither computed here nor lost: the adapter is a reshape, and this is
    // the state the shell's NavRow and Overview's cards key off.
    const pages = servedNavGroups(MENU).flatMap((g) => servedGroupPages(g));
    const payroll = pages.find((p) => p.code === "nav-workforce-payroll");
    const leave = pages.find((p) => p.code === "nav-workforce-leave");
    expect(payroll?.locked).toBe(true);
    expect(payroll?.lockedReason).toBe("Requires one of: workforce.payroll");
    expect(leave?.locked).toBe(false);
  });

  it("drops a module folder with no pages instead of rendering it empty", () => {
    const menu = [
      group("nav-g", [
        folder("nav-empty-module", [], { moduleCode: "finance", name: "Finance" }),
        page({ code: "nav-one", path: "/one" }),
      ]),
    ];
    const [only] = servedNavGroups(menu);
    expect(only.nodes.map((node) => node.type)).toEqual(["page"]);
  });

  it("drops a group once nothing survives beneath it", () => {
    const menu = [group("nav-g", [folder("nav-empty", [], { moduleCode: "finance" })])];
    expect(servedNavGroups(menu)).toEqual([]);
  });
});

describe("servedGroupPages", () => {
  it("lists every page in the group regardless of the node it arrived in", () => {
    const [operations] = servedNavGroups(MENU);
    expect(servedGroupPages(operations).map((p) => p.code)).toEqual([
      "nav-overview",
      "nav-workforce-payroll",
      "nav-workforce-leave",
    ]);
  });
});

describe("filterServedNav", () => {
  const groups: ServedNavGroup[] = servedNavGroups(MENU);

  it("keeps everything when the query is empty", () => {
    expect(filterServedNav(groups, "  ")).toEqual(groups);
  });

  it("keeps the pages whose label or description matches", () => {
    const [operations] = filterServedNav(groups, "payroll");
    const [workforce] = operations.nodes;
    if (workforce.type !== "module") throw new Error("expected a module node");
    expect(workforce.pages.map((p) => p.code)).toEqual(["nav-workforce-payroll"]);
  });

  it("keeps every page of a module whose label matches", () => {
    const [operations] = filterServedNav(groups, "workforce");
    const [workforce] = operations.nodes;
    if (workforce.type !== "module") throw new Error("expected a module node");
    expect(workforce.pages).toHaveLength(2);
  });

  it("drops the group when nothing in it matches", () => {
    expect(filterServedNav(groups, "no-such-area")).toEqual([]);
  });
});

describe("activeServedModuleCodes", () => {
  const groups: ServedNavGroup[] = servedNavGroups(MENU);

  it("names the module owning the active page", () => {
    expect(activeServedModuleCodes(groups, "/workforce/payroll")).toEqual(["workforce"]);
  });

  it("matches a sub-path of a served page", () => {
    expect(activeServedModuleCodes(groups, "/workforce/payroll/123")).toEqual(["workforce"]);
  });

  it("does not match a sibling that merely shares a prefix", () => {
    expect(activeServedModuleCodes(groups, "/workforce/payroll-archive")).toEqual([]);
  });

  it("returns nothing outside any served module", () => {
    expect(activeServedModuleCodes(groups, "/")).toEqual([]);
    expect(activeServedModuleCodes(groups, "/elsewhere")).toEqual([]);
  });
});
