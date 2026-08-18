import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Container } from "../../../composition-root.js";

const createSchema = z.object({
  legalEntityId: z.string().uuid(),
  parentId: z.string().uuid().nullable().optional(),
  name: z.string().min(1),
  unitType: z.string().optional(),
});

export function registerOrganizationUnitRoutes(app: FastifyInstance, container: Container) {
  app.post("/organization-units", { preHandler: app.authenticate }, async (request, reply) => {
    const body = createSchema.parse(request.body);
    const actor = request.actor!;
    const unit = await container.organizationUnit.create(actor, body);
    return reply.status(201).send(unit);
  });

  app.get("/organization-units", { preHandler: app.authenticate }, async (request, reply) => {
    const actor = request.actor!;
    const list = await container.organizationUnit.listForTenant(actor);
    return reply.send(list);
  });
}
