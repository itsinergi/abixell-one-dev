import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Container } from "../../../composition-root.js";

/**
 * WP-APR-02 — Central Rule Registry surface (DEC-008/BR-013).
 * Governed by config.manage (rule content) / config.read (listing).
 */

const registerSchema = z
  .object({
    ruleKey: z.string().trim().min(1),
    payload: z.record(z.unknown()),
    activate: z.boolean().optional(),
  })
  .strict();

const keySchema = z.object({ key: z.string().trim().min(1) });
const idSchema = z.object({ id: z.string().uuid() });
const statusSchema = z.object({ status: z.enum(["draft", "active", "retired"]) });

export function registerRuleRegistryRoutes(app: FastifyInstance, container: Container): void {
  app.get(
    "/rule-registry/:key",
    { preHandler: app.authenticate },
    async (request, reply) => {
      const { key } = keySchema.parse(request.params);
      return reply.send(await container.ruleRegistry.list(request.actor!, key));
    },
  );

  app.post(
    "/rule-registry",
    { preHandler: app.authenticate },
    async (request, reply) => {
      const body = registerSchema.parse(request.body);
      const entry = await container.ruleRegistry.register(request.actor!, body);
      return reply.status(201).send(entry);
    },
  );

  app.patch(
    "/rule-registry/:id/status",
    { preHandler: app.authenticate },
    async (request, reply) => {
      const { id } = idSchema.parse(request.params);
      const { status } = statusSchema.parse(request.body);
      const entry = await container.ruleRegistry.setStatus(request.actor!, id, status);
      return reply.send(entry);
    },
  );
}
