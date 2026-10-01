import { timingSafeEqual } from "node:crypto";
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
/**
 * Constant-time comparison of a caller-supplied secret against the configured
 * bootstrap key. `timingSafeEqual` throws when the two buffers differ in
 * length, so the lengths are compared first; that check leaks only the key's
 * length, not its contents.
 */
export function bootstrapKeyMatches(provided: unknown, expected: string | undefined): boolean {
  if (!expected || typeof provided !== "string") return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export function registerBootstrapAuthDecorators(app: FastifyInstance): void {
  app.decorate(
    "requireBootstrapKey",
    async (request: FastifyRequest, reply: FastifyReply) => {
      if (!bootstrapKeyMatches(request.headers["x-bootstrap-key"], process.env.PLATFORM_BOOTSTRAP_KEY)) {
        return reply.status(401).send({ error: "Invalid or missing bootstrap key" });
      }
    },
  );
}
