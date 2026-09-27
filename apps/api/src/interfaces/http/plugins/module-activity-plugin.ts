/**
 * Module-active enforcement wiring (Epic 3 Wave 3, CORE-ROADMAP.md §4.3 step 9).
 *
 * The decision rule is pure and lives in `module-enforcement.ts`; this plugin
 * only places it in the request path. It works the same way
 * `@fastify/rate-limit` does (the mechanism app.ts already documents): an
 * `onRoute` hook appends one `preHandler` to every mutating route, so the
 * check runs AFTER `app.authenticate` — the handler that populates
 * `request.actor`. A plain global `preValidation` hook would run before
 * `authenticate` and find no actor on most routes, which is why it is not
 * used here.
 *
 * Scope, per route, is decided by the pure rule: reads pass, unattributable
 * paths pass, `platform` passes. What this layer adds is the tenant's live
 * module state — one query per request, resolved through the same
 * ConfigurationService the menu filter feeds from, so the two cannot
 * disagree about what "active" means.
 *
 * No request can reach this hook without having run it: Fastify merges the
 * `preHandler` array on the route options, and the hook appends to whatever
 * the route already declared (usually `[app.authenticate]`), preserving
 * order.
 */

import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import {
  evaluateModuleActivity,
  MUTATING_METHODS,
  MODULE_INACTIVE_REASON,
} from "../../../domain/configuration/module-enforcement.js";
import { ForbiddenError } from "../../../domain/shared-kernel/errors.js";
import type { Container } from "../../../composition-root.js";

async function enforceModuleActivity(
  request: FastifyRequest,
  _reply: FastifyReply,
  container: Container,
): Promise<void> {
  const method = request.method.toUpperCase();
  if (!MUTATING_METHODS.includes(method as (typeof MUTATING_METHODS)[number])) return;

  const routeUrl = request.routeOptions?.url;
  if (!routeUrl) return;

  // Unauthenticated callers have no tenant to be active IN. Every mutating
  // route that matters is behind `authenticate`; the two token-validated
  // public routes are reads-or-self-contained writes whose reach is bounded
  // by the token itself, not by any tenant's module state.
  const actor = request.actor;
  if (!actor) return;

  const decision = evaluateModuleActivity({
    method,
    path: routeUrl,
    activeModuleCodes: await container.configuration.listActiveModuleCodesForTenant(
      actor.tenantId,
    ),
  });

  if (!decision.allowed) {
    throw new ForbiddenError(decision.reason ?? MODULE_INACTIVE_REASON);
  }
}

/**
 * Appends the module-active check to every mutating route, after the route's
 * own `preHandler` chain (i.e. after `app.authenticate`). Registered on the
 * top-level instance alongside `registerAuthDecorators`, so every sibling
 * route module is covered without any route opting in.
 */
export function registerModuleActivityEnforcement(
  app: FastifyInstance,
  container: Container,
): void {
  app.addHook("onRoute", (route) => {
    const methods = Array.isArray(route.method) ? route.method : [route.method];
    const isMutating = methods.some((m) =>
      MUTATING_METHODS.includes(m.toUpperCase() as (typeof MUTATING_METHODS)[number]),
    );
    if (!isMutating) return;

    const existing = route.preHandler;
    const gate = async (request: FastifyRequest, reply: FastifyReply) =>
      enforceModuleActivity(request, reply, container);

    if (existing === undefined) {
      route.preHandler = gate;
    } else if (Array.isArray(existing)) {
      existing.push(gate);
    } else {
      route.preHandler = [existing, gate];
    }
  });
}
