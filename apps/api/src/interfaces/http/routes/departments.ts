import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Container } from "../../../composition-root.js";

/**
 * `/departments` — the Department master (Epic 5 Gelombang 1, G0 contract M8).
 *
 * A Department organises people; it is NOT an authorization scope. Nothing in
 * this file (or in `DepartmentService` / `PgDepartmentRepository`) feeds a
 * Department id into a Data Scope decision — see the module comment on
 * `domain/department/department.entity.ts`. Deactivation exists so a
 * superseded Department can be retired without a hard delete; there is no
 * tombstone because a Department holds no scope reference to preserve
 * (G0 §5: "active / inactive only").
 *
 * Bodies are `.strict()`: `code` is the business identifier and is unique per
 * Tenant, so a mistyped key must be a 400 rather than an ignored field.
 */

const createSchema = z
  .object({
    name: z.string().trim().min(1).max(160),
    code: z.string().trim().min(1).max(64).nullable().optional(),
    parentDepartmentId: z.string().uuid().nullable().optional(),
  })
  .strict();

const updateSchema = z
  .object({
    name: z.string().trim().min(1).max(160).optional(),
    code: z.string().trim().min(1).max(64).nullable().optional(),
    parentDepartmentId: z.string().uuid().nullable().optional(),
  })
  .strict();

const idSchema = z.object({ id: z.string().uuid() });

export function registerDepartmentRoutes(app: FastifyInstance, container: Container) {
  app.post("/departments", { preHandler: app.authenticate }, async (request, reply) => {
    const body = createSchema.parse(request.body);
    const actor = request.actor!;
    const department = await container.departments.create(actor, body);
    return reply.status(201).send(department);
  });

  app.get("/departments", { preHandler: app.authenticate }, async (request, reply) => {
    const actor = request.actor!;
    const list = await container.departments.listForTenant(actor);
    return reply.send(list);
  });

  app.patch("/departments/:id", { preHandler: app.authenticate }, async (request, reply) => {
    const { id } = idSchema.parse(request.params);
    const body = updateSchema.parse(request.body);
    const department = await container.departments.update(request.actor!, id, body);
    return reply.send(department);
  });

  app.post(
    "/departments/:id/deactivate",
    { preHandler: app.authenticate },
    async (request, reply) => {
      const { id } = idSchema.parse(request.params);
      const department = await container.departments.setActive(request.actor!, id, false);
      return reply.send(department);
    },
  );

  app.post(
    "/departments/:id/activate",
    { preHandler: app.authenticate },
    async (request, reply) => {
      const { id } = idSchema.parse(request.params);
      const department = await container.departments.setActive(request.actor!, id, true);
      return reply.send(department);
    },
  );
}
