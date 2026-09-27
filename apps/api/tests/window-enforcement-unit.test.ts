/**
 * Epic 4 Wave 1 — Window read-only rule, unit matrix (CORE-ROADMAP.md §4.4
 * step 11b).
 *
 * The wiring is proved against a real app in window-enforcement.test.ts and
 * window-enforcement-coverage.test.ts. This file pins the decision rule alone,
 * with no database and no HTTP, so a failure here says the RULE is wrong rather
 * than "the hook did not run".
 */
import { describe, expect, it } from "vitest";
import {
  evaluateWindowWriteAccess,
  registerServedMutatingRoute,
  resolveWindowForApiPath,
  WINDOW_ENFORCEMENT_EXEMPTIONS,
  WINDOW_READ_ONLY_REASON,
  WINDOW_RULES,
  windowAccountability,
  windowEnforcementStatus,
  windowsWithEnforcement,
} from "../src/domain/configuration/window-enforcement.js";
import { resolveRouteEntry } from "../src/domain/configuration/route-registry.js";

const CONFIGURED_READ_ONLY = { configured: true, writable: false };
const CONFIGURED_WRITABLE = { configured: true, writable: true };
const NOT_CONFIGURED = { configured: false, writable: false };

describe("resolveWindowForApiPath — attribution", () => {
  it("resolves an exact path", () => {
    expect(resolveWindowForApiPath("POST", "/wms/warehouses")).toBe("route:/wms/warehouses");
  });

  it("resolves a sub-path of the rule's prefix", () => {
    expect(resolveWindowForApiPath("PATCH", "/wms/warehouses/abc/status")).toBe(
      "route:/wms/warehouses",
    );
  });

  it("returns undefined when no rule claims the path", () => {
    expect(resolveWindowForApiPath("POST", "/definitely/not/mapped")).toBeUndefined();
  });

  it("matches on a segment boundary, never on a name prefix", () => {
    // `/assets-archive` is not the `/assets` subtree. A naive startsWith would
    // fold an unrelated route into the assets Window and lock it by accident.
    expect(resolveWindowForApiPath("POST", "/assets-archive")).toBeUndefined();
    expect(resolveWindowForApiPath("POST", "/assets")).toBe("route:/assets");
  });

  it("is case-insensitive on the method and exact on the path", () => {
    expect(resolveWindowForApiPath("post", "/hse/records")).toBe("route:/hse/report");
    expect(resolveWindowForApiPath("POST", "/HSE/records")).toBeUndefined();
  });

  it("lets the longest pattern win: a sub-resource beats its parent", () => {
    // `/assets/schedules` is the maintenance Window, `/assets/:id` the asset
    // detail. Neither derives from the other by string rule; the longer literal
    // is what separates them.
    expect(resolveWindowForApiPath("POST", "/assets/schedules")).toBe(
      "route:/asset-maintenance",
    );
    expect(resolveWindowForApiPath("POST", "/assets/:id")).toBe("route:/assets/:assetId");
    expect(resolveWindowForApiPath("POST", "/assets")).toBe("route:/assets");
  });

  it("breaks a same-length tie in favour of the exact method", () => {
    // `POST /hse/records` is the report form; `/hse` is the module read surface.
    expect(resolveWindowForApiPath("POST", "/hse/records")).toBe("route:/hse/report");
    // The detail route is longer, so it wins on length instead.
    expect(resolveWindowForApiPath("PATCH", "/hse/records/:id")).toBe(
      "route:/hse/records/:recordId",
    );
    // A method the report-form rule does not name falls to the module Window.
    expect(resolveWindowForApiPath("DELETE", "/hse/records")).toBe("route:/hse");
  });

  it("expects the Fastify route pattern, never a concrete URL", () => {
    // The plugin passes `request.routeOptions.url`, which is the declared
    // pattern. Passing a filled-in URL would resolve to the parent Window
    // silently, which is why this is pinned rather than assumed.
    expect(resolveWindowForApiPath("PATCH", "/assets/3f2a")).toBe("route:/assets");
    expect(resolveWindowForApiPath("PATCH", "/assets/:id")).toBe("route:/assets/:assetId");
  });

  it("maps the legacy and canonical WMS namespaces to the same Windows", () => {
    // Both prefixes are served; a rule for one and not the other would leave
    // half the surface open under the alias.
    for (const [canonical, legacy] of [
      ["/wms/warehouses", "/supply-chain/advanced/warehouses"],
      ["/wms/valuation-layers", "/supply-chain/advanced/valuation-layers"],
    ] as const) {
      expect(resolveWindowForApiPath("POST", legacy)).toBe(
        resolveWindowForApiPath("POST", canonical),
      );
    }
  });

  it("maps a write route to the Window that would raise it, not to its own module page", () => {
    // `/work-requests` has no client route of its own; a request is raised from
    // and converted into a work order. Silence here would leave 3 mutating
    // routes unlocked with no record of why.
    expect(resolveWindowForApiPath("POST", "/work-requests")).toBe("route:/work-orders");
  });
});

describe("windowsWithEnforcement — every literal names a real Window", () => {
  it("covers at least one Window (guards against a rule table that parses empty)", () => {
    expect(windowsWithEnforcement().size).toBeGreaterThan(20);
  });

  it("resolves every windowCode to a route the application serves", () => {
    // A typo in a `windowCode` would otherwise cover nothing while reading as
    // if it covered something — the exact silent gap §4.4 forbids.
    const unknown = WINDOW_RULES.map((rule) => rule.windowCode)
      .filter((code) => !code.startsWith("route:"))
      .concat(
        WINDOW_RULES.map((rule) => rule.windowCode.slice("route:".length)).filter(
          (path) => resolveRouteEntry(path) === null,
        ),
      );
    expect([...new Set(unknown)], `Window codes with no registered route`).toEqual([]);
  });

  it("is derived from the rules, so the two cannot drift", () => {
    const fromRules = new Set(WINDOW_RULES.map((rule) => rule.windowCode));
    expect([...windowsWithEnforcement()].sort()).toEqual([...fromRules].sort());
  });
});

describe("WINDOW_ENFORCEMENT_EXEMPTIONS — every entry carries its justification", () => {
  it("explains each exemption rather than naming it", () => {
    const unexplained = WINDOW_ENFORCEMENT_EXEMPTIONS.filter(
      (exemption) => exemption.reason.trim().length < 40,
    );
    expect(
      unexplained.map((exemption) => exemption.apiPath),
      "exemptions with a placeholder reason",
    ).toEqual([]);
  });

  it("states a property the enforcement code can act on", () => {
    // The literal set is closed on purpose: a third property would reach the
    // census with no branch deciding it, and the route would land unaccounted
    // with no explanation of which property failed.
    const known = new Set(["unauthenticated", "window-from-request"]);
    const unknown = WINDOW_ENFORCEMENT_EXEMPTIONS.filter(
      (exemption) => !known.has(exemption.property),
    );
    expect(unknown.map((exemption) => exemption.apiPath)).toEqual([]);
  });

  it("writes prefixes the same way the matcher reads them", () => {
    // Segment-aligned, so a leading or trailing slash is not cosmetic: `/auth/`
    // would stop matching `/auth/login` while still looking correct in the file.
    const malformed = WINDOW_ENFORCEMENT_EXEMPTIONS.filter(
      (exemption) => !exemption.apiPath.startsWith("/") || exemption.apiPath.endsWith("/"),
    );
    expect(malformed.map((exemption) => exemption.apiPath)).toEqual([]);
  });
});

describe("windowEnforcementStatus — read from the census, never asserted", () => {
  // The census is process-global and append-only, so these run in order and each
  // asserts membership of a unique key rather than a set size. The empty
  // assertion is first because nothing before it has registered a route.
  it("starts with nothing unaccounted for and no route counted", () => {
    expect(windowAccountability()).toEqual({ governed: [], exempt: [], unaccounted: [] });
    expect(windowEnforcementStatus()).toBe("enforced");
  });

  it("counts a route a rule claims as governed, whatever else is true of it", () => {
    registerServedMutatingRoute({ method: "post", apiPath: "/wms/warehouses", hasActor: false });
    // Governed wins over exemption: a rule claims it, so the lock reaches it and
    // no exemption could be honest about it.
    expect(windowAccountability().governed).toContain("POST /wms/warehouses");
    expect(windowAccountability().unaccounted).toEqual([]);
  });

  it("counts an unauthenticated route under its exemption as exempt", () => {
    registerServedMutatingRoute({ method: "POST", apiPath: "/auth/refresh", hasActor: false });
    expect(windowAccountability().exempt).toContain("POST /auth/refresh");
    expect(windowEnforcementStatus()).toBe("enforced");
  });

  it("refuses to exempt an authenticated route as unauthenticated", () => {
    // The property is falsifiable, and this is the direction that matters: a
    // route with an actor could have been mapped, so listing it as
    // unauthenticated would be an escape hatch rather than an exemption.
    registerServedMutatingRoute({ method: "POST", apiPath: "/auth/login", hasActor: true });
    expect(windowAccountability().unaccounted).toContain("POST /auth/login");
    expect(windowAccountability().exempt).not.toContain("POST /auth/login");
  });

  it("reports partial once anything is unaccounted for", () => {
    // §4.4: "Tidak ada fallback diam-diam." One uncounted route is enough to
    // withdraw the word enforced — that is the whole point of deriving it.
    expect(windowEnforcementStatus()).toBe("partial");
  });

  it("counts a route no rule and no exemption covers as unaccounted for", () => {
    registerServedMutatingRoute({ method: "DELETE", apiPath: "/definitely/not/mapped", hasActor: true });
    expect(windowAccountability().unaccounted).toContain("DELETE /definitely/not/mapped");
  });

  it("holds a window-from-request exemption whatever the route's actor", () => {
    // Unlike `unauthenticated`, this property is not falsifiable from the
    // declaration — the claim is about where the Window comes from, which the
    // route object does not state. The census therefore accepts it, and the
    // coverage test is what checks the actor actually exists.
    registerServedMutatingRoute({ method: "POST", apiPath: "/documents", hasActor: true });
    registerServedMutatingRoute({ method: "DELETE", apiPath: "/documents/:id", hasActor: true });
    expect(windowAccountability().exempt).toContain("POST /documents");
    expect(windowAccountability().exempt).toContain("DELETE /documents/:id");
    expect(windowAccountability().unaccounted).not.toContain("POST /documents");
  });

  it("matches an exemption on a segment boundary, never on a name prefix", () => {
    // `/authz` is not the `/auth` subtree; folding it in would exempt a route
    // nobody meant to exempt.
    registerServedMutatingRoute({ method: "POST", apiPath: "/authz/grants", hasActor: true });
    expect(windowAccountability().unaccounted).toContain("POST /authz/grants");
    expect(windowAccountability().exempt).not.toContain("POST /authz/grants");
  });
});

describe("evaluateWindowWriteAccess — the four steps", () => {
  it("step 1: never blocks a read, whatever the Window says", () => {
    for (const method of ["GET", "HEAD", "OPTIONS"]) {
      expect(
        evaluateWindowWriteAccess({
          method,
          path: "/wms/warehouses",
          access: CONFIGURED_READ_ONLY,
        }),
      ).toEqual({ allowed: true });
    }
  });

  it("step 2: passes a route no rule claims, rather than inventing a lock", () => {
    expect(
      evaluateWindowWriteAccess({
        method: "POST",
        path: "/definitely/not/mapped",
        access: CONFIGURED_READ_ONLY,
      }),
    ).toEqual({ allowed: true });
  });

  it("step 3: passes when no Role was ever configured for the Window", () => {
    // The table ships empty. Reading absence as read-only would lock every Role
    // out of every Window on deploy day.
    expect(
      evaluateWindowWriteAccess({
        method: "POST",
        path: "/wms/warehouses",
        access: NOT_CONFIGURED,
      }),
    ).toEqual({ allowed: true, windowCode: "route:/wms/warehouses" });
  });

  it("step 4: rejects a configured, read-only Window with the §4.4 reason", () => {
    const decision = evaluateWindowWriteAccess({
      method: "PATCH",
      path: "/wms/warehouses/:id",
      access: CONFIGURED_READ_ONLY,
    });
    expect(decision.allowed).toBe(false);
    expect(decision.windowCode).toBe("route:/wms/warehouses");
    expect(decision.reason).toBe(WINDOW_READ_ONLY_REASON);
  });

  it("applies the union allow: one writable assignment is enough", () => {
    expect(
      evaluateWindowWriteAccess({
        method: "DELETE",
        path: "/wms/warehouses/:id",
        access: CONFIGURED_WRITABLE,
      }),
    ).toEqual({ allowed: true, windowCode: "route:/wms/warehouses" });
  });

  it("blocks every mutating method on a read-only Window", () => {
    for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
      expect(
        evaluateWindowWriteAccess({
          method,
          path: "/hse/records/:id",
          access: CONFIGURED_READ_ONLY,
        }).allowed,
      ).toBe(false);
    }
  });

  it("does not let one Window's lock carry another", () => {
    expect(
      evaluateWindowWriteAccess({
        method: "POST",
        path: "/wms/warehouses",
        access: CONFIGURED_WRITABLE,
      }).allowed,
    ).toBe(true);
    expect(
      evaluateWindowWriteAccess({
        method: "POST",
        path: "/finance/accounts",
        access: CONFIGURED_READ_ONLY,
      }).allowed,
    ).toBe(false);
  });

  it("exempts nobody — platform routes are lockable like any other", () => {
    // Deliberate contrast with the module-active rule, which exempts
    // `platform`. The header states why: a Window lock is per Role and
    // revocable by another Role, so an exemption would make `route:/admin`
    // decorative for exactly the Roles most likely to be over-privileged.
    for (const path of ["/config/modules/hse", "/users", "/admin/roles"]) {
      expect(
        evaluateWindowWriteAccess({
          method: "PUT",
          path,
          access: CONFIGURED_READ_ONLY,
        }).allowed,
      ).toBe(false);
    }
  });
});
