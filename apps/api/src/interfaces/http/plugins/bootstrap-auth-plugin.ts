import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";

declare module "fastify" {
  interface FastifyInstance {
    requireBootstrapKey: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
}

/**
 * Guards platform-bootstrap-only operations (currently: Tenant creation).
 * See ADR-0004 — Tenant creation happens before any User/Role exists in a
 * deployment, so ordinary RBAC cannot apply; a shared secret held only by
 * the platform operator (Insting Tekno Sinergi engineering) stands in for
 * it instead. This is NOT a substitute for RBAC on any other endpoint.
 */
export function registerBootstrapAuthDecorators(app: FastifyInstance): void {
  app.decorate(
    "requireBootstrapKey",
    async (request: FastifyRequest, reply: FastifyReply) => {
      const expected = process.env.PLATFORM_BOOTSTRAP_KEY;
      const provided = request.headers["x-bootstrap-key"];
      if (!expected || provided !== expected) {
        return reply.status(401).send({ error: "Invalid or missing bootstrap key" });
      }
    },
  );
}
