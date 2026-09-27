/**
 * Module-active enforcement (Epic 3 Wave 3, CORE-ROADMAP.md §4.3 step 9).
 *
 * §4.3 fixes the consequence of an inactive module, and only that consequence:
 *
 *   MODUL NONAKTIF
 *     menu kerja                 hilang          (Wave 2, menu-filter.ts)
 *     create / update / action   DITOLAK di API   ← this file
 *     baca arsip / ekspor        boleh, lewat izin khusus
 *     data                       tidak pernah dihapus
 *
 * "Menonaktifkan modul harus berarti sesuatu di server" (§4.3 prinsip 5). Until
 * this check existed, a tenant could switch a module off and still drive the
 * whole of it through a direct URL or an integration using a legitimate actor
 * (see the gap recorded at §4.3 "Menonaktifkan modul saat ini hanya kosmetik").
 *
 * Why writes only. The roadmap asks for a block on create/update/action — not
 * on reads — because reads are how an archive is reached, and cutting them
 * would "memutus akses ke arsip, menggagalkan ekspor untuk audit, dan membuat
 * kewajiban lama yang belum selesai tidak bisa ditutup" (§4.3). Rejecting a
 * write is also strictly safety-increasing: it can never lock a legitimate
 * reader out of data, which is the failure mode a stricter read rule could
 * introduce. The rollback plan keeps the two separable for the same reason
 * ("Rollback aturan write/action secara terpisah", §4.3).
 *
 * Two deliberate pass-throughs, both stated rather than silent:
 *
 *   - `platform` is exempt. The module owns identity, tenancy, configuration
 *     and the move to activate a module at all — `PUT /config/modules/:code`
 *     resolves to `platform` through `attributeApiPath`. The menu layer
 *     reaches the same outcome with a NULL `module_id` (§4.3 Wave 2 decision
 *     #1); at the API layer the exemption has to be explicit because
 *     `attributeApiPath` does resolve those segments. Without it the check
 *     would lock the door to its own switch — and on a tenant that has no
 *     activation rows yet (every module inactive by default) that lock is the
 *     whole application.
 *
 *   - A path whose first segment resolves to no module is passed through. The
 *     root and a `:param` segment resolve to `undefined` by design
 *     (`attributeApiPath`), so the caller cannot silently default them; there
 *     is no module whose activity could be consulted, and inventing one would
 *     be the "kesalahan yang tidak terlihat" the attribution table exists to
 *     prevent.
 *
 * Pure and total: it decides, it does not act. The wiring is in
 * `module-activity-plugin.ts`, and the reason string below is the one §4.3
 * fixes for the user to read.
 */

import { attributeApiPath, type ModuleCode } from "./module-attribution.js";

/** The methods §4.3 calls create / update / action. */
export const MUTATING_METHODS = ["POST", "PUT", "PATCH", "DELETE"] as const;

export type MutatingMethod = (typeof MUTATING_METHODS)[number];

/**
 * The platform module is never subject to its own check. See the file header:
 * this is what keeps `PUT /config/modules/:code` — the route that activates
 * anything — reachable on a tenant whose modules are all inactive.
 */
export const MODULE_ACTIVITY_EXEMPT: ModuleCode = "platform";

/** §4.3 "Penjelasan saat alamat dibuka langsung": 403 dengan alasan. */
export const MODULE_INACTIVE_REASON = "Modul ini tidak aktif untuk tenant Anda.";

export interface ModuleActivityInput {
  /** HTTP method as the route declares it, e.g. `POST`. */
  method: string;
  /** The route pattern as Fastify declares it, e.g. `/complaints/:id`. */
  path: string;
  /** Module codes active for the caller's tenant. */
  activeModuleCodes: readonly string[];
}

export interface ModuleActivityDecision {
  /** `false` only when a write is rejected for an inactive module. */
  allowed: boolean;
  /** The module the decision was made about; absent when nothing applied. */
  moduleCode?: ModuleCode;
  /** Present exactly when `allowed` is false. */
  reason?: string;
}

/**
 * Decide whether a request may proceed under the module-active rule.
 *
 * Order is fixed and each step is the reason the next one need not run:
 * method → attribution → exemption → activity.
 */
export function evaluateModuleActivity(input: ModuleActivityInput): ModuleActivityDecision {
  // Step 1 — reads are never blocked. "baca arsip tetap boleh".
  if (!MUTATING_METHODS.includes(input.method as MutatingMethod)) {
    return { allowed: true };
  }

  const moduleCode = attributeApiPath(input.path);

  // Step 2 — unresolvable path: no module to consult. Reported upstream as an
  // unattributed segment by the dictionary parity test, not defaulted here.
  if (moduleCode === undefined) return { allowed: true };

  // Step 3 — the platform exemption (see header).
  if (moduleCode === MODULE_ACTIVITY_EXEMPT) return { allowed: true };

  // Step 4 — the module must be active for this tenant. A module with no
  // activation row is inactive: `listActiveModuleCodes` selects
  // `is_active = true` only, so absence and false are the same state.
  if (input.activeModuleCodes.includes(moduleCode)) {
    return { allowed: true, moduleCode };
  }

  return {
    allowed: false,
    moduleCode,
    reason: MODULE_INACTIVE_REASON,
  };
}
