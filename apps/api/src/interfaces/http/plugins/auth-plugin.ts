import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { verifyAccessToken } from "../../../infrastructure/security/jwt.js";
import { pool } from "../../../infrastructure/persistence/db.js";
import type { ActorContext } from "../../../domain/shared-kernel/audit-context.js";

declare module "fastify" {
  interface FastifyRequest {
    actor?: ActorContext;
  }
  interface FastifyInstance {
    authenticate: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
}

const INVALID_TOKEN_RESPONSE = { error: "Invalid or expired access token" } as const;

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
    let payload;
    try {
      payload = verifyAccessToken(token);
    } catch {
      return reply.status(401).send(INVALID_TOKEN_RESPONSE);
    }

    // Stale-JWT lifecycle hardening (Phase 11F): a valid signature is
    // necessary but not sufficient. Re-fetch the current actor on every
    // request so a deactivated/deleted/tenant-moved account loses access
    // immediately rather than surviving until its 15-minute token expires
    // (same precedent as jwt.ts: permissions are intentionally never
    // trusted from the token itself, only re-checked against the current
    // DB state). A single generic 401 covers every failure mode — deleted,
    // inactive, tenant mismatch — so a caller cannot distinguish them.
    const result = await pool.query<{ tenant_id: string; status: string }>(
      `SELECT tenant_id, status FROM users WHERE id = $1 AND deleted_at IS NULL`,
      [payload.sub],
    );
    const actor = result.rows[0];
    if (!actor || actor.status !== "active" || actor.tenant_id !== payload.tenantId) {
      return reply.status(401).send(INVALID_TOKEN_RESPONSE);
    }

    request.actor = { userId: payload.sub, tenantId: payload.tenantId };
  });
}
