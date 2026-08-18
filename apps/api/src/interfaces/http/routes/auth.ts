import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Container } from "../../../composition-root.js";

const loginSchema = z.object({
  tenantCode: z.string().min(1),
  email: z.string().email(),
  password: z.string().min(1),
});

const refreshSchema = z.object({
  refreshToken: z.string().min(1),
});

export function registerAuthRoutes(app: FastifyInstance, container: Container) {
  app.post("/auth/login", async (request, reply) => {
    const body = loginSchema.parse(request.body);
    const result = await container.auth.login({ ...body, ip: request.ip });
    return reply.send({
      accessToken: result.accessToken,
      refreshToken: result.refreshToken,
      userId: result.userId,
      tenantId: result.tenantId,
    });
  });

  app.post("/auth/refresh", async (request, reply) => {
    const body = refreshSchema.parse(request.body);
    const result = await container.auth.refresh(body.refreshToken);
    return reply.send(result);
  });

  app.get("/me", { preHandler: app.authenticate }, async (request, reply) => {
    const actor = request.actor!;
    const permissions = await container.rbac.getEffectivePermissions(actor.userId);
    return reply.send({
      userId: actor.userId,
      tenantId: actor.tenantId,
      permissions: Array.from(permissions),
    });
  });
}
