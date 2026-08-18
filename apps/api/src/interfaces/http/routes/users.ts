import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Container } from "../../../composition-root.js";

const createSchema = z.object({
  email: z.string().email(),
  fullName: z.string().min(1),
  password: z.string().min(8),
  roleCode: z.string().min(1),
  scopeType: z.enum(["tenant", "organization_unit", "customer"]),
  scopeOrganizationUnitId: z.string().uuid().nullable().optional(),
  // Checkpoint 1A / ADR-0011 — required when scopeType === "customer".
  scopeCustomerId: z.string().uuid().nullable().optional(),
});

export function registerUserRoutes(app: FastifyInstance, container: Container) {
  app.post("/users", { preHandler: app.authenticate }, async (request, reply) => {
    const body = createSchema.parse(request.body);
    const actor = request.actor!;
    const { user, assignment } = await container.user.createWithRole(actor, body);
    return reply.status(201).send({ user, assignment });
  });

  app.get("/users", { preHandler: app.authenticate }, async (request, reply) => {
    const actor = request.actor!;
    const list = await container.user.listForTenant(actor);
    return reply.send(list);
  });
}
