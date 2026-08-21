import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Container } from "../../../composition-root.js";

const createSchema = z.object({
  customerId: z.string().uuid(),
  projectId: z.string().uuid().nullable().optional(),
  code: z.string().min(1),
  name: z.string().min(1),
  address: z.string().nullable().optional(),
  status: z.string().optional(),
});

const updateSchema = z.object({
  code: z.string().min(1).optional(),
  name: z.string().min(1).optional(),
  address: z.string().nullable().optional(),
  status: z.string().optional(),
});

const idParamSchema = z.object({ id: z.string().uuid() });

export function registerSiteRoutes(app: FastifyInstance, container: Container) {
  app.post("/sites", { preHandler: app.authenticate }, async (request, reply) => {
    const body = createSchema.parse(request.body);
    const site = await container.site.create(request.actor!, body);
    return reply.status(201).send(site);
  });

  app.get("/sites", { preHandler: app.authenticate }, async (request, reply) => {
    const query = z.object({ customerId: z.string().uuid() }).parse(request.query);
    const list = await container.site.listByCustomer(request.actor!, query.customerId);
    return reply.send(list);
  });

  app.patch("/sites/:id", { preHandler: app.authenticate }, async (request, reply) => {
    const params = idParamSchema.parse(request.params);
    const body = updateSchema.parse(request.body);
    const site = await container.site.update(request.actor!, params.id, body);
    return reply.send(site);
  });
}
