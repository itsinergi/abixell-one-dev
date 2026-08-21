import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Container } from "../../../composition-root.js";

const createCustomerSchema = z.object({
  code: z.string().min(1),
  name: z.string().min(1),
  status: z.string().optional(),
  ownerOrganizationUnitId: z.string().uuid().nullable().optional(),
  notes: z.string().nullable().optional(),
});

const createContactSchema = z.object({
  customerId: z.string().uuid(),
  name: z.string().min(1),
  email: z.string().email().nullable().optional(),
  phone: z.string().nullable().optional(),
  isPrimary: z.boolean().optional(),
});

const updateCustomerSchema = createCustomerSchema.partial();

const updateContactSchema = createContactSchema.omit({ customerId: true }).partial();

const idParamSchema = z.object({ id: z.string().uuid() });

export function registerCustomerRoutes(app: FastifyInstance, container: Container) {
  app.post("/customers", { preHandler: app.authenticate }, async (request, reply) => {
    const body = createCustomerSchema.parse(request.body);
    const customer = await container.customer.create(request.actor!, body);
    return reply.status(201).send(customer);
  });

  app.get("/customers", { preHandler: app.authenticate }, async (request, reply) => {
    const list = await container.customer.listForTenant(request.actor!);
    return reply.send(list);
  });

  app.patch("/customers/:id", { preHandler: app.authenticate }, async (request, reply) => {
    const params = idParamSchema.parse(request.params);
    const body = updateCustomerSchema.parse(request.body);
    const customer = await container.customer.update(request.actor!, params.id, body);
    return reply.send(customer);
  });

  app.post("/customer-contacts", { preHandler: app.authenticate }, async (request, reply) => {
    const body = createContactSchema.parse(request.body);
    const contact = await container.customer.createContact(request.actor!, body);
    return reply.status(201).send(contact);
  });

  app.get("/customer-contacts", { preHandler: app.authenticate }, async (request, reply) => {
    const query = z.object({ customerId: z.string().uuid() }).parse(request.query);
    const list = await container.customer.listContacts(request.actor!, query.customerId);
    return reply.send(list);
  });

  app.patch("/customer-contacts/:id", { preHandler: app.authenticate }, async (request, reply) => {
    const params = idParamSchema.parse(request.params);
    const body = updateContactSchema.parse(request.body);
    const contact = await container.customer.updateContact(request.actor!, params.id, body);
    return reply.send(contact);
  });
}
