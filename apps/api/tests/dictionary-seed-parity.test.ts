/**
 * Epic 2 Wave 1 — dictionary seed parity (CORE-ROADMAP.md §4.2).
 *
 * The seed migration holds a snapshot of two derivations:
 *
 *   app_processes     — one row per permission, seeded from the live
 *                       `permissions` table.
 *   app_api_resources — one row per HTTP route, seeded from Fastify's own
 *                       route table.
 *
 * Nothing in the build forces the snapshot to stay true. A permission added
 * without re-running the seed, a route added without it, or a module
 * attribution that changed in code but not in the migration all look
 * identical from the outside: the dictionary quietly describes an application
 * that no longer exists. This test is what makes that visible.
 *
 * It does NOT read the migration file. Reading the file would only prove the
 * file agrees with itself. It re-derives both lists from their real sources —
 * `permissions` in the database and `app.routes` on a built app instance —
 * and compares against what the seed actually wrote for a fresh tenant. The
 * tenant is created here through the real bootstrap endpoint, so the trigger
 * path is exercised, not just the backfill.
 *
 * Route enumeration uses Fastify's `onRoute` hook because a large share of the
 * surface is registered inside loops; `printRoutes` was the previous approach
 * and loses the method/path pairing.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { pool } from "../src/infrastructure/persistence/db.js";
import {
  MODULE_CODES,
  attributeApiPath,
  attributePermission,
} from "../src/domain/configuration/module-attribution.js";
import { ROUTE_REGISTRY } from "../src/domain/configuration/route-registry.js";
import { bootstrapTenant } from "./integration/helpers.js";

const TENANT_CODE = `test-dict-parity-${Date.now()}`;
const GOVERNED_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"] as const;

/** Every governed route the built app serves, as `METHOD /path`.
 *
 * Routes register inside the avvio boot queue (app.ts wraps every
 * registration in `app.register(async ...)`), so the hook only fires once
 * `ready()` completes. Async and awaited: `buildApp()` returns before any
 * route exists. */
let servedRoutesCache: Promise<{ method: string; path: string }[]> | undefined;

function servedRoutes(): Promise<{ method: string; path: string }[]> {
  // Booting a full app instance is the expensive part of this suite; two
  // assertions need the same list, so derive it once.
  servedRoutesCache ??= collectServedRoutes();
  return servedRoutesCache;
}

async function collectServedRoutes(): Promise<{ method: string; path: string }[]> {
  const app = buildApp();
  const seen = new Map<string, { method: string; path: string }>();
  app.addHook("onRoute", (route) => {
    const methods = Array.isArray(route.method) ? route.method : [route.method];
    for (const method of methods) {
      if (!GOVERNED_METHODS.includes(method as (typeof GOVERNED_METHODS)[number])) continue;
      seen.set(`${method} ${route.url}`, { method, path: route.url });
    }
  });
  await app.ready();
  await app.close();
  return [...seen.values()];
}

describe("Epic 2 Wave 1 — dictionary seed parity", () => {
  let tenantId: string;
  let seededProcesses: { code: string; module_code: string }[];
  let seededApiResources: { code: string; module_code: string; http_method: string; path_pattern: string }[];
  let livePermissions: { code: string }[];

  beforeAll(async () => {
    // Building the app twice is deliberate: one instance is awaited inside
    // servedRoutes(); the seeded rows only need the tenant trigger.
    const app = buildApp();
    const tenant = await bootstrapTenant(app, TENANT_CODE, "Test Tenant Dictionary Parity");
    tenantId = tenant.id;

    seededProcesses = (
      await pool.query(
        `SELECT code, module_code FROM app_processes WHERE tenant_id = $1 ORDER BY code`,
        [tenantId],
      )
    ).rows;
    seededApiResources = (
      await pool.query(
        `SELECT code, module_code, http_method, path_pattern
           FROM app_api_resources WHERE tenant_id = $1 ORDER BY code`,
        [tenantId],
      )
    ).rows;
    livePermissions = (await pool.query(`SELECT code FROM permissions ORDER BY code`)).rows;

    await app.close();
  });

  afterAll(async () => {
    await pool.query(`DELETE FROM tenants WHERE id = $1`, [tenantId]);
  });

  it("seeds one process per permission, and no more", () => {
    const seeded = seededProcesses.map((row) => row.code).sort();
    const live = livePermissions.map((row) => row.code).sort();
    const missing = live.filter((code) => !seeded.includes(code));
    const extra = seeded.filter((code) => !live.includes(code));
    expect(missing, `permissions with no seeded process: ${missing.join(", ")}`).toEqual([]);
    expect(extra, `seeded processes with no permission: ${extra.join(", ")}`).toEqual([]);
  });

  it("seeds one API resource per served route, and no more", async () => {
    const served = (await servedRoutes())
      .map((route) => `api:${route.method} ${route.path}`)
      .sort();
    const seeded = seededApiResources.map((row) => row.code).sort();
    const missing = served.filter((code) => !seeded.includes(code));
    const extra = seeded.filter((code) => !served.includes(code));
    expect(missing, `served routes with no dictionary row: ${missing.join(", ")}`).toEqual([]);
    expect(extra, `dictionary rows with no served route: ${extra.join(", ")}`).toEqual([]);
  });

  it("attributes every permission to the module its owner service belongs to", () => {
    // Re-derivation, not a re-read: expected module comes from the code-owned
    // rule set, actual module comes from what the migration wrote.
    const wrong = seededProcesses
      .map((row) => ({ code: row.code, expected: attributePermission(row.code), actual: row.module_code }))
      .filter((row) => row.expected !== row.actual)
      .map((row) => `${row.code}: expected ${row.expected}, seeded ${row.actual}`);
    expect(wrong, wrong.join("\n")).toEqual([]);
  });

  it("attributes every API resource to the module of its first path segment", () => {
    const wrong = seededApiResources
      .map((row) => ({
        code: row.code,
        expected: attributeApiPath(row.path_pattern),
        actual: row.module_code,
      }))
      .filter((row) => row.expected !== row.actual)
      .map((row) => `${row.code}: expected ${row.expected}, seeded ${row.actual}`);
    expect(wrong, wrong.join("\n")).toEqual([]);
  });

  it("resolves every attribution to a real module code", async () => {
    // A permission or path that resolves to nothing cannot be locked to a role
    // under §4.4, so silence here would be the "kesalahan yang tidak terlihat"
    // §4.3 warns about.
    const unmappedPermissions = livePermissions
      .map((row) => row.code)
      .filter((code) => attributePermission(code) === undefined);
    expect(unmappedPermissions, `unattributed permissions: ${unmappedPermissions.join(", ")}`).toEqual([]);

    const unmappedSegments = [
      ...new Set((await servedRoutes()).map((route) => route.path.replace(/^\//, "").split("/")[0])),
    ].filter((segment) => segment !== "" && !segment.startsWith(":") && attributeApiPath(`/${segment}`) === undefined);
    expect(unmappedSegments, `unattributed segments: ${unmappedSegments.join(", ")}`).toEqual([]);
  });

  it("stores only module codes that exist in the modules catalogue", async () => {
    const catalog = new Set(
      (await pool.query(`SELECT code FROM modules`)).rows.map((row) => row.code as string),
    );
    const orphans = [
      ...seededProcesses.map((row) => row.module_code),
      ...seededApiResources.map((row) => row.module_code),
      ...ROUTE_REGISTRY.map((entry) => entry.moduleCode),
    ].filter((code) => !catalog.has(code));
    expect([...new Set(orphans)], `module codes with no catalogue row: ${orphans.join(", ")}`).toEqual([]);
    // The literal union in code must match the catalogue too, or a rule can
    // typecheck against a module that does not exist.
    expect([...catalog].sort()).toEqual([...MODULE_CODES].sort());
  });

  it("keeps the method column within the constraint the table declares", () => {
    const allowed = new Set<string>(GOVERNED_METHODS);
    const bad = seededApiResources
      .filter((row) => !allowed.has(row.http_method))
      .map((row) => `${row.code} -> ${row.http_method}`);
    expect(bad, `out-of-range methods: ${bad.join(", ")}`).toEqual([]);
  });
});
