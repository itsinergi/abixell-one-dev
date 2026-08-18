import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Container } from "../../../composition-root.js";

const createSchema = z.object({
  customerId: z.string().uuid(),
  contractId: z.string().uuid().nullable().optional(),
  code: z.string().min(1),
  name: z.string().min(1),
  status: z.string().optional(),
});

export function registerProjectRoutes(app: FastifyInstance, container: Container) {
  app.post("/projects", { preHandler: app.authenticate }, async (request, reply) => {
    const body = createSchema.parse(request.body);
    const project = await container.project.create(request.actor!, body);
    return reply.status(201).send(project);
  });

  app.get("/projects", { preHandler: app.authenticate }, async (request, reply) => {
    const query = z.object({ customerId: z.string().uuid() }).parse(request.query);
    const list = await container.project.listByCustomer(request.actor!, query.customerId);
    return reply.send(list);
  });
}
