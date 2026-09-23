import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Container } from "../../../composition-root.js";

const createSchema = z.object({
  legalEntityId: z.string().uuid(),
  parentId: z.string().uuid().nullable().optional(),
  name: z.string().min(1),
  unitType: z.string().optional(),
});

const updateSchema = z.object({
  name: z.string().min(1),
  unitType: z.string().min(1).optional(),
});

const idSchema = z.object({ id: z.string().uuid() });

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

  app.patch(
    "/organization-units/:id",
    { preHandler: app.authenticate },
    async (request, reply) => {
      const { id } = idSchema.parse(request.params);
      const body = updateSchema.parse(request.body);
      const unit = await container.organizationUnit.update(request.actor!, id, body);
      return reply.send(unit);
    },
  );

  app.post(
    "/organization-units/:id/activate",
    { preHandler: app.authenticate },
    async (request, reply) => {
      const { id } = idSchema.parse(request.params);
      const unit = await container.organizationUnit.setActive(request.actor!, id, true);
      return reply.send(unit);
    },
  );

  app.post(
    "/organization-units/:id/deactivate",
    { preHandler: app.authenticate },
    async (request, reply) => {
      const { id } = idSchema.parse(request.params);
      const unit = await container.organizationUnit.setActive(request.actor!, id, false);
      return reply.send(unit);
    },
  );
}
