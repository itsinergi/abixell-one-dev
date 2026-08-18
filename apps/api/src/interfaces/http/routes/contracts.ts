import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Container } from "../../../composition-root.js";

const createSchema = z.object({
  customerId: z.string().uuid(),
  code: z.string().min(1),
  name: z.string().min(1),
  startDate: z.string().nullable().optional(),
  endDate: z.string().nullable().optional(),
  status: z.string().optional(),
});

export function registerContractRoutes(app: FastifyInstance, container: Container) {
  app.post("/contracts", { preHandler: app.authenticate }, async (request, reply) => {
    const body = createSchema.parse(request.body);
    const contract = await container.contract.create(request.actor!, body);
    return reply.status(201).send(contract);
  });

  app.get("/contracts", { preHandler: app.authenticate }, async (request, reply) => {
    const query = z.object({ customerId: z.string().uuid() }).parse(request.query);
    const list = await container.contract.listByCustomer(request.actor!, query.customerId);
    return reply.send(list);
  });
}
