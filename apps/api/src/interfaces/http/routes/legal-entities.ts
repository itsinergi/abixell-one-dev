import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Container } from "../../../composition-root.js";

const createSchema = z.object({
  name: z.string().min(2),
  registrationNo: z.string().optional(),
});

const updateSchema = z.object({
  name: z.string().min(2),
  registrationNo: z.string().nullable().optional(),
});

const idSchema = z.object({ id: z.string().uuid() });

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

  app.patch(
    "/legal-entities/:id",
    { preHandler: app.authenticate },
    async (request, reply) => {
      const { id } = idSchema.parse(request.params);
      const body = updateSchema.parse(request.body);
      const legalEntity = await container.legalEntity.update(request.actor!, id, body);
      return reply.send(legalEntity);
    },
  );

  app.post(
    "/legal-entities/:id/activate",
    { preHandler: app.authenticate },
    async (request, reply) => {
      const { id } = idSchema.parse(request.params);
      const legalEntity = await container.legalEntity.setActive(request.actor!, id, true);
      return reply.send(legalEntity);
    },
  );

  app.post(
    "/legal-entities/:id/deactivate",
    { preHandler: app.authenticate },
    async (request, reply) => {
      const { id } = idSchema.parse(request.params);
      const legalEntity = await container.legalEntity.setActive(request.actor!, id, false);
      return reply.send(legalEntity);
    },
  );
}
