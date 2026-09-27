/**
 * Epic 4 Wave 1 — Window read-only coverage (CORE-ROADMAP.md §4.4 step 11b).
 *
 * The mapping in `window-enforcement.ts` is by hand, so nothing in the build
 * forces it to stay complete. A route added without a rule resolves to
 * `undefined` and passes through — deliberately, because "not yet mapped" is not
 * the same claim as "read-only". The cost of that choice is that an unmapped
 * route is invisible unless something counts it. This test is that something.
 *
 * It enumerates every mutating route the app actually serves (`onRoute`, the
 * same approach as `dictionary-seed-parity.test.ts`, because a large share of
 * the surface registers inside loops) and holds the two sets against each
 * other:
 *
 *   served, resolving to a Window        → governed
 *   served, resolving to none, exempt    → exempt, and the property must hold
 *   served, resolving to none, not exempt → FAIL (§4.4's silent fallback)
 *   exempt, covering no served route     → FAIL (a stale excuse)
 *
 * The middle pair is what makes the exemption list evidence rather than a
 * licence. `registerServedMutatingRoute` records each route against the
 * property its exemption claims, so a route that carries `app.authenticate`
 * cannot hide behind `unauthenticated` — such a route has an actor, and an
 * actor means it could have been mapped.
 *
 * The enumeration is independent of the census the plugin accumulates: this
 * file reads the route objects itself, so the two agreeing is a real result
 * rather than the same code checking itself.
 */
import { describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import {
  MUTATING_METHODS,
  resolveWindowForApiPath,
  WINDOW_ENFORCEMENT_EXEMPTIONS,
  windowAccountability,
  windowEnforcementStatus,
} from "../src/domain/configuration/window-enforcement.js";
import { MODULE_CODES, attributeApiPath } from "../src/domain/configuration/module-attribution.js";

interface ServedRoute {
  method: string;
  path: string;
  /** Whether the declaration puts `app.authenticate` in its preHandler chain. */
  hasActor: boolean;
}

/** Every mutating route the built app serves, as `METHOD /path`.
 *
 * Routes register inside the avvio boot queue (`app.ts` wraps every
 * registration in `app.register(async ...)`), so the hook only fires once
 * `ready()` completes — `buildApp()` returns before any route exists. */
async function collectMutatingRoutes(): Promise<ServedRoute[]> {
  const app = buildApp();
  const seen = new Map<string, ServedRoute>();
  app.addHook("onRoute", (route) => {
    const methods = Array.isArray(route.method) ? route.method : [route.method];
    const preHandler = route.preHandler;
    const chain =
      preHandler === undefined ? [] : Array.isArray(preHandler) ? preHandler : [preHandler];
    // Identity, not a name match: the decorator itself is the only thing that
    // sets `request.actor`. Anything else that authenticates is a different
    // mechanism, and reporting it as having no actor is the safe direction.
    const hasActor = chain.some((handler) => handler === app.authenticate);
    for (const method of methods) {
      if (!MUTATING_METHODS.includes(method as (typeof MUTATING_METHODS)[number])) continue;
      seen.set(`${method} ${route.url}`, { method, path: route.url, hasActor });
    }
  });
  await app.ready();
  await app.close();
  return [...seen.values()];
}

/** Segment-aligned prefix test — `/auth` covers `/auth/login`, never `/authors`. */
function underPrefix(path: string, prefix: string): boolean {
  return path === prefix || path.startsWith(`${prefix}/`);
}

const SERVED = await collectMutatingRoutes();

function key(route: { method: string; path: string }): string {
  return `${route.method} ${route.path}`;
}

/** The routes that resolve to no Window — the set the exemptions must cover. */
function unmappedRoutes(): ServedRoute[] {
  return SERVED.filter((route) => resolveWindowForApiPath(route.method, route.path) === undefined);
}

function routesUnder(prefix: string): ServedRoute[] {
  return SERVED.filter((route) => underPrefix(route.path, prefix));
}

describe("Epic 4 Wave 1 — Window read-only coverage", () => {
  it("served a non-trivial mutating surface (guards against a hook that never fired)", () => {
    // Booting the app is the expensive part; this also proves the enumeration
    // is real rather than an empty array passing every assertion below.
    expect(SERVED.length).toBeGreaterThan(200);
  });

  it("maps every mutating route the server declared — nothing unaccounted for", () => {
    // §4.4: "Tidak ada fallback diam-diam sebelum pemetaan modul selesai." A
    // route in neither list is exactly that silent fallback.
    const { unaccounted } = windowAccountability();
    expect(
      unaccounted,
      `mutating routes governed by no rule and covered by no exemption:\n${unaccounted.join("\n")}`,
    ).toEqual([]);
  });

  it("agrees with the census the server built from those same routes", () => {
    // The census is filled by the enforcement plugin's own `onRoute`. This file
    // enumerates independently, so a disagreement means one of the two is not
    // seeing the real surface — a broken hook would otherwise read as "clean".
    const { governed, exempt } = windowAccountability();
    const accounted = [...governed, ...exempt].sort();
    expect(accounted).toEqual(SERVED.map(key).sort());
  });

  it("reports its derived status truthfully", () => {
    // Pins the link between the field the API returns and the counted routes.
    // With no gap list left to consult, `enforced` is a reading of the served
    // surface rather than an assertion someone set by hand.
    expect(windowAccountability().unaccounted).toEqual([]);
    expect(windowEnforcementStatus()).toBe("enforced");
  });

  it("keeps an exemption only while a served route still needs it", () => {
    const stale = WINDOW_ENFORCEMENT_EXEMPTIONS.filter(
      (exemption) => routesUnder(exemption.apiPath).length === 0,
    ).map((exemption) => exemption.apiPath);
    expect(
      stale,
      `exemptions covering no served route (delete them) — the route was renamed, removed, or is now mapped: ${stale.join(", ")}`,
    ).toEqual([]);
  });

  it("proves each exemption's claimed property against the route declaration", () => {
    // The heart of the gate. `unauthenticated` is falsifiable from the route
    // object, so it is checked here: a route carrying `app.authenticate` has an
    // actor, and an actor means a Role could have been consulted, which makes
    // the exemption an escape hatch rather than an explanation.
    //
    // `window-from-request` claims the opposite — the actor exists and the
    // Window is the browser-supplied part. Asserting the actor IS present keeps
    // the two properties from being used interchangeably: a genuinely anonymous
    // route must be declared `unauthenticated`, or the reason on file is false.
    const failures: string[] = [];
    for (const exemption of WINDOW_ENFORCEMENT_EXEMPTIONS) {
      for (const route of routesUnder(exemption.apiPath)) {
        if (resolveWindowForApiPath(route.method, route.path) !== undefined) continue;
        if (exemption.property === "unauthenticated" && route.hasActor) {
          failures.push(
            `${key(route)} carries app.authenticate but is exempted as unauthenticated (${exemption.apiPath})`,
          );
        }
        if (exemption.property === "window-from-request" && !route.hasActor) {
          failures.push(
            `${key(route)} has no actor but is exempted as window-from-request (${exemption.apiPath}) — it belongs under unauthenticated`,
          );
        }
      }
    }
    expect(failures, "exemptions whose claimed property the declaration contradicts").toEqual([]);
  });

  it("has no exemption whose prefix also resolves to a Window — an exemption must not shadow a rule", () => {
    // A rule claims these routes first, so the exemption would sit in the list
    // looking authoritative while covering nothing. The stale check above only
    // catches that once it covers nothing at all; this catches it per-route.
    const shadowed: string[] = [];
    for (const exemption of WINDOW_ENFORCEMENT_EXEMPTIONS) {
      for (const route of routesUnder(exemption.apiPath)) {
        if (resolveWindowForApiPath(route.method, route.path) !== undefined) {
          shadowed.push(`${key(route)} under exemption ${exemption.apiPath}`);
        }
      }
    }
    expect([...new Set(shadowed)], "exemptions shadowing a live Window rule").toEqual([]);
  });

  it("leaves no open module unaccounted for", () => {
    // §4.4's gate row: read-only "berlaku untuk modul yang pemetaan API Resource
    // → Window-nya sudah eksplisit; modul lain belum boleh dianggap tertutup."
    // A module with an unmapped mutating route is still open, and the reason
    // must be a declared exemption rather than silence.
    const openModules = new Map<string, string[]>();
    for (const route of unmappedRoutes()) {
      const moduleCode = attributeApiPath(route.path);
      if (moduleCode === undefined) continue;
      if (!MODULE_CODES.includes(moduleCode)) continue;
      const list = openModules.get(moduleCode) ?? [];
      list.push(key(route));
      openModules.set(moduleCode, list);
    }

    const undeclaredModules = [...openModules.keys()].filter((moduleCode) => {
      const paths = openModules.get(moduleCode) ?? [];
      return paths.every(
        (entry) =>
          !WINDOW_ENFORCEMENT_EXEMPTIONS.some((exemption) =>
            underPrefix(entry.split(" ")[1], exemption.apiPath),
          ),
      );
    });
    expect(
      undeclaredModules,
      `modules with no Window coverage and no exemption: ${undeclaredModules.join(", ")}`,
    ).toEqual([]);
  });
});
