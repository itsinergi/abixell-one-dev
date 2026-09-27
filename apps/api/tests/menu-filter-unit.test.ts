/**
 * Epic 3 Wave 2 — the filter rule itself (CORE-ROADMAP.md §4.3 step 7).
 *
 * menu-filter.test.ts proves the rule through `GET /me`; this file proves the
 * rule alone. The two are not duplicates: the integration test can only
 * observe the seeded catalogue, so the cases that matter here — a menu with no
 * permission requirement, a group all of whose children die, a caller with a
 * partial scope list — are pinned directly against the pure function.
 */
import { describe, expect, it } from "vitest";
import { filterMenuForCaller, isExternalCaller } from "../src/domain/configuration/menu-filter.js";
import type { MenuNode } from "../src/domain/configuration/app-metadata.entity.js";

function page(overrides: Partial<MenuNode> & { code: string }): MenuNode {
  return {
    name: overrides.code,
    isSummary: false,
    isExternalAllowed: false,
    requiredPermissions: [],
    seqNo: 0,
    children: [],
    ...overrides,
  };
}

function folder(code: string, children: MenuNode[], overrides: Partial<MenuNode> = {}): MenuNode {
  return page({ code, isSummary: true, ...overrides, children });
}

const INTERNAL = ["tenant"];
const EXTERNAL = ["customer"];
const ALL_MODULES = [
  "customer_complaint",
  "workforce",
  "finance",
  "hse",
  "platform",
];

describe("isExternalCaller", () => {
  it("treats an explicit internal Data Scope as internal", () => {
    expect(isExternalCaller(["tenant"])).toBe(false);
    expect(isExternalCaller(["organization_unit"])).toBe(false);
    expect(isExternalCaller(["customer", "organization_unit"])).toBe(false);
  });

  it("treats anything else — including nothing at all — as external", () => {
    // Default closed: a caller the server cannot place inside the tenant gets
    // the narrow view, not the wide one.
    expect(isExternalCaller(["customer"])).toBe(true);
    expect(isExternalCaller([])).toBe(true);
    expect(isExternalCaller(["something_new"])).toBe(true);
  });
});

describe("step order: whitelist → module → role", () => {
  // The group carries the whitelist flag too, exactly as the seed writes it:
  // a whitelisted page behind a closed container is unreachable, so the seed
  // opens the container whenever it opens a descendant.
  const catalogue = [
    folder(
      "nav-operations",
      [
        page({ code: "nav-overview", isExternalAllowed: true }),
        page({
          code: "nav-internal",
          isExternalAllowed: false,
          path: "/internal",
          requiredPermissions: ["internal.read"],
        }),
      ],
      { isExternalAllowed: true },
    ),
  ];

  it("removes an unwhitelisted menu for an external caller rather than locking it", () => {
    const [group] = filterMenuForCaller(catalogue, {
      permissions: ["internal.read"],
      scopeTypes: EXTERNAL,
      activeModuleCodes: ALL_MODULES,
    });
    const codes = group.children.map((child) => child.code);
    // The caller HOLDS the permission, so the role step would have opened it.
    // It is absent anyway — which is what proves step 1 runs first.
    expect(codes).toEqual(["nav-overview"]);
  });

  it("keeps the same menu for an internal caller, open, on the same permission", () => {
    const [group] = filterMenuForCaller(catalogue, {
      permissions: ["internal.read"],
      scopeTypes: INTERNAL,
      activeModuleCodes: ALL_MODULES,
    });
    expect(group.children.map((child) => child.code)).toEqual(["nav-overview", "nav-internal"]);
    expect(group.children[1].locked).toBe(false);
  });
});

describe("module status", () => {
  it("drops the module's menus for everyone when it is inactive", () => {
    const catalogue = [
      folder("nav-workforce", [page({ code: "nav-payroll", moduleCode: "workforce" })], {
        moduleCode: "workforce",
      }),
    ];
    const active = filterMenuForCaller(catalogue, {
      permissions: [],
      scopeTypes: INTERNAL,
      activeModuleCodes: ALL_MODULES,
    });
    const inactive = filterMenuForCaller(catalogue, {
      permissions: [],
      scopeTypes: INTERNAL,
      activeModuleCodes: ALL_MODULES.filter((code) => code !== "workforce"),
    });
    expect(active).toHaveLength(1);
    expect(inactive).toEqual([]);
  });

  it("keeps a module-less group while it still has a module-less page", () => {
    // The seeded groups carry no module, which is why Overview survives a
    // tenant that has switched every module off.
    const catalogue = [folder("nav-operations", [page({ code: "nav-overview" })])];
    expect(
      filterMenuForCaller(catalogue, {
        permissions: [],
        scopeTypes: INTERNAL,
        activeModuleCodes: [],
      }),
    ).toHaveLength(1);
  });
});

describe("role rights", () => {
  const catalogue = [
    folder("nav-hse", [
      page({ code: "nav-hse-home", moduleCode: "hse", requiredPermissions: ["hse.read"] }),
      page({
        code: "nav-hse-report",
        moduleCode: "hse",
        requiredPermissions: ["hse.report", "hse.manage"],
      }),
      page({ code: "nav-hse-open", moduleCode: "hse" }),
    ]),
  ];
  const base = { scopeTypes: INTERNAL, activeModuleCodes: ALL_MODULES };

  it('locks a page the role cannot open, with the codes it would need ("any of")', () => {
    const [group] = filterMenuForCaller(catalogue, { ...base, permissions: ["hse.read"] });
    const byCode = new Map(group.children.map((child) => [child.code, child]));
    expect(byCode.get("nav-hse-home")?.locked).toBe(false);
    expect(byCode.get("nav-hse-report")?.locked).toBe(true);
    expect(byCode.get("nav-hse-report")?.lockedReason).toBe(
      "Requires one of: hse.report, hse.manage",
    );
  });

  it("unlocks on any ONE of the required codes", () => {
    const [group] = filterMenuForCaller(catalogue, { ...base, permissions: ["hse.manage"] });
    const report = group.children.find((child) => child.code === "nav-hse-report");
    expect(report?.locked).toBe(false);
  });

  it("never locks a page that requires no permission", () => {
    const [group] = filterMenuForCaller(catalogue, { ...base, permissions: [] });
    const open = group.children.find((child) => child.code === "nav-hse-open");
    expect(open?.locked).toBe(false);
    // …while its siblings, which do require one, are locked.
    expect(group.children.filter((child) => child.locked).map((c) => c.code)).toEqual([
      "nav-hse-home",
      "nav-hse-report",
    ]);
  });

  it("leaves a locked page in place — the state is the point of the rule", () => {
    const [group] = filterMenuForCaller(catalogue, { ...base, permissions: [] });
    expect(group.children).toHaveLength(3);
  });
});

describe("containers", () => {
  it("drops a folder once nothing survives beneath it, at every level", () => {
    const catalogue = [
      folder("nav-group", [
        folder("nav-module", [
          page({ code: "nav-gone", moduleCode: "finance", requiredPermissions: [] }),
        ]),
      ]),
    ];
    const result = filterMenuForCaller(catalogue, {
      permissions: [],
      scopeTypes: INTERNAL,
      activeModuleCodes: ALL_MODULES.filter((code) => code !== "finance"),
    });
    expect(result).toEqual([]);
  });

  it("marks folders as unlocked, so the shell never renders a disabled folder", () => {
    const catalogue = [folder("nav-group", [page({ code: "nav-page" })])];
    const [group] = filterMenuForCaller(catalogue, {
      permissions: [],
      scopeTypes: INTERNAL,
      activeModuleCodes: ALL_MODULES,
    });
    expect(group.locked).toBe(false);
  });
});
