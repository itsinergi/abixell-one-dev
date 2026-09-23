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

const updateSchema = z
  .object({
    fullName: z.string().min(1).optional(),
    email: z.string().email().optional(),
    password: z.string().min(8).optional(),
  })
  .refine((body) => body.fullName !== undefined || body.email !== undefined || body.password !== undefined, {
    message: "At least one profile field is required",
  });

const idSchema = z.object({ id: z.string().uuid() });

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

  app.patch("/users/:id", { preHandler: app.authenticate }, async (request, reply) => {
    const { id } = idSchema.parse(request.params);
    const body = updateSchema.parse(request.body);
    const user = await container.user.updateProfile(request.actor!, id, body);
    return reply.send(user);
  });

  app.post("/users/:id/activate", { preHandler: app.authenticate }, async (request, reply) => {
    const { id } = idSchema.parse(request.params);
    return reply.send(await container.user.setActive(request.actor!, id, true));
  });

  app.post("/users/:id/deactivate", { preHandler: app.authenticate }, async (request, reply) => {
    const { id } = idSchema.parse(request.params);
    return reply.send(await container.user.setActive(request.actor!, id, false));
  });

  app.delete("/users/:id", { preHandler: app.authenticate }, async (request, reply) => {
    const { id } = idSchema.parse(request.params);
    return reply.send(await container.user.softDelete(request.actor!, id));
  });
}
