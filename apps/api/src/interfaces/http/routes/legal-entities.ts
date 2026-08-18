import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Container } from "../../../composition-root.js";

const createSchema = z.object({
  name: z.string().min(2),
  registrationNo: z.string().optional(),
});

export function registerLegalEntityRoutes(app: FastifyInstance, container: Container) {
  app.post("/legal-entities", { preHandler: app.authenticate }, async (request, reply) => {
    const body = createSchema.parse(request.body);
    const actor = request.actor!;
    const legalEntity = await container.legalEntity.create(actor, body);
    return reply.status(201).send(legalEntity);
  });

  app.get("/legal-entities", { preHandler: app.authenticate }, async (request, reply) => {
    const actor = request.actor!;
    const list = await container.legalEntity.listForTenant(actor);
    return reply.send(list);
  });
}
