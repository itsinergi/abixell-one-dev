/**
 * Window read-only enforcement wiring (Epic 4 Wave 1, CORE-ROADMAP.md §4.4
 * step 11b).
 *
 * The decision rule is pure and lives in `window-enforcement.ts`; this plugin
 * only places it in the request path. It is deliberately the same shape as
 * `module-activity-plugin.ts`, for the same mechanical reason: an `onRoute`
 * hook appends one `preHandler` to every mutating route, so the check runs
 * AFTER `app.authenticate` — the handler that populates `request.actor`. A
 * global `preValidation` hook would run before `authenticate` on most routes
 * and find no actor.
 *
 * Order against the module-active check matters and is fixed by registration
 * order in `app.ts`: this plugin is registered after
 * `registerModuleActivityEnforcement`, so its `gate` is appended second and an
 * inactive module reports "modul tidak aktif" rather than "hanya baca". Both
 * are 403s; the first reason is the more actionable one, because activating the
 * module is what the actor has to do first.
 *
 * `window_code` for the decision comes only from `resolveWindowForApiPath`
 * reading the route pattern Fastify resolved. Nothing is read from the request
 * body, headers, or query string — §4.4: "`window_code` pada keputusan
 * enforcement selalu berasal dari resolusi route di server, tidak pernah dari
 * nilai yang dikirim browser."
 *
 * One query per mutating request, and only after the pure rule has decided the
 * route is mapped. A route with no Window rule costs nothing: the decision is
 * returned before the repository is consulted.
 */

import type {
  FastifyInstance,
  FastifyReply,
  FastifyRequest,
  RouteOptions,
} from "fastify";
import {
  registerServedMutatingRoute,
  resolveWindowForApiPath,
  WINDOW_READ_ONLY_REASON,
  MUTATING_METHODS,
} from "../../../domain/configuration/window-enforcement.js";
import { ForbiddenError } from "../../../domain/shared-kernel/errors.js";
import type { Container } from "../../../composition-root.js";

async function enforceWindowWriteAccess(
  request: FastifyRequest,
  _reply: FastifyReply,
  container: Container,
): Promise<void> {
  const method = request.method.toUpperCase();
  if (!MUTATING_METHODS.includes(method as (typeof MUTATING_METHODS)[number])) return;

  const routeUrl = request.routeOptions?.url;
  if (!routeUrl) return;

  // Unauthenticated callers hold no Role, so no Window lock can apply to them.
  // The two token-validated public writes (`/public/surveys/:token/submit` and
  // the inbound webhook receiver) are bounded by the token itself.
  const actor = request.actor;
  if (!actor) return;

  const windowCode = resolveWindowForApiPath(method, routeUrl);
  if (windowCode === undefined) return;

  // Epic 1 (§4.1 C) — the lock is evaluated against the ACTIVE Role. A
  // read-only Assignment must not be able to write through because another
  // Role the user holds is writable, and a writable Assignment must not be
  // silenced because a switched-away Role is read-only.
  const access = await container.rbac.getWindowAccessStateForActor(
    actor,
    windowCode,
  );

  // Absence is "not configured", never "read-only": the table ships empty and
  // a Window no Role is configured for is outside the lock. See the decision
  // module's header for why treating the two alike would break every tenant.
  if (!access.configured) return;

  // Union allow — one writable, active assignment is enough.
  if (access.writable) return;

  throw new ForbiddenError(WINDOW_READ_ONLY_REASON);
}

/**
 * Whether a route declaration puts `app.authenticate` in its `preHandler`
 * chain, so the request will carry an actor by the time any gate runs.
 *
 * Answered from the declaration alone — no request is observed and no handler
 * is executed — because this is a fact about the route, not about traffic. The
 * comparison is by identity against the decorator the auth plugin installed:
 * an inline re-implementation of token checking would not be this function,
 * and this returns `false` for it, which is the safe direction. A route that
 * verified a token without going through the decorator would be reported as
 * having no actor, and a route with no actor cannot claim the
 * `unauthenticated` exemption while carrying authentication.
 */
function declaresActor(
  app: FastifyInstance,
  preHandler: RouteOptions["preHandler"],
): boolean {
  if (preHandler === undefined) return false;
  const chain = Array.isArray(preHandler) ? preHandler : [preHandler];
  return chain.some((handler) => handler === app.authenticate);
}

/**
 * Appends the Window read-only check to every mutating route, after the
 * route's own `preHandler` chain (i.e. after `app.authenticate`), and after
 * the module-active gate when that is registered first.
 *
 * The same hook records each route in the accountability census, so
 * `windowEnforcementStatus()` reports what the server actually declared rather
 * than what a constant beside it claims. Reading the declaration here is what
 * lets the coverage test hold the exemption list to account: the properties
 * `registerServedMutatingRoute` checks are properties of the route object, and
 * this is the only place that object is available.
 */
export function registerWindowAccessEnforcement(
  app: FastifyInstance,
  container: Container,
): void {
  app.addHook("onRoute", (route) => {
    const methods = Array.isArray(route.method) ? route.method : [route.method];
    const mutating = methods.filter((m) =>
      MUTATING_METHODS.includes(m.toUpperCase() as (typeof MUTATING_METHODS)[number]),
    );

    // Recorded before the gate is appended: the census describes the routes the
    // application declared, and the gate is this plugin's own addition.
    const hasActor = declaresActor(app, route.preHandler);
    for (const method of mutating) {
      registerServedMutatingRoute({ method, apiPath: route.url, hasActor });
    }

    if (mutating.length === 0) return;

    const existing = route.preHandler;
    const gate = async (request: FastifyRequest, reply: FastifyReply) =>
      enforceWindowWriteAccess(request, reply, container);

    if (existing === undefined) {
      route.preHandler = gate;
    } else if (Array.isArray(existing)) {
      existing.push(gate);
    } else {
      route.preHandler = [existing, gate];
    }
  });
}
