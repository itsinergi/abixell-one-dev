/**
 * Epic 3 Wave 3 — namespace-parity guard for the legacy alias.
 *
 * The legacy `/supply-chain/advanced/*` namespace is a shim that mounts the
 * canonical WMS and Procurement registrars under a foreign first segment
 * (`supply-chain`). First-segment attribution lies there: every alias URL
 * attributes to `supply_chain` while the identical handler at `/wms/*`
 * attributes to `warehouse_management` and `/procurement/*` to
 * `procurement_management`.
 *
 * `API_PATH_MODULE_OVERRIDES` states the true owners explicitly, and this test
 * is the mechanical check that it cannot drift: it parses the live route files
 * for every `route(prefix, "/x")` literal in each registrar, and asserts each
 * subtree (a) appears in the override table, and (b) attributes to the same
 * module at the alias prefix as it does at the canonical prefix.
 *
 * Fails when a new route is added to either namespace without a home in the
 * override table — which is what stops the §4.3 bypass (a tenant disabling
 * `warehouse_management` while keeping `supply_chain` could otherwise still
 * post movements at the alias URL) from ever re-opening.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  API_PATH_MODULE_OVERRIDES,
  attributeApiPath,
  type ModuleCode,
} from "../src/domain/configuration/module-attribution.js";

// tests/ → apps/api → apps → repository root.
const REPO = join(__dirname, "..", "..", "..");
const WMS_ROUTES = join(REPO, "apps/api/src/modules/supply-chain/warehouse/api/wms.routes.ts");
const PROCUREMENT_ROUTES = join(
  REPO,
  "apps/api/src/modules/supply-chain/procurement/api/procurement.routes.ts",
);

const LEGACY_PREFIX = "/supply-chain/advanced";

/** Subtrees mounted by a registrar, parsed straight from the source. */
function extractSubtrees(filePath: string): string[] {
  const source = readFileSync(filePath, "utf-8");
  const subtrees = new Set<string>();
  for (const match of source.matchAll(/route\(prefix,\s*"\/([^"]+)"/g)) {
    subtrees.add(match[1].split("/")[0]);
  }
  return [...subtrees].sort();
}

/** Subtrees the override table claims for one module under the legacy prefix. */
function declaredSubtrees(moduleCode: ModuleCode): string[] {
  return API_PATH_MODULE_OVERRIDES.filter(
    ([path, code]) => code === moduleCode && path.startsWith(`${LEGACY_PREFIX}/`),
  )
    .map(([path]) => path.slice(LEGACY_PREFIX.length + 1))
    .sort();
}

const WMS_SUBTREES = extractSubtrees(WMS_ROUTES);
const PROCUREMENT_SUBTREES = extractSubtrees(PROCUREMENT_ROUTES);

describe("API_PATH_MODULE_OVERRIDES — the legacy alias cannot bypass the module ceiling", () => {
  it("parsed a non-trivial route surface (guards against a regex that matches nothing)", () => {
    expect(WMS_SUBTREES.length).toBeGreaterThan(20);
    expect(PROCUREMENT_SUBTREES.length).toBeGreaterThan(4);
  });

  it("covers every wms.routes.ts subtree, with no stranger rows", () => {
    expect(declaredSubtrees("warehouse_management")).toEqual(WMS_SUBTREES);
  });

  it("covers every procurement.routes.ts subtree, with no stranger rows", () => {
    expect(declaredSubtrees("procurement_management")).toEqual(PROCUREMENT_SUBTREES);
  });

  it("attributes identically at the canonical and alias namespaces", () => {
    const cases: Array<[string[], string, ModuleCode]> = [
      [WMS_SUBTREES, "/wms", "warehouse_management"],
      [PROCUREMENT_SUBTREES, "/procurement", "procurement_management"],
    ];

    for (const [subtrees, canonicalPrefix, expectedModule] of cases) {
      for (const subtree of subtrees) {
        const canonical = attributeApiPath(`${canonicalPrefix}/${subtree}`);
        const alias = attributeApiPath(`${LEGACY_PREFIX}/${subtree}`);
        expect(canonical).toBe(expectedModule);
        expect(alias).toBe(expectedModule);
        // A subtree must never collapse into the shim's own segment default.
        expect(alias).not.toBe("supply_chain");
      }
    }
  });

  it("matches only on a segment boundary, never a name prefix", () => {
    // `/supply-chain/advanced/movements-x` is not the WMS `movements` subtree;
    // it must fall through to the shim's own segment, not inherit warehouse.
    expect(attributeApiPath(`${LEGACY_PREFIX}/movements-x`)).toBe("supply_chain");
    expect(attributeApiPath(`${LEGACY_PREFIX}/inventory-aging`)).toBe("supply_chain");
    // The exact subtree still resolves.
    expect(attributeApiPath(`${LEGACY_PREFIX}/movements`)).toBe("warehouse_management");
  });
});
