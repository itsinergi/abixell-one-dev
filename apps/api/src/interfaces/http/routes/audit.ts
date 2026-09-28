import type { FastifyInstance } from "fastify";
import type { Container } from "../../../composition-root.js";

export function registerAuditRoutes(app: FastifyInstance, container: Container) {
  app.get("/audit-log/recent", { preHandler: app.authenticate }, async (request, reply) => {
    const actor = request.actor!;
    await container.rbac.requirePermission(actor, "audit_log.read");
    const entries = await container.audit.listRecentByTenant(actor.tenantId, 50);
    return reply.send(entries);
  });
}
