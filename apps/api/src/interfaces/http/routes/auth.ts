import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Container } from "../../../composition-root.js";
import { getLoginRateLimitConfig } from "../../../infrastructure/security/http-hardening.js";

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
    { config: { rateLimit: getLoginRateLimitConfig() } },
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
    const [permissions, assignments] = await Promise.all([
      container.rbac.getEffectivePermissions(actor.userId),
      container.rbac.getAssignments(actor.userId),
    ]);
    // Checkpoint 1C.3 — expose the distinct Data-Scope types the actor holds
    // ("customer" vs "organization_unit"/"tenant"). This is what lets the
    // experience layer tell an external Customer User apart from an internal
    // operational user for navigation — a distinction permissions alone
    // cannot make (both hold complaint.read/manage). Authorization is still
    // enforced per-route in the backend; this only shapes the UI.
    const scopeTypes = Array.from(new Set(assignments.map((a) => a.scopeType)));
    return reply.send({
      userId: actor.userId,
      tenantId: actor.tenantId,
      permissions: Array.from(permissions),
      scopeTypes,
    });
  });
}
