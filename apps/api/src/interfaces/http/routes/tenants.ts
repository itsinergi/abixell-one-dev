import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Container } from "../../../composition-root.js";

const createTenantSchema = z.object({
  code: z.string().min(2).max(32),
  name: z.string().min(2),
});

export function registerTenantRoutes(app: FastifyInstance, container: Container) {
  // Platform-bootstrap only — see ADR-0004. Not an RBAC-guarded endpoint.
  app.post("/tenants", { preHandler: app.requireBootstrapKey }, async (request, reply) => {
    const body = createTenantSchema.parse(request.body);
    const tenant = await container.tenant.create(body);
    return reply.status(201).send(tenant);
  });

  // Authenticated read of the caller's own Tenant (dedicated-per-client
  // deployment: a user only ever belongs to one Tenant).
  app.get("/tenants/me", { preHandler: app.authenticate }, async (request, reply) => {
    const actor = request.actor!;
    await container.rbac.requirePermission(actor.userId, "tenant.read");
    const tenant = await container.tenant.getById(actor.tenantId);
    return reply.send(tenant);
  });
}
