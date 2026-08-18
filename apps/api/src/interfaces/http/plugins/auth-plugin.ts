import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { verifyAccessToken } from "../../../infrastructure/security/jwt.js";
import type { ActorContext } from "../../../domain/shared-kernel/audit-context.js";

declare module "fastify" {
  interface FastifyRequest {
    actor?: ActorContext;
  }
  interface FastifyInstance {
    authenticate: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
}

/**
 * Verifies the JWT access token and attaches `request.actor`. This is the
 * ONLY place a token is trusted; every route that needs an authenticated
 * user calls `app.authenticate` as a preHandler — there is no route that
 * infers identity from anything the client sends unverified.
 *
 * Registered directly on the top-level Fastify instance (not via
 * `app.register`) so the `authenticate` decorator is visible to every
 * sibling route module without fighting Fastify's plugin encapsulation.
 */
export function registerAuthDecorators(app: FastifyInstance): void {
  app.decorate("authenticate", async (request: FastifyRequest, reply: FastifyReply) => {
    const header = request.headers.authorization;
    if (!header?.startsWith("Bearer ")) {
      return reply.status(401).send({ error: "Missing bearer token" });
    }
    const token = header.slice("Bearer ".length);
    try {
      const payload = verifyAccessToken(token);
      request.actor = { userId: payload.sub, tenantId: payload.tenantId };
    } catch {
      return reply.status(401).send({ error: "Invalid or expired access token" });
    }
  });
}
