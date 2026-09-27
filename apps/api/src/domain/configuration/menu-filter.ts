/**
 * The Wave 2 menu filter (CORE-ROADMAP.md §4.3, "Dua sebab, dua akibat" and
 * "URUTAN PENYARINGAN MENU").
 *
 * §4.3 fixes both the order and the consequence of each step, for every
 * caller, in the server:
 *
 *   1. External whitelist (`is_external_allowed`)  → a caller without an
 *      internal Data Scope receives ONLY whitelisted menus. A menu without
 *      the flag is never sent — absent, not disabled.
 *   2. Module status                               → an inactive module's
 *      menus disappear for everyone. Inactivity is a tenant-wide decision;
 *      there is nothing to gain by showing its menus.
 *   3. Role rights                                 → a menu the role cannot
 *      open is still sent, marked `locked`, with the reason. Rights are a
 *      per-person decision; showing the locked menu tells the person the
 *      function exists and what to ask an administrator for.
 *
 * "Menu bukan security boundary" still holds: this shapes what the shell
 * renders, and every destination is checked again by the route guard and the
 * API. Filtering here keeps internal structure from even reaching a browser
 * that must not see it (§4.3 principle 2).
 */

import type { MenuNode } from "./app-metadata.entity.js";

/** A folder is dropped once nothing survives beneath it. */
export interface MenuFilterInput {
  /** Effective permission codes held by the caller ("any of" per menu). */
  permissions: readonly string[];
  /** Data-Scope types the caller holds (customer / organization_unit / tenant). */
  scopeTypes: readonly string[];
  /** Module codes active for the caller's tenant. */
  activeModuleCodes: readonly string[];
}

/**
 * External = holds NO internal Data Scope. Mirrors the browser's
 * `isInternalScope` (capabilities.ts): internal means an explicit
 * `tenant` or `organization_unit` scope. A caller with only a customer
 * scope is external even if some permission was granted alongside it —
 * the whitelist decides reach, not permissions.
 */
export function isExternalCaller(scopeTypes: readonly string[]): boolean {
  return !scopeTypes.some((scope) => scope === "tenant" || scope === "organization_unit");
}

function filterNode(node: MenuNode, input: MenuFilterInput, external: boolean): MenuNode | null {
  // Step 1 — the external whitelist. Default closed: no flag, no delivery.
  if (external && !node.isExternalAllowed) return null;

  // Step 2 — module status. A group root carries no module and passes; a
  // module folder dies with its module, so its locked children never have to
  // be evaluated against a module the tenant turned off.
  if (node.moduleCode && !input.activeModuleCodes.includes(node.moduleCode)) return null;

  if (node.isSummary) {
    const children = node.children
      .map((child) => filterNode(child, input, external))
      .filter((child): child is MenuNode => child !== null);
    if (children.length === 0) return null;
    // A folder is never locked: rights are held on the destination, and a
    // folder has none. Stated explicitly rather than left `undefined` so the
    // payload has one shape — every node reports its state, not "false or
    // absent depending on what it is".
    return { ...node, locked: false, children };
  }

  // Step 3 — role rights. "Any of": the menu unlocks when the caller holds at
  // least one of the codes. A menu with no requirement is never locked.
  const held = input.permissions.some((code) => node.requiredPermissions.includes(code));
  if (node.requiredPermissions.length === 0 || held) {
    return { ...node, locked: false };
  }
  return {
    ...node,
    locked: true,
    lockedReason: `Requires one of: ${node.requiredPermissions.join(", ")}`,
  };
}

/** Applies the §4.3 filter, in its fixed order, to a served catalogue. */
export function filterMenuForCaller(tree: MenuNode[], input: MenuFilterInput): MenuNode[] {
  const external = isExternalCaller(input.scopeTypes);
  return tree
    .map((node) => filterNode(node, input, external))
    .filter((node): node is MenuNode => node !== null);
}
