/**
 * Epic 2 Wave 1 — auto-registration parity (CORE-ROADMAP.md §4.2, §4.3).
 *
 * The backend registry is canonical; the browser reads a generated mirror
 * because apps/web cannot import apps/api. Nothing at build time forces the
 * two to agree, so this test does. It also checks the registry against the
 * routes actually declared in App.tsx — a page added without a registry entry
 * is exactly the "kesalahan yang terlihat" §4.3 asks the guard to surface.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  ROUTE_REGISTRY,
  resolveRouteEntry,
  resolveRoutePermissions,
  resolveRouteStatus,
} from "../src/domain/configuration/route-registry.js";
import { ROUTE_REGISTRY as WEB_MIRROR } from "../../web/src/lib/routeRegistry.js";

const APP_TSX = readFileSync(resolve(__dirname, "../../web/src/App.tsx"), "utf8");

/**
 * Every path App.tsx declares, as an absolute path. Nested routes are written
 * relative to the shell root (`path="/"`), and `index` means the root itself.
 *
 * Split on the `<Route` tag rather than regex-matching to its closing `>`,
 * because a `>` inside a JSX attribute value (`element={<OverviewPage />}`)
 * would end a naive match early and silently drop routes from the comparison.
 * Each chunk stops at the first `path=`/`index` attribute, which always precedes
 * `element`, so the attribute values that can contain `>` are never needed.
 */
function declaredRoutePaths(): string[] {
  const paths: string[] = [];
  for (const chunk of APP_TSX.split("<Route").slice(1)) {
    const head = chunk.split(/\b(?:element|loader|action|children)=/)[0];
    // The index route inside the shell renders at "/".
    if (/\bindex\b/.test(head) && !/\bpath=/.test(head)) {
      paths.push("/");
      continue;
    }
    const path = /\bpath="([^"]*)"/.exec(head)?.[1];
    if (path === undefined) continue;
    // The wildcard catch-all is literally `*`; everything else is either an
    // absolute path or a shell-relative one, which is absolute once prefixed.
    paths.push(path === "*" || path.startsWith("/") ? path : `/${path}`);
  }
  return paths;
}

describe("route registry parity", () => {
  it("the browser mirror carries exactly the backend routes", () => {
    const backend = ROUTE_REGISTRY.map((r) => r.path).sort();
    const mirror = WEB_MIRROR.map((r) => r.path).sort();
    expect(mirror).toEqual(backend);
  });

  it("the mirror agrees on status and permissions for every route", () => {
    const byPath = new Map(WEB_MIRROR.map((r) => [r.path, r]));
    for (const entry of ROUTE_REGISTRY) {
      const mirrored = byPath.get(entry.path);
      expect(mirrored, `mirror is missing ${entry.path}`).toBeDefined();
      expect(mirrored!.status, `status differs for ${entry.path}`).toBe(entry.status);
      expect(mirrored!.permissions, `permissions differ for ${entry.path}`).toEqual(
        entry.permissions,
      );
      expect(mirrored!.moduleCode, `module differs for ${entry.path}`).toBe(entry.moduleCode);
    }
  });

  it("registers every route App.tsx declares", () => {
    const registered = new Set(ROUTE_REGISTRY.map((r) => r.path));
    const missing = [...new Set(declaredRoutePaths())].filter((p) => !registered.has(p));
    expect(missing, `unregistered routes: ${missing.join(", ")}`).toEqual([]);
  });

  it("declares no route App.tsx does not have", () => {
    const declared = new Set(declaredRoutePaths());
    // The wildcard catch-all is declared as `path="*"`, so it is included.
    const extra = ROUTE_REGISTRY.map((r) => r.path).filter((p) => !declared.has(p));
    expect(extra, `registry-only routes: ${extra.join(", ")}`).toEqual([]);
  });

  it("gates the HSE report form on the permission the server actually checks", () => {
    // hse.service.ts:110 gates reportRecord on `hse.report`, not `hse.manage`.
    expect(resolveRoutePermissions("/hse/report")).toContain("hse.report");
  });

  it("resolves detail routes to their own entry, not the list", () => {
    expect(resolveRouteEntry("/complaints/9f2c1b7e")?.path).toBe("/complaints/:complaintId");
    expect(resolveRouteEntry("/complaints")?.path).toBe("/complaints");
    // Trailing slash is the same route.
    expect(resolveRouteEntry("/complaints/")?.path).toBe("/complaints");
  });

  it("reports an unknown path as belum_terdaftar", () => {
    // The wildcard entry must not act as a runtime fallback, or the guard
    // could never report an unregistered page.
    expect(resolveRouteStatus("/definitely/not/a/route")).toBe("belum_terdaftar");
    expect(resolveRoutePermissions("/definitely/not/a/route")).toBeNull();
    expect(resolveRouteEntry("/definitely/not/a/route")).toBeNull();
  });

  it("keeps entry-flow routes reachable with no permission", () => {
    for (const path of ["/login", "/select-workspace", "/public/surveys/:token"]) {
      expect(resolveRouteStatus(path), `${path} must be registered`).not.toBe("belum_terdaftar");
      expect(resolveRoutePermissions(path), `${path} must need no permission`).toEqual([]);
    }
  });
});
