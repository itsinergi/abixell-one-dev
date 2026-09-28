import type { FastifyInstance } from "fastify";
import type { Container } from "../../../composition-root.js";

/**
 * Observability Foundation (Checkpoint 0E): a read surface over the
 * durable Event Foundation log. Scheduled Job run history — the other
 * half of Observability doc 07/06 don't explicitly name but this
 * checkpoint's Scheduler needs — is already exposed under
 * `/scheduler/jobs/:jobCode/runs` (gated by `scheduler.manage`); kept
 * there rather than duplicated here since it is specifically about job
 * runs, not general domain events. Every HTTP request is also already
 * structured-logged by Fastify's built-in pino logger with a per-request
 * `reqId` (see app.ts) — that request-correlation layer needs no HTTP
 * surface, it is Observability read from the process's own stdout/log
 * sink, not from the database.
 */
export function registerObservabilityRoutes(app: FastifyInstance, container: Container) {
  app.get("/observability/events", { preHandler: app.authenticate }, async (request, reply) => {
    const actor = request.actor!;
    await container.rbac.requirePermission(actor, "observability.read");
    const events = await container.eventBus.listRecentByTenant(actor.tenantId, 100);
    return reply.send(events);
  });
}
