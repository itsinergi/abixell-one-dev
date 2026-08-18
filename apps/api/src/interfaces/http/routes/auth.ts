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

const logoutSchema = z.object({
  refreshToken: z.string().min(1),
});

export function registerAuthRoutes(app: FastifyInstance, container: Container) {
  // Security (Checkpoint 0F): a much tighter per-route rate limit than
  // the global default — login is the one endpoint where an attacker can
  // profitably guess credentials, so it gets its own budget (per IP, per
  // Fastify/rate-limit default keying).
  app.post(
    "/auth/login",
    { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } },
    async (request, reply) => {
      const body = loginSchema.parse(request.body);
      const result = await container.auth.login({ ...body, ip: request.ip });
      return reply.send({
        accessToken: result.accessToken,
        refreshToken: result.refreshToken,
        userId: result.userId,
        tenantId: result.tenantId,
      });
    },
  );

  app.post("/auth/refresh", async (request, reply) => {
    const body = refreshSchema.parse(request.body);
    const result = await container.auth.refresh(body.refreshToken);
    return reply.send(result);
  });

  // Frontend token/session persistence (Checkpoint 0F) means a refresh
  // token can now live in the browser across reloads for up to 7 days —
  // logout must actively revoke it server-side, not just discard it
  // client-side, or a stolen/leftover token would keep working after the
  // user believes they signed out.
  app.post("/auth/logout", async (request, reply) => {
    const body = logoutSchema.parse(request.body);
    await container.auth.logout(body.refreshToken);
    return reply.status(204).send();
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
