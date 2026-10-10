import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Container } from "../../../composition-root.js";

/**
 * WP-APR-03 — Segregation of Duties surface.
 *
 * The hard block lives in the DB trigger on `user_role_assignments`; this
 * surface lets a tenant administrator (config.manage) govern the forbidden
 * pair rules and survey violations already present.
 */

const createSchema = z
  .object({
    roleCodeA: z.string().trim().min(1),
    roleCodeB: z.string().trim().min(1),
    reason: z.string().trim().min(1),
  })
  .strict();

const idSchema = z.object({ id: z.string().uuid() });

export function registerSodRoutes(app: FastifyInstance, container: Container): void {
  app.get(
    "/sod/rules",
    { preHandler: app.authenticate },
    async (request, reply) => {
      return reply.send(await container.sod.listRules(request.actor!));
    },
  );

  app.post(
    "/sod/rules",
    { preHandler: app.authenticate },
    async (request, reply) => {
      const body = createSchema.parse(request.body);
      const rule = await container.sod.createRule(request.actor!, body);
      return reply.status(201).send(rule);
    },
  );

  app.delete(
    "/sod/rules/:id",
    { preHandler: app.authenticate },
    async (request, reply) => {
      const { id } = idSchema.parse(request.params);
      await container.sod.deleteRule(request.actor!, id);
      return reply.status(204).send();
    },
  );

  app.get(
    "/sod/violations",
    { preHandler: app.authenticate },
    async (request, reply) => {
      return reply.send(await container.sod.listViolations(request.actor!));
    },
  );
}
