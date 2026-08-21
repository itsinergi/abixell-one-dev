import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Container } from "../../../composition-root.js";

const createServiceSchema = z.object({
  code: z.string().min(1),
  name: z.string().min(1),
  description: z.string().nullable().optional(),
});

const createAssignmentSchema = z.object({
  customerId: z.string().uuid(),
  serviceId: z.string().uuid(),
  contractId: z.string().uuid().nullable().optional(),
  projectId: z.string().uuid().nullable().optional(),
  siteId: z.string().uuid().nullable().optional(),
  internalPicUserId: z.string().uuid().nullable().optional(),
});

const updateServiceSchema = createServiceSchema.extend({ isActive: z.boolean().optional() }).partial();

const updateAssignmentSchema = z.object({
  status: z.string().optional(),
});

const idParamSchema = z.object({ id: z.string().uuid() });

export function registerServiceRoutes(app: FastifyInstance, container: Container) {
  app.post("/services", { preHandler: app.authenticate }, async (request, reply) => {
    const body = createServiceSchema.parse(request.body);
    const service = await container.serviceCatalog.createService(request.actor!, body);
    return reply.status(201).send(service);
  });

  app.get("/services", { preHandler: app.authenticate }, async (request, reply) => {
    const list = await container.serviceCatalog.listServices(request.actor!);
    return reply.send(list);
  });

  app.patch("/services/:id", { preHandler: app.authenticate }, async (request, reply) => {
    const params = idParamSchema.parse(request.params);
    const body = updateServiceSchema.parse(request.body);
    const service = await container.serviceCatalog.updateService(request.actor!, params.id, body);
    return reply.send(service);
  });

  app.post("/customer-service-links", { preHandler: app.authenticate }, async (request, reply) => {
    const body = createAssignmentSchema.parse(request.body);
    const link = await container.serviceCatalog.assignToCustomer(request.actor!, body);
    return reply.status(201).send(link);
  });

  app.get("/customer-service-links", { preHandler: app.authenticate }, async (request, reply) => {
    const query = z.object({ customerId: z.string().uuid() }).parse(request.query);
    const list = await container.serviceCatalog.listAssignmentsForCustomer(
      request.actor!,
      query.customerId,
    );
    return reply.send(list);
  });

  app.patch("/customer-service-links/:id", { preHandler: app.authenticate }, async (request, reply) => {
    const params = idParamSchema.parse(request.params);
    const body = updateAssignmentSchema.parse(request.body);
    const link = await container.serviceCatalog.updateAssignment(request.actor!, params.id, body);
    return reply.send(link);
  });
}
